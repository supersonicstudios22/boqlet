import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DimensionRule } from "@/components/dimension-rule";
import { APP_NAME } from "@/config";
import { cn } from "@/lib/utils";
import { AnimatedWordmark } from "./animated-wordmark";
import { Wordmark } from "./wordmark";
import styles from "./auth-split.module.css";

const delay = (seconds: number) => ({ "--delay": `${seconds}s` }) as CSSProperties;

/**
 * The sign-in pages (sign-in, sign-up, password reset, invitations, the takeover question): the form on
 * paper on one half, and on the other an ink poster with the logo animation (design-guidelines.md "The
 * poster language"). Below `lg` only the form shows. The pages render their own `<main>` inside.
 */
export function AuthSplit({ children }: { children: ReactNode }) {
  const t = useTranslations("auth.split");
  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col px-6 py-6 sm:px-12 lg:px-16">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label={t("home", { appName: APP_NAME })}>
            <Wordmark className="text-[24px]" />
          </Link>
          {/* Below `lg` the poster half is hidden: its four shapes stay, small, beside the logo. */}
          <div className="flex items-center gap-1.5 lg:hidden" aria-hidden>
            <span className="size-4 rounded-[var(--radius-shape)] bg-[var(--data-blue)]" />
            <span className="size-4 rounded-full bg-[var(--data-orange)]" />
            <span className="size-4 rounded-[var(--radius-shape)] rounded-tl-full bg-[var(--data-yellow)]" />
            <svg viewBox="0 0 16 16" className="size-4 text-[var(--data-red)]">
              <polygon points="2,14 8,2.5 14,14" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-center py-12">
          <div className="mx-auto flex w-full max-w-md flex-col gap-6">{children}</div>
        </div>
      </div>
      <AuthPoster label={t("label")} title={t("title")} measure={t("measure")} />
    </div>
  );
}

/** The decorative half: hidden from assistive tech, the logo's name is already on the page. */
function AuthPoster({ label, title, measure }: { label: string; title: string; measure: string }) {
  return (
    <div className={cn("dark", styles.panel, "hidden lg:flex lg:flex-col")} aria-hidden>
      <div className="relative z-10 flex flex-col gap-8 p-16 xl:p-20">
        <p className="label-caps text-muted-foreground">{label}</p>
        <AnimatedWordmark className="w-full max-w-[480px]" />
        <p className="display max-w-[16ch] text-[clamp(32px,3.2vw,48px)] leading-none">{title}</p>
        {/* Drawn once "boqlet" has settled (the animation's 3.97 s). */}
        <div className={cn("max-w-[320px]", styles.rise)} style={delay(3.9)}>
          <DimensionRule label={measure} labelClassName="font-semibold" lineClassName={styles.drawX} />
        </div>
      </div>
      {/* The shapes arrive while the logo plays, so the panel is never empty. */}
      <div className={styles.shapes}>
        <div className={cn(styles.shape, "rounded-[var(--radius-shape)]", styles.rise, "top-0 left-0 h-[58%] w-[58%] bg-[var(--data-blue)]")} style={delay(0.2)} />
        <div className={cn(styles.shape, "rounded-[var(--radius-shape)]", styles.rise, "top-0 right-[10%] h-[28%] w-[28%] rounded-tl-full bg-[var(--data-yellow)]")} style={delay(0.4)} />
        <div className={cn(styles.shape, "rounded-[var(--radius-shape)]", styles.rise, "top-[40%] left-[38%] h-[48%] w-[48%] rounded-full bg-[var(--data-orange)]")} style={delay(0.6)} />
        <svg viewBox="0 0 100 100" className={cn(styles.rise, "absolute bottom-[10%] left-[6%] h-[30%] w-[30%] text-[var(--data-red)]")} style={delay(0.8)}>
          <polygon points="6,94 50,8 94,94" fill="currentColor" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
