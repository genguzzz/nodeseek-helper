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
    if (!passphrase) throw new PassphraseError('远端数据已加密，请填写同步口令');
    if (!env.kdf || !env.iv) throw new Error('加密信封缺少参数');
    const key = await deriveKey(passphrase, fromB64(env.kdf.salt), env.kdf.iter);
    try {
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, bytes));
    } catch {
      throw new PassphraseError('同步口令错误，无法解密远端数据');
    }
  }
  if (env.zip === 'gzip') bytes = await pipe(bytes, new DecompressionStream('gzip'));
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as SyncDocument;
  if (doc.schema !== 'nsh-sync/1') throw new Error(`不支持的同步文档版本：${String(doc.schema)}`);
  return doc;
}
