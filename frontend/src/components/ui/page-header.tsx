import type { ReactNode } from "react";

export function PageHeader({
  title,
  titleAddon,
  description,
  actions,
}: {
  title: string;
  /** 标题旁的附加内容（如角色徽章）：不进入 h1 文本，保持可访问名稳定。 */
  titleAddon?: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[28px] font-medium leading-9 tracking-normal text-ink">
            {title}
          </h1>
          {titleAddon}
        </div>
        {description ? (
          <p className="mt-1 text-[13px] leading-6 text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
