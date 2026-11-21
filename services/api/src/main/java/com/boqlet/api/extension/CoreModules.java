package com.boqlet.api.extension;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Component;

@Component
public class CoreModules {
    private final List<CoreModule> installed;
    private final Map<String, CoreModule.EmailTemplate> notifications;
    private final Map<String, CoreModule.EntitlementType> entitlements;

    CoreModules(List<CoreModule> modules) {
        var ids = new java.util.HashSet<String>();
        for (var module : modules) {
            if (!module.key().matches("[a-z][a-z0-9_-]*") || !ids.add(module.key())) {
                throw new IllegalArgumentException("Module keys must be unique and lower-case.");
            }
        }
        installed = List.copyOf(modules);
        notifications = register(modules, CoreModule::notificationTemplates);
        entitlements = register(modules, CoreModule::entitlementKeys);
    }

    public List<CoreModule> installed() { return installed; }
    public Map<String, CoreModule.EmailTemplate> emailTemplates() { return notifications; }
    public Map<String, CoreModule.EntitlementType> entitlementKeys() { return entitlements; }

    public Map<String, Map<String, Object>> profile(UUID user) {
        var result = new LinkedHashMap<String, Map<String, Object>>();
        for (var module : installed) {
            var data = new LinkedHashMap<>(module.profile(user));
            String kind = module.accountKind(user);
            if (kind != null) data.put("accountKind", kind);
            if (!data.isEmpty()) result.put(module.key(), data);
        }
        return result;
    }

    public boolean hasAuditAction(String action) {
        return installed.stream().anyMatch(module -> action.startsWith(module.key() + ".") && module.auditActions().contains(action));
    }

    private static <T> Map<String, T> register(List<CoreModule> modules, Function<CoreModule, Map<String, T>> contributions) {
        var result = new LinkedHashMap<String, T>();
        for (var module : modules) {
            contributions.apply(module).forEach((key, value) -> {
                if (result.putIfAbsent(key, value) != null) throw new IllegalArgumentException("Duplicate module contribution " + key);
            });
        }
        return Map.copyOf(result);
    }
}
