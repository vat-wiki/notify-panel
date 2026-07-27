import { describe, it, expect } from 'vitest';
import { validateNotifyBatch } from '../../src/protocol';

describe('validateNotifyBatch - 合法', () => {
  it('外层 source 自动注入到每个 item(item 不必带 source)', () => {
    const r = validateNotifyBatch({
      source: 'ci',
      items: [
        { title: 't1', message: 'm1' },
        { title: 't2', message: 'm2' },
      ],
    });
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.value.items[0].source).toBe('ci');
      expect(r.value.items[1].source).toBe('ci');
    }
  });

  it('item 自带 source 也合法(以 item 为准)', () => {
    const r = validateNotifyBatch({
      source: 'ci',
      items: [{ source: 'override', title: 't', message: 'm' }],
    });
    expect(r.valid).toBe(true);
  });
});

describe('validateNotifyBatch - 非法', () => {
  it('缺外层 source', () => {
    const r = validateNotifyBatch({ items: [{ title: 't', message: 'm' }] });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.source).toBeTruthy();
  });

  it('items 不是数组', () => {
    const r = validateNotifyBatch({ source: 'ci', items: 'nope' as any });
    expect(r.valid).toBe(false);
  });

  it('items 为空', () => {
    const r = validateNotifyBatch({ source: 'ci', items: [] });
    expect(r.valid).toBe(false);
  });

  it('items 超过 500 条', () => {
    const items = Array.from({ length: 501 }, () => ({ title: 't', message: 'm' }));
    const r = validateNotifyBatch({ source: 'ci', items });
    expect(r.valid).toBe(false);
  });

  it('item 自身字段非法(缺 message)', () => {
    const r = validateNotifyBatch({ source: 'ci', items: [{ title: 't' }] });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors['items[0]']).toBeTruthy();
  });

  it('字段级错误定位准确(items[1])', () => {
    const r = validateNotifyBatch({
      source: 'ci',
      items: [{ title: 't1', message: 'm1' }, { title: 't2' }],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors['items[1]']).toBeTruthy();
  });
});
