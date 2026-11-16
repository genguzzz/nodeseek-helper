<script setup lang="ts">
import { ui } from '../core/ui';
</script>

<template>
  <Transition name="nsh-fade">
    <div v-if="ui.confirm" class="nsh-mask nsh-confirm-mask" @mousedown.self="ui.confirm.resolve('cancel')">
      <div class="nsh-confirm" role="alertdialog">
        <div class="nsh-confirm-title">{{ ui.confirm.title }}</div>
        <div class="nsh-confirm-msg">{{ ui.confirm.message }}</div>
        <div class="nsh-confirm-actions">
          <button v-if="ui.confirm.altText" class="nsh-btn ghost sm nsh-confirm-alt" @click="ui.confirm.resolve('alt')">{{ ui.confirm.altText }}</button>
          <span class="nsh-spacer" />
          <button class="nsh-btn sm" @click="ui.confirm.resolve('cancel')">{{ ui.confirm.cancelText }}</button>
          <button class="nsh-btn sm primary" @click="ui.confirm.resolve('ok')">{{ ui.confirm.okText }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style>
.nsh-confirm-mask {
  z-index: 99998;
}
.nsh-confirm {
  width: 100%;
  max-width: 420px;
  padding: 18px 20px 14px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg);
  box-shadow: var(--nsh-shadow);
}
.nsh-confirm-title {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 8px;
  color: var(--nsh-text-strong);
}
.nsh-confirm-msg {
  font-size: 13px;
  line-height: 1.7;
  color: var(--nsh-text);
  white-space: pre-line;
}
.nsh-confirm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.nsh-confirm-alt {
  color: var(--nsh-text-sub);
}
</style>
