/**
 * notify-panel-tui — PTY 桥接核心。
 *
 * 把任意 TUI agent(claude / codex / 任何交互式 CLI)起在一个伪终端里,然后:
 *  1. 真实键盘 ──透传──▶ 目标 TUI(用户照常操作,无感)
 *  2. 目标 TUI 输出 ──透传──▶ 用户屏幕 + 旁路一份给状态分析(idle 推断)
 *  3. notify-panel 未读通知 ──▶ 当作"用户敲的字"注入
 *
 * 这是 notify-panel 的"TUI 消费端":和 extensions/pi 是孪生关系 ——
 * pi 扩展用 pi.sendUserMessage 投递给 pi agent,这里用 PTY 注入投递给
 * 任意 TUI agent。复用同一套 notify-panel daemon + SDK,只是投递通道不同。
 */

import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import * as pty from "node-pty";
import { execSync } from "node:child_process";
import { QueuedInjector, type InjectFn } from "./queue.js";
import { TuiWatcher } from "./watcher.js";

/** 起目标进程的参数。 */
export interface SpawnOptions {
  /** 要执行的目标,如 "claude"。 */
  cmd: string;
  /** 透传给目标的参数。 */
  args: string[];
  /** 工作目录,默认当前目录。 */
  cwd?: string;
}

/** 控制协议:一行一个 JSON 命令(调试用,见下方控制 socket)。 */
export interface ControlMessage {
  op: "inject";
  text: string;
}

/** 控制 socket 的可发现路径:按 pid 命名,放在 ~/.notify-panel-tui/。 */
export function controlSocketPath(pid: number): string {
  return path.join(os.homedir(), ".notify-panel-tui", `sock-${pid}`);
}

/**
 * 把一段文本注入给目标 TUI(打字 + 提交键)。
 *
 * 关键时序陷阱(实测发现):
 *   node-pty 把数据高速灌进 PTY kernel buffer,codex(ratatui)在同一个
 *   事件循环 tick 里一次性读到完整 "text\r" 会把 \r 当文本处理、不提交。
 *   必须让目标先消化 text、完成回显,再发的提交键才被识别为键事件。
 *   解决:text 与提交键分两次 write,中间用 setTimeout 留出 SUBMIT_DELAY_MS
 *   让目标跑一轮事件循环。
 *
 *   对照:用 Python 的 os.write(fd, b"hi\r") 不需要这个延迟(Python 的
 *   write 路径节奏不同),claude code 的 TUI 也不需要(它的输入处理对
 *   同 tick 的 \r 宽容)。这个延迟对 claude 无副作用,对 codex 必须。
 *
 * @returns text 是否成功写入(提交键异步跟上)
 */
const SUBMIT_DELAY_MS = 80;
export function writeToPty(child: pty.IPty): InjectFn {
  return (text: string): boolean => {
    try {
      child.write(text);
      setTimeout(() => {
        try {
          child.write("\r");
        } catch {
          /* 目标可能已退出 */
        }
      }, SUBMIT_DELAY_MS);
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * 运行一个被 wrap 的目标。
 *
 * 默认启动内置 notify-panel 轮询器:用 NotifyClient SDK 读未读通知,
 * 通过 QueuedInjector 在目标 idle 时注入。这就是"一个命令,背后一切就绪"。
 *
 * @param onInjected 可选回调:每次成功注入时触发(日志/状态展示)。
 * @returns 目标进程的退出码。
 */
export async function runWrapped(
  opts: SpawnOptions,
  onInjected?: (msg: ControlMessage) => void,
): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("notify-panel-tui 必须在终端(TTY)下运行");
  }

  // ── 起目标进程 ──
  const child = pty.spawn(opts.cmd, opts.args, {
    name: "xterm-256color",
    cwd: opts.cwd ?? process.cwd(),
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    env: process.env as Record<string, string>,
  });

  // ── raw mode 修复:从 parent 侧设 PTY raw mode ──
  // 根因:claude code / codex 启动时调用 TCSETSW 设 raw mode,但 TCSETSW
  // 要求进程是 foreground process。在 PTY 里目标不是 foreground,
  // TCSETSW 返回 ERESTARTSYS,目标卡在重试循环 → 注入的输入没人读。
  // 修复:用 TCSANOW(立即生效)从 parent 侧先设 raw mode,目标的 TCSETSW
  // 立即成功(PTY 已经是 raw),目标进入事件循环,注入生效。
  applyRawMode(child);

  // 注入管道:QueuedInjector 负责 idle 推断 + 排队,注入动作用 writeToPty。
  const qi = new QueuedInjector(writeToPty(child));

  // ── 1. 用户键盘 → 目标(stdin 置 raw,逐字节透传)──
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (d: Buffer) => {
    child.write(d.toString());
  });

  // ── 2. 目标输出 → 用户屏幕 + 旁路给 QueuedInjector 做 idle 推断 ──
  child.onData((d: string) => {
    process.stdout.write(d);
    qi.observeOutput();
  });

  // ── 窗口大小同步 ──
  const onResize = () => {
    child.resize(
      process.stdout.columns || 80,
      process.stdout.rows || 24,
    );
  };
  process.stdout.on("resize", onResize);

  // ── 3. 控制 socket:外部手动注入(调试用)──
  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: ControlMessage;
        try {
          msg = JSON.parse(line);
        } catch {
          socket.write(JSON.stringify({ ok: false, error: "bad json" }) + "\n");
          continue;
        }
        if (msg.op !== "inject") {
          socket.write(
            JSON.stringify({ ok: false, error: `unknown op: ${msg.op}` }) + "\n",
          );
          continue;
        }
        qi.enqueue(msg.text);
        onInjected?.(msg);
        socket.write(JSON.stringify({ ok: true }) + "\n");
      }
    });
  });
  const sockPath = controlSocketPath(process.pid);
  mkdirSync(path.dirname(sockPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    server.listen(sockPath, resolve);
    server.on("error", reject);
  });
  process.stderr.write(`notify-panel-tui: control socket at ${sockPath}\n`);

  // ── 4. notify-panel 轮询器:用 SDK 读未读 → 注入 ──
  // 和 extensions/pi 是孪生:pi 扩展投递给 pi agent,这里投递给 PTY。
  let watcher: TuiWatcher | undefined;
  try {
    watcher = new TuiWatcher({
      inject: { write: (text) => (qi.enqueue(text), true) },
    });
    watcher.start();
    process.stderr.write(
      `notify-panel-tui: watcher started (${watcher.status})\n`,
    );
  } catch (err) {
    process.stderr.write(
      `notify-panel-tui: notify-panel 不可用,跳过自动轮询(仅 PTY 包装生效)。\n` +
        `       ${(err as Error).message}\n` +
        `       安装/启动: notify-panel install && notify-panel start\n`,
    );
  }

  // ── 退出清理 ──
  const cleanup = () => {
    try { qi.dispose(); } catch { /* */ }
    try { watcher?.stop(); } catch { /* */ }
    try { server.close(); } catch { /* */ }
    try { unlinkSync(sockPath); } catch { /* */ }
    try { process.stdin.setRawMode(false); } catch { /* */ }
  };

  return new Promise<number>((resolve) => {
    child.onExit(({ exitCode }) => {
      cleanup();
      resolve(exitCode ?? 0);
    });
    process.on("SIGINT", () => { cleanup(); process.exit(130); });
    process.on("SIGTERM", () => { cleanup(); process.exit(143); });
  });
}

/**
 * 控制 socket 客户端:给一个正在运行的会话发注入命令(调试用)。
 */
export async function sendControl(
  pid: number,
  msg: ControlMessage,
): Promise<string> {
  const sockPath = controlSocketPath(pid);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath, () => {
      socket.write(JSON.stringify(msg) + "\n");
    });
    let resp = "";
    socket.on("data", (d) => {
      resp += d.toString();
      const nl = resp.indexOf("\n");
      if (nl >= 0) {
        socket.end();
        resolve(resp.slice(0, nl));
      }
    });
    socket.on("error", (err) => {
      reject(
        new Error(
          `连不上 notify-panel-tui 会话(pid=${pid},sock=${sockPath}):${err.message}`,
        ),
      );
    });
  });
}

/** 从 parent 侧用 TCSANOW 把 PTY 设成 raw mode(见上方注释)。 */
function applyRawMode(child: pty.IPty): void {
  const ptySlave = (child as any)._pty;
  if (!ptySlave || typeof ptySlave !== "string") return;
  try {
    execSync(
      `python3 -c "
import termios, os
fd = os.open('${ptySlave}', os.O_RDWR | os.O_NONBLOCK)
new = termios.tcgetattr(fd)
new[0] = 0
new[1] = 0
new[2] = new[2] & ~(termios.CSIZE | termios.PARENB) | termios.CS8
new[3] = 0
termios.tcsetattr(fd, termios.TCSANOW, new)
os.close(fd)
"`,
      { stdio: "ignore" },
    );
  } catch {
    // 静默忽略:非 TUI 目标不需要 raw mode
  }
}
