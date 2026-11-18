package com.boqlet.api.http;

import com.boqlet.api.identity.IdentityFilter;
import com.boqlet.api.identity.IdentityService;
import com.boqlet.api.identity.Sessions;
import com.boqlet.api.identity.NativeCredentials;
import com.boqlet.api.identity.NativeIdentityFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;

@Configuration
class SecurityConfiguration {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity security, ObjectMapper json,
            ObjectProvider<JwtDecoder> decoders, IdentityService identities, Sessions sessions,
            ObjectProvider<NativeCredentials> nativeCredentials, @Value("${BOQLET_APP_URL:}") String origin) throws Exception {
        AuthenticationEntryPoint unauthenticated = (request, response, failure) -> {
            response.setStatus(401);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            json.writeValue(response.getOutputStream(), new ApiError("unauthenticated", "Sign in to continue."));
        };
        security
                .sessionManagement(policy -> policy.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                // Native cookie requests have an exact Origin check in NativeIdentityFilter.
                .csrf(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests(requests -> requests
                        .dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
                        .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/actuator/prometheus").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/plans", "/api/v1/invitations/*", "/api/v1/public/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/webhooks/billing/*").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/sign-in", "/api/v1/auth/set-password").permitAll()
                        .requestMatchers("/api/v1/**").authenticated()
                        .anyRequest().denyAll())
                .exceptionHandling(errors -> errors.authenticationEntryPoint(unauthenticated));
        var nativeAuth = nativeCredentials.getIfAvailable();
        if (nativeAuth != null) {
            security.addFilterBefore(new NativeIdentityFilter(nativeAuth, identities, json, origin), AnonymousAuthenticationFilter.class);
            return security.build();
        }
        var decoder = decoders.getIfAvailable();
        if (decoder != null) {
            var bearer = new DefaultBearerTokenResolver();
            security.oauth2ResourceServer(oauth -> oauth.authenticationEntryPoint(unauthenticated)
                    .bearerTokenResolver(request -> {
                        String path = request.getRequestURI().substring(request.getContextPath().length());
                        boolean publicRoute = request.getMethod().equals("GET") && (path.equals("/api/v1/plans")
                                || path.startsWith("/api/v1/public/") || path.startsWith("/api/v1/invitations/"))
                                || request.getMethod().equals("POST") && path.startsWith("/api/v1/webhooks/billing/");
                        return publicRoute ? null : bearer.resolve(request);
                    })
                    .jwt(tokens -> tokens.decoder(decoder)));
            security.addFilterAfter(new IdentityFilter(identities, sessions, json), BearerTokenAuthenticationFilter.class);
        }
        return security.build();
    }
}
