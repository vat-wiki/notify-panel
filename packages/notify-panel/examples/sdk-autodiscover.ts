/**
 * 验证 SDK 的「零配置自动发现」:
 * 启动面板(自动写端口文件) → new NotifyClient() 不传任何参数 → 推送成功。
 *
 * 运行: npx ts-node -T -P tsconfig.examples.json examples/sdk-autodiscover.ts
 */
import { createServer } from 'notify-panel/server';
import { NotifyClient } from 'notify-panel/sdk';

async function main() {
  const { panel, close } = await createServer({ port: 0, secret: 'auto-secret' });

  panel.on('notification', (n) => console.log(`📨 [${n.severity}] ${n.title}: ${n.message}`));

  // SDK 零配置!不传 baseUrl、不传 secret,完全靠发现机制
  const client = new NotifyClient();
  console.log('SDK 自动发现面板地址:', client.endpoint);

  await client.push({ source: 'app', title: '零配置', message: 'SDK 自动找到了我', severity: 'success' });
  console.log('✅ 推送成功');

  await close();
}

main().catch(console.error);
