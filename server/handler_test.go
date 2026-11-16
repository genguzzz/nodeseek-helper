package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testToken = "test-token-0123456789"

func newTestServer(t *testing.T, dir string) (*httptest.Server, *Store) {
	t.Helper()
	if dir == "" {
		dir = t.TempDir()
	}
	store, err := NewStore(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	h := NewServer(Config{Tokens: map[string]bool{testToken: true}, MaxBody: 1024, MaxWatchers: 4, Quiet: true}, store)
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	return ts, store
}

func do(t *testing.T, method, url string, body string, headers map[string]string) *http.Response {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req, _ := http.NewRequest(method, url, rd)
	req.Header.Set("Authorization", "Bearer "+testToken)
	for k, v := range headers {
		if v == "" {
			req.Header.Del(k)
			continue
		}
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func readAll(t *testing.T, r *http.Response) string {
	t.Helper()
	b, _ := io.ReadAll(r.Body)
	return string(b)
}

func TestAuth(t *testing.T) {
	ts, _ := newTestServer(t, "")
	if r := do(t, "GET", ts.URL+"/v1/sync", "", map[string]string{"Authorization": ""}); r.StatusCode != 401 {
		t.Fatalf("缺少令牌应 401，实际 %d", r.StatusCode)
	}
	if r := do(t, "GET", ts.URL+"/v1/sync", "", map[string]string{"Authorization": "Bearer wrong"}); r.StatusCode != 401 {
		t.Fatalf("错误令牌应 401，实际 %d", r.StatusCode)
	}
	if r := do(t, "GET", ts.URL+"/v1/sync", "", nil); r.StatusCode != 404 {
		t.Fatalf("尚无数据应 404，实际 %d", r.StatusCode)
	}
}

func TestPutGetConditional(t *testing.T) {
	ts, _ := newTestServer(t, "")
	body := `{"format":"nsh-sync-envelope/1","data":"x"}`
	r := do(t, "PUT", ts.URL+"/v1/sync", body, map[string]string{"If-None-Match": "*"})
	if r.StatusCode != 200 {
		t.Fatalf("创建应 200，实际 %d %s", r.StatusCode, readAll(t, r))
	}
	etag := r.Header.Get("ETag")
	if etag == "" || !strings.HasPrefix(etag, `"`) {
		t.Fatalf("ETag 格式不对：%q", etag)
	}
	g := do(t, "GET", ts.URL+"/v1/sync", "", nil)
	if g.StatusCode != 200 || readAll(t, g) != body || g.Header.Get("ETag") != etag || g.Header.Get("X-Updated-At") == "" {
		t.Fatalf("读取结果不一致：%d", g.StatusCode)
	}
	if r := do(t, "GET", ts.URL+"/v1/sync", "", map[string]string{"If-None-Match": etag}); r.StatusCode != 304 {
		t.Fatalf("未变化应 304，实际 %d", r.StatusCode)
	}
	if r := do(t, "HEAD", ts.URL+"/v1/sync", "", nil); r.StatusCode != 200 || r.Header.Get("ETag") != etag {
		t.Fatalf("HEAD 应返回 ETag")
	}
	// 再次以「不存在」为前提创建 → 412
	if r := do(t, "PUT", ts.URL+"/v1/sync", body, map[string]string{"If-None-Match": "*"}); r.StatusCode != 412 {
		t.Fatalf("已存在时 If-None-Match:* 应 412，实际 %d", r.StatusCode)
	}
	// 过期版本 → 412 并给出当前 ETag
	stale := do(t, "PUT", ts.URL+"/v1/sync", `{"v":2}`, map[string]string{"If-Match": `"deadbeef"`})
	if stale.StatusCode != 412 || stale.Header.Get("ETag") != etag {
		t.Fatalf("过期版本应 412 且带当前 ETag，实际 %d %q", stale.StatusCode, stale.Header.Get("ETag"))
	}
	// 缺少 If-Match → 412
	if r := do(t, "PUT", ts.URL+"/v1/sync", `{"v":2}`, nil); r.StatusCode != 412 {
		t.Fatalf("已存在时缺少 If-Match 应 412，实际 %d", r.StatusCode)
	}
	ok := do(t, "PUT", ts.URL+"/v1/sync", `{"v":2}`, map[string]string{"If-Match": etag})
	if ok.StatusCode != 200 || ok.Header.Get("ETag") == etag {
		t.Fatalf("正确版本应写入成功并更新 ETag")
	}
	var res struct {
		Etag      string `json:"etag"`
		UpdatedAt int64  `json:"updatedAt"`
		Size      int64  `json:"size"`
	}
	_ = json.NewDecoder(ok.Body).Decode(&res)
	if res.Etag != ok.Header.Get("ETag") || res.Size != 7 || res.UpdatedAt == 0 {
		t.Fatalf("响应体不正确：%+v", res)
	}
}

func TestBodyValidation(t *testing.T) {
	ts, _ := newTestServer(t, "")
	big := "{" + strings.Repeat(" ", 2000) + "}"
	if r := do(t, "PUT", ts.URL+"/v1/sync", big, nil); r.StatusCode != 413 {
		t.Fatalf("超限应 413，实际 %d", r.StatusCode)
	}
	if r := do(t, "PUT", ts.URL+"/v1/sync", "not json", nil); r.StatusCode != 400 {
		t.Fatalf("非 JSON 应 400，实际 %d", r.StatusCode)
	}
	if r := do(t, "PUT", ts.URL+"/v1/sync", "  \n {}", nil); r.StatusCode != 200 {
		t.Fatalf("前导空白的 JSON 应接受，实际 %d", r.StatusCode)
	}
}

func TestWatch(t *testing.T) {
	ts, _ := newTestServer(t, "")
	first := do(t, "PUT", ts.URL+"/v1/sync", `{"a":1}`, nil)
	etag := first.Header.Get("ETag")
	// 超时 → 304
	start := time.Now()
	if r := do(t, "GET", ts.URL+"/v1/sync/watch?timeout=1&etag="+etag, "", nil); r.StatusCode != 304 {
		t.Fatalf("超时应 304，实际 %d", r.StatusCode)
	}
	if time.Since(start) < 900*time.Millisecond {
		t.Fatal("watch 应该等待到超时")
	}
	// 版本不同 → 立即返回
	if r := do(t, "GET", ts.URL+"/v1/sync/watch?timeout=5&etag=%22old%22", "", nil); r.StatusCode != 200 {
		t.Fatalf("版本不同应立即 200，实际 %d", r.StatusCode)
	}
	// 并发写入 → 唤醒
	done := make(chan *http.Response, 1)
	go func() {
		done <- do(t, "GET", ts.URL+"/v1/sync/watch?timeout=10&etag="+etag, "", nil)
	}()
	time.Sleep(200 * time.Millisecond)
	start = time.Now()
	do(t, "PUT", ts.URL+"/v1/sync", `{"a":2}`, map[string]string{"If-Match": etag})
	select {
	case r := <-done:
		if r.StatusCode != 200 || time.Since(start) > 2*time.Second {
			t.Fatalf("写入后应立即唤醒，实际 %d", r.StatusCode)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("watch 未被唤醒")
	}
}

func TestDeleteAndOptions(t *testing.T) {
	ts, _ := newTestServer(t, "")
	do(t, "PUT", ts.URL+"/v1/sync", `{}`, nil)
	if r := do(t, "DELETE", ts.URL+"/v1/sync", "", nil); r.StatusCode != 204 {
		t.Fatalf("删除应 204，实际 %d", r.StatusCode)
	}
	if r := do(t, "GET", ts.URL+"/v1/sync", "", nil); r.StatusCode != 404 {
		t.Fatalf("删除后应 404，实际 %d", r.StatusCode)
	}
	req, _ := http.NewRequest("OPTIONS", ts.URL+"/v1/sync", nil)
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	if r.StatusCode != 204 || r.Header.Get("Access-Control-Allow-Origin") != "*" || !strings.Contains(r.Header.Get("Access-Control-Expose-Headers"), "ETag") {
		t.Fatalf("预检应 204 且带 CORS 头，实际 %d", r.StatusCode)
	}
}

func TestRestartRebuildsMeta(t *testing.T) {
	dir := t.TempDir()
	ts, _ := newTestServer(t, dir)
	etag := do(t, "PUT", ts.URL+"/v1/sync", `{"keep":true}`, nil).Header.Get("ETag")
	ts.Close()
	ts2, _ := newTestServer(t, dir)
	r := do(t, "GET", ts2.URL+"/v1/sync", "", nil)
	if r.StatusCode != 200 || r.Header.Get("ETag") != etag || readAll(t, r) != `{"keep":true}` {
		t.Fatalf("重启后元数据应一致：%d %q", r.StatusCode, r.Header.Get("ETag"))
	}
}

func TestOpenMode(t *testing.T) {
	store, _ := NewStore(t.TempDir(), 10)
	ts := httptest.NewServer(NewServer(Config{Open: true, MaxBody: 1024, MaxWatchers: 4, Quiet: true}, store))
	defer ts.Close()
	req, _ := http.NewRequest("GET", ts.URL+"/v1/sync", nil)
	req.Header.Set("Authorization", "Bearer short")
	r, _ := http.DefaultClient.Do(req)
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatalf("开放模式下过短令牌应 401，实际 %d", r.StatusCode)
	}
	req.Header.Set("Authorization", "Bearer "+strings.Repeat("k", 16))
	r, _ = http.DefaultClient.Do(req)
	r.Body.Close()
	if r.StatusCode != 404 {
		t.Fatalf("开放模式下合法令牌应可访问，实际 %d", r.StatusCode)
	}
}

// 经过 Cloudflare 等 CDN 时客户端拿到的是弱 ETag（W/"…"），条件写入与长轮询都要认
func TestWeakETagFromCDN(t *testing.T) {
	ts, _ := newTestServer(t, "")
	res := do(t, "PUT", ts.URL+"/v1/sync", `{"a":1}`, map[string]string{"If-None-Match": "*"})
	etag := res.Header.Get("ETag")
	if res.StatusCode != 200 || etag == "" {
		t.Fatalf("首次写入失败 %d", res.StatusCode)
	}
	g := do(t, "GET", ts.URL+"/v1/sync", "", nil)
	if !strings.Contains(g.Header.Get("Cache-Control"), "no-transform") {
		t.Fatalf("GET 应带 no-transform，避免 CDN 改写 ETag：%q", g.Header.Get("Cache-Control"))
	}
	if r := do(t, "GET", ts.URL+"/v1/sync", "", map[string]string{"If-None-Match": "W/" + etag}); r.StatusCode != 304 {
		t.Fatalf("弱 ETag 的 If-None-Match 应为 304，得到 %d", r.StatusCode)
	}
	if r := do(t, "GET", ts.URL+"/v1/sync/watch?timeout=1&etag="+url.QueryEscape("W/"+etag), "", nil); r.StatusCode != 304 {
		t.Fatalf("弱 ETag 的长轮询应等待到超时（304），得到 %d", r.StatusCode)
	}
	if r := do(t, "PUT", ts.URL+"/v1/sync", `{"a":2}`, map[string]string{"If-Match": "W/" + etag}); r.StatusCode != 200 {
		t.Fatalf("弱 ETag 的 If-Match 应能写入，得到 %d", r.StatusCode)
	}
}
