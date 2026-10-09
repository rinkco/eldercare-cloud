"use client";

import { Activity, ChevronRight, LockKeyhole, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// 快捷登录账号在构建时由 NEXT_PUBLIC_DEMO_* 注入，默认与演示口令一致；
// 自定义口令的部署（如公网演示）需同步配置，否则快捷登录会提示密码错误。
const DEMO_ACCOUNTS = [
  {
    label: "管理员账号",
    username: process.env.NEXT_PUBLIC_DEMO_ADMIN_USERNAME || "admin",
    password: process.env.NEXT_PUBLIC_DEMO_ADMIN_PASSWORD || "admin123456",
  },
  {
    label: "家属账号",
    username: process.env.NEXT_PUBLIC_DEMO_FAMILY_USERNAME || "family",
    password: process.env.NEXT_PUBLIC_DEMO_FAMILY_PASSWORD || "family123456",
  },
];

const DEMO_LOGIN_ENABLED =
  (process.env.NEXT_PUBLIC_DEMO_LOGIN_ENABLED || "true") !== "false";

export default function LoginPage() {
  const { login, session, ready } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) {
      router.replace("/");
    }
  }, [ready, session, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("请输入账号和密码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      router.replace("/");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "登录失败，请稍后重试"
      );
    } finally {
      setBusy(false);
    }
  }

  function fillAccount(account: (typeof DEMO_ACCOUNTS)[number]) {
    setUsername(account.username);
    setPassword(account.password);
    setError(null);
  }

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

          <h2 className="text-[24px] font-medium leading-8 text-ink">
            登录管理台
          </h2>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <Label htmlFor="username">账号</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted/70" />
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  className="pl-9"
                  placeholder="请输入账号"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "login-error" : undefined}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted/70" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  className="pl-9"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "login-error" : undefined}
                />
              </div>
            </div>

            <div id="login-error">
              <FieldError>{error}</FieldError>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={busy}
            >
              {busy ? "正在登录…" : "登录"}
            </Button>
          </form>

          {DEMO_LOGIN_ENABLED ? (
            <div className="mt-8 border-t border-line pt-5">
              <p className="text-[12px] text-ink-muted">快捷登录</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.username}
                    type="button"
                    onClick={() => fillAccount(account)}
                    className="flex items-center justify-between rounded-[6px] border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-line-strong"
                  >
                    <span>
                      <span className="block text-[12px] text-ink-muted">
                        {account.label}
                      </span>
                      <span className="block text-[13px] text-ink">
                        {account.username}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-ink-muted/70" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
