# 架构设计

讲清楚 notify-panel 为什么这么设计。如果你只想用,跳过这篇看 [快速上手](./getting-started.md) 即可。

## 核心理念:daemon 是宇宙中心

notify-panel 的本质是一个**常驻后台的通知中心进程(daemon)**。所有东西都是它的客户端。

```
                    notify-panel daemon(常驻进程)
                    ┌─────────────────────────┐
                    │  存储 + 查询 + 状态管理  │
                    │  HTTP 端点 /v1/*         │
                    └────────────▲────────────┘
                                 │ 统一的 HTTP 协议(v1)
                ┌────────────────┼────────────────┐
                │                │                │
           CLI 命令          TS SDK           裸 HTTP
        (shell/cron/CI)   (Node/前端)    (Python/Go/curl)
```

**关键设计决策:**

1. **daemon 持有一切状态** —— 存储、查询、状态管理都在 daemon 里。客户端是无状态的,只发请求。
2. **客户端通过 HTTP 协议通信** —— 不是函数调用,不是 IPC,是 HTTP。这让任何语言、任何进程、任何机器都能对接。
3. **三种客户端等价** —— CLI / SDK / 裸 HTTP 推同一个 daemon,行为完全一致。选哪个只看你的场景便利。

### 为什么不让客户端直接调 core?

我们有一个 `core` 模块(`src/core/`),里面有 `NotifyPanel` 类、存储、事件。为什么不让所有客户端直接 import 它?

因为那样会变成**进程内库**,只能跟自己对话:
- ❌ Python 脚本没法 import TS 库
- ❌ 两个 Node 服务想共享通知,得各自存一份,数据割裂
- ❌ cron job、shell 脚本被排除在外

daemon + HTTP 的模式把"存储"和"使用"解耦:**daemon 是唯一数据源**,所有客户端都来问它。

## 包结构与依赖

```
packages/
├── protocol/  开放协议(地基,零依赖)
├── core/      面板引擎:存储 + 事件 + 查询
├── server/    daemon 服务端:core 的 HTTP 外壳
├── sdk/       HTTP API 的完整封装(纯客户端)
└── cli/       命令行:daemon 管理 + 基于 sdk 的客户端命令
```

### 严格分层规则(这个项目里是铁律)

**两边各成一条链,中间靠 HTTP 连接,不跨层:**

```
  【服务端链】                  【客户端链】
  protocol ◀── core ◀── server   protocol ◀── sdk ◀── cli
                       │                          │
                       └──── HTTP 协议 ───────────┘
```

核心原则:

1. **sdk = HTTP API 的完整封装**。server 暴露的全部端点,push/list/get/markRead/markAllRead/archive/remove/clear/ping/shutdown,sdk 都要有对应方法。**不能有端点只存在于 server 而 sdk 没封装**(那样 cli 只能绕过 sdk 自己 fetch,分层就乱了)。

2. **cli 的客户端命令全部基于 sdk**。push/list/read/archive/clear/stop 这些命令,**不允许直接 `fetch`**,必须调 `NotifyClient` 的方法。这样:
   - 复用 sdk 的自动发现 / 鉴权 / 错误处理逻辑
   - sdk 一处修复,cli 跟着好
   - 客户端逻辑只有一份实现

3. **cli 不依赖 core**。cli 的职责是「起 daemon(用 server)+ 当客户端(用 sdk)」,都不该直接碰引擎。core 只属于「服务端链」。

4. **客户端链不依赖服务端链**。sdk 和 cli 的客户端部分都不 import core/server —— 它们只通过 HTTP 跟 daemon 说话。这让 sdk 能独立分发给纯集成方。

> cli 里确实有 `start`/`restart` 命令依赖 server —— 但那是「**启动 daemon**」职责,属于服务端链,合理。客户端命令(push/list/...)严格走 sdk。

- `protocol` 是地基,零运行时依赖
- `core` 只依赖 `protocol`
- `server` 依赖 `core` + `protocol`(给引擎加 HTTP 外壳)
- `sdk` 只依赖 `protocol`(纯 HTTP 客户端,封装全部 API)
- `cli` 依赖 `server`(启动 daemon)+ `sdk`(客户端命令)+ `protocol`,**不依赖 core**

### 为什么要分这么多包?

每个包对应一个**角色**,角色清楚就不会装错东西:

| 角色 | 该装什么 | 不该装什么 |
|------|---------|-----------|
| 做 daemon / 做 UI | `core` + `server` | — |
| 推通知的第三方(TS) | `sdk` | `core`/`server`(那是面板方的) |
| 跨语言对接 | 啥都不装,看协议文档 | 任何 npm 包 |
| 要类型/校验 | `protocol` | 实现代码 |

## 协议层（`src/protocol/`）

这是整个体系的**地基**。它定义:

1. **数据结构** —— `NotifyPayload`(推送载荷)、`Notification`(完整通知)、`PanelEvent`(事件)
2. **校验器** —— `validateNotifyPayload`,零依赖,几百字节
3. **JSON Schema** —— `schemas/*.json`,给 Go/Python/Java 校验用
4. **传输协议常量** —— HTTP 路径、事件名、media-type
5. **服务发现读取** —— 集成方怎么找到 daemon

**为什么协议要独立成一个模块？**

因为"什么是合法通知"这份定义**只能有一份**。如果 daemon 和客户端各自定义，迟早对不上。协议层零依赖、纯类型 + 校验器，daemon 实现、TS SDK、跨语言对接方都引用同一份定义，接口就统一了。协议版本锁在 `v1`（见 `ServerInfo.protocol`），跟包的 npm 版本号解耦。

详见 [协议 JSON Schema](../schemas/)。

## 服务发现机制

daemon 端口不固定(可能冲突、可能开多实例),客户端怎么找到它?三层优先级:

```
客户端连接前,按此顺序找 daemon 地址:

1. 环境变量 NOTIFY_PANEL_URL      ← 显式覆盖(测试/远程)
2. 端口文件 ~/.notify-panel/server.json  ← 自动发现(主力)
3. 默认 http://127.0.0.1:8787     ← 兜底,保证开箱即用
```

**端口文件(`server.json`)是关键:** daemon 启动时把自己的真实地址 + pid + secret 写进去,客户端读它。端口怎么变都能被发现。文件权限 0600(含 secret)。

**为什么不用固定端口?**

- 固定端口被占就启动不了
- 没法开多个实例(工作 / 测试)
- 客户端写死端口,daemon 换地方就得改代码

**为什么不用单纯的环境变量?**

引导死循环:要知道 daemon 在哪才能设环境变量,可环境变量是用来告诉别人 daemon 在哪的。

**端口文件是「路径固定、内容动态」** —— Docker 的 `/var/run/docker.sock`、VSCode server 都是这套路。

## 数据存储

存储分两层:**内存**(运行时查询用)+ **文件**(持久化用)。

### 内存层
`core` 用 `Map` 存所有通知,查询过滤都在内存做(快)。默认 500 条上限,超过淘汰最老的。

### 持久化层(默认启用)
任何变更都会防抖落盘到 `~/.notify-panel/store.json`,daemon 重启后自动恢复。

**为什么用单 JSON 文件?** 通知面板数据量小(几百 KB 级),单文件绰绰有余,且零原生依赖——这对「系统级软件」很重要(SQLite 的原生模块跨平台/跨 Node 版本要编译,是大坑)。

**两个可靠性保证:**
1. **原子写**:先写 `.tmp` 临时文件,写完再 `rename`。rename 在同文件系统是原子的,杜绝「写一半崩溃」损坏文件
2. **防抖批量写**:save 后攒 300ms 合并成一次落盘。避免高频写压 IO,崩溃最多丢这几百毫秒的数据(对通知场景可接受)

**损坏恢复**:若文件损坏(罕见),daemon 启动时跳过它当空数据处理,不会起不来。

### 存储可插拔
`core` 定义了 `NotificationStorage` 接口,内置 `FileStorage`。想换实现(Redis / IndexedDB / 云存储)实现这个接口即可,API 不变。daemon 启动时可注入自定义 storage。

## 事件系统

core 有完整的事件系统,任何状态变化都会广播:

```ts
panel.on('notification', (n) => ...);   // 新通知
panel.on('read', ({id, read}) => ...);  // 已读变化
panel.on('removed', ({id}) => ...);     // 删除
// 还有:notifications / archived / cleared / allRead
```

还有协议层统一的 `event` 事件,载荷是 `PanelEvent` 联合类型 —— 这个是为 WebSocket 实时推送准备的(把 core 事件通过 WS 转发给 UI)。当前 daemon 没开 WS,但在协议层已预留好格式。

🚧 **WebSocket `/v1/stream`** 在路线图:daemon 通过它实时把 `PanelEvent` 推给订阅方(主要是 UI)。

## 安全模型

默认配置走「本机信任」模型:daemon 只监听 `127.0.0.1`,本机进程可直接连,**无需密钥**。零配置即可用。

需要访问控制时,**按需开启**:
- **共享密钥(`--secret`)** —— daemon 启动时设,客户端推送要带 `X-Notify-Secret` 头。适合多用户机器,或防止其它进程误推。
- **监听地址** —— 默认只听 `127.0.0.1`,外部访问不了。暴露到网络需显式 `--host 0.0.0.0`,**此时务必设 `--secret`**(明文 HTTP,建议再套 TLS)。
- **端口文件权限** —— 含 secret(若设),默认 0600,只有文件所有者能读。

当前**没有**:
- TLS(内网够用,公网建议套 nginx)
- 细粒度权限(任何有 secret 的人能推任何 source)
- 防重放、限流

这些适合 v1 之后按需加。

## 版本演进策略

- HTTP 路径前缀 `/v1/` 即版本号
- Media-Type `application/vnd.notify-panel.v1+json`
- 不兼容变更走 `/v2/`,**v1 永久保证可用**
- 这样老客户端不会被新 daemon 打断

## 设计取舍记录

| 决策 | 选择 | 为什么 |
|------|------|--------|
| daemon vs 库 | daemon | 跨语言、跨进程、数据统一 |
| 通信 vs 函数调用 | HTTP | 任何东西都能对接 |
| 客户端如何找 daemon | 端口文件 + 环境变量 + 默认值 | 端口可变且零配置发现 |
| 存储 | 单 JSON 文件 + 内存 | 数据量小(KB级)单文件够用;零原生依赖是系统级软件必需 |
| 校验 | 零依赖手写 | 协议包要保持极小,集成方才愿意装 |
| 多个客户端 | CLI + SDK + 裸 HTTP | 不同场景用不同工具,本质都是协议客户端 |
