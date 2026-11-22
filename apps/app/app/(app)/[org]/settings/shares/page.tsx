"use client";

import { useTranslations } from "next-intl";
import { useOrgShareLinks } from "@/api/hooks/shares";
import { useOrg } from "@/features/orgs/org-context";
import { LinkRow } from "@/features/shares/share-dialog";
import { InlineError } from "@/components/errors/inline-error";
import { LoadingLines } from "@/components/loading";

/** F18 §3: every share link of the org's BoQs (owners and admins), each revocable. */
export default function ShareLinksSettingsPage() {
  const t = useTranslations("shares");
  const { org, can } = useOrg();
  const links = useOrgShareLinks(org.id);
  if (!can("manageShareLinks")) return <p className="text-muted-foreground">{t("notAllowed")}</p>;
  return (
    <section className="flex flex-col gap-3" data-testid="org-share-links">
      <p className="text-muted-foreground">{t("orgIntro")}</p>
      {links.isError && (
        <InlineError error={links.error} onRetry={() => links.refetch()} />
      )}
      {links.isPending && <LoadingLines />}
      {links.data && links.data.length === 0 && <p className="text-muted-foreground">{t("noOrgLinks")}</p>}
      {(links.data ?? []).map((l) => (
        <LinkRow key={l.id} link={l} showBoq />
      ))}
    </section>
  );
}
