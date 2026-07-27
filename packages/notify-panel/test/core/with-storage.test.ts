import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NotifyPanel, FileStorage } from '../../src/core';
import type { Notification } from '../../src/protocol';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'np-core-store-'));
const filePath = path.join(TMP_DIR, 'store.json');

beforeEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

describe('NotifyPanel + Storage 集成', () => {
  it('启动时从存储恢复', () => {
    const storage = new FileStorage({ filePath });
    // 先用一个 panel 写入数据
    const seed = new NotifyPanel({ storage });
    seed.push({ source: 'a', title: 't1', message: 'm1' });
    seed.push({ source: 'b', title: 't2', message: 'm2' });
    seed.shutdown();

    // 新 panel 用同一 storage,应恢复出 2 条
    const storage2 = new FileStorage({ filePath });
    const panel = new NotifyPanel({ storage: storage2 });
    expect(panel.list()).toHaveLength(2);
    expect(panel.list().map((n) => n.source).sort()).toEqual(['a', 'b']);
  });

  it('变更触发自动落盘', async () => {
    const storage = new FileStorage({ filePath, debounceMs: 10 });
    const panel = new NotifyPanel({ storage });
    panel.push({ source: 'x', title: 't', message: 'm' });
    panel.markAllRead();
    await new Promise((r) => setTimeout(r, 30)); // 等防抖
    expect(fs.existsSync(filePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(data.items).toHaveLength(1);
  });

  it('shutdown 强制 flush', async () => {
    const storage = new FileStorage({ filePath, debounceMs: 5000 });
    const panel = new NotifyPanel({ storage });
    panel.push({ source: 'x', title: 't', message: 'm' });
    await panel.shutdown(); // 不等防抖,直接 flush
    expect(fs.existsSync(filePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(data.items).toHaveLength(1);
  });

  it('不注入 storage 时纯内存(不落盘)', () => {
    const panel = new NotifyPanel(); // 无 storage
    panel.push({ source: 'x', title: 't', message: 'm' });
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('恢复的数据状态保留(已读状态等)', async () => {
    const storage = new FileStorage({ filePath, debounceMs: 10 });
    const panel1 = new NotifyPanel({ storage });
    const n = panel1.push({ source: 'x', title: 't', message: 'm' });
    panel1.markRead(n.id);
    panel1.archive(n.id);
    await panel1.shutdown();

    const panel2 = new NotifyPanel({ storage: new FileStorage({ filePath }) });
    const restored = panel2.get(n.id)!;
    expect(restored.read).toBe(true);
    expect(restored.archived).toBe(true);
  });
});
