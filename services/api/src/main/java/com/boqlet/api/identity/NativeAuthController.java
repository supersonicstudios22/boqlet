package com.boqlet.api.identity;

import com.boqlet.contract.model.Session;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@ConditionalOnProperty(name = "BOQLET_NATIVE_AUTH", havingValue = "true")
class NativeAuthController {
    private final NativeCredentials credentials;
    private final boolean secure;

    NativeAuthController(NativeCredentials credentials, @Value("${boqlet.auth.secure-cookie:true}") boolean secure) {
        this.credentials = credentials;
        this.secure = secure;
    }

    @PostMapping("/sign-in")
    ResponseEntity<Session> signIn(@RequestBody SignIn body, HttpServletRequest request) {
        credentials.limit("source:" + NativeCredentials.hash(request.getRemoteAddr()), 45);
        String email = body.email() == null ? "" : IdentityService.normalizeEmail(body.email());
        if (email.length() > 254 || email.isBlank()) {
            throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_body", "Enter an email and password.");
        }
        credentials.limit("email:" + NativeCredentials.hash(email), 12);
        String secret = NativeCredentials.token();
        Session session;
        try {
            session = credentials.signIn(email, body.password(), secret, body.deviceLabel(), body.takeover());
        } catch (com.boqlet.api.http.ApiException refused) {
            if ("unauthenticated".equals(refused.body().code())) credentials.signInFailed(email);
            throw refused;
        }
        return ResponseEntity.status(HttpStatus.CREATED).header(HttpHeaders.SET_COOKIE,
                ResponseCookie.from(SessionController.COOKIE, secret).secure(secure).httpOnly(true)
                        .sameSite("Lax").path("/api/v1").build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store").body(session);
    }

    @PostMapping("/set-password")
    ResponseEntity<Void> setPassword(@RequestBody Setup body, HttpServletRequest request) {
        credentials.limit("source:" + NativeCredentials.hash(request.getRemoteAddr()), 45);
        credentials.setPassword(body.token(), body.password(), body.name());
        return ResponseEntity.noContent().header(HttpHeaders.CACHE_CONTROL, "no-store").build();
    }

    @ExceptionHandler(SessionConflict.class)
    ResponseEntity<Map<String, Object>> conflict(SessionConflict failure) {
        return ResponseEntity.status(HttpStatus.CONFLICT).header(HttpHeaders.CACHE_CONTROL, "no-store").body(
                Map.of("code", "session_active", "message", failure.getMessage(), "activeSession", failure.active));
    }

    record SignIn(String email, String password, String deviceLabel, boolean takeover) {}
    record Setup(String token, String password, String name) {}
}
