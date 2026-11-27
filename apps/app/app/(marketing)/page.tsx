import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { APP_HOME } from "@/auth/AuthAdapter";
import { SIGNED_IN_HINT } from "@/auth/signed-in-hint";
import { APP_NAME } from "@/config";
import { LandingPage } from "@/features/landing/landing-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.meta");
  // TODO(owner): an Open Graph image and the canonical URL, once the domain is settled (P58).
  // An absolute title: the layout's "%s · boqlet" template would name the product twice.
  return { title: { absolute: t("title", { appName: APP_NAME }) }, description: t("description") };
}

/**
 * `/`: the public landing page (P58). A browser that was signed in goes straight to the app, decided here on
 * the server from the hint (signed-in-hint.ts), so nothing of the landing page is drawn first.
 */
export default async function Home() {
  if ((await cookies()).has(SIGNED_IN_HINT)) redirect(APP_HOME);
  return <LandingPage />;
}
