"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { LOGO_B, LOGO_LET, LOGO_O, LOGO_Q, LOGO_VIEW_BOX } from "./logo";
import styles from "./splash.module.css";

const KEY = "boqlet-splash";
/** The animation's length (docs/brand/boqlet.mp4, timeline in splash.module.css). */
const PLAY_MS = 5333;
/** With reduced motion: the finished logo, this long. */
const STILL_MS = 800;
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
  const clip = useId();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setLeaving(true), still ? STILL_MS : PLAY_MS);
    const skip = () => setLeaving(true);
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
      <svg viewBox={LOGO_VIEW_BOX} className={styles.logo}>
        <defs>
          <clipPath id={clip}>
            <rect className={styles.grow} x={0} y={-720} width={3600} height={940} />
          </clipPath>
        </defs>
        <g className={styles.word}>
          <g className={styles.boq}>
            <g className={styles.outer}>
              <g className={styles.left}>
                <path d={LOGO_O} />
              </g>
              <g className={styles.right}>
                <path d={LOGO_O} />
              </g>
            </g>
            <g className={styles.stems} clipPath={`url(#${clip})`}>
              <path d={LOGO_B} />
              <path d={LOGO_Q} />
            </g>
            <path className={styles.pop} d={LOGO_O} />
          </g>
          <g className={styles.let} fill="currentColor">
            {LOGO_LET.map((d) => <path key={d} d={d} />)}
          </g>
        </g>
      </svg>
    </div>
  );
}
