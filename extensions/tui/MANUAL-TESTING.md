# 手动验证:各 TUI 工具的适配

> 自动化测试(`test/compat.test.ts`)用 mock child 验证 `writeToPty` 的时序契约,
> CI 可跑、零 flaky。但真实工具(claude/codex/opencode/pi)有各自的启动确认框、
> 模型 loading、网络状态,无法可靠地自动化。本文档固化**实测验证步骤 + 观察数据**,
> 供改动后手动回归。

## 一键自检(推荐)

每个工具起一次,确认注入链路通:

```bash
cd ~/projects/notify-panel
notify-panel start                    # 确保 daemon 在跑

# 每个工具开一个终端:
notify-panel-tui claude               # 或 codex / opencode / pi
# 另一个终端推一条测试通知:
notify-panel push --source test --title "smoke" --message "reply OK" --severity info
# 回到第一个终端:应该看到 claude 收到 "🔴[info] smoke (test) ..." 并开始处理
```

**通过判据**:目标 TUI 收到通知文本、自动提交、进入处理状态(spinner 转 / 开始输出)。

## 各工具实测数据(2024 探测)

下表是开发期用 Python pty 探测的真实行为,作为"是否正常"的参照:

| 工具 | 版本 | `\r` 提交 | `\n` 提交 | spinner 出现 | 启动确认框 | 备注 |
|------|------|----------|----------|--------------|-----------|------|
| **claude** | 2.1.205 | ✅ | (多行模式) | ✅ | 无 | `\r` 单次写即可提交,宽松 |
| **codex** | 0.145.0 | ✅ | ❌ | ✅ | 信任目录(首次) | **严格时序**:node-pty 同 tick `\r` 不提交 |
| **opencode** | 1.18.7 | ✅ | (多行模式) | ✅ | 无 | `\r` 单次写即可提交,宽松 |
| **pi** | 0.81.1 | ✅ | - | ✅ | 无 | 是 TUI,`\r` 提交 |

### 关键结论

- **所有工具都认 `\r` 为提交键** → `writeToPty` 固定发 `\r`,覆盖全部
- **codex 额外要求分 tick** → `writeToPty` 的 `setTimeout(80ms)` 保证 text 和 `\r` 不在同 tick,对其他工具无副作用
- **`\n` 在多个工具会进多行模式** → `formatForInject` 强制压单行,避免触发

## codex 的特殊处理

codex 是唯一需要特殊照顾的工具,两个点:

### 1. 信任目录确认框(首次进入未信任目录)

codex 首次进入一个目录会弹:
```
Do you trust the contents of this directory?
  1. Yes, continue
  2. No, quit
```
**手动选 1** 跳过。之后该目录不再弹。
> 如果在确认框出现时就有通知注入,会被确认框吃掉。建议先手动进一次目录确认信任,
> 再启动 `notify-panel-tui codex`。

### 2. 严格时序(node-pty 陷阱)

node-pty 把数据高速灌进 PTY,codex(ratatui)在同一个事件循环 tick 读到 `text\r`
会把 `\r` 当文本处理。`writeToPty` 用 `setTimeout(80ms)` 把 `\r` 排到下一个 tick,
规避此问题。详见 [README "关键技术点"](./README.md#2-node-pty-写入时序text-与-r-必须分-tick)。

## 失败排查

| 症状 | 可能原因 | 排查 |
|------|---------|------|
| 通知文本进了输入框但不提交 | 目标是 codex 型,时序没生效 | 确认 `writeToPty` 的 setTimeout 没被误改 |
| 文本根本没进框 | 目标在确认框/模型 loading | 等目标完全就绪再注入 |
| 通知被截断 | 超过 500 字符单行上限 | 正常,`formatForInject` 设计如此;让 agent 自己查详情 |
| 注入了但目标没反应 | 模型挂了(404/429) | `notify-panel` 链路正常,是上游模型问题 |
| `notify-panel-tui` 启动报 daemon 不可达 | daemon 没跑 | `notify-panel status` / `notify-panel start` |

## 重新探测(改了 writeToPty 后)

如果改了 `writeToPty` 的时序逻辑,用这个快速探测各工具是否仍正常:

```bash
# 用 notify-panel-tui 自己跑各工具,手动推通知观察
notify-panel-tui claude &
sleep 8  # 等启动完
notify-panel push --source probe --title "test $(date +%s)" --message "say OK"
# 观察 claude 是否收到并处理;Ctrl+C 退出后换下一个工具
```

或用 Python pty 直接探(不依赖 notify-panel-tui,只验证提交键):

```python
# 见本仓库 git 历史的开发期 probe 脚本;核心是写 text+\r 看是否离开输入框
```
