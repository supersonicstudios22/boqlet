package com.boqlet.api.db;

import java.security.SecureRandom;
import java.util.UUID;

public final class Ids {
    private static final SecureRandom RANDOM = new SecureRandom();

    private Ids() {}

    public static UUID newId() {
        long timestamp = System.currentTimeMillis() & 0x0000_ffff_ffff_ffffL;
        long high = (timestamp << 16) | 0x7000L | RANDOM.nextInt(0x1000);
        long low = (RANDOM.nextLong() & 0x3fff_ffff_ffff_ffffL) | 0x8000_0000_0000_0000L;
        return new UUID(high, low);
    }
}
