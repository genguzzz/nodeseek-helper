/** 线性图标，风格对齐 NodeSeek 使用的 IconPark outline（currentColor，1em） */
const svg = (body: string, size = '1em'): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const ICON_UPLOAD = svg(
  '<path d="M12 33c-4.4 0-8-3.6-8-8 0-4 3-7.4 7-7.9C12.2 11.3 17.6 7 24 7s11.8 4.3 13 10.1c4 .5 7 3.9 7 7.9 0 4.4-3.6 8-8 8"/><path d="M24 41V22M17 28l7-7 7 7"/>',
  '16',
);
export const ICON_GEAR = svg(
  '<path d="M18.3 6.6 20 3h8l1.7 3.6 3.9 2.2 4-.4 4 6.9-2.3 3.3v4.6l2.3 3.3-4 6.9-4-.4-3.9 2.2L28 45h-8l-1.7-3.6-3.9-2.2-4 .4-4-6.9 2.3-3.3v-4.6L6.4 15.5l4-6.9 4 .4 3.9-2.4Z"/><circle cx="24" cy="24" r="6"/>',
  '16',
);

/** 工具栏表情按钮：与 IconPark outline 同笔画 */
export const ICON_EMOJI = svg(
  '<circle cx="24" cy="24" r="20"/><path d="M31 18v1M17 18v1M31 31s-2 4-7 4-7-4-7-4"/>',
  '16',
);

/**
 * NodeSeek 助手入口图标：笑脸气泡 + 右上角四芒星。
 * 笑脸代表表情包，四芒星代表「助手 / 增强」，线宽与站点 iconpark 一致，单色 currentColor。
 */
export const ICON_HELPER = `<svg class="iconpark-icon nsh-helper-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M36.5 25.5c.3 1 .5 2 .5 3C37 37 30.3 43 22 43c-2.6 0-5-.6-7.1-1.6L7 43l1.9-6.4A15 15 0 0 1 7 28.5C7 20 13.7 14 22 14c1.6 0 3.1.2 4.5.6"/><path d="M16.5 26v1M27.5 26v1M16 33s2 3 6 3 6-3 6-3"/><path d="M38 5l1.6 4.4L44 11l-4.4 1.6L38 17l-1.6-4.4L32 11l4.4-1.6Z" fill="currentColor" stroke-width="2"/></svg>`;

/** 顶部导航入口：笑脸贴纸（右下角卷起），与导航栏的太阳 / 月亮 / 搜索图标同为 17px IconPark outline */
export const ICON_HEADER = svg(
  '<path d="M44 24c0-11.046-8.954-20-20-20S4 12.954 4 24s8.954 20 20 20c2 0 4-.3 5.8-.8L44 29"/><path d="M29 43V33a4 4 0 0 1 4-4h11"/><path d="M15 27c2 3 5 4.5 9 4.5"/><circle cx="17" cy="18" r="1" fill="currentColor"/><circle cx="31" cy="18" r="1" fill="currentColor"/>',
  '17',
);
