/**
 * One status line for a run (review C-20, PRD-015): whether the BoQ is complete (BR-10: no blocking question left)
 * and what is still left to look at, so "Complete" never stands next to unexplained counts.
 */
export interface StatusLine {
  complete: boolean;
  /** Blocking questions without an answer (the run's own count while the questions load). */
  blocking: number;
  /** Lines without a quantity or resting on something to confirm (`stats.flaggedLines`). */
  toConfirm: number;
  /** Open questions that don't block. */
  optional: number;
  /** Of those, the ones about the models (overlaps, copies that disagree: they can move a number, review A-19). */
  aboutModels: number;
}

export function statusLine(
  run: { status: string; stats?: { flaggedLines?: number; blockingQuestions?: number } | null },
  questions?: { unanswered: number; blocking: number; modelsToCheck: number },
): StatusLine {
  const blocking = questions ? questions.blocking : (run.stats?.blockingQuestions ?? 0);
  return {
    complete: run.status !== "needs_input",
    blocking,
    toConfirm: run.stats?.flaggedLines ?? 0,
    optional: questions ? questions.unanswered - questions.blocking : 0,
    aboutModels: questions?.modelsToCheck ?? 0,
  };
}
