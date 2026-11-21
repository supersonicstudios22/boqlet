package com.boqlet.api.http;

import org.openapitools.jackson.nullable.JsonNullableModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class JsonConfiguration {
    @Bean
    JsonNullableModule jsonNullableModule() {
        return new JsonNullableModule();
    }
}
