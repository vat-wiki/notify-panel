/** 归档 / 取消归档 —— 基于 @notify-panel/sdk。 */
import type { Command } from 'commander';
import { addClientOptions, makeClientFromCmd } from '../client-utils';

export function registerArchive(program: Command): void {
  const cmd = program
    .command('archive <id>')
    .description('归档一条通知')
    .option('--unarchive', '取消归档');

  addClientOptions(cmd);

  cmd.action(async (id: string, opts: { unarchive?: boolean } & Record<string, string | boolean | undefined>) => {
    const client = makeClientFromCmd(opts);
    try {
      await client.archive(id, !opts.unarchive);
      console.log(`✓ ${opts.unarchive ? '已取消归档' : '已归档'}: ${id}`);
    } catch {
      console.log(`✗ 未找到 ${id}`);
    }
  });
}
