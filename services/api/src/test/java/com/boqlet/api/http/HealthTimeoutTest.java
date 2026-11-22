package com.boqlet.api.http;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.PrintWriter;
import java.sql.Connection;
import java.time.Duration;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Status;

/** TF-185: with the database unreachable, the `db` check answers DOWN within its deadline instead of hanging. */
class HealthTimeoutTest {
    @Test
    void aHangingDatabaseIsDownWithinTheDeadline() {
        var indicator = new HealthConfiguration().dbHealthIndicator(new HangingDataSource(), Duration.ofMillis(300));
        long started = System.nanoTime();
        var health = indicator.health();
        long ms = (System.nanoTime() - started) / 1_000_000;
        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(ms).isLessThan(2_000);
    }

    /** A pool waiting for a connection that never comes (the database container stopped). */
    private static final class HangingDataSource implements DataSource {
        @Override
        public Connection getConnection() {
            try {
                Thread.sleep(30_000);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            throw new IllegalStateException("no connection");
        }

        @Override public Connection getConnection(String user, String password) { return getConnection(); }
        @Override public PrintWriter getLogWriter() { return null; }
        @Override public void setLogWriter(PrintWriter out) {}
        @Override public void setLoginTimeout(int seconds) {}
        @Override public int getLoginTimeout() { return 0; }
        @Override public Logger getParentLogger() { return Logger.getGlobal(); }
        @Override public <T> T unwrap(Class<T> type) { return null; }
        @Override public boolean isWrapperFor(Class<?> type) { return false; }
    }
}
