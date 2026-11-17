<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { GM_setClipboard } from '$';
import { DEFAULT_GROUP_ID, exportStickers, seedBuiltinPacks, stickerData, uid, type Sticker, type StickerGroup } from '../core/store';
import { toast } from '../core/ui';
import StickerThumb from './StickerThumb.vue';
import GroupIcon from './GroupIcon.vue';
import ImportDialog from './ImportDialog.vue';
import GroupIconDialog from './GroupIconDialog.vue';

/** 触摸设备上关闭 HTML5 拖拽排序：iOS 上 draggable 元素长按会进入拖拽，干扰列表滑动 */
const pointerDrag: boolean = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

type View = 'all' | 'fav' | 'recent' | string;
type SortKey = 'manual' | 'used' | 'recent' | 'created' | 'name';

const view = ref<View>('all');
const keyword = ref('');
const sortKey = ref<SortKey>('manual');
const selecting = ref(false);
const selected = reactive(new Set<string>());
const importing = ref(false);
const editingName = ref<string>('');
const renamingGroup = ref<string>('');
const dragOver = ref<string>('');

const SORTERS: Record<Exclude<SortKey, 'manual'>, (a: Sticker, b: Sticker) => number> = {
  used: (a, b) => b.useCount - a.useCount,
  recent: (a, b) => b.lastUsedAt - a.lastUsedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  name: (a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
};

const list = computed<Sticker[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  let arr = stickerData.stickers.filter((s) => {
    if (view.value === 'fav' && !s.favorite) return false;
    if (view.value === 'recent' && !s.lastUsedAt) return false;
    if (!['all', 'fav', 'recent'].includes(view.value) && s.groupId !== view.value) return false;
    return !kw || s.name.toLowerCase().includes(kw) || s.url.toLowerCase().includes(kw);
  });
  const key = view.value === 'recent' && sortKey.value === 'manual' ? 'recent' : sortKey.value;
  if (key !== 'manual') arr = [...arr].sort(SORTERS[key]);
  return arr;
});

const canDrag = computed(() => sortKey.value === 'manual' && !keyword.value && !selecting.value && view.value !== 'recent');
const currentGroup = computed(() => stickerData.groups.find((g) => g.id === view.value));
const countOf = (gid: string): number => stickerData.stickers.filter((s) => s.groupId === gid).length;
const favCount = computed(() => stickerData.stickers.filter((s) => s.favorite).length);
const groupName = (gid: string): string => stickerData.groups.find((g) => g.id === gid)?.name ?? '未分组';

/* ---------- 分组 ---------- */
function addGroup(): void {
  const name = prompt('新分组名称', '新分组')?.trim();
  if (!name) return;
  const g: StickerGroup = { id: uid(), name };
  stickerData.groups.push(g);
  view.value = g.id;
}

function commitRenameGroup(g: StickerGroup, e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  if (v) g.name = v;
  renamingGroup.value = '';
}

/** 正在编辑图标的分组（面板内对话框，替代原生 prompt：后者在 iOS 上会弹出整段 SVG 代码） */
const iconGroup = ref<StickerGroup | null>(null);

/** 点分组图标：鼠标设备直接编辑图标；触屏只当作选中分组（避免误触），编辑走「图标」按钮 */
function onGroupIconClick(e: Event, g: StickerGroup): void {
  if (!pointerDrag) return;
  e.stopPropagation();
  iconGroup.value = g;
}

/** iOS 点击空白处不会让输入框失焦：在面板任意处按下时结束正在进行的重命名（失焦即保存） */
function blurInlineInput(e: Event): void {
  const a = document.activeElement as HTMLElement | null;
  if (a?.classList.contains('nsh-inline-input') && !a.contains(e.target as Node)) a.blur();
}
onMounted(() => document.addEventListener('pointerdown', blurInlineInput, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', blurInlineInput, true));

function deleteGroup(g: StickerGroup): void {
  const n = countOf(g.id);
  if (g.id === DEFAULT_GROUP_ID) return;
  if (!confirm(n ? `删除分组「${g.name}」及其中 ${n} 个表情？` : `删除分组「${g.name}」？`)) return;
  stickerData.stickers = stickerData.stickers.filter((s) => s.groupId !== g.id);
  stickerData.groups.splice(stickerData.groups.indexOf(g), 1);
  view.value = 'all';
}

function restoreBuiltin(): void {
  seedBuiltinPacks(true);
  toast('已恢复内置表情包', 'success');
}

/* ---------- 单个表情 ---------- */
function copyUrl(s: Sticker): void {
  GM_setClipboard(s.url, 'text');
  toast('已复制链接', 'success', 1500);
}

function commitRename(s: Sticker, e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  if (v) s.name = v;
  editingName.value = '';
}

function removeOne(s: Sticker): void {
  stickerData.stickers.splice(stickerData.stickers.indexOf(s), 1);
  toast(`已删除「${s.name}」`, 'info', 1500);
}

function clickCard(s: Sticker): void {
  if (!selecting.value) return;
  selected.has(s.id) ? selected.delete(s.id) : selected.add(s.id);
}

/* ---------- 批量 ---------- */
const selectedList = (): Sticker[] => stickerData.stickers.filter((s) => selected.has(s.id));

function toggleSelecting(): void {
  selecting.value = !selecting.value;
  selected.clear();
}

function selectAll(): void {
  if (selected.size === list.value.length) selected.clear();
  else list.value.forEach((s) => selected.add(s.id));
}

function bulkFav(v: boolean): void {
  selectedList().forEach((s) => (s.favorite = v));
  toast(`${v ? '已收藏' : '已取消收藏'} ${selected.size} 个`, 'success');
}

function bulkMove(e: Event): void {
  const gid = (e.target as HTMLSelectElement).value;
  (e.target as HTMLSelectElement).value = '';
  if (!gid) return;
  selectedList().forEach((s) => (s.groupId = gid));
  toast(`已移动 ${selected.size} 个到「${groupName(gid)}」`, 'success');
  selected.clear();
}

function bulkDelete(): void {
  if (!selected.size || !confirm(`删除选中的 ${selected.size} 个表情？`)) return;
  stickerData.stickers = stickerData.stickers.filter((s) => !selected.has(s.id));
  selected.clear();
}

/** 把当前视图的排序结果固化为自定义顺序 */
function applySortAsManual(): void {
  const ids = list.value.map((s) => s.id);
  const pos = stickerData.stickers.map((s, i) => (ids.includes(s.id) ? i : -1)).filter((i) => i > -1);
  const sortedItems = ids.map((id) => stickerData.stickers.find((s) => s.id === id) as Sticker);
  const next = [...stickerData.stickers];
  pos.forEach((p, i) => (next[p] = sortedItems[i]));
  stickerData.stickers = next;
  sortKey.value = 'manual';
  toast('已保存为自定义顺序', 'success');
}

/* ---------- 拖拽：表情排序 / 拖到分组 / 分组排序 ---------- */
const MIME_STICKER = 'application/x-nsh-sticker';
const MIME_GROUP = 'application/x-nsh-group';

/** 任何视图下都允许拖动（拖到左侧分组即移动）；只有自定义顺序视图才允许卡片间排序 */
function onCardDragStart(e: DragEvent, s: Sticker): void {
  e.dataTransfer?.setData(MIME_STICKER, s.id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

function onCardDrop(e: DragEvent, target: Sticker): void {
  dragOver.value = '';
  const id = e.dataTransfer?.getData(MIME_STICKER);
  if (!id || id === target.id || !canDrag.value) return;
  const arr = stickerData.stickers;
  const from = arr.findIndex((s) => s.id === id);
  const [item] = arr.splice(from, 1);
  const to = arr.findIndex((s) => s.id === target.id);
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const after = e.clientX > rect.left + rect.width / 2;
  item.groupId = target.groupId;
  arr.splice(after ? to + 1 : to, 0, item);
}

function onGroupDragStart(e: DragEvent, g: StickerGroup): void {
  e.dataTransfer?.setData(MIME_GROUP, g.id);
}

function onGroupDrop(e: DragEvent, g: StickerGroup): void {
  dragOver.value = '';
  const sid = e.dataTransfer?.getData(MIME_STICKER);
  if (sid) {
    const ids = selecting.value && selected.has(sid) ? [...selected] : [sid];
    stickerData.stickers.filter((s) => ids.includes(s.id)).forEach((s) => (s.groupId = g.id));
    toast(`已移动 ${ids.length} 个到「${g.name}」`, 'success');
    return;
  }
  const gid = e.dataTransfer?.getData(MIME_GROUP);
  if (!gid || gid === g.id) return;
  const arr = stickerData.groups;
  const [item] = arr.splice(arr.findIndex((x) => x.id === gid), 1);
  arr.splice(arr.indexOf(g), 0, item);
}

function onGroupDragOver(e: DragEvent, g: StickerGroup): void {
  const types = e.dataTransfer?.types ?? [];
  if (types.includes(MIME_STICKER) || types.includes(MIME_GROUP)) {
    e.preventDefault();
    dragOver.value = 'g:' + g.id;
  }
}

function onCardDragOver(e: DragEvent, s: Sticker): void {
  if (canDrag.value && e.dataTransfer?.types.includes(MIME_STICKER)) {
    e.preventDefault();
    dragOver.value = 's:' + s.id;
  }
}

/* ---------- 导出 ---------- */
function exportAll(): void {
  const blob = new Blob([exportStickers()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nodeseek-stickers-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function copyGroupLinks(): void {
  GM_setClipboard(list.value.map((s) => s.url).join('\n'), 'text');
  toast(`已复制 ${list.value.length} 条链接`, 'success');
}

const defaultImportGroup = computed(() => (currentGroup.value ? currentGroup.value.id : DEFAULT_GROUP_ID));
</script>

<template>
  <div class="nsh-sm">
    <!-- 左侧分组 -->
    <aside class="nsh-sm-side nsh-scroll">
      <button class="nsh-sm-nav" :class="{ active: view === 'all' }" @click="view = 'all'">
        <span class="nsh-icon">🗂</span><span class="nsh-sm-nav-name">全部</span><span class="nsh-count">{{ stickerData.stickers.length }}</span>
      </button>
      <button class="nsh-sm-nav" :class="{ active: view === 'fav' }" @click="view = 'fav'">
        <span class="nsh-icon nsh-star">★</span><span class="nsh-sm-nav-name">收藏</span><span class="nsh-count">{{ favCount }}</span>
      </button>
      <button class="nsh-sm-nav" :class="{ active: view === 'recent' }" @click="view = 'recent'">
        <span class="nsh-icon">🕘</span><span class="nsh-sm-nav-name">最近使用</span>
      </button>
      <div class="nsh-sm-side-title">
        分组<button class="nsh-btn ghost sm" title="新建分组" @click="addGroup">＋</button>
      </div>
      <div
        v-for="g in stickerData.groups"
        :key="g.id"
        class="nsh-sm-nav"
        :class="{ active: view === g.id, 'drop-hint': dragOver === 'g:' + g.id }"
        :draggable="pointerDrag"
        @click="view = g.id"
        @dragstart="onGroupDragStart($event, g)"
        @dragover="onGroupDragOver($event, g)"
        @dragleave="dragOver = ''"
        @drop.prevent="onGroupDrop($event, g)"
      >
        <span class="nsh-icon" :class="{ 'nsh-clickable': pointerDrag }" :title="pointerDrag ? '设置图标' : undefined" @click="onGroupIconClick($event, g)"><GroupIcon :group="g" fallback /></span>
        <input
          v-if="renamingGroup === g.id"
          class="nsh-input nsh-inline-input"
          :value="g.name"
          autofocus
          @click.stop
          @keydown.enter="commitRenameGroup(g, $event)"
          @blur="commitRenameGroup(g, $event)"
        />
        <span v-else class="nsh-sm-nav-name" @dblclick.stop="renamingGroup = g.id">{{ g.name }}</span>
        <span class="nsh-count">{{ countOf(g.id) }}</span>
        <span v-if="renamingGroup !== g.id" class="nsh-sm-nav-ops">
          <button title="设置图标" @click.stop="iconGroup = g">☺</button>
          <button title="重命名" @click.stop="renamingGroup = g.id">✎</button>
          <button v-if="g.id !== 'default'" title="删除分组" @click.stop="deleteGroup(g)">✕</button>
        </span>
      </div>
      <!-- 手机端侧栏变为横向分组条，标题行（含新建按钮）隐藏，在末尾提供新建入口 -->
      <button class="nsh-sm-nav nsh-sm-add-chip" title="新建分组" @click="addGroup">＋ 新建分组</button>
      <div class="nsh-sm-side-foot">
        <span>拖动分组可排序，把表情拖到分组上可移动</span>
        <a href="javascript:void(0)" @click="restoreBuiltin">恢复内置表情包</a>
      </div>
    </aside>

    <!-- 右侧内容 -->
    <section class="nsh-sm-main">
      <div class="nsh-sm-toolbar">
        <input v-model="keyword" class="nsh-input nsh-sm-search" placeholder="搜索名称或链接" />
        <select v-model="sortKey" class="nsh-select nsh-sm-sort" title="排序">
          <option value="manual">自定义顺序</option>
          <option value="used">最常使用</option>
          <option value="recent">最近使用</option>
          <option value="created">最新添加</option>
          <option value="name">按名称</option>
        </select>
        <button v-if="sortKey !== 'manual' && view !== 'recent'" class="nsh-btn sm" title="把当前排序结果保存为自定义顺序" @click="applySortAsManual">
          保存为自定义顺序
        </button>
        <span class="nsh-spacer" />
        <button class="nsh-btn sm" :class="{ primary: selecting }" @click="toggleSelecting">{{ selecting ? '完成' : '批量管理' }}</button>
        <button class="nsh-btn sm" @click="copyGroupLinks">复制链接</button>
        <button class="nsh-btn sm" @click="exportAll">导出备份</button>
        <button class="nsh-btn sm primary" @click="importing = true">＋ 批量导入</button>
      </div>

      <div v-if="selecting" class="nsh-sm-bulk">
        <label class="nsh-check"><input type="checkbox" :checked="list.length > 0 && selected.size === list.length" @change="selectAll" />全选</label>
        <span class="nsh-sub">已选 {{ selected.size }} 个</span>
        <span class="nsh-spacer" />
        <button class="nsh-btn sm" :disabled="!selected.size" @click="bulkFav(true)">★ 收藏</button>
        <button class="nsh-btn sm" :disabled="!selected.size" @click="bulkFav(false)">取消收藏</button>
        <select class="nsh-select nsh-sm-move" :disabled="!selected.size" @change="bulkMove">
          <option value="">移动到…</option>
          <option v-for="g in stickerData.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <button class="nsh-btn sm danger" :disabled="!selected.size" @click="bulkDelete">删除</button>
      </div>

      <div class="nsh-sm-grid nsh-scroll">
        <div
          v-for="s in list"
          :key="s.id"
          class="nsh-sm-card"
          :class="{ selected: selected.has(s.id), selecting, 'drop-hint': dragOver === 's:' + s.id }"
          :draggable="pointerDrag"
          @click="clickCard(s)"
          @dragstart="onCardDragStart($event, s)"
          @dragover="onCardDragOver($event, s)"
          @dragleave="dragOver = ''"
          @drop.prevent="onCardDrop($event, s)"
        >
          <StickerThumb :url="s.url" :name="s.name" :size="84" :preview="!selecting" />
          <input
            v-if="editingName === s.id"
            class="nsh-input nsh-inline-input"
            :value="s.name"
            autofocus
            @click.stop
            @keydown.enter="commitRename(s, $event)"
            @blur="commitRename(s, $event)"
          />
          <div v-else class="nsh-sm-name" :title="s.name + (view === 'all' || view === 'fav' ? ' · ' + groupName(s.groupId) : '')" @dblclick.stop="editingName = s.id">
            {{ s.name }}
          </div>
          <div class="nsh-sm-meta">{{ s.useCount ? `用过 ${s.useCount} 次` : '未使用' }}</div>
          <span v-if="selecting" class="nsh-sm-check">{{ selected.has(s.id) ? '✓' : '' }}</span>
          <template v-else>
            <button class="nsh-fav-dot" :class="{ on: s.favorite }" :title="s.favorite ? '取消收藏' : '收藏'" @click.stop="s.favorite = !s.favorite">★</button>
            <div class="nsh-sm-ops">
              <button title="复制链接" @click.stop="copyUrl(s)">⧉</button>
              <button title="重命名" @click.stop="editingName = s.id">✎</button>
              <button title="删除" @click.stop="removeOne(s)">✕</button>
            </div>
          </template>
        </div>
        <div v-if="!list.length" class="nsh-empty nsh-sm-empty">
          <div class="nsh-sm-empty-icon">🫥</div>
          <template v-if="keyword">没有匹配的表情</template>
          <template v-else>
            这里还没有表情，
            <a href="javascript:void(0)" @click="importing = true">批量导入</a>
            ，或在帖子里悬浮图片点「收藏为表情」
          </template>
        </div>
      </div>
      <div class="nsh-sm-status">
        共 {{ list.length }} 个
        <template v-if="canDrag && list.length > 1"> · 拖动卡片调整顺序</template>
        <template v-else-if="sortKey !== 'manual'"> · 当前为「{{ { used: '最常使用', recent: '最近使用', created: '最新添加', name: '按名称' }[sortKey] }}」视图，切回自定义顺序可拖动排序</template>
        · 双击名称可重命名
      </div>
    </section>

    <ImportDialog v-if="importing" :default-group="defaultImportGroup" @close="importing = false" @done="(gid: string) => (view = gid)" />
    <GroupIconDialog v-if="iconGroup" :group="iconGroup" @close="iconGroup = null" />
  </div>
</template>

<style>
.nsh-sm {
  position: relative;
  display: flex;
  min-height: 0;
}
.nsh-sm-side {
  width: 200px;
  flex: none;
  padding: 10px;
  border-right: 1px solid var(--nsh-border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nsh-sm-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--nsh-radius);
  border: 1px dashed transparent;
  background: transparent;
  color: var(--nsh-text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.nsh-sm-nav:hover {
  background: var(--nsh-bg-muted);
}
.nsh-sm-nav.active {
  background: var(--nsh-accent-soft);
  color: var(--nsh-accent);
  font-weight: 600;
}
.nsh-sm-nav.drop-hint {
  border-color: var(--nsh-accent);
  background: var(--nsh-accent-soft);
}
.nsh-sm-nav-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nsh-sm-nav .nsh-count {
  font-size: 11px;
  color: var(--nsh-text-faint);
  font-weight: 400;
}
.nsh-sm-nav-ops {
  display: none;
  gap: 2px;
}
.nsh-sm-nav:hover .nsh-sm-nav-ops {
  display: flex;
}
.nsh-sm-nav:hover .nsh-count {
  display: none;
}
.nsh-sm-nav-ops button,
.nsh-sm-ops button {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--nsh-text-sub);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.nsh-sm-nav-ops button:hover {
  background: var(--nsh-bg);
  color: var(--nsh-text);
}
.nsh-clickable {
  cursor: pointer;
}
.nsh-sm-side-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 10px 4px 2px 10px;
  font-size: 12px;
  color: var(--nsh-text-faint);
}
.nsh-sm-side-foot {
  margin-top: auto;
  padding: 12px 8px 4px;
  font-size: 11px;
  color: var(--nsh-text-faint);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nsh-sm-side-foot a {
  color: var(--nsh-accent);
}
.nsh-inline-input {
  height: 24px;
  font-size: 12px;
  padding: 0 6px;
}
.nsh-sm-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.nsh-sm-toolbar,
.nsh-sm-bulk {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--nsh-border);
  flex-wrap: wrap;
}
.nsh-sm-bulk {
  background: var(--nsh-accent-soft);
  padding: 6px 14px;
}
.nsh-sm-toolbar .nsh-sm-search {
  width: 180px;
  height: 28px;
}
.nsh-sm-toolbar .nsh-sm-sort,
.nsh-sm-bulk .nsh-sm-move {
  width: auto;
  height: 26px;
  font-size: 12px;
  padding: 0 24px 0 8px;
  background-position: right 7px center;
}
.nsh-sm-add-chip {
  display: none;
}
/* 触屏没有悬浮：当前选中的分组常显重命名 / 删除按钮 */
@media (hover: none) {
  .nsh-sm-nav.active .nsh-sm-nav-ops {
    display: flex;
  }
  .nsh-sm-nav.active .nsh-count {
    display: none;
  }
}
.nsh-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
}
.nsh-sub {
  font-size: 12px;
  color: var(--nsh-text-sub);
}
.nsh-sm-grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  grid-auto-rows: min-content;
  gap: 10px;
  align-content: start;
}
.nsh-sm-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 6px 8px;
  border-radius: var(--nsh-radius);
  border: 1px solid var(--nsh-border);
  background: var(--nsh-bg);
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  cursor: grab;
}
.nsh-sm-card:hover {
  border-color: var(--nsh-accent);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}
.nsh-sm-card.selecting {
  cursor: pointer;
}
.nsh-sm-card.selected {
  border-color: var(--nsh-accent);
  background: var(--nsh-accent-soft);
}
.nsh-sm-card.drop-hint {
  border-style: dashed;
  border-color: var(--nsh-accent);
  transform: scale(1.03);
}
.nsh-sm-name {
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nsh-sm-meta {
  font-size: 10px;
  color: var(--nsh-text-faint);
}
.nsh-sm-card .nsh-fav-dot {
  top: 6px;
  right: 6px;
}
.nsh-sm-card:hover .nsh-fav-dot {
  opacity: 1;
}
.nsh-sm-ops {
  position: absolute;
  top: 6px;
  left: 6px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}
.nsh-sm-card:hover .nsh-sm-ops {
  opacity: 1;
}
.nsh-sm-ops button {
  background: var(--nsh-bg-muted);
}
.nsh-sm-ops button:hover {
  color: var(--nsh-accent);
}
.nsh-sm-ops button:last-child:hover {
  color: var(--nsh-danger);
}
.nsh-sm-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--nsh-text-faint);
  background: var(--nsh-bg);
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  font-weight: 700;
}
.nsh-sm-card.selected .nsh-sm-check {
  background: var(--nsh-accent);
  border-color: var(--nsh-accent);
}
.nsh-sm-empty {
  grid-column: 1 / -1;
  padding: 60px 0;
}
.nsh-sm-empty a {
  color: var(--nsh-accent);
}
.nsh-sm-empty-icon {
  font-size: 34px;
  margin-bottom: 6px;
}
.nsh-sm-status {
  padding: 6px 14px;
  border-top: 1px solid var(--nsh-border);
  font-size: 11px;
  color: var(--nsh-text-faint);
}
@media (max-width: 720px) {
  .nsh-sm {
    flex-direction: column;
  }
  .nsh-sm-toolbar,
  .nsh-sm-bulk {
    padding: 8px 10px;
  }
  /* 工具栏两行：第一行搜索 + 批量导入，第二行排序与其余按钮等分（::after 作为换行） */
  .nsh-sm-toolbar {
    row-gap: 8px;
  }
  .nsh-sm-toolbar .nsh-spacer {
    display: none;
  }
  .nsh-sm-toolbar .nsh-sm-search {
    order: -2;
    flex: 1 1 0;
    min-width: 0;
    width: auto;
    height: 32px;
  }
  .nsh-sm-toolbar .nsh-btn.primary {
    order: -1;
    height: 32px;
  }
  .nsh-sm-toolbar::after {
    content: '';
    order: -1;
    flex-basis: 100%;
  }
  /* 第二行：下拉按内容定宽（iOS 下拉需 16px 字号以免聚焦放大），其余按钮缩小字号后均分剩余宽度 */
  .nsh-sm-toolbar > .nsh-sm-sort {
    flex: none;
    width: auto;
    height: 30px;
  }
  .nsh-sm-toolbar > .nsh-btn:not(.primary) {
    flex: 1 1 0;
    min-width: 0;
    height: 30px;
    padding: 0 6px;
    font-size: 13px;
  }
  .nsh-sm-grid {
    padding: 10px;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
  }
  .nsh-sm-card {
    padding: 8px 4px 6px;
  }
  .nsh-sm-status {
    display: none;
  }
  .nsh-sm-side {
    width: auto;
    flex: none;
    flex-direction: row;
    gap: 6px;
    padding: 8px 10px;
    border-right: none;
    border-bottom: 1px solid var(--nsh-border);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .nsh-sm-side::-webkit-scrollbar {
    display: none;
  }
  .nsh-sm-nav {
    width: auto;
    flex: none;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--nsh-border);
    border-radius: 16px;
  }
  .nsh-sm-nav.active {
    border-color: transparent;
  }
  .nsh-sm-add-chip {
    display: inline-flex;
    border-style: dashed;
    color: var(--nsh-text-sub);
  }
  /* 重命名：紧凑输入框，不撑满整条 */
  .nsh-sm-side .nsh-inline-input {
    flex: none;
    width: 7.5em;
    height: 26px;
    padding: 0 8px;
  }
  .nsh-sm-side-title,
  .nsh-sm-side-foot {
    display: none;
  }
}
</style>
