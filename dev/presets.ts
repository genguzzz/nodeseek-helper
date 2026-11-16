import fs from 'node:fs';

/**
 * 读取本地 presets/*.json（已 gitignore）里出现的域名：图床配置的各类地址与同步服务地址。
 * 写进 @connect 后，Tampermonkey 对这些域名直接放行，不再逐个弹跨域确认；个人域名不会进入公共代码。
 */
export function presetConnectHosts(dir = 'presets'): string[] {
  if (!fs.existsSync(dir)) return [];
  const hosts = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const json = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
      const list = [...(json.hosts ?? json.settings?.hosts ?? []), ...(json.sync ? [{ values: json.sync }] : [])];
      for (const h of list) {
        for (const v of Object.values(h.values ?? {})) {
          if (typeof v === 'string' && /^https?:\/\//.test(v)) hosts.add(new URL(v).hostname);
        }
      }
    } catch {
      /* 忽略无效文件 */
    }
  }
  return [...hosts].sort();
}
