/** 列出通知 —— 基于 @notify-panel/sdk。 */
import type { Command } from 'commander';
import type { Severity } from '../../protocol';
import { addClientOptions, makeClientFromCmd } from '../client-utils';

export function registerList(program: Command): void {
  const cmd = program
    .command('list')
    .description('列出通知')
    .option('--source <source>', '按来源过滤')
    .option('--severity <level>', '按级别过滤:info|success|warning|error')
    .option('--keyword <keyword>', '关键词(匹配标题/正文)')
    .option('--unread', '只看未读');

  addClientOptions(cmd);

  cmd.action(async (opts: Record<string, string | boolean | undefined>) => {
    const client = makeClientFromCmd(opts);
    const { items } = await client.list({
      source: opts.source as string | undefined,
      severity: opts.severity as Severity | undefined,
      unreadOnly: opts.unread === true,
      keyword: opts.keyword as string | undefined,
    });

    if (items.length === 0) {
      console.log('(暂无通知)');
      return;
    }
    for (const n of items) {
      const dot = n.read ? ' ' : '•';
      const arch = n.archived ? ' [归档]' : '';
      console.log(`${dot} [${(n.severity ?? 'info').padEnd(7)}] ${n.title}  (${n.source})  id=${n.id}${arch}`);
      if (n.message) console.log(`    ${n.message}`);
    }
    console.log(`\n共 ${items.length} 条`);
  });
}
