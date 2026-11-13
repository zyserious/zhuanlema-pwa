# Web Push 推送

> 目标：不装 App、不发短信，让 iPhone 上的网页到点弹通知。

## 准入条件（不知道会白调一天）

- iOS **16.4+** 才支持 Web Push
- **只有「添加到主屏幕」的 PWA 才能订阅**，Safari 标签页里拿到的 subscription 是无效的
  - 这就是「苹果自带的浏览器显示浏览器不支持」的真实原因 —— 不是不支持，是**环境不对**
- 纯前端**无法**在应用关闭后定时唤醒 → **必须有服务端**
- 通知权限必须由用户手势触发（点按钮），不能在页面加载时自动请求

## 环境判断要准

最初只看 UA 里有没有 `Safari`，把 Mac 和部分 Android 也误判成 iPhone，提示全错。

正确做法是三个条件一起看：

| 判断项 | 作用 |
|---|---|
| `standalone` | 是否主屏运行 |
| `navigator.maxTouchPoints > 0` | 排除 Mac |
| `navigator.platform` / UA | 区分 iOS 与其他 |

判定出「iOS 但没加到主屏」时，提示必须是**可操作的**：
> 请先用 Safari 打开 → 分享 → 添加到主屏幕 → 再从主屏图标打开

而不是一句「浏览器不支持」。

## 最小实现链路

```
前端：pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID公钥 })
        │  POST subscription（endpoint + p256dh + auth）
        ▼
服务端：pywebpush 负责 VAPID（JWT 签名 ES256 + ECDH 加密载荷）
        │  定时扫描「谁下一个班次要开始了」
        ▼
Service Worker：addEventListener('push') → showNotification
                addEventListener('notificationclick') → 聚焦或打开对应页面
```

## 踩过的坑

**VAPID 私钥形态**
`pywebpush` 只接受 base64url 编码的 **32 字节原始私钥标量**，传 PEM 会抛 `deserialize error`。
更麻烦的是它抛的是 `ValueError` 而不是 `WebPushException`，最初写的 `except WebPushException` 兜底重试**完全没生效**。
→ 环境变量只传原始标量，服务端用 `cryptography` 重建 PEM；同时保留「两种候选都试一遍」的兜底。

**Cloudflare 拦 Python 默认 UA**
服务端调自己接口返回 403，`curl` 正常，曾误判为服务端 bug。见 [deploy.md](deploy.md)。

**怎么低成本验证加密链路是通的**
故意往一个不存在的 endpoint 发推送。如果报的是 **DNS 解析失败**，说明 JWT 签名、载荷加密、HTTPS 请求全部成功了，只是目标不存在 → **链路是对的**。
这个技巧比读文档快得多。

## 必须配一条降级路径

推送依赖 Apple/Google 的服务器、依赖权限、依赖用户手动开 → 一定会有人收不到。

降级方案：**导出 .ics 日历**

- 一键生成带 `VALARM` 的 `.ics`，iOS 打开直接弹「添加到日历」
- 不依赖推送服务，100% 会响
- 日历提醒是系统级的，比 Web Push 更可靠

原则：**任何依赖外部通道的功能，都要有不依赖它的兜底。**

## 生成 VAPID 密钥

```bash
npx web-push generate-vapid-keys
# 或
python -c "from cryptography.hazmat.primitives.asymmetric import ec; import base64; \
k=ec.generate_private_key(ec.SECP256R1()); \
print('PUBLIC', base64.urlsafe_b64encode(k.public_key().public_numbers().encode_point()).decode()); \
print('PRIVATE', base64.urlsafe_b64encode(k.private_numbers().private_value.to_bytes(32,'big')).decode())"
```

`PUBLIC` 是 65 字节非压缩公钥的 base64url；`PRIVATE` 是 32 字节原始标量的 base64url。
