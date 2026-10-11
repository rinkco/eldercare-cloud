import { Badge, type BadgeProps } from "@/components/ui/badge";

import type { ElderRole } from "@/lib/types";

export const ELDER_ROLE_LABELS: Record<ElderRole, string> = {
  admin: "管理员",
  owner: "主照护者",
  member: "普通成员",
};

/** 主照护者用品牌色、普通成员用中性色，管理员用信息色以便与主照护者区分。 */
const ELDER_ROLE_TONES: Record<ElderRole, NonNullable<BadgeProps["tone"]>> = {
  admin: "info",
  owner: "brand",
  member: "neutral",
};

export function ElderRoleBadge({
  role,
  className,
}: {
  role: ElderRole;
  className?: string;
}) {
  return (
    <Badge tone={ELDER_ROLE_TONES[role]} className={className}>
      {ELDER_ROLE_LABELS[role]}
    </Badge>
  );
}
