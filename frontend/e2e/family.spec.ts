import { expect, test, type Page } from "@playwright/test";

import { ADMIN, FAMILY, TEST, login, triggerScenario } from "./helpers";

// 演示数据（scripts/seed.py）：演示老人关联 family（relation=daughter）与测试账号
// laowang（relation 为空）；family-guest 未关联任何老人，作候选账号。
// SPEC 04：家属成员权限一致，不再区分 owner / member。
const DEMO_ELDER = "演示老人-张奶奶";
const GUEST_USERNAME = "family-guest";

function membersPanel(page: Page) {
  return page.locator("section").filter({ hasText: "监护成员" });
}

/** 监护成员表格中某一账号所在的整行。 */
function memberRow(page: Page, username: string) {
  return membersPanel(page).getByRole("row").filter({ hasText: username });
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

test.describe("统一家属权限（SPEC 04）", () => {
  test("家属成员可查看并管理监护成员，且不再有角色区分", async ({ page }) => {
    await login(page, FAMILY);
    await page.goto("/elders/");

    // 列表：family 视角不再有「我的角色」列，编辑入口直接可见
    const listRow = page.getByRole("row").filter({ hasText: DEMO_ELDER });
    await expect(listRow.getByText("主照护者")).toHaveCount(0);
    await expect(listRow.getByText("普通成员")).toHaveCount(0);
    await expect(listRow.getByRole("button", { name: "编辑档案" })).toBeVisible();

    await listRow.getByRole("button", { name: "查看详情" }).click();
    await expect(page).toHaveURL(/\/elders\/detail\/?\?id=\d+/);
    await expect(
      page.getByRole("heading", { name: DEMO_ELDER, level: 1 })
    ).toBeVisible();

    await page.getByRole("tab", { name: "监护成员" }).click();
    await expect(page).toHaveURL(/tab=members/);

    const panel = membersPanel(page);
    await expect(panel.getByRole("table")).toBeVisible();
    // 表头不再有「角色」列
    await expect(
      panel.getByRole("columnheader", { name: "角色" })
    ).toHaveCount(0);

    // 「我」标记按 username 判定：自己那一行
    const ownRow = memberRow(page, FAMILY.username);
    await expect(ownRow.getByText("我")).toBeVisible();
    await expect(ownRow.getByText("女儿")).toBeVisible();

    // 候选搜索添加 family-guest（无角色选项，添加后即为同级成员）
    await expect(memberRow(page, GUEST_USERNAME)).toHaveCount(0);
    await panel.getByPlaceholder("账号或显示名关键字").fill(GUEST_USERNAME);
    await panel.getByRole("button", { name: "搜索" }).click();
    await panel
      .getByRole("combobox", { name: "选择要添加的家属账号" })
      .click();
    await page.getByRole("option", { name: /family-guest/ }).click();
    await panel.getByRole("button", { name: "添加" }).click();
    await expect(page.getByText("监护成员已更新").first()).toBeVisible();
    await expect(memberRow(page, GUEST_USERNAME)).toBeVisible();

    // 收尾：移除 family-guest，恢复 seed 的「候选账号未关联任何老人」状态
    await memberRow(page, GUEST_USERNAME)
      .getByRole("button", { name: "移除" })
      .click();
    await expect(page.getByText("监护成员已更新").first()).toBeVisible();
    await expect(memberRow(page, GUEST_USERNAME)).toHaveCount(0);
    // 增删成员不影响既有行的关系备注
    await expect(
      memberRow(page, FAMILY.username).getByText("女儿")
    ).toBeVisible();
  });

  test("测试账号同样可以管理成员，最后一位成员也可以取消绑定（SPEC 05）", async ({
    page,
  }) => {
    const elderId = await openDemoElderDetail(page, TEST);
    await page.getByRole("tab", { name: "监护成员" }).click();

    // 初始：seed 给演示老人关联 family（daughter）与测试账号 laowang
    const ownRow = memberRow(page, TEST.username);
    await expect(ownRow.getByText("我")).toBeVisible();
    await expect(memberRow(page, FAMILY.username)).toBeVisible();
    await expect(ownRow.getByRole("button", { name: "移除" })).toBeEnabled();

    // 先移除其他成员（此时自己仍有权限），列表只剩自己一位
    await memberRow(page, FAMILY.username)
      .getByRole("button", { name: "移除" })
      .click();
    await expect(page.getByText("监护成员已更新").first()).toBeVisible();
    await expect(memberRow(page, FAMILY.username)).toHaveCount(0);

    // SPEC 05：最后一位成员也可以移除（旧行为是「至少保留一位」禁用按钮）
    await expect(ownRow.getByRole("button", { name: "移除" })).toBeEnabled();
    await ownRow.getByRole("button", { name: "移除" }).click();
    await expect(page.getByText("监护成员已更新").first()).toBeVisible();
    await expect(membersPanel(page).getByText("暂未授权家属")).toBeVisible();

    // 取消绑定立即生效：该账号在老人列表看不到演示老人
    await page.goto("/elders/");
    await expect(
      page.getByRole("row").filter({ hasText: DEMO_ELDER })
    ).toHaveCount(0);
    await expect(page.getByText("暂无老人档案")).toBeVisible();

    // 收尾：精确恢复 seed 状态（family + laowang 两行，且保留 family 的 relation）。
    // 这里必须走接口恢复而不是界面：界面「添加」不带 relation，会把 family 的
    // "daughter" 丢成 null，导致后续 project（desktop-wide / mobile-chromium）
    // 复跑本文件时断言「女儿」失败。恢复逻辑幂等，可安全重复执行。
    await page.evaluate(() => window.sessionStorage.clear());
    await login(page, ADMIN);
    const adminToken = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem("eldercare.session");
      return raw ? (JSON.parse(raw) as { token: string }).token : null;
    });
    expect(adminToken).toBeTruthy();
    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    // 候选接口只返回「尚未关联该老人」的 family 账号，清空后可精确取回两个账号 ID
    const findUserId = async (username: string): Promise<number> => {
      const response = await page.request.get(
        `/api/v1/elders/${elderId}/access/candidates?q=${username}`,
        { headers: authHeaders }
      );
      expect(response.status()).toBe(200);
      const rows = (await response.json()) as Array<{
        id: number;
        username: string;
      }>;
      const matched = rows.find((row) => row.username === username);
      expect(matched, `候选账号 ${username} 未找到`).toBeTruthy();
      return matched!.id;
    };
    const familyId = await findUserId(FAMILY.username);
    const testId = await findUserId(TEST.username);

    const restored = await page.request.put(
      `/api/v1/elders/${elderId}/access`,
      {
        headers: authHeaders,
        data: [
          { user_id: familyId, relation: "daughter" },
          { user_id: testId, relation: null },
        ],
      }
    );
    expect(restored.status()).toBe(200);

    // 回到界面确认恢复结果：两行都在，family 行关系备注仍是「女儿」
    await page.goto(`/elders/detail/?id=${elderId}`);
    await page.getByRole("tab", { name: "监护成员" }).click();
    await expect(memberRow(page, TEST.username)).toBeVisible();
    await expect(
      memberRow(page, FAMILY.username).getByText("女儿")
    ).toBeVisible();
  });

  test("家属成员可以编辑老人档案，不再出现权限空态", async ({ page }) => {
    const elderId = await openDemoElderDetail(page, FAMILY);
    await page.getByRole("button", { name: "编辑档案" }).click();
    await expect(page).toHaveURL(/\/elders\/edit\/?\?id=\d+/);

    await expect(page.getByText("需要主照护者权限")).toHaveCount(0);
    await expect(page.getByLabel("姓名 *")).toHaveValue(DEMO_ELDER);
    // 原值保存：验证 member 侧保存链路可用，且不改动演示数据
    await page.getByRole("button", { name: "保存老人" }).click();
    await expect(page.getByText("老人档案已保存")).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/elders/detail/?\\?id=${elderId}`)
    );
  });

  test("家属成员可以确认告警", async ({ page }) => {
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
