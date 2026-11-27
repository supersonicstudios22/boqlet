"use client";

import { useId } from "react";
import { APP_NAME } from "@/config";
import { cn } from "@/lib/utils";
import { LOGO_B, LOGO_LET, LOGO_O, LOGO_Q, LOGO_VIEW_BOX } from "./logo";
import styles from "./animated-wordmark.module.css";

/** How long the animation plays (docs/brand/boqlet.mp4; the timeline is in animated-wordmark.module.css). */
export const ANIMATED_WORDMARK_MS = 5333;

/**
 * The logo animation ("o", "ooo", "boq", "boqlet"), played once when it mounts. The sign-in splash, the
 * landing page and the sign-in pages all draw this one component, from the same letter shapes as the
 * static `Wordmark`. With `prefers-reduced-motion` it is the finished logo. Width comes from `className`.
 */
export function AnimatedWordmark({ className }: { className?: string }) {
  const clip = useId();
  return (
    <svg viewBox={LOGO_VIEW_BOX} role="img" aria-label={APP_NAME} className={cn(styles.logo, className)}>
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
  );
}
