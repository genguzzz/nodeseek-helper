<script setup lang="ts">
import { computed, ref } from 'vue';
import { settings, uid, type HostProfile } from '../core/store';
import { defaultValues, detectImgBed, makeTestImage, providerById, providers, uploadFile, validateProfile, type ProviderDef } from '../core/uploaders';
import { toast } from '../core/ui';

/** 配置存储位置：代理注入版在浏览器 localStorage，油猴版在脚本存储 */
const STORAGE = __NSH_WEB__ ? '浏览器本地存储' : '油猴脚本存储';

const editingId = ref<string>(settings.activeHostId || settings.hosts[0]?.id || '');
const choosing = ref(settings.hosts.length === 0);
const showAdvanced = ref(false);
const reveal = ref<Record<string, boolean>>({});
const testing = ref(false);
const testResult = ref<{ ok: boolean; text: string } | null>(null);

const editing = computed(() => settings.hosts.find((h) => h.id === editingId.value));
const provider = computed(() => (editing.value ? providerById(editing.value.provider) : undefined));
const basicFields = computed(() => provider.value?.fields.filter((f) => !f.advanced) ?? []);
const advFields = computed(() => provider.value?.fields.filter((f) => f.advanced) ?? []);

function create(p: ProviderDef): void {
  const h: HostProfile = {
    id: uid(),
    name: p.name + (settings.hosts.some((x) => x.provider === p.id) ? ` ${settings.hosts.filter((x) => x.provider === p.id).length + 1}` : ''),
    provider: p.id,
    values: defaultValues(p),
  };
  settings.hosts.push(h);
  if (!settings.activeHostId) settings.activeHostId = h.id;
  editingId.value = h.id;
  choosing.value = false;
  showAdvanced.value = p.id === 'custom';
  testResult.value = null;
}

function select(h: HostProfile): void {
  editingId.value = h.id;
  choosing.value = false;
  testResult.value = null;
}

function setActive(h: HostProfile): void {
  settings.activeHostId = h.id;
  toast(`已切换到「${h.name}」`, 'success');
}

function duplicate(): void {
  if (!editing.value) return;
  const h: HostProfile = JSON.parse(JSON.stringify(editing.value));
  h.id = uid();
  h.name += ' 副本';
  settings.hosts.push(h);
  editingId.value = h.id;
}

function remove(): void {
  const h = editing.value;
  if (!h || !confirm(`删除图床配置「${h.name}」？`)) return;
  settings.hosts.splice(settings.hosts.indexOf(h), 1);
  if (settings.activeHostId === h.id) settings.activeHostId = settings.hosts[0]?.id ?? '';
  editingId.value = settings.hosts[0]?.id ?? '';
  choosing.value = !settings.hosts.length;
}

const detecting = ref(false);
const detectNotes = ref<string[]>([]);

/** CloudFlare-ImgBed：读取站点公开配置自动填写渠道、目录、命名与链接前缀 */
async function detect(): Promise<void> {
  const h = editing.value;
  if (!h || !String(h.values.base ?? '').trim()) {
    toast('请先填写站点地址', 'error');
    return;
  }
  detecting.value = true;
  try {
    const r = await detectImgBed(String(h.values.base));
    Object.assign(h.values, r.values);
    detectNotes.value = [`已读取：${Object.entries(r.values).map(([k, v]) => `${k}=${v}`).join('，') || '无可用配置'}`, ...r.notes];
    if (Object.keys(r.values).length) toast('已按站点配置填写', 'success');
  } catch (e) {
    detectNotes.value = [`读取失败：${(e as Error).message}`];
  } finally {
    detecting.value = false;
  }
}

async function test(): Promise<void> {
  const h = editing.value;
  if (!h) return;
  const err = validateProfile(h);
  if (err) {
    testResult.value = { ok: false, text: err };
    return;
  }
  testing.value = true;
  testResult.value = null;
  try {
    const url = await uploadFile(h, await makeTestImage());
    testResult.value = { ok: true, text: url };
  } catch (e) {
    testResult.value = { ok: false, text: (e as Error).message };
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="nsh-hosts">
    <aside class="nsh-host-list nsh-scroll">
      <div
        v-for="h in settings.hosts"
        :key="h.id"
        class="nsh-host-item"
        :class="{ active: h.id === editingId && !choosing }"
        @click="select(h)"
      >
        <button
          class="nsh-radio"
          :class="{ on: settings.activeHostId === h.id }"
          :title="settings.activeHostId === h.id ? '当前使用中' : '设为当前图床'"
          @click.stop="setActive(h)"
        />
        <div class="nsh-host-meta">
          <div class="nsh-host-name">{{ h.name }}</div>
          <div class="nsh-host-type">{{ providerById(h.provider)?.name }}</div>
        </div>
        <span v-if="settings.activeHostId === h.id" class="nsh-tag">使用中</span>
      </div>
      <button class="nsh-btn nsh-add-host" :class="{ primary: !settings.hosts.length }" @click="choosing = true">＋ 添加图床</button>
    </aside>

    <section class="nsh-host-main nsh-scroll">
      <!-- 选择图床类型 -->
      <template v-if="choosing">
        <h3 class="nsh-h3">选择图床类型</h3>
        <p class="nsh-desc">可以添加多个配置并随时切换；不在列表里的图床用「自定义 / 高级」适配。</p>
        <div class="nsh-provider-grid">
          <button v-for="p in providers" :key="p.id" class="nsh-provider-card" @click="create(p)">
            <div class="nsh-provider-title">
              {{ p.name }}<span v-if="p.badge" class="nsh-tag accent">{{ p.badge }}</span>
            </div>
            <div class="nsh-provider-desc">{{ p.desc }}</div>
          </button>
        </div>
      </template>

      <!-- 编辑配置 -->
      <template v-else-if="editing && provider">
        <div class="nsh-form-head">
          <input v-model="editing.name" class="nsh-input nsh-name-input" placeholder="配置名称" />
          <a v-if="provider.homepage" class="nsh-link" :href="provider.homepage" target="_blank" rel="noopener">{{ provider.name }} ↗</a>
        </div>
        <p class="nsh-desc">{{ provider.desc }}</p>

        <div v-for="f in basicFields" :key="f.key" class="nsh-field">
          <label class="nsh-label">{{ f.label }}<em v-if="f.required">*</em></label>
          <div class="nsh-control">
            <template v-if="f.type === 'select'">
              <select v-model="editing.values[f.key]" class="nsh-select">
                <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </template>
            <template v-else-if="f.type === 'switch'">
              <button class="nsh-switch" :class="{ on: editing.values[f.key] !== false }" @click="editing.values[f.key] = editing.values[f.key] === false" />
            </template>
            <template v-else-if="f.type === 'textarea'">
              <textarea v-model="editing.values[f.key] as string" class="nsh-textarea" :placeholder="f.placeholder" rows="3" />
            </template>
            <div v-else class="nsh-input-wrap">
              <input
                v-model="editing.values[f.key] as string"
                class="nsh-input"
                :type="f.type === 'password' && !reveal[f.key] ? 'password' : 'text'"
                :placeholder="f.placeholder"
                autocomplete="off"
                spellcheck="false"
              />
              <button v-if="f.type === 'password'" class="nsh-eye" :title="reveal[f.key] ? '隐藏' : '显示'" @click="reveal[f.key] = !reveal[f.key]">
                {{ reveal[f.key] ? '隐藏' : '显示' }}
              </button>
            </div>
            <div v-if="f.help" class="nsh-help">{{ f.help }}</div>
          </div>
        </div>

        <template v-if="advFields.length">
          <button class="nsh-adv-toggle" @click="showAdvanced = !showAdvanced">
            <span :class="{ rot: showAdvanced }">▸</span> 高级选项（{{ advFields.length }}）
          </button>
          <div v-show="showAdvanced">
            <div v-for="f in advFields" :key="f.key" class="nsh-field">
              <label class="nsh-label">{{ f.label }}</label>
              <div class="nsh-control">
                <select v-if="f.type === 'select'" v-model="editing.values[f.key]" class="nsh-select">
                  <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
                <button
                  v-else-if="f.type === 'switch'"
                  class="nsh-switch"
                  :class="{ on: editing.values[f.key] !== false }"
                  @click="editing.values[f.key] = editing.values[f.key] === false"
                />
                <textarea v-else-if="f.type === 'textarea'" v-model="editing.values[f.key] as string" class="nsh-textarea" :placeholder="f.placeholder" />
                <input v-else v-model="editing.values[f.key] as string" class="nsh-input" :placeholder="f.placeholder" spellcheck="false" />
                <div v-if="f.help" class="nsh-help">{{ f.help }}</div>
              </div>
            </div>
          </div>
        </template>

        <div v-if="detectNotes.length" class="nsh-detect-notes">
          <div v-for="n in detectNotes" :key="n">{{ n }}</div>
        </div>

        <div v-if="testResult" class="nsh-test-result" :class="testResult.ok ? 'ok' : 'err'">
          <template v-if="testResult.ok">
            <img :src="testResult.text" referrerpolicy="no-referrer" />
            <div>
              <b>测试上传成功</b>
              <a :href="testResult.text" target="_blank" rel="noopener">{{ testResult.text }}</a>
            </div>
          </template>
          <template v-else><b>测试失败：</b>{{ testResult.text }}</template>
        </div>

        <div class="nsh-form-actions">
          <button class="nsh-btn primary" :disabled="testing" @click="test">{{ testing ? '上传中…' : '测试上传' }}</button>
          <button v-if="editing.provider === 'cfimgbed'" class="nsh-btn" :disabled="detecting" @click="detect">
            {{ detecting ? '读取中…' : '读取站点配置' }}
          </button>
          <button v-if="settings.activeHostId !== editing.id" class="nsh-btn" @click="setActive(editing)">设为当前图床</button>
          <span class="nsh-spacer" />
          <button class="nsh-btn ghost sm" @click="duplicate">复制配置</button>
          <button class="nsh-btn ghost sm danger" @click="remove">删除</button>
        </div>
        <p class="nsh-help">配置自动保存，仅存储在本机（{{ STORAGE }}）。</p>
      </template>
      <div v-else class="nsh-empty">选择左侧配置进行编辑</div>
    </section>
  </div>
</template>

<style>
.nsh-hosts {
  display: flex;
  min-height: 0;
}
.nsh-host-list {
  width: 210px;
  flex: none;
  padding: 12px;
  border-right: 1px solid var(--nsh-border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nsh-host-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--nsh-radius);
  cursor: pointer;
  transition: background 0.15s;
}
.nsh-host-item:hover {
  background: var(--nsh-bg-muted);
}
.nsh-host-item.active {
  background: var(--nsh-accent-soft);
}
.nsh-host-meta {
  min-width: 0;
  flex: 1;
}
.nsh-host-name {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nsh-host-type {
  font-size: 11px;
  color: var(--nsh-text-sub);
}
.nsh-radio {
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 50%;
  border: 2px solid var(--nsh-text-faint);
  background: transparent;
  padding: 0;
  cursor: pointer;
}
.nsh-radio.on {
  border-color: var(--nsh-accent);
  box-shadow: inset 0 0 0 3px var(--nsh-bg), inset 0 0 0 8px var(--nsh-accent);
}
.nsh-tag {
  flex: none;
  font-size: 10px;
  padding: 0 6px;
  line-height: 18px;
  border-radius: 9px;
  background: var(--nsh-accent-soft);
  color: var(--nsh-accent);
}
.nsh-tag.accent {
  margin-left: 6px;
  background: linear-gradient(90deg, #ff5fa2, #ff8a3d);
  color: #fff;
}
.nsh-add-host {
  margin-top: 6px;
}
.nsh-host-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  padding: 18px 22px;
  overflow-y: auto;
}
.nsh-h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.nsh-desc {
  margin: 0 0 16px;
  color: var(--nsh-text-sub);
  font-size: 12px;
}
.nsh-provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}
.nsh-provider-card {
  text-align: left;
  padding: 12px 14px;
  border-radius: var(--nsh-radius);
  border: 1px solid var(--nsh-border);
  background: var(--nsh-bg);
  color: var(--nsh-text);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.nsh-provider-card:hover {
  border-color: var(--nsh-accent);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}
.nsh-provider-title {
  font-weight: 600;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
}
.nsh-provider-desc {
  font-size: 12px;
  color: var(--nsh-text-sub);
  line-height: 1.5;
}
.nsh-form-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
.nsh-name-input {
  max-width: 260px;
  font-weight: 600;
  font-size: 15px;
  border-color: transparent;
  padding-left: 4px;
}
.nsh-name-input:hover {
  border-color: var(--nsh-border);
}
.nsh-link {
  font-size: 12px;
  color: var(--nsh-accent);
  text-decoration: none;
}
.nsh-field {
  display: flex;
  gap: 14px;
  margin-bottom: 12px;
}
.nsh-label {
  width: 110px;
  flex: none;
  padding-top: 7px;
  font-size: 13px;
  color: var(--nsh-text-sub);
  text-align: right;
}
.nsh-label em {
  color: var(--nsh-danger);
  font-style: normal;
  margin-left: 2px;
}
.nsh-control {
  flex: 1;
  min-width: 0;
}
.nsh-control > .nsh-switch {
  margin-top: 7px;
}
.nsh-input-wrap {
  position: relative;
}
.nsh-input-wrap .nsh-input {
  padding-right: 48px;
}
.nsh-eye {
  position: absolute;
  right: 4px;
  top: 4px;
  height: 26px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--nsh-text-sub);
  font-size: 12px;
  cursor: pointer;
}
.nsh-help {
  margin-top: 4px;
  font-size: 12px;
  color: var(--nsh-text-faint);
}
.nsh-adv-toggle {
  margin: 4px 0 12px 124px;
  border: none;
  background: none;
  color: var(--nsh-text-sub);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.nsh-adv-toggle span {
  display: inline-block;
  transition: transform 0.2s;
}
.nsh-adv-toggle span.rot {
  transform: rotate(90deg);
}
.nsh-form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0 8px 124px;
}
.nsh-spacer {
  flex: 1;
}
.nsh-detect-notes {
  margin: 12px 0 0 124px;
  padding: 8px 12px;
  border-radius: var(--nsh-radius);
  background: var(--nsh-bg-sub);
  font-size: 12px;
  color: var(--nsh-text-sub);
  line-height: 1.8;
}
.nsh-test-result {
  margin: 12px 0 0 124px;
  padding: 10px 12px;
  border-radius: var(--nsh-radius);
  font-size: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  word-break: break-all;
}
.nsh-test-result.ok {
  background: var(--nsh-accent-soft);
}
.nsh-test-result.ok a {
  display: block;
  color: var(--nsh-accent);
}
.nsh-test-result.err {
  background: rgba(215, 58, 73, 0.1);
  color: var(--nsh-danger);
}
.nsh-test-result img {
  width: 72px;
  height: 36px;
  object-fit: cover;
  border-radius: 4px;
  flex: none;
}
@media (max-width: 720px) {
  .nsh-hosts {
    flex-direction: column;
  }
  .nsh-host-list {
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--nsh-border);
    flex-direction: row;
    overflow-x: auto;
    max-height: none;
  }
  .nsh-host-item {
    flex: none;
  }
  .nsh-field {
    flex-direction: column;
    gap: 4px;
  }
  .nsh-label {
    text-align: left;
    width: auto;
    padding-top: 0;
  }
  .nsh-adv-toggle,
  .nsh-detect-notes,
  .nsh-form-actions,
  .nsh-test-result {
    margin-left: 0;
  }
  .nsh-host-list {
    padding: 8px;
    gap: 6px;
  }
  .nsh-host-item {
    padding: 6px 10px;
  }
  .nsh-add-host {
    margin-top: 0;
    flex: none;
  }
  .nsh-host-main {
    padding: 14px;
  }
  .nsh-provider-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .nsh-provider-card {
    padding: 10px 12px;
  }
  .nsh-form-head {
    flex-wrap: wrap;
    gap: 4px;
  }
  .nsh-name-input {
    max-width: none;
  }
  .nsh-form-actions {
    flex-wrap: wrap;
  }
  .nsh-form-actions .nsh-spacer {
    display: none;
  }
}
</style>
