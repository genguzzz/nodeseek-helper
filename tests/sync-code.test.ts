import { describe, expect, it } from 'vitest';
import { decodeSyncCode, encodeSyncCode, looksLikeSyncCode } from '../src/sync/sync-code';

// 与 server/synccode_test.go 共用的测试向量（由 Go 服务端生成）
const VECTOR = 'nsh1_K5PzK5mrBe5bcbAZL8wtzMMxkehKpP9T_1Fun2JgyjmdjUKQuVPnEnrODDePZdizI8-pHPsTELve';

describe('同步码', () => {
  it('与 Go 服务端生成结果完全一致', () => {
    expect(encodeSyncCode('https://sync.example.com/nsh-sync/', 'demo-token-0123456789')).toBe(VECTOR);
  });

  it('解析出地址与令牌（去掉末尾斜杠）', () => {
    expect(decodeSyncCode(VECTOR)).toEqual({ base: 'https://sync.example.com/nsh-sync', token: 'demo-token-0123456789' });
    expect(decodeSyncCode('  ' + VECTOR + '\n')).toEqual({ base: 'https://sync.example.com/nsh-sync', token: 'demo-token-0123456789' });
  });

  it('明文中不出现地址与令牌', () => {
    expect(VECTOR).not.toContain('example');
    expect(VECTOR).not.toContain('demo-token');
  });

  it('复制不全、改动、非同步码都会报错', () => {
    expect(() => decodeSyncCode(VECTOR.slice(0, -3))).toThrow(/校验|不完整|格式|无效/);
    expect(() => decodeSyncCode(VECTOR.slice(0, 20) + 'A' + VECTOR.slice(21))).toThrow();
    expect(() => decodeSyncCode('https://sync.example.com')).toThrow(/nsh1_/);
  });

  it('中文与特殊字符往返', () => {
    const code = encodeSyncCode('https://同步.example.com/路径', 't0k+en/=中');
    expect(decodeSyncCode(code)).toEqual({ base: 'https://同步.example.com/路径', token: 't0k+en/=中' });
  });

  it('接入码携带加密口令，往返一致且明文不可见', () => {
    const code = encodeSyncCode('https://sync.example.com/', 'demo-token', 'my secret 口令');
    expect(decodeSyncCode(code)).toEqual({ base: 'https://sync.example.com', token: 'demo-token', passphrase: 'my secret 口令' });
    expect(code).not.toContain('secret');
  });

  it('识别误粘贴的同步码', () => {
    expect(looksLikeSyncCode(VECTOR)).toBe(true);
    expect(looksLikeSyncCode('nsh1_')).toBe(false);
    expect(looksLikeSyncCode('my passphrase')).toBe(false);
  });
});
