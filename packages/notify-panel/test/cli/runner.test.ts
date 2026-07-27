import { describe, it, expect } from 'vitest';
import { run } from '../../src/cli/runner';

/** 捕获 console.log 输出 */
async function capture(fn: () => Promise<void>): Promise<string> {
  const buf: string[] = [];
  const orig = console.log;
  const origErr = console.error;
  console.log = (...a: any[]) => buf.push(a.join(' '));
  console.error = (...a: any[]) => buf.push(a.join(' '));
  try {
    await fn();
  } finally {
    console.log = orig;
    console.error = origErr;
  }
  return buf.join('\n');
}

describe('runner - help', () => {
  it('无参数打印帮助', async () => {
    const out = await capture(() => run([]));
    expect(out).toContain('notify-panel');
    expect(out).toContain('start');
    expect(out).toContain('push');
  });

  it('-h / --help / help 都打印帮助', async () => {
    for (const arg of ['-h', '--help', 'help']) {
      const out = await capture(() => run([arg]));
      expect(out).toContain('notify-panel');
    }
  });

  it('子命令 -h 打印该命令帮助', async () => {
    const out = await capture(() => run(['push', '-h']));
    expect(out).toContain('push');
    expect(out).toContain('<source>');
  });
});

describe('runner - 版本', () => {
  it('--version 打印版本', async () => {
    for (const arg of ['--version']) {
      const out = await capture(() => run([arg]));
      expect(out).toMatch(/\d+\.\d+\.\d+/);
    }
  });
});

describe('runner - 未知命令', () => {
  it('返回非零退出码并提示', async () => {
    const orig = process.exitCode;
    await capture(() => run(['nonexistent']));
    expect(process.exitCode).not.toBe(0);
    process.exitCode = orig;
  });
});

describe('runner - 命令注册完整性', () => {
  it('start/stop/restart/status/logs/url/install/uninstall/push/list/read/archive/clear/skill 都在帮助里', async () => {
    const out = await capture(() => run([]));
    const cmds = ['start', 'stop', 'restart', 'status', 'logs', 'url', 'install', 'uninstall',
                  'push', 'list', 'read', 'archive', 'clear', 'skill'];
    for (const c of cmds) {
      expect(out).toContain(c);
    }
  });
});
