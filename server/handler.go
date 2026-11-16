package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Config 服务配置
type Config struct {
	Tokens      map[string]bool // 环境变量 NSH_TOKENS 里的令牌（已规整）
	Registry    *Registry       // 命令行登记的令牌（可为 nil）；增删无需重启
	Open        bool            // 开放注册：任意长度 >= 16 的令牌
	MaxBody     int64
	MaxWatchers int64
	Quiet       bool
}

// Server HTTP 处理器
type Server struct {
	cfg      Config
	store    *Store
	watchers atomic.Int64
	limiter  *limiter
}

// NewServer 组装处理器
func NewServer(cfg Config, store *Store) *Server {
	return &Server{cfg: cfg, store: store, limiter: newLimiter(10, 20)}
}

const (
	minOpenToken    = 16
	defaultWatchS   = 25
	maxWatchS       = 55
	headerUpdated   = "X-Updated-At"
	headerKeyID     = "X-NSH-Key-Id"
	headerLocked    = "X-NSH-Locked"
	contentTypeJSON = "application/json"
)

// spaceID 空间 ID = hex(sha256(token))[:32]，不保存明文令牌
func spaceID(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])[:32]
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	rec := &statusRecorder{ResponseWriter: w, status: 200}
	cors(rec.Header())
	sid := s.route(rec, r)
	if !s.cfg.Quiet {
		short := sid
		if len(short) > 8 {
			short = short[:8]
		}
		slog.Info("req", "method", r.Method, "path", r.URL.Path, "status", rec.status, "ms", time.Since(start).Milliseconds(), "space", short)
	}
}

func (s *Server) route(w *statusRecorder, r *http.Request) string {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return ""
	}
	switch r.URL.Path {
	case "/healthz":
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
		return ""
	case "/v1/sync", "/v1/sync/watch":
	default:
		http.Error(w, "not found", http.StatusNotFound)
		return ""
	}
	sid, ok := s.auth(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Bearer realm="nsh-sync"`)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "认证失败"})
		return ""
	}
	if !s.limiter.allow(sid) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"message": "请求过于频繁"})
		return sid
	}
	if r.URL.Path == "/v1/sync/watch" {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return sid
		}
		s.watch(w, r, sid)
		return sid
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		s.get(w, r, sid)
	case http.MethodPut:
		s.put(w, r, sid)
	case http.MethodDelete:
		s.del(w, r, sid)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
	return sid
}

func (s *Server) auth(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return "", false
	}
	tok := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	if tok == "" {
		return "", false
	}
	if s.cfg.Tokens[tok] || (s.cfg.Registry != nil && s.cfg.Registry.Has(tok)) || (s.cfg.Open && len(tok) >= minOpenToken) {
		return spaceID(tok), true
	}
	return "", false
}

func (s *Server) get(w http.ResponseWriter, r *http.Request, sid string) {
	f, m, err := s.store.Open(sid)
	if errors.Is(err, errNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "尚无数据"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "读取失败"})
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("ETag", m.etag)
	h.Set(headerUpdated, strconv.FormatInt(m.updatedAt, 10))
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Type", contentTypeJSON)
	if s.store.Lock(sid) != "" {
		h.Set(headerLocked, "1")
	}
	if matchETag(r.Header.Get("If-None-Match"), m.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	// ServeContent 流式输出，HEAD 时不写响应体
	http.ServeContent(w, r, "", time.UnixMilli(m.updatedAt), f)
}

func (s *Server) put(w http.ResponseWriter, r *http.Request, sid string) {
	if r.ContentLength > s.cfg.MaxBody {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"message": "数据过大"})
		return
	}
	ifMatch := strings.TrimSpace(r.Header.Get("If-Match"))
	ifNone := strings.TrimSpace(r.Header.Get("If-None-Match")) == "*"
	m, err := s.store.Put(sid, r.Body, s.cfg.MaxBody, ifMatch, ifNone, keyIDOf(r))
	switch {
	case errors.Is(err, errLocked):
		writeLocked(w)
	case errors.Is(err, errPrecondition):
		if m.etag != "" {
			w.Header().Set("ETag", m.etag)
		}
		writeJSON(w, http.StatusPreconditionFailed, map[string]string{"message": "版本冲突"})
	case errors.Is(err, errTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"message": "数据过大"})
	case errors.Is(err, errNotJSON):
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "需要 JSON"})
	case errors.Is(err, errTooMany):
		writeJSON(w, http.StatusInsufficientStorage, map[string]string{"message": "空间数量已达上限"})
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "写入失败"})
	default:
		w.Header().Set("ETag", m.etag)
		w.Header().Set(headerUpdated, strconv.FormatInt(m.updatedAt, 10))
		writeJSON(w, http.StatusOK, map[string]any{"etag": m.etag, "updatedAt": m.updatedAt, "size": m.size})
	}
}

func (s *Server) del(w http.ResponseWriter, r *http.Request, sid string) {
	err := s.store.Delete(sid, keyIDOf(r))
	if errors.Is(err, errLocked) {
		writeLocked(w)
		return
	}
	if errors.Is(err, errNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "尚无数据"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "删除失败"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// watch 长轮询：版本与客户端不同立即返回，否则等待变更 / 超时 / 客户端断开
func (s *Server) watch(w http.ResponseWriter, r *http.Request, sid string) {
	if s.watchers.Add(1) > s.cfg.MaxWatchers {
		s.watchers.Add(-1)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"message": "连接过多"})
		return
	}
	defer s.watchers.Add(-1)
	timeout := defaultWatchS
	if v, err := strconv.Atoi(r.URL.Query().Get("timeout")); err == nil {
		timeout = min(max(v, 1), maxWatchS)
	}
	// 单独放宽本请求的写超时，不影响其他请求
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(time.Duration(timeout+10) * time.Second))
	since := r.URL.Query().Get("etag")
	ch := s.store.Changed(sid)
	if m, _ := s.store.Meta(sid); m.etag != since {
		writeJSON(w, http.StatusOK, map[string]any{"etag": m.etag, "updatedAt": m.updatedAt})
		return
	}
	t := time.NewTimer(time.Duration(timeout) * time.Second)
	defer t.Stop()
	select {
	case <-ch:
		m, _ := s.store.Meta(sid)
		writeJSON(w, http.StatusOK, map[string]any{"etag": m.etag, "updatedAt": m.updatedAt})
	case <-t.C:
		w.WriteHeader(http.StatusNotModified)
	case <-r.Context().Done():
	}
}

/* ---------------- 工具 ---------------- */

func cors(h http.Header) {
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, If-None-Match, X-NSH-Key-Id")
	h.Set("Access-Control-Allow-Methods", "GET, HEAD, PUT, DELETE, OPTIONS")
	h.Set("Access-Control-Expose-Headers", "ETag, X-Updated-At, X-NSH-Locked")
	h.Set("Access-Control-Max-Age", "86400")
}

// keyIDOf 客户端由加密口令派生的密钥标识（未加密时为空）；只允许十六进制，长度 16–128
func keyIDOf(r *http.Request) string {
	k := strings.ToLower(strings.TrimSpace(r.Header.Get(headerKeyID)))
	if len(k) < 16 || len(k) > 128 {
		return ""
	}
	for _, c := range k {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return ""
		}
	}
	return k
}

func writeLocked(w http.ResponseWriter) {
	w.Header().Set(headerLocked, "1")
	writeJSON(w, http.StatusForbidden, map[string]string{"message": "这个同步空间已被另一个加密口令锁定"})
}

func matchETag(header, etag string) bool {
	if header == "" || etag == "" {
		return false
	}
	for _, part := range strings.Split(header, ",") {
		p := strings.TrimPrefix(strings.TrimSpace(part), "W/")
		if p == etag || p == "*" {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", contentTypeJSON)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// ReadFrom 透传底层实现，让 ServeContent 走 sendfile 零拷贝（否则每次读取都要分配 32KB 缓冲）
func (r *statusRecorder) ReadFrom(src io.Reader) (int64, error) {
	if rf, ok := r.ResponseWriter.(io.ReaderFrom); ok {
		return rf.ReadFrom(src)
	}
	return io.Copy(r.ResponseWriter, src)
}

// Unwrap 让 http.ResponseController 能拿到底层连接
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

/* ---------------- 按空间限流（令牌桶） ---------------- */

type bucket struct {
	tokens float64
	last   time.Time
}

type limiter struct {
	mu      sync.Mutex
	rate    float64
	burst   float64
	buckets map[string]*bucket
	sweep   time.Time
}

func newLimiter(rate, burst float64) *limiter {
	return &limiter{rate: rate, burst: burst, buckets: map[string]*bucket{}, sweep: time.Now()}
}

func (l *limiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	// 每分钟清理一次闲置的桶，避免开放注册时 map 无限增长
	if now.Sub(l.sweep) > time.Minute {
		for k, b := range l.buckets {
			if now.Sub(b.last) > time.Minute {
				delete(l.buckets, k)
			}
		}
		l.sweep = now
	}
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
