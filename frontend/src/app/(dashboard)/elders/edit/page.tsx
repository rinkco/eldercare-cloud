import type { Metadata } from "next";

import { ElderEditClient } from "@/components/elder-edit-client";

export const metadata: Metadata = { title: "老人编辑" };

export default function ElderEditPage() {
  return <ElderEditClient />;
}
