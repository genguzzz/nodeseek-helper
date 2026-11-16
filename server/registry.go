package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// registryFile 令牌登记表（数据目录下；不以 .json 结尾，不会被当成空间文件扫描）
const registryFile = "tokens.registry"

// TokenEntry 登记的令牌：只保存 SHA-256，不保存明文
type TokenEntry struct {
	ID      string `json:"id"`   // 空间 ID = hex(sha256(token))[:32]
	Hash    string `json:"hash"` // hex(sha256(token))
	Note    string `json:"note,omitempty"`
	Created int64  `json:"created"`
}

type registryDoc struct {
	Tokens []TokenEntry `json:"tokens"`
}

// Registry 由命令行维护的令牌表；服务端按文件修改时间自动重新加载，新增 / 作废令牌无需重启
type Registry struct {
	path string

	mu      sync.Mutex
	hashes  map[string]bool
	modTime time.Time
	size    int64
	checked time.Time
}

func NewRegistry(dataDir string) *Registry {
	return &Registry{path: filepath.Join(dataDir, registryFile), hashes: map[string]bool{}}
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Has 令牌是否已登记。文件变化最多每秒检查一次（一次 stat）
func (r *Registry) Has(token string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if now := time.Now(); now.Sub(r.checked) >= time.Second {
		r.checked = now
		r.reloadLocked()
	}
	return r.hashes[tokenHash(token)]
}

func (r *Registry) reloadLocked() {
	st, err := os.Stat(r.path)
	if err != nil {
		r.hashes, r.modTime, r.size = map[string]bool{}, time.Time{}, 0
		return
	}
	if st.ModTime().Equal(r.modTime) && st.Size() == r.size {
		return
	}
	doc, err := readRegistry(r.path)
	if err != nil {
		return // 读取失败（如正在写入）保留旧表，下次再试
	}
	m := make(map[string]bool, len(doc.Tokens))
	for _, t := range doc.Tokens {
		m[t.Hash] = true
	}
	r.hashes, r.modTime, r.size = m, st.ModTime(), st.Size()
}

func readRegistry(path string) (registryDoc, error) {
	var doc registryDoc
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return doc, nil
	}
	if err != nil {
		return doc, err
	}
	err = json.Unmarshal(b, &doc)
	return doc, err
}

// writeRegistry 原子替换（先写临时文件再 rename），服务端不会读到半个文件
func writeRegistry(path string, doc registryDoc) error {
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, append(b, '\n'))
}

func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

/* ---------------- 命令行操作 ---------------- */

// AddToken 生成一个新令牌并登记，返回明文令牌（只在此时出现一次）
func AddToken(dataDir, note string) (string, TokenEntry, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", TokenEntry{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	path := filepath.Join(dataDir, registryFile)
	doc, err := readRegistry(path)
	if err != nil {
		return "", TokenEntry{}, err
	}
	e := TokenEntry{ID: spaceID(token), Hash: tokenHash(token), Note: note, Created: time.Now().UnixMilli()}
	doc.Tokens = append(doc.Tokens, e)
	if err := writeRegistry(path, doc); err != nil {
		return "", TokenEntry{}, err
	}
	return token, e, nil
}

// ListTokens 列出登记的令牌
func ListTokens(dataDir string) ([]TokenEntry, error) {
	doc, err := readRegistry(filepath.Join(dataDir, registryFile))
	if err != nil {
		return nil, err
	}
	sort.Slice(doc.Tokens, func(i, j int) bool { return doc.Tokens[i].Created < doc.Tokens[j].Created })
	return doc.Tokens, nil
}

// findEntry 按空间 ID 前缀（至少 6 位）或完整 ID 找到唯一一项
func findEntry(tokens []TokenEntry, prefix string) (int, error) {
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	if len(prefix) < 6 {
		return -1, errors.New("空间 ID 至少输入 6 位")
	}
	idx := -1
	for i, t := range tokens {
		if strings.HasPrefix(t.ID, prefix) {
			if idx >= 0 {
				return -1, errors.New("ID 前缀匹配到多个空间，请多输入几位")
			}
			idx = i
		}
	}
	if idx < 0 {
		return -1, errors.New("没有找到这个空间 ID（只能管理通过 token add 登记的令牌）")
	}
	return idx, nil
}

// RevokeToken 作废令牌：之后该同步码无法访问。purge 时同时删除数据与口令锁
func RevokeToken(dataDir, prefix string, purge bool) (TokenEntry, error) {
	path := filepath.Join(dataDir, registryFile)
	doc, err := readRegistry(path)
	if err != nil {
		return TokenEntry{}, err
	}
	i, err := findEntry(doc.Tokens, prefix)
	if err != nil {
		return TokenEntry{}, err
	}
	e := doc.Tokens[i]
	doc.Tokens = append(doc.Tokens[:i], doc.Tokens[i+1:]...)
	if err := writeRegistry(path, doc); err != nil {
		return e, err
	}
	if purge {
		for _, f := range []string{e.ID + ".json", e.ID + lockSuffix} {
			if err := os.Remove(filepath.Join(dataDir, f)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return e, err
			}
		}
	}
	return e, nil
}

// SetNote 修改备注（方便管理员记住每个空间是谁在用）
func SetNote(dataDir, prefix, note string) (TokenEntry, error) {
	path := filepath.Join(dataDir, registryFile)
	doc, err := readRegistry(path)
	if err != nil {
		return TokenEntry{}, err
	}
	i, err := findEntry(doc.Tokens, prefix)
	if err != nil {
		return TokenEntry{}, err
	}
	doc.Tokens[i].Note = note
	return doc.Tokens[i], writeRegistry(path, doc)
}

// UnlockSpace 解除口令锁（用户忘记口令时由管理员操作；之后第一个用口令写入的人重新锁定）
func UnlockSpace(dataDir, prefix string) (TokenEntry, error) {
	tokens, err := ListTokens(dataDir)
	if err != nil {
		return TokenEntry{}, err
	}
	i, err := findEntry(tokens, prefix)
	if err != nil {
		return TokenEntry{}, err
	}
	err = os.Remove(filepath.Join(dataDir, tokens[i].ID+lockSuffix))
	if errors.Is(err, os.ErrNotExist) {
		return tokens[i], errors.New("这个空间没有被口令锁定")
	}
	return tokens[i], err
}
