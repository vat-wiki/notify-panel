/**
 * 安装内置的 pi skill 到指定目录。
 *
 *   notify-panel skill install [dir]
 *
 * 默认装到 ~/.pi/agent/skills/notify-panel,装完 pi 下次启动就能自动发现。
 * skill 源文件随 npm 包发布(packages/cli/skill/),所以是自包含的。
 */
import type { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** 内置 skill 源目录(相对当前文件层级定位) */
function skillSrcDir(): string {
  // 单包结构:dist/cli/commands/skill.js → 上三级到包根,再进 skill/
  // (运行 src 测试时同理:src/cli/commands/ → 上三级到包根)
  return path.resolve(__dirname, '..', '..', '..', 'skill');
}

/** 默认安装目标:~/.pi/agent/skills/notify-panel */
function defaultDestDir(): string {
  return path.join(os.homedir(), '.pi', 'agent', 'skills', 'notify-panel');
}

export function registerSkill(program: Command): void {
  const skill = program.command('skill').description('管理 notify-panel 的 pi skill(让 AI 助手自动用本工具)');

  skill
    .command('install [dir]', { isDefault: true })
    .description('安装内置 skill 到目标目录(默认 ~/.pi/agent/skills/notify-panel)')
    .option('-f, --force', '目标已存在时强制覆盖')
    .action((dir: string | undefined, opts: { force?: boolean }) => {
      const src = skillSrcDir();
      const dest = path.resolve(dir || defaultDestDir());
      if (!dir) {
        // 给个提示,让用户知道默认装哪
        console.log(`(未指定目录,装到默认位置:${dest})`);
      }

      if (!fs.existsSync(src)) {
        console.error(`找不到内置 skill 源:${src}`);
        console.error('(可能 npm 包损坏,请重新安装 notify-panel)');
        process.exitCode = 1;
        return;
      }

      const exists = fs.existsSync(dest);
      if (exists && !opts.force) {
        console.log(`目标已存在:${dest}`);
        console.log('如需覆盖,加 --force。');
        return;
      }

      try {
        // 递归复制(覆盖模式下先清空目标)
        if (exists) fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
      } catch (e: any) {
        console.error(`安装失败:${e.message}`);
        process.exitCode = 1;
        return;
      }

      console.log(`✓ skill 已安装到:${dest}`);
      console.log('');
      console.log('下一步:');
      console.log('  - pi(下次启动)会自动发现该 skill');
      console.log('  - 或重启 pi 后用 /skill:notify-panel 加载');
      console.log('  - 自定义目录:notify-panel skill install /path/to/skills');
    });

  skill
    .command('path')
    .description('显示内置 skill 源目录(便于查看 / 手动复制)')
    .action(() => {
      console.log(skillSrcDir());
    });
}
