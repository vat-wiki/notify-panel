# 文档索引

| 文档 | 给谁看 | 内容 |
|------|--------|------|
| [README](../../README.md) | 所有人 | 项目是什么、为什么为 agent 设计、怎么选对接方式 |
| [快速上手](./getting-started.md) | 第一次用的人 | 5 分钟跑起来 |
| [CLI 命令参考](./cli-reference.md) | 用命令行的人 | 每个命令的完整选项 |
| [场景配方](./cookbook.md) | 有具体场景的人 | CI / cron / Python / Go / Docker 等实战 |
| [架构设计](./architecture.md) | 想理解原理 / 二次开发的人 | 为什么这么设计、包结构、发现机制、安全模型 |
| [协议 JSON Schema](../schemas/) | 跨语言对接的人 | notify-payload / notify-batch 的 JSON Schema |

## 按角色快速定位

**「我想让 AI agent 接管通知」**
- 让 agent 学会查收件箱 → `notify-panel skill install`(skill 文件随包发布)
- 让 agent 被事件驱动(新通知自动投递)→ [pi 扩展](../../extensions/pi/)

**「我就想推个通知」**
- shell / cron / CI → [CLI 命令参考](./cli-reference.md) 的 `push`
- TS/JS 项目 → `import { NotifyClient } from 'notify-panel/sdk'`(见 [README](../../README.md) 方式 B)
- Python/Go/curl → [场景配方](./cookbook.md)

**「我要搭一套 agent 的通知基础设施」**
1. [快速上手](./getting-started.md) 启动 daemon
2. [CLI 命令参考](./cli-reference.md) 学会管理
3. [场景配方](./cookbook.md) 把各种来源接进来
4. 装 skill / pi 扩展,让 agent 消费

**「我想理解 / 扩展它」**
1. [架构设计](./architecture.md) 理解 daemon + 协议 + 发现机制
2. [协议 JSON Schema](../schemas/) 看接口契约
3. 各模块 `src/` 里的 JSDoc 看 API 细节
