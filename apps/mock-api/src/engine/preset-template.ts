export interface TemplateInput {
  kind: "rule_set" | "classification" | "dictionary";
  doc: unknown;
  effective?: unknown;
  parentParams?: unknown;
  checkParent?: unknown;
  library?: unknown[];
  items?: { id: string; label: string }[];
  terms?: string[];
  source: "draft" | "latest" | "empty";
}

export interface TemplateImport {
  doc: Record<string, unknown>;
  changes: { what: string; summary: string; before?: unknown; after?: unknown }[];
  problems: { sheet?: string; row?: number; column?: string; message: string }[];
}
