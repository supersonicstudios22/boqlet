package com.boqlet.api.identity;

import com.boqlet.api.billing.PlatformConfig;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@ConditionalOnProperty(name = "BOQLET_NATIVE_AUTH", havingValue = "true")
class NativeAuthController {
    /** A form sent sooner than this after it opened is taken for a bot's (P57, basic bot protection). */
    static final long MIN_FILL_MILLIS = 3000;
    private static final java.util.regex.Pattern EMAIL = java.util.regex.Pattern.compile("[^@\\s]+@[^@\\s]+\\.[^@\\s]+");
    private final NativeCredentials credentials;
    private final PlatformConfig platform;
    private final boolean secure;

    NativeAuthController(NativeCredentials credentials, PlatformConfig platform, @Value("${boqlet.auth.secure-cookie:true}") boolean secure) {
        this.credentials = credentials;
        this.platform = platform;
        this.secure = secure;
    }

    @GetMapping("/sign-up")
    ResponseEntity<Map<String, Boolean>> signUpStatus() {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(Map.of("open", platform.publicSignUp()));
    }

    /**
     * Public sign-up (P57). 202 whether or not anything is sent, so the answer doesn't tell which
     * addresses have accounts; a filled honeypot (website) or a form sent too soon sends nothing.
     */
    @PostMapping("/sign-up")
    ResponseEntity<Void> signUp(@RequestBody SignUp body, HttpServletRequest request) {
        if (!platform.publicSignUp()) {
            throw IdentityService.failure(HttpStatus.FORBIDDEN, "sign_up_closed", "Accounts are made by invitation for now.");
        }
        String email = linkRequest("sign-up", body.email(), request);
        if (body.elapsedMs() == null || body.elapsedMs() < 0 || (body.locale() != null && body.locale().length() > 64)
                || (body.website() != null && body.website().length() > 200)) {
            throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_body", "Enter your email.");
        }
        boolean bot = (body.website() != null && !body.website().isEmpty()) || body.elapsedMs() < MIN_FILL_MILLIS;
        if (!bot) credentials.requestSignUp(email, body.locale());
        return ResponseEntity.accepted().header(HttpHeaders.CACHE_CONTROL, "no-store").build();
    }

    /** Self-service password reset (P57): 202 whether or not the address has an account. */
    @PostMapping("/password-reset")
    ResponseEntity<Void> passwordReset(@RequestBody Reset body, HttpServletRequest request) {
        credentials.requestReset(linkRequest("reset", body.email(), request));
        return ResponseEntity.accepted().header(HttpHeaders.CACHE_CONTROL, "no-store").build();
    }

    /** The checked, normalised address of a sign-up or reset request, counted per source and per email. */
    private String linkRequest(String kind, String raw, HttpServletRequest request) {
        String source = kind + "-source:" + NativeCredentials.hash(request.getRemoteAddr());
        credentials.requireUnder(source, NativeCredentials.LINK_REQUESTS_PER_SOURCE);
        String email = raw == null ? "" : IdentityService.normalizeEmail(raw);
        if (email.length() > 254 || !EMAIL.matcher(email).matches()) {
            throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_body", "Enter a valid email.");
        }
        String account = kind + "-email:" + NativeCredentials.hash(email);
        credentials.requireUnder(account, NativeCredentials.LINK_REQUESTS_PER_EMAIL);
        credentials.count(source);
        credentials.count(account);
        return email;
    }

    @PostMapping("/sign-in")
    ResponseEntity<Session> signIn(@RequestBody SignIn body, HttpServletRequest request) {
        String address = NativeCredentials.hash(request.getRemoteAddr());
        credentials.requireUnder("source:" + address, NativeCredentials.FAILURES_PER_SOURCE);
        credentials.requireUnder("source-ok:" + address, NativeCredentials.SUCCESSES_PER_SOURCE);
        String email = body.email() == null ? "" : IdentityService.normalizeEmail(body.email());
        if (email.length() > 254 || email.isBlank()) {
            throw IdentityService.failure(HttpStatus.BAD_REQUEST, "invalid_body", "Enter an email and password.");
        }
        String account = "email:" + NativeCredentials.hash(email);
        credentials.requireUnder(account, NativeCredentials.FAILURES_PER_EMAIL);
        String secret = NativeCredentials.token();
        Session session;
        try {
            session = credentials.signIn(email, body.password(), secret, body.deviceLabel(), body.takeover());
        } catch (com.boqlet.api.http.ApiException refused) {
            if ("unauthenticated".equals(refused.body().code())) {
                credentials.count("source:" + address);
                credentials.count(account);
                credentials.signInFailed(email);
            }
            throw refused;
        }
        credentials.count("source-ok:" + address);
        return ResponseEntity.status(HttpStatus.CREATED).header(HttpHeaders.SET_COOKIE,
                ResponseCookie.from(SessionController.COOKIE, secret).secure(secure).httpOnly(true)
                        .sameSite("Lax").path("/api/v1").build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store").body(session);
    }

    @PostMapping("/set-password")
    ResponseEntity<Void> setPassword(@RequestBody Setup body, HttpServletRequest request) {
        String address = NativeCredentials.hash(request.getRemoteAddr());
        credentials.requireUnder("source:" + address, NativeCredentials.FAILURES_PER_SOURCE);
        credentials.requireUnder("source-ok:" + address, NativeCredentials.SUCCESSES_PER_SOURCE);
        try {
            credentials.setPassword(body.token(), body.password(), body.name());
        } catch (com.boqlet.api.http.ApiException refused) {
            if ("invalid_setup".equals(refused.body().code())) credentials.count("source:" + address);
            throw refused;
        }
        credentials.count("source-ok:" + address);
        return ResponseEntity.noContent().header(HttpHeaders.CACHE_CONTROL, "no-store").build();
    }

    @ExceptionHandler(SessionConflict.class)
    ResponseEntity<Map<String, Object>> conflict(SessionConflict failure) {
        return ResponseEntity.status(HttpStatus.CONFLICT).header(HttpHeaders.CACHE_CONTROL, "no-store").body(
                Map.of("code", "session_active", "message", failure.getMessage(), "activeSession", failure.active));
    }

    record SignIn(String email, String password, String deviceLabel, boolean takeover) {}
    record SignUp(String email, String locale, String website, Long elapsedMs) {}
    record Reset(String email) {}
    record Setup(String token, String password, String name) {}
}
