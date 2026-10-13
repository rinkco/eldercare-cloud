import { expect, test, type Page } from "@playwright/test";

import { ADMIN, FAMILY, login, uniqueSuffix } from "./helpers";

/** 当前焦点是否落在给定容器内（用于抽屉/弹窗的焦点圈定断言）。 */
async function focusInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((css) => {
    const container = document.querySelector(css);
    const active = document.activeElement;
    return Boolean(container && active && container.contains(active));
  }, selector);
}

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

// 用户列表「监护关系」列 + 右侧抽屉（仅 admin）：同时覆盖新增控件的无障碍契约
test.describe("用户监护关系抽屉", () => {
  test("admin 可从抽屉查看监护关系并用键盘操作弹窗", async ({ page }) => {
    const trigger = page.getByRole("button", {
      name: `查看 ${FAMILY.username} 的监护关系`,
    });

    await login(page, ADMIN);
    await page.goto("/users/");
    await expect(
      page.getByRole("columnheader", { name: "监护关系" })
    ).toBeVisible();

    await trigger.click();
    const sheet = page.getByRole("dialog");
    // 抽屉在 Content 上显式声明 aria-modal
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    await expect(
      sheet.getByRole("heading", { name: "监护关系", level: 2 })
    ).toBeVisible();

    // 关联老人 + relation 只读展示（SPEC 04：不再展示成员角色）
    const relationRow = sheet
      .locator("li")
      .filter({ hasText: "演示老人-张奶奶" });
    await expect(relationRow).toBeVisible();
    await expect(relationRow.getByText("女儿")).toBeVisible();

    // 键盘可达 + 焦点圈定：连续 Tab 时焦点始终留在抽屉内
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Tab");
      expect(
        await focusInside(page, '[role="dialog"][aria-modal="true"]')
      ).toBe(true);
    }

    // Esc 关闭，焦点回到触发按钮
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // 抽屉 → 编辑弹窗：焦点交接给弹窗
    await trigger.click();
    await page.getByRole("button", { name: "编辑账号" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "编辑用户" })
    ).toBeVisible();
    await expect
      .poll(() => focusInside(page, '[role="dialog"]'))
      .toBe(true);

    // 弹窗内键盘可操作：Tab 到「显示名」并输入，Esc 关闭且不保存
    let typed = false;
    for (let index = 0; index < 8 && !typed; index += 1) {
      await page.keyboard.press("Tab");
      expect(await focusInside(page, '[role="dialog"]')).toBe(true);
      if ((await page.evaluate(() => document.activeElement?.id)) ===
        "edit-display-name") {
        await page.keyboard.type("键盘编辑");
        typed = true;
      }
    }
    expect(typed).toBe(true);
    await expect(dialog.getByLabel("显示名")).toHaveValue("键盘编辑");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // 未保存：列表里仍是原显示名
    await expect(page.getByRole("row").filter({ has: trigger })).toContainText(
      "演示家属"
    );
  });
});
