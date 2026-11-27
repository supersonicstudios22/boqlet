package com.boqlet.api.boq;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Review C-07: the Excel's built-in groupings; a run without a classification has no grouping at all (null). */
class BuiltInGroupingTest {
    @Test
    void storeyAndRuleAreBuiltInAndNoGroupingIsNone() {
        assertThat(BoqExports.builtIn("~storey")).isTrue();
        assertThat(BoqExports.builtIn("~rule")).isTrue();
        assertThat(BoqExports.builtIn("acme-cost-codes")).isFalse();
        assertThat(BoqExports.builtIn(null)).isFalse();
    }
}
