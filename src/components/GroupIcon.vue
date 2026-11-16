<script setup lang="ts">
import type { StickerGroup } from '../core/store';

defineProps<{ group: StickerGroup }>();
</script>

<template>
  <span v-if="group.icon && group.icon.startsWith('<svg')" class="nsh-icon" v-html="group.icon" />
  <span v-else-if="group.icon && /^(https?:|data:image\/)/.test(group.icon)" class="nsh-icon"><img :src="group.icon" alt="" referrerpolicy="no-referrer" class="nsh-icon-img" /></span>
  <span v-else-if="group.icon" class="nsh-icon">{{ group.icon }}</span>
</template>

<style>
.nsh-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
