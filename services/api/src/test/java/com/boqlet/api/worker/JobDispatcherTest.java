package com.boqlet.api.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.boqlet.api.db.StoredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.ConnectException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessResourceException;

/**
 * TF-184: the HTTP transport's transient failures. A worker that can't be reached doesn't use up the job's
 * attempts; a database restart neither cancels a healthy worker exchange nor loses its result.
 */
class JobDispatcherTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final Jobs jobs = mock(Jobs.class);
    private final WorkerClient worker = mock(WorkerClient.class);
    private final JobDispatcher dispatcher = new JobDispatcher(jobs, worker, new StoredJson(mapper), 1, Duration.ofMinutes(1));
    private final Jobs.Attempt attempt = new Jobs.Attempt(UUID.randomUUID(), "parse", UUID.randomUUID(), UUID.randomUUID(),
            UUID.randomUUID(), UUID.randomUUID(), "orgs/x/models/y/", mapper.createObjectNode(), 1, 3, "1", OffsetDateTime.now(), true);

    @Test
    void aWorkerThatRefusesTheConnectionLeavesTheJobWaitingWithoutUsingAnAttempt() throws Exception {
        when(worker.run(any(), any(), any())).thenThrow(new ConnectException("Connection refused"));
        when(jobs.postpone(eq(attempt), any())).thenReturn(true);
        dispatcher.execute(attempt);
        verify(jobs).postpone(eq(attempt), any());
        verify(jobs, never()).finish(any(), any(), any());
    }

    @Test
    void aJobThatHasWaitedLongEnoughFailsAsBefore() throws Exception {
        when(worker.run(any(), any(), any())).thenThrow(new ConnectException("Connection refused"));
        when(jobs.postpone(eq(attempt), any())).thenReturn(false);
        dispatcher.execute(attempt);
        var result = ArgumentCaptor.forClass(JsonNode.class);
        verify(jobs).finish(eq(attempt), any(), result.capture());
        assertThat(result.getValue().path("error").path("code").asText()).isEqualTo("engine_unavailable");
        assertThat(result.getValue().path("error").path("retryable").asBoolean()).isTrue();
    }

    @Test
    void aHeartbeatTheDatabaseRefusesDoesNotCancelTheExchange() throws Exception {
        var done = mapper.readTree("{\"status\":\"succeeded\",\"output\":{}}");
        when(worker.run(any(), any(), any())).thenAnswer(call -> {
            Thread.sleep(2_500);
            return done;
        });
        var beats = new AtomicInteger();
        when(jobs.heartbeat(eq(attempt), any())).thenAnswer(call -> {
            if (beats.incrementAndGet() == 1) throw new DataAccessResourceFailureException("connection reset");
            return true;
        });
        dispatcher.execute(attempt);
        verify(jobs).finish(eq(attempt), any(), eq(done));
        assertThat(beats.get()).isGreaterThanOrEqualTo(2);
    }

    @Test
    void aResultThatBreaksAConstraintFailsWithoutARetry() throws Exception {
        // review A-25: two questions with one id break run_questions' primary key on every attempt
        var done = mapper.readTree("{\"status\":\"succeeded\",\"output\":{}}");
        when(worker.run(any(), any(), any())).thenReturn(done);
        var duplicate = new IllegalStateException("Could not index worker output.",
                new java.sql.SQLException("duplicate key value violates unique constraint \"run_questions_pkey\"", "23505"));
        var calls = new AtomicInteger();
        org.mockito.Mockito.doAnswer(call -> {
            if (calls.incrementAndGet() == 1) throw duplicate;
            return null;
        }).when(jobs).finish(any(), any(), any());
        dispatcher.execute(attempt);
        var result = ArgumentCaptor.forClass(JsonNode.class);
        verify(jobs, times(2)).finish(eq(attempt), any(), result.capture());
        var error = result.getAllValues().get(1).path("error");
        assertThat(error.path("code").asText()).isEqualTo("result_invalid");
        assertThat(error.path("retryable").asBoolean()).isFalse();
        assertThat(JobDispatcher.invalidResult(new IllegalStateException("network"))).isFalse();
    }

    @Test
    void aResultTheDatabaseRefusesForAMomentIsRecordedOnceItIsBack() throws Exception {
        var done = mapper.readTree("{\"status\":\"succeeded\",\"output\":{}}");
        when(worker.run(any(), any(), any())).thenReturn(done);
        var calls = new AtomicInteger();
        org.mockito.Mockito.doAnswer(call -> {
            if (calls.incrementAndGet() == 1) throw new TransientDataAccessResourceException("the database is restarting");
            return null;
        }).when(jobs).finish(any(), any(), any());
        dispatcher.execute(attempt);
        verify(jobs, times(2)).finish(eq(attempt), any(), eq(done));
    }
}
