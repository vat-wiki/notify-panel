# notify-panel

> **AI agent 的通知收件箱。** 任何外部系统——CI、cron、webhook、监控、后台任务——把「发生了什么」推到这里,AI agent 查收并据此行动。
>
> 它填补了 agent 与外部世界之间的缺口:agent 没有「被动收到事件」的能力。notify-panel 让 CI 失败、定时备份完成、监控告警这些事,能像「新邮件到达」一样被 agent 主动消费。

## 它解决什么问题

AI coding agent 越来越强,但它本质是**被动**的——你问它才答。外部世界发生了什么(CI 挂了、备份跑完了、磁盘快满了、webhook 触发了),agent 默认**根本不知道**。

notify-panel 把这些事件汇到一个地方,让 agent 能:

- **查收件箱**:「有没有新通知?」「CI 失败了吗?」「有告警吗?」
- **据此行动**:看到 CI 失败 → 去查日志修复;看到磁盘满 → 去清理;看到备份失败 → 去排查
- **被事件驱动**:配合 pi 扩展,新通知会**主动投递**给 agent,触发它处理(不用人去催)

```
   CI / cron / 监控 / 后台任务 / webhook / 外部系统
              │ push 通知(往里投)
              ▼
        ┌──────────────┐
        │ notify-panel │  ← AI agent 查这里
        │   daemon     │     list / read → 行动
        └──────────────┘
              ▲
              │ query / consume
           AI agent
```

同时它也是一台机器上的**统一通知中心**:本机任何进程(shell 脚本、Python 服务、TS 应用)都能用一行命令或一个 HTTP 请求把通知投进来,不用每个工具自己造一套通知机制。

## 能做什么

| 能力 | 说明 |
|------|------|
| ✅ **agent 的事件总线** | 任何系统推事件进来,agent 查收 → 判断 → 行动 |
| ✅ **主动投递给 agent** | [pi 扩展](./extensions/pi/) 自动把未读通知投给 agent,触发处理 |
| ✅ **agent skill 一键装** | `notify-panel skill install` 让 agent 学会主动查收件箱 |
| ✅ 全局安装,一个命令 | `npm install -g` 装一次,本机所有进程可用 |
| ✅ 后台常驻 + 开机自启 | systemd/launchd 服务自动生成并启用,崩溃重启 |
| ✅ 持久化存储 | 自动落盘,daemon 重启不丢数据 |
| ✅ 跨语言对接 | CLI / TS SDK / 裸 HTTP(curl/Python/Go/bash 任选) |
| ✅ 自动发现 | 端口不固定,本机客户端零配置找到 daemon |
| 🚧 实时推送 | WebSocket 事件流(规划中) |
| 🚧 Web UI | 可视化面板(规划中,核心场景是 agent 消费,UI 是辅助) |

## 快速开始

```bash
# 1. 全局安装(本机装一次)
npm install -g notify-panel
# 或:curl -fsSL https://raw.githubusercontent.com/vat-wiki/notify-panel/main/install.sh | sh

# 2. 启动后台 daemon + 设为开机自启
notify-panel install   # 一步到位:生成服务文件 + 自动启用 + 立即启动

# 3. 任何东西都能往里投
notify-panel push ci build "#1234 失败" --severity error
notify-panel push backup db "每日备份完成" --severity success

# 4. 让 agent 接管(二选一)
#    a) 装 skill —— 让当前 AI 助手学会查收件箱
notify-panel skill install
#    b) 装 pi 扩展 —— 新通知自动投递给 agent 处理(见下方)
```

## 三种对接方式(把通知投进来)

不管你用什么语言,总能把通知推给同一个 daemon:

### 方式 A:命令行(CLI)—— shell / cron / CI 首选

```bash
notify-panel push ci build "#1234 构建失败" --severity error
notify-panel push wechat 张三 "在吗?"
```

### 方式 B:TypeScript/JavaScript SDK —— 类型安全

```ts
import { NotifyClient } from 'notify-panel/sdk';
const client = new NotifyClient();  // 零配置,自动找到 daemon
await client.push({ source: 'app', title: '导出完成', message: 'report.xlsx' });
```

### 方式 C:裸 HTTP —— Python / Go / curl

```bash
curl -X POST http://$(notify-panel url)/v1/notify \
  -H "Content-Type: application/json" \
  -d '{"source":"ci","title":"build","message":"done","severity":"success"}'
```

```python
import os, requests
url = os.environ.get("NOTIFY_PANEL_URL", "http://localhost:8787")
requests.post(f"{url}/v1/notify",
    json={"source":"python","title":"ETL","message":"完成"})
```

> **别写死端口。** daemon 端口冲突时会自动换,真实地址用 `notify-panel url` 动态拿,或读环境变量 `$NOTIFY_PANEL_URL` / 端口文件 `~/.notify-panel/server.json`。
>
> **密钥按需。** 默认只监听本机(`127.0.0.1`),免密钥;仅当暴露到网络(`--host 0.0.0.0`)或设了 `--secret` 时才需要 `X-Notify-Secret` 头。
>
> 三种方式推到同一个 daemon,**完全等价**。

## 让 AI agent 接管消费

这是 notify-panel 区别于普通通知工具的核心。两层能力,按需选:

### Skill:让 agent 学会查收件箱

装一个 skill 文件,agent 就知道「有 notify-panel 这个收件箱可以查」。用户说「看看有没有新通知 / CI 失败了吗 / 有告警吗」,agent 会主动调 `notify-panel list` 去查、看到 error 就去处理。

```bash
notify-panel skill install              # 默认装到 ~/.pi/agent/skills/
notify-panel skill install /path/to/skills  # 自定义目录
```

> 当前 skill 格式面向 [pi](https://github.com/earendil-works/pi-coding-agent);其它 agent(Claude Desktop / Cursor 等)可手动复制 `skill/` 下的 markdown 并按各自格式适配。

### pi 扩展:让 agent 被事件驱动

[pi 扩展](./extensions/pi/)更进一步——它每 N 秒轮询收件箱,有未读通知就**主动投递**给 agent,触发 agent 处理。配合 `--no-notify-panel` 可临时禁用,`/notify-panel pause` 可暂停。

```bash
pi install git:github.com/vat-wiki/notify-panel
# 或开发模式:pi -e ./extensions/pi/src/notify-panel.ts
```

典型闭环:CI 失败 → 推送到 notify-panel → pi 扩展轮询到 → 投递给 agent → agent 自动去查 CI 日志、修复、推回结果。**全程无需人介入。**

## 文档

| 你想做什么 | 看这里 |
|------------|--------|
| 5 分钟跑起来 | [快速上手 →](./packages/notify-panel/docs/getting-started.md) |
| 查 CLI 全部命令 | [CLI 命令参考 →](./packages/notify-panel/docs/cli-reference.md) |
| 抄 CI / cron / Python / Docker 配方 | [场景配方 →](./packages/notify-panel/docs/cookbook.md) |
| 理解整体架构、为什么这么设计 | [架构设计 →](./packages/notify-panel/docs/architecture.md) |
| 跨语言对接、自己做 daemon | [协议规范(JSON Schema)→](./packages/notify-panel/schemas/) |
| 看 API 详细签名 | 源码 JSDoc(`packages/notify-panel/src/` 下) |
| 让 agent 自动消费通知 | [pi 扩展 →](./extensions/pi/) |
| 怎么发版(给维护者) | [发版流程 →](./docs/release.md) |

## 仓库结构

monorepo(npm workspaces)。主包是发 npm 的单一包;`extensions/` 是与主包独立分发的 agent 集成。

```
packages/
└── notify-panel/          主包(发 npm)
    └── src/
        ├── protocol/  开放协议(零依赖):类型 + JSON Schema + 校验 + 发现
        ├── core/      面板引擎:存储 + 事件 + 查询
        ├── server/    daemon 服务端:把 core 暴露成 HTTP 端点
        ├── sdk/       TS 集成方 SDK:推通知的类型安全客户端
        └── cli/       命令行:daemon 管理 + 通用客户端
extensions/
└── pi/                    pi 扩展(npm 包 notify-panel-pi,走 pi install 分发)
```

依赖方向:`cli`/`server` → `core` → `protocol`;`sdk`/`cli` 客户端 → `protocol`。客户端永远不碰 `core`,只通过 HTTP 跟 daemon 说话。

**发布分工:** 所有包都走[版本号驱动的自动发版](./docs/release.md)—— 改 `package.json` 的 version、push,CI 自动发 npm + 打 tag + 建 Release。

## 从源码构建

```bash
git clone https://github.com/vat-wiki/notify-panel.git
cd notify-panel
npm install           # 安装全部 workspace 依赖
npm run build         # 构建全部 workspace
npm test              # 跑全部用例(161 个)
```

测试基于 [Vitest](https://vitest.dev),跨 workspace 扫描 `packages/**/test`,直接打源码不依赖 build 产物。

## 安装要求

- **Node.js 18+**(用到了原生 `fetch`)
- 全局命令背后是唯一的系统级 daemon,本机所有进程通过 HTTP 跟它交互

## 状态与路线图

**当前:** 核心功能完整 —— daemon + CLI + SDK + 协议 + 自动发现 + 持久化 + agent skill + pi 扩展,端到端验证通过,已发布到 npm。

**路线图:**
- [ ] WebSocket `/v1/stream`(实时事件推送,替代轮询)
- [ ] Web UI 面板(可视化查看,辅助 agent 消费)
- [ ] 配置文件 `~/.notify-panel/config.json`
- [ ] 多 agent 集成(Cursor / Claude Desktop / 自定义 agent 的 skill / 扩展)
- [ ] 多实例隔离(按 source 分命名空间)

## 许可证

MIT
