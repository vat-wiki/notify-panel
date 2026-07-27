import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileStorage } from '../../src/core';
import type { Notification } from '../../src/protocol';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'np-store-'));
const filePath = path.join(TMP_DIR, 'store.json');
let storage: FileStorage;

function makeN(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    source: 'ci',
    title: 't',
    message: 'm',
    timestamp: 1700000000000,
    severity: 'info',
    read: false,
    archived: false,
    ...over,
  };
}

beforeEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
  storage = new FileStorage({ filePath, debounceMs: 50 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FileStorage - load', () => {
  it('文件不存在时返回空数组', () => {
    expect(new FileStorage({ filePath }).load()).toEqual([]);
  });

  it('能加载正常文件', () => {
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, items: [makeN({ id: 'a' }), makeN({ id: 'b' })] }));
    const items = storage.load();
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('a');
  });

  it('损坏文件当空数据(不抛错)', () => {
    fs.writeFileSync(filePath, '{ 损坏的 json');
    expect(storage.load()).toEqual([]);
  });

  it('结构不对当空数据', () => {
    fs.writeFileSync(filePath, JSON.stringify({ foo: 'bar' }));
    expect(storage.load()).toEqual([]);
  });
});

describe('FileStorage - save / flush', () => {
  it('flush 后文件确实写入', () => {
    storage.save([makeN({ id: 'a' })]);
    storage.flush();
    expect(fs.existsSync(filePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe('a');
  });

  it('文件版本字段为 1', () => {
    storage.save([makeN()]);
    storage.flush();
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(data.version).toBe(1);
  });

  it('文件权限 0600', () => {
    storage.save([makeN()]);
    storage.flush();
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('防抖:多次 save 只在 flush 时落盘一次', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    storage.save([makeN({ id: 'a' })]);
    storage.save([makeN({ id: 'b' })]);
    storage.save([makeN({ id: 'c' })]);
    storage.flush();
    // writeFileSync 至少写 tmp 一次(rename 是同步的),save 多次只落盘一次内容
    const writes = writeSpy.mock.calls.filter((c) => c[0] === filePath || String(c[0]).endsWith('.tmp'));
    expect(writes.length).toBe(1); // 只写了一次 tmp,然后 rename
    writeSpy.mockRestore();
  });

  it('防抖:用 fake timers 验证多次 save 合并成一次落盘', () => {
    vi.useFakeTimers();
    const storage = new FileStorage({ filePath, debounceMs: 100 });
    // 模拟 core 真实调用方式:每次传「当前全量」状态(逐渐增加)
    storage.save([makeN({ id: '1' })]);
    storage.save([makeN({ id: '1' }), makeN({ id: '2' })]);
    storage.save([makeN({ id: '1' }), makeN({ id: '2' }), makeN({ id: '3' })]);
    vi.advanceTimersByTime(100);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // 只落盘一次,内容是最后一次的全量(3 条)
    expect(data.items).toHaveLength(3);
  });

  it('save 后等 debounceMs 自动落盘', async () => {
    storage = new FileStorage({ filePath, debounceMs: 30 });
    storage.save([makeN({ id: 'a' })]);
    expect(fs.existsSync(filePath)).toBe(false); // 还没落
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(filePath)).toBe(true); // 已落
  });
});

describe('FileStorage - 原子写', () => {
  it('写完后不留 .tmp 文件', () => {
    storage.save([makeN()]);
    storage.flush();
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
