<script setup lang="ts">
import { computed } from 'vue';
import { ui } from '../core/ui';

const SIZE = 240;
const GAP = 10;

const style = computed(() => {
  const p = ui.preview;
  if (!p) return {};
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = (p.rect.left + p.rect.right) / 2;
  let left = Math.min(Math.max(8, cx - SIZE / 2 - 12), vw - SIZE - 32);
  // 优先显示在上方，空间不够时放到下方
  const above = p.rect.top > SIZE + 60;
  const top = above ? p.rect.top - GAP : Math.min(p.rect.bottom + GAP, vh - SIZE - 40);
  left = Math.max(8, left);
  return { left: left + 'px', top: top + 'px', transform: above ? 'translateY(-100%)' : 'none' };
});
</script>

<template>
  <Transition name="nsh-pop">
    <div v-if="ui.preview" class="nsh-preview" :style="style">
      <video v-if="ui.preview.video" :src="ui.preview.video" :poster="ui.preview.url" autoplay loop muted playsinline />
      <img v-else :src="ui.preview.url" :alt="ui.preview.name" referrerpolicy="no-referrer" />
      <div v-if="ui.preview.name" class="nsh-preview-name">{{ ui.preview.name }}</div>
    </div>
  </Transition>
</template>

<style>
.nsh-preview {
  position: fixed;
  z-index: 100000;
  padding: 10px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg);
  border: 1px solid var(--nsh-border);
  box-shadow: var(--nsh-shadow);
  pointer-events: none;
  text-align: center;
}
.nsh-preview video {
  display: block;
  width: 160px;
  height: 160px;
  margin: 0 auto;
}
.nsh-preview img {
  display: block;
  max-width: 240px;
  max-height: 240px;
  min-width: 80px;
  margin: 0 auto;
  object-fit: contain;
}
.nsh-preview-name {
  margin-top: 6px;
  max-width: 240px;
  font-size: 12px;
  color: var(--nsh-text-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nsh-pop-enter-active,
.nsh-pop-leave-active {
  transition: opacity 0.15s ease, margin 0.15s ease;
}
.nsh-pop-enter-from,
.nsh-pop-leave-to {
  opacity: 0;
  margin-top: 4px;
}
</style>
