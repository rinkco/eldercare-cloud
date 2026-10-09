import type { Metadata } from "next";

import { ElderDetailClient } from "@/components/elder-detail-client";

export const metadata: Metadata = { title: "老人详情" };

export default function ElderDetailPage() {
  return <ElderDetailClient />;
}
