/**
 * notify-panel-tui 的轮询器 —— notify-panel 的 TUI 消费端。
 *
 * 和 extensions/pi/src/notify-panel.ts 是孪生设计:
 *   - pi 扩展:轮询未读 → pi.sendUserMessage() 投递给 pi agent
 *   - tui 扩展:轮询未读 → inject.write() 入队 QueuedInjector,等 TUI idle 注入
 *
 * 关键简化:直接复用 notify-panel 的 NotifyClient SDK,不重新实现
 * 服务发现 / HTTP / 鉴权 / archived 过滤 —— SDK 已封装好。
 * 这里只负责"轮询节奏 + 退避 + 投递契约"。
 *
 * 投递契约(沿用 pi 扩展,已验证稳定):
 *  - 先 inject 成功,再标记已读 —— 投递失败不丢消息,下一轮重试。
 *  - daemon 不可达时指数退避,恢复后回到基础间隔。
 */

import { NotifyClient, type Notification } from "notify-panel/sdk";

// ───────── 配置 ─────────
const POLL_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_INJECT_LEN = 500; // 单行注入上限,见 formatForInject

// ───────── 注入器接口(解耦:既可写 PTY,也可写 socket)─────────
export interface Injector {
  /** 注入一段文本。返回是否成功。 */
  write: (text: string) => boolean;
}

export interface WatcherOptions {
  inject: Injector;
  onStatus?: (s: string) => void;
  onDelivered?: (count: number, ids: string[]) => void;
}

export class TuiWatcher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private paused = false;
  private interval = POLL_INTERVAL_MS;
  private lastError = "";
  private deliveredCount = 0;
  private stopFlag = false;
  private client: NotifyClient;

  constructor(private opts: WatcherOptions) {
    // NotifyClient 构造时自动发现本机 daemon(读 server.json)。
    // 发现失败抛错 —— 由 runWrapped 捕获,降级为"仅 PTY 包装"。
    this.client = new NotifyClient();
  }

  start(): () => void {
    this.stopFlag = false;
    this.schedule(this.interval);
    return () => this.stop();
  }

  stop(): void {
    this.stopFlag = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  pause(): void {
    this.paused = true;
    this.refreshStatus();
  }

  resume(): void {
    this.paused = false;
    this.schedule(POLL_INTERVAL_MS);
  }

  async pollOnce(): Promise<void> {
    await this.tick();
  }

  get status(): string {
    if (this.paused) return "paused";
    if (this.lastError)
      return `${this.lastError} · backoff ${this.interval / 1000}s`;
    return `polling ${this.interval / 1000}s · delivered ${this.deliveredCount}`;
  }

  private refreshStatus(): void {
    this.opts.onStatus?.(this.status);
  }

  private schedule(intervalMs: number): void {
    if (this.stopFlag) return;
    if (this.timer) clearInterval(this.timer);
    this.interval = intervalMs;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.refreshStatus();
  }

  private async tick(): Promise<void> {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      // SDK 已处理 archived 过滤:list({unreadOnly:true}) 返回的也可能含
      // archived,客户端必须再过滤一次。这里显式过滤保持契约。
      let unread: Notification[];
      try {
        const result = await this.client.list({ unreadOnly: true });
        unread = result.items.filter((i) => !i.archived);
      } catch (err) {
        // fetch 失败 / daemon 不可达 → 退避
        this.lastError =
          err instanceof Error ? err.message.slice(0, 40) : "fetch failed";
        const next = Math.min(this.interval * 2, MAX_BACKOFF_MS);
        if (next !== this.interval) this.schedule(next);
        return;
      }

      // 恢复正常
      if (this.lastError || this.interval !== POLL_INTERVAL_MS) {
        this.lastError = "";
        this.schedule(POLL_INTERVAL_MS);
      }

      if (unread.length === 0) return;

      // 投递:先 inject 成功的才标记已读(不丢消息)
      const delivered: string[] = [];
      for (const item of unread) {
        const text = formatForInject(item);
        if (this.opts.inject.write(text)) {
          delivered.push(item.id);
        }
      }
      if (delivered.length === 0) return;

      await Promise.all(
        delivered.map((id) => this.client.markRead(id).catch(() => {})),
      );
      this.deliveredCount += delivered.length;
      this.opts.onDelivered?.(delivered.length, delivered);
    } catch (err) {
      this.lastError =
        err instanceof Error ? err.message.slice(0, 40) : "tick error";
      this.refreshStatus();
    } finally {
      this.running = false;
    }
  }
}

// ───────── 格式化:把通知编成给 agent 看的一条"用户消息" ─────────
function severityEmoji(s?: string): string {
  switch (s) {
    case "error":
      return "🔴";
    case "warning":
      return "🟡";
    case "success":
      return "🟢";
    default:
      return "🔵";
  }
}

/**
 * 把一条通知格式化成注入给 agent 的文本。
 *
 * 关键:必须压成严格单行。claude/codex 这类 TUI 的输入框遇到换行会
 * 进入多行编辑模式,此时回车变成"换行"而非"提交",导致注入的文本
 * 躺在框里不执行。所有 \r\n\t 都得替换掉。
 *
 * 超长截断并提示,agent 可自行用工具查详情。
 */
export function formatForInject(item: Notification): string {
  const emoji = severityEmoji(item.severity);
  const head = `${emoji}[${item.severity ?? "info"}] ${item.title ?? "(无标题)"} (${item.source ?? "unknown"}) [id=${item.id}]`;
  const body = item.message?.trim() ?? "";
  let text = body ? `${head} ${body}` : head;
  text = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > MAX_INJECT_LEN) {
    text = text.slice(0, MAX_INJECT_LEN) + "…(已截断)";
  }
  return text;
}
