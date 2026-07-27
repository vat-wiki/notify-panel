/**
 * HTTP 层 —— 基于 Fastify。
 *
 * 用框架后职责清晰:
 *   - 路由声明式注册,顺序无关(不再有 if/startsWith 的脆弱顺序)
 *   - JSON body 解析、CORS、错误序列化全由框架处理
 *   - schema 校验交给 @notify-panel/protocol(保留单一校验来源)
 *
 * 同时保留 createHttpHandler() 作为「无框架依赖」的兼容入口,
 * 把请求桥接到 Fastify 实例,旧测试 / 外部库用法不受影响。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { NotifyPanel } from '../core';
import {
  HTTP_PATH,
  MEDIA_TYPE,
  validateNotifyPayload,
  validateNotifyBatch,
  type Notification,
  type NotifyResponse,
  type NotifyError,
  type Severity,
} from '../protocol';

export interface ServerOptions {
  /** 共享密钥,设置后请求需带 X-Notify-Secret 头 */
  secret?: string;
  /** CORS 允许的 origin,默认 '*' */
  corsOrigin?: string;
  /** 收到 shutdown 请求时的回调(CLI stop / DELETE /v1/daemon 触发) */
  onShutdown?: () => void;
}

/** 把所有路由注册到给定 Fastify 实例上(供 createServer 复用同一 app) */
export function registerRoutes(app: FastifyInstance, panel: NotifyPanel, opts: ServerOptions = {}): void {
  const { secret, onShutdown } = opts;

  // 鉴权 hook:所有路由统一检查 secret(OPTIONS 预检不鉴权)
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return;
    if (secret && req.headers['x-notify-secret'] !== secret) {
      reply.code(401).send(errorBody('UNAUTHORIZED', 'invalid or missing X-Notify-Secret'));
    }
  });

  // ---------------- 写入 ----------------

  // POST /v1/notify  单条
  app.post(HTTP_PATH, async (req, reply) => {
    const result = validateNotifyPayload(req.body);
    if (!result.valid) {
      return reply.code(400).send(errorBody('VALIDATION_ERROR', 'payload invalid', result.errors));
    }
    try {
      const n = panel.push(result.value);
      return reply.code(201).send(okBody([n]));
    } catch (e: any) {
      return reply.code(400).send(errorBody(e.code ?? 'INTERNAL', e.message));
    }
  });

  // POST /v1/notify/batch  批量
  app.post(`${HTTP_PATH}/batch`, async (req, reply) => {
    const result = validateNotifyBatch(req.body);
    if (!result.valid) {
      return reply.code(400).send(errorBody('VALIDATION_ERROR', 'batch invalid', result.errors));
    }
    const accepted = panel.pushBatch(result.value.items);
    return reply.code(201).send(okBody(accepted));
  });

  // ---------------- 查询 ----------------

  // GET /v1/notify  列表(带过滤)
  app.get(HTTP_PATH, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const items = panel.list({
      source: q.source,
      severity: q.severity as Severity | undefined,
      unreadOnly: q.unread === '1' || q.unread === 'true',
      since: q.since ? Number(q.since) : undefined,
      keyword: q.keyword,
    });
    return reply.send({ ok: true, items, total: items.length });
  });

  // GET /v1/notify/:id  单条
  app.get(`${HTTP_PATH}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const n = panel.get(id);
    if (!n) return reply.code(404).send(errorBody('NOT_FOUND', `notification ${id} not found`));
    return reply.send(okBody([n]));
  });

  // ---------------- 状态 ----------------

  // PATCH /v1/notify  全部已读
  app.patch(HTTP_PATH, async (req, reply) => {
    const body = (req.body ?? {}) as { allRead?: boolean };
    if (body.allRead) panel.markAllRead();
    return reply.send({ ok: true });
  });

  // PATCH /v1/notify/:id  已读 / 归档
  app.patch(`${HTTP_PATH}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { read?: boolean; archived?: boolean };
    if (!panel.get(id)) {
      return reply.code(404).send(errorBody('NOT_FOUND', `notification ${id} not found`));
    }
    if (body.read != null) panel.markRead(id, body.read);
    if (body.archived != null) panel.archive(id, body.archived);
    return reply.send(okBody([panel.get(id)!]));
  });

  // ---------------- 删除 ----------------

  // DELETE /v1/notify/:id  删一条
  app.delete(`${HTTP_PATH}/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = panel.remove(id);
    return reply.code(ok ? 200 : 404).send({ ok });
  });

  // DELETE /v1/notify  清空全部
  app.delete(HTTP_PATH, async (_req, reply) => {
    panel.clear();
    return reply.send({ ok: true });
  });

  // DELETE /v1/daemon  关闭 daemon
  app.delete('/v1/daemon', async (_req, reply) => {
    await reply.send({ ok: true });
    onShutdown?.();
  });

  // 404 统一按协议格式返回
  app.setNotFoundHandler(async (req, reply) => {
    reply.code(404).send(errorBody('NOT_FOUND', `${req.method} ${req.url}`));
  });

  // 未捕获错误统一按协议格式返回
  app.setErrorHandler(async (err: Error, _req, reply) => {
    app.log.error(err);
    reply.code(500).send(errorBody('INTERNAL', String(err?.message ?? err)));
  });
}

/**
 * 构建一个挂好路由的 Fastify 实例(不监听端口)。
 * createServer() 和外部库用法共用。调用方自己 app.listen() 即可。
 */
export async function buildApp(panel: NotifyPanel, opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // 关掉框架自带的 body 大小限制带来的 415,我们信任协议校验
    bodyLimit: 1_000_000,
  });
  // 重写 content-type parser:对空 body 返回 {}(避免 DELETE 带空 Content-Type 报 400)
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = body as string;
      if (!text || text.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
  await app.register(cors, {
    origin: opts.corsOrigin ?? '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Notify-Secret'],
  });
  registerRoutes(app, panel, opts);
  return app;
}

// ---------- 响应体 helpers(协议统一格式) ----------

function okBody(accepted: Notification[]): NotifyResponse {
  return { ok: true, accepted };
}

function errorBody(code: string, message: string, fields?: Record<string, string>): NotifyError {
  return { ok: false, error: { code, message, fields } };
}

/** 媒体类型常量,供需要手动设置 Content-Type 的调用方使用 */
export { MEDIA_TYPE };
