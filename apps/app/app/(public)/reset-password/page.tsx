"use client";

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { authAdapter } from "@/auth";
import { usePageTitle } from "@/lib/page-title";

/** Self-service password reset (P57): ask for a reset link by email. Only where passwords live in the app. */
export default function ResetPasswordPage() {
  usePageTitle(1, useTranslations("auth.native")("resetTitle"));
  const Page = authAdapter.ResetPasswordPage;
  if (!Page) notFound();
  return (
    <Suspense>
      <Page />
    </Suspense>
  );
}
