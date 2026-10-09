import { expect, test } from "@playwright/test";

import { ADMIN, login } from "./helpers";

test.describe("健康数据", () => {
  test("趋势图渲染并可切换表格视图", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/health/");

    await expect(
      page.getByRole("heading", { name: "心率趋势" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "血氧趋势" })
    ).toBeVisible();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    // 图表无障碍替代：切到表格视图
    await page.getByRole("button", { name: "表格视图" }).first().click();
    await expect(
      page.getByRole("columnheader", { name: "时间" }).first()
    ).toBeVisible();

    // 间隔切换
    await page.getByRole("button", { name: "按天" }).click();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
  });
});
