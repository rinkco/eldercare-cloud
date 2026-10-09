"use client";

import {
  Activity,
  BellRing,
  ChevronDown,
  Cpu,
  Eye,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ConnectionIndicator } from "@/components/connection-indicator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  roles: Role[];
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "总览",
    items: [
      {
        href: "/",
        label: "概览台",
        icon: <LayoutDashboard className="size-4" />,
        roles: ["admin", "family"],
      },
    ],
  },
  {
    title: "档案",
    items: [
      {
        href: "/elders",
        label: "老人档案",
        icon: <UserRound className="size-4" />,
        roles: ["admin", "family"],
      },
      {
        href: "/devices",
        label: "设备管理",
        icon: <Cpu className="size-4" />,
        roles: ["admin"],
      },
    ],
  },
  {
    title: "监护",
    items: [
      {
        href: "/health",
        label: "健康数据",
        icon: <HeartPulse className="size-4" />,
        roles: ["admin", "family"],
      },
      {
        href: "/alerts",
        label: "告警中心",
        icon: <BellRing className="size-4" />,
        roles: ["admin", "family"],
      },
      {
        href: "/events",
        label: "事件记录",
        icon: <ScrollText className="size-4" />,
        roles: ["admin", "family"],
      },
    ],
  },
  {
    title: "系统",
    items: [
      {
        href: "/users",
        label: "用户列表",
        icon: <Users className="size-4" />,
        roles: ["admin"],
      },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Navigation({
  role,
  pathname,
  onNavigate,
}: {
  role: Role;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => item.roles.includes(role));
        if (items.length === 0) return null;
        return (
          <div key={section.title}>
            <p className="px-2 pb-1.5 text-[11px] tracking-wide text-ink-muted/70">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] transition-colors",
                        active
                          ? "bg-brand/12 text-brand"
                          : "text-ink-muted hover:bg-white/5 hover:text-ink"
                      )}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-[7px] border border-brand/30 bg-brand/12">
        <Activity className="size-4 text-brand" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[14px] font-medium leading-5 text-ink">
          老人监护云
        </span>
        <span className="block text-[11px] leading-4 text-ink-muted/80">
          教学演示平台
        </span>
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (!session) return null;

  const roleLabel = session.role === "admin" ? "管理员" : "家属";

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-line bg-panel/60 lg:flex lg:h-dvh lg:flex-col lg:sticky lg:top-0">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
          <BrandMark />
        </div>
        <Navigation role={session.role} pathname={pathname} />
        <div className="border-t border-line px-4 py-3">
          <ConnectionIndicator />
        </div>
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
            aria-label="关闭导航"
          />
          <div className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-line-strong bg-panel shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <BrandMark />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDrawerOpen(false)}
                aria-label="关闭导航"
              >
                <X />
              </Button>
            </div>
            <Navigation
              role={session.role}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-canvas/92 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="打开导航"
            >
              <Menu />
            </Button>
            <span className="text-[13px] text-ink-muted lg:hidden">
              老人监护云
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden lg:block">
              <ConnectionIndicator />
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-[6px] border border-line bg-panel px-2.5 py-1.5 text-[13px] text-ink transition-colors hover:border-line-strong"
                  aria-label="账号菜单"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-brand/15 text-[11px] text-brand">
                    {session.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden max-w-28 truncate sm:block">
                    {session.username}
                  </span>
                  <ChevronDown className="size-3.5 text-ink-muted" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {session.username} · {roleLabel}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => router.push("/elder-view/")}
                >
                  <Eye className="size-4" />
                  长辈视图
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger onSelect={logout}>
                  <LogOut className="size-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-6">
          <div className="mx-auto w-full max-w-[1600px] animate-rise-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
