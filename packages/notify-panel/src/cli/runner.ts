/**
 * 命令分发(基于 Commander.js)。
 *
 * 各命令通过 registerXxx(program) 注册自己的选项和 action,
 * Commander 负责:参数解析、自动 -h/--help 生成、版本号、未知命令报错。
 * 这里只做顶层装配。
 */
import { Command } from 'commander';
import path from 'path';
import { registerStart } from './commands/start';
import { registerStop } from './commands/stop';
import { registerRestart } from './commands/restart';
import { registerStatus } from './commands/status';
import { registerLogs } from './commands/logs';
import { registerUrl } from './commands/url';
import { registerInstall } from './commands/install';
import { registerUninstall } from './commands/uninstall';
import { registerPush } from './commands/push';
import { registerList } from './commands/list';
import { registerRead } from './commands/read';
import { registerArchive } from './commands/archive';
import { registerClear } from './commands/clear';
import { registerSkill } from './commands/skill';

// 运行时基于 __dirname 解析根 package.json,
// 避免全局安装后 CWD 不在包根导致读不到版本号。
const VERSION = require(path.join(__dirname, '..', '..', 'package.json')).version;

export async function run(argv: string[]): Promise<void> {
  const program = new Command();

  // 把 Commander 内部的 process.exit 转成抛错,交给入口(cli.ts)统一处理。
  // 这样 -h / -v / 未知命令都不会强行退出进程,也便于测试。
  program.exitOverride((err) => {
    throw err;
  });

  // 让 Commander 的 help / version / 错误输出走 console.log / console.error,
  // 与项目其它输出一致,也便于测试统一捕获 stdout。
  program.configureOutput({
    writeOut: (str) => console.log(str.trimEnd()),
    writeErr: (str) => console.error(str.trimEnd()),
    outputError: (msg, write) => write(`${msg}\n`),
  });

  program
    .name('notify-panel')
    .description('系统级通知面板 —— 收下本机所有通知,统一管理')
    .version(VERSION, '-v, --version');

  // 管理 daemon
  registerStart(program);
  registerStop(program);
  registerRestart(program);
  registerStatus(program);
  registerLogs(program);
  registerUrl(program);
  // 开机自启
  registerInstall(program);
  registerUninstall(program);
  // 作为客户端
  registerPush(program);
  registerList(program);
  registerRead(program);
  registerArchive(program);
  registerClear(program);
  registerSkill(program);

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err: any) {
    // Commander 的 help / version / 未知命令错误:已向 stdout/stderr 输出过,
    // 这里只需设置退出码,不再重复打印。
    if (err?.exitCode != null) {
      // help / version 是成功路径(exitCode 0),未知命令是 1
      process.exitCode = err.exitCode;
      return;
    }
    throw err;
  }
}
