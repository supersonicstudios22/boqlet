package com.boqlet.api.identity;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * The token of an emailed sign-up or reset link (P57): derived from the link's nonce with the
 * server's signing secret (`BOQLET_INVITATION_SECRET`), so neither the database nor the email
 * outbox holds a usable token. `native_setup_links` keeps only its hash, as for operator links.
 */
@Component
public class LinkTokens {
    private final byte[] secret;

    LinkTokens(@Value("${boqlet.auth.invitation-secret:}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    /** 43 URL-safe characters, the shape `set-password` accepts. */
    public String token(UUID nonce) {
        if (secret.length < 32) throw IdentityService.failure(HttpStatus.SERVICE_UNAVAILABLE, "link_unavailable",
                "Emailed links are not configured on this server.");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] bytes = mac.doFinal(("account-link:" + nonce).getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException(failure);
        }
    }
}
