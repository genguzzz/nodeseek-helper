<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { acquireSlot, loadedUrls, releaseSlot, RETRY_DELAYS } from '../core/image-queue';
import { settings } from '../core/store';
import { hidePreview, isAnimatedUrl, showPreview } from '../core/ui';

const props = withDefaults(defineProps<{ url: string; name?: string; size?: number; preview?: boolean; video?: string }>(), {
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

/* ---------- 进入可视区后排队加载，失败退避重试（应对图床 429 限流） ---------- */
const src = ref('');
let attempt = 0;
let holding = false;
let io: IntersectionObserver | null = null;
let retryTimer = 0;

async function startLoad(): Promise<void> {
  if (src.value) return;
  if (loadedUrls.has(props.url)) {
    src.value = props.url;
    return;
  }
  await acquireSlot();
  holding = true;
  failed.value = false;
  // 重试时加参数绕过浏览器对失败请求的短暂缓存
  src.value = attempt ? `${props.url}${props.url.includes('?') ? '&' : '?'}r=${attempt}` : props.url;
}

function settle(): void {
  if (holding) {
    holding = false;
    releaseSlot();
  }
}

function onImgLoad(e: Event): void {
  loadedUrls.add(props.url);
  settle();
  onLoad(e);
}

function onImgError(): void {
  settle();
  if (attempt < RETRY_DELAYS.length) {
    const delay = RETRY_DELAYS[attempt++] * (0.8 + Math.random() * 0.4);
    src.value = '';
    retryTimer = window.setTimeout(() => void startLoad(), delay);
    return;
  }
  failed.value = true;
}

/** 点击「加载失败」可手动重试 */
function manualRetry(): void {
  attempt = 0;
  src.value = '';
  void startLoad();
}

onMounted(() => {
  if (!root.value) return;
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        io?.disconnect();
        void startLoad();
      }
    },
    { rootMargin: '120px' },
  );
  io.observe(root.value);
});

watch(
  () => props.url,
  () => {
    attempt = 0;
    src.value = '';
    frozen.value = false;
    void startLoad();
  },
);

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
  timer = window.setTimeout(() => root.value && showPreview(root.value, props.url, props.name, props.video), 260);
}

function leave(): void {
  hovering.value = false;
  clearTimeout(timer);
  hidePreview();
}

/** 移动端长按预览：长按出预览后松手不触发点击；滑动列表时取消长按 */
let pressTimer = 0;
let pressed = false;
function touchStart(): void {
  pressed = false;
  pressTimer = window.setTimeout(() => {
    if (!root.value) return;
    pressed = true;
    showPreview(root.value, props.url, props.name, props.video);
  }, 420);
}
function touchMove(): void {
  clearTimeout(pressTimer);
}
function touchEnd(e: TouchEvent): void {
  clearTimeout(pressTimer);
  hidePreview();
  if (pressed) {
    e.preventDefault();
    pressed = false;
  }
}

onBeforeUnmount(() => {
  leave();
  io?.disconnect();
  clearTimeout(retryTimer);
  settle();
});
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
    @touchmove.passive="touchMove"
    @touchend="touchEnd"
    @touchcancel="touchEnd"
    @contextmenu.prevent
  >
    <img v-if="src" :src="src" :alt="name" referrerpolicy="no-referrer" draggable="false" @load="onImgLoad" @error="onImgError" />
    <canvas v-show="frozen && !hovering" ref="canvas" />
    <span v-if="isGif && frozen && !hovering" class="nsh-gif-badge">GIF</span>
    <span v-if="failed" class="nsh-thumb-fail" title="点击重试" @click.stop="manualRetry">加载失败</span>
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
  cursor: pointer;
  position: absolute;
  font-size: 11px;
  color: var(--nsh-text-faint);
}
.nsh-thumb.failed img {
  display: none;
}
</style>
