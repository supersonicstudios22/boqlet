package com.boqlet.api.extension;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
class ModuleTasks {
    private final CoreModules modules;
    private final TaskScheduler scheduler;
    private final JdbcTemplate database;
    private final TransactionTemplate transactions;

    ModuleTasks(CoreModules modules, TaskScheduler scheduler, JdbcTemplate database, TransactionTemplate transactions) {
        this.modules = modules;
        this.scheduler = scheduler;
        this.database = database;
        this.transactions = transactions;
    }

    @EventListener(ApplicationReadyEvent.class)
    void schedule() {
        for (var module : modules.installed()) {
            for (var task : module.scheduledTasks()) {
                if (task.interval().isNegative() || task.interval().isZero()) {
                    throw new IllegalArgumentException("A module task requires a positive interval.");
                }
                String key = "module-task:" + module.key() + ":" + task.name();
                scheduler.scheduleWithFixedDelay(() -> transactions.executeWithoutResult(status -> {
                    if (Boolean.TRUE.equals(database.queryForObject(
                            "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))", Boolean.class, key))) task.action().run();
                }), task.interval());
            }
        }
    }
}
