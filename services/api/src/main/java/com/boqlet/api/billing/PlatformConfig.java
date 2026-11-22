package com.boqlet.api.billing;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** The platform's own settings (P57): the one currency of plan prices, and whether public sign-up is open. */
@Service
public class PlatformConfig {
    private final JdbcTemplate database;

    PlatformConfig(JdbcTemplate database) {
        this.database = database;
    }

    public record Values(String currency, boolean publicSignUp) {}

    public Values read() {
        return database.queryForObject("SELECT currency, public_sign_up FROM platform_settings",
                (row, index) -> new Values(row.getString(1), row.getBoolean(2)));
    }

    /** Reads the settings for an update in the caller's transaction: changes to them are serialised. */
    public Values lock() {
        return database.queryForObject("SELECT currency, public_sign_up FROM platform_settings FOR UPDATE",
                (row, index) -> new Values(row.getString(1), row.getBoolean(2)));
    }

    public void write(Values values) {
        database.update("UPDATE platform_settings SET currency = ?, public_sign_up = ?, updated_at = now()",
                values.currency(), values.publicSignUp());
    }

    public boolean publicSignUp() { return read().publicSignUp(); }
}
