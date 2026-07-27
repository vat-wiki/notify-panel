/**
 * 本地服务发现 —— 读取侧(集成方用)。
 *
 * 「集成方如何找到面板」本身就是协议约定的一部分,所以放在 protocol 包里。
 * 这一层零依赖、纯读取,SDK 和 server 都可以用。
 *
 * 三层查找优先级:
 *   1. 环境变量 NOTIFY_PANEL_URL
 *   2. 端口文件 ~/.notify-panel/server.json
 *   3. 默认 http://127.0.0.1:8787
 *
 * 写端口文件是面板实现的职责,见 @notify-panel/server 的 discovery 模块。
 */
import type { Severity } from './types';

/** 环境变量名:集成方用它显式指定面板地址 */
export const ENV_URL = 'NOTIFY_PANEL_URL';

/** 运行目录环境变量名 */
export const ENV_HOME = 'NOTIFY_PANEL_HOME';

/** 默认兜底端口 */
export const DEFAULT_PORT = 8787;

/** 端口文件内容结构 */
export interface ServerInfo {
  /** 协议版本 */
  protocol: 'v1';
  /** 完整 base url,例如 http://127.0.0.1:8787 */
  url: string;
  port: number;
  host: string;
  /** 面板进程 pid,用于存活检测 */
  pid: number;
  /** 启动时间(毫秒) */
  startedAt: number;
  /** 共享密钥(端口文件默认权限 0600) */
  secret?: string;
}

export interface DiscoveryOptions {
  /** 是否校验 pid 存活(默认 true)。测试时可关 */
  checkAlive?: boolean;
  /** 找不到时是否回退默认地址(默认 true) */
  useDefault?: boolean;
}

/** 端口文件存放目录(可被 NOTIFY_PANEL_HOME 覆盖) */
export function getRuntimeDir(): string {
  const envHome = typeof process !== 'undefined' && process.env?.[ENV_HOME];
  const home = typeof process !== 'undefined' && process.env?.HOME;
  if (envHome) return envHome;
  if (home) return `${home}/.notify-panel`;
  // 浏览器等非 Node 环境兜底
  return '.notify-panel';
}

/** 端口文件完整路径 */
export function getServerFilePath(): string {
  return `${getRuntimeDir()}/server.json`;
}

/**
 * 集成方调用:按三层优先级查找面板地址。
 * 返回 null 表示完全找不到。
 *
 * 这个函数依赖 fs/process。纯浏览器环境请直接传 baseUrl 给 SDK。
 */
export function discoverServer(opts: DiscoveryOptions = {}): ServerInfo | null {
  const { checkAlive = true, useDefault = true } = opts;

  // 1) 环境变量(最高优先级)
  const envUrl = process.env[ENV_URL];
  if (envUrl) return parseUrlToInfo(envUrl);

  // 2) 端口文件
  const file = readServerFile();
  if (file) {
    if (checkAlive && !isPidAlive(file.pid)) {
      clearServerFile();
    } else {
      return file;
    }
  }

  // 3) 默认兜底
  if (useDefault) return parseUrlToInfo(`http://127.0.0.1:${DEFAULT_PORT}`);
  return null;
}

/** 只读端口文件,不做存活校验 */
export function readServerFile(): ServerInfo | null {
  try {
    // 动态加载,避免纯浏览器环境直接报错
    const fs = require('fs');
    const raw = fs.readFileSync(getServerFilePath(), 'utf8');
    const info = JSON.parse(raw) as ServerInfo;
    if (info && info.protocol === 'v1' && info.url) return info;
    return null;
  } catch {
    return null;
  }
}

/** 判断给定 pid 的进程是否还活着 */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

/** 删除端口文件(读到陈旧文件时清理用) */
export function clearServerFile(): void {
  try {
    const fs = require('fs');
    fs.unlinkSync(getServerFilePath());
  } catch {
    /* ignore */
  }
}

/**
 * 面板启动后写入端口文件(权限 0600)。
 * 这是面板实现的职责,SDK 不需要。
 */
export function writeServerFile(info: Omit<ServerInfo, 'protocol'>): ServerInfo {
  const fs = require('fs');
  const full: ServerInfo = { protocol: 'v1', ...info };
  fs.mkdirSync(getRuntimeDir(), { recursive: true });
  fs.writeFileSync(getServerFilePath(), JSON.stringify(full, null, 2), { mode: 0o600 });
  return full;
}

// 用于类型循环引用提示规避
export type { Severity };

function parseUrlToInfo(url: string): ServerInfo {
  const u = new URL(url);
  return {
    protocol: 'v1',
    url: `${u.protocol}//${u.host}`,
    port: u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80,
    host: u.hostname,
    pid: 0,
    startedAt: 0,
  };
}
