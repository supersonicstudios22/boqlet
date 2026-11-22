import type { EditBatch } from "@/api/hooks/edits";

/**
 * Edits the API refused because the session ended (a 401 while saving, TF-146), kept in this tab's
 * sessionStorage until the sheet of that BoQ opens again after signing in, which offers them again.
 */
export interface KeptEdit {
  apply: EditBatch;
  undo: EditBatch | null;
}

const key = (boqId: string) => `boqlet-kept-edits:${boqId}`;

function read(boqId: string): KeptEdit[] {
  try {
    const raw = sessionStorage.getItem(key(boqId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as KeptEdit[]) : [];
  } catch {
    return [];
  }
}

export function keepEdit(boqId: string, edit: KeptEdit) {
  try {
    sessionStorage.setItem(key(boqId), JSON.stringify([...read(boqId), edit]));
  } catch {
    /* storage blocked: nothing to keep it in */
  }
}

/** The kept edits of a BoQ, removed from storage (the sheet holds them from now on). */
export function takeKeptEdits(boqId: string): KeptEdit[] {
  const list = read(boqId);
  try {
    sessionStorage.removeItem(key(boqId));
  } catch {
    /* blocked */
  }
  return list;
}
