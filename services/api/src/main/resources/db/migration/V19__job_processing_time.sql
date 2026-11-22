-- TF-036 (BR-62): a job's processing time across attempts. A failed attempt that is retried adds its
-- time here before the retry; the wait for the retry is not counted. The usage event of the ended job
-- is this plus its last attempt. The previous image keeps working (it never reads the column).
ALTER TABLE jobs ADD COLUMN processing_ms bigint NOT NULL DEFAULT 0;
