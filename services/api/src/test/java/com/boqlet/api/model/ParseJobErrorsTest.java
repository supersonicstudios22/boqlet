package com.boqlet.api.model;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** TF-037: a failed model version answers a code of state-machines.md's list, never a job's own code. */
class ParseJobErrorsTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void jobCodesBecomeVersionCodesAndKeepTheirCause() throws Exception {
        var timeout = ParseJob.versionError(json.readTree("{\"code\":\"engine_timeout\",\"message\":\"The worker exceeded the job timeout.\",\"retryable\":false}"));
        assertThat(timeout.path("code").asText()).isEqualTo("parse_timeout");
        assertThat(timeout.path("cause").asText()).isEqualTo("engine_timeout");
        assertThat(timeout.path("retryable").asBoolean()).isFalse();
        for (String code : new String[] {"worker_lost", "ingestion_failed", "engine_unavailable", "engine_process_failed", "engine_error", "invalid_input", ""}) {
            var mapped = ParseJob.versionError(json.readTree("{\"code\":\"" + code + "\",\"message\":\"m\"}"));
            assertThat(mapped.path("code").asText()).as(code).isEqualTo("parse_error");
            assertThat(mapped.path("cause").asText()).isEqualTo(code);
        }
        for (String code : ParseJob.VERSION_ERRORS) {
            var kept = ParseJob.versionError(json.readTree("{\"code\":\"" + code + "\",\"message\":\"m\"}"));
            assertThat(kept.path("code").asText()).isEqualTo(code);
            assertThat(kept.has("cause")).isFalse();
        }
        assertThat(ParseJob.versionError(null).path("code").asText()).isEqualTo("parse_error");
        assertThat(ParseJob.versionError(null).path("message").asText()).isNotBlank();
    }
}
