# 今天赚了吗 · iOS 灵动岛版

一个几十行的原生壳 App，把 `/api/today` 的数据放到 **灵动岛 + 锁屏实时活动**上。

网页做不到这件事：灵动岛对应的「实时活动（Live Activity）」只对原生 App 开放，Safari 没有任何接口能碰。

---

## 它显示什么

**灵动岛（iPhone 14 Pro 及以上）**

- 紧凑态：左边班次图标，右边「还剩 1:13」——系统自己走，不耗电
- 展开态：已赚金额、进度条、剩余时间、今日目标

**锁屏（所有 iPhone）**

- 一张卡片：班次、金额、进度条、倒计时、「更新于 22:31」

**关键点：倒计时和进度条由系统驱动**（`Text(timerInterval:)` + `ProgressView(timerInterval:)`），
不需要 App 在后台跑，也不会被系统的更新频率限制卡住。
**金额是快照**——打开 App 或从后台切回来时刷新一次，所以灵动岛上的金额可能滞后几分钟，
但「还剩多久」永远是准的。

---

## 一次性准备（Mac 上）

### 0. 把代码拿到 Mac 上

```bash
git clone https://github.com/zyserious/zhuanlema-pwa.git
cd zhuanlema-pwa/ios
```

不想用 git 也行：在仓库页面点 `Code → Download ZIP`，解压后进 `ios/` 目录。

### 1. 装 Xcode

App Store 搜 Xcode，装完打开一次，同意协议。约 10 GB，慢慢下。

### 2. 装 XcodeGen

```bash
brew install xcodegen
```

没有 Homebrew 的话先装：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 3. 生成工程

```bash
cd ios
xcodegen generate
open Zhuanlema.xcodeproj
```

---

## 在 Xcode 里配置签名（两个 target 都要改）

免费 Apple ID 就够了，**不需要 $99 开发者账号**。

**a. App 本体**

1. 左侧点最上面的 `Zhuanlema`（蓝色项目图标）
2. 中间选 `TARGETS → Zhuanlema` → `Signing & Capabilities`
3. `Team` 选 `你的名字 (Personal Team)`
4. `Bundle Identifier` 改成 `com.你的拼音.zhuanlema`（例：`com.zy.zhuanlema`）

**b. 小组件**

1. `TARGETS → ZhuanlemaWidget` → `Signing & Capabilities`
2. 同样的 Team
3. Bundle Identifier 改成 `com.你的拼音.zhuanlema.widget`（必须和上面保持一致的前缀）

> Bundle ID 全 App Store 唯一，撞了会报 `Failed to register bundle identifier`，换个后缀再试。
> 免费账号每 7 天最多注册 10 个 App ID，别反复改。

---

## 装到手机

1. 数据线连 iPhone，手机上点「信任此电脑」
2. Xcode 顶部设备选择器选你的 iPhone
3. 点 ▶️（Run），等编译完自动装到手机
4. 首次运行会弹「不受信任的开发者」，去 **设置 → 通用 → VPN与设备管理 → 开发者 App → 信任**
5. 回到桌面打开 App

---

## App 里怎么用

1. 输入你的账号密码（就是网页那个），登录
2. 看到今日金额和剩余时间
3. 点 **「在灵动岛 / 锁屏上显示」**
4. 锁屏看效果；有灵动岛的机型，长按灵动岛看展开态

想撤掉就点「结束显示」。

---

## 7 天后过期怎么办

免费签名只有 7 天。到期后 App 点开闪退（图标还在）。

**续期**：手机连 Mac → Xcode 打开工程 → 再点一次 ▶️。约 1 分钟。

想省掉这个麻烦，只有 $99/年开发者账号（可以走 TestFlight，一次 90 天）。
代码不用改，只是签名方式不同。

---

## 排错

| 现象 | 原因 / 解法 |
|---|---|
| `Failed to register bundle identifier` | Bundle ID 被别人占了，换个后缀 |
| `Signing for "ZhuanlemaWidget" requires a development team` | 小组件 target 没选 Team，见上面 b 步 |
| 装完点开闪退 | 没信任开发者证书，去「VPN与设备管理」 |
| 灵动岛没反应 | 设置 → 今天赚了吗 → 实时活动，打开；确认机型是 14 Pro 及以上 |
| 只有锁屏卡片、没有灵动岛 | 机型不支持灵动岛，锁屏实时活动仍然可用 |
| 金额和网页对不上 | 正常，金额是快照；点 App 里的「刷新一下」 |
| 提示「现在没有进行中的班次」 | 今天休息或未排班，服务端不会给窗口 |

---

## 数据流

```
iPhone App ──GET /api/today──▶ xyt.zyserious.xyz
     │                              │
     │  { earned, window, perSec, status … }
     ▼
ActivityKit（本地）→ 灵动岛 / 锁屏
```

没有走 APNs 推送，所以**不需要 Push Notifications 权限**（免费账号也开不了），
全部在 App 内本地发起和更新。

---

## 文件结构

```
ios/
├── project.yml                     XcodeGen 工程描述（改了 sources 要重新 generate）
├── Shared/
│   └── ShiftActivityAttributes.swift   App 与小组件共用的数据契约
├── Zhuanlema/
│   ├── ZhuanlemaApp.swift          入口
│   ├── ContentView.swift           登录 + 今日卡 + 灵动岛开关
│   ├── API.swift                   登录 / 今日数据 / Keychain
│   └── LiveActivityManager.swift   实时活动的启动、更新、结束
└── ZhuanlemaWidget/
    └── ShiftLiveActivity.swift     灵动岛与锁屏的 UI
```

`Shared/` 下的文件被两个 target 同时编译，改字段时两边会一起更新，不会不同步。
