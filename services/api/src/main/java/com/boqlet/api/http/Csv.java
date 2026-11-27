package com.boqlet.api.http;

import java.util.Arrays;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * The API's one CSV writer (review B-15): UTF-8 with a byte order mark (so Excel reads accents), RFC 4180 rows
 * ending in CRLF, a cell quoted only when it holds a quote, comma or line break, and text a spreadsheet would
 * run as a formula (starting with = + - @, after any leading space) defused with a leading apostrophe.
 * Numbers and dates are written as they are, so a negative number stays a number.
 */
public final class Csv {
    private final StringBuilder out = new StringBuilder("﻿");

    /** Appends one row. */
    public Csv row(Object... values) {
        out.append(Arrays.stream(values).map(Csv::cell).collect(Collectors.joining(","))).append("\r\n");
        return this;
    }

    /** One cell as written. */
    public static String cell(Object value) {
        String text = Objects.toString(value, "");
        if (value instanceof String && text.stripLeading().matches("(?s)^[=+@-].*")) text = "'" + text;
        return text.matches("(?s).*[\",\r\n].*") ? "\"" + text.replace("\"", "\"\"") + "\"" : text;
    }

    @Override
    public String toString() {
        return out.toString();
    }

    /** The download: {@code text/csv} in UTF-8, never cached, saved as {@code file}. */
    public ResponseEntity<String> download(String file) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + file + "\"").body(out.toString());
    }
}
