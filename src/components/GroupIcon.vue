<script setup lang="ts">
import type { StickerGroup } from '../core/store';

/** fallback：没有设置图标时显示默认文件夹图标（管理面板侧栏用，保证名称对齐） */
defineProps<{ group: StickerGroup; fallback?: boolean }>();
</script>

<template>
  <span v-if="group.icon && group.icon.startsWith('<svg')" class="nsh-icon" v-html="group.icon" />
  <span v-else-if="group.icon && /^(https?:|data:image\/)/.test(group.icon)" class="nsh-icon"><img :src="group.icon" alt="" referrerpolicy="no-referrer" class="nsh-icon-img" /></span>
  <span v-else-if="group.icon" class="nsh-icon">{{ group.icon }}</span>
  <span v-else-if="fallback" class="nsh-icon nsh-icon-fallback">
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.4l2 2.2h8.6A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /></svg>
  </span>
</template>

<style>
.nsh-icon-fallback {
  color: var(--nsh-text-sub);
}
.nsh-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
