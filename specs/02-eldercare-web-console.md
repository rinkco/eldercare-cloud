# SPEC 02 — 老人监护云平台前端 Web 管理台

> **Status:** 已实现（本地验收通过；云端部署演示待执行）—— 部分内容被 SPEC 03 修订，见下方修订记录
> **Depends on:** SPEC 01（老人监护云平台总体规格，已实现并通过验收）
> **Date:** 2026-10-08
> **Objective:** 为老人监护云平台构建一套中文、美观、有设计感的 Next.js 前端 Web 管理台，覆盖登录与角色权限、老人/联系人、设备、电子围栏、遥测与健康趋势、事件/告警/通知、实时推送，并随同一份 Docker Compose 部署到公有云供答辩演示。

> **修订记录（SPEC 03：`specs/03-console-members-and-ia.md`）：** 本规格中关于「同一账号在管理台内的老人只读展示页」的路由、权限矩阵、共用账号约定、实现计划第 3/8 步、验收标准与验收记录、已定决策与风险条目均已被 SPEC 03 修订——该页面整体移除（旧地址在部署环境 301 回首页），管理台只服务 admin / family，老人侧使用 App。同时 `/events` 并入 `/alerts`（双 Tab，`?view=alerts|events`），老人详情改为可寻址的 4 个分区 Tabs，用户列表新增「监护关系」列与抽屉，老人维度成员角色 owner / member 落到管理台界面。以下正文保留原始表述，冲突处以 SPEC 03 为准。

## 为什么需要这份规格

SPEC 01 只交付了云平台后端，界面部分明确留给了 App/小程序组。实际答辩演示中，评委需要在一个屏幕上直观看到「设备接入 → 数据 → 告警 → 通知 → 实时推送」的完整链路，而 Swagger 无法承担演示体验。本规格补齐一个面向管理演示的 Web 管理台，同时把后端尚缺的接口（电子围栏读写、通知记录查询）与角色模型收敛（elder 与 family 共用账号、移除独立 elder 账号）一并冻结，避免前端为了“覆盖全部功能”而在实现期反复改接口。

## 范围（Scope）

**本规格包含（In）：**

- 后端变更：电子围栏读写、通知记录查询、角色模型收敛为 admin / family（移除独立 elder 账号并迁移存量账号）、`elder_access(user_id)` 索引。
- 数据迁移 0003：存量 elder 账号并入 family、收紧 role 约束、新增 `elder_access(user_id)` 索引。
- 前端 Web 管理台（Next.js App Router + TypeScript + Tailwind + shadcn/ui + Recharts）：登录、概览台、老人与联系人、设备、围栏、健康趋势、事件/告警/通知、告警确认。
- 实时推送：WebSocket 新告警与新遥测摘要；断线重连与轮询兜底。
- 设计系统：深色专业监控风格 + 非模板化设计标准（色彩、字体层级、栅格、图表、动效、状态、响应式、无障碍）。
- 部署：新增 `frontend` 容器（Next.js 静态导出 + nginx），同一份 compose 对外 3000，nginx 同源反代 `/api` 与 `/api/v1/ws` 到 backend。
- 测试与文档：Playwright 端到端用例、后端 pytest 增补、README 冷启动与演示步骤更新。

**本规格不包含（Out of scope）：**

- 用户账号的新建/停用/改密（账号由 seed 脚本与 `.env` 的 `SEED_*` 管理，前端只读展示用户列表）。
- 真实微信/短信/电话通知渠道（沿用 SPEC 01 的控制台模拟通知）。
- 多语言（仅中文界面）、移动端 App/小程序、深浅色主题切换。
- 生产级前端（SSR、CDN、HTTPS 证书、CI/CD、国际化、埋点）。
- 修改 SPEC 01 已冻结的 REST 契约语义（本规格仅新增接口/索引，并按上述决策收敛角色模型；不改动既有接口的请求/响应语义）。
- 独立 elder 登录、elder 专属接口（`/api/v1/me/*`）与多角色/共享账号的成员级权限。

## 角色与权限矩阵

| 功能 | admin | family（elder 共用此账号） |
| --- | --- | --- |
| 登录 / 登出 / 查看本人信息 | 是 | 是 |
| 概览台 | 全量 | 仅关联老人 |
| 老人列表 / 详情 | 全量 | 仅关联老人 |
| 老人新建 / 编辑 / 删除 | 是 | 仅关联老人 |
| 紧急联系人读写 | 是 | 仅关联老人 |
| 设备注册 / 列表 / 绑定 | 是 | 否 |
| 电子围栏读写 | 是 | 仅关联老人 |
| 遥测查询 / 健康趋势 | 是 | 仅关联老人 |
| 事件 / 告警查询 | 是 | 仅关联老人 |
| 告警确认（ack） | 是 | 仅关联老人 |
| 通知记录查询 | 是 | 仅关联老人 |
| 用户列表 | 是 | 否 |
| WebSocket 实时推送 | 全量 | 仅关联老人 |

共用账号约定：不再存在独立 elder 账号；elder 与 family 共用一个 family 账号（通过 `elder_access` 关联老人）。管理台本身只服务 admin 与 family 两个全局角色，权限边界由后端 RBAC 与 `elder_access` 决定，不依赖界面约定缩小权限。老人维度另有 owner / member 两级成员角色（迁移 0004），其界面表现由 SPEC 03 定义。

> SPEC 03 修订：上表的 admin / family 二分判断保留，另按老人维度角色细分——老人列表新增「我的角色」列、详情页头角色徽章、编辑/成员管理按 admin、owner 门控；用户列表新增「监护关系」列与抽屉。详见 `specs/03-console-members-and-ia.md`。

## 后端变更（接口与角色模型）

以下变更均由 SPEC 02 实现，版本前缀与鉴权方式沿用 SPEC 01（`Authorization: Bearer <JWT>`）。

### 1. 电子围栏（补齐 SPEC 01 已定义但未实现的契约）

| 方法 | 路径 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/v1/geofences/{elder_id}` | 返回该老人全部围栏 | admin / family |
| PUT | `/api/v1/geofences/{elder_id}` | 整体替换该老人围栏，空数组表示清空 | admin / family |

字段：`name`（1–64 字符）、`center_lat`（-90..90）、`center_lon`（-180..180）、`radius_m`（50..5000）、`enabled`（bool）。写操作在同一事务内写审计 `update_geofences`；family 仅能操作可见老人，越权 403。

### 2. 通知记录查询

| 方法 | 路径 | 说明 | 角色 |
| --- | --- | --- | --- |
| GET | `/api/v1/alerts/{alert_id}/notifications` | 返回该告警的通知记录 | admin / family |

字段：`id`、`alert_id`、`contact_id`、`channel`、`target`、`content`、`status`、`sent_at`、`error`。family 需要该告警对应老人可见；告警不存在 404，越权 403。

### 3. 角色模型收敛与数据迁移

- `users.role` 取值收敛为 `admin | family`；不再新增 `role='elder'` 的账号。
- 迁移 0003：
  1. 先把存量 `users.role='elder'` 更新为 `family`；
  2. 收紧 `ck_users_role` 约束为 `role IN ('admin', 'family')`；
  3. 新增索引 `ix_elder_access_user_id`（`elder_access.user_id`），服务于 family 列表查询。
- 后端同步清理：移除鉴权、访问校验与测试中 `role='elder'` 的分支；seed 脚本继续只创建 admin / family 账号；存量 elder 账号迁移为 family 后，若没有 `elder_access` 关联则看不到任何老人数据（安全兜底）。
- WebSocket 维持现有角色约束（admin / family）。

## 前端信息架构

技术栈固定为：**Next.js（App Router）+ TypeScript + Tailwind CSS + shadcn/ui + Recharts + Framer Motion**；构建产物为静态导出（`output: 'export'`），详情页使用查询参数（如 `/elders/detail?id=3`），避免静态导出下的动态路由限制。

| 路由 | 名称 | 角色 | 主要内容 |
| --- | --- | --- | --- |
| `/login` | 登录 | 公开 | 账号密码登录、错误提示、演示账号提示 |
| `/` | 概览台 | admin / family | KPI（老人数、在线设备、未处理告警、今日事件）、设备状态、最新告警、实时流 |
| `/elders` | 老人列表 | admin / family | 搜索、分页、可见范围、新建入口 |
| `/elders/detail` | 老人详情（SPEC 03 分区 Tabs） | admin / family | `?tab=` 四分区：档案与联系人 / 监护成员（admin 与 owner）/ 设备与围栏 / 数据记录 |
| `/elders/edit` | 老人编辑 | admin / family | 新建 / 编辑 / 删除（删除需二次确认） |
| `/devices` | 设备管理 | admin | 注册设备、列表、绑定老人 |
| `/health` | 健康数据 | admin / family | 遥测查询、小时/天趋势图、活动分布 |
| `/alerts` | 告警与事件（SPEC 03 合并） | admin / family | 双 Tab：告警（过滤、详情、确认、通知记录）/ 事件（类型/状态/老人/时间过滤、完整 Payload） |
| `/events` | — | — | 已移除：SPEC 03 并入 `/alerts?view=events`，部署环境 301 跳转 |
| `/users` | 用户列表 | admin | 只读账号列表 + 「监护关系」列与抽屉（SPEC 03） |

通用组件：应用外壳（侧边导航 + 顶部状态栏）、角色菜单、数据表格、过滤栏、抽屉/对话框、确认弹窗、Toast、骨架屏、空态、错误态、实时连接指示、数字滚动、趋势图卡。

## 设计系统与交互标准

设计由 `frontend-design` 与 `premium-frontend-ui` 两个技能指导，但只采用适合管理台的部分：**深色专业监控风格打底，用非模板化的配色、排版与动效制造设计感，不照搬落地页的 preloader / 滚动叙事**。

### 色彩

| 用途 | 值 |
| --- | --- |
| 页面基底 | `#0F1215`（炭黑，不用蓝紫渐变） |
| 卡片 / 面板 | `#171B20`，悬浮层 `#1E232A` |
| 分隔线 | `rgba(255,255,255,0.08)` |
| 主文本 / 次文本 | `#E8EAED` / `#9AA3AD` |
| 品牌主色 | `#3FAE8C`（青瓷绿） |
| 危急 / 警告 / 正常 / 信息 | `#E05B4B` / `#D9A441` / `#3FAE8C` / `#4C8FD6` |
| 数据序列 | 心率 `#E05B4B`、血氧 `#3FAE8C`、步数 `#D9A441`、活动 `#8B7BD8` |

禁止：大面积单一色系铺满、蓝紫渐变、霓虹发光、彩色玻璃拟态堆叠；图表同屏数据色不超过 5 种。

### 字体与排版

- 中文：Noto Sans SC / HarmonyOS Sans / 系统无衬线兜底；数字启用 `tabular-nums`。
- 层级：页面标题 28–32、区块标题 20–24、正文 14–16、辅助 12–13；行高 ≥1.5；字距为 0。
- 卡片/面板内不使用 hero 级字号；KPI 数字 32–40。

### 布局

- 桌面优先：主布局适配 1280–1920；≤1024 侧栏折叠为抽屉；≤768 单列，表格横向滚动。
- 左侧导航 240px，顶部状态栏 56px，内容区 12 列栅格；卡片圆角 ≤8px，禁止卡片套卡片。
- 列表页以表格为主，筛选栏固定在表格上方；图表卡高度固定（如 320px），避免加载/刷新时布局跳动。

### 图表

- Recharts；统一网格线、坐标轴、Tooltip、图例样式；空数据展示空态而非空白画布。
- 心率/血氧折线；步数柱状；活动状态分布/堆叠条；告警按严重度着色。
- 图表提供加载骨架、错误重试，以及可展开的“表格视图”作为无障碍替代。

### 动效

- 页面首屏一次性 200–300ms 淡入；数字滚动；新告警插入时 1.2s 高亮；实时连接状态脉冲。
- 仅动画 `transform` / `opacity`；`prefers-reduced-motion` 下全部关闭或降为静态。
- 不使用滚动劫持、自定义光标、磁吸按钮等营销页动效。

### 状态与文案

- 加载骨架、空态（含下一步操作）、错误态（说明原因 + 重试）、401 跳登录、403 显示无权访问、409 显示业务冲突原因。
- 破坏性操作（删除老人、清空围栏、替换联系人）必须二次确认；操作结果用 Toast 反馈。
- 文案中文、句子式、主动语态，不使用“抱歉/出错了”这类含糊提示。

### 无障碍

- 键盘可达、可见 focus ring、对比度 ≥4.5:1、图标按钮带 `aria-label`/Tooltip、表单错误与输入关联。

## 部署与网络

- Compose 新增 `frontend` 服务：多阶段构建（Node 构建静态导出 → nginx:alpine 运行），对外 `${FRONTEND_PORT:-3000}:80`。
- nginx 同源反代：
  - `/api/` → `http://backend:8000`
  - `/api/v1/ws` → backend，开启 WebSocket Upgrade
  - `/` → 静态导出文件，未知路由回退 `index.html`
- 前端使用相对路径请求（`NEXT_PUBLIC_API_BASE=""`），不引入 CORS；开发模式用 `next.config` rewrites 代理到 `http://localhost:8080`。
- 云端部署与 SPEC 01 第 11 步合并执行：同一份 compose，安全组开放 8080、1883、3000、22（仅管理员 IP）；手机流量访问 `http://<公网IP>:3000` 完成演示。

## 实现计划

1. 后端改动：围栏 GET/PUT、通知查询、角色模型收敛（移除 elder 角色并迁移存量账号）、迁移 0003（role 约束收紧 + `elder_access(user_id)` 索引）；同步清理后端 elder 分支与测试。
2. 前端脚手架与设计 token：Next.js + TypeScript + Tailwind + shadcn/ui + Recharts；建立色彩/字体/间距/圆角 token、应用外壳与导航；compose 增加 frontend 服务与 nginx 同源反代；登录页壳可访问。
3. 认证与权限框架：登录、sessionStorage 存取 JWT、路由守卫、角色菜单、401/403 处理、退出登录、Token 过期自动跳转。
4. 概览台：admin / family 差异化 KPI（老人数、在线设备、未处理告警、今日事件）、设备状态、最新告警列表、WebSocket 实时流与连接状态。
5. 老人与联系人模块：列表、详情、新建、编辑、删除、紧急联系人读写（整体替换语义提示）、family 可见范围。
6. 设备与围栏模块：设备注册/列表/绑定（admin）、重复绑定与占用 409 提示；围栏读取/整体替换、半径与开关校验。
7. 健康数据模块：遥测查询（指标/时间过滤）、小时/天趋势图（心率、血氧、步数、活动）、活动分布、表格视图。
8. 事件/告警/通知模块：事件与告警列表过滤、告警确认、通知记录展示。
9. 设计打磨：状态与空态、响应式三档、无障碍、动效克制、图表质感；对照 `frontend-design` / `premium-frontend-ui` 自检并截图评审。
10. 测试与打包：Playwright 端到端用例、README 更新（含前端 3000 的冷启动与演示步骤）、`docker compose down -v` 冷启动复测、云端部署验收。

## 验收标准

- [x] `docker compose up -d --build` 后 `frontend` 容器 healthy，浏览器打开 `http://127.0.0.1:3000` 显示登录页；`migrate` 为 Exited (0)，backend/postgres/mosquitto 均 healthy。
- [x] admin 登录可见全部菜单；family 仅能看到并操作已关联老人；不存在独立 elder 登录。
- [x] 数据库 `users.role` 约束已收敛为 admin / family；历史 elder 账号迁移为 family 后仍可登录，且在无 `elder_access` 关联时看不到任何老人数据。
- [x] 老人档案、紧急联系人、设备绑定可完成增删改查；重复绑定或绑定已占用设备时界面给出 409 中文原因。
- [x] 电子围栏可读取与整体替换，空数组能清空；半径越界等非法输入在表单层与接口层都被拒绝。
- [x] 告警中心可按状态/时间过滤，确认后状态变为 handled 且列表即时更新；通知记录能展示 channel、status、target、sent_at。
- [x] 健康趋势按小时和按天切换，心率/血氧/步数/活动与 `/health-trends` 返回一致，图表有加载、空态与错误态。
- [x] WebSocket 发布 fall 事件后，页面在 1 秒内出现新告警且无需刷新；断线后自动重连，重连期间列表 30 秒轮询仍可更新。
- [x] 设计验收：配色、字体层级、圆角、间距全部来自 token；无浏览器默认控件；卡片不嵌套；同屏数据色 ≤5 种。
- [x] 响应式验收：1440×900、1920×1080、390×844 三档无文字溢出、无元素遮挡、无横向滚动（表格除外，允许局部横滚）。
- [x] 无障碍验收：全流程可键盘操作、focus 可见、对比度达标、`prefers-reduced-motion` 生效。
- [x] Playwright 端到端用例全部通过（登录 admin / family、老人/联系人、设备绑定、趋势图、告警确认、通知展示、实时推送）。
- [x] 后端 `docker compose exec backend python -m pytest -q` 全部通过，包含本规格新增接口、角色迁移与权限边界用例。
- [x] README 从零冷启动步骤可直接跑通到前端演示（含端口 3000 与演示账号）。
- [ ] 云服务器同一 compose 部署后，手机流量访问 3000 端口可完成登录、查看趋势、确认告警与实时推送演示（待云端演示环境执行）。

## 验收记录

- 日期：2026-10-09
- 后端：`docker compose exec -T backend python -m pytest -q` → 92 passed
- 前端：`npm run build` 静态导出 12 个路由成功；`npx tsc --noEmit` 无错误
- 端到端：`npx playwright test` → 28 passed（desktop-chromium 1440×900 全量 15；desktop-wide 1920×1080 核心 7；mobile-chromium 390×844 核心 6）
- 部署：`docker compose down -v` 后 `docker compose up -d --build` 冷启动，frontend/backend/postgres/mosquitto 均 healthy，migrate Exited (0)，`alembic current` = 0003_role_model_and_index (head)
- 覆盖场景：登录与权限、老人/联系人 CRUD 与二次确认、设备注册与 409、围栏整体替换、健康趋势与表格视图、告警确认与通知记录、WebSocket 实时推送。
- 云端部署与手机流量验收需在真实云服务器执行，未包含在本记录内。

## 已定决策与已排除方案

- **是：** Next.js App Router + TypeScript + Tailwind + shadcn/ui + Recharts + Framer Motion，理由是组件生态成熟、管理台开发速度快、与答辩演示匹配。
- **是：** 静态导出 + nginx 单容器，对外端口 3000，nginx 同源反代 `/api` 与 `/api/v1/ws`，避免修改后端 CORS。
- **是：** JWT 存 `sessionStorage`，关闭标签页即失效；401 或过期自动跳登录。
- **是：** elder 与 family 共用一个 family 账号（通过 `elder_access` 关联老人），不再维护独立 elder 账号与 `/api/v1/me/*` 接口。（SPEC 03 修订：移除该账号在管理台内的老人只读展示页。）
- **是：** 角色模型收敛为 admin / family；迁移 0003 将存量 elder 账号并入 family 并收紧约束。
- **是：** 把围栏读写与通知查询纳入本规格，保证前端能覆盖后端全部已有能力。
- **是：** 深色专业监控风格打底，用非模板化设计标准（配色/排版/图表/动效）制造设计感。
- **是：** 列表 30 秒轮询作为 WebSocket 的兜底。
- **否：** 用户账号新建/停用、多语言、移动端 App、深浅色切换、CI/CD、生产级 SSR/HTTPS，理由是与答辩验收点无关或超出两周工期。
- **否：** 修改 SPEC 01 既有接口的语义与鉴权方式，理由是后端已验收，前端只做消费与增补。
- **否：** 独立 elder 登录、elder 专属接口（`/api/v1/me/*`）、roles 多值模型，理由是共用账号已满足课设演示且实现成本最低。

## 风险

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 静态导出下详情页使用查询参数，URL 观感一般 | 演示体验下降 | 用面包屑与页面标题强化层级；如后续需要动态路由，改 nginx 回退或切 standalone 模式 |
| nginx 同源反代配置错误导致 WS 失败 | 实时推送不可用 | 提供 WS 端到端用例；前端显示连接状态并在断线时轮询兜底 |
| 存量 elder 账号迁移遗漏 | 登录失败或数据可见性异常 | 迁移先 UPDATE 再收紧 CHECK；补充迁移与登录回归测试 |
| 设计打磨占用过多工期 | 核心功能延期 | 先冻结 token 与布局，动效限定“首屏进入 + 新告警高亮”两处 |
| 新增端口 3000 公网暴露 | 被扫描/滥用 | 演示期使用强口令账号，安全组按需限制来源；HTTPS 不在本规格范围 |
| 前端与后端并行改动导致接口漂移 | 联调返工 | 本规格先冻结接口增补，实现顺序为后端接口 → 前端接入 |

## 本规格不包含的内容

- 跌倒检测算法、App/小程序、硬件固件。
- 真实通知渠道、视频通话、用药提醒、多租户、Kubernetes、压测。
- 账号生命周期管理（新建/停用/改密）与权限管理界面。
- 独立 elder 账号、elder 专属接口（`/api/v1/me/*`）与同一账号内区分操作人的成员级权限。
- 生产级安全加固（HTTPS、WAF、限流网关、审计报表导出）。

以上每项如需落地，另开独立规格或并入后续迭代。
