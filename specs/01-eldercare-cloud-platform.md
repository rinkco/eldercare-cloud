# SPEC 01 — 老人监护云平台总体规格

> **Status:** Approved
> **Depends on:** 无（本规格是项目基线）
> **Date:** 2026-10-08
> **Objective:** 为小组课设的老人跌倒检测健康监护系统构建云平台后端，提供 MQTT 设备接入、用户与老人档案、健康与位置数据、跌倒/SOS/电子围栏/低电量告警、模拟通知与审计能力，支持 Docker 一键启动，并可原样部署到公有云作为答辩演示环境。

## 为什么需要这份规格

这是小组课设项目，组内分为算法、App/小程序、硬件和云平台四块，本规格负责人只实现云平台后端。其他三块都要与云端对接，所以先用一份总体规格冻结云平台的边界、数据流和接口契约，再按模块展开后续规格，避免实现期接口反复。

课设周期为两周，验收形式是教学演示，不接触真实个人数据，不考虑真实并发规模。

## 范围（Scope）

**本规格包含（In）：**

- 云平台后端 MVP：账号、角色与权限（admin / family；elder 与 family 共用一个账号；老人维度角色 owner / member 见 SPEC 03）。
- 老人档案与紧急联系人管理。
- 设备管理与设备-老人绑定。
- MQTT 接入：遥测、事件、状态三类上行消息。
- 健康数据与位置数据存储（降采样，不含原始加速度流）。
- 跌倒、SOS、电子围栏越界、低电量、设备离线五类事件与告警。
- 通知模拟适配器：写通知表、打印控制台日志、预留 Webhook 接口。
- 健康趋势聚合：心率、血氧、步数、活动状态按小时和按天统计。
- WebSocket 实时推送：新告警与新遥测。
- 审计日志：登录和管理员写操作。
- 本地 Docker Compose 一键启动，并支持把同一套 compose 部署到公有云服务器，提供公网可访问的答辩演示环境。
- Swagger 接口文档、MQTT 模拟设备脚本、种子演示数据。

**本规格不包含（Out of scope，留给后续规格或其他组）：**

- 跌倒检测算法本身：数据预处理、阈值法、SVM/随机森林/轻量 CNN 训练与评估。
- App/小程序界面实现：页面、交互和图表渲染。
- 硬件端实现：ESP32 固件、MPU6050/MAX30102 驱动、手机传感器采集。
- 低功耗策略的实际测试与 ≥24h 续航验证。
- AI 健康摘要与问答、语音助手：列为可选的 SPEC 07，不属于本次 MVP。
- 真实微信、短信、电话通知通道。
- 视频通话、用药提醒、多租户、Kubernetes、水平扩展和压测。
- 生产级云运维：CI/CD、负载均衡、备份容灾和高可用。
- 真实医疗合规、等保测评、生产级安全加固。

**后续规格拆分：**

- 原计划的 SPEC 02–06 模块拆分（用户与老人档案、设备接入与遥测、告警与通知、健康趋势、隐私安全与审计）已并入 SPEC 01 的实现，不再单独开规格。
- SPEC 02：前端 Web 管理台（elder 与 family 共用一个 family 账号；管理台只服务 admin / family，老人侧使用 App，见 `specs/02-eldercare-web-console.md`）。
- SPEC 03：管理台成员权限落地与前端信息架构优化（老人列表/详情按角色门控、合并告警与事件入口、移除老人只读展示页，见 `specs/03-console-members-and-ia.md`）。
- SPEC 07（可选）：AI 健康摘要与问答（调用在线大模型 API，无 Key 时模板 mock 兜底，不属于 MVP）。

## 数据模型

以下表结构是 MVP 基线，后续规格可以在不冲突的前提下细化字段和索引。

```sql
-- 账号与权限
users(id, username UNIQUE, password_hash, role, display_name, phone, created_at)
-- role: admin | family（elder 与 family 共用一个账号；存量 elder 账号在迁移时并入 family）

-- 老人档案与关系
elders(id, name, gender, birth_date, height_cm, weight_kg, address, notes, created_at)
elder_access(id, elder_id FK, user_id FK, role, relation)  -- 哪些账号可以访问哪位老人
-- role: owner | member（老人维度成员角色，迁移 0004 写入）
elder_contacts(id, elder_id FK, name, phone, relation, priority, is_primary)

-- 设备
devices(id, device_uid UNIQUE, kind, model, status, elder_id FK NULL, battery_percent, last_seen_at, bound_at)
-- kind: esp32 | phone | wearable
-- status: online | offline | disabled
-- 一台设备同一时刻只能绑定一位老人

-- 遥测数据（已降采样）
telemetry(id, device_id FK, elder_id FK, metric, value_num, value_text, lat, lon, recorded_at)
-- metric: heart_rate | spo2 | steps | activity | gait | location | battery

-- 事件、告警、通知
events(id, elder_id FK, device_id FK, type, severity, confidence, occurred_at, payload_json, status)
-- type: fall | sos | geofence_exit | low_battery | device_offline
-- status: new | handled | closed
alerts(id, event_id FK, elder_id FK, status, created_at, handled_at, handled_by)
notifications(id, alert_id FK, contact_id FK, channel, target, content, status, sent_at, error)
-- channel: sms | wechat | console
-- status: pending | sent | failed

-- 围栏与审计
geofences(id, elder_id FK, name, center_lat, center_lon, radius_m, enabled)
audit_logs(id, user_id FK, action, target_type, target_id, ip, detail_json, created_at)
```

约定：

- 主键使用 PostgreSQL `BIGSERIAL`。
- 时间统一存 UTC，接口使用 ISO 8601（例如 `2026-10-08T02:00:00Z`）。
- 必要索引：`telemetry(elder_id, metric, recorded_at)`、`events(elder_id, occurred_at)`、`notifications(alert_id)`。
- 教学演示期内数据全部保留，不做归档和清理。

### MQTT 主题与载荷（设备到云）

| 主题 | 方向 | 用途 |
| --- | --- | --- |
| `iot/v1/{device_uid}/telemetry` | 设备到云 | 心率、血氧、步数、活动、步态、位置、电量 |
| `iot/v1/{device_uid}/event` | 设备到云 | 跌倒、SOS 等事件 |
| `iot/v1/{device_uid}/status` | 设备到云 | 在线心跳与电量 |
| `iot/v1/{device_uid}/cmd` | 云到设备 | 演示阶段仅发送 SOS 确认 |

统一使用 QoS 1、UTF-8 JSON，载荷中的 `ts` 为 UTC ISO 8601。示例：

```json
{"device_uid":"esp32-0001","ts":"2026-10-08T02:00:00Z","metric":"heart_rate","value":78}
{"device_uid":"esp32-0001","ts":"2026-10-08T02:00:00Z","metric":"location","lat":31.2304,"lon":121.4737}
{"device_uid":"esp32-0001","ts":"2026-10-08T02:00:00Z","metric":"battery","value":18}
{"device_uid":"esp32-0001","ts":"2026-10-08T02:00:00Z","type":"fall","severity":"critical","confidence":0.97,"payload":{"source":"mpu6050"}}
```

接入规则：

- 未注册设备或字段非法的消息直接丢弃，并写一条 `WARN` 日志。
- 电量低于 20% 触发 `low_battery`。
- 设备超过 120 秒没有状态或遥测消息触发 `device_offline`（演示用模拟脚本触发）。
- 位置点与围栏中心距离大于 `radius_m` 时触发 `geofence_exit`。

### REST 与 WebSocket（App 到云）

| 方法 | 路径 | 说明 | 角色 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | 登录并获取 JWT | 全部 |
| GET/POST | `/api/v1/elders` | 老人列表 / 新建老人 | admin / family（仅可见范围） |
| GET/PUT/DELETE | `/api/v1/elders/{id}` | 老人详情 / 修改 / 删除 | admin / family（仅可见范围） |
| GET/PUT | `/api/v1/elders/{id}/contacts` | 紧急联系人读写 | admin / family |
| GET/POST | `/api/v1/devices` | 设备列表 / 注册设备 | admin |
| POST | `/api/v1/devices/{id}/bind` | 绑定设备到老人 | admin |
| GET | `/api/v1/elders/{id}/telemetry` | 遥测查询 | admin / family |
| GET | `/api/v1/elders/{id}/health-trends` | 健康趋势聚合（interval=hour 或 day） | admin / family |
| GET | `/api/v1/events` | 事件查询 | admin / family |
| GET | `/api/v1/alerts` | 告警查询 | admin / family |
| POST | `/api/v1/alerts/{id}/ack` | 告警确认 | admin / family |
| GET/PUT | `/api/v1/geofences/{elder_id}` | 围栏读写 | admin / family |
| WS | `/api/v1/ws?token=JWT` | 实时推送告警与遥测摘要 | admin / family |

鉴权使用 `Authorization: Bearer <JWT>`。家属账号只能访问 `elder_access` 中关联的老人，越权返回 403。

### 部署与网络

- 开发与联调：Windows 上使用 Docker Desktop，执行 `docker compose up -d` 启动 backend、postgres、mosquitto 三个容器。
- 答辩演示：在轻量云服务器（2 核 2G 起步，2 核 4G 更稳，Ubuntu 加 Docker）上使用同一份 compose 与 `.env` 部署，通过公网 IP 访问 Swagger 和 MQTT。
- 本地兜底：答辩前保留本地环境，云端故障或网络中断时切换到本地演示。
- 凭据管理：数据库密码、JWT 密钥和 MQTT 凭据只保留在本地与服务器的 `.env`，不提交到 Git。
- 域名与备案：演示直接使用 IP 加高位端口；国内节点若使用域名加 80/443，需要 ICP 备案。

| 端口 | 用途 | 安全组策略 |
| --- | --- | --- |
| 8080 | 后端 REST 与 Swagger | 对公网开放 |
| 1883 | MQTT | 对公网开放，强制用户名密码 |
| 22 | SSH 运维 | 仅管理员 IP |
| 5432 | PostgreSQL | 不对外开放 |

## 实现计划

1. 初始化 `eldercare-cloud/` 后端骨架：FastAPI 应用、`docker-compose.yml`（backend + postgres + mosquitto）、`GET /healthz`。手动测试：`docker compose up -d` 后访问 `/healthz` 返回 200。
2. 建立 Alembic 迁移和上节表结构。手动测试：迁移完成后数据库中存在全部表。
3. 实现登录、JWT、bcrypt 密码哈希和角色权限。手动测试：错误密码返回 401，family 访问管理接口返回 403，登录写入审计日志。
4. 实现老人档案、访问关系、紧急联系人接口。手动测试：Swagger 完成老人和联系人的增删改查。
5. 实现设备注册、设备列表和设备绑定接口。手动测试：绑定成功，重复绑定或绑定已占用设备被拒绝。
6. 实现 MQTT 接入服务：订阅三个上行主题、校验载荷、写入 `telemetry`、更新设备状态。手动测试：`mosquitto_pub` 发布心率后 `telemetry` 出现记录。
7. 实现事件规则、告警引擎和通知模拟适配器。手动测试：发布 fall 事件后生成一条 event、一条 alert、一条 notification，控制台打印通知内容。
8. 实现遥测查询、事件查询、告警查询与健康趋势聚合接口。手动测试：种子数据按小时和按天返回心率、血氧、步数和活动状态统计。
9. 实现 WebSocket 推送。手动测试：MQTT 发布 fall 事件后，客户端 1 秒内收到告警消息。
10. 打包演示：种子脚本、MQTT 模拟设备脚本、README 快速开始。手动测试：从零按 README 步骤跑通一键演示。
11. 云端部署：把同一 compose 部署到云服务器，配置 `.env`、安全组和 MQTT 认证。手动测试：手机流量访问 Swagger，外部 `mosquitto_pub` 发布消息成功入库。

## 验收标准

- [ ] 装有 Docker Desktop 的 Windows 电脑执行 `docker compose up -d` 后，backend、postgres、mosquitto 三个容器均健康运行。
- [ ] `GET /healthz` 返回 200，Swagger `/docs` 覆盖全部 MVP 接口。
- [ ] 种子管理员账号可以登录并拿到 JWT，错误密码返回 401。
- [ ] family 角色不能访问管理员接口，且只能查询已关联老人的数据；elder 与 family 共用同一账号，不存在独立 elder 登录。
- [ ] 老人档案、紧急联系人和设备绑定接口可以完成增删改查。
- [ ] MQTT 发布一条心率遥测后 2 秒内写入 `telemetry` 表。
- [ ] MQTT 发布 fall、sos、geofence_exit、low_battery 四类消息后，分别生成对应的 `events`、`alerts`、`notifications` 记录。
- [ ] 电量低于 20% 自动生成低电量告警，设备超过 120 秒无消息自动生成离线告警。
- [ ] 通知模拟适配器把通知内容打印到控制台，并把通知状态置为 `sent`。
- [ ] WebSocket 客户端在告警产生后 1 秒内收到推送。
- [ ] 健康趋势接口对种子数据返回按小时和按天聚合的心率、血氧、步数和活动状态统计。
- [ ] 登录和管理员写操作在 `audit_logs` 中留下记录。
- [ ] `pytest` 自动化测试全部通过。
- [ ] README 记录的冷启动步骤可以从零跑通完整演示。
- [ ] 云服务器上 `docker compose up -d` 后，用手机流量可访问 Swagger，外部设备可用带认证的 MQTT 发布消息并成功入库。
- [ ] 本地 Docker 环境可以独立完成与云端相同的演示流程，作为答辩兜底。

## 已定决策与已排除方案

- **是：** SPEC 01 写总体规格，后续按 SPEC 02–06 拆分模块，理由是一个规格装不下跨设备、数据、告警、安全和统计的完整平台。
- **是：** 只做云平台后端；算法、App/小程序、硬件固件由其他组员负责，云端通过冻结的接口契约对接。
- **是：** FastAPI + PostgreSQL + Mosquitto + JWT + WebSocket，理由是生态成熟、Docker 部署简单、与 Python 课设成本匹配。
- **是：** Docker Compose 一键启动，本机需要安装 Docker Desktop。
- **是：** 跌倒检测在设备端完成，云端只接收跌倒事件和降采样遥测，不存储 50Hz 原始加速度。
- **是：** 电子围栏越界和低电量判定放在云端，理由是设备端只需上报位置与电量，规则调整无需改固件。
- **是：** 通知使用模拟适配器：写 `notifications` 表、打印控制台日志、保留 Webhook 接口。
- **是：** 最小安全实现：JWT + RBAC + bcrypt + 审计日志。
- **是：** elder 与 family 共用一个 family 账号，不再单独维护 elder 角色；理由是课设演示不需要老人独立登录。（原 SPEC 02 在同一账号内提供的老人只读展示页，已由 SPEC 03 移除：管理台只服务 admin / family，老人侧使用 App。）
- **否：** 字段级 AES 加密、强制 HTTPS、真实短信和微信 SDK，理由是教学演示且不涉及真实数据。
- **是：** 演示规模 ≤10 台设备、≤20 个用户、单机部署，不做压测和水平扩展。
- **是：** 两周内完成，优先保证「MQTT 接入 → 告警 → 通知 → 实时推送」的一键演示链路，趋势统计只做最小聚合。
- **是：** 答辩环境部署到公有云服务器，标题含云平台，需要公网可访问的服务和远程设备接入。
- **是：** 开发用本地 Docker，云端与本地共用同一份 compose；内网穿透只作为临时联调备选。
- **否：** 纯局域网演示作为最终验收环境，具备云平台架构但答辩说服力不足。
- **是：** AI 不进 MVP，作为可选的 SPEC 07 做健康摘要与问答，调用在线大模型 API，无 Key 时用模板 mock 兜底。
- **否：** 把旧 LLMTalk 的本地 Qwen 与 Vosk 语音助手并入新平台，两周工期风险大，0.5B 模型也不适合部署到云服务器。
- **否：** 视频通话、用药提醒、多租户、Kubernetes、真实医疗合规认证，理由是与本次课设验收点无关。

## 风险

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 演示机器未安装 Docker Desktop | 无法一键启动 | 提前安装并预热镜像，README 提供本地 venv 备选启动方案 |
| 与算法组、App 组的载荷格式不一致 | 联调返工 | SPEC 01 冻结 MQTT/REST 契约，提供 `simulate_device.py` 供对方对照 |
| 两周工期紧张 | 功能做不完 | 冻结 MVP 边界，趋势只做小时/天聚合，非 MVP 功能明确排除 |
| 传感器数据缺失或异常 | 误报或脏数据入库 | 接入层校验必填字段和取值范围，异常消息丢弃并记录 WARN |
| 模拟通知被误判为未实现 | 验收争议 | Swagger、控制台、`notifications` 表三处都能看到模拟结果 |
| 最小安全实现被当成生产方案 | 安全误解 | 在 README 和规格中声明仅限教学演示，不接入真实数据 |
| 云服务器试用到期或欠费 | 答辩中断 | 答辩前一周完成部署并确认到期日，准备好按量付费或学生优惠续费 |
| 公网 MQTT 被扫描滥用 | 数据污染、资源占用 | 开启用户名密码认证、使用强口令、安全组最小开放，必要时限制来源 IP |
| 校园网 AP 隔离导致设备连不上笔记本 | 局域网联调失败 | 以云端 MQTT 为联调主通道，手机热点作为备用 |

## 本规格不包含的内容

- 跌倒检测算法与 SisFall/UCI 数据集训练评估。
- App/小程序界面实现。
- ESP32 与手机端采集程序、低功耗策略和续航实测。
- 真实微信、短信、电话通知。
- 视频通话、用药提醒、多租户、Kubernetes、高并发压测、真实医疗合规认证。
- 生产级云运维：CI/CD、负载均衡、备份容灾。
- AI 健康摘要与问答、语音助手（列为可选的 SPEC 07）。

以上每项如需落地，都由对应组员完成或另开独立规格。
