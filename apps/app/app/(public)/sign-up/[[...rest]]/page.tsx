"use client";

import { Suspense } from "react";
import { authAdapter } from "@/auth";
import { usePageTitle } from "@/lib/page-title";
import { useTranslations } from "next-intl";

/** S01: the adapter's sign-up page (a setup link or an invitation, P50). */
export default function SignUpPage() {
  usePageTitle(1, useTranslations("auth.native")("setPassword"));
  const Page = authAdapter.SignUpPage ?? authAdapter.SignInPage;
  return <Suspense>{Page ? <Page /> : null}</Suspense>;
}
