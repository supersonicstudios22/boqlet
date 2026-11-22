// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import common from "../../../messages/en/common.json";
import errors from "../../../messages/en/errors.json";
import projects from "../../../messages/en/projects.json";
import models from "../../../messages/en/models.json";
import boqs from "../../../messages/en/boqs.json";
import { ApiError } from "@/api/errors";

/**
 * Loading and error states (screens.md): a project's overview says neither "No models yet" while
 * loading nor on an error (TF-018); a project that can't be loaded offers a retry instead of an
 * endless busy box (TF-019); the shared inline error retries (TF-017).
 */

vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  const messages = { common, errors, projects, models, boqs };
  return { useTranslations: (namespace?: string) => createTranslator({ locale: "en", messages: messages as never, namespace: namespace as never }) };
});
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/ui/button", () => ({
  // variant and size are styling only
  Button: (props: Record<string, unknown>) => <button {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== "variant" && k !== "size"))} />,
}));
vi.mock("@/components/dimension-rule", () => ({ DimensionRule: () => null }));
vi.mock("@/features/projects/activity-list", () => ({ ActivityList: () => null }));
vi.mock("@/extensions", () => ({ extensions: () => [] }));
vi.mock("@/features/orgs/org-context", () => ({ useOrg: () => ({ org: { slug: "acme" } }) }));

type Q = { data?: unknown; isPending: boolean; isError: boolean; error: unknown; refetch: () => void };
const state = vi.hoisted(() => ({ models: null as unknown, boqs: null as unknown, project: null as unknown }));
vi.mock("@/api/hooks/models", () => ({ useModels: () => state.models }));
vi.mock("@/api/hooks/boqs", () => ({ useBoqs: () => state.boqs }));
vi.mock("@/api/hooks/projects", () => ({ useProject: () => state.project }));

const { default: Overview } = await import("../../../app/(app)/[org]/projects/[projectId]/page");
const { ProjectProvider, useOptionalProjectScope } = await import("./project-context");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});
function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
const pending = (): Q => ({ isPending: true, isError: false, error: null, refetch: vi.fn() });
const failed = (): Q => ({ isPending: false, isError: true, error: new ApiError(500, "internal", "boom"), refetch: vi.fn() });
const project = { id: "p1", name: "P", permissions: {} };

/** The overview inside a project scope (the scope's own loading is tested below). */
function InScope({ children }: { children: ReactNode }) {
  return <ProjectProvider projectId="p1">{children}</ProjectProvider>;
}

describe("TF-018 project overview", () => {
  it("shows loading, not 'No models yet', while the lists load", () => {
    state.project = { data: project, isPending: false, isError: false, error: null, refetch: vi.fn() };
    state.models = pending();
    state.boqs = pending();
    const page = mount(<InScope><Overview /></InScope>);
    expect(page.textContent).not.toContain(projects.overview.noModels);
    expect(page.textContent).not.toContain(projects.overview.noBoqs);
    expect(page.querySelectorAll("[data-testid=loading]")).toHaveLength(2);
  });

  it("shows the error with a retry, not 'No models yet', when a list fails", () => {
    state.project = { data: project, isPending: false, isError: false, error: null, refetch: vi.fn() };
    state.models = failed();
    state.boqs = { data: [], isPending: false, isError: false, error: null, refetch: vi.fn() };
    const page = mount(<InScope><Overview /></InScope>);
    expect(page.textContent).not.toContain(projects.overview.noModels);
    const retry = page.querySelector<HTMLButtonElement>("[data-testid=inline-error-retry]")!;
    expect(retry.textContent).toBe(common.retry);
    act(() => retry.click());
    expect((state.models as Q).refetch).toHaveBeenCalled();
  });
});

describe("TF-019 project scope", () => {
  it("a project that fails to load says so and retries, instead of loading forever", () => {
    state.project = failed();
    const rendered = vi.fn();
    function Child() {
      rendered(useOptionalProjectScope());
      return null;
    }
    const page = mount(<ProjectProvider projectId="p1"><Child /></ProjectProvider>);
    expect(rendered).not.toHaveBeenCalled();
    expect(page.querySelector("[aria-busy=true]")).toBeNull();
    expect(page.querySelector("[data-testid=inline-error]")).not.toBeNull();
    act(() => page.querySelector<HTMLButtonElement>("[data-testid=inline-error-retry]")!.click());
    expect((state.project as Q).refetch).toHaveBeenCalled();
  });
});
