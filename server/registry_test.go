package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 用命令行登记令牌的服务（环境变量里没有令牌）
func newRegistryServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := NewStore(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	h := NewServer(Config{Tokens: map[string]bool{}, Registry: NewRegistry(dir), MaxBody: 1024, MaxWatchers: 4, Quiet: true}, store)
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	return ts, dir
}

func req(t *testing.T, method, url, token, body string, headers map[string]string) *http.Response {
	t.Helper()
	r, _ := http.NewRequest(method, url, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+token)
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

// 命令行创建同步码，取出其中的令牌
func cliAdd(t *testing.T, dir, note string) (token, id string) {
	t.Helper()
	var out, errOut bytes.Buffer
	if code := runTokenCmd([]string{"add", "-data", dir, "-url", "https://sync.example.com", "-note", note}, &out, &errOut); code != 0 {
		t.Fatalf("token add 失败：%s", errOut.String())
	}
	base, token, err := DecodeSyncCodeForTest(strings.TrimSpace(out.String()))
	if err != nil || base != "https://sync.example.com" {
		t.Fatalf("同步码无效：%v %s", err, base)
	}
	return token, spaceID(token)
}

func TestCLITokenAddIsUsableWithoutRestart(t *testing.T) {
	ts, dir := newRegistryServer(t)
	if res := req(t, "GET", ts.URL+"/v1/sync", "not-registered-token-123", "", nil); res.StatusCode != 401 {
		t.Fatalf("未登记的令牌应为 401，得到 %d", res.StatusCode)
	}
	token, _ := cliAdd(t, dir, "张三")
	time.Sleep(1100 * time.Millisecond) // 登记表最多每秒重新检查一次
	if res := req(t, "GET", ts.URL+"/v1/sync", token, "", nil); res.StatusCode != 404 {
		t.Fatalf("新登记的令牌应可访问（空空间 404），得到 %d", res.StatusCode)
	}
	// 登记表里只有哈希，没有明文令牌
	b, _ := os.ReadFile(filepath.Join(dir, registryFile))
	if strings.Contains(string(b), token) || !strings.Contains(string(b), "张三") {
		t.Fatalf("登记表不应包含明文令牌：%s", b)
	}
}

func TestCLIRevoke(t *testing.T) {
	ts, dir := newRegistryServer(t)
	token, id := cliAdd(t, dir, "")
	time.Sleep(1100 * time.Millisecond)
	if res := req(t, "PUT", ts.URL+"/v1/sync", token, `{"a":1}`, map[string]string{"If-None-Match": "*"}); res.StatusCode != 200 {
		t.Fatalf("写入失败 %d", res.StatusCode)
	}
	var out, errOut bytes.Buffer
	if code := runTokenCmd([]string{"revoke", "-data", dir, "-purge", id[:8]}, &out, &errOut); code != 0 {
		t.Fatalf("revoke 失败：%s", errOut.String())
	}
	time.Sleep(1100 * time.Millisecond)
	if res := req(t, "GET", ts.URL+"/v1/sync", token, "", nil); res.StatusCode != 401 {
		t.Fatalf("作废后应为 401，得到 %d", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(dir, id+".json")); !os.IsNotExist(err) {
		t.Fatal("-purge 应删除数据文件")
	}
}

func TestPassphraseLock(t *testing.T) {
	ts, dir := newRegistryServer(t)
	token, id := cliAdd(t, dir, "")
	time.Sleep(1100 * time.Millisecond)
	const k1 = "0123456789abcdef0123456789abcdef"
	const k2 = "fedcba9876543210fedcba9876543210"
	put := func(etag, key string) *http.Response {
		h := map[string]string{}
		if etag == "" {
			h["If-None-Match"] = "*"
		} else {
			h["If-Match"] = etag
		}
		if key != "" {
			h["X-NSH-Key-Id"] = key
		}
		return req(t, "PUT", ts.URL+"/v1/sync", token, `{"x":1}`, h)
	}

	// 第一个带密钥标识写入的人锁定空间
	res := put("", k1)
	if res.StatusCode != 200 {
		t.Fatalf("首次写入失败 %d", res.StatusCode)
	}
	etag := res.Header.Get("ETag")
	if g := req(t, "GET", ts.URL+"/v1/sync", token, "", nil); g.Header.Get("X-NSH-Locked") != "1" {
		t.Fatal("锁定后 GET 应带 X-NSH-Locked")
	}
	// 别的口令、不加密的写入都被拒绝；同一口令可以继续写
	for _, key := range []string{k2, ""} {
		if r := put(etag, key); r.StatusCode != 403 || r.Header.Get("X-NSH-Locked") != "1" {
			t.Fatalf("口令 %q 写入锁定空间应为 403，得到 %d", key, r.StatusCode)
		}
	}
	if r := req(t, "DELETE", ts.URL+"/v1/sync", token, "", map[string]string{"X-NSH-Key-Id": k2}); r.StatusCode != 403 {
		t.Fatalf("其他口令删除应为 403，得到 %d", r.StatusCode)
	}
	if r := put(etag, k1); r.StatusCode != 200 {
		t.Fatalf("同一口令写入应成功，得到 %d", r.StatusCode)
	}
	// 管理员解锁后，下一个带口令写入的人重新锁定
	var out, errOut bytes.Buffer
	if code := runTokenCmd([]string{"unlock", "-data", dir, id[:6]}, &out, &errOut); code != 0 {
		t.Fatalf("unlock 失败：%s", errOut.String())
	}
	cur := req(t, "GET", ts.URL+"/v1/sync", token, "", nil).Header.Get("ETag")
	if r := put(cur, k2); r.StatusCode != 200 {
		t.Fatalf("解锁后新口令写入应成功，得到 %d", r.StatusCode)
	}
	cur = req(t, "GET", ts.URL+"/v1/sync", token, "", nil).Header.Get("ETag")
	if r := put(cur, k1); r.StatusCode != 403 {
		t.Fatalf("重新锁定后旧口令应被拒绝，得到 %d", r.StatusCode)
	}
}

func TestNoKeyIDDoesNotLock(t *testing.T) {
	ts, dir := newRegistryServer(t)
	token, id := cliAdd(t, dir, "")
	time.Sleep(1100 * time.Millisecond)
	if r := req(t, "PUT", ts.URL+"/v1/sync", token, `{}`, map[string]string{"If-None-Match": "*"}); r.StatusCode != 200 {
		t.Fatalf("写入失败 %d", r.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(dir, id+lockSuffix)); !os.IsNotExist(err) {
		t.Fatal("不加密的写入不应锁定空间")
	}
	// 非法的密钥标识当作没有
	if k := keyIDOf(&http.Request{Header: http.Header{"X-Nsh-Key-Id": {"../../etc"}}}); k != "" {
		t.Fatalf("非法密钥标识应被忽略，得到 %q", k)
	}
}

func TestCLIListAndNote(t *testing.T) {
	dir := t.TempDir()
	_, id := cliAdd(t, dir, "李四")
	var out, errOut bytes.Buffer
	if code := runTokenCmd([]string{"list", "-data", dir}, &out, &errOut); code != 0 || !strings.Contains(out.String(), "李四") {
		t.Fatalf("list 输出不对：%s %s", out.String(), errOut.String())
	}
	out.Reset()
	if code := runTokenCmd([]string{"note", "-data", dir, id[:8], "王五", "的手机"}, &out, &errOut); code != 0 {
		t.Fatalf("note 失败：%s", errOut.String())
	}
	out.Reset()
	runTokenCmd([]string{"list", "-data", dir}, &out, &errOut)
	if !strings.Contains(out.String(), "王五 的手机") || strings.Contains(out.String(), "李四") {
		t.Fatalf("备注没有更新：%s", out.String())
	}
	if code := runTokenCmd([]string{"add", "-data", dir, "-url", ""}, &out, &errOut); code == 0 {
		t.Fatal("没有对外地址时 add 应失败")
	}
}

// DecodeSyncCodeForTest 测试用：还原同步码里的地址与令牌（并校验）
func DecodeSyncCodeForTest(code string) (string, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(code, syncCodePrefix))
	if err != nil {
		return "", "", err
	}
	plain := syncMask(raw)
	body, sum := plain[:len(plain)-2], plain[len(plain)-2:]
	if want := fnv16(body); want[0] != sum[0] || want[1] != sum[1] {
		return "", "", errors.New("校验失败")
	}
	parts := bytes.SplitN(body, []byte{0}, 2)
	return string(parts[0]), string(parts[1]), nil
}
