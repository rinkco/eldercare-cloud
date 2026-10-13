import { expect, test } from "@playwright/test";

import { ADMIN, FAMILY, login, uniqueSuffix } from "./helpers";

test.describe("老人档案与联系人", () => {
  test("admin 可以新建、编辑、维护联系人和删除老人", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E老人-${suffix}`;
    const renamed = `${name}-改`;

    await login(page, ADMIN);
    await page.goto("/elders/");
    await page.getByRole("button", { name: "新建老人" }).click();
    await expect(page).toHaveURL(/\/elders\/edit\/?$/);

    await page.getByLabel("姓名 *").fill(name);
    await page.getByLabel("身高（cm）").fill("165");
    await page.getByLabel("体重（kg）").fill("60");
    await page.getByLabel("地址").fill("E2E 测试地址");
    await page.getByRole("button", { name: "保存老人" }).click();

    await expect(page.getByText("老人档案已创建")).toBeVisible();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);
    await expect(
      page.getByRole("heading", { name, level: 1 })
    ).toBeVisible();

    // 联系人整体替换：添加一名主联系人
    await page.getByRole("button", { name: "编辑联系人" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "添加联系人" }).click();
    await dialog.getByPlaceholder("联系人姓名").fill(`联系人${suffix}`);
    await dialog.getByPlaceholder("联系电话").fill("13900000000");
    await dialog.getByPlaceholder("例如：子女、邻居").fill("女儿");
    await dialog
      .getByRole("checkbox", { name: /设为主联系人/ })
      .first()
      .click();
    await dialog.getByRole("button", { name: "保存联系人" }).click();
    await expect(page.getByText("联系人已保存")).toBeVisible();
    await expect(page.getByText(`联系人${suffix}`)).toBeVisible();

    // 整体替换已有联系人需要二次确认
    await page.getByRole("button", { name: "编辑联系人" }).click();
    const replaceDialog = page.getByRole("dialog");
    await replaceDialog
      .getByPlaceholder("联系电话")
      .first()
      .fill("13900000001");
    await replaceDialog.getByRole("button", { name: "保存联系人" }).click();
    await expect(replaceDialog.getByText(/整体替换现有/)).toBeVisible();
    await expect(
      replaceDialog.getByPlaceholder("联系电话").first()
    ).toBeDisabled();
    await replaceDialog.getByRole("button", { name: "返回修改" }).click();
    await expect(
      replaceDialog.getByPlaceholder("联系电话").first()
    ).toBeEnabled();
    await replaceDialog.getByRole("button", { name: "保存联系人" }).click();
    await expect(replaceDialog.getByText(/整体替换现有/)).toBeVisible();
    await replaceDialog
      .getByRole("button", { name: "确认替换联系人" })
      .click();
    await expect(page.getByText("联系人已保存").last()).toBeVisible();

    // 编辑档案改名
    await page.getByRole("button", { name: "编辑档案" }).click();
    await expect(page).toHaveURL(/\/elders\/edit\/?\?id=\d+/);
    await page.getByLabel("姓名 *").fill(renamed);
    await page.getByRole("button", { name: "保存老人" }).click();
    await expect(page.getByText("老人档案已保存")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: renamed, level: 1 })
    ).toBeVisible();

    // 删除
    await page.getByRole("button", { name: "编辑档案" }).click();
    await page.getByRole("button", { name: "删除老人" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "删除老人" })
      .click();
    await expect(page).toHaveURL(/\/elders\/?$/);
    await expect(page.getByText(renamed)).toHaveCount(0);
  });

  test("family（普通成员）只看到关联老人且无编辑入口", async ({ page }) => {
    await login(page, FAMILY);
    await page.goto("/elders/");

    const row = page.getByRole("row").filter({ hasText: "演示老人-张奶奶" });
    await expect(row).toBeVisible();
    // 「我的角色」列：family 是该老人的普通成员
    await expect(row.getByText("普通成员")).toBeVisible();
    // member 行内没有编辑入口（编辑按钮仅 admin/owner 渲染）
    await expect(row.getByRole("button", { name: "编辑档案" })).toHaveCount(0);
    await expect(page.getByText(/E2E老人-/)).toHaveCount(0);
  });

  test("admin 在老人详情可切换分区并管理监护成员面板", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/elders/");
    await page
      .getByRole("row")
      .filter({ hasText: "演示老人-张奶奶" })
      .getByRole("button", { name: "查看详情" })
      .click();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);

    // 详情页默认落在「档案与联系人」分区，成员面板需先切到对应 Tab
    await expect(
      page.getByRole("tab", { name: "档案与联系人" })
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "监护成员" }).click();
    await expect(page).toHaveURL(/tab=members/);

    const panel = page.locator("section").filter({ hasText: "监护成员" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("family", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "添加" })).toBeVisible();
  });

  test("family（普通成员）在详情可看设备分区但没有成员分区", async ({
    page,
  }) => {
    await login(page, FAMILY);
    await page.goto("/elders/");
    await page
      .getByRole("row")
      .filter({ hasText: "演示老人-张奶奶" })
      .getByRole("button", { name: "查看详情" })
      .click();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);

    // member 只有 3 个分区，「监护成员」既不渲染 Tab 也不渲染内容
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(page.getByRole("tab", { name: "监护成员" })).toHaveCount(0);

    await page.getByRole("tab", { name: "设备与围栏" }).click();
    await expect(page.getByRole("heading", { name: "绑定设备" })).toBeVisible();
    await expect(page.getByText("esp32-demo-0001")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "监护成员" })
    ).toHaveCount(0);
  });
});
