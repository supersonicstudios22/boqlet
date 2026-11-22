// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPicker } from "./search-picker";

/**
 * TF-103: the sheet's code picker sits in a virtualised row (positioned with a transform); its list
 * must be drawn over the page, not inside the row, or the next rows cover it and take its clicks.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const items = [
  { value: "01.01", label: "01.01", hint: "Walls" },
  { value: "01.02", label: "01.02", hint: "Slabs" },
];

describe("TF-103 SearchPicker portal", () => {
  it("draws its list at the input's place over the page, and a click on it picks", () => {
    const row = document.createElement("div");
    row.style.transform = "translateY(320px)";
    document.body.append(row);
    root = createRoot(row);
    const onPick = vi.fn();
    act(() => root!.render(<SearchPicker items={items} value={undefined} onPick={onPick} label="Item code" empty="—" portal data-testid="cell-editor" />));
    const input = row.querySelector("input")!;
    act(() => input.focus());
    const list = document.querySelector<HTMLUListElement>("[data-testid=cell-editor-list]")!;
    expect(list).not.toBeNull();
    expect(row.contains(list)).toBe(false);
    expect(list.style.position).toBe("fixed");
    act(() => list.querySelectorAll<HTMLLIElement>("[role=option]")[1]!.click());
    expect(onPick).toHaveBeenCalledWith("01.02");
  });

  it("without `portal` it stays in its parent (dialogs, forms)", () => {
    const box = document.createElement("div");
    document.body.append(box);
    root = createRoot(box);
    act(() => root!.render(<SearchPicker items={items} value={undefined} onPick={() => {}} label="Code" empty="—" data-testid="p" />));
    act(() => box.querySelector("input")!.focus());
    expect(box.querySelector("[role=listbox]")).not.toBeNull();
  });
});
