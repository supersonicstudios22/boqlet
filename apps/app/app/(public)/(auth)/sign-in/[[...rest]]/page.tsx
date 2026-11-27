"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authAdapter } from "@/auth";
import { usePageTitle } from "@/lib/page-title";

/** S01: the adapter's sign-in page, and why one was signed out (F01 §10). */
export default function SignInPage() {
  usePageTitle(1, useTranslations("auth.native")("signIn"));
  const Page = authAdapter.SignInPage;
  return (
    <Suspense>
      <SignedOutNotice />
      {Page ? <Page /> : null}
    </Suspense>
  );
}

function SignedOutNotice() {
  const t = useTranslations("auth.signedOut");
  const reason = useSearchParams().get("reason");
  if (!reason || !t.has(reason)) return null;
  return (
    <p role="status" className="border-l-2 border-[var(--status-attention)] py-2 pl-3" data-testid="signed-out-reason">
      {t(reason)}
    </p>
  );
}
