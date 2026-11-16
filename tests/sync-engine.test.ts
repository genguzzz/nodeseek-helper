/**
 * 同步引擎端到端测试：用内存里的假服务端（与 Go 服务相同的 ETag / 条件写入语义）模拟多台设备。
 * 每台设备是一份独立的模块实例（vi.resetModules 后重新导入），各自有自己的 store 与同步配置。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Envelope } from '../src/sync/crypto';
import type { PullResult, SyncProvider } from '../src/sync/providers';

/* ---------------- 假服务端 ---------------- */

interface Remote {
  body?: string;
  etag?: string;
  /** 口令锁：第一次带密钥标识写入时记下（与 Go 服务一致） */
  lock?: string;
  ver: number;
  pulls: number;
  pushes: number;
  /** 下一次 pull 返回前等待它（用于在同步过程中插入本地修改 / 其他设备写入） */
  gate?: Promise<void>;
  /** 下一次 push 检查版本之前执行（用于制造「拉取后、推送前云端被其他设备修改」的冲突） */
  beforePush?: () => Promise<void>;
  /** 当前挂起的长轮询 */
  watching: { signal: AbortSignal; resolve: (changed: boolean) => void }[];
}

const remote: Remote = { ver: 0, pulls: 0, pushes: 0, watching: [] };

function resetRemote(): void {
  Object.assign(remote, { body: undefined, etag: undefined, lock: undefined, ver: 0, pulls: 0, pushes: 0, gate: undefined, beforePush: undefined, watching: [] });
}

function write(env: Envelope): string {
  remote.body = JSON.stringify(env);
  remote.etag = `"v${++remote.ver}"`;
  for (const w of remote.watching.splice(0)) w.resolve(true);
  return remote.etag;
}

/**
 * 假服务端。每台设备是独立的模块实例，错误类也各有一份：
 * 由 vi.mock 工厂按实例传入该实例自己的 ConflictError / LockedError，引擎的 instanceof 判断才成立。
 */
function makeFake(errors: { ConflictError: new () => Error; LockedError: new (msg: string) => Error }): SyncProvider {
  return {
    id: 'fake',
    name: 'fake',
    desc: '',
    fields: [],
    keyScope: () => 'space-1',
    async pull(_v, etag): Promise<PullResult> {
      remote.pulls++;
      const gate = remote.gate;
      remote.gate = undefined;
      if (gate) await gate;
      const locked = !!remote.lock;
      if (!remote.body) return { status: 'empty', locked };
      if (etag && etag === remote.etag) return { status: 'notModified', etag, locked };
      return { status: 'ok', etag: remote.etag, envelope: JSON.parse(remote.body) as Envelope, locked };
    },
    async push(_v, env, etag, keyId) {
      remote.pushes++;
      const hook = remote.beforePush;
      remote.beforePush = undefined;
      if (hook) await hook();
      if (remote.lock && remote.lock !== keyId) throw new errors.LockedError('这个同步空间已被另一个加密口令锁定');
      if (remote.body ? etag !== remote.etag : !!etag) throw new errors.ConflictError();
      if (keyId && !remote.lock) remote.lock = keyId;
      return write(env);
    },
    watch(_v, etag, signal) {
      if (etag !== remote.etag) return Promise.resolve(true);
      return new Promise((resolve, reject) => {
        // 与真实实现一致：中断时请求失败
        signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true });
        remote.watching.push({ signal, resolve });
      });
    },
  };
}

vi.mock('../src/sync/providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/sync/providers')>();
  const crypto = await import('../src/sync/crypto');
  const fake = makeFake({ ConflictError: mod.ConflictError, LockedError: crypto.LockedError });
  return { ...mod, syncProviderById: (id: string) => (id === 'fake' ? fake : mod.syncProviderById(id)) };
});

/* ---------------- 设备 ---------------- */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** 等待 store / 同步配置的防抖落盘（200 / 300ms） */
const flushStorage = (): Promise<void> => sleep(350);

interface Device {
  store: typeof import('../src/core/store');
  engine: typeof import('../src/sync/engine');
}

/** 新设备：清空本地存储后加载一份独立的模块实例 */
async function newDevice(passphrase: string, opts: { keepStorage?: boolean } = {}): Promise<Device> {
  // 先等上一台设备的防抖落盘写完，否则清空之后它才写入，新设备会读到上一台的 ETag / meta
  await flushStorage();
  if (!opts.keepStorage) localStorage.clear();
  vi.resetModules();
  const store = await import('../src/core/store');
  const engine = await import('../src/sync/engine');
  engine.syncConfig.provider = 'fake';
  engine.syncConfig.passphrase = passphrase;
  engine.syncConfig.auto = false;
  return { store, engine };
}

const addSticker = (d: Device, id: string): void => {
  d.store.stickerData.stickers.push({
    id,
    url: `https://example.com/${id}.png`,
    name: id,
    groupId: 'default',
    favorite: false,
    useCount: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  });
};
const ids = (d: Device): string[] => d.store.stickerData.stickers.map((s) => s.id).filter((id) => /^t_/.test(id));

afterEach(async () => {
  await flushStorage();
  resetRemote();
  localStorage.clear();
});

/* ---------------- 用例 ---------------- */

describe('同步引擎：多设备', () => {
  it('第一台设备推送到空的云端，第二台相同口令的设备拉取到数据', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_a1');
    await a.engine.syncNow();
    expect(a.engine.syncState.status).toMatch(/已同步/);
    expect(remote.pushes).toBe(1);
    expect(JSON.parse(remote.body as string).enc).toBe('aes-256-gcm');

    const b = await newDevice('p1');
    await b.engine.syncNow();
    expect(b.engine.syncState.status).toMatch(/已同步/);
    expect(ids(b)).toContain('t_a1');
  });

  it('口令不同或为空：报「口令错误」，不覆盖云端', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_a1');
    await a.engine.syncNow();
    const etag = remote.etag;

    for (const pass of ['wrong', '']) {
      const b = await newDevice(pass);
      addSticker(b, 't_b1');
      await b.engine.syncNow();
      expect(b.engine.syncState.status).toBe('口令错误');
      expect(b.engine.syncConfig.lastError).not.toBe('');
      expect(remote.etag).toBe(etag);
      expect(ids(b)).not.toContain('t_a1');
    }
  });

  it('两台设备各自新增，互相同步后都包含对方的数据', async () => {
    const a = await newDevice('p1');
    await a.engine.syncNow();
    const b = await newDevice('p1');
    await b.engine.syncNow();

    addSticker(a, 't_a1');
    addSticker(b, 't_b1');
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(ids(a).sort()).toEqual(['t_a1', 't_b1']);
    expect(ids(b).sort()).toEqual(['t_a1', 't_b1']);
  });

  it('推送时云端已被其他设备修改：冲突后重新拉取合并再推送', async () => {
    const a = await newDevice('p1');
    await a.engine.syncNow();
    const b = await newDevice('p1');
    await b.engine.syncNow();

    // 两台设备都没有挂实时同步（不经过 onLocalChange），靠 meta 比对发现本地修改
    addSticker(b, 't_b1');
    addSticker(a, 't_a1');
    // A 拉取完之后、推送之前，B 抢先写入云端 → A 带着旧 ETag 推送，必然冲突
    const pushesBefore = remote.pushes;
    remote.beforePush = () => b.engine.syncNow();
    await a.engine.syncNow();

    expect(remote.pushes - pushesBefore).toBe(3); // A 冲突 + B 成功 + A 重试成功
    expect(a.engine.syncState.status).toMatch(/已同步/);
    expect(ids(a).sort()).toEqual(['t_a1', 't_b1']);
    await b.engine.syncNow();
    expect(ids(b).sort()).toEqual(['t_a1', 't_b1']);
  });

  it('删除会同步到其他设备', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_a1');
    addSticker(a, 't_a2');
    await a.engine.syncNow();
    const b = await newDevice('p1');
    await b.engine.syncNow();
    expect(ids(b).sort()).toEqual(['t_a1', 't_a2']);

    a.store.stickerData.stickers = a.store.stickerData.stickers.filter((s) => s.id !== 't_a1');
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(ids(b)).toEqual(['t_a2']);
  });
});

describe('同步引擎：本地修改不丢失', () => {
  it('修改后未来得及推送就关闭页面：下次打开（云端未变化）仍会推送', async () => {
    const a = await newDevice('p1');
    a.engine.startAutoSync();
    await sleep(0);
    await a.engine.syncNow();
    const pushes = remote.pushes;

    addSticker(a, 't_a1');
    expect(a.engine.syncConfig.dirty).toBe(true);
    await flushStorage();
    // 模拟关闭页面：不等防抖推送，直接以同一份本地存储重新加载
    const a2 = await newDevice('p1', { keepStorage: true });
    expect(a2.engine.syncConfig.dirty).toBe(true);
    await a2.engine.syncNow();
    expect(remote.pushes).toBe(pushes + 1);
    expect(a2.engine.syncConfig.dirty).toBe(false);

    const b = await newDevice('p1');
    await b.engine.syncNow();
    expect(ids(b)).toContain('t_a1');
  });

  it('同步进行中产生的新修改：本轮结束后仍标记为待推送，下一轮推送出去', async () => {
    const a = await newDevice('p1');
    a.engine.startAutoSync();
    await sleep(0);
    await a.engine.syncNow();

    let release!: () => void;
    remote.gate = new Promise((r) => (release = r));
    const pending = a.engine.syncNow();
    await sleep(0);
    addSticker(a, 't_late'); // 本轮已经开始，buildLocalDoc 之前 / 之后都可能
    release();
    await pending;
    expect(a.engine.syncConfig.dirty).toBe(true);

    await a.engine.syncNow();
    expect(a.engine.syncConfig.dirty).toBe(false);
    const b = await newDevice('p1');
    await b.engine.syncNow();
    expect(ids(b)).toContain('t_late');
  });
});

describe('同步引擎：实时同步长轮询', () => {
  it('手动同步会先中断挂起的长轮询，同步完再恢复', async () => {
    const a = await newDevice('p1');
    a.engine.syncConfig.auto = true;
    a.engine.startAutoSync();
    // 等启动同步完成、长轮询挂起
    for (let i = 0; i < 50 && !remote.watching.length; i++) await sleep(10);
    expect(remote.watching).toHaveLength(1);
    const first = remote.watching[0];

    await a.engine.syncNow('manual');
    expect(first.signal.aborted).toBe(true);
    for (let i = 0; i < 50 && !remote.watching.some((w) => !w.signal.aborted); i++) await sleep(10);
    expect(remote.watching.some((w) => w.signal !== first.signal && !w.signal.aborted)).toBe(true);
    a.engine.syncConfig.auto = false;
  });

  it('其他设备写入后，长轮询唤醒并拉取到新数据', async () => {
    const a = await newDevice('p1');
    a.engine.syncConfig.auto = true;
    a.engine.startAutoSync();
    for (let i = 0; i < 50 && !remote.watching.length; i++) await sleep(10);

    // 另一台设备（独立实例）写入；之后切回 A 的模块实例不受影响
    const aEngine = a.engine;
    const aStore = a.store;
    const b = await newDevice('p1');
    addSticker(b, 't_b1');
    await b.engine.syncNow();

    for (let i = 0; i < 100 && !aStore.stickerData.stickers.some((s) => s.id === 't_b1'); i++) await sleep(10);
    expect(aStore.stickerData.stickers.some((s) => s.id === 't_b1')).toBe(true);
    aEngine.syncConfig.auto = false;
  });
});

describe('同步引擎：口令锁（第一个设置口令的人锁定空间）', () => {
  it('首次加密写入锁定空间；其他口令既解不开，也无法用「重置云端」覆盖', async () => {
    const a = await newDevice('owner');
    addSticker(a, 't_owner');
    await a.engine.syncNow();
    expect(remote.lock).toMatch(/^[0-9a-f]{64}$/);

    const b = await newDevice('intruder');
    await b.engine.syncNow();
    expect(b.engine.syncState.status).toBe('口令错误');
    await b.engine.overwriteRemote();
    expect(b.engine.syncConfig.lastError).toContain('锁定');

    // 不设口令也无法覆盖
    const c = await newDevice('');
    await c.engine.overwriteRemote();
    expect(c.engine.syncConfig.lastError).toContain('锁定');

    // 主人照常同步，数据没被动过
    const a2 = await newDevice('owner');
    await a2.engine.syncNow();
    expect(a2.engine.syncState.status).toMatch(/已同步/);
    expect(ids(a2)).toEqual(['t_owner']);
  });

  it('升级前已加密但未锁定的空间：有口令的设备同步一次即锁定（即使本地没有修改）', async () => {
    const a = await newDevice('owner');
    addSticker(a, 't_owner');
    await a.engine.syncNow();
    remote.lock = undefined; // 模拟旧版服务端写入、尚未锁定
    const pushes = remote.pushes;
    await a.engine.syncNow();
    expect(remote.pushes).toBe(pushes + 1);
    expect(remote.lock).toMatch(/^[0-9a-f]{64}$/);
    await a.engine.syncNow();
    expect(remote.pushes).toBe(pushes + 1); // 已锁定后不再多余推送
  });

  it('不加密的写入不会锁定空间', async () => {
    const a = await newDevice('');
    await a.engine.syncNow();
    expect(remote.lock).toBeUndefined();
  });
});

describe('同步引擎：忘记口令重置云端', () => {
  it('用本机数据和新口令覆盖云端，其他设备改用新口令后可同步', async () => {
    const a = await newDevice('old');
    addSticker(a, 't_old');
    await a.engine.syncNow();

    const b = await newDevice('new');
    addSticker(b, 't_b1');
    await b.engine.syncNow();
    expect(b.engine.syncState.status).toBe('口令错误');
    remote.lock = undefined; // 管理员执行 token unlock 解除口令锁
    await b.engine.overwriteRemote();
    expect(b.engine.syncConfig.lastError).toBe('');
    expect(remote.lock).toMatch(/^[0-9a-f]{64}$/); // 新口令重新锁定

    const c = await newDevice('new');
    await c.engine.syncNow();
    expect(ids(c)).toEqual(['t_b1']);
    const d = await newDevice('old');
    await d.engine.syncNow();
    expect(d.engine.syncState.status).toBe('口令错误');
  });
});
