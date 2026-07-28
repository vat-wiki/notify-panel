/**
 * codex 端到端冒烟脚本 —— 验证 notify-panel-tui 对 codex 的三大适配是否真的成立。
 *
 * 直接驱动 notify-panel-tui 的核心组件(node-pty + raw mode 修复 + QueuedInjector),
 * 对着一个真实的 codex 进程验证:
 *
 *   T1  codex 能在 PTY 里正常启动,输入框出现
 *   T2  codex 的 idle 静默特征成立(加载完后趋于静默 → 会被判 idle)
 *   T3  通过 QueuedInjector 注入文本后,codex 真的开始响应
 *       (证明 raw mode 修复生效 + `\r` 能提交)
 *
 * 用法:
 *   npx tsx src/codex-smoke.ts                 # 默认
 *   npx tsx src/codex-smoke.ts --timeout 30    # 延长 codex 响应等待(秒)
 *   npx tsx src/codex-smoke.ts --no-raw        # 跳过 raw mode 修复(对照)
 *   npx tsx src/codex-smoke.ts -v              # 打印 codex 输出尾部
 *
 * 退出码:全过 = 0,有失败 = 1。
 */
import * as pty from "node-pty";
import { execSync } from "node:child_process";
import { QueuedInjector } from "./queue.js";
import { writeToPty } from "./pty.js";

// ─── 参数解析 ───
function parseArgs(argv: string[]) {
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    timeoutSec: Number(get("--timeout") ?? "20"),
    skipRaw: argv.includes("--no-raw"),
    verbose: argv.includes("-v") || argv.includes("--verbose"),
    prompt: get("--prompt") ?? "hi",
  };
}
const args = parseArgs(process.argv.slice(2));

// ─── 颜色 ───
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};
const ok = (s: string) => console.log(`${C.green}✓${C.reset} ${s}`);
const bad = (s: string) => console.log(`${C.red}✗${C.reset} ${s}`);
const info = (s: string) => console.log(`${C.cyan}ℹ${C.reset} ${s}`);
const section = (s: string) =>
  console.log(`\n${C.bold}${C.cyan}── ${s} ──${C.reset}`);

/** 去 ANSI/控制序列 → 可读文本。 */
function strip(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b[=>]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b[<[][^a-zA-Z]*[a-zA-Z]/g, "");
}

// ─── 运行结果累计 ───
let totalBytes = 0;
let outputEvents = 0;
let readable = ""; // strip 后的累积文本
// 保留原始输出尾部(不 strip),用于字节级检测 spinner/error。
// 原因:strip() 会截断 UTF-8 多字节字符(braille spinner 帧),
// 导致检测漏判。
let rawTail = "";
const RAW_TAIL_MAX = 65536;

async function main() {
  // 预检
  try {
    execSync("command -v codex", { stdio: "ignore" });
  } catch {
    bad("找不到 codex,请先安装/登录");
    process.exit(1);
  }

  info(
    `启动 codex (raw=${!args.skipRaw}, timeout=${args.timeoutSec}s, prompt="${args.prompt}")`,
  );

  const child = pty.spawn("codex", [], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    env: process.env as Record<string, string>,
  });

  // ── raw mode 修复(与 src/pty.ts 完全一致)──
  if (!args.skipRaw) {
    const ptySlave = (child as any)._pty;
    if (ptySlave && typeof ptySlave === "string") {
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
        ok("raw mode 已设置(parent 侧 TCSANOW)");
      } catch {
        bad("raw mode 设置失败(继续测,结果存疑)");
      }
    }
  } else {
    info("已用 --no-raw 跳过 raw mode 修复(对照组)");
  }

  // 注入动作:直接复用生产代码 pty.ts 的 writeToPty。
  // 这样 smoke 测试的就是和 `notify-panel-tui codex` 完全相同的注入路径,不是副本。
  // 关键时序特性(text 与 \r 分两次 write、中间留延迟)见 pty.ts 的注释。
  const writeToCodex = writeToPty(child);
  const qi = new QueuedInjector(writeToCodex);

  child.onData((d) => {
    totalBytes += d.length;
    readable += strip(d);
    rawTail = (rawTail + d).slice(-RAW_TAIL_MAX);
    outputEvents++;
    qi.observeOutput();
  });

  // ── T1:等输入框出现(同时处理首次进入未信任目录的确认框)──
  //
  // codex 进入未信任目录时会弹框:"Do you trust the contents of this
  // directory? 1. Yes  2. No"。如果不处理,后续注入的通知会被这个
  // 框吃掉。smoke 脚本自动选 1(Yes)跳过它,让测试进入真正的输入框。
  // 这也揭示了 notify-panel-tui 对 codex 的一个真实注意点(见 README 补充)。
  section("T1 · codex 启动");
  const t1Start = Date.now();
  let t1Ok = false;
  let trustHandled = false;
  while (Date.now() - t1Start < 12000) {
    await sleep(150);
    // 处理信任目录确认框(strip 会把空格吃掉,用去空格后的文本匹配)
    const compact = readable.replace(/\s+/g, "");
    if (!trustHandled && /trustthecontentsofthisdirectory/i.test(compact)) {
      info("检测到信任目录确认框,自动选 1(Yes)跳过");
      child.write("1\r");
      trustHandled = true;
      await sleep(800); // 等重绘进入主界面
      continue;
    }
    // 真正的输入框出现标志
    if (/OpenAI Codex\s*\(v/.test(readable) || /\>_/.test(readable)) {
      // 再等一拍,确保信任框(如果有)已完全关闭
      if (/model:|directory:/i.test(readable)) {
        t1Ok = true;
        break;
      }
    }
  }
  if (!t1Ok) {
    bad("codex 12s 内没出现输入框");
    dumpTailAndExit(child, readable, 1);
  }
  ok(`输入框已出现(${((Date.now() - t1Start) / 1000) | 0}s)`);

  // ── 等 model 加载完(loading → 具体模型名)──
  // 这一步很关键:loading 期间 codex 输入框还没真正可交互,且输出节奏不稳。
  info("等 model 加载完成(行里不再出现 'loading')…");
  const loadDeadline = Date.now() + 15000;
  let modelLine = "";
  while (Date.now() < loadDeadline) {
    await sleep(300);
    const m = readable.match(/model:\s*([^\n\\/]*?)\s/);
    modelLine = m?.[1]?.trim() ?? "";
    if (modelLine && !/loading/i.test(modelLine)) break;
  }
  if (/loading/i.test(modelLine) || !modelLine) {
    info(
      `${C.yellow}model 还在 loading(${modelLine || "?"}),继续测试但 idle 判据可能受扰${C.reset}`,
    );
  } else {
    ok(`model 已加载:${modelLine}`);
  }

  // ── T2:idle 静默特征 ──
  section("T2 · idle 静默特征");
  const t2Bytes = totalBytes;
  const t2Events = outputEvents;
  await sleep(2500);
  const dBytes = totalBytes - t2Bytes;
  const dEvents = outputEvents - t2Events;
  info(`2.5s 静默观察:+${dBytes} 字节 / ${dEvents} 次 onData`);
  if (dBytes < 100) {
    ok("codex 趋于静默 → 符合 QueuedInjector 的 idle 判据(1.5s 静默期)");
  } else {
    info(
      `${C.yellow}仍有输出(可能是 spinner/网络),idle 推断会被推迟,但不阻断${C.reset}`,
    );
  }
  info(`QueuedInjector.currentState = ${qi.currentState}`);

  // ── T3:注入 + 验证提交动作生效 ──
  //
  // 关键:notify-panel-tui 验证的是"注入链路"(文本进框 + \r 提交)是否生效,
  // 不是"模型能不能回答"——那是模型/网络的事(本机模型 tencent/hy3:free
  // 现在在 OpenRouter 上 404 下架了,但这不影响 notify-panel-tui 的验证)。
  //
  // 提交生效的硬指标(字节级检测,不靠 strip 后的文本——strip 会截断
  // UTF-8 多字节 spinner 字符):
  //   1. braille spinner 帧(⠋⠙⠹...)—— codex 一干活就转
  //   2. reconnect/connecting/error/unavailable 文本(请求已发出)
  //   3. 注入后输出显著增长(提交触发历史区/重绘)
  //
  // 实测确认(codex_enter.py 扫描所有提交键):
  //   \r (CR)  → 提交成功(spin+reconnect+error)
  //   \n (LF)  → 不提交(只回显)
  //   \r\n    → 提交成功(等价 CR)
  section("T3 · 注入并验证 \\r 提交生效");
  const before = totalBytes;
  qi.enqueue(args.prompt);
  info(`enqueue("${args.prompt}")  → 等 codex 提交(最多 ${args.timeoutSec}s)`);

  const SPINNER = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  const submitDeadline = Date.now() + args.timeoutSec * 1000;
  let submitted = false;
  let reason = "";
  while (Date.now() < submitDeadline) {
    await sleep(200);
    // 看最近 4KB 原始输出(不经 strip)
    const recent = rawTail.slice(-4096);
    if (SPINNER.some((s) => recent.includes(s))) {
      submitted = true; reason = "spinner 帧"; break;
    }
    if (/reconnect|connecting|unavailable|upstream|\berror\b/i.test(recent)) {
      submitted = true; reason = "处理/错误文本(请求已发出)"; break;
    }
    if (totalBytes - before >= 4096) {
      submitted = true; reason = `输出暴增 ${totalBytes - before} 字节`; break;
    }
  }
  const delta = totalBytes - before;

  if (submitted) {
    ok(
      `\\r 提交生效(${reason}):codex 离开输入框进入处理状态 ` +
        `(注入后 +${delta} 字节)`,
    );
  } else {
    bad(
      `未检测到提交特征:注入后 +${delta} 字节,但无 spinner/error/暴增。` +
        `可能 \\r 未被当提交键,或 codex 输入框未就绪。`,
    );
    info("注入点附近 codex 输出(人工判断):");
    const around = readable.slice(Math.max(0, readable.length - 400));
    console.log(`${C.dim}${around || "(空)"}${C.reset}`);
  }

  // ── 摘要 ──
  section("摘要");
  console.log(`  总输出 : ${totalBytes} 字节 / ${outputEvents} 次 onData`);
  console.log(`  队列剩余: ${qi.queueDepth}`);
  if (args.verbose) {
    console.log(`${C.dim}─── 最后 600 字符(去 ANSI) ───${C.reset}`);
    console.log(readable.slice(-600) || "(空)");
  }

  cleanup(child);
  process.exit(submitted ? 0 : 1);
}

// ─── helpers ───
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function cleanup(child: pty.IPty) {
  try {
    child.write("\x03");
  } catch {
    /* */
  }
  try {
    child.kill();
  } catch {
    /* */
  }
}

/** 打印 codex 尾部输出后退出(调试失败用)。 */
function dumpTailAndExit(
  child: pty.IPty,
  readable: string,
  code: number,
): never {
  console.log(`${C.dim}─── codex 输出尾部(去 ANSI) ───${C.reset}`);
  console.log(readable.slice(-500) || "(空)");
  cleanup(child);
  process.exit(code);
}

main().catch((err) => {
  console.error("smoke 脚本崩溃:", err);
  process.exit(1);
});
