import { describe, expect, it } from "vitest";
import errors from "../../../messages/en/errors.json";

/** The texts of error codes a screen can't explain better itself. */
describe("error texts", () => {
  it("TF-133: invalid_preset names no preset kind (it is answered for rule sets and code lists too)", () => {
    expect(errors.codes.invalid_preset).not.toMatch(/dictionar|rule set|classification|code list/i);
  });

  it("TF-183: an API that doesn't answer has its own text", () => {
    expect(errors.codes.api_unavailable).toBeTruthy();
  });

  it("TF-174: the request limits' refusals have their own texts", () => {
    expect(errors.codes.invalid_body).toBeTruthy();
    expect(errors.codes.too_large).toBeTruthy();
  });
});
