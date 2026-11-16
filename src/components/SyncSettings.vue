<script setup lang="ts">
import { computed, ref } from 'vue';
import { GM_setClipboard } from '$';
import { resetSyncCursor, syncConfig, syncNow, syncState } from '../sync/engine';
import { onedrivePollLogin, onedriveStartLogin, syncProviderById, syncProviders, type DeviceCode } from '../sync/providers';
import { toast } from '../core/ui';

const reveal = ref<Record<string, boolean>>({});
const provider = computed(() => syncProviderById(syncConfig.provider));
const values = computed(() => (provider.value ? (syncConfig.values[provider.value.id] ??= {}) : {}));
const lastSync = computed(() => (syncConfig.lastSyncAt ? new Date(syncConfig.lastSyncAt).toLocaleString() : '从未'));

function choose(id: string): void {
  if (syncConfig.provider === id) return;
  syncConfig.provider = id;
  resetSyncCursor();
}

function onPassphraseChange(): void {
  // 口令变化后下次推送用新口令重新加密
  resetSyncCursor();
}

/* OneDrive 设备代码登录 */
const device = ref<DeviceCode | null>(null);
let loginAbort: AbortController | null = null;

async function onedriveLogin(): Promise<void> {
  const clientId = values.value.clientId?.trim();
  if (!clientId) {
    toast('请先填写应用 Client ID', 'error');
    return;
  }
  try {
    device.value = await onedriveStartLogin(clientId);
    GM_setClipboard(device.value.userCode, 'text');
    window.open(device.value.verificationUri, '_blank', 'noopener');
    loginAbort = new AbortController();
    values.value.refreshToken = await onedrivePollLogin(clientId, device.value, loginAbort.signal);
    device.value = null;
    toast('OneDrive 登录成功', 'success');
    resetSyncCursor();
    void syncNow('manual');
  } catch (e) {
    device.value = null;
    toast(`OneDrive 登录失败：${(e as Error).message}`, 'error', 5000);
  }
}

function cancelLogin(): void {
  loginAbort?.abort();
  device.value = null;
}

function disable(): void {
  syncConfig.provider = '';
  resetSyncCursor();
}
</script>

<template>
  <div class="nsh-general nsh-scroll">
    <h3 class="nsh-h3">配置同步</h3>
    <p class="nsh-desc">
      在多台设备、油猴版与代理版之间同步图床配置、通用设置和全部表情包（含自定义分组与图标）。
      多端同时修改按条目合并，不会整份覆盖。
    </p>

    <div class="nsh-provider-grid nsh-sync-providers">
      <button
        v-for="p in syncProviders"
        :key="p.id"
        class="nsh-provider-card"
        :class="{ active: syncConfig.provider === p.id }"
        @click="choose(p.id)"
      >
        <div class="nsh-provider-title">{{ p.name }}<span v-if="syncConfig.provider === p.id" class="nsh-tag">使用中</span></div>
        <div class="nsh-provider-desc">{{ p.desc }}</div>
      </button>
    </div>

    <template v-if="provider">
      <div class="nsh-sync-form">
        <div v-for="f in provider.fields" :key="f.key" class="nsh-field">
          <label class="nsh-label">{{ f.label }}<em v-if="f.required">*</em></label>
          <div class="nsh-control">
            <div class="nsh-input-wrap">
              <input
                v-model="values[f.key]"
                class="nsh-input"
                :type="f.type === 'password' && !reveal[f.key] ? 'password' : 'text'"
                :placeholder="f.placeholder"
                autocomplete="off"
                spellcheck="false"
                @change="resetSyncCursor()"
              />
              <button v-if="f.type === 'password'" class="nsh-eye" @click="reveal[f.key] = !reveal[f.key]">{{ reveal[f.key] ? '隐藏' : '显示' }}</button>
            </div>
            <div v-if="f.help" class="nsh-help">{{ f.help }}</div>
          </div>
        </div>
        <div v-if="provider.homepage" class="nsh-field">
          <span class="nsh-label" />
          <a class="nsh-link" :href="provider.homepage" target="_blank" rel="noopener">{{ provider.id === 'gist' ? '创建令牌' : provider.id === 'onedrive' ? '注册应用' : '使用说明' }} ↗</a>
        </div>

        <div v-if="provider.id === 'onedrive'" class="nsh-field">
          <span class="nsh-label">账号</span>
          <div class="nsh-control">
            <div v-if="device" class="nsh-device-code">
              <div>在打开的微软页面输入代码（已复制）：</div>
              <b>{{ device.userCode }}</b>
              <div class="nsh-help">
                <a :href="device.verificationUri" target="_blank" rel="noopener">{{ device.verificationUri }}</a> · 等待登录…
                <a href="javascript:void(0)" @click="cancelLogin">取消</a>
              </div>
            </div>
            <template v-else>
              <span class="nsh-sub">{{ values.refreshToken ? '已登录' : '未登录' }}</span>
              <button class="nsh-btn sm" style="margin-left: 8px" @click="onedriveLogin">{{ values.refreshToken ? '重新登录' : '登录 OneDrive' }}</button>
            </template>
          </div>
        </div>

        <div class="nsh-field">
          <label class="nsh-label">加密口令</label>
          <div class="nsh-control">
            <div class="nsh-input-wrap">
              <input
                v-model="syncConfig.passphrase"
                class="nsh-input"
                :type="reveal.pass ? 'text' : 'password'"
                placeholder="强烈建议设置：图床密钥会以密文存放在同步后端"
                autocomplete="new-password"
                @change="onPassphraseChange"
              />
              <button class="nsh-eye" @click="reveal.pass = !reveal.pass">{{ reveal.pass ? '隐藏' : '显示' }}</button>
            </div>
            <div class="nsh-help">AES-256-GCM 端到端加密，口令只保存在本机；各设备需填写相同口令，遗忘无法找回</div>
          </div>
        </div>
      </div>

      <div class="nsh-row">
        <div class="nsh-row-text">
          <div>自动同步</div>
          <div class="nsh-help">修改后 3 秒自动推送；页面切回前台时拉取；自建服务额外支持实时推送</div>
        </div>
        <button class="nsh-switch" :class="{ on: syncConfig.auto }" @click="syncConfig.auto = !syncConfig.auto" />
      </div>
      <div v-if="syncConfig.auto" class="nsh-field nsh-mt-sm">
        <label class="nsh-label">定时拉取</label>
        <div class="nsh-control">
          <select v-model.number="syncConfig.intervalMin" class="nsh-select nsh-interval">
            <option :value="5">每 5 分钟</option>
            <option :value="10">每 10 分钟</option>
            <option :value="30">每 30 分钟</option>
            <option :value="60">每小时</option>
          </select>
        </div>
      </div>

      <div class="nsh-sync-status" :class="{ err: !!syncConfig.lastError }">
        <div>
          <b>{{ syncState.running ? '同步中…' : syncState.status || '待同步' }}</b>
          <span class="nsh-sub"> · 上次同步：{{ lastSync }}</span>
        </div>
        <div v-if="syncConfig.lastError" class="nsh-sync-error">{{ syncConfig.lastError }}</div>
      </div>
      <div class="nsh-io-actions">
        <button class="nsh-btn primary" :disabled="syncState.running" @click="syncNow('manual')">立即同步</button>
        <span class="nsh-spacer" />
        <button class="nsh-btn ghost sm danger" @click="disable">停用同步</button>
      </div>
    </template>
  </div>
</template>

<style>
.nsh-sync-providers {
  margin-bottom: 16px;
}
.nsh-provider-card.active {
  border-color: var(--nsh-accent);
  background: var(--nsh-accent-soft);
}
.nsh-provider-card .nsh-tag {
  margin-left: 6px;
}
.nsh-sync-form {
  margin-bottom: 4px;
}
.nsh-device-code {
  padding: 10px 12px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg-sub);
  font-size: 13px;
}
.nsh-device-code b {
  display: block;
  margin: 6px 0;
  font-size: 22px;
  letter-spacing: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.nsh-device-code a {
  color: var(--nsh-accent);
}
.nsh-interval {
  width: 160px;
}
.nsh-mt-sm {
  margin-top: 10px;
}
.nsh-sync-status {
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-accent-soft);
  font-size: 13px;
}
.nsh-sync-status.err {
  background: rgba(215, 58, 73, 0.1);
}
.nsh-sync-error {
  margin-top: 4px;
  color: var(--nsh-danger);
  font-size: 12px;
  word-break: break-all;
}
</style>
