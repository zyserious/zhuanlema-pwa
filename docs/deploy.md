# 部署：让家里的服务带上自己的域名

> 适用于「内网跑了个 Web 服务，想让外网也能访问，但没有公网 IP」的场景。
> 本项目的线上实例就是这么部署的，整套流程可以复用到任何自托管项目。

## 为什么不用传统方案

| 方案 | 需要公网 IP | 需要端口映射 | 地址稳定 | HTTPS | 结论 |
|---|---|---|---|---|---|
| 公网 IP + 端口映射 | 是 | 是 | 是 | 手动配 | 家宽通常拿不到公网 IP，否 |
| DDNS + 端口映射 | 否 | 是 | 是 | 手动配 | 仍要在路由器开端口，暴露面大，否 |
| frp / 自建反代 | 需要一台公网 VPS | 否 | 是 | 手动配 | 多一台机器要维护，成本高 |
| ngrok / 内网穿透免费版 | 否 | 否 | **地址会变** | 是 | 地址一换用户全废，否 |
| **Cloudflare Tunnel** | **否** | **否** | **是** | **自动** | **选它** |

原理一句话：内网的 `cloudflared` 主动向 Cloudflare 建一条**出站长连接**，公网请求走这条连接回到内网。因为是出站连接，防火墙不需要开放任何入站端口。

## 标准步骤

### 1. 域名托管到 Cloudflare

把域名的 NS 指到 Cloudflare，等生效。免费版足够——你要的只是 DNS + 边缘代理 + 自动证书。

### 2. 在内网机器上跑 cloudflared

新建一个 Tunnel，拿到 **Tunnel ID** 和凭证文件（`<TUNNEL_ID>.json` 或 Token）。

推荐用**本地配置模式**（`config.yml`），比在仪表盘里点 ingress 更可控、也能纳入版本管理。

### 3. 写 `config.yml`

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
  # 一条 hostname 对应一个内网服务
  - hostname: app.example.com
    service: http://127.0.0.1:8090
  # 兜底规则必须在最后，且不带 hostname
  - service: http_status:404
```

### 4. 加 DNS 记录

| 类型 | 名称 | 目标 | 代理状态 |
|---|---|---|---|
| CNAME | 子域前缀（如 `app`） | `<TUNNEL_ID>.cfargotunnel.com` | **必须开启（橙云）** |

开了代理才会签发 Cloudflare 的边缘证书。

### 5. 验证

```bash
curl -I https://app.example.com     # 期望 200
```

再在浏览器打开一次，确认证书有效（不是自签名警告）。

### 6. 服务端只监听内网

反向代理（Caddy / nginx）监听 `8090` 之类内网端口即可，**不要**再去路由器上开端口。

## 复用清单（新项目上线照着勾）

- [ ] 新子域只在 Cloudflare 加一条 CNAME，指向**同一个** Tunnel → 不用改隧道、不用重启 cloudflared
- [ ] `config.yml` 的 ingress 加一条 `hostname`，指向新容器端口
- [ ] 反向代理把 `/api/*` **同源**转发到后端 → 不新开子域，就没有 CORS、没有预检请求
- [ ] 静态资源与 API 同源 → 前端不需要配 baseURL，token 也好处理
- [ ] html / sw / manifest 发 `Cache-Control: no-cache`，图标长缓存（见 [README 的缓存章节](../README.md#三个值得一读的坑)）
- [ ] 国内访问走国际链路，速度一般但可用；**不要**把它用于需要备案的正式商业站点

## 踩过的坑

**Cloudflare 会用 UA 拦脚本请求**
Python `urllib` 默认 UA 打自己的接口返回 403，换 `curl` 正常，一度误判为服务端 bug。
→ 脚本里显式设一个正常 UA；连通性验证优先用 `curl`。

**Cloudflare 会按后缀缓存 `.js`**
`sw.js` 被缓存 4 小时，导致前端更新不生效，进而触发 PWA 双层缓存自锁。
→ 注册地址带版本号 `sw.js?v=N`，绕开 CDN 缓存。

**改了隧道配置必须重启 cloudflared 容器**
重启后旧连接会有几秒中断。
→ 尽量一次性把 ingress 写好，别频繁改。

**不要用「重装 Tunnel」来解决问题**
换 Tunnel 就等于换一套凭证和 CNAME 目标，DNS 要一起动，风险远大于收益。

**容器内的 `127.0.0.1` 是容器自己**
ingress 指向宿主机服务要用 `host.docker.internal` 或宿主内网 IP。

**NAS 上传的文件权限可能是 0770**
容器内的非 root 进程读不到，反代一律 403，而配置看起来完全正确。
→ 优先用 root 启动的 Caddy；**先确认文件权限，再怀疑配置**。


## 自托管环境（NAS / 家用服务器）的注意事项

把 NAS 当个人 PaaS 用：常开、低功耗、数据在自己硬盘上，配合 Tunnel 就能对外提供 HTTPS 服务。

**目录约定**（一个项目一个目录）

```
/volume1/docker/<项目名>/
├─ html/              静态文件
├─ <服务名>/          后端代码
├─ data/              持久化（务必挂到宿主机，容器删了数据还在）
├─ Caddyfile
└─ docker-compose.yaml
```

**几条硬习惯**

- `restart: unless-stopped`，保证机器重启后服务自己起来
- 容器只监听内网端口，对外由 Tunnel 暴露
- 改宿主机上被挂载的代码后必须 `docker restart <容器>`，容器的进程不会自动感知
- 每次改数据文件前先备份，服务端自带写入前快照（见 [sync.md](sync.md)）
- 部署完必做健康检查：`curl /api/health` + 一次真实登录
- 排查线上问题优先看容器日志，比猜快得多

**容器网络的坑**
容器内的 `127.0.0.1` 是容器自己。指向宿主机服务要用 `host.docker.internal` 或宿主内网 IP。

## 这套链路真正省下的是什么

不是时间，是**每次都不用重新做安全决策**：要不要开端口、证书怎么弄、地址会不会变。新项目上线只需要「加一条 CNAME + 加一条 ingress」，边际成本趋近于零。
