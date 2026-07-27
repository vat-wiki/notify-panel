# 文档索引

| 文档 | 给谁看 | 内容 |
|------|--------|------|
| [README](../README.md) | 所有人 | 项目是什么、能干什么、怎么选对接方式 |
| [快速上手](./getting-started.md) | 第一次用的人 | 5 分钟跑起来 |
| [CLI 命令参考](./cli-reference.md) | 用命令行的人 | 每个命令的完整选项 |
| [场景配方](./cookbook.md) | 有具体场景的人 | CI / cron / Python / Go / Docker 等实战 |
| [架构设计](./architecture.md) | 想理解原理 / 二次开发的人 | 为什么这么设计、包结构、发现机制、安全模型 |
| [协议规范](../packages/protocol/README.md) | 跨语言对接 / 自做 daemon 的人 | HTTP 协议、JSON Schema、版本协商 |

## 按角色快速定位

**「我就想推个通知」**
- shell / cron / CI → [CLI 命令参考](./cli-reference.md) 的 `push`
- TS/JS 项目 → 装包 `@notify-panel/sdk`,看 README 方式 B
- Python/Go/curl → [场景配方](./cookbook.md) 配方 5/6

**「我要搭一套通知中心」**
1. [快速上手](./getting-started.md) 启动 daemon
2. [CLI 命令参考](./cli-reference.md) 学会管理
3. [场景配方](./cookbook.md) 把各种来源接进来

**「我想理解 / 扩展它」**
1. [架构设计](./architecture.md) 理解 daemon + 协议 + 发现机制
2. [协议规范](../packages/protocol/README.md) 看接口契约
3. 各包 `src/` 里的 JSDoc 看 API 细节
