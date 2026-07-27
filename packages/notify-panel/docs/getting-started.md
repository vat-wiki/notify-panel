# 快速上手

5 分钟跑起来 notify-panel,作为系统级服务使用。

## 第一步:全局安装

notify-panel 是**系统级软件**,这台机器装一次即可。两种方式任选:

```bash
# 方式一:npm
npm install -g notify-panel

# 方式二:脚本(自动检测 Node、处理权限、给修复提示)
curl -fsSL https://raw.githubusercontent.com/<owner>/notify-panel/main/install.sh | sh
```

> 装不上多半是 npm 全局目录无写权限。脚本会提示两种修复方式(nvm 或改 prefix)。

验证:
```bash
notify-panel --version
```

## 第二步:启动后台 daemon

daemon 是常驻后台进程,接收和存储所有通知。启动后**立即返回终端**,不占用:

```bash
notify-panel start
# notify-panel daemon 已在后台启动 (pid 12345)
# 日志: ~/.notify-panel/daemon.log
```

验证:
```bash
notify-panel status
# 🟢 notify-panel 运行中
```

## 第三步:推一条通知试试

**任何终端、任何脚本**都能推,自动发现 daemon:

```bash
notify-panel push ci build "#1234 构建成功" --severity success
notify-panel push wechat 张三 "在吗?"
notify-panel push monitor 磁盘 "使用率 85%" --severity warning

# 或者 curl(零依赖,地址用 url 命令拿,别写死)
curl -X POST http://$(notify-panel url)/v1/notify \
  -H "Content-Type: application/json" \
  -d '{"source":"curl","title":"测试","message":"我是 curl 推的"}'
```

## 第四步:查看与管理

```bash
notify-panel list                     # 全部
notify-panel list --unread            # 未读
notify-panel list --severity error    # 按级别
notify-panel read <id>                # 标记已读
notify-panel read --all               # 全部已读
notify-panel clear                    # 清空
notify-panel logs                     # 看 daemon 日志
```

## 第五步:设为开机自启

让 daemon 开机自动启动、崩溃自动重启。**一步到位**(自动生成服务文件并启动):

```bash
notify-panel install
# → 已生成 systemd / launchd 服务,已启用并启动(daemon 正在跑)
```

## 关闭 / 重启

```bash
notify-panel restart   # 重启
notify-panel stop      # 停止
notify-panel status    # 查状态
```

## 检查 daemon 状态

任何时候:

```bash
notify-panel status
# 🟢 notify-panel 运行中 / 🔴 未运行
```

## 接下来

- [CLI 命令参考](./cli-reference.md) —— 所有命令的完整选项
- [场景配方](./cookbook.md) —— CI 通知、定时任务、多语言对接等实战
- [SDK 用法](../packages/sdk/src/index.ts) —— 在 TS/JS 项目里用

## 常见问题

**Q: daemon 端口被占用了怎么办?**
A: 不用管。默认端口 8787 被占时,daemon 自动找下一个可用端口,客户端通过端口文件自动发现,零配置。**裸 HTTP / 跨语言脚本别写死端口**,用 `notify-panel url` 动态拿地址,或读环境变量 `$NOTIFY_PANEL_URL`。

**Q: 后台运行的 daemon 怎么看日志?**
A: `notify-panel logs`(最近 50 行)或 `notify-panel logs -f`(持续跟踪)。日志文件在 `~/.notify-panel/daemon.log`。

**Q: 开机想自动启动?**
A: `notify-panel install` 一步到位:生成 systemd(Linux)/ launchd(macOS)服务文件 **并自动启用启动**,重启机器后 daemon 自启。详见 [CLI 参考](./cli-reference.md) 的 install 命令。

**Q: 重启 daemon 数据会丢吗?**
A: **不会。** 默认启用持久化,所有通知自动落盘到 `~/.notify-panel/store.json`,重启后自动恢复。写盘用原子写 + 防抖,崩溃最多丢最近几百毫秒的数据。要纯内存模式可 `--no-persist`。

**Q: 需要密钥吗?**
A: 默认不需要。daemon 只监听本机(`127.0.0.1`),同机进程可直接连。**仅当**你要暴露到网络(`--host 0.0.0.0`)或想加一层访问控制时,才用 `notify-panel start --secret xxx`,此时客户端推送需带 `X-Notify-Secret` 头。

**Q: 怎么从别的机器/容器推通知?**
A: daemon 默认只监听 `127.0.0.1`。要让外部访问,启动时加 `--host 0.0.0.0` **并设 `--secret`**(明文 HTTP,建议套 TLS)。
