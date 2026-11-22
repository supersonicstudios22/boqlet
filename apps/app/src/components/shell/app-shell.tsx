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
      <header className="flex min-w-0 items-center gap-4 border-b border-border px-4 lg:col-span-2">
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
      <main id="main" className="min-w-0 px-4 py-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
