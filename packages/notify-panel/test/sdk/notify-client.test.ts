import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotifyClient, NotifyError } from '../../src/sdk';
import { createServer } from '../../src/server';

// 起一个真实 daemon 给 SDK 打
let base: string;
let secret: string;
let cleanup: () => Promise<void>;
let panel: import('@notify-panel/core').NotifyPanel;

beforeAll(async () => {
  const running = await createServer({ port: 0, secret: 'test-secret', silent: true });
  base = running.info.url;
  secret = running.info.secret!;
  panel = running.panel;
  cleanup = running.close;
});

afterAll(async () => {
  await cleanup();
});

describe('NotifyClient 构造', () => {
  it('显式 baseUrl + secret', () => {
    const c = new NotifyClient({ baseUrl: 'http://x:1234', secret: 's' });
    expect(c.endpoint).toBe('http://x:1234');
  });

  it('baseUrl 末尾斜杠被去掉', () => {
    const c = new NotifyClient({ baseUrl: 'http://x:1234/' });
    expect(c.endpoint).toBe('http://x:1234');
  });
});

describe('push', () => {
  it('推送成功返回 Notification', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const n = await c.push({ source: 'ci', title: 't', message: 'm' });
    expect(n.id).toBeTruthy();
    expect(n.source).toBe('ci');
  });

  it('数据真的进了 panel', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const before = panel.list().length;
    await c.push({ source: 'sdk', title: 't', message: 'm' });
    expect(panel.list().length).toBe(before + 1);
  });

  it('非法载荷本地拦截,抛 NotifyError(VALIDATION_ERROR),不发请求', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const before = panel.list().length;
    await expect(c.push({ source: '', title: 't', message: 'm' } as any)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(panel.list().length).toBe(before); // 没发出去
  });
});

describe('pushBatch', () => {
  it('批量推送', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const items = await c.pushBatch([
      { source: 'b', title: '1', message: 'm' },
      { source: 'b', title: '2', message: 'm' },
      { source: 'b', title: '3', message: 'm' },
    ]);
    expect(items).toHaveLength(3);
  });

  it('空数组直接返回空(不发请求)', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const items = await c.pushBatch([]);
    expect(items).toEqual([]);
  });
});

describe('ping', () => {
  it('在线返回 true', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    expect(await c.ping()).toBe(true);
  });

  it('离线返回 false', async () => {
    const c = new NotifyClient({ baseUrl: 'http://127.0.0.1:1', secret });
    expect(await c.ping()).toBe(false);
  });
});

describe('鉴权错误', () => {
  it('secret 错误抛 NotifyError(UNAUTHORIZED)', async () => {
    const c = new NotifyClient({ baseUrl: base, secret: 'wrong' });
    await expect(c.push({ source: 'x', title: 't', message: 'm' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('NotifyError 带 httpStatus', async () => {
    const c = new NotifyClient({ baseUrl: base, secret: 'wrong' });
    try {
      await c.push({ source: 'x', title: 't', message: 'm' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NotifyError);
      expect((e as NotifyError).httpStatus).toBe(401);
    }
  });
});

describe('自动发现', () => {
  it('不传 baseUrl 时走发现机制(本测试环境会用默认值,可能连不上 → 构造成功但 ping=false)', () => {
    // 设环境变量指向真实 daemon,验证层级1优先级
    process.env.NOTIFY_PANEL_URL = base;
    const c = new NotifyClient();
    expect(c.endpoint).toBe(base);
    delete process.env.NOTIFY_PANEL_URL;
  });

  it('NOTIFY_PANEL_URL 带末尾斜杠也能用', () => {
    process.env.NOTIFY_PANEL_URL = `${base}/`;
    const c = new NotifyClient();
    expect(c.endpoint).toBe(base);
    delete process.env.NOTIFY_PANEL_URL;
  });
});

// ---- 新增:查询 / 状态管理方法 ----

describe('get - 单条查询', () => {
  it('按 id 返回通知', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const n = await c.push({ source: 'ci', title: 't', message: 'm' });
    const got = await c.get(n.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(n.id);
  });

  it('不存在的 id 返回 null', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    expect(await c.get('nope-id')).toBeNull();
  });
});

describe('list - 查询', () => {
  it('返回 items 和 total', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const r = await c.list();
    expect(Array.isArray(r.items)).toBe(true);
    expect(typeof r.total).toBe('number');
    expect(r.total).toBe(r.items.length);
  });

  it('按 source 过滤', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    await c.push({ source: 'unique-list-src', title: 't', message: 'm' });
    const r = await c.list({ source: 'unique-list-src' });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((n) => n.source === 'unique-list-src')).toBe(true);
  });

  it('按 severity / unreadOnly / keyword 过滤', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    await c.push({ source: 'kf', title: '关键词命中', message: 'x', severity: 'error' });
    const bySev = await c.list({ severity: 'error' });
    expect(bySev.items.every((n) => n.severity === 'error')).toBe(true);
    const byKw = await c.list({ keyword: '关键词命中' });
    expect(byKw.items.length).toBeGreaterThan(0);
  });
});

describe('状态管理', () => {
  it('markRead / markAllRead', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const n1 = await c.push({ source: 'r', title: '1', message: 'm' });
    await c.push({ source: 'r', title: '2', message: 'm' });

    const updated = await c.markRead(n1.id);
    expect(updated.read).toBe(true);

    await c.markAllRead();
    const r = await c.list({ source: 'r' });
    expect(r.items.every((n) => n.read)).toBe(true);
  });

  it('markRead 不存在的 id 抛 NOT_FOUND', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    await expect(c.markRead('nope-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('archive', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const n = await c.push({ source: 'a', title: 't', message: 'm' });
    const updated = await c.archive(n.id);
    expect(updated.archived).toBe(true);
    const updated2 = await c.archive(n.id, false);
    expect(updated2.archived).toBe(false);
  });

  it('remove 返回 true/false', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    const n = await c.push({ source: 'd', title: 't', message: 'm' });
    expect(await c.remove(n.id)).toBe(true);
    expect(await c.remove(n.id)).toBe(false); // 再删返回 false
  });
});

describe('clear', () => {
  it('清空后列表为空', async () => {
    const c = new NotifyClient({ baseUrl: base, secret });
    await c.push({ source: 'c', title: 't', message: 'm' });
    await c.clear();
    const r = await c.list({ source: 'c' });
    expect(r.items).toHaveLength(0);
  });
});

describe('shutdown', () => {
  it('shutdown 发出请求后 daemon 响应 200', async () => {
    // 起一个独立 daemon,关闭「退出进程」(避免在 vitest 里 process.exit)
    const { info, close } = await createServer({
      port: 0, secret: 'sh-secret', silent: true, exitOnShutdown: false,
    });
    const c = new NotifyClient({ baseUrl: info.url, secret: 'sh-secret' });
    await c.shutdown(); // 不抛错即成功
    await close();
  });
});
