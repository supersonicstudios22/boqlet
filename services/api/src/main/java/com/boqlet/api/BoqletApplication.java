package com.boqlet.api;

import org.openapitools.configuration.EnumConverterConfiguration;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@Import(EnumConverterConfiguration.class)
@EnableScheduling
public class BoqletApplication {
    public static void main(String[] args) {
        SpringApplication.run(BoqletApplication.class, args);
    }
}
