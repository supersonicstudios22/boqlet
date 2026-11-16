package com.boqlet.api.billing;

import com.boqlet.api.http.ApiException;
import com.boqlet.api.identity.Login;
import com.boqlet.api.org.OrgAccess;
import com.boqlet.contract.api.BillingApi;
import com.boqlet.contract.model.*;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import static com.boqlet.contract.model.OrgRole.ADMIN;
import static com.boqlet.contract.model.OrgRole.OWNER;

@RestController
class BillingController implements BillingApi {
    private final OrgAccess access;
    private final EntitlementService billing;

    BillingController(OrgAccess access, EntitlementService billing) {
        this.access = access;
        this.billing = billing;
    }

    @Override
    public ResponseEntity<List<Plan>> listPlans() {
        return ResponseEntity.ok(billing.plans());
    }

    @Override
    public ResponseEntity<EntitlementsResponse> getEntitlements(UUID org) {
        access.require(org, Login.current().userId());
        return ResponseEntity.ok(billing.snapshot(org));
    }

    @Override
    public ResponseEntity<UsageResponse> getUsage(UUID org, String month) {
        OrgAccess.checkRole(access.require(org, Login.current().userId()).role(), OWNER, ADMIN);
        return ResponseEntity.ok(billing.usage(org, month));
    }

    @Override
    public ResponseEntity<Subscription> getBilling(UUID org) {
        OrgAccess.checkRole(access.require(org, Login.current().userId()).role(), OWNER);
        return ResponseEntity.ok(billing.subscription(org));
    }

    @Override
    public ResponseEntity<RedirectUrl> createCheckout(UUID org, CreateCheckoutRequest request) {
        OrgAccess.checkRole(access.require(org, Login.current().userId()).role(), OWNER);
        throw new ApiException(HttpStatus.CONFLICT, "checkout_unavailable",
                "Pilot plans are managed by the platform administrator.", Map.of());
    }

    @Override
    public ResponseEntity<RedirectUrl> createBillingPortal(UUID org, CreateBillingPortalRequest request) {
        OrgAccess.checkRole(access.require(org, Login.current().userId()).role(), OWNER);
        String url = request.getReturnUrl();
        try {
            URI uri = URI.create(url);
            if (uri.getHost() != null && ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                    && uri.getUserInfo() == null) return ResponseEntity.ok(new RedirectUrl(url));
        } catch (IllegalArgumentException ignored) {
            // Treat malformed URLs like unsupported schemes.
        }
        throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_body", "The return URL is invalid.", Map.of());
    }

    @Override
    public ResponseEntity<Void> billingWebhook(String provider, Object body) {
        throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "The billing provider was not found.", Map.of());
    }
}
