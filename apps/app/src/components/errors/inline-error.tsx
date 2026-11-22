"use client";

import { useTranslations } from "next-intl";
import { errorReference } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useErrorMessage } from "./use-error-message";

/**
 * A query that failed, inline (screens.md "error: message + retry", frontend.md data layer rule 6,
 * TF-017): the translated reason and Try again; a server failure's request id (TF-185).
 */
export function InlineError({ error, onRetry, className }: { error: unknown; onRetry?: () => unknown; className?: string }) {
  const t = useTranslations("common");
  const te = useTranslations("errors");
  const message = useErrorMessage();
  const reference = errorReference(error);
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-3", className)} data-testid="inline-error">
      <p className="text-error">{message(error)}</p>
      {reference && (
        <p className="text-xs text-muted-foreground" data-testid="error-reference">
          {te("reference", { id: reference })}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={() => void onRetry()} data-testid="inline-error-retry">
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
