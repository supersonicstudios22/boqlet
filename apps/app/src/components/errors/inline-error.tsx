"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useErrorMessage } from "./use-error-message";

/**
 * A query that failed, inline (screens.md "error: message + retry", frontend.md data layer rule 6,
 * TF-017): the translated reason and Try again.
 */
export function InlineError({ error, onRetry, className }: { error: unknown; onRetry?: () => unknown; className?: string }) {
  const t = useTranslations("common");
  const message = useErrorMessage();
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-3", className)} data-testid="inline-error">
      <p className="text-error">{message(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={() => void onRetry()} data-testid="inline-error-retry">
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
