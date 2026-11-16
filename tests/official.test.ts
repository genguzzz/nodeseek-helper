import { describe, expect, it } from 'vitest';
import { officialStickers, parseOfficialFromScript } from '../src/core/official';

describe('官方表情清单解析', () => {
  const code =
    'var x=1;const N4=[{group:"ac",cn_text:"AC娘",files:["01.png","1001.png"]},{group:"yct",cn_text:"洋葱头",files:["001.gif"]},' +
    '{group:"emoji",cn_text:"Fluent",is_video:!0,files:["00","01"]},{group:"app",cn_text:"App",files:["vote.png"]}],y=2;';

  it('从压缩后的脚本中解析分组，排除 App', () => {
    const groups = parseOfficialFromScript(code);
    expect(groups?.map((g) => g.group)).toEqual(['ac', 'yct', 'emoji']);
    expect(groups?.[2]).toMatchObject({ name: 'Fluent', video: true, files: ['00', '01'] });
  });

  it('脚本里没有清单时返回 null', () => {
    expect(parseOfficialFromScript('function a(){}')).toBeNull();
  });

  it('转义码与图片地址和官方一致', () => {
    const [ac, , emoji] = parseOfficialFromScript(code) ?? [];
    expect(officialStickers(ac).map((s) => s.code)).toEqual([':ac01:', ':ac1001:']);
    expect(officialStickers(ac)[0].url).toBe('/static/image/sticker/ac/01.png');
    expect(officialStickers(emoji)[0]).toMatchObject({ code: ':emoji00:', url: '/static/image/sticker/emoji/00.png', video: '/static/image/sticker/emoji/00.webm' });
  });
});
