import { expect, test } from "@playwright/test";

import { ADMIN, FAMILY, login } from "./helpers";

test.describe("登录与权限", () => {
  test("错误密码停留在登录页并提示原因", async ({ page }) => {
    await page.goto("/login/");
    await page.fill("#username", ADMIN.username);
    await page.fill("#password", "wrong-password");
    await page.click('button[type="submit"]');

    await expect(page.getByText("用户名或密码错误")).toBeVisible();
    await expect(page).toHaveURL(/\/login\/?$/);
  });

  test("admin 登录后进入概览台并保存会话", async ({ page }) => {
    await login(page, ADMIN);

    await expect(page.getByRole("heading", { name: "概览台", level: 1 })).toBeVisible();
    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem("eldercare.session")
    );
    expect(stored).toBeTruthy();
    const session = JSON.parse(stored ?? "{}") as {
      token?: string;
      role?: string;
    };
    expect(session.role).toBe("admin");
    expect(session.token).toMatch(/^eyJ/);
  });

  test("未登录访问受保护页面会跳转登录页", async ({ page }) => {
    await page.goto("/alerts/");
    await expect(page).toHaveURL(/\/login\/?$/);
  });

  test("family 登录后可见概览台且导航不含设备与用户", async ({ page }) => {
    await login(page, FAMILY);

    await expect(page.getByRole("heading", { name: "概览台", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "设备管理" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "用户列表" })).toHaveCount(0);
  });

  test("退出登录后回到登录页", async ({ page }) => {
    await login(page, ADMIN);
    await page.getByRole("button", { name: "账号菜单" }).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();

    await expect(page).toHaveURL(/\/login\/?$/);
  });
});
