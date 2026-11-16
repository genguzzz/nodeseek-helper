<script setup lang="ts">
import type { StickerGroup } from '../core/store';

defineProps<{ group: StickerGroup }>();
</script>

<template>
  <span v-if="group.icon && group.icon.startsWith('<svg')" class="nsh-icon" v-html="group.icon" />
  <span v-else-if="group.icon" class="nsh-icon">{{ group.icon }}</span>
</template>
