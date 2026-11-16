/**
 * 同步码：把自建同步服务的「访问地址 + 令牌」编码成一个字符串，用户只需粘贴一次。
 * 由服务端生成（启动日志 / `nsh-sync-server code` 子命令），客户端解析。
 *
 *   nsh1_<base64url( mask( utf8(地址) 0x00 utf8(令牌) ‖ 校验 2 字节 ) )>
 *
 * - 校验：FNV-1a 32 位的低 16 位（大端），用于发现复制不全 / 手误
 * - 混淆：与固定密钥循环异或，再叠加按位置变化的字节，避免地址与令牌明文可读
 * 注意：这是编码混淆而非加密，持有同步码即可访问对应空间，应像密码一样保管。
 * 与 server/synccode.go 保持完全一致（tests/sync-code.test.ts 中有共享测试向量）。
 */
export const SYNC_CODE_PREFIX = 'nsh1_';
const KEY = new TextEncoder().encode('nodeseek-helper/sync-code/v1');

function fnv16(bytes: Uint8Array): [number, number] {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return [(h >>> 8) & 0xff, h & 0xff];
}

function mask(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ KEY[i % KEY.length] ^ ((i * 0x5b + 0x2d) & 0xff);
  return out;
}

const toB64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

export function encodeSyncCode(base: string, token: string): string {
  const enc = new TextEncoder();
  const plain = new Uint8Array([...enc.encode(base.trim().replace(/\/+$/, '')), 0, ...enc.encode(token.trim())]);
  return SYNC_CODE_PREFIX + toB64url(mask(new Uint8Array([...plain, ...fnv16(plain)])));
}

export interface SyncCodeParts {
  base: string;
  token: string;
}

/** 解析同步码；格式不对或校验失败抛出带中文说明的错误 */
export function decodeSyncCode(code: string): SyncCodeParts {
  const s = code.trim();
  if (!s.startsWith(SYNC_CODE_PREFIX)) throw new Error('不是有效的同步码（应以 nsh1_ 开头）');
  let bytes: Uint8Array;
  try {
    bytes = mask(fromB64url(s.slice(SYNC_CODE_PREFIX.length)));
  } catch {
    throw new Error('同步码格式错误');
  }
  if (bytes.length < 4) throw new Error('同步码不完整');
  const plain = bytes.slice(0, -2);
  const [c1, c2] = fnv16(plain);
  if (bytes[bytes.length - 2] !== c1 || bytes[bytes.length - 1] !== c2) throw new Error('同步码校验失败，可能复制不完整');
  const sep = plain.indexOf(0);
  if (sep < 1) throw new Error('同步码内容无效');
  const dec = new TextDecoder();
  const base = dec.decode(plain.slice(0, sep));
  const token = dec.decode(plain.slice(sep + 1));
  if (!/^https?:\/\//.test(base) || !token) throw new Error('同步码内容无效');
  return { base, token };
}
