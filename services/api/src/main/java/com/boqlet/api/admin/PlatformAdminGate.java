package com.boqlet.api.admin;

import com.boqlet.api.http.ApiException;
import com.boqlet.api.identity.IdentityService;
import com.boqlet.api.identity.Login;
import com.boqlet.contract.api.AdminApi;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * The platform-admin check on the handler itself (F19-AC1, BR-57, TF-011): every `AdminApi`
 * operation answers `404` unless the signed-in user is a platform admin, whatever spelling of the
 * URL reached it. The identity filters check the path too; this is the check that can't be
 * bypassed by how the path is written, because it runs on the handler Spring actually chose.
 */
@Configuration(proxyBeanMethods = false)
class PlatformAdminGate implements WebMvcConfigurer, HandlerInterceptor {
    private final IdentityService identities;

    PlatformAdminGate(IdentityService identities) {
        this.identities = identities;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this);
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (handler instanceof HandlerMethod method && AdminApi.class.isAssignableFrom(method.getBeanType())) {
            Login login = Login.current();
            if (login == null || !identities.platformAdmin(login.userId())) {
                throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "The resource was not found.", Map.of());
            }
        }
        return true;
    }
}
