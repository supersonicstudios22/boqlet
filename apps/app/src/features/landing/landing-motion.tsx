"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/auth";
import { APP_HOME } from "@/auth/AuthAdapter";
import styles from "./landing.module.css";

/** Where a section counts as seen: a little above the bottom edge, so it draws while it is in view. */
const ROOT_MARGIN = "0px 0px -12% 0px";
const MOTION = styles.motion ?? "motion";
const DRAWN = styles.drawn ?? "drawn";

/**
 * The landing page's only JavaScript. It turns the draw-in on (`.motion` on the page, never with reduced
 * motion) and draws each section once, the first time it enters the viewport (`.drawn`). Until it runs the
 * page is fully drawn, so a server render or a visit without JavaScript never misses a line.
 *
 * It also sends a signed-in visitor to the app when the server had no hint of it (signed-in-hint.ts):
 * the session is checked here as on every page.
 */
export function LandingMotion() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.status === "authenticated") router.replace(APP_HOME);
  }, [session.status, router]);

  useEffect(() => {
    const page = document.querySelector<HTMLElement>("[data-landing]");
    if (!page || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(DRAWN);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    page.classList.add(MOTION);
    page.querySelectorAll("[data-draw]").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return null;
}
