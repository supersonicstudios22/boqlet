package com.boqlet.api.identity;

import com.boqlet.contract.model.Session;
import java.util.UUID;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

public record Login(UUID userId, String providerSession, Session session) {
    static final String ATTRIBUTE = Login.class.getName();

    public static Login current() {
        var attributes = (ServletRequestAttributes) RequestContextHolder.currentRequestAttributes();
        return (Login) attributes.getRequest().getAttribute(ATTRIBUTE);
    }
}
