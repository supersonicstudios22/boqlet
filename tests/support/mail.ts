import { ROOT_URL, TARGET } from "./env";

/**
 * Emails the backend sent (invitations carry their token only by email). Mock: its outbox at
 * `/_dev/outbox`. Java: the MailHog the Java suite test runs (its real SMTP sender delivers there).
 */
export interface SentMail {
  to: string;
  subject: string;
  kind: string;
  links: string[];
}

export async function mailsTo(email: string): Promise<SentMail[]> {
  if (TARGET === "java") return mailHog(email);
  if (TARGET !== "mock") throw new Error(`no mail sink for target ${TARGET} yet`);
  const res = await fetch(`${ROOT_URL}/_dev/outbox`);
  return ((await res.json()) as SentMail[]).filter((m) => m.to.toLowerCase() === email.toLowerCase());
}

interface MailHogMessage {
  Content: { Headers: Record<string, string[] | undefined>; Body: string };
  MIME?: { Parts?: { Headers: Record<string, string[] | undefined>; Body: string }[] } | null;
}

/**
 * Java sends real SMTP. The Java suite test runs MailHog and passes its HTTP API as
 * `BOQLET_SUITE_MAILHOG`. MailHog lists the newest message first, like the mock's outbox is read here.
 */
async function mailHog(email: string): Promise<SentMail[]> {
  const base = process.env.BOQLET_SUITE_MAILHOG;
  if (!base) throw new Error("BOQLET_SUITE_MAILHOG is not set (the MailHog API the Java suite test runs)");
  const read = async () => {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/v2/search?kind=to&query=${encodeURIComponent(email)}&limit=250`);
    if (!res.ok) throw new Error(`MailHog answered ${res.status}`);
    const { items } = (await res.json()) as { items: MailHogMessage[] };
    return items.map((m): SentMail => {
      const body = [m.Content.Body, ...(m.MIME?.Parts ?? []).map((p) => p.Body)].map(decodeQuotedPrintable).join("\n");
      const header = (name: string) => m.Content.Headers[name]?.[0] ?? "";
      return {
        to: header("To"),
        subject: decodeHeader(header("Subject")),
        kind: header("X-Boqlet-Kind"),
        links: [...new Set(body.match(/https?:\/\/[^\s"'<>)]+/g) ?? [])],
      };
    });
  };
  // Java's sender polls its outbox: wait until everything due is sent (the suite test's /_test/mail/settle).
  const settled = await fetch(`${ROOT_URL}/_test/mail/settle`, { method: "POST" });
  if (!settled.ok) throw new Error(`/_test/mail/settle answered ${settled.status}`);
  return read();
}

const decodeQuotedPrintable = (text: string) =>
  text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** RFC 2047 encoded words (`=?UTF-8?Q?…?=` / `=?UTF-8?B?…?=`), as JavaMail writes non-ASCII subjects. */
function decodeHeader(value: string) {
  return value.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, _charset: string, mode: string, text: string) =>
    mode.toUpperCase() === "B"
      ? Buffer.from(text, "base64").toString("utf8")
      : Buffer.from(decodeQuotedPrintable(text.replace(/_/g, " ")), "latin1").toString("utf8"));
}

/** The token of the newest invitation sent to `email` (from its `/invite/<token>` link). */
export async function invitationToken(email: string): Promise<string> {
  const link = (await mailsTo(email)).flatMap((m) => m.links).find((l) => l.includes("/invite/"));
  if (!link) throw new Error(`no invitation mail to ${email}`);
  return link.split("/invite/")[1]!;
}
