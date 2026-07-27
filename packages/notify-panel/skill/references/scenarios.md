# 典型场景与响应策略

agent 作为通知的**消费者**,核心是「查收件箱 → 判断 → 行动」。下面是常见来源的处理范式。

## 通用收件模式

每次会话/任务开始时,先扫一眼有没有该处理的通知:

```bash
# 只看未读 + 需要处理的级别
notify-panel list --unread --severity error
notify-panel list --unread --severity warning
```

有 error → 立刻查详情并行动;warning → 视情况;无 → 告知用户「一切正常」。

## 来源 1:CI 构建结果

推送方:GitHub Actions / Jenkins / GitLab CI(在 workflow 里 `notify-panel push ci ...`)

**响应策略:**
```bash
notify-panel list --source ci --unread
# 看到:
#   • [error] build (ci) #1234 失败:测试未通过
# 行动:查 CI 日志、定位失败测试、修复
notify-panel read <id>   # 处理完标记已读
```

- `error` → 必须处理(查日志、修代码)
- `success` → 可告知用户「构建已通过」,通常无需深究

## 来源 2:后台任务 / agent 派出的子任务

推送方:你自己启动的长任务(训练、迁移、批量处理),或其它 agent

**典型场景**:你启动了一个耗时任务在后台跑,完成后它把结果推到 notify-panel:

```bash
# 后台任务结束时(在任务脚本里)
./long-task.sh && notify-panel push task 训练 "完成,准确率 95%" --severity success \
  || notify-panel push task 训练 "失败:OOM" --severity error
```

**之后你查收:**
```bash
notify-panel list --source task --unread
# 看到结果 → 继续后续步骤(部署模型 / 报告失败原因)
```

这是「异步任务 + 结果回收」模式:派出去的任务不阻塞你,完成时往收件箱投,你按需来取。

## 来源 3:监控告警

推送方:cron 跑的磁盘/CPU/服务检测脚本

**响应策略:**
```bash
notify-panel list --source monitor --severity error
# • [error] 磁盘 (monitor) 根分区 98%
#   行动:找大文件清理 → du -sh /* | sort -h
# • [error] nginx (monitor) 服务已停止
#   行动:systemctl status nginx → 重启
```

监控类通知通常是**行动触发器**:error 几乎都对应一个明确动作。

## 来源 4:webhook / 外部事件

推送方:外部系统通过 HTTP POST 回调(见 http-api.md 配置推送端)

```bash
notify-panel list --source webhook --unread
# 按 data 字段里的业务信息判断怎么处理
```

通知支持自定义 `data` 字段,推送方可塞业务上下文(订单号、用户 ID 等),你读取后据此路由处理逻辑。

## 来源 5:用户消息(聊天/工单系统接入)

如果配置了微信/Slack/工单系统往这里推:

```bash
notify-panel list --source wechat --unread
# • [info] 张三 (wechat) 在吗?
#   行动:告知用户有未回消息,或代为起草回复
```

## 标记已读:避免重复处理

处理完一条通知**务必标记已读**,否则下次会重复处理:

```bash
notify-panel read <id>        # 单条
notify-panel read --all       # 批量(确认都处理完了再用)
```

## 归档:暂不处理但要保留

有些通知现在不处理(如低优先级信息),归档后默认 `list` 仍显示但带 `[归档]` 标记:

```bash
notify-panel archive <id>
notify-panel list             # 归档项带 [归档],一眼区分
```

## 关键词搜索(历史回顾)

```bash
notify-panel list --keyword "失败"       # 找所有含「失败」的
notify-panel list --keyword "deploy"     # 找部署相关的
```

用于回溯历史:「上次部署是什么时候?成功没?」

## 排查「为什么没收到通知」

如果你预期某任务该推通知却没看到:

1. `notify-panel status` —— daemon 在跑吗?
2. `notify-panel list --source <预期来源>` —— 不限未读全看一遍(可能已读过了)
3. `notify-panel logs` —— daemon 收到请求了吗?有没有 401(密钥不对)/400(载荷非法)?
4. 检查推送方:任务真的执行了吗?`notify-panel push` 那行命令跑了吗?

## 推荐的 agent 行为

- **会话开始先扫 error**:`list --unread --severity error`,有则优先处理
- **处理一条标记一条**:避免重复劳动
- **主动投递自己的结果**:执行完任务后 `push` 一条,形成可追溯记录
- **用 source 分类**:不同来源不同响应策略,别混在一锅查
