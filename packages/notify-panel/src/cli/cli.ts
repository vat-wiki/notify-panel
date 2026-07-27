#!/usr/bin/env node
/**
 * notify-panel —— 统一命令行入口。
 *
 * 它是 daemon 的管理者,也是 daemon 的客户端。同一套二进制,两种用法:
 *
 *   管理常驻进程:
 *     notify-panel start [--port 8787] [--secret xxx]   启动 daemon(前台)
 *     notify-panel status                                 daemon 是否在跑
 *     notify-panel stop                                   停掉 daemon
 *
 *   推送 / 操作(自动连上 daemon):
 *     notify-panel push <source> <title> [message] [--severity error]
 *     notify-panel list [--source xxx] [--unread]
 *     notify-panel read <id> [--unread]
 *     notify-panel clear
 *
 * 设计哲学:daemon 是宇宙中心,CLI 是它最通用的客户端,SDK 是 TS 开发者的 CLI 同款。
 */
import { run } from './runner';

run(process.argv.slice(2)).catch((err) => {
  console.error(err?.message ? String(err.message) : String(err));
  process.exit(1);
});
