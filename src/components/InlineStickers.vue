<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { stickerData, type Sticker } from '../core/store';
import { openPanel } from '../core/ui';
import { isFav, searchStickers, stickersOfTab, textForSticker, toggleFav } from '../core/sticker-lists';
import StickerThumb from './StickerThumb.vue';

/**
 * 并入编辑器底部原生表情栏（.expression）的助手表情：
 * - 分组标签（收藏 / 最近 / 自定义分组）通过 Teleport 放进原生栏，复用原生 .exp-item 样式；
 * - 搜索 / 管理放在原生栏最右侧；
 * - 表情网格渲染在原生 .exp-container 下方，与原生分组互斥展开（点我们的分组会收起原生的，反之亦然）。
 */
const props = defineProps<{
  bar: HTMLElement;
  tabsHost: HTMLElement;
  toolsHost: HTMLElement;
  insert: (text: string) => void;
}>();

/** 原生 Vue scoped 属性（data-v-xxx），让我们的标签与原生标签同款样式 */
const scope = computed<Record<string, string>>(() => {
  const ref = props.bar.querySelector('.exp-item:not(.nsh-exp-item)');
  const o: Record<string, string> = {};
  if (ref) for (const a of Array.from(ref.attributes)) if (a.name.startsWith('data-v-')) o[a.name] = '';
  return o;
});

const active = ref<string | null>(null);
const keyword = ref('');
const searchEl = ref<HTMLInputElement>();

const groups = computed(() => stickerData.groups);
/** 被删除的分组自动收起 */
watch(groups, (gs) => {
  const t = active.value;
  if (t && t !== 'fav' && t !== 'recent' && t !== 'search' && !gs.some((g) => g.id === t)) active.value = null;
});

const list = computed<Sticker[]>(() => {
  if (!active.value) return [];
  if (active.value === 'search') return searchStickers(keyword.value);
  return stickersOfTab(active.value);
});

/** 收起原生正在展开的分组（原生再次点击当前分组即收起） */
function closeNative(): void {
  props.bar.querySelector<HTMLElement>('.exp-item.current-group:not(.nsh-exp-item)')?.click();
}

function toggle(tab: string): void {
  if (active.value === tab) {
    active.value = null;
    return;
  }
  closeNative();
  active.value = tab;
  if (tab === 'search') nextTick(() => searchEl.value?.focus());
}

function pick(s: Sticker): void {
  props.insert(textForSticker(s));
}

/** 用户点了原生分组：收起我们的面板 */
function onBarClick(e: Event): void {
  const item = (e.target as Element).closest?.('.exp-item');
  if (item && !item.classList.contains('nsh-exp-item')) active.value = null;
}

/** 原生栏放不下时：鼠标纵向滚轮转为横向滚动 */
function onBarWheel(e: WheelEvent): void {
  const el = props.bar;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
  e.preventDefault();
  el.scrollLeft += e.deltaY;
}

onMounted(() => {
  props.bar.addEventListener('click', onBarClick);
  props.bar.addEventListener('wheel', onBarWheel, { passive: false });
});
onBeforeUnmount(() => {
  props.bar.removeEventListener('click', onBarClick);
  props.bar.removeEventListener('wheel', onBarWheel);
});

const emptyText = computed(() => {
  if (active.value === 'search') return keyword.value.trim() ? `没有匹配「${keyword.value.trim()}」的表情` : '输入名称、链接或官方转义码搜索（含官方表情）';
  if (active.value === 'fav') return '还没有收藏，悬浮表情点右上角 ★ 即可收藏';
  if (active.value === 'recent') return '最近没有使用过表情';
  return '';
});
</script>

<template>
  <Teleport :to="tabsHost">
    <div v-bind="scope" class="exp-item nsh-exp-item" :class="{ 'current-group': active === 'fav' }" title="收藏的表情（含官方）" @click="toggle('fav')">收藏</div>
    <div v-bind="scope" class="exp-item nsh-exp-item" :class="{ 'current-group': active === 'recent' }" title="最近使用" @click="toggle('recent')">最近</div>
    <div
      v-for="g in groups"
      :key="g.id"
      v-bind="scope"
      class="exp-item nsh-exp-item"
      :class="{ 'current-group': active === g.id }"
      :title="`${g.name}（NodeSeek 助手）`"
      @click="toggle(g.id)"
    >
      {{ g.name }}
    </div>
  </Teleport>
  <Teleport :to="toolsHost">
    <div v-bind="scope" class="exp-item nsh-exp-item nsh-exp-tool" :class="{ 'current-group': active === 'search' }" title="搜索表情" @click="toggle('search')">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    </div>
    <div v-bind="scope" class="exp-item nsh-exp-item nsh-exp-tool" title="表情设置（NodeSeek 助手）" @click="openPanel('stickers')">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
    </div>
  </Teleport>

  <div class="nsh-exp-panel" :class="{ open: !!active }">
    <template v-if="active">
      <div v-if="active === 'search'" class="nsh-exp-search">
        <input ref="searchEl" v-model="keyword" class="nsh-input" placeholder="搜索表情（名称 / 链接 / 转义码）" @keydown.esc="toggle('search')" />
      </div>
      <div class="nsh-exp-grid">
        <div v-for="s in list" :key="s.id" class="nsh-picker-cell" @click="pick(s)">
          <StickerThumb :url="s.url" :name="s.code || s.name" :size="64" :video="s.video" />
          <button class="nsh-fav-dot" :class="{ on: isFav(s) }" :title="isFav(s) ? '取消收藏' : '收藏'" @click.stop="toggleFav(s)">★</button>
        </div>
        <div v-if="!list.length" class="nsh-empty">
          <template v-if="emptyText">{{ emptyText }}</template>
          <template v-else>
            这个分组还是空的，
            <a href="javascript:void(0)" @click="openPanel('stickers')">去批量导入</a>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style>
/* 原生表情栏：放不下时横向滚动（隐藏滚动条），标签不换行 */
:is(.md-editor, .message-input) .expression.nsh-exp-bar {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
:is(.md-editor, .message-input) .expression.nsh-exp-bar::-webkit-scrollbar {
  display: none;
}
.expression.nsh-exp-bar > .exp-item,
.nsh-exp-tabs > .exp-item,
.nsh-exp-tools > .exp-item {
  flex: none;
  white-space: nowrap;
}
.nsh-exp-tabs,
.nsh-exp-tools {
  display: contents;
}
/* 助手分组在前，与原生 App 分组一样用一条竖线和官方分组隔开 */
.expression .nsh-exp-tabs > .exp-item:last-child {
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  padding-right: 9px;
  margin-right: 4px;
}
.dark-layout .expression .nsh-exp-tabs > .exp-item:last-child {
  border-right-color: rgba(255, 255, 255, 0.12);
}
.expression .nsh-exp-tool {
  display: inline-flex;
  align-items: center;
  opacity: 0.7;
}
.expression .nsh-exp-tool:hover,
.expression .nsh-exp-tool.current-group {
  opacity: 1;
}
/* 工具按钮靠右；原生栏横向滚动时仍固定在右侧（背景与原生栏一致，遮住滚到下面的标签） */
.expression .nsh-exp-tool {
  position: sticky;
  right: 0;
  background-color: rgb(248, 248, 248);
}
.expression .nsh-exp-tool:first-child {
  margin-left: auto;
  right: 25px;
}
.dark-layout .expression .nsh-exp-tool {
  background-color: rgb(81, 81, 81);
}

/* 表情网格：与原生 .exp-container.open 同款尺寸与留白 */
.nsh-exp-panel {
  display: none;
}
.nsh-exp-panel.open {
  display: block;
}
.nsh-exp-search {
  padding: 10px 10px 0;
}
.nsh-exp-search .nsh-input {
  width: 100%;
  height: 28px;
  font-size: 13px;
}
.nsh-exp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 4px;
  padding: 10px;
  max-height: 280px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.nsh-exp-grid .nsh-empty {
  grid-column: 1 / -1;
}
.nsh-exp-grid .nsh-empty a {
  color: var(--nsh-accent);
}
@media (max-width: 720px) {
  .nsh-exp-grid {
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    max-height: min(280px, 42dvh);
  }
}
</style>
