#!/usr/bin/env bash
# 通过 AppleScript 驱动 Arc 中的 Tampermonkey：自动安装 / 卸载 / 列出用户脚本（本地调试用，仅 macOS + Arc）
#
#   bash scripts/tm.sh list
#   bash scripts/tm.sh install  <脚本 URL>      # 打开安装页并自动确认（安装 / 重新安装 / 更新）
#   bash scripts/tm.sh uninstall <脚本名称>     # 按名称精确匹配删除（进入 Tampermonkey 回收站，可恢复）
#   bash scripts/tm.sh dev                      # 卸载旧的开发加载器，安装稳定开发加载器
set -euo pipefail

ARC_EXT_DIR="$HOME/Library/Application Support/Arc/User Data/Default/Extensions"
DEV_LOADER_URL="${NSH_DEV_LOADER_URL:-http://127.0.0.1:5173/nsh-dev.user.js}"

# 按 manifest 名称找到 Tampermonkey 的扩展 ID
tm_id() {
  for d in "$ARC_EXT_DIR"/*; do
    m=$(ls -d "$d"/*/ 2>/dev/null | tail -1)
    [ -f "$m/_locales/en/messages.json" ] && grep -q '"Tampermonkey' "$m/_locales/en/messages.json" && { basename "$d"; return; }
  done
  echo "未找到 Tampermonkey 扩展" >&2
  exit 1
}

# 在 URL 包含 $1 的 Arc 标签页里直接执行 JS（$2）。
# 注意：扩展页面的 CSP 禁止 eval，这里把源码转义成 AppleScript 字符串原样执行，不经过 eval。
run_js() {
  local script
  script=$(python3 - "$1" "$2" <<'PY'
import sys
frag, js = sys.argv[1], sys.argv[2]
esc = lambda x: x.replace('\\', '\\\\').replace('"', '\\"')
print(f'''tell application "Arc"
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t contains "{esc(frag)}" then return (execute t javascript "{esc(js)}")
    end repeat
  end repeat
  return "NO_TAB"
end tell''')
PY
)
  # Arc 把 JS 返回值按 JSON 编码返回，这里解码成纯文本
  osascript -e "$script" | python3 -c 'import json,sys
s=sys.stdin.read().strip()
try: v=json.loads(s)
except Exception: v=s
print(v if isinstance(v,str) else json.dumps(v))'
}

open_tab() { osascript -e "tell application \"Arc\" to tell front window to make new tab with properties {URL:\"$1\"}" >/dev/null; }

close_tabs() {
  # 倒序遍历：关闭标签后下标会前移
  osascript <<EOF >/dev/null
tell application "Arc"
  repeat with w in windows
    set n to count of tabs of w
    repeat with i from n to 1 by -1
      if URL of tab i of w contains "$1" then close tab i of w
    end repeat
  end repeat
end tell
EOF
}

# 等待某个 URL 的标签页出现且 JS 条件为真
wait_for() {
  local frag=$1 cond=$2 i
  for i in $(seq 1 30); do
    [ "$(run_js "$frag" "String(!!($cond))" 2>/dev/null)" = "true" ] && return 0
    sleep 0.5
  done
  return 1
}

dashboard() {
  local id=$1
  close_tabs "$id/options.html"
  open_tab "chrome-extension://$id/options.html#nav=dashboard"
  wait_for "$id/options.html" "document.querySelectorAll('tr.scripttr').length > 0" || { echo "打开 Tampermonkey 管理面板超时" >&2; exit 1; }
}

cmd_list() {
  local id; id=$(tm_id)
  dashboard "$id"
  run_js "$id/options.html" "[...document.querySelectorAll('tr.scripttr')].map(r => r.querySelector('[title=Delete]') ? [...r.cells].map(c => c.innerText.trim()).filter(Boolean).slice(1, 3).join('  ') : '').filter(Boolean).join('\n')"
  echo
  close_tabs "$id/options.html"
}

cmd_uninstall() {
  local name=$1 id; id=$(tm_id)
  dashboard "$id"
  local n
  n=$(run_js "$id/options.html" "
    window.confirm = () => true;
    const rows = [...document.querySelectorAll('tr.scripttr')].filter(r => r.querySelector('[title=Delete]') && [...r.cells].some(c => c.innerText.trim() === $(printf '%s' "$name" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')));
    rows.forEach(r => r.querySelector('[title=Delete]').click());
    String(rows.length)")
  sleep 1
  echo "已删除 ${n} 个「${name}」"
  close_tabs "$id/options.html"
}

cmd_install() {
  local url=$1 id; id=$(tm_id)
  if ! curl -sf -o /dev/null -m 5 "$url"; then
    echo "无法访问 $url（开发加载器需要先运行 npm run dev）" >&2
    exit 1
  fi
  close_tabs "$id/ask.html"
  open_tab "$url"
  wait_for "$id/ask.html" "[...document.querySelectorAll('input[type=button],button')].some(b => /^(Install|Reinstall|Update|安装|重新安装|更新)\$/.test((b.value || b.innerText).trim()))" \
    || { echo "未出现 Tampermonkey 安装确认页（URL 是否返回用户脚本？）" >&2; exit 1; }
  local label
  label=$(run_js "$id/ask.html" "
    const b = [...document.querySelectorAll('input[type=button],button')].find(b => /^(Install|Reinstall|Update|安装|重新安装|更新)\$/.test((b.value || b.innerText).trim()));
    b.click(); (b.value || b.innerText).trim()")
  sleep 1
  close_tabs "$id/ask.html"
  # 安装前跳转的中转页（tampermonkey.net/script_installation.php）一并关闭
  close_tabs "script_installation.php"
  close_tabs "$url"
  echo "已${label}：$url"
}

case "${1:-}" in
  list) cmd_list ;;
  install) cmd_install "${2:?缺少脚本 URL}" ;;
  uninstall) cmd_uninstall "${2:?缺少脚本名称}" ;;
  dev)
    cmd_uninstall "server:NodeSeek 助手"
    cmd_install "$DEV_LOADER_URL"
    ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
