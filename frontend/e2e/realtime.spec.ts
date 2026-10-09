import { expect, test } from "@playwright/test";

import { ADMIN, login, triggerScenario } from "./helpers";

test.describe("实时推送", () => {
  test("WebSocket 把新告警推送到概览页实时流", async ({ page }) => {
    await login(page, ADMIN);

    await expect(page.getByText("实时在线").first()).toBeVisible();
    await expect(page.getByText("等待实时消息").first()).toBeVisible();

    triggerScenario("sos");

    await expect(
      page.getByText(/紧急求助/).first()
      // 窗口含 MQTT 发布、后端规则与 WS 推送的完整往返
    ).toBeVisible({ timeout: 5_000 });
  });
});
