"use client";

import { useUpdateInputs, type Boq, type RevisionInputs } from "@/api/hooks/boqs";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { NewerPresets } from "@/features/library/newer-presets";

/**
 * Review A-44: next to "New model version available", the working version's presets that have a newer published
 * version ("Use version n", a pending change like any input edit) or are archived. Saved versions keep theirs (BR-07).
 */
export function NewPresetVersions({ boq }: { boq: Boq }) {
  const message = useErrorMessage();
  const revision = boq.currentRevision;
  const update = useUpdateInputs(revision.id, boq.id);
  if (boq.archived || revision.status === "issued") return null;
  const editable = boq.status !== "confirmed" && revision.permissions.editBoqs === true;
  return (
    <div className="flex flex-col gap-1">
      <NewerPresets
        list={revision.presetInputs}
        ids={revision.inputs}
        editable={editable}
        pending={update.isPending}
        onUse={(patch) => update.mutate(patch as Partial<RevisionInputs>)}
        testId="new-preset-version"
      />
      {update.error ? (
        <p role="alert" className="text-error">
          {message(update.error)}
        </p>
      ) : null}
    </div>
  );
}
