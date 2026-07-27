# HTTP API:配置外部系统向 notify-panel 推送

daemon 暴露 HTTP 端点(兼容 `@notify-panel/protocol` v1)。这是**让外部系统(CI、cron、webhook、Python/Go 服务)把通知推进来**的接口——notify-panel 是收件箱,这些是寄件人。agent 侧查询/操作用 CLI 即可,除非你也想用 HTTP 查。

不装 CLI 的语言(Python / Go / Java / curl)直接 POST JSON 即可推进来。

## 前置:拿真实地址

daemon 端口**会变**(冲突自动 +1),**别写死端口**:

```bash
URL=$(notify-panel url)                           # 有 CLI
URL=${NOTIFY_PANEL_URL:-http://localhost:8787}    # 无 CLI,读环境变量,回退默认
```

> daemon 默认只监听 `127.0.0.1`。设了 `--secret` 时,请求需带 `X-Notify-Secret` 头。

## 端点一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/notify` | 推送单条 |
| POST | `/v1/notify/batch` | 批量推送(同 source) |
| GET | `/v1/notify` | 查询列表(支持过滤) |
| GET | `/v1/notify/:id` | 查询单条 |
| PATCH | `/v1/notify` | 全部已读(`{allRead: true}`) |
| PATCH | `/v1/notify/:id` | 改已读/归档 |
| DELETE | `/v1/notify/:id` | 删一条 |
| DELETE | `/v1/notify` | 清空全部 |
| DELETE | `/v1/daemon` | 关闭 daemon |

## 推送单条(POST /v1/notify)

**请求体:**
```json
{
  "source": "ci",
  "title": "build",
  "message": "#1234 done",
  "severity": "success"
}
```

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `source` | ✅ | 来源标识(≤64 字符) |
| `title` | ✅ | 标题(≤256) |
| `message` | ✅ | 正文(≤4096) |
| `severity` | ➖ | `info`(默认)\| `success` \| `warning` \| `error` |
| `timestamp` | ➖ | 毫秒时间戳,不传由面板填 |
| `data` | ➖ | 自定义扩展数据(任意 JSON 对象) |
| `id` | ➖ | 自定义 ID,不传自动生成 |

**响应:** `201`,`{ ok: true, accepted: [Notification] }`

### curl

```bash
curl -X POST "$URL/v1/notify" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Secret: $SECRET" \
  -d '{"source":"ci","title":"build","message":"done","severity":"success"}'
```

### Python

```python
import os, requests

URL = os.environ.get("NOTIFY_PANEL_URL", "http://localhost:8787")
SECRET = os.environ.get("NOTIFY_PANEL_SECRET")  # daemon 未设 secret 时不需要

headers = {"Content-Type": "application/json"}
if SECRET:
    headers["X-Notify-Secret"] = SECRET

requests.post(f"{URL}/v1/notify",
    json={"source": "python", "title": "ETL", "message": "完成", "severity": "success"},
    headers=headers)
```

### Go

```go
func notify(source, title, message, severity string) error {
    url := os.Getenv("NOTIFY_PANEL_URL")
    if url == "" {
        url = "http://localhost:8787"
    }
    payload, _ := json.Marshal(map[string]string{
        "source": source, "title": title, "message": message, "severity": severity,
    })
    req, _ := http.NewRequest("POST", url+"/v1/notify", bytes.NewReader(payload))
    req.Header.Set("Content-Type", "application/json")
    if secret := os.Getenv("NOTIFY_PANEL_SECRET"); secret != "" {
        req.Header.Set("X-Notify-Secret", secret)
    }
    _, err := http.DefaultClient.Do(req)
    return err
}
```

## 批量推送(POST /v1/notify/batch)

同 source 的多条一次性推送:

```json
{
  "source": "ci",
  "items": [
    { "title": "1", "message": "m1" },
    { "title": "2", "message": "m2" }
  ]
}
```

> 外层 `source` 适用于所有 item,不必每条重复写。

## 查询列表(GET /v1/notify)

query 参数过滤:

| 参数 | 说明 |
|------|------|
| `source` | 按来源 |
| `severity` | 按级别 |
| `unread=1` | 只看未读 |
| `since=<ms>` | 此时间戳之后 |
| `keyword` | 关键词(匹配标题/正文) |

```bash
curl "$URL/v1/notify?unread=1&severity=error"
# → { ok: true, items: [...], total: 2 }
```

## 查询单条(GET /v1/notify/:id)

```bash
curl "$URL/v1/notify/n_xxx"
# → { ok: true, accepted: [Notification] }
# 不存在 → 404 { ok: false, error: { code: "NOT_FOUND" } }
```

## 状态修改(PATCH)

```bash
# 全部已读
curl -X PATCH "$URL/v1/notify" -H "Content-Type: application/json" -d '{"allRead": true}'

# 单条:改已读/归档
curl -X PATCH "$URL/v1/notify/n_xxx" -H "Content-Type: application/json" \
  -d '{"read": true, "archived": false}'
```

## 删除(DELETE)

```bash
curl -X DELETE "$URL/v1/notify/n_xxx"   # 删一条
curl -X DELETE "$URL/v1/notify"         # 清空全部
```

## 响应格式

成功:
```json
{ "ok": true, "accepted": [ { ...Notification } ] }
```

失败:
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { "source": "..." } } }
```

常见 error code:`VALIDATION_ERROR` `UNAUTHORIZED` `NOT_FOUND` `INTERNAL`。

## 跨机 / 容器对接

容器内读不到宿主机端口文件,需用环境变量显式指向:

```bash
# 宿主机:暴露并设密钥
notify-panel start --host 0.0.0.0 --secret xxx

# 容器:用环境变量
docker run -e NOTIFY_PANEL_URL=http://host.docker.internal:8787 \
           -e NOTIFY_PANEL_SECRET=xxx my-app
```

## TS/JS 用 SDK(类型安全)

不想手写 HTTP?用官方 SDK,零配置自动发现 + 本地校验:

```ts
import { NotifyClient } from '@notify-panel/sdk';
const client = new NotifyClient();  // 自动发现本机 daemon
await client.push({ source: 'app', title: '导出完成', message: 'report.xlsx' });
```
