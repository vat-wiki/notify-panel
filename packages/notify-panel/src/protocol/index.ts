/**
 * `notify-panel/protocol`
 *
 * 通知面板的开放协议（标准本体）。
 * 零运行时依赖，只导出契约：类型、JSON Schema 路径、校验器、传输常量。
 *
 * 对接方有三种等价方式，按偏好任选其一：
 *   1. 装 notify-panel，从 `notify-panel/protocol` 导入 —— 获得类型 + 校验器
 *   2. 只看协议，用 HTTP 推 JSON                    —— 不装任何东西
 *   3. 用仓库里的 JSON Schema 给 Go/Python 校验       —— 跨语言
 */
export * from './types';
export * from './validate';
export * from './discovery';
