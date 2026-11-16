package main

import (
	"encoding/base64"
	"strings"
)

// 同步码：把「访问地址 + 令牌」编码成一个字符串，客户端粘贴即可完成配置。
// 格式与前端 src/sync/sync-code.ts 完全一致：
//
//	nsh1_<base64url( mask( utf8(地址) 0x00 utf8(令牌) ‖ 校验 2 字节 ) )>
//
// 这是编码混淆而非加密，持有同步码即可访问对应空间。
const syncCodePrefix = "nsh1_"

var syncCodeKey = []byte("nodeseek-helper/sync-code/v1")

func fnv16(b []byte) [2]byte {
	h := uint32(0x811c9dc5)
	for _, c := range b {
		h ^= uint32(c)
		h *= 0x01000193
	}
	return [2]byte{byte(h >> 8), byte(h)}
}

func syncMask(b []byte) []byte {
	out := make([]byte, len(b))
	for i, c := range b {
		out[i] = c ^ syncCodeKey[i%len(syncCodeKey)] ^ byte((i*0x5b+0x2d)&0xff)
	}
	return out
}

// EncodeSyncCode 由对外访问地址与令牌生成同步码
func EncodeSyncCode(base, token string) string {
	plain := append([]byte(strings.TrimRight(strings.TrimSpace(base), "/")), 0)
	plain = append(plain, []byte(strings.TrimSpace(token))...)
	sum := fnv16(plain)
	return syncCodePrefix + base64.RawURLEncoding.EncodeToString(syncMask(append(plain, sum[0], sum[1])))
}
