# 场景配方

真实的对接场景,可直接复制。每个配方都假设 daemon 已启动(`notify-panel start`)。

---

## 配方 1:CI/CD 构建结果通知

让 CI pipeline 把构建结果推到面板,不用盯构建日志。

### GitHub Actions

```yaml
# .github/workflows/build.yml
- name: Build
  run: npm run build

- name: Notify on failure
  if: failure()
  run: |
    curl -X POST http://notify-panel.local:8787/v1/notify \
      -H "Content-Type: application/json" \
      -H "X-Notify-Secret: ${{ secrets.NOTIFY_SECRET }}" \
      -d "{\"source\":\"ci\",\"title\":\"构建失败\",\"message\":\"${GITHUB_REF#refs/heads/} #${GITHUB_RUN_NUMBER}\",\"severity\":\"error\"}"

- name: Notify on success
  if: success()
  run: notify-panel push ci 构建成功 "${GITHUB_REF#refs/heads/} #${GITHUB_RUN_NUMBER}" --severity success
```

> 提示:CI runner 里要么装 CLI,要么直接用 curl(零依赖)。跨机器访问记得 daemon 用 `--host 0.0.0.0`。

### Jenkins (Pipeline)

```groovy
post {
  failure {
    sh 'notify-panel push jenkins 装配失败 "${JOB_NAME} #${BUILD_NUMBER}" --severity error'
  }
  success {
    sh 'notify-panel push jenkins 装配成功 "${JOB_NAME} #${BUILD_NUMBER}" --severity success'
  }
}
```

---

## 配方 2:定时任务完成通知

cron 跑完脚本,推个通知告诉你结果。

```cron
# crontab -e

# 每天凌晨 2 点备份数据库
0 2 * * * /opt/scripts/backup-db.sh && \
         /usr/local/bin/notify-panel push backup 数据库备份 "成功" --severity success || \
         /usr/local/bin/notify-panel push backup 数据库备份 "失败!" --severity error

# 每周一早 9 点生成周报
0 9 * * 1 /opt/scripts/weekly-report.sh && \
         /usr/local/bin/notify-panel push report 周报 "已生成,见 ~/reports/"
```

**脚本里集成(更灵活):**

```bash
#!/bin/bash
# backup-db.sh
set -e

notify() {
  local sev=$1; local msg=$2
  notify-panel push backup 数据库 "$msg" --severity "$sev"
}

if pg_dump mydb > /backup/$(date +%F).sql; then
  notify success "备份成功:$(date +%F)"
else
  notify error "备份失败!"
  exit 1
fi
```

---

## 配方 3:服务器监控告警

监控脚本检测到异常,推 error 级通知。

```bash
#!/bin/bash
# check-disk.sh —— 磁盘空间检查
THRESHOLD=85
USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
  notify-panel push monitor 磁盘告警 \
    "根分区使用率 ${USAGE}%,超过阈值 ${THRESHOLD}%" \
    --severity warning
fi
```

配合 cron 每分钟检查:
```cron
* * * * * /opt/scripts/check-disk.sh
```

---

## 配方 4:在 TypeScript/JS 项目里集成

适合 Node 服务、Electron 应用、前端项目。

### 安装

```bash
npm install @notify-panel/sdk
```

### 基本用法

```ts
import { NotifyClient } from '@notify-panel/sdk';

// 零配置:自动发现本机 daemon
const notify = new NotifyClient();

await notify.push({
  source: 'my-app',
  title: '用户注册',
  message: `新用户: ${user.email}`,
  severity: 'info',
});
```

### 带错误处理

```ts
import { NotifyClient, NotifyError } from '@notify-panel/sdk';

const notify = new NotifyClient();

try {
  await riskyOperation();
  await notify.push({ source: 'app', title: '操作', message: '成功', severity: 'success' });
} catch (e) {
  if (e instanceof NotifyError) {
    // 通知推送本身失败(校验错/daemon 没起来/鉴权失败)
    console.error('通知推送失败:', e.code, e.message);
  } else {
    // 业务操作失败 —— 推个 error 通知
    await notify.push({
      source: 'app',
      title: '操作失败',
      message: String(e),
      severity: 'error',
    }).catch(() => {}); // 推送失败别影响主流程
  }
}
```

### 显式指定地址(测试 / 远程)

```ts
const notify = new NotifyClient({
  baseUrl: 'http://10.0.0.5:8787',
  secret: 'top-secret',
  timeoutMs: 3000,
});
```

### 批量推送

```ts
await notify.pushBatch([
  { source: 'import', title: '行 1', message: '...' },
  { source: 'import', title: '行 2', message: '...' },
  { source: 'import', title: '行 3', message: '...' },
]);
```

---

## 配方 5:Python 脚本对接

两种方式:直接 HTTP,或调 CLI 子进程。

### 方式 A:直接 HTTP(推荐,无需装 Node)

```python
import os, requests

# 地址优先读环境变量,避免写死端口(daemon 端口可能变动)
PANEL_URL = os.environ.get("NOTIFY_PANEL_URL", "http://localhost:8787")
SECRET = "top-secret"

def notify(source, title, message, severity="info"):
    requests.post(f"{PANEL_URL}/v1/notify",
        json={"source": source, "title": title, "message": message, "severity": severity},
        headers={"X-Notify-Secret": SECRET})

# 用法
notify("python", "ETL 任务", "数据处理完成", "success")
notify("python", "ETL 任务", "数据校验失败!", "error")
```

### 方式 B:调 CLI 子进程

```python
import subprocess

def notify(source, title, message, severity="info"):
    subprocess.run([
        "notify-panel", "push", source, title, message,
        "--severity", severity
    ], check=False)  # check=False:通知失败别让主程序崩

notify("python", "训练完成", "模型准确率 95%")
```

---

## 配方 6:Go 程序对接

直接用标准库 HTTP,零依赖。

```go
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
    "os"
)

func Notify(source, title, message, severity string) error {
    // 地址优先读环境变量,避免写死端口(daemon 端口可能变动)
    url := os.Getenv("NOTIFY_PANEL_URL")
    if url == "" {
        url = "http://localhost:8787"
    }
    payload, _ := json.Marshal(map[string]string{
        "source":   source,
        "title":    title,
        "message":  message,
        "severity": severity,
    })
    req, _ := http.NewRequest("POST", url+"/v1/notify", bytes.NewReader(payload))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-Notify-Secret", "top-secret")
    _, err := http.DefaultClient.Do(req)
    return err
}

func main() {
    Notify("go", "服务启动", "api-server 监听 :8080", "info")
}
```

---

## 配方 7:在 Docker 容器里推通知

容器内的服务想推通知给宿主机 daemon:

```bash
# 方式 1:用 host.docker.internal(macOS/Windows,或 Linux Docker 20.10+)
curl -X POST http://host.docker.internal:8787/v1/notify ...

# 方式 2:设环境变量,SDK 自动用
docker run -e NOTIFY_PANEL_URL=http://host.docker.internal:8787 my-app
```

---

## 配方 8:多来源统一查看

把不同来源的通知都推过来,然后用 `list --source` 分类查看:

```bash
# 模拟各种来源
notify-panel push wechat 张三 "需求确认"
notify-panel push ci build "#100 ok" --severity success
notify-panel push backup 备份 "完成"
notify-panel push monitor 内存 "告警" --severity warning
notify-panel push cron 清理 "临时文件已清"

# 按来源看
notify-panel list --source ci       # 只看 CI
notify-panel list --source monitor  # 只看监控

# 只看需要关注的
notify-panel list --severity error
notify-panel list --unread
```

---

## 常见集成模式总结

| 场景 | 推荐方式 | 原因 |
|------|---------|------|
| shell 脚本 / cron | CLI `push` | 一行命令,零额外代码 |
| CI/CD pipeline | CLI 或 curl | runner 不一定有 npm |
| TS/JS 项目 | SDK | 类型安全、自动发现 |
| Python / Go / 其它 | 裸 HTTP | 不依赖 Node 生态 |
| Docker 容器 | 裸 HTTP + 环境变量 | 隔离环境,发现靠 env |
| 老旧系统 | shell out 到 CLI | 不改语言、不加依赖 |

更多命令细节见 [CLI 命令参考](./cli-reference.md)。
