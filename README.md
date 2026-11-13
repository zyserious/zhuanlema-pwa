# 今天赚了吗 · 自托管 PWA

> 上班实时看见「今天已经赚了多少钱」。
> 把一个开源安卓 App 重构为可自托管的微信级轻量 PWA，并按**客服排班制**重写了计薪内核。

<p align="left">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-offline--ready-5B8DEF">
  <img alt="No framework" src="https://img.shields.io/badge/frontend-zero%20build-FFC53D">
  <img alt="Python" src="https://img.shields.io/badge/backend-Python%20stdlib-3776AB">
  <img alt="Deploy" src="https://img.shields.io/badge/deploy-Docker%20Compose-2496ED">
  <img alt="Tunnel" src="https://img.shields.io/badge/expose-Cloudflare%20Tunnel-F38020">
  <img alt="Version" src="https://img.shields.io/badge/version-v2.4-2EA44F">
</p>

每次发布都记录在 [CHANGELOG.md](CHANGELOG.md)：改了什么、为什么改、踩了什么坑。历史版本对应 git tag（`v2.4` 起开始打）。

## 它解决什么问题

原项目（[Jack-Cherish/zhuanlema](https://github.com/Jack-Cherish/zhuanlema)）是一个安卓 APK：上班期间实时显示「已经挣了多少钱」，用跳动的数字给自己打气。

但它有两条硬伤：

1. **只有安卓**，iPhone 用户装不了 —— 而 APK 本质只是 WebView 外壳，全部逻辑都在一个单文件 HTML 里
2. **固定工作制假设**（周一到周五 9:00–18:00 + 午休）—— 而真实用户是客服，**组长几天排一次班**，白班 08:00–16:00、夜班 16:00–24:00、休息日不固定、**没有午休**

于是做了三件事：Web 化 → 按排班重写计薪 → 补上 iPhone 真正缺的能力（推送到点提醒、换设备数据不丢、电脑桌面小窗）。

## 特性

- 💰 **实时收益**：已挣金额 / 每秒工资 / 下班倒计时 / 进度节点
- 📅 **四态排班日历**：白班 → 夜班 → 休息 → **未排班**（未排班不计入提醒和统计）
- 🔔 **班次到点提醒**：自建 Web Push（iOS 16.4+ 主屏 PWA），并提供 `.ics` 日历导出作为降级方案
- 🐟 **摸鱼计薪**：把偷懒也折成钱
- 🐷 **愿望罐**：给想要的东西标价，实时算「还要上几天班」
- 📈 **模拟炒股 / 攒钱进度**：情绪放大器
- 📱 **PWA**：添加到主屏、全屏无地址栏、离线可用
- 🖥 **桌面小窗**：Document Picture-in-Picture，300×186 始终置顶（Chrome/Edge 116+）
- ☁️ **账号 + 云同步**：多设备数据一致，且**任何一台设备的空白都不会覆盖完整数据**

## 架构

```
iPhone 主屏 PWA / 桌面浏览器（零框架单文件前端）
        │  HTTPS
        ▼
Cloudflare（DNS + 边缘代理 + 免费 TLS）
        │  Cloudflare Tunnel（出站长连接，无需公网 IP / 端口映射）
        ▼
自有 NAS · Docker Compose
  ├─ web    caddy:alpine    :8090   静态站点 + 反代 /api/*
  └─ push   python:3.12     :8000   Web Push + 账号 + 数据 API
        │
        ├─ /data/            accounts.json · subs.json · snapshots/
        └─ APNs / FCM        （Web Push 投递）
```

## 目录结构

```
zhuanlema-web/
├─ index.html              # 整个前端（单文件，零框架零构建）
├─ sw.js                   # Service Worker：网络优先 + 推送事件
├─ manifest.webmanifest    # PWA 清单
├─ icons/
├─ diag.html               # 设备自诊断页（版本 / 本机数据 / 同步锚点 / 云端）
├─ v.json                  # 构建号，用于 CDN 缓存自愈
├─ CHANGELOG.md            # 每个版本改了什么、为什么
├─ Caddyfile               # 静态站点 + /api/* 同源反代 + 分级缓存头
├─ docker-compose.yaml     # 两个容器，一条命令起服务
├─ push/
│  └─ server.py            # 11 个 HTTP 接口（标准库 + pywebpush）
├─ docs/                   # 技术文档（每个坑的根因、解法、排查顺序）
│  ├─ deploy.md            # 无公网 IP 的 HTTPS 部署 SOP + 自托管环境注意事项
│  ├─ caching.md           # PWA 双层缓存自锁与更新通道
│  ├─ sync.md              # 多端数据同步的四道闸与回归测试
│  ├─ push.md              # iOS Web Push 的准入条件与实现
│  └─ payroll-model.md     # 排班制计薪模型改造清单
└─ tests/                  # 同步逻辑回归测试（6 场景）
   ├─ harness.js  cases.js  extract.js
   ├─ run.sh               # 跑同步回归
   └─ version-check.sh     # 校验四处版本标记与 CHANGELOG 是否对齐
```

## 快速开始

```bash
# 1. 准备
cp push/.env.example push/.env      # 填 VAPID 私钥（32 字节 base64url 原始标量）、账号密码
dom=$(your.domain.example)          # 换成你自己的域名

# 2. 起服务
docker compose up -d

# 3. 验证
curl -s https://$dom/api/health
curl -s -X POST https://$dom/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo"}'
```

外网暴露用 Cloudflare Tunnel，**不需要公网 IP，也不需要开路由器端口**。完整步骤（含方案对比与踩坑清单）见 [`docs/deploy.md`](docs/deploy.md)；最小配置：Cloudflare 建一条 Tunnel → DNS 加 CNAME 指向 `<TUNNEL_ID>.cfargotunnel.com` → `config.yml` 的 ingress 加一条 `hostname → http://127.0.0.1:8090`。

## 关键设计取舍

| 决策 | 选择 | 理由 |
|---|---|---|
| 前端框架 | **不用** | 复杂度在计薪规则不在 UI 状态；引入构建链会让"改一句话"变成一次完整发版 |
| 数据库 | **不用** | 数据是「1~2 个用户 + 一个 JSON blob」，JSON + 原子替换（`os.replace`）+ 快照足够，省一个容器的运维债 |
| 后端端口 | **不新开子域** | Caddy 同源反代 `/api/*`，无 CORS、无预检、不用再动隧道配置 |
| SW 缓存策略 | **网络优先** | 缓存优先曾导致"用户永远看到旧版"的线上故障，见下 |
| 提醒通道 | **推送 + 日历双通道** | 推送依赖权限和厂商服务，.ics 导出不依赖任何外部通道，100% 会响 |
| 同步权威 | **云端权威 + 设备需授权** | 时间戳单独判不了新旧，必须叠加数据完整度与同步关系 |

## 技术文档

| 文档 | 内容 |
|---|---|
| [docs/deploy.md](docs/deploy.md) | Cloudflare Tunnel 部署 SOP、方案对比、自托管环境注意事项 |
| [docs/caching.md](docs/caching.md) | PWA 双层缓存自锁的根因、三层解法、排查顺序 |
| [docs/sync.md](docs/sync.md) | 多端同步的四个缺陷、四道闸、6 场景回归测试 |
| [docs/push.md](docs/push.md) | iOS 推送准入条件、VAPID 坑、链路自检技巧、降级方案 |
| [docs/payroll-model.md](docs/payroll-model.md) | 周期性→按日模型的改造清单与高危点 |

## 三个值得一读的坑

1. **PWA 双层缓存自锁** —— CDN 缓存 `sw.js` 4 小时 × 旧 SW 缓存优先 = 用户既拿不到新页面，也拿不到能更新自己的新 SW。
   解法：网络优先 + **版本化 SW URL**（`sw.js?v=N`）+ `Cache-Control` 分级。**关键是保证存在一条永远不被缓存的更新通道。**
2. **iOS 推送的准入条件** —— 16.4+ 且**必须添加到主屏**，标签页里订阅无效。纯前端无法在应用关闭后定时唤醒，所以必须有服务端。
3. **空白设备覆盖云端数据** —— 自动保存污染了"最后修改时间" + 只比时间戳 + 服务端零校验，三者叠加。解法是四道闸：同步锚点授权 / 自动数据独立通道 / 数据完整度评分 / 服务端 base 校验 409 + 写入快照。

## 测试

```bash
bash tests/run.sh
```

6 个场景覆盖同步判定的边界：手机首登、手机乱点、久放、旧设备升级、已同步改动、无改动。
测试用 `vm` 沙箱直接加载**真实前端脚本**，只 mock `fetch` 与 `localStorage`。

```bash
bash tests/version-check.sh
```

校验 `v.json` / 页脚 / `sw.js?v=N` / `CACHE` 四处版本标记与 CHANGELOG 一致。
漏改任何一处，用户就会停在旧版本而你以为已发布 —— 这个脚本让它在发布前就报错。

## 已知限制

- 认证是个人项目级别：PBKDF2-SHA256 + Bearer token，**缺**接口限流、CSRF 防护、多租户隔离审计、日志脱敏
- 提醒靠 20 秒轮询扫描，用户量上去必须换成定时任务队列 + 按班次预排
- 存储是 JSON 文件，千级用户必须换 SQLite / Postgres
- 境外域名 + 境外 CDN，国内访问走国际链路，速度一般，**不适用于需要备案的正式商业站点**

## Roadmap

- [ ] 计薪内核单元测试（跨零点 / 休息日 / 月末边界）
- [ ] 提醒改为预排任务队列，去掉轮询
- [ ] 今日页增加「明天什么班」预告
- [ ] 换设备时的一键导出 / 导入（离线迁移）

## License

MIT。原项目版权归 [Jack-Cherish](https://github.com/Jack-Cherish) 所有，本项目是其 Web / PWA 方向的衍生重构。
