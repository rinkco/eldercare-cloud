import { expect, test } from "@playwright/test";

import { ADMIN, login, uniqueSuffix } from "./helpers";

test.describe("设备管理", () => {
  test("admin 注册设备、重复 UID 冲突、绑定老人", async ({ page }) => {
    const uid = `e2e-dev-${uniqueSuffix()}`;

    await login(page, ADMIN);
    await page.goto("/devices/");
    await page.getByRole("button", { name: "注册设备" }).first().click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("设备 UID").fill(uid);
    await dialog.getByRole("button", { name: "注册设备" }).click();
    await expect(page.getByText("设备已注册")).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: uid });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /绑定/ }).click();

    const bindDialog = page.getByRole("dialog");
    await bindDialog
      .getByRole("combobox", { name: /选择要绑定的老人/ })
      .click();
    await page.getByRole("option", { name: "演示老人-张奶奶" }).click();
    await bindDialog.getByRole("button", { name: "绑定", exact: true }).click();
    await expect(page.getByText("设备已绑定")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: uid }).getByText("已绑定")
    ).toBeVisible();

    // 重复注册同一 UID → 表单内显示后端 409 原因
    await page.getByRole("button", { name: "注册设备" }).first().click();
    const againDialog = page.getByRole("dialog");
    await againDialog.getByLabel("设备 UID").fill(uid);
    await againDialog.getByRole("button", { name: "注册设备" }).click();
    await expect(
      againDialog.getByText("设备 UID 已存在")
    ).toBeVisible();
  });

  test("family 看不到设备菜单，直接访问显示无权", async ({ page }) => {
    await login(page, { username: "family", password: "family123456" });
    await expect(page.getByRole("link", { name: "设备管理" })).toHaveCount(0);
    await page.goto("/devices/");
    await expect(page.getByText("当前账号无权访问此页面")).toBeVisible();
  });
});
