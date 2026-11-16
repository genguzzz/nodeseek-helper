/**
 * 同步引擎端到端测试：内存里的假服务端（与 Go 服务相同的 ETag 条件写入 + 口令锁语义）+ 多台模拟设备。
 *
 * - 每个「标签页」是一份独立的模块实例（vi.resetModules 后重新导入），有自己的内存状态；
 * - 每台「设备」有自己的存储（GM_getValue / GM_setValue）、跨标签页通知与 Web Locks；
 *   同一设备的多个标签页共享这些，不同设备之间完全隔离；
 * - 设备时钟可以单独偏移，用来验证逻辑时钟。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Envelope } from '../src/sync/crypto';
import type { PullResult, SyncProvider } from '../src/sync/providers';

/* ---------------- 假服务端 ---------------- */

interface Remote {
  body?: string;
  etag?: string;
  lock?: string;
  ver: number;
  pulls: number;
  pushes: number;
  conflicts: number;
  /** 下一次 pull 返回前等待它 */
  gate?: Promise<void>;
  /** 下一次 push 检查版本之前执行（制造「拉取后、推送前被其他设备修改」） */
  beforePush?: () => Promise<void>;
  /** 下一次 push 直接失败（模拟断网） */
  failNextPush?: Error;
  watching: { signal: AbortSignal; resolve: (changed: boolean) => void }[];
}

const remote: Remote = { ver: 0, pulls: 0, pushes: 0, conflicts: 0, watching: [] };

function resetRemote(): void {
  for (const w of remote.watching) w.resolve(false);
  Object.assign(remote, {
    body: undefined, etag: undefined, lock: undefined, ver: 0, pulls: 0, pushes: 0, conflicts: 0,
    gate: undefined, beforePush: undefined, failNextPush: undefined, watching: [],
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, Math.random() * 3));

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
      await tick(); // 网络延迟：让并发的设备交错执行
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
      await tick();
      if (remote.failNextPush) {
        const e = remote.failNextPush;
        remote.failNextPush = undefined;
        throw e;
      }
      // 以下检查 + 写入是同步的，相当于服务端持锁的原子操作
      if (remote.lock && remote.lock !== keyId) throw new errors.LockedError('这个同步空间已被另一个加密口令锁定');
      if (remote.body ? etag !== remote.etag : !!etag) {
        remote.conflicts++;
        throw new errors.ConflictError();
      }
      if (keyId && !remote.lock) remote.lock = keyId;
      remote.body = JSON.stringify(env);
      remote.etag = `"v${++remote.ver}"`;
      for (const w of remote.watching.splice(0)) w.resolve(true);
      return remote.etag;
    },
    watch(_v, etag, signal) {
      if (etag !== remote.etag) return Promise.resolve(true);
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true });
        remote.watching.push({ signal, resolve });
      });
    },
  };
}

/* ---------------- 设备：存储、跨标签页通知、Web Locks、时钟 ---------------- */

type Listener = (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void;

class DeviceEnv {
  data = new Map<string, string>();
  listeners: { tab: number; key: string; fn: Listener }[] = [];
  locks = new Map<string, Promise<void>>();
  clockOffset = 0;
  tabs = 0;

  /** 与 Web Locks 语义一致：同名锁排队独占 */
  request<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(name) ?? Promise.resolve();
    const run = prev.then(fn);
    this.locks.set(name, run.then(() => undefined, () => undefined));
    return run;
  }
}

/**
 * 为即将加载的标签页注册模块替身（vi.doMock 不会被提升，配合 vi.resetModules 每个标签页拿到自己的一份）：
 * - '$'：GM 存储换成该设备的存储，跨标签页通知只发给同一设备的其他标签页；
 * - locks：该设备自己的 Web Locks；
 * - providers：假服务端，错误类用该实例自己的（引擎的 instanceof 判断才成立）。
 */
function mockTab(env: DeviceEnv, tab: number): void {
  vi.doMock('$', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../src/platform/web')>();
    return {
      ...mod,
      GM_getValue: <T,>(key: string, def?: T): T => {
        const raw = env.data.get(key);
        return raw == null ? (def as T) : (JSON.parse(raw) as T);
      },
      GM_setValue: (key: string, value: unknown): void => {
        const old = env.data.get(key);
        env.data.set(key, JSON.stringify(value));
        // 其他标签页异步收到通知（与 Tampermonkey 一致）
        for (const l of env.listeners) {
          if (l.key === key && l.tab !== tab) setTimeout(() => l.fn(key, old && JSON.parse(old), value, true), 0);
        }
      },
      GM_addValueChangeListener: (key: string, fn: Listener): number => {
        env.listeners.push({ tab, key, fn });
        return 0;
      },
    };
  });
  vi.doMock('../src/sync/locks', () => ({
    withLock: <T,>(name: string, fn: () => Promise<T>): Promise<T> => env.request(name, fn),
    holdLeadership: (name: string, onLeader: () => void): void => {
      void env.request(name, () => new Promise<void>(() => onLeader()));
    },
  }));
  vi.doMock('../src/sync/providers', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../src/sync/providers')>();
    const crypto = await import('../src/sync/crypto');
    const fake = makeFake({ ConflictError: mod.ConflictError, LockedError: crypto.LockedError });
    return { ...mod, syncProviderById: (id: string) => (id === 'fake' ? fake : mod.syncProviderById(id)) };
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** 等待各模块的防抖落盘（store 200ms / 同步配置 300ms）与跨标签页通知 */
const settle = (): Promise<void> => sleep(400);

interface Tab {
  env: DeviceEnv;
  store: typeof import('../src/core/store');
  engine: typeof import('../src/sync/engine');
}

const realNow = Date.now.bind(Date);
const tabs: Tab[] = [];

/** 在某台设备上打开一个新标签页（新设备传 new DeviceEnv()） */
async function openTab(env: DeviceEnv, passphrase?: string): Promise<Tab> {
  vi.resetModules();
  mockTab(env, ++env.tabs);
  const store = await import('../src/core/store');
  const engine = await import('../src/sync/engine');
  if (passphrase !== undefined) {
    engine.syncConfig.provider = 'fake';
    engine.syncConfig.passphrase = passphrase;
    engine.syncConfig.auto = false;
  }
  const t = { env, store, engine };
  tabs.push(t);
  return t;
}

const newDevice = (passphrase: string): Promise<Tab> => openTab(new DeviceEnv(), passphrase);

/** 在该设备的时钟下执行（设备时钟可以偏移） */
async function onDevice<T>(t: Tab, fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + t.env.clockOffset);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}
const sync = (t: Tab): Promise<void> => onDevice(t, () => t.engine.syncNow());

const addSticker = (t: Tab, id: string, name = id): void => {
  t.store.stickerData.stickers.push({
    id,
    url: `https://example.com/${id}.png`,
    name,
    groupId: 'default',
    favorite: false,
    useCount: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
  });
};
const ids = (t: Tab): string[] => t.store.stickerData.stickers.map((s) => s.id).filter((id) => /^t_/.test(id)).sort();
const nameOf = (t: Tab, id: string): string | undefined => t.store.stickerData.stickers.find((s) => s.id === id)?.name;
const rename = (t: Tab, id: string, name: string): void => {
  const s = t.store.stickerData.stickers.find((x) => x.id === id);
  if (s) s.name = name;
};
const synced = (t: Tab): boolean => /已同步/.test(t.engine.syncState.status);

afterEach(async () => {
  for (const t of tabs.splice(0)) t.engine.syncConfig.auto = false;
  resetRemote();
  await settle();
});

/* ---------------- 基础 ---------------- */

describe('同步：基础', () => {
  it('第一台设备推送到空的云端，第二台相同口令的设备拉取到数据', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_a1');
    await sync(a);
    expect(synced(a)).toBe(true);
    expect(JSON.parse(remote.body as string).enc).toBe('aes-256-gcm');

    const b = await newDevice('p1');
    await sync(b);
    expect(synced(b)).toBe(true);
    expect(ids(b)).toEqual(['t_a1']);
  });

  it('口令不同或为空：报「口令错误」，不覆盖云端', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_a1');
    await sync(a);
    const etag = remote.etag;
    for (const pass of ['wrong', '']) {
      const b = await newDevice(pass);
      addSticker(b, 't_b1');
      await sync(b);
      expect(b.engine.syncState.status).toBe('口令错误');
      expect(remote.etag).toBe(etag);
      expect(ids(b)).toEqual(['t_b1']);
    }
  });

  it('删除会同步到其他设备', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_a1');
    addSticker(a, 't_a2');
    await sync(a);
    const b = await newDevice('p1');
    await sync(b);
    a.store.stickerData.stickers = a.store.stickerData.stickers.filter((s) => s.id !== 't_a1');
    await sync(a);
    await sync(b);
    expect(ids(b)).toEqual(['t_a2']);
  });

  it('新设备自带的默认数据不会覆盖其他设备的修改（未同步过的条目让位于云端）', async () => {
    const a = await newDevice('p1');
    await sync(a);
    a.store.stickerData.groups[0].name = '我的默认';
    await sync(a);

    const b = await newDevice('p1'); // 自带「默认」分组
    await sync(b);
    expect(b.store.stickerData.groups[0].name).toBe('我的默认');
    await sync(a);
    expect(a.store.stickerData.groups[0].name).toBe('我的默认');
  });
});

/* ---------------- 多设备竞态 ---------------- */

describe('同步：多设备竞态', () => {
  it('推送前云端被其他设备修改：冲突后重新拉取合并再推送', async () => {
    const a = await newDevice('p1');
    await sync(a);
    const b = await newDevice('p1');
    await sync(b);

    addSticker(b, 't_b1');
    addSticker(a, 't_a1');
    remote.beforePush = () => sync(b);
    await sync(a);
    expect(remote.conflicts).toBe(1);
    expect(synced(a)).toBe(true);
    expect(ids(a)).toEqual(['t_a1', 't_b1']);
    await sync(b);
    expect(ids(b)).toEqual(['t_a1', 't_b1']);
  });

  it('5 台设备同时新增、同时同步，多轮之后全部收敛，没有失败也没有丢数据', async () => {
    const devs: Tab[] = [];
    for (let i = 0; i < 5; i++) devs.push(await newDevice('p1'));
    const expected: string[] = [];
    for (let round = 0; round < 3; round++) {
      devs.forEach((d, i) => {
        addSticker(d, `t_${round}_${i}`);
        expected.push(`t_${round}_${i}`);
      });
      await Promise.all(devs.map((d) => sync(d)));
      for (const d of devs) expect(d.engine.syncConfig.lastError).toBe('');
    }
    // 再各同步一次拉取别人最后一轮的写入
    for (const d of devs) await sync(d);
    for (const d of devs) expect(ids(d)).toEqual([...expected].sort());
    expect(remote.conflicts).toBeGreaterThan(0); // 确实发生过并发冲突
  }, 60_000); // 每次同步都做真实的 AES / PBKDF2，5 台设备多轮较慢

  it('两台设备同时改同一个表情：后改的生效，先改的设备不会把它改回去', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_x', '原名');
    await sync(a);
    const b = await newDevice('p1');
    await sync(b);

    rename(a, 't_x', 'A 改的');
    await sync(a);
    await sleep(5);
    rename(b, 't_x', 'B 改的'); // 更晚
    await Promise.all([sync(a), sync(b)]);
    await sync(a);
    await sync(b);
    expect(nameOf(a, 't_x')).toBe('B 改的');
    expect(nameOf(b, 't_x')).toBe('B 改的');
  });

  it('一台设备删除、另一台同时修改：以时间更晚的操作为准，各端一致', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_x');
    await sync(a);
    const b = await newDevice('p1');
    await sync(b);

    rename(b, 't_x', '改名');
    await sync(b);
    await sleep(5);
    a.store.stickerData.stickers = a.store.stickerData.stickers.filter((s) => s.id !== 't_x'); // 更晚的删除
    await Promise.all([sync(a), sync(b)]);
    await sync(a);
    await sync(b);
    expect(ids(a)).toEqual([]);
    expect(ids(b)).toEqual([]);
  });

  it('设备时钟慢 1 小时：看过云端最新状态之后做的修改仍然生效（逻辑时钟）', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_x', 'A 的版本');
    await sync(a);
    const b = await newDevice('p1');
    b.env.clockOffset = -3600_000;
    await sync(b);
    rename(b, 't_x', 'B 后来改的');
    await sync(b);
    await sync(a);
    expect(nameOf(a, 't_x')).toBe('B 后来改的');
  });
});

/* ---------------- 本地修改不丢失 ---------------- */

describe('同步：本地修改不丢失', () => {
  it('修改后未来得及同步就关闭页面：下次打开（云端未变化）仍会推送', async () => {
    const env = new DeviceEnv();
    const a = await openTab(env, 'p1');
    await sync(a);
    addSticker(a, 't_a1');
    await settle(); // 数据已落盘，但没有同步
    const a2 = await openTab(env); // 重新打开页面：同一设备的存储
    const pushes = remote.pushes;
    await sync(a2);
    expect(remote.pushes).toBe(pushes + 1);
    const b = await newDevice('p1');
    await sync(b);
    expect(ids(b)).toEqual(['t_a1']);
  });

  it('同步过程中产生的新修改：下一轮推送出去', async () => {
    const a = await newDevice('p1');
    await sync(a);
    let release!: () => void;
    remote.gate = new Promise((r) => (release = r));
    const pending = sync(a);
    await sleep(0);
    addSticker(a, 't_late');
    release();
    await pending;
    await sync(a);
    const b = await newDevice('p1');
    await sync(b);
    expect(ids(b)).toEqual(['t_late']);
  });

  it('推送失败（断网）：已写回的云端内容不会被当成本地修改，本地修改下次仍会推送', async () => {
    const a = await newDevice('p1');
    addSticker(a, 't_x', 'A 原名');
    await sync(a);
    const b = await newDevice('p1');
    await sync(b);

    rename(a, 't_x', 'A 新名'); // A 的修改
    await sync(a);
    addSticker(b, 't_b1'); // B 的本地修改
    remote.failNextPush = new Error('网络错误');
    await sync(b); // 拉到并写回 A 的新名，推送失败
    expect(b.engine.syncState.status).toBe('同步失败');
    expect(nameOf(b, 't_x')).toBe('A 新名');
    await sync(b); // 恢复后：推送 t_b1，且不会把 A 的新名当成 B 的修改
    await sync(a);
    expect(ids(a)).toEqual(['t_b1', 't_x']);
    expect(nameOf(a, 't_x')).toBe('A 新名');
  });
});

/* ---------------- 同一设备多个标签页 ---------------- */

describe('同步：同一设备多个标签页', () => {
  it('两个标签页轮流同步，不会用过期状态把其他设备的修改改回去', async () => {
    const env = new DeviceEnv();
    const tab1 = await openTab(env, 'p1');
    addSticker(tab1, 't_x', '原名');
    await sync(tab1);
    await settle();
    const tab2 = await openTab(env);
    await sync(tab2);

    const c = await newDevice('p1');
    await sync(c);
    rename(c, 't_x', 'C 改的');
    await sync(c);

    await sync(tab1); // tab1 拉到 C 的修改
    await settle(); // 写回的数据传到 tab2
    await sync(tab2); // tab2 用的是共享的最新同步状态
    await sync(c);
    expect(nameOf(c, 't_x')).toBe('C 改的');
    expect(nameOf(tab2, 't_x')).toBe('C 改的');
  });

  it('两个标签页同时触发同步：串行执行，不会互相冲突', async () => {
    const env = new DeviceEnv();
    const tab1 = await openTab(env, 'p1');
    await sync(tab1);
    await settle();
    const tab2 = await openTab(env);
    addSticker(tab1, 't_1');
    await settle();
    await Promise.all([sync(tab1), sync(tab2)]);
    expect(remote.conflicts).toBe(0);
    expect(tab1.engine.syncConfig.lastError).toBe('');
    expect(tab2.engine.syncConfig.lastError).toBe('');
  });

  it('只有一个标签页成为主标签页负责自动同步', async () => {
    const env = new DeviceEnv();
    const tab1 = await openTab(env, 'p1');
    tab1.engine.startAutoSync();
    await settle();
    const tab2 = await openTab(env);
    tab2.engine.startAutoSync();
    await sleep(20);
    expect(tab1.engine.syncState.leader).toBe(true);
    expect(tab2.engine.syncState.leader).toBe(false);
  });
});

/* ---------------- 实时同步 ---------------- */

describe('同步：实时同步长轮询', () => {
  it('手动同步会先中断挂起的长轮询，同步完再恢复', async () => {
    const a = await newDevice('p1');
    a.engine.syncConfig.auto = true;
    a.engine.startAutoSync();
    for (let i = 0; i < 100 && !remote.watching.length; i++) await sleep(10);
    expect(remote.watching).toHaveLength(1);
    const first = remote.watching[0];
    await sync(a);
    expect(first.signal.aborted).toBe(true);
    for (let i = 0; i < 100 && !remote.watching.some((w) => !w.signal.aborted); i++) await sleep(10);
    expect(remote.watching.some((w) => w.signal !== first.signal && !w.signal.aborted)).toBe(true);
  });

  it('其他设备写入后，长轮询唤醒并拉取到新数据', async () => {
    const a = await newDevice('p1');
    a.engine.syncConfig.auto = true;
    a.engine.startAutoSync();
    for (let i = 0; i < 100 && !remote.watching.length; i++) await sleep(10);
    const b = await newDevice('p1');
    addSticker(b, 't_b1');
    await sync(b);
    for (let i = 0; i < 200 && !ids(a).includes('t_b1'); i++) await sleep(10);
    expect(ids(a)).toEqual(['t_b1']);
  });
});

/* ---------------- 口令锁 ---------------- */

describe('同步：口令锁', () => {
  it('首次加密写入锁定空间；其他口令既解不开，也无法用「重置云端」覆盖', async () => {
    const a = await newDevice('owner');
    addSticker(a, 't_owner');
    await sync(a);
    expect(remote.lock).toMatch(/^[0-9a-f]{64}$/);

    const b = await newDevice('intruder');
    await sync(b);
    expect(b.engine.syncState.status).toBe('口令错误');
    await b.engine.overwriteRemote();
    expect(b.engine.syncConfig.lastError).toContain('锁定');
    const c = await newDevice('');
    await c.engine.overwriteRemote();
    expect(c.engine.syncConfig.lastError).toContain('锁定');

    await sync(a);
    expect(synced(a)).toBe(true);
    expect(ids(a)).toEqual(['t_owner']);
  });

  it('已加密但未锁定的空间：有口令的设备同步一次即锁定，之后不再多余推送', async () => {
    const a = await newDevice('owner');
    await sync(a);
    remote.lock = undefined;
    const pushes = remote.pushes;
    await sync(a);
    expect(remote.pushes).toBe(pushes + 1);
    expect(remote.lock).toMatch(/^[0-9a-f]{64}$/);
    await sync(a);
    expect(remote.pushes).toBe(pushes + 1);
  });

  it('不加密的写入不会锁定空间', async () => {
    const a = await newDevice('');
    await sync(a);
    expect(remote.lock).toBeUndefined();
  });

  it('忘记口令：管理员解锁后，用本机数据和新口令重置云端', async () => {
    const a = await newDevice('old');
    addSticker(a, 't_old');
    await sync(a);
    const b = await newDevice('new');
    addSticker(b, 't_b1');
    await sync(b);
    expect(b.engine.syncState.status).toBe('口令错误');
    remote.lock = undefined; // token unlock
    await b.engine.overwriteRemote();
    expect(b.engine.syncConfig.lastError).toBe('');

    const c = await newDevice('new');
    await sync(c);
    expect(ids(c)).toEqual(['t_b1']);
    const d = await newDevice('old');
    await sync(d);
    expect(d.engine.syncState.status).toBe('口令错误');
  });
});
