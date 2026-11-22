"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Schemas } from "@ifc-boq/api";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import { useSession } from "@/auth";

/** `GET /me`: the user, their orgs and roles. Org-level permissions come from here (`orgCan`). */
export function useMe() {
  const session = useSession();
  return useQuery({
    queryKey: keys.me(),
    enabled: session.status === "authenticated",
    queryFn: async () => (await api.GET("/me")).data!,
  });
}

/**
 * Saves interface preferences on the server (`PATCH /me`, Q55, TF-109), so they follow the user to every
 * browser. The cached `GET /me` changes at once; a failed save reloads it.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (preferences: Schemas["UserPreferences"]) => (await api.PATCH("/me", { body: { preferences } })).data!,
    onMutate: (preferences) => {
      queryClient.setQueryData<Schemas["Me"]>(keys.me(), (me) => (me ? { ...me, preferences: { ...me.preferences, ...preferences } } : me));
    },
    onError: () => queryClient.invalidateQueries({ queryKey: keys.me() }),
  });
}
