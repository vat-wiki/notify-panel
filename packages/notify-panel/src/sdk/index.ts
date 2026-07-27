import {
  validateNotifyPayload,
  discoverServer,
  type NotifyPayload,
  type Notification,
  type Severity,
  type ServerInfo,
} from '../protocol';

/**
 * `notify-panel/sdk` —— HTTP API 的完整封装。
 *
 * 这是给「集成方」(想把通知推过来的人)用的模块。
 * 它封装了 daemon 暴露的**全部** HTTP 端点，对外提供类型安全的 API，
 * 内部统一处理：自动发现、本地校验、鉴权、超时、错误。
 *
 * 最简单的用法（零配置，自动发现本地面板）：
 * ```ts
 * import { NotifyClient } from 'notify-panel/sdk';
 * const client = new NotifyClient();
 * await client.push({ source: 'wechat', title: '张三', message: '在吗' });
 * const list = await client.list({ unreadOnly: true });
 * await client.markRead(id);
 * ```
 *
 * 显式指定地址(测试 / 远程部署):
 * ```ts
 * const client = new NotifyClient({ baseUrl: 'http://10.0.0.5:8787', secret: 'xxx' });
 * ```
 */
export interface ClientOptions {
  /** 面板地址。不传则走发现机制(环境变量 NOTIFY_PANEL_URL > 端口文件 > 默认值) */
  baseUrl?: string;
  /** 共享密钥;不传则用发现机制读到的 secret */
  secret?: string;
  /** 发现面板时是否允许回退到默认地址,默认 true */
  useDefault?: boolean;
  /** 请求超时(毫秒),默认 5000 */
  timeoutMs?: number;
}

/** list 查询条件(映射到 GET 查询参数) */
export interface ListOptions {
  source?: string;
  severity?: Severity;
  unreadOnly?: boolean;
  /** 只返回这个时间点之后的 */
  since?: number;
  /** 关键词(匹配 title / message) */
  keyword?: string;
}

export interface ListResult {
  items: Notification[];
  total: number;
}

export type { NotifyPayload, Notification, Severity, ServerInfo } from '../protocol';

export class NotifyClient {
  private baseUrl: string;
  private secret?: string;
  private timeoutMs: number;

  constructor(opts: ClientOptions = {}) {
    if (opts.baseUrl) {
      this.baseUrl = opts.baseUrl.replace(/\/$/, '');
      this.secret = opts.secret;
    } else {
      // 自动发现本地面板
      const info = discoverServer({ useDefault: opts.useDefault ?? true });
      this.baseUrl = (info?.url ?? '').replace(/\/$/, '');
      this.secret = opts.secret ?? info?.secret;
    }
    this.timeoutMs = opts.timeoutMs ?? 5000;

    if (!this.baseUrl) {
      throw new Error(
        '[NotifyClient] 未找到面板地址。请设置 NOTIFY_PANEL_URL 环境变量,或显式传入 baseUrl。',
      );
    }
  }

  /** 实际连接的面板地址 */
  get endpoint(): string {
    return this.baseUrl;
  }

  // ---------------- 写入 ----------------

  /** 推送一条通知。本地先校验,非法直接抛错不发请求。 */
  async push(payload: NotifyPayload): Promise<Notification> {
    const result = validateNotifyPayload(payload);
    if (!result.valid) {
      throw new NotifyError('VALIDATION_ERROR', 'payload invalid', result.errors);
    }
    const body = await this.request<{ accepted: Notification[] }>('POST', '/v1/notify', result.value);
    return body.accepted[0];
  }

  /** 批量推送(同一 source)。 */
  async pushBatch(items: NotifyPayload[]): Promise<Notification[]> {
    if (items.length === 0) return [];
    const source = items[0].source;
    const body = await this.request<{ accepted: Notification[] }>('POST', '/v1/notify/batch', {
      source,
      items,
    });
    return body.accepted ?? [];
  }

  // ---------------- 查询 ----------------

  /** 按 id 获取单条 */
  async get(id: string): Promise<Notification | null> {
    const resp = await this.fetchRaw('GET', `/v1/notify/${encodeURIComponent(id)}`);
    if (resp.status === 404) return null;
    const body = (await this.parseErrorAware(resp)) as { accepted: Notification[] };
    return body.accepted?.[0] ?? null;
  }

  /** 列表查询,支持过滤 */
  async list(options: ListOptions = {}): Promise<ListResult> {
    const params = new URLSearchParams();
    if (options.source) params.set('source', options.source);
    if (options.severity) params.set('severity', options.severity);
    if (options.unreadOnly) params.set('unread', '1');
    if (options.since != null) params.set('since', String(options.since));
    if (options.keyword) params.set('keyword', options.keyword);
    const qs = params.size ? `?${params}` : '';
    const body = await this.request<{ items: Notification[]; total: number }>('GET', `/v1/notify${qs}`);
    return body;
  }

  // ---------------- 状态 ----------------

  /** 标记已读 / 未读 */
  async markRead(id: string, read = true): Promise<Notification> {
    return this.patchId(id, { read });
  }

  /** 全部已读 */
  async markAllRead(): Promise<void> {
    await this.request('PATCH', '/v1/notify', { allRead: true });
  }

  /** 归档 / 取消归档 */
  async archive(id: string, archived = true): Promise<Notification> {
    return this.patchId(id, { archived });
  }

  /** 删除一条 */
  async remove(id: string): Promise<boolean> {
    const resp = await this.fetchRaw('DELETE', `/v1/notify/${encodeURIComponent(id)}`);
    if (resp.status === 404) return false;
    await this.parseErrorAware(resp);
    return true;
  }

  /** 清空所有 */
  async clear(): Promise<void> {
    await this.request('DELETE', '/v1/notify');
  }

  // ---------------- 运维 ----------------

  /** 健康检查:面板是否在线 */
  async ping(): Promise<boolean> {
    try {
      const resp = await this.fetchRaw('GET', '/v1/notify');
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** 请求 daemon 优雅关闭(对应 DELETE /v1/daemon) */
  async shutdown(): Promise<void> {
    await this.request('DELETE', '/v1/daemon');
  }

  // ---------------- 内部 ----------------

  /** PATCH /v1/notify/:id 的内部封装 */
  private async patchId(
    id: string,
    body: { read?: boolean; archived?: boolean },
  ): Promise<Notification> {
    const result = await this.request<{ accepted: Notification[] }>(
      'PATCH',
      `/v1/notify/${encodeURIComponent(id)}`,
      body,
    );
    return result.accepted[0];
  }

  /** 发请求并解析,非 2xx 或 ok:false 抛 NotifyError */
  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const resp = await this.fetchRaw(method, path, body);
    return (await this.parseErrorAware(resp)) as T;
  }

  private async parseErrorAware(resp: Response): Promise<any> {
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.ok === false) {
      const code = json?.error?.code ?? 'HTTP_ERROR';
      const message = json?.error?.message ?? `HTTP ${resp.status}`;
      throw new NotifyError(code, message, json?.error?.fields, resp.status);
    }
    return json;
  }

  private async fetchRaw(method: string, path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.secret) headers['X-Notify-Secret'] = this.secret;
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * SDK 抛出的统一错误,带 code 方便集成方区分「校验失败 / 网络错 / 鉴权失败」。
 */
export class NotifyError extends Error {
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly httpStatus?: number;

  constructor(code: string, message: string, fields?: Record<string, string>, httpStatus?: number) {
    super(`[${code}] ${message}`);
    this.name = 'NotifyError';
    this.code = code;
    this.fields = fields;
    this.httpStatus = httpStatus;
  }
}

/** 便捷工厂:读端口文件拿到面板信息(不创建 client) */
export function discoverPanel(): ServerInfo | null {
  return discoverServer();
}
