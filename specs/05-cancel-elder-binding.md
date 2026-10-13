# SPEC 05 — 取消账号与老人的绑定（成员列表允许为空）

> **Status:** 已实现（本地与云端验收均通过）
> **Depends on:** SPEC 01、SPEC 02、SPEC 03、SPEC 04（本规格修订其中「至少保留一位家属成员」守卫）
> **Date:** 2026-10-13
> **Objective:** 取消「至少保留一位家属成员」约束——admin 与该老人的任意家属成员都可以取消任意账号（含最后一位）与老人的绑定；`PUT /api/v1/elders/{elder_id}/access` 允许提交空数组，即清空该老人的全部监护成员，成员列表允许为空。

## 为什么需要这份规格

- 线上演示中发现：老人只剩一位家属成员时，admin 与该家属成员**都无法取消这条绑定**。前端「移除」按钮被 `members.length <= 1` 禁用，后端 `PUT /api/v1/elders/{elder_id}/access` 提交空列表返回 422「至少保留一位家属成员」，形成死锁——只要某位老人只剩一位成员，管理台就再也无法解除该绑定。
- 触发场景（2026-10-13 云端演示）：老人 187（王爷爷）只剩 `laowang` 一人绑定，admin 与 `laowang` 本人都无法取消该绑定（前端按钮禁用、后端 422）。该守卫本意是防误删，但当绑定的家属成员本人也想解除绑定时，它变成不可绕过的障碍。
- 用户决策（2026-10-13）：管理员与家属成员都应能取消任意账号与老人的绑定，包含最后一位；监护成员列表允许为空。

## 范围（Scope）

**In:**

- 后端：`app/routers/elders.py` 的 `replace_elder_access` 删除「列表为空」422 分支，允许提交空数组（清空全部绑定）；更新 summary / description / docstring。其余校验（成员重复 422、只能关联 family 账号 422、账号不存在 404）与审计逻辑保持不变。
- 前端：`frontend/src/components/elder-detail-client.tsx` 的「移除」按钮对最后一位成员不再禁用（`disabled={savingMember}`）；顺带修正渲染条件的过时注释。
- 测试：`tests/test_elders_api.py` 中「空列表 422」断言改为「空列表 200 且返回 `[]`」；`test_family_member_can_grant_and_revoke_members` 追加「最后一位成员自移除并失去访问」用例；`frontend/e2e/family.spec.ts` 第二个用例重写为「最后一位成员也可以取消绑定」。
- 文档与规格同步：`docs/business-flows.md`、`docs/app-integration.md`、`specs/03`、`specs/04`。

**Out of scope:** App / 硬件端改动；设备解绑（`POST /api/v1/devices/{id}/unbind`）；邀请-接受两阶段成员流程；字段级数据共享同意。

## 契约（改动前 → 改动后）

### 监护成员整体替换（`PUT /api/v1/elders/{elder_id}/access`）

- 鉴权不变：admin 或该老人的任一已关联家属成员（其他人 403）。
- **改动：** 提交空数组 `[]` → 200 且返回 `[]`，清空该老人的全部 `elder_access` 行。
- 保留的约束：提交列表内成员重复返回 422（「监护成员不能重复」）；只能关联 `family` 账号，命中 admin 或其他角色返回 422（「只能关联家属账号」）；账号不存在返回 404（「账号不存在：<id>」）。
- 审计不变：写 `update_elder_access`，`detail` 仅 `{count}`，`count` **可以为 0**（代表清空）。

### 前端「移除」按钮

- 改动前：`disabled={savingMember || members.length <= 1}`——最后一位成员不可移除。
- 改动后：`disabled={savingMember}`——任意成员（含最后一位）都可移除；「移除」仍走整体替换，把剩余成员原样回填 relation。

## 已定决策与已排除方案

- **是：** 允许清空成员列表，含最后一位成员，admin 与任意家属成员一致。**否：** 保留「至少保留一位家属成员」守卫（与用户 2026-10-13 诉求直接冲突，且在「成员本人解绑」场景下形成死锁）。
- **否：** 为「移除最后一位」加二次确认弹窗（保持与既有移除一致的轻量交互；admin 可随时重新添加，误操作可恢复）。

## 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 老人可能短暂无任何家属成员 | 该老人仅 admin 可见 / 可管理 | admin 可随时在「监护成员」Tab 重新添加；审计日志记录 `update_elder_access` 的 `count=0` |
| 被移除账号的实时数据 | 该账号 REST 立即 403；WebSocket 可见范围最长 30 秒内刷新 | 沿用现有语义（SPEC 02/03/04 一致），无需额外处理 |

## 验收标准

- [x] 后端：`docker compose exec -T backend python -m pytest -q` 全部通过（126 passed，1 warning；改动前基线同为 126——本规格在既有用例内替换 / 追加断言，未新增测试函数）。
- [x] 后端：`docker compose exec -T backend alembic check` 无 drift（`No new upgrade operations detected.`；本规格无迁移）。
- [x] 前端：`npx tsc --noEmit` 通过（exit 0）；`npm run build` 通过（10 条路由静态预渲染成功）。
- [x] e2e：`npx playwright test e2e/family.spec.ts` 通过（15 passed / 56.0s，desktop-chromium、desktop-wide、mobile-chromium 三个 project 各 5 例），含重写后的「测试账号同样可以管理成员，最后一位成员也可以取消绑定（SPEC 05）」。用例收尾经接口精确恢复 seed（`family` relation=`daughter`、`laowang` relation=null），跨 project 幂等；运行后复验 `GET /api/v1/elders/1/access` 与 seed 一致。
- [x] 云端更新（47.108.147.192，2026-10-13）：tarball 覆盖 `36be5bf`（两侧 sha256 `8adaed8f…a2ba9` 一致，248870 bytes / 159 文件；覆盖后整仓 161 文件、改动文件 0 个 CRLF）；`docker compose up -d --build` 重建后 backend / frontend `Up (healthy)`、migrate `Exited (0)`，postgres / mosquitto 未被重建（`Up 3 days`，数据卷未触碰），服务器专属 `docker-compose.override.yml` 与 `.env` 未被覆盖（mtime 保持 `2026-10-10`）；回滚快照 `/opt/eldercare-cloud.pre-36be5bf-20261013_164625`。复验通过——`readyz` 200、OpenAPI `PUT /api/v1/elders/{elder_id}/access` description 含「允许空列表」且全文档无「至少保留一位家属成员」；`laowang` 视角 `GET /api/v1/elders` = {1 演示老人-张奶奶, 187 王爷爷}，`GET /api/v1/elders/187/access` 保持 `[laowang, relation=creator]`，`GET /api/v1/elders/1/access` 保持 `[family(daughter), laowang(null)]`（未受影响）；临时老人 249 实测 `PUT /api/v1/elders/249/access` body `[]` → **200 且返回 `[]`**（核心新行为；审计 `update_elder_access` `detail={"count": 0}`），清空后该账号 `GET /api/v1/elders/249/access` 返回 403（立刻失去访问，符合设计）；测后已精确清理（`elders` / `elder_access` / `audit_logs` 相关行复核均为 0），`GET /api/v1/elders` 恢复 {1, 187}；公网 :3000 只读 Playwright 用例（187 详情页「监护成员」Tab：`laowang` 行可见且「移除」按钮 `toBeEnabled`，未点击、无写入）通过。

## 本规格不包含的内容

- App / 硬件端改动、设备解绑、邀请-接受流程、字段级共享。

以上内容如需实现，各自另开规格。

---

## 规格修订说明

本规格修订 **SPEC 04**（`specs/04-unified-family-access.md`）保留的「至少保留一位家属成员」守卫，并**传导到 SPEC 03**（`specs/03-console-members-and-ia.md`，其原始表述为「至少保留一位 owner」，已由 SPEC 04 改述）。两份旧规格正文保留原始表述，冲突处以本规格为准，其顶部修订记录已加指路说明。
