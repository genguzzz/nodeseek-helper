import { beforeEach, describe, expect, it } from 'vitest';
import { settings, stickerData, type Sticker } from '../src/core/store';
import { applyDoc, buildLocalDoc, iconFromSync, iconToSync, mergeDocs, type SyncDocument, type SyncMeta } from '../src/sync/format';
import { open, PassphraseError, seal } from '../src/sync/crypto';

const sticker = (id: string, extra: Partial<Sticker> = {}): Sticker => ({
  id,
  url: `https://cdn.nodeimage.com/i/${id}.png`,
  name: id,
  groupId: 'default',
  favorite: false,
  useCount: 0,
  lastUsedAt: 0,
  createdAt: 1,
  ...extra,
});

function resetLocal(stickers: Sticker[]): void {
  stickerData.groups = [{ id: 'default', name: '默认' }];
  stickerData.stickers = stickers;
  settings.hosts = [];
  settings.activeHostId = '';
}

describe('同步文档：生成与变更追踪', () => {
  beforeEach(() => resetLocal([sticker('a'), sticker('b')]));

  it('未变化的条目保持原时间戳，变化的条目刷新时间戳', () => {
    const meta: SyncMeta = {};
    const d1 = buildLocalDoc(meta, 'dev1', 1000);
    expect(d1.stickers.a.t).toBe(1000);
    stickerData.stickers[0].name = 'a2';
    const d2 = buildLocalDoc(meta, 'dev1', 2000);
    expect(d2.stickers.a.t).toBe(2000);
    expect(d2.stickers.b.t).toBe(1000);
  });

  it('本地删除的条目生成墓碑', () => {
    const meta: SyncMeta = {};
    buildLocalDoc(meta, 'dev1', 1000);
    stickerData.stickers = stickerData.stickers.filter((s) => s.id !== 'b');
    const d = buildLocalDoc(meta, 'dev1', 2000);
    expect(d.stickers.b).toEqual({ t: 2000, d: true });
  });
});

describe('合并', () => {
  const base = (device: string, stickers: Record<string, SyncDocument['stickers'][string]>): SyncDocument => ({
    schema: 'nsh-sync/1',
    updatedAt: 0,
    device,
    settings: { t: 0, v: {} },
    hosts: {},
    groups: { default: { t: 0, v: { id: 'default', name: '默认' } } },
    stickers,
    order: { groups: { t: 0, v: ['default'] }, stickers: { t: 0, v: Object.keys(stickers) } },
  });

  it('两端各自新增的表情都保留', () => {
    const m = mergeDocs(base('A', { a: { t: 1, v: sticker('a') } }), base('B', { b: { t: 1, v: sticker('b') } }));
    expect(Object.keys(m.stickers).sort()).toEqual(['a', 'b']);
  });

  it('同一条目取时间较新的一方', () => {
    const m = mergeDocs(base('A', { a: { t: 5, v: sticker('a', { name: '新' }) } }), base('B', { a: { t: 3, v: sticker('a', { name: '旧' }) } }));
    expect(m.stickers.a.v?.name).toBe('新');
  });

  it('删除晚于修改时删除生效', () => {
    const m = mergeDocs(base('A', { a: { t: 9, d: true } }), base('B', { a: { t: 3, v: sticker('a') } }));
    expect(m.stickers.a.d).toBe(true);
  });

  it('使用次数与最近使用时间取两端最大值', () => {
    const m = mergeDocs(
      base('A', { a: { t: 5, v: sticker('a', { useCount: 2, lastUsedAt: 100 }) } }),
      base('B', { a: { t: 3, v: sticker('a', { useCount: 7, lastUsedAt: 50 }) } }),
    );
    expect(m.stickers.a.v).toMatchObject({ useCount: 7, lastUsedAt: 100 });
  });

  it('时间相同时两端得到相同结果（按设备 ID 决定）', () => {
    const a = base('A', { x: { t: 5, v: sticker('x', { name: 'fromA' }) } });
    const b = base('B', { x: { t: 5, v: sticker('x', { name: 'fromB' }) } });
    expect(mergeDocs(a, b).stickers.x.v?.name).toBe(mergeDocs(b, a).stickers.x.v?.name);
  });
});

describe('写回本地', () => {
  beforeEach(() => resetLocal([sticker('a')]));

  it('按顺序表写回，未出现在顺序表里的追加到末尾，并对齐 meta', () => {
    const meta: SyncMeta = {};
    const doc = buildLocalDoc(meta, 'dev1', 1000);
    doc.stickers.b = { t: 1500, v: sticker('b', { createdAt: 5 }) };
    doc.stickers.c = { t: 1500, v: sticker('c', { createdAt: 3 }) };
    doc.order.stickers = { t: 1500, v: ['b', 'a'] };
    applyDoc(doc, meta);
    expect(stickerData.stickers.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    // 写回后再生成文档不应被当作本地变更
    const again = buildLocalDoc(meta, 'dev1', 9999);
    expect(again.stickers.b.t).toBe(1500);
  });

  it('分组被删除时其中的表情回落到默认分组', () => {
    const meta: SyncMeta = {};
    const doc = buildLocalDoc(meta, 'dev1', 1000);
    doc.stickers.z = { t: 2000, v: sticker('z', { groupId: 'gone' }) };
    applyDoc(doc, meta);
    expect(stickerData.stickers.find((s) => s.id === 'z')?.groupId).toBe('default');
  });
});

describe('分组图标编码', () => {
  it('SVG 编码为 base64 data URL 并可还原', () => {
    const svg = '<svg viewBox="0 0 1 1"><text>花火</text></svg>';
    const icon = iconToSync(svg);
    expect(icon?.type).toBe('svg');
    expect(iconFromSync(icon)).toBe(svg);
  });
  it('URL 与 emoji', () => {
    expect(iconToSync('https://x.com/a.png')).toEqual({ type: 'url', url: 'https://x.com/a.png' });
    expect(iconToSync('🔥')).toEqual({ type: 'emoji', text: '🔥' });
    expect(iconFromSync({ type: 'unknown' } as never)).toBeUndefined();
  });
});

describe('信封', () => {
  const doc = (): SyncDocument => ({
    schema: 'nsh-sync/1',
    updatedAt: 1,
    device: 'd',
    settings: { t: 1, v: { imageTemplate: '![{name}]({url})' } },
    hosts: { h: { t: 1, v: { id: 'h', name: '图床', provider: 'cfimgbed', values: { authCode: 'secret-code' } } } },
    groups: {},
    stickers: {},
    order: { groups: { t: 1, v: [] }, stickers: { t: 1, v: [] } },
  });

  it('不加密：gzip 往返', async () => {
    const env = await seal(doc(), '');
    expect(env.enc).toBe('none');
    expect(await open(env, '')).toEqual(doc());
  });

  it('加密：密文中不含明文密钥，口令正确可还原，错误抛 PassphraseError', async () => {
    const env = await seal(doc(), 'p@ss');
    expect(env.enc).toBe('aes-256-gcm');
    expect(JSON.stringify(env)).not.toContain('secret-code');
    expect(await open(env, 'p@ss')).toEqual(doc());
    await expect(open(env, 'wrong')).rejects.toBeInstanceOf(PassphraseError);
    await expect(open(env, '')).rejects.toBeInstanceOf(PassphraseError);
  });
});
