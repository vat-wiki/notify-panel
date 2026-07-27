/**
 * 本地服务发现 —— 服务端侧辅助。
 *
 * 合并到单包后,读取 / 写入端口文件的实现统一在 `../protocol/discovery` 里,
 * 这里只做一层薄封装,保留 server 模块自洽的导入入口(供 server/index 使用)。
 */
export {
  writeServerFile,
  clearServerFile,
  readServerFile,
  isPidAlive,
  getRuntimeDir,
  getServerFilePath,
  discoverServer,
  DEFAULT_PORT,
  ENV_URL,
  ENV_HOME,
  type ServerInfo,
} from '../protocol';
