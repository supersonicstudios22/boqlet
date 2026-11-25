"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Schemas } from "@ifc-boq/api";
import { isApiError } from "@/api/errors";
import { usePlans } from "@/api/hooks/models";
import { DimensionRule } from "@/components/dimension-rule";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/features/orgs/org-context";
import { checkFile, sendModelUpload, startModelUpload, UploadInterrupted, type UploadSession } from "./upload";

/** Choose an IFC file, check it, upload it with progress; an interrupted upload resumes where it stopped (F03 §2, A-40). */
export function UploadButton({
  modelId,
  label,
  onUploaded,
  variant = "default",
}: {
  modelId: string;
  label: string;
  onUploaded?: (version: Schemas["ModelVersion"]) => void;
  variant?: "default" | "outline";
}) {
  const t = useTranslations("models.upload");
  const message = useErrorMessage();
  const { org } = useOrg();
  const plans = usePlans();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [share, setShare] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The upload that stopped part way, with the share it reached: "Resume upload" continues it. */
  const [stopped, setStopped] = useState<{ session: UploadSession; share: number } | null>(null);
  const maxMb = plans.data?.find((p) => p.id === org.planId)?.entitlements.maxModelVersionMb;

  async function send(session: UploadSession) {
    setError(null);
    setStopped(null);
    let reached = 0;
    setShare(0);
    try {
      const version = await sendModelUpload(
        session,
        (s) => {
          reached = s;
          setShare(s);
          setRetrying(false);
        },
        { onRetry: () => setRetrying(true) },
      );
      await Promise.all([client.invalidateQueries({ queryKey: ["models"] }), client.invalidateQueries({ queryKey: ["modelVersions"] }), client.invalidateQueries({ queryKey: ["model", modelId] })]);
      onUploaded?.(version);
    } catch (e) {
      if (e instanceof UploadInterrupted) {
        setStopped({ session: e.session, share: reached });
        setError(message(e.cause));
      } else if (!(isApiError(e) && e.status === 402)) setError(message(e));      // 402: the limit dialog (global handler)
    } finally {
      setShare(null);
      setRetrying(false);
    }
  }

  async function upload(file: File) {
    setError(null);
    setStopped(null);
    const problem = checkFile(file, maxMb);
    if (input.current) input.current.value = "";
    if (problem) return setError(problem === "not_ifc" ? t("notIfc") : t("tooLarge", { max: maxMb ?? 0 }));
    let session: UploadSession;
    setShare(0);
    try {
      session = await startModelUpload(modelId, file);
    } catch (e) {
      setShare(null);
      if (!(isApiError(e) && e.status === 402)) setError(message(e));
      return;
    }
    await send(session);
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept=".ifc"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
        data-testid={`upload-input-${modelId}`}
      />
      <Button variant={variant} onClick={() => input.current?.click()} disabled={share !== null} data-testid={`upload-${modelId}`}>
        {label}
      </Button>
      {share !== null && (
        <DimensionRule progress={share} label={t(retrying ? "retrying" : "uploading", { pct: Math.round(share * 100) })} className="max-w-64" />
      )}
      {stopped && share === null && (
        <div className="flex flex-col gap-1" data-testid="upload-stopped">
          <p role="alert" className="text-error" data-testid="upload-error">
            {t("stopped", { pct: Math.round(stopped.share * 100), name: stopped.session.file.name })} {error}
          </p>
          <Button variant="outline" size="sm" className="self-start" onClick={() => void send(stopped.session)} data-testid={`upload-resume-${modelId}`}>
            {t("resume")}
          </Button>
        </div>
      )}
      {error && !stopped && (
        <p role="alert" className="text-error" data-testid="upload-error">
          {error}
        </p>
      )}
    </div>
  );
}
