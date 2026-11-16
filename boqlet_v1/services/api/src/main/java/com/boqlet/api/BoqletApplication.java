package com.boqlet.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
public class BoqletApplication {
    public static void main(String[] args) {
        SpringApplication.run(BoqletApplication.class, args);
    }
}
