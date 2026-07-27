/** 标记已读/未读 —— 基于 @notify-panel/sdk。 */
import type { Command } from 'commander';
import { addClientOptions, makeClientFromCmd } from '../client-utils';

export function registerRead(program: Command): void {
  const cmd = program
    .command('read [id]')
    .description('标记一条通知为已读')
    .option('--unread', '标记为未读')
    .option('--all', '标记全部已读');

  addClientOptions(cmd);

  cmd.action(async (id: string | undefined, opts: { unread?: boolean; all?: boolean } & Record<string, string | boolean | undefined>) => {
    const client = makeClientFromCmd(opts);

    if (opts.all) {
      await client.markAllRead();
      console.log('✓ 全部已读');
      return;
    }

    if (!id) {
      console.error('需要 <id> 或 --all');
      process.exitCode = 2;
      return;
    }

    try {
      await client.markRead(id, !opts.unread);
      console.log(`✓ ${opts.unread ? '已标记未读' : '已标记已读'}: ${id}`);
    } catch {
      console.log(`✗ 未找到 ${id}`);
    }
  });
}
