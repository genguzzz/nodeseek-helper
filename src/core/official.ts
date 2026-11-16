import { reactive } from 'vue';
import { GM_getValue, GM_setValue } from '$';
import type { Sticker } from './store';

/**
 * NodeSeek 官方内置表情（AC娘 / 洋葱头 / 小黄鸡 / Fluent）。
 * 运行时从站点编辑器脚本中解析表情清单，站点更新表情后自动跟随；解析失败时使用内置快照。
 * 发送内容与官方一致：` :<group><编号>: ` 转义码，不上传任何图片。
 */
export interface OfficialGroup {
  group: string;
  name: string;
  video: boolean;
  files: string[];
}

const CACHE_KEY = 'nsh_official_v1';
const STICKER_BASE = '/static/image/sticker';

const seq = (from: number, to: number, width: number, ext = ''): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(width, '0') + ext);

/** 2026-11 的官方清单快照 */
const SNAPSHOT: OfficialGroup[] = [
  { group: 'ac', name: 'AC娘', video: false, files: [...seq(1, 54, 2, '.png'), ...seq(1001, 1040, 4, '.png'), ...seq(2001, 2055, 4, '.png')] },
  { group: 'yct', name: '洋葱头', video: false, files: seq(1, 22, 3, '.gif') },
  {
    group: 'xhj',
    name: '小黄鸡',
    video: false,
    files: '001.png 002.png 003.png 004.gif 005.png 006.png 007.png 008.gif 009.gif 010.gif 011.png 012.gif 013.gif 014.gif 015.gif 016.gif 017.gif 018.gif 019.gif 020.gif 021.gif 022.png 023.gif 024.png 025.png 026.gif 027.gif 028.gif 029.gif 030.gif 031.png 032.png'.split(' '),
  },
  { group: 'emoji', name: 'Fluent', video: true, files: seq(0, 48, 2) },
];

export const official = reactive({
  groups: (GM_getValue<{ src: string; groups: OfficialGroup[] } | undefined>(CACHE_KEY, undefined)?.groups ?? SNAPSHOT) as OfficialGroup[],
  source: 'snapshot' as 'snapshot' | 'site',
});

/** 从站点脚本中截取第一个 `[{group:"…` 开头的数组字面量并转成 JSON */
export function parseOfficialFromScript(code: string): OfficialGroup[] | null {
  const start = code.indexOf('[{group:"');
  if (start < 0) return null;
  let depth = 0;
  let end = start;
  let inStr = false;
  for (; end < code.length; end++) {
    const c = code[end];
    if (inStr) {
      if (c === '\\') end++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  try {
    const json = code
      .slice(start, end + 1)
      .replace(/!0\b/g, 'true')
      .replace(/!1\b/g, 'false')
      .replace(/([{,])([A-Za-z_]\w*):/g, '$1"$2":');
    const raw = JSON.parse(json) as { group: string; cn_text: string; is_video?: boolean; files: string[] }[];
    const groups = raw
      .filter((g) => g.group !== 'app' && Array.isArray(g.files) && g.files.length)
      .map((g) => ({ group: g.group, name: g.cn_text, video: !!g.is_video, files: g.files }));
    return groups.length ? groups : null;
  } catch {
    return null;
  }
}

/** 页面里有编辑器脚本时读取并缓存（按脚本 URL 缓存，站点发版后自动刷新） */
export async function loadOfficialStickers(): Promise<void> {
  const src = Array.from(document.scripts)
    .map((s) => s.src)
    .find((s) => /\/assets\/markdownEditor-[\w-]+\.js$/.test(s));
  if (!src) return;
  const cached = GM_getValue<{ src: string; groups: OfficialGroup[] } | undefined>(CACHE_KEY, undefined);
  if (cached?.src === src) {
    official.groups = cached.groups;
    official.source = 'site';
    return;
  }
  try {
    const code = await (await fetch(src)).text();
    const groups = parseOfficialFromScript(code);
    if (!groups) return;
    official.groups = groups;
    official.source = 'site';
    GM_setValue(CACHE_KEY, { src, groups });
  } catch {
    /* 保持快照 */
  }
}

const codeOf = (file: string): string => file.replace(/\..*$/, '');

/** 官方表情转成与自定义表情同形的对象（id 以 ns: 开头，带 code 与视频地址） */
export function officialStickers(g: OfficialGroup): Sticker[] {
  return g.files.map((file) => {
    const code = codeOf(file);
    const base = `${STICKER_BASE}/${g.group}/${file}`;
    return {
      id: `ns:${g.group}${code}`,
      url: g.video ? `${base}.png` : base,
      name: `${g.name} ${code}`,
      groupId: `ns:${g.group}`,
      favorite: false,
      useCount: 0,
      lastUsedAt: 0,
      createdAt: 0,
      code: `:${g.group}${code}:`,
      video: g.video ? `${base}.webm` : undefined,
    };
  });
}

export const isOfficialId = (id: string): boolean => id.startsWith('ns:');
