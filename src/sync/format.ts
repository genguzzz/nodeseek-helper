import { toRaw } from 'vue';
import { settings, stickerData, type HostProfile, type Settings, type Sticker, type StickerGroup } from '../core/store';

/** 同步文档格式，见 docs/sync.md */
export const SCHEMA = 'nsh-sync/1';
const TOMBSTONE_TTL = 90 * 24 * 3600 * 1000;

export interface Entry<T> {
  v?: T;
  t: number;
  d?: true;
}

export type Icon = { type: 'svg'; data: string } | { type: 'url'; url: string } | { type: 'emoji'; text: string };

export interface SyncGroup {
  id: string;
  name: string;
  icon?: Icon;
  builtin?: string;
}

export interface SyncDocument {
  schema: typeof SCHEMA;
  updatedAt: number;
  device: string;
  settings: Entry<Partial<Settings>>;
  hosts: Record<string, Entry<HostProfile>>;
  groups: Record<string, Entry<SyncGroup>>;
  stickers: Record<string, Entry<Sticker>>;
  order: { groups: Entry<string[]>; stickers: Entry<string[]> };
}

/** 参与同步的通用设置字段；history 与同步配置本身不同步 */
export const SYNCED_SETTING_KEYS = [
  'activeHostId',
  'pasteUpload',
  'dropUpload',
  'imageTemplate',
  'stickerTemplate',
  'compress',
  'compressFormat',
  'compressQuality',
  'maxWidth',
  'collectFromPost',
  'freezeAnimated',
  'hoverPreview',
  'pickerDefaultTab',
  'showUploadButton',
  'showStickerButton',
  'showFastNav',
  'showHeaderEntry',
  'officialFav',
  'officialUsage',
  'seededPacks',
] as const;

/* ---------------- 图标：本地字符串 ⇄ 同步结构 ---------------- */

const b64encode = (s: string): string => btoa(unescape(encodeURIComponent(s)));
const b64decode = (s: string): string => decodeURIComponent(escape(atob(s)));

export function iconToSync(icon?: string): Icon | undefined {
  if (!icon) return undefined;
  const s = icon.trim();
  if (s.startsWith('<svg')) return { type: 'svg', data: `data:image/svg+xml;base64,${b64encode(s)}` };
  if (/^data:image\/svg\+xml;base64,/.test(s)) return { type: 'svg', data: s };
  if (/^(https?:|data:image\/)/.test(s)) return { type: 'url', url: s };
  return { type: 'emoji', text: s };
}

export function iconFromSync(icon?: Icon): string | undefined {
  if (!icon) return undefined;
  if (icon.type === 'svg') {
    const m = /^data:image\/svg\+xml;base64,(.+)$/.exec(icon.data);
    try {
      return m ? b64decode(m[1]) : icon.data;
    } catch {
      return undefined;
    }
  }
  if (icon.type === 'url') return icon.url;
  if (icon.type === 'emoji') return icon.text;
  return undefined; // 未知类型降级为默认图标
}

/* ---------------- 摘要与本地变更追踪 ---------------- */

/** FNV-1a 32 位摘要，足够用来判断条目内容是否变化 */
export function hash(value: unknown): string {
  const s = JSON.stringify(value) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 每个条目上次同步时的摘要与时间：key → { h, t, d } */
export type SyncMeta = Record<string, { h: string; t: number; d?: true }>;

interface LocalItem {
  key: string;
  value: unknown;
}

function localItems(): LocalItem[] {
  const s = toRaw(settings);
  const syncedSettings: Partial<Settings> = {};
  for (const k of SYNCED_SETTING_KEYS) (syncedSettings as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(s[k]));
  const items: LocalItem[] = [{ key: 'settings', value: syncedSettings }];
  for (const h of s.hosts) items.push({ key: `host:${h.id}`, value: JSON.parse(JSON.stringify(h)) });
  const data = toRaw(stickerData);
  for (const g of data.groups) {
    const sg: SyncGroup = { id: g.id, name: g.name };
    const icon = iconToSync(g.icon);
    if (icon) sg.icon = icon;
    if (g.builtin) sg.builtin = g.builtin;
    items.push({ key: `group:${g.id}`, value: sg });
  }
  for (const st of data.stickers) items.push({ key: `sticker:${st.id}`, value: JSON.parse(JSON.stringify(st)) });
  items.push({ key: 'order:groups', value: data.groups.map((g) => g.id) });
  items.push({ key: 'order:stickers', value: data.stickers.map((x) => x.id) });
  return items;
}

/**
 * 由本地数据生成同步文档：内容摘要与上次同步不同的条目时间戳置为 now，
 * 本地已不存在的条目生成墓碑。会就地更新 meta。
 * `stats.changed` 返回与上次同步相比发生变化（新增 / 修改 / 删除）的条目数。
 */
export function buildLocalDoc(meta: SyncMeta, device: string, now = Date.now(), stats?: { changed: number }): SyncDocument {
  let changed = 0;
  const doc: SyncDocument = {
    schema: SCHEMA,
    updatedAt: now,
    device,
    settings: { t: 0 },
    hosts: {},
    groups: {},
    stickers: {},
    order: { groups: { t: 0, v: [] }, stickers: { t: 0, v: [] } },
  };
  const seen = new Set<string>();
  for (const it of localItems()) {
    seen.add(it.key);
    const h = hash(it.value);
    const m = meta[it.key];
    if (!m || m.d || m.h !== h) {
      meta[it.key] = { h, t: now };
      changed++;
    }
    put(doc, it.key, { v: it.value, t: meta[it.key].t } as Entry<never>);
  }
  for (const [key, m] of Object.entries(meta)) {
    if (seen.has(key)) continue;
    if (!m.d) {
      meta[key] = { h: '', t: now, d: true };
      changed++;
    }
    if (now - meta[key].t > TOMBSTONE_TTL) {
      delete meta[key];
      continue;
    }
    put(doc, key, { t: meta[key].t, d: true });
  }
  if (stats) stats.changed = changed;
  return doc;
}

function put(doc: SyncDocument, key: string, entry: Entry<never>): void {
  const [kind, id] = key.split(/:(.*)/s);
  if (key === 'settings') doc.settings = entry;
  else if (kind === 'host') doc.hosts[id] = entry;
  else if (kind === 'group') doc.groups[id] = entry;
  else if (kind === 'sticker') doc.stickers[id] = entry;
  else if (key === 'order:groups') doc.order.groups = entry;
  else if (key === 'order:stickers') doc.order.stickers = entry;
}

/* ---------------- 合并 ---------------- */

function pick<T>(a: Entry<T> | undefined, b: Entry<T> | undefined, preferB: boolean): Entry<T> | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.t !== b.t) return a.t > b.t ? a : b;
  return preferB ? b : a;
}

function mergeMap<T>(a: Record<string, Entry<T>>, b: Record<string, Entry<T>>, preferB: boolean, fix?: (w: Entry<T>, x?: Entry<T>, y?: Entry<T>) => Entry<T>): Record<string, Entry<T>> {
  const out: Record<string, Entry<T>> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const w = pick(a[id], b[id], preferB) as Entry<T>;
    out[id] = fix ? fix(w, a[id], b[id]) : w;
  }
  return out;
}

/** 条目级 LWW 合并；时间相同时按 device 字典序决定，保证各端结果一致 */
export function mergeDocs(local: SyncDocument, remote: SyncDocument): SyncDocument {
  const preferRemote = remote.device > local.device;
  const stickers = mergeMap(local.stickers, remote.stickers, preferRemote, (w, x, y) => {
    if (w.d || !x?.v || !y?.v || !w.v) return w;
    // 使用次数与最近使用时间取最大值，不因合并回退
    return { ...w, v: { ...w.v, useCount: Math.max(x.v.useCount, y.v.useCount), lastUsedAt: Math.max(x.v.lastUsedAt, y.v.lastUsedAt) } };
  });
  return {
    schema: SCHEMA,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    device: local.device,
    settings: pick(local.settings, remote.settings, preferRemote) as Entry<Partial<Settings>>,
    hosts: mergeMap(local.hosts, remote.hosts, preferRemote),
    groups: mergeMap(local.groups, remote.groups, preferRemote),
    stickers,
    order: {
      groups: pick(local.order.groups, remote.order.groups, preferRemote) as Entry<string[]>,
      stickers: pick(local.order.stickers, remote.order.stickers, preferRemote) as Entry<string[]>,
    },
  };
}

/** 文档内容摘要（忽略 updatedAt / device），用于判断合并后是否需要回写 */
export function docHash(doc: SyncDocument): string {
  const { updatedAt: _u, device: _d, ...rest } = doc;
  return hash(rest);
}

/* ---------------- 应用到本地 ---------------- */

function ordered<T extends { id: string }>(items: T[], order: string[] | undefined, by: (x: T) => number): T[] {
  const idx = new Map((order ?? []).map((id, i) => [id, i]));
  const inOrder = items.filter((x) => idx.has(x.id)).sort((a, b) => (idx.get(a.id) as number) - (idx.get(b.id) as number));
  const rest = items.filter((x) => !idx.has(x.id)).sort((a, b) => by(a) - by(b));
  return [...inOrder, ...rest];
}

/**
 * 同一图片链接只保留一条（旧版本内置包使用随机 ID，多设备会各写一份）：
 * 优先保留内置确定性 ID（bi_ 前缀），其次保留创建更早的；收藏取或、使用次数与最近使用取最大。
 * 被合并掉的条目在下次生成文档时成为墓碑，其他设备随之删除。
 */
export function dedupeByUrl(list: Sticker[]): Sticker[] {
  const keep = new Map<string, Sticker>();
  const rank = (s: Sticker): number => (s.id.startsWith('bi_') ? 0 : 1);
  for (const s of list) {
    const cur = keep.get(s.url);
    if (!cur) {
      keep.set(s.url, s);
      continue;
    }
    const [win, lose] = rank(s) < rank(cur) || (rank(s) === rank(cur) && s.createdAt < cur.createdAt) ? [s, cur] : [cur, s];
    keep.set(s.url, {
      ...win,
      favorite: win.favorite || lose.favorite,
      useCount: Math.max(win.useCount, lose.useCount),
      lastUsedAt: Math.max(win.lastUsedAt, lose.lastUsedAt),
    });
  }
  const winners = new Set([...keep.values()].map((s) => s.id));
  // 保持原有顺序：按首次出现的位置输出胜出者
  const seen = new Set<string>();
  const out: Sticker[] = [];
  for (const s of list) {
    const w = keep.get(s.url) as Sticker;
    if (seen.has(s.url) || !winners.has(w.id)) continue;
    seen.add(s.url);
    out.push(w);
  }
  return out;
}

/** 把合并后的文档写回本地存储，并把 meta 对齐到文档（避免被当成本地变更） */
export function applyDoc(doc: SyncDocument, meta: SyncMeta): void {
  if (doc.settings.v) {
    for (const k of SYNCED_SETTING_KEYS) {
      if (k in doc.settings.v) (settings as unknown as Record<string, unknown>)[k] = (doc.settings.v as Record<string, unknown>)[k];
    }
  }
  settings.hosts = Object.values(doc.hosts)
    .filter((e) => !e.d && e.v)
    .map((e) => e.v as HostProfile);
  const groups: StickerGroup[] = Object.values(doc.groups)
    .filter((e) => !e.d && e.v)
    .map((e) => {
      const g = e.v as SyncGroup;
      const out: StickerGroup = { id: g.id, name: g.name };
      const icon = iconFromSync(g.icon);
      if (icon) out.icon = icon;
      if (g.builtin) out.builtin = g.builtin;
      return out;
    });
  if (!groups.some((g) => g.id === 'default')) groups.unshift({ id: 'default', name: '默认' });
  const groupIds = new Set(groups.map((g) => g.id));
  const stickers = Object.values(doc.stickers)
    .filter((e) => !e.d && e.v)
    .map((e) => {
      const s = e.v as Sticker;
      return groupIds.has(s.groupId) ? s : { ...s, groupId: 'default' };
    });
  stickerData.groups = ordered(groups, doc.order.groups.v, () => 0);
  stickerData.stickers = dedupeByUrl(ordered(stickers, doc.order.stickers.v, (s) => s.createdAt));
  if (!settings.hosts.some((h) => h.id === settings.activeHostId)) settings.activeHostId = settings.hosts[0]?.id ?? '';
  // 对齐 meta：以写回后的本地内容为准，时间取文档里的时间
  const fresh: SyncMeta = {};
  const tOf = (key: string): number => {
    if (key === 'settings') return doc.settings.t;
    if (key === 'order:groups') return doc.order.groups.t;
    if (key === 'order:stickers') return doc.order.stickers.t;
    const [kind, id] = key.split(/:(.*)/s);
    const map = kind === 'host' ? doc.hosts : kind === 'group' ? doc.groups : doc.stickers;
    return map[id]?.t ?? Date.now();
  };
  for (const it of localItems()) fresh[it.key] = { h: hash(it.value), t: tOf(it.key) };
  for (const [kind, map] of [['host', doc.hosts], ['group', doc.groups], ['sticker', doc.stickers]] as const) {
    for (const [id, e] of Object.entries(map as Record<string, Entry<unknown>>)) {
      if (e.d) fresh[`${kind}:${id}`] = { h: '', t: e.t, d: true };
    }
  }
  for (const k of Object.keys(meta)) delete meta[k];
  Object.assign(meta, fresh);
}
