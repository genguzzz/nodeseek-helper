package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// 错误类型
var (
	errNotFound     = errors.New("not found")
	errPrecondition = errors.New("precondition failed")
	errTooLarge     = errors.New("body too large")
	errNotJSON      = errors.New("body is not json")
	errTooMany      = errors.New("too many spaces")
)

// meta 每个空间在内存中只保留这点元数据，数据本体始终在磁盘上
type meta struct {
	etag      string
	updatedAt int64
	size      int64
}

// space 单个空间：写锁 + 变更广播
type space struct {
	mu      sync.Mutex
	changed chan struct{}
}

// Store 文件存储：一个空间一个文件，内存里只有元数据
type Store struct {
	dir       string
	maxSpaces int

	mu     sync.RWMutex
	metas  map[string]meta
	spaces map[string]*space
}

// NewStore 打开数据目录并通过扫描文件重建元数据
func NewStore(dir string, maxSpaces int) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, maxSpaces: maxSpaces, metas: map[string]meta{}, spaces: map[string]*space{}}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") {
			// 清理上次异常退出遗留的临时文件
			if strings.HasPrefix(name, ".tmp-") {
				_ = os.Remove(filepath.Join(dir, name))
			}
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		m, err := scanFile(filepath.Join(dir, name))
		if err != nil {
			return nil, fmt.Errorf("扫描 %s: %w", name, err)
		}
		s.metas[id] = m
	}
	return s, nil
}

// scanFile 流式计算文件的 ETag
func scanFile(path string) (meta, error) {
	f, err := os.Open(path)
	if err != nil {
		return meta{}, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return meta{}, err
	}
	st, err := f.Stat()
	if err != nil {
		return meta{}, err
	}
	return meta{etag: etagOf(h.Sum(nil)), updatedAt: st.ModTime().UnixMilli(), size: n}, nil
}

func etagOf(sum []byte) string { return `"` + hex.EncodeToString(sum[:16]) + `"` }

func (s *Store) path(id string) string { return filepath.Join(s.dir, id+".json") }

func (s *Store) space(id string) *space {
	s.mu.Lock()
	defer s.mu.Unlock()
	sp := s.spaces[id]
	if sp == nil {
		sp = &space{changed: make(chan struct{})}
		s.spaces[id] = sp
	}
	return sp
}

// Meta 读取元数据
func (s *Store) Meta(id string) (meta, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.metas[id]
	return m, ok
}

// Open 打开空间文件用于流式读取
func (s *Store) Open(id string) (*os.File, meta, error) {
	m, ok := s.Meta(id)
	if !ok {
		return nil, meta{}, errNotFound
	}
	f, err := os.Open(s.path(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil, meta{}, errNotFound
	}
	return f, m, err
}

// Put 条件写入。ifMatch 为当前 ETag；ifNoneMatch 为 true 表示要求空间不存在。
// 请求体边写临时文件边计算 SHA-256，整体不进内存；成功后原子替换并广播变更。
func (s *Store) Put(id string, body io.Reader, maxBody int64, ifMatch string, ifNoneMatch bool) (meta, error) {
	sp := s.space(id)
	sp.mu.Lock()
	defer sp.mu.Unlock()
	cur, exists := s.Meta(id)
	switch {
	case exists && ifNoneMatch:
		return cur, errPrecondition
	case exists && ifMatch != cur.etag:
		return cur, errPrecondition
	case !exists && ifMatch != "":
		return cur, errPrecondition
	}
	if !exists {
		s.mu.RLock()
		full := len(s.metas) >= s.maxSpaces
		s.mu.RUnlock()
		if full {
			return meta{}, errTooMany
		}
	}
	tmp, err := os.CreateTemp(s.dir, ".tmp-*")
	if err != nil {
		return meta{}, err
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			tmp.Close()
			os.Remove(tmpName)
		}
	}()
	br := bufio.NewReaderSize(io.LimitReader(body, maxBody+1), 4096)
	if err := checkJSONStart(br); err != nil {
		return meta{}, err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), br)
	if err != nil {
		return meta{}, err
	}
	if n > maxBody {
		return meta{}, errTooLarge
	}
	if err := tmp.Sync(); err != nil {
		return meta{}, err
	}
	if err := tmp.Close(); err != nil {
		return meta{}, err
	}
	if err := os.Rename(tmpName, s.path(id)); err != nil {
		return meta{}, err
	}
	ok = true
	m := meta{etag: etagOf(h.Sum(nil)), updatedAt: time.Now().UnixMilli(), size: n}
	s.mu.Lock()
	s.metas[id] = m
	s.mu.Unlock()
	s.notify(sp)
	return m, nil
}

// checkJSONStart 跳过空白后第一个字节必须是 '{'，不消费该字节之外的内容
func checkJSONStart(br *bufio.Reader) error {
	for {
		b, err := br.ReadByte()
		if err != nil {
			return errNotJSON
		}
		switch b {
		case ' ', '\t', '\r', '\n':
			continue
		case '{':
			return br.UnreadByte()
		default:
			return errNotJSON
		}
	}
}

// Delete 删除空间数据
func (s *Store) Delete(id string) error {
	sp := s.space(id)
	sp.mu.Lock()
	defer sp.mu.Unlock()
	if _, ok := s.Meta(id); !ok {
		return errNotFound
	}
	if err := os.Remove(s.path(id)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	s.mu.Lock()
	delete(s.metas, id)
	s.mu.Unlock()
	s.notify(sp)
	return nil
}

// notify 关闭旧通道唤醒所有等待者，并换上新通道（调用方持有 sp.mu）
func (s *Store) notify(sp *space) {
	s.mu.Lock()
	close(sp.changed)
	sp.changed = make(chan struct{})
	s.mu.Unlock()
}

// Changed 返回当前的变更通道，变更发生时会被关闭
func (s *Store) Changed(id string) <-chan struct{} {
	sp := s.space(id)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return sp.changed
}
