import type { Metadata } from "next";

import { UsersClient } from "@/components/users-client";
import { RoleGuard } from "@/components/role-guard";

export const metadata: Metadata = { title: "用户列表" };

export default function UsersPage() {
  return (
    <RoleGuard allow={["admin"]}>
      <UsersClient />
    </RoleGuard>
  );
}
