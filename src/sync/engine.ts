import { reactive, toRaw, watch } from 'vue';
import { GM_getValue, GM_setValue } from '$';
import { flushStores, settings, stickerData, uid } from '../core/store';
import { keyId, open, PassphraseError, seal } from './crypto';
import { applyDoc, buildLocalDoc, dedupeByUrl, docHash, maxEntryTime, mergeDocs, stampNew, type SyncDocument, type SyncMeta } from './format';
import { ConflictError, missingFields, syncProviderById, type SyncProvider, type Values } from './providers';
import { decodeSyncCode } from './sync-code';
import { holdLeadership, withLock } from './locks';

/**
 * 同步引擎。并发模型：
 *
 * - 多台设备：服务端按 ETag 做条件写入（乐观并发），写入冲突时重新拉取、条目级合并后重试（随机退避）。
 *   数据是端到端加密的，服务端看不到内容，合并只能在客户端做。
 * - 同一台设备的多个标签页：共享本地存储。同步过程用 Web Locks 串行化；只有一个「主标签页」负责自动同步，
 *   每次同步开始时从存储重新读取同步状态，结束时立即落盘，避免各标签页拿着过期的状态互相覆盖。
 * - 同步状态（上次同步时各条目的摘要 meta、ETag、逻辑时钟）只在确认与云端一致后才提交，
 *   推送失败时保留旧状态，下次同步仍能发现这些本地修改。
 * - 条目时间戳用逻辑时钟：max(本机时间, 见过的最大时间 + 1)。看过云端最新状态之后做的修改一定更新，
 *   不受各设备时钟快慢影响。
 */

/** 本机同步配置（用户在「同步」页填写的内容；不参与同步） */
export interface SyncConfig {
  provider: string;
  values: Record<string, Values>;
  passphrase: string;
  auto: boolean;
  intervalMin: number;
  deviceId: string;
  lastSyncAt: number;
  lastError: string;
}

/** 同步状态：只由同步过程读写，多个标签页共享 */
interface SyncStateStore {
  meta: SyncMeta;
  lastEtag: string;
  /** 逻辑时钟：见过的最大条目时间戳 */
  clock: number;
}

const CONFIG_KEY = 'nsh_sync_v1';
const STATE_KEY = 'nsh_sync_state_v1';
const LOCK_RUN = 'nsh-sync-run';
const LOCK_LEADER = 'nsh-sync-leader';
/** 写入冲突的重试次数与退避：多台设备同时写入时错开重试时间 */
const MAX_ATTEMPTS = 8;
const CONFLICT_BACKOFF_MS = 150;
const DEBOUNCE_MS = 1500;

const configDefaults = (): SyncConfig => ({
  provider: '',
  values: {},
  passphrase: '',
  auto: true,
  intervalMin: 10,
  deviceId: `d_${uid()}`,
  lastSyncAt: 0,
  lastError: '',
});

const readState = (): SyncStateStore => ({ meta: {}, lastEtag: '', clock: 0, ...(GM_getValue<Partial<SyncStateStore>>(STATE_KEY, {}) ?? {}) });
const writeState = (s: SyncStateStore): void => GM_setValue(STATE_KEY, JSON.parse(JSON.stringify(s)));

const storedConfig = GM_getValue<Partial<SyncConfig>>(CONFIG_KEY, {}) ?? {};
export const syncConfig = reactive<SyncConfig>({ ...configDefaults(), ...storedConfig });
export const syncState = reactive({ running: false, status: '' as string, leader: false });
/** 当前已知的云端版本（watch 长轮询用）；权威值在共享存储里 */
let lastEtag = readState().lastEtag;

let saveTimer = 0;
const flushConfig = (): void => {
  clearTimeout(saveTimer);
  saveTimer = 0;
  GM_setValue(CONFIG_KEY, JSON.parse(JSON.stringify(toRaw(syncConfig))));
};
watch(
  syncConfig,
  () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushConfig, 300);
  },
  { deep: true },
);
window.addEventListener('pagehide', () => saveTimer && flushConfig());

const valuesOf = (id: string): Values => (syncConfig.values[id] ??= {});

/** 写入时附带的密钥标识：只有支持口令锁的后端、且设置了口令时才有 */
async function keyIdFor(p: SyncProvider, v: Values): Promise<string | undefined> {
  const scope = p.keyScope?.(v);
  return scope && syncConfig.passphrase ? keyId(syncConfig.passphrase, scope) : undefined;
}

/** 切换后端或口令后，远端版本对不上，需要从头比对 */
export function resetSyncCursor(): void {
  const s = readState();
  s.lastEtag = '';
  writeState(s);
  lastEtag = '';
  syncConfig.lastError = '';
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 实时同步失败后的退避区间：5 秒起，翻倍到 5 分钟 */
const WATCH_BACKOFF_MIN = 5_000;
const WATCH_BACKOFF_MAX = 300_000;

let applying = false;
let queued = false;

/** 把合并结果写回本地；期间的 store 变更不算本地修改 */
function applyMerged(next: SyncDocument, meta: SyncMeta): void {
  applying = true;
  try {
    applyDoc(next, meta);
  } finally {
    queueMicrotask(() => (applying = false));
  }
}

/**
 * 一次同步（持有跨标签页锁）：拉取 → 解密 → 条目级合并 → 写回本地 → 必要时推送。
 * 推送遇到版本冲突时退避后重新拉取合并，最多 MAX_ATTEMPTS 次。
 */
async function runSync(p: SyncProvider, v: Values): Promise<void> {
  const state = readState();
  for (let attempt = 0; ; attempt++) {
    const pulled = await p.pull(v, state.lastEtag || undefined);
    // 本地先去重（同一链接多条）：被去掉的条目在下面生成墓碑并推送，其他设备随之清理
    const deduped = dedupeByUrl(stickerData.stickers);
    if (deduped.length !== stickerData.stickers.length) stickerData.stickers = deduped;

    const now = Math.max(Date.now(), state.clock + 1);
    const meta: SyncMeta = JSON.parse(JSON.stringify(state.meta));
    const stats = { changed: 0 };
    const local = buildLocalDoc(meta, syncConfig.deviceId, now, stats);
    let next = local;
    let remoteHash = '';
    let applied = false;
    // 本机已设置加密口令而远端仍是明文（如先同步、后设置口令）：即使内容无变化也要重新加密推送
    const needEncrypt = pulled.status === 'ok' && pulled.envelope?.enc === 'none' && !!syncConfig.passphrase;
    if (pulled.status === 'ok' && pulled.envelope) {
      const remote = await open(pulled.envelope, syncConfig.passphrase);
      remoteHash = docHash(remote);
      next = mergeDocs(local, remote);
      if (docHash(next) !== docHash(local)) {
        applyMerged(next, meta);
        applied = true;
      }
    }
    stampNew(next, meta, now);
    const clock = Math.max(state.clock, now, maxEntryTime(next));
    const etag = pulled.status === 'notModified' ? state.lastEtag : (pulled.etag ?? '');
    // 设置了口令、但空间还没被锁定：写入一次，用当前口令锁定
    const needLock = !!p.keyScope && !!syncConfig.passphrase && pulled.locked === false;
    const needPush =
      pulled.status === 'empty' || needEncrypt || needLock || (pulled.status === 'notModified' ? stats.changed > 0 : docHash(next) !== remoteHash);

    if (!needPush) {
      Object.assign(state, { meta, lastEtag: etag, clock });
      writeState(state);
      return;
    }
    try {
      next.updatedAt = now;
      next.device = syncConfig.deviceId;
      const newEtag = await p.push(v, await seal(next, syncConfig.passphrase), pulled.status === 'empty' ? undefined : etag, await keyIdFor(p, v));
      Object.assign(state, { meta, lastEtag: newEtag, clock });
      writeState(state);
      return;
    } catch (e) {
      // 已把云端内容写回本地：本地 = 合并结果，meta 必须随之提交（否则写回的内容会被当成本地修改）；
      // ETag 清空，下次完整拉取比对，没推送出去的修改仍会被发现
      if (applied) {
        Object.assign(state, { meta, lastEtag: '', clock });
        writeState(state);
      }
      if (!(e instanceof ConflictError) || attempt >= MAX_ATTEMPTS - 1) throw e;
      state.lastEtag = '';
      await sleep(CONFLICT_BACKOFF_MS * (attempt + 1) * (0.5 + Math.random()));
    }
  }
}

/** 同步一次。同一标签页内重复触发会合并成一次；多个标签页之间串行执行 */
export async function syncNow(reason = 'manual'): Promise<void> {
  const p = syncProviderById(syncConfig.provider);
  if (!p) return;
  if (syncState.running) {
    queued = true;
    return;
  }
  const v = valuesOf(p.id);
  const missing = missingFields(p, v);
  if (missing.length) {
    // 还没填完（如刚选中自建服务、尚未粘贴同步码）：提示而不是报错
    syncState.status = p.id === 'selfhost' ? '待粘贴同步码' : `待填写：${missing.join('、')}`;
    syncConfig.lastError = '';
    return;
  }
  syncState.running = true;
  syncState.status = '同步中…';
  // 正在挂起的实时同步长轮询会占住连接，拉取 / 推送要排在它后面等到超时：先中断，同步完再恢复
  const resumeWatch = reason !== 'watch' && stopWatch();
  try {
    await withLock(LOCK_RUN, async () => {
      flushStores();
      try {
        await runSync(p, v);
      } finally {
        // 释放锁之前把写回的数据落盘，下一个拿到锁的标签页看到的就是最新的
        flushStores();
        lastEtag = readState().lastEtag;
      }
    });
    // OneDrive 会轮换 refresh token
    const upd = p.updates?.(v);
    if (upd) Object.assign(v, upd);
    syncConfig.lastSyncAt = Date.now();
    syncConfig.lastError = '';
    syncState.status = `已同步（${reason === 'manual' ? '手动' : '自动'}）`;
  } catch (e) {
    syncConfig.lastError = (e as Error).message;
    syncState.status = e instanceof PassphraseError ? '口令错误' : '同步失败';
  } finally {
    syncState.running = false;
    if (queued) {
      queued = false;
      void syncNow(reason);
    }
    if (resumeWatch) void watchLoop();
  }
}

/**
 * 用本机数据覆盖远端（忘记加密口令时的重置）：不读取、不合并远端内容，直接以本机数据 + 当前口令重新写入。
 * 远端原有数据无法解密，覆盖后其他设备需改用新口令（或粘贴本机的接入码）。
 */
export async function overwriteRemote(): Promise<void> {
  const p = syncProviderById(syncConfig.provider);
  if (!p || syncState.running) return;
  syncState.running = true;
  syncState.status = '同步中…';
  const resumeWatch = stopWatch();
  try {
    const v = valuesOf(p.id);
    await withLock(LOCK_RUN, async () => {
      flushStores();
      const state = readState();
      const now = Math.max(Date.now(), state.clock + 1);
      const pulled = await p.pull(v);
      const meta: SyncMeta = JSON.parse(JSON.stringify(state.meta));
      const doc = buildLocalDoc(meta, syncConfig.deviceId, now);
      stampNew(doc, meta, now);
      const etag = await p.push(v, await seal(doc, syncConfig.passphrase), pulled.status === 'empty' ? undefined : pulled.etag, await keyIdFor(p, v));
      writeState({ meta, lastEtag: etag, clock: Math.max(state.clock, now) });
      lastEtag = etag;
    });
    syncConfig.lastSyncAt = Date.now();
    syncConfig.lastError = '';
    syncState.status = '已用本机数据重置云端';
  } catch (e) {
    syncConfig.lastError = (e as Error).message;
    syncState.status = e instanceof PassphraseError ? '口令错误' : '同步失败';
  } finally {
    syncState.running = false;
    if (resumeWatch) void watchLoop();
  }
}

/* ---------------- 自动同步（只在主标签页运行） ---------------- */

let debounceTimer = 0;
let intervalTimer = 0;
let watchAbort: AbortController | null = null;

/** 中断实时同步长轮询；返回此前是否在运行 */
function stopWatch(): boolean {
  const running = !!watchAbort && !watchAbort.signal.aborted;
  watchAbort?.abort();
  return running;
}

const enabled = (): boolean => !!syncConfig.provider && syncConfig.auto && syncState.leader;

/**
 * 本地数据变化：主标签页里自己的修改和其他标签页写入共享存储的修改都要推送；
 * 只有同步写回（applying）本身不算。非主标签页不推送，交给主标签页。
 */
function onLocalChange(): void {
  if (applying || !enabled()) return;
  clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void syncNow('change'), DEBOUNCE_MS);
}

/** 自建服务：页面可见时长轮询，远端一变化就拉取 */
async function watchLoop(): Promise<void> {
  watchAbort?.abort();
  const p = syncProviderById(syncConfig.provider);
  if (!p?.watch || !enabled() || document.hidden) return;
  const ctrl = new AbortController();
  watchAbort = ctrl;
  let backoff = WATCH_BACKOFF_MIN;
  const pause = (ms: number): Promise<void> =>
    new Promise((r) => {
      const t = window.setTimeout(r, ms);
      ctrl.signal.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
    });
  while (!ctrl.signal.aborted && enabled() && !document.hidden) {
    const started = Date.now();
    try {
      if (!lastEtag) await syncNow('watch');
      // 同步失败（口令错误、限流、认证失败等）时不进入长轮询，按指数退避等待，避免死循环刷请求
      if (syncConfig.lastError || !lastEtag) throw new Error(syncConfig.lastError || 'no etag');
      const changed = await p.watch(valuesOf(p.id), lastEtag, ctrl.signal);
      if (ctrl.signal.aborted) break;
      if (changed) await syncNow('watch');
      backoff = WATCH_BACKOFF_MIN;
      // 一轮结束得太快（异常响应）时至少间隔 1 秒
      if (Date.now() - started < 1000) await pause(1000);
    } catch {
      await pause(backoff);
      backoff = Math.min(backoff * 2, WATCH_BACKOFF_MAX);
    }
  }
}

function schedule(): void {
  clearInterval(intervalTimer);
  watchAbort?.abort();
  if (!enabled()) return;
  intervalTimer = window.setInterval(() => !document.hidden && void syncNow('interval'), Math.max(1, syncConfig.intervalMin) * 60_000);
  void syncNow('startup').then(() => void watchLoop());
}

/** 同步配置变化后（如粘贴了新的同步码）立即重新同步，并结束正在退避等待的实时同步 */
export function restartSync(): void {
  if (enabled()) schedule();
  else void syncNow('manual');
}

/**
 * 启动自动同步。同一站点的多个标签页里只有一个成为主标签页（Web Locks 选举，主标签页关闭后自动交接）；
 * 不支持 Web Locks 时每个标签页各自同步（同步过程本身仍串行）。
 */
export function startAutoSync(): void {
  watch([() => settings, () => stickerData], onLocalChange, { deep: true, flush: 'sync' });
  watch(() => [syncConfig.provider, syncConfig.auto, syncConfig.intervalMin], schedule);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      watchAbort?.abort();
      return;
    }
    if (enabled() && Date.now() - syncConfig.lastSyncAt > 30_000) void syncNow('visible').then(() => void watchLoop());
    else void watchLoop();
  });
  holdLeadership(LOCK_LEADER, () => {
    syncState.leader = true;
    schedule();
  });
}

/** 从配置文件导入同步设置（新设备一键接入）：{ "sync": { provider, base, token, passphrase, ... } } */
export function importSyncConfig(raw: unknown): boolean {
  const cfg = (raw as { sync?: Record<string, string> } | null)?.sync;
  if (!cfg || !syncProviderById(cfg.provider)) return false;
  const { provider, passphrase, code, ...values } = cfg;
  if (code) Object.assign(values, decodeSyncCode(code));
  syncConfig.values[provider] = { ...(syncConfig.values[provider] ?? {}), ...values };
  if (typeof passphrase === 'string') syncConfig.passphrase = passphrase;
  syncConfig.provider = provider;
  syncConfig.auto = true;
  resetSyncCursor();
  return true;
}
