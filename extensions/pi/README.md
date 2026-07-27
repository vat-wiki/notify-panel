# notify-panel-pi-extension

[pi](https://github.com/earendil-works/pi-coding-agent) 扩展:让 AI agent **被通知事件驱动**。

它是 [notify-panel](https://github.com/vat-wiki/notify-panel) 的消费端闭环——轮询本机收件箱,把未读通知**主动投递**给当前 agent,触发它去处理。配合 notify-panel 的推送端,构成「外部事件 → agent 自动响应」的完整链路。

## 为什么需要它

notify-panel 解决了「事件怎么汇到一处」,但 agent 默认仍是被动的——你不问,它不知道有新通知。这个扩展补上最后一环:

```
CI 失败 / 备份完成 / 监控告警 / webhook 触发
        │ push
        ▼
   notify-panel daemon  ← 这个扩展每 5s 轮询
        │ 拉到未读
        ▼
   pi.sendUserMessage()  ← 主动投递给 agent
        │
        ▼
   agent 自动处理(查日志 / 修复 / 回推结果)
```

典型闭环:**CI 失败 → 推送到 notify-panel → 扩展轮询到 → 投递给 agent → agent 自动查 CI 日志、修复代码、提交。全程无需人介入。**

## 前置条件

本机已安装并运行 notify-panel daemon:

```bash
npm install -g notify-panel
notify-panel install   # 开机自启 + 立即启动
```

## 安装

```bash
# 方式 A:pi install(推荐)
pi install git:github.com/vat-wiki/notify-panel

# 方式 B:本地开发
git clone https://github.com/vat-wiki/notify-panel.git
cd notify-panel && npm install
pi -e ./extensions/pi/src/notify-poller.ts   # 临时加载测试
```

## 运行时控制

安装后下次启动 pi 自动加载。

```
/notify-poller status    # 查看状态(运行/暂停/间隔/累计投递/上下文占用)
/notify-poller pause     # 暂停轮询(当前会话)
/notify-poller resume    # 恢复轮询
/notify-poller poll      # 手动触发一次轮询
/notify-poller test      # 自检服务发现 + HTTP 链路
```

CLI flag 全局禁用:

```bash
pi --no-notify-poller
```

## 设计要点

- **服务发现**:优先读 `~/.notify-panel/server.json`(零开销),读不到再 fallback 到 `notify-panel url`
- **不丢消息**:先 `sendUserMessage` 投递成功,再标记已读;投递失败时通知保留未读,下轮重试
- **archived 过滤**:用户归档的通知不会被反复推送(`?unread=1` 不排除 archived,扩展必须自己过滤)
- **退避**:daemon 不可达时间隔指数退避(上限 30s),恢复后回到 5s
- **并发保护**:同一时刻只有一个轮询 tick 在跑,防止网络慢时重叠
- **上下文感知**:占用超过阈值时,在投递的消息里追加 `/compact` 提示
- **资源清理**:定时器在 `session_start` 创建、`session_shutdown` 清理(不在 factory 里启动)

## 配置

轮询间隔、退避上限、上下文阈值等常量在 `src/notify-poller.ts` 顶部,按需修改后重启 pi 生效。

## 与 notify-panel skill 的区别

- **skill**(`notify-panel skill install`):让 agent 知道有收件箱可查,**被动**——用户问到才查
- **本扩展**:把通知**主动**推给 agent,**主动**——有新通知就触发

两者可叠加:skill 让 agent 理解概念,扩展让它被事件驱动。
