import type { Metadata } from "next";

import { ElderViewClient } from "@/components/elder-view-client";

export const metadata: Metadata = { title: "长辈视图" };

export default function ElderViewPage() {
  return <ElderViewClient />;
}
