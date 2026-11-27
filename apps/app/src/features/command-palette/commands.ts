/**
 * The command palette's actions in context (review C-09, DEC-75): a page registers what can be done where the person
 * is ("Generate again", "Export Excel", "Go to questions" in a BoQ), the palette lists them first. A tiny store
 * outside React, so a page deep in the tree and the palette in the top bar share it without a provider.
 */
import { useEffect, useRef } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  /** Shown greyed with this reason instead of running. */
  disabledReason?: string;
  run: () => void;
}

const sets = new Map<string, PaletteCommand[]>();
const listeners = new Set<() => void>();
let snapshot: readonly PaletteCommand[] = [];

function emit() {
  snapshot = [...sets.values()].flat();
  for (const l of listeners) l();
}

export function subscribeCommands(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const commandsSnapshot = () => snapshot;
const NONE: readonly PaletteCommand[] = [];
export const noCommands = () => NONE;

/** What a set shows (labels and reasons): the store only changes, and the palette only re-renders, when that does. */
const signature = (commands: readonly PaletteCommand[]) => commands.map((c) => `${c.id}\u0000${c.label}\u0000${c.disabledReason ?? ""}`).join("\u0001");

/**
 * Registers `commands` under `owner` while the component is mounted; each runs the latest handler it was given.
 */
export function useRegisterCommands(owner: string, commands: readonly PaletteCommand[]) {
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  const sig = signature(commands);
  useEffect(() => {
    const ids = sig ? latest.current.map((c) => c.id) : [];
    sets.set(
      owner,
      ids.map((id) => {
        const c = latest.current.find((x) => x.id === id)!;
        return { id, label: c.label, disabledReason: c.disabledReason, run: () => latest.current.find((x) => x.id === id)?.run() };
      }),
    );
    emit();
    return () => {
      sets.delete(owner);
      emit();
    };
  }, [owner, sig]);
}

/** Case- and accent-insensitive "contains"; names that start with the text rank first (as the API's search). */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function matches(label: string, query: string): boolean {
  const q = fold(query.trim());
  return q === "" || fold(label).includes(q);
}

export function byMatch<T extends { label: string }>(items: readonly T[], query: string): T[] {
  const q = fold(query.trim());
  return items.filter((i) => matches(i.label, query)).sort((a, b) => Number(fold(b.label).startsWith(q)) - Number(fold(a.label).startsWith(q)));
}
