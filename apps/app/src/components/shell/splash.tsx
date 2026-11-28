"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { ANIMATED_WORDMARK_MS, AnimatedWordmark } from "./animated-wordmark";
import styles from "./splash.module.css";

const KEY = "boqlet-splash";
/** The animation's length (docs/brand/boqlet.mp4). */
const PLAY_MS = ANIMATED_WORDMARK_MS;
/** With reduced motion: the finished logo, this long in all, with no fade (review C-33, DEC-52). */
const STILL_MS = 300;
const FADE_MS = 300;

/** Called by a sign-in just before it loads the app: the next page opens with the splash. */
export function requestSplash() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // No storage (private mode limits): no splash.
  }
}

// Read once per page load and cleared at once, so a reload or a later visit doesn't play it again.
let pending: boolean | null = null;
const listeners = new Set<() => void>();

function take(): boolean {
  if (pending === null) {
    try {
      pending = sessionStorage.getItem(KEY) === "1";
      sessionStorage.removeItem(KEY);
    } catch {
      pending = false;
    }
  }
  return pending;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function finish() {
  pending = false;
  for (const listener of listeners) listener();
}

/**
 * The splash after a sign-in: the logo animation over the app while it loads underneath, then a fade
 * into it. A click or any key skips it. Shown once per sign-in (`requestSplash`), never on a reload.
 */
export function Splash() {
  const show = useSyncExternalStore(subscribe, take, () => false);
  return show ? <SplashScreen /> : null;
}

function SplashScreen() {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion: the still logo, then the app at once (a fade is motion too).
    const timer = setTimeout(still ? finish : () => setLeaving(true), still ? STILL_MS : PLAY_MS);
    const skip = () => (still ? finish() : setLeaving(true));
    window.addEventListener("keydown", skip);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(finish, FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <div
      aria-hidden
      data-testid="splash"
      className={cn(styles.screen, leaving && styles.leaving)}
      onClick={() => setLeaving(true)}
    >
      <AnimatedWordmark className={styles.logo} />
    </div>
  );
}
