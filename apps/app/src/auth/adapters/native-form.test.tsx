// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import auth from "../../../messages/en/auth.json";
import errors from "../../../messages/en/errors.json";

/**
 * TF-113 (F01 §10, S31): when the account is open elsewhere, the sign-in form says where and since when,
 * and offers Cancel next to "End the other session and sign in". TF-188: the submit waits for React.
 */
vi.mock("next-intl", async () => {
  const { createTranslator } = await import("use-intl/core");
  return {
    useTranslations: (namespace: string) => createTranslator({ locale: "en", messages: { auth, errors } as never, namespace: namespace as never }),
  };
});
vi.mock("@/i18n/use-relative-time", () => ({ useRelativeTime: () => () => "5 minutes ago" }));
let search = "email=ada%40example.test";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/shell/wordmark", () => ({ Wordmark: () => null }));
vi.mock("@/components/ui/button", () => ({
  // variant and size are styling only
  Button: (props: Record<string, unknown>) => <button {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== "variant" && k !== "size"))} />,
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: Record<string, unknown>) => <input {...props} /> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  search = "email=ada%40example.test";
});

describe("native sign-in form", () => {
  it("TF-113: the takeover question names the device and when it was last active, with Cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/auth/sign-in")
          ? Response.json({ code: "session_active", message: "Another session is active.", activeSession: { id: "s", status: "active", deviceLabel: "Firefox on Windows", lastSeenAt: "2026-11-22T10:00:00Z" } }, { status: 409 })
          : new Response("{}", { status: 401 }),
      ),
    );
    const { nativeAuthAdapter } = await import("./native");
    const Page = nativeAuthAdapter.SignInPage!;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Page />));
    const submit = host.querySelector<HTMLButtonElement>("[data-testid=auth-submit]")!;
    expect(submit.disabled).toBe(false);
    host.querySelector<HTMLInputElement>('input[name="password"]')!.value = "a long password for the test";
    await act(async () => submit.form!.requestSubmit());
    const question = host.querySelector("[data-testid=takeover-question]")!;
    expect(question.textContent).toContain("You're signed in on Firefox on Windows, last active 5 minutes ago.");
    expect(submit.textContent).toBe(auth.native.takeover);
    act(() => host.querySelector<HTMLButtonElement>("[data-testid=takeover-cancel]")!.click());
    expect(host.querySelector("[data-testid=takeover-question]")).toBeNull();
    expect(submit.textContent).toBe(auth.native.signIn);
    host.remove();
  });

  it("C-28: the set-password form names the link's address, checks the length in words, and signs in", async () => {
    search = `token=${"t".repeat(43)}`;
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
        if (String(url).endsWith("/auth/setup-link")) return Response.json({ email: "new@example.test", purpose: "setup" });
        if (String(url).endsWith("/auth/set-password")) return Response.json({ id: "s", status: "active" }, { status: 201 });
        return new Response("{}", { status: 401 });
      }),
    );
    const { nativeAuthAdapter } = await import("./native");
    const Page = nativeAuthAdapter.SignUpPage!;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Page />));
    expect(host.querySelector("[data-testid=link-email]")!.textContent).toBe("For new@example.test");
    const form = host.querySelector("form")!;
    expect(form.noValidate).toBe(true);
    expect(host.querySelector("[data-testid=password-rule]")!.textContent).toBe("0 / 15 characters: use at least 15.");

    const password = host.querySelector<HTMLInputElement>('input[name="password"]')!;
    password.value = "too short";
    await act(async () => form.requestSubmit());
    expect(host.querySelector("[data-testid=password-rule]")!.textContent)
      .toBe("The password needs at least 15 characters; this one has 9.");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((c) => c.url.endsWith("/auth/set-password"))).toBe(false);

    password.value = "a long enough password";
    await act(async () => form.requestSubmit());
    const sent = calls.find((c) => c.url.endsWith("/auth/set-password"))!;
    expect(sent.body).toMatchObject({ token: "t".repeat(43), password: "a long enough password", signIn: true });
    host.remove();
  });
});
