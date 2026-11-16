import { reactive, watch, toRaw } from 'vue';
import { builtinPacks } from './packs';
import { GM_getValue, GM_setValue, GM_addValueChangeListener } from '$';

export interface HostProfile {
  id: string;
  name: string;
  provider: string;
  values: Record<string, string | boolean>;
}

export interface Settings {
  activeHostId: string;
  hosts: HostProfile[];
  pasteUpload: boolean;
  dropUpload: boolean;
  /** 插入模板，可用变量 {url} {name} */
  imageTemplate: string;
  stickerTemplate: string;
  compress: boolean;
  compressFormat: 'image/webp' | 'image/jpeg' | 'original';
  compressQuality: number;
  maxWidth: number;
  collectFromPost: boolean;
  /** 选择面板里动图默认静止，悬浮时播放 */
  freezeAnimated: boolean;
  hoverPreview: boolean;
  /** 已写入过的内置包，用户删除后不再自动恢复 */
  seededPacks: string[];
  history: UploadRecord[];
}

export interface UploadRecord {
  url: string;
  name: string;
  host: string;
  time: number;
}

export interface Sticker {
  id: string;
  url: string;
  name: string;
  groupId: string;
  favorite: boolean;
  useCount: number;
  lastUsedAt: number;
  createdAt: number;
}

export interface StickerGroup {
  id: string;
  name: string;
  /** SVG 字符串或单个 emoji */
  icon?: string;
  /** 内置包 id */
  builtin?: string;
}

export interface StickerData {
  groups: StickerGroup[];
  stickers: Sticker[];
}

const SETTINGS_KEY = 'nsh_settings_v1';
const STICKER_KEY = 'nsh_stickers_v1';
export const DEFAULT_GROUP_ID = 'default';

export const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const defaultSettings = (): Settings => ({
  activeHostId: '',
  hosts: [],
  pasteUpload: true,
  dropUpload: true,
  imageTemplate: '![{name}]({url})',
  stickerTemplate: '![{name}]({url})',
  compress: false,
  compressFormat: 'image/webp',
  compressQuality: 0.85,
  maxWidth: 0,
  collectFromPost: true,
  freezeAnimated: true,
  hoverPreview: true,
  seededPacks: [],
  history: [],
});

const defaultStickers = (): StickerData => ({
  groups: [{ id: DEFAULT_GROUP_ID, name: '默认' }],
  stickers: [],
});

function load<T extends object>(key: string, fallback: () => T): T {
  const raw = GM_getValue<T | undefined>(key, undefined);
  return raw && typeof raw === 'object' ? { ...fallback(), ...raw } : fallback();
}

export const settings = reactive<Settings>(load(SETTINGS_KEY, defaultSettings));
export const stickerData = reactive<StickerData>(load(STICKER_KEY, defaultStickers));
if (!stickerData.groups.some((g) => g.id === DEFAULT_GROUP_ID)) {
  stickerData.groups.unshift({ id: DEFAULT_GROUP_ID, name: '默认' });
}

/** 写入尚未安装过的内置包（放在默认分组之后） */
export function seedBuiltinPacks(force = false): void {
  for (const pack of builtinPacks) {
    if (!force && settings.seededPacks.includes(pack.id)) continue;
    if (!stickerData.groups.some((g) => g.id === pack.id)) {
      stickerData.groups.splice(1, 0, { id: pack.id, name: pack.name, icon: pack.icon, builtin: pack.id });
    }
    addStickers(pack.urls.map((url, i) => ({ url, name: `${pack.name}${String(i + 1).padStart(2, '0')}` })), pack.id);
    if (!settings.seededPacks.includes(pack.id)) settings.seededPacks.push(pack.id);
  }
}

/** 持久化 + 多标签页同步；remote 写入时跳过一次回写，避免死循环 */
function persist<T extends object>(key: string, target: T): void {
  let applyingRemote = false;
  let timer = 0;
  watch(
    target,
    () => {
      if (applyingRemote) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => GM_setValue(key, JSON.parse(JSON.stringify(toRaw(target)))), 200);
    },
    { deep: true },
  );
  GM_addValueChangeListener(key, (_name, _old, value, remote) => {
    if (!remote || !value) return;
    applyingRemote = true;
    Object.assign(target, value);
    queueMicrotask(() => (applyingRemote = false));
  });
}

persist(SETTINGS_KEY, settings);
persist(STICKER_KEY, stickerData);
seedBuiltinPacks();

export function activeHost(): HostProfile | undefined {
  return settings.hosts.find((h) => h.id === settings.activeHostId) ?? settings.hosts[0];
}

export function addHistory(rec: UploadRecord): void {
  settings.history.unshift(rec);
  if (settings.history.length > 200) settings.history.length = 200;
}

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/* ---------------- 表情包操作 ---------------- */

export interface ImportResult {
  added: number;
  skipped: number;
}

export function addStickers(items: { url: string; name?: string }[], groupId: string): ImportResult {
  const exists = new Set(stickerData.stickers.map((s) => s.url));
  let added = 0;
  let skipped = 0;
  const now = Date.now();
  for (const it of items) {
    const url = it.url.trim();
    if (!url || exists.has(url)) {
      skipped++;
      continue;
    }
    exists.add(url);
    stickerData.stickers.push({
      id: uid(),
      url,
      name: (it.name || guessName(url)).slice(0, 40),
      groupId,
      favorite: false,
      useCount: 0,
      lastUsedAt: 0,
      createdAt: now + added,
    });
    added++;
  }
  return { added, skipped };
}

export function guessName(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || '');
    return last.replace(/\.[a-z0-9]+$/i, '') || 'sticker';
  } catch {
    return 'sticker';
  }
}

/** 解析批量导入文本：支持纯 URL、Markdown 图片、HTML img、本插件导出的 JSON */
export function parseImportText(text: string): { url: string; name?: string }[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const json = JSON.parse(t);
      const list: unknown[] = Array.isArray(json) ? json : json.stickers ?? [];
      return list
        .map((x) => (typeof x === 'string' ? { url: x } : (x as { url: string; name?: string })))
        .filter((x) => x && typeof x.url === 'string');
    } catch {
      /* 不是 JSON，按文本解析 */
    }
  }
  const out: { url: string; name?: string }[] = [];
  const seen = new Set<string>();
  const push = (url: string, name?: string): void => {
    if (!seen.has(url)) {
      seen.add(url);
      out.push({ url, name: name || undefined });
    }
  };
  for (const m of t.matchAll(/!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g)) push(m[2], m[1]);
  for (const m of t.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?/gi)) push(m[1], m[2]);
  // 已识别出图片语法时（如整段帖子），裸链接只收图片扩展名，避免把普通网页链接当表情
  const strict = out.length > 0;
  for (const m of t.matchAll(/https?:\/\/[^\s"'<>()]+/g)) {
    if (!strict || /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i.test(m[0])) push(m[0]);
  }
  return out;
}

export function useSticker(s: Sticker): void {
  s.useCount++;
  s.lastUsedAt = Date.now();
}

export function exportStickers(): string {
  return JSON.stringify({ app: 'nodeseek-helper', version: 1, ...toRaw(stickerData) }, null, 2);
}

/** 导入完整备份（保留分组） */
export function importBackup(text: string): ImportResult {
  const json = JSON.parse(text) as Partial<StickerData>;
  if (!Array.isArray(json.stickers)) throw new Error('不是有效的备份文件');
  for (const g of json.groups ?? []) {
    if (!stickerData.groups.some((x) => x.id === g.id)) stickerData.groups.push({ id: g.id, name: g.name });
  }
  const exists = new Set(stickerData.stickers.map((s) => s.url));
  let added = 0;
  let skipped = 0;
  for (const s of json.stickers) {
    if (!s?.url || exists.has(s.url)) {
      skipped++;
      continue;
    }
    exists.add(s.url);
    stickerData.stickers.push({
      id: s.id || uid(),
      url: s.url,
      name: s.name || guessName(s.url),
      groupId: stickerData.groups.some((g) => g.id === s.groupId) ? s.groupId : DEFAULT_GROUP_ID,
      favorite: !!s.favorite,
      useCount: s.useCount || 0,
      lastUsedAt: s.lastUsedAt || 0,
      createdAt: s.createdAt || Date.now(),
    });
    added++;
  }
  return { added, skipped };
}

/* ---------------- 配置导入 / 导出 ---------------- */

export interface ConfigBundle {
  app: 'nodeseek-helper';
  kind: 'config';
  version: 1;
  settings?: Partial<Settings>;
  stickers?: StickerData;
}

/** 导出配置；history 体积大且无迁移价值，不导出 */
export function exportConfig(opts: { withStickers: boolean }): string {
  const { history: _history, ...rest } = JSON.parse(JSON.stringify(toRaw(settings))) as Settings;
  const bundle: ConfigBundle = { app: 'nodeseek-helper', kind: 'config', version: 1, settings: rest };
  if (opts.withStickers) bundle.stickers = JSON.parse(JSON.stringify(toRaw(stickerData))) as StickerData;
  return JSON.stringify(bundle, null, 2);
}

export interface ConfigImportResult {
  hostsAdded: number;
  hostsUpdated: number;
  settingsApplied: boolean;
  stickers?: ImportResult;
}

/**
 * 导入配置：图床按 id 合并（同 id 覆盖，新 id 追加），通用设置覆盖，表情走去重合并。
 * 也接受只包含 hosts 数组或单个图床对象的简写 JSON，方便分享单个图床配置。
 */
export function importConfig(text: string): ConfigImportResult {
  const json = JSON.parse(text) as Partial<ConfigBundle> & Partial<HostProfile> & { hosts?: HostProfile[] };
  const res: ConfigImportResult = { hostsAdded: 0, hostsUpdated: 0, settingsApplied: false };
  const incoming: Partial<Settings> = json.settings ?? (json.hosts ? { hosts: json.hosts } : json.provider ? { hosts: [json as HostProfile] } : {});
  const hosts = (incoming.hosts ?? []).filter((h) => h && typeof h.provider === 'string');
  for (const h of hosts) {
    const host: HostProfile = { id: h.id || uid(), name: h.name || h.provider, provider: h.provider, values: { ...(h.values ?? {}) } };
    const i = settings.hosts.findIndex((x) => x.id === host.id);
    if (i > -1) {
      settings.hosts[i] = host;
      res.hostsUpdated++;
    } else {
      settings.hosts.push(host);
      res.hostsAdded++;
    }
  }
  const { hosts: _h, history: _hist, ...rest } = incoming;
  if (Object.keys(rest).length) {
    Object.assign(settings, rest);
    res.settingsApplied = true;
  }
  // 简写导入（只有图床）时，把第一个导入的图床设为当前使用
  if (!json.settings && hosts.length) settings.activeHostId = hosts[0].id || settings.activeHostId;
  if (!settings.hosts.some((h) => h.id === settings.activeHostId)) settings.activeHostId = settings.hosts[0]?.id ?? '';
  if (json.stickers) res.stickers = importBackup(JSON.stringify(json.stickers));
  if (!res.hostsAdded && !res.hostsUpdated && !res.settingsApplied && !res.stickers) throw new Error('没有识别到可导入的配置');
  return res;
}
