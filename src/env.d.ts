/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module 'gifenc' {
  type Palette = number[][];
  interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number; transparent?: boolean; transparentIndex?: number; dispose?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(): Encoder;
  export function quantize(rgba: Uint8ClampedArray, maxColors: number, opts?: { format?: string; oneBitAlpha?: boolean | number }): Palette;
  export function applyPalette(rgba: Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
}

/** 构建时注入的版本号（package.json） */
declare const __NSH_VERSION__: string;

/** 调试构建的性能日志上报地址；正式构建为空字符串 */
declare const __NSH_DEBUG_REPORT__: string;

/** 构建目标：true 为代理工具注入版（`$` = platform/web.ts，原生 XHR + 同源中转），false 为油猴脚本 */
declare const __NSH_WEB__: boolean;
