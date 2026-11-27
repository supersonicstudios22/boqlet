package com.boqlet.api.identity;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * <b>Rollback only</b> (P50, review B-16, DEC-62): the legacy Keycloak/OIDC sign-in, active only when
 * {@code BOQLET_OIDC_ISSUER} is set. Native sign-in ({@code NativeIdentityFilter}) is the live path on the pilot;
 * this one stays until the owner confirms its removal. {@code OidcConfigurationTest} boots this decoder; the Java
 * test harness ({@code ApiFoundationTest.Tokens}, {@code SuiteSupport}) signs in through {@code IdentityFilter}
 * with a stub decoder, so removing the path means moving that harness to native sign-in first.
 */
@Configuration
class OidcConfiguration {
    @Bean
    @ConditionalOnProperty(name = "BOQLET_OIDC_ISSUER")
    JwtDecoder identityDecoder(@Value("${boqlet.auth.issuer}") String issuer,
            @Value("${boqlet.auth.audience}") String audience,
            @Value("${BOQLET_OIDC_JWKS_URL:}") String jwksUrl) {
        var decoder = jwksUrl.isBlank()
                ? NimbusJwtDecoder.withIssuerLocation(issuer).build()
                : NimbusJwtDecoder.withJwkSetUri(jwksUrl).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(issuer),
                token -> token.getAudience() != null && token.getAudience().contains(audience)
                        ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Incorrect audience.", null))));
        return decoder;
    }
}
