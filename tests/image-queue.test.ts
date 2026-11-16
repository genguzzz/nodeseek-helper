import { describe, expect, it, vi } from 'vitest';

describe('image-queue', () => {
  it('跳过已卸载的排队者，名额不会被永久占用', async () => {
    vi.resetModules();
    const { acquireSlot } = await import('../src/core/image-queue');
    const held = await Promise.all([1, 2, 3, 4].map(() => acquireSlot()));
    // 4 个已卸载的排队者 + 1 个存活的
    const dead = [1, 2, 3, 4].map(() => acquireSlot(() => false));
    const live = acquireSlot(() => true);
    held.forEach((r) => r());
    const r = await live;
    expect(typeof r).toBe('function');
    let settled = false;
    void Promise.race(dead).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('挂起的请求到时自动归还名额', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const { acquireSlot } = await import('../src/core/image-queue');
    await Promise.all([1, 2, 3, 4].map(() => acquireSlot()));
    let got = false;
    void acquireSlot().then(() => (got = true));
    await vi.advanceTimersByTimeAsync(9000);
    expect(got).toBe(true);
    vi.useRealTimers();
  });

  it('归还函数重复调用只生效一次', async () => {
    vi.resetModules();
    const { acquireSlot } = await import('../src/core/image-queue');
    const rs = await Promise.all([1, 2, 3, 4].map(() => acquireSlot()));
    rs[0]();
    rs[0]();
    await acquireSlot();
    let fifth = false;
    void acquireSlot().then(() => (fifth = true));
    await Promise.resolve();
    expect(fifth).toBe(false);
  });
});
