import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DimensionRule } from "@/components/dimension-rule";
import { AnimatedWordmark } from "@/components/shell/animated-wordmark";
import { Wordmark } from "@/components/shell/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { APP_NAME } from "@/config";
import { cn } from "@/lib/utils";
import { LandingMotion } from "./landing-motion";
import styles from "./landing.module.css";

/** Where "Request access" goes: the sign-up page (public sign-up, P57; while it is closed, it says how accounts are made). */
export const REQUEST_ACCESS_HREF = "/sign-up";
const SIGN_IN_HREF = "/sign-in";

/** A stagger step for the draw-in (landing.module.css reads `--delay`). */
const delay = (seconds: number) => ({ "--delay": `${seconds}s` }) as CSSProperties;

/**
 * The public landing page at `/` (P58): what boqlet is, then how it works, for people who have never seen
 * the app. Design "A · Running dimension" (the owner's canvas), rebuilt on the app's tokens and parts.
 * Server-rendered; `LandingMotion` is the only client code.
 */
export function LandingPage() {
  return (
    <div className={styles.page} data-landing>
      <LandingMotion />
      <Header />
      <main id="main" className={styles.frame}>
        <div className={styles.rail} aria-hidden />
        <div className={styles.railStart} aria-hidden />
        <Hero />
        <WhatItIs />
        <HowItWorks />
        <HowItIsCalculated />
        <GeneralNotes />
        <RequestAccess />
      </main>
      <Footer year={new Date().getFullYear()} />
    </div>
  );
}

function Header() {
  const t = useTranslations("landing.nav");
  return (
    <header className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-[clamp(20px,4vw,48px)] py-5">
      <Link href="/" aria-label={t("home", { appName: APP_NAME })} className="block">
        <Wordmark className="text-[24px] sm:text-[31px]" />
      </Link>
      <nav aria-label={t("label")} className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <a href="#what" className="hidden text-foreground hover:text-link min-[721px]:inline">
          {t("what")}
        </a>
        <a href="#how" className="hidden text-foreground hover:text-link min-[721px]:inline">
          {t("how")}
        </a>
        <Link href={SIGN_IN_HREF} className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")} data-testid="landing-sign-in">
          {t("signIn")}
        </Link>
        <Link href={REQUEST_ACCESS_HREF} className={cn(buttonVariants(), "hidden h-10 px-4 min-[480px]:inline-flex")}>
          {t("requestAccess")}
        </Link>
      </nav>
    </header>
  );
}

/** A section's tick and label on the rail. The hero has neither a tick (the rail starts there) nor the draw-in. */
function RailMarks({ label, hero = false }: { label: string; hero?: boolean }) {
  return (
    <>
      {!hero && <div className={styles.tick} aria-hidden />}
      <div className={cn(styles.railLabel, !hero && styles.rise, "label-caps")} aria-hidden>
        {label}
      </div>
    </>
  );
}

function SectionHead({ label, title, titleClass, children }: { label: string; title: string; titleClass: string | undefined; children?: ReactNode }) {
  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <p className="label-caps text-muted-foreground">{label}</p>
      <h2 className={cn(styles.display, titleClass)}>{title}</h2>
      {children}
    </div>
  );
}

function Hero() {
  const t = useTranslations("landing");
  return (
    <section className={cn(styles.section, styles.hero)} aria-labelledby="landing-title">
      <RailMarks label={t("rail.s0")} hero />
      <div className="flex flex-wrap items-center gap-[clamp(40px,6vw,80px)]">
        <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-7">
          <p className="label-caps text-muted-foreground">{t("hero.label")}</p>
          <AnimatedWordmark className="w-full max-w-[560px]" />
          <h1 id="landing-title" className={cn(styles.display, styles.h1)}>
            {t("hero.title")}
          </h1>
          <p className={cn(styles.lead, "max-w-[54ch]")}>{t("hero.lead")}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={REQUEST_ACCESS_HREF} className={cn(buttonVariants(), "h-12 px-[22px] text-[14px]")}>
              {t("nav.requestAccess")}
            </Link>
            <a href="#how" className={cn(buttonVariants({ variant: "outline" }), "h-12 px-[22px] text-[14px]")}>
              {t("hero.seeHow")}
            </a>
          </div>
        </div>
        <HeroPoster area={t("hero.area")} elements={t("hero.elements")} />
      </div>
    </section>
  );
}

function HeroPoster({ area, elements }: { area: string; elements: string }) {
  return (
    <div className={cn(styles.heroPoster, "max-w-[460px] min-w-[260px] flex-[1_1_340px]")} aria-hidden>
      <div className={styles.poster}>
        <DimensionRule
          label={area}
          labelClassName="font-semibold"
          lineClassName={styles.heroDrawX}
          className="absolute top-[-36px] left-0 w-[62%]"
        />
        <div className="absolute top-0 left-[-32px] h-[62%]">
          <DimensionRule vertical label={elements} labelClassName="label-caps" lineClassName={styles.heroDrawY} />
        </div>
        <div className={cn(styles.shape, "rounded-[var(--radius-shape)]", "top-0 left-0 h-[62%] w-[62%] bg-[var(--data-blue)]")} />
        <div className={cn(styles.shape, "rounded-[var(--radius-shape)]", "top-0 right-0 h-[30%] w-[30%] rounded-tl-full bg-[var(--data-yellow)]")} />
        <div className={cn(styles.shape, "rounded-[var(--radius-shape)]", styles.blend, "top-[42%] left-[40%] h-[54%] w-[54%] rounded-full bg-[var(--data-red)]")} />
        <div className={cn(styles.shape, "rounded-[var(--radius-shape)]", "bottom-0 left-0 h-[9%] w-[34%] bg-foreground")} />
        <div className={cn(styles.shape, "rounded-[var(--radius-shape)]", "right-0 bottom-0 h-[22%] w-[22%] bg-[var(--data-orange)]")} />
      </div>
    </div>
  );
}

const WHAT_ITEMS = ["traceable", "asks", "rules", "revisions"] as const;

function WhatItIs() {
  const t = useTranslations("landing");
  return (
    <section id="what" className={cn(styles.section, "flex flex-col gap-10")} data-draw>
      <RailMarks label={t("rail.s1")} />
      <SectionHead label={t("what.label")} title={t("what.title")} titleClass={styles.h2}>
        <p className={styles.lead}>{t("what.lead", { appName: APP_NAME })}</p>
      </SectionHead>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-8">
        {WHAT_ITEMS.map((key, i) => (
          <li key={key} className="flex flex-col gap-2.5">
            <span className={cn(styles.drawX, "block h-0.5 bg-foreground")} style={delay(i * 0.15)} aria-hidden />
            <span className="label-caps text-muted-foreground" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="text-[16px] font-semibold">{t(`what.items.${key}.title`)}</h3>
            <p className="text-muted-foreground">{t(`what.items.${key}.body`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const STEPS = ["upload", "measure", "answer", "excel"] as const;

function StepShape({ index }: { index: number }) {
  if (index === 3)
    return (
      <svg viewBox="0 0 40 40" className="block size-10 text-[var(--data-red)]" aria-hidden>
        <polygon points="3,37 20,4 37,37" fill="currentColor" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      </svg>
    );
  const shape = ["bg-[var(--data-blue)]", "rounded-full bg-[var(--data-orange)]", "rounded-tl-full bg-[var(--data-yellow)]"][index];
  return <div className={cn("size-10 rounded-[var(--radius-shape)]", shape)} aria-hidden />;
}

function HowItWorks() {
  const t = useTranslations("landing");
  return (
    <section id="how" className={cn(styles.section, "flex flex-col gap-10")} data-draw>
      <RailMarks label={t("rail.s2")} />
      <SectionHead label={t("how.label")} title={t("how.title")} titleClass={styles.h2} />
      <div className="relative h-3" aria-hidden>
        <span className={cn(styles.drawX, "absolute top-[5px] right-0 left-0 h-0.5 bg-foreground")} />
        {[0, 25, 50, 75].map((at) => (
          <span key={at} className="absolute top-0 h-3 w-0.5 bg-foreground" style={{ left: `${at}%` }} />
        ))}
        <span className="absolute top-0 right-0 h-3 w-0.5 bg-foreground" />
      </div>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-8">
        {STEPS.map((key, i) => (
          <li key={key} className={cn(styles.rise, "flex flex-col gap-3")} style={delay(0.2 * (i + 1))}>
            <StepShape index={i} />
            <span className="label-caps text-muted-foreground">{t("how.step", { n: String(i + 1).padStart(2, "0") })}</span>
            <h3 className="text-[18px] font-semibold">{t(`how.steps.${key}.title`)}</h3>
            <p className="text-muted-foreground">{t(`how.steps.${key}.body`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

type SheetRow = { code: string; key: "wall" | "footing" | "slab" | "formwork" | "site"; qty: string; unit: "m2" | "m3" | "item"; tag?: "derived" | "toConfirm" };
const SHEET: SheetRow[] = [
  { code: "D.01", key: "wall", qty: "267.16", unit: "m2" },
  { code: "B.01", key: "footing", qty: "16.53", unit: "m3" },
  { code: "B.02", key: "slab", qty: "129.69", unit: "m2" },
  { code: "—", key: "formwork", qty: "153.80", unit: "m2", tag: "derived" },
  { code: "A.01", key: "site", qty: "—", unit: "item", tag: "toConfirm" },
];

function Tag({ kind }: { kind: "derived" | "toConfirm" }) {
  const t = useTranslations("landing.calc");
  return kind === "derived" ? (
    <span className="label-caps inline-flex h-[18px] whitespace-nowrap items-center rounded-[var(--radius)] border border-[var(--status-derived)] px-1 text-[var(--status-derived)]">
      {t("derived")}
    </span>
  ) : (
    <span className="label-caps inline-flex h-[18px] whitespace-nowrap items-center rounded-[var(--radius)] bg-[var(--status-attention)] px-1 text-[var(--on-fill)]">
      {t("toConfirm")}
    </span>
  );
}

function HowItIsCalculated() {
  const t = useTranslations("landing.calc");
  const tr = useTranslations("landing.rail");
  return (
    <section className={cn(styles.section, styles.calcSection, "flex flex-col gap-8")} data-draw>
      <RailMarks label={tr("s3")} />
      <SectionHead label={t("label")} title={t("title")} titleClass={styles.h2} />
      {/* `.dark` scopes the dark tokens inside: an ink panel in the light theme too. */}
      <div className={cn("dark", styles.inkPanel, "flex flex-wrap gap-9 p-[clamp(20px,3vw,36px)]")}>
        <div className="min-w-0 flex-[3_1_460px] overflow-x-auto">
          <table className={styles.sheet}>
            <caption className="sr-only">{t("caption")}</caption>
            <thead>
              <tr>
                <th scope="col" className="label-caps">{t("columns.code")}</th>
                <th scope="col" className="label-caps">{t("columns.description")}</th>
                <th scope="col" className={cn("label-caps", styles.num)}>{t("columns.qty")}</th>
                <th scope="col" className="label-caps">{t("columns.unit")}</th>
                <th scope="col" className="label-caps">{t("columns.source")}</th>
              </tr>
            </thead>
            <tbody>
              {SHEET.map((row, i) => (
                <tr key={row.key} className={i === 0 ? styles.selected : undefined}>
                  <td className="text-muted-foreground">{row.code}</td>
                  <td>{t(`rows.${row.key}`)}</td>
                  <td className={cn(styles.num, i === 0 && "font-semibold")}>{row.qty}</td>
                  <td>{t(`units.${row.unit}`)}</td>
                  <td>{row.tag && <Tag kind={row.tag} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-3.5">
          <p className="label-caps text-muted-foreground">{t("heading")}</p>
          <p className="font-semibold">{t("rows.wall")}</p>
          <dl className="flex flex-col gap-3.5 text-ui">
            {(
              [
                ["gross", "340.575"],
                ["openings", "−73.413"],
                ["rounded", "−0.002"],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt>{t(key)}</dt>
                <dd>{t("amount", { value })}</dd>
              </div>
            ))}
          </dl>
          <DimensionRule
            tone="link"
            label={t("result")}
            labelClassName="display text-[32px] leading-none"
            lineClassName={styles.drawX}
            className="mt-2"
          />
          <p className="text-[12px] text-muted-foreground">{t("formula")}</p>
        </div>
      </div>
      <p className="max-w-[72ch] text-muted-foreground">{t("footnote")}</p>
    </section>
  );
}

const NOTES = ["modelled", "standards", "formats", "draft"] as const;

function GeneralNotes() {
  const t = useTranslations("landing");
  return (
    <section className={cn(styles.section, styles.notesSection, "flex flex-wrap gap-10")} data-draw>
      <RailMarks label={t("rail.s4")} />
      <div className="flex flex-[1_1_300px] flex-col gap-4">
        <p className="label-caps text-muted-foreground">{t("notes.label")}</p>
        <h2 className={cn(styles.display, styles.h2Notes)}>{t("notes.title")}</h2>
      </div>
      <ol className="flex flex-[2_1_460px] flex-col border-t border-foreground">
        {NOTES.map((key, i) => (
          <li key={key} className="flex gap-5 border-b border-border py-3.5">
            <span className="text-muted-foreground" aria-hidden>
              {t("notes.number", { n: i + 1 })}
            </span>
            <span>{t(`notes.items.${key}`)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RequestAccess() {
  const t = useTranslations("landing");
  return (
    <section id="access" className={cn(styles.section, styles.accessSection, "flex flex-col items-start gap-6")} data-draw>
      <RailMarks label={t("rail.s5")} />
      <h2 className={cn(styles.display, styles.h2Final)}>{t("access.title", { appName: APP_NAME })}</h2>
      <p className={cn(styles.lead, "max-w-[54ch]")}>{t("access.body", { appName: APP_NAME })}</p>
      <Link href={REQUEST_ACCESS_HREF} className={cn(buttonVariants(), "h-[52px] px-[26px] text-[15px]")} data-testid="landing-request-access">
        {t("nav.requestAccess")}
      </Link>
      <div className={styles.finalLine} aria-hidden>
        <span className={cn(styles.finalLabel, styles.rise)} style={delay(0.9)}>
          {t("access.lines")}
        </span>
        <span className={cn(styles.finalRule, styles.drawX)} style={delay(0.3)} />
        <span className={styles.finalTick} />
      </div>
    </section>
  );
}

function Footer({ year }: { year: number }) {
  const t = useTranslations("landing.footer");
  const cells = [
    ["drawing", "drawingValue"],
    ["sheet", "sheetValue"],
    ["scale", "scaleValue"],
  ] as const;
  return (
    <footer className="mx-auto flex max-w-[1200px] flex-col gap-4 px-[clamp(20px,4vw,48px)] pb-10">
      <div className={cn(styles.titleBlock, "label-caps")}>
        <div className={styles.titleCell}>
          <Wordmark className="self-start text-[26px]" />
        </div>
        {cells.map(([label, value]) => (
          <div key={label} className={styles.titleCell}>
            <span className="text-muted-foreground">{t(label)}</span>
            <span>{t(value)}</span>
          </div>
        ))}
        <div className={styles.titleCell}>
          <span className="text-muted-foreground">{t("copyright")}</span>
          <span>{t("copyrightValue", { year: String(year), appName: APP_NAME })}</span>
        </div>
      </div>
      <Link href={SIGN_IN_HREF} className="self-start text-link underline-offset-4 hover:underline">
        {t("signIn")}
      </Link>
    </footer>
  );
}
