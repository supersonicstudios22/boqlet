import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/inter-tight";
import "./globals.css";
import { AuthProvider } from "@/auth";
import { ThemeProvider } from "@/components/theme-provider";
import { APP_NAME } from "@/config";
import { NONCE_HEADER } from "@/lib/csp";
import { HydrationMark } from "@/components/hydration";
import { Splash } from "@/components/shell/splash";

export const metadata: Metadata = { title: { default: APP_NAME, template: `%s · ${APP_NAME}` } };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // The Content-Security-Policy's nonce (proxy.ts): the theme's inline script runs only with it.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <HydrationMark />
        <Splash />
        <NextIntlClientProvider>
          <ThemeProvider nonce={nonce}>
            <AuthProvider>{children}</AuthProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
