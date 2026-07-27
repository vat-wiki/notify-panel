/**
 * 通知面板 —— 最直接的用法(当库用)。
 *
 * 运行: npm run example
 */
import { NotifyPanel } from 'notify-panel/core';

function main() {
  const panel = new NotifyPanel({ maxItems: 200 });

  // 1) 监听新通知 —— UI / 业务层订阅这个就行
  panel.on('notification', (n) => {
    const dot = n.read ? ' ' : '•';
    console.log(`${dot} [${n.severity}] ${n.title}: ${n.message}`);
  });

  // 2) 推几条通知(外部系统对接时最常用的方式)
  panel.push({ source: 'wechat', title: '产品群', message: '@你 新版需求文档已更新', severity: 'warning' });
  panel.push({ source: 'slack', title: '#general', message: 'hi from slack', severity: 'info' });
  panel.push({ source: 'ci', title: 'build', message: '#1234 failed', severity: 'error' });

  console.log(`\n当前未读:${panel.unreadCount()} 条`);

  // 3) 标记已读
  const first = panel.list()[0];
  if (first) {
    panel.markRead(first.id);
    console.log(`已标记 "${first.title}" 为已读`);
  }

  // 4) 过滤查询:只看 ci 来源
  console.log('\nci 来源的通知:');
  for (const n of panel.list({ source: 'ci' })) {
    console.log(`  - ${n.title}: ${n.message}`);
  }

  console.log(`\n未读变为:${panel.unreadCount()} 条`);
  panel.destroy();
}

main();
