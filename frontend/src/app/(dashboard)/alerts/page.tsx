import type { Metadata } from "next";

import { AlertsClient } from "@/components/alerts-client";

export const metadata: Metadata = { title: "告警中心" };

export default function AlertsPage() {
  return <AlertsClient />;
}
