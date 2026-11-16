import type { SyncDocument } from './format';

/** 信封格式，见 docs/sync.md §4 */
export const ENVELOPE_FORMAT = 'nsh-sync-envelope/1';
const PBKDF2_ITER = 210_000;

export interface Envelope {
  format: typeof ENVELOPE_FORMAT;
  updatedAt: number;
  device: string;
  zip: 'gzip' | 'none';
  enc: 'aes-256-gcm' | 'none';
  kdf?: { name: 'PBKDF2'; hash: 'SHA-256'; iter: number; salt: string };
  iv?: string;
  data: string;
}

export class PassphraseError extends Error {}

/** 自建服务的空间已被另一个加密口令锁定（服务端按密钥标识拒绝写入） */
export class LockedError extends PassphraseError {}

const toB64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function pipe(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = await new Response((new Response(data).body as ReadableStream<BufferSource>).pipeThrough(stream as ReadableWritablePair<Uint8Array, BufferSource>)).arrayBuffer();
  return new Uint8Array(out);
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** 文档 → 信封：JSON → gzip → （可选）AES-256-GCM → base64 */
export async function seal(doc: SyncDocument, passphrase: string): Promise<Envelope> {
  const zipped = await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream('gzip'));
  const env: Envelope = { format: ENVELOPE_FORMAT, updatedAt: doc.updatedAt, device: doc.device, zip: 'gzip', enc: 'none', data: '' };
  if (!passphrase) {
    env.data = toB64(zipped);
    return env;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITER);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipped);
  return { ...env, enc: 'aes-256-gcm', kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: PBKDF2_ITER, salt: toB64(salt) }, iv: toB64(iv), data: toB64(cipher) };
}

/** 信封 → 文档；加密信封口令错误时抛 PassphraseError */
export async function open(env: Envelope, passphrase: string): Promise<SyncDocument> {
  if (env.format !== ENVELOPE_FORMAT) throw new Error(`不支持的同步数据格式：${String(env.format)}`);
  let bytes = fromB64(env.data);
  if (env.enc === 'aes-256-gcm') {
    if (!passphrase) throw new PassphraseError('远端数据已加密：请在已同步的设备上打开「同步」页点「复制接入码」，粘贴到本设备的同步码输入框');
    if (!env.kdf || !env.iv) throw new Error('加密信封缺少参数');
    const key = await deriveKey(passphrase, fromB64(env.kdf.salt), env.kdf.iter);
    try {
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, bytes));
    } catch {
      throw new PassphraseError('加密口令与其他设备不一致，无法解密远端数据。请在已同步的设备上打开「同步」页复制「接入码」，粘贴到本设备');
    }
  }
  if (env.zip === 'gzip') bytes = await pipe(bytes, new DecompressionStream('gzip'));
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as SyncDocument;
  if (doc.schema !== 'nsh-sync/1') throw new Error(`不支持的同步文档版本：${String(doc.schema)}`);
  return doc;
}

const keyIdCache = new Map<string, Promise<string>>();

/**
 * 密钥标识：由加密口令与空间（令牌）派生的固定值，随写入发给自建服务，用于「第一个设置口令的人锁定空间」。
 * PBKDF2 单向派生，服务端拿到它也无法反推出口令、更解不开数据；不同空间即使口令相同，标识也不同。
 */
export function keyId(passphrase: string, scope: string): Promise<string> {
  const cacheKey = `${scope}\u0000${passphrase}`;
  let p = keyIdCache.get(cacheKey);
  if (!p) {
    p = (async () => {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
      const salt = new TextEncoder().encode(`nsh-sync/key-id/v1\u0000${scope}`);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, base, 256);
      return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
    })();
    keyIdCache.set(cacheKey, p);
  }
  return p;
}
