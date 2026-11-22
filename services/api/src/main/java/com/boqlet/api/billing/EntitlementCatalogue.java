package com.boqlet.api.billing;

import com.boqlet.api.extension.CoreModule.EntitlementType;
import com.boqlet.api.extension.CoreModules;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * The limits and features the backend enforces (P57): the only keys a plan or an org override may
 * set. A key here has a check in code (EntitlementService's callers, plans-and-limits.md); a new
 * kind of limit needs code, so the platform admin can set values but not invent keys. Modules add
 * theirs through `CoreModule.entitlementKeys()`.
 */
@Component
public class EntitlementCatalogue {
    private static final Map<String, EntitlementType> CORE;

    static {
        var core = new LinkedHashMap<String, EntitlementType>();
        for (String key : new String[] {"seats", "activeProjects", "ownedOrgsPerUser", "maxModelVersionMb", "maxModelsPerBoq",
                "processingMinutesPerMonth", "libraryOrgPresets", "auditLogRetentionDays"}) {
            core.put(key, EntitlementType.NUMBER);
        }
        for (String key : new String[] {"shareLinks", "approvalWorkflow", "exportWatermark"}) {
            core.put(key, EntitlementType.BOOLEAN);
        }
        CORE = Collections.unmodifiableMap(core);
    }

    private final Map<String, EntitlementType> keys;

    EntitlementCatalogue(CoreModules modules) {
        var all = new LinkedHashMap<>(CORE);
        modules.entitlementKeys().forEach(all::putIfAbsent);
        keys = Collections.unmodifiableMap(all);
    }

    /** Every key in a stable order: core first, then the modules'. */
    public Map<String, EntitlementType> keys() { return keys; }

    /**
     * Whether `value` is a valid value for `key`: a number is a non-negative whole number, a feature a
     * boolean. Unknown keys are invalid.
     */
    public boolean valid(String key, JsonNode value) {
        EntitlementType type = keys.get(key);
        if (type == null || value == null) return false;
        if (type == EntitlementType.BOOLEAN) return value.isBoolean();
        if (!value.isNumber() || value.decimalValue().signum() < 0) return false;
        // 1e15 keeps every limit inside a long and a JSON number every client reads exactly.
        var number = value.decimalValue();
        return number.stripTrailingZeros().scale() <= 0 && number.compareTo(java.math.BigDecimal.valueOf(1_000_000_000_000_000L)) <= 0;
    }
}
