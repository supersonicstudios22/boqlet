import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/config";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { OrgSwitcher } from "@/features/orgs/org-switcher";
import { LeftNav } from "./left-nav";
import { NavMenu } from "./nav-menu";
import { ThemeSwitch } from "./theme-switch";
import { UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

/**
 * The chrome of every `/{org}` route: a top bar with the wordmark, the org switcher, the
 * notifications bell (FE-018), the theme switch and the user menu (search joins in FE-034), and the
 * left navigation.
 */
export async function AppShell({ org, children }: { org: string; children: ReactNode }) {
  const t = await getTranslations("shell");
  return (
    <div className="grid min-h-dvh grid-cols-1 grid-rows-[48px_1fr] lg:grid-cols-[208px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-1 focus:left-2 focus:z-50 focus:inline-flex focus:min-h-10 focus:items-center focus:border focus:border-border focus:bg-background focus:px-3 focus:shadow-sm"
      >
        {t("skipToContent")}
      </a>
      {/* More skip links from the page in view, right after the first ("Skip to the sheet", review C-04). */}
      <div id="skip-links" className="contents" />
      {/* Sticky: the top bar stays in view on every page that scrolls (review C-01). */}
      <header className="sticky top-0 z-30 flex min-w-0 items-center gap-4 border-b border-border bg-background px-4 lg:col-span-2">
        <NavMenu org={org} />
        <Link href={`/${org}`} aria-label={t("home", { appName: APP_NAME })} data-testid="wordmark">
          <Wordmark />
        </Link>
        <span className="h-5 w-px bg-border" aria-hidden />
        <OrgSwitcher />
        <div className="flex-1" />
        <NotificationBell />
        <ThemeSwitch />
        <UserMenu />
      </header>
      <aside className="hidden border-r border-border lg:block">
        <LeftNav org={org} />
      </aside>
      {/*
        A page that holds a workspace filling the screen (the BoQ sheet, `data-workspace-fill`) gets a main exactly
        the viewport's height under the top bar, so its grid is the one scroll container (review C-01). Every other
        page scrolls the document as before.
      */}
      <main
        id="main"
        className="min-w-0 px-4 py-6 lg:px-8 has-[[data-workspace-fill]]:flex has-[[data-workspace-fill]]:h-[calc(100dvh-48px)] has-[[data-workspace-fill]]:flex-col has-[[data-workspace-fill]]:overflow-y-auto has-[[data-workspace-fill]]:pt-2 has-[[data-workspace-fill]]:pb-1 lg:has-[[data-workspace-fill]]:px-6"
      >
        {children}
      </main>
    </div>
  );
}
