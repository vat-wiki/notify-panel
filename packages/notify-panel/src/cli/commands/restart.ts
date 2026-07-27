/** 重启 daemon:先 stop 再 start,保留原始参数。 */
import type { Command } from 'commander';
import { findRunningDaemon } from '../../server';
import { clearServerFile } from '../../protocol';
import { shutdownDaemon } from './stop';
import { startDaemon, type StartArgs } from './start';

export function registerRestart(program: Command): void {
  program
    .command('restart')
    .description('重启 daemon(选项同 start)')
    .option('--port <port>', '端口', (v: string) => Number(v))
    .option('--host <host>', '监听地址')
    .option('--secret <secret>', '共享密钥')
    .option('--foreground', '前台运行')
    .option('--no-advertise', '不写端口文件')
    .action(async (opts: Record<string, unknown>) => {
      const existing = findRunningDaemon();
      if (existing) {
        console.log(`停止旧 daemon (pid ${existing.pid})...`);
        await shutdownDaemon();
      } else {
        clearServerFile();
      }
      console.log('启动新 daemon...');
      await startDaemon(opts as StartArgs);
    });
}
