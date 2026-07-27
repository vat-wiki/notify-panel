/** 卸载系统服务:先停止+禁用,再删文件。 */
import type { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

export function registerUninstall(program: Command): void {
  program.command('uninstall').description('卸载系统服务(停止 + 禁用 + 删除文件)').action(() => {
    const platform = process.platform;
    let removed: string[] = [];

    if (platform === 'linux') {
      const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', 'notify-panel.service');
      // 先停止+禁用(文件还在时),再删文件
      if (fs.existsSync(unitPath)) {
        try {
          runSystemctl('disable', '--now', 'notify-panel');
        } catch (e: any) {
          console.warn('! 自动停止/禁用失败(可能本就没启用):' + e.message);
        }
        try {
          runSystemctl('daemon-reload');
        } catch {
          /* ignore */
        }
        removed.push(unitPath);
        fs.unlinkSync(unitPath);
      }
      if (removed.length === 0) {
        console.log('未找到已安装的服务文件,无需卸载。');
      } else {
        console.log('✓ 已停止、禁用并移除:');
        removed.forEach((f) => console.log(`  ${f}`));
      }
    } else if (platform === 'darwin') {
      const plistPath = path.join(
        os.homedir(),
        'Library',
        'LaunchAgents',
        'dev.notify-panel.daemon.plist',
      );
      // 先 unload(停止),再删文件
      if (fs.existsSync(plistPath)) {
        try {
          execFileSync('launchctl', ['unload', plistPath], { stdio: 'inherit' });
        } catch (e: any) {
          console.warn('! 自动卸载失败(可能本就没加载):' + e.message);
        }
        removed.push(plistPath);
        fs.unlinkSync(plistPath);
      }
      if (removed.length === 0) {
        console.log('未找到已安装的服务文件,无需卸载。');
      } else {
        console.log('✓ 已卸载并移除:');
        removed.forEach((f) => console.log(`  ${f}`));
      }
    } else {
      console.error(`暂不支持 ${platform} 自动卸载。`);
      process.exitCode = 1;
    }
  });
}

/** 执行 systemctl --user 命令,失败抛错 */
function runSystemctl(...args: string[]): void {
  execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' });
}
