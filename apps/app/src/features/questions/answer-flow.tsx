"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useBoqs } from "@/api/hooks/boqs";
import { answerImpact, useAnswer, useClearDecision, useTerms, type AnswerImpact, type AnswerRequest, type Decision } from "@/api/hooks/decisions";
import { useMe } from "@/api/hooks/me";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useOrg } from "@/features/orgs/org-context";
import { describeAnswer } from "./model";

function otherAnswer(decision: Decision): string | number {
  const type = decision.answerType;
  if (type?.kind === "choice") return type.options[0]?.value ?? "";
  if (type?.kind === "number") return 0;
  return "-";
}

type Pending = { kind: "answer"; request: AnswerRequest; impact: AnswerImpact; done?: () => void } | { kind: "clear"; decision: Decision; impact: AnswerImpact; done?: () => void };

/** How many replaced answers and BoQs the dialog names before "and N more". */
const SHOWN = 5;

/** Whether any of these decisions was made by someone other than `me` (review C-17). */
export function byOthers(current: readonly (Decision | undefined)[], me: string | undefined): boolean {
  return current.some((d) => !!d?.decidedBy && d.decidedBy.id !== me);
}

/**
 * Saving answers with a look first (F05 §2): when a BoQ of the project is in review or approved (BR-23), or the
 * answer replaces a colleague's (review C-17), a dry run says which versions go back to draft, whose answers are
 * replaced and which BoQs the answer applies to, and the person confirms. Otherwise the answer is saved in one
 * request (F05 AC3).
 */
export function useAnswerFlow(projectId: string) {
  const t = useTranslations("questions.reopen");
  const tq = useTranslations("questions");
  const format = useFormatter();
  const locale = useLocale();
  const message = useErrorMessage();
  const { org } = useOrg();
  const me = useMe().data?.user.id;
  const terms = useTerms(org.id, projectId);
  const boqs = useBoqs(projectId);
  const answer = useAnswer(projectId);
  const clear = useClearDecision(projectId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [checkError, setCheckError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const atRisk = (boqs.data ?? []).some((b) => !b.archived && (b.currentRevision.status === "in_review" || b.currentRevision.status === "approved"));

  async function guarded(request: AnswerRequest, current: readonly (Decision | undefined)[], go: () => void, warn: (impact: AnswerImpact) => void) {
    setCheckError(null);
    if (!atRisk && !byOthers(current, me)) return go();
    setChecking(true);
    try {
      const impact = await answerImpact(projectId, request);
      if (impact.reopened.length || impact.replaced.length) warn(impact);
      else go();
    } catch (e) {
      setCheckError(e);
    } finally {
      setChecking(false);
    }
  }

  /** `current`: the decisions the request may replace (the questions' answers as the page shows them). */
  const submit = (request: AnswerRequest, done?: () => void, current: readonly (Decision | undefined)[] = []) =>
    guarded(
      request,
      current,
      () => answer.mutate(request, { onSuccess: () => done?.() }),
      (impact) => setPending({ kind: "answer", request, impact, done }),
    );

  /**
   * Clearing changes the run like any other answer would; the dry run (which has no "clear") asks
   * with a different, valid answer: `null`, or for a dismissed question one its control accepts.
   */
  const remove = (decision: Decision, done?: () => void) =>
    guarded(
      { decisions: [{ questionId: decision.questionId, kind: decision.kind, answer: decision.answer === null ? otherAnswer(decision) : null }] },
      [decision],
      () => clear.mutate(decision.id, { onSuccess: () => done?.() }),
      (impact) => setPending({ kind: "clear", decision, impact, done }),
    );

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "answer") answer.mutate(pending.request, { onSuccess: () => pending.done?.() });
    else clear.mutate(pending.decision.id, { onSuccess: () => pending.done?.() });
    setPending(null);
  };

  const byId = new Map((terms.data ?? []).map((x) => [x.id, x]));
  const answerText = (d: Decision) => {
    const shown = describeAnswer(d.answer, d.answerType, { terms: byId, locale });
    return "text" in shown ? shown.text : tq(`special.${shown.special}`);
  };
  const impact = pending?.impact;
  const reopening = !!impact?.reopened.length;
  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent data-testid="reopen-warning">
        <AlertDialogHeader>
          <AlertDialogTitle>{reopening ? t("title") : t("replaceTitle", { count: impact?.replaced.length ?? 0 })}</AlertDialogTitle>
          {reopening && <AlertDialogDescription>{t("body", { count: impact!.reopened.length })}</AlertDialogDescription>}
        </AlertDialogHeader>
        {reopening && (
          <ul className="flex flex-col gap-1">
            {impact!.reopened.map((r) => (
              <li key={r.revisionId}>{t("revision", { boq: r.boqName, label: r.label, status: r.status })}</li>
            ))}
          </ul>
        )}
        {!!impact?.replaced.length && (
          <ul className="flex flex-col gap-1" data-testid="replace-warning">
            {impact.replaced.slice(0, SHOWN).map((d) => (
              <li key={d.id}>
                {t("replaced", {
                  name: d.decidedBy?.name ?? "",
                  answer: answerText(d),
                  date: format.dateTime(new Date(d.decidedAt), { day: "numeric", month: "short" }),
                })}
              </li>
            ))}
            {impact.replaced.length > SHOWN && <li>{t("more", { count: impact.replaced.length - SHOWN })}</li>}
          </ul>
        )}
        {!!impact?.appliesTo.length && (
          <p className="text-muted-foreground" data-testid="applies-to">
            {t("appliesTo", {
              count: impact.appliesTo.length,
              boqs: format.list(impact.appliesTo.slice(0, SHOWN).map((r) => r.boqName), { type: "conjunction" }),
              more: Math.max(0, impact.appliesTo.length - SHOWN),
            })}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} data-testid="reopen-confirm">
            {reopening ? t("confirm") : t("replace")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const error = checkError ?? answer.error ?? clear.error;
  return {
    submit,
    remove,
    dialog,
    busy: checking || answer.isPending || clear.isPending,
    error: error ? message(error) : null,
  };
}
