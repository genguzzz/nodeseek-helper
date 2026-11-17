<script setup lang="ts">
import { computed, ref } from 'vue';
import type { StickerGroup } from '../core/store';
import { builtinPacks } from '../core/packs';
import GroupIcon from './GroupIcon.vue';

/**
 * 分组图标编辑：常用 emoji 一键选择，或填写 emoji / 图片链接 / SVG 代码。
 * 内置包的 SVG 图标不回填到输入框（一长串代码既看不懂也不好改），只提示「当前为自定义图标」。
 */
const props = defineProps<{ group: StickerGroup }>();
const emit = defineEmits<{ close: [] }>();

const QUICK = ['📁', '⭐', '❤️', '😀', '😂', '🥺', '😎', '🤔', '👍', '🎉', '🔥', '✨', '🌸', '🐱', '🐶', '🎸', '🎮', '🍜', '💬', '📌'];

const isSvg = (v?: string): boolean => !!v && (v.startsWith('<svg') || v.startsWith('data:image/svg'));
const draft = ref(isSvg(props.group.icon) ? '' : (props.group.icon ?? ''));
/** 输入框为空且原图标是 SVG：保持原图标 */
const keepSvg = ref(isSvg(props.group.icon));
const builtinIcon = computed(() => builtinPacks.find((p) => p.id === props.group.builtin)?.icon);
const preview = computed<StickerGroup>(() => ({ ...props.group, icon: draft.value.trim() || (keepSvg.value ? props.group.icon : undefined) }));

function pick(v: string): void {
  draft.value = v;
  keepSvg.value = false;
}

function reset(): void {
  props.group.icon = builtinIcon.value;
  emit('close');
}

function save(): void {
  const v = draft.value.trim();
  if (v) props.group.icon = v;
  else if (!keepSvg.value) props.group.icon = undefined;
  emit('close');
}
</script>

<template>
  <div class="nsh-dialog-mask" @click.self="emit('close')">
    <div class="nsh-dialog nsh-icon-dialog">
      <div class="nsh-dialog-head">
        <span class="nsh-icon-dialog-preview"><GroupIcon :group="preview" fallback /></span>
        <b>「{{ group.name }}」的图标</b>
        <button class="nsh-btn ghost sm" title="关闭" @click="emit('close')">✕</button>
      </div>
      <div class="nsh-dialog-body">
        <div class="nsh-icon-quick">
          <button v-for="e in QUICK" :key="e" :class="{ on: draft === e }" @click="pick(e)">{{ e }}</button>
        </div>
        <input v-model="draft" class="nsh-input" placeholder="或输入 emoji / 图片链接 / SVG" autocomplete="off" spellcheck="false" @input="keepSvg = false" @keydown.enter="save" />
        <p v-if="keepSvg && !draft" class="nsh-help">当前为自定义图标，留空保存即保持不变</p>
      </div>
      <div class="nsh-dialog-foot">
        <button class="nsh-btn ghost" @click="reset">{{ builtinIcon ? '恢复内置图标' : '恢复默认' }}</button>
        <span class="nsh-spacer" />
        <button class="nsh-btn" @click="emit('close')">取消</button>
        <button class="nsh-btn primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style>
.nsh-icon-dialog {
  width: min(420px, calc(100vw - 32px));
}
.nsh-icon-dialog .nsh-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nsh-icon-dialog-preview {
  display: inline-flex;
  font-size: 20px;
}
.nsh-icon-quick {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 6px;
}
.nsh-icon-quick button {
  height: 40px;
  border: 1px solid var(--nsh-border);
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg);
  font-size: 20px;
  cursor: pointer;
}
.nsh-icon-quick button:hover,
.nsh-icon-quick button.on {
  border-color: var(--nsh-accent);
  background: var(--nsh-accent-soft);
}
</style>
