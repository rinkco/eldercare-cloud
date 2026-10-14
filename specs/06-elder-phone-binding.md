# SPEC 06 — 老人手机号（新建必填、全局唯一）与家属按手机号添加/解绑、监护成员权限收敛

> **Status:** 已批准（2026-10-14 用户确认；实现中）
> **Depends on:** SPEC 01、SPEC 02、SPEC 03、SPEC 04（本规格修订其成员管理权限）、SPEC 05（本规格修订其「家属可取消任意绑定」部分）
> **Date:** 2026-10-14
> **Objective:** 老人档案新增手机号（新建必填、全局唯一、11 位格式）；「老人档案」新增「添加老人」（按老人手机号）；家属「取消绑定」只解除自己；监护成员整体替换与候选检索收敛为仅 admin；家属侧「监护成员」Tab 变为只读。

## 为什么需要这份规格

- 用户 2026-10-14 提出流程：账号新建老人时必填老人手机号；「老人档案」界面可选择「添加老人」「新建老人」与「取消账号与这名老人的绑定关联」；添加老人通过手机号添加。
- 目标是把手机号定为老人的身份标识，串起家属侧「新建（必填手机号）→ 添加（凭手机号绑定自己）→ 取消绑定（解除自己）」的完整流程；管理员侧保留全量管理能力。
- 用户 2026-10-14 明确决策：
  1. 老人手机号全局唯一 + 11 位格式（`1[3-9]\d{9}`），新建时所有账号统一必填；重复创建时报错提示改用「添加老人」。
  2. 新建老人**不引入勾选框**：家属绑定时（新建）直接自动绑定自己（保持现状，`relation=creator`）；管理员绑定时默认不进行自动绑定（保持现状，创建不产生绑定）。
  3. 管理员「添加老人」= 按手机号检索定位：命中后不产生绑定，仅提示「该老人已存在」并打开其档案（选项 B）。
  4. 家属账号只能解除**自己**与老人的绑定；管理员可管理所有绑定（详情页「监护成员」Tab 保持全量管理）。
  5. 云端部署：服务器初始化 git、此后用 git 更新；若服务器连不上 GitHub 再按之前的 tarball 方式回退并说明解法。

## 范围（Scope）

**In:**

- 后端：迁移 0007 为 `elders` 增加 `phone`（可空列 + 唯一索引，兼容存量数据）；`ElderCreate` 手机号必填、`ElderUpdate` 可改但不可清空、`ElderOut` 返回；创建/更新手机号格式与唯一校验（冲突 409 提示改用「添加老人」）；新增 `POST /api/v1/elders/add-by-phone` 与 `DELETE /api/v1/elders/{elder_id}/access/me`；`PUT /access` 与 `GET /access/candidates` 收敛为仅 admin；seed 为演示老人补手机号；pytest 全量更新与新增。
- 前端：「老人档案」列表页新增「添加老人」按钮（弹窗按手机号）与手机号列；家属行内新增「取消绑定」（二次确认）；「新建/编辑老人」表单新增「手机号 *」；详情页展示手机号、家属「监护成员」Tab 只读；注册页文案微调；`lib/types.ts`；Playwright e2e 更新。
- 文档与规格同步：`docs/business-flows.md`、`docs/app-integration.md`、`README.md`（如涉及）、`specs/02`、`specs/03`、`specs/04`、`specs/05` 顶部修订指路。

**Out of scope:** App / 硬件端改动；短信验证码与真实通知；邀请-接受两阶段绑定流程；手机号修改的二次确认/历史留痕页面；云端 HTTPS/反向代理。

## 契约（改动前 → 改动后）

### 1. 数据模型（迁移 0007 `elder_phone`）

- `elders` 新增 `phone VARCHAR(32) NULL` 与唯一索引 `uq_elders_phone`。
  - 可空：兼容存量行（无手机号的历史档案保持 `NULL`，不影响现有功能）。
  - 唯一：PostgreSQL 唯一索引中多个 `NULL` 互不冲突，无需部分索引。
- `downgrade`：删除唯一索引与 `phone` 列。
- 存量档案的补号途径：seed（演示老人）与「编辑老人」表单（补填）。

### 2. 老人档案接口（`app/routers/elders.py`、`app/schemas.py`）

- `ElderCreate` 新增 `phone: str`（必填，`pattern=r"^1[3-9]\d{9}$"`）；缺失/空串/格式不符 → 422。
- 创建时手机号已存在 → `409`，`detail="该手机号已存在老人档案，请改用「添加老人」"`（沿用注册接口「账号已存在」的 409 风格）。唯一索引作为并发兜底。
- `ElderUpdate` 新增 `phone: str | None`：省略 = 不修改；提交 `null` → 422（错误信息「phone 不能为 null」，与既有 name 校验风格一致，手机号不允许清空）；提交非法格式 → 422；与**其他**老人重复 → 409（排除自身）。
- `ElderOut` 新增 `phone: str | None`；**注意**：`ElderOut` 继承 `ElderCreate`，必须覆盖声明允许 `null`（存量数据），实现后以测试验证（`GET /api/v1/elders`、`GET /api/v1/elders/{id}` 返回存量档案不报错）。
- 家属创建老人仍自动绑定自己（`relation="creator"`），不引入任何勾选框；admin 创建不产生绑定（保持现状）。

### 3. 新接口：按手机号添加老人（`POST /api/v1/elders/add-by-phone`）

- 鉴权：`require_roles("admin", "family")`。
- 入参：`{"phone": "13800000003"}`（`extra="forbid"`，格式校验同手机号规则）。
- 行为：
  - 按 `elders.phone` 精确匹配；无命中 → `404`，`detail="未找到该手机号对应的老人档案，请核对或改用「新建老人」"`。
  - **family**：未绑定 → 创建 `ElderAccess(elder_id, user_id, relation=NULL)`、写审计 `add_elder_by_phone`（target elder，`detail={"phone": ...}`）、返回 `200` + `ElderOut`；已绑定 → `409`，`detail="该老人已与当前账号绑定"`。
  - **admin**：不产生任何绑定、不写审计，返回 `200` + `ElderOut`（仅检索定位）。
- 路由声明顺序：需在 `GET /{elder_id}` 之前注册，避免 `elder_id` 的 int 解析错误（FastAPI 按注册顺序匹配）。
- 审计动作沿用 snake_case：`add_elder_by_phone`。

### 4. 新接口：解除自己与老人的绑定（`DELETE /api/v1/elders/{elder_id}/access/me`）

- 鉴权：`require_roles("family")`（admin → 403）。
- 未绑定该老人（无对应行）→ `404`，`detail="未绑定该老人"`。
- 存在 → 删除自己的 `elder_access` 行、写审计 `remove_self_elder_access`（target elder，`detail={"user_id": ...}`）、返回 `204`。
- 允许解除最后一位成员（自助退出；老人档案与历史数据保留，仅解除该账号可见性）。

### 5. 权限收敛（修订 SPEC 04 / SPEC 05）

- `PUT /api/v1/elders/{elder_id}/access`（整体替换）：改为 `require_roles("admin")`，family → 403（house 默认「权限不足」）；既有约束（重复 422、空列表允许 200、仅 family 账号 422、账号不存在 404）与审计保持不变。
- `GET /api/v1/elders/{elder_id}/access/candidates`：改为 `require_roles("admin")`，family → 403。
- `GET /api/v1/elders/{elder_id}/access`（只读）：保持 admin + 该老人已关联家属可见。
- 收敛后的家属绑定能力 = ① 新建老人自动绑定（`creator`）② `add-by-phone` 自助绑定 ③ `access/me` 自助解绑；不得增删他人。

### 6. 前端行为

「老人档案」列表页（`elders-client.tsx`）：

- 顶部按钮：`[添加老人]`（admin 与 family 均显示）+ `[新建老人]`（保持）。
- `[添加老人]` 弹窗：手机号输入（前端 11 位校验，错误文案「请输入 11 位手机号。」）→ 调 `add-by-phone`：
  - family 成功：toast「已添加老人：<姓名>」→ 跳转该老人详情；
  - admin 成功：toast「该老人已存在：<姓名>」→ 跳转该老人详情；
  - 404 / 409：弹窗内联展示后端 `detail`。
- 列表新增「手机号」列（建议紧随姓名；`NULL` 显示「—」）。
- 行操作：**family** 追加「取消绑定」（二次确认——标题「确认取消与这位老人的绑定？」，描述「取消后你将不再看到这位老人的档案与数据；如需恢复，可用手机号重新添加。」，确认按钮「取消绑定」）→ 调 `access/me` → 成功 toast「已取消与<姓名>的绑定」→ 刷新列表；admin 不显示该操作。
- family 空态文案：「当前账号还没有关联老人，可凭老人手机号「添加老人」，或「新建老人」。」

「老人详情」（`elder-detail-client.tsx`）：

- 基础信息区新增「手机号」（`NULL` 显示「—」）。
- 「监护成员」Tab：admin 保持现状（搜索 + 添加 + 移除）；**family 变为只读**：保留成员列表与「我」标记，隐藏搜索框/添加/移除按钮，并展示提示「成员管理仅管理员可用；可在「老人档案」中对这位老人取消绑定。」（家属凭直链 `?tab=members` 仍可打开只读视图，不再回落到档案分区；档案加载失败/不可见时才回落）。

「新建/编辑老人」表单（`elder-edit-client.tsx`）：

- 基础信息新增「手机号 *」（`type=tel`，`maxLength=11`，前端校验 11 位格式；后端 409 的 `detail` 直接展示）。
- 新建保存成功后跳详情（家属已自动绑定；admin 不绑定，行为不变）；存量无手机号档案在编辑时需补填后保存。

其他：注册页文案「注册后即可登录管理台；在「老人档案」中新建老人会自动关联当前账号，也可凭老人手机号添加已有档案。」；`lib/types.ts` 的 `Elder`/`ElderInput` 增加 `phone`。

### 7. seed（`scripts/seed.py`）

- 演示老人（张奶奶）补充演示手机号（常量建议 `DEMO_ELDER_PHONE = "13800000003"`）；**仅当为 `NULL` 时补填，不覆盖已有值**；docstring 同步。

### 8. 测试

后端（pytest，容器内运行）：

- 更新所有经接口创建老人的既有用例（补 `phone`）；`tests/test_elders_api.py`、`tests/conftest.py`、`tests/helpers.py` 及全仓 grep `api/v1/elders` 的测试文件都在范围内。
- 新增用例：
  - 创建：缺 phone → 422；格式非法 → 422；重复 phone → 409（detail 含「添加老人」）；成功后 `ElderOut.phone` 正确。
  - 更新：改 phone 成功；撞他人 → 409；显式 `null` → 422；省略 → 不变。
  - `add-by-phone`：family 命中 → 200 且绑定生效（列表可见）+ 审计存在；family 未命中 → 404；family 已绑定 → 409；admin 命中 → 200、**无绑定行、无审计**。
  - `access/me`：family 解自己 → 204、随后访问 403、老人仍存于 admin 列表；未绑定 → 404；admin → 403；解绑最后一位成员允许。
  - 权限收敛：family `PUT /access` → 403；family `candidates` → 403；admin 两侧正常。
  - 存量兼容：直接以模型创建无手机号老人（或迁移测试）→ `GET` 正常返回 `phone=null`。
- 迁移：`alembic check` 无 drift；`alembic current` = 0007；新增 `tests/test_migration_0007.py`（列与唯一索引存在、`downgrade` 可回退）。

前端（e2e，Playwright 三档位 desktop-chromium / desktop-wide / mobile-chromium）：

- `elders.spec.ts`：新建表单含手机号必填校验；创建成功流程补手机号输入。
- `family.spec.ts`：重写成员相关用例——① 家属按手机号「添加老人」自助绑定；② 家属「取消绑定」自助退出（含最后一位成员场景）；③ 家属「监护成员」Tab 只读（无搜索框/添加/移除按钮，成员列表可见）。用例收尾精确恢复 seed 状态（沿用 SPEC 05 的做法）。
- 全仓检查其他 e2e 是否受文案/表单变更影响（如空态文案、表单字段）。

### 9. 文档同步

- `docs/business-flows.md`：家属侧流程（新建/添加/取消绑定）、手机号规则、监护成员权限收敛；管理员全量管理描述。
- `docs/app-integration.md`：`ElderOut.phone` 字段、`add-by-phone`、`access/me`、成员管理权限变化（含「由部署方补 elder_access 行」等过时描述的修订）。
- `README.md`：如涉及演示账号/业务流程描述则同步（检查后决定）。
- `specs/02`、`specs/03`、`specs/04`、`specs/05`：顶部追加 SPEC 06 修订指路（04/05 重点标注成员管理权限收敛）。

## 已定决策与已排除方案

- **是：** 手机号全局唯一 + 11 位格式 + 所有账号新建必填。**否：** 仅家属必填 / 不校验格式 / 允许重复。
- **是：** 家属「添加老人」命中即自动绑定自己；新建老人保持自动绑定（`creator`），不引入勾选框。**否：** 家属创建时可选是否绑定（用户 2026-10-14 明确取消勾选框方案）。
- **是：** 管理员「添加老人」仅检索定位（不绑定、不审计）。**否：** 管理员代绑定到指定家属账号（方案 A，未采纳）；管理员也自动绑定（不可行，监护成员仅限 family 账号）。
- **是：** 家属只能解除自己的绑定；成员增删与候选检索收敛为仅 admin。**否：** 家属继续管理成员（SPEC 04/05 旧行为，被本规格收敛）。
- **是：** 提供 `add-by-phone` 与 `access/me` 两个专用接口。**否：** 前端复用整体替换接口（需先拉全量成员、并发下易覆盖他人变更）。
- **是：** 手机号可编辑（同校验、不可清空）。**否：** 手机号只读 / 允许清空。

## 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 知道老人手机号的账号即可自助绑定（无邀请确认） | 产品层面的宽松策略（课设场景接受） | 用户决策接受；审计留痕；管理员可随时移除成员 |
| 手机号被修改后，他人按旧号添加失败 | 轻微 | 手机号即添加凭据，文档注明；编辑需有档案可见性 |
| 存量老人无手机号 | 无法被按手机号添加 | 保持 `NULL` 可正常使用；seed/云端验收补号；编辑时补填 |
| 迁移 0007 在云端执行 | 加列 + 唯一索引，低风险 | 部署前保留目录快照；`downgrade` 可回退 |
| e2e 依赖 seed 数据状态 | 用例脆弱 | 沿用 SPEC 05 的「精确恢复/清理测试数据」经验 |

## 验收标准

- [ ] 后端：`docker compose exec -T backend python -m pytest -q` 全量通过（记录 passed 数）。
- [ ] 后端：`alembic check` 无 drift；`alembic current` = 0007；`migrate` Exited(0)。
- [ ] 前端：`npx tsc --noEmit` 与 `npm run build` 通过。
- [ ] e2e：Playwright 三档位全量通过（记录用例与通过数）。
- [ ] 手工/接口验收：家属添加→列表可见→取消绑定→不可见；管理员添加不绑定；重复手机号 409 提示；家属成员 Tab 只读。
- [ ] 文档与规格同步完成（含旧规格修订指路）。
- [ ] 独立子智能体审查通过（无未解决的 Important/Critical；修复后复审查）。
- [ ] GitHub：分支推送 + 合入 main（ff-only）+ push origin/main（按 AGENTS.md 流程）。
- [ ] 云端（47.108.147.192）：服务器初始化 git 并改用 git 更新（保留 `.env` 与 `docker-compose.override.yml`，更新前保留回滚快照）；0007 迁移执行成功；真实环境实测（含为现网演示老人补手机号）。若 GitHub 连通性问题：回退 tarball 方式完成并说明原因与解决办法。

## 规格修订说明

本规格修订以下旧规格，冲突处以本规格为准；旧规格正文保留原始表述，并将在其顶部追加修订指路：

- **SPEC 04**（统一家属权限）：家属成员不再可管理监护成员（增删他人）；改为「只读查看 + 自助绑定/解绑」。
- **SPEC 05**（取消账号与老人的绑定）：「家属可取消任意（含最后一位）绑定」收敛为「家属仅可解除自己的绑定」；admin 侧行为不变（仍可清空成员列表）。
- **SPEC 02 / SPEC 03**：「老人档案」列表页新增「添加老人」与家属「取消绑定」；「监护成员」Tab 家属只读；老人表单与展示新增手机号字段。

以上内容如需扩展（如邀请-接受流程、手机号变更留痕），各自另开规格。
