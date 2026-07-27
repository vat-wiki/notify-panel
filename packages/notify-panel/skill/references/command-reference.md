# 命令完整参考

`notify-panel` 二进制既是 **daemon 管理者**,也是 **daemon 客户端**。同一套命令,两种用途。

> 全局用法:`notify-panel <command> [options]`,任何命令加 `-h` 看帮助。

## 全局选项

| 选项 | 说明 |
|------|------|
| `-h, --help` | 打印帮助 |
| `-v, --version` | 打印版本号 |

---

## 一、管理 daemon

### `start`

启动 daemon。默认后台运行,`--foreground` 前台(调试)。

```
notify-panel start [--port <n>] [--host <h>] [--secret <s>] [--foreground] [--no-advertise]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--port <n>` | `8787` | 监听端口。被占自动换;传 `0` 随机分配 |
| `--host <h>` | `127.0.0.1` | 监听地址。外部访问用 `0.0.0.0` |
| `--secret <s>` | 无 | 共享密钥。本机无需;暴露网络时必须设 |
| `--foreground` | 后台 | 前台运行(调试) |
| `--no-advertise` | (默认开) | 不写端口文件 |

**示例:**
```bash
notify-panel start                                # 后台运行(本机免密钥)
notify-panel start --foreground                   # 前台(调试)
notify-panel start --host 0.0.0.0 --secret xxx    # 暴露到网络(必须设密钥)
```

### `stop`

停止 daemon(优雅 HTTP shutdown,失败回退 SIGTERM),清理端口/pid 文件。

```
notify-panel stop
```

### `restart`

重启 daemon(保留命令行参数)。相当于 stop + start。

```
notify-panel restart [同 start 的选项]
```

### `status`

查看是否在运行。**退出码:运行中 0,未运行 1**(适合脚本判断)。

```
notify-panel status
```

```bash
notify-panel status || notify-panel start   # 没跑就拉起
```

### `url`

输出当前 daemon 的**真实地址**(纯地址,便于 shell 嵌套)。端口会变,裸 HTTP 别写死。

```
notify-panel url [--json] [--no-default]
```

| 选项 | 说明 |
|------|------|
| `--json` | 输出完整信息 JSON(url/port/pid/secret 等) |
| `--no-default` | 未设环境变量且端口文件不存在时不回退默认值(直接报错) |

发现顺序:`NOTIFY_PANEL_URL` 环境变量 > 端口文件 > 默认 `8787`。

```bash
curl http://$(notify-panel url)/v1/notify ...     # 拿地址拼 curl
notify-panel url --json                            # 看完整信息
```

### `logs`

查看 daemon 日志。

```
notify-panel logs [n] [-f]
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `n` | `50` | 最近 n 行 |
| `-f, --follow` | | 持续跟踪(类似 tail -f) |

日志文件:`~/.notify-panel/daemon.log`

---

## 二、开机自启

### `install`

生成系统服务文件 **并自动启用 + 启动**(**一步到位**:开机自启 + 崩溃自动重启)。

```
notify-panel install [--secret <s>] [--port <n>] [--no-start]
```

| 选项 | 说明 |
|------|------|
| `--secret <s>` | 共享密钥(本机免密钥时可省略) |
| `--port <n>` | 端口,默认 8787 |
| `--no-start` | 只生成文件,不自动启用/启动 |

- **Linux**:systemd user service,自动 `daemon-reload + enable --now`
- **macOS**:launchd LaunchAgent,自动 `launchctl load`
- 自动启用失败(容器无 systemd 等)降级为只生成文件 + 打印手动命令

### `uninstall`

卸载系统服务:**先自动停止+禁用,再删文件**(顺序正确)。

```
notify-panel uninstall
```

---

## 三、推送 / 操作(作为客户端)

以下命令自动发现 daemon,无需指定地址。

> **通用选项**(以下命令都支持):
> - `--url <u>` —— 显式指定 daemon 地址(覆盖自动发现)
> - `--secret <s>` —— 共享密钥(daemon 未设可省略;设了则从端口文件自动读)

### `push`

推送一条通知。

```
notify-panel push <source> <title> [message] [--severity <s>]
```

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `<source>` | ✅ | 来源标识,如 `ci`、`wechat`、`backup` |
| `<title>` | ✅ | 标题 |
| `[message]` | ➖ | 正文,不传则为空 |

| 选项 | 默认 | 说明 |
|------|------|------|
| `--severity <s>` | `info` | `info` \| `success` \| `warning` \| `error` |

```bash
notify-panel push ci build "#1234 失败" --severity error
notify-panel push backup 备份 "每天凌晨任务完成"
```

### `list`

列出通知(按时间倒序,最新在前)。

```
notify-panel list [--source <s>] [--severity <s>] [--keyword <k>] [--unread]
```

| 选项 | 说明 |
|------|------|
| `--source <s>` | 按来源过滤 |
| `--severity <s>` | 按级别过滤:`info` \| `success` \| `warning` \| `error` |
| `--keyword <k>` | 关键词搜索(匹配标题和正文) |
| `--unread` | 只看未读 |

```bash
notify-panel list --unread
notify-panel list --severity error
notify-panel list --source ci --keyword "fail"
```

**输出格式:**
```
• [warning] 磁盘  (monitor)  id=n_xxx        # • 未读
    使用率 85%
  [success] build  (ci)  id=n_yyy            # (空格) 已读
    #1 ok
共 2 条
```

行首 `•` = 未读,空格 = 已读;`[归档]` = 已归档。

### `read`

标记已读。

```
notify-panel read <id>           # 标记某条已读
notify-panel read <id> --unread  # 标记某条未读
notify-panel read --all          # 全部已读
```

### `archive`

归档通知(归档后 list 仍显示,但带 `[归档]` 标记)。

```
notify-panel archive <id>             # 归档
notify-panel archive <id> --unarchive # 取消归档
```

### `clear`

清空所有通知。**不可恢复**。

```
notify-panel clear
```

---

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 运行时错误(daemon 没起、请求失败等) |
| 2 | 用法错误(参数不对) |
