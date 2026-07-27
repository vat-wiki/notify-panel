/** 停掉 daemon:先发优雅 shutdown(sdk),失败再 SIGTERM。 */
import type { Command } from 'commander';
import { findRunningDaemon, stopRunningDaemon } from '../../server';
import { NotifyClient } from '../../sdk';
import { clearPidFile } from '../daemon-manager';

export function registerStop(program: Command): void {
  program.command('stop').description('停掉正在运行的 daemon').action(async () => {
    await shutdownDaemon();
  });
}

/** 停掉 daemon 的核心逻辑(restart 复用) */
export async function shutdownDaemon(): Promise<void> {
  const info = findRunningDaemon();
  if (!info) {
    console.log('notify-panel 未运行');
    return;
  }

  // 1) 优雅路径:用 sdk 发 DELETE /v1/daemon
  try {
    const client = new NotifyClient({ baseUrl: info.url, secret: info.secret });
    await client.shutdown();
    await waitExit(info.pid, 3000);
    clearPidFile();
    console.log(`已停止 daemon (pid ${info.pid})`);
    return;
  } catch {
    /* 优雅路径失败,回退到信号 */
  }

  // 2) 回退:直接发 SIGTERM
  if (stopRunningDaemon()) {
    await waitExit(info.pid, 3000);
    clearPidFile();
    console.log(`已停止 daemon (pid ${info.pid})`);
  } else {
    console.error('停止失败');
    process.exitCode = 1;
  }
}

function waitExit(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      try {
        process.kill(pid, 0);
        if (Date.now() - start > timeoutMs) return resolve();
        setTimeout(tick, 100);
      } catch {
        resolve();
      }
    };
    tick();
  });
}
