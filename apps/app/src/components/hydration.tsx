"use client";

import { useEffect, useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True once React runs this page in the browser (false on the server and in the server HTML before
 * hydration). A form whose submit isn't wired yet keeps its button disabled until then (TF-188: a
 * submit before hydration was a native GET that put the password in the URL).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** `<html data-hydrated="true">` once the app runs in the browser (for browser tests, TF-188). */
export function HydrationMark() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}
