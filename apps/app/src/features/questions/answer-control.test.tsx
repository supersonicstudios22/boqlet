// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/input", () => ({ Input: () => null }));
vi.mock("@/components/native-select", () => ({ NativeSelect: () => null }));
vi.mock("./search-picker", () => ({ SearchPicker: () => null }));

const { AnswerControl } = await import("./answer-control");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const choice = { kind: "choice", options: [{ value: "stated", label: "Stated", recommended: true }, { value: "measured", label: "Measured" }] } as const;

/** TF-173 (Q60): a click on the preselected suggested option accepts it. */
describe("choice answers", () => {
  it("a click on the option already checked commits it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onChange = vi.fn();
    act(() => root!.render(<AnswerControl type={choice as never} value="stated" onChange={onChange} context={{ terms: [] }} label="Answer" />));
    const radios = host.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect(radios[0]!.checked).toBe(true);
    act(() => radios[0]!.click());
    expect(onChange).toHaveBeenCalledWith("stated", true);
    onChange.mockClear();
    act(() => radios[1]!.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("measured", true);
    host.remove();
  });
});
