import { expect, test } from "@playwright/test";

import { ADMIN, login, triggerScenario } from "./helpers";

test.describe("告警中心", () => {
  test("新告警可查看详情、通知记录并确认", async ({ page }) => {
    triggerScenario("fall");

    await login(page, ADMIN);
    await page.goto("/alerts/");

    const row = page
      .getByRole("row")
      .filter({ hasText: "跌倒" })
      .filter({ hasText: "未处理" })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 详情：告警元信息 + 通知记录
    await row.getByRole("button", { name: /详情/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("通知记录")).toBeVisible();
    await expect(dialog.getByText("控制台").first()).toBeVisible();
    await dialog.getByRole("button", { name: "关闭" }).click();

    // 确认告警：状态即时更新
    await row.getByRole("button", { name: /确认/ }).click();
    await expect(page.getByText("告警已确认")).toBeVisible();
    const updatedRow = page
      .getByRole("row")
      .filter({ hasText: "跌倒" })
      .first();
    await expect(updatedRow.getByText("已处理")).toBeVisible();
  });

  test("按状态筛选只显示未处理告警", async ({ page }) => {
    triggerScenario("low-battery");

    await login(page, ADMIN);
    await page.goto("/alerts/");
    await page.getByRole("combobox", { name: "告警状态" }).click();
    await page.getByRole("option", { name: "未处理" }).click();

    const rows = page.getByRole("row").filter({ hasText: "未处理" });
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  });

  test("手动刷新在告警确认后能正常结束", async ({ page }) => {
    triggerScenario("sos");

    await login(page, ADMIN);
    await page.goto("/alerts/");

    const row = page
      .getByRole("row")
      .filter({ hasText: "紧急求助" })
      .filter({ hasText: "未处理" })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let markRefreshStarted: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });

    await page.route(/\/api\/v1\/alerts\?limit=500$/, async (route) => {
      markRefreshStarted?.();
      await refreshGate;
      await route.continue();
    });

    const refreshButton = page.getByRole("button", { name: "刷新" });
    await refreshButton.click();
    await refreshStarted;
    await expect(refreshButton).toBeDisabled();

    await row.getByRole("button", { name: /确认/ }).click();
    await expect(page.getByText("告警已确认")).toBeVisible();

    releaseRefresh?.();
    await expect(refreshButton).toBeEnabled();
  });
});
