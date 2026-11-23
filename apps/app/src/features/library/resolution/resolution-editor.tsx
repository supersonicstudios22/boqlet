"use client";

/**
 * Resolution settings editor (F10 §3, advanced): the contradiction thresholds as fields (review WP-A1,
 * A-04: when a stated quantity that disagrees with the geometry is asked about, and when it blocks the
 * BoQ), everything else as JSON. The engine applies the values and checks them (`presets.check`); the
 * defaults shown are the engine's (`measure.py` CONTRADICTION, CONTRADICTION_BLOCK).
 */
import { useTranslations } from "next-intl";
import type { ResolutionSettings } from "@ifc-boq/types";
import type { EditorProps } from "../preset-editor";
import { put } from "../shared/doc";
import { Field, Num, Section } from "../shared/fields";
import { JsonTab } from "../shared/json-tab";

export const DEFAULT_WARN_PCT = 10;
export const DEFAULT_BLOCK_PCT = 50;

export function ResolutionEditor({ doc, onChange }: EditorProps<ResolutionSettings>) {
  const t = useTranslations("library.resolution");
  return (
    <div className="flex flex-col gap-6" data-testid="resolution-editor">
      <Section title={t("contradictions")} hint={t("contradictionsHint")}>
        <Field label={t("warnPct")} hint={t("warnPctHint", { n: DEFAULT_WARN_PCT })}>
          <Num
            value={doc.contradictionWarnPct}
            onChange={(v) => onChange(put(doc, "contradictionWarnPct", v))}
            step={1}
            placeholder={String(DEFAULT_WARN_PCT)}
            data-testid="contradiction-warn-pct"
          />
        </Field>
        <Field label={t("blockPct")} hint={t("blockPctHint", { n: DEFAULT_BLOCK_PCT })}>
          <Num
            value={doc.contradictionBlockPct}
            onChange={(v) => onChange(put(doc, "contradictionBlockPct", v))}
            step={1}
            placeholder={String(DEFAULT_BLOCK_PCT)}
            data-testid="contradiction-block-pct"
          />
        </Field>
      </Section>
      <JsonTab value={doc} onChange={onChange} />
    </div>
  );
}
