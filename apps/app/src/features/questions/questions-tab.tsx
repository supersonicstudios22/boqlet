"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useBoqFormat } from "@/i18n/boq-format";
import { useGenerate, type Boq } from "@/api/hooks/boqs";
import { useQuestions, type Answer, type Question } from "@/api/hooks/decisions";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Tag } from "@/features/boqs/boq-header";
import { useOrg } from "@/features/orgs/org-context";
import { showIn3dHref } from "@/features/viewer/viewer-tab";
import { useEngineMessage } from "@/i18n/engine-message";
import { useUnit } from "@/i18n/units";
import { cn } from "@/lib/utils";
import { AnswerControl, type AnswerContext } from "./answer-control";
import { useAnswerFlow } from "./answer-flow";
import { counts, describeAnswer, elementCount, filterQuestions, initialValue, kindsOf, NOT_RELEVANT, selectable, splitByEffect, termPath, type AnswerState } from "./model";
import { PromoteDialog } from "./promote-dialog";
import { useAnswerContext } from "./use-answer-context";
import { InlineError } from "@/components/errors/inline-error";
import { LoadingLines } from "@/components/loading";

/**
 * S12b Questions (F05 §1–6): the current run's questions joined with the project's decisions,
 * answered one at a time or many at once (one kind and one control), dismissed, promoted. Answers
 * apply on the next run: the toolbar and the header say how many wait (F05 §3).
 */
export function QuestionsTab({ boq }: { boq: Boq }) {
  const t = useTranslations("questions");
  const message = useErrorMessage();
  const { org, can: orgCan } = useOrg();
  const revision = boq.currentRevision;
  const run = revision.currentRun;
  const questions = useQuestions(run?.id);
  const context = useAnswerContext(org.id, boq.projectId, run);
  const flow = useAnswerFlow(boq.projectId);
  const generate = useGenerate(revision.id, boq.id);
  const canAnswer = revision.permissions.answerQuestions === true;
  const canPromote = orgCan("promoteDecisions");

  const [kind, setKind] = useState("");
  const [state, setState] = useState<AnswerState>("unanswered");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [toDictionary, setToDictionary] = useState(true);
  const [promoting, setPromoting] = useState<string[] | null>(null);

  const list = useMemo(() => questions.data ?? [], [questions.data]);
  const shown = useMemo(() => filterQuestions(list, { state, ...(kind ? { kind } : {}) }), [list, state, kind]);
  // review C-15: questions whose answer changes nothing come last, collapsed ("For information")
  const groups = useMemo(() => splitByEffect(shown), [shown]);
  const selection = useMemo(() => list.filter((q) => selected.has(q.id)), [list, selected]);
  const n = counts(list);

  if (!run) return <p className="text-muted-foreground">{t("noRun")}</p>;
  if (questions.isError) return <InlineError error={questions.error} onRetry={() => questions.refetch()} />;
  if (!questions.data) return <LoadingLines />;

  const toggle = (q: Question) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(q.id)) next.delete(q.id);
      else next.add(q.id);
      return next;
    });
  const selectAllLike = () => {
    const like = selection[0] ?? shown.find((q) => !q.decision) ?? shown[0];
    if (like) setSelected(new Set(shown.filter((q) => selectable([like], q)).map((q) => q.id)));
  };
  const save = (qs: Question[], answer: Answer, done?: () => void) =>
    flow.submit({ decisions: qs.map((q) => ({ questionId: q.id, kind: q.kind, answer })), addToProjectDictionary: toDictionary }, done);

  const row = (q: Question) => (
    <QuestionRow
      key={`${q.id}:${q.decision?.id ?? "open"}`}
      question={q}
      context={context}
      canAnswer={canAnswer}
      checked={selected.has(q.id)}
      selectable={selectable(selection, q)}
      onToggle={() => toggle(q)}
      showIn3d={q.guids?.length && boq.currentRevision.currentRun ? showIn3dHref(`/${org.slug}/projects/${boq.projectId}/boqs/${boq.id}`, { guids: q.guids }) : undefined}
      busy={flow.busy}
      onAnswer={(answer) => save([q], answer)}
      onClear={() => q.decision && flow.remove(q.decision)}
      onPromote={canPromote && q.kind === "unknown_name" && typeof q.decision?.answer === "string" ? () => setPromoting([q.decision!.id]) : undefined}
    />
  );
  const nameQuestions = list.some((q) => q.kind === "unknown_name");
  const promotable = selection.filter((q) => q.kind === "unknown_name" && typeof q.decision?.answer === "string");

  return (
    <section className="flex flex-col gap-4" data-testid="questions-tab">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h3 className="text-heading" data-testid="questions-summary">
          {list.length ? t("summary", { unanswered: n.unanswered, blocking: n.blocking }) : t("none")}
        </h3>
        {list.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="label-caps text-muted-foreground">{t("filters.kind")}</span>
              <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)} data-testid="questions-kind">
                <option value="">{t("filters.allKinds")}</option>
                {kindsOf(list).map((k) => (
                  <option key={k} value={k}>
                    {t.has(`kinds.${k}`) ? t(`kinds.${k}`) : k}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex items-center gap-2">
              <span className="label-caps text-muted-foreground">{t("filters.show")}</span>
              <NativeSelect value={state} onChange={(e) => setState(e.target.value as AnswerState)} data-testid="questions-state">
                <option value="unanswered">{t("filters.unanswered")}</option>
                <option value="answered">{t("filters.answered")}</option>
                <option value="all">{t("filters.all")}</option>
              </NativeSelect>
            </label>
          </div>
        )}
        {n.notApplied > 0 && revision.permissions.editBoqs && (
          <Button className="ml-auto" onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="questions-regenerate">
            {t("regenerate", { count: n.notApplied })}
          </Button>
        )}
      </div>

      {canAnswer && nameQuestions && (
        <label className="flex items-center gap-2 self-start">
          <input type="checkbox" checked={toDictionary} onChange={(e) => setToDictionary(e.target.checked)} className="accent-[var(--link)]" data-testid="to-project-dictionary" />
          <span>{t("toProjectDictionary")}</span>
        </label>
      )}

      {canAnswer && selection.length > 0 && (
        <BulkBar
          selection={selection}
          context={context}
          busy={flow.busy}
          onApply={(answer) => save(selection, answer, () => setSelected(new Set()))}
          onClear={() => setSelected(new Set())}
          onPromote={canPromote && promotable.length === selection.length ? () => setPromoting(promotable.map((q) => q.decision!.id)) : undefined}
        />
      )}
      {flow.error && (
        <p role="alert" className="text-error">
          {flow.error}
        </p>
      )}
      {generate.error ? (
        <p role="alert" className="text-error">
          {message(generate.error)}
        </p>
      ) : null}

      {shown.length === 0 ? (
        list.length > 0 && <p className="text-muted-foreground">{t("nothingShown")}</p>
      ) : (
        <div className="flex flex-col">
          {canAnswer && (
            <div className="flex items-center gap-3 border-b border-border py-2">
              <Button variant="ghost" onClick={selectAllLike} data-testid="select-all-like">
                {t("selectAllLike")}
              </Button>
            </div>
          )}
          <ul className="flex flex-col" data-testid="questions-list">
            {groups.main.map(row)}
          </ul>
          {groups.info.length > 0 && (
            <details className="mt-3" data-testid="questions-info">
              <summary className="cursor-pointer py-2 text-muted-foreground">{t("infoGroup", { count: groups.info.length })}</summary>
              <ul className="flex flex-col">{groups.info.map(row)}</ul>
            </details>
          )}
        </div>
      )}
      {flow.dialog}
      {promoting && <PromoteDialog orgId={org.id} projectId={boq.projectId} decisionIds={promoting} open onOpenChange={(open) => !open && setPromoting(null)} />}
    </section>
  );
}

/** Affected lines named in a row; the rest are counted (review C-15). */
const SHOWN_LINES = 3;

function QuestionRow({
  question: q,
  context,
  canAnswer,
  checked,
  selectable: canSelect,
  onToggle,
  showIn3d,
  busy,
  onAnswer,
  onClear,
  onPromote,
}: {
  question: Question;
  context: AnswerContext;
  canAnswer: boolean;
  checked: boolean;
  selectable: boolean;
  onToggle: () => void;
  /** "Show in 3D" (F07 §7): the Viewer tab on the question's elements. */
  showIn3d?: string;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
  onClear: () => void;
  onPromote?: () => void;
}) {
  const t = useTranslations("questions");
  const boqFormat = useBoqFormat();
  const message = useEngineMessage()(q);
  const unitLabel = useUnit();
  const count = elementCount(q);
  const initial = initialValue(q);
  const affected = q.affectedLines ?? [];
  const more = (q.affectedLineCount ?? affected.length) - Math.min(affected.length, SHOWN_LINES);
  const source = typeof q.params?.source === "string" ? q.params.source : undefined;
  const [value, setValue] = useState<Answer | undefined>(initial.value);
  const locale = useLocale();
  const answered = q.decision;
  const byId = new Map(context.terms.map((x) => [x.id, x]));
  const shownAnswer = answered ? describeAnswer(answered.answer, q.answer, { terms: byId, locale }) : null;
  // review C-16: terms that fit the name, one click each; "Not relevant" for any name question
  const offered = !answered && q.kind === "unknown_name" ? (q.candidates ?? []).filter((id) => byId.has(id)) : [];
  return (
    <li className={cn("grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-b border-border py-3 lg:grid-cols-[auto_auto_minmax(0,1fr)_minmax(14rem,28rem)]", answered && "text-muted-foreground")} data-testid="question-row" data-question-id={q.id} data-answered={answered ? "true" : "false"}>
      <input
        type="checkbox"
        aria-label={t("select", { question: message.text })}
        checked={checked}
        disabled={!canAnswer || (!checked && !canSelect)}
        onChange={onToggle}
        className="mt-1.5 accent-[var(--link)]"
        data-testid="question-select"
      />
      <Tag filled={q.blocking && !answered} className={cn("mt-0.5 self-start", !q.blocking && "border-muted-foreground text-muted-foreground")}>
        {q.blocking ? t("blocking") : t("info")}
      </Tag>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-foreground" data-testid="question-message" data-message={message.source}>
          {message.text}
          {count ? <span className="text-muted-foreground"> — {t("elements", { count })}</span> : null}
          {showIn3d && (
            <Link href={showIn3d} className="ml-2 text-link underline underline-offset-2" data-testid="question-show-in-3d">
              {t("showIn3d")}
            </Link>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {answered && shownAnswer && (
            <span data-testid="question-answer">
              {t("answeredWith", { answer: "text" in shownAnswer ? shownAnswer.text : t(`special.${shownAnswer.special}`) })}
            </span>
          )}
          {q.answeredAfterRun && (
            <Tag className="border-[var(--status-attention)]" data-testid="answered-after-run">
              {answered ? t("changedAfterRun") : t("clearedAfterRun")}
            </Tag>
          )}
          {/* a choice marks its suggested option itself: one label, not two (review C-15) */}
          {!answered && initial.suggested && q.answer.kind !== "choice" && <Tag className="border-muted-foreground text-muted-foreground">{t("suggested")}</Tag>}
        </div>
        {q.affectedLines && (
          <p className="text-muted-foreground" data-testid="question-affects">
            {affected.length === 0
              ? t("affectsNone")
              : t("affects", {
                  lines: affected
                    .slice(0, SHOWN_LINES)
                    .map((l) => (l.quantity === null || l.quantity === undefined ? l.description : `${l.description} (${boqFormat.quantity(l.quantity)} ${unitLabel(l.unit)})`))
                    .join("; "),
                  more,
                })}
          </p>
        )}
        {source && (
          <details className="text-muted-foreground" data-testid="question-details">
            <summary className="cursor-pointer">{t("details")}</summary>
            <p>{t("statedIn", { source })}</p>
          </details>
        )}
      </div>
      {canAnswer && (
        <div className="col-span-3 flex flex-wrap items-center gap-2 lg:col-span-1 lg:justify-end">
          <AnswerControl
            type={q.answer}
            value={value}
            context={context}
            disabled={busy}
            label={t("answerFor", { question: message.text })}
            testId="answer-control"
            onChange={(v, commit) => {
              setValue(v);
              // Choosing the answer already saved changes nothing; choosing the preselected suggestion saves it.
              if (commit && !(answered && JSON.stringify(answered.answer) === JSON.stringify(v))) onAnswer(v);
            }}
          />
          {offered.length > 0 && (
            <span className="flex flex-wrap items-center gap-1" role="group" aria-label={t("candidates")} data-testid="question-candidates">
              {offered.map((id) => (
                <Button key={id} variant="outline" size="sm" disabled={busy} onClick={() => onAnswer(id)} title={termPath(id, byId, locale).join(" › ")} data-testid="question-candidate" data-term={id}>
                  {termPath(id, byId, locale).at(-1)}
                </Button>
              ))}
            </span>
          )}
          {!answered && q.kind === "unknown_name" && q.suggestion !== NOT_RELEVANT && (
            <Button variant="ghost" disabled={busy} onClick={() => onAnswer(NOT_RELEVANT)} data-testid="not-relevant">
              {t("notRelevant")}
            </Button>
          )}
          {!answered && !q.blocking && (
            <Button variant="ghost" disabled={busy} onClick={() => onAnswer(null)} data-testid="dismiss">
              {t("dismiss")}
            </Button>
          )}
          {answered && (
            <Button variant="ghost" disabled={busy} onClick={onClear} data-testid="clear-answer">
              {t("clear")}
            </Button>
          )}
          {onPromote && (
            <Button variant="ghost" onClick={onPromote} data-testid="promote">
              {answered?.promotedToPresetVersionId ? t("promoteAgain") : t("promoteAction")}
            </Button>
          )}
        </div>
      )}
      {!canAnswer && answered === undefined && q.suggestion !== undefined && (
        <span className="col-span-3 text-muted-foreground">{t("suggestion", { value: typeof q.suggestion === "number" ? boqFormat.number(q.suggestion) : String(q.suggestion) })}</span>
      )}
    </li>
  );
}

function BulkBar({ selection, context, busy, onApply, onClear, onPromote }: { selection: Question[]; context: AnswerContext; busy: boolean; onApply: (answer: Answer) => void; onClear: () => void; onPromote?: () => void }) {
  const t = useTranslations("questions.bulk");
  const [value, setValue] = useState<Answer | undefined>(undefined);
  const first = selection[0]!;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-muted px-3 py-2" role="region" aria-label={t("label")} data-testid="bulk-bar">
      <span className="tabular-nums">{t("selected", { count: selection.length })}</span>
      <AnswerControl key={first.answer.kind} type={first.answer} value={value} context={context} disabled={busy} label={t("answer")} testId="bulk-answer" onChange={(v) => setValue(v)} />
      <Button disabled={busy || value === undefined} onClick={() => value !== undefined && onApply(value)} data-testid="bulk-apply">
        {t("apply")}
      </Button>
      {onPromote && (
        <Button variant="outline" onClick={onPromote} data-testid="bulk-promote">
          {t("promote")}
        </Button>
      )}
      <Button variant="ghost" onClick={onClear}>
        {t("clearSelection")}
      </Button>
    </div>
  );
}
