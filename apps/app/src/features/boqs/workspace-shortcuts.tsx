"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** The sheet's grid, the target of "Skip to the sheet" and `g s`. */
export const SHEET_GRID_ID = "sheet-grid";

/** A `g s` that opened the Sheet tab: the grid takes focus when it mounts. */
let gridFocusRequested = false;

/** Called by the grid once it is on the page: true once after `g s` from another tab. */
export function takeGridFocusRequest(): boolean {
  const asked = gridFocusRequested;
  gridFocusRequested = false;
  return asked;
}

/** The keys the workspace knows, in the order the help lists them (catalogue keys under `boqs.shortcuts.keys`). */
const KEYS = ["search", "palette", "lines", "cells", "edit", "tick", "tickAll", "undo", "close", "goSheet", "goQuestions", "help"] as const;

/** Typing in a field or working in a dialog: the workspace's letter keys stay out of the way. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=listbox]");
}

/**
 * Workspace keyboard shortcuts (review C-04): `g s` goes to the sheet and focuses its grid, `g q` to the Questions tab,
 * `?` lists every key of the workspace. Letters are ignored while typing or in a dialog.
 */
export function WorkspaceShortcuts({ hrefOf, sheetOpen }: { hrefOf: (tab: string) => string; sheetOpen: boolean }) {
  const t = useTranslations("boqs.shortcuts");
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const pendingG = useRef(0);
  const live = useRef({ hrefOf, sheetOpen });
  useEffect(() => {
    live.current = { hrefOf, sheetOpen };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
        return;
      }
      const now = performance.now();
      if (e.key === "g") {
        pendingG.current = now;
        return;
      }
      if (now - pendingG.current > 1500) return;
      pendingG.current = 0;
      if (e.key === "s") {
        e.preventDefault();
        if (live.current.sheetOpen) document.getElementById(SHEET_GRID_ID)?.focus();
        else {
          gridFocusRequested = true;
          router.push(live.current.hrefOf("sheet"));
        }
      } else if (e.key === "q") {
        e.preventDefault();
        router.push(live.current.hrefOf("questions"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent data-testid="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {KEYS.map((k) => (
            <div key={k} className="contents">
              <dt className="font-mono whitespace-nowrap">{t(`keys.${k}.key`)}</dt>
              <dd className="text-muted-foreground">{t(`keys.${k}.does`)}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
