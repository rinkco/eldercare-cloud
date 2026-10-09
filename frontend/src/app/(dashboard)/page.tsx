import type { Metadata } from "next";

import { OverviewClient } from "@/components/overview-client";

export const metadata: Metadata = { title: "概览台" };

export default function DashboardPage() {
  return <OverviewClient />;
}
