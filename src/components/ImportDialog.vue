<script setup lang="ts">
import { computed, ref } from 'vue';
import { activeHost, addStickers, importBackup, parseImportText, stickerData, uid } from '../core/store';
import { maybeCompress, uploadFile } from '../core/uploaders';
import { settings } from '../core/store';
import { toast } from '../core/ui';
import StickerThumb from './StickerThumb.vue';

const props = defineProps<{ defaultGroup: string }>();
const emit = defineEmits<{ close: []; done: [groupId: string] }>();

type Mode = 'text' | 'files' | 'backup';
const PREVIEW_LIMIT = 60;

const mode = ref<Mode>('text');
const text = ref('');
const groupId = ref(props.defaultGroup);
const newGroupName = ref('');
const files = ref<File[]>([]);
const uploading = ref(false);
const progress = ref({ done: 0, failed: 0 });
const dragging = ref(false);

const parsed = computed(() => parseImportText(text.value));
const duplicates = computed(() => {
  const exists = new Set(stickerData.stickers.map((s) => s.url));
  return parsed.value.filter((p) => exists.has(p.url)).length;
});
const filePreviews = computed(() => files.value.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })));

function resolveGroup(): string {
  if (groupId.value !== '__new') return groupId.value;
  const id = uid();
  stickerData.groups.push({ id, name: newGroupName.value.trim() || '新分组' });
  return id;
}

function importText(): void {
  if (!parsed.value.length) return;
  const gid = resolveGroup();
  const r = addStickers(parsed.value, gid);
  toast(`导入 ${r.added} 个${r.skipped ? `，跳过重复 ${r.skipped} 个` : ''}`, 'success', 3500);
  emit('done', gid);
  emit('close');
}

function onPickFiles(list: FileList | null | undefined): void {
  if (!list) return;
  files.value.push(...Array.from(list).filter((f) => f.type.startsWith('image/')));
}

async function uploadFiles(): Promise<void> {
  const host = activeHost();
  if (!host) {
    toast('请先在「图床」页配置图床', 'error');
    return;
  }
  const gid = resolveGroup();
  uploading.value = true;
  progress.value = { done: 0, failed: 0 };
  const queue = [...files.value];
  const CONCURRENCY = 3;
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const f = queue.shift() as File;
      try {
        // 表情包保留原格式（GIF 不压缩），其余按全局压缩设置
        const file = f.type === 'image/gif' ? f : await maybeCompress(f, settings);
        const url = await uploadFile(host, file);
        addStickers([{ url, name: f.name.replace(/\.[^.]+$/, '') }], gid);
        progress.value.done++;
      } catch (e) {
        progress.value.failed++;
        toast(`${f.name} 上传失败：${(e as Error).message}`, 'error', 5000);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  uploading.value = false;
  toast(`上传完成：成功 ${progress.value.done}，失败 ${progress.value.failed}`, progress.value.failed ? 'error' : 'success', 4000);
  emit('done', gid);
  if (!progress.value.failed) emit('close');
}

async function onBackupFile(list: FileList | null): Promise<void> {
  const f = list?.[0];
  if (!f) return;
  try {
    const r = importBackup(await f.text());
    toast(`恢复 ${r.added} 个表情${r.skipped ? `，跳过重复 ${r.skipped} 个` : ''}`, 'success', 3500);
    emit('close');
  } catch (e) {
    toast(`导入失败：${(e as Error).message}`, 'error');
  }
}
</script>

<template>
  <div class="nsh-dialog-mask" @click.self="!uploading && emit('close')">
    <div class="nsh-dialog">
      <div class="nsh-dialog-head">
        <b>批量导入表情</b>
        <div class="nsh-seg">
          <button :class="{ on: mode === 'text' }" @click="mode = 'text'">粘贴链接</button>
          <button :class="{ on: mode === 'files' }" @click="mode = 'files'">上传本地图片</button>
          <button :class="{ on: mode === 'backup' }" @click="mode = 'backup'">恢复备份</button>
        </div>
        <button class="nsh-btn ghost sm" :disabled="uploading" @click="emit('close')">✕</button>
      </div>

      <div class="nsh-dialog-body nsh-scroll">
        <div v-if="mode !== 'backup'" class="nsh-import-group">
          <span>导入到</span>
          <select v-model="groupId" class="nsh-select">
            <option v-for="g in stickerData.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            <option value="__new">＋ 新建分组…</option>
          </select>
          <input v-if="groupId === '__new'" v-model="newGroupName" class="nsh-input" placeholder="新分组名称" />
        </div>

        <template v-if="mode === 'text'">
          <textarea
            v-model="text"
            class="nsh-textarea nsh-import-text"
            placeholder="每行一个图片链接；也支持直接粘贴 Markdown ![名称](链接)、HTML <img>、JSON 数组，或整段帖子内容（自动提取其中的图片）"
          />
          <div class="nsh-import-summary">
            识别到 <b>{{ parsed.length }}</b> 张
            <template v-if="duplicates">，其中 {{ duplicates }} 张已存在将跳过</template>
          </div>
          <div v-if="parsed.length" class="nsh-import-preview">
            <StickerThumb v-for="p in parsed.slice(0, PREVIEW_LIMIT)" :key="p.url" :url="p.url" :name="p.name" :size="52" />
            <span v-if="parsed.length > PREVIEW_LIMIT" class="nsh-sub">… 还有 {{ parsed.length - PREVIEW_LIMIT }} 张</span>
          </div>
        </template>

        <template v-else-if="mode === 'files'">
          <label
            class="nsh-dropzone"
            :class="{ dragging }"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="(dragging = false), onPickFiles($event.dataTransfer?.files)"
          >
            <input type="file" accept="image/*" multiple hidden @change="onPickFiles(($event.target as HTMLInputElement).files)" />
            <div class="nsh-dropzone-icon">⇪</div>
            <div>点击选择或拖入图片（可多选），将通过当前图床「{{ activeHost()?.name ?? '未配置' }}」上传</div>
          </label>
          <div v-if="files.length" class="nsh-import-preview">
            <StickerThumb v-for="p in filePreviews" :key="p.url" :url="p.url" :name="p.name" :size="52" :preview="false" />
          </div>
          <div v-if="uploading" class="nsh-import-summary">上传中 {{ progress.done + progress.failed }} / {{ files.length }}…</div>
        </template>

        <template v-else>
          <p class="nsh-desc">选择之前「导出备份」得到的 JSON 文件，分组与收藏、使用次数会一起恢复，重复的表情自动跳过。</p>
          <label class="nsh-dropzone">
            <input type="file" accept="application/json,.json" hidden @change="onBackupFile(($event.target as HTMLInputElement).files)" />
            <div class="nsh-dropzone-icon">⟲</div>
            <div>选择备份文件</div>
          </label>
        </template>
      </div>

      <div v-if="mode !== 'backup'" class="nsh-dialog-foot">
        <button class="nsh-btn" :disabled="uploading" @click="emit('close')">取消</button>
        <button v-if="mode === 'text'" class="nsh-btn primary" :disabled="!parsed.length" @click="importText">
          导入 {{ Math.max(0, parsed.length - duplicates) }} 张
        </button>
        <button v-else class="nsh-btn primary" :disabled="!files.length || uploading" @click="uploadFiles">
          {{ uploading ? '上传中…' : `上传并导入 ${files.length} 张` }}
        </button>
      </div>
    </div>
  </div>
</template>

<style>
.nsh-dialog-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.nsh-dialog {
  width: 100%;
  max-width: 620px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--nsh-bg);
  border-radius: var(--nsh-radius);
  box-shadow: var(--nsh-shadow);
  overflow: hidden;
}
.nsh-dialog-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--nsh-border);
}
.nsh-dialog-head .nsh-btn {
  margin-left: auto;
}
.nsh-seg {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg-muted);
}
.nsh-seg button {
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--nsh-text-sub);
  font-size: 12px;
  cursor: pointer;
}
.nsh-seg button.on {
  background: var(--nsh-bg);
  color: var(--nsh-text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  font-weight: 600;
}
.nsh-dialog-body {
  padding: 14px;
  overflow-y: auto;
}
.nsh-import-group {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}
.nsh-import-group span {
  flex: none;
  color: var(--nsh-text-sub);
}
.nsh-import-group .nsh-select,
.nsh-import-group .nsh-input {
  width: 180px;
  height: 30px;
}
.nsh-import-text {
  min-height: 140px;
}
.nsh-import-summary {
  margin: 8px 0;
  font-size: 12px;
  color: var(--nsh-text-sub);
}
.nsh-import-summary b {
  color: var(--nsh-accent);
}
.nsh-import-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg-sub);
  max-height: 200px;
  overflow-y: auto;
  align-items: center;
}
.nsh-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 30px 16px;
  border: 2px dashed var(--nsh-border);
  border-radius: var(--nsh-radius);
  color: var(--nsh-text-sub);
  font-size: 13px;
  text-align: center;
  cursor: pointer;
  margin-bottom: 10px;
  transition: border-color 0.15s, background 0.15s;
}
.nsh-dropzone:hover,
.nsh-dropzone.dragging {
  border-color: var(--nsh-accent);
  background: var(--nsh-accent-soft);
}
.nsh-dropzone-icon {
  font-size: 26px;
  color: var(--nsh-accent);
}
.nsh-dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--nsh-border);
}
</style>
