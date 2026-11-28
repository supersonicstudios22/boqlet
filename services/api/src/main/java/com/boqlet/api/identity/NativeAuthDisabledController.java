package com.boqlet.api.identity;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The contract's answer for native sign-in on a backend that doesn't run it (P50, C05). */
@RestController
@RequestMapping("/api/v1/auth")
@ConditionalOnProperty(name = "BOQLET_NATIVE_AUTH", havingValue = "false", matchIfMissing = true)
class NativeAuthDisabledController {
    @PostMapping({"/sign-in", "/set-password", "/setup-link", "/sign-up", "/password-reset"})
    void disabled() {
        throw IdentityService.failure(HttpStatus.NOT_FOUND, "native_auth_disabled", "This backend doesn't run native sign-in.");
    }

    @GetMapping("/sign-up")
    void signUpDisabled() {
        throw IdentityService.failure(HttpStatus.NOT_FOUND, "native_auth_disabled", "This backend doesn't run native sign-in.");
    }
}
