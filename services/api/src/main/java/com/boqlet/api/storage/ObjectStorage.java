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
        if (size <= MULTIPART_THRESHOLD) return new Upload(null, instructions(key, size, null));
        String multipart = client.createMultipartUpload(request -> request.bucket(bucket).key(key)).uploadId();
        try {
            return new Upload(multipart, instructions(key, size, multipart));
        } catch (RuntimeException failure) {
            abort(key, multipart);
            throw failure;
        }
    }

    /**
     * Fresh signed URLs for an upload still under way (A-40): the same object, and for a multipart upload the
     * same upload id, so parts already sent keep their ETags.
     */
    public UploadInstructions renew(String key, long size, String multipart) {
        configured();
        if ((multipart == null) != (size <= MULTIPART_THRESHOLD)) {
            throw new IllegalStateException("The upload's multipart state does not match its size.");
        }
        return instructions(key, size, multipart);
    }

    private UploadInstructions instructions(String key, long size, String multipart) {
        var expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(UPLOAD_TTL);
        if (multipart == null) {
            String url = presigner.presignPutObject(request -> request.signatureDuration(UPLOAD_TTL)
                    .putObjectRequest(object -> object.bucket(bucket).key(key).contentLength(size))).url().toString();
            return new UploadInstructions(UploadInstructions.MethodEnum.PUT, url).expiresAt(expiresAt);
        }
        var urls = new ArrayList<UploadInstructionsPartsInner>();
        int number = 1;
        for (long remaining = size; remaining > 0; remaining -= PART_SIZE) {
            final int part = number++;
            long bytes = Math.min(remaining, PART_SIZE);
            String url = presigner.presignUploadPart(request -> request.signatureDuration(UPLOAD_TTL)
                    .uploadPartRequest(object -> object.bucket(bucket).key(key).uploadId(multipart)
                            .partNumber(part).contentLength(bytes))).url().toString();
            urls.add(new UploadInstructionsPartsInner(part, url));
        }
        return new UploadInstructions(UploadInstructions.MethodEnum.PUT, urls.getFirst().getUrl())
                .expiresAt(expiresAt).partSizeBytes(PART_SIZE).parts(urls);
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

    /** The object's SHA-256 (lowercase hex), streamed: the same digest the engine records for a model's file. */
    public String sha256(String key) {
        try (InputStream data = open(key)) {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[1 << 20];
            for (int read; (read = data.read(buffer)) > 0;) digest.update(buffer, 0, read);
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (java.io.IOException | java.security.NoSuchAlgorithmException failure) {
            throw new IllegalStateException("The stored file could not be read.", failure);
        }
    }

    public boolean exists(String key) {
        configured();
        return head(key) != null;
    }

    public void put(String key, String contentType, byte[] data) {
        configured();
        client.putObject(request -> request.bucket(bucket).key(key).contentType(contentType), RequestBody.fromBytes(data));
    }

    public void delete(String key) {
        configured();
        client.deleteObject(request -> request.bucket(bucket).key(key));
    }

    public void deletePrefix(String prefix) {
        configured();
        if (!prefix.startsWith("orgs/") || !prefix.endsWith("/") || prefix.length() <= "orgs/".length()) {
            throw new IllegalArgumentException("Expected an organisation artifact prefix.");
        }
        for (var page : client.listMultipartUploadsPaginator(request -> request.bucket(bucket).prefix(prefix))) {
            for (var upload : page.uploads()) abort(upload.key(), upload.uploadId());
        }
        BucketVersioningStatus versioning;
        try {
            versioning = client.getBucketVersioning(request -> request.bucket(bucket)).status();
        } catch (S3Exception failure) {
            if (failure.statusCode() != 501) throw failure;
            versioning = null;
        }
        if (versioning == BucketVersioningStatus.ENABLED || versioning == BucketVersioningStatus.SUSPENDED) {
            for (var page : client.listObjectVersionsPaginator(request -> request.bucket(bucket).prefix(prefix))) {
                var batch = new ArrayList<ObjectIdentifier>();
                page.versions().forEach(version -> batch.add(ObjectIdentifier.builder().key(version.key()).versionId(version.versionId()).build()));
                page.deleteMarkers().forEach(marker -> batch.add(ObjectIdentifier.builder().key(marker.key()).versionId(marker.versionId()).build()));
                deleteBatch(batch);
            }
        } else {
            for (var page : client.listObjectsV2Paginator(request -> request.bucket(bucket).prefix(prefix))) {
                deleteBatch(page.contents().stream().map(object -> ObjectIdentifier.builder().key(object.key()).build()).toList());
            }
        }
    }

    /** Deletes the objects under `prefix` last written before `before`, e.g. the throwaway preset templates. */
    public int deleteOlderThan(String prefix, java.time.Instant before) {
        configured();
        if (!prefix.endsWith("/") || !(prefix.startsWith("orgs/") || prefix.startsWith("system/"))) {
            throw new IllegalArgumentException("Expected an artifact prefix.");
        }
        int deleted = 0;
        for (var page : client.listObjectsV2Paginator(request -> request.bucket(bucket).prefix(prefix))) {
            var old = page.contents().stream().filter(object -> object.lastModified().isBefore(before))
                    .map(object -> ObjectIdentifier.builder().key(object.key()).build()).toList();
            deleteBatch(old);
            deleted += old.size();
        }
        return deleted;
    }

    private void deleteBatch(List<ObjectIdentifier> objects) {
        if (objects.isEmpty()) return;
        var result = client.deleteObjects(request -> request.bucket(bucket).delete(delete -> delete.objects(objects).quiet(true)));
        if (result.hasErrors() && !result.errors().isEmpty()) throw new IllegalStateException("Could not remove every storage object.");
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
