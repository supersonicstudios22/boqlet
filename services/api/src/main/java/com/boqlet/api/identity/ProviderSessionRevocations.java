package com.boqlet.api.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** <b>Rollback only</b> (review B-16): ends Keycloak sessions for the legacy OIDC path ({@code OidcConfiguration}). */
@Component
class ProviderSessionRevocations {
    private static final Logger LOG = LoggerFactory.getLogger(ProviderSessionRevocations.class);
    private final JdbcTemplate database;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final String issuer;
    private final String clientId;
    private final String clientSecret;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private String token;
    private Instant validUntil = Instant.EPOCH;

    ProviderSessionRevocations(JdbcTemplate database, TransactionTemplate transactions, ObjectMapper json,
                               @Value("${boqlet.auth.issuer}") String issuer,
                               @Value("${BOQLET_OIDC_REVOCATION_CLIENT_ID:}") String clientId,
                               @Value("${BOQLET_OIDC_REVOCATION_CLIENT_SECRET:}") String clientSecret) {
        this.database = database;
        this.transactions = transactions;
        this.json = json;
        this.issuer = issuer.replaceAll("/+$", "");
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    @Scheduled(fixedDelayString = "${BOQLET_OIDC_REVOCATION_POLL_MS:3000}")
    void poll() {
        if (issuer.isBlank() || clientId.isBlank() || clientSecret.isBlank()) return;
        for (int count = 0; count < 10; count++) {
            if (!Boolean.TRUE.equals(transactions.execute(status -> deliver()))) break;
        }
    }

    private boolean deliver() {
        var jobs = database.query("""
                SELECT provider_session, attempts FROM provider_session_revocations
                WHERE next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED
                """, (row, index) -> new Pending(row.getString("provider_session"), row.getInt("attempts")));
        if (jobs.isEmpty()) return false;
        var job = jobs.getFirst();
        try {
            if (!job.session().matches("[A-Za-z0-9_-]{1,200}")) throw new IOException("Unsupported provider session identifier.");
            int separator = issuer.lastIndexOf("/realms/");
            if (separator < 0) throw new IOException("The issuer is missing its Keycloak realm path.");
            var endpoint = URI.create(issuer.substring(0, separator) + "/admin" + issuer.substring(separator)
                    + "/sessions/" + job.session());
            var response = http.send(HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(5))
                    .header("Authorization", "Bearer " + token()).DELETE().build(), HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() == 401) validUntil = Instant.EPOCH;
            if (response.statusCode() != 204 && response.statusCode() != 404) {
                throw new IOException("Keycloak session removal returned " + response.statusCode());
            }
            database.update("DELETE FROM provider_session_revocations WHERE provider_session = ?", job.session());
        } catch (IOException | InterruptedException failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            int attempts = job.attempts() + 1;
            long delay = Math.min(3600, 15L << Math.min(8, attempts - 1));
            database.update("""
                    UPDATE provider_session_revocations SET attempts = ?, next_attempt_at = now() + (? * interval '1 second')
                    WHERE provider_session = ?
                    """, attempts, delay, job.session());
            LOG.warn("Keycloak session revocation attempt {} failed ({})", attempts, failure.getClass().getSimpleName());
        }
        return !Thread.currentThread().isInterrupted();
    }

    private String token() throws IOException, InterruptedException {
        if (validUntil.isAfter(Instant.now())) return token;
        var request = HttpRequest.newBuilder(URI.create(issuer + "/protocol/openid-connect/token")).timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials&client_id="
                        + encode(clientId) + "&client_secret=" + encode(clientSecret))).build();
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IOException("Could not obtain a Keycloak service token.");
        var payload = json.readTree(response.body());
        token = payload.path("access_token").asText();
        if (token.isBlank()) throw new IOException("Keycloak returned an empty service token.");
        validUntil = Instant.now().plusSeconds(Math.max(0, payload.path("expires_in").asLong(30) - 15));
        return token;
    }

    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    private record Pending(String session, int attempts) {}
}
