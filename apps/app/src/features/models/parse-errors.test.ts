import { describe, expect, it } from "vitest";
import models from "../../../messages/en/models.json";

/**
 * TF-037 (state-machines.md ModelVersion `failed.error.code`): every parse failure code the engine and
 * Java write has a text; the size error is `too_large` (was `model_too_large`).
 */
const CODES = ["not_ifc", "unsupported_schema", "corrupt_file", "too_large", "parse_timeout", "parse_error", "engine_unavailable", "cancelled", "engine_timeout", "worker_lost", "ingestion_failed", "result_invalid", "engine_process_failed", "engine_error", "invalid_input"];

describe("parse failure texts", () => {
  it.each(CODES)("%s", (code) => {
    expect((models.status.errors as Record<string, string>)[code]).toBeTruthy();
  });
});
