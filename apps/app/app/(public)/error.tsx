"use client";

import { ErrorView } from "@/components/errors/error-view";

/** Sign-in, sign-up, invitations, the session conflict and share pages: translated, with Try again (TF-026). */
export default function PublicError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto max-w-3xl px-8">
      <ErrorView error={error} reset={retry} />
    </main>
  );
}
