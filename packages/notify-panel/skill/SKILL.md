---
name: notify-panel
description: >
  作为 agent 的通知收件箱/事件总线:查询任何软件(CI、cron、webhook、后台任务、监控、外部系统)
  推来的通知,据此决定后续行动。当用户说「看看有没有新通知」「检查构建/任务状态」「CI 失败了吗」
  「有没有告警」,或你派出后台任务后需查收结果时使用。也用于管理本机通知 daemon、发送通知、
  标记已读/归档。核心是「查收件箱 → 行动」,不是给人看弹窗。
allowed-tools: Bash(notify-panel:*) Bash(curl:*)
---

# notify-panel — agent 的通知收件箱

notify-panel 是这台机器上的**常驻通知基础设施**:任何软件(CI 构建、cron 定时任务、webhook、
你派出去的后台任务、监控告警、外部系统)都把「发生了什么」推到这一个地方,统一存储。
**你(agent)是消费者**:查询这里来发现事件、判断状态、决定下一步行动。

```
   CI / cron / 监控 / 后台任务 / webhook / 外部系统
              │ push 通知(往里投)
              ▼
        ┌──────────────┐
        │ notify-panel │  ← 你(agent)查这里
        │   daemon     │     list / read → 行动
        └──────────────┘
              ▲
              │ query / consume
              你(agent)
```

## 何时用这个 skill

- **用户问「有什么新消息/通知吗」** → `notify-panel list --unread`
- **检查某任务结果**(你之前派出后台任务 / CI / 长任务)→ 按来源查
- **判断是否该行动**(构建失败→修、磁盘满→清、服务挂→重启)→ 按级别查 error
- **发送通知**(把你执行的结果/告警投进去,供后续查)→ `push`
- **管理 daemon 本身**(起停、排错)→ 见 daemon-management

## 前置:确保 daemon 在跑

```bash
notify-panel status
# 🟢 运行中 → 直接查
# 🔴 未运行 → notify-panel start
```

没装 `notify-panel` 命令?见 [安装](#安装)。

## 核心工作流:查收件箱 → 行动

```bash
# 1. 看有没有新东西(未读)
notify-panel list --unread

# 2. 只看需要立刻处理的(error / warning)
notify-panel list --severity error
notify-panel list --severity warning

# 3. 按来源查(你关心的特定系统)
notify-panel list --source ci          # CI 结果
notify-panel list --source backup      # 备份任务
notify-panel list --source monitor     # 监控告警

# 4. 处理完标记已读(避免重复处理)
notify-panel read <id>                 # 单条
notify-panel read --all                # 全部

# 5. 暂不处理但想藏起来 → 归档
notify-panel archive <id>
```

**输出解读:**
```
• [error  ] build  (ci)  id=n_xxx        # • = 未读,[error] = 级别,(ci) = 来源
    #1234 失败:测试未通过                  # 这条值得立刻行动
  [success] backup  (backup) id=n_yyy     # (空格)= 已读,已处理过
    完成于 03:00
```

## 通知来源与级别语义

| 来源(source) | 典型推送者 | 你该怎么响应 |
|---------------|-----------|-------------|
| `ci` | CI/CD 系统 | 失败→查日志修复,成功→告知用户 |
| `backup` | 备份脚本/cron | 失败→排查,成功→通常无需动作 |
| `monitor` | 监控(磁盘/CPU/服务) | error→立刻处理(清空间/重启) |
| `webhook` | 外部系统回调 | 按业务判断 |
| `agent`/`task` | 你或其它 agent 派的后台任务 | 查收任务结果,继续后续 |
| 自定义 | 任何推通知的东西 | — |

级别:`info`(信息)| `success`(成功)| `warning`(注意)| `error`(需处理)

## 主动推送(往收件箱投通知)

你执行任务后也可把结果投进去(供后续查、或通知用户):

```bash
notify-panel push <source> <title> [message] [--severity <level>]

# 例:你修完 bug,投一条记录
notify-panel push agent 修复 "issue #123 已处理" --severity success
```

## 命令速查

### 查询(最常用)
```bash
notify-panel list [--source <s>] [--severity <s>] [--keyword <k>] [--unread]
notify-panel read <id> [--unread] | --all       # 标记已读/未读
notify-panel archive <id> [--unarchive]
notify-panel clear
```

### 发送
```bash
notify-panel push <source> <title> [message] [--severity <s>]
```

### 管理 daemon
```bash
notify-panel start [--foreground]                # 启动(默认后台)
notify-panel status                              # 是否在跑(退出码 0/1)
notify-panel stop / restart
notify-panel logs [-f] [n]                       # 日志
notify-panel url [--json]                        # 真实地址(端口会变)
```

任何命令 `-h` 看帮助。

## 关键概念

- **端口会变**:daemon 端口冲突自动换(默认 8787)。裸 HTTP 别写死,用 `notify-panel url` 动态拿。
- **自动发现**:查询/推送命令零配置找到 daemon(读端口文件 `~/.notify-panel/server.json`)。
- **密钥按需**:默认监听 `127.0.0.1`,本机免密钥。仅暴露网络(`--host 0.0.0.0`)才需 `--secret`。
- **持久化**:通知自动落盘,daemon 重启不丢。

## 安装

```bash
npm install -g notify-panel
# 或脚本:curl -fsSL <repo-url>/install.sh | sh
```

需要 Node.js 18+。

---

## 详细参考

按需查阅:

- **[典型场景与响应策略](references/scenarios.md)** — 各来源通知该怎么响应、查收后台任务结果、监控告警处理
- **[daemon 管理与排错](references/daemon-management.md)** — 启停、开机自启、日志、端口/密钥、跨机、常见问题
- **[命令完整参考](references/command-reference.md)** — 每个命令的全部选项、参数、退出码
- **[HTTP API(让外部系统推送)](references/http-api.md)** — 端点、字段、curl/Python/Go 示例,用于配置 webhook/CI 推送
