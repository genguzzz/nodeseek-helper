package main

import (
	"crypto/sha256"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
)

// 并发写入与读取时，读到的内容必须与同时返回的 ETag 属于同一版本
func TestOpenEtagMatchesContentUnderConcurrentPut(t *testing.T) {
	store, err := NewStore(t.TempDir(), 10)
	if err != nil {
		t.Fatal(err)
	}
	const id = "space"
	if _, err := store.Put(id, strings.NewReader(`{"v":0}`), 1<<20, "", true); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 1; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			cur, _ := store.Meta(id)
			// 不同长度的内容，避免偶然相同
			body := fmt.Sprintf(`{"v":%d,"pad":"%s"}`, i, strings.Repeat("x", i%50))
			if _, err := store.Put(id, strings.NewReader(body), 1<<20, cur.etag, false); err != nil && err != errPrecondition {
				t.Error(err)
				return
			}
		}
	}()
	for i := 0; i < 400; i++ {
		f, m, err := store.Open(id)
		if err != nil {
			t.Fatal(err)
		}
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			t.Fatal(err)
		}
		f.Close()
		if got := etagOf(h.Sum(nil)); got != m.etag {
			close(stop)
			wg.Wait()
			t.Fatalf("第 %d 次读取：内容 ETag %s 与返回的 ETag %s 不一致", i, got, m.etag)
		}
	}
	close(stop)
	wg.Wait()
}

// 删除后 Changed 通道被关闭（唤醒长轮询），且再次写入要求 If-None-Match
func TestDeleteWakesWatchersAndResetsVersion(t *testing.T) {
	store, err := NewStore(t.TempDir(), 10)
	if err != nil {
		t.Fatal(err)
	}
	m, err := store.Put("s", strings.NewReader(`{}`), 1024, "", true)
	if err != nil {
		t.Fatal(err)
	}
	ch := store.Changed("s")
	if err := store.Delete("s"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ch:
	default:
		t.Fatal("删除后长轮询没有被唤醒")
	}
	if _, err := store.Put("s", strings.NewReader(`{}`), 1024, m.etag, false); err != errPrecondition {
		t.Fatalf("删除后用旧 ETag 写入应冲突，得到 %v", err)
	}
	if _, err := store.Put("s", strings.NewReader(`{}`), 1024, "", true); err != nil {
		t.Fatalf("删除后按新建写入应成功：%v", err)
	}
}
