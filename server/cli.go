package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const tokenUsage = `用法（在服务器上执行；Docker 部署时前面加 docker exec <容器名>）：
  nsh-sync-server token add [-note 备注]            生成新的同步码（发给一个人 / 一组设备）
  nsh-sync-server token list                        列出已发出的同步码对应的空间
  nsh-sync-server token note <空间ID> <备注>        修改备注（如改成使用者的名字）
  nsh-sync-server token revoke [-purge] <空间ID>    作废同步码；-purge 同时删除该空间的数据
  nsh-sync-server token unlock <空间ID>             解除口令锁（用户忘记加密口令时）

空间 ID 可只写前 6 位以上。数据目录取 NSH_DATA（默认 ./data），对外地址取 NSH_PUBLIC_URL 或 -url。
`

// runTokenCmd 令牌管理子命令；不经过 HTTP，只在服务器本机操作数据目录
func runTokenCmd(args []string, out, errOut io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(errOut, tokenUsage)
		return 2
	}
	fs := flag.NewFlagSet("token "+args[0], flag.ContinueOnError)
	fs.SetOutput(errOut)
	dataDir := fs.String("data", env("NSH_DATA", "./data"), "数据目录")
	pub := fs.String("url", os.Getenv("NSH_PUBLIC_URL"), "对外访问地址（生成同步码用）")
	note := fs.String("note", "", "备注（如使用者名字）")
	purge := fs.Bool("purge", false, "作废时同时删除数据与口令锁")
	if err := fs.Parse(args[1:]); err != nil {
		return 2
	}
	fail := func(err error) int {
		fmt.Fprintln(errOut, "错误：", err)
		return 1
	}
	switch args[0] {
	case "add":
		base := strings.TrimRight(strings.TrimSpace(*pub), "/")
		if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
			return fail(errors.New("需要对外访问地址：设置环境变量 NSH_PUBLIC_URL 或传 -url https://sync.example.com"))
		}
		if err := os.MkdirAll(*dataDir, 0o700); err != nil {
			return fail(err)
		}
		token, e, err := AddToken(*dataDir, *note)
		if err != nil {
			return fail(err)
		}
		fmt.Fprintf(errOut, "已创建空间 %s%s，同步码只显示这一次，请复制保存：\n", e.ID[:8], noteSuffix(e.Note))
		fmt.Fprintln(out, EncodeSyncCode(base, token))
		return 0
	case "list":
		tokens, err := ListTokens(*dataDir)
		if err != nil {
			return fail(err)
		}
		if len(tokens) == 0 {
			fmt.Fprintln(out, "还没有通过 token add 创建的同步码")
			return 0
		}
		fmt.Fprintf(out, "%-10s %-6s %-9s %-17s %s\n", "空间ID", "口令锁", "数据", "创建时间", "备注")
		for _, t := range tokens {
			lock, size := "-", "-"
			if _, err := os.Stat(filepath.Join(*dataDir, t.ID+lockSuffix)); err == nil {
				lock = "已锁定"
			}
			if st, err := os.Stat(filepath.Join(*dataDir, t.ID+".json")); err == nil {
				size = fmt.Sprintf("%.1fKB", float64(st.Size())/1024)
			}
			fmt.Fprintf(out, "%-10s %-6s %-9s %-17s %s\n", t.ID[:8], lock, size, time.UnixMilli(t.Created).Format("2006-01-02 15:04"), t.Note)
		}
		return 0
	case "note":
		if fs.NArg() < 1 {
			fmt.Fprint(errOut, tokenUsage)
			return 2
		}
		e, err := SetNote(*dataDir, fs.Arg(0), strings.Join(fs.Args()[1:], " "))
		if err != nil {
			return fail(err)
		}
		fmt.Fprintf(out, "空间 %s 的备注已改为：%s\n", e.ID[:8], e.Note)
		return 0
	case "revoke", "unlock":
		if fs.NArg() != 1 {
			fmt.Fprint(errOut, tokenUsage)
			return 2
		}
		if args[0] == "revoke" {
			e, err := RevokeToken(*dataDir, fs.Arg(0), *purge)
			if err != nil {
				return fail(err)
			}
			what := "已作废，数据保留"
			if *purge {
				what = "已作废并删除数据"
			}
			fmt.Fprintf(out, "空间 %s%s %s\n", e.ID[:8], noteSuffix(e.Note), what)
			return 0
		}
		e, err := UnlockSpace(*dataDir, fs.Arg(0))
		if err != nil {
			return fail(err)
		}
		fmt.Fprintf(out, "空间 %s%s 已解锁：下一个用加密口令写入的设备会重新锁定它\n", e.ID[:8], noteSuffix(e.Note))
		return 0
	default:
		fmt.Fprint(errOut, tokenUsage)
		return 2
	}
}

func noteSuffix(note string) string {
	if note == "" {
		return ""
	}
	return "（" + note + "）"
}
