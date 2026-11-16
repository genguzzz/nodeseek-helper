/** 内置表情包。首次启动（或新增内置包时）写入用户数据，之后可像普通分组一样排序、收藏、删除 */
export interface BuiltinPack {
  id: string;
  name: string;
  icon: string;
  source: string;
  urls: string[];
}

/** 花火图标：中心火种 + 8 道放射光束 + 末端火星，粉橙渐变 */
export const HANABI_ICON = `<svg viewBox="0 0 24 24" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="nshHanabi" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5fa2"/><stop offset=".55" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ffd23f"/></linearGradient></defs><g fill="none" stroke="url(#nshHanabi)" stroke-linecap="round" stroke-width="1.8"><path d="M12 8.2V3.6M12 15.8v4.6M8.2 12H3.6M15.8 12h4.6"/><path d="M9.3 9.3 6.4 6.4M14.7 14.7l2.9 2.9M14.7 9.3l2.9-2.9M9.3 14.7l-2.9 2.9" stroke-width="1.4"/></g><g fill="url(#nshHanabi)"><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="2" r="1.1"/><circle cx="12" cy="22" r="1.1"/><circle cx="2" cy="12" r="1.1"/><circle cx="22" cy="12" r="1.1"/><circle cx="5.2" cy="5.2" r=".9"/><circle cx="18.8" cy="18.8" r=".9"/><circle cx="18.8" cy="5.2" r=".9"/><circle cx="5.2" cy="18.8" r=".9"/></g></svg>`;

const ni = (ids: string): string[] => ids.trim().split(/\s+/).map((x) => `https://cdn.nodeimage.com/i/${x}`);

export const builtinPacks: BuiltinPack[] = [
  {
    id: 'hanabi',
    name: '花火',
    icon: HANABI_ICON,
    source: 'https://www.nodeseek.com/post-472759-1',
    urls: ni(`
      kiTPNRkkUMXrFbcqiQjInY997EXX8ugQ.png yNwUePEGVy7u15Dav0dsnKe44c3YJvAK.gif YtrI0qXlSjH1vjIVEPCIFrra7p93S9kn.webp
      BAyT6QNxu41dsi2jLwmhfE2qaRiIxyY6.webp p4NKizdYxK7YtdBjHmuYqaogU4QBYaUd.webp vTcG6KHwda3ZzsWCYHxPIXI36cPvFgaR.avif
      MdE5TIiLs1sogvre8Rc1TunNkROvwXbR.png DLckJTHxmoTysBWShRGhXcmY3bmB56TG.png rM7RVynnxChinGGZXXc1kzcJNaPsxx09.webp
      nJj1NJMN3FrvCjiYxLjDGnnMQrOuodX0.webp dI2NfaGlg4LMHsJJYbj6Deg7AvSrvfPW.webp v8bbgwPmDhn8CJfRLoJfTExECZXY9cAJ.avif
      s6yvTaNndMqSW2237VHvVaGbGUrtR482.avif IqtoK3LNY6UH8F49SMH6PnrdHbJDxbL5.avif EcfVbQVEhIQuhhZfz3GfmUbXbOugaTKs.avif
      jjmCWuOeedjWFyUMI1tM9KDLpK0YzMuU.avif d2Ybd1xx8ejNkfu7Rvv6YXHEEcj4dDuE.avif a53uo9CgZlL78BqIResfFmVJSk6YSVpi.webp
      2Jmuo2O6rd2BAwUv5IPnzrqOndF4GaXH.avif aa5u2pyhmLgxiqNye1Bm600GdFgQwnoH.avif sg1QIipECwsa0mVAXhGtDEUtrXz32I9j.avif
      Z24cydZ2nUL5jYmIxYbx8PTCgHUYWHVk.avif ixMkhZuRNt39ObpRpY5XTyNdyEpVenGh.avif qJbzpaPkUflHQxf0aUszKZrEgQzta5jd.webp
      Bjm9HjOzzaXTqNUWYx1yZexGs0lIN9so.webp 3TyPkkNXQ2iWsT2cuUBb5lqNEXkhQwMu.gif Rs1eZBpod5QsSoV1kIv1husXtopA6AcI.png
      Gy9MjsQyA7tW6kkRBux6Vurjw8tIuGAX.png 4dQT9ylVI51vzTvwdWAzZalZCOXS3RYc.png 5Z2V8HGqrFYzTdJDdoNAvIX4WQIQnBZz.png
      yIdwRnUajcvuVOlHaO5647PdMcRua2yS.png IEyH4NN7T0gzIj2GNDLEkMNfxi5e7S5R.png Q05BMry7UbL1QzNAAr0b4CO1jwB7po5v.png
      jCc6NDHOEP8AmpWifMkopF0w1vcNJVMC.png cLmlEhOL5qv1r7UNW6MgRuYePyupd35k.png 5qP7UR9sOgTBVH63ZXf5pWPiMq18iTyK.png
      43KwtgzDgaU2C91WXwp4ItBKHjsevHQE.png mRtWtxLeHYXdhM4yXmKAvPAZlkTzHfSl.gif Jrn7JvYVY7dAhQHMrQ0i2ixfaDDvxGYU.png
    `),
  },
];

/** 单色版本，用于顶部导航（与站点日/夜间图标同色） */
export const HANABI_ICON_MONO = HANABI_ICON.replace(/url\(#nshHanabi\)/g, 'currentColor').replace(/<defs>.*?<\/defs>/, '');
