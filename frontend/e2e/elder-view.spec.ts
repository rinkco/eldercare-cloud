import { expect, test } from "@playwright/test";

import { FAMILY, login } from "./helpers";

test.describe("长辈视图", () => {
  test("family 可从侧边栏进入只读长辈视图并返回概览台", async ({ page }) => {
    await login(page, FAMILY);
    await page.getByRole("link", { name: "长辈视图" }).click();

    await expect(page).toHaveURL(/\/elder-view\/?$/);
    await expect(page.getByText("只读模式")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "最近告警" })
    ).toBeVisible();
    // 只读：不存在写操作入口
    await expect(page.getByRole("button", { name: "编辑档案" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /确认告警/ })).toHaveCount(0);

    await page.getByRole("link", { name: "概览台" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
