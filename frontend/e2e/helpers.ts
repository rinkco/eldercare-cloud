import { execFileSync } from "node:child_process";
import path from "node:path";

import type { Page } from "@playwright/test";

// 默认与本地演示口令一致；对自定义口令的部署（如云端）可用环境变量覆盖
export const ADMIN = {
  username: process.env.E2E_ADMIN_USERNAME ?? "admin",
  password: process.env.E2E_ADMIN_PASSWORD ?? "admin123456",
};
export const FAMILY = {
  username: process.env.E2E_FAMILY_USERNAME ?? "family",
  password: process.env.E2E_FAMILY_PASSWORD ?? "family123456",
};
// 登录页第三个快捷登录按钮对应的测试账号（SPEC 04）
export const TEST = {
  username: process.env.E2E_TEST_USERNAME ?? "laowang",
  password: process.env.E2E_TEST_PASSWORD ?? "123456",
};
// 未关联任何老人的家属账号：SPEC 06「按手机号添加老人」用例使用
export const GUEST = {
  username: process.env.E2E_GUEST_USERNAME ?? "family-guest",
  password: process.env.E2E_GUEST_PASSWORD ?? "guest123456",
};

export async function login(
  page: Page,
  account: { username: string; password: string }
) {
  await page.goto("/login/");
  await page.fill("#username", account.username);
  await page.fill("#password", account.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");
  await page.waitForLoadState("networkidle");
}

export function uniqueSuffix(): string {
  return Date.now().toString(36).slice(-6);
}

/** 生成符合 SPEC 06 规则的演示手机号（11 位、1 开头）。 */
export function uniquePhone(): string {
  const tail = `${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0")}`;
  return `138${tail}`;
}

/**
 * 通过模拟设备脚本触发一个真实 MQTT 场景（fall / sos / geofence / low-battery）。
 * 需要宿主机可执行 docker compose，且演示设备已由 scripts.seed 注册。
 */
export function triggerScenario(
  scenario: "fall" | "sos" | "geofence" | "low-battery"
): void {
  const projectRoot = path.resolve(__dirname, "..", "..");
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "backend",
      "python",
      "-m",
      "scripts.simulate_device",
      "--scenario",
      scenario,
    ],
    { cwd: projectRoot, timeout: 90_000, stdio: "pipe" }
  );
}
