"use client";

import { use } from "react";
import { AdminPlanEditor } from "@/features/admin/plans";

export default function AdminPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  return <AdminPlanEditor planId={decodeURIComponent(planId)} />;
}
