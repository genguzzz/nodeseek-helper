<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { closePicker, ui } from '../core/ui';
import StickerPicker from './StickerPicker.vue';

const WIDTH = 480;
const GAP = 6;
const pos = ref({ left: 0, top: 0, up: false });
const root = ref<HTMLElement>();
let raf = 0;

/** 跟随锚点按钮定位：默认在按钮下方，空间不足时翻到上方 */
function place(): void {
  const a = ui.picker?.anchor;
  if (!a || !a.isConnected) return closePicker();
  const r = a.getBoundingClientRect();
  const h = root.value?.offsetHeight ?? 340;
  const left = Math.max(8, Math.min(r.left - 12, window.innerWidth - WIDTH - 8));
  const up = r.bottom + GAP + h > window.innerHeight && r.top - GAP - h > 0;
  pos.value = { left, top: up ? r.top - GAP - h : r.bottom + GAP, up };
}

function schedule(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(place);
}

function onDown(e: MouseEvent): void {
  const t = e.target as Node;
  if (!ui.picker || root.value?.contains(t) || ui.picker.anchor.contains(t)) return;
  // 点到管理面板 / 预览等插件自身浮层时不关闭
  if ((t as Element).closest?.('.nsh-mask')) return;
  closePicker();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.picker) closePicker();
}

/** 插入后默认收起；按住 Shift 点击可连续插入多个 */
function onInsert(text: string, keepOpen: boolean): void {
  ui.picker?.insert(text);
  if (!keepOpen) closePicker();
}

watch(
  () => ui.picker?.anchor,
  (a, old) => {
    old?.classList.remove('nsh-active');
    a?.classList.add('nsh-active');
    if (a) requestAnimationFrame(place);
  },
);

onMounted(() => {
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', schedule, true);
  window.removeEventListener('resize', schedule);
  document.removeEventListener('mousedown', onDown, true);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Transition name="nsh-pop">
    <div
      v-if="ui.picker"
      ref="root"
      class="nsh-picker-pop"
      :class="{ up: pos.up }"
      :style="{ left: pos.left + 'px', top: pos.top + 'px', width: WIDTH + 'px' }"
    >
      <StickerPicker @insert="onInsert" />
    </div>
  </Transition>
</template>

<style>
.nsh-picker-pop {
  position: fixed;
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
</style>
