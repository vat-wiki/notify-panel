import { describe, it, expect } from 'vitest';
import { HTTP_PATH, validateNotifyPayload } from '../../src/protocol';

describe('冒烟测试:协议包能正常导入', () => {
  it('HTTP_PATH 常量存在', () => {
    expect(HTTP_PATH).toBe('/v1/notify');
  });

  it('validateNotifyPayload 能用', () => {
    expect(validateNotifyPayload({ source: 's', title: 't', message: 'm' }).valid).toBe(true);
  });
});
