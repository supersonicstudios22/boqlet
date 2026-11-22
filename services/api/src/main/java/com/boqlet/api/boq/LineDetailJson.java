package com.boqlet.api.boq;

import com.boqlet.contract.model.LineDetail;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * A flagged line's `quantity` is `null` and required (TF-189). The generator flattens `LineDetail`'s
 * `allOf` into a plain `BigDecimal` (not `JsonNullable` as in `RunLine`), so the API's `non_null`
 * inclusion left the field out of `getLine` and `getPublicShareLine` while the lines pages send it.
 */
@Configuration(proxyBeanMethods = false)
class LineDetailJson {
    @Bean
    Jackson2ObjectMapperBuilderCustomizer lineDetailQuantity() {
        return builder -> builder.mixIn(LineDetail.class, Quantity.class);
    }

    abstract static class Quantity {
        @JsonInclude(JsonInclude.Include.ALWAYS)
        public abstract BigDecimal getQuantity();
    }
}
