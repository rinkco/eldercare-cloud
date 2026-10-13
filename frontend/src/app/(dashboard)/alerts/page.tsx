import type { Metadata } from "next";

import { AlertsEventsClient } from "@/components/alerts-events-client";

export const metadata: Metadata = { title: "告警与事件" };

export default function AlertsPage() {
  return <AlertsEventsClient />;
}
