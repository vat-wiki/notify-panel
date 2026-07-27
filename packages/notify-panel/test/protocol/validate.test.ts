import { describe, it, expect } from 'vitest';
import {
  validateNotifyPayload,
  validateNotifyBatch,
  isValidNotifyPayload,
} from '../../src/protocol';

// ---- validateNotifyPayload ----

describe('validateNotifyPayload - 合法用例', () => {
  it('最小合法载荷', () => {
    const r = validateNotifyPayload({ source: 'ci', title: 'build', message: 'ok' });
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.value.source).toBe('ci');
      expect(r.value.title).toBe('build');
      expect(r.value.message).toBe('ok');
    }
  });

  it('带全部可选字段', () => {
    const r = validateNotifyPayload({
      id: 'x1',
      source: 'ci',
      title: 't',
      message: 'm',
      severity: 'error',
      data: { foo: 1 },
      timestamp: 1700000000000,
      read: true,
      archived: false,
    });
    expect(r.valid).toBe(true);
  });

  it('所有 severity 取值都合法', () => {
    for (const s of ['info', 'success', 'warning', 'error'] as const) {
      expect(validateNotifyPayload({ source: 's', title: 't', message: 'm', severity: s }).valid).toBe(true);
    }
  });
});

describe('validateNotifyPayload - 非法用例', () => {
  it('非对象', () => {
    const r = validateNotifyPayload('not an object');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors._).toBeTruthy();
  });

  it('缺 source', () => {
    const r = validateNotifyPayload({ title: 't', message: 'm' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.source).toBeTruthy();
  });

  it('缺 title', () => {
    const r = validateNotifyPayload({ source: 's', message: 'm' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.title).toBeTruthy();
  });

  it('缺 message', () => {
    const r = validateNotifyPayload({ source: 's', title: 't' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.message).toBeTruthy();
  });

  it('source 过长(>64)', () => {
    const r = validateNotifyPayload({ source: 'x'.repeat(65), title: 't', message: 'm' });
    expect(r.valid).toBe(false);
  });

  it('title 过长(>256)', () => {
    const r = validateNotifyPayload({ source: 's', title: 'x'.repeat(257), message: 'm' });
    expect(r.valid).toBe(false);
  });

  it('message 过长(>4096)', () => {
    const r = validateNotifyPayload({ source: 's', title: 't', message: 'x'.repeat(4097) });
    expect(r.valid).toBe(false);
  });

  it('非法 severity', () => {
    const r = validateNotifyPayload({ source: 's', title: 't', message: 'm', severity: 'critical' as any });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.severity).toBeTruthy();
  });

  it('timestamp 非法(负数)', () => {
    const r = validateNotifyPayload({ source: 's', title: 't', message: 'm', timestamp: -1 });
    expect(r.valid).toBe(false);
  });

  it('read 非 boolean', () => {
    const r = validateNotifyPayload({ source: 's', title: 't', message: 'm', read: 'yes' as any });
    expect(r.valid).toBe(false);
  });
});

// ---- isValidNotifyPayload(类型守卫)----

describe('isValidNotifyPayload', () => {
  it('合法返回 true', () => {
    expect(isValidNotifyPayload({ source: 's', title: 't', message: 'm' })).toBe(true);
  });
  it('非法返回 false', () => {
    expect(isValidNotifyPayload({ title: 't' })).toBe(false);
  });
});
