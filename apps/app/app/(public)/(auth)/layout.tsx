import type { ReactNode } from "react";
import { AuthSplit } from "@/components/shell/auth-split";

/** Sign-in, sign-up, password reset, invitations and the takeover question: the form beside the poster. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthSplit>{children}</AuthSplit>;
}
