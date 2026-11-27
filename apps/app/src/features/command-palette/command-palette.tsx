"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOrgSearch, type SearchHit } from "@/api/hooks/search";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOrg } from "@/features/orgs/org-context";
import { cn } from "@/lib/utils";
import { byMatch, commandsSnapshot, noCommands, subscribeCommands } from "./commands";

/** The groups in the order the list shows them: what can be done here, what the search found, then pages. */
const GROUPS = ["actions", "project", "boq", "model", "preset", "pages"] as const;
type Group = (typeof GROUPS)[number];

interface Option {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  disabled?: boolean;
  href?: string;
  run?: () => void;
}

/** The settings pages and the person's own, by their path under the org (or the app, for account and notifications). */
const PAGES = [
  ["dashboard", ""],
  ["projects", "/projects"],
  ["newProject", "/projects/new"],
  ["library", "/library"],
  ["general", "/settings/general"],
  ["members", "/settings/members"],
  ["billing", "/settings/billing"],
  ["usage", "/settings/usage"],
  ["shares", "/settings/shares"],
  ["audit", "/settings/audit"],
  ["account", "~/account"],
  ["notifications", "~/notifications"],
] as const;

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const noSubscribe = () => () => {};

/**
 * The command palette and global search (review C-09, DEC-75): ⌘K / Ctrl+K or the top bar's search field opens it;
 * typing finds projects, BoQs, models and presets by name across the org — only those the person can open, the server
 * decides (`GET /orgs/{orgId}/search`) — the actions of the page in view ("Generate again", "Export Excel", "Go to
 * questions") and the settings pages. Arrows move, Enter opens, Esc closes.
 */
export function CommandPalette() {
  const t = useTranslations("shell.palette");
  const { org } = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  // The highlighted option, by its place in the list; -1: the first one that can be chosen (after each keystroke).
  const [active, setActive] = useState(-1);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const mac = useSyncExternalStore(noSubscribe, isMac, () => false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const search = useOrgSearch(open ? org.id : undefined, debounced);
  const commands = useSyncExternalStore(subscribeCommands, commandsSnapshot, noCommands);
  const base = `/${org.slug}`;
  const hrefOf = (hit: SearchHit) =>
    hit.kind === "project"
      ? `${base}/projects/${hit.id}`
      : hit.kind === "boq"
        ? `${base}/projects/${hit.projectId}/boqs/${hit.id}`
        : hit.kind === "model"
          ? `${base}/projects/${hit.projectId}/models/${hit.id}`
          : `${base}/library/${hit.presetKind}/${hit.id}`;
  const hits = debounced.trim() && q.trim() ? (search.data ?? []) : [];
  const options: Option[] = [
    ...byMatch(commands, q).map((c) => ({ id: `cmd:${c.id}`, group: "actions" as const, label: c.label, hint: c.disabledReason, disabled: !!c.disabledReason, run: c.run })),
    ...hits.map((h) => ({
      id: `${h.kind}:${h.id}`,
      group: h.kind,
      label: h.name,
      hint: h.kind === "boq" || h.kind === "model" ? t("inProject", { project: h.projectName ?? "" }) : h.kind === "preset" && h.presetKind ? t(`presetKinds.${h.presetKind}`) : h.archived ? t("archived") : undefined,
      href: hrefOf(h),
    })),
    ...byMatch(
      PAGES.map(([key, path]) => ({ key, path, label: t(`pages.${key}`) })),
      q,
    ).map((p) => ({ id: `page:${p.key}`, group: "pages" as const, label: p.label, href: p.path.startsWith("~") ? p.path.slice(1) : base + p.path })),
  ];
  const ordered = GROUPS.flatMap((g) => options.filter((o) => o.group === g));
  const enabled = ordered.flatMap((o, i) => (o.disabled ? [] : [i]));
  const current = active >= 0 && active < ordered.length && !ordered[active]!.disabled ? active : (enabled[0] ?? -1);

  const close = () => {
    setOpen(false);
    setQ("");
    setDebounced("");
    setActive(-1);
  };
  const choose = (o: Option | undefined) => {
    if (!o || o.disabled) return;
    close();
    if (o.href) router.push(o.href);
    else o.run?.();
  };
  const move = (by: number) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(current);
    const next = at < 0 ? (by > 0 ? 0 : enabled.length - 1) : (at + by + enabled.length) % enabled.length;
    setActive(enabled[next]!);
  };
  const activeId = current >= 0 ? `${listId}-${current}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  const shortcut = mac ? "⌘K" : "Ctrl+K";
  const groupLabels = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g, t(`groups.${g}`)])) as Record<Group, string>, [t]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-8 min-w-0 items-center gap-2 rounded-[var(--radius)] border border-border px-2 text-muted-foreground hover:text-foreground md:w-64"
        data-testid="palette-open"
      >
        <Search aria-hidden className="size-3.5 shrink-0" />
        <span className="hidden truncate md:inline">{t("open")}</span>
        <span className="sr-only md:hidden">{t("open")}</span>
        <kbd className="label-caps ml-auto hidden rounded-[var(--radius)] border border-border px-1 md:inline">{shortcut}</kbd>
      </button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="top-24 translate-y-0 gap-0 p-0 sm:max-w-xl" showCloseButton={false} initialFocus={input} data-testid="palette">
          <DialogTitle className="sr-only">{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("description", { key: shortcut })}</DialogDescription>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={input}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label={t("title")}
              value={q}
              maxLength={200}
              placeholder={t("placeholder")}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(e.key === "ArrowDown" ? 1 : -1);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(current >= 0 ? ordered[current] : undefined);
                }
              }}
              className="h-11 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              data-testid="palette-input"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1">
            <ul id={listId} role="listbox" aria-label={t("results")} data-testid="palette-list" aria-busy={search.isFetching}>
              {ordered.map((o, i) => {
                const first = i === 0 || ordered[i - 1]!.group !== o.group;
                return (
                  <li key={o.id} role="presentation">
                    {first && (
                      <div role="presentation" className="label-caps px-2 pt-2 pb-1 text-muted-foreground">
                        {groupLabels[o.group]}
                      </div>
                    )}
                    <div
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === current}
                      aria-disabled={o.disabled || undefined}
                      onMouseMove={() => !o.disabled && setActive(i)}
                      onClick={() => choose(o)}
                      className={cn("flex cursor-pointer items-baseline gap-2 rounded-[var(--radius)] px-2 py-1.5", i === current && "bg-[var(--selection)]", o.disabled && "cursor-default text-muted-foreground")}
                      data-testid="palette-option"
                      data-kind={o.group}
                      data-id={o.id}
                    >
                      <span className="min-w-0 truncate">{o.label}</span>
                      {o.hint && <span className="min-w-0 shrink truncate text-muted-foreground">{o.hint}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {ordered.length === 0 && (
              <p className="px-2 py-3 text-muted-foreground" role="status" data-testid="palette-empty">
                {search.isFetching ? t("searching") : t("empty", { q: q.trim() })}
              </p>
            )}
            {search.isError && (
              <p className="px-2 py-2 text-error" role="alert">
                {t("error")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
