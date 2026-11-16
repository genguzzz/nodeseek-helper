import { GM_xmlhttpRequest } from '$';
import { gmErrorMessage, type FieldDef } from '../core/uploaders';
import type { Envelope } from './crypto';

/* ---------------- 通用 HTTP ---------------- */

interface HttpResult {
  status: number;
  text: string;
  headers: Record<string, string>;
}

function http(method: string, url: string, headers: Record<string, string> = {}, body?: string, timeout = 30_000): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: method as 'GET',
      headers,
      data: body,
      responseType: 'text',
      timeout,
      onload: (r) => {
        const map: Record<string, string> = {};
        for (const line of (r.responseHeaders ?? '').split(/\r?\n/)) {
          const i = line.indexOf(':');
          if (i > 0) map[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        }
        resolve({ status: r.status, text: r.responseText, headers: map });
      },
      onerror: (e: unknown) => reject(new Error(gmErrorMessage(e, url))),
      ontimeout: () => reject(new Error('请求超时')),
    });
  });
}

const trimBase = (u: string | undefined): string => (u ?? '').trim().replace(/\/+$/, '');

export class ConflictError extends Error {
  constructor() {
    super('远端在此期间被其他设备修改');
  }
}

export interface PullResult {
  /** empty：远端还没有数据；notModified：与 etag 一致 */
  status: 'ok' | 'empty' | 'notModified';
  etag?: string;
  envelope?: Envelope;
}

export type Values = Record<string, string>;

export interface SyncProvider {
  id: string;
  name: string;
  desc: string;
  homepage?: string;
  fields: FieldDef[];
  pull(v: Values, etag?: string): Promise<PullResult>;
  /** 返回新的 etag；版本冲突抛 ConflictError */
  push(v: Values, env: Envelope, etag?: string): Promise<string>;
  /** 可选：长轮询，远端变化返回 true，超时返回 false */
  watch?(v: Values, etag: string, signal: AbortSignal): Promise<boolean>;
  /** 可选：首次推送后需要回写到配置里的值（如自动创建的 Gist ID） */
  updates?: (v: Values) => Values | undefined;
}

function parseEnvelope(text: string): Envelope {
  try {
    return JSON.parse(text) as Envelope;
  } catch {
    throw new Error('远端文件不是有效的同步数据');
  }
}

function fail(r: HttpResult, what: string): never {
  if (r.status === 401 || r.status === 403) throw new Error(`${what}：认证失败（HTTP ${r.status}），请检查令牌 / 账号密码`);
  throw new Error(`${what}：HTTP ${r.status} ${r.text.slice(0, 120)}`);
}

/* ---------------- 自建 Go 服务 ---------------- */

const selfhost: SyncProvider = {
  id: 'selfhost',
  name: '自建同步服务',
  desc: '本项目的 Go 同步服务（单文件 / Docker，常驻内存 < 10MB），支持长轮询实时同步',
  fields: [
    { key: 'base', label: '服务地址', type: 'text', required: true, placeholder: 'https://sync.example.com' },
    { key: 'token', label: '访问令牌', type: 'password', required: true, help: '服务端 NSH_TOKENS 中的一个；每个令牌是独立的空间' },
  ],
  async pull(v, etag) {
    const r = await http('GET', `${trimBase(v.base)}/v1/sync`, { Authorization: `Bearer ${v.token}`, ...(etag ? { 'If-None-Match': etag } : {}) });
    if (r.status === 304) return { status: 'notModified', etag };
    if (r.status === 404) return { status: 'empty' };
    if (r.status !== 200) fail(r, '拉取失败');
    return { status: 'ok', etag: r.headers.etag, envelope: parseEnvelope(r.text) };
  },
  async push(v, env, etag) {
    const r = await http('PUT', `${trimBase(v.base)}/v1/sync`, {
      Authorization: `Bearer ${v.token}`,
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
    }, JSON.stringify(env));
    if (r.status === 412) throw new ConflictError();
    if (r.status !== 200) fail(r, '推送失败');
    return r.headers.etag || (JSON.parse(r.text) as { etag: string }).etag;
  },
  async watch(v, etag, signal) {
    if (signal.aborted) return false;
    const r = await http('GET', `${trimBase(v.base)}/v1/sync/watch?etag=${encodeURIComponent(etag)}&timeout=25`, { Authorization: `Bearer ${v.token}` }, undefined, 35_000);
    if (r.status === 200) return true;
    if (r.status === 304) return false;
    // 限流 / 认证失败 / 服务异常：抛出让调用方退避，不能当作「无变化」立刻重连
    throw new Error(`实时同步：HTTP ${r.status}`);
  },
};

/* ---------------- WebDAV（坚果云 / Nextcloud / 群晖 / Alist …） ---------------- */

const SYNC_FILE = 'nodeseek-helper-sync.json';

const webdav: SyncProvider = {
  id: 'webdav',
  name: 'WebDAV',
  desc: '坚果云、Nextcloud、群晖、Alist、InfiniCLOUD 等，任意支持 WebDAV 的网盘',
  homepage: 'https://help.jianguoyun.com/?p=2064',
  fields: [
    {
      key: 'base',
      label: '目录地址',
      type: 'text',
      required: true,
      placeholder: 'https://dav.jianguoyun.com/dav/我的坚果云/',
      help: '填一个已存在的目录，同步文件为该目录下的 nodeseek-helper-sync.json',
    },
    { key: 'user', label: '账号', type: 'text', required: true },
    { key: 'pass', label: '密码', type: 'password', required: true, help: '坚果云需使用「第三方应用密码」' },
  ],
  async pull(v, etag) {
    const r = await http('GET', fileUrl(v), { ...davAuth(v), ...(etag ? { 'If-None-Match': etag } : {}) });
    if (r.status === 304) return { status: 'notModified', etag };
    if (r.status === 404) return { status: 'empty' };
    if (r.status !== 200) fail(r, '拉取失败');
    return { status: 'ok', etag: r.headers.etag || r.headers['last-modified'], envelope: parseEnvelope(r.text) };
  },
  async push(v, env, etag) {
    const headers: Record<string, string> = { ...davAuth(v), 'Content-Type': 'application/json' };
    // 只有真正的 ETag 才做条件写；部分服务只给 Last-Modified，这时退化为先读后写
    if (etag && etag.startsWith('"')) headers['If-Match'] = etag;
    else if (etag) {
      const cur = await http('HEAD', fileUrl(v), davAuth(v));
      const now = cur.headers.etag || cur.headers['last-modified'];
      if (now && now !== etag) throw new ConflictError();
    } else headers['If-None-Match'] = '*';
    const r = await http('PUT', fileUrl(v), headers, JSON.stringify(env));
    if (r.status === 412) throw new ConflictError();
    if (r.status === 409) throw new Error('目录不存在，请先在网盘里创建该目录');
    if (r.status >= 300) fail(r, '推送失败');
    if (r.headers.etag) return r.headers.etag;
    const head = await http('HEAD', fileUrl(v), davAuth(v));
    return head.headers.etag || head.headers['last-modified'] || String(Date.now());
  },
};

function fileUrl(v: Values): string {
  const base = (v.base ?? '').trim().replace(/\/*$/, '/');
  return encodeURI(decodeURI(base)) + SYNC_FILE;
}

function davAuth(v: Values): Record<string, string> {
  return { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${v.user}:${v.pass}`)))}` };
}

/* ---------------- GitHub Gist ---------------- */

const GIST_API = 'https://api.github.com/gists';

const gist: SyncProvider = {
  id: 'gist',
  name: 'GitHub Gist',
  desc: '存到你的私密 Gist；令牌只需 gist 权限',
  homepage: 'https://github.com/settings/tokens/new?scopes=gist&description=nodeseek-helper',
  fields: [
    { key: 'token', label: 'GitHub 令牌', type: 'password', required: true, help: 'Classic token 勾选 gist；Fine-grained token 授予 Gists 读写' },
    { key: 'gistId', label: 'Gist ID', type: 'text', placeholder: '留空则首次同步时自动创建私密 Gist', help: '多设备请填同一个 Gist ID' },
  ],
  async pull(v) {
    if (!v.gistId) return { status: 'empty' };
    const r = await http('GET', `${GIST_API}/${v.gistId}`, ghHeaders(v));
    if (r.status === 404) throw new Error('找不到该 Gist，请检查 Gist ID 或令牌权限');
    if (r.status !== 200) fail(r, '拉取失败');
    const g = JSON.parse(r.text) as { history?: { version: string }[]; files: Record<string, { content?: string; truncated?: boolean; raw_url: string }> };
    const f = g.files[SYNC_FILE];
    if (!f) return { status: 'empty', etag: g.history?.[0]?.version };
    let content = f.content ?? '';
    if (f.truncated) content = (await http('GET', f.raw_url, ghHeaders(v))).text;
    return { status: 'ok', etag: g.history?.[0]?.version, envelope: parseEnvelope(content) };
  },
  async push(v, env, etag) {
    const body = JSON.stringify({ description: 'NodeSeek 助手同步数据', files: { [SYNC_FILE]: { content: JSON.stringify(env) } } });
    if (!v.gistId) {
      const r = await http('POST', GIST_API, { ...ghHeaders(v), 'Content-Type': 'application/json' }, JSON.stringify({ public: false, ...JSON.parse(body) }));
      if (r.status !== 201) fail(r, '创建 Gist 失败');
      const g = JSON.parse(r.text) as { id: string; history: { version: string }[] };
      v.gistId = g.id;
      return g.history[0].version;
    }
    // Gist 不支持条件写：写前读一次版本号比对
    if (etag) {
      const cur = await http('GET', `${GIST_API}/${v.gistId}`, ghHeaders(v));
      const ver = (JSON.parse(cur.text) as { history?: { version: string }[] }).history?.[0]?.version;
      if (ver && ver !== etag) throw new ConflictError();
    }
    const r = await http('PATCH', `${GIST_API}/${v.gistId}`, { ...ghHeaders(v), 'Content-Type': 'application/json' }, body);
    if (r.status !== 200) fail(r, '推送失败');
    return (JSON.parse(r.text) as { history: { version: string }[] }).history[0].version;
  },
  updates: (v) => (v.gistId ? { gistId: v.gistId } : undefined),
};

function ghHeaders(v: Values): Record<string, string> {
  return { Authorization: `Bearer ${v.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

/* ---------------- OneDrive（设备代码登录） ---------------- */

const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_FILE = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${SYNC_FILE}`;
const MS_SCOPE = 'Files.ReadWrite.AppFolder offline_access';

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresAt: number;
}

/** 第一步：申请设备代码，用户在 microsoft.com/devicelogin 输入 */
export async function onedriveStartLogin(clientId: string): Promise<DeviceCode> {
  const r = await http('POST', `${MS_AUTH}/devicecode`, { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ client_id: clientId, scope: MS_SCOPE }).toString());
  const j = JSON.parse(r.text) as { user_code: string; verification_uri: string; device_code: string; interval: number; expires_in: number; error_description?: string };
  if (r.status !== 200) throw new Error(j.error_description?.split('\n')[0] || `HTTP ${r.status}`);
  return { userCode: j.user_code, verificationUri: j.verification_uri, deviceCode: j.device_code, interval: j.interval, expiresAt: Date.now() + j.expires_in * 1000 };
}

/** 第二步：轮询直到用户完成登录，返回 refresh token */
export async function onedrivePollLogin(clientId: string, dc: DeviceCode, signal: AbortSignal): Promise<string> {
  while (Date.now() < dc.expiresAt) {
    if (signal.aborted) throw new Error('已取消');
    await new Promise((res) => setTimeout(res, dc.interval * 1000));
    const r = await http('POST', `${MS_AUTH}/token`, { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dc.deviceCode }).toString());
    const j = JSON.parse(r.text) as { refresh_token?: string; error?: string; error_description?: string };
    if (j.refresh_token) return j.refresh_token;
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') {
      dc.interval += 5;
      continue;
    }
    throw new Error(j.error_description?.split('\n')[0] || j.error || `HTTP ${r.status}`);
  }
  throw new Error('登录超时，请重新开始');
}

let msToken: { value: string; exp: number; refresh: string } | null = null;

async function msAccessToken(v: Values): Promise<string> {
  if (msToken && msToken.refresh === v.refreshToken && msToken.exp > Date.now() + 60_000) return msToken.value;
  if (!v.refreshToken) throw new Error('请先点击「登录 OneDrive」');
  const r = await http('POST', `${MS_AUTH}/token`, { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ grant_type: 'refresh_token', client_id: v.clientId, refresh_token: v.refreshToken, scope: MS_SCOPE }).toString());
  const j = JSON.parse(r.text) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!j.access_token) throw new Error(`OneDrive 登录已失效，请重新登录（${j.error_description?.split('\n')[0] ?? r.status}）`);
  // 微软会轮换 refresh token，交给引擎回写到配置
  if (j.refresh_token) v.refreshToken = j.refresh_token;
  msToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000, refresh: v.refreshToken };
  return j.access_token;
}

const onedrive: SyncProvider = {
  id: 'onedrive',
  name: 'OneDrive',
  desc: '存到 OneDrive 的应用专属文件夹（仅授予该文件夹读写权限），设备代码登录',
  homepage: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  fields: [
    {
      key: 'clientId',
      label: '应用 Client ID',
      type: 'text',
      required: true,
      help: '在 Microsoft Entra 注册应用：账户类型选「任何组织目录 + 个人 Microsoft 账户」，身份验证里开启「允许公共客户端流」，API 权限添加 Files.ReadWrite.AppFolder',
    },
  ],
  async pull(v, etag) {
    const auth = { Authorization: `Bearer ${await msAccessToken(v)}` };
    const meta = await http('GET', `${GRAPH_FILE}?select=eTag`, auth);
    if (meta.status === 404) return { status: 'empty' };
    if (meta.status !== 200) fail(meta, '拉取失败');
    const tag = (JSON.parse(meta.text) as { eTag: string }).eTag;
    if (etag && tag === etag) return { status: 'notModified', etag };
    const r = await http('GET', `${GRAPH_FILE}:/content`, auth);
    if (r.status !== 200) fail(r, '下载失败');
    return { status: 'ok', etag: tag, envelope: parseEnvelope(r.text) };
  },
  async push(v, env, etag) {
    const headers: Record<string, string> = { Authorization: `Bearer ${await msAccessToken(v)}`, 'Content-Type': 'application/json' };
    if (etag) headers['If-Match'] = etag;
    const r = await http('PUT', `${GRAPH_FILE}:/content${etag ? '' : '?@microsoft.graph.conflictBehavior=fail'}`, headers, JSON.stringify(env));
    if (r.status === 412 || r.status === 409) throw new ConflictError();
    if (r.status >= 300) fail(r, '上传失败');
    return (JSON.parse(r.text) as { eTag: string }).eTag;
  },
  updates: (v) => (v.refreshToken ? { refreshToken: v.refreshToken } : undefined),
};

/** 返回缺失的必填项名称；全部填写时返回空数组 */
export function missingFields(p: SyncProvider, v: Values): string[] {
  return p.fields.filter((f) => f.required && !(v[f.key] ?? '').trim()).map((f) => f.label);
}

export const syncProviders: SyncProvider[] = [selfhost, webdav, gist, onedrive];
export const syncProviderById = (id: string): SyncProvider | undefined => syncProviders.find((p) => p.id === id);
