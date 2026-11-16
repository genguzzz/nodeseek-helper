package main

import "testing"

// 与前端 tests/sync-code.test.ts 共用的测试向量，保证两端编码一致
const syncCodeVector = "nsh1_K5PzK5mrBe5bcbAZL8wtzMMxkehKpP9T_1Fun2JgyjmdjUKQuVPnEnrODDePZdizI8-pHPsTELve"

func TestEncodeSyncCodeVector(t *testing.T) {
	if got := EncodeSyncCode("https://sync.example.com/nsh-sync/", "demo-token-0123456789"); got != syncCodeVector {
		t.Fatalf("同步码与共享向量不一致：%s", got)
	}
}
