package com.boqlet.api.maintenance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.boqlet.api.storage.ObjectStorage;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/** BE-025: the alerts of deployment.md, judged from their readings and logged on a change of state. */
class AlertMonitorTest {
    private final JdbcTemplate database = mock(JdbcTemplate.class);
    private final ObjectStorage storage = mock(ObjectStorage.class);
    private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
    private final AlertMonitor monitor = new AlertMonitor(database, meters, storage, "bucket");

    private double gauge(String alert) {
        return meters.get("boqlet.alerts.firing").tag("alert", alert).gauge().value();
    }

    @Test
    void anAlertFiresAboveItsThresholdAndResolvesBelowIt() {
        assertThat(monitor.judge(AlertMonitor.QUEUE_WAIT, new AlertMonitor.Reading(301, 300, true))).isTrue();
        assertThat(gauge(AlertMonitor.QUEUE_WAIT)).isEqualTo(1);
        // Unknown readings (too little data) keep the state.
        assertThat(monitor.judge(AlertMonitor.QUEUE_WAIT, AlertMonitor.Reading.unknown(300))).isTrue();
        assertThat(monitor.judge(AlertMonitor.QUEUE_WAIT, new AlertMonitor.Reading(10, 300, true))).isFalse();
        assertThat(gauge(AlertMonitor.QUEUE_WAIT)).isZero();
    }

    @Test
    void jobFailuresNeedTwentyFinishedJobs() {
        when(database.queryForMap(anyString())).thenReturn(Map.of("total", 10L, "failed", 9L));
        assertThat(monitor.jobFailures().known()).isFalse();
        when(database.queryForMap(anyString())).thenReturn(Map.of("total", 40L, "failed", 3L));
        var reading = monitor.jobFailures();
        assertThat(reading.value()).isEqualTo(0.075);
        assertThat(reading.over()).isTrue();
    }

    @Test
    void apiErrorsAreTheShareOf5xxInTheWindow() {
        assertThat(monitor.apiErrors().known()).isFalse();                       // no traffic yet
        meters.timer("http.server.requests", "outcome", "SUCCESS", "uri", "/api/v1/me").record(Duration.ofMillis(5));
        for (int i = 0; i < 196; i++) meters.timer("http.server.requests", "outcome", "SUCCESS", "uri", "/api/v1/me").record(Duration.ofMillis(5));
        for (int i = 0; i < 3; i++) meters.timer("http.server.requests", "outcome", "SERVER_ERROR", "uri", "/api/v1/me").record(Duration.ofMillis(5));
        var reading = monitor.apiErrors();
        assertThat(reading.known()).isTrue();
        assertThat(reading.value()).isEqualTo(0.015);
        assertThat(reading.over()).isTrue();
    }

    @Test
    void aStorageFailureFiresTheStorageAlert() {
        when(storage.exists(anyString())).thenThrow(new IllegalStateException("unreachable"));
        assertThat(monitor.judge(AlertMonitor.STORAGE, monitor.storageProbe())).isTrue();
        org.mockito.Mockito.doReturn(false).when(storage).exists(anyString());
        assertThat(monitor.judge(AlertMonitor.STORAGE, monitor.storageProbe())).isFalse();
    }
}
