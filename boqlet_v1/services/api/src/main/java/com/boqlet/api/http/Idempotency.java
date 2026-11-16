package com.boqlet.api.http;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class Idempotency {
    public record Result(int status, JsonNode body) {}

    private final JdbcTemplate database;
    private final ObjectMapper json;

    public Idempotency(JdbcTemplate database, ObjectMapper json) {
        this.database = database;
        this.json = json;
    }

    @Transactional
    public Result execute(UUID userId, String endpoint, UUID key, Supplier<Result> action) {
        if (key == null) {
            return action.get();
        }
        String storedKey = key.toString();
        database.update("""
                DELETE FROM idempotency_keys
                WHERE user_id = ? AND endpoint = ? AND key = ? AND created_at <= now() - interval '24 hours'
                """, userId, endpoint, storedKey);

        int claimed = database.update("""
                INSERT INTO idempotency_keys (user_id, endpoint, key) VALUES (?, ?, ?)
                ON CONFLICT DO NOTHING
                """, userId, endpoint, storedKey);
        if (claimed == 0) {
            return database.queryForObject("""
                    SELECT response_status, response::text FROM idempotency_keys
                    WHERE user_id = ? AND endpoint = ? AND key = ?
                    """, (row, index) -> new Result(row.getInt(1), readResponse(row.getString(2))),
                    userId, endpoint, storedKey);
        }

        Result response = action.get();
        database.update("""
                UPDATE idempotency_keys SET response_status = ?, response = CAST(? AS jsonb)
                WHERE user_id = ? AND endpoint = ? AND key = ?
                """, response.status(), response.body() == null ? null : response.body().toString(),
                userId, endpoint, storedKey);
        return response;
    }

    private JsonNode readResponse(String encoded) {
        if (encoded == null) {
            return null;
        }
        try {
            return json.readTree(encoded);
        } catch (JsonProcessingException cause) {
            throw new IllegalStateException("Stored response is not valid JSON.", cause);
        }
    }
}
