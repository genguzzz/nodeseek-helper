<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { ui, dismissToast, type PanelTab } from './core/ui';
import HostSettings from './components/HostSettings.vue';
import StickerManager from './components/StickerManager.vue';
import GeneralSettings from './components/GeneralSettings.vue';
import UploadHistory from './components/UploadHistory.vue';
import SyncSettings from './components/SyncSettings.vue';
import PreviewPopover from './components/PreviewPopover.vue';
import PickerPopover from './components/PickerPopover.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { HANABI_ICON } from './core/packs';

const VERSION: string = __NSH_VERSION__;

const tabs: { id: PanelTab; label: string; icon: string }[] = [
  { id: 'hosts', label: '图床', icon: '☁' },
  { id: 'stickers', label: '表情包', icon: '☺' },
  { id: 'sync', label: '同步', icon: '⇅' },
  { id: 'general', label: '通用', icon: '⚙' },
  { id: 'history', label: '上传记录', icon: '⏱' },
];

/** 打开设置面板时锁定页面滚动，并补上滚动条宽度防止页面横跳 */
watch(
  () => ui.panelOpen || !!ui.confirm,
  (open) => {
    const html = document.documentElement;
    if (open) {
      const gap = window.innerWidth - html.clientWidth;
      html.classList.add('nsh-scroll-lock');
      if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    } else {
      html.classList.remove('nsh-scroll-lock');
      document.body.style.paddingRight = '';
    }
  },
);

/** 遮罩上的滚轮 / 触摸滑动直接吞掉（面板内部滚动区不受影响） */
function blockScroll(e: Event): void {
  if (!(e.target as Element).closest('.nsh-scroll, .nsh-textarea, [class*="-grid"], select')) e.preventDefault();
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (ui.confirm) ui.confirm.resolve('cancel');
  else if (ui.panelOpen) ui.panelOpen = false;
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Transition name="nsh-fade">
    <div v-if="ui.panelOpen" class="nsh-mask" @mousedown.self="ui.panelOpen = false" @wheel="blockScroll" @touchmove="blockScroll">
      <div class="nsh-panel" role="dialog" aria-label="NodeSeek 助手">
        <header class="nsh-panel-head">
          <div class="nsh-brand"><span class="nsh-brand-logo" v-html="HANABI_ICON" />NodeSeek 助手<span class="nsh-brand-ver">v{{ VERSION }}</span></div>
          <nav class="nsh-tabs">
            <button v-for="t in tabs" :key="t.id" class="nsh-tab" :class="{ active: ui.panelTab === t.id }" @click="ui.panelTab = t.id">
              <span class="nsh-tab-icon">{{ t.icon }}</span>{{ t.label }}
            </button>
          </nav>
          <button class="nsh-close" title="关闭（Esc）" @click="ui.panelOpen = false">✕</button>
        </header>
        <main class="nsh-panel-body">
          <KeepAlive>
            <HostSettings v-if="ui.panelTab === 'hosts'" />
            <StickerManager v-else-if="ui.panelTab === 'stickers'" />
            <SyncSettings v-else-if="ui.panelTab === 'sync'" />
            <GeneralSettings v-else-if="ui.panelTab === 'general'" />
            <UploadHistory v-else />
          </KeepAlive>
        </main>
      </div>
    </div>
  </Transition>

  <div class="nsh-toasts">
    <TransitionGroup name="nsh-toast">
      <div v-for="t in ui.toasts" :key="t.id" class="nsh-toast" :class="t.type" @click="dismissToast(t.id)">
        <span class="nsh-toast-icon">
          <span v-if="t.type === 'loading'" class="nsh-spin" />
          <template v-else>{{ { success: '✓', error: '!', info: 'i' }[t.type] }}</template>
        </span>
        <span class="nsh-toast-text">{{ t.text }}</span>
        <span v-if="t.progress !== undefined" class="nsh-toast-progress">{{ t.progress }}%</span>
        <span v-if="t.progress !== undefined" class="nsh-toast-bar" :style="{ width: t.progress + '%' }" />
      </div>
    </TransitionGroup>
  </div>

  <ConfirmDialog />
  <PickerPopover />
  <PreviewPopover />
</template>

<style>
.nsh-mask {
  position: fixed;
  inset: 0;
  z-index: 99995;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.nsh-panel {
  width: 100%;
  max-width: 980px;
  height: min(680px, 100%);
  display: flex;
  flex-direction: column;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg);
  box-shadow: var(--nsh-shadow);
  overflow: hidden;
}
.nsh-panel-head {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 52px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid var(--nsh-border);
  flex: none;
}
.nsh-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
}
.nsh-brand-ver {
  margin-left: -2px;
  font-size: 11px;
  font-weight: 400;
  color: var(--nsh-text-faint);
}
.nsh-brand-logo {
  display: inline-flex;
  font-size: 22px;
}
.nsh-tabs {
  display: flex;
  gap: 2px;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.nsh-tabs::-webkit-scrollbar {
  display: none;
}
.nsh-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--nsh-text-sub);
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}
.nsh-tab:hover {
  color: var(--nsh-text);
}
.nsh-tab.active {
  color: var(--nsh-accent);
  font-weight: 600;
}
.nsh-tab.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 1px;
  background: var(--nsh-accent);
}
.nsh-tab-icon {
  font-size: 13px;
  opacity: 0.8;
}
.nsh-close {
  margin-left: auto;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--nsh-radius);
  background: transparent;
  color: var(--nsh-text-sub);
  font-size: 14px;
  cursor: pointer;
}
.nsh-close:hover {
  background: var(--nsh-bg-muted);
  color: var(--nsh-text);
}
.nsh-panel-body {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 各页面撑满面板主体：用 flex 而不是 height:100%（iOS Safari 对 flex 子项的百分比高度解析不可靠，会导致内部无法滚动） */
.nsh-panel-body > * {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
/* 横向滚动的分组列表等宽内容不能撑宽面板（手机上会把整块面板挤出屏幕并横向错位） */
.nsh-sm > *,
.nsh-hosts > * {
  min-width: 0;
}
.nsh-fade-enter-active,
.nsh-fade-leave-active {
  transition: opacity 0.2s;
}
.nsh-fade-enter-active .nsh-panel,
.nsh-fade-leave-active .nsh-panel {
  transition: transform 0.2s;
}
.nsh-fade-enter-from,
.nsh-fade-leave-to {
  opacity: 0;
}
.nsh-fade-enter-from .nsh-panel,
.nsh-fade-leave-to .nsh-panel {
  transform: translateY(10px) scale(0.98);
}

.nsh-toasts {
  position: fixed;
  left: 50%;
  top: 18px;
  transform: translateX(-50%);
  z-index: 100001;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.nsh-toast {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 440px;
  padding: 8px 14px 8px 10px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg);
  border: 1px solid var(--nsh-border);
  box-shadow: var(--nsh-shadow);
  font-size: 13px;
  pointer-events: auto;
  cursor: pointer;
  overflow: hidden;
}
.nsh-toast-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: #6a737d;
}
.nsh-toast.success .nsh-toast-icon {
  background: var(--nsh-accent);
}
.nsh-toast.error .nsh-toast-icon {
  background: var(--nsh-danger);
}
.nsh-toast.loading .nsh-toast-icon {
  background: transparent;
}
.nsh-toast-text {
  word-break: break-all;
}
.nsh-toast-progress {
  font-size: 12px;
  color: var(--nsh-text-sub);
  font-variant-numeric: tabular-nums;
}
.nsh-toast-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--nsh-accent);
  transition: width 0.2s;
}
.nsh-spin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--nsh-accent-soft);
  border-top-color: var(--nsh-accent);
  animation: nsh-spin 0.8s linear infinite;
}
@keyframes nsh-spin {
  to {
    transform: rotate(360deg);
  }
}
.nsh-toast-enter-active,
.nsh-toast-leave-active {
  transition: all 0.25s ease;
}
.nsh-toast-enter-from,
.nsh-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
@media (max-width: 720px) {
  .nsh-mask {
    padding: 0;
    align-items: stretch;
  }
  /* 手机：全屏面板，高度用动态视口（扣除浏览器工具栏），顶部 / 底部避开安全区 */
  .nsh-panel {
    max-width: none;
    height: 100dvh;
    border-radius: 0;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .nsh-panel-head {
    gap: 4px;
    padding: 0 4px 0 8px;
    height: 46px;
  }
  .nsh-brand {
    display: none;
  }
  .nsh-tabs {
    flex: 1;
    min-width: 0;
  }
  .nsh-tab {
    padding: 0 9px;
    font-size: 13px;
  }
  .nsh-tab.active::after {
    left: 9px;
    right: 9px;
  }
  .nsh-tab-icon {
    display: none;
  }
  .nsh-close {
    flex: none;
  }
  .nsh-toasts {
    top: calc(10px + env(safe-area-inset-top));
    width: calc(100vw - 24px);
  }
  .nsh-toast {
    max-width: 100%;
  }
}
</style>
