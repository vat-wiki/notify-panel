import path from 'path';
import type { FastifyInstance } from 'fastify';
import { NotifyPanel, FileStorage, type NotificationStorage } from '../core';
import { getRuntimeDir } from '../protocol';
import { buildApp, type ServerOptions } from './http';
import {
  DEFAULT_PORT,
  writeServerFile,
  clearServerFile,
  readServerFile,
  isPidAlive,
  type ServerInfo,
} from './discovery';

export interface StartOptions extends ServerOptions {
  /**
   * 端口:
   *   - 不传 / DEFAULT_PORT:用默认 8787,冲突时自动往后找可用端口
   *   - 0:让系统随机分配可用端口
   *   - 其它值:尊重该端口,冲突即抛错
   */
  port?: number;
  host?: string;
  /** 默认 true:把地址写到端口文件供集成方发现。测试时可关 */
  advertise?: boolean;
  /** 是否在控制台打印启动地址 */
  silent?: boolean;
  /** 内存中最多保留多少条通知,超出淘汰最老的。默认 500 */
  maxItems?: number;
  /** 自动回退时最多尝试的端口数,默认 20 */
  maxPortAttempts?: number;
  /** 收到 shutdown 请求后是否退出进程,默认 true(CLI daemon 用)。库用法可关 */
  exitOnShutdown?: boolean;
  /** 是否启用持久化存储,默认 true(daemon 重启不丢数据)。传 false 用纯内存 */
  persist?: boolean;
  /** 自定义存储文件路径。默认 ~/.notify-panel/store.json */
  storePath?: string;
  /** 自定义存储实现(优先于 persist)。用于接 Redis / IndexedDB 等 */
  storage?: NotificationStorage;
  /** 存储写盘防抖间隔(毫秒),默认 300 */
  persistDebounceMs?: number;
}

export interface RunningServer {
  app: FastifyInstance;
  panel: NotifyPanel;
  /** 实际启动信息(含真实端口、最终地址) */
  info: ServerInfo;
  close: () => Promise<void>;
}

/**
 * 一键启动一个兼容协议 v1 的通知面板 HTTP 服务(异步)。
 *
 * 启动后会:
 *   1. 监听端口(默认端口冲突时会自动尝试下一个可用端口)
 *   2. 把真实地址写入端口文件 ~/.notify-panel/server.json,供集成方发现
 *
 * ```ts
 * import { createServer } from '@notify-panel/server';
 * const { info, panel, close } = await createServer({ secret: 'top-secret' });
 * console.log(info.url); // http://127.0.0.1:54321
 * ```
 */
export async function createServer(opts: StartOptions = {}): Promise<RunningServer> {
  // 持久化存储:默认启用,daemon 重启不丢数据
  const persist = opts.persist ?? true;
  const storePath = opts.storePath ?? path.join(getRuntimeDir(), 'store.json');
  const storage: NotificationStorage | undefined = opts.storage
    ?? (persist ? new FileStorage({ filePath: storePath, debounceMs: opts.persistDebounceMs }) : undefined);

  const panel = new NotifyPanel({
    maxItems: opts.maxItems,
    storage,
  });

  let running: RunningServer | null = null;
  const app = await buildApp(panel, {
    ...opts,
    onShutdown: () => {
      // 收到 shutdown 请求 → 优雅关闭。如果 start() 在后台 daemon,这里会退出进程
      running?.close().finally(() => opts.exitOnShutdown !== false && process.exit(0));
    },
  });

  const host = opts.host ?? '127.0.0.1';
  const wantPort = opts.port ?? DEFAULT_PORT;
  const advertise = opts.advertise ?? true;
  const maxAttempts = opts.maxPortAttempts ?? 20;

  // 监听端口(默认端口冲突时会自动尝试下一个可用端口)
  const { port } = await listenWithFallback(app, wantPort, host, maxAttempts);

  const serverInfo: ServerInfo = {
    protocol: 'v1',
    url: `http://${host}:${port}`,
    port,
    host,
    pid: process.pid,
    startedAt: Date.now(),
    secret: opts.secret,
  };

  if (advertise) writeServerFile(serverInfo);
  if (!opts.silent) {
    console.log(`[notify-panel] listening on ${serverInfo.url} (pid ${serverInfo.pid})`);
  }

  running = {
    app,
    panel,
    info: serverInfo,
    close: () =>
      new Promise((resolve) => {
        if (advertise) clearServerFile();
        app.close().then(async () => {
          // flush 存储,确保缓冲的写入落盘后再退出
          await panel.shutdown();
          resolve();
        });
      }),
  };
  return running;
}

/**
 * 查询当前是否有 daemon 在跑(读端口文件 + pid 存活检测)。
 * CLI 的 status / stop 命令用。
 */
export function findRunningDaemon(): ServerInfo | null {
  const info = readServerFile();
  if (!info || !info.pid) return null;
  if (!isPidAlive(info.pid)) {
    clearServerFile();
    return null;
  }
  return info;
}

/**
 * 通过 pid 停掉正在跑的 daemon。
 * @returns true 表示已发送停信号(不保证对方已退出)
 */
export function stopRunningDaemon(): boolean {
  const info = findRunningDaemon();
  if (!info?.pid) return false;
  try {
    process.kill(info.pid, 'SIGTERM');
    clearServerFile();
    return true;
  } catch {
    return false;
  }
}

/**
 * 尝试监听 wantPort;若被占用且 wantPort 是默认值,自动往后找可用端口。
 *
 * - wantPort === 0:让系统分配,一定成功
 * - wantPort === DEFAULT_PORT:冲突则 DEFAULT_PORT, DEFAULT_PORT+1, ... 逐个试
 * - 其它显式端口:冲突直接抛 EADDRINUSE,尊重调用方意图
 */
function listenWithFallback(
  app: FastifyInstance,
  wantPort: number,
  host: string,
  maxAttempts: number,
): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    // 让系统分配端口,一次性成功
    if (wantPort === 0) {
      app.listen({ port: 0, host }).then(() => resolve({ port: realPort(app) }), reject);
      return;
    }

    // 显式非默认端口:尊重它,失败即抛
    if (wantPort !== DEFAULT_PORT) {
      app.listen({ port: wantPort, host }).then(() => resolve({ port: wantPort }), reject);
      return;
    }

    // 默认端口:冲突时自动 +1 重试(需重建 app,因为 listen 失败后实例不可复用)
    let attempt = 0;
    const tryPort = (p: number) => {
      app.listen({ port: p, host }).then(
        () => resolve({ port: p }),
        (err: NodeJS.ErrnoException) => {
          if (err.code !== 'EADDRINUSE' || attempt >= maxAttempts) {
            reject(err);
            return;
          }
          attempt++;
          // listen 失败后 app 已关闭,需 close 再试下一端口
          app.close().finally(() => tryPort(p + 1));
        },
      );
    };
    tryPort(wantPort);
  });
}

/** 从已 listening 的 app 取出真实端口 */
function realPort(app: FastifyInstance): number {
  const addr = app.server.address();
  return addr && typeof addr === 'object' ? addr.port : 0;
}

export { buildApp, registerRoutes, type ServerOptions } from './http';

// 发现机制对外导出,方便集成方在同一包里调用
export * from './discovery';
