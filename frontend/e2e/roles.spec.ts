import { expect, test, type Page } from "@playwright/test";

import { ADMIN, FAMILY, OWNER, login, triggerScenario } from "./helpers";

// 演示数据（scripts/seed.py）：演示老人同时关联 family（普通成员，relation=daughter）
// 与 family-owner（主照护者，relation=son）；family-guest 未关联任何老人，作候选账号
const DEMO_ELDER = "演示老人-张奶奶";
const GUEST_USERNAME = "family-guest";

function membersPanel(page: Page) {
  return page.locator("section").filter({ hasText: "监护成员" });
}

/** 监护成员表格中某一账号所在的整行（按角色下拉的 aria-label 精确定位）。 */
function memberRow(page: Page, username: string) {
  return membersPanel(page)
    .getByRole("row")
    .filter({
      has: page.getByRole("combobox", {
        name: `设置 ${username} 的角色`,
      }),
    });
}

function memberRoleSelect(page: Page, username: string) {
  return membersPanel(page).getByRole("combobox", {
    name: `设置 ${username} 的角色`,
  });
}

/** 打开演示老人详情页，返回其 id（从地址栏读取，避免硬编码）。 */
async function openDemoElderDetail(
  page: Page,
  account: { username: string; password: string }
): Promise<number> {
  await login(page, account);
  await page.goto("/elders/");
  await page
    .getByRole("row")
    .filter({ hasText: DEMO_ELDER })
    .getByRole("button", { name: "查看详情" })
    .click();
  await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);
  const id = Number(new URL(page.url()).searchParams.get("id"));
  expect(Number.isInteger(id) && id > 0).toBe(true);
  return id;
}

test.describe("主照护者（owner）权限", () => {
  test("可查看并管理监护成员，且受「至少保留一位主照护者」约束", async ({
    page,
  }) => {
    await login(page, OWNER);
    await page.goto("/elders/");

    // 列表：family 视角有「我的角色」列，owner 行带主照护者徽章与编辑入口
    const listRow = page.getByRole("row").filter({ hasText: DEMO_ELDER });
    await expect(listRow.getByText("主照护者")).toBeVisible();
    await expect(listRow.getByRole("button", { name: "编辑档案" })).toBeVisible();

    await listRow.getByRole("button", { name: "查看详情" }).click();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);

    // 详情页头：角色徽章不进入 h1 可访问名
    await expect(
      page.getByRole("heading", { name: DEMO_ELDER, level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑档案" })).toBeVisible();

    // 先点 Tab 再断言内容：未激活的面板会被卸载重挂载
    await page.getByRole("tab", { name: "监护成员" }).click();
    await expect(page).toHaveURL(/tab=members/);

    const panel = membersPanel(page);
    await expect(panel.getByRole("table")).toBeVisible();

    // 「我」标记按 username 判定：owner 自己那一行
    const ownRow = memberRow(page, OWNER.username);
    await expect(ownRow.getByText("我")).toBeVisible();
    await expect(memberRoleSelect(page, OWNER.username)).toContainText(
      "主照护者"
    );

    // 候选搜索添加 family-guest（普通成员）
    const guestRow = memberRow(page, GUEST_USERNAME);
    await expect(guestRow).toHaveCount(0);
    await panel.getByPlaceholder("账号或显示名关键字").fill(GUEST_USERNAME);
    await panel.getByRole("button", { name: "搜索" }).click();
    await panel
      .getByRole("combobox", { name: "选择要添加的家属账号" })
      .click();
    await page.getByRole("option", { name: /family-guest/ }).click();
    await panel.getByRole("button", { name: "添加" }).click();
    await expect(page.getByText("监护成员已更新").first()).toBeVisible();
    await expect(memberRow(page, GUEST_USERNAME)).toBeVisible();
    await expect(memberRoleSelect(page, GUEST_USERNAME)).toContainText(
      "普通成员"
    );

    // 调整角色：family 升为主照护者，relation 由前端回填保持不变
    const familyRow = memberRow(page, FAMILY.username);
    await expect(familyRow.getByText("女儿")).toBeVisible();
    await memberRoleSelect(page, FAMILY.username).click();
    await page.getByRole("option", { name: "主照护者" }).click();
    await expect(page.getByText("监护成员已更新").first()).toBeVisible();
    await expect(memberRoleSelect(page, FAMILY.username)).toContainText(
      "主照护者"
    );
    await expect(familyRow.getByText("女儿")).toBeVisible();

    // 恢复 family 为普通成员，随后把唯一的主照护者降级 → 后端 422 拒绝
    await memberRoleSelect(page, FAMILY.username).click();
    await page.getByRole("option", { name: "普通成员" }).click();
    await expect(page.getByText("监护成员已更新").first()).toBeVisible();
    await expect(memberRoleSelect(page, FAMILY.username)).toContainText(
      "普通成员"
    );
    await expect(familyRow.getByText("女儿")).toBeVisible();

    await memberRoleSelect(page, OWNER.username).click();
    await page.getByRole("option", { name: "普通成员" }).click();
    await expect(page.getByText("至少保留一位主照护者")).toBeVisible();

    // 保存失败未写入：重试后自己仍是主照护者
    await panel.getByRole("button", { name: "重试" }).click();
    await expect(memberRoleSelect(page, OWNER.username)).toContainText(
      "主照护者"
    );
    await expect(ownRow.getByText("我")).toBeVisible();

    // 收尾：移除 family-guest，恢复 seed 的「候选账号未关联任何老人」状态
    await memberRow(page, GUEST_USERNAME)
      .getByRole("button", { name: "移除" })
      .click();
    await expect(page.getByText("监护成员已更新").first()).toBeVisible();
    await expect(memberRow(page, GUEST_USERNAME)).toHaveCount(0);
    await expect(familyRow.getByText("女儿")).toBeVisible();
  });
});

test.describe("普通成员（member）权限", () => {
  test("无编辑入口、无成员分区，直链 ?tab=members 回落档案分区", async ({
    page,
  }) => {
    await login(page, FAMILY);
    await page.goto("/elders/");

    const listRow = page.getByRole("row").filter({ hasText: DEMO_ELDER });
    await expect(listRow.getByText("普通成员")).toBeVisible();
    await expect(listRow.getByRole("button", { name: "编辑档案" })).toHaveCount(0);

    await listRow.getByRole("button", { name: "查看详情" }).click();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);
    const elderId = Number(new URL(page.url()).searchParams.get("id"));

    // member 只渲染 3 个分区，且没有「编辑档案」入口
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(page.getByRole("tab", { name: "监护成员" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "编辑档案" })).toHaveCount(0);

    // 直链 ?tab=members：规格只要求回落到档案分区（实现会把地址栏改写为 profile）
    await page.goto(`/elders/detail?id=${elderId}&tab=members`);
    await expect(
      page.getByRole("tab", { name: "档案与联系人" })
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "档案信息" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "监护成员" })).toHaveCount(0);

    // 联系人仍可编辑
    await expect(page.getByRole("button", { name: "编辑联系人" })).toBeVisible();

    // 围栏仍可编辑
    await page.getByRole("tab", { name: "设备与围栏" }).click();
    await expect(page.getByRole("button", { name: "保存围栏" })).toBeVisible();

    // 编辑页：权限空态，且没有删除区
    await page.goto(`/elders/edit?id=${elderId}`);
    await expect(page.getByText("需要主照护者权限")).toBeVisible();
    await expect(page.getByText("危险操作")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "删除老人" })).toHaveCount(0);
  });

  test("member 可以确认告警", async ({ page }) => {
    triggerScenario("fall");

    await login(page, FAMILY);
    await page.goto("/alerts/");

    const row = page
      .getByRole("row")
      .filter({ hasText: "跌倒" })
      .filter({ hasText: "未处理" })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: /确认/ }).click();
    await expect(page.getByText("告警已确认")).toBeVisible();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "跌倒" })
        .first()
        .getByText("已处理")
    ).toBeVisible();
  });
});

test.describe("已移除的长辈视图", () => {
  test("直链 /elder-view/ 落回首页", async ({ page }) => {
    await login(page, ADMIN);

    // 部署环境由 nginx 301 回首页（开发服务器无该路由）
    await page.goto("/elder-view/");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "概览台", level: 1 })
    ).toBeVisible();
  });
});
