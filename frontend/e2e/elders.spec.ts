import { expect, test } from "@playwright/test";

import { ADMIN, FAMILY, login, uniquePhone, uniqueSuffix } from "./helpers";

// seed（scripts/seed.py）给演示老人补写的手机号
const DEMO_ELDER = "演示老人-张奶奶";
const DEMO_ELDER_PHONE = "13800000003";

test.describe("老人档案与联系人", () => {
  test("admin 可以新建、编辑、维护联系人和删除老人", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E老人-${suffix}`;
    const renamed = `${name}-改`;

    await login(page, ADMIN);
    await page.goto("/elders/");

    // SPEC 06：列表新增手机号列；「取消绑定」只对家属开放
    await expect(
      page.getByRole("columnheader", { name: "手机号" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "添加老人" })).toBeVisible();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: DEMO_ELDER })
        .getByRole("button", { name: "取消绑定" })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "新建老人" }).click();
    await expect(page).toHaveURL(/\/elders\/edit\/?$/);

    await page.getByLabel("姓名 *").fill(name);
    await page.getByLabel("身高（cm）").fill("165");
    await page.getByLabel("体重（kg）").fill("60");
    await page.getByLabel("地址").fill("E2E 测试地址");

    // SPEC 06：老人手机号必填 + 11 位格式校验
    await page.getByRole("button", { name: "保存老人" }).click();
    await expect(page.getByText("请输入老人手机号。")).toBeVisible();
    await page.getByLabel("手机号 *").fill("1234567890");
    await page.getByRole("button", { name: "保存老人" }).click();
    await expect(page.getByText("请输入 11 位手机号。")).toBeVisible();

    const phone = uniquePhone();
    await page.getByLabel("手机号 *").fill(phone);
    await page.getByRole("button", { name: "保存老人" }).click();

    await expect(page.getByText("老人档案已创建")).toBeVisible();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);
    await expect(
      page.getByRole("heading", { name, level: 1 })
    ).toBeVisible();
    // 详情页展示手机号
    await expect(page.getByText(phone).first()).toBeVisible();

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

    // 编辑档案改名（手机号保持原值）
    await page.getByRole("button", { name: "编辑档案" }).click();
    await expect(page).toHaveURL(/\/elders\/edit\/?\?id=\d+/);
    await expect(page.getByLabel("手机号 *")).toHaveValue(phone);
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

  test("重复手机号新建会被拒绝，并提示改用「添加老人」", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/elders/edit/");

    await page.getByLabel("姓名 *").fill(`E2E重复手机号-${uniqueSuffix()}`);
    await page.getByLabel("手机号 *").fill(DEMO_ELDER_PHONE);
    await page.getByRole("button", { name: "保存老人" }).click();

    await expect(
      page.getByText("该手机号已存在老人档案，请改用「添加老人」")
    ).toBeVisible();
    await expect(page).toHaveURL(/\/elders\/edit\/?$/);
  });

  test("family 只看到关联老人，且行内编辑入口直接可用", async ({ page }) => {
    await login(page, FAMILY);
    await page.goto("/elders/");

    const row = page.getByRole("row").filter({ hasText: DEMO_ELDER });
    await expect(row).toBeVisible();
    // SPEC 04：家属成员权限一致，不再有「我的角色」列，编辑入口直接可用
    await expect(
      page.getByRole("columnheader", { name: "我的角色" })
    ).toHaveCount(0);
    await expect(row.getByRole("button", { name: "编辑档案" })).toBeVisible();
    // SPEC 06：家属行内提供「取消绑定」自助解绑入口
    await expect(row.getByRole("button", { name: "取消绑定" })).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "手机号" })
    ).toBeVisible();
    await expect(page.getByText(/E2E老人-/)).toHaveCount(0);
  });

  test("admin 在老人详情可切换分区并管理监护成员面板", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/elders/");
    await page
      .getByRole("row")
      .filter({ hasText: DEMO_ELDER })
      .getByRole("button", { name: "查看详情" })
      .click();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);

    // 详情页展示 seed 补写的手机号
    await expect(page.getByText(DEMO_ELDER_PHONE)).toBeVisible();

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

  test("admin 用「添加老人」定位已有档案，且不产生绑定", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/elders/");
    await page.getByRole("button", { name: "添加老人" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "添加老人" })
    ).toBeVisible();

    // 未命中：后端 404 detail 内联展示
    await dialog.getByLabel("老人手机号").fill("13900000000");
    await dialog.getByRole("button", { name: "确认添加" }).click();
    await expect(
      dialog.getByText(/未找到该手机号对应的老人档案/)
    ).toBeVisible();

    // 命中演示老人：仅检索定位并跳转详情
    await dialog.getByLabel("老人手机号").fill(DEMO_ELDER_PHONE);
    await dialog.getByRole("button", { name: "确认添加" }).click();
    await expect(
      page.getByText(`该老人已存在：${DEMO_ELDER}`)
    ).toBeVisible();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);
    await expect(
      page.getByRole("heading", { name: DEMO_ELDER, level: 1 })
    ).toBeVisible();

    // 不产生绑定：监护成员名单仍是 seed 的 family + laowang
    await page.getByRole("tab", { name: "监护成员" }).click();
    const panel = page.locator("section").filter({ hasText: "监护成员" });
    await expect(
      panel.getByRole("row").filter({ hasText: "admin" })
    ).toHaveCount(0);
    await expect(
      panel.getByRole("row").filter({ hasText: "family" })
    ).toBeVisible();
  });

  test("family 在详情可切换 4 个分区（含监护成员）", async ({ page }) => {
    await login(page, FAMILY);
    await page.goto("/elders/");
    await page
      .getByRole("row")
      .filter({ hasText: DEMO_ELDER })
      .getByRole("button", { name: "查看详情" })
      .click();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);

    // SPEC 04：家属与管理台一致，4 个分区都可见
    await expect(page.getByRole("tab")).toHaveCount(4);
    await expect(page.getByRole("tab", { name: "监护成员" })).toBeVisible();

    await page.getByRole("tab", { name: "设备与围栏" }).click();
    await expect(page.getByRole("heading", { name: "绑定设备" })).toBeVisible();
    await expect(page.getByText("esp32-demo-0001")).toBeVisible();

    // SPEC 06：家属可打开监护成员分区，但只是只读视图
    await page.getByRole("tab", { name: "监护成员" }).click();
    await expect(
      page.getByRole("heading", { name: "监护成员" })
    ).toBeVisible();
    await expect(
      page.getByText("成员管理仅管理员可用；可在「老人档案」中对这位老人取消绑定。")
    ).toBeVisible();
  });
});
