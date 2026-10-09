import { expect, test } from "@playwright/test";

import { ADMIN, login, triggerScenario } from "./helpers";

test.describe("事件记录", () => {
  test("可查看事件详情与完整 Payload", async ({ page }) => {
    triggerScenario("fall");

    await login(page, ADMIN);
    await page.goto("/events/");

    const row = page
      .getByRole("row")
      .filter({ hasText: "跌倒" })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.getByRole("button", { name: /详情/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("完整 Payload")).toBeVisible();
    // 硬件上报的原始载荷应原样可见（模拟器 fall 场景包含 source/accel_g）
    await expect(dialog.locator("pre")).toContainText("mpu6050");
    await expect(dialog.locator("pre")).toContainText("accel_g");
    await dialog.getByRole("button", { name: "关闭" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
