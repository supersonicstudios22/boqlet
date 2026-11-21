package com.boqlet.api.db;

import java.io.IOException;
import java.io.StringReader;
import java.sql.SQLException;
import java.util.function.Consumer;
import org.postgresql.PGConnection;
import org.postgresql.copy.CopyManager;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class PostgresCopy {
    private final JdbcTemplate database;

    PostgresCopy(JdbcTemplate database) {
        this.database = database;
    }

    /** SQL is a static table and column list. Row data is always quoted as CSV. */
    public void copy(String tableAndColumns, Consumer<Rows> data) {
        database.execute((ConnectionCallback<Void>) connection -> {
            var rows = new Rows(connection.unwrap(PGConnection.class).getCopyAPI(),
                    "COPY " + tableAndColumns + " FROM STDIN WITH (FORMAT CSV)");
            data.accept(rows);
            rows.flush();
            return null;
        });
    }

    public static class Rows {
        private final CopyManager copy;
        private final String sql;
        private final StringBuilder buffer = new StringBuilder();

        Rows(CopyManager copy, String sql) {
            this.copy = copy;
            this.sql = sql;
        }

        public void add(Object... values) {
            for (int index = 0; index < values.length; index++) {
                if (index > 0) buffer.append(',');
                if (values[index] != null) {
                    buffer.append('"').append(values[index].toString().replace("\"", "\"\"")).append('"');
                }
            }
            buffer.append('\n');
            if (buffer.length() >= 1 << 20) flush();
        }

        private void flush() {
            if (buffer.isEmpty()) return;
            try (var reader = new StringReader(buffer.toString())) {
                copy.copyIn(sql, reader);
                buffer.setLength(0);
            } catch (IOException | SQLException failure) {
                throw new IllegalStateException("Could not index worker output.", failure);
            }
        }
    }
}
