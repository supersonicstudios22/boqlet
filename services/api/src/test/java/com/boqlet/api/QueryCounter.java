package com.boqlet.api;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.util.Set;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * Counts the SQL statements one thread prepares while {@link #count} runs (review B-20: a list of BoQs costs a fixed
 * number of queries). The application's DataSource is wrapped so that each connection reports
 * `prepareStatement`, `prepareCall` and `createStatement`; other threads (dispatchers, schedulers) are not counted.
 */
@TestConfiguration
public class QueryCounter {
    private static final ThreadLocal<int[]> COUNTING = new ThreadLocal<>();
    private static final Set<String> STATEMENTS = Set.of("prepareStatement", "prepareCall", "createStatement");

    /** The value `work` returns, with the statements it prepared on this thread. */
    public record Counted<T>(T value, int statements) {}

    public static <T> Counted<T> count(Supplier<T> work) {
        int[] counter = {0};
        COUNTING.set(counter);
        try {
            T value = work.get();
            return new Counted<>(value, counter[0]);
        } finally {
            COUNTING.remove();
        }
    }

    @Bean
    static BeanPostProcessor countingDataSource() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String name) {
                if (!(bean instanceof DataSource source) || Proxy.isProxyClass(bean.getClass())) return bean;
                return Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[]{DataSource.class},
                        forward(source, (method, result) -> result instanceof Connection connection ? counting(connection) : result));
            }
        };
    }

    private static Connection counting(Connection connection) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[]{Connection.class},
                forward(connection, (method, result) -> {
                    int[] counter = COUNTING.get();
                    if (counter != null && STATEMENTS.contains(method.getName())) counter[0]++;
                    return result;
                }));
    }

    private interface After {
        Object apply(java.lang.reflect.Method method, Object result);
    }

    private static InvocationHandler forward(Object target, After after) {
        return (proxy, method, args) -> {
            try {
                return after.apply(method, method.invoke(target, args));
            } catch (InvocationTargetException failure) {
                throw failure.getCause();
            }
        };
    }
}
