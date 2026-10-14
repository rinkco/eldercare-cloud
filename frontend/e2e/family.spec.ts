import { expect, test, type Page } from "@playwright/test";

import {
  ADMIN,
  FAMILY,
  GUEST,
  TEST,
  login,
  triggerScenario,
  uniquePhone,
  uniqueSuffix,
} from "./helpers";

// 演示数据（scripts/seed.py）：演示老人关联 family（relation=daughter）与测试账号
// laowang（relation 为空）；family-guest 未关联任何老人。
// SPEC 04：家属成员权限一致，不再区分 owner / member。
// SPEC 06：家属只能自助绑定（新建自动绑定 / 按手机号添加）与自助解绑，
//          成员增删与候选检索收敛为仅 admin，家属侧「监护成员」Tab 只读。
const DEMO_ELDER = "演示老人-张奶奶";

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

/** 切换账号并取回该账号的登录 token（接口级收尾用）。 */
async function loginToken(
  page: Page,
  account: { username: string; password: string }
): Promise<string> {
  await page.evaluate(() => {
    try {
      window.sessionStorage.clear();
    } catch {
      // about:blank 等不透明源没有 sessionStorage，忽略即可
    }
  });
  await login(page, account);
  const token = await page.evaluate(() => {
    const raw = window.sessionStorage.getItem("eldercare.session");
    return raw ? (JSON.parse(raw) as { token: string }).token : null;
  });
  expect(token).toBeTruthy();
  return token as string;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** 接口级新建临时老人（admin 创建不产生绑定），返回其 id。 */
async function createElderViaApi(
  page: Page,
  token: string,
  name: string,
  phone: string
): Promise<number> {
  const response = await page.request.post("/api/v1/elders", {
    headers: authHeaders(token),
    data: { name, phone },
  });
  expect(response.status(), await response.text()).toBe(201);
  const elder = (await response.json()) as { id: number };
  return elder.id;
}

async function deleteElderViaApi(
  page: Page,
  token: string,
  elderId: number
): Promise<void> {
  const response = await page.request.delete(`/api/v1/elders/${elderId}`, {
    headers: authHeaders(token),
  });
  expect([200, 204]).toContain(response.status());
}

/** 从账号列表读取账号 id（收尾恢复成员时用）。 */
async function findUserId(
  page: Page,
  token: string,
  username: string
): Promise<number> {
  const response = await page.request.get("/api/v1/users", {
    headers: authHeaders(token),
  });
  expect(response.status()).toBe(200);
  const rows = (await response.json()) as Array<{
    id: number;
    username: string;
  }>;
  const matched = rows.find((row) => row.username === username);
  expect(matched, `账号 ${username} 未找到`).toBeTruthy();
  return matched!.id;
}

test.describe("家属自助绑定与解绑（SPEC 06）", () => {
  test("家属按手机号添加老人自助绑定，取消绑定后自助退出（最后一位成员）", async ({
    page,
  }) => {
    const name = `E2E手机号老人-${uniqueSuffix()}`;
    const phone = uniquePhone();
    const adminToken = await loginToken(page, ADMIN);
    const elderId = await createElderViaApi(page, adminToken, name, phone);

    try {
      // 未关联任何老人的家属账号：列表空态给出两种入口
      await loginToken(page, GUEST);
      await page.goto("/elders/");
      await expect(page.getByText(/还没有关联老人/)).toBeVisible();

      await page.getByRole("button", { name: "添加老人" }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "添加老人" })
      ).toBeVisible();

      // 前端：11 位手机号格式校验
      await dialog.getByLabel("老人手机号").fill("123");
      await dialog.getByRole("button", { name: "确认添加" }).click();
      await expect(dialog.getByText("请输入 11 位手机号。")).toBeVisible();

      // 后端：未命中手机号 → 404 detail 内联展示在弹窗内
      await dialog.getByLabel("老人手机号").fill("13900000000");
      await dialog.getByRole("button", { name: "确认添加" }).click();
      await expect(
        dialog.getByText(/未找到该手机号对应的老人档案/)
      ).toBeVisible();

      // 命中：家属自动绑定自己并跳转详情
      await dialog.getByLabel("老人手机号").fill(phone);
      await dialog.getByRole("button", { name: "确认添加" }).click();
      await expect(page.getByText(`已添加老人：${name}`)).toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`/elders/detail/?\\?id=${elderId}`)
      );
      await expect(
        page.getByRole("heading", { name, level: 1 })
      ).toBeVisible();
      await expect(page.getByText(phone).first()).toBeVisible();

      // 列表：新老人可见，手机号列展示手机号
      await page.goto("/elders/");
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toBeVisible();
      await expect(row.getByText(phone)).toBeVisible();

      // 取消绑定：二次确认后自助退出（此时自己就是最后一位成员）
      await row.getByRole("button", { name: "取消绑定" }).click();
      const confirm = page.getByRole("dialog");
      await expect(
        confirm.getByText("确认取消与这位老人的绑定？")
      ).toBeVisible();
      await confirm
        .getByRole("button", { name: "取消绑定", exact: true })
        .click();
      await expect(page.getByText(`已取消与${name}的绑定`)).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(
        0
      );
      await expect(page.getByText(/还没有关联老人/)).toBeVisible();

      // 解绑只影响自己的可见范围：老人档案本身仍然存在
      await loginToken(page, ADMIN);
      await page.goto("/elders/");
      await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
    } finally {
      // 收尾：删除临时老人（连同其访问关系），不留下脏数据
      const cleanupToken = await loginToken(page, ADMIN);
      await deleteElderViaApi(page, cleanupToken, elderId);
    }
  });

  test("家属的监护成员 Tab 只读（无搜索 / 添加 / 移除入口）", async ({
    page,
  }) => {
    const elderId = await openDemoElderDetail(page, FAMILY);
    await page.getByRole("tab", { name: "监护成员" }).click();
    await expect(page).toHaveURL(/tab=members/);

    const panel = membersPanel(page);
    await expect(panel.getByRole("table")).toBeVisible();
    // 成员名单与「我」标记保留
    await expect(memberRow(page, FAMILY.username).getByText("我")).toBeVisible();
    await expect(
      memberRow(page, FAMILY.username).getByText("女儿")
    ).toBeVisible();

    // 只读：没有搜索框、添加、移除入口，并给出权限提示
    await expect(panel.getByPlaceholder("账号或显示名关键字")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "添加", exact: true })
    ).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "移除" })).toHaveCount(0);
    await expect(
      panel.getByText(
        "成员管理仅管理员可用；可在「老人档案」中对这位老人取消绑定。"
      )
    ).toBeVisible();

    // 直链 ?tab=members 对可见老人保持只读视图，不回落档案分区
    await page.goto(`/elders/detail/?id=${elderId}&tab=members`);
    await expect(page.getByRole("tab", { name: "监护成员" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(membersPanel(page).getByRole("table")).toBeVisible();

    // 不可见的老人：?tab=members 才回落到档案分区（错误态可见）
    const adminToken = await loginToken(page, ADMIN);
    const hiddenId = await createElderViaApi(
      page,
      adminToken,
      `E2E未绑定老人-${uniqueSuffix()}`,
      uniquePhone()
    );
    try {
      await loginToken(page, FAMILY);
      await page.goto(`/elders/detail/?id=${hiddenId}&tab=members`);
      await expect(
        page.getByText("无权查看这位老人的档案。")
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "档案与联系人" })
      ).toHaveAttribute("aria-selected", "true");
    } finally {
      const cleanupToken = await loginToken(page, ADMIN);
      await deleteElderViaApi(page, cleanupToken, hiddenId);
    }
  });

  test("家属取消绑定只解除自己；管理员仍可管理全部成员", async ({ page }) => {
    const elderId = await openDemoElderDetail(page, FAMILY);

    try {
      // 家属在列表行内自助解绑（不触碰其他成员的绑定）
      await page.goto("/elders/");
      await page
        .getByRole("row")
        .filter({ hasText: DEMO_ELDER })
        .getByRole("button", { name: "取消绑定" })
        .click();
      const confirm = page.getByRole("dialog");
      await expect(
        confirm.getByText(/确认取消与这位老人的绑定/)
      ).toBeVisible();
      await confirm
        .getByRole("button", { name: "取消绑定", exact: true })
        .click();
      await expect(page.getByText(`已取消与${DEMO_ELDER}的绑定`)).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: DEMO_ELDER })
      ).toHaveCount(0);

      // 解绑即生效：该账号无法再打开详情
      await page.goto(`/elders/detail/?id=${elderId}`);
      await expect(page.getByText("无权查看这位老人的档案。")).toBeVisible();

      // 其他成员不受影响：laowang 仍能看到演示老人
      await loginToken(page, TEST);
      await page.goto("/elders/");
      await expect(
        page.getByRole("row").filter({ hasText: DEMO_ELDER })
      ).toBeVisible();
    } finally {
      // 收尾：管理员恢复 seed 绑定（family → daughter + laowang），必须保留关系备注。
      // 放在 finally 里保证断言中途失败也能恢复，不连锁破坏后续用例与另外两个档位；
      // 恢复逻辑幂等，可安全重复执行（三个档位都会跑本文件）。
      const adminToken = await loginToken(page, ADMIN);
      const familyId = await findUserId(page, adminToken, FAMILY.username);
      const testId = await findUserId(page, adminToken, TEST.username);
      const restored = await page.request.put(
        `/api/v1/elders/${elderId}/access`,
        {
          headers: authHeaders(adminToken),
          data: [
            { user_id: familyId, relation: "daughter" },
            { user_id: testId, relation: null },
          ],
        }
      );
      expect(restored.status()).toBe(200);
    }

    // 恢复结果：家属重新可见，成员名单与关系备注不变
    await loginToken(page, FAMILY);
    await page.goto(`/elders/detail/?id=${elderId}&tab=members`);
    await expect(
      memberRow(page, FAMILY.username).getByText("女儿")
    ).toBeVisible();
    await expect(memberRow(page, TEST.username)).toBeVisible();
    await page.goto("/elders/");
    await expect(
      page.getByRole("row").filter({ hasText: DEMO_ELDER })
    ).toBeVisible();
  });

  test("家属成员可以编辑老人档案，不再出现权限空态", async ({ page }) => {
    const elderId = await openDemoElderDetail(page, FAMILY);
    await page.getByRole("button", { name: "编辑档案" }).click();
    await expect(page).toHaveURL(/\/elders\/edit\/?\?id=\d+/);

    await expect(page.getByText("需要主照护者权限")).toHaveCount(0);
    await expect(page.getByLabel("姓名 *")).toHaveValue(DEMO_ELDER);
    // 原值保存：验证 family 侧保存链路可用，且不改动演示数据
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
