"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useNames } from "@/api/hooks/models";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InlineError } from "@/components/errors/inline-error";

/**
 * The names preview (F03 §5): distinct material and type names in the model and whether the
 * project's dictionaries resolve them, so upcoming name questions are visible before generating.
 */
export function NamesPreview({ versionId }: { versionId: string }) {
  const t = useTranslations("models.names");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const names = useNames(versionId, open);
  const rows = useMemo(() => [...(names.data?.names ?? [])].sort((a, b) => Number(!!a.term) - Number(!!b.term) || b.count - a.count), [names.data]);
  const unresolved = rows.filter((n) => !n.term).length;

  return (
    <section className="flex flex-col gap-3" data-testid="names-preview">
      <div className="flex items-center gap-4">
        <h3 className="label-caps flex-1">{t("title")}</h3>
        {!open && (
          <Button variant="outline" onClick={() => setOpen(true)} data-testid="load-names">
            {t("load")}
          </Button>
        )}
      </div>
      <p className="prose-text text-muted-foreground">{t("intro")}</p>
      {names.isError && (
        <InlineError error={names.error} onRetry={() => names.refetch()} />
      )}
      {names.isFetching && <p className="text-muted-foreground">{t("loading")}</p>}
      {names.data && (
        <>
          <p data-testid="names-summary">{t("summary", { total: rows.length, unresolved })}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="label-caps">{t("field")}</TableHead>
                <TableHead className="label-caps">{t("name")}</TableHead>
                <TableHead className="label-caps">{t("term")}</TableHead>
                <TableHead className="label-caps text-right">{t("elements")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((n) => (
                <TableRow key={`${n.field}:${n.raw}`}>
                  <TableCell className="text-muted-foreground">{n.field}</TableCell>
                  <TableCell>{n.raw}</TableCell>
                  <TableCell>
                    {n.term ? (
                      n.term
                    ) : (
                      <span className="label-caps rounded-[var(--radius)] bg-attention px-1 text-on-fill">{n.worthAsking ? t("willAsk") : t("unresolved")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format.number(n.count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}
