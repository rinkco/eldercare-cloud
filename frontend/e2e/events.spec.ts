import { expect, test } from "@playwright/test";

import { ADMIN, login, triggerScenario } from "./helpers";

// /events 已并入「告警与事件」页的事件 Tab：用例改走 ?view=events 直达
test.describe("告警与事件 · 事件 Tab", () => {
  test("可查看事件详情与完整 Payload", async ({ page }) => {
    triggerScenario("fall");

    await login(page, ADMIN);
    await page.goto("/alerts/?view=events");

    // 事件 Tab 直达：地址栏回写保持所在视图，事件列表面板在 Tab 内渲染
    await expect(page.getByRole("tab", { name: "事件" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const row = page
      .getByRole("table", { name: "事件记录列表" })
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
