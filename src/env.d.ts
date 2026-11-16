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
