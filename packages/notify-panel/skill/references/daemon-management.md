# daemon 管理与排错

## 启动

### 默认(推荐:本机使用)

```bash
notify-panel start
# → notify-panel daemon 已在后台启动 (pid 12345)
# → 日志: ~/.notify-panel/daemon.log
```

默认行为:
- **后台运行**(fork 子进程,不占终端,日志写文件)
- 监听 `127.0.0.1:8787`(端口被占自动 +1)
- 写端口文件 `~/.notify-panel/server.json` + pid 文件 `~/.notify-panel/daemon.pid`
- **单实例保护**:已在跑就提示信息并退出

### 前台运行(调试)

```bash
notify-panel start --foreground
# 输出直接到终端,Ctrl+C 退出
```

### 暴露到网络(需谨慎)

```bash
notify-panel start --host 0.0.0.0 --secret <你的密钥>
```

> 暴露到网络**必须设 `--secret`**(明文 HTTP,建议再套 TLS/nginx)。客户端推送要带 `X-Notify-Secret` 头。

### 全部启动选项

| 选项 | 默认 | 说明 |
|------|------|------|
| `--port <n>` | `8787` | 监听端口。被占自动换;传 `0` 随机分配 |
| `--host <h>` | `127.0.0.1` | 监听地址。外部访问用 `0.0.0.0` |
| `--secret <s>` | 无 | 共享密钥。本机无需;暴露网络时必须设 |
| `--foreground` | 后台 | 前台运行(调试) |
| `--no-advertise` | (默认开) | 不写端口文件(不利于被发现) |

## 开机自启

```bash
notify-panel install [--secret <s>] [--port <n>] [--no-start]
```

**一步到位**:生成系统服务文件 **并自动启用 + 启动**(开机自启 + 崩溃自动重启)。agent 部署到新机器时跑这一条即可。
- **Linux**:systemd user service → `~/.config/systemd/user/notify-panel.service`,自动 daemon-reload + enable --now
- **macOS**:launchd LaunchAgent → `~/Library/LaunchAgents/dev.notify-panel.daemon.plist`,自动 launchctl load

> 自动启用失败(容器无 systemd 等)会降级为只生成文件并打印手动命令。`--no-start` 可跳过自动启动。

卸载:`notify-panel uninstall`(自动停止+禁用+删文件,顺序正确)。

## 状态与日志

```bash
notify-panel status          # 是否在跑(退出码:运行 0,未运行 1)
notify-panel logs            # 最近 50 行
notify-panel logs 200        # 最近 200 行
notify-panel logs -f         # 持续跟踪(类似 tail -f,Ctrl+C 退出)
```

日志文件:`~/.notify-panel/daemon.log`

## 端口与地址

daemon 端口**不固定**(冲突自动换)。拿真实地址:

```bash
notify-panel url             # 输出纯地址,如 http://127.0.0.1:8787
notify-panel url --json      # 完整信息(url/port/pid/secret)
```

发现顺序:`NOTIFY_PANEL_URL` 环境变量 > 端口文件 > 默认 8787。

裸 HTTP / 跨语言脚本**别写死端口**,用 `notify-panel url` 动态拿:

```bash
curl http://$(notify-panel url)/v1/notify ...
```

## 停止 / 重启

```bash
notify-panel stop            # 优雅 HTTP shutdown,失败回退 SIGTERM
notify-panel restart         # stop + start(保留参数)
```

## 数据位置(都在 ~/.notify-panel/)

| 文件 | 说明 |
|------|------|
| `server.json` | 端口文件:真实地址 + pid + secret(0600 权限) |
| `daemon.pid` | daemon 进程 pid |
| `daemon.log` | daemon 日志 |
| `store.json` | 持久化存储:所有通知(原子写 + 防抖) |

## 排错

### `notify-panel push` 没反应 / 报连不上

1. daemon 没跑:`notify-panel status`,没跑就 `notify-panel start`
2. 命令不存在:没装好,见主文档「安装」
3. 端口文件坏了:`notify-panel url` 看能否取到地址;取不到试 `notify-panel restart`

### daemon 起不来

1. 看日志:`notify-panel logs 100`
2. 端口全被占:`notify-panel start --port 0`(随机端口)
3. pid 文件残留(进程已死但文件在):`notify-panel stop` 清理后再 start

### 改了代码不生效

若通过 `npm link` 安装,改源码后需 `npm run build` 重新编译(link 指向 dist 不是 src)。

### 跨机访问不通

1. daemon 是否监听 `0.0.0.0`:`notify-panel url --json` 看 host 字段
2. 防火墙是否放行端口
3. 客户端是否带对了 `--secret` / `X-Notify-Secret` 头

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 运行时错误(daemon 没起、请求失败等) |
| 2 | 用法错误(参数不对) |
