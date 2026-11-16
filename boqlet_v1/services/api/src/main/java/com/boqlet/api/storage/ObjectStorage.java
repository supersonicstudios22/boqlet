package com.boqlet.api.storage;

import com.boqlet.api.http.ApiException;
import com.boqlet.contract.model.CompleteModelUploadRequestPartsInner;
import com.boqlet.contract.model.UploadInstructions;
import com.boqlet.contract.model.UploadInstructionsPartsInner;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@Service
public class ObjectStorage {
    private static final Duration UPLOAD_TTL = Duration.ofHours(1);
    private static final Duration DOWNLOAD_TTL = Duration.ofMinutes(5);
    private static final long MULTIPART_THRESHOLD = 100L << 20;
    private static final int PART_SIZE = 16 << 20;

    private final String bucket;
    private final S3Client client;
    private final S3Presigner presigner;

    public ObjectStorage(@Value("${boqlet.storage.bucket:}") String bucket,
                         @Value("${boqlet.storage.region}") String region,
                         @Value("${boqlet.storage.endpoint:}") String endpoint,
                         @Value("${boqlet.storage.public-endpoint:}") String publicEndpoint) {
        this.bucket = bucket;
        if (bucket.isBlank()) {
            client = null;
            presigner = null;
            return;
        }
        var clientBuilder = S3Client.builder().region(Region.of(region));
        var signerBuilder = S3Presigner.builder().region(Region.of(region));
        if (!endpoint.isBlank()) clientBuilder.endpointOverride(URI.create(endpoint)).forcePathStyle(true);
        String signingEndpoint = publicEndpoint.isBlank() ? endpoint : publicEndpoint;
        if (!signingEndpoint.isBlank()) signerBuilder.endpointOverride(URI.create(signingEndpoint))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build());
        client = clientBuilder.build();
        presigner = signerBuilder.build();
    }

    public record Upload(String multipartId, UploadInstructions instructions) {}

    public Upload upload(String key, long size) {
        configured();
        var expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(UPLOAD_TTL);
        if (size <= MULTIPART_THRESHOLD) {
            String url = presigner.presignPutObject(request -> request.signatureDuration(UPLOAD_TTL)
                    .putObjectRequest(object -> object.bucket(bucket).key(key).contentLength(size))).url().toString();
            return new Upload(null, new UploadInstructions(UploadInstructions.MethodEnum.PUT, url).expiresAt(expiresAt));
        }
        String multipart = client.createMultipartUpload(request -> request.bucket(bucket).key(key)).uploadId();
        var urls = new ArrayList<UploadInstructionsPartsInner>();
        try {
            int number = 1;
            for (long remaining = size; remaining > 0; remaining -= PART_SIZE) {
                final int part = number++;
                long bytes = Math.min(remaining, PART_SIZE);
                String url = presigner.presignUploadPart(request -> request.signatureDuration(UPLOAD_TTL)
                        .uploadPartRequest(object -> object.bucket(bucket).key(key).uploadId(multipart)
                                .partNumber(part).contentLength(bytes))).url().toString();
                urls.add(new UploadInstructionsPartsInner(part, url));
            }
        } catch (RuntimeException failure) {
            abort(key, multipart);
            throw failure;
        }
        return new Upload(multipart, new UploadInstructions(UploadInstructions.MethodEnum.PUT, urls.getFirst().getUrl())
                .expiresAt(expiresAt).partSizeBytes(PART_SIZE).parts(urls));
    }

    public void seal(String incoming, String source, String multipart, List<CompleteModelUploadRequestPartsInner> parts,
                     long expectedSize, boolean zip) {
        configured();
        if (multipart != null && head(incoming) == null) {
            var completed = completedParts(expectedSize, parts);
            try {
                client.completeMultipartUpload(request -> request.bucket(bucket).key(incoming).uploadId(multipart)
                        .multipartUpload(upload -> upload.parts(completed)));
            } catch (S3Exception failure) {
                if (failure.statusCode() == 404 && head(incoming) == null) throw missing();
                if (failure.statusCode() == 400) throw bad("upload_parts_invalid", "The uploaded parts do not match.");
                if (failure.statusCode() != 404) throw failure;
            }
        }
        HeadObjectResponse object = head(incoming);
        if (object == null) throw missing();
        if (object.contentLength() != expectedSize) throw bad("upload_size_mismatch", "The uploaded file size differs.");
        try (var stream = client.getObject(request -> request.bucket(bucket).key(incoming).ifMatch(object.eTag())
                .range("bytes=0-4095"))) {
            byte[] start = stream.readNBytes(4096);
            if (!hasHeader(start, zip)) throw bad("not_ifc", "The file is missing its IFC or IFCZIP header.");
        } catch (IOException failure) {
            throw new IllegalStateException("Cannot read upload header.", failure);
        } catch (S3Exception failure) {
            if (failure.statusCode() == 404 || failure.statusCode() == 412) throw missing();
            throw failure;
        }
        try {
            client.copyObject(request -> request.sourceBucket(bucket).sourceKey(incoming).copySourceIfMatch(object.eTag())
                    .destinationBucket(bucket).destinationKey(source));
        } catch (S3Exception failure) {
            if (failure.statusCode() == 404 || failure.statusCode() == 412) throw missing();
            throw failure;
        }
    }

    public URI download(String key, String cacheControl, String contentType) {
        configured();
        return URI.create(presigner.presignGetObject(request -> request.signatureDuration(DOWNLOAD_TTL)
                .getObjectRequest(object -> object.bucket(bucket).key(key)
                        .responseCacheControl(cacheControl).responseContentType(contentType))).url().toString());
    }

    public URI downloadAttachment(String key, String contentType, String fileName) {
        configured();
        String encoded = java.net.URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
        return URI.create(presigner.presignGetObject(request -> request.signatureDuration(DOWNLOAD_TTL)
                .getObjectRequest(object -> object.bucket(bucket).key(key).responseCacheControl("private, no-store")
                        .responseContentDisposition("attachment; filename*=UTF-8''" + encoded)
                        .responseContentType(contentType))).url().toString());
    }

    public InputStream open(String key) {
        configured();
        return client.getObject(request -> request.bucket(bucket).key(key));
    }

    public void put(String key, String contentType, byte[] data) {
        configured();
        client.putObject(request -> request.bucket(bucket).key(key).contentType(contentType), RequestBody.fromBytes(data));
    }

    public void delete(String key) {
        configured();
        client.deleteObject(request -> request.bucket(bucket).key(key));
    }

    public void abort(String key, String upload) {
        if (upload == null) return;
        configured();
        try {
            client.abortMultipartUpload(request -> request.bucket(bucket).key(key).uploadId(upload));
        } catch (S3Exception error) {
            if (error.statusCode() != 404) throw error;
        }
    }

    public static String orgPrefix(UUID org) {
        return "orgs/" + org + "/";
    }

    private HeadObjectResponse head(String key) {
        try {
            return client.headObject(request -> request.bucket(bucket).key(key));
        } catch (S3Exception failure) {
            if (failure.statusCode() == 404) return null;
            throw failure;
        }
    }

    private static List<CompletedPart> completedParts(long expectedSize, List<CompleteModelUploadRequestPartsInner> parts) {
        int expected = Math.toIntExact((expectedSize + PART_SIZE - 1) / PART_SIZE);
        if (parts == null || parts.size() != expected) throw bad("upload_parts_invalid", "Supply all uploaded parts.");
        var sorted = parts.stream().sorted(Comparator.comparingInt(CompleteModelUploadRequestPartsInner::getPartNumber)).toList();
        var completed = new ArrayList<CompletedPart>(expected);
        for (int index = 0; index < expected; index++) {
            var part = sorted.get(index);
            if (part.getPartNumber() != index + 1 || part.getEtag().isBlank()) {
                throw bad("upload_parts_invalid", "Part numbers and ETags must match the uploaded parts.");
            }
            completed.add(CompletedPart.builder().partNumber(index + 1).eTag(part.getEtag()).build());
        }
        return completed;
    }

    private static boolean hasHeader(byte[] start, boolean zip) {
        if (zip) return start.length >= 4 && start[0] == 'P' && start[1] == 'K' && start[2] == 3 && start[3] == 4;
        return new String(start, StandardCharsets.UTF_8).replaceFirst("^\uFEFF", "").stripLeading().startsWith("ISO-10303-21;");
    }

    private void configured() {
        if (client == null) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "storage_unavailable", "Object storage is not configured.", Map.of());
        }
    }

    private static ApiException missing() {
        return bad("upload_missing", "The uploaded file is missing or changed.");
    }

    private static ApiException bad(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message, Map.of());
    }

    @PreDestroy
    void close() {
        if (presigner != null) presigner.close();
        if (client != null) client.close();
    }
}
