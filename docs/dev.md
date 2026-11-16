# 油猴脚本开发调试

目标：**装一次加载器，之后只管写代码**。保存即在浏览器生效，dev server 重启、改配置都不用重新安装，也不用手动点「安装」。

## 日常流程

```bash
npm run dev           # 启动 dev server，终端会打印加载器地址
npm run dev:install   # 首次：自动把「NodeSeek 助手 · 开发」装进 Arc 的 Tampermonkey
```

之后打开 NodeSeek 任意页面即可：

- 改 `.vue` 组件：热替换，页面不刷新、状态保留。
- 改 `.ts`：Vite 自动整页刷新。
- dev server 没启动时，页面控制台会提示 `无法连接本地 dev server`，而不是静默失败。

其他命令：

```bash
npm run tm:list                         # 列出 Tampermonkey 里的脚本
npm run tm:uninstall -- "脚本名称"       # 按名称精确匹配删除（进回收站，可恢复）
bash scripts/tm.sh install <脚本 URL>    # 安装任意脚本并自动确认
```

## 原理

```
Tampermonkey                      页面                          本地 dev server（Vite）
┌─────────────────────┐   ① 注入   ┌──────────────────────┐   ② import   ┌──────────────────┐
│ NodeSeek 助手 · 开发 │ ────────▶ │ <script type=module> │ ───────────▶ │ /src/main.ts …    │
│（固定头部 + 固定 key）│           │  document[KEY] = GM  │ ◀─── HMR ─── │ @vite/client      │
└─────────────────────┘           └──────────────────────┘              └──────────────────┘
```

1. 加载器（`/nsh-dev.user.js`，由 `dev/dev-loader.ts` 生成）在 `document-start` 运行，把油猴授予的 `GM_*` 收集成对象，挂到 `document["__monkeyWindow-nsh-dev"]`，再插入一个指向 dev server 的 `<script type="module">`。
2. 页面里的开发代码通过 `$`（vite-plugin-monkey 的客户端）从这个固定 key 取 GM API，Vite 的 HMR 照常工作。

### 和常见开源方案的差异

| 方案 | 安装 | 热更新 | 已知问题 |
|---|---|---|---|
| [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey) 自带加载器 | 安装一次 | Vite HMR | GM 桥接 key = 脚本头部的 md5：头部任何变化（`@connect`、`@run-at`…）后，已装的加载器对不上 key，`GM_*` 全部 undefined，只能重装 |
| [vite-userscript-plugin](https://github.com/greasify/vite-userscript-plugin) | 安装一次 `.dev.user.js` | 页面刷新 / HMR | `server.file` 模式没有 HMR |
| [webpack-monkey](https://github.com/guansss/webpack-monkey) | 安装一次 | 整个脚本重载 | webpack 生态 |
| **本项目** | 安装一次，`npm run dev:install` 自动完成 | Vite HMR | — |

本项目在 vite-plugin-monkey 之上做了三处改动（`dev/dev-loader.ts`）：

- **固定 key**：开发模式下把客户端代码里的 `__MONKEY_WINDOW_KEY__` 换成固定值，加载器头部变不变都对得上。
- **显式传递 GM API**：新版 Tampermonkey 的 `GM_*` 是脚本作用域变量，不在沙箱 `window` 上；加载器显式收集后用 Proxy 叠加到 `window` 交给页面。
- **宽授权**：加载器一次性授予全部常用 GM API 与 `@connect *`，以后代码用到新 API 也不用重装；`presets/*.json` 里的个人域名也写进 `@connect`，避免逐个弹跨域确认。

只有加载器**自身的代码**变化时才需要重装（极少），`npm run dev:install` 会自动完成。

### 自动化安装 / 卸载（`scripts/tm.sh`）

通过 AppleScript 驱动 Arc：

- 安装：打开脚本 URL → Tampermonkey 跳到确认页 → 自动点击「Install / Reinstall / Update」→ 关闭标签。
- 卸载：打开 Tampermonkey 管理面板，按名称**精确匹配**行并点击删除。
- 扩展页面的 CSP 禁止 `eval`，脚本把 JS 转义成 AppleScript 字符串原样执行；Arc 返回的 JS 结果是 JSON 编码的，统一解码。

> 仅支持 macOS + Arc。Chrome 可把 `Arc` 换成 `Google Chrome`（AppleScript 接口相同，需在「开发者」菜单允许 Apple 事件中的 JavaScript）。

## 无登录态调试

```bash
node dev/mock-server.mjs
```

- `http://localhost:5299/dev/mock.html`：模拟 NodeSeek 编辑器 + 模拟 ImgBed 上传接口（认证码 `test-code`），GM API 用 `dev/gm-shim.js` 模拟。
- `http://localhost:5299/dev/proxied.html`：代理版，页面与 `/__nsh/*` 经真实的 `dist/nsh-proxy.js` 处理；`dev/proxy-sim.mjs` 模拟 Surge 的 `$httpClient`，`NSH_SIM=qx` 模拟 Quantumult X 的 `$task`。构建时设 `NSH_PUBLISH_BASE=http://localhost:5299/dist`。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 控制台 `GM_xxx is not a function` | 加载器版本过旧：`npm run dev:install` |
| 控制台 `无法连接本地 dev server` | 没有运行 `npm run dev` |
| 请求被拦截 `Request was blocked by the user` | 曾在跨域确认中选了拒绝：把域名加入 `presets/*.json` 后 `npm run dev:install`，或在 Tampermonkey 脚本设置的 XHR 白名单里添加 |
| 改了依赖后页面仍是旧代码 | Vite 预构建依赖带强缓存：`npx vite --force` 重新预构建 |
