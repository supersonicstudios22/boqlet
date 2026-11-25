"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemes } from "next-themes";

/** Light by default; dark when the OS asks for it, or when the user switches (design-guidelines.md). */
export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  // `nonce`: the page's Content-Security-Policy nonce, for the inline script that sets the theme before paint.
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="boqlet-theme" nonce={nonce}>
      {children}
    </NextThemes>
  );
}
