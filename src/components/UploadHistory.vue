<script setup lang="ts">
import { GM_setClipboard } from '$';
import { addStickers, DEFAULT_GROUP_ID, renderTemplate, settings, type UploadRecord } from '../core/store';
import { toast } from '../core/ui';
import StickerThumb from './StickerThumb.vue';

function copy(r: UploadRecord, md: boolean): void {
  GM_setClipboard(md ? renderTemplate(settings.imageTemplate, { url: r.url, name: r.name }) : r.url, 'text');
  toast(md ? '已复制 Markdown' : '已复制链接', 'success', 1500);
}

function toSticker(r: UploadRecord): void {
  const res = addStickers([{ url: r.url, name: r.name }], DEFAULT_GROUP_ID);
  toast(res.added ? '已加入「默认」表情分组' : '表情库里已经有它了', res.added ? 'success' : 'info');
}

function clear(): void {
  if (confirm('清空上传记录？（不会删除图床上的图片）')) settings.history.splice(0);
}

const fmt = (t: number): string => new Date(t).toLocaleString();
</script>

<template>
  <div class="nsh-history nsh-scroll">
    <div class="nsh-history-head">
      <span class="nsh-sub">最近 {{ settings.history.length }} 条上传记录（最多保留 200 条）</span>
      <button v-if="settings.history.length" class="nsh-btn sm ghost danger" @click="clear">清空</button>
    </div>
    <div v-for="r in settings.history" :key="r.url + r.time" class="nsh-history-item">
      <StickerThumb :url="r.url" :name="r.name" :size="48" />
      <div class="nsh-history-meta">
        <a :href="r.url" target="_blank" rel="noopener" class="nsh-history-url">{{ r.url }}</a>
        <div class="nsh-help">{{ fmt(r.time) }} · {{ r.host }}</div>
      </div>
      <button class="nsh-btn sm" @click="copy(r, false)">链接</button>
      <button class="nsh-btn sm" @click="copy(r, true)">Markdown</button>
      <button class="nsh-btn sm" title="加入表情库" @click="toSticker(r)">设为表情</button>
    </div>
    <div v-if="!settings.history.length" class="nsh-empty">还没有上传记录，去编辑器里粘贴一张图片试试</div>
  </div>
</template>

<style>
.nsh-history {
  padding: 14px max(22px, calc((100% - 820px) / 2));
  overflow-y: auto;
}
.nsh-history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.nsh-history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--nsh-border);
}
.nsh-history-meta {
  flex: 1;
  min-width: 0;
}
.nsh-history-url {
  display: block;
  font-size: 12px;
  color: var(--nsh-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: none;
}
.nsh-history-url:hover {
  color: var(--nsh-accent);
}
</style>
