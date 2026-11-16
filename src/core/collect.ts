import { activeHost, addHistory, addStickers, DEFAULT_GROUP_ID, guessName, settings, uid, type HostProfile } from './store';
import { compressSticker } from './sticker-compress';
import { downloadImage, providerById, uploadFile } from './uploaders';
import { askConfirm, openPanel, toast, updateToast } from './ui';

/**
 * 「收藏为表情」的流量策略：
 * - NodeSeek 官方图床（NodeImage）与站点自身资源：直接收藏
 * - 自己配置的图床域名：直接收藏（流量是自己的）
 * - 其他图床：不直接引用别人的流量；有图床则询问转存到自己的图床，没有则询问转存到官方图床 NodeImage
 */
const OFFICIAL_HOST_RE = /(^|\.)(nodeimage\.com|nodeseek\.com|deepflood\.com)$/i;

const hostOf = (url: string): string => {
  try {
    return new URL(url, location.href).hostname;
  } catch {
    return '';
  }
};

/** 用户已配置图床涉及的所有域名（站点地址、链接前缀等） */
function ownHosts(): Set<string> {
  const set = new Set<string>();
  for (const h of settings.hosts) {
    for (const v of Object.values(h.values)) {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) set.add(hostOf(v));
    }
  }
  return set;
}

export type LinkKind = 'official' | 'own' | 'foreign';

export function classifyLink(url: string): LinkKind {
  const host = hostOf(url);
  if (!host || OFFICIAL_HOST_RE.test(host)) return 'official';
  if (ownHosts().has(host)) return 'own';
  return 'foreign';
}

/** 下载 → 必要时压缩 → 上传到指定图床，返回新链接 */
export async function rehostImage(url: string, host: HostProfile, name: string): Promise<string> {
  const t = toast('正在下载图片…', 'loading');
  try {
    const blob = await downloadImage(url);
    updateToast(t, { text: '正在压缩…' });
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const result = await compressSticker(blob, `${name}.${ext}`);
    updateToast(t, { text: `正在上传到「${host.name}」${result.note ? `（${result.note}）` : ''}`, progress: 0 });
    const newUrl = await uploadFile(host, result.file, { onProgress: (p) => (t.progress = p) });
    addHistory({ url: newUrl, name, host: host.name || providerById(host.provider)?.name || host.provider, time: Date.now() });
    updateToast(t, { type: 'success', text: `已转存到「${host.name}」${result.compressed ? `，${result.note}` : ''}`, progress: undefined }, 3500);
    return newUrl;
  } catch (e) {
    updateToast(t, { type: 'error', text: `转存失败：${(e as Error).message}`, progress: undefined }, 6000);
    throw e;
  }
}

function findNodeImageHost(): HostProfile | undefined {
  return settings.hosts.find((h) => h.provider === 'nodeimage' && String(h.values.key ?? '').trim());
}

/** 帖子图片「收藏为表情」入口 */
export async function collectSticker(url: string, alt?: string): Promise<void> {
  const name = (alt && alt !== 'image' && alt !== 'emote' ? alt : guessName(url)).slice(0, 40);
  const add = (finalUrl: string): void => {
    const r = addStickers([{ url: finalUrl, name }], DEFAULT_GROUP_ID);
    toast(r.added ? '已收藏到「默认」分组' : '表情库里已经有它了', r.added ? 'success' : 'info');
  };
  const kind = classifyLink(url);
  if (kind !== 'foreign') return add(url);
  const host = hostOf(url);
  const mine = activeHost();
  if (mine) {
    const choice = await askConfirm({
      title: '这张图不在官方图床',
      message: `图片来自 ${host}。直接收藏会一直消耗对方图床的流量。\n是否下载后转存到你的图床「${mine.name}」再收藏？偏大的表情会自动压缩。`,
      okText: '转存并收藏',
      cancelText: '取消',
    });
    if (choice === 'ok') add(await rehostImage(url, mine, name));
    return;
  }
  const ni = findNodeImageHost();
  const choice = await askConfirm({
    title: '这张图不在官方图床',
    message: `图片来自 ${host}，直接收藏会消耗对方图床的流量。\n你还没有配置图床，是否转存到 NodeSeek 官方图床 NodeImage？${ni ? '' : '\n需要先填写 NodeImage 的 API Key（在 nodeimage.com 首页「API 密钥」处复制）。'}`,
    okText: ni ? '转存到 NodeImage' : '去配置 NodeImage',
    cancelText: '取消',
  });
  if (choice !== 'ok') return;
  if (ni) {
    add(await rehostImage(url, ni, name));
    return;
  }
  // 创建 NodeImage 配置并打开设置页，填好 Key 后再点一次收藏即可
  if (!settings.hosts.some((h) => h.provider === 'nodeimage')) {
    const id = uid();
    settings.hosts.push({ id, name: 'NodeImage（官方图床）', provider: 'nodeimage', values: {} });
    settings.activeHostId = id;
  }
  openPanel('hosts');
  toast('填写 NodeImage API Key 后，再点一次「收藏为表情」即可', 'info', 5000);
}
