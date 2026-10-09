import type { Metadata } from "next";

import { HealthClient } from "@/components/health-client";

export const metadata: Metadata = { title: "健康数据" };

export default function HealthPage() {
  return <HealthClient />;
}
