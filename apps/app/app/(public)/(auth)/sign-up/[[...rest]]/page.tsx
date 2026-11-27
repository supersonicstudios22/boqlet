"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { authAdapter } from "@/auth";
import { usePageTitle } from "@/lib/page-title";
import { useTranslations } from "next-intl";

/** S01: the adapter's sign-up page: a link sets a password (setup, reset or invitation, P50); without one, public sign-up (P57). */
export default function SignUpPage() {
  const Page = authAdapter.SignUpPage ?? authAdapter.SignInPage;
  return <Suspense>{Page ? <Titled><Page /></Titled> : null}</Suspense>;
}

function Titled({ children }: { children: React.ReactNode }) {
  const t = useTranslations("auth.native");
  const query = useSearchParams();
  const linked = query.get("token") || query.get("returnTo")?.startsWith("/invite/");
  usePageTitle(1, t(query.get("reset") === "1" ? "newPassword" : linked ? "setPassword" : "createAccount"));
  return children;
}
