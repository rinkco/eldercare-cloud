"use client";

import { LockKeyhole, Phone, UserRound, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

export default function RegisterPage() {
  const { login, session, ready } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) {
      router.replace("/");
    }
  }, [ready, session, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = username.trim();
    if (!USERNAME_PATTERN.test(name)) {
      setError("账号需为 3-32 位字母、数字、下划线或连字符");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/register", {
        username: name,
        password,
        display_name: displayName.trim() || null,
        phone: phone.trim() || null,
      });
      await login(name, password);
      router.replace("/");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "注册失败，请稍后重试"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="text-[24px] font-medium leading-8 text-ink">
        注册家属账号
      </h2>
      <p className="mt-2 text-[13px] leading-5 text-ink-muted">
        注册后即可登录管理台；如需查看老人数据，请让管理员在「老人档案」中
        为账号关联老人。
      </p>

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
              placeholder="3-32 位字母、数字、下划线或连字符"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="display-name">显示名（选填）</Label>
          <div className="relative">
            <UserRoundPlus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted/70" />
            <Input
              id="display-name"
              name="display_name"
              autoComplete="nickname"
              className="pl-9"
              placeholder="例如：张奶奶家属"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="phone">手机号（选填）</Label>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted/70" />
            <Input
              id="phone"
              name="phone"
              autoComplete="tel"
              className="pl-9"
              placeholder="例如：13800000000"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              aria-invalid={Boolean(error)}
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
              autoComplete="new-password"
              className="pl-9"
              placeholder="至少 6 位"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="confirm-password">确认密码</Label>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted/70" />
            <Input
              id="confirm-password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              className="pl-9"
              placeholder="再次输入密码"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "register-error" : undefined}
            />
          </div>
        </div>

        <div id="register-error">
          <FieldError>{error}</FieldError>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={busy}
        >
          {busy ? "正在注册…" : "注册并登录"}
        </Button>
      </form>

      <p className="mt-4 text-center text-[13px] text-ink-muted">
        已有账号？{" "}
        <Link
          href="/login/"
          className="font-medium text-brand transition-colors hover:underline"
        >
          返回登录
        </Link>
      </p>
    </AuthShell>
  );
}
