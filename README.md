# notify-panel

> 一个**系统级**的通知中心。全局安装一次,后台常驻,这台机器上**所有进程**——shell 脚本、cron、CI、TS 应用、Python 服务——都跟它交互,把通知汇到一处。
>
> 它就像系统的一个「收件箱」:任何东西都能往里投,你统一看。

## 它是什么

你身边的通知来源太散:微信、CI 构建结果、定时备份、服务器告警……每个都在自己的角落响。

**notify-panel 是这台机器上的一个常驻后台进程(daemon)**,负责收下所有通知、统一存储、让你随时查、随时管。它不替你展示(那是 UI 的活),只做**接收 / 存储 / 查询 / 状态管理**。

```
   一台机器(系统)
   ┌─────────────────────────────────────┐
   │  npm install -g notify-panel  ←装一次│
   │         │                            │
   │  notify-panel start --daemon  ←常驻   │
   │         ▼                            │
   │  ┌─────────────────────┐             │
   │  │ notify-panel daemon │ 本机唯一实例 │
   │  └──────────▲──────────┘             │
   │             │ 同机交互                │
   │  ┌──────────┼──────────┬────────┐    │
   │  │          │          │        │    │
   │ CI脚本    cron任务   TS应用  Python   │
   │(CLI)     (CLI)     (SDK)  (HTTP)     │
   └─────────────────────────────────────┘
```

## 能做什么

| 能力 | 说明 |
|------|------|
| ✅ 全局安装,一个 `notify-panel` 命令 | `npm install -g` 装一次,任何目录可用 |
| ✅ 后台常驻 | `start` 默认后台运行,不占终端,日志写文件 |
| ✅ 开机自启 | `install` 生成 systemd / launchd 服务**并自动启用启动**,一步到位 + 崩溃重启 |
| ✅ 单实例保证 | 本机只有一个 daemon,重复 start 会提示 |
| ✅ 接收通知 | 单条、批量推送,带来源、级别、自定义数据 |
| ✅ 统一存储 | 内存存储(默认 500 条,可配),自动淘汰旧条目 |
| ✅ **持久化** | **自动落盘,daemon 重启不丢数据**(原子写 + 防抖) |
| ✅ 查询过滤 | 按来源 / 级别 / 未读 / 关键词 / 时间过滤 |
| ✅ AI 助手集成 | `notify-panel skill install` 一键装 pi skill,让 AI 自动用本工具发通知 |
| ✅ 状态管理 | 已读 / 未读、归档、删除、清空 |
| ✅ 自动发现 | daemon 端口不固定,本机所有客户端零配置找到它 |
| ✅ 跨语言 | 任何能发 HTTP 的东西都能对接(curl/Python/Go/bash) |
| 🚧 实时推送 | WebSocket 事件流(规划中) |
| 🚧 Web UI | 可视化面板(规划中) |

## 快速开始(系统级安装)

```bash
# 1. 全局安装(这台机器装一次)
#    方式一:npm
npm install -g notify-panel
#    方式二:脚本(自动检测 Node,处理权限问题)
curl -fsSL https://raw.githubusercontent.com/<owner>/notify-panel/main/install.sh | sh

# 2. 启动后台 daemon(立即试用)
notify-panel start
# → notify-panel daemon 已在后台启动 (pid 12345)

# 3. 设为开机自启(一步到位:生成服务 + 自动启用启动)
notify-panel install

# 4. 任何地方推通知
notify-panel push ci build "#1234 done" --severity success

# 5. 查看 / 管理
notify-panel list --unread
notify-panel status      # daemon 是否在跑
notify-panel logs        # 看日志
notify-panel url         # 拿真实地址(端口会变,裸 HTTP 用它拼)
notify-panel stop        # 停止
```

> 全局命令背后:daemon 是唯一的系统级实例,本机所有进程通过 HTTP 跟它交互。

## 三种对接方式(选最适合你的)

不管你用什么语言、在什么环境,总能找到一种方式把通知推过来:

### 方式 A:命令行(CLI)—— 最通用,零依赖

shell 脚本、cron job、CI pipeline 首选。装一个二进制,一行命令推通知。

```bash
# 先启动 daemon(后台常驻)
notify-panel start &

# 任何地方推通知
notify-panel push ci build "#1234 构建失败" --severity error
notify-panel push wechat 张三 "在吗?"
```

### 方式 B:TypeScript/JavaScript SDK —— 类型安全

TS/JS 项目里用,自动发现 daemon、本地校验、类型提示齐全。

```ts
import { NotifyClient } from 'notify-panel/sdk';
const client = new NotifyClient();  // 零配置,自动找到 daemon
await client.push({ source: 'app', title: '导出完成', message: 'report.xlsx' });
```

### 方式 C:裸 HTTP —— 跨语言

不想装任何东西?直接 POST JSON,Python / Go / Java / curl 都行。

> **别写死端口。** daemon 端口冲突时会自动换,真实地址请动态拿:
> 装了 CLI 用 `$(notify-panel url)`;没装就读环境变量 `$NOTIFY_PANEL_URL` 或端口文件 `~/.notify-panel/server.json`。
>
> **关于密钥:** daemon 默认只监听本机(`127.0.0.1`),无需密钥。仅当启动时设了 `--secret` 或暴露到网络(`--host 0.0.0.0`)时,下面的请求才需要带 `X-Notify-Secret` 头。

```bash
# shell:用 CLI 拿真实地址(推荐)
curl -X POST http://$(notify-panel url)/v1/notify \
  -H "Content-Type: application/json" \
  -d '{"source":"ci","title":"build","message":"done","severity":"success"}'
```

```python
# Python:优先读环境变量,没有则用默认端口
import os, requests
url = os.environ.get("NOTIFY_PANEL_URL", "http://localhost:8787")
requests.post(f"{url}/v1/notify",
    json={"source":"python","title":"ETL","message":"完成"})
```

> 三种方式推到同一个 daemon,**完全等价**。

## 我是哪种用户,该看哪份文档?

| 你的情况 | 看这里 |
|---------|--------|
| 第一次用,想 5 分钟跑起来 | [快速上手 →](./docs/getting-started.md) |
| 想知道 CLI 有哪些命令 | [CLI 命令参考 →](./docs/cli-reference.md) |
| 有具体场景(CI 通知、定时任务…),想抄配方 | [场景配方 →](./docs/cookbook.md) |
| 想理解整体架构、为什么这么设计 | [架构设计 →](./docs/architecture.md) |
| 要用别的语言对接,或自己做 daemon | [协议规范 →](./packages/notify-panel/src/protocol/README.md) |
| 想看 API 详细签名 | 源码里的 JSDoc 注释(`packages/notify-panel/src/` 下) |
| 在 pi(AI 助手)里自动消费通知 | [pi 扩展 →](./extensions/pi/) |

## 仓库结构(给开发者)

本仓库是 **monorepo**,用 npm workspaces 管理。主包 `notify-panel` 是单一 npm 包(protocol / core / server / sdk / cli 合并);`extensions/` 下是与主包独立分发的集成扩展。

```
packages/
└── notify-panel/          主包(发 npm)
    └── src/
        ├── protocol/  开放协议(地基,零依赖):类型 + JSON Schema + 校验 + 发现
        ├── core/      面板引擎:存储 + 事件 + 查询
        ├── server/    daemon 服务端:把 core 暴露成 HTTP 端点
        ├── sdk/       TS 集成方 SDK:推通知的类型安全客户端
        └── cli/       命令行:daemon 管理 + 通用客户端
extensions/
└── pi/                    pi 扩展(走 pi install 分发,不发布 npm)
```

依赖方向:`cli`/`server` → `core` → `protocol`;`sdk`/`cli` 客户端部分 → `protocol`。客户端永远不碰 `core`,只通过 HTTP 跟 daemon 说话。

发布分工:`packages/*` 走 changesets + npm 自动发布;`extensions/*` 各自独立(如 pi 扩展走 `pi install`),不纳入 npm 发版。

## 安装

**用户安装**(全局命令,任意目录可用):

```bash
# 方式一:npm
npm install -g notify-panel

# 方式二:脚本(检测 Node、处理权限、给出修复提示)
curl -fsSL https://raw.githubusercontent.com/<owner>/notify-panel/main/install.sh | sh
```

需要 Node.js 18+(用到了原生 fetch)。装完即可 `notify-panel start`。

## 从源码构建(开发者)

```bash
git clone <repo> && cd notify-panel
npm install
npm run build
```

这是 monorepo。在仓库根执行:

```bash
npm install           # 安装全部 workspace 依赖
npm run build         # 构建全部 workspace(主包用 tsc)
npm test              # 跑全部用例(161 个)
```

测试直接跑源码不依赖 build 产物:

```bash
npm run test:watch    # watch 模式
npm run test:coverage # 带覆盖率
```

用 [Vitest](https://vitest.dev),配置在根 `vitest.config.ts`。跨所有 workspace 扫描 `packages/**/test` 和 `extensions/**/test`,直接打各包**源码**,不依赖 build 产物,改代码立即生效。

测试按包分布:

| 包 | 测试重点 | 覆盖率 |
|----|---------|--------|
| protocol | 校验器、服务发现、端口文件、损坏恢复 | ~96% |
| core | push/查询/状态/事件/淘汰/持久化 | ~93% |
| server | 全部 HTTP 路由、鉴权、CORS、shutdown | ~93% |
| sdk | push/batch/ping/错误处理/发现 | — |
| cli | runner 路由、各命令端到端 | ~47% |

> cli 覆盖率偏低是预期:start/stop/install 等进程管理命令需真实 fork,难单元测;核心客户端命令(push/list/read/archive/clear)都有端到端用例,但命令选项分支无法全覆盖。

## 状态与路线图

**当前:** 核心功能完整 —— daemon + CLI + SDK + 协议 + 自动发现 + 持久化全部可用,端到端验证通过。

**已完成:**
- [x] 持久化存储(自动落盘 + 防抖批量写,daemon 重启不丢数据)
- [x] HTTP 层基于 Fastify、CLI 基于 Commander(降低自实现复杂度)

**路线图:**
- [ ] WebSocket `/v1/stream`(实时事件推送,给 UI 用)
- [ ] Web UI 面板
- [ ] 配置文件 `~/.notify-panel/config.json`(端口、保留条数、可选 secret 等)
- [ ] 多实例隔离(按 source 分命名空间)

## 许可证

MIT
# notify-panel
# notify-panel
