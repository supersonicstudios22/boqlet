import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl/core";
import settings from "../../../messages/en/settings.json";
import { minutesText } from "./usage-settings";

/** TF-120 (F14-AC4): the total and its parts read the same way; nothing above zero shows as 0. */
const t = createTranslator({ locale: "en", messages: { settings }, namespace: "settings.usage" });
const n = (v: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(v);
const show = (v: number) => minutesText(v, n, (k, values) => t(k, values));

describe("usage minutes", () => {
  it("a total of 0.05 (parse 0.04, run 0.01) reads like its parts", () => {
    expect(show(0.05)).toBe("under 0.1 min");
    expect(show(0.04)).toBe("under 0.1 min");
    expect(show(0.01)).toBe("under 0.1 min");
  });
  it("zero and larger amounts as before", () => {
    expect(show(0)).toBe("0 min");
    expect(show(12.34)).toBe("12.3 min");
  });
});
