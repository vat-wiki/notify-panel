/** 清空全部通知 —— 基于 @notify-panel/sdk。 */
import type { Command } from 'commander';
import { addClientOptions, makeClientFromCmd } from '../client-utils';

export function registerClear(program: Command): void {
  const cmd = program.command('clear').description('清空所有通知');
  addClientOptions(cmd);

  cmd.action(async (opts: Record<string, string | boolean | undefined>) => {
    const client = makeClientFromCmd(opts);
    await client.clear();
    console.log('✓ 已清空');
  });
}
