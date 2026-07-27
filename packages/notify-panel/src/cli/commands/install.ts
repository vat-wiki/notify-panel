/**
 * 安装为系统服务(开机自启)。
 *
 * Linux:  生成 systemd unit 到 ~/.config/systemd/user/
 * macOS:   生成 launchd plist 到 ~/Library/LaunchAgents/
 *
 * 安装后 daemon 会开机自启、崩溃自动重启。
 */
import type { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { runtimeDir } from '../daemon-manager';

export function registerInstall(program: Command): void {
  program
    .command('install')
    .description('安装为系统服务(开机自启 + 立即启动)')
    .option('--secret <secret>', '共享密钥')
    .option('--port <port>', '端口', (v: string) => Number(v))
    .option('--no-start', '只生成服务文件,不自动启用/启动')
    .action(async (opts: { secret?: string; port?: number; start: boolean }) => {
      const nodeBin = process.execPath;
      const cliBin = findCliBin();
      if (!cliBin) {
        console.error('找不到 notify-panel 可执行文件路径(请用 npm install -g 全局安装)');
        process.exitCode = 1;
        return;
      }

      const platform = process.platform;
      if (platform === 'linux') {
        installSystemd({ nodeBin, cliBin, secret: opts.secret, port: opts.port, autoStart: opts.start });
      } else if (platform === 'darwin') {
        installLaunchd({ nodeBin, cliBin, secret: opts.secret, port: opts.port, autoStart: opts.start });
      } else {
        console.error(`暂不支持 ${platform} 自动安装。请参考文档手动配置自启。`);
        console.error('Windows 可用 nssm / 任务计划程序;其它系统可用 init 脚本。');
        process.exitCode = 1;
      }
    });
}

/** 找 notify-panel 可执行文件路径(解析软链,返回真实的 cli.js) */
function findCliBin(): string | null {
  const argv1 = process.argv[1] || '';
  try {
    const real = fs.realpathSync(argv1);
    if (fs.existsSync(real)) return real;
  } catch {
    /* ignore */
  }
  if (argv1.endsWith('cli.js') && fs.existsSync(argv1)) return argv1;
  return null;
}

interface ServiceOpts {
  nodeBin: string;
  cliBin: string;
  secret?: string;
  port?: number;
  /** 生成文件后是否自动启用+启动 */
  autoStart?: boolean;
}

/** 生成传给 daemon 的参数数组(两套服务共用) */
function daemonArgs(opts: ServiceOpts): string[] {
  const args = [opts.cliBin, 'start', '--foreground'];
  if (opts.secret) args.push('--secret', opts.secret);
  if (opts.port != null) args.push('--port', String(opts.port));
  return args;
}

function installSystemd(opts: ServiceOpts): void {
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const unitPath = path.join(unitDir, 'notify-panel.service');
  fs.mkdirSync(unitDir, { recursive: true });

  // 用 systemd 的数组语法 ExecStart(每参数单独引号),避免空格/特殊字符破坏 unit
  const argv = [opts.nodeBin, ...daemonArgs(opts)];
  const execStart = argv.map(shellQuote).join(' ');

  const unit = `[Unit]
Description=Notify Panel Daemon
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=3
# 让 daemon 能写入 ~/.notify-panel
Environment=HOME=${os.homedir()}

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(unitPath, unit);
  console.log('✓ 已生成 systemd user service:');
  console.log(`  ${unitPath}`);

  if (opts.autoStart === false) {
    console.log('');
    console.log('(已指定 --no-start,未自动启用。手动启用:)');
    console.log('  systemctl --user daemon-reload && systemctl --user enable --now notify-panel');
    return;
  }

  // 自动 reload + enable --now
  try {
    runSystemctl('daemon-reload');
    runSystemctl('enable', '--now', 'notify-panel');
    console.log('✓ 已启用并启动(daemon 正在跑)');
  } catch (e: any) {
    console.log('');
    console.warn('! 自动启用失败:' + e.message);
    console.log('  (可能是当前环境没有 systemd,比如容器/WSL。手动启用:)');
    console.log('  systemctl --user daemon-reload && systemctl --user enable --now notify-panel');
    console.log('  查看状态: systemctl --user status notify-panel');
    return;
  }
  console.log('');
  console.log('查看状态 / 日志:');
  console.log('  systemctl --user status notify-panel');
  console.log('  journalctl --user -u notify-panel -f');
}

function installLaunchd(opts: ServiceOpts): void {
  const label = 'dev.notify-panel.daemon';
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, `${label}.plist`);
  fs.mkdirSync(plistDir, { recursive: true });

  const args = [opts.nodeBin, ...daemonArgs(opts)];
  const logFile = path.join(runtimeDir(), 'daemon.log');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escapeXml(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>HOME</key><string>${escapeXml(os.homedir())}</string></dict>
</dict>
</plist>
`;

  fs.writeFileSync(plistPath, plist);
  console.log('✓ 已生成 launchd LaunchAgent:');
  console.log(`  ${plistPath}`);

  if (opts.autoStart === false) {
    console.log('');
    console.log('(已指定 --no-start,未自动加载。手动加载:)');
    console.log(`  launchctl load ${plistPath}`);
    return;
  }

  // launchctl: 先 unload(避免重复加载报错),再 load
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    /* 首次安装没加载过,unload 失败是正常的 */
  }
  try {
    execFileSync('launchctl', ['load', plistPath], { stdio: 'inherit' });
    console.log('✓ 已加载并启动(daemon 正在跑)');
  } catch (e: any) {
    console.log('');
    console.warn('! 自动加载失败:' + e.message);
    console.log('  手动加载:');
    console.log(`  launchctl load ${plistPath}`);
    return;
  }
  console.log('');
  console.log('查看 / 卸载:');
  console.log(`  launchctl list | grep ${label}`);
  console.log(`  launchctl unload ${plistPath}`);
}

/** 执行 systemctl --user 命令,失败拕错 */
function runSystemctl(...args: string[]): void {
  execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' });
}

/** systemd shell 引用:含空格或特殊字符的参数用单引号包裹 */
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9@%+=:,./_-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** XML 转义(launchd plist 用) */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
