package com.boqlet.api.boq;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/** Review C-22: the issue workbook's Cover date, written as the firm writes dates (the app's tokens, boq-format.ts). */
class ReadableDateTest {
    private static final OffsetDateTime SAVED = OffsetDateTime.parse("2026-03-07T23:30:00-02:00"); // 8 March in UTC

    @Test
    void theFirmsPatternUsesTheAppsTokensAndKeepsEverythingElse() {
        assertThat(BoqExports.readableDate(SAVED, "dd.MM.yyyy", null)).isEqualTo("08.03.2026");
        assertThat(BoqExports.readableDate(SAVED, "d/M/yy", "en-GB")).isEqualTo("8/3/26");
        assertThat(BoqExports.readableDate(SAVED, "yyyy-MM-dd UTC", null)).isEqualTo("2026-03-08 UTC");
    }

    @Test
    void withoutAPatternTheLocalesLongDate() {
        assertThat(BoqExports.readableDate(SAVED, null, null)).isEqualTo("March 8, 2026");
        assertThat(BoqExports.readableDate(SAVED, " ", "en-GB")).isEqualTo("8 March 2026");
        assertThat(BoqExports.readableDate(SAVED, null, "de-DE")).isEqualTo("8. März 2026");
    }
}
