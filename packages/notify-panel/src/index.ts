/**
 * notify-panel —— 系统级通知中心,单一 npm 包。
 *
 * 本包把原本拆成 5 个子包(protocol / core / sdk / server / cli)的能力合并成一个发布单元。
 * 按使用场景从子路径导入:
 *
 * - 纯协议契约(类型 / JSON Schema / 校验器):  `notify-panel/protocol`
 * - 核心引擎(内存 + 持久化存储):              `notify-panel/core`
 * - 集成方 SDK(HTTP 客户端):                  `notify-panel/sdk`
 * - 参考服务端(Fastify 实现):                 `notify-panel/server`
 * - 命令行入口:                                `notify-panel/cli`
 *
 * 也可以直接从根入口取常用 API:
 * ```ts
 * import { NotifyClient, createServer, NotifyPanel } from 'notify-panel';
 * ```
 *
 * 注意:协议层有一个 `NotifyError` 结构体(描述 daemon 返回的错误响应),
 * SDK 层有一个同名 `NotifyError` class(客户端抛出的异常)。
 * 在根入口里,`NotifyError` 指 SDK 的 class;协议结构体以 `NotifyErrorResponse` 别名导出,
 * 避免歧义。需要协议原始类型时请从 `notify-panel/protocol` 子路径导入。
 */

// ---- protocol(契约层)----
export {
  HTTP_PATH,
  WS_EVENT,
  WS_INCOMING_CHANNEL,
  MEDIA_TYPE,
  validateNotifyPayload,
  validateNotifyBatch,
  isValidNotifyPayload,
  discoverServer,
  readServerFile,
  writeServerFile,
  clearServerFile,
  isPidAlive,
  getRuntimeDir,
  getServerFilePath,
  DEFAULT_PORT,
  ENV_URL,
  ENV_HOME,
  type Severity,
  type NotifyPayload,
  type Notification,
  type NotifyBatch,
  type NotifyResult,
  type PanelEvent,
  type ServerInfo,
  type DiscoveryOptions,
  type ValidationResult,
  type ValidationOk,
  type ValidationFail,
  // NotifyError 在 protocol 里是「错误响应结构体」,与 SDK 抛出的 NotifyError class 同名,
  // 这里用别名导出避免冲突。
  type NotifyError as NotifyErrorResponse,
  type NotifyResponse,
} from './protocol';

// ---- core(引擎层)----
export {
  NotifyPanel,
  TypedEmitter,
  FileStorage,
  type CoreEvents,
  type NotificationStorage,
} from './core';

// ---- sdk(集成方客户端)----
export { NotifyClient, NotifyError, type ClientOptions, type ListOptions, type ListResult } from './sdk';

// ---- server(参考服务端)----
export {
  createServer,
  findRunningDaemon,
  stopRunningDaemon,
  buildApp,
  registerRoutes,
  type StartOptions,
  type RunningServer,
  type ServerOptions,
} from './server';
