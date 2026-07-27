/**
 * CLI 客户端命令的公共工具。
 *
 * 所有客户端命令(push/list/read/...)都基于 @notify-panel/sdk 的 NotifyClient。
 * 这里集中处理两件每个客户端命令都要做的事:
 *   1. 注册 --url / --secret 通用选项
 *   2. 从命令对象构造 NotifyClient(自动发现或显式地址)
 *
 * 这样每个命令文件只需关心自己的业务选项,不再重复手写参数解析。
 */
import type { Command } from 'commander';
import { NotifyClient } from '../sdk';

/** 给一个子命令挂上 --url / --secret 通用选项 */
export function addClientOptions(cmd: Command): Command {
  return cmd
    .option('--url <url>', '显式指定面板地址(默认自动发现)')
    .option('--secret <secret>', '共享密钥');
}

/** 从 commander action 的 options 对象构造 NotifyClient */
export function makeClientFromCmd(opts: Record<string, string | boolean | undefined>): NotifyClient {
  const url = typeof opts.url === 'string' ? opts.url : undefined;
  const secret = typeof opts.secret === 'string' ? opts.secret : undefined;
  return new NotifyClient({ baseUrl: url, secret });
}
