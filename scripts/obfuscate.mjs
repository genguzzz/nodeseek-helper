// 发布构建的 JS 混淆：仅在 NSH_OBFUSCATE=1 时执行（发布流水线设置），本地开发保持可读。
// 油猴脚本保留 ==UserScript== 头部原样（油猴靠它识别与自动更新），只混淆其后的代码。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

/** 兼顾体积与运行性能：不做控制流平坦化 / 死代码注入 / 自我保护（明显拖慢且容易被格式化破坏） */
const OPTIONS = {
  compact: true,
  target: 'browser',
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  splitStrings: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

function obfuscateFile(file, keepHeader) {
  const src = fs.readFileSync(path.join(dist, file), 'utf8');
  let header = '';
  let code = src;
  if (keepHeader) {
    const end = src.indexOf('// ==/UserScript==');
    if (end < 0) throw new Error(`${file} 缺少 UserScript 头部`);
    const cut = src.indexOf('\n', end) + 1;
    header = src.slice(0, cut);
    code = src.slice(cut);
  }
  const out = JavaScriptObfuscator.obfuscate(code, OPTIONS).getObfuscatedCode();
  fs.writeFileSync(path.join(dist, file), `${header}\n${out}\n`);
  console.log(`obfuscated ${file}: ${(src.length / 1024).toFixed(0)}KB → ${((header.length + out.length) / 1024).toFixed(0)}KB`);
}

if (process.env.NSH_OBFUSCATE === '1') {
  obfuscateFile('nodeseek-helper.user.js', true);
  obfuscateFile('nodeseek-helper.inject.js', false);
} else {
  console.log('skip obfuscation (set NSH_OBFUSCATE=1 to enable)');
}
