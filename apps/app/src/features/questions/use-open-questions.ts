import { useQuestions } from "@/api/hooks/decisions";
import { counts } from "./model";

/**
 * A run's questions without an answer (`open`) and how many of those block the BoQ (`blocking`):
 * the count on the Questions tab and the "Answer N questions" step in the BoQ header (P55). Shares
 * the Questions tab's query.
 */
export function useOpenQuestions(runId: string | undefined): { open: number; blocking: number } {
  const questions = useQuestions(runId);
  if (!questions.data) return { open: 0, blocking: 0 };
  const n = counts(questions.data);
  return { open: n.unanswered, blocking: n.blocking };
}
