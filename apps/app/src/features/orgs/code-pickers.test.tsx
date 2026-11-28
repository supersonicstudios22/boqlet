// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import orgs from "../../../messages/en/orgs.json";
import { COUNTRY_CODES, CURRENCY_CODES, countryItems, currencyItems, searchItems } from "./regions";

/**
 * Review C-29 (CAS-007, PRD-023): country and currency are chosen by name, not typed into a box cut
 * to the code's length ("Ireland" became IR, Iran).
 */
vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  return {
    useLocale: () => "en",
    useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: { orgs } as never, namespace: namespace as never }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("country and currency codes", () => {
  it("are unique codes with a name for each", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    expect(COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(CURRENCY_CODES.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
    expect(countryItems("en").find((i) => i.value === "IE")?.label).toBe("Ireland");
    expect(currencyItems("en").find((i) => i.value === "EUR")?.label).toBe("Euro");
  });

  it("a name or a code finds it; names that start with the words come first", () => {
    expect(searchItems(countryItems("en"), "Ireland")[0]!.value).toBe("IE");
    expect(searchItems(countryItems("en"), "ie")[0]!.value).toBe("IE");
    expect(searchItems(countryItems("en"), "aus")[0]!.label).toMatch(/^Aus/);
    expect(searchItems(countryItems("en"), "cote")[0]!.value).toBe("CI");
    expect(searchItems(currencyItems("en"), "euro")[0]!.value).toBe("EUR");
    expect(searchItems(currencyItems("en"), "chf")[0]!.value).toBe("CHF");
  });
});

describe("CountryPicker", () => {
  it("typing Ireland and Enter picks IE; Not set clears it", async () => {
    const { CountryPicker } = await import("./code-pickers");
    const box = document.createElement("div");
    document.body.append(box);
    root = createRoot(box);
    const onChange = vi.fn();
    act(() => root!.render(<CountryPicker id="c" value="" onChange={onChange} optional />));
    const input = box.querySelector("input")!;
    expect(input.id).toBe("c");
    act(() => input.focus());
    type(input, "Ireland");
    const options = [...box.querySelectorAll("[role=option]")].map((o) => o.textContent);
    expect(options[0]).toBe("IrelandIE");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onChange).toHaveBeenLastCalledWith("IE");

    act(() => root!.render(<CountryPicker id="c" value="IE" onChange={onChange} optional />));
    expect(input.value).toBe("Ireland");
    act(() => input.focus());
    act(() => box.querySelector<HTMLLIElement>("[role=option]")!.click());
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("a stored code the list doesn't have still shows, as its code", async () => {
    const { CurrencyPicker } = await import("./code-pickers");
    const box = document.createElement("div");
    document.body.append(box);
    root = createRoot(box);
    act(() => root!.render(<CurrencyPicker id="m" value="BGN" onChange={() => {}} />));
    expect(box.querySelector("input")!.value).toBe("BGN");
  });
});
