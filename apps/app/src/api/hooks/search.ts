"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Schemas } from "@ifc-boq/api";
import { api } from "@/api/client";
import { keys } from "@/api/keys";

export type SearchHit = Schemas["SearchHit"];

/** The command palette's search (review C-09): names in the org the caller can open, `GET /orgs/{orgId}/search`. */
export function useOrgSearch(orgId: string | undefined, q: string) {
  const text = q.trim();
  return useQuery({
    queryKey: keys.search(orgId ?? "none", text),
    enabled: !!orgId && text.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.GET("/orgs/{orgId}/search", { params: { path: { orgId: orgId! }, query: { q: text.slice(0, 200) } } })).data!.items,
  });
}
