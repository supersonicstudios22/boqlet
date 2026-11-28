"use client";

import { use } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import { useAuth, useSession } from "@/auth";
import { openAppSession } from "@/auth/app-session";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { Button } from "@/components/ui/button";
import { JoinForm } from "@/features/orgs/join-form";
import { rememberOrg } from "@/features/orgs/org-context";

/** S03: accept an invitation (F01 §6). The signed-in email must match the invited one. */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations("orgs.invite");
  const roles = useTranslations("common.roles");
  const message = useErrorMessage();
  const auth = useAuth();
  const session = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const returnTo = `/invite/${token}`;

  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: async () => (await api.GET("/invitations/{token}", { params: { path: { token } } })).data!,
    throwOnError: false,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async () => {
      if (auth.appSession() === null) {
        const opened = await openAppSession();
        if (opened.kind === "conflict") {
          router.replace(`/session-conflict?returnTo=${encodeURIComponent(returnTo)}`);
          return { kind: "session-conflict" } as const;
        }
      }
      const before = new Set(((await api.GET("/me")).data?.memberships ?? []).map((m) => m.org.id));
      await api.POST("/invitations/{token}/accept", { params: { path: { token } } });
      const after = (await api.GET("/me")).data!;
      return { kind: "accepted", slug: after.memberships.find((m) => !before.has(m.org.id))?.org.slug } as const;
    },
    onSuccess: async (result) => {
      if (result.kind !== "accepted") return;
      const { slug } = result;
      await client.invalidateQueries({ queryKey: keys.me() });
      if (slug) rememberOrg(slug);
      router.push(slug ? `/${slug}` : "/app");
    },
    onError: () => {},
  });

  const inv = preview.data;
  const emailMismatch =
    session.status === "authenticated" && inv && session.email && session.email.toLowerCase() !== inv.email.toLowerCase();

  return (
    <main>
      <div className="flex flex-col gap-6" data-testid="invitation">
        {preview.isPending && <p className="text-muted-foreground">{t("loading")}</p>}
        {preview.isError && (
          <p role="alert" className="prose-text">
            {t("notFound")}
          </p>
        )}
        {inv && (
          <>
            <div className="flex flex-col gap-3">
              <p className="label-caps text-muted-foreground">{t("label")}</p>
              <h1 className="display text-display-sm">{t("title", { org: inv.orgName })}</h1>
              <p className="prose-text">
                {inv.invitedBy
                  ? t("bodyFrom", { inviter: inv.invitedBy, email: inv.email, role: roles.has(inv.role) ? roles(inv.role) : inv.role })
                  : t("body", { email: inv.email, role: roles.has(inv.role) ? roles(inv.role) : inv.role })}
              </p>
            </div>
            {inv.status !== "pending" && (
              <p role="alert" className="prose-text" data-testid="invitation-status">
                {t(`status.${inv.status}`)}
              </p>
            )}
            {/* Review C-31: an address without an account makes it and joins here, in one step. */}
            {inv.status === "pending" && session.status === "anonymous" && inv.hasAccount === false && auth.createAccountFromInvitation && (
              <JoinForm token={token} onSignIn={() => void auth.signIn({ returnTo, email: inv.email })} />
            )}
            {inv.status === "pending" && session.status === "anonymous" && !(inv.hasAccount === false && auth.createAccountFromInvitation) && (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground">{t("signInFirst")}</p>
                <div>
                  <Button onClick={() => void auth.signIn({ returnTo, email: inv.email })} data-testid="invite-sign-in">
                    {t("signIn")}
                  </Button>
                </div>
              </div>
            )}
            {inv.status === "pending" && emailMismatch && (
              <div className="flex flex-col gap-3" data-testid="email-mismatch">
                <p role="alert" className="prose-text">
                  {t("mismatch", { signedIn: session.email ?? "", invited: inv.email })}
                </p>
                <div>
                  <Button variant="outline" onClick={() => void auth.signOut({ returnTo })}>
                    {t("otherAccount")}
                  </Button>
                </div>
              </div>
            )}
            {inv.status === "pending" && session.status === "authenticated" && !emailMismatch && (
              <div className="flex flex-col gap-2">
                {accept.error && (
                  <p role="alert" className="text-error">
                    {message(accept.error)}
                  </p>
                )}
                <div>
                  <Button onClick={() => accept.mutate()} disabled={accept.isPending} data-testid="accept-invitation">
                    {t("accept")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
