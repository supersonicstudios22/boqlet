package com.boqlet.api.boq;

import com.boqlet.api.identity.Login;
import com.boqlet.api.http.Idempotency;
import com.boqlet.contract.api.PublicApi;
import com.boqlet.contract.api.SharingApi;
import com.boqlet.contract.model.*;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ShareController implements SharingApi, PublicApi {
    private final ShareLinks links;
    private final PublicShares shares;
    private final Idempotency idempotency;
    private final HttpServletRequest request;
    private static final int TOKENS_PER_ADDRESS = 50;
    private final int requestsPerMinute;
    /** Requests this minute per address and token (F18 "per token and IP", TF-087). */
    private final Map<String, Integer> requests = new HashMap<>();
    /** Different tokens an address asked for this minute: bounds the keys one address can add. */
    private final Map<String, Integer> tokens = new HashMap<>();
    private long minute;

    ShareController(ShareLinks links, PublicShares shares, HttpServletRequest request, Idempotency idempotency,
                    @Value("${BOQLET_PUBLIC_SHARE_REQUESTS_PER_MINUTE:300}") int requestsPerMinute) {
        this.links = links;
        this.shares = shares;
        this.request = request;
        this.idempotency = idempotency;
        this.requestsPerMinute = Math.max(1, requestsPerMinute);
    }

    @Override
    public ResponseEntity<ShareLinkCreated> createShareLink(UUID boq, ShareLinkCreate body, UUID idempotencyKey) {
        UUID actor = actor();
        UUID key = idempotencyKey;
        ShareLinkCreated created;
        if (key == null) {
            created = links.create(boq, actor, body, null);
        } else {
            created = idempotency.once(actor, key, 201, ShareLinkCreated.class, () -> links.authorizeCreation(boq, actor),
                    () -> links.create(boq, actor, body, key).url(null));
            created.url(links.replayUrl(created.getId(), key));
        }
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(created);
    }

    @Override
    public ResponseEntity<List<ShareLink>> listOrgShareLinks(UUID org) {
        return ResponseEntity.ok(links.listOrg(org, actor()));
    }

    @Override
    public ResponseEntity<List<ShareLink>> listShareLinks(UUID boq) {
        return ResponseEntity.ok(links.list(boq, actor()));
    }

    @Override
    public ResponseEntity<Void> revokeShareLink(UUID id) {
        links.revoke(id, actor());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ShareLink> updateShareLink(UUID id, UpdateShareLinkRequest body) {
        return ResponseEntity.ok(links.update(id, actor(), body));
    }

    @Override
    public ResponseEntity<PublicShare> getPublicShare(String token) {
        countRequest(token);
        return publicResponse(shares.get(token));
    }

    @Override
    public ResponseEntity<LinesPage> listPublicShareLines(String token, String cursor, String query) {
        countRequest(token);
        return publicResponse(shares.lines(token, cursor, query));
    }

    @Override
    public ResponseEntity<LineDetail> getPublicShareLine(String key, String token) {
        countRequest(token);
        return publicResponse(shares.detail(token, key));
    }

    @Override
    public ResponseEntity<SceneIndex> getPublicShareScene(String token, UUID version) {
        countRequest(token);
        return publicResponse(shares.scene(token, version));
    }

    @Override
    public ResponseEntity<Void> getPublicShareGeometry(String token, UUID version) {
        countRequest(token);
        return redirect(shares.geometry(token, version));
    }

    @Override
    public ResponseEntity<Void> getPublicShareExport(String token) {
        countRequest(token);
        return redirect(shares.workbook(token));
    }

    private synchronized void countRequest(String token) {
        long now = Instant.now().getEpochSecond();
        if (minute != now / 60) {
            minute = now / 60;
            requests.clear();
            tokens.clear();
        }
        String address = request.getRemoteAddr();
        String key = address + " " + token;
        if (!requests.containsKey(key) && (requests.size() >= 20_000
                || tokens.merge(address, 1, Integer::sum) > TOKENS_PER_ADDRESS)) {
            throw com.boqlet.api.http.RateLimits.tooMany(60 - now % 60);
        }
        if (requests.merge(key, 1, Integer::sum) > requestsPerMinute) {
            throw com.boqlet.api.http.RateLimits.tooMany(60 - now % 60);
        }
    }

    private static <T> ResponseEntity<T> publicResponse(T body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("Referrer-Policy", "no-referrer").body(body);
    }

    private static ResponseEntity<Void> redirect(URI location) {
        return ResponseEntity.status(HttpStatus.FOUND).location(location).cacheControl(CacheControl.noStore())
                .header("Referrer-Policy", "no-referrer").build();
    }

    private static UUID actor() { return Login.current().userId(); }
}
