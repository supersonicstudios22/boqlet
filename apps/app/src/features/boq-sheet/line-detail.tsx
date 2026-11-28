"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Box, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Param } from "@ifc-boq/types";
import type { Run } from "@/api/hooks/boqs";
import { useLine, useLines, usePresetVersion, type LineDetail } from "@/api/hooks/sheet";
import { Button } from "@/components/ui/button";
import { lexicon, toReadable, type Lexicon } from "@/features/library/lib/readable";
import { cn } from "@/lib/utils";
import { useOrg } from "@/features/orgs/org-context";
import { labelUnits, useEngineMessage } from "@/i18n/engine-message";
import { HowCalculated } from "./how-calculated";
import { SourceTag } from "./source-tag";
import { useUnit } from "@/i18n/units";
import { useBoqFormat } from "@/i18n/boq-format";
import { InlineError } from "@/components/errors/inline-error";
import { describeInput, shareText } from "./element-inputs";
import { LoadingLines } from "@/components/loading";

/** "… (from slot formwork_walls_formula)": the engine names the setting a formula came from. */
const FROM_SLOT = /\s*\(from slot ([A-Za-z0-9_]+)\)\s*$/;

/**
 * The line detail (F06 §5): quantity and source, the formula in words (the PoC's readable
 * formulas) and as written, the settings used, every element's share with their total, the source
 * line of a derived line, codes per system, location, notes and the line's log entries. It starts
 * with the plain-words "How it is calculated" (FE-013), before any formula.
 */
export function LineDetailPanel({
  run,
  lineKey,
  groupBy,
  showIn3dHref,
  modelNames,
  systemNames,
  onSelect,
  onClose,
  children,
  className,
  describe,
}: {
  run: Run;
  lineKey: string;
  /** The sheet's Group-by system: its item text comes first (F06 §5). */
  groupBy?: string | null;
  /** "Show in 3D" (F06 §5, F07 §7): the Viewer tab on this line's elements. */
  showIn3dHref?: string;
  modelNames: Map<string, string>;
  systemNames: Map<string, string>;
  onSelect: (key: string) => void;
  onClose: () => void;
  /** The line's edits and actions (F06 §6), above its explanation. */
  children?: React.ReactNode;
  className?: string;
  /** Descriptions of other lines (a step's source line), when the caller has them: the large-BoQ view, which never loads every line (review B-19). */
  describe?: (key: string) => string | undefined;
}) {
  const t = useTranslations("boqs.detail");
  const tl = useTranslations("library");
  const { org } = useOrg();
  const detail = useLine(run.id, lineKey);
  const lines = useLines(describe ? undefined : run.id);
  const descriptions = useMemo(() => new Map((lines.data ?? []).map((l) => [l.key, l.description])), [lines.data]);
  const ruleSet = usePresetVersion(run.snapshotVersions?.ruleSetVersionId);
  const slots = useMemo(() => {
    const doc = (ruleSet.data?.flattened ?? ruleSet.data?.doc) as { params?: Record<string, Param> } | undefined;
    return doc?.params ?? {};
  }, [ruleSet.data]);
  const lex = useMemo(() => lexicon(slots, (name) => (tl.has(`names.${name}.label`) ? tl(`names.${name}.label`) : name)), [slots, tl]);
  const presetId = ruleSet.data?.presetId;
  const libraryHref = presetId ? `/${org.slug}/library/rule_set/${presetId}` : null;

  return (
    <aside className={cn("flex w-full flex-col gap-5 border-l border-border pl-5 lg:w-[440px] lg:shrink-0", className)} aria-label={t("title")} data-testid="line-detail">
      <div className="flex items-start gap-2">
        <h3 className="text-title flex-1">{detail.data ? itemTexts(detail.data, groupBy)[0]?.text ?? detail.data.description : ""}</h3>
        {showIn3dHref && (
          <Button variant="outline" render={<Link href={showIn3dHref} />} nativeButton={false} data-testid="show-in-3d">
            <Box aria-hidden />
            {t("showIn3d")}
          </Button>
        )}
        <Button variant="ghost" aria-label={t("close")} onClick={onClose} data-testid="close-detail">
          <X aria-hidden />
        </Button>
      </div>
      {children}
      {detail.isError && (
        <InlineError error={detail.error} onRetry={() => detail.refetch()} />
      )}
      {!detail.data && !detail.isError && <LoadingLines />}
      {detail.data && (
        <LineDetailBody line={detail.data} groupBy={groupBy} slots={slots} lex={lex} libraryHref={libraryHref} modelNames={modelNames} systemNames={systemNames} describe={describe ?? ((key) => descriptions.get(key))} onSelect={onSelect} />
      )}
    </aside>
  );
}

/**
 * The line detail's content (F06 §5) from a line and the rule set's settings: the panel above, and the
 * public share page (F18, with its own data and no settings links) use it.
 */
export function LineDetailBody({
  line,
  groupBy,
  slots,
  lex,
  libraryHref,
  modelNames,
  systemNames,
  describe,
  onSelect,
  showLog = true,
}: {
  line: LineDetail;
  groupBy?: string | null;
  slots: Record<string, Param>;
  lex: Lexicon;
  libraryHref: string | null;
  modelNames: Map<string, string>;
  systemNames: Map<string, string>;
  describe: (key: string) => string | undefined;
  onSelect: (key: string) => void;
  showLog?: boolean;
}) {
  const unitLabel = useUnit();
  const t = useTranslations("boqs.detail");
  const ti = useTranslations("boqs.detail.input");
  const tl = useTranslations("library");
  const fieldLabel = (f: string) => (tl.has(`names.${f}.label`) ? tl(`names.${f}.label`) : f);
  // BoQ values in the firm's format (TF-021).
  const format = useBoqFormat();
  const message = useEngineMessage();
  const num = (v: number) => format.quantity(v);
  // An element's share and their total: 3 decimals, with the line's unit (review C-11).
  const share = (v: number) => shareText(v, line.unit, format.number, unitLabel);
  const value = (v: unknown) => (typeof v === "boolean" ? (v ? t("yes") : t("no")) : typeof v === "number" ? num(v) : typeof v === "string" ? v : JSON.stringify(v));
  const slotLabel = (name: string) => lex.slotLabels.get(name) ?? slots[name]?.label ?? name;

          const [, slot] = line.trace.formula.match(FROM_SLOT) ?? [];
          const formula = line.trace.formula.replace(FROM_SLOT, "");
          const elements = line.trace.elements;
          const sum = elements.reduce((s, e) => s + (e.quantity ?? 0), 0);
          const params = Object.entries(line.trace.params);
          const texts = itemTexts(line, groupBy);
          return (
            <>
              {texts.length > 0 && (
                <div className="flex flex-col gap-2" data-testid="detail-item-texts">
                  {texts.map((x, i) => (
                    <p key={x.system} className={i === 0 ? "text-prose" : "text-muted-foreground"} data-testid="detail-item-text" data-system={x.system}>
                      {texts.length > 1 && <span className="label-caps mr-2 text-muted-foreground">{systemNames.get(x.system) ?? x.system}</span>}
                      {x.text}
                    </p>
                  ))}
                  <p className="text-muted-foreground" data-testid="detail-measured-as">
                    {t("measuredAs", { text: line.description })}
                  </p>
                </div>
              )}
              <div className="flex items-baseline gap-3">
                <span className="text-title tabular-nums" data-testid="detail-quantity">
                  {line.quantity === null ? "—" : num(line.quantity)} {unitLabel(line.unit)}
                </span>
                <SourceTag source={line.source} toConfirm={line.toConfirm} />
              </div>

              <Section title={t("howCalculated")}>
                <HowCalculated line={line} slots={slots} lex={lex} libraryHref={libraryHref} modelNames={modelNames} describe={describe} onSelect={onSelect} />
              </Section>

              <Section title={t("formula")}>
                <p className="text-prose" data-testid="detail-formula">
                  {toReadable(formula, lex)}
                </p>
                {slot && <p className="text-muted-foreground">{t("fromSetting", { name: slotLabel(slot) })}</p>}
                <p className="font-mono text-muted-foreground">
                  <span className="label-caps mr-2">{t("rawFormula")}</span>
                  <code data-testid="detail-raw-formula">{line.trace.formula}</code>
                </p>
                {line.trace.sourceLine && (
                  <p>
                    <span className="label-caps mr-2 text-muted-foreground">{t("derivedFrom")}</span>
                    <button className="text-link hover:underline" onClick={() => onSelect(line.trace.sourceLine!)} data-testid="detail-source-line">
                      {line.trace.sourceLine}
                    </button>
                  </p>
                )}
              </Section>

              <Section title={t("parameters")}>
                {params.length === 0 ? (
                  <p className="text-muted-foreground">{t("noParameters")}</p>
                ) : (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1" data-testid="detail-params">
                    {params.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt title={k}>{slotLabel(k)}</dt>
                        <dd className="text-right tabular-nums">{value(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Section>

              <Section title={t("elements")}>
                {elements.length === 0 ? (
                  <p className="text-muted-foreground">{t("noElements")}</p>
                ) : (
                  <table className="w-full" data-testid="detail-elements">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="label-caps py-1 font-medium">{t("element")}</th>
                        <th className="label-caps py-1 text-right font-medium">{t("share")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {elements.map((e, i) => (
                        <tr key={e.guid + i} className="border-b border-border align-top" data-testid="detail-element">
                          <td className="py-1 pr-2">
                            <div title={e.guid}>{e.name || e.guid}</div>
                            <div className="text-muted-foreground">
                              {e.model ? (modelNames.get(e.model) ?? e.model.slice(0, 8)) : null}
                              {e.note ? ` · ${labelUnits(e.note, unitLabel)}` : null}
                            </div>
                            {/* Its measured inputs and where each came from (review C-10). */}
                            {e.inputs?.length ? (
                              <ul className="text-muted-foreground" aria-label={t("inputsLabel")} data-testid="detail-inputs">
                                {e.inputs.map((input) => (
                                  <li key={input.field} data-testid="detail-input" data-field={input.field} data-basis={input.basis ?? ""}>
                                    {describeInput(input, ti as unknown as Parameters<typeof describeInput>[1], fieldLabel, (v) => format.number(v, { maximumFractionDigits: 3 }), unitLabel)}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td className="py-1 text-right tabular-nums" data-testid="detail-share">
                            {e.quantity === null ? t("missing") : share(e.quantity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="py-1">{t("sumOfShares", { count: elements.length })}</td>
                        <td className="py-1 text-right font-semibold tabular-nums" data-testid="detail-share-sum">
                          {share(sum)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </Section>

              {Object.keys(line.codes).length > 0 && (
                <Section title={t("codes")}>
                  <ul className="flex flex-col gap-1" data-testid="detail-codes">
                    {Object.values(line.codes).map((c) => (
                      <li key={c.system}>
                        <span className="label-caps mr-2 text-muted-foreground">{systemNames.get(c.system) ?? c.system}</span>
                        <span className="font-semibold">{c.code}</span> {c.title}{" "}
                        <span className="text-muted-foreground">({c.mapRuleId ? t("mapRule", { id: c.mapRuleId }) : t(`codeSource.${c.source}`)})</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {(line.location?.storey || line.location?.storeys?.length) && (
                <Section title={t("location")}>
                  <p>{line.location?.storey ?? line.location?.storeys?.join(", ")}</p>
                </Section>
              )}
              {(line.notes.length > 0 || (line.quantity === null && line.source === "flagged")) && (
                <Section title={t("notes")}>
                  {line.quantity === null && line.source === "flagged" && (
                    <p className="mb-1" data-testid="detail-empty-hint">{t("emptyHint")}</p>
                  )}
                  {line.notes.length > 0 && (
                    <ul className="list-disc pl-4">
                      {line.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}
              {line.tags.length > 0 && (
                <Section title={t("tags")}>
                  <p>{line.tags.join(", ")}</p>
                </Section>
              )}

              {showLog && line.elementLog && (
                <Section title={t("elementLog")}>
                  {line.elementLog.length === 0 ? (
                    <p className="text-muted-foreground">{t("noElementLog")}</p>
                  ) : (
                    <ol className="flex flex-col gap-1" data-testid="detail-element-log">
                      {line.elementLog.map((e) => (
                        <li key={e.seq} className="flex gap-2" data-guid={e.guid ?? ""}>
                          <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{e.seq}</span>
                          <span className={e.level === "warning" ? "border-l-2 border-[var(--status-attention)] pl-2" : undefined}>{message(e).text}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {line.elementLogMore && <p className="text-muted-foreground" data-testid="detail-element-log-more">{t("elementLogMore", { count: line.elementLog.length })}</p>}
                </Section>
              )}
              {showLog && <Section title={t("log")}>
                {(line.log ?? []).length === 0 ? (
                  <p className="text-muted-foreground">{t("noLog")}</p>
                ) : (
                  <ol className="flex flex-col gap-1" data-testid="detail-log">
                    {line.log!.map((e) => (
                      <li key={e.seq} className="flex gap-2">
                        <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{e.seq}</span>
                        <span className={e.level === "warning" ? "border-l-2 border-[var(--status-attention)] pl-2" : undefined}>{message(e).text}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>}
            </>
          );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="label-caps text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

/** A line's item texts (P14), the Group-by system's first. */
function itemTexts(line: { codes: Record<string, { text?: string }> }, groupBy: string | null | undefined) {
  return Object.entries(line.codes)
    .filter(([, c]) => !!c.text)
    .map(([system, c]) => ({ system, text: c.text! }))
    .sort((a, b) => (a.system === groupBy ? -1 : b.system === groupBy ? 1 : 0));
}
