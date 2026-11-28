// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import settings from "../../../messages/en/settings.json";
import errors from "../../../messages/en/errors.json";

/** TF-098 (F14, F09 §4): a feature the plan doesn't include can't be switched on in General settings. */

vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  return { useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: { settings, errors } as never, namespace: namespace as never }) };
});
vi.mock("@tanstack/react-query", () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, isError: false }), useQueryClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/api/client", () => ({ api: {} }));
vi.mock("@/components/errors/use-error-message", () => ({ useErrorMessage: () => () => "" }));
const plain = (tag: string) => {
  function Plain(props: Record<string, unknown>) {
    const { children, ...rest } = props as { children?: ReactNode };
    const clean = Object.fromEntries(Object.entries(rest).filter(([k]) => !["variant", "size", "render", "nativeButton", "label", "hint", "error"].includes(k)));
    return tag === "input" ? <input {...clean} /> : tag === "select" ? <select {...clean}>{children}</select> : <div {...clean}>{children}</div>;
  }
  return Plain;
};
vi.mock("@/components/field", () => ({ Field: plain("div") }));
vi.mock("@/components/native-select", () => ({ NativeSelect: plain("select") }));
vi.mock("@/components/ui/button", () => ({ Button: plain("div") }));
vi.mock("@/components/ui/input", () => ({ Input: plain("input") }));
// Review C-29: country and currency are pickers (their own test, code-pickers.test.tsx).
vi.mock("@/features/orgs/code-pickers", () => ({ CountryPicker: plain("input"), CurrencyPicker: plain("input") }));
vi.mock("@/components/ui/alert-dialog", () => {
  const D = plain("div");
  return { AlertDialog: D, AlertDialogAction: D, AlertDialogCancel: D, AlertDialogContent: D, AlertDialogDescription: D, AlertDialogFooter: D, AlertDialogHeader: D, AlertDialogTitle: D, AlertDialogTrigger: D };
});
const plan = vi.hoisted(() => ({ limits: {} as Record<string, unknown>, approvalOn: false }));
vi.mock("@/features/orgs/org-context", () => ({
  rememberOrg: vi.fn(),
  useOrg: () => ({ org: { id: "o1", name: "Acme", slug: "acme", settings: { approvalRequired: plan.approvalOn } }, can: () => true }),
}));
vi.mock("@/api/hooks/billing", () => ({ useEntitlements: () => ({ data: { planId: "x", limits: plan.limits, usage: {} } }) }));

const { GeneralSettings } = await import("./general-settings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
function approvalBox() {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(<GeneralSettings />));
  return host.querySelector<HTMLInputElement>("#org-approval")!;
}

describe("TF-098 approval toggle and the plan", () => {
  it("can't be switched on when the plan has no review and approval", () => {
    plan.limits = { approvalWorkflow: false };
    plan.approvalOn = false;
    expect(approvalBox().disabled).toBe(true);
  });
  it("can be switched on when the plan has it", () => {
    plan.limits = { approvalWorkflow: true };
    plan.approvalOn = false;
    expect(approvalBox().disabled).toBe(false);
  });
  it("can still be switched off after a downgrade", () => {
    plan.limits = { approvalWorkflow: false };
    plan.approvalOn = true;
    expect(approvalBox().disabled).toBe(false);
  });
});
