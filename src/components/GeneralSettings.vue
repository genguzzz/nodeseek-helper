<script setup lang="ts">
import { ref } from 'vue';
import { GM_setClipboard } from '$';
import { exportConfig, importConfig, settings } from '../core/store';
import { toast } from '../core/ui';

const withStickers = ref(false);
const importText = ref('');

function download(text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `nodeseek-helper-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function doExport(copy: boolean): void {
  const text = exportConfig({ withStickers: withStickers.value });
  if (copy) {
    GM_setClipboard(text, 'text');
    toast('配置已复制到剪贴板（含图床密钥，请勿公开分享）', 'success', 3500);
  } else {
    download(text);
  }
}

function applyImport(text: string): void {
  try {
    const r = importConfig(text);
    const parts = [
      r.hostsAdded && `新增图床 ${r.hostsAdded} 个`,
      r.hostsUpdated && `更新图床 ${r.hostsUpdated} 个`,
      r.settingsApplied && '通用设置已应用',
      r.stickers && `表情 +${r.stickers.added}`,
    ].filter(Boolean);
    toast(`导入成功：${parts.join('，')}`, 'success', 4000);
    importText.value = '';
  } catch (e) {
    toast(`导入失败：${(e as Error).message}`, 'error', 4000);
  }
}

async function onImportFile(e: Event): Promise<void> {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) applyImport(await f.text());
  (e.target as HTMLInputElement).value = '';
}

type BoolKey = 'pasteUpload' | 'dropUpload' | 'compress' | 'collectFromPost' | 'freezeAnimated' | 'hoverPreview';
const toggles: { key: BoolKey; label: string; help: string }[] = [
  { key: 'pasteUpload', label: '粘贴图片自动上传', help: '在回复 / 发帖编辑器中 Ctrl+V 截图或图片时自动上传并插入' },
  { key: 'dropUpload', label: '拖拽图片自动上传', help: '把图片文件拖进编辑器即可上传' },
  { key: 'hoverPreview', label: '表情悬浮预览', help: '鼠标悬浮表情时显示大图；移动端长按预览' },
  { key: 'freezeAnimated', label: '动图静止，悬浮播放', help: '表情面板中 GIF / 动态 WebP 默认显示首帧，鼠标悬浮时才播放，面板更清爽' },
  { key: 'collectFromPost', label: '帖子图片一键收藏', help: '浏览帖子时悬浮图片，右上角出现「收藏为表情」按钮' },
  { key: 'compress', label: '上传前压缩', help: '在浏览器端缩放并转码后再上传（GIF 不处理）' },
];
</script>

<template>
  <div class="nsh-general nsh-scroll">
    <h3 class="nsh-h3">上传与交互</h3>
    <div v-for="t in toggles" :key="t.key" class="nsh-row">
      <div class="nsh-row-text">
        <div>{{ t.label }}</div>
        <div class="nsh-help">{{ t.help }}</div>
      </div>
      <button class="nsh-switch" :class="{ on: settings[t.key] }" @click="settings[t.key] = !settings[t.key]" />
    </div>

    <div v-if="settings.compress" class="nsh-sub-block">
      <div class="nsh-field">
        <label class="nsh-label">输出格式</label>
        <div class="nsh-control">
          <select v-model="settings.compressFormat" class="nsh-select">
            <option value="image/webp">WebP（推荐）</option>
            <option value="image/jpeg">JPEG</option>
            <option value="original">保持原格式</option>
          </select>
        </div>
      </div>
      <div class="nsh-field">
        <label class="nsh-label">质量 {{ Math.round(settings.compressQuality * 100) }}%</label>
        <div class="nsh-control">
          <input v-model.number="settings.compressQuality" type="range" min="0.4" max="1" step="0.05" class="nsh-range" />
        </div>
      </div>
      <div class="nsh-field">
        <label class="nsh-label">最大宽度</label>
        <div class="nsh-control">
          <input v-model.number="settings.maxWidth" type="number" min="0" class="nsh-input" placeholder="0 表示不限制" />
          <div class="nsh-help">超过该宽度等比缩小，0 为不缩放</div>
        </div>
      </div>
    </div>

    <h3 class="nsh-h3 nsh-mt">插入格式</h3>
    <p class="nsh-desc">可用变量 <code>{url}</code> 图片链接、<code>{name}</code> 文件名 / 表情名。</p>
    <div class="nsh-field">
      <label class="nsh-label">上传图片</label>
      <div class="nsh-control"><input v-model="settings.imageTemplate" class="nsh-input" spellcheck="false" /></div>
    </div>
    <div class="nsh-field">
      <label class="nsh-label">发送表情</label>
      <div class="nsh-control">
        <input v-model="settings.stickerTemplate" class="nsh-input" spellcheck="false" />
        <div class="nsh-help">如只想插入链接，可改为 <code>{url}</code></div>
      </div>
    </div>

    <h3 class="nsh-h3 nsh-mt">配置导入 / 导出</h3>
    <p class="nsh-desc">在油猴脚本、Surge / 圈X 等代理版本、不同浏览器之间迁移配置。导出内容包含图床密钥，请勿公开分享。</p>
    <div class="nsh-row">
      <div class="nsh-row-text">
        <div>导出时包含表情包</div>
        <div class="nsh-help">分组、收藏与使用次数一并导出</div>
      </div>
      <button class="nsh-switch" :class="{ on: withStickers }" @click="withStickers = !withStickers" />
    </div>
    <div class="nsh-io-actions">
      <button class="nsh-btn" @click="doExport(false)">下载配置文件</button>
      <button class="nsh-btn" @click="doExport(true)">复制配置</button>
      <label class="nsh-btn">
        选择文件导入
        <input type="file" accept="application/json,.json" hidden @change="onImportFile" />
      </label>
    </div>
    <textarea
      v-model="importText"
      class="nsh-textarea nsh-io-text"
      placeholder="或在此粘贴配置 JSON（完整配置、hosts 数组或单个图床对象均可）"
    />
    <div class="nsh-io-actions">
      <button class="nsh-btn primary" :disabled="!importText.trim()" @click="applyImport(importText)">导入粘贴的配置</button>
    </div>
  </div>
</template>

<style>
.nsh-general {
  padding: 18px 22px;
  overflow-y: auto;
  height: 100%;
}
/* 滚动容器占满面板宽度（滚动条贴右边），只限制内容宽度 */
.nsh-general > * {
  max-width: 760px;
}
.nsh-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--nsh-border);
}
.nsh-row-text {
  flex: 1;
  font-size: 13px;
}
.nsh-sub-block {
  margin: 10px 0 0;
  padding: 14px 0 2px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg-sub);
}
.nsh-range {
  width: 100%;
  accent-color: var(--nsh-accent);
  margin-top: 9px;
}
.nsh-io-actions {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.nsh-io-text {
  min-height: 90px;
}
.nsh-mt {
  margin-top: 24px;
}
.nsh-general code,
.nsh-desc code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--nsh-bg-muted);
  font-size: 12px;
}
</style>
