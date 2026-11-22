"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { saveFile } from "@/api/hooks/exports";
import { publicExport, usePublicLine, usePublicLines, usePublicShare } from "@/api/hooks/shares";
import type { RunLine } from "@/api/hooks/sheet";
import { useErrorMessage } from "@/components/errors/use-error-message";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineDetailBody } from "@/features/boq-sheet/line-detail";
import { lexicon } from "@/features/library/lib/readable";
import { ModelViewer } from "@/features/viewer/model-viewer";
import { cn } from "@/lib/utils";
import { useUnit } from "@/i18n/units";
import { BoqFormatProvider, useBoqFormat, type BoqFormatSettings } from "@/i18n/boq-format";
import { InlineError } from "@/components/errors/inline-error";
import { LoadingLines } from "@/components/loading";
import { isApiError } from "@/api/errors";

/** The line's text in the grouping system (P14 item text), else the rule set's. */
const textOf = (l: RunLine, system: string | undefined) => (system ? l.codes[system]?.text : undefined) ?? l.description;

/**
 * S35 `/s/{token}` (F18 §2): a share link opened with no account. The firm, project, BoQ, version and run
 * date (WORKING unless it is a saved version), the sheet read-only with grouping and search, the line
 * detail and the 3D view and the Excel as the link includes. Nothing else of the firm's (BR-56).
 */
export function PublicSharePage({ token }: { token: string }) {
  const unitLabel = useUnit();
  const t = useTranslations("shares.public");
  const message = useErrorMessage();
  const share = usePublicShare(token);
  // BoQ values and the run date in the firm's format (TF-021, `PublicShare.numberFormat` / `dateFormat`;
  // optional: the defaults where the API doesn't send them). The line detail inside gets them too.
  const firm = share.data;
  const formats = useMemo<BoqFormatSettings | null>(
    () => (firm ? { numberFormat: firm.numberFormat ?? undefined, dateFormat: firm.dateFormat ?? undefined } : null),
    [firm],
  );
  const format = useBoqFormat(formats ?? undefined);
  const shown = !!share.data?.revisionLabel;
  const lines = usePublicLines(token, shown);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const detail = usePublicLine(token, share.data?.include.lineDetail ? selected : null);
  // TF-158: each line opens by keyboard (a button in its description cell); focus goes into the detail
  // when a line is opened from the sheet, and back to that line when the detail closes.
  const lineButtons = useRef(new Map<string, HTMLButtonElement>());
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const focusDetail = useRef(false);
  const detailShown = !!(selected && detail.data);
  useEffect(() => {
    if (detailShown && focusDetail.current) {
      focusDetail.current = false;
      detailHeading.current?.focus();
    }
  }, [detailShown, selected]);
  const openLine = (key: string) => {
    focusDetail.current = true;
    setSelected(key);
  };
  const closeDetail = () => {
    const key = selected;
    setSelected(null);
    if (key) lineButtons.current.get(key)?.focus();
  };
  const excel = useMutation({ mutationFn: async () => saveFile(await publicExport(token), `${share.data?.boqName ?? "boq"}_${share.data?.revisionLabel ?? ""}.xlsx`.replace(/[^\w.-]+/g, "-")), onError: () => {} });
  const system = share.data?.include.groupBy ?? share.data?.systems?.[0]?.id;
  const lex = useMemo(() => lexicon({}, (name) => name), []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (lines.data ?? []).filter((l) => !term || textOf(l, system).toLowerCase().includes(term) || l.description.toLowerCase().includes(term) || Object.values(l.codes).some((c) => c.code.toLowerCase().includes(term)));
  }, [lines.data, q, system]);
  const groups = useMemo(() => {
    const out = new Map<string, { code: string; title: string; lines: RunLine[] }>();
    for (const l of filtered) {
      const top = system ? l.codes[system]?.path[0] : undefined;
      const key = top?.code ?? "";
      const g = out.get(key) ?? { code: key, title: top?.title ?? "", lines: [] };
      g.lines.push(l);
      out.set(key, g);
    }
    return [...out.values()];
  }, [filtered, system]);
  const models = useMemo(() => (share.data?.modelVersionIds ?? []).map((id, i) => ({ versionId: id, label: t("viewerModel", { n: i + 1 }) })), [share.data?.modelVersionIds, t]);

  // A link revoked, expired or never made answers 404: "no longer available". Anything else (the
  // network, a rate limit, the server) is not the link's fault: say so and offer to try again (TF-017).
  if (share.isError && !(isApiError(share.error) && (share.error.status === 404 || share.error.status === 410))) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center gap-3 p-8" data-testid="share-error">
        <InlineError error={share.error} onRetry={() => share.refetch()} />
      </main>
    );
  }
  if (share.isError) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center gap-3 p-8" data-testid="share-gone">
        <h1 className="text-title">{t("gone")}</h1>
        <p className="text-muted-foreground">{t("goneHint")}</p>
      </main>
    );
  }
  if (!share.data) return <LoadingLines className="mx-auto max-w-[1400px] p-6" />;
  const s = share.data;
  const working = s.revisionStatus !== null && s.revisionStatus !== "issued";

  return (
    <BoqFormatProvider settings={formats}>
    <div className="relative mx-auto flex max-w-[1400px] flex-col gap-6 p-6" data-testid="public-share" data-working={working ? "true" : "false"}>
      {working && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden">
          <span className="rotate-[-24deg] select-none text-[18vw] font-bold leading-none text-foreground/5">{t("working")}</span>
        </div>
      )}
      <header className="relative z-10 flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-border pb-4">
        <div className="flex flex-1 flex-col gap-1">
          <span className="label-caps text-muted-foreground">
            {s.firmName} · {s.projectName}
          </span>
          <h1 className="text-title" data-testid="share-title">
            {s.boqName}
          </h1>
          {shown && (
            <p className="flex flex-wrap items-center gap-2">
              <span className="label-caps rounded-[var(--radius)] border border-foreground px-1" data-testid="share-version">
                {t("saved", { label: s.revisionLabel! })}
              </span>
              {working && (
                <span className="label-caps rounded-[var(--radius)] border border-[var(--status-attention)] px-1" title={t("workingHint")} data-testid="share-working">
                  {t("working")}
                </span>
              )}
              {s.runAt && <span className="text-muted-foreground">{t("run", { date: format.dateTime(new Date(s.runAt), { dateStyle: "medium", timeStyle: "short" }) })}</span>}
            </p>
          )}
        </div>
        {shown && s.include.excel && (
          <Button variant="outline" onClick={() => excel.mutate()} disabled={excel.isPending} data-testid="share-excel">
            <Download aria-hidden />
            {t("excel")}
          </Button>
        )}
      </header>
      {excel.error ? (
        <p role="alert" className="text-error">
          {message(excel.error)}
        </p>
      ) : null}

      {!shown ? (
        <p className="relative z-10 text-muted-foreground" data-testid="share-nothing">
          {t("nothingSaved")}
        </p>
      ) : (
        <>
          <p className="relative z-10 max-w-3xl text-muted-foreground">{t("readOnly")}</p>
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row">
            <section className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-center gap-3">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="max-w-sm" data-testid="share-search" />
                <span className="text-muted-foreground tabular-nums">{t("lines", { count: filtered.length })}</span>
              </div>
              {lines.data && filtered.length === 0 && <p className="text-muted-foreground">{t("noLines")}</p>}
              {filtered.length > 0 && (
                <Table data-testid="share-sheet">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="label-caps">{t("description")}</TableHead>
                      <TableHead className="label-caps">{t("unit")}</TableHead>
                      <TableHead className="label-caps text-right">{t("quantity")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => [
                      system ? (
                        <TableRow key={`g:${g.code}`} className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={3} className="label-caps">
                            {g.code ? `${g.code} ${g.title}` : "—"}
                          </TableCell>
                        </TableRow>
                      ) : null,
                      ...g.lines.map((l) => (
                        <TableRow
                          key={l.key}
                          className={cn(s.include.lineDetail && "cursor-pointer", selected === l.key && "bg-selection")}
                          onClick={() => s.include.lineDetail && setSelected(l.key)}
                          data-testid="share-line"
                          data-key={l.key}
                          data-source={l.source}
                        >
                          <TableCell className="max-w-[520px]">
                            {s.include.lineDetail ? (
                              <button
                                type="button"
                                ref={(el) => {
                                  if (el) lineButtons.current.set(l.key, el);
                                  else lineButtons.current.delete(l.key);
                                }}
                                onClick={() => openLine(l.key)}
                                aria-expanded={selected === l.key}
                                aria-controls={selected === l.key ? "share-detail" : undefined}
                                className="w-full rounded-[var(--radius)] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {textOf(l, system)}
                              </button>
                            ) : (
                              textOf(l, system)
                            )}
                          </TableCell>
                          <TableCell>{unitLabel(l.unit)}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.quantity === null ? "—" : format.number(l.quantity, { maximumFractionDigits: 3 })}</TableCell>
                        </TableRow>
                      )),
                    ])}
                  </TableBody>
                </Table>
              )}
            </section>
            {s.include.lineDetail && selected && detail.data && (
              <aside id="share-detail" aria-label={t("detail")} className="flex w-full flex-col gap-4 border-l border-border pl-5 lg:w-[440px] lg:shrink-0" data-testid="share-detail">
                <div className="flex items-start gap-2">
                  <h2 ref={detailHeading} tabIndex={-1} className="text-title flex-1 outline-none">
                    {textOf(detail.data, system)}
                  </h2>
                  <Button variant="ghost" aria-label={t("close")} onClick={closeDetail}>
                    <X aria-hidden />
                  </Button>
                </div>
                <LineDetailBody
                  line={detail.data}
                  groupBy={system}
                  slots={{}}
                  lex={lex}
                  libraryHref={null}
                  modelNames={new Map()}
                  systemNames={new Map((s.systems ?? []).map((x) => [x.id, x.name]))}
                  describe={(key) => lines.data?.find((l) => l.key === key)?.description}
                  onSelect={setSelected}
                  showLog={s.include.log === true}
                />
              </aside>
            )}
          </div>
          {s.include.viewer && models.length > 0 && (
            <section className="relative z-10 flex flex-col gap-2">
              <h2 className="label-caps">{t("viewer")}</h2>
              <ModelViewer models={models} lines={lines.data ?? []} publicToken={token} focusLine={selected} onOpenLine={(key) => setSelected(key)} className="h-[560px]" />
            </section>
          )}
        </>
      )}

      <footer className="relative z-10 flex items-center gap-3 border-t border-border pt-4 text-muted-foreground">
        {s.madeWithBadge ? (
          <>
            <span data-testid="share-badge">{t("madeWith")}</span>
            <Link href="/sign-up" className="text-link hover:underline">
              {t("madeWithCta")}
            </Link>
          </>
        ) : (
          <Wordmark />
        )}
      </footer>
    </div>
    </BoqFormatProvider>
  );
}
