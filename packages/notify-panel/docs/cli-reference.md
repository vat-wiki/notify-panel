# CLI 命令参考

`notify-panel` 二进制既是 **daemon 管理者**,也是 **daemon 客户端**。同一套命令,两种用途。

> 全局用法:`notify-panel <command> [options]`,任何命令加 `-h` 看该命令帮助。

---

## 全局选项

| 选项 | 说明 |
|------|------|
| `-h, --help` | 打印帮助 |
| `-v, --version` | 打印版本号 |

---

## 一、管理 daemon

### `notify-panel start`

启动 daemon。**默认后台运行**(不占终端),`--foreground` 前台运行(调试用)。

```
notify-panel start [--port <n>] [--host <h>] [--secret <s>] [--foreground] [--no-advertise]
```

**选项:**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--port <n>` | `8787` | 监听端口。默认端口被占时自动换;传 `0` 让系统随机分配 |
| `--host <h>` | `127.0.0.1` | 监听地址。要让外部访问用 `0.0.0.0` |
| `--secret <s>` | 无 | 共享密钥。设置后客户端推送要带 `X-Notify-Secret` 头 |
| `--foreground` | 后台 | 前台运行,输出到终端(调试用) |
| `--no-advertise` | (默认开) | 不写端口文件 |

**行为:**
- 若已有 daemon 在跑,提示信息并退出(单实例保护)
- 后台模式:fork 子进程,stdio 重定向到日志文件,父进程立即返回
- 写端口文件 `~/.notify-panel/server.json` + pid 文件 `~/.notify-panel/daemon.pid`

**示例:**
```bash
notify-panel start --secret my-secret        # 后台运行
notify-panel start --secret my-secret --foreground  # 前台(调试)
notify-panel start --host 0.0.0.0 --secret xxx      # 允许外部访问
```

### `notify-panel stop`

停止 daemon(先优雅 HTTP shutdown,失败再 SIGTERM),清理端口/pid 文件。

```
notify-panel stop
```

### `notify-panel restart`

重启 daemon,保留命令行参数。相当于 stop + start。

```
notify-panel restart [同 start 的选项]
```

### `notify-panel status`

查看 daemon 是否在运行。退出码:运行中 0,未运行 1(适合脚本判断)。

```
notify-panel status
```

```bash
# 开机自动拉起 daemon 的例子
notify-panel status || notify-panel start
```

### `notify-panel url`

输出当前 daemon 的**真实地址**(纯地址输出,便于 shell 嵌套)。端口会变,裸 HTTP / 跨语言脚本别写死端口,用它动态拿。

```
notify-panel url [--json] [--no-default]
```

| 选项 | 说明 |
|------|------|
| `--json` | 输出完整信息 JSON(url/port/pid/secret 等) |
| `--no-default` | 未设环境变量且端口文件不存在时不回退默认值(直接报错) |

查找顺序:`NOTIFY_PANEL_URL` 环境变量 > 端口文件 > 默认 `8787`。

**示例:**
```bash
# shell:拿真实地址拼 curl
curl http://$(notify-panel url)/v1/notify ...

# 看完整信息(端口/pid/secret)
notify-panel url --json
```

### `notify-panel logs`

查看 daemon 日志(后台运行时所有输出都在这)。

```
notify-panel logs [n] [-f]
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `n` | `50` | 最近 n 行 |
| `-f, --follow` | | 持续跟踪(类似 `tail -f`) |

日志文件位置:`~/.notify-panel/daemon.log`

## 二、开机自启

### `notify-panel install`

生成系统服务文件 **并自动启用 + 启动**(开机自启 + 崩溃自动重启)。一步到位。

```
notify-panel install [--secret <s>] [--port <n>] [--no-start]
```

| 选项 | 说明 |
|------|------|
| `--secret <s>` | 共享密钥(本机免密钥时可省略) |
| `--port <n>` | 端口,默认 8787 |
| `--no-start` | 只生成文件,不自动启用/启动 |

- **Linux**:生成 systemd user service 到 `~/.config/systemd/user/notify-panel.service`,自动 `daemon-reload + enable --now`
- **macOS**:生成 launchd LaunchAgent 到 `~/Library/LaunchAgents/dev.notify-panel.daemon.plist`,自动 `launchctl load`

> 自动启用失败时(如容器/WSL 无 systemd),会降级为只生成文件并打印手动命令。

### `notify-panel uninstall`

卸载系统服务:**先自动停止+禁用,再删文件**(顺序正确,避免残留进程)。

```
notify-panel uninstall
```

## 三、推送 / 操作(作为客户端)

以下命令自动发现 daemon,无需指定地址。

> **通用选项**(以下命令都支持):
> - `--url <u>` —— 显式指定 daemon 地址(覆盖自动发现)
> - `--secret <s>` —— 共享密钥(默认从端口文件读)

### `notify-panel push`

推送一条通知。

```
notify-panel push <source> <title> [message] [--severity <s>]
```

**参数:**

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `<source>` | ✅ | 来源标识,如 `ci`、`wechat`、`backup` |
| `<title>` | ✅ | 标题 |
| `[message]` | ➖ | 正文,不传则为空 |

**选项:**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--severity <s>` | `info` | `info` \| `success` \| `warning` \| `error` |

**示例:**
```bash
notify-panel push ci build "#1234 失败" --severity error
notify-panel push wechat 张三 "在吗?"
notify-panel push backup 备份 "每天凌晨任务完成"
```

### `notify-panel list`

列出通知(按时间倒序,最新在前)。

```
notify-panel list [--source <s>] [--severity <s>] [--keyword <k>] [--unread]
```

**选项:**

| 选项 | 说明 |
|------|------|
| `--source <s>` | 按来源过滤 |
| `--severity <s>` | 按级别过滤:`info` \| `success` \| `warning` \| `error` |
| `--keyword <k>` | 关键词搜索(匹配标题和正文) |
| `--unread` | 只看未读 |

**示例:**
```bash
notify-panel list                          # 全部
notify-panel list --unread                 # 未读
notify-panel list --severity error         # 只看错误
notify-panel list --source ci --keyword "fail"   # 组合过滤
```

**输出格式:**
```
• [warning] 磁盘  (monitor)  id=n_xxx
    使用率 85%
  [success] build  (ci)  id=n_yyy     # 已读(无圆点)
    #1 ok
共 2 条
```

> 行首 `•` 表示未读,空格表示已读;`[归档]` 标记已归档。

### `notify-panel read`

标记已读。

```
notify-panel read <id>           # 标记某条已读
notify-panel read <id> --unread  # 标记某条未读
notify-panel read --all          # 全部已读
```

### `notify-panel archive`

归档通知(归档后默认 list 仍会显示,但带 `[归档]` 标记)。

```
notify-panel archive <id>             # 归档
notify-panel archive <id> --unarchive # 取消归档
```

### `notify-panel clear`

清空所有通知。**不可恢复**,慎用。

```
notify-panel clear
```

---

## 四、与 AI 助手集成(pi skill)

内置一份 pi skill,描述了如何用 notify-panel 发送/管理通知。安装后,AI 助手(如 pi)在「任务完成通知、CI 告警、监控提醒」等场景会自动加载并使用本工具。

### `notify-panel skill install`

安装内置 skill 到指定目录(默认 `~/.pi/agent/skills/notify-panel`)。

```
notify-panel skill install [dir] [-f, --force]
```

| 参数/选项 | 说明 |
|-----------|------|
| `[dir]` | 目标目录。不传则装到 `~/.pi/agent/skills/notify-panel` |
| `-f, --force` | 目标已存在时强制覆盖 |

```bash
notify-panel skill install             # 装到默认全局位置(pi 下次启动自动发现)
notify-panel skill install ./my-skills # 装到指定目录
notify-panel skill install --force     # 重新安装(覆盖旧版)
```

> skill 源随 npm 包发布,装完即可离线使用,不依赖网络。

### `notify-panel skill path`

显示内置 skill 源目录(便于查看或手动复制)。

```
notify-panel skill path
```

---

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 运行时错误(daemon 没起来、请求失败等) |
| 2 | 用法错误(参数不对) |

---

## 配合其它工具

### 后台运行(systemd 示例)

```ini
# /etc/systemd/system/notify-panel.service
[Unit]
Description=Notify Panel Daemon
After=network.target

[Service]
ExecStart=/usr/local/bin/notify-panel start --secret top-secret
Restart=always
User=leon

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now notify-panel
```

### 后台运行(nohup 简易版)

```bash
nohup notify-panel start --secret xxx > /tmp/notify-panel.log 2>&1 &
```

### 在 cron 里推通知

```cron
# 每天凌晨 2 点备份,完成后通知
0 2 * * * /usr/local/bin/backup.sh && /usr/local/bin/notify-panel push backup 备份 "完成"
```

更多场景见 [场景配方](./cookbook.md)。
