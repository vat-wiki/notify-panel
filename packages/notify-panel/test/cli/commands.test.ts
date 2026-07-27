import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server';
import { run } from '../../src/cli/runner';

/**
 * 端到端跑 CLI:run(['push', ...args]),捕获 stdout/stderr + 退出码。
 * 走完整 Commander 装配链路,验证真实命令行行为。
 */
async function runCmd(...args: string[]): Promise<{ out: string; code: number }> {
  const buf: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origCode = process.exitCode;
  console.log = (...a: any[]) => buf.push(a.join(' '));
  console.error = (...a: any[]) => buf.push(a.join(' '));
  process.exitCode = undefined as any;
  try {
    await run(args);
  } catch (e: any) {
    buf.push(e?.message ? String(e.message) : String(e));
    process.exitCode = 1;
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const code = process.exitCode ?? 0;
  process.exitCode = origCode;
  return { out: buf.join('\n'), code };
}

/** 从输出里抓通知 id */
function grabId(out: string): string {
  return out.match(/n_\w+/)?.[0] ?? '';
}

let base: string;
let secret: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const running = await createServer({ port: 0, secret: 'e2e-secret', silent: true });
  base = running.info.url;
  secret = running.info.secret!;
  cleanup = running.close;
});

afterAll(async () => {
  await cleanup();
});

describe('CLI push 命令', () => {
  it('推送成功输出 ✓', async () => {
    const { out, code } = await runCmd('push', '--url', base, '--secret', secret, 'ci', 'build', 'ok');
    expect(code).toBe(0);
    expect(out).toContain('✓');
  });

  it('带 --severity', async () => {
    const { out } = await runCmd('push', '--url', base, '--secret', secret, 'ci', 'b', 'm', '--severity', 'error');
    expect(out).toContain('✓');
  });

  it('非法 severity 报错', async () => {
    const { code } = await runCmd('push', '--url', base, '--secret', secret, 'ci', 'b', 'm', '--severity', 'critical');
    expect(code).not.toBe(0);
  });

  it('参数不足报错', async () => {
    const { code } = await runCmd('push', '--url', base, '--secret', secret, 'only-one');
    expect(code).not.toBe(0);
  });
});

describe('CLI list 命令', () => {
  it('列出通知', async () => {
    await runCmd('push', '--url', base, '--secret', secret, 'test', 't', 'm');
    const { out, code } = await runCmd('list', '--url', base, '--secret', secret);
    expect(code).toBe(0);
    expect(out).toContain('test');
    expect(out).toMatch(/共 \d+ 条/);
  });

  it('--source 过滤', async () => {
    await runCmd('push', '--url', base, '--secret', secret, 'unique-src', 't', 'm');
    const { out } = await runCmd('list', '--url', base, '--secret', secret, '--source', 'unique-src');
    expect(out).toContain('unique-src');
  });

  it('空结果显示提示', async () => {
    const { out } = await runCmd('list', '--url', base, '--secret', secret, '--source', '不存在的来源');
    expect(out).toContain('暂无');
  });
});

describe('CLI read 命令', () => {
  it('read <id> 标记已读', async () => {
    const { info, close } = await createServer({ port: 0, secret: 'r-secret', silent: true });
    const b = info.url, s = info.secret!;
    try {
      const { out: pushOut } = await runCmd('push', '--url', b, '--secret', s, 'x', 't', 'm');
      const id = grabId(pushOut);
      const { out, code } = await runCmd('read', '--url', b, '--secret', s, id);
      expect(code).toBe(0);
      expect(out).toContain('已标记已读');
    } finally {
      await close();
    }
  });

  it('read --all 全部已读', async () => {
    const { info, close } = await createServer({ port: 0, secret: 'a-secret', silent: true });
    const b = info.url, s = info.secret!;
    try {
      await runCmd('push', '--url', b, '--secret', s, 'x', '1', 'm');
      await runCmd('push', '--url', b, '--secret', s, 'x', '2', 'm');
      const { out } = await runCmd('read', '--url', b, '--secret', s, '--all');
      expect(out).toContain('全部已读');
    } finally {
      await close();
    }
  });

  it('无 id 无 --all 报错', async () => {
    const { code } = await runCmd('read', '--url', base, '--secret', secret);
    expect(code).toBe(2);
  });
});

describe('CLI archive 命令', () => {
  it('archive <id>', async () => {
    const { info, close } = await createServer({ port: 0, secret: 'arc-secret', silent: true });
    const b = info.url, s = info.secret!;
    try {
      const { out: pushOut } = await runCmd('push', '--url', b, '--secret', s, 'x', 't', 'm');
      const id = grabId(pushOut);

      const { out } = await runCmd('archive', '--url', b, '--secret', s, id);
      expect(out).toContain('已归档');

      const { out: out2 } = await runCmd('archive', '--url', b, '--secret', s, id, '--unarchive');
      expect(out2).toContain('取消归档');
    } finally {
      await close();
    }
  });
});

describe('CLI clear 命令', () => {
  it('清空所有', async () => {
    await runCmd('push', '--url', base, '--secret', secret, 'x', 't', 'm');
    const { out } = await runCmd('clear', '--url', base, '--secret', secret);
    expect(out).toContain('已清空');
  });
});

describe('CLI 连不上 daemon', () => {
  it('list 指向不存在的地址 → 报错', async () => {
    const { code } = await runCmd('list', '--url', 'http://127.0.0.1:1', '--secret', 'x');
    expect(code).not.toBe(0);
  });
});

describe('CLI url 命令(动态地址,端口不写死)', () => {
  const ENV_KEY = 'NOTIFY_PANEL_URL';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  it('优先读 NOTIFY_PANEL_URL 环境变量', async () => {
    process.env[ENV_KEY] = base;
    const { out, code } = await runCmd('url');
    expect(code).toBe(0);
    expect(out.trim()).toBe(base);
  });

  it('--json 输出完整信息', async () => {
    process.env[ENV_KEY] = base;
    const { out } = await runCmd('url', '--json');
    const info = JSON.parse(out);
    expect(info.url).toBe(base);
    expect(typeof info.port).toBe('number');
  });

  it('--no-default:无环境变量且无端口文件时返回非零', async () => {
    delete process.env[ENV_KEY];
    const { code } = await runCmd('url', '--no-default');
    expect(code).not.toBe(0);
  });
});

describe('CLI skill install(内置 pi skill 安装)', () => {
  it('安装到临时目录,文件完整', async () => {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-skill-'));
    // dir 参数是最终目标目录(不自动加子目录)
    const dest = path.join(tmpDir, 'my-skill');
    try {
      const { out, code } = await runCmd('skill', 'install', dest);
      expect(code).toBe(0);
      expect(fs.existsSync(path.join(dest, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(dest, 'references', 'command-reference.md'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('目标已存在且未 --force 时跳过', async () => {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-skill2-'));
    const dest = path.join(tmpDir, 'my-skill');
    try {
      // 预先创建同名目录模拟已存在
      fs.mkdirSync(dest, { recursive: true });
      const { out, code } = await runCmd('skill', 'install', dest);
      expect(code).toBe(0);
      expect(out).toContain('已存在');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
