# SPEC 04 — 统一家属权限（取消成员角色分层）与测试账号

> **Status:** 已实现（本地验收通过；云端更新执行见验收记录）
> **Depends on:** SPEC 01、SPEC 02、SPEC 03（本规格修订其成员角色与演示账号部分）
> **Date:** 2026-10-13
> **Objective:** 取消 SPEC 03 引入的 family owner / member 两级成员角色——家属成员权限一致（关联即可查看、编辑档案、管理监护成员），`elder_access` 删除 `role` 列；登录页第三个快捷登录按钮改为测试账号 `laowang / 123456`，并把它纳入 seed 演示账号（旧演示账号 `family-owner` 删除）。

> **修订记录（SPEC 05：`specs/05-cancel-elder-binding.md`）：** 本规格保留的「至少保留一位家属成员」守卫已被 SPEC 05 取消：成员列表允许为空，admin 与任意家属成员都可以取消任意账号（含最后一位）与老人的绑定；以下正文保留原始表述，冲突处以 SPEC 05 为准。

## 为什么需要这份规格

- SPEC 03 把 owner / member 两级成员角色落到管理台后，演示需要「主照护者 / 普通成员」两类家属账号、角色徽章、按角色门控的按钮与「至少保留一位 owner」约束；member 账号在界面上失去编辑与成员管理入口，直链还会落到权限空态。课设项目中家属即“一家人”，成员角色分层没有实际收益，反而增加演示与解释成本。
- 用户决策（2026-10-13）：取消成员权限分层，family 不区分 owner 与其他成员；登录页第三个快捷登录按钮改为现有测试账号 `laowang / 123456`。

## 范围（Scope）

**In:**

- 后端：`elder_access` 删除 `role` 列（迁移 0006，含 downgrade）；`ElderOut.my_role`、`AccessMemberIn.role`、`AccessMemberOut.role`、`UserElderOut.role` 全部移除；编辑老人档案、监护成员查看 / 整体替换、候选检索对“已关联 family”一律开放（未关联仍 403）；保留「成员列表不能为空」约束（提示改为「至少保留一位家属成员」）；删除老人仍仅 admin。
- 前端：移除「我的角色」列、页头 / 成员列表角色徽章、成员角色下拉与全部角色门控（含编辑页 member 空态）；「监护成员」Tab 对 admin 与 family 一致（含添加 / 移除，relation 回填逻辑保留，「我」标记保留）；用户列表「监护关系」抽屉去掉成员角色展示。
- seed 与演示账号：新增 `SEED_TEST_*`（默认 `laowang / 123456`，display name `老王`，关联演示老人）；删除旧演示账号 `family-owner`（若存在）；`family-guest` 保持未关联候选。
- 登录页：第三个快捷登录按钮改为测试账号（`NEXT_PUBLIC_DEMO_TEST_*`，默认 `laowang / 123456`）。
- 测试与文档：pytest（含迁移 0006 回归测试）、`tsc --noEmit`、前端镜像构建、Playwright；README、`docs/business-flows.md`、`docs/app-integration.md`、`specs/01`、`specs/02`、`specs/03` 同步修订。

**Out of scope:** 邀请-接受两阶段成员流程、字段级数据共享同意、审计日志页面、设备停用 / 启用、App 端改动（App 不依赖 `my_role`，仅少一个响应字段）。

## 角色与权限矩阵（管理台视角）

全局角色为 `admin / family`；家属成员之间不再有层级。本表只描述管理台界面行为。

| 能力 | admin | family（家属成员，权限一致） |
| --- | --- | --- |
| 查看老人档案 / 健康 / 事件 / 告警 | 全量 | 仅关联老人 |
| 编辑老人档案 | 是 | 是 |
| 删除老人档案 | 是 | 否 |
| 紧急联系人读写 | 是 | 是 |
| 电子围栏读写 | 是 | 是 |
| 确认告警 | 是 | 是 |
| 查看 / 管理监护成员 | 是 | 是 |
| 查看绑定设备（只读） | 是 | 是 |
| 注册 / 绑定 / 解绑设备 | 是 | 否 |
| 用户列表 / 编辑用户 / 重置密码 | 是 | 否 |
| 查看账号监护关系（用户列表） | 是 | 否 |

## 数据模型与接口契约

### 1. 迁移 0006（`0006_drop_elder_access_role`）

- `upgrade`：删除 `ck_elder_access_role` 约束与 `elder_access.role` 列；`relation` 与既有关联行完整保留。
- `downgrade`：恢复 `role` 列（默认 `'member'`）并沿用 0004 的回填策略把存量行写为 `'owner'`，保证回滚后仍有账号可以管理成员。

### 2. 响应模型变化

- `ElderOut` 移除 `my_role`：`GET/POST /api/v1/elders`、`GET/PUT /api/v1/elders/{elder_id}` 不再返回该字段。
- `AccessMemberIn` = `{user_id, relation?}`；`AccessMemberOut` 移除 `role`。
- `UserElderOut` 移除 `role`（用户列表抽屉只展示老人与关系）。
- 老人相关接口按“关联关系”判定可见范围；未关联 family 一律 403，与 SPEC 02/03 的 403/404 语义一致。

### 3. 监护成员整体替换（`PUT /api/v1/elders/{elder_id}/access`）

- 鉴权：admin 或该老人的任一已关联 family 成员（其他人 403）。
- 约束：成员不能重复（422）、列表不能为空（422，「至少保留一位家属成员」）、只能关联 family 账号（422）、账号不存在 404。
- 行为：写入 `(elder_id, user_id, relation)`；写审计 `update_elder_access`（detail 仅 `{count}`）。

### 4. 候选检索

`GET /api/v1/elders/{elder_id}/access/candidates?q=` 语义不变（仅 family 账号、排除已有成员、最多 10 条、`q` 1–32 字符），鉴权放宽为 admin / 已关联 family。

## seed 与演示账号（变更后）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SEED_ADMIN_USERNAME/PASSWORD` | admin / admin123456 | 管理员 |
| `SEED_FAMILY_USERNAME/PASSWORD` | family / family123456 | 演示家属（relation=daughter） |
| `SEED_TEST_USERNAME/PASSWORD` | laowang / 123456 | 测试账号（登录页第三个按钮），relation 为空 |
| `SEED_GUEST_USERNAME/PASSWORD` | family-guest / guest123456 | 候选账号（未关联任何老人） |

- seed 重跑幂等：收敛 `family` / `laowang` 与演示老人的关联；`family-owner` 存在时删除账号与其全部关联；`family-guest` 保持未关联。
- 环境变量更名：`SEED_OWNER_*` → `SEED_TEST_*`，`NEXT_PUBLIC_DEMO_OWNER_*` → `NEXT_PUBLIC_DEMO_TEST_*`；云端 `.env` 未设置这些变量，使用默认值即可，无需改动。

## 实现记录（已完成）

1. 后端：`app/models.py`（删 role 列与约束）、`app/access.py`（收敛为可见性校验，删除成员角色函数）、`app/schemas.py`、`app/routers/elders.py`、`app/routers/users.py`、迁移 0006、`scripts/seed.py`。
2. 后端测试：`tests/test_elders_api.py`、`tests/test_users_api.py`、`tests/test_models.py` 更新，新增 `tests/test_migration_0006.py`。
3. 前端：`lib/types.ts`、登录页、老人列表 / 详情 / 编辑、用户列表抽屉；删除 `member-role-badge.tsx`；`docker-compose.yml`、`frontend/Dockerfile`、`.env.example`。
4. e2e：`roles.spec.ts` → `family.spec.ts`（统一家属权限 4 个用例 + 长辈视图 301 用例），auth / elders / users / helpers / playwright.config 适配。
5. 文档与规格同步（README、business-flows、app-integration、specs 01/02/03）。

## 验收标准

- [x] `docker compose exec -T backend python -m pytest -q` 全部通过（126 passed）。
- [x] 迁移 0006：本地 `alembic current` = `0006_drop_elder_access_role`；`tests/test_migration_0006.py` 验证列删除、数据保留与 downgrade 回填。
- [x] `npx tsc --noEmit` 通过；前端镜像使用新构建参数重建成功。
- [x] Playwright 全量通过（50 passed：1440 全量 + 1920/390 核心档位），含 `family.spec.ts`（管理成员、添加 / 移除、仅剩一位成员时移除禁用、家属编辑档案、家属确认告警）。
- [x] 本地 seed：`family`（daughter）与 `laowang` 关联演示老人；`family-owner` 删除；`family-guest` 未关联。
- [x] 云端更新（47.108.147.192，2026-10-13）：tarball 覆盖 `0e0f86f`；migrate 0006 `Exited (0)`、`alembic current` = 0006；seed 后 `family-owner` 已删除、`laowang` 关联演示老人（含原有 187 号老人）；复验通过——登录页第三个按钮为 `laowang`（含「测试账号」标签）、OpenAPI 与 `ElderOut` 均无 `my_role`、laowang 可访问 `/elders/1/access`、`family-owner` 登录 401、`/events` 301 回归、`readyz` 200。

## 已定决策与已排除方案

- **是：** 彻底删除 `elder_access.role`（迁移 0006）。**否：** 保留列但停止读取（死字段，文档与实现漂移）。
- **是：** family 全员可管理监护成员（关联即权）。**否：** 成员管理仅 admin（演示需要家属侧入口，且业务文档曾以 owner 身份开放同一能力）。
- **是：** seed 删除旧演示账号 `family-owner`（其概念已取消）。**否：** 保留为普通成员账号（演示账号清单与文档混乱）。
- **是：** 保留「至少保留一位家属成员」守卫。**否：** 允许清空成员列表（误操作后无人可再管理该老人）。
- **是：** 第三个快捷登录按钮使用既有测试账号 `laowang / 123456`。**否：** 新建专用演示账号（owner 概念已取消，直接复用现有测试账号）。
- **是：** 环境变量更名 `SEED_TEST_*` / `NEXT_PUBLIC_DEMO_TEST_*`。**否：** 沿用 `OWNER` 名称仅改默认值（语义漂移）。
- **是：** `ElderOut.my_role` 直接移除（SPEC 02/03 的 403 语义不变，App 不依赖该字段）。**否：** 保留返回 `admin/family`（与全局角色重复，无消费者）。

## 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 迁移 0006 在云端删除列 | 回滚需重建列 | downgrade 与 0004 一致回填 owner；部署前保留目录快照 |
| `my_role` 移除影响 App | App 端解析失败（理论上无依赖） | App 对接文档同步说明字段移除 |
| 演示账号更替 | 旧口令登录失败 | README / 业务文档 / 登录页同步更新，改用 `laowang` |

## 本规格不包含的内容

- 邀请-接受流程、字段级共享、真实通知渠道。
- App / 硬件端改动；审计日志页；生产级安全加固。

以上内容如需实现，各自另开规格。
