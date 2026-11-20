package com.boqlet.api.worker;

import com.boqlet.api.http.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.function.Consumer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class WorkerClient {
    private final String base;
    private final ObjectMapper json;
    private final HttpClient client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10)).build();

    WorkerClient(ObjectMapper json, @Value("${boqlet.worker.url}") String url) {
        this.json = json;
        this.base = url.replaceAll("/+$", "");
    }

    public JsonNode run(String type, Map<String, Object> envelope, Consumer<JsonNode> progress) throws IOException, InterruptedException {
        HttpResponse<java.io.InputStream> response = client.send(request("/jobs/" + type, envelope, Duration.ofSeconds(45)),
                HttpResponse.BodyHandlers.ofInputStream());
        try (var reader = new BufferedReader(new InputStreamReader(response.body(), StandardCharsets.UTF_8))) {
            if (response.statusCode() != 200) throw new IOException("Worker HTTP " + response.statusCode());
            for (String line; (line = reader.readLine()) != null;) {
                JsonNode event = json.readTree(line);
                if (!envelope.get("jobId").toString().equals(event.path("jobId").asText())) {
                    throw new IOException("The worker returned an unexpected job ID.");
                }
                if (event.has("status")) return event;
                progress.accept(event);
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            }
        }
        throw new IOException("The worker closed without a result.");
    }

    public <T> T rpc(String op, Map<String, ?> input, Class<T> type) {
        try {
            HttpResponse<String> response = client.send(request("/rpc/" + op, input, Duration.ofSeconds(15)),
                    HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) return json.readValue(response.body(), type);
            if (response.statusCode() == 422) {
                // The engine's reason (FastAPI's `detail`), e.g. which file types it reads.
                String reason = null;
                try {
                    var detail = json.readTree(response.body()).path("detail");
                    if (detail.isTextual() && !detail.asText().isBlank()) reason = detail.asText();
                } catch (IOException unreadable) {
                    // keep the general message
                }
                throw new ApiException(HttpStatus.BAD_REQUEST, "engine_input",
                        reason == null ? "The engine rejected the input." : reason, Map.of());
            }
        } catch (IOException failure) {
            throw unavailable();
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw unavailable();
        }
        throw unavailable();
    }

    private HttpRequest request(String path, Object payload, Duration timeout) throws IOException {
        return HttpRequest.newBuilder(URI.create(base + path)).timeout(timeout).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(payload))).build();
    }

    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "engine_unavailable", "The engine is unavailable.", Map.of());
    }
}
