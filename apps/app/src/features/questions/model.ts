import type { Answer, AnswerType, Decision, Question, Term } from "@/api/hooks/decisions";
import type { EngineMessage } from "@/i18n/engine-message";

/**
 * The questions tab's logic (F05 §1, §2, S12b), pure and tested: order, filters, which questions
 * can be answered together, and how an answer reads.
 */

export type AnswerState = "unanswered" | "answered" | "all";
export interface QuestionFilters {
  kind?: string;
  state: AnswerState;
}

/** F05 §1: unanswered first, blocking first, then by kind, then by occurrences (most first). */
export function sortQuestions<Q extends Pick<Question, "id" | "kind" | "blocking" | "occurrences" | "decision">>(list: readonly Q[]): Q[] {
  return [...list].sort(
    (a, b) =>
      Number(!!a.decision) - Number(!!b.decision) ||
      Number(b.blocking) - Number(a.blocking) ||
      a.kind.localeCompare(b.kind) ||
      (b.occurrences ?? 0) - (a.occurrences ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

export function filterQuestions(list: readonly Question[], f: QuestionFilters): Question[] {
  return list.filter((q) => (!f.kind || q.kind === f.kind) && (f.state === "all" || (f.state === "answered") === !!q.decision));
}

/**
 * Review C-15: questions whose answer changes nothing under the current rules (`noEffect`, a name in a field no
 * rule reads) go to a "For information" group; the rest stay in the main list. Order is kept.
 */
export function splitByEffect<Q extends Pick<Question, "noEffect">>(list: readonly Q[]): { main: Q[]; info: Q[] } {
  return { main: list.filter((q) => !q.noEffect), info: list.filter((q) => q.noEffect) };
}

/** One count per question (review C-15): its distinct elements when the engine names them, else its occurrences. */
export function elementCount(q: Pick<Question, "guids" | "occurrences">): number | undefined {
  return q.guids?.length ? new Set(q.guids).size : q.occurrences;
}

/** Kinds present, in list order (for the kind filter). */
export function kindsOf(list: readonly Question[]): string[] {
  return [...new Set(list.map((q) => q.kind))];
}

/** Federation questions whose answer can move a number: an overlap or copies that disagree (review A-19). */
const MODEL_KINDS: readonly string[] = ["overlap", "duplicate_conflict"];

export function counts(list: readonly Question[]) {
  const open = list.filter((q) => !q.decision);
  return {
    unanswered: open.length,
    blocking: open.filter((q) => q.blocking).length,
    /** Open federation questions that don't block: the BoQ can be "complete" with them, so the header lists them. */
    modelsToCheck: open.filter((q) => !q.blocking && MODEL_KINDS.includes(q.kind)).length,
    /** Answers given, changed or cleared since the run (F05 §3: "N answers not applied yet"). */
    notApplied: list.filter((q) => q.answeredAfterRun).length,
  };
}

/** Questions answered together must share the kind and the answer control (F05 edge cases). */
export function answerTypeKey(t: AnswerType): string {
  switch (t.kind) {
    case "term":
      return `term:${t.category ?? ""}`;
    case "number":
      return `number:${t.unit ?? ""}`;
    case "code":
      return `code:${t.system}`;
    case "choice":
      return `choice:${t.options.map((o) => o.value).join("|")}`;
    default:
      return t.kind;
  }
}

export const bulkKey = (q: Pick<Question, "kind" | "answer">) => `${q.kind}/${answerTypeKey(q.answer)}`;

/** The selection keeps one kind and one answer control: rows of another key can't join it. */
export function selectable(selection: readonly Question[], q: Question): boolean {
  return selection.length === 0 || bulkKey(selection[0]!) === bulkKey(q);
}

/** Whether a value fits an answer control (a suggestion that doesn't is not preselected). */
export function fits(type: AnswerType, value: Answer | undefined): boolean {
  if (value === undefined || value === null) return false;
  switch (type.kind) {
    case "number":
      return (typeof value === "number" && Number.isFinite(value) && value >= 0) || value === "flag";
    case "choice":
      return typeof value === "string" && type.options.some((o) => o.value === value);
    default:
      return typeof value === "string" && value.trim() !== "";
  }
}

/** What a control starts with: the decision, else the engine's suggestion (F05 §4). */
export function initialValue(q: Pick<Question, "answer" | "decision" | "suggestion">): { value: Answer | undefined; suggested: boolean } {
  if (q.decision) return { value: q.decision.answer, suggested: false };
  if (fits(q.answer, q.suggestion)) return { value: q.suggestion as Answer, suggested: true };
  return { value: undefined, suggested: false };
}

/** A term's label in the user's language when the dictionary has it, else its label (review C-16). */
export function termLabel(term: Pick<Term, "label" | "labels">, locale?: string): string {
  if (!locale || !term.labels) return term.label;
  return term.labels[locale] ?? term.labels[locale.split("-")[0]!] ?? term.label;
}

/** A term's place in the hierarchy, root first: "Concrete › In-situ concrete". */
export function termPath(id: string, byId: ReadonlyMap<string, Term>, locale?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let t = byId.get(id); t && !seen.has(t.id); t = t.parent ? byId.get(t.parent) : undefined) {
    seen.add(t.id);
    out.unshift(termLabel(t, locale));
  }
  return out.length ? out : [id];
}

export interface AnswerLookups {
  terms?: ReadonlyMap<string, Term>;
  /** The UI language, for terms' translated labels. */
  locale?: string;
  rules?: ReadonlyMap<string, string>;
  codes?: ReadonlyMap<string, string>;
}

/**
 * How an answer reads in a row or the decisions table. `null` (dismissed), "flag" and "exclude"
 * are the caller's to translate; this returns them as `{special}`.
 */
export function describeAnswer(answer: Answer, type: AnswerType | undefined, lookups: AnswerLookups = {}): { text: string } | { special: "dismissed" | "flag" | "exclude" } {
  if (answer === null) return { special: "dismissed" };
  const value = String(answer);
  if (type?.kind === "number" && answer === "flag") return { special: "flag" };
  if (type?.kind === "rule" && answer === "exclude") return { special: "exclude" };
  switch (type?.kind) {
    case "term":
      return { text: lookups.terms?.has(value) ? termPath(value, lookups.terms, lookups.locale).join(" › ") : value };
    case "choice":
      return { text: type.options.find((o) => o.value === value)?.label ?? value };
    case "rule":
      return { text: lookups.rules?.get(value) ?? value };
    case "code": {
      const title = lookups.codes?.get(value);
      return { text: title ? `${value} ${title}` : value };
    }
    default:
      return { text: value };
  }
}

/** The term the "Not relevant" answer picks (review C-16): the seed's `unspecified`, logged like any answer. */
export const NOT_RELEVANT = "unspecified";

const folded = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Searches terms by id, label, translations, aliases (synonyms, abbreviations, other languages) and the broader
 * terms' labels (review C-16); every word must appear, accents ignored. The category narrows when given.
 */
export function searchTerms(terms: readonly Term[], q: string, category?: string, limit = 50): Term[] {
  const byId = new Map(terms.map((t) => [t.id, t]));
  const words = folded(q.trim()).split(/\s+/).filter(Boolean);
  return terms
    .filter((t) => !category || t.category === category)
    .filter((t) => {
      if (!words.length) return true;
      const own = [t.id, ...termPath(t.id, byId), ...Object.values(t.labels ?? {}), ...(t.aliases ?? [])];
      const hay = folded(own.join(" "));
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/**
 * A decision's question as the Questions tab writes it (review C-18): the stored question's code and params, with
 * its English (the summary) as the fallback, and the id for a decision whose question was never stored.
 */
export function decisionMessage(d: Pick<Decision, "questionId" | "summary" | "questionCode" | "questionParams">): EngineMessage {
  return { code: d.questionCode ?? null, params: (d.questionParams as Record<string, unknown> | undefined) ?? null, message: d.summary ?? d.questionId };
}
