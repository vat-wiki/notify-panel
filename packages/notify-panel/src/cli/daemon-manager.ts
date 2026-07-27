/**
 * daemon 进程管理:fork 后台进程 + 日志 + pid 文件。
 *
 * 这是「系统级常驻进程」该有的能力:
 *   - start 默认后台化(detach + 日志重定向),不占终端
 *   - 所有输出写进日志文件,logs 命令查看
 *   - pid 文件 + 端口文件双重保证:只有一个实例
 */
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { getRuntimeDir } from '../protocol';

/** 本机运行时目录(各种文件都在这) */
export function runtimeDir(): string {
  return getRuntimeDir();
}

/** pid 文件路径(记录 daemon 的 pid) */
export function pidFilePath(): string {
  return path.join(runtimeDir(), 'daemon.pid');
}

/** 日志文件路径(daemon 的 stdout/stderr) */
export function logFilePath(): string {
  return path.join(runtimeDir(), 'daemon.log');
}

/** 读 pid 文件 */
export function readPidFile(): number | null {
  try {
    const raw = fs.readFileSync(pidFilePath(), 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** 写 pid 文件 */
export function writePidFile(pid: number): void {
  fs.mkdirSync(runtimeDir(), { recursive: true });
  fs.writeFileSync(pidFilePath(), String(pid));
}

/** 删 pid 文件 */
export function clearPidFile(): void {
  try {
    fs.unlinkSync(pidFilePath());
  } catch {
    /* ignore */
  }
}

/** 进程是否存活(跨平台) */
export function isAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

/**
 * 把当前进程 fork 成后台 daemon。
 *
 * 原理:用 spawn 把自己重新启动一遍,带上 --foreground 标志(避免递归),
 * stdio 重定向到日志文件,detached 让它脱离父进程。
 *
 * @param fullArgs 子进程的完整参数,**含命令名**(如 ['start', '--secret', 'xxx'])
 * @returns 后台子进程
 */
export function forkDaemon(fullArgs: string[]): ChildProcess {
  fs.mkdirSync(runtimeDir(), { recursive: true }); // 确保运行目录存在
  const logFd = fs.openSync(logFilePath(), 'a'); // 追加写,保留历史

  const child = spawn(process.execPath, [process.argv[1]!, ...fullArgs, '--foreground'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: process.cwd(),
    env: { ...process.env, NOTIFY_PANEL_DAEMONIZED: '1' },
  });

  // 写一行分隔,方便看日志
  fs.writeSync(
    logFd,
    `\n\n===== notify-panel daemon 启动 ${new Date().toISOString()} =====\n`,
  );
  fs.closeSync(logFd);

  child.unref(); // 父进程不必等它
  return child;
}

/** 读最后 n 行日志(默认 50) */
export function tailLog(lines = 50): string {
  try {
    const raw = fs.readFileSync(logFilePath(), 'utf8');
    const all = raw.split('\n');
    return all.slice(Math.max(0, all.length - lines)).join('\n');
  } catch {
    return '(无日志)';
  }
}
