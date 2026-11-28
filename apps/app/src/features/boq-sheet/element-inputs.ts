import type { LineDetail } from "@/api/hooks/sheet";

/** One measured input of an element (review C-10): the engine's `TraceInput`. */
export type TraceInput = NonNullable<LineDetail["trace"]["elements"][number]["inputs"]>[number];

/** The SI unit a measured field's value is in (measured.ts: metres, m², m³, kg). Counts and angles have none. */
const FIELD_UNIT: Record<string, string> = {
  gross_volume: "m3", net_volume: "m3",
  mass: "kg", nominal_mass_per_length: "kg/m", density: "kg/m3",
  slope: "°", bar_count: "", connection_count: "",
};

export function fieldUnit(field: string): string {
  if (field in FIELD_UNIT) return FIELD_UNIT[field]!;
  return /area$|_area_|cross_section_area/.test(field) ? "m2" : "m";
}

type Translate = { (key: string, values?: Record<string, string | number>): string; has(key: string): boolean };

/**
 * An input as one line of text: "Net volume 4.587 m³ · from PSet_Revit_Dimensions.Volume · geometry 4.59 m³".
 * `t` is the `boqs.detail.input` catalogue; values are rounded to 3 decimals in the firm's format (C-11).
 */
export function describeInput(
  input: TraceInput,
  t: Translate,
  fieldLabel: (field: string) => string,
  amount: (value: number) => string,
  unitLabel: (unit: string) => string,
): string {
  const unit = fieldUnit(input.field);
  const withUnit = (v: number) => (unit ? `${amount(v)} ${unitLabel(unit)}` : amount(v));
  const from = input.from ?? "";
  const parts = [t("value", { field: fieldLabel(input.field), value: withUnit(input.value) })];
  if (input.basis && t.has(`basis.${input.basis}`)) parts.push(t(`basis.${input.basis}`, { from }));
  else if (input.provenance && t.has(`provenance.${input.provenance}`)) parts.push(t(`provenance.${input.provenance}`));
  if (typeof input.geometry === "number") parts.push(t("geometry", { value: withUnit(input.geometry) }));
  if (typeof input.stated === "number") {
    // the property the stated value came from, unless the basis sentence already names it
    const named = input.basis === "property" || input.basis === "attribute";
    parts.push(t("stated", { value: withUnit(input.stated), from: !named && from ? from : "none" }));
  }
  if (input.question) parts.push(t("answered"));
  return parts.join(" · ");
}
