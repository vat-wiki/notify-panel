/** 启动 daemon:默认后台运行,--foreground 前台运行(调试用)。 */
import type { Command } from 'commander';
import type { StartOptions } from '../../server';
import { createServer, findRunningDaemon } from '../../server';
import {
  forkDaemon,
  writePidFile,
  readPidFile,
  isAlive,
  logFilePath,
  tailLog,
} from '../daemon-manager';
import { sleep } from '../util';

export interface StartArgs {
  port?: number;
  host?: string;
  secret?: string;
  foreground?: boolean;
  advertise?: boolean;
}

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('启动通知面板 daemon(默认后台运行)')
    .option('--port <port>', '端口,默认 8787(冲突自动换)', (v: string) => Number(v))
    .option('--host <host>', '监听地址,默认 127.0.0.1')
    .option('--secret <secret>', '共享密钥(集成方推送时需带上)')
    .option('--foreground', '前台运行(调试用,默认后台)')
    .option('--no-advertise', '不写端口文件(不利于被发现)')
    .action(async (opts: StartArgs) => {
      await startDaemon(opts);
    });
}

/** start 命令的核心逻辑(restart 复用)。opts.foreground 强制为 false 走前台路径 */
export async function startDaemon(opts: StartArgs): Promise<void> {
  // 1) 单实例保护:已在跑就不起
  const existing = findRunningDaemon();
  if (existing) {
    console.log(`notify-panel 已经在运行了:`);
    console.log(`  pid:  ${existing.pid}`);
    console.log(`  url:  ${existing.url}`);
    console.log(`  启动时间: ${new Date(existing.startedAt).toLocaleString()}`);
    console.log(`(如需重启: notify-panel restart;改端口先 stop)`);
    return;
  }

  // 2) 后台模式:fork 自己
  if (!opts.foreground) {
    const pidFileStale = readPidFile();
    if (pidFileStale && isAlive(pidFileStale)) {
      console.error(`已有 daemon 进程(pid ${pidFileStale})在运行`);
      return;
    }
    const child = forkDaemon(makeForegroundArgs(opts));
    const ok = await waitForReady(child.pid!, 5000);
    if (ok) {
      console.log(`notify-panel daemon 已在后台启动 (pid ${child.pid})`);
      console.log(`日志: ${logFilePath()}`);
      console.log(`查看状态: notify-panel status`);
    } else {
      console.error(`启动超时,查看日志: ${logFilePath()}`);
      console.error(tailLog(5));
      process.exitCode = 1;
    }
    return;
  }

  // 3) 前台模式:本进程直接当 daemon
  await startForeground(opts);
}

/** 前台启动(restart --foreground 复用) */
export async function startForeground(opts: StartArgs): Promise<void> {
  const serverOpts: StartOptions = {
    port: opts.port,
    host: opts.host,
    secret: opts.secret,
    advertise: opts.advertise,
  };
  const { info } = await createServer(serverOpts);
  writePidFile(info.pid);
  console.log(`notify-panel daemon 已启动(前台):`);
  console.log(`  pid:  ${info.pid}`);
  console.log(`  url:  ${info.url}`);
  console.log(`(Ctrl+C 退出;或 notify-panel stop)`);

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  await new Promise<void>(() => {}); // 常驻
}

/** 等后台 daemon 把端口文件写出来(就绪标志) */
async function waitForReady(expectedPid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = findRunningDaemon();
    if (info && info.pid === expectedPid) return true;
    await sleep(150);
  }
  return false;
}

/** 把 start 的选项转成 fork 子进程用的参数(带 --foreground) */
function makeForegroundArgs(opts: StartArgs): string[] {
  const args = ['start'];
  if (opts.port != null) args.push('--port', String(opts.port));
  if (opts.host) args.push('--host', opts.host);
  if (opts.secret) args.push('--secret', opts.secret);
  if (opts.advertise === false) args.push('--no-advertise');
  return args;
}
