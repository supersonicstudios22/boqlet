"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeftNav } from "./left-nav";

/**
 * Below 1024 px the left navigation folds into this menu, so the work area keeps the width (TF-168,
 * TF-171: at 768 px or 200 % zoom the sheet's Quantity column and the tabs fit).
 */
export function NavMenu({ org }: { org: string }) {
  const t = useTranslations("shell");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // A page change closes it.
  const [at, setAt] = useState(pathname);
  if (at !== pathname) {
    setAt(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="relative lg:hidden">
      <Button variant="ghost" size="icon" aria-label={t("openNav")} aria-expanded={open} aria-controls="nav-menu" onClick={() => setOpen((o) => !o)} data-testid="nav-menu">
        <Menu aria-hidden />
      </Button>
      {open && (
        <div id="nav-menu" className="absolute top-full left-0 z-40 mt-2 w-56 border border-border bg-popover shadow-sm">
          <LeftNav org={org} />
        </div>
      )}
    </div>
  );
}
