package com.boqlet.api.http;

import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.actuate.jdbc.DataSourceHealthIndicator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The `db` health check with a deadline (TF-185): with the database gone, a connection waits for the
 * pool's timeout (30 s), so readiness hung instead of answering `503 DOWN`. The bean's name replaces
 * Spring Boot's own `db` indicator; readiness includes it (application.yml).
 */
@Configuration
class HealthConfiguration {
    private static final ExecutorService CHECKS = Executors.newVirtualThreadPerTaskExecutor();

    @Bean("dbHealthIndicator")
    HealthIndicator dbHealthIndicator(DataSource dataSource,
                                      @Value("${boqlet.health.db-timeout:2s}") Duration timeout) {
        return within(new DataSourceHealthIndicator(dataSource, "SELECT 1"), timeout);
    }

    static HealthIndicator within(HealthIndicator check, Duration timeout) {
        return () -> {
            Future<Health> health = CHECKS.submit((java.util.concurrent.Callable<Health>) check::health);
            try {
                return health.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            } catch (TimeoutException late) {
                health.cancel(true);
                return Health.down().withDetail("error", "No answer within " + timeout.toMillis() + " ms").build();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return Health.down().build();
            } catch (Exception failure) {
                return Health.down(failure).build();
            }
        };
    }
}
