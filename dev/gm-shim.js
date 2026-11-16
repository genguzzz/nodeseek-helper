// 本地验证用：用 localStorage / XHR 模拟油猴 GM_* API（仅 dev/mock.html 使用，不进入产物）
(() => {
  const P = 'gmshim:';
  const listeners = {};
  window.unsafeWindow = window;
  window.GM_getValue = (k, d) => {
    const v = localStorage.getItem(P + k);
    return v == null ? d : JSON.parse(v);
  };
  window.GM_setValue = (k, v) => {
    localStorage.setItem(P + k, JSON.stringify(v));
  };
  window.GM_addValueChangeListener = (k, fn) => ((listeners[k] ??= []).push(fn), 1);
  window.GM_registerMenuCommand = (name) => console.log('[menu]', name);
  window.GM_setClipboard = (t) => navigator.clipboard?.writeText(t).catch(() => {});
  window.GM_addStyle = (css) => {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.append(s);
    return s;
  };
  window.GM_xmlhttpRequest = (d) => {
    const x = new XMLHttpRequest();
    x.open(d.method || 'GET', d.url);
    for (const [k, v] of Object.entries(d.headers || {})) x.setRequestHeader(k, v);
    if (d.upload?.onprogress) x.upload.onprogress = d.upload.onprogress;
    x.timeout = d.timeout || 0;
    x.onload = () => d.onload?.({ status: x.status, responseText: x.responseText, responseHeaders: x.getAllResponseHeaders() });
    x.onerror = () => d.onerror?.({});
    x.ontimeout = () => d.ontimeout?.({});
    x.send(d.data);
    return { abort: () => x.abort() };
  };
  window.GM_info = { script: { name: 'shim' } };
})();
