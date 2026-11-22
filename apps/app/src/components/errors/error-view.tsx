"use client";

import { useTranslations } from "next-intl";
import { errorReference, isApiError } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { NotFoundView } from "./not-found-view";

/** A route's error boundary body: the not-found page for API 404s, otherwise message, retry and a server failure's request id. */
export function ErrorView({ error, reset }: { error: unknown; reset: () => void }) {
  const t = useTranslations("common");
  const te = useTranslations("errors");
  if (isApiError(error) && error.status === 404) return <NotFoundView />;
  const reference = errorReference(error);
  return (
    <div className="flex flex-col items-start gap-4 py-16" role="alert" data-testid="error-view">
      <h1 className="text-title">{t("error.title")}</h1>
      <p className="prose-text text-muted-foreground">{t("error.body")}</p>
      {reference && (
        <p className="text-xs text-muted-foreground" data-testid="error-reference">
          {te("reference", { id: reference })}
        </p>
      )}
      <div className="h-0.5 w-16 bg-error" aria-hidden />
      <Button onClick={reset}>{t("retry")}</Button>
    </div>
  );
}
