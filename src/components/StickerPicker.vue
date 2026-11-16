<script setup lang="ts">
import { computed, ref } from 'vue';
import { renderTemplate, settings, stickerData, useSticker, type Sticker } from '../core/store';
import { openPanel, hidePreview } from '../core/ui';
import StickerThumb from './StickerThumb.vue';
import GroupIcon from './GroupIcon.vue';

const emit = defineEmits<{ insert: [text: string, keepOpen: boolean] }>();

const RECENT_LIMIT = 24;
type Tab = 'fav' | 'recent' | string;

const hasFav = computed(() => stickerData.stickers.some((s) => s.favorite));
const tab = ref<Tab>(hasFav.value ? 'fav' : stickerData.groups.find((g) => stickerData.stickers.some((s) => s.groupId === g.id))?.id ?? 'recent');
const keyword = ref('');

const countOf = (gid: string): number => stickerData.stickers.filter((s) => s.groupId === gid).length;

const list = computed<Sticker[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (kw) return stickerData.stickers.filter((s) => s.name.toLowerCase().includes(kw) || s.url.toLowerCase().includes(kw));
  if (tab.value === 'fav') return stickerData.stickers.filter((s) => s.favorite);
  if (tab.value === 'recent')
    return stickerData.stickers
      .filter((s) => s.lastUsedAt > 0)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, RECENT_LIMIT);
  return stickerData.stickers.filter((s) => s.groupId === tab.value);
});

function pick(s: Sticker, e: MouseEvent): void {
  hidePreview();
  useSticker(s);
  emit('insert', ' ' + renderTemplate(settings.stickerTemplate, { url: s.url, name: s.name }) + ' ', e.shiftKey);
}

function toggleFav(s: Sticker): void {
  s.favorite = !s.favorite;
}
</script>

<template>
  <div class="nsh-picker">
    <div class="nsh-picker-bar nsh-scroll">
      <button class="nsh-ptab" :class="{ active: tab === 'fav' && !keyword }" @click="(tab = 'fav'), (keyword = '')">
        收藏
      </button>
      <button class="nsh-ptab" :class="{ active: tab === 'recent' && !keyword }" @click="(tab = 'recent'), (keyword = '')">
        最近
      </button>
      <span class="nsh-picker-sep" />
      <button
        v-for="g in stickerData.groups"
        :key="g.id"
        class="nsh-ptab"
        :class="{ active: tab === g.id && !keyword }"
        :title="g.name"
        @click="(tab = g.id), (keyword = '')"
      >
        <GroupIcon :group="g" />{{ g.name }}
      </button>
      <div class="nsh-picker-tools">
        <input v-model="keyword" class="nsh-input nsh-picker-search" placeholder="搜索表情" />
        <a href="javascript:void(0)" class="nsh-picker-manage" title="管理表情包" @click="openPanel('stickers')">管理</a>
      </div>
    </div>
    <div class="nsh-picker-grid nsh-scroll">
      <div
        v-for="s in list"
        :key="s.id"
        class="nsh-picker-cell"
        @click="pick(s, $event)"
      >
        <StickerThumb :url="s.url" :name="s.name" :size="64" />
        <button class="nsh-fav-dot" :class="{ on: s.favorite }" :title="s.favorite ? '取消收藏' : '收藏'" @click.stop="toggleFav(s)">★</button>
      </div>
      <div v-if="!list.length" class="nsh-empty">
        <template v-if="keyword">没有匹配「{{ keyword }}」的表情</template>
        <template v-else-if="tab === 'fav'">还没有收藏，悬浮表情点右上角 ★ 即可收藏</template>
        <template v-else-if="tab === 'recent'">最近没有使用过表情</template>
        <template v-else>
          这个分组还是空的，
          <a href="javascript:void(0)" @click="openPanel('stickers')">去批量导入</a>
        </template>
      </div>
    </div>
  </div>
</template>

<style>

/* 与站点 .tab-select .tab-option 一致：纯文字，当前项下划线 */
.nsh-ptab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--nsh-text);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.nsh-ptab:hover {
  color: var(--nsh-text-strong);
}
.nsh-ptab.active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  background: currentColor;
}
.nsh-picker-manage {
  font-size: 13px;
  color: var(--nsh-text-sub);
  text-decoration: none;
  white-space: nowrap;
}
.nsh-picker-manage:hover {
  color: var(--nsh-text-strong);
}
.nsh-picker {
  border-bottom: 1px solid var(--nsh-border);
  background: var(--nsh-bg-sub);
}
.nsh-picker-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--nsh-border);
}
.nsh-picker-sep {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--nsh-border);
  flex: none;
}
.nsh-picker-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
}
.nsh-picker-search {
  width: 120px;
  height: 22px;
  border-radius: 3px;
  font-size: 12px;
}
.nsh-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 4px;
  padding: 8px 10px 10px;
  max-height: 300px;
  overflow-y: auto;
}
.nsh-picker-cell {
  position: relative;
  display: flex;
  justify-content: center;
  padding: 4px;
  border-radius: var(--nsh-radius);
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}
.nsh-picker-cell:hover {
  outline: rgb(175, 255, 232) dashed 3px;
}
.nsh-picker-cell:active {
  transform: scale(0.95);
}
.nsh-fav-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 11px;
  line-height: 20px;
  padding: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.nsh-picker-cell:hover .nsh-fav-dot,
.nsh-fav-dot.on {
  opacity: 1;
}
.nsh-fav-dot.on {
  background: var(--nsh-star);
}
.nsh-star {
  color: var(--nsh-star);
}
.nsh-picker .nsh-empty {
  grid-column: 1 / -1;
}
.nsh-picker .nsh-empty a {
  color: var(--nsh-accent);
}
</style>
