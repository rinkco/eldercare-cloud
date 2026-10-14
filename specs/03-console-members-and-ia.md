# SPEC 03 — 管理台成员权限落地与前端信息架构优化

> **Status:** 已实现（本地验收通过）—— 成员角色部分被 SPEC 04 修订，见下方修订记录
> **Depends on:** SPEC 01、SPEC 02
> **Date:** 2026-10-11
> **Objective:** 在 Web 管理台落地家属 owner/member 两级权限的展示与操作边界，把告警与事件合并为单一入口、老人详情改分区 Tabs、移除长辈视图，并补齐管理员的账号-老人关联视图。

> **修订记录（SPEC 04：`specs/04-unified-family-access.md`）：** 本规格引入的 owner / member 两级成员角色、角色徽章与门控、「至少保留一位 owner」约束、`ElderOut.my_role` 字段以及 `family-owner` 演示账号安排均已被 SPEC 04 取消：家属成员权限一致（关联即可查看、编辑与管理成员），`elder_access` 删除 `role` 列（迁移 0006），第三个快捷登录按钮改为测试账号 `laowang`。以下正文保留原始表述，冲突处以 SPEC 04 为准。
>
> **修订记录（SPEC 05：`specs/05-cancel-elder-binding.md`）：** 上述守卫（原文「至少保留一位 owner」，SPEC 04 改述为「至少保留一位家属成员」）已被 SPEC 05 进一步取消：管理员与任意家属成员都可以取消任意账号（含最后一位）与老人的绑定，成员列表允许为空。正文冲突处同样以 SPEC 05 为准。

> **修订记录（SPEC 06：`specs/06-elder-phone-binding.md`）：** 本规格的成员管理界面（老人详情「监护成员」Tab 的搜索、添加、移除）与老人档案表单/列表已被 SPEC 06 修订——成员增删收敛为仅 admin，家属「监护成员」Tab 只读（保留成员列表与「我」标记）；「老人档案」列表页新增「添加老人」按钮与手机号列，家属行内新增「取消绑定」，老人表单新增「手机号 *」（必填、全局唯一）。以下正文保留原始表述，冲突处以 SPEC 06 为准。

## 为什么需要这份规格

- 后端早已实现按老人维度的成员角色（`owner` 主照护者 / `member` 普通成员，`elder_access.role`，迁移 0004），`docs/business-flows.md` 也写清了权限矩阵，但管理台前端只有 admin/family 二值判断：家属（含 owner）看不到自己的角色，owner 无法在界面上管理成员，member 还会看到点了必然 403 的按钮。SPEC 02 曾把「成员级权限」列为范围外，后续提交只补了后端与 admin 面板，规格、文档与 family 侧界面没有同步。
- 管理台实际只服务管理员与家属：老人不会直接使用 Web 管理台。SPEC 02 的「长辈视图」页面已没有使用场景，继续保留只增加维护面与演示噪音。
- 「告警中心」与「事件记录」是同一批数据（每条事件 1:1 生成一条告警）的两个入口，列表高度重复。
- 老人详情页 1500+ 行、8 个区块纵向堆叠，与健康/告警/事件三个专门页信息重叠，需要按成熟控制台的做法分层。

## 范围（Scope）

**In:**

- 后端：`ElderOut` 新增 `my_role`（`admin/owner/member`，列表、创建、详情、更新四处都返回）；新增 `GET /api/v1/users/{user_id}/elders`（仅 admin）；新增 `GET /api/v1/elders/{elder_id}/access/candidates?q=`（admin/owner，供 owner 添加成员时检索候选家属账号）。无数据库结构变更。
- 前端权限落地：老人列表「我的角色」列与按角色门控的操作按钮；老人详情角色徽章、监护成员区按 admin/owner 门控、owner 可添加/调整/移除成员；老人编辑页删除区仅 admin、member 进入编辑页给权限空态；用户列表新增「监护关系」列与抽屉（admin）；概览台家属 KPI 文案修正。
- 前端信息架构：告警与事件合并为单页双 Tab（URL 保持 `/alerts/`，`?view=alerts|events`）；`/events` 旧地址 301 到 `/alerts/?view=events`；老人详情改 4 个分区 Tabs（`?tab=` 可寻址）；移除长辈视图（页面、导航、组件、e2e 与全部引用；`/elder-view` 旧地址 301 回 `/`）；侧边导航收敛。
- 对标改进（受成熟产品做法启发、限定在本规格范围内）：成员角色徽章与「我」标记；账号-老人关联用「列 + 抽屉」；控制台详情页用可寻址 Tabs；导航与告警入口收敛。
- seed 与演示：新增 owner 演示账号（全局角色仍是 family）与一个**未关联任何老人**的候选演示账号 `family-guest`，`family` 保持 member；seed 显式写入并收敛 `elder_access.role`（口令默认值与脚本改动见实现计划第 4 步）；登录页快捷登录补第三个按钮。
- 测试与文档：后端 pytest 增补；Playwright 更新与 owner/member 新用例；SPEC 01/02、`docs/business-flows.md`、`docs/app-integration.md`、`README.md` 同步；除本规格自身的变更说明外，Web 代码、e2e、`specs/01-02`、README、`docs/business-flows.md` 中 `elder-view | 长辈视图` 0 命中（`docs/app-integration.md` App 端保留清单见实现计划第 15 步）。

**Out of scope（future specs）:**

- 管理台创建账号（注册仍走公开注册页）、审计日志查看页、设备停用/启用。
- 邀请-接受两阶段成员流程、字段级数据共享同意。
- 导航栏未处理告警角标、列表深链预筛选（如 `/health?elder=3`）。
- App/小程序端的任何改动（App 端自己的「长辈视图」见 `docs/app-integration.md`，保持不变）。
- 新页面（概览 Tab、设备详情页、地图选点围栏等）。

## 角色与权限矩阵（管理台视角）

全局角色为 `admin / family`；成员角色 `owner / member` 按老人生效。本表只描述管理台界面行为。

| 能力 | admin | owner | member | 管理台表现 |
| --- | --- | --- | --- | --- |
| 老人列表 / 详情 / 健康 / 事件 / 告警查看 | 全量 | 关联老人 | 关联老人 | 列表对 family 新增「我的角色」列；详情页头显示角色徽章 |
| 编辑老人档案 | 是 | 是 | 否 | 「编辑档案」按钮仅 admin/owner 可见；member 直链编辑页显示权限空态 |
| 删除老人 | 是 | 否 | 否 | 编辑页「危险操作」区仅 admin 显示（owner/member 不可见，无需再处理删除 403 文案） |
| 紧急联系人读写 | 是 | 是 | 是 | 不变（全员可见可编辑） |
| 电子围栏读写 | 是 | 是 | 是 | 不变 |
| 确认告警 | 是 | 是 | 是 | 不变 |
| 查看 / 管理监护成员 | 是 | 是 | 否 | 详情「监护成员」Tab 仅 admin/owner；owner 可通过候选搜索添加、调整角色、移除；成员列表不可为空，family 操作时至少保留一位 owner；member 不渲染该 Tab |
| 查看账号监护关系（用户列表） | 是 | 否 | 否 | 用户列表新增「监护关系」列 + 抽屉，仅 admin |
| 设备只读 | 是 | 是 | 是 | 不变 |
| 设备注册 / 绑定 / 解绑、用户列表 | 是 | 否 | 否 | 不变 |
| 新建老人 | 是 | 是（family 身份） | 是（family 身份） | 保留现行为：family 新建者自动成为该老人 owner |

## 数据模型与接口契约

本规格不新增数据库表、不新增迁移；变更集中在响应模型与两个新接口。

### 1. `ElderOut.my_role`（新增字段）

- 取值：`"admin" | "owner" | "member"`；含义是**调用者在该老人上的角色**；admin 账号一律返回 `"admin"`。
- 覆盖所有返回 `ElderOut` 的接口：
  - `GET /api/v1/elders`（列表逐行；admin 路径填 `"admin"`，family 路径连同 `ElderAccess.role` 一起查询，避免 N+1）；
  - `POST /api/v1/elders`（创建者：admin → `"admin"`，family → `"owner"`）；
  - `GET /api/v1/elders/{elder_id}` 与 `PUT /api/v1/elders/{elder_id}`（复用 `app/access.py` 的 `get_elder_role()`）。
- 响应示例：

```json
{
  "id": 3,
  "name": "演示老人-张奶奶",
  "gender": "female",
  "birth_date": "1945-03-02",
  "height_cm": 158,
  "weight_kg": 52.5,
  "address": "演示地址",
  "notes": null,
  "created_at": "2026-10-08T08:00:00Z",
  "my_role": "owner"
}
```

- 兼容性：只新增字段，既有字段与语义不动；App 端无需改动。注意 `my_role` 是必填字段，四处返回点必须全部提供，否则 FastAPI 响应校验会 500。

### 2. `GET /api/v1/users/{user_id}/elders`（仅 admin）

- 用途：用户列表「监护关系」列与抽屉。
- 鉴权：仅 admin（其他角色 403，`{"detail": "权限不足"}`）；用户不存在 → 404 `{"detail": "用户不存在"}`。
- 响应 `UserElderOut[]`，按 `elder_id` 升序：

```json
[
  {"elder_id": 3, "name": "演示老人-张奶奶", "role": "owner", "relation": "son"}
]
```

- admin 账号自身通常返回 `[]`（admin 不写入 `elder_access`）。

### 3. `GET /api/v1/elders/{elder_id}/access/candidates?q=`（admin/owner）

- 用途：owner 在「监护成员」中检索要添加的家属账号。现状的候选下拉依赖仅 admin 可调的 `GET /api/v1/users`，把面板放开给 owner 会立即 403，因此必须由本接口提供候选。
- 鉴权：admin 或该老人的 owner（member 与其他 family → 403）。
- 参数：`q` 必填，1–32 字符；对 `username` 与 `display_name` 做大小写不敏感的包含匹配；仅返回全局角色为 `family` 的账号；排除已是该老人成员的账号；按 `id` 升序，最多 10 条。
- 响应 `AccessCandidateOut[]`：

```json
[
  {"id": 9, "username": "zhang-family", "display_name": "张奶奶女儿"}
]
```

- 演示前置：seed 提供一个未关联任何老人的家属账号 `family-guest`，保证 owner 在演示与 e2e 中能搜到可添加的候选账号（否则候选恒为空）。

### 4. 其他

- WebSocket 契约不变（载荷与可见范围只取决于全局角色与关联集合）。
- 前端类型：`frontend/src/lib/types.ts` 的 `Elder` 增加 `my_role: "admin" | "owner" | "member"`；新增 `UserElder` 与 `AccessCandidate`。
- `elder_access` 表结构不变；`relation` 字段维持现状（seed 写入、界面只读展示；保存成员时前端负责回填保留，见「前端信息架构」）。

## 前端信息架构

### 路由（变更后）

| 路由 | 名称 | 角色 | 变化 |
| --- | --- | --- | --- |
| `/alerts` | 告警与事件 | admin / family | 合并原 `/events`；Tab：告警（`?view=alerts`，默认）/ 事件（`?view=events`） |
| `/elders/detail` | 老人详情 | admin / family | 分区 Tabs：`?tab=profile|members|devices|data`，默认 `profile`；member 不渲染 members |
| `/events` | — | — | 移除；部署环境 301 → `/alerts/?view=events` |
| `/elder-view` | — | — | 移除；部署环境 301 → `/` |
| 其他 | 不变 | — | `/`、`/elders`、`/elders/edit`、`/devices`、`/health`、`/users`、`/login`、`/register` |

`?tab=` 与 `?view=` 的读取沿用现有页面的 `window.location.search` 方式，回写用 `history.replaceState`（避免静态导出下 `useSearchParams` 的 Suspense 边界问题）；非法或不可见的 `?tab=` 值回落到默认 `profile`（member 访问 `?tab=members` 同样回落）。

### 侧边导航

- 总览：概览台
- 档案：老人档案、设备管理（admin）
- 监护：健康数据、告警与事件
- 系统：用户列表（admin）
- 账号菜单保持 `username · 管理员/家属`（owner/member 是老人维度角色，不放入全局菜单）。

### 老人详情 Tabs

1. 档案与联系人（默认）：档案信息 + 紧急联系人（读写，全员）
2. 监护成员（admin/owner）：成员列表（角色徽章、relation 只读展示；「我」标记以 `member.username === session.username` 判定）+ 添加（候选搜索）/ 调整角色 / 移除。成员列表不可为空，family 操作时至少保留一位 owner；保存时前端回填既有行的 `relation`，不因改角色而清空
3. 设备与围栏：绑定设备（只读）+ 电子围栏编辑器
4. 数据记录：最近遥测 + 最近事件 + 最近告警（保持各 20 条）

分区只改变信息组织，不改变各区块自身行为；`?tab=` 可寻址（刷新/分享保持所在分区）。

### 告警与事件合并页

- Tab 1 告警：沿用现有告警列表（状态/老人过滤、确认、通知记录），保留 `aria-label="告警状态"` 等既有可访问性契约。
- Tab 2 事件：沿用现有事件列表（类型/状态/老人/时间过滤、完整 Payload 详情）。
- Tab 切换用 `history.replaceState` 回写 `?view=`，刷新与分享保持所在视图。
- 概览台「前往告警中心」链接文案改为「前往告警与事件」。
- 移除 `/events` 页面与导航项；侧边导航不再出现「事件记录」。

### 用户列表「监护关系」

- 仅 admin 页面（沿用现有 `RoleGuard`）；表格新增「监护关系」列，单元格为「查看」按钮，点击打开右侧抽屉（新增 `components/ui/sheet.tsx`，基于现有 Radix Dialog 依赖实现，含 Esc 关闭、焦点圈定与 `aria-modal`）。
- 抽屉内容：账号基本信息（账号、显示名、手机号、全局角色）+ 关联老人列表（老人名、角色徽章、relation）+「编辑账号」入口（打开现有编辑弹窗）。数据来自 `GET /api/v1/users/{user_id}/elders`。
- 全局角色列（管理员/家属）保持原样；owner/member 只出现在关联列表里。

### 文案与状态

- 老人列表（family）：「可见范围：关联老人」徽章保留；每行新增「我的角色」徽章：主照护者（品牌色）/ 普通成员（中性色）。
- 老人详情页头：姓名旁角色徽章（管理员/主照护者/普通成员）。
- 编辑页 member 空态：「需要主照护者权限」+ 返回详情按钮。
- 概览台家属「今日告警」卡：hint 由「设备侧仅管理员可见」改为「今日新产生的告警」。

## 对标参考

以下为成熟产品/开源项目的既有做法，本规格只采纳其中已列入 Scope 的部分，其余留作后续。

| 做法 | 代表产品/项目 | 本规格落点 |
| --- | --- | --- |
| 成员角色用徽章 + 「我」标记，角色差异一眼可见 | 涂鸦智能家庭、Apple Home（住户/访客）、华为运动健康家庭空间 | 成员列表角色徽章与「我」标记；老人列表「我的角色」列；详情页头角色徽章 |
| 成员管理有明确入口，按角色收口并说明权限 | 涂鸦智能、Slack 成员管理 | 「监护成员」Tab 仅 admin/owner；面板描述写明主照护者/普通成员权限差异；member 不渲染 |
| 「告警 = 需人处理的对象、事件 = 设备原始日志」，单入口分层 | Sentry（issue/event）、PagerDuty、Grafana Alerting | 合并页两个 Tab：告警（ack/通知）与事件（只读完整 Payload） |
| 账号列表 + 关联摘要 + 抽屉详情 | Supabase Studio、Vercel、Google Workspace 管理台 | 用户列表「监护关系」列 + 抽屉 |
| 控制台详情页用可寻址 Tabs（4–7 个）而非长滚动 | Vercel 项目页、Supabase 项目页、云控制台实例详情 | 老人详情 4 个 Tab，`?tab=` 可寻址 |
| 导航收敛，不设「展示模式」级页面 | 萤石云、家庭安防类产品（家庭成员侧使用） | 移除长辈视图，导航收敛为 总览/档案/监护/系统 |

## 实现计划

每个步骤以可提交的小步为单位；后端步骤跑 `docker compose exec -T backend python -m pytest -q`，前端步骤跑 `npx tsc --noEmit`，改动前端后在步骤 14 统一跑 Playwright。

1. 后端 `ElderOut.my_role`：`app/schemas.py` 新增字段；`app/routers/elders.py` 四处返回点补值（列表 admin 路径填 `"admin"`、family 路径连同 role 查询；创建按创建者角色；详情/更新复用 `get_elder_role()`）；`tests/test_elders_api.py` 增补用例（admin 列表全 `"admin"`、family 列表按角色、创建者 `"owner"`、详情/更新返回一致）。实现方式：给 ORM 实例挂 `my_role` 属性后交给 `from_attributes` 校验（额外属性会被忽略），或显式构造 `ElderOut(...)`；不要用 `ElderOut(**elder.__dict__)`（父类 `extra="forbid"` 会拒绝 `_sa_instance_state`）。
2. 后端 `GET /api/v1/users/{user_id}/elders`：`UserElderOut` 响应模型 + `app/routers/users.py` 路由（403 → 404 顺序）；`tests/test_users_api.py` 增补用例（admin 200 严格断言、family 403、用户不存在 404、member 关联也返回、admin 自身 `[]`）。
3. 后端 `GET /api/v1/elders/{elder_id}/access/candidates`：`AccessCandidateOut` + 路由（admin/owner 鉴权、仅 family、排除已有成员、limit 10）+ `tests/test_elders_api.py` 用例（admin/owner 200、member 403、排除逻辑、`q` 边界 422）。
4. seed 与演示账号：`scripts/seed.py` 新增 `SEED_OWNER_USERNAME/PASSWORD`（默认 `family-owner` / `owner123456`）与 `SEED_GUEST_USERNAME/PASSWORD`（默认 `family-guest` / `guest123456`，不写 `elder_access`）；`_ensure_access` 泛化并显式写入、重跑收敛 role/relation（迁移 0004 曾把存量行回填为 owner，收敛逻辑是验收前置）；docstring 补两行；`.env.example`、`docker-compose.yml` 环境变量；登录页快捷登录第三个按钮（`NEXT_PUBLIC_DEMO_OWNER_*`，含 `frontend/Dockerfile` 与 `docker-compose.yml` 构建参数）；跑 seed 验证 `family`=member、`family-owner`=owner、`family-guest` 无关联。
5. 前端基础：`types.ts` 补 `my_role`/`UserElder`/`AccessCandidate`；新增成员角色标签与徽章工具（主照护者/普通成员）；`tsc --noEmit` 通过。
6. 老人列表：family 视角新增「我的角色」列（徽章）；行内「编辑档案」按钮按 `my_role` 门控（admin/owner 显示，member 隐藏）；空态按钮口径统一。
7. 老人详情（权限部分）：页头角色徽章（`PageHeader` 增加可选 `titleAddon` 插槽，徽章不进入 `h1` 文本，保持可访问名稳定）；「编辑档案」与档案区「编辑」按钮门控 admin/owner；「监护成员」区门控 admin/owner；添加成员改为候选搜索（调用步骤 3 接口）；member 不渲染成员区（含不发请求）；成员保存回填既有 `relation`；「我」标记用 `member.username === session.username` 判定。
8. 老人编辑页：member 进入已存在老人时显示权限空态；「危险操作」删除区仅 admin（owner/member 不可见，无需再单独处理删除 403 文案）。
9. 用户列表：「监护关系」列 + 右侧抽屉；新增 `components/ui/sheet.tsx` 原语（Radix Dialog 基座、Esc/焦点圈定）；抽屉调用步骤 2 接口；保留现有编辑弹窗，抽屉提供「编辑账号」入口。
10. 概览台：家属「今日告警」卡 hint 文案修正。
11. 告警与事件合并：`/alerts` 改为双 Tab 容器（`?view=`，切换用 `history.replaceState` 回写、读取沿用 `window.location.search`），事件列表迁入（保留原过滤与完整 Payload 详情）；删除 `/events` 页面与导航项；概览链接文案更新；`frontend/nginx.conf` 为 `/events` 与 `/events/` 各加 301 到 `/alerts/?view=events`（原 URL 带查询串时以 `&$args` 拼接）；`playwright.config.ts`：`desktop-wide` 改为 `/(auth|health|roles)/`、`mobile-chromium` 改为 `/(auth|roles)/`（合并页对应用例在第 14 步统一更新）。
12. 老人详情改 4 个分区 Tabs：复用现有 `ui/tabs.tsx`（当前无消费者）；区块迁移不改行为；`?tab=` 可寻址（沿用 `window.location.search` 读取 + `replaceState` 回写；非法值回落 `profile`）；member 显示 3 个 Tab 且 `?tab=members` 回落 `profile`。默认分区变化会影响既有 e2e 对设备/遥测的断言，改法见第 14 步。
13. 移除长辈视图：删除 `app/(dashboard)/elder-view/` 与 `components/elder-view-client.tsx`、`e2e/elder-view.spec.ts`；清理 `app-shell.tsx` 导航项与图标 import；`nginx.conf` 为 `/elder-view` 与 `/elder-view/` 各加 301 回 `/`；`rg -i "elder-view|长辈视图"` 复核：除本规格自身的变更说明外，Web 代码、e2e、`specs/01-02`、README、`docs/business-flows.md` 应 0 命中；`docs/app-integration.md` 按保留清单处理（23、26、286、316、1225、1239 保留，304 改写）。
14. e2e 更新与新增：`events.spec.ts` 改走 `/alerts/?view=events`（Payload 断言在事件 Tab 内）；`alerts.spec.ts` 适配 Tab 容器并保留 `aria-label="告警状态"` 等契约；`elders.spec.ts` 的 family 用例升级为 member 语义，涉及设备/遥测/告警的断言先切换到对应 Tab；`helpers.ts` 新增 `OWNER` 导出与 `E2E_OWNER_USERNAME/PASSWORD` 覆盖，`devices.spec.ts` 改用 `FAMILY` 常量；新增 `roles.spec.ts`（owner：成员面板可见、搜索 `family-guest` 并添加、调整角色后 relation 保留、移除受限；member：无编辑入口、无成员 Tab、`?tab=members` 回落、可确认告警、编辑页权限空态与无删除区；直链 `/elder-view/` 落回 `/`）；全套 Playwright 跑通（1440 全量 + 1920/390 核心档位）。
15. 文档与规格同步：`README.md`（演示流程、账号清单补 `family-owner`/`family-guest`、env 表补 `SEED_OWNER_*`/`SEED_GUEST_*` 与 `NEXT_PUBLIC_DEMO_OWNER_*`）、`docs/business-flows.md`（矩阵补「查看账号监护关系」行、删长辈视图行、接口表补两个新接口与 `ElderOut.my_role` 字段、演示脚本与边界更新）、`docs/app-integration.md`（`ElderOut` 字段表补 `my_role`、新增两个接口章节、矩阵行、修正「Web/App」混写、演示账号表补两项）、`specs/01`（`elder_access` 数据模型补 role；范围与决策去长辈视图）、`specs/02`（状态行与相关段落标注「被 SPEC 03 修订」，删除长辈视图条目）；最终 `rg -n -i "elder-view|长辈视图"` 复核保留清单。

## 验收标准

- [x] `GET /api/v1/elders`、`POST /api/v1/elders`、`GET /api/v1/elders/{id}`、`PUT /api/v1/elders/{id}` 的响应都含 `my_role`，取值正确（admin → `admin`；family 按关联；新建者 → `owner`）。
- [x] `GET /api/v1/users/{user_id}/elders`：admin 200 且 `elder_id/name/role/relation` 完整；family 403；用户不存在 404。
- [x] 候选搜索接口：admin/owner 200；member 403；结果仅 family 且不含已有成员；`q` 越界（空/超 32 字）422；最多 10 条；owner 能搜索到 `family-guest`。
- [x] 后端 `docker compose exec -T backend python -m pytest -q` 全部通过（含新增用例）。
- [x] member 登录：老人列表无「编辑档案」按钮；详情页无「编辑档案」按钮、无「监护成员」Tab；直链 `?tab=members` 回落 `profile`；直链编辑页显示权限空态且无删除区；「编辑联系人」、围栏编辑、告警「确认」均可用。
- [x] owner 登录：列表对应行显示「主照护者」徽章与编辑入口；详情「监护成员」Tab 可查看、可搜索添加 `family-guest`、可调整角色、可移除（成员列表不可为空，family 操作时至少保留一位 owner）；自己一行带「我」标记；调整角色后 relation 保持不变；保存后立即生效。
- [x] admin 登录：用户列表出现「监护关系」列；抽屉正确列出关联老人与角色；原编辑账号流程不受影响。
- [x] 告警与事件：侧边导航只有「告警与事件」；`/alerts/` 默认告警 Tab；`?view=events` 直达事件 Tab；事件完整 Payload 可见；部署环境访问 `/events` 与 `/events/` 均 301 到 `/alerts/?view=events`（保留原有查询串；301 断言需在 nginx 容器上执行）。
- [x] 老人详情 4 个 Tab（admin/owner）/ 3 个（member）切换正常，`?tab=` 直达有效，各区块行为与改造前一致。
- [x] 长辈视图移除：除本规格自身的变更说明外，Web 代码、e2e、`specs/01-02`、README、`docs/business-flows.md` 中 `elder-view | 长辈视图` 0 命中；`docs/app-integration.md` 仅按保留清单处理；`/elder-view` 与 `/elder-view/` 均 301 回 `/`；导航无此项。
- [x] seed 之后（验收前需重跑 seed，把存量卷的 role/relation 收敛为配置值）：演示老人同时存在 `family`（member）与 `family-owner`（owner）两个关联；`family-guest` 未关联任何老人且可被候选搜索命中；登录页三个快捷登录按钮可用。
- [x] family 概览台「今日告警」卡 hint 为「今日新产生的告警」。
- [x] `npx tsc --noEmit` 无错误；`npm run build` 静态导出成功。
- [x] Playwright 全量通过（1440 全量；1920/390 核心档位更新后仍通过），含新增 `roles.spec.ts`。
- [x] `docker compose down -v` 后冷启动 `up -d --build`：frontend/backend/postgres/mosquitto 全部 healthy，`migrate` Exited (0)。
- [x] 响应式 1440×900、1920×1080、390×844 三档：新增列、抽屉与 Tabs 无溢出、无遮挡（表格允许局部横滚；含登录页三个快捷按钮的换行布局）。
- [x] 无障碍：新增控件（含右侧抽屉 `sheet`、Tabs）键盘可达、focus 可见、`aria-modal` 正确；合并页保留既有 `aria-label` 契约。

## 已定决策与已排除方案

- **是：** `my_role` 直接并入 `ElderOut`（新增字段）。列表徽章与详情门控一次取值，少一次请求，App 端兼容。**否：** 独立 `/elders/{id}/my-role` 接口（列表拿不到角色）；**否：** 前端探测 403 推断 member（语义脆弱）。
- **是：** owner 添加成员走老人维度的候选搜索接口（admin/owner、`q` 1–32 字符、最多 10 条）。兑现 `docs/business-flows.md` 的「owner 可添加/移除成员」，又避免向 family 暴露全量用户列表。**否：** owner 只能管理已有成员（违反既有文档）；**否：** 向 owner 开放 `GET /api/v1/users`（过度暴露）。
- **是：** 告警与事件合并为单页双 Tab，URL 保持 `/alerts/`；`/events` 301 到 `/alerts/?view=events`。**否：** 双页互链（重复仍在）；**否：** `/events` 直接 404（旧书签落空，301 更友好）。
- **是：** 长辈视图整体移除，`/elder-view` 301 回 `/`。管理台只服务 admin/family，老人使用 App。**否：** 改为大字版保留（无使用场景）；**否：** 404（沿用友好跳转）。
- **是：** 老人详情 4 个 Tabs（档案与联系人 / 监护成员 / 设备与围栏 / 数据记录），`?tab=` 可寻址；member 不渲染监护成员 Tab。**否：** 锚点长滚动；**否：** 再拆「概览」Tab（信息重复，留作后续）。
- **是：** 用户列表「列 + 抽屉」只读展示监护关系，编辑继续用现有弹窗；抽屉用新增的 `ui/sheet.tsx` 原语（Radix Dialog 基座）。**否：** 把编辑整体搬进抽屉（改动大、收益小）；**否：** 复用居中 Dialog 当抽屉；**否：** 引入新的抽屉依赖包。
- **是：** 成员「我」标记用 `member.username === session.username` 判定。**否：** 给 `Session` 增加 userId 并解码 JWT（收益小）。
- **是：** 成员保存时前端回填既有行 `relation`（不改变整体替换语义）。**否：** 改后端为局部更新接口（超出本规格）。
- **是：** seed 提供 `family-owner`（owner）与 `family-guest`（未关联、作候选）两个新账号，`family` 保持 member；`_ensure_access` 显式写 role 并在重跑时收敛。**否：** 把 `family` 改成 owner（失去只读对比）；**否：** 只加 owner 账号（候选恒为空，无法演示添加成员）。
- **是：** family（含 member）仍可新建老人（创建者自动成为 owner）。**否：** 收紧为仅 owner/admin 可新建（与既有后端行为冲突）。
- **是：** e2e 保留既有 aria-label/选择器契约，降低合并改造的回归成本。
- **是：** 按「设计决策变化要同步旧规格」的约定，在同一批变更里更新 SPEC 01/02 与 docs 的受影响段落。

## 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `my_role` 为必填，个别返回点漏挂字段 | FastAPI 响应校验 500 | 四处返回点全覆盖 + pytest 对四类响应逐一断言 |
| 候选搜索接口可被枚举家属账号 | 账号名暴露给恶意 owner | 仅 admin/owner、`limit 10`、`q` 最短 1 字符；课程项目范围内接受，生产化见安全加固规格 |
| 静态导出下移除路由 | 旧书签/演示地址落空 | `nginx.conf` 301 规则 + 部署验收断言 |
| e2e 大面积改写引入回归失真 | 原有覆盖失效 | 保留 aria-label 契约、分步更新、全量重跑 |
| 演示账号角色混淆（family 是 member） | 答辩演示误判 | README/业务文档更新 + 快捷登录标签（管理员/家属/主照护者） |
| SPEC 02 修订遗漏 | 规格与实现漂移 | 独立步骤 + 全仓 `rg` 复核清单 |

## 本规格不包含的内容

- 管理台创建/停用账号、审计日志页面、设备停用/启用、导航未处理角标、列表深链预筛选。
- 邀请-接受流程、字段级数据共享、真实通知渠道。
- App 端「长辈视图」及其文档描述（保持不变）。
- 摄像头/地图/视频等新能力与生产级安全加固。

以上内容如需实现，各自另开规格。
