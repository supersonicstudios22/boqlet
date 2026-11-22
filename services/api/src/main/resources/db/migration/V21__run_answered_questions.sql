-- TF-137: the questions a run raised that decisions answered (the engine's `answeredQuestionIds`), so its
-- question list shows those and not every decision of the project. NULL for runs made before.
ALTER TABLE runs ADD COLUMN answered_questions jsonb;
