/**
 * @notify-panel/protocol
 *
 * 通知面板的开放协议。
 * 这个包不包含任何运行时实现,只定义「契约」:
 *   - 数据结构(TypeScript 类型)
 *   - JSON Schema(供任意语言校验)
 *   - 校验器(零依赖,几百字节)
 *   - 传输协议常量(HTTP 路径、事件名)
 *
 * 第三方系统接入只需依赖本包(或参照 README 自行实现),无需依赖面板实现。
 */

// ====== 传输协议常量 ======

/** 默认 HTTP 接收端点 */
export const HTTP_PATH = '/v1/notify' as const;

/** WebSocket 事件名(面板 -> 客户端) */
export const WS_EVENT = 'notify' as const;

/** WebSocket 发送频道名(客户端 -> 面板) */
export const WS_INCOMING_CHANNEL = 'notify:push' as const;

/** 校验通过回包用的 media-type */
export const MEDIA_TYPE = 'application/vnd.notify-panel.v1+json' as const;

// ====== 数据模型 ======

/**
 * 通知的严重程度
 */
export type Severity = 'info' | 'success' | 'warning' | 'error';

/**
 * 推送通知请求体 —— 第三方对接时往面板发送的标准载荷。
 *
 * 只有 source / title / message 是必填,其余都是可选。
 * `source` 用于标识来源(例如 'wechat'、'slack'、'ci-build'),
 * 面板按它分组、过滤、计数。
 */
export interface NotifyPayload {
  /** 全局唯一 ID。不传时由面板自动生成 */
  id?: string;
  /** 必填:来源标识 */
  source: string;
  /** 必填:标题 */
  title: string;
  /** 必填:正文 */
  message: string;
  severity?: Severity;
  /** 自定义扩展数据。不同来源可以塞自己的结构,面板不解释 */
  data?: Record<string, unknown>;
  /** 毫秒时间戳,不传时由面板填充 */
  timestamp?: number;
  /** 是否已读,默认 false */
  read?: boolean;
  /** 是否归档,默认 false */
  archived?: boolean;
}

/**
 * 面板回填完字段后的标准通知对象(面板内部 & 对外查询返回用)。
 */
export interface Notification extends NotifyPayload {
  id: string;
  timestamp: number;
  severity: Severity;
  read: boolean;
  archived: boolean;
}

/**
 * 批量推送请求体(Webhook / HTTP 接口的批量变体)。
 */
export interface NotifyBatch {
  source: string;
  items: NotifyPayload[];
}

/**
 * 推送结果响应。
 */
export interface NotifyResult {
  ok: true;
  /** 被接受的通知(已回填 id/timestamp 等) */
  accepted: Notification[];
}

export interface NotifyError {
  ok: false;
  error: {
    code: string;
    message: string;
    /** 字段级错误,方便排查 */
    fields?: Record<string, string>;
  };
}

export type NotifyResponse = NotifyResult | NotifyError;

// ====== 事件协议(WebSocket / SSE 推给客户端) ======

export type PanelEvent =
  | { type: 'notification'; data: Notification }
  | { type: 'notifications'; data: Notification[] }
  | { type: 'read'; data: { id: string; read: boolean } }
  | { type: 'archived'; data: { id: string; archived: boolean } }
  | { type: 'removed'; data: { id: string } }
  | { type: 'cleared' }
  | { type: 'allRead' };
