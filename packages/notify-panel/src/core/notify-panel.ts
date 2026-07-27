import { TypedEmitter } from './emitter';
import type { NotificationStorage } from './storage';
import {
  validateNotifyPayload,
  type Notification,
  type NotifyPayload,
  type Severity,
  type PanelEvent,
} from '../protocol';

/**
 * core 包对外暴露的事件。
 *
 * 提供两套等价的订阅方式:
 *   1. 具名事件(推荐,类型精确、写法直观):
 *        panel.on('notification', (n) => ...)
 *   2. 协议统一事件(给 server / 录制 / 跨进程转发用):
 *        panel.on('event', (e) => ...)
 *
 * 任何状态变化都会同时走这两个频道。
 */
export interface CoreEvents {
  /** 新单条通知到达 */
  notification: Notification;
  /** 批量新通知到达(pushBatch 的一次性聚合) */
  notifications: Notification[];
  /** 已读状态变化 */
  read: { id: string; read: boolean };
  /** 归档状态变化 */
  archived: { id: string; archived: boolean };
  /** 通知被删除 */
  removed: { id: string };
  /** 全部清空 */
  cleared: void;
  /** 全部已读 */
  allRead: void;
  /** 协议统一事件:上面任一变化都会同时发,载荷是 PanelEvent */
  event: PanelEvent;
}

/**
 * NotifyPanel 核心引擎。
 *
 * 最简单的用法(当库直接用):
 * ```ts
 * import { NotifyPanel } from '@notify-panel/core';
 * const panel = new NotifyPanel();
 * panel.on('notification', (n) => console.log(n.title, n.message));
 * panel.push({ source: 'wechat', title: '张三', message: '在吗' });
 * ```
 *
 * 如果要做跨进程/跨语言对接,再叠加 @notify-panel/server。
 */
export class NotifyPanel extends TypedEmitter<CoreEvents> {
  private store = new Map<string, Notification>();
  private seq = 0;
  private maxItems: number;
  private storage?: NotificationStorage;

  constructor(opts: { maxItems?: number; storage?: NotificationStorage } = {}) {
    super();
    this.maxItems = opts.maxItems ?? 500;
    this.storage = opts.storage;
    if (this.storage) {
      // 启动时从存储恢复
      for (const n of this.storage.load()) {
        this.store.set(n.id, n);
      }
      // 任何变更 → 防抖落盘
      this.on('event', () => this.persist());
    }
  }

  /** 把当前所有通知落盘(防抖) */
  private persist(): void {
    if (!this.storage) return;
    this.storage.save([...this.store.values()]);
  }

  /** 退出前调用:强制把缓冲的写入完成 */
  async shutdown(): Promise<void> {
    this.storage?.flush();
    this.destroy();
  }

  // ---------------- 写入 ----------------

  /**
   * 推入一条通知。内部会先按协议校验,非法则抛错。
   */
  push(payload: NotifyPayload): Notification {
    const result = validateNotifyPayload(payload);
    if (!result.valid) {
      const err = new Error('invalid payload: ' + JSON.stringify(result.errors));
      (err as any).code = 'VALIDATION_ERROR';
      (err as any).fields = result.errors;
      throw err;
    }

    const n = this.normalize(result.value);
    this.store.set(n.id, n);
    this.evict();
    this.broadcast('notification', n, { type: 'notification', data: n });
    return n;
  }

  /** 批量推入(同一 source)。 */
  pushBatch(payloads: NotifyPayload[]): Notification[] {
    const items = payloads.map((p) => this.push(p));
    this.broadcast('notifications', items, { type: 'notifications', data: items });
    return items;
  }

  // ---------------- 状态 ----------------

  markRead(id: string, read = true): boolean {
    const n = this.store.get(id);
    if (!n) return false;            // 找不到
    if (n.read === read) return false; // 已是目标状态,无变化
    n.read = read;
    this.broadcast('read', { id, read }, { type: 'read', data: { id, read } });
    return true;
  }

  markAllRead(): void {
    for (const n of this.store.values()) {
      if (!n.read) {
        n.read = true;
        this.broadcast('read', { id: n.id, read: true }, { type: 'read', data: { id: n.id, read: true } });
      }
    }
    this.broadcast('allRead', undefined, { type: 'allRead' });
  }

  archive(id: string, archived = true): boolean {
    const n = this.store.get(id);
    if (!n) return false;
    if (n.archived === archived) return false;
    n.archived = archived;
    this.broadcast('archived', { id, archived }, { type: 'archived', data: { id, archived } });
    return true;
  }

  remove(id: string): boolean {
    const ok = this.store.delete(id);
    if (ok) this.broadcast('removed', { id }, { type: 'removed', data: { id } });
    return ok;
  }

  clear(): void {
    this.store.clear();
    this.broadcast('cleared', undefined, { type: 'cleared' });
  }

  // ---------------- 查询 ----------------

  get(id: string): Notification | undefined {
    return this.store.get(id);
  }

  /** 查询列表,支持过滤,已按时间倒序(最新在前) */
  list(filter?: {
    source?: string;
    severity?: Severity;
    unreadOnly?: boolean;
    since?: number;
    keyword?: string;
  }): Notification[] {
    let items = [...this.store.values()];
    if (filter) {
      const kw = filter.keyword?.toLowerCase();
      items = items.filter((n) => {
        if (filter.source && n.source !== filter.source) return false;
        if (filter.severity && n.severity !== filter.severity) return false;
        if (filter.unreadOnly && n.read) return false;
        if (filter.since != null && n.timestamp < filter.since) return false;
        if (kw && !`${n.title} ${n.message}`.toLowerCase().includes(kw)) return false;
        return true;
      });
    }
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** 便捷:未读列表 */
  unread(): Notification[] {
    return this.list({ unreadOnly: true });
  }

  /** 便捷:未读数量 */
  unreadCount(): number {
    let c = 0;
    for (const n of this.store.values()) if (!n.read) c++;
    return c;
  }

  destroy(): void {
    this.removeAllListeners();
  }

  // ---------------- 内部 ----------------

  /** 同时发具名事件 + 协议 event,保证两套订阅者都收到 */
  private broadcast<K extends keyof CoreEvents>(
    name: K,
    payload: CoreEvents[K],
    panelEvent: PanelEvent,
  ): void {
    this.emit(name, payload);
    this.emit('event', panelEvent);
  }

  private normalize(p: NotifyPayload): Notification {
    const id = p.id ?? this.genId();
    return {
      ...p,
      id,
      timestamp: p.timestamp ?? Date.now(),
      severity: p.severity ?? 'info',
      read: p.read ?? false,
      archived: p.archived ?? false,
    };
  }

  private genId(): string {
    this.seq += 1;
    return `n_${Date.now().toString(36)}_${this.seq.toString(36)}`;
  }

  private evict(): void {
    if (this.store.size <= this.maxItems) return;
    let oldestId: string | null = null;
    let oldestTs = Infinity;
    for (const [id, n] of this.store) {
      if (n.timestamp < oldestTs) {
        oldestTs = n.timestamp;
        oldestId = id;
      }
    }
    if (oldestId) {
      this.store.delete(oldestId);
      this.broadcast('removed', { id: oldestId }, { type: 'removed', data: { id: oldestId } });
    }
  }
}
