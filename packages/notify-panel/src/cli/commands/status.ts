/** 查看 daemon 状态。 */
import type { Command } from 'commander';
import { findRunningDaemon } from '../../server';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('查看 daemon 是否在运行')
    .action(() => {
      const info = findRunningDaemon();
      if (!info) {
        console.log('🔴 notify-panel 未运行');
        console.log('   用 `notify-panel start` 启动');
        process.exitCode = 1;
        return;
      }
      console.log('🟢 notify-panel 运行中');
      console.log(`  pid:  ${info.pid}`);
      console.log(`  url:  ${info.url}`);
      console.log(`  启动时间: ${new Date(info.startedAt).toLocaleString()}`);
      if (info.secret) console.log(`  密钥: 已设置`);
    });
}
