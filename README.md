# NodeSeek 助手（油猴脚本）

基于 [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey) + Vue 3 + TypeScript。

## 功能
- **粘贴 / 拖拽图片自动上传**：回复、发帖编辑器（CodeMirror）里 Ctrl+V 截图或拖入图片，先插入占位，上传完成后替换为 Markdown；工具栏和编辑器右上角各有一个上传按钮。
- **多图床配置**，可同时保存多个并一键切换，带「测试上传」：
  CloudFlare-ImgBed（MarSeventh）、兰空 Lsky Pro v1/v2、EasyImage 2.0、Chevereto、NodeImage、SM.MS、Imgur、PicList/PicGo 本地服务、**自定义**（URL / 方法 / 请求头 / 表单字段 / binary 请求体 / 返回值 JSON 路径 / URL 前缀）。
- 可选的上传前压缩（WebP/JPEG、质量、最大宽度）和插入模板（`{url}` `{name}`）。
- **表情包**：Markdown 工具栏里的笑脸按钮弹出表情面板（工具栏隐藏时在编辑器右上角），分组、收藏、最近、搜索；动图默认静止，悬浮播放并显示大图预览（移动端长按）；Shift+点击可连续插入。
- **表情管理**：分组（新建 / 重命名 / 图标 / 拖动排序）、拖动卡片排序、拖到分组即可移动、按使用次数 / 最近 / 添加时间 / 名称排序并可保存为自定义顺序、批量收藏 / 移动 / 删除、批量导入（链接 / Markdown / HTML / 整段帖子 / 本地图片经图床上传 / JSON 备份）、导出备份。
- 内置「花火」表情分组（来源 https://www.nodeseek.com/post-472759-1）。
- 帖子内悬浮图片可一键「收藏为表情」；上传记录可复制链接或设为表情。
- 入口：右下角快捷按钮组（回到顶部上方）的「助手」按钮（表情包管理 / 图床 / 上传记录 / 通用），顶部导航花火图标、编辑器右上角齿轮、油猴菜单。
- CloudFlare-ImgBed「读取站点配置」：自动读取 `/api/userConfig`、`/api/channels`、`/api/auth/sessionCheck`，填好渠道、目录、命名方式、链接前缀，并提示是否需要认证码。
- **配置导入 / 导出**（通用页）：完整配置、`{"hosts":[...]}` 或单个图床对象均可导入，用于在油猴版与代理版之间迁移。
- UI 直接使用站点 CSS 变量（`--main-color`、`--bg-main-color` 等），跟随 `body.dark-layout` 日/夜切换。

## 产物（同一份代码，多种运行方式）
`npm run build` 一次生成：

| 文件 | 用途 |
|---|---|
| `nodeseek-helper.user.js` | Tampermonkey / Violentmonkey 用户脚本 |
| `nodeseek-helper.inject.js` | 代理注入版（Vue 与样式已内置，GM API 换成 localStorage + 同源中转） |
| `nsh-proxy.js` | 代理通用脚本：改写 HTML 注入、提供 `/__nsh/app.js`、`/__nsh/relay` 上传中转 |
| `nodeseek-helper.sgmodule` | Surge 模块 |
| `nodeseek-helper.snippet` | Quantumult X 重写片段 |
| `nodeseek-helper.plugin` | Loon 插件 |
| `nodeseek-helper.stoverride` | Stash 覆写 |

代理版需要 MITM `nodeseek.com` / `deepflood.com`。发布前设置 dist 的公开地址再构建：
```bash
NSH_PUBLISH_BASE=https://cdn.jsdelivr.net/gh/<github-user>/nodeseek-helper@main/dist npm run build
```
代理环境没有跨域能力，图床请求经同源 `/__nsh/relay` 交给代理脚本转发；代理版的配置存在站点 localStorage，与油猴版互不相通，用「配置导入 / 导出」迁移。

## 开发
```bash
npm install
npm run dev     # 浏览器打开 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js 安装一次，之后改代码页面自动热更新
npm run build   # 产物 dist/nodeseek-helper.user.js
npm run typecheck
```
本地无登录态调试：`node dev/mock-server.mjs` 后打开：
- http://localhost:5299/dev/mock.html：油猴版（GM API 用 localStorage 模拟）
- http://localhost:5299/dev/proxied.html：代理版，页面与 `/__nsh/*` 都经真实的 `dist/nsh-proxy.js` 处理（`dev/proxy-sim.mjs` 模拟 Surge 的 `$httpClient`；`NSH_SIM=qx` 切换为 Quantumult X 的 `$task`）。构建时设 `NSH_PUBLISH_BASE=http://localhost:5299/dist`。

模拟 ImgBed 的 `/upload` 认证码为 `test-code`。个人图床配置放在 `presets/`（已 gitignore），在「通用 → 配置导入」中导入。

## 目录
- `src/core/uploaders.ts`：图床定义（字段 schema + 请求构造 + 响应解析），新增图床只需追加一项
- `src/core/editor.ts`：编辑器注入（粘贴、拖拽、工具栏上传 / 表情按钮）
- `src/core/fastnav.ts`：右下角快捷按钮
- `src/platform/web.ts`：代理版的 GM API 适配（`$` 在注入构建中指向它）
- `proxy/nsh-proxy.js`、`scripts/build-proxy.mjs`：代理脚本模板与模块生成
- `src/core/store.ts`：GM 存储（多标签页同步）、表情数据操作
- `src/core/packs.ts`：内置表情包与花火图标
- `src/components/`：选择面板、管理面板、图床设置等
