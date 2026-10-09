import { Activity } from "lucide-react";
import type { ReactNode } from "react";

/** 登录 / 注册页共用的双栏外壳：左侧品牌装饰，右侧表单区。 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden border-r border-line bg-panel/40 lg:flex lg:items-center lg:justify-center lg:px-14">
        <div className="absolute left-14 top-12 z-10 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[8px] border border-brand/30 bg-brand/12">
            <Activity className="size-4.5 text-brand" aria-hidden="true" />
          </span>
          <span className="text-[15px] font-medium text-ink">老人监护云</span>
        </div>

        <svg
          className="pointer-events-none relative w-[180%] min-w-[680px] max-w-[1180px] text-brand/30"
          viewBox="0 0 1200 160"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M0 96H180L208 96L226 60L250 132L272 30L296 96H430L452 96L470 72L490 118L508 54L528 96H720L744 96L762 64L786 128L806 40L828 96H1200"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-[7px] border border-brand/30 bg-brand/12">
              <Activity className="size-4 text-brand" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-medium text-ink">
              老人监护云
            </span>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
