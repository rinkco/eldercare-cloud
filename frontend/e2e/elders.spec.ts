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

  test("family 只看到自己关联的老人", async ({ page }) => {
    await login(page, FAMILY);
    await page.goto("/elders/");
    await expect(page.getByText("演示老人-张奶奶")).toBeVisible();
    await expect(page.getByText(/E2E老人-/)).toHaveCount(0);
  });
});
