"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { Button } from "@/components/ui/button";

/**
 * "Remove model" (Q50, TF-080, F03): archives the model (`DELETE /models/{modelId}`), so it leaves the
 * models list; its versions stay for the BoQs and saved versions that use them.
 */
export function RemoveModel({ modelId, name, projectId, listHref }: { modelId: string; name: string; projectId: string; listHref: string }) {
  const t = useTranslations("models.remove");
  const message = useErrorMessage();
  const client = useQueryClient();
  const router = useRouter();
  const remove = useMutation({
    mutationFn: async () => api.DELETE("/models/{modelId}", { params: { path: { modelId } } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.models(projectId) });
      client.removeQueries({ queryKey: keys.model(modelId) });
      toast.success(t("done", { name }));
      router.push(listHref);
    },
    onError: (error) => toast.error(message(error)),
  });
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" data-testid="remove-model">
          {t("action")}
        </Button>
      }
      title={t("title", { name })}
      body={t("body")}
      confirm={t("action")}
      destructive
      testId="remove-model-confirm"
      onConfirm={() => remove.mutateAsync()}
    />
  );
}
