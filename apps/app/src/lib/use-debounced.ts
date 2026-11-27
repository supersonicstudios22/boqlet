"use client";

import { useEffect, useState } from "react";

/** `value` once it has stopped changing for `ms` (a string or number, compared by value). */
export function useDebounced<T extends string | number | undefined>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
