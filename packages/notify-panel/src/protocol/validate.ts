/**
 * 零依赖校验器。
 *
 * 协议要能成为「标准」,关键就是校验规则只有一份来源。
 * 这里手写实现而非引入 ajv 等,目的就是让 protocol 包保持极小,
 * 第三方愿意直接依赖它。
 *
 * 返回的错误结构与 NotifyError 里的 fields 对齐,方便定位。
 */
import type { NotifyPayload, NotifyBatch, Severity } from './types';

export interface ValidationOk<T> {
  valid: true;
  value: T;
}
export interface ValidationFail {
  valid: false;
  errors: Record<string, string>;
}
export type ValidationResult<T> = ValidationOk<T> | ValidationFail;

const SEVERITIES: Severity[] = ['info', 'success', 'warning', 'error'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 校验单条通知载荷。
 */
export function validateNotifyPayload(input: unknown): ValidationResult<NotifyPayload> {
  if (!isObject(input)) {
    return { valid: false, errors: { _: 'payload must be a JSON object' } };
  }
  const errors: Record<string, string> = {};

  // source
  if (typeof input.source !== 'string' || input.source.length === 0) {
    errors.source = 'source is required and must be a non-empty string';
  } else if (input.source.length > 64) {
    errors.source = 'source length must be <= 64';
  }

  // title
  if (typeof input.title !== 'string' || input.title.length === 0) {
    errors.title = 'title is required and must be a non-empty string';
  } else if (input.title.length > 256) {
    errors.title = 'title length must be <= 256';
  }

  // message
  if (typeof input.message !== 'string' || input.message.length === 0) {
    errors.message = 'message is required and must be a non-empty string';
  } else if (input.message.length > 4096) {
    errors.message = 'message length must be <= 4096';
  }

  // severity(可选)
  if (input.severity != null && !SEVERITIES.includes(input.severity as Severity)) {
    errors.severity = `severity must be one of ${SEVERITIES.join(' | ')}`;
  }

  // timestamp(可选)
  if (input.timestamp != null && (typeof input.timestamp !== 'number' || input.timestamp < 0)) {
    errors.timestamp = 'timestamp must be a non-negative number (ms)';
  }

  // read / archived(可选)
  if (input.read != null && typeof input.read !== 'boolean') {
    errors.read = 'read must be boolean';
  }
  if (input.archived != null && typeof input.archived !== 'boolean') {
    errors.archived = 'archived must be boolean';
  }

  // id(可选)
  if (input.id != null && (typeof input.id !== 'string' || input.id.length === 0)) {
    errors.id = 'id must be a non-empty string';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: input as unknown as NotifyPayload };
}

/**
 * 校验批量推送。
 */
export function validateNotifyBatch(input: unknown): ValidationResult<NotifyBatch> {
  if (!isObject(input)) {
    return { valid: false, errors: { _: 'payload must be a JSON object' } };
  }
  const errors: Record<string, string> = {};

  if (typeof input.source !== 'string' || input.source.length === 0) {
    errors.source = 'source is required and must be a non-empty string';
  }

  if (!Array.isArray(input.items)) {
    errors.items = 'items must be an array';
  } else if (input.items.length === 0) {
    errors.items = 'items must not be empty';
  } else if (input.items.length > 500) {
    errors.items = 'items length must be <= 500';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  // batch 语义:外层 source 适用于所有 item。先注入 source 再校验每个 item,
  // 这样调用方推送时不必每条重复写 source。
  const source = input.source;
  const items = (input.items as unknown[]).map((item) => ({
    source,
    ...(isObject(item) ? item : {}),
  }));
  const itemErrors: Record<string, string> = {};
  items.forEach((item, i) => {
    const r = validateNotifyPayload(item);
    if (!r.valid && r.errors) {
      // 忽略 source 相关错误(已被外层 source 覆盖)
      const { source: _drop, ...rest } = r.errors;
      if (Object.keys(rest).length > 0) itemErrors[`items[${i}]`] = Object.values(rest).join('; ');
    }
  });
  if (Object.keys(itemErrors).length > 0) {
    return { valid: false, errors: itemErrors };
  }
  return { valid: true, value: { source, items } as unknown as NotifyBatch };
}

/**
 * 判断任意值是否为合法的 NotifyPayload(类型守卫形式)。
 * 第三方库常会用这个做入参断言。
 */
export function isValidNotifyPayload(input: unknown): input is NotifyPayload {
  return validateNotifyPayload(input).valid;
}
