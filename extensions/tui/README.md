# notify-panel-tui

[notify-panel](../../) 的 **TUI 消费端**:把任意交互式 TUI agent(claude / codex / gemini-cli / 任何交互式 CLI)起在一个伪终端里,未读通知**自动当作"用户敲的字"注入**,让 agent 被外部事件唤醒。

它是 [extensions/pi](../pi/) 的孪生兄弟 —— 用同一套 notify-panel daemon,只是投递通道不同:

| | pi 扩展 | **tui 扩展(本包)** |
|---|---|---|
| 目标 | pi agent | 任意 TUI agent(claude/codex/gemini-cli/…) |
| 投递方式 | `pi.sendUserMessage()` | PTY 注入(`child.write()`) |
| idle 推断 | pi 内置 | 静默期启发式(目标静默 ≥ 1.5s → idle) |
| 通用性 | 绑定 pi | 对任意 TUI 通用,不依赖私有协议 |

> 代价:tui 扩展的 idle 判据是启发式(静默期),不是 100% 精确,但对绝大多数 TUI(spinner/流式输出型)成立。

## 快速开始

```bash
cd ~/projects/notify-panel
npm install                          # 首次(在 monorepo 里)

# 确保 notify-panel daemon 在跑(自动发现依赖它)
notify-panel status || notify-panel start

# 方式 1:monorepo 里直接跑(最快,免构建)
npm run dev --workspace notify-panel-tui -- claude
npm run dev --workspace notify-panel-tui -- codex

# 方式 2:全局链接后直接用
npm link --workspace notify-panel-tui
notify-panel-tui claude              # 任意目录都能用
```

启动时 stderr 会打印(不污染目标的 TUI 屏幕):

```
notify-panel-tui: control socket at ~/.notify-panel-tui/sock-12345
notify-panel-tui: watcher started (polling 5s · delivered 0)
```

从这一刻起,任何推进 notify-panel 的通知(CI、cron、webhook、`club listen`…)都会自动注入给 claude/codex,就像你亲手敲进去一样。

## 工作原理

```
                          ┌─ notify-panel-tui 进程 ──────────────────────┐
真实键盘 ──raw 透传──────▶│                                              │
                          │   PTY child(claude/codex/...)                │
                          │      ▲  │                                     │
                          │      │  │ child.onData ──▶ observeOutput     │
                          │      │  │                  (标记 busy)       │
                          │      │  ▼                                     │
                          │   QueuedInjector                            │
                          │      ▲  │ idle 判定(静默期 ≥ 1.5s)          │
                          │      │  ▼                                     │
notify-panel 未读 ───────▶│   TuiWatcher(用 NotifyClient SDK 轮询)     │
  (CI/cron/webhook 推来)  │      └─ enqueue ──▶ 排队(忙时不注入)      │
                          └──────────────────────────────────────────────┘
                                  │ 透传输出
                                  ▼
                              用户屏幕
```

**忙就不注入**的保证:目标干活时持续输出(spinner/流式文本)→ 持续被 `observeOutput` 标记 busy → 队列里的通知排队等;目标静默满 1.5s → 判 idle → 出队注入一条 → 进 2s 冷却 → 再判下一条。

## 命令

```bash
notify-panel-tui <cmd> [args...]              # 包装目标 + 自动起 watcher(默认)
notify-panel-tui ctl inject <pid> "<text>"    # 手动往一个会话注入文本(调试用)
notify-panel-tui ctl list                     # 列出活跃会话
notify-panel-tui -v | --version               # 打印版本号(取自 package.json)
```

## 已验证的链路

- ✅ 单元测试(14/14):QueuedInjector 状态机 + watcher 投递契约(注入成功才标记已读 / 注入失败回队 / archived 过滤 / daemon 不可达退避)
- ✅ 端到端验证:真实 codex 进程 → raw mode 修复 → idle 判定 → `\r` 提交生效 → codex 进入处理状态
- ✅ node-pty 时序陷阱已修复:text 与提交键分两次 write,中间留 80ms(见下)

## 关键技术点

### 1. raw mode 修复(parent 侧 TCSANOW)

claude/codex 启动时调用 `TCSETSW` 设 raw mode,但 `TCSETSW` 要求进程是 foreground。在 PTY 里目标不是 foreground,`TCSETSW` 返回 `ERESTARTSYS`,目标卡在重试循环 → 注入的输入没人读。

修复:从 parent 侧用 `TCSANOW`(立即生效)先把 PTY 设成 raw,目标的 `TCSETSW` 立即成功。

### 2. node-pty 写入时序(text 与 `\r` 必须分 tick)

实测发现:`child.write("hi\r")` 或同 tick 连写 `write("hi")` + `write("\r")` 都**不能让 codex 提交** —— codex(ratatui)在同一个事件循环 tick 里读到 `hi\r`,把 `\r` 当文本处理。

必须分两次 write,中间留 ~80ms 让 codex 跑一轮事件循环、消化 text、完成回显,再发的 `\r` 才被识别为提交键。

对照:用 Python `os.write(fd, b"hi\r")` 不需要这个延迟;claude code 的 TUI 也不需要(对同 tick 的 `\r` 宽容)。这个延迟对 claude 无副作用,对 codex 必须。

### 3. 单行注入

claude/codex 的输入框遇到换行会进多行模式(回车变换行)。`formatForInject` 把通知强制压成单行(去 `\r\n\t`、折叠空白、超长截断),保证回车 = 提交。

## 已知限制

> 改动注入逻辑后,建议照 [手动验证清单](./MANUAL-TESTING.md) 对各工具回归一次。

| 限制 | 影响 | 计划 |
|------|------|------|
| **idle 判据是启发式** | 靠静默期判断 idle,一个极慢但不输出的 prompt 可能被误判 busy | 可选加 prompt 特征正则双保险 |
| **codex 首次进未信任目录** | 会弹"信任目录?"确认框,注入的通知会被它吃掉 | 启动时需手动选"Yes";或用 `codex --config` 预置信任 |
| **多行注入** | 每条通知压成单行注入,长内容会被截 | 走目标 TUI 的 paste 模式;或先发摘要让 agent 自己查详情 |

## 项目结构

```
extensions/tui/
├── bin/notify-panel-tui.js  # 入口(用 tsx 跑源,免构建)
├── src/
│   ├── pty.ts               # PTY 桥接 + raw mode + writeToPty + 控制 socket
│   ├── watcher.ts           # TuiWatcher:用 NotifyClient SDK 轮询 → enqueue
│   ├── queue.ts             # QueuedInjector: idle 推断 + 排队注入
│   └── cli.ts               # CLI:notify-panel-tui <cmd> | ctl inject/list
├── test/
│   ├── queue.test.ts        # QueuedInjector 状态机测试
│   ├── watcher.test.ts      # watcher 投递契约测试(mock HTTP)
│   └── compat.test.ts       # writeToPty 跨工具适配测试(claude/codex/opencode/pi)
├── package.json
└── tsconfig.json
```

## License

MIT
