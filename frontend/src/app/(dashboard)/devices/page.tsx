import type { Metadata } from "next";

import { DevicesClient } from "@/components/devices-client";

export const metadata: Metadata = { title: "设备管理" };

export default function DevicesPage() {
  return <DevicesClient />;
}
