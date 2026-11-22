/**
 * The API's request limits (contract change C08, TF-174; `packages/api/openapi.yaml` `info.description`).
 * Inputs carry them as `maxLength`, so a value the API would refuse (`400 invalid_body`) can't be typed.
 */
export const LIMITS = {
  /** A person's name. */
  personName: 120,
  /** Names and labels: org, project, BoQ, model, preset; share and version labels. */
  name: 200,
  /** Notes, reasons, comments, descriptions, answers. */
  text: 4000,
  /** A BoQ line's description. */
  lineText: 10_000,
} as const;
