<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { settings, stickerData, type Sticker } from '../core/store';
import { official } from '../core/official';
import { openPanel, ui, closePicker } from '../core/ui';
import { favList, isFav, searchStickers, stickersOfTab, textForSticker, toggleFav } from '../core/sticker-lists';
import StickerThumb from './StickerThumb.vue';
import GroupIcon from './GroupIcon.vue';

const emit = defineEmits<{ insert: [text: string, keepOpen: boolean] }>();

type Tab = 'fav' | 'recent' | 'app' | string;

/** 当前编辑器是否有原生 App 功能（投票 / 星尘） */
const appItems = computed(() => {
  const ed = ui.picker?.editor;
  if (!ed?.querySelector('.exp-item.sticker-group-app')) return [];
  return [
    { key: 'vote', label: '投票', icon: '/static/image/sticker/app/vote.png' },
    { key: 'stardust', label: '星尘', icon: '/static/image/sticker/app/stardust.png' },
  ];
});

/** 分组是否仍然存在（设置里记的分组可能已被删除） */
function isValidTab(t: string): boolean {
  if (t === 'fav' || t === 'recent') return true;
  if (t.startsWith('ns:')) return official.groups.some((g) => `ns:${g.group}` === t);
  return stickerData.groups.some((g) => g.id === t);
}

/** 按「默认打开」设置决定初始分组；找不到时回退到自动规则 */
function initialTab(): Tab {
  const pref = settings.pickerDefaultTab;
  const wanted = pref === 'last' ? settings.pickerLastTab : pref;
  if (wanted && wanted !== 'auto' && isValidTab(wanted)) return wanted as Tab;
  if (favList.value.length) return 'fav';
  return stickerData.groups.find((g) => stickerData.stickers.some((s) => s.groupId === g.id))?.id ?? `ns:${official.groups[0]?.group ?? 'ac'}`;
}

const tab = ref<Tab>(initialTab());
const keyword = ref('');

const list = computed<Sticker[]>(() => (keyword.value.trim() ? searchStickers(keyword.value) : stickersOfTab(tab.value)));

/* 分组条：横向滚动 + 两端渐隐（有内容被遮住的一侧才显示蒙版） */
const tabsEl = ref<HTMLElement>();
const fade = reactive({ left: false, right: false });

function updateFade(): void {
  const el = tabsEl.value;
  if (!el) return;
  fade.left = el.scrollLeft > 2;
  fade.right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
}

/** 鼠标纵向滚轮在分组条上转为横向滚动 */
function onTabsWheel(e: WheelEvent): void {
  const el = tabsEl.value;
  if (!el || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
  e.preventDefault();
  el.scrollLeft += e.deltaY;
}

/** 切换分组时把当前标签滚入可视区 */
watch(tab, (t) => {
  if (t !== 'app') settings.pickerLastTab = t;
});
watch(tab, () =>
  nextTick(() => {
    tabsEl.value?.querySelector('.nsh-ptab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateFade();
  }),
);
onMounted(() => nextTick(updateFade));

function pick(s: Sticker, e: MouseEvent): void {
  emit('insert', textForSticker(s), e.shiftKey);
}

/** 触发原生 App 功能：打开原生 App 分组并点击对应项（原生表情栏隐藏时同样有效） */
function runApp(key: string): void {
  const ed = ui.picker?.editor;
  const tabEl = ed?.querySelector<HTMLElement>('.exp-item.sticker-group-app');
  if (!ed || !tabEl) return;
  closePicker();
  if (!tabEl.classList.contains('current-group')) tabEl.click();
  requestAnimationFrame(() => ed.querySelector<HTMLElement>(`.exp-container img[alt="app${key}"]`)?.click());
}
</script>

<template>
  <div class="nsh-picker">
    <div class="nsh-picker-bar">
      <div
        ref="tabsEl"
        class="nsh-picker-tabs"
        :class="{ 'fade-l': fade.left, 'fade-r': fade.right }"
        @scroll="updateFade"
        @wheel="onTabsWheel"
      >
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
      <span class="nsh-picker-sep" />
      <button
        v-for="g in official.groups"
        :key="g.group"
        class="nsh-ptab"
        :class="{ active: tab === 'ns:' + g.group && !keyword }"
        :title="`NodeSeek 官方表情 · ${g.name}`"
        @click="(tab = 'ns:' + g.group), (keyword = '')"
      >
        {{ g.name }}
      </button>
      <button v-if="appItems.length" class="nsh-ptab" :class="{ active: tab === 'app' && !keyword }" @click="(tab = 'app'), (keyword = '')">App</button>
      </div>
      <div class="nsh-picker-tools">
        <input v-model="keyword" class="nsh-input nsh-picker-search" placeholder="搜索表情" />
        <a href="javascript:void(0)" class="nsh-picker-manage" title="管理表情包" @click="openPanel('stickers')">管理</a>
      </div>
    </div>
    <div v-if="tab === 'app' && !keyword" class="nsh-picker-grid nsh-scroll nsh-app-grid">
      <div v-for="a in appItems" :key="a.key" class="nsh-picker-cell nsh-app-cell" @click="runApp(a.key)">
        <img :src="a.icon" :alt="a.label" />
        <span>{{ a.label }}</span>
      </div>
    </div>
    <div v-else class="nsh-picker-grid nsh-scroll">
      <div
        v-for="s in list"
        :key="s.id"
        class="nsh-picker-cell"
        @click="pick(s, $event)"
      >
        <StickerThumb :url="s.url" :name="s.code || s.name" :size="64" :video="s.video" />
        <button class="nsh-fav-dot" :class="{ on: isFav(s) }" :title="isFav(s) ? '取消收藏' : '收藏'" @click.stop="toggleFav(s)">★</button>
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
.nsh-app-grid {
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
}
.nsh-app-cell {
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.nsh-app-cell img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

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
  gap: 8px;
  padding: 0 8px;
  border-bottom: 1px solid var(--nsh-border);
}
/* 分组标签横向滚动；底部细滚动条；被遮住的一侧渐隐，避免文字被生硬截断 */
.nsh-picker-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  /* 滚动条隐藏：滚轮 / 触控板横向滚动，被遮住的一侧有渐隐提示 */
  padding: 4px 0;
  scrollbar-width: none;
  --fade-l: 0px;
  --fade-r: 0px;
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent 100%);
  mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent 100%);
}
.nsh-picker-tabs.fade-l {
  --fade-l: 18px;
}
.nsh-picker-tabs.fade-r {
  --fade-r: 28px;
}
.nsh-picker-tabs::-webkit-scrollbar {
  display: none;
}
.nsh-picker-sep {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--nsh-border);
  flex: none;
}
.nsh-picker-tools {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
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
/* 触摸设备没有悬浮态：收藏星标常显（未收藏的淡一些） */
@media (hover: none) {
  .nsh-fav-dot {
    opacity: 0.55;
  }
  .nsh-fav-dot.on {
    opacity: 1;
  }
  .nsh-picker-cell:hover {
    outline: none;
  }
}
@media (max-width: 720px) {
  .nsh-picker-search {
    width: 92px;
  }
  .nsh-picker-bar {
    padding: 0 6px;
  }
  .nsh-ptab {
    padding: 0 7px;
  }
}
</style>
