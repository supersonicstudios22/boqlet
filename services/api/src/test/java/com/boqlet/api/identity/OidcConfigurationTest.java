package com.boqlet.api.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtValidationException;

/**
 * The legacy OIDC sign-in path is kept for rollback only (review B-16, DEC-62: the owner has not confirmed its
 * removal). The other Java tests reach {@code IdentityFilter} with a stub decoder ({@code ApiFoundationTest.Tokens});
 * this one boots the real decoder {@code OidcConfiguration} builds, against a local JWKS endpoint, so the rollback
 * path is known to start and to check the signature, the issuer and the audience.
 */
class OidcConfigurationTest {
    private static final String ISSUER = "https://sign-in.example.test/realms/boqlet";
    private static HttpServer jwks;
    private static RSAKey key;
    private static JwtDecoder decoder;

    @BeforeAll
    static void start() throws Exception {
        key = new RSAKeyGenerator(2048).keyID("rollback-test").generate();
        byte[] body = new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
        jwks = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        jwks.createContext("/certs", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        jwks.start();
        decoder = new OidcConfiguration().identityDecoder(ISSUER, "boqlet-api",
                "http://127.0.0.1:" + jwks.getAddress().getPort() + "/certs");
    }

    @AfterAll
    static void stop() {
        jwks.stop(0);
    }

    private static String token(String issuer, String audience, RSAKey signer) throws Exception {
        var claims = new JWTClaimsSet.Builder().issuer(issuer).audience(audience).subject("owner").claim("sid", "s1")
                .claim("email", "owner@example.test").claim("email_verified", true)
                .issueTime(Date.from(Instant.now())).expirationTime(Date.from(Instant.now().plusSeconds(300))).build();
        var jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(signer.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(signer));
        return jwt.serialize();
    }

    @Test
    void aTokenFromTheIssuerForTheApiIsAccepted() throws Exception {
        var jwt = decoder.decode(token(ISSUER, "boqlet-api", key));
        assertThat(jwt.getSubject()).isEqualTo("owner");
        assertThat(jwt.getClaimAsString("sid")).isEqualTo("s1");
    }

    @Test
    void anotherAudienceOrIssuerIsRefused() {
        assertThatThrownBy(() -> decoder.decode(token(ISSUER, "another-client", key))).isInstanceOf(JwtValidationException.class);
        assertThatThrownBy(() -> decoder.decode(token("https://elsewhere.example.test", "boqlet-api", key)))
                .isInstanceOf(JwtValidationException.class);
    }

    @Test
    void aTokenSignedWithAnotherKeyIsRefused() throws Exception {
        var other = new RSAKeyGenerator(2048).keyID("rollback-test").generate();
        assertThatThrownBy(() -> decoder.decode(token(ISSUER, "boqlet-api", other))).isInstanceOf(JwtException.class);
    }
}
