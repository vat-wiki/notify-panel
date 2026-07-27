import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotifyPanel } from '../../src/core';
import { buildApp } from '../../src/server';

/**
 * 起一个真实 Fastify app 跑路由,用 fetch 打它。
 */
async function start(panel: NotifyPanel, secret?: string) {
  const app = await buildApp(panel, { secret });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as any).port;
  return { app, base: `http://127.0.0.1:${port}` };
}

function close(app: import('fastify').FastifyInstance): Promise<void> {
  return app.close();
}

let panel: NotifyPanel;
let app: import('fastify').FastifyInstance;
let base: string;

beforeEach(async () => {
  panel = new NotifyPanel();
  ({ app, base } = await start(panel));
});

afterEach(async () => {
  await close(app);
});

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const resp = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, body: json };
}

describe('POST /v1/notify - 单条推送', () => {
  it('合法载荷返回 201 + accepted', async () => {
    const { status, body } = await req('POST', '/v1/notify', { source: 'ci', title: 't', message: 'm' });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.accepted).toHaveLength(1);
    expect(body.accepted[0].id).toBeTruthy();
  });

  it('数据真的进了 panel', async () => {
    await req('POST', '/v1/notify', { source: 'ci', title: 't', message: 'm' });
    expect(panel.list()).toHaveLength(1);
  });

  it('非法载荷返回 400 + VALIDATION_ERROR', async () => {
    const { status, body } = await req('POST', '/v1/notify', { title: '缺 source' });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.fields.source).toBeTruthy();
  });
});

describe('POST /v1/notify/batch - 批量', () => {
  it('批量推送成功', async () => {
    const { status, body } = await req('POST', '/v1/notify/batch', {
      source: 'ci',
      items: [
        { title: '1', message: 'm' },
        { title: '2', message: 'm' },
      ],
    });
    expect(status).toBe(201);
    expect(body.accepted).toHaveLength(2);
  });

  it('空 items 返回 400', async () => {
    const { status } = await req('POST', '/v1/notify/batch', { source: 'ci', items: [] });
    expect(status).toBe(400);
  });
});

describe('GET /v1/notify - 查询', () => {
  beforeEach(() => {
    panel.push({ source: 'wechat', title: 'a', message: 'm' });
    panel.push({ source: 'ci', title: 'b', message: 'fail', severity: 'error' });
    panel.push({ source: 'ci', title: 'c', message: 'ok', severity: 'success' });
  });

  it('返回全部', async () => {
    const { status, body } = await req('GET', '/v1/notify');
    expect(status).toBe(200);
    expect(body.items).toHaveLength(3);
    expect(body.total).toBe(3);
  });

  it('?source= 过滤', async () => {
    const { body } = await req('GET', '/v1/notify?source=ci');
    expect(body.items).toHaveLength(2);
    expect(body.items.every((n: any) => n.source === 'ci')).toBe(true);
  });

  it('?severity= 过滤', async () => {
    const { body } = await req('GET', '/v1/notify?severity=error');
    expect(body.items).toHaveLength(1);
  });

  it('?unread=true 过滤', async () => {
    // 标记一条已读
    panel.markRead(panel.list()[0].id);
    const { body } = await req('GET', '/v1/notify?unread=true');
    expect(body.items).toHaveLength(2);
  });

  it('?keyword= 过滤', async () => {
    const { body } = await req('GET', '/v1/notify?keyword=fail');
    expect(body.items).toHaveLength(1);
  });
});

describe('GET 单条查询', () => {
  it('GET /v1/notify/:id 返回该通知', async () => {
    const n = panel.push({ source: 'ci', title: 't', message: 'm' });
    const { status, body } = await req('GET', `/v1/notify/${n.id}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.accepted[0].id).toBe(n.id);
  });

  it('GET /v1/notify/:id 不存在返回 404', async () => {
    const { status, body } = await req('GET', '/v1/notify/nope');
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH - 状态修改', () => {
  it('PATCH /v1/notify/:id 改已读', async () => {
    const n = panel.push({ source: 'x', title: 't', message: 'm' });
    const { status, body } = await req('PATCH', `/v1/notify/${n.id}`, { read: true });
    expect(status).toBe(200);
    expect(body.accepted[0].read).toBe(true);
  });

  it('PATCH /v1/notify/:id 改归档', async () => {
    const n = panel.push({ source: 'x', title: 't', message: 'm' });
    await req('PATCH', `/v1/notify/${n.id}`, { archived: true });
    expect(panel.get(n.id)!.archived).toBe(true);
  });

  it('PATCH 不存在的 id 返回 404', async () => {
    const { status, body } = await req('PATCH', '/v1/notify/nope', { read: true });
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /v1/notify 全部已读', async () => {
    panel.push({ source: 'x', title: '1', message: 'm' });
    panel.push({ source: 'x', title: '2', message: 'm' });
    const { status } = await req('PATCH', '/v1/notify', { allRead: true });
    expect(status).toBe(200);
    expect(panel.unreadCount()).toBe(0);
  });
});

describe('DELETE - 删除', () => {
  it('DELETE /v1/notify/:id 删一条', async () => {
    const n = panel.push({ source: 'x', title: 't', message: 'm' });
    const { status, body } = await req('DELETE', `/v1/notify/${n.id}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(panel.get(n.id)).toBeUndefined();
  });

  it('DELETE 不存在的 id 返回 404', async () => {
    const { status } = await req('DELETE', '/v1/notify/nope');
    expect(status).toBe(404);
  });

  it('DELETE /v1/notify 清空', async () => {
    panel.push({ source: 'x', title: '1', message: 'm' });
    panel.push({ source: 'x', title: '2', message: 'm' });
    await req('DELETE', '/v1/notify');
    expect(panel.list()).toHaveLength(0);
  });
});

describe('404 / 路由', () => {
  it('未知路径返回 404', async () => {
    const { status, body } = await req('GET', '/unknown');
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('CORS', () => {
  const preflightHeaders = {
    Origin: 'http://localhost:3000',
    'Access-Control-Request-Method': 'POST',
  };

  it('OPTIONS 预检返回 204 + CORS 头', async () => {
    const resp = await fetch(`${base}/v1/notify`, {
      method: 'OPTIONS',
      headers: preflightHeaders,
    });
    expect(resp.status).toBe(204);
    expect(resp.headers.get('access-control-allow-origin')).toBe('*');
    expect(resp.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('预检允许 PATCH / DELETE(给浏览器跨域用)', async () => {
    const resp = await fetch(`${base}/v1/notify`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'PATCH',
      },
    });
    const methods = resp.headers.get('access-control-allow-methods') ?? '';
    expect(methods).toContain('PATCH');
    expect(methods).toContain('DELETE');
  });
});

describe('鉴权(secret)', () => {
  it('设了 secret 但请求没带 → 401', async () => {
    await close(app);
    ({ app, base } = await start(panel, 'top-secret'));
    const { status, body } = await req('POST', '/v1/notify', { source: 'x', title: 't', message: 'm' });
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('带正确 secret 通过', async () => {
    await close(app);
    ({ app, base } = await start(panel, 'top-secret'));
    const { status } = await req('POST', '/v1/notify', { source: 'x', title: 't', message: 'm' }, {
      'X-Notify-Secret': 'top-secret',
    });
    expect(status).toBe(201);
  });
});

describe('onShutdown', () => {
  it('DELETE /v1/daemon 触发回调', async () => {
    let called = false;
    await close(app);
    app = await buildApp(panel, { onShutdown: () => (called = true) });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as any).port;
    base = `http://127.0.0.1:${port}`;

    const { status } = await req('DELETE', '/v1/daemon');
    expect(status).toBe(200);
    // 给回调执行的机会(它是同步调的,但 fetch 返回前可能没执行)
    expect(called).toBe(true);
  });
});
