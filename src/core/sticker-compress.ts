import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

/** 表情的目标尺寸：最长边不超过该值（论坛里表情显示宽度约 90~120px，留 2 倍清晰度） */
export const STICKER_MAX_SIDE = 240;
/** 超过该体积即视为「明显偏大」需要压缩 */
export const STICKER_MAX_BYTES = 200 * 1024;

export interface CompressResult {
  file: File;
  compressed: boolean;
  before: number;
  after: number;
  note?: string;
}

const kb = (n: number): string => `${Math.round(n / 1024)}KB`;

function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

async function readSize(blob: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const r = { w: bmp.width, h: bmp.height };
  bmp.close();
  return r;
}

/** 静态图：缩放后转 WebP（保留透明） */
async function compressStatic(blob: Blob, name: string): Promise<File> {
  const bmp = await createImageBitmap(blob);
  const { w, h } = fitSize(bmp.width, bmp.height, STICKER_MAX_SIDE);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
  return new File([out], name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
}

/**
 * GIF：逐帧解码 → 按处置方式合成完整画面 → 缩放 → 量化重新编码，保留动画与透明。
 * 帧数过多时按比例抽帧（合并延时），控制体积与耗时。
 */
async function compressGif(blob: Blob, name: string): Promise<File> {
  const gif = parseGIF(await blob.arrayBuffer());
  const frames: ParsedFrame[] = decompressFrames(gif, true);
  const fw = gif.lsd.width;
  const fh = gif.lsd.height;
  const { w, h } = fitSize(fw, fh, STICKER_MAX_SIDE);
  const full = new OffscreenCanvas(fw, fh);
  const fctx = full.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  const patchCanvas = new OffscreenCanvas(1, 1);
  const pctx = patchCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const out = new OffscreenCanvas(w, h);
  const octx = out.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  octx.imageSmoothingQuality = 'high';
  const MAX_FRAMES = 60;
  const step = Math.max(1, Math.ceil(frames.length / MAX_FRAMES));
  const enc = GIFEncoder();
  let delayAcc = 0;
  let prevDisposal = 0;
  let prevDims: ParsedFrame['dims'] | null = null;
  frames.forEach((f, i) => {
    if (prevDisposal === 2 && prevDims) fctx.clearRect(prevDims.left, prevDims.top, prevDims.width, prevDims.height);
    patchCanvas.width = f.dims.width;
    patchCanvas.height = f.dims.height;
    pctx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
    fctx.drawImage(patchCanvas, f.dims.left, f.dims.top);
    prevDisposal = f.disposalType;
    prevDims = f.dims;
    delayAcc += f.delay || 100;
    if (i % step !== 0 && i !== frames.length - 1) return;
    octx.clearRect(0, 0, w, h);
    octx.drawImage(full, 0, 0, w, h);
    const { data } = octx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(data, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((c) => c[3] === 0);
    enc.writeFrame(index, w, h, {
      palette,
      delay: delayAcc,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    });
    delayAcc = 0;
  });
  enc.finish();
  return new File([new Uint8Array(enc.bytes())], name.replace(/\.[^.]+$/, '') + '.gif', { type: 'image/gif' });
}

/** 表情明显偏大（体积或尺寸）时压缩；压缩后反而更大则保留原图 */
export async function compressSticker(blob: Blob, name: string): Promise<CompressResult> {
  const before = blob.size;
  const original = new File([blob], name, { type: blob.type });
  let size: { w: number; h: number };
  try {
    size = await readSize(blob);
  } catch {
    return { file: original, compressed: false, before, after: before, note: '无法解码，按原图上传' };
  }
  const oversized = before > STICKER_MAX_BYTES || Math.max(size.w, size.h) > STICKER_MAX_SIDE * 1.5;
  if (!oversized) return { file: original, compressed: false, before, after: before };
  try {
    let file: File;
    if (blob.type === 'image/gif') file = await compressGif(blob, name);
    else if (/^image\/(webp|avif|apng)$/.test(blob.type) && (await isAnimated(blob))) {
      // 动态 WebP / AVIF 浏览器端无法重新编码动画，保留原图
      return { file: original, compressed: false, before, after: before, note: `动图格式 ${blob.type} 无法在浏览器端压缩，按原图上传（${kb(before)}）` };
    } else file = await compressStatic(blob, name);
    if (file.size >= before) return { file: original, compressed: false, before, after: before };
    return { file, compressed: true, before, after: file.size, note: `${kb(before)} → ${kb(file.size)}` };
  } catch (e) {
    return { file: original, compressed: false, before, after: before, note: `压缩失败（${(e as Error).message}），按原图上传` };
  }
}

/** 用 ImageDecoder（WebCodecs）粗略判断是否动图，不支持时按静态处理 */
async function isAnimated(blob: Blob): Promise<boolean> {
  const Decoder = (globalThis as unknown as { ImageDecoder?: new (init: { data: ReadableStream; type: string }) => { tracks: { ready: Promise<void>; selectedTrack?: { animated: boolean } }; close(): void } }).ImageDecoder;
  if (!Decoder) return false;
  try {
    const d = new Decoder({ data: blob.stream(), type: blob.type });
    await d.tracks.ready;
    const animated = !!d.tracks.selectedTrack?.animated;
    d.close();
    return animated;
  } catch {
    return false;
  }
}
