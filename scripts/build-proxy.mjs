// 生成代理工具产物：通用脚本 + Surge / Loon / Quantumult X / Stash 模块
// 发布地址由 NSH_PUBLISH_BASE 指定（dist 目录对外可访问的 URL，例如 jsDelivr GitHub 链接）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const PLACEHOLDER = 'https://cdn.jsdelivr.net/gh/<github-user>/nodeseek-helper@main/dist';
const base = (process.env.NSH_PUBLISH_BASE || PLACEHOLDER).replace(/\/+$/, '');
const version = pkg.version;
const script = `${base}/nsh-proxy.js`;

const hosts = ['www.nodeseek.com', 'nodeseek.com', 'www.deepflood.com', 'deepflood.com'];
const SITE = String.raw`^https?:\/\/(www\.)?(nodeseek|deepflood)\.com`;
// 页面：路径不含扩展名，排除接口与静态资源
const PAGE = String.raw`${SITE}\/(?!__nsh\/|api\/|static\/|assets\/|cdn-cgi\/)[^.?]*(\?.*)?$`;
const NSH = String.raw`${SITE}\/__nsh\/(relay|app\.js)`;
const NAME = 'NodeSeek 助手';
const DESC = '粘贴图片自动上传图床、表情包管理与快捷发送（与油猴脚本同一份代码）';

const outputs = {
  'nsh-proxy.js': fs
    .readFileSync(path.join(root, 'proxy/nsh-proxy.js'), 'utf8')
    .replaceAll('__NSH_BASE__', base)
    .replaceAll('__NSH_VERSION__', version),

  'nodeseek-helper.sgmodule': `#!name=${NAME}
#!desc=${DESC} v${version}
#!category=NodeSeek

[Script]
nsh-inject = type=http-response,pattern=${PAGE},requires-body=1,max-size=4194304,timeout=10,script-path=${script}
nsh-relay = type=http-request,pattern=${NSH},requires-body=1,binary-body-mode=1,max-size=20971520,timeout=120,script-path=${script}

[MITM]
hostname = %APPEND% ${hosts.join(', ')}
`,

  'nodeseek-helper.plugin': `#!name=${NAME}
#!desc=${DESC} v${version}
#!icon=https://www.nodeseek.com/static/image/favicon/android-chrome-192x192.png

[Script]
http-response ${PAGE} script-path=${script}, requires-body=true, max-size=4194304, timeout=10, tag=nsh-inject
http-request ${NSH} script-path=${script}, requires-body=true, binary-body-mode=true, max-size=20971520, timeout=120, tag=nsh-relay

[MitM]
hostname = ${hosts.join(', ')}
`,

  'nodeseek-helper.snippet': `# ${NAME} · Quantumult X 重写片段 v${version}
# ${DESC}
hostname = ${hosts.join(', ')}

${PAGE} url script-response-body ${script}
${NSH} url script-analyze-echo-response ${script}
`,

  'nodeseek-helper.stoverride': `name: ${NAME}
desc: ${DESC} v${version}

http:
  mitm:
${hosts.map((h) => `    - "${h}"`).join('\n')}
  script:
    - match: ${PAGE}
      name: nsh-proxy
      type: response
      require-body: true
      max-size: 4194304
      timeout: 10
    - match: ${NSH}
      name: nsh-proxy
      type: request
      require-body: true
      binary-mode: true
      max-size: 20971520
      timeout: 120

script-providers:
  nsh-proxy:
    url: ${script}
    interval: 86400
`,
};

for (const [file, content] of Object.entries(outputs)) fs.writeFileSync(path.join(dist, file), content);
console.log(`proxy artifacts (v${version}) → dist/  base=${base}`);
if (base === PLACEHOLDER) console.warn('⚠ 未设置 NSH_PUBLISH_BASE，模块里的脚本地址是占位符，发布前请设置后重新构建');
