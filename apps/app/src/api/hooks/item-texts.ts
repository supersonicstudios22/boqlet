"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Schemas } from "@ifc-boq/api";
import { api } from "@/api/client";
import { keys } from "@/api/keys";

/**
 * Item texts filled by the engine for the Library's "Reads as" and samples (review B-13, BR-01): the app
 * keeps no copy of the engine's blanks or number format. A page of codes asks for many at once, so the
 * requests made within one short window go out as one call (at most `PAGE` items each), and each is
 * debounced while it is typed.
 */

export type ItemTextSample = Schemas["ItemTextSample"];
export type ItemTextPiece = Schemas["ItemTextPiece"];
export type ItemTextRequest = { template: string; line?: { keys?: Record<string, unknown>; unit?: string | null; quantity?: number | null }; filled?: string; filledFrom?: string };

const PAGE = 500;
const WINDOW_MS = 15;
const TYPING_MS = 250;

type Waiting = { item: ItemTextRequest; resolve: (s: ItemTextSample) => void; reject: (e: unknown) => void };
let waiting: Waiting[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = waiting;
  waiting = [];
  for (let i = 0; i < batch.length; i += PAGE) {
    const chunk = batch.slice(i, i + PAGE);
    try {
      const { data, error } = await api.POST("/presets/item-texts/sample", { body: { items: chunk.map((w) => w.item) } });
      if (error || !data) throw error ?? new Error("item_text_sample");
      chunk.forEach((w, j) => w.resolve(data.results[j]!));
    } catch (e) {
      chunk.forEach((w) => w.reject(e));
    }
  }
}

/** One item text through the shared batch. */
export function sampleItemText(item: ItemTextRequest): Promise<ItemTextSample> {
  return new Promise((resolve, reject) => {
    waiting.push({ item, resolve, reject });
    timer ??= setTimeout(() => void flush(), WINDOW_MS);
  });
}

function useDebouncedKey(key: string, ms: number): string {
  const [v, setV] = useState(key);
  useEffect(() => {
    const id = setTimeout(() => setV(key), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return v;
}

/** The engine's pieces for an item text; the previous answer stays shown while a new one is on its way. */
export function useItemTextSample(item: ItemTextRequest | null) {
  const request = useDebouncedKey(item && item.template.trim() ? JSON.stringify(item) : "", TYPING_MS);
  return useQuery({
    queryKey: keys.itemTextSample(request),
    enabled: request !== "",
    queryFn: () => sampleItemText(JSON.parse(request) as ItemTextRequest),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

/** A rule set's slot renamed by the engine, which parses the expressions (FM-42); nothing is saved. */
export async function renamePresetParam<T extends object>(doc: T, from: string, to: string): Promise<T> {
  const { data, error } = await api.POST("/presets/rename-param", { body: { doc, from, to } });
  if (error || !data) throw error ?? new Error("rename_param");
  return data.doc as T;
}
