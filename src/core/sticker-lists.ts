import { computed } from 'vue';
import { renderTemplate, settings, stickerData, useSticker, type Sticker } from './store';
import { official, officialStickers, isOfficialId } from './official';
import { hidePreview } from './ui';

const RECENT_LIMIT = 24;

/** 官方表情全集（按转义码索引），收藏 / 最近使用 / 搜索里要用 */
export const officialAll = computed(() => official.groups.flatMap(officialStickers));
const officialByCode = computed(() => new Map(officialAll.value.map((s) => [s.code as string, s])));

export const favList = computed<Sticker[]>(() => [
  ...stickerData.stickers.filter((s) => s.favorite),
  ...settings.officialFav.map((c) => officialByCode.value.get(c)).filter((s): s is Sticker => !!s),
]);

export const recentList = computed<Sticker[]>(() => {
  const mine = stickerData.stickers.filter((s) => s.lastUsedAt > 0).map((s) => ({ s, t: s.lastUsedAt }));
  const off = Object.entries(settings.officialUsage)
    .map(([code, u]) => ({ s: officialByCode.value.get(code), t: u.t }))
    .filter((x): x is { s: Sticker; t: number } => !!x.s);
  return [...mine, ...off]
    .sort((a, b) => b.t - a.t)
    .slice(0, RECENT_LIMIT)
    .map((x) => x.s);
});

export function searchStickers(keyword: string): Sticker[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  const hit = (s: Sticker): boolean => s.name.toLowerCase().includes(kw) || s.url.toLowerCase().includes(kw) || !!s.code?.includes(kw);
  return [...stickerData.stickers.filter(hit), ...officialAll.value.filter(hit)].slice(0, 200);
}

/** 分组 id → 表情列表（fav / recent / ns:<官方分组> / 自定义分组 id） */
export function stickersOfTab(tab: string): Sticker[] {
  if (tab === 'fav') return favList.value;
  if (tab === 'recent') return recentList.value;
  if (tab.startsWith('ns:')) {
    const g = official.groups.find((x) => `ns:${x.group}` === tab);
    return g ? officialStickers(g) : [];
  }
  return stickerData.stickers.filter((s) => s.groupId === tab);
}

export const isFav = (s: Sticker): boolean => (s.code && isOfficialId(s.id) ? settings.officialFav.includes(s.code) : s.favorite);

export function toggleFav(s: Sticker): void {
  if (s.code && isOfficialId(s.id)) {
    const i = settings.officialFav.indexOf(s.code);
    if (i > -1) settings.officialFav.splice(i, 1);
    else settings.officialFav.push(s.code);
    return;
  }
  s.favorite = !s.favorite;
}

/** 记录一次官方表情使用（转义码形如 `:yct001:`） */
export function recordOfficialUse(code: string): void {
  const u = settings.officialUsage[code] ?? { c: 0, t: 0 };
  settings.officialUsage[code] = { c: u.c + 1, t: Date.now() };
}

/** 选中表情后要插入编辑器的文本，并记录使用 */
export function textForSticker(s: Sticker): string {
  hidePreview();
  if (s.code && isOfficialId(s.id)) {
    // 官方表情：与原生一致，发送转义码
    recordOfficialUse(s.code);
    return ` ${s.code} `;
  }
  useSticker(s);
  return ' ' + renderTemplate(settings.stickerTemplate, { url: s.url, name: s.name }) + ' ';
}
