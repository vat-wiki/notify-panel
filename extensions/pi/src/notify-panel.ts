/**
 * notify-panel pi 扩展 — notify-panel 的自动消费器
 *
 * 每 N 秒轮询本机 notify-panel 收件箱,把未读通知通过 pi.sendUserMessage
 * 投递给 agent 处理;当上下文占用超过阈值时,在消息里追加压缩提示。
 *
 * 设计要点
 * ─────────
 * - 服务发现:直接读 ~/.notify-panel/server.json(权限 600,端口会变),
 *   不依赖 spawn 子进程;读不到再 fallback 到 `notify-panel url --json`。
 * - HTTP:用 Node 18+ 内置的 fetch,不依赖 curl。
 * - 投递顺序:先 sendUserMessage 成功,再把这批标记已读 —— 投递失败不丢消息。
 * - archived:notify-panel 的 ?unread=1 不排除 archived,客户端必须过滤掉,
 *   否则用户想「暂时藏起来」的通知会被反复推送。
 * - 退避:daemon 不可达时,轮询间隔指数退避(上限 30s),恢复后回到基础间隔。
 * - 并发保护:tick 期间加锁,防止上一轮网络慢时重叠。
 * - 后台资源:定时器在 session_start 创建、session_shutdown 清理,
 *   绝不在 factory 里启动(文档明确禁止)。
 *
 * 控制
 * ─────
 * - 命令 /notify-panel status | pause | resume | poll | test
 * - CLI flag --no-notify-panel 全局禁用
 *
 * 可观测
 * ───────
 * - ctx.ui.setStatus 暴露「运行/暂停/daemon 不可达」状态到 footer
 * - 每次成功投递用 pi.appendEntry 持久化处理记录,可在会话里回溯
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

// ───────── 配置(常量,按需改) ─────────
const POLL_INTERVAL_MS = 5_000; // 基础轮询间隔
const MAX_BACKOFF_MS = 30_000; // daemon 不可达时的退避上限
const CONTEXT_THRESHOLD_PCT = 25; // 上下文占用百分比阈值

// ───────── 类型 ─────────
interface NotifyItem {
	id: string;
	source?: string;
	title?: string;
	message?: string;
	severity?: "info" | "success" | "warning" | "error";
	read?: boolean;
	archived?: boolean;
	timestamp?: number;
	data?: unknown;
}

interface ServerInfo {
	url: string;
	secret?: string;
}

interface ListResponse {
	ok: boolean;
	items?: NotifyItem[];
	total?: number;
	error?: { code?: string; message?: string };
}

interface DeliveredRecord {
	at: number;
	count: number;
	ids: string[];
}

// ───────── 服务发现 ─────────

/** 直接读 ~/.notify-panel/server.json,无子进程开销。 */
function discoverFromFile(): ServerInfo | null {
	try {
		const path = join(homedir(), ".notify-panel", "server.json");
		const raw = readFileSync(path, "utf8");
		const info = JSON.parse(raw) as {
			url?: string;
			secret?: string;
		};
		if (info.url) return { url: info.url, secret: info.secret };
		return null;
	} catch {
		return null;
	}
}

/** Fallback:通过 notify-panel CLI 动态拿地址。 */
async function discoverFromCli(
	pi: ExtensionAPI,
): Promise<ServerInfo | null> {
	try {
		const result = await pi.exec("notify-panel", ["url", "--json"], {
			timeout: 2000,
		});
		if (result.code !== 0 || !result.stdout.trim()) return null;
		const info = JSON.parse(result.stdout) as {
			url?: string;
			secret?: string;
		};
		if (info.url) return { url: info.url, secret: info.secret };
		return null;
	} catch {
		return null;
	}
}

async function discover(
	pi: ExtensionAPI,
): Promise<ServerInfo | null> {
	// 文件优先(快、无进程开销);读不到(daemon 起在别处/没装 CLI 配置)再走 CLI。
	return discoverFromFile() ?? (await discoverFromCli(pi));
}

// ───────── HTTP(原生 fetch) ─────────

function authHeaders(srv: ServerInfo): Record<string, string> {
	return srv.secret ? { "X-Notify-Secret": srv.secret } : {};
}

async function fetchUnread(
	srv: ServerInfo,
): Promise<NotifyItem[] | null> {
	try {
		const url = `${srv.url.replace(/\/$/, "")}/v1/notify?unread=1`;
		const res = await fetch(url, {
			headers: authHeaders(srv),
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return null;
		const payload = (await res.json()) as ListResponse;
		if (!payload.ok) return null;
		// 关键:unread 查询不排除 archived,客户端必须过滤
		return (payload.items ?? []).filter((i) => !i.archived);
	} catch {
		return null;
	}
}

/** 把一批标记已读。单条失败不影响整批。 */
async function markRead(srv: ServerInfo, ids: string[]): Promise<void> {
	const base = srv.url.replace(/\/$/, "");
	await Promise.all(
		ids.map(async (id) => {
			try {
				await fetch(`${base}/v1/notify/${encodeURIComponent(id)}`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						...authHeaders(srv),
					},
					body: JSON.stringify({ read: true }),
					signal: AbortSignal.timeout(2000),
				});
			} catch {
				/* 忽略单条失败 */
			}
		}),
	);
}

// ───────── 格式化 ─────────
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

function formatMessage(items: NotifyItem[], usagePct: number | null): string {
	const lines: string[] = [];
	lines.push(`[notify-panel] 收到 ${items.length} 条未读通知,请处理:`);
	for (const item of items) {
		const head = `${severityEmoji(item.severity)} [${item.severity ?? "info"}] ${item.title ?? "(无标题)"} (${item.source ?? "unknown"}) [id=${item.id}]`;
		const body = item.message?.trim() ? `\n  ${item.message.trim()}` : "";
		lines.push(`\n${head}${body}`);
	}
	if (usagePct != null && usagePct >= CONTEXT_THRESHOLD_PCT) {
		lines.push("");
		lines.push(
			`⚠️ 当前上下文已使用 ${usagePct.toFixed(1)}%,已超过 ${CONTEXT_THRESHOLD_PCT}% 阈值。`,
		);
		lines.push("建议先执行 /compact 压缩上下文,再继续处理上面的通知。");
	}
	return lines.join("\n");
}

// ───────── 扩展 ─────────
export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let running = false; // tick 并发锁
	let paused = false; // 手动暂停
	let currentInterval = POLL_INTERVAL_MS; // 动态间隔(退避用)
	let lastError = ""; // 最近一次错误,供 status 展示
	let deliveredCount = 0; // 本会话累计投递条数

	const STATUS_KEY = "notify-panel";

	function clearTimer() {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	}

	function refreshStatus(ctx: ExtensionContext) {
		if (paused) {
			ctx.ui.setStatus(STATUS_KEY, "⏸ paused");
		} else if (lastError) {
			ctx.ui.setStatus(
				STATUS_KEY,
				`⚠ ${lastError} · ${currentInterval / 1000}s`,
			);
		} else {
			ctx.ui.setStatus(
				STATUS_KEY,
				`▶ polling ${currentInterval / 1000}s · delivered ${deliveredCount}`,
			);
		}
	}

	function schedule(
		ctx: ExtensionContext,
		intervalMs: number,
	) {
		clearTimer();
		currentInterval = intervalMs;
		timer = setInterval(() => void tick(ctx), intervalMs);
		refreshStatus(ctx);
	}

	async function tick(ctx: ExtensionContext): Promise<void> {
		if (running || paused) return;
		running = true;
		try {
			const srv = await discover(pi);
			if (!srv) {
				// daemon 没起 → 退避,但保持轮询以便 daemon 回来
				lastError = "daemon unreachable";
				const next = Math.min(currentInterval * 2, MAX_BACKOFF_MS);
				if (next !== currentInterval) schedule(ctx, next);
				return;
			}

			const unread = await fetchUnread(srv);
			if (unread === null) {
				lastError = "fetch failed";
				const next = Math.min(currentInterval * 2, MAX_BACKOFF_MS);
				if (next !== currentInterval) schedule(ctx, next);
				return;
			}
			// 恢复正常:清错误、回到基础间隔
			if (lastError || currentInterval !== POLL_INTERVAL_MS) {
				lastError = "";
				schedule(ctx, POLL_INTERVAL_MS);
			}

			if (unread.length === 0) return;

			// 上下文占用(可能为 null:刚压缩完、还没下一轮 LLM 响应)
			const usage = ctx.getContextUsage();
			const pct = usage?.percent ?? null;

			const message = formatMessage(unread, pct);

			// 先投递。sendUserMessage 在 idle 时同步触发 turn;
			// 非 idle 必须指定 deliverAs,这里用 followUp 排队,不抢占当前任务。
			// sendUserMessage 抛错会被外层 catch,通知保留未读,下一轮重试。
			if (ctx.isIdle()) {
				pi.sendUserMessage(message);
			} else {
				pi.sendUserMessage(message, { deliverAs: "followUp" });
			}

			// 投递成功后再标记已读,避免丢消息
			await markRead(srv, unread.map((i) => i.id));

			deliveredCount += unread.length;
			pi.appendEntry("notify-panel:delivered", {
				at: Date.now(),
				count: unread.length,
				ids: unread.map((i) => i.id),
			} satisfies DeliveredRecord);
			refreshStatus(ctx);
		} catch (err) {
			// 轮询异常不应崩溃整个扩展。记录错误,下一轮继续。
			lastError = err instanceof Error ? err.message.slice(0, 40) : "tick error";
			refreshStatus(ctx);
		} finally {
			running = false;
		}
	}

	// ───────── CLI flag:全局禁用 ─────────
	pi.registerFlag("no-notify-panel", {
		description: "Disable the notify-panel poller extension",
		type: "boolean",
		default: false,
	});

	// ───────── 命令:运行时控制 + 自检 ─────────
	pi.registerCommand("notify-panel", {
		description:
			"notify-panel 轮询器:status | pause | resume | poll | test",
		handler: async (args, ctx) => {
			// flag 禁用时,命令仍可用(便于排查),但不真正轮询
			if (pi.getFlag("no-notify-panel")) {
				ctx.ui.notify(
					"notify-panel 被 --no-notify-panel 禁用",
					"warning",
				);
				return;
			}

			const sub = (args.trim().split(/\s+/)[0] ?? "status").toLowerCase();

			if (sub === "pause") {
				paused = true;
				clearTimer();
				refreshStatus(ctx);
				ctx.ui.notify("notify-panel 已暂停", "info");
				return;
			}
			if (sub === "resume") {
				paused = false;
				schedule(ctx, POLL_INTERVAL_MS);
				ctx.ui.notify("notify-panel 已恢复", "info");
				return;
			}
			if (sub === "poll") {
				ctx.ui.notify("手动触发一次轮询...", "info");
				await tick(ctx);
				return;
			}
			if (sub === "test") {
				// 不依赖真实通知:直接验证服务发现 + HTTP 链路
				const srv = await discover(pi);
				if (!srv) {
					ctx.ui.notify(
						"找不到 notify-panel daemon(读 server.json / CLI 均失败)",
						"error",
					);
					return;
				}
				const unread = await fetchUnread(srv);
				ctx.ui.notify(
					`daemon=${srv.url} · unread=${unread === null ? "fetch 失败" : unread.length}`,
					unread === null ? "error" : "info",
				);
				return;
			}

			// status(默认)
			const usage = ctx.getContextUsage();
			ctx.ui.notify(
				[
					`state: ${paused ? "paused" : lastError ? "error" : "running"}`,
					`interval: ${currentInterval / 1000}s`,
					`delivered: ${deliveredCount}`,
					`context: ${usage?.percent != null ? `${usage.percent.toFixed(1)}%` : "unknown"}`,
					lastError ? `lastError: ${lastError}` : null,
				]
					.filter(Boolean)
					.join(" · "),
				"info",
			);
		},
	});

	// ───────── 生命周期 ─────────
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("no-notify-panel")) {
			ctx.ui.setStatus(STATUS_KEY, "⏸ disabled (--no-notify-panel)");
			return;
		}
		// 先清掉可能残留的旧 timer(/reload 场景)
		clearTimer();
		schedule(ctx, POLL_INTERVAL_MS);
	});

	pi.on("session_shutdown", async () => {
		clearTimer();
	});
}
