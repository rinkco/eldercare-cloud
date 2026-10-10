# 老人监护云平台 App 端对接文档

> 适用对象：正在开发 iOS / Android / 小程序 / H5 App 的移动端成员。  
> 适用分支：`main`（spec-01 / spec-02 及后续增强均已合并）。  
> 口径来源：`specs/01-eldercare-cloud-platform.md`、`specs/02-eldercare-web-console.md`、`app/routers/*.py`、`app/schemas.py`、`app/access.py`、`app/deps.py`、`app/ws.py`、`README.md`、`scripts/seed.py`、`frontend/src/lib/api.ts`、`frontend/src/lib/realtime.tsx`。  
> 冲突处理：规格与当前代码不一致时，以当前代码为准。

## 1. 概览与协作边界

系统数据链路：

```text
设备 / 模拟器 --MQTT--> Mosquitto --> backend
backend --> PostgreSQL
backend --REST/WebSocket--> App
backend --REST/WebSocket--> Web 管理台
```

App 直接对接 FastAPI 后端，不建议把 Web 管理台（3000）当成 API 服务。管理台的 `/api` 是 nginx 同源代理，App 使用后端地址（本地默认 `http://127.0.0.1:18080`）更直接。

App 端的职责边界：

- 主要使用 `family` 账号，面向家属和共用账号下的长辈视图。
- Web 管理台和运维使用 `admin` 账号。不要把 admin 账号打进移动端或让普通用户持有 admin Token。
- 设备注册、列表、绑定、解绑只有 admin 接口；family 可用 `GET /api/v1/elders/{id}/devices` 只读查看某老人绑定设备。
- 长辈视图只是前端交互约定，不是后端安全隔离。`family` 账号仍然拥有老人、联系人、围栏、告警确认等写权限。App 的“只读”页面必须隐藏写操作，但不能把它当作安全边界。
- App 需要实时告警时使用 WebSocket；WebSocket 断开期间用 REST 轮询兜底。

以下事项需要产品/联调双方对齐（含最新进展）：

- App 展示绑定设备或电量：已提供 `GET /api/v1/elders/{elder_id}/devices`（admin 与关联家属可用），字段含 `status`、`battery_percent`、`last_seen_at`。
- 云端联调地址已就绪：REST API `http://47.108.147.192:18080`、管理台 `http://47.108.147.192:3000`、
  MQTT `47.108.147.192:1883`；账号口令请联系部署负责人获取，不要写入仓库。
  模拟器/真机访问宿主机或云端的最终基址仍按各自 App 工程配置确定。
- 公网演示环境当前为 `IP:端口` 的 HTTP，没有域名与 HTTPS；是否补充 HTTPS 由部署方后续决定。

## 2. 环境准备与测试数据

### 2.1 默认端口与地址

| 服务 | 本地地址 | 说明 |
| --- | --- | --- |
| 后端 REST / Swagger | `http://127.0.0.1:18080` | App 的默认本地 API 基址 |
| 后端健康检查 | `http://127.0.0.1:18080/healthz` | 只检查进程存活 |
| 后端就绪检查 | `http://127.0.0.1:18080/readyz` | 数据库、迁移、MQTT 都正常才返回 200 |
| Swagger | `http://127.0.0.1:18080/docs` | 可直接查看当前路由和 schema |
| Web 管理台 | `http://127.0.0.1:3000` | Next.js + nginx 管理台，不是 App 必需依赖 |
| MQTT | `mqtt://127.0.0.1:1883` | 设备侧联调使用，App 不直接连接 |

App 在模拟器或真机上运行时，`localhost` 指手机/模拟器自身，不一定是运行后端的电脑。Android 模拟器访问宿主机通常使用 `10.0.2.2`，真机通常使用电脑局域网 IP 或上面的云端地址；使用本地后端时，具体地址由 App 工程配置决定。

公网演示环境（答辩联调，已部署）：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| REST / Swagger | `http://47.108.147.192:18080` | App 可直接使用该基址，Swagger 在 `/docs` |
| 管理台 | `http://47.108.147.192:3000` | 注册账号、用户编辑、设备注册与演示数据 |
| MQTT | `mqtt://47.108.147.192:1883` | 设备侧联调使用，App 不直接连接 |

> 端口变更提醒：云端已统一使用 18080；App 需同步修改 `api/ApiConfig.java` 的
> `BASE_URL` / `WS_URL` 与 `res/xml/network_security_config.xml`。MQTT 仍为 1883，不受影响。

演示环境的 admin / family / MQTT 口令由部署负责人在联调群内提供，仓库与本文档
不保存实际口令。服务为云厂商试用实例，停机或重建后公网 IP 可能变化，以群内
最新公告为准。

### 2.2 启动后端

在仓库根目录 `D:\Code\eldercare-cloud` 执行：

```powershell
Copy-Item .env.example .env

# 生成并填入 JWT_SECRET；JWT_SECRET 必须至少 32 字节
$secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
Write-Output $secret

docker compose up -d --build
docker compose ps -a

Invoke-RestMethod http://127.0.0.1:18080/healthz
Invoke-RestMethod http://127.0.0.1:18080/readyz
```

启动成功的典型状态：

- `frontend`、`backend`、`postgres`、`mosquitto` 为 healthy。
- `migrate` 执行完成后为 `Exited (0)`。
- `/healthz` 返回 `{"status":"ok"}`。
- `/readyz` 返回数据库、迁移、MQTT 均为 `ok` 的对象。

### 2.3 演示账号与种子数据

演示账号由 `.env` 的以下变量提供给后端容器，再由 seed 脚本创建或同步：

| 变量 | 默认值 |
| --- | --- |
| `SEED_ADMIN_USERNAME` | `admin` |
| `SEED_ADMIN_PASSWORD` | `admin123456` |
| `SEED_FAMILY_USERNAME` | `family` |
| `SEED_FAMILY_PASSWORD` | `family123456` |

实际值以部署环境的 `.env` 为准，不要假设默认口令仍然有效。

执行 seed：

```powershell
docker compose exec backend python -m scripts.seed
```

脚本可重复执行，主要行为：

- 创建或同步 admin、family 账号及其角色和密码。
- 创建或复用演示老人“演示老人-张奶奶”。
- 建立 family 与该演示老人的 `elder_access(relation="daughter")` 关系。
- 补充两个联系人、一个“家附近围栏”、设备 `esp32-demo-0001`。
- 补充最近 24 小时的确定性遥测：心率、血氧、步数、活动。

seed 本身不生成事件、告警和通知。需要完整链路时执行：

```powershell
# 正常持续上报，Ctrl+C 停止
docker compose exec backend python -m scripts.simulate_device

# 一次性场景
docker compose exec backend python -m scripts.simulate_device --scenario fall
docker compose exec backend python -m scripts.simulate_device --scenario sos
docker compose exec backend python -m scripts.simulate_device --scenario geofence
docker compose exec backend python -m scripts.simulate_device --scenario low-battery
```

## 3. 认证

### 3.1 登录接口

`POST /api/v1/auth/login`

- 角色：公开接口。
- 请求体：JSON 对象。
- `username`：字符串，1 到 64 字符。
- `password`：字符串，1 到 128 字符。

请求：

```json
{
  "username": "family",
  "password": "family123456"
}
```

成功响应：HTTP 200。

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 43200,
  "role": "family"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `access_token` | string | JWT；后续 REST 和 WebSocket 都使用它 |
| `token_type` | string | 当前固定为 `bearer` |
| `expires_in` | integer | 有效秒数；由后端配置计算，当前默认 720 分钟，即 43200 秒 |
| `role` | string | `admin` 或 `family` |

登录失败返回 401：

```json
{
  "detail": "用户名或密码错误"
}
```

### 3.2 Bearer 用法

除登录、`/healthz`、`/readyz` 外，REST 请求都必须携带：

```http
Authorization: Bearer <access_token>
```

示例：

```powershell
$TOKEN = "<access_token>"
curl.exe -sS "http://127.0.0.1:18080/api/v1/elders" `
  -H "Authorization: Bearer $TOKEN"
```

### 3.3 过期与 401 处理

当前没有 refresh token，也没有独立的 token 续期接口。

App 约定：

- 使用 `expires_in` 计算本地过期时间，提前停止使用即将过期的 Token。
- 收到 401 时清理本地会话、关闭 WebSocket，并回到登录页重新登录。
- 不要把 401 当成可重试的业务错误；不要原样反复提交。
- 服务端没有 logout/revoke 接口。退出登录由 App 删除本地 Token 并关闭 WebSocket 实现。
- JWT 默认有效期是 720 分钟。`expires_in` 是唯一可靠的有效期来源，不要硬编码 12 小时。
- 登录 schema 允许密码最长 128 字符，但 bcrypt 实际限制为 72 字节；超过时会认证失败并返回 401。演示账号不受影响。

401 常见响应：

```json
{"detail": "未提供访问令牌"}
```

```json
{"detail": "访问令牌无效或已过期"}
```

```json
{"detail": "访问令牌对应的账号不存在"}
```

401 响应通常带：

```http
WWW-Authenticate: Bearer
```

### 3.4 注册接口（公开）

`POST /api/v1/auth/register`

- 角色：公开接口，无需 Token。
- 固定创建 `family` 角色账号，不能在请求体里指定角色（出现 `role` 等额外字段返回 422）。

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `username` | string | 3-32 位字母、数字、下划线或连字符 |
| `password` | string | 6-64 字符，且不超过 bcrypt 的 72 字节 |
| `display_name` | string \| null | 可选，最长 64 字符 |
| `phone` | string \| null | 可选，最长 32 字符 |

请求示例：

```json
{
  "username": "zhang-family",
  "password": "family-pass-123",
  "display_name": "张奶奶女儿",
  "phone": "13800000000"
}
```

成功响应：HTTP 201，返回 `UserOut`（不含 Token，需再调用登录接口）：

```json
{
  "id": 3,
  "username": "zhang-family",
  "role": "family",
  "display_name": "张奶奶女儿",
  "phone": "13800000000"
}
```

错误语义：

- 用户名已存在：409，`{"detail": "账号已存在"}`。
- 字段不合法：422。

注册后的数据可见范围：

- 新账号默认没有任何 `elder_access` 关联，老人列表为空。
- family 账号调用 `POST /api/v1/elders` 新建老人时会自动建立关联
  （`relation=creator`），随后即可查看该老人数据。
- 当前没有“把已有老人关联到某个账号”的管理接口与界面；如需让新账号访问已有
  老人，需由部署方在数据库或种子脚本中补充 `elder_access` 行。

## 4. 角色与数据可见范围

当前只有两个角色：

- `admin`
- `family`

不再存在独立的 `elder` 角色。老人和家属共用 `family` 账号，App 使用同一个 Token 提供“管理视图”和“长辈视图”。

### 4.1 能力矩阵

| 能力 | admin | family |
| --- | --- | --- |
| 登录、持有 JWT、WebSocket | 是 | 是 |
| 老人列表 / 详情 | 全量 | 仅 `elder_access` 关联的老人 |
| 新建 / 修改 / 删除老人 | 是 | 仅可见老人；family 新建后自动获得关联 |
| 紧急联系人读取 / 整体替换 | 是 | 仅可见老人 |
| 设备注册 / 列表 / 绑定 / 解绑 | 是 | 否，返回 403 |
| 老人绑定设备（只读） | 全量 | 仅关联老人 |
| 电子围栏读取 / 整体替换 | 是 | 仅可见老人 |
| 遥测查询 / 健康趋势 | 是 | 仅可见老人 |
| 事件列表 | 全量 | 自动过滤到关联老人 |
| 告警列表 / 确认 | 全量 | 仅关联老人 |
| 通知记录 | 全量 | 仅关联告警对应老人 |
| 用户列表 / 用户编辑 | 是 | 否，返回 403 |
| 长辈视图 | Web/App 展示层可预览或使用 | 展示层只读，但账号权限没有降级 |

注册接口（`POST /api/v1/auth/register`）公开可用，注册结果固定为 `family` 角色。

### 4.2 可见范围语义

- `family` 访问“不存在”的老人：404，`detail` 为 `老人档案不存在`。
- `family` 访问“存在但未关联”的老人：403，`detail` 为 `无权访问该老人档案`。
- `/api/v1/events`、`/api/v1/alerts` 这类列表接口会直接过滤可见数据；传入未关联的 `elder_id` 时通常返回空数组，而不是 403。
- WebSocket 在连接时按 `family` 的 `elder_access` 关系加载可见老人，广播时只向有权限的连接发送对应老人的数据。
- `admin` 在 WebSocket 和列表接口中可见全量数据。

长辈视图风险：

- 隐藏“编辑”“删除”“确认告警”等按钮只是 UI 约定。
- 同一 Token 仍可通过接口直接写数据。
- 如果未来需要真正只读的老人账号，需要新增独立角色和成员级权限规格，当前分支没有实现。

## 5. 接口清单

### 5.1 通用约定

- REST API 基址：`/api/v1`。
- 请求体使用 `Content-Type: application/json`。
- 列表接口直接返回 JSON 数组，没有 `items`、`total`、`page` 包装。
- 当前只有 `limit`，没有 offset/cursor 分页。
- 时间参数必须带时区，例如 `2026-10-09T02:00:00Z` 或 `2026-10-09T10:00:00+08:00`。
- 不带时区的 `2026-10-09T02:00:00` 返回 422。
- 接口响应时间统一为 UTC。REST 示例通常显示 `Z`，WebSocket 的 `isoformat()` 通常显示 `+00:00`，客户端都应按时区时间解析。

### 5.2 系统与认证

| 方法 | 路径 | 角色 | 请求 | 响应 | 错误语义 |
| --- | --- | --- | --- | --- | --- |
| GET | `/healthz` | 公开 | 无 | 200：`{"status":"ok"}` | 无业务错误 |
| GET | `/readyz` | 公开 | 无 | 200：数据库、迁移、MQTT 均 `ok` | 503：任一依赖未就绪 |
| POST | `/api/v1/auth/login` | 公开 | `LoginRequest` | 200：`TokenResponse` | 401、422 |
| POST | `/api/v1/auth/register` | 公开 | `RegisterRequest` | 201：`UserOut` | 409（账号已存在）、422 |

`/readyz` 健康响应：

```json
{
  "status": "ok",
  "database": "ok",
  "migration": "ok",
  "mqtt": "ok"
}
```

### 5.3 老人与联系人

| 方法 | 路径 | 角色 | 请求 | 响应 | 错误语义 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/elders` | admin / family | 无 | `ElderOut[]` | 401 |
| POST | `/api/v1/elders` | admin / family | `ElderCreate` | 201：`ElderOut` | 401、422 |
| GET | `/api/v1/elders/{elder_id}` | admin / family | 路径参数 | `ElderOut` | 403、404 |
| PUT | `/api/v1/elders/{elder_id}` | admin / family | `ElderUpdate`；局部更新 | `ElderOut` | 403、404、422 |
| DELETE | `/api/v1/elders/{elder_id}` | admin / family | 无 | 204，无响应体 | 403、404 |
| GET | `/api/v1/elders/{elder_id}/contacts` | admin / family | 无 | `ContactOut[]` | 403、404 |
| PUT | `/api/v1/elders/{elder_id}/contacts` | admin / family | `ContactIn[]`；整体替换 | `ContactOut[]` | 403、404、422 |

老人新建示例：

```json
{
  "name": "演示老人-张奶奶",
  "gender": "female",
  "birth_date": "1945-03-12",
  "height_cm": 158,
  "weight_kg": 56,
  "address": "上海市浦东新区演示路 1 号",
  "notes": "课设演示数据"
}
```

老人更新是局部更新。只提交需要修改的字段，未出现的字段保持不变：

```json
{
  "address": "上海市浦东新区新地址 2 号",
  "notes": null
}
```

`name` 可以省略，但显式提交 `null` 会返回 422。

联系人接口是“整表替换”，不是单项增删改：

```json
[
  {
    "name": "张小明",
    "phone": "13800000001",
    "relation": "son",
    "priority": 1,
    "is_primary": true
  },
  {
    "name": "张小红",
    "phone": "13800000002",
    "relation": "daughter",
    "priority": 2,
    "is_primary": false
  }
]
```

- 空数组表示清空全部联系人。
- 联系人 ID 每次替换后重新生成。
- 最多只能有一个 `is_primary=true`；多个主联系人返回 422，`detail` 为 `最多只能有一个主联系人`。
- 列表按 `priority` 升序、再按 `id` 升序。

### 5.4 设备

设备注册 / 列表 / 绑定 / 解绑仅限 admin；family 可通过老人维度只读接口查看绑定设备。

| 方法 | 路径 | 角色 | 请求 | 响应 | 错误语义 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/devices` | admin | 无 | `DeviceOut[]` | 403 |
| POST | `/api/v1/devices` | admin | `DeviceCreate` | 201：`DeviceOut` | 403、409、422 |
| POST | `/api/v1/devices/{device_id}/bind` | admin | `DeviceBind` | `DeviceOut` | 403、404、409、422 |
| POST | `/api/v1/devices/{device_id}/unbind` | admin | 无 | `DeviceOut` | 403、404、409 |
| GET | `/api/v1/elders/{elder_id}/devices` | admin / family | 无 | `DeviceOut[]` | 403、404 |

注册设备：

```json
{
  "device_uid": "esp32-room-0001",
  "kind": "esp32",
  "model": "ESP32-DevKit"
}
```

绑定设备：

```json
{
  "elder_id": 1
}
```

权限和业务限制：

- `device_uid` 只允许字母、数字、下划线、短横线，必须字母或数字开头，最长 64。
- `kind` 只能是 `esp32`、`phone`、`wearable`。
- 设备 UID 重复返回 409，`detail` 为 `设备 UID 已存在`。
- 同一设备重复绑定同一老人返回 409。
- 设备已被其他老人占用返回 409。
- 设备状态为 `disabled` 时绑定返回 409。
- 绑定成功后 `bound_at` 使用服务器 UTC 时间。
- 解绑接口把设备置回未绑定并清空 `bound_at`，历史遥测与事件保留；删除老人时也会自动解绑。

### 5.5 遥测与健康趋势

#### 遥测查询

`GET /api/v1/elders/{elder_id}/telemetry`

角色：admin / family。

查询参数：

| 参数 | 类型 | 必填 | 限制与默认值 |
| --- | --- | --- | --- |
| `metric` | string | 否 | 按指标精确过滤；REST 层不校验枚举值，未知值返回空数组 |
| `start` | datetime | 否 | 带时区；条件为 `recorded_at >= start` |
| `end` | datetime | 否 | 带时区；条件为 `recorded_at <= end` |
| `limit` | integer | 否 | 默认 200，范围 1 到 1000 |

返回 `TelemetryOut[]`，按 `recorded_at` 降序、再按 `id` 降序。

示例：

```powershell
curl.exe -sS "http://127.0.0.1:18080/api/v1/elders/1/telemetry?metric=heart_rate&limit=50" `
  -H "Authorization: Bearer $TOKEN"
```

```json
[
  {
    "id": 101,
    "device_id": 2,
    "elder_id": 1,
    "metric": "heart_rate",
    "value_num": 78.0,
    "value_text": null,
    "lat": null,
    "lon": null,
    "recorded_at": "2026-10-09T02:00:00Z"
  }
]
```

位置遥测使用 `lat`、`lon`，活动/步态也可能使用 `value_text`。

#### 健康趋势

`GET /api/v1/elders/{elder_id}/health-trends`

角色：admin / family。

查询参数：

| 参数 | 类型 | 必填 | 限制与默认值 |
| --- | --- | --- | --- |
| `interval` | string | 否 | 只能是 `hour` 或 `day`，默认 `hour` |
| `start` | datetime | 否 | 带时区 |
| `end` | datetime | 否 | 带时区 |
| `limit` | integer | 否 | 只返回最近 N 个分桶，范围 1 到 720；省略返回全部 |

返回 `TrendBucket[]`，按 `bucket_start` 升序。

聚合口径：

- `heart_rate`、`spo2`：返回 `avg`、`min`、`max`、`count`。
- `steps`：按区间求和，输出 `steps_total`。设备上报值按“本区间新增步数”处理。
- `activity`：按活动文本统计采样次数，输出 `activity[]`。
- 时间桶按 UTC 小时或 UTC 天切分。

示例：

```json
[
  {
    "bucket_start": "2026-10-09T02:00:00Z",
    "heart_rate": {
      "avg": 70.0,
      "min": 60.0,
      "max": 80.0,
      "count": 2
    },
    "spo2": {
      "avg": 96.0,
      "min": 95.0,
      "max": 97.0,
      "count": 2
    },
    "steps_total": 250.0,
    "activity": [
      {
        "activity": "walking",
        "count": 2
      },
      {
        "activity": "resting",
        "count": 1
      }
    ]
  }
]
```

没有数据的聚合项为 `null`，`activity` 没有数据时为 `[]`。

### 5.6 事件、告警与通知

#### 事件列表

`GET /api/v1/events`

角色：admin / family。family 自动过滤到关联老人。

| 参数 | 类型 | 必填 | 限制与默认值 |
| --- | --- | --- | --- |
| `elder_id` | integer | 否 | 按老人过滤 |
| `type` | string | 否 | 事件类型，如 `fall`、`sos` |
| `status` | string | 否 | `new`、`handled`、`closed` |
| `start` | datetime | 否 | 带时区；按 `occurred_at >= start` |
| `end` | datetime | 否 | 带时区；按 `occurred_at <= end` |
| `limit` | integer | 否 | 默认 100，范围 1 到 500 |

返回 `EventOut[]`，按 `occurred_at` 降序、再按 `id` 降序。

`type`、`status` 查询值在 REST 层不做枚举校验；未知值返回空数组。

事件不会被告警确认接口修改；确认告警只修改 `Alert.status`，`Event.status` 保持原值。

#### 告警列表

`GET /api/v1/alerts`

角色：admin / family。family 自动过滤到关联老人。

| 参数 | 类型 | 必填 | 限制与默认值 |
| --- | --- | --- | --- |
| `elder_id` | integer | 否 | 按老人过滤 |
| `status` | string | 否 | `new`、`handled`、`closed` |
| `limit` | integer | 否 | 默认 100，范围 1 到 500 |

返回 `AlertOut[]`，按 `created_at` 降序、再按 `id` 降序。

`status` 查询值在 REST 层不做枚举校验；未知值返回空数组。

`AlertOut` 现已包含 `occurred_at`（事件发生时间）与 `elder_name`，App 无需再按 `event_id` 二次查询或只用 `created_at` 兜底。

#### 告警确认

`POST /api/v1/alerts/{alert_id}/ack`

角色：admin / family。

- 不发送请求体。
- `new` 告警会变为 `handled`，写入 `handled_at` 和当前用户 `handled_by`。
- 重复确认是幂等操作，仍返回 200，状态保持 `handled`。
- 已处理告警再次确认不会追加新的审计记录。
- 告警不存在返回 404；family 访问未关联老人的告警返回 403。

成功响应：

```json
{
  "id": 10,
  "event_id": 25,
  "elder_id": 1,
  "status": "handled",
  "created_at": "2026-10-09T02:03:00Z",
  "handled_at": "2026-10-09T02:05:00Z",
  "handled_by": 2,
  "event_type": "fall",
  "severity": "critical"
}
```

#### 通知记录

`GET /api/v1/alerts/{alert_id}/notifications`

角色：admin / family；family 需要告警对应老人可见。

- 返回 `NotificationOut[]`，按 `id` 升序。
- 告警不存在返回 404。
- 告警存在但 family 不可见返回 403。

```json
[
  {
    "id": 31,
    "alert_id": 10,
    "contact_id": 3,
    "channel": "console",
    "target": "13800000001",
    "content": "【critical】演示老人-张奶奶 触发跌倒，请及时处理。",
    "status": "sent",
    "sent_at": "2026-10-09T02:03:00Z",
    "error": null
  }
]
```

当前通知写路径只创建 `channel="console"` 的模拟通知，写入数据库并打印后端日志。数据库约束允许 `sms`、`wechat`、`console`，但当前没有真实短信、微信发送逻辑。

### 5.7 电子围栏

| 方法 | 路径 | 角色 | 请求 | 响应 | 错误语义 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/geofences/{elder_id}` | admin / family | 无 | `GeofenceOut[]` | 403、404 |
| PUT | `/api/v1/geofences/{elder_id}` | admin / family | `GeofenceIn[]`；整体替换 | `GeofenceOut[]` | 403、404、422 |

围栏是整表替换，空数组表示清空。整体替换会重新生成围栏 ID。

请求示例：

```json
[
  {
    "name": "家附近围栏",
    "center_lat": 31.2304,
    "center_lon": 121.4737,
    "radius_m": 500,
    "enabled": true
  }
]
```

字段限制：

- `name`：1 到 64 字符。
- `center_lat`：-90 到 90。
- `center_lon`：-180 到 180。
- `radius_m`：50 到 5000。
- `enabled`：严格布尔，只能是 `true` 或 `false`；`1`、`0`、`"false"`、`null` 都会返回 422。

### 5.8 用户列表与编辑

`GET /api/v1/users`、`PATCH /api/v1/users/{user_id}`

- 角色：仅 admin；family 返回 403。
- GET 返回 `UserOut[]`，按 `id` 升序。
- PATCH 可编辑 `display_name`、`phone`、`role`（admin / family）与
  `password`（重置密码）：省略字段表示不修改，`display_name` / `phone`
  传 `null` 表示清空；`username` 不可修改。
- 降级管理员时系统需至少保留一个管理员，否则返回 400；用户不存在返回 404。

PATCH 请求示例（省略字段表示不修改；`display_name` / `phone` 传 `null` 表示清空）：

```json
{
  "display_name": "张奶奶女儿",
  "phone": "13800000000",
  "role": "family",
  "password": "new-pass-456"
}
```

`GET /api/v1/users` 响应示例：

```json
[
  {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "display_name": "演示管理员",
    "phone": null
  }
]
```

## 6. 典型业务流程

推荐顺序：

1. 登录并保存 `access_token`、`expires_in`、`role`。
2. 拉取老人列表，确定当前账号可见的老人。
3. 拉取选中老人的详情和联系人。
4. 拉取最近遥测和小时/天健康趋势。
5. 拉取事件与告警列表。
6. 确认告警。
7. 查询该告警的通知记录。
8. 同时建立 WebSocket，接收新告警和新遥测摘要。

### 6.1 最小 PowerShell 闭环

```powershell
$Base = "http://127.0.0.1:18080"

$loginBody = '{"username":"family","password":"family123456"}'
$login = Invoke-RestMethod `
  -Method Post `
  -Uri "$Base/api/v1/auth/login" `
  -ContentType "application/json" `
  -Body $loginBody

$Headers = @{ Authorization = "Bearer $($login.access_token)" }

$elders = @(Invoke-RestMethod -Uri "$Base/api/v1/elders" -Headers $Headers)
if ($elders.Count -eq 0) { throw "当前账号没有可见老人" }

$ElderId = $elders[0].id

$elder = Invoke-RestMethod `
  -Uri "$Base/api/v1/elders/$ElderId" `
  -Headers $Headers

$contacts = @(Invoke-RestMethod `
  -Uri "$Base/api/v1/elders/$ElderId/contacts" `
  -Headers $Headers)

$telemetry = @(Invoke-RestMethod `
  -Uri "$Base/api/v1/elders/$ElderId/telemetry?limit=50" `
  -Headers $Headers)

$trends = @(Invoke-RestMethod `
  -Uri "$Base/api/v1/elders/$ElderId/health-trends?interval=hour" `
  -Headers $Headers)

$events = @(Invoke-RestMethod `
  -Uri "$Base/api/v1/events?elder_id=$ElderId&limit=20" `
  -Headers $Headers)

$alerts = @(Invoke-RestMethod `
  -Uri "$Base/api/v1/alerts?elder_id=$ElderId&limit=20" `
  -Headers $Headers)

if ($alerts.Count -gt 0) {
  $AlertId = $alerts[0].id

  $ack = Invoke-RestMethod `
    -Method Post `
    -Uri "$Base/api/v1/alerts/$AlertId/ack" `
    -Headers $Headers

  $notifications = @(Invoke-RestMethod `
    -Uri "$Base/api/v1/alerts/$AlertId/notifications" `
    -Headers $Headers)
}
```

### 6.2 curl 登录示例

Windows PowerShell 使用 `curl.exe`，避免 `curl` 被解析为 `Invoke-WebRequest`：

```powershell
$Base = "http://127.0.0.1:18080"

curl.exe -sS -X POST "$Base/api/v1/auth/login" `
  -H "Content-Type: application/json" `
  -d '{"username":"family","password":"family123456"}'
```

拿到 Token 后：

```powershell
$TOKEN = "<access_token>"

curl.exe -sS "$Base/api/v1/elders" `
  -H "Authorization: Bearer $TOKEN"
```

### 6.3 告警触发测试

执行 seed 后，设备的 family 相关测试链路可这样触发：

```powershell
docker compose exec backend python -m scripts.simulate_device --scenario fall
```

随后：

1. WebSocket 应收到 `type=alert` 的 `fall` 消息。
2. `/api/v1/events?type=fall&limit=20` 应出现事件。
3. `/api/v1/alerts?status=new&limit=20` 应出现对应告警。
4. 调用 `/api/v1/alerts/{alert_id}/ack`。
5. `/api/v1/alerts/{alert_id}/notifications` 应返回 `console` 通知。

## 7. 数据字典

### 7.1 认证与用户

| 模型 | 字段 | JSON 类型 | 含义与约束 |
| --- | --- | --- | --- |
| `LoginRequest` | `username` | string | 1 到 64 字符 |
| `LoginRequest` | `password` | string | 1 到 128 字符；bcrypt 实际限制 72 字节 |
| `TokenResponse` | `access_token` | string | JWT |
| `TokenResponse` | `token_type` | string | 当前为 `bearer` |
| `TokenResponse` | `expires_in` | integer | 有效秒数 |
| `TokenResponse` | `role` | string | `admin` 或 `family` |
| `UserOut` | `id` | integer | 用户 ID |
| `UserOut` | `username` | string | 用户名 |
| `UserOut` | `role` | string | `admin` 或 `family` |
| `UserOut` | `display_name` | string \| null | 展示名 |
| `UserOut` | `phone` | string \| null | 手机号 |
| `RegisterRequest` | `username` | string | 3-32 位字母、数字、下划线或连字符，唯一 |
| `RegisterRequest` | `password` | string | 6-64 字符；bcrypt 实际限制 72 字节 |
| `RegisterRequest` | `display_name` | string \| null | 可选，最长 64 字符 |
| `RegisterRequest` | `phone` | string \| null | 可选，最长 32 字符 |
| `UserUpdate` | `display_name` / `phone` | string \| null | 省略不修改；传 `null` 清空 |
| `UserUpdate` | `role` | string \| null | `admin` 或 `family`；省略不修改，不允许显式 `null` |
| `UserUpdate` | `password` | string \| null | 重置密码；6-64 字符、≤72 字节 |

### 7.2 老人与联系人

| 模型 | 字段 | JSON 类型 | 含义与约束 |
| --- | --- | --- | --- |
| `ElderOut` | `id` | integer | 老人 ID |
| `ElderOut` | `name` | string | 1 到 64 字符 |
| `ElderOut` | `gender` | string \| null | 自由文本，最长 16 字符，当前 seed 使用 `female` |
| `ElderOut` | `birth_date` | string \| null | `YYYY-MM-DD` |
| `ElderOut` | `height_cm` | integer \| null | 30 到 250 |
| `ElderOut` | `weight_kg` | number \| null | 1 到 500 |
| `ElderOut` | `address` | string \| null | 最长 255 字符 |
| `ElderOut` | `notes` | string \| null | 备注，无显式长度限制 |
| `ElderOut` | `created_at` | string | ISO 8601 UTC |
| `ContactOut` | `id` | integer | 联系人 ID；整体替换后重新生成 |
| `ContactOut` | `name` | string | 1 到 64 字符 |
| `ContactOut` | `phone` | string | 1 到 32 字符，不校验号码格式 |
| `ContactOut` | `relation` | string \| null | 最长 32 字符，自由文本 |
| `ContactOut` | `priority` | integer | 1 到 99，默认 1 |
| `ContactOut` | `is_primary` | boolean | 是否主联系人；最多一个为 true |

### 7.3 设备与围栏

| 模型 | 字段 | JSON 类型 | 含义与约束 |
| --- | --- | --- | --- |
| `DeviceOut` | `id` | integer | 设备 ID |
| `DeviceOut` | `device_uid` | string | 设备唯一 UID，MQTT 主题使用 |
| `DeviceOut` | `kind` | string | `esp32`、`phone`、`wearable` |
| `DeviceOut` | `model` | string \| null | 设备型号 |
| `DeviceOut` | `status` | string | `online`、`offline`、`disabled` |
| `DeviceOut` | `elder_id` | integer \| null | 绑定的老人 ID |
| `DeviceOut` | `battery_percent` | integer \| null | 0 到 100 |
| `DeviceOut` | `last_seen_at` | string \| null | 最近一次状态/遥测时间，UTC |
| `DeviceOut` | `bound_at` | string \| null | 绑定时间，UTC |
| `GeofenceOut` | `id` | integer | 围栏 ID；整体替换后重新生成 |
| `GeofenceOut` | `name` | string | 1 到 64 字符 |
| `GeofenceOut` | `center_lat` | number | -90 到 90 |
| `GeofenceOut` | `center_lon` | number | -180 到 180 |
| `GeofenceOut` | `radius_m` | integer | 50 到 5000 |
| `GeofenceOut` | `enabled` | boolean | 严格布尔 |

### 7.4 遥测与趋势

| 模型 | 字段 | JSON 类型 | 含义与约束 |
| --- | --- | --- | --- |
| `TelemetryOut` | `id` | integer | 遥测 ID |
| `TelemetryOut` | `device_id` | integer | 设备 ID |
| `TelemetryOut` | `elder_id` | integer | 老人 ID |
| `TelemetryOut` | `metric` | string | `heart_rate`、`spo2`、`steps`、`activity`、`gait`、`location`、`battery` |
| `TelemetryOut` | `value_num` | number \| null | 数值型指标值 |
| `TelemetryOut` | `value_text` | string \| null | 文本型指标值，如活动状态 |
| `TelemetryOut` | `lat` | number \| null | 纬度 |
| `TelemetryOut` | `lon` | number \| null | 经度 |
| `TelemetryOut` | `recorded_at` | string | 记录时间，UTC |
| `TrendBucket` | `bucket_start` | string | UTC 小时或天的桶起点 |
| `TrendBucket` | `heart_rate` | `MetricStats` \| null | 心率统计 |
| `TrendBucket` | `spo2` | `MetricStats` \| null | 血氧统计 |
| `TrendBucket` | `steps_total` | number \| null | 桶内步数增量之和 |
| `TrendBucket` | `activity` | `ActivityCount[]` | 桶内活动采样计数 |
| `MetricStats` | `avg` | number | 平均值 |
| `MetricStats` | `min` | number | 最小值 |
| `MetricStats` | `max` | number | 最大值 |
| `MetricStats` | `count` | integer | 样本数 |
| `ActivityCount` | `activity` | string | 活动文本；数据库不限制枚举，App 应容忍未知值 |
| `ActivityCount` | `count` | integer | 次数 |

当前 seed 和模拟器使用的活动值包括 `walking`、`resting`、`sleeping`。

### 7.5 事件、告警与通知

| 模型 | 字段 | JSON 类型 | 含义与约束 |
| --- | --- | --- | --- |
| `EventOut` | `id` | integer | 事件 ID |
| `EventOut` | `elder_id` | integer | 老人 ID |
| `EventOut` | `device_id` | integer | 触发设备 ID |
| `EventOut` | `type` | string | `fall`、`sos`、`geofence_exit`、`low_battery`、`device_offline` |
| `EventOut` | `severity` | string | 当前写入值为 `info`、`warning`、`critical` |
| `EventOut` | `confidence` | number \| null | 0 到 1 |
| `EventOut` | `occurred_at` | string | 事件发生时间，UTC |
| `EventOut` | `payload_json` | object | 事件扩展数据 |
| `EventOut` | `status` | string | `new`、`handled`、`closed` |
| `AlertOut` | `id` | integer | 告警 ID |
| `AlertOut` | `event_id` | integer | 对应事件 ID |
| `AlertOut` | `elder_id` | integer | 老人 ID |
| `AlertOut` | `status` | string | `new`、`handled`、`closed` |
| `AlertOut` | `created_at` | string | 告警创建时间，UTC |
| `AlertOut` | `handled_at` | string \| null | 确认时间，UTC |
| `AlertOut` | `handled_by` | integer \| null | 确认用户的 ID，不是用户名 |
| `AlertOut` | `event_type` | string | 从事件表复制的类型 |
| `AlertOut` | `severity` | string | 从事件表复制的重要级别 |
| `NotificationOut` | `id` | integer | 通知 ID |
| `NotificationOut` | `alert_id` | integer | 告警 ID |
| `NotificationOut` | `contact_id` | integer \| null | 联系人 ID；没有联系人时可为 null |
| `NotificationOut` | `channel` | string | `sms`、`wechat`、`console`；当前写路径只产生 `console` |
| `NotificationOut` | `target` | string \| null | 发送目标；当前模拟通知为联系人电话 |
| `NotificationOut` | `content` | string | 通知正文 |
| `NotificationOut` | `status` | string | `pending`、`sent`、`failed`；当前模拟通知为 `sent` |
| `NotificationOut` | `sent_at` | string \| null | 发送时间，UTC |
| `NotificationOut` | `error` | string \| null | 失败原因；成功时为 null |

事件类型中文映射建议：

| 类型 | 中文 |
| --- | --- |
| `fall` | 跌倒 |
| `sos` | SOS 求助 |
| `geofence_exit` | 电子围栏越界 |
| `low_battery` | 设备低电量 |
| `device_offline` | 设备离线 |

## 8. WebSocket 实时推送

### 8.1 连接与鉴权

连接地址：

```text
ws://127.0.0.1:18080/api/v1/ws?token=<URL 编码后的 access_token>
```

注意：

- 当前 WebSocket 只从查询参数读取 `token`，不是 `Authorization` 请求头。
- Token 必须 URL 编码。
- 不要在 App 日志中打印完整 WebSocket URL，避免泄露 JWT。
- 连接建立后，服务端先发送 `ready`，之后才会发送业务消息。
- `admin` 接收全量广播；`family` 只接收关联老人的广播。
- 服务端在握手和广播时检查 Token 过期，不是定时强制断开。App 应按 `expires_in` 主动重连或重新登录。

连接成功后第一条消息：

```json
{
  "type": "ready"
}
```

### 8.2 告警消息

```json
{
  "type": "alert",
  "alert": {
    "id": 10,
    "event_id": 25,
    "elder_id": 1,
    "elder_name": "演示老人-张奶奶",
    "event_type": "fall",
    "severity": "critical",
    "occurred_at": "2026-10-09T02:03:00+00:00",
    "status": "new"
  }
}
```

WebSocket 的 `alert` 与 REST `AlertOut` 都包含 `elder_name`、`occurred_at`；WS 消息不含 `created_at`、`handled_at`、`handled_by`，App 收到后可先展示，再用 REST 刷新完整详情。

### 8.3 遥测消息

```json
{
  "type": "telemetry",
  "telemetry": {
    "elder_id": 1,
    "device_uid": "esp32-demo-0001",
    "metric": "heart_rate",
    "value_num": 72.0,
    "value_text": null,
    "lat": null,
    "lon": null,
    "recorded_at": "2026-10-09T02:03:05+00:00"
  }
}
```

WebSocket 使用 `device_uid`；REST `TelemetryOut` 使用 `device_id`。两者不是同一字段。

### 8.4 关闭码与重连

| 关闭码 | 含义与 App 处理 |
| --- | --- |
| `4401` | 握手中 JWT 缺失、无效或已过期；连接后续失去授权时也可能由服务端关闭。停止重连，清理会话并重新登录；若账号仍有效但可见范围变化，刷新老人列表后重连。 |
| `4403` | JWT 可解析，但用户不存在或角色不是 `admin`/`family`。停止重连，按无权限或会话失效处理。 |
| 其他正常/网络关闭 | 使用指数退避重连。前端参考实现为 1 秒、2 秒、4 秒递增，最大 30 秒。 |

服务端没有业务层消息重放、`Last-Event-ID` 或离线补发。重连成功后必须调用 REST 补齐断线期间的数据。

建议重连流程：

1. 使用当前 Token 建立连接。
2. 收到 `ready` 后标记连接可用，并调用最近告警、事件、遥测接口做一次全量刷新。
3. 收到 `alert` 后按 `alert.id` 合并；收到 `telemetry` 后按业务时间追加或覆盖。
4. 非 4401/4403 断开时进入指数退避重连。
5. WebSocket 不可用时每 30 秒轮询 REST 作为兜底。
6. 轮询建议使用 `/api/v1/alerts?limit=500` 或按老人 `/api/v1/alerts?elder_id={id}&limit=500`，按 `id` 合并，以同时感知新告警和状态变化。
7. Token 到期或收到 4401/4403 时，停止重连并回到登录流程。

当前服务端没有应用层心跳消息。WebSocket 协议层的 ping/pong 由客户端或平台 SDK 处理。

### 8.5 App 伪代码

```text
connect(token):
  ws = open("ws://host/api/v1/ws?token=" + urlencode(token))

onMessage(message):
  switch message.type:
    ready:
      connectionState = ONLINE
      refreshAlertsAndLatestTelemetry()
    alert:
      upsertAlertById(message.alert.id, message.alert)
      refreshAlertDetailAndNotificationsLater(message.alert.id)
    telemetry:
      appendOrReplaceTelemetry(message.telemetry)

onClose(code):
  if code in (4401, 4403):
    clearSession()
    stopReconnect()
  else:
    startPollingEvery30Seconds()
    reconnectWithExponentialBackoff()
```

## 9. 错误处理与常见问题

### 9.1 HTTP 状态码

| 状态码 | 典型场景 | App 处理 |
| --- | --- | --- |
| 401 | 未带 Token、Token 无效/过期、登录账号密码错误 | 清理会话并重新登录 |
| 403 | family 访问设备/用户管理接口，或访问未关联老人/告警 | 提示无权限，不重复请求同一资源 |
| 404 | 老人、设备、告警不存在，或路径不存在 | 刷新列表；如果是旧 ID，移除本地缓存 |
| 400 | 业务校验失败，例如把系统中最后一个管理员降级 | 展示 `detail`，不重试 |
| 409 | 设备 UID 重复、重复绑定、设备被占用、设备停用、注册用户名已存在 | 展示 `detail`，刷新设备状态 |
| 422 | 字段缺失、类型错误、额外字段、数值越界、时间不带时区、多个主联系人 | 定位请求字段并修正 |
| 503 | `/readyz` 检测到数据库、迁移或 MQTT 未就绪 | 后端不可用，延迟重试并提示联调环境未就绪 |

常见错误体：

```json
{"detail": "权限不足"}
```

```json
{"detail": "老人档案不存在"}
```

```json
{"detail": "无权访问该老人档案"}
```

```json
{"detail": "设备 UID 已存在"}
```

```json
{"detail": "设备已被其他老人占用"}
```

FastAPI/Pydantic 的校验错误通常是数组：

```json
{
  "detail": [
    {
      "type": "greater_than_equal",
      "loc": ["query", "limit"],
      "msg": "Input should be greater than or equal to 1",
      "input": "0"
    }
  ]
}
```

自定义业务校验错误可能是字符串：

```json
{"detail": "start 必须带时区（例如 Z 或 +08:00）"}
```

App 的错误解析应同时兼容 `detail` 为字符串和数组两种情况。

### 9.2 422 常见原因

- 老人、联系人、设备、围栏请求体出现未定义字段。这些模型配置了 `extra="forbid"`。
- `kind` 不是 `esp32`、`phone` 或 `wearable`。
- `enabled` 不是严格布尔。
- `limit` 小于最小值或大于最大值。
- `start`、`end` 不带时区。
- `interval` 不是 `hour` 或 `day`。
- 联系人列表出现多个 `is_primary=true`。
- 更新老人时显式提交 `"name": null`。
- 手机号、设备 UID、围栏名称等长度约束不满足。
- 注册用户名不是 3-32 位字母、数字、下划线或连字符（例如包含空格）。
- 注册或重置密码少于 6 字符、超过 64 字符，或超过 bcrypt 的 72 字节。

登录请求模型没有配置额外字段禁止，多余字段可能被忽略；App 仍应只发送 `username` 和 `password`。

### 9.3 时间字段

- 所有时间语义均为 UTC。
- 请求中的 `start`、`end` 必须带时区偏移。
- REST 响应通常使用 `Z` 后缀。
- WebSocket 推送由 Python `isoformat()` 生成，通常使用 `+00:00`。
- App 应使用带时区的 ISO 8601 解析器，再转换为本地时区展示。
- 不要假设所有时间字符串都以 `Z` 结尾。

### 9.4 分页与刷新

- 当前没有分页参数。
- 遥测最大 `limit=1000`，事件和告警最大 `limit=500`。
- 列表是快照，没有 `updated_since`、版本号或增量同步协议。
- 实时推送没有重放能力。App 断线重连后应重新拉取最近列表。
- 如果将来需要全量历史，需要后端新增分页接口；当前 App 不应自行拼接 offset。

### 9.5 通知渠道

当前告警生成后：

- 有联系人时，为每个联系人写一条 `console` 通知，目标为联系人电话。
- 没有联系人时，也写一条 `contact_id=null`、`target=null` 的 `console` 通知。
- 当前发送状态直接置为 `sent`。
- 后端控制台打印 `[通知模拟]` 日志。

因此 App 只能展示“通知模拟记录”，不能把 `sent` 理解为真实短信或微信已经送达。

### 9.6 常见联调问题

| 现象 | 排查 |
| --- | --- |
| 登录返回 401 | 检查用户名密码、`SEED_*` 是否已同步、是否应为 `application/json` |
| 所有业务请求返回 401 | 检查 `Authorization: Bearer <token>` 是否为原生 HTTP 头 |
| family 看不到演示老人 | 重新执行 seed，或检查该用户是否存在 `elder_access` 关联 |
| family 返回 403 | 可能是设备/用户管理接口，或老人未关联 |
| WebSocket 立即关闭 4401 | Token 错误、过期或 URL 未正确编码 |
| WebSocket 自动断线 | 检查网络、Token 过期、代理 Upgrade 配置；恢复后先用 REST 补数据 |
| 触发 fall 后没有告警 | 检查设备是否已注册并绑定、MQTT 是否 healthy、`readyz` 是否 200 |
| 没有通知记录 | 确认告警存在，并请求 `/alerts/{alert_id}/notifications` |
| 时间查询返回 422 | 给 `start`、`end` 补充 `Z` 或 `+08:00` |
| 浏览器/H5 直连 18080 被 CORS 拦截 | 后端未配置 CORS；原生 App 不受浏览器同源策略影响，H5 应走同源代理或由平台层处理 |

## 10. 联调检查清单

- [ ] `docker compose ps -a` 中 `backend`、`postgres`、`mosquitto`、`frontend` healthy，`migrate` 为 `Exited (0)`。
- [ ] `/healthz` 返回 200。
- [ ] `/readyz` 返回 200，且 `database`、`migration`、`mqtt` 都为 `ok`。
- [ ] 已执行 `docker compose exec backend python -m scripts.seed`。
- [ ] 使用 family 账号登录成功，响应包含 `access_token`、`token_type`、`expires_in`、`role`。
- [ ] App 正确保存 Token，并为 REST 请求添加 Bearer 头。
- [ ] `/api/v1/elders` 返回 family 关联的演示老人，而不是全量老人。
- [ ] 能根据老人 `id` 拉取详情。
- [ ] 能拉取联系人列表；保存时使用整表替换 JSON 数组。
- [ ] 能拉取遥测；`metric=heart_rate` 返回按时间倒序的数据。
- [ ] 能拉取 `interval=hour` 和 `interval=day` 的健康趋势。
- [ ] 执行 `--scenario fall` 后能查询到 `fall` 事件。
- [ ] 执行 `--scenario fall` 后能查询到对应 `new` 告警。
- [ ] WebSocket 连接后先收到 `{"type":"ready"}`。
- [ ] WebSocket 能收到 `type=alert`，且 `elder_id`、`event_type`、`severity` 正确。
- [ ] WebSocket 能收到 `type=telemetry`。
- [ ] WebSocket 断开时，App 会按 30 秒轮询告警作为兜底。
- [ ] WebSocket 重连后，App 会重新拉取 REST 最近数据，补齐断线区间。
- [ ] 调用告警确认后，`AlertOut.status` 为 `handled`，`handled_at` 和 `handled_by` 非空。
- [ ] 重复确认同一告警仍返回 200，且状态保持 `handled`。
- [ ] 通知接口返回 `channel=console`、`status=sent` 的记录。
- [ ] family 调用 `/api/v1/devices` 返回 403。
- [ ] family 调用未关联老人的详情/联系人/围栏/遥测返回 403；事件/告警列表不会泄露未关联老人。
- [ ] 使用过期或错误 Token 时，App 能清理本地会话并回到登录页。
- [ ] App 不显示长辈视图中的写操作入口，并已明确该视图不是安全隔离。
- [ ] 注册接口能创建 family 账号（201），重复用户名返回 409，注册后可用新账号登录。
- [ ] admin 可通过 `PATCH /api/v1/users/{id}` 编辑显示名/手机号/角色并重置密码。

## 11. 已知限制与不在范围内的事项

- 本地与当前 compose 默认使用 HTTP，不包含 HTTPS、TLS 证书和 WAF。
- 没有 refresh token、Token 续期接口、Token 吊销接口和服务端 logout。
- 已提供公开注册（`POST /api/v1/auth/register`，固定 family 角色）与 admin 用户编辑
  （`PATCH /api/v1/users/{id}`），以及监护成员管理
  （`GET/PUT /api/v1/elders/{id}/access`，owner/member 两级）；
  仍没有账号停用/删除、找回密码、自助改密；演示账号仍由 seed 与 `.env` 同步。
- 没有 `/api/v1/me/*` 老人专属接口。
- 没有独立 `elder` 登录角色；老人和 family 共用一个账号。
- 长辈视图只读是展示层约定，不是权限隔离。
- 设备注册、设备列表、设备绑定、解绑仅 admin；family 可通过
  `GET /api/v1/elders/{id}/devices` 只读查看绑定设备。
- 电子围栏和紧急联系人均为整体替换，没有单条更新接口。
- REST 列表没有分页、搜索、排序和总数。
- WebSocket 没有离线补发、消息序号、业务心跳和送达确认。
- 没有单条事件或告警详情接口，App 只能从列表接口按条件筛选。
- 告警 REST 与 WebSocket 均包含 `occurred_at` 和 `elder_name`。
- `Alert.status` 和 `Event.status` 是两套状态；确认告警不会改变事件状态。
- `handled_by` 只有用户 ID，App 需要用户列表或本地映射才能显示处理人名称；family 无用户列表权限。
- 通知只使用 console 模拟，不发送真实短信、微信或电话。
- 没有多语言接口和 i18n 字段，接口错误与枚举按当前中文/英文原值处理。
- 没有真实医疗合规、字段级加密、生产高可用和水平扩展能力。
- 当前不支持多实例 WebSocket 广播；规格明确按单实例演示。

## 12. 快速核对索引

需要重新核对实现时，优先查看：

| 内容 | 源码 |
| --- | --- |
| 登录与 Token | `app/routers/auth.py`、`app/security.py`、`app/config.py` |
| 401/403 语义 | `app/deps.py`、`app/access.py` |
| 老人与联系人 | `app/routers/elders.py` |
| 设备 | `app/routers/devices.py` |
| 遥测与趋势 | `app/routers/telemetry.py` |
| 事件、告警、通知 | `app/routers/events.py` |
| 围栏 | `app/routers/geofences.py` |
| 用户列表 | `app/routers/users.py` |
| 请求/响应字段 | `app/schemas.py` |
| WebSocket | `app/ws.py` |
| 前端 REST 消费 | `frontend/src/lib/api.ts` |
| 前端 WebSocket 与重连 | `frontend/src/lib/realtime.tsx` |
| 种子数据 | `scripts/seed.py` |
| 模拟设备 | `scripts/simulate_device.py` |
