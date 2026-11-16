package com.boqlet.api.realtime;

import com.boqlet.api.identity.Login;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
class EventController {
    private final Realtime realtime;

    EventController(Realtime realtime) { this.realtime = realtime; }

    @GetMapping(value = "/api/v1/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    ResponseEntity<SseEmitter> open(@RequestHeader(value = "Last-Event-ID", required = false) String lastId,
                                    @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noCache().noTransform()).header("X-Accel-Buffering", "no")
                .body(realtime.connect(Login.current(), lastId, jwt.getExpiresAt()));
    }
}
