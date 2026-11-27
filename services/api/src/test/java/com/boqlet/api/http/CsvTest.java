package com.boqlet.api.http;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The API's one CSV writer (review B-15): used by the decisions, audit and admin organisations exports. */
class CsvTest {
    @Test
    void rowsStartWithAByteOrderMarkAndEndInCrlf() {
        assertThat(new Csv().row("a", "b").row(1, null).toString()).isEqualTo("﻿a,b\r\n1,\r\n");
    }

    @Test
    void aCellIsQuotedOnlyWhenItNeedsIt() {
        assertThat(Csv.cell("plain text")).isEqualTo("plain text");
        assertThat(Csv.cell("a, b")).isEqualTo("\"a, b\"");
        assertThat(Csv.cell("say \"hi\"")).isEqualTo("\"say \"\"hi\"\"\"");
        assertThat(Csv.cell("two\nlines")).isEqualTo("\"two\nlines\"");
    }

    @Test
    void textThatWouldRunAsAFormulaIsDefusedButNumbersStayNumbers() {
        assertThat(Csv.cell("=HYPERLINK(\"x\")")).isEqualTo("\"'=HYPERLINK(\"\"x\"\")\"");
        assertThat(Csv.cell("  +1")).isEqualTo("'  +1");
        assertThat(Csv.cell("@SUM(A1)")).isEqualTo("'@SUM(A1)");
        assertThat(Csv.cell("-2")).isEqualTo("'-2");
        assertThat(Csv.cell(-2)).isEqualTo("-2");
    }

    @Test
    void theDownloadIsUtf8CsvNotCached() {
        var response = new Csv().row("x").download("audit.csv");
        assertThat(response.getHeaders().getContentType().toString()).isEqualTo("text/csv;charset=UTF-8");
        assertThat(response.getHeaders().getFirst("Content-Disposition")).isEqualTo("attachment; filename=\"audit.csv\"");
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
    }
}
