// 录制演示用：把页面上显示的私人域名临时替换成示例域名（只改显示，不改数据），刷新页面即失效。
// 用法（在页面控制台或自动化脚本中注入）：
//   <本文件内容>; __nshDemoMask({ 'img.my-domain.com': 'img.example.com' })
window.__nshDemoMask = (map) => {
  const entries = Object.entries(map);
  const mask = (s) => entries.reduce((acc, [from, to]) => acc.split(from).join(to), s);
  const needs = (s) => typeof s === 'string' && entries.some(([from]) => s.includes(from));
  const fixNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (needs(node.nodeValue)) node.nodeValue = mask(node.nodeValue);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    // 输入框只改显示值，不触发 input 事件，避免写回配置
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && needs(el.value)) el.value = mask(el.value);
    for (const attr of ['href', 'title', 'src']) if (needs(el.getAttribute?.(attr))) el.setAttribute(attr, mask(el.getAttribute(attr)));
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (needs(n.nodeValue)) n.nodeValue = mask(n.nodeValue);
      } else if ((n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') && needs(n.value)) {
        n.value = mask(n.value);
      }
    }
  };
  window.__nshDemoMaskObserver?.disconnect();
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixNode(m.target);
      m.addedNodes.forEach(fixNode);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.__nshDemoMaskObserver = mo;
  fixNode(document.body);
  // 输入框的值在聚焦 / 切换面板时可能被 Vue 重设，定时补一次
  clearInterval(window.__nshDemoMaskTimer);
  window.__nshDemoMaskTimer = setInterval(() => document.querySelectorAll('input, textarea').forEach(fixNode), 300);
  return 'masking on';
};
