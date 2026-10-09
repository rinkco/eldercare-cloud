import type { Metadata } from "next";

import { EventsClient } from "@/components/events-client";

export const metadata: Metadata = { title: "事件记录" };

export default function EventsPage() {
  return <EventsClient />;
}
