/**
 * 场景:你是一个【第三方】,想把通知推给面板。
 *
 * 现在用官方 SDK:@notify-panel/sdk
 *   - 零配置自动发现本地面板
 *   - 本地校验,类型安全
 *   - 不依赖任何面板实现
 *
 * ```ts
 * const client = new NotifyClient();           // 自动发现
 * await client.push({ source: 'app', title: 't', message: 'm' });
 * ```
 */
import { NotifyClient, NotifyError } from 'notify-panel/sdk';

export { NotifyClient, NotifyError };

// 演示:实际使用看 server-usage.ts
async function demo() {
  const client = new NotifyClient();
  console.log('发现面板:', client.endpoint);

  await client.push({
    source: 'wechat',
    title: '产品群',
    message: '@你 新版需求文档已更新',
    severity: 'info',
  });

  await client.push({
    source: 'monitor',
    title: 'CPU 告警',
    message: 'prod-01 CPU 持续 5 分钟 > 90%',
    severity: 'error',
  });

  // 非法载荷:本地直接拦下,不会发请求
  try {
    // @ts-expect-error 故意缺字段
    await client.push({ title: '缺 source' });
  } catch (e) {
    console.log('校验拦截:', (e as NotifyError).code);
  }
}

// 当直接运行本文件时才 demo;被 require 时不执行
if (require.main === module) {
  demo().catch(console.error);
}
