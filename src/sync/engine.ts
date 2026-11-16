import { reactive, toRaw, watch } from 'vue';
import { GM_getValue, GM_setValue } from '$';
import { isApplyingRemote, settings, stickerData, uid } from '../core/store';
import { keyId, open, PassphraseError, seal } from './crypto';
import { applyDoc, buildLocalDoc, dedupeByUrl, docHash, mergeDocs, type SyncMeta } from './format';
import { ConflictError, missingFields, syncProviderById, type SyncProvider, type Values } from './providers';
import { decodeSyncCode } from './sync-code';

/** 本机同步配置：不参与同步（含后端凭据与加密口令） */
export interface SyncConfig {
  provider: string;
  values: Record<string, Values>;
  passphrase: string;
  auto: boolean;
  intervalMin: number;
  deviceId: string;
  lastEtag: string;
  lastSyncAt: number;
  lastError: string;
  /** 本机有尚未推送的修改（持久化：修改后立即关闭页面，下次打开仍会推送） */
  dirty: boolean;
  meta: SyncMeta;
}

const KEY = 'nsh_sync_v1';
const MAX_RETRY = 3;
const DEBOUNCE_MS = 1500;

const defaults = (): SyncConfig => ({
  provider: '',
  values: {},
  passphrase: '',
  auto: true,
  intervalMin: 10,
  deviceId: `d_${uid()}`,
  lastEtag: '',
  lastSyncAt: 0,
  lastError: '',
  dirty: false,
  meta: {},
});

export const syncConfig = reactive<SyncConfig>({ ...defaults(), ...(GM_getValue<Partial<SyncConfig>>(KEY, {}) ?? {}) });
export const syncState = reactive({ running: false, status: '' as string });

let saveTimer = 0;
const flushConfig = (): void => {
  clearTimeout(saveTimer);
  saveTimer = 0;
  GM_setValue(KEY, JSON.parse(JSON.stringify(toRaw(syncConfig))));
};
watch(
  syncConfig,
  () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushConfig, 300);
  },
  { deep: true },
);
// 关闭页面前把还没写入的配置（如 dirty 标记）落盘
window.addEventListener('pagehide', () => saveTimer && flushConfig());

const valuesOf = (id: string): Values => (syncConfig.values[id] ??= {});

/** 写入时附带的密钥标识：只有支持口令锁的后端、且设置了口令时才有 */
async function keyIdFor(p: SyncProvider, v: Values): Promise<string | undefined> {
  const scope = p.keyScope?.(v);
  return scope && syncConfig.passphrase ? keyId(syncConfig.passphrase, scope) : undefined;
}

/** 切换后端或口令后，远端版本对不上，需要从头比对 */
export function resetSyncCursor(): void {
  syncConfig.lastEtag = '';
  syncConfig.lastError = '';
}

/** 实时同步失败后的退避区间：5 秒起，翻倍到 5 分钟 */
const WATCH_BACKOFF_MIN = 5_000;
const WATCH_BACKOFF_MAX = 300_000;

let applying = false;
let queued = false;
/** 本地修改计数：同步开始后又有新修改时，结束时不能清掉 dirty */
let changeGen = 0;

/**
 * 一次完整同步：拉取 → 解密 → 条目级合并 → 写回本地 → 必要时推送。
 * 推送遇到版本冲突时重新拉取合并，最多重试 3 次。
 */
export async function syncNow(reason = 'manual'): Promise<void> {
  const p = syncProviderById(syncConfig.provider);
  if (!p) return;
  if (syncState.running) {
    queued = true;
    return;
  }
  syncState.running = true;
  syncState.status = '同步中…';
  const v = valuesOf(p.id);
  const missing = missingFields(p, v);
  if (missing.length) {
    // 还没填完（如刚选中自建服务、尚未粘贴同步码）：提示而不是报错
    syncState.running = false;
    syncState.status = p.id === 'selfhost' ? '待粘贴同步码' : `待填写：${missing.join('、')}`;
    syncConfig.lastError = '';
    return;
  }
  // 正在挂起的实时同步长轮询会占住连接，拉取 / 推送要排在它后面等到超时（最长 25 秒）：先中断，同步完再恢复
  const resumeWatch = reason !== 'watch' && stopWatch();
  const gen = changeGen;
  try {
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const pulled = await p.pull(v, syncConfig.lastEtag || undefined);
      // 本地先去重（同一链接多条）：被去掉的条目会在下面生成墓碑并推送，其他设备随之清理
      const deduped = dedupeByUrl(stickerData.stickers);
      if (deduped.length !== stickerData.stickers.length) {
        stickerData.stickers = deduped;
        syncConfig.dirty = true;
      }
      const stats = { changed: 0 };
      const local = buildLocalDoc(syncConfig.meta, syncConfig.deviceId, Date.now(), stats);
      // meta 已记录这次的变化：推送成功前保持 dirty，失败后下次仍会推送
      if (stats.changed) syncConfig.dirty = true;
      let next = local;
      let remoteHash = '';
      // 本机已设置加密口令而远端仍是明文（如先同步、后设置口令）：即使内容无变化也要重新加密推送
      const needEncrypt = pulled.status === 'ok' && pulled.envelope?.enc === 'none' && !!syncConfig.passphrase;
      if (pulled.status === 'ok' && pulled.envelope) {
        const remote = await open(pulled.envelope, syncConfig.passphrase);
        remoteHash = docHash(remote);
        next = mergeDocs(local, remote);
        if (docHash(next) !== docHash(local)) {
          applying = true;
          try {
            applyDoc(next, syncConfig.meta);
          } finally {
            queueMicrotask(() => (applying = false));
          }
        }
      }
      const etag = pulled.status === 'notModified' ? syncConfig.lastEtag : pulled.etag;
      // 设置了口令、但空间还没被锁定（如升级前创建的空间）：写入一次，用当前口令锁定
      const needLock = !!p.keyScope && !!syncConfig.passphrase && pulled.locked === false;
      const needPush =
        pulled.status === 'empty' || needEncrypt || needLock || (pulled.status === 'notModified' ? syncConfig.dirty : docHash(next) !== remoteHash);
      if (!needPush) {
        syncConfig.lastEtag = etag ?? '';
        break;
      }
      try {
        next.updatedAt = Date.now();
        next.device = syncConfig.deviceId;
        syncConfig.lastEtag = await p.push(v, await seal(next, syncConfig.passphrase), pulled.status === 'empty' ? undefined : etag, await keyIdFor(p, v));
        const upd = p.updates?.(v);
        if (upd) Object.assign(v, upd);
        break;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt === MAX_RETRY - 1) throw e;
        syncConfig.lastEtag = '';
      }
    }
    // OneDrive 会轮换 refresh token，pull 时也要回写
    const upd = p.updates?.(v);
    if (upd) Object.assign(v, upd);
    if (changeGen === gen) syncConfig.dirty = false;
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
  const gen = changeGen;
  try {
    const v = valuesOf(p.id);
    const pulled = await p.pull(v);
    const doc = buildLocalDoc(syncConfig.meta, syncConfig.deviceId);
    syncConfig.lastEtag = await p.push(v, await seal(doc, syncConfig.passphrase), pulled.status === 'empty' ? undefined : pulled.etag, await keyIdFor(p, v));
    if (changeGen === gen) syncConfig.dirty = false;
    syncConfig.lastSyncAt = Date.now();
    syncConfig.lastError = '';
    syncState.status = '已用本机数据重置云端';
  } catch (e) {
    syncConfig.lastError = (e as Error).message;
    syncState.status = '同步失败';
  } finally {
    syncState.running = false;
    if (resumeWatch) void watchLoop();
  }
}

/* ---------------- 自动同步 ---------------- */

let debounceTimer = 0;
let intervalTimer = 0;
let watchAbort: AbortController | null = null;

/** 中断实时同步长轮询；返回此前是否在运行 */
function stopWatch(): boolean {
  const running = !!watchAbort && !watchAbort.signal.aborted;
  watchAbort?.abort();
  return running;
}

const enabled = (): boolean => !!syncConfig.provider && syncConfig.auto;

function onLocalChange(): void {
  // 来自同步写回或其他标签页的变更不触发推送
  if (applying || isApplyingRemote()) return;
  changeGen++;
  syncConfig.dirty = true;
  if (!enabled()) return;
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
      if (!syncConfig.lastEtag) await syncNow('watch');
      // 同步失败（口令错误、限流、认证失败等）时不进入长轮询，按指数退避等待，避免死循环刷请求
      if (syncConfig.lastError || !syncConfig.lastEtag) throw new Error(syncConfig.lastError || 'no etag');
      const changed = await p.watch(valuesOf(p.id), syncConfig.lastEtag, ctrl.signal);
      if (ctrl.signal.aborted) break;
      if (changed) await syncNow('watch');
      backoff = WATCH_BACKOFF_MIN;
      // 兜底：一轮结束得太快（异常响应）时至少间隔 1 秒
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
  schedule();
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
