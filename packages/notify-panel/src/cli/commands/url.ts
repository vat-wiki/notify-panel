/**
 * 输出当前 daemon 的真实地址。
 *
 * 端口会变(冲突时自动 +1),所以「裸 HTTP / 跨语言」对接时不要写死端口,
 * 而是从这里动态拿。设计成对 shell 友好:
 *
 *   curl http://$(notify-panel url)/v1/notify ...
 *
 * 查找顺序同发现机制:NOTIFY_PANEL_URL 环境变量 > 端口文件 > 默认值。
 * 注意:daemon 没在跑时,环境变量仍可能指向(已设)或回退默认端口。
 */
import type { Command } from 'commander';
import { discoverServer, ENV_URL } from '../../protocol';

export function registerUrl(program: Command): void {
  program
    .command('url')
    .description('输出当前 daemon 的真实地址(便于 shell 脚本 / 裸 HTTP 拼接)')
    .option('--json', '输出完整信息 JSON(url/port/pid/secret 等)')
    .option('--no-default', '未设环境变量且端口文件不存在时不回退默认值')
    .action((opts: { json?: boolean; default: boolean }) => {
      const info = discoverServer({ useDefault: opts.default });
      if (!info) {
        console.error('找不到 notify-panel 地址。');
        console.error(`请启动 daemon(notify-panel start)或设置 $${ENV_URL}。`);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        // secret 之类敏感信息也一并输出(端口文件本就 0600,命令调用者即本机用户)
        console.log(JSON.stringify(info));
        return;
      }
      // 默认:只输出纯地址,方便 $(notify-panel url) 嵌套
      console.log(info.url);
    });
}
