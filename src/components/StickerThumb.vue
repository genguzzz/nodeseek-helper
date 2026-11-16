<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { settings } from '../core/store';
import { hidePreview, isAnimatedUrl, showPreview } from '../core/ui';

const props = withDefaults(defineProps<{ url: string; name?: string; size?: number; preview?: boolean }>(), {
  name: '',
  size: 64,
  preview: true,
});

const root = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const hovering = ref(false);
const frozen = ref(false);
const failed = ref(false);
const animated = computed(() => isAnimatedUrl(props.url));
/** WebP / AVIF 不一定是动图，角标只给 GIF */
const isGif = computed(() => /\.gif(\?|#|$)/i.test(props.url));
let timer = 0;

/** 动图静止：把首帧画到 canvas 上，悬浮时再显示原图播放 */
function onLoad(e: Event): void {
  if (!settings.freezeAnimated || !animated.value || !canvas.value) return;
  const img = e.target as HTMLImageElement;
  const c = canvas.value;
  const ratio = Math.min(1, (props.size * 2) / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  c.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  try {
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    frozen.value = true;
  } catch {
    frozen.value = false;
  }
}

function enter(): void {
  hovering.value = true;
  if (!props.preview || !settings.hoverPreview) return;
  timer = window.setTimeout(() => root.value && showPreview(root.value, props.url, props.name), 260);
}

function leave(): void {
  hovering.value = false;
  clearTimeout(timer);
  hidePreview();
}

/** 移动端长按预览 */
let pressTimer = 0;
function touchStart(): void {
  pressTimer = window.setTimeout(() => root.value && showPreview(root.value, props.url, props.name), 420);
}
function touchEnd(): void {
  clearTimeout(pressTimer);
  hidePreview();
}

onBeforeUnmount(leave);
</script>

<template>
  <div
    ref="root"
    class="nsh-thumb"
    :class="{ playing: hovering || !frozen, failed }"
    :style="{ width: size + 'px', height: size + 'px' }"
    @mouseenter="enter"
    @mouseleave="leave"
    @touchstart.passive="touchStart"
    @touchend="touchEnd"
    @touchcancel="touchEnd"
  >
    <img :src="url" :alt="name" loading="lazy" referrerpolicy="no-referrer" draggable="false" @load="onLoad" @error="failed = true" />
    <canvas v-show="frozen && !hovering" ref="canvas" />
    <span v-if="isGif && frozen && !hovering" class="nsh-gif-badge">GIF</span>
    <span v-if="failed" class="nsh-thumb-fail">加载失败</span>
    <slot />
  </div>
</template>

<style>
.nsh-thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  overflow: hidden;
  flex: none;
}
.nsh-thumb img,
.nsh-thumb canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.nsh-thumb canvas {
  position: absolute;
  inset: 0;
  margin: auto;
}
.nsh-thumb:not(.playing) img {
  opacity: 0;
}
.nsh-gif-badge {
  position: absolute;
  right: 3px;
  bottom: 3px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  line-height: 14px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.nsh-thumb-fail {
  position: absolute;
  font-size: 11px;
  color: var(--nsh-text-faint);
}
.nsh-thumb.failed img {
  display: none;
}
</style>
