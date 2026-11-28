// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import shares from "../../../messages/en/shares.json";
import common from "../../../messages/en/common.json";
import errors from "../../../messages/en/errors.json";
import boqs from "../../../messages/en/boqs.json";
import { ApiError } from "@/api/errors";

/*
 * TF-158: the share page's lines are reachable by keyboard (WCAG 2.1.1). The data hooks, the viewer, the
 * line detail and the UI packages hoisted to the workspace root are replaced with plain stand-ins.
 */
vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  return {
    useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: { shares, common, errors, boqs } as never, namespace: namespace as never }),
    useLocale: () => "en",
  };
});
vi.mock("@tanstack/react-query", () => ({ useMutation: () => ({ mutate: () => {}, isPending: false, error: null }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("lucide-react", () => ({ Download: () => <span />, X: () => <span /> }));
// variant and size are styling only
vi.mock("@/components/ui/button", () => ({
  Button: (props: Record<string, unknown>) => <button {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== "variant" && k !== "size"))} />,
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: Record<string, unknown>) => <input {...(props as object)} /> }));
vi.mock("@/components/shell/wordmark", () => ({ Wordmark: () => <span data-testid="wordmark" /> }));
vi.mock("@/i18n/units", () => ({ useUnit: () => (u: string) => u }));
const seen = vi.hoisted(() => ({ detail: null as Record<string, unknown> | null, viewer: null as Record<string, unknown> | null }));
vi.mock("@/features/viewer/model-viewer", () => ({
  ModelViewer: (props: Record<string, unknown>) => {
    seen.viewer = props;
    return null;
  },
}));
vi.mock("@/features/boq-sheet/line-detail", () => ({
  LineDetailBody: (props: Record<string, unknown>) => {
    seen.detail = props;
    return <div data-testid="detail-body" />;
  },
}));
vi.mock("@/api/hooks/exports", () => ({ saveFile: () => {} }));

const line = (key: string, description: string) => ({ key, description, unit: "m2", quantity: 12.5, source: "measured", codes: {} });
const data = vi.hoisted(() => ({ lines: [] as unknown[], formats: {} as Record<string, unknown>, shareError: null as unknown, refetch: () => {}, noDetail: false }));
vi.mock("@/api/hooks/shares", () => ({
  publicExport: async () => new Blob(),
  usePublicShare: () => ({
    isError: !!data.shareError,
    error: data.shareError,
    refetch: data.refetch,
    data: { firmName: "F", projectName: "P", boqName: "B", revisionLabel: "A", revisionStatus: "issued", runAt: null, include: { lineDetail: true, excel: false, viewer: false, log: false }, systems: [], modelVersionIds: [], madeWithBadge: false, ...data.formats },
  }),
  usePublicLines: () => ({ data: data.lines }),
  usePublicLine: (_t: string, key: string | null) => ({
    data: key && !data.noDetail ? (data.lines as { key: string }[]).find((l) => l.key === key) : undefined,
    isError: !!key && data.noDetail,
  }),
}));

const { PublicSharePage } = await import("./public-share");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  data.formats = {};
  data.shareError = null;
  data.noDetail = false;
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<PublicSharePage token="t" />));
  return host;
}

describe("TF-158 share page: lines by keyboard", () => {
  it("each line has a focusable control that opens its explanation and takes focus into it", () => {
    data.lines = [line("a", "Wall, exterior"), line("b", "Slab")];
    const page = mount();
    const rows = page.querySelectorAll<HTMLTableRowElement>("[data-testid=share-line]");
    expect(rows).toHaveLength(2);
    const open = rows[1]!.querySelector<HTMLButtonElement>("button");
    expect(open, "a button in the line").not.toBeNull();
    expect(open!.textContent).toBe("Slab");
    expect(open!.getAttribute("aria-expanded")).toBe("false");
    open!.focus();
    expect(document.activeElement).toBe(open);

    act(() => open!.click());
    const detail = page.querySelector("[data-testid=share-detail]");
    expect(detail).not.toBeNull();
    expect(open!.getAttribute("aria-expanded")).toBe("true");
    expect(open!.getAttribute("aria-controls")).toBe(detail!.id);
    expect(detail!.contains(document.activeElement), "focus moves into the detail").toBe(true);

    // Closing it returns focus to the line that opened it.
    const close = detail!.querySelector<HTMLButtonElement>(`button[aria-label="${shares.public.close}"]`)!;
    act(() => close.click());
    expect(page.querySelector("[data-testid=share-detail]")).toBeNull();
    expect(document.activeElement).toBe(page.querySelectorAll("[data-testid=share-line]")[1]!.querySelector("button"));
  });
});

describe("review C-25 share page: settings and models by name, never an id", () => {
  it("the line detail gets the run's setting labels and model names, and no formula as written; the viewer names models", () => {
    data.lines = [line("a", "Wall")];
    data.formats = {
      include: { lineDetail: true, viewer: true, excel: false, log: false },
      modelVersionIds: ["9b1c0d6e-0000-4000-8000-000000000001"],
      models: [{ versionId: "9b1c0d6e-0000-4000-8000-000000000001", name: "Duplex_A.ifc" }],
      slots: { wall_recess_mode: { label: "Recesses in walls", type: "choice", optionLabels: { deduct: "Deduct" } } },
    };
    const page = mount();
    act(() => page.querySelector<HTMLButtonElement>("[data-testid=share-line] button")!.click());
    const props = seen.detail as { lex: { slotLabels: Map<string, string> }; slots: Record<string, { label: string }>; modelNames: Map<string, string>; showRawFormula: boolean };
    expect(props.lex.slotLabels.get("wall_recess_mode")).toBe("Recesses in walls");
    expect(props.slots.wall_recess_mode!.label).toBe("Recesses in walls");
    expect(props.modelNames.get("9b1c0d6e-0000-4000-8000-000000000001")).toBe("Duplex_A.ifc");
    expect(props.showRawFormula).toBe(false);
    expect((seen.viewer as { models: { label: string }[] }).models.map((m) => m.label)).toEqual(["Duplex_A.ifc"]);
  });

  it("a model without a name is numbered", () => {
    data.lines = [line("a", "Wall")];
    data.formats = { include: { lineDetail: true, viewer: true, excel: false, log: false }, modelVersionIds: ["m1"], models: [] };
    mount();
    expect((seen.viewer as { models: { label: string }[] }).models.map((m) => m.label)).toEqual([shares.public.viewerModel.replace("{n}", "1")]);
  });
});

describe("review C-26 share sheet: numbers, marks, phone-safe quantities, large sheets", () => {
  it("each line shows its position number and its mark; a line to confirm without a quantity says so; a legend explains the marks", () => {
    data.lines = [
      { ...line("a", "Wall"), positionNo: "B.02.1" },
      { ...line("b", "Slab"), positionNo: "B.02.2", source: "flagged", quantity: null },
      { ...line("c", "Skirting"), positionNo: "B.02.3", source: "derived" },
    ];
    const page = mount();
    const rows = [...page.querySelectorAll("[data-testid=share-line]")];
    expect(rows.map((r) => r.querySelector("[data-testid=share-position]")!.textContent)).toEqual(["B.02.1", "B.02.2", "B.02.3"]);
    expect(rows.map((r) => r.querySelector("[data-testid=status-mark]")?.getAttribute("data-mark") ?? null)).toEqual([null, "flagged", "derived"]);
    expect(rows[1]!.querySelector("[data-testid=share-to-confirm]")!.textContent).toBe(shares.public.toConfirm);
    expect(rows[0]!.querySelector("[data-testid=share-to-confirm]")).toBeNull();
    expect(page.querySelector("[data-testid=share-legend]")!.textContent).toContain(shares.public.legend.flagged);
  });

  it("no legend when every line is measured; the quantity cell wraps, the number doesn't", () => {
    data.lines = [{ ...line("a", "Wall"), overridden: { fields: ["quantity"], quantity: 12.5, engineQuantity: 44.91 } }];
    const page = mount();
    expect(page.querySelector("[data-testid=share-legend]")).toBeNull();
    const cell = page.querySelector("[data-testid=share-quantity]")!;
    expect(cell.className).toContain("whitespace-normal");
    expect(cell.className).not.toContain("whitespace-nowrap");
    expect(cell.querySelector("span")!.className).toContain("whitespace-nowrap");
    expect(cell.querySelector("[data-testid=share-edited]")).not.toBeNull();
  });

  it("above 500 lines only the rows near the window are drawn", () => {
    // jsdom lays nothing out: every element measures as a 41 px row.
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(41);
    onTestFinished(() => height.mockRestore());
    data.lines = Array.from({ length: 800 }, (_, i) => line(`k${i}`, `Line ${i}`));
    const page = mount();
    expect(page.querySelector("[data-testid=share-sheet]")!.getAttribute("data-virtual")).toBe("true");
    const drawn = page.querySelectorAll("[data-testid=share-line]").length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(200);
  });

  it("at 500 lines or fewer every row is drawn", () => {
    data.lines = Array.from({ length: 500 }, (_, i) => line(`k${i}`, `Line ${i}`));
    const page = mount();
    expect(page.querySelector("[data-testid=share-sheet]")!.getAttribute("data-virtual")).toBe("false");
    expect(page.querySelectorAll("[data-testid=share-line]")).toHaveLength(500);
  });
});

describe("review C-27 share page: header, working version, edit marks off", () => {
  it("the header has the wordmark, a colour block and the BoQ in display type", () => {
    data.lines = [line("a", "Wall")];
    const page = mount();
    const header = page.querySelector("[data-testid=share-header]")!;
    expect(header.querySelector("[data-testid=wordmark]"), "the wordmark").not.toBeNull();
    expect(header.querySelector("[aria-hidden][class*=aspect-square]"), "the poster block").not.toBeNull();
    expect(page.querySelector("[data-testid=share-title]")!.className).toContain("display");
  });

  it("a working version says so above the sheet, with no watermark over the page", () => {
    data.lines = [line("a", "Wall")];
    data.formats = { revisionStatus: "draft" };
    const page = mount();
    expect(page.querySelector("[data-testid=share-working]")!.textContent).toContain(shares.public.workingBanner);
    expect(page.querySelector(".fixed"), "no fixed watermark layer").toBeNull();
    data.formats = {};
  });

  it("a saved version has no working note", () => {
    data.lines = [line("a", "Wall")];
    const page = mount();
    expect(page.querySelector("[data-testid=share-working]")).toBeNull();
  });

  it("a line the link doesn't explain opens with a note instead of the calculation", () => {
    data.lines = [line("a", "Wall")];
    data.noDetail = true;
    const page = mount();
    act(() => page.querySelector<HTMLButtonElement>("[data-testid=share-line] button")!.click());
    const detail = page.querySelector("[data-testid=share-detail]")!;
    expect(detail.querySelector("[data-testid=share-no-detail]")!.textContent).toBe(shares.public.noDetail);
    expect(detail.querySelector("h2")!.textContent).toBe("Wall");
    expect(detail.querySelector("[data-testid=detail-body]")).toBeNull();
  });
});

describe("TF-021 share page: the firm's number format", () => {
  it("shows quantities with the separators the share carries", () => {
    data.lines = [{ ...line("a", "Wall"), quantity: 12450.75 }];
    data.formats = { numberFormat: { decimal: ",", thousands: "." } };
    const page = mount();
    expect(page.querySelector("[data-testid=share-line] td:last-child")!.textContent).toBe("12.450,75");
  });

  it("without them, the defaults (narrow no-break space, the locale's decimal mark)", () => {
    data.lines = [{ ...line("a", "Wall"), quantity: 12450.75 }];
    const page = mount();
    expect(page.querySelector("[data-testid=share-line] td:last-child")!.textContent).toBe("12 450.75");
  });
});

describe("TF-017 share page: an error that isn't the link's", () => {
  it("a link that is gone (404) says so", () => {
    data.shareError = new ApiError(404, "not_found", "");
    const page = mount();
    expect(page.querySelector("[data-testid=share-gone]")).not.toBeNull();
  });

  it("a network or server error offers a retry instead of 'no longer available'", () => {
    data.shareError = ApiError.network(new TypeError("Failed to fetch"));
    data.refetch = vi.fn();
    const page = mount();
    expect(page.querySelector("[data-testid=share-gone]")).toBeNull();
    expect(page.textContent).toContain(errors.network);
    act(() => page.querySelector<HTMLButtonElement>("[data-testid=inline-error-retry]")!.click());
    expect(data.refetch).toHaveBeenCalled();
  });
});
