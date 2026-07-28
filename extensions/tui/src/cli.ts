#!/usr/bin/env node
/**
 * notify-panel-tui CLI 入口。
 *
 * 用法:
 *   notify-panel-tui <cmd> [args...]              把 <cmd> 起在 PTY 里(自动消费 notify-panel)
 *   notify-panel-tui ctl inject <pid> <text...>  往正在运行的会话注入文本(调试用)
 *   notify-panel-tui ctl list                    列出本机活跃会话(读 ~/.notify-panel-tui/sock-*)
 *
 * 设计:保持极薄。轮询 notify-panel 是自动的;手动注入仅供调试。
 */
import { runWrapped, sendControl, controlSocketPath } from "./pty.js";

async function main() {
  const [, , sub, ...rest] = process.argv;

  // ── 子命令:ctl(调试用)──
  if (sub === "ctl") {
    const action = rest[0];
    if (action === "inject") {
      const pidStr = rest[1];
      const text = rest.slice(2).join(" ");
      if (!pidStr || !text) {
        process.stderr.write("用法:notify-panel-tui ctl inject <pid> <text...>\n");
        process.exit(2);
      }
      const pid = Number(pidStr);
      if (!Number.isInteger(pid)) {
        process.stderr.write(`pid 必须是整数,收到:${pidStr}\n`);
        process.exit(2);
      }
      try {
        const resp = await sendControl(pid, { op: "inject", text });
        process.stdout.write(resp + "\n");
      } catch (err) {
        process.stderr.write((err as Error).message + "\n");
        process.exit(1);
      }
      return;
    }

    if (action === "list") {
      const { readdirSync } = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const dir = path.join(os.homedir(), ".notify-panel-tui");
      let files: string[] = [];
      try {
        files = readdirSync(dir);
      } catch {
        /* 无目录 → 无会话 */
      }
      const socks = files.filter((f) => f.startsWith("sock-"));
      if (socks.length === 0) {
        process.stdout.write("(无活跃 notify-panel-tui 会话)\n");
        return;
      }
      for (const f of socks) {
        const pid = f.replace("sock-", "");
        process.stdout.write(`pid=${pid}  sock=${path.join(dir, f)}\n`);
      }
      return;
    }

    process.stderr.write("未知 ctl 动作。可用:inject | list\n");
    process.exit(2);
  }

  // ── 默认:wrap 一个目标 ──
  if (!sub) {
    process.stderr.write(
      "用法:\n" +
        "  notify-panel-tui <cmd> [args...]              把目标起在 PTY 里\n" +
        "  notify-panel-tui ctl inject <pid> <text...>   注入文本(调试用)\n" +
        "  notify-panel-tui ctl list                     列出活跃会话\n",
    );
    process.exit(2);
  }

  const cmd = sub;
  const args = rest;

  const code = await runWrapped({ cmd, args }, (msg) => {
    process.stderr.write(`notify-panel-tui: injected ${msg.text.length} chars\n`);
  });
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`notify-panel-tui: ${err?.stack ?? err}\n`);
  process.exit(1);
});
