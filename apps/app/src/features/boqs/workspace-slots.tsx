"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Places in the BoQ workspace's chrome that a tab's content fills (review C-01): the end of the tabs row,
 * where the sheet puts its one-line "not in the models" bar, so the sheet doesn't spend a row of its own on it.
 */
export interface WorkspaceSlots {
  tabsEnd: HTMLElement | null;
}

const Slots = createContext<WorkspaceSlots | null>(null);

export const WorkspaceSlotsProvider = Slots.Provider;

/** Renders `children` at the end of the workspace's tabs row, or where it stands when there is no such row. */
export function InTabsRow({ children }: { children: ReactNode }) {
  const slot = useContext(Slots)?.tabsEnd;
  return slot ? createPortal(children, slot) : <>{children}</>;
}
