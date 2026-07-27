import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  discoverServer,
  readServerFile,
  writeServerFile,
  clearServerFile,
  isPidAlive,
  getRuntimeDir,
  getServerFilePath,
  DEFAULT_PORT,
  ENV_URL,
  ENV_HOME,
  type ServerInfo,
} from '../../src/protocol';

// 用一个临时目录做隔离,避免污染真实 ~/.notify-panel
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'np-test-'));

function makeInfo(over: Partial<ServerInfo> = {}): ServerInfo {
  return {
    protocol: 'v1',
    url: 'http://127.0.0.1:9999',
    port: 9999,
    host: '127.0.0.1',
    pid: process.pid,
    startedAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  // 把运行目录重定向到临时目录
  process.env[ENV_HOME] = TMP;
  delete process.env[ENV_URL];
  // 清空临时目录里的文件
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
  fs.mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  delete process.env[ENV_HOME];
  delete process.env[ENV_URL];
});

describe('路径解析', () => {
  it('getRuntimeDir 受 NOTIFY_PANEL_HOME 控制', () => {
    process.env[ENV_HOME] = '/some/dir';
    expect(getRuntimeDir()).toBe('/some/dir');
  });

  it('getServerFilePath 在 runtime dir 下', () => {
    process.env[ENV_HOME] = '/some/dir';
    expect(getServerFilePath()).toBe('/some/dir/server.json');
  });
});

describe('isPidAlive', () => {
  it('当前进程存活', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
  it('不存在的 pid 不存活', () => {
    expect(isPidAlive(99999999)).toBe(false);
  });
  it('0 / 负数 不存活', () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
  });
});

describe('端口文件读写', () => {
  it('写入后能读回', () => {
    writeServerFile({ url: 'http://127.0.0.1:9999', port: 9999, host: '127.0.0.1', pid: process.pid, startedAt: 1 });
    const info = readServerFile();
    expect(info).not.toBeNull();
    expect(info!.url).toBe('http://127.0.0.1:9999');
    expect(info!.pid).toBe(process.pid);
  });

  it('文件不存在时返回 null', () => {
    expect(readServerFile()).toBeNull();
  });

  it('文件权限为 0600', () => {
    writeServerFile({ url: 'http://x', port: 1, host: 'x', pid: 1, startedAt: 1 });
    const mode = fs.statSync(getServerFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('clearServerFile 删除文件', () => {
    writeServerFile({ url: 'http://x', port: 1, host: 'x', pid: 1, startedAt: 1 });
    clearServerFile();
    expect(readServerFile()).toBeNull();
  });
});

describe('discoverServer 三层优先级', () => {
  it('层级3:无环境变量无文件时回退默认值', () => {
    const info = discoverServer();
    expect(info).not.toBeNull();
    expect(info!.url).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
    expect(info!.pid).toBe(0); // 默认值无 pid
  });

  it('层级3:useDefault=false 且无其它来源 → null', () => {
    expect(discoverServer({ useDefault: false })).toBeNull();
  });

  it('层级2:端口文件优先于默认值,且 pid 存活则采用', () => {
    writeServerFile({ url: 'http://127.0.0.1:8888', port: 8888, host: '127.0.0.1', pid: process.pid, startedAt: 1 });
    const info = discoverServer();
    expect(info!.url).toBe('http://127.0.0.1:8888');
  });

  it('层级2:pid 已死 → 当作不存在并清理文件,回退默认值', () => {
    writeServerFile({ url: 'http://127.0.0.1:8888', port: 8888, host: '127.0.0.1', pid: 99999999, startedAt: 1 });
    const info = discoverServer();
    // 回退到默认
    expect(info!.url).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
    // 文件被清理
    expect(readServerFile()).toBeNull();
  });

  it('层级2:checkAlive=false 不做存活检测', () => {
    writeServerFile({ url: 'http://127.0.0.1:8888', port: 8888, host: '127.0.0.1', pid: 99999999, startedAt: 1 });
    const info = discoverServer({ checkAlive: false });
    expect(info!.url).toBe('http://127.0.0.1:8888');
  });

  it('层级1:环境变量优先级最高(覆盖端口文件)', () => {
    writeServerFile({ url: 'http://127.0.0.1:8888', port: 8888, host: '127.0.0.1', pid: process.pid, startedAt: 1 });
    process.env[ENV_URL] = 'http://10.0.0.5:7000';
    const info = discoverServer();
    expect(info!.url).toBe('http://10.0.0.5:7000');
  });
});

describe('损坏文件处理', () => {
  it('损坏的 server.json 被当 null(不抛错)', () => {
    fs.writeFileSync(getServerFilePath(), '{ 不是合法 json');
    expect(readServerFile()).toBeNull();
  });

  it('协议版本不对的文件被忽略', () => {
    fs.writeFileSync(getServerFilePath(), JSON.stringify({ protocol: 'v0', url: 'http://x' }));
    expect(readServerFile()).toBeNull();
  });
});
