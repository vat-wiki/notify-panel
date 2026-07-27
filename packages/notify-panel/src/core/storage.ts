/**
 * 存储抽象 + 内置文件实现。
 *
 * 设计:
 * - 数据量小(几百 KB 级),单 JSON 文件足够,不引入 SQLite 等原生依赖。
 * - 写操作做两件事保证可靠性:
 *   1. 原子写:先写 .tmp 再 rename,避免「写一半崩溃」损坏文件
 *   2. 防抖批量写:攒一小段时间的变更合并成一次落盘,避免高频写压 IO
 *
 * 持久化的全部内容就是通知列表,结构简单:
 *   { "version": 1, "items": [Notification, ...] }
 */
import fs from 'fs';
import path from 'path';
import type { Notification } from '../protocol';

/** 存储抽象接口。想换实现(如 Redis/IndexedDB)实现这个即可。 */
export interface NotificationStorage {
  /** 启动时加载所有通知 */
  load(): Notification[];
  /** 把所有通知落盘。实现可自行防抖/批量 */
  save(items: Notification[]): void;
  /** 退出前强制把缓冲的数据写完 */
  flush(): void;
}

/** 文件存储的磁盘格式 */
interface StoreFile {
  version: 1;
  items: Notification[];
}

/**
 * 单文件 JSON 存储(内置默认实现)。
 *
 * - 原子写:.tmp + rename
 * - 防抖写:save() 后等 debounceMs 再真正落盘;期间多次 save 合并成一次
 * - 退出 flush:确保缓冲的数据不丢
 */
export class FileStorage implements NotificationStorage {
  private readonly filePath: string;
  private readonly tmpPath: string;
  private readonly debounceMs: number;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private lastItems: Notification[] = [];

  constructor(opts: { filePath: string; debounceMs?: number }) {
    this.filePath = opts.filePath;
    this.tmpPath = `${opts.filePath}.tmp`;
    this.debounceMs = opts.debounceMs ?? 300;
  }

  load(): Notification[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw) as StoreFile;
      if (data && Array.isArray(data.items)) return data.items;
      return [];
    } catch (e: any) {
      if (e.code === 'ENOENT') return []; // 文件不存在 = 空存储
      // 损坏文件:记日志,当空处理,别让 daemon 起不来
      console.error(`[notify-panel] 存储文件损坏,当空处理: ${this.filePath}`, e.message);
      return [];
    }
  }

  save(items: Notification[]): void {
    this.lastItems = items;
    this.dirty = true;
    if (this.timer) return; // 已有定时器,等它触发
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushNow();
    }, this.debounceMs);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushNow();
  }

  private flushNow(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const payload: StoreFile = { version: 1, items: this.lastItems };
    const json = JSON.stringify(payload, null, 2);
    try {
      // 原子写:先写临时文件,再 rename
      fs.writeFileSync(this.tmpPath, json, { mode: 0o600 });
      fs.renameSync(this.tmpPath, this.filePath);
    } catch (e: any) {
      console.error(`[notify-panel] 存储写入失败: ${e.message}`);
      // 写失败置回 dirty,下次再试
      this.dirty = true;
    }
  }
}
