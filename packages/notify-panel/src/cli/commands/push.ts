/**
 * 推送一条通知 —— CLI 作为客户端最常用的入口。
 *
 *   notify-panel push <source> <title> [message] [--severity error]
 *
 * shell 脚本 / cron / CI 最爱这个:零依赖、一行搞定。
 */
import type { Command } from 'commander';
import { NotifyClient } from '../../sdk';
import type { Severity } from '../../protocol';
import { addClientOptions, makeClientFromCmd } from '../client-utils';

const SEVERITIES: Severity[] = ['info', 'success', 'warning', 'error'];

export function registerPush(program: Command): void {
  const cmd = program
    .command('push <source> <title> [message]')
    .description('推送一条通知')
    .option('--severity <level>', 'info | success | warning | error,默认 info', 'info')
    .addHelpText(
      'after',
      `
示例:
  notify-panel push ci build "#1234 failed"
  notify-panel push wechat 张三 "在吗?" --severity info`,
    );

  addClientOptions(cmd);

  cmd.action(
    async (source: string, title: string, message: string, opts: { severity: string } & Record<string, string | boolean | undefined>) => {
      const severity = opts.severity as Severity;
      if (!SEVERITIES.includes(severity)) throw new Error(`无效 severity: ${severity}`);
      const client = makeClientFromCmd(opts);
      const n = await client.push({ source, title, message: message ?? '', severity });
      console.log(`✓ 已推送 [${n.id}]`);
    },
  );
}
