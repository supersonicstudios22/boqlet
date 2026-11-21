package com.boqlet.api.identity;

import com.boqlet.contract.model.Session;

final class SessionConflict extends RuntimeException {
    final Session active;

    SessionConflict(Session active) {
        super("Another session is active.");
        this.active = active;
    }
}
