import { GM_xmlhttpRequest } from '$';
import type { HostProfile } from './store';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'switch' | 'textarea';
  placeholder?: string;
  help?: string;
  required?: boolean;
  default?: string | boolean;
  options?: { label: string; value: string }[];
  /** 归入「高级」折叠区 */
  advanced?: boolean;
}

type Values = Record<string, string | boolean>;

interface RequestPlan {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  fileField?: string;
  form?: Record<string, string>;
  /** binary：请求体直接是文件本身 */
  bodyType?: 'multipart' | 'binary';
}

export interface ProviderDef {
  id: string;
  name: string;
  desc: string;
  homepage?: string;
  badge?: string;
  fields: FieldDef[];
  build(v: Values, file: File): RequestPlan;
  parse(json: unknown, v: Values): string | undefined;
}

const str = (v: Values, k: string): string => String(v[k] ?? '').trim();
const trimBase = (u: string): string => u.replace(/\/+$/, '');

/** 把油猴的网络错误翻译成可操作的提示（最常见：跨域域名被 Tampermonkey 拦截） */
export function gmErrorMessage(e: unknown, url: string): string {
  if (e instanceof Error) return e.message;
  const raw = String((e as { error?: string } | undefined)?.error ?? '');
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* 保持原样 */
  }
  if (/blocked|refused|not.*permitted|@connect/i.test(raw)) {
    return `Tampermonkey 拦截了对 ${host} 的访问：打开 Tampermonkey 管理面板 → 本脚本 → 设置 → XHR 安全「用户域名白名单」添加 ${host}（或在弹出的跨域确认中选择「总是允许」）`;
  }
  return raw ? `网络错误：${raw}` : '网络错误，请检查地址、证书或跨域设置';
}

/** 读取 a.b[0].c / 0.src 形式的路径 */
export function getByPath(obj: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** 兜底：在响应里深度查找第一个像图片直链的 URL */
function findUrl(obj: unknown, depth = 0): string | undefined {
  if (depth > 6 || obj == null) return undefined;
  if (typeof obj === 'string') return /^https?:\/\//.test(obj) ? obj : undefined;
  if (typeof obj !== 'object') return undefined;
  const entries = Object.entries(obj as Record<string, unknown>);
  const prefer = ['url', 'src', 'link', 'direct', 'public_url', 'publicUrl', 'image_url'];
  entries.sort(([a], [b]) => (prefer.includes(b) ? 1 : 0) - (prefer.includes(a) ? 1 : 0));
  for (const [, val] of entries) {
    const r = findUrl(val, depth + 1);
    if (r) return r;
  }
  return undefined;
}

function parseKV(text: string): Record<string, string> {
  const t = text.trim();
  if (!t) return {};
  if (t.startsWith('{')) return JSON.parse(t) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const line of t.split('\n')) {
    const i = line.indexOf(':') > -1 ? line.indexOf(':') : line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export const providers: ProviderDef[] = [
  {
    id: 'cfimgbed',
    name: 'CloudFlare ImgBed',
    badge: '推荐',
    desc: 'MarSeventh/CloudFlare-ImgBed，支持 Telegram / R2 / S3 / Discord / HuggingFace 等渠道',
    homepage: 'https://github.com/MarSeventh/CloudFlare-ImgBed',
    fields: [
      { key: 'base', label: '站点地址', type: 'text', required: true, placeholder: 'https://img.example.com' },
      { key: 'authCode', label: '上传认证码', type: 'password', placeholder: '后台设置的 authCode，未开启可留空', help: '与 API Token 二选一' },
      { key: 'token', label: 'API Token', type: 'password', placeholder: '需具备 upload 权限', help: '以 Authorization: Bearer 方式发送' },
      {
        key: 'uploadChannel',
        label: '上传渠道',
        type: 'select',
        default: 'telegram',
        options: ['telegram', 'cfr2', 's3', 'discord', 'huggingface', 'webdav'].map((x) => ({ label: x, value: x })),
      },
      { key: 'channelName', label: '渠道名称', type: 'text', advanced: true, placeholder: '多渠道时指定，留空用默认' },
      { key: 'uploadFolder', label: '上传目录', type: 'text', advanced: true, placeholder: '如 nodeseek/2026' },
      {
        key: 'uploadNameType',
        label: '文件命名',
        type: 'select',
        default: 'default',
        advanced: true,
        options: [
          { label: '默认（前缀_原名）', value: 'default' },
          { label: '仅前缀', value: 'index' },
          { label: '原名', value: 'origin' },
          { label: '短链接', value: 'short' },
        ],
      },
      { key: 'serverCompress', label: '服务端压缩（仅 Telegram）', type: 'switch', default: true, advanced: true },
      { key: 'autoRetry', label: '失败自动切换渠道', type: 'switch', default: true, advanced: true },
      { key: 'usePublicUrl', label: '优先使用 publicUrl', type: 'switch', default: true, advanced: true },
      {
        key: 'urlPrefix',
        label: '自定义链接前缀',
        type: 'text',
        placeholder: '如 https://pic.example.com/，留空用 站点/file/',
        help: '对应站点「系统设置 → 链接前缀」，最终链接 = 前缀 + 文件名；可用下方「读取站点配置」自动填写',
      },
    ],
    build(v) {
      const base = trimBase(str(v, 'base'));
      const q = new URLSearchParams({
        uploadChannel: str(v, 'uploadChannel') || 'telegram',
        uploadNameType: str(v, 'uploadNameType') || 'default',
        serverCompress: String(v.serverCompress !== false),
        autoRetry: String(v.autoRetry !== false),
        returnFormat: 'full',
      });
      if (str(v, 'authCode')) q.set('authCode', str(v, 'authCode'));
      if (str(v, 'channelName')) q.set('channelName', str(v, 'channelName'));
      if (str(v, 'uploadFolder')) q.set('uploadFolder', str(v, 'uploadFolder'));
      const headers: Record<string, string> = {};
      if (str(v, 'token')) headers.Authorization = `Bearer ${str(v, 'token')}`;
      return { url: `${base}/upload?${q}`, headers, fileField: 'file' };
    },
    parse(json, v) {
      const item = (Array.isArray(json) ? json[0] : json) as { src?: string; publicUrl?: string } | undefined;
      if (!item) return undefined;
      if (v.usePublicUrl !== false && item.publicUrl) return item.publicUrl;
      if (!item.src) return undefined;
      // 与站点前端一致：rootUrl = 链接前缀 || 站点/file/，最终链接 = rootUrl + 文件 ID
      const prefix = str(v, 'urlPrefix');
      const fileId = item.src.replace(/^.*?\/file\//, '');
      if (prefix && fileId !== item.src) return prefix.replace(/\/*$/, '/') + fileId;
      return /^https?:/.test(item.src) ? item.src : trimBase(str(v, 'base')) + item.src;
    },
  },
  {
    id: 'lsky',
    name: '兰空图床 Lsky Pro',
    desc: 'Lsky Pro 1.x 开源版 / 2.x，使用 Bearer Token 上传',
    homepage: 'https://github.com/lsky-org/lsky-pro',
    fields: [
      { key: 'base', label: '站点地址', type: 'text', required: true, placeholder: 'https://lsky.example.com' },
      { key: 'token', label: 'Token', type: 'password', required: true, placeholder: '在 接口 → 生成 Token 获取，不含 Bearer 前缀' },
      {
        key: 'version',
        label: 'API 版本',
        type: 'select',
        default: 'v1',
        options: [
          { label: 'v1（开源版）', value: 'v1' },
          { label: 'v2（新版）', value: 'v2' },
        ],
      },
      { key: 'strategyId', label: '储存策略 ID', type: 'text', advanced: true, placeholder: 'v1: strategy_id / v2: storage_id，留空默认' },
      { key: 'albumId', label: '相册 ID', type: 'text', advanced: true },
      {
        key: 'permission',
        label: '权限',
        type: 'select',
        default: '',
        advanced: true,
        options: [
          { label: '默认', value: '' },
          { label: '公开', value: '1' },
          { label: '私有', value: '0' },
        ],
      },
    ],
    build(v) {
      const isV2 = str(v, 'version') === 'v2';
      const form: Record<string, string> = {};
      if (str(v, 'strategyId')) form[isV2 ? 'storage_id' : 'strategy_id'] = str(v, 'strategyId');
      if (str(v, 'albumId')) form.album_id = str(v, 'albumId');
      if (str(v, 'permission')) form.permission = str(v, 'permission');
      return {
        url: `${trimBase(str(v, 'base'))}/api/${isV2 ? 'v2' : 'v1'}/upload`,
        headers: { Authorization: `Bearer ${str(v, 'token').replace(/^Bearer\s+/i, '')}`, Accept: 'application/json' },
        fileField: 'file',
        form,
      };
    },
    parse(json) {
      return (getByPath(json, 'data.links.url') ?? getByPath(json, 'data.public_url') ?? getByPath(json, 'data.url')) as string | undefined;
    },
  },
  {
    id: 'easyimage',
    name: '简单图床 EasyImage',
    desc: 'icret/EasyImages2.0，在后台 API 设置中获取 Token',
    homepage: 'https://github.com/icret/EasyImages2.0',
    fields: [
      { key: 'base', label: '站点地址', type: 'text', required: true, placeholder: 'https://img.example.com' },
      { key: 'token', label: 'Token', type: 'password', required: true },
    ],
    build(v) {
      return { url: `${trimBase(str(v, 'base'))}/api/index.php`, fileField: 'image', form: { token: str(v, 'token') } };
    },
    parse(json) {
      return getByPath(json, 'url') as string | undefined;
    },
  },
  {
    id: 'chevereto',
    name: 'Chevereto',
    desc: 'Chevereto V3 / V4 自建图床（API v1）',
    homepage: 'https://chevereto.com',
    fields: [
      { key: 'base', label: '站点地址', type: 'text', required: true, placeholder: 'https://chevereto.example.com' },
      { key: 'key', label: 'API Key', type: 'password', required: true },
      { key: 'albumId', label: '相册 ID', type: 'text', advanced: true },
      {
        key: 'linkType',
        label: '返回链接',
        type: 'select',
        default: 'url',
        advanced: true,
        options: [
          { label: '原图', value: 'url' },
          { label: '中等缩略图', value: 'medium.url' },
        ],
      },
    ],
    build(v) {
      const form: Record<string, string> = { key: str(v, 'key'), format: 'json' };
      if (str(v, 'albumId')) form.album_id = str(v, 'albumId');
      return { url: `${trimBase(str(v, 'base'))}/api/1/upload`, headers: { 'X-API-Key': str(v, 'key') }, fileField: 'source', form };
    },
    parse(json, v) {
      return (getByPath(json, `image.${str(v, 'linkType') || 'url'}`) ?? getByPath(json, 'image.url')) as string | undefined;
    },
  },
  {
    id: 'nodeimage',
    name: 'NodeImage',
    desc: 'NodeSeek 社区常用的 nodeimage.com，在其首页「API 密钥」处复制',
    homepage: 'https://www.nodeimage.com',
    fields: [{ key: 'key', label: 'API Key', type: 'password', required: true }],
    build(v) {
      return { url: 'https://api.nodeimage.com/api/upload', headers: { 'X-API-Key': str(v, 'key') }, fileField: 'image' };
    },
    parse(json) {
      return (getByPath(json, 'links.direct') ?? getByPath(json, 'data.links.direct') ?? getByPath(json, 'url')) as string | undefined;
    },
  },
  {
    id: 'smms',
    name: 'SM.MS',
    desc: '老牌公共图床，在 用户中心 → API Token 获取',
    homepage: 'https://sm.ms',
    fields: [
      { key: 'token', label: 'API Token', type: 'password', required: true },
      { key: 'endpoint', label: 'API 地址', type: 'text', advanced: true, default: 'https://sm.ms/api/v2', placeholder: '国内可用 https://smms.app/api/v2' },
    ],
    build(v) {
      return {
        url: `${trimBase(str(v, 'endpoint') || 'https://sm.ms/api/v2')}/upload`,
        headers: { Authorization: str(v, 'token') },
        fileField: 'smfile',
        form: { format: 'json' },
      };
    },
    parse(json) {
      // 重复上传时返回 code=image_repeated，链接在 images 字段
      return (getByPath(json, 'data.url') ?? getByPath(json, 'images')) as string | undefined;
    },
  },
  {
    id: 'imgur',
    name: 'Imgur',
    desc: '使用 Client ID 匿名上传，在 api.imgur.com/oauth2/addclient 申请',
    homepage: 'https://imgur.com',
    fields: [{ key: 'clientId', label: 'Client ID', type: 'password', required: true }],
    build(v) {
      return { url: 'https://api.imgur.com/3/image', headers: { Authorization: `Client-ID ${str(v, 'clientId')}` }, fileField: 'image' };
    },
    parse(json) {
      return getByPath(json, 'data.link') as string | undefined;
    },
  },
  {
    id: 'piclist',
    name: 'PicList / PicGo 本地服务',
    desc: '转发到本机 PicList 的 HTTP 服务，由它上传到你在 PicList 里配置的任意图床',
    homepage: 'https://piclist.cn',
    fields: [
      { key: 'base', label: '服务地址', type: 'text', default: 'http://127.0.0.1:36677', required: true },
      { key: 'key', label: '鉴权密钥', type: 'password', placeholder: 'PicList 设置里的 server key，未设置留空' },
      { key: 'picbed', label: '指定图床', type: 'text', advanced: true, placeholder: '如 smms / github，留空用 PicList 默认' },
      { key: 'configName', label: '配置名', type: 'text', advanced: true },
    ],
    build(v) {
      const q = new URLSearchParams();
      if (str(v, 'key')) q.set('key', str(v, 'key'));
      if (str(v, 'picbed')) q.set('picbed', str(v, 'picbed'));
      if (str(v, 'configName')) q.set('configName', str(v, 'configName'));
      return { url: `${trimBase(str(v, 'base'))}/upload${q.size ? `?${q}` : ''}`, fileField: 'file' };
    },
    parse(json) {
      return getByPath(json, 'result[0]') as string | undefined;
    },
  },
  {
    id: 'custom',
    name: '自定义 / 高级',
    desc: '自由配置请求地址、请求头、表单字段与返回值路径，适配任意图床 API',
    fields: [
      { key: 'url', label: '上传地址', type: 'text', required: true, placeholder: 'https://api.example.com/upload?token=xxx' },
      {
        key: 'method',
        label: '请求方法',
        type: 'select',
        default: 'POST',
        options: [
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
        ],
      },
      {
        key: 'bodyType',
        label: '请求体',
        type: 'select',
        default: 'multipart',
        options: [
          { label: 'multipart/form-data', value: 'multipart' },
          { label: '文件二进制（binary）', value: 'binary' },
        ],
      },
      { key: 'fileField', label: '文件字段名', type: 'text', default: 'file', help: 'multipart 时文件所在字段，如 file / image / smfile / source' },
      { key: 'headers', label: '请求头', type: 'textarea', placeholder: 'Authorization: Bearer xxx\nX-API-Key: xxx', help: '每行一个 Key: Value，或填写 JSON 对象' },
      { key: 'form', label: '额外表单字段', type: 'textarea', placeholder: 'album_id=1\npermission=1', help: '每行一个 key=value，或 JSON 对象' },
      { key: 'urlPath', label: '返回 URL 路径', type: 'text', placeholder: 'data.links.url 或 [0].src', help: '留空则自动在响应中查找第一个 http 链接' },
      { key: 'urlPrefix', label: 'URL 前缀', type: 'text', placeholder: 'https://img.example.com', help: '返回相对路径时拼接在前面' },
    ],
    build(v) {
      return {
        url: str(v, 'url'),
        method: (str(v, 'method') as 'POST' | 'PUT') || 'POST',
        headers: parseKV(str(v, 'headers')),
        form: parseKV(str(v, 'form')),
        fileField: str(v, 'fileField') || 'file',
        bodyType: (str(v, 'bodyType') as 'multipart' | 'binary') || 'multipart',
      };
    },
    parse(json, v) {
      const p = str(v, 'urlPath');
      const raw = p ? getByPath(json, p) : undefined;
      const url = typeof raw === 'string' ? raw : undefined;
      if (!url) return undefined;
      return /^https?:/.test(url) ? url : str(v, 'urlPrefix').replace(/\/+$/, '') + (url.startsWith('/') ? '' : '/') + url;
    },
  },
];

export const providerById = (id: string): ProviderDef | undefined => providers.find((p) => p.id === id);

export function defaultValues(p: ProviderDef): Values {
  const v: Values = {};
  for (const f of p.fields) if (f.default !== undefined) v[f.key] = f.default;
  return v;
}

export function validateProfile(h: HostProfile): string | undefined {
  const p = providerById(h.provider);
  if (!p) return '未知的图床类型';
  const miss = p.fields.find((f) => f.required && !String(h.values[f.key] ?? '').trim());
  return miss ? `请填写「${miss.label}」` : undefined;
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export function uploadFile(h: HostProfile, file: File, opts: UploadOptions = {}): Promise<string> {
  const p = providerById(h.provider);
  if (!p) return Promise.reject(new Error('未知的图床类型'));
  const err = validateProfile(h);
  if (err) return Promise.reject(new Error(err));
  const plan = p.build(h.values, file);
  let data: FormData | File;
  if (plan.bodyType === 'binary') {
    data = file;
  } else {
    const fd = new FormData();
    for (const [k, val] of Object.entries(plan.form ?? {})) fd.append(k, val);
    fd.append(plan.fileField ?? 'file', file, file.name);
    data = fd;
  }
  return new Promise((resolve, reject) => {
    // upload.onprogress 为 Tampermonkey / Violentmonkey 扩展字段，类型声明里没有
    type Details = Parameters<typeof GM_xmlhttpRequest>[0] & { upload?: { onprogress?: (e: ProgressEvent) => void } };
    const details: Details = {
      url: plan.url,
      method: plan.method ?? 'POST',
      headers: plan.headers,
      data,
      responseType: 'text',
      timeout: 120_000,
      upload: {
        onprogress: (e: ProgressEvent) => e.lengthComputable && opts.onProgress?.(Math.round((e.loaded / e.total) * 100)),
      },
      onload: (res) => {
        let json: unknown;
        try {
          json = JSON.parse(res.responseText);
        } catch {
          const plain = res.responseText.trim();
          if (res.status < 300 && /^https?:\/\/\S+$/.test(plain)) return resolve(plain);
          return reject(new Error(`HTTP ${res.status}：${plain.slice(0, 120) || '响应不是 JSON'}`));
        }
        const url = p.parse(json, h.values) ?? (h.provider === 'custom' && h.values.urlPath ? undefined : findUrl(json));
        if (url && res.status < 400) return resolve(url);
        const msg = (getByPath(json, 'message') ?? getByPath(json, 'msg') ?? getByPath(json, 'error.message') ?? getByPath(json, 'error')) as
          | string
          | undefined;
        reject(new Error(`HTTP ${res.status}：${typeof msg === 'string' ? msg : JSON.stringify(json).slice(0, 160)}`));
      },
      onerror: (e: unknown) => reject(new Error(gmErrorMessage(e, plan.url))),
      ontimeout: () => reject(new Error('上传超时')),
    };
    const req = GM_xmlhttpRequest(details);
    opts.signal?.addEventListener('abort', () => {
      req.abort();
      reject(new Error('已取消'));
    });
  });
}

/** 浏览器端压缩：按最大宽度缩放并转码 */
export async function maybeCompress(
  file: File,
  cfg: { compress: boolean; compressFormat: string; compressQuality: number; maxWidth: number },
): Promise<File> {
  if (!cfg.compress || !/^image\/(png|jpe?g|webp|bmp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const scale = cfg.maxWidth > 0 && bmp.width > cfg.maxWidth ? cfg.maxWidth / bmp.width : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = cfg.compressFormat === 'original' ? file.type : cfg.compressFormat;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, cfg.compressQuality));
  if (!blob || blob.size >= file.size) return file;
  const ext = type.split('/')[1].replace('jpeg', 'jpg');
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type });
}

/** 生成一张测试图片，用于「测试上传」 */
export async function makeTestImage(): Promise<File> {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 120;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, 240, 120);
  grad.addColorStop(0, '#2ea44f');
  grad.addColorStop(1, '#1c9165');
  g.fillStyle = grad;
  g.fillRect(0, 0, 240, 120);
  g.fillStyle = '#fff';
  g.font = 'bold 20px sans-serif';
  g.fillText('NodeSeek 助手', 50, 55);
  g.font = '13px sans-serif';
  g.fillText(new Date().toLocaleString(), 50, 82);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  return new File([blob as Blob], `nsh-test-${Date.now()}.png`, { type: 'image/png' });
}

export interface SiteDetectResult {
  values: Record<string, string>;
  notes: string[];
}

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: 'GET',
      responseType: 'text',
      timeout: 15_000,
      onload: (r) => {
        try {
          resolve(JSON.parse(r.responseText));
        } catch {
          reject(new Error(`HTTP ${r.status}：响应不是 JSON`));
        }
      },
      onerror: (e: unknown) => reject(new Error(gmErrorMessage(e, url))),
      ontimeout: () => reject(new Error('超时')),
    });
  });
}

/**
 * 读取 CloudFlare-ImgBed（Sanyue ImgHub）站点的公开配置：
 * /api/userConfig（默认渠道、目录、命名方式、链接前缀）、/api/channels（已配置渠道）、/api/auth/sessionCheck（是否需要认证）
 */
export async function detectImgBed(base: string): Promise<SiteDetectResult> {
  const root = trimBase(base.trim());
  const notes: string[] = [];
  const values: Record<string, string> = {};
  const cfg = (await getJson(`${root}/api/userConfig`)) as Record<string, unknown>;
  if (typeof cfg.defaultUploadChannel === 'string') values.uploadChannel = cfg.defaultUploadChannel;
  if (typeof cfg.defaultUploadFolder === 'string') values.uploadFolder = cfg.defaultUploadFolder;
  if (typeof cfg.defaultUploadNameType === 'string') values.uploadNameType = cfg.defaultUploadNameType;
  if (typeof cfg.urlPrefix === 'string' && cfg.urlPrefix) values.urlPrefix = cfg.urlPrefix;
  try {
    const ch = (await getJson(`${root}/api/channels`)) as Record<string, { name: string }[]>;
    const configured = Object.entries(ch).filter(([, list]) => list?.length);
    if (configured.length) notes.push(`已配置渠道：${configured.map(([k, l]) => `${k}(${l.map((x) => x.name).join('/')})`).join('、')}`);
  } catch {
    /* 旧版本没有该接口 */
  }
  try {
    const auth = (await getJson(`${root}/api/auth/sessionCheck`)) as { userRequired?: boolean };
    notes.push(auth.userRequired ? '站点开启了上传认证，请填写认证码或 API Token' : '站点未开启上传认证，认证码可留空');
  } catch {
    /* 旧版本没有该接口 */
  }
  return { values, notes };
}
