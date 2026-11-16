// NodeSeek 助手 · 自建配置同步服务
//
// 只依赖标准库；数据以文件落盘、流式读写，内存里只保留每个空间的元数据，常驻内存 < 10MB。
// 协议见 docs/sync.md §5。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var version = "dev"

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int64) int64 {
	if v, err := strconv.ParseInt(os.Getenv(key), 10, 64); err == nil && v > 0 {
		return v
	}
	return def
}

func main() {
	addr := flag.String("addr", env("NSH_ADDR", ":8787"), "监听地址")
	dataDir := flag.String("data", env("NSH_DATA", "./data"), "数据目录")
	maxBody := flag.Int64("max-body", envInt("NSH_MAX_BODY", 2<<20), "单个空间数据上限（字节）")
	maxSpaces := flag.Int64("max-spaces", envInt("NSH_MAX_SPACES", 1000), "空间数量上限")
	maxWatchers := flag.Int64("max-watchers", envInt("NSH_MAX_WATCHERS", 256), "长轮询连接上限")
	showVersion := flag.Bool("version", false, "打印版本")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	// 默认内存策略：软上限 8MiB + 更积极的 GC，保证常驻 < 10MB
	if os.Getenv("GOMEMLIMIT") == "" {
		debug.SetMemoryLimit(8 << 20)
	}
	if os.Getenv("GOGC") == "" {
		debug.SetGCPercent(30)
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	tokens := map[string]bool{}
	for _, t := range strings.Split(os.Getenv("NSH_TOKENS"), ",") {
		if t = strings.TrimSpace(t); t != "" {
			tokens[t] = true
		}
	}
	open := os.Getenv("NSH_OPEN") == "1"
	if len(tokens) == 0 && !open {
		fmt.Fprintln(os.Stderr, "请设置 NSH_TOKENS（逗号分隔的访问令牌），或设置 NSH_OPEN=1 开放注册")
		os.Exit(2)
	}
	store, err := NewStore(*dataDir, int(*maxSpaces))
	if err != nil {
		fmt.Fprintln(os.Stderr, "打开数据目录失败：", err)
		os.Exit(1)
	}
	srv := &http.Server{
		Addr: *addr,
		Handler: NewServer(Config{
			Tokens:      tokens,
			Open:        open,
			MaxBody:     *maxBody,
			MaxWatchers: *maxWatchers,
			Quiet:       os.Getenv("NSH_LOG") == "quiet",
		}, store),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		// 不设全局 WriteTimeout：长轮询在处理器里单独设置写超时
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		slog.Info("nsh-sync-server 启动", "version", version, "addr", *addr, "data", *dataDir, "tokens", len(tokens), "open", open)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("监听失败", "err", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	slog.Info("已停止")
}
