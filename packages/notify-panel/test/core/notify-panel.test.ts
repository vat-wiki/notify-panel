import { describe, it, expect, vi } from 'vitest';
import { NotifyPanel } from '../../src/core';
import type { PanelEvent } from '../../src/protocol';

const base = { source: 'ci', title: 't', message: 'm' };

describe('NotifyPanel - push', () => {
  it('push 返回回填后的完整通知', () => {
    const panel = new NotifyPanel();
    const n = panel.push(base);
    expect(n.id).toBeTruthy();
    expect(n.timestamp).toBeGreaterThan(0);
    expect(n.severity).toBe('info'); // 默认
    expect(n.read).toBe(false);
    expect(n.archived).toBe(false);
  });

  it('push 非法载荷抛 VALIDATION_ERROR', () => {
    const panel = new NotifyPanel();
    expect(() => panel.push({ source: '', title: 't', message: 'm' } as any)).toThrow();
  });

  it('push 自定义 severity 被保留', () => {
    const panel = new NotifyPanel();
    const n = panel.push({ ...base, severity: 'error' });
    expect(n.severity).toBe('error');
  });

  it('push 自定义 id 被保留', () => {
    const panel = new NotifyPanel();
    const n = panel.push({ ...base, id: 'my-id' });
    expect(n.id).toBe('my-id');
  });
});

describe('NotifyPanel - pushBatch', () => {
  it('批量推入返回多条', () => {
    const panel = new NotifyPanel();
    const items = panel.pushBatch([
      { ...base, title: '1' },
      { ...base, title: '2' },
      { ...base, title: '3' },
    ]);
    expect(items).toHaveLength(3);
  });

  it('其中一条非法会抛错(整体失败)', () => {
    const panel = new NotifyPanel();
    expect(() =>
      panel.pushBatch([{ ...base }, { source: '', title: 'x', message: 'y' } as any]),
    ).toThrow();
  });
});

describe('NotifyPanel - 查询', () => {
  it('list 默认按时间倒序', async () => {
    const panel = new NotifyPanel();
    const a = panel.push({ ...base, title: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = panel.push({ ...base, title: 'b' });
    const list = panel.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('list 按 source 过滤', () => {
    const panel = new NotifyPanel();
    panel.push({ ...base, source: 'wechat' });
    panel.push({ ...base, source: 'ci' });
    panel.push({ ...base, source: 'ci' });
    expect(panel.list({ source: 'ci' })).toHaveLength(2);
    expect(panel.list({ source: 'wechat' })).toHaveLength(1);
  });

  it('list 按 severity 过滤', () => {
    const panel = new NotifyPanel();
    panel.push({ ...base, severity: 'error' });
    panel.push({ ...base, severity: 'info' });
    expect(panel.list({ severity: 'error' })).toHaveLength(1);
  });

  it('list keyword 匹配 title 或 message', () => {
    const panel = new NotifyPanel();
    panel.push({ ...base, title: '构建失败', message: 'x' });
    panel.push({ ...base, title: 'x', message: '部署失败' });
    panel.push({ ...base, title: '无关', message: '无关' });
    const r = panel.list({ keyword: '失败' });
    expect(r).toHaveLength(2);
  });

  it('unread / unreadCount', () => {
    const panel = new NotifyPanel();
    panel.push(base);
    panel.push(base);
    panel.markRead(panel.list()[0].id);
    expect(panel.unread()).toHaveLength(1);
    expect(panel.unreadCount()).toBe(1);
  });

  it('since 过滤', () => {
    const panel = new NotifyPanel();
    const old = panel.push(base);
    panel.push({ ...base, timestamp: Date.now() + 100000 });
    const r = panel.list({ since: old.timestamp + 1 });
    expect(r).toHaveLength(1);
  });
});

describe('NotifyPanel - 状态管理', () => {
  it('markRead 改变 read 状态', () => {
    const panel = new NotifyPanel();
    const n = panel.push(base);
    expect(panel.markRead(n.id)).toBe(true);
    expect(panel.get(n.id)!.read).toBe(true);
  });

  it('markRead 幂等:已是目标状态返回 false', () => {
    const panel = new NotifyPanel();
    const n = panel.push(base);
    panel.markRead(n.id);
    expect(panel.markRead(n.id)).toBe(false); // 已是 read,再 mark true 无变化
  });

  it('markRead 不存在的 id 返回 false', () => {
    const panel = new NotifyPanel();
    expect(panel.markRead('nope')).toBe(false);
  });

  it('markRead 可以标记未读', () => {
    const panel = new NotifyPanel();
    const n = panel.push(base);
    panel.markRead(n.id);
    panel.markRead(n.id, false);
    expect(panel.get(n.id)!.read).toBe(false);
  });

  it('markAllRead 把全部置为已读', () => {
    const panel = new NotifyPanel();
    panel.push(base);
    panel.push(base);
    panel.markAllRead();
    expect(panel.unreadCount()).toBe(0);
  });

  it('archive 改变归档状态', () => {
    const panel = new NotifyPanel();
    const n = panel.push(base);
    panel.archive(n.id);
    expect(panel.get(n.id)!.archived).toBe(true);
    panel.archive(n.id, false);
    expect(panel.get(n.id)!.archived).toBe(false);
  });

  it('remove 删除', () => {
    const panel = new NotifyPanel();
    const n = panel.push(base);
    expect(panel.remove(n.id)).toBe(true);
    expect(panel.get(n.id)).toBeUndefined();
    expect(panel.remove(n.id)).toBe(false); // 再删返回 false
  });

  it('clear 清空所有', () => {
    const panel = new NotifyPanel();
    panel.push(base);
    panel.push(base);
    panel.clear();
    expect(panel.list()).toHaveLength(0);
  });
});

describe('NotifyPanel - 事件', () => {
  it('notification 事件被触发', () => {
    const panel = new NotifyPanel();
    const fn = vi.fn();
    panel.on('notification', fn);
    panel.push(base);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ source: 'ci' }));
  });

  it('read 事件带 {id, read}', () => {
    const panel = new NotifyPanel();
    const fn = vi.fn();
    const n = panel.push(base);
    panel.on('read', fn);
    panel.markRead(n.id);
    expect(fn).toHaveBeenCalledWith({ id: n.id, read: true });
  });

  it('removed 事件(删除时)', () => {
    const panel = new NotifyPanel();
    const fn = vi.fn();
    const n = panel.push(base);
    panel.on('removed', fn);
    panel.remove(n.id);
    expect(fn).toHaveBeenCalledWith({ id: n.id });
  });

  it('cleared 事件', () => {
    const panel = new NotifyPanel();
    const fn = vi.fn();
    panel.on('cleared', fn);
    panel.clear();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('allRead 事件', () => {
    const panel = new NotifyPanel();
    const fn = vi.fn();
    panel.push(base);
    panel.on('allRead', fn);
    panel.markAllRead();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('协议 event 频道也收到 PanelEvent', () => {
    const panel = new NotifyPanel();
    const events: PanelEvent[] = [];
    panel.on('event', (e) => events.push(e));
    const n = panel.push(base);
    panel.markRead(n.id);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['notification', 'read']),
    );
  });

  it('on 返回的取消订阅函数有效', () => {
    const panel = new NotifyPanel();
    const fn = vi.fn();
    const off = panel.on('notification', fn);
    off();
    panel.push(base);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('NotifyPanel - 淘汰', () => {
  it('超过 maxItems 淘汰最老的一条', async () => {
    const panel = new NotifyPanel({ maxItems: 3 });
    const a = panel.push({ ...base, title: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    panel.push({ ...base, title: 'b' });
    await new Promise((r) => setTimeout(r, 5));
    panel.push({ ...base, title: 'c' });
    await new Promise((r) => setTimeout(r, 5));
    panel.push({ ...base, title: 'd' });
    // a 被淘汰
    expect(panel.get(a.id)).toBeUndefined();
    expect(panel.list()).toHaveLength(3);
  });

  it('淘汰会触发 removed 事件', () => {
    const panel = new NotifyPanel({ maxItems: 1 });
    const fn = vi.fn();
    panel.on('removed', fn);
    panel.push({ ...base, title: 'a' });
    panel.push({ ...base, title: 'b' });
    expect(fn).toHaveBeenCalled();
  });
});

describe('NotifyPanel - destroy', () => {
  it('destroy 后不再触发事件', () => {
    const panel = new NotifyPanel();
    const fn = vi.fn();
    panel.on('notification', fn);
    panel.destroy();
    panel.push(base);
    expect(fn).not.toHaveBeenCalled();
  });
});
