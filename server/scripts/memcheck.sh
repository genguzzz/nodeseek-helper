#!/usr/bin/env bash
# 内存检查：真实启动服务，做 300 轮 ~200KB 的读写（20 个空间）+ 50 个并发长轮询，RSS 必须 < 10MB
set -euo pipefail
cd "$(dirname "$0")/.."
# 目标是 Linux 部署环境 < 10MB；macOS 上 Go 运行时基线（dyld 等）多出约 3~4MB，只做参考
if [ "$(uname)" = "Darwin" ]; then LIMIT_KB=${LIMIT_KB:-14336}; else LIMIT_KB=${LIMIT_KB:-10240}; fi
TMP=$(mktemp -d)
BIN="$TMP/nsh-sync-server"
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$BIN" .
PORT=$((20000 + RANDOM % 20000))
NSH_OPEN=1 NSH_LOG=quiet NSH_ADDR="127.0.0.1:$PORT" NSH_DATA="$TMP/data" "$BIN" &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 0.1; done

# 约 200KB 的 JSON 信封
{ printf '{"format":"nsh-sync-envelope/1","data":"'; head -c 200000 /dev/zero | tr '\0' 'A'; printf '"}'; } > "$TMP/body.json"
URL="http://127.0.0.1:$PORT/v1/sync"

# 50 个并发长轮询
for i in $(seq 1 50); do
  curl -s -o /dev/null -H "Authorization: Bearer watch-token-$(printf %04d $((i % 20)))-xxxxxxxx" "$URL/watch?etag=none-$i&timeout=20" &
done

peak=0
for round in $(seq 1 15); do
  for s in $(seq 0 19); do
    tok="watch-token-$(printf %04d $s)-xxxxxxxx"
    etag=$(curl -s -D - -o /dev/null -H "Authorization: Bearer $tok" "$URL" | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
    if [ -n "$etag" ]; then hdr="If-Match: $etag"; else hdr="If-None-Match: *"; fi
    curl -s -o /dev/null -X PUT -H "Authorization: Bearer $tok" -H "$hdr" --data-binary @"$TMP/body.json" "$URL"
    curl -s -o /dev/null -H "Authorization: Bearer $tok" "$URL"
  done
  rss=$(ps -o rss= -p "$PID" | tr -d ' ')
  [ "$rss" -gt "$peak" ] && peak=$rss
done
echo "300 轮读写 + 50 个长轮询后：当前 RSS ${rss}KB，峰值 ${peak}KB（上限 ${LIMIT_KB}KB）"
if [ "$peak" -gt "$LIMIT_KB" ]; then
  echo "❌ 内存超出上限"
  exit 1
fi
echo "✅ 内存检查通过"
