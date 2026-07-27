/** 查看 daemon 日志。 */
import type { Command } from 'commander';
import fs from 'fs';
import { tailLog, logFilePath } from '../daemon-manager';

export function registerLogs(program: Command): void {
  program
    .command('logs [lines]')
    .description('查看 daemon 日志(默认 50 行)')
    .option('-f, --follow', '持续跟踪(类似 tail -f)')
    .action(async (linesArg: string | undefined, opts: { follow?: boolean }) => {
      const lines = Number(linesArg ?? 50);

      if (opts.follow) {
        console.log(`跟踪日志 ${logFilePath()} (Ctrl+C 退出)...\n`);
        await followLog(lines);
        return;
      }

      console.log(tailLog(lines));
    });
}

/**
 * 持续跟踪日志文件。跨平台:
 *   - Unix:用系统 tail -f(轻量、可靠)
 *   - Windows 或无 tail:回退到 Node 原生 fs.watch 轮询
 */
async function followLog(lines: number): Promise<void> {
  const { spawn } = await import('child_process');
  try {
    const tail = spawn('tail', ['-n', String(lines), '-f', logFilePath()], { stdio: 'inherit' });
    tail.on('error', () => watchFallback(lines));
    process.on('SIGINT', () => tail.kill());
    await new Promise<void>(() => {}); // 常驻
  } catch {
    watchFallback(lines);
  }
}

/** 无 tail 时的兜底:fs.watch + 定期 flush */
async function watchFallback(lines: number): Promise<void> {
  const file = logFilePath();
  let lastSize = 0;
  try {
    lastSize = fs.statSync(file).size;
    console.log(tailLog(lines));
  } catch {
    /* ignore */
  }
  try {
    fs.watch(file, () => {
      try {
        const size = fs.statSync(file).size;
        if (size > lastSize) {
          const stream = fs.createReadStream(file, { start: lastSize, end: size });
          stream.on('data', (chunk) => process.stdout.write(chunk));
          lastSize = size;
        } else if (size < lastSize) {
          // 文件被截断/轮转,重置
          lastSize = size;
        }
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
  await new Promise<void>(() => {});
}
