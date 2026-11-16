package com.boqlet.api.realtime;

import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.NotificationsApi;
import com.boqlet.contract.model.ListNotifications200Response;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
class NotificationController implements NotificationsApi {
    private final Notifications notifications;

    NotificationController(Notifications notifications) { this.notifications = notifications; }

    @Override
    public ResponseEntity<ListNotifications200Response> listNotifications(String cursor, Integer limit, Boolean unread) {
        return ResponseEntity.ok(notifications.list(Login.current().userId(), cursor, limit, Boolean.TRUE.equals(unread)));
    }

    @Override
    public ResponseEntity<Void> markNotificationRead(UUID id) {
        notifications.mark(Login.current().userId(), id);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> markAllNotificationsRead() {
        notifications.mark(Login.current().userId(), null);
        return ResponseEntity.noContent().build();
    }
}
