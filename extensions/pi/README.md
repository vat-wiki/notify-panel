# notify-panel-pi-extension

pi 扩展:自动轮询本机 [notify-panel](https://github.com/vat-wiki/notify-panel) 收件箱,把未读通知投递给 agent 处理。

## 它做什么

每 5 秒轮询一次本机 notify-panel daemon 的未读通知,通过 `pi.sendUserMessage` 投递给当前 agent。agent 处理完(或收到消息后)自动标记已读。daemon 不可达时指数退避,恢复后回到正常间隔。

- **服务发现**:优先读 `~/.notify-panel/server.json`(零开销),读不到再 fallback 到 `notify-panel url`
- **不丢消息**:先投递成功,再标记已读
- **archived 过滤**:归档的通知不会被反复推送
- **上下文感知**:占用超过阈值时在消息里追加 `/compact` 提示

## 前置条件

本机已安装并运行 notify-panel daemon:

```bash
npm install -g notify-panel
notify-panel install   # 开机自启 + 立即启动
```

## 安装

### 方式 A:pi install(推荐)

```bash
pi install git:github.com/vat-wiki/notify-panel
```

pi 会克隆仓库、读取根 `package.json` 的 workspaces,自动发现本扩展。

### 方式 B:本地开发

```bash
git clone https://github.com/vat-wiki/notify-panel.git
cd notify-panel
npm install

# 用本地路径加载(开发调试)
pi -e ./extensions/pi/src/notify-poller.ts
```

## 使用

安装后下次启动 pi 自动加载。运行时控制:

```
/notify-poller status    # 查看状态
/notify-poller pause     # 暂停轮询
/notify-poller resume    # 恢复轮询
/notify-poller poll      # 手动触发一次
/notify-poller test      # 自检服务发现 + HTTP 链路
```

CLI flag 全局禁用:

```bash
pi --no-notify-poller
```

## 配置

轮询间隔、退避上限、上下文阈值等常量在 `src/notify-poller.ts` 顶部,按需修改后重启 pi 生效。
