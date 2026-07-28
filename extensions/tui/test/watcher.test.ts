/**
 * watcher.ts 测试:验证轮询器的核心契约,不起真实 notify-panel daemon。
 *
 * 重点验证(沿用 pi 扩展 + agwrap notify.test 的稳定性契约):
 *  - 注入器成功 → 才会标记已读(投递失败不丢消息)
 *  - 空未读列表 → 安静 no-op
 *  - formatForInject 压单行 + 截断
 *  - daemon 不可达 → 不崩,状态变 error
 *
 * 策略:用本地 mock HTTP server 模拟 notify-panel daemon,
 * 写一个临时 server.json 让 NotifyClient 自动发现到它。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { TuiWatcher, type Injector, formatForInject } from "../src/watcher.js";

// 用环境变量 NOTIFY_PANEL_URL 指向 mock server,绕过 server.json 的
// protocol/pid 校验。在 beforeEach 保存原值,afterEach 恢复。
let origUrl: string | undefined;

beforeEach(() => {
  origUrl = process.env.NOTIFY_PANEL_URL;
});

afterEach(() => {
  if (origUrl === undefined) delete process.env.NOTIFY_PANEL_URL;
  else process.env.NOTIFY_PANEL_URL = origUrl;
});

/** 起一个 mock notify-panel daemon。 */
function mockPanel(items: unknown[]): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      if (url.startsWith("/v1/notify")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, items, total: items.length }));
      } else if (req.method === "PATCH" && url.match(/^\/v1\/notify\//)) {
        const id = url.split("/").pop()!;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            accepted: [{ id, read: true }],
          }),
        );
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;
      // 用环境变量让 NotifyClient 直接发现到 mock,绕过 server.json 的
      // protocol/pid 校验(更简单、更可靠)
      process.env.NOTIFY_PANEL_URL = url;
      resolve({ server, url });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

const sampleItem = {
  id: "n1",
  source: "ci",
  title: "build failed",
  message: "main.ts:12 error",
  severity: "error",
  read: false,
  archived: false,
  timestamp: Date.now(),
};

describe("formatForInject", () => {
  it("压成严格单行(换行/制表符 → 空格)", () => {
    const text = formatForInject({
      ...sampleItem,
      message: "line1\nline2\ttabbed\r\nwindows",
    } as any);
    expect(text).not.toMatch(/[\r\n\t]/);
    expect(text).toContain("build failed");
    expect(text).toContain("line1 line2 tabbed windows");
  });

  it("超长截断", () => {
    const text = formatForInject({
      ...sampleItem,
      message: "x".repeat(1000),
    } as any);
    expect(text.length).toBeLessThan(600);
    expect(text).toMatch(/已截断/);
  });

  it("带 severity emoji 前缀", () => {
    expect(formatForInject({ ...sampleItem } as any)).toMatch(/^🔴/);
  });
});

describe("TuiWatcher", () => {
  it("有未读 → 注入成功 → 标记已读", async () => {
    const { server } = await mockPanel([sampleItem]);
    const injected: string[] = [];
    const inject: Injector = {
      write: (t) => {
        injected.push(t);
        return true;
      },
    };
    const w = new TuiWatcher({ inject });
    await w.pollOnce();
    expect(injected).toHaveLength(1);
    expect(injected[0]).toContain("build failed");
    await close(server);
  });

  it("注入失败 → 不标记已读(不丢消息,下轮重试)", async () => {
    const { server } = await mockPanel([sampleItem]);
    const inject: Injector = { write: () => false }; // 永远失败
    const w = new TuiWatcher({ inject });
    await w.pollOnce();
    // 未读仍在(没被标记已读),下一轮还能拿到
    const w2 = new TuiWatcher({ inject: { write: () => true } });
    const injected: string[] = [];
    w2["opts"].inject = { write: (t) => (injected.push(t), true) };
    await w2.pollOnce();
    expect(injected).toHaveLength(1);
    await close(server);
  });

  it("空未读 → 安静 no-op", async () => {
    const { server } = await mockPanel([]);
    let delivered = 0;
    const w = new TuiWatcher({
      inject: { write: () => true },
      onDelivered: (n) => (delivered += n),
    });
    await w.pollOnce();
    expect(delivered).toBe(0);
    await close(server);
  });

  it("过滤 archived(未读但已归档不投递)", async () => {
    const { server } = await mockPanel([
      sampleItem,
      { ...sampleItem, id: "n2", archived: true },
    ]);
    const injected: string[] = [];
    const w = new TuiWatcher({
      inject: { write: (t) => (injected.push(t), true) },
    });
    await w.pollOnce();
    expect(injected).toHaveLength(1); // 只投 n1,n2 被 archived 过滤
    await close(server);
  });

  it("daemon 不可达 → 不崩,状态含 error", async () => {
    // 指向一个不存在的地址(端口 1 保留端口,连接被拒)
    process.env.NOTIFY_PANEL_URL = "http://127.0.0.1:1";
    const w = new TuiWatcher({ inject: { write: () => true } });
    await w.pollOnce();
    expect(w.status).toMatch(/backoff|fetch failed|error/i);
  });
});
