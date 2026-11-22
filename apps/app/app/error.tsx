"use client";

import { ErrorView } from "@/components/errors/error-view";

/** Any page outside a segment with its own error view: translated, with Try again (TF-026). */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto max-w-3xl px-8">
      <ErrorView error={error} reset={retry} />
    </main>
  );
}
