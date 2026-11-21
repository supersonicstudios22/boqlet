"use client";

import { Suspense } from "react";
import { authAdapter } from "@/auth";

/** S01: the adapter's sign-up page (a setup link or an invitation, P50). */
export default function SignUpPage() {
  const Page = authAdapter.SignUpPage ?? authAdapter.SignInPage;
  return <Suspense>{Page ? <Page /> : null}</Suspense>;
}
