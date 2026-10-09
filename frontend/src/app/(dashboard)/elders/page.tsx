import type { Metadata } from "next";

import { EldersClient } from "@/components/elders-client";

export const metadata: Metadata = { title: "老人档案" };

export default function EldersPage() {
  return <EldersClient />;
}
