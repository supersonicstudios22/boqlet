package com.boqlet.api.identity;

import com.boqlet.contract.api.SessionsApi;
import com.boqlet.contract.model.OpenSessionRequest;
import com.boqlet.contract.model.Session;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestController;

@RestController
class SessionController implements SessionsApi {
    static final String COOKIE = "boqlet_session";

    private final Sessions sessions;
    private final boolean secureCookie;

    SessionController(Sessions sessions, @Value("${boqlet.auth.secure-cookie:true}") boolean secureCookie) {
        this.sessions = sessions;
        this.secureCookie = secureCookie;
    }

    @Override
    public ResponseEntity<Session> openSession(OpenSessionRequest request) {
        var login = Login.current();
        if (login.providerSession().startsWith("native:")) {
            return ResponseEntity.status(HttpStatus.CREATED).body(login.session());
        }
        Session session = sessions.open(login, request.getDeviceLabel(), Boolean.TRUE.equals(request.getTakeover()));
        return ResponseEntity.status(HttpStatus.CREATED)
                .header(HttpHeaders.SET_COOKIE, cookie(session.getId().toString()).build().toString())
                .body(session);
    }

    @Override
    public ResponseEntity<Session> getCurrentSession() {
        return ResponseEntity.ok(Login.current().session());
    }

    @Override
    public ResponseEntity<Void> closeCurrentSession() {
        sessions.close(Login.current());
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("").maxAge(0).build().toString()).build();
    }

    @ExceptionHandler(SessionConflict.class)
    ResponseEntity<Map<String, Object>> conflict(SessionConflict failure) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(
                Map.of("code", "session_active", "message", failure.getMessage(), "activeSession", failure.active));
    }

    private ResponseCookie.ResponseCookieBuilder cookie(String value) {
        return ResponseCookie.from(COOKIE, value).httpOnly(true).secure(secureCookie).sameSite("Lax").path("/api/v1");
    }
}
