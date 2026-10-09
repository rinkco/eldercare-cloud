# 老人监护云平台（IoT Code 课设）

老人跌倒检测健康监护系统的云平台，包含 FastAPI 后端（SPEC 01）与
Next.js Web 管理台（SPEC 02）：设备 MQTT 接入、健康与位置数据、告警通知、
健康趋势、WebSocket 实时推送与审计能力，管理台覆盖登录、老人/联系人、
设备、电子围栏、健康趋势、告警确认与通知记录。教学演示项目，
不接入真实个人数据，不可用于生产环境。

## 架构

```
设备/模拟器 --MQTT--> Mosquitto --> backend（FastAPI + MQTT 消费 + 规则/告警 + WebSocket）
浏览器管理台 --HTTP/WS--> frontend（nginx + Next.js 静态导出）--同源反代--> backend
App/Swagger --HTTP--> backend --> PostgreSQL
```

Docker Compose 服务：

| 服务 | 说明 | 端口 |
| --- | --- | --- |
| `frontend` | Next.js 管理台（静态导出 + nginx 同源反代） | 宿主机 3000 → 容器 80 |
| `backend` | FastAPI + REST + WebSocket + MQTT 消费 | 宿主机 8080 → 容器 8000 |
| `postgres` | PostgreSQL 16（不对外暴露） | 仅容器网络 5432 |
| `mosquitto` | MQTT broker（强制用户名密码） | 1883 |
| `migrate` | 一次性迁移任务（`alembic upgrade head`） | 运行后退出 |

## 前置条件

- Windows 上安装 Docker Desktop（WSL2 后端）
- 8080、1883、3000 端口未被占用（被占用时见「配置项」）
- 仅本地前端开发需要 Node.js 22+；容器构建已自带 Node

## 快速开始

```powershell
# 1. 配置环境变量（首次）
Copy-Item .env.example .env
# 用 PowerShell 生成 JWT 密钥（也可用任意 Python 生成）
$secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
#   把 $secret 填入 .env 的 JWT_SECRET；并按需修改数据库 / MQTT / SEED_* 口令

# 2. 启动（首次会自动构建镜像并执行数据库迁移）
docker compose up -d --build

# 3. 检查四个常驻容器是否健康，migrate 应为 Exited (0)
docker compose ps -a

# 4. 健康检查
Invoke-RestMethod http://127.0.0.1:8080/healthz
Invoke-RestMethod http://127.0.0.1:8080/readyz   # 数据库、迁移版本、MQTT 都就绪才返回 200
```

- Web 管理台：<http://127.0.0.1:3000>（演示账号 admin / admin123456、family / family123456）
- Swagger：<http://127.0.0.1:8080/docs>
- MQTT：`mqtt://127.0.0.1:1883`，账号见 `.env`

## 一键演示流程

管理台演示（答辩推荐顺序）：打开 <http://127.0.0.1:3000>，用 `admin` 登录，
在概览台查看 KPI、设备状态与实时流，进入老人详情维护联系人与围栏、在健康数据
切换小时/天趋势，触发告警后到告警中心确认并查看通知记录；再用 `family`
登录验证可见范围与长辈视图。

```powershell
# 1. 写入演示数据（可重复执行）
docker compose exec backend python -m scripts.seed
#    管理员 admin / admin123456，家属 family / family123456（演示用）

# 2. 登录拿 JWT
$body = '{"username":"admin","password":"admin123456"}'
$login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/api/v1/auth/login `
  -ContentType "application/json" -Body $body
$headers = @{ Authorization = "Bearer $($login.access_token)" }

# 3. 查看老人 / 健康趋势
$elders = Invoke-RestMethod -Uri http://127.0.0.1:8080/api/v1/elders -Headers $headers
$elder = $elders | Where-Object { $_.name -eq "演示老人-张奶奶" } | Select-Object -First 1
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/v1/elders/$($elder.id)/health-trends?interval=hour" -Headers $headers

# 4. 启动模拟设备持续上报（另开终端，Ctrl+C 停止）
docker compose exec backend python -m scripts.simulate_device

# 5. 演示跌倒告警（生成 event → alert → notification，并写入控制台）
docker compose exec backend python -m scripts.simulate_device --scenario fall
docker compose logs backend --tail 5      # 看到「[通知模拟] ... 触发跌倒」
Invoke-RestMethod -Uri http://127.0.0.1:8080/api/v1/alerts -Headers $headers
# 确认告警（把 status 置为 handled）
$alerts = Invoke-RestMethod -Uri http://127.0.0.1:8080/api/v1/alerts -Headers $headers
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8080/api/v1/alerts/$($alerts[0].id)/ack" -Headers $headers

# 6. 演示低电量 / SOS / 围栏越界
docker compose exec backend python -m scripts.simulate_device --scenario low-battery
docker compose exec backend python -m scripts.simulate_device --scenario sos
docker compose exec backend python -m scripts.simulate_device --scenario geofence

# 7. 演示设备离线：停止模拟设备并等待约 2 分 15 秒（巡检间隔 15 秒）
#    然后查询 /api/v1/alerts，应出现 device_offline 告警
```

WebSocket 实时推送（`token` 为上面登录返回的 JWT；宿主机需 `pip install websockets`）：

```powershell
python -c @"
import asyncio, json, websockets
async def main():
    async with websockets.connect('ws://127.0.0.1:8080/api/v1/ws?token=你的TOKEN') as ws:
        while True:
            print(json.loads(await ws.recv()))
asyncio.run(main())
"@
```

## 前端开发模式

容器方式已经包含前端构建；需要热更新调试时在宿主机运行：

```powershell
cd frontend
npm install
npm run dev        # http://localhost:3000
```

开发模式下 `/api` 由 `next.config.ts` 的 rewrites 代理到
`http://localhost:8080`；后端端口不同（例如 8080 被占用）时覆盖目标：

```powershell
$env:DEV_BACKEND_URL = "http://localhost:18080"
$env:NEXT_PUBLIC_WS_BASE = "ws://localhost:18080"   # WebSocket 直连后端
npm run dev
```

`DEV_BACKEND_URL` 只作用于 REST 代理；实时推送走 WebSocket，需要用
`NEXT_PUBLIC_WS_BASE` 指向同一后端端口，否则连接状态会停在“连接中”。

生产构建使用 `output: "export"`，由 nginx 同源反代 `/api/` 与 `/api/v1/ws`，
前端不依赖 CORS。

## 测试

集成测试需要运行中的 compose 栈（会使用真实数据库与 MQTT broker）：

```powershell
docker compose exec backend python -m pytest -q
```

宿主无数据库时会自动跳过集成用例，只跑单元测试。

管理台端到端测试（需要运行中的栈，且已执行 `scripts.seed`）：

```powershell
cd frontend
npm install
npx playwright install chromium
npm run e2e        # 默认访问 http://localhost:3000；可用 E2E_BASE_URL 覆盖
```

## 常用命令

```powershell
docker compose logs -f backend          # 查看后端日志（含通知模拟输出）
docker compose exec backend alembic check       # 检查模型与迁移是否漂移
docker compose exec backend alembic upgrade head
docker compose restart backend
docker compose down                     # 停止（保留数据卷）
docker compose down -v                  # 清空数据库卷，重新开始
```

## 配置项（.env）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `POSTGRES_USER/PASSWORD/DB` | eldercare | 数据库凭据（仅容器网络可见） |
| `BACKEND_PORT` | 8080 | 宿主机 REST/Swagger 端口；被占用时改这里 |
| `FRONTEND_PORT` | 3000 | 宿主机 Web 管理台端口；被占用时改这里 |
| `NPM_REGISTRY` | npmjs.org | 前端容器构建源；国内可改 npmmirror |
| `MQTT_USER/PASSWORD` | eldercare | MQTT 账号（公网部署务必改强口令） |
| `JWT_SECRET` | 空 | 必填，至少 32 字节随机值，启动时校验 |
| `PIP_INDEX_URL` | pypi.org | 国内网络慢时可改为清华镜像 |

## 云端部署（答辩演示）

1. Ubuntu 云服务器安装 Docker + Docker Compose；安全组开放 8080、3000、1883（1883 建议限制来源），22 仅允许管理员 IP。
2. 上传代码，按上面的「快速开始」创建 `.env`，务必更换数据库/MQTT/SEED_* 口令与 JWT 密钥。
3. `docker compose up -d --build`，确认 `migrate` Exited (0)、四个容器 healthy。
4. 手机流量访问 `http://<公网IP>:3000` 打开管理台完成演示；`http://<公网IP>:8080/docs` 为 Swagger；外部设备用带用户名密码的 MQTT 连接 1883。
5. 本地环境保持可用，作为答辩兜底。

> 注意：WebSocket 的 JWT 通过查询参数传递，应用已对 uvicorn 日志做
> `token=***` 脱敏；若在云上再加 Nginx 等反向代理，请同步配置访问日志脱敏。
> MQTT 1883 为明文端口，公网演示必须使用强口令并尽量限制来源 IP。

> 数据口径：模拟器与种子数据中的 `steps` 表示“本区间新增步数”，趋势接口
> 按小时/天对 steps 求和；真实设备若上报累计步数，需要在设备侧转为增量。

## 安全边界声明

- 仅用于教学演示：JWT + RBAC + bcrypt + 审计日志，不包含 HTTPS、字段级加密、
  真实短信/微信通知、生产级高可用与合规能力。
- 演示账号由 `.env` 的 `SEED_*` 配置（`scripts.seed` 会同步口令）；不要提交 `.env`，公网演示请使用强口令。
- 设备事件/遥测的 QoS1 重复消息已做应用级去重；多实例部署需改用共享消息总线
  （当前按规格只支持单实例）。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `docker compose up` 报 Docker daemon 未运行 | 启动 Docker Desktop 后重试 |
| 8080 打不开或返回别的内容 | 端口被占用，改 `.env` 的 `BACKEND_PORT` 后 `docker compose up -d` |
| 3000 打不开或返回别的内容 | 端口被占用，改 `.env` 的 `FRONTEND_PORT` 后 `docker compose up -d frontend` |
| 前端容器构建 npm 下载慢 | 在 `.env` 设置 `NPM_REGISTRY=https://registry.npmmirror.com` |
| 构建时 pip 下载超时 | 在 `.env` 设置 `PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple` |
| `/readyz` 返回 503 | 看 `docker compose ps -a` 与 `docker compose logs backend`，确认数据库/迁移/MQTT |
| MQTT 连接被拒绝 | 检查 `.env` 账号口令；broker 已关闭匿名访问 |
