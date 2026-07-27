/**
 * 跨进程用法:面板启动 HTTP 服务,外部系统通过官方 SDK 推送。
 *
 * 运行: npm run example:server
 */
import { createServer } from 'notify-panel/server';
import { NotifyClient } from 'notify-panel/sdk';

async function main() {
  const { info, panel, close } = await createServer({ secret: 'top-secret' });

  panel.on('notification', (n) => {
    console.log(`📨 [${n.severity}] ${n.title}: ${n.message}`);
  });

  // 外部系统:用 SDK,显式传发现到的地址(因为示例里我们知道)
  const client = new NotifyClient({ baseUrl: info.url, secret: info.secret });
  await client.push({ source: 'slack', title: '#general', message: 'hi from SDK' });
  await client.push({ source: 'ci', title: 'build', message: '#1234 failed', severity: 'error' });

  // 批量
  await client.pushBatch([
    { source: 'bot', title: 't1', message: 'm1' },
    { source: 'bot', title: 't2', message: 'm2' },
  ]);

  console.log(`\n面板共收到 ${panel.unreadCount()} 条`);
  await close();
}

main().catch(console.error);
