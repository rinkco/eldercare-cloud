import { expect, test } from "@playwright/test";

import { ADMIN, login, uniqueSuffix } from "./helpers";

test.describe("用户注册与编辑", () => {
  test("新账号可在注册页注册并自动登录", async ({ page }) => {
    const username = `e2e-${uniqueSuffix()}`;

    await page.goto("/register/");
    await page.fill("#username", username);
    await page.fill("#display-name", "端到端注册");
    await page.fill("#password", "e2e-pass-123");
    await page.fill("#confirm-password", "e2e-pass-123");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/");
    await expect(
      page.getByRole("heading", { name: "概览台", level: 1 })
    ).toBeVisible();
  });

  test("admin 可在用户列表中编辑账号", async ({ page, request }) => {
    const username = `e2e-${uniqueSuffix()}`;
    const created = await request.post("/api/v1/auth/register", {
      data: { username, password: "e2e-pass-123", display_name: "待编辑" },
    });
    expect(created.status()).toBe(201);

    await login(page, ADMIN);
    await page.goto("/users/");

    const row = page.getByRole("row", { name: new RegExp(username) });
    await row.getByRole("button", { name: "编辑" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("显示名").fill("端到端已编辑");
    await dialog.getByRole("button", { name: "保存" }).click();

    await expect(
      page.getByRole("row", { name: new RegExp(username) })
    ).toContainText("端到端已编辑");
  });
});
