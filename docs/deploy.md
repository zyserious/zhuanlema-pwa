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
- [ ] 容器 `restart: always` + 依赖装进挂载目录 + healthcheck + 日志轮转（见[下文](#让服务在宿主机重启后自己回来)）
- [ ] **做过一次真实重启测试**，记下恢复用时
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

- `restart: always`（不是 `unless-stopped`），保证机器重启后服务自己起来
- 容器只监听内网端口，对外由 Tunnel 暴露
- 改宿主机上被挂载的代码后必须 `docker restart <容器>`，容器的进程不会自动感知
- 每次改数据文件前先备份，服务端自带写入前快照（见 [sync.md](sync.md)）
- 部署完必做健康检查：`curl /api/health` + 一次真实登录
- 排查线上问题优先看容器日志，比猜快得多
- 每个容器都配日志轮转，否则跑几个月把磁盘写满

**容器网络的坑**
容器内的 `127.0.0.1` 是容器自己。指向宿主机服务要用 `host.docker.internal` 或宿主内网 IP。

## 让服务在宿主机重启后自己回来

家用服务器会不定时重启（系统更新、断电、手动重启）。要让服务自己回来，需要同时满足四件事——少了任何一件，重启后都是打不开的。

### 1. Docker 守护进程本身要开机自启

这是最容易漏的一层，而且它在 Docker 外面。多数 NAS 系统在应用中心里有个「开机自启」开关；群晖/威联通/Linux 上是 `systemctl enable docker`。

**自检**：重启一次，`docker ps` 有输出就说明 Docker 起来了。

### 2. 容器要有重启策略

| 策略 | 行为 | 用在哪 |
|---|---|---|
| `no`（默认） | 不自动重启 | 一次性任务 |
| `on-failure` | 非零退出才重启 | 批处理 |
| `unless-stopped` | 自动重启，但手动 `stop` 过就不再起 | 一般服务 |
| `always` | **无条件重启**，宿主机重启后一定拉起 | 常驻服务 |

个人服务建议 `always`：你想的是「它必须一直活着」，而不是「我上次是不是手动停过」。

### 3. 启动过程不能依赖外部网络

这是最隐蔽的坑。很多人把依赖安装写在启动命令里：

```yaml
command: sh -c "pip install pywebpush && python app.py"
```

宿主机刚重启时网络往往还没就绪，`pip install` 失败 → 进程退出 → 容器重启 → 再失败，可能循环几分钟甚至更久。

**解决：把依赖装进挂载目录，让它只在第一次联网。**

```yaml
environment:
  - PYTHONPATH=/pylibs        # 依赖从这里加载
volumes:
  - ./pylibs:/pylibs          # 挂在宿主机，重建容器也不丢
command: >
  sh -c "for i in 1 2 3 4 5 6; do
           python -c 'import pywebpush' 2>/dev/null && break;
           pip install --no-cache-dir -q --target=/pylibs pywebpush 2>/dev/null && break;
           echo \"[boot] 等待网络，第 \$i 次重试\"; sleep 8;
         done; exec python /app/server.py"
```

效果：首次装完以后，重启只需要几秒，且**完全不需要网络**。

实测对比：改造前容器重启要等 `pip` 拉包（几十秒且依赖网络），改造后 **4 秒**恢复。

### 4. 要有能判断「真的活着」的探针

容器 `RUNNING` 不等于服务可用——进程可能卡死、线程池耗尽、磁盘写满。

```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 180s      # 首次启动要装依赖，给足时间
```

注意两件事：

- **alpine 镜像里没有 curl**，用 `python -c` 或 `wget --spider`
- **`healthcheck` 自己不会重启容器**，它只标记 `unhealthy`。要自动重启，得再配一个 [`autoheal`](https://github.com/willfarrell/docker-autoheal) 之类的看门狗

### 部署完必须做一次真实重启测试

配置写完不等于能自启。**手动重启一次容器，计时看多久恢复**：

```bash
docker restart <容器名>
# 然后每 2 秒 curl 一次健康接口，记下恢复用时
```

如果恢复要几十秒、或者日志里出现 `pip install`，说明还在联网装依赖，第 3 条没做到位。

### 排查顺序（重启后打不开）

1. `docker ps` 有没有这个容器 → 没有，是 Docker 自己没起来（第 1 条）
2. 容器在但 `EXITED`/`RESTARTING` → `docker logs` 看退出原因（多半是第 3 条）
3. 容器 RUNNING 但访问 502 → 反向代理找不到后端，检查容器名/端口，`docker restart` 反代容器
4. 完全访问不到（不是 502，是超时）→ 隧道容器死了，`docker ps` 看 cloudflared
5. 都正常但只有页面不对 → 缓存问题，见 [caching.md](caching.md)

## 发布一个新版本

```bash
bash tests/run.sh            # 同步逻辑 6 场景
bash tests/version-check.sh   # 四处版本标记 + CHANGELOG 对齐
```

1. 四处版本标记同步递增（`v.json` / 页脚 / `sw.js?v=N` / `CACHE`）
2. [CHANGELOG.md](../CHANGELOG.md) 顶部新增一节，写「改了什么 + 为什么」
3. 提交：`feat:` / `fix:` / `docs:` / `chore:` 前缀，正文写原因
4. `git tag v<版本> && git push origin main --tags`
5. 部署后用**旧数据**回归：设置项原样、排班条数不变、已迁移数据不被二次改动

`version-check.sh` 存在的理由：四处版本标记漏改任何一处，用户就会停在旧版本而你以为已发布。让它在发布前报错，比事后排查「网页怎么没更新」便宜得多 —— 根因见 [caching.md](caching.md)。

## 这套链路真正省下的是什么

不是时间，是**每次都不用重新做安全决策**：要不要开端口、证书怎么弄、地址会不会变。新项目上线只需要「加一条 CNAME + 加一条 ingress」，边际成本趋近于零。
