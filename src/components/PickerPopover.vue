<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { closePicker, ui } from '../core/ui';
import StickerPicker from './StickerPicker.vue';

/**
 * 表情面板容器
 * - 桌面：绝对定位在文档坐标系里（不是 fixed），页面滚动时由浏览器原生带着走，无需监听滚动；
 *   只有编辑器位于内部滚动容器里时，才在该容器滚动时校正一次位置。
 * - 手机（窄屏或触摸设备）：底部抽屉（bottom sheet），带遮罩与拖拽手柄，下拉关闭，内部原生惯性滚动。
 */
const WIDTH = 480;
const GAP = 6;
const CLOSE_DRAG = 90;

const mq = window.matchMedia('(max-width: 720px), (pointer: coarse) and (max-width: 1024px)');
const mobile = ref(mq.matches);
const onMq = (e: MediaQueryListEvent): void => {
  mobile.value = e.matches;
};

const pos = ref({ left: 0, top: 0 });
const root = ref<HTMLElement>();
const dragY = ref(0);
let dragStart: number | null = null;
let scroller: HTMLElement | null = null;

const open = computed(() => !!ui.picker);

/** 找到锚点所在的内部滚动容器（页面级滚动不算） */
function scrollParent(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** 计算一次文档坐标位置：默认在按钮下方，视口下方放不下时翻到上方 */
function place(): void {
  const a = ui.picker?.anchor;
  if (!a || !a.isConnected) return closePicker();
  if (mobile.value) return;
  const r = a.getBoundingClientRect();
  const h = root.value?.offsetHeight ?? 340;
  const left = Math.max(8, Math.min(r.left - 12, document.documentElement.clientWidth - WIDTH - 8));
  const up = r.bottom + GAP + h > window.innerHeight && r.top - GAP - h > 0;
  const top = (up ? r.top - GAP - h : r.bottom + GAP) + window.scrollY;
  pos.value = { left: left + window.scrollX, top };
}

function onInnerScroll(): void {
  requestAnimationFrame(place);
}

function bindScroller(): void {
  scroller?.removeEventListener('scroll', onInnerScroll);
  scroller = ui.picker && !mobile.value ? scrollParent(ui.picker.anchor) : null;
  scroller?.addEventListener('scroll', onInnerScroll, { passive: true });
}

function onDown(e: Event): void {
  const t = e.target as Node;
  if (!ui.picker || root.value?.contains(t) || ui.picker.anchor.contains(t)) return;
  // 点到管理面板 / 预览等插件自身浮层时不关闭；手机端由遮罩处理
  if ((t as Element).closest?.('.nsh-mask, .nsh-sheet-mask')) return;
  if (!mobile.value) closePicker();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.picker) closePicker();
}

/** 插入后默认收起；按住 Shift 点击可连续插入多个 */
function onInsert(text: string, keepOpen: boolean): void {
  ui.picker?.insert(text);
  if (!keepOpen) closePicker();
}

/* ---------- 手机抽屉：拖拽手柄下拉关闭 ---------- */
function dragBegin(e: TouchEvent): void {
  dragStart = e.touches[0].clientY;
}
function dragMove(e: TouchEvent): void {
  if (dragStart == null) return;
  dragY.value = Math.max(0, e.touches[0].clientY - dragStart);
}
function dragEnd(): void {
  if (dragY.value > CLOSE_DRAG) closePicker();
  dragY.value = 0;
  dragStart = null;
}

watch(
  () => ui.picker?.anchor,
  (a, old) => {
    old?.classList.remove('nsh-active');
    a?.classList.add('nsh-active');
    bindScroller();
    if (a) requestAnimationFrame(place);
  },
);

/** 手机抽屉打开时锁定页面滚动，避免滑动穿透 */
watch(
  () => open.value && mobile.value,
  (lock) => document.documentElement.classList.toggle('nsh-sheet-lock', lock),
);

onMounted(() => {
  mq.addEventListener('change', onMq);
  window.addEventListener('resize', place);
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('touchstart', onDown, { capture: true, passive: true });
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  mq.removeEventListener('change', onMq);
  window.removeEventListener('resize', place);
  document.removeEventListener('mousedown', onDown, true);
  document.removeEventListener('touchstart', onDown, true);
  document.removeEventListener('keydown', onKey);
  scroller?.removeEventListener('scroll', onInnerScroll);
});
</script>

<template>
  <!-- 手机：底部抽屉 -->
  <template v-if="mobile">
    <Transition name="nsh-sheet-fade" :duration="260">
      <div v-if="open" class="nsh-sheet-mask nsh-scope" @click="closePicker()" @touchmove.prevent />
    </Transition>
    <Transition name="nsh-sheet" :duration="300">
      <div
        v-if="open"
        ref="root"
        class="nsh-sheet nsh-scope"
        :style="dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined"
      >
        <div class="nsh-sheet-handle" @touchstart.passive="dragBegin" @touchmove.passive="dragMove" @touchend="dragEnd" @touchcancel="dragEnd">
          <span />
        </div>
        <StickerPicker @insert="onInsert" />
      </div>
    </Transition>
  </template>
  <!-- 桌面：跟随文档滚动的弹出面板 -->
  <Transition v-else name="nsh-pop">
    <div v-if="open" ref="root" class="nsh-picker-pop" :style="{ left: pos.left + 'px', top: pos.top + 'px', width: WIDTH + 'px' }">
      <StickerPicker @insert="onInsert" />
    </div>
  </Transition>
</template>

<style>
.nsh-picker-pop {
  position: absolute;
  z-index: 99990;
  max-width: calc(100vw - 16px);
  border-radius: var(--nsh-radius);
  border: 1px solid var(--nsh-border);
  background: var(--nsh-bg);
  box-shadow: var(--nsh-shadow);
  overflow: hidden;
}
.nsh-picker-pop .nsh-picker {
  border-bottom: none;
  background: var(--nsh-bg);
}

/* ---------- 手机底部抽屉 ---------- */
html.nsh-sheet-lock,
html.nsh-sheet-lock body {
  overflow: hidden !important;
}
.nsh-sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 99989;
  background: rgba(0, 0, 0, 0.32);
}
.nsh-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99990;
  max-height: 62dvh;
  display: flex;
  flex-direction: column;
  border-radius: 14px 14px 0 0;
  background: var(--nsh-bg);
  box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.18);
  padding-bottom: env(safe-area-inset-bottom);
  transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform;
}
.nsh-sheet-handle {
  flex: none;
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  touch-action: none;
}
.nsh-sheet-handle span {
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--nsh-text-faint);
}
.nsh-sheet .nsh-picker {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-bottom: none;
  background: var(--nsh-bg);
}
/* 抽屉里分组独占第一行，搜索与管理换到第二行，避免挤占分组 */
.nsh-sheet .nsh-picker-bar {
  flex-wrap: wrap;
  row-gap: 0;
  padding: 0 10px 6px;
}
.nsh-sheet .nsh-picker-tabs {
  flex: 1 1 100%;
}
.nsh-sheet .nsh-picker-tools {
  flex: 1 1 100%;
}
.nsh-sheet .nsh-picker-search {
  flex: 1;
  width: auto;
  height: 32px;
  font-size: 14px;
}
.nsh-sheet .nsh-ptab {
  height: 34px;
  font-size: 14px;
}
.nsh-sheet .nsh-picker-grid {
  flex: 1;
  min-height: 0;
  max-height: none;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  -webkit-overflow-scrolling: touch;
}
.nsh-sheet-enter-from,
.nsh-sheet-leave-to {
  transform: translateY(100%);
}
.nsh-sheet-fade-enter-active,
.nsh-sheet-fade-leave-active {
  transition: opacity 0.25s;
}
.nsh-sheet-fade-enter-from,
.nsh-sheet-fade-leave-to {
  opacity: 0;
}
</style>
