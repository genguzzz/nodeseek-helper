# 配置同步：数据格式与协议

本文是客户端（油猴脚本 / 代理注入版）与各同步后端之间的契约，`server/`（Go 自建同步服务）按本文实现。

## 1. 分层

```
SyncDocument（明文 JSON，按条目合并）
   │ JSON.stringify → gzip → [AES-256-GCM 加密，可选] → base64
   ▼
Envelope（信封，后端只看到它）
   │ 原样存取
   ▼
后端：自建 Go 服务 / WebDAV（坚果云、Nextcloud…）/ GitHub Gist / OneDrive
```

后端永远不解析业务数据，只按「整份文件 + 版本号（ETag）」做乐观并发控制；合并全部在客户端完成。
开启加密时，图床密钥等敏感信息在任何后端上都是密文。

## 2. SyncDocument（`nsh-sync/1`）

```jsonc
{
  "schema": "nsh-sync/1",
  "updatedAt": 1794825114415,        // 文档最后写入时间（ms）
  "device": "d_k3f9a2",               // 最后写入的设备 ID
  "settings": { "v": { /* 通用设置，见下 */ }, "t": 1794825114415 },
  "hosts":    { "<hostId>":    { "v": HostProfile, "t": 1794825114415 } },
  "groups":   { "<groupId>":   { "v": StickerGroup, "t": 1794825114415 } },
  "stickers": { "<stickerId>": { "v": Sticker, "t": 1794825114415, "d": true } },
  "order": {
    "groups":   { "v": ["default", "hanabi"], "t": 1794825114415 },
    "stickers": { "v": ["s1", "s2"],          "t": 1794825114415 }
  }
}
```

- 每个条目是 `Entry<T> = { v: T, t: number, d?: true }`：`t` 为该条目最后修改时间，`d` 为删除墓碑（`v` 可省略）。
- 墓碑保留 90 天后清理。
- `settings.v` 包含：`activeHostId pasteUpload dropUpload imageTemplate stickerTemplate compress compressFormat compressQuality maxWidth collectFromPost freezeAnimated hoverPreview seededPacks`。
  **不同步**：上传记录 `history`、同步配置本身（后端地址、令牌、加密口令）。

### StickerGroup

```jsonc
{ "id": "hanabi", "name": "花火", "icon": Icon, "builtin": "hanabi" }
```

### Icon（分组图标，三选一）

```jsonc
{ "type": "svg",   "data": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0i..." }  // 内嵌 SVG，base64
{ "type": "url",   "url":  "https://example.com/icon.png" }                    // 远程图片（也接受 data:image/* URL）
{ "type": "emoji", "text": "🔥" }
```

本地存储里图标是字符串（`<svg…>` / URL / emoji），同步时与上面结构互转，旧客户端读不到的类型降级为默认图标。

### Sticker

```jsonc
{ "id": "s1", "url": "https://…/a.gif", "name": "花火01", "groupId": "hanabi",
  "favorite": true, "useCount": 3, "lastUsedAt": 1794825114415, "createdAt": 1794825000000 }
```

### HostProfile

```jsonc
{ "id": "h_k3f9a2", "name": "我的图床", "provider": "cfimgbed", "values": { "base": "https://…", "authCode": "…" } }
```

## 3. 合并规则（客户端）

1. 条目级 LWW（last-writer-wins）：同一 id 取 `t` 大的一方；`t` 相同取 `device` 字典序大的一方，保证各端结果一致。
2. 墓碑参与比较：删除时间晚于修改时间则删除生效。
3. `order.*` 整体 LWW；合并后把不在顺序表里的条目按 `createdAt` 追加到末尾，顺序表里已删除的 id 丢弃。
4. `useCount` 例外：取两边最大值（计数不应因合并回退）；`lastUsedAt` 同理。
5. 本地变更时间戳的来源：客户端为每个条目保存上次同步时的内容摘要（meta），本地内容变化即把该条目 `t` 置为当前**逻辑时间**。
6. 逻辑时钟：当前逻辑时间 = max(本机时间, 见过的最大条目时间 + 1)。看过云端最新状态之后做的修改一定比云端已有的更新，不受设备时钟快慢影响。
7. 从未同步过的本地条目（meta 里没有）时间记为 0，合并时让位于云端已有的同一条目（如新设备自带的默认分组不会覆盖别人改过的名字）；合并后仍为 0 的条目（云端没有）推送前盖上当前逻辑时间，云端不会出现时间为 0 的条目。

### 并发

- **多台设备**：服务端条件写入（`If-Match`）保证不会覆盖别人的写入；冲突（412）时客户端退避（随机）后重新拉取、合并、推送，最多 8 次。数据端到端加密，合并只能在客户端完成。
- **同一设备多个标签页**：共享本地存储。同步过程用 Web Locks 串行执行，且只有一个主标签页负责自动同步；每次同步开始时从存储读取同步状态（meta、ETag、逻辑时钟），结束时立即落盘。
- **同步状态的提交时机**：只有确认本地与云端一致（推送成功，或无需推送）时才提交 meta 与 ETag；推送失败时，若已把云端内容写回本地，则提交 meta 但清空 ETag，下次完整拉取比对，没推送出去的本地修改不会丢。

## 4. Envelope（`nsh-sync-envelope/1`）

```jsonc
{
  "format": "nsh-sync-envelope/1",
  "updatedAt": 1794825114415,
  "device": "d_k3f9a2",
  "zip": "gzip",                         // gzip | none
  "enc": "aes-256-gcm",                  // aes-256-gcm | none
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iter": 210000, "salt": "base64(16B)" },  // enc=none 时省略
  "iv": "base64(12B)",                   // enc=none 时省略
  "data": "base64(…)"                    // gzip(JSON) 或 AES-GCM(gzip(JSON))
}
```

- 口令只保存在本机，不进入任何后端；忘记口令无法恢复，只能用本地数据覆盖远端。
- `updatedAt` / `device` 明文放在信封上，便于后端和客户端在不解密的情况下判断新旧。

## 5. 自建同步服务 HTTP API（`server/`）

认证：`Authorization: Bearer <token>`。每个令牌对应一个独立空间（space），空间 ID = `hex(sha256(token))[:32]`，服务端不保存明文令牌。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/healthz` | 健康检查，返回 `ok` |
| `GET` | `/v1/sync` | 读取信封。`200` + `ETag` + `X-Updated-At`；不存在返回 `404`；带 `If-None-Match` 且未变返回 `304` |
| `HEAD` | `/v1/sync` | 同上但无响应体，用于廉价轮询 |
| `PUT` | `/v1/sync` | 写入信封。已存在时必须带 `If-Match: <etag>`，不存在时带 `If-None-Match: *`；不匹配返回 `412` 并在 `ETag` 头给出当前版本。成功返回 `200 {"etag","updatedAt","size"}` |
| `GET` | `/v1/sync/watch?etag=<etag>&timeout=25` | 长轮询：版本与 `etag` 不同时立即返回 `200 {"etag","updatedAt"}`；超时返回 `304`；`timeout` 上限 55 秒 |
| `DELETE` | `/v1/sync` | 删除本空间数据，返回 `204` |

**口令锁**：`PUT` / `DELETE` 可带 `X-NSH-Key-Id: <hex>`（客户端由加密口令派生的密钥标识，见下）。空间第一次带标识的写入成功后，服务端把它记在 `<空间ID>.lock`；之后标识不同（含不带标识）的写入与删除返回 `403`，并带响应头 `X-NSH-Locked: 1`。已锁定空间的 `GET` 也带该响应头。锁只能由管理员在服务器上执行 `token unlock` 解除。

密钥标识 = hex( PBKDF2-SHA256( 口令, salt = `"nsh-sync/key-id/v1" 0x00 令牌`, 210000 次, 256 bit ) )。与加密用的密钥（每次随机 salt）不同，单向派生，服务端不能由它反推口令或解密数据；salt 含令牌，不同空间用相同口令得到的标识也不同。

- ETag：响应体 SHA-256 前 16 字节的 hex，带双引号（`"a1b2…"`）。
- 请求体上限默认 2 MiB（`413`），必须是以 `{` 开头的 JSON（`400`）。
- CORS：允许任意来源，允许 `Authorization, Content-Type, If-Match, If-None-Match`，暴露 `ETag, X-Updated-At`。
- 内存目标：常驻 < 10 MB。信封以流的方式写盘 / 读盘（不整体驻留内存），内存里只保留每个空间的元数据（etag、updatedAt、size）。

### 同步码

`nsh1_` + base64url( mask( utf8(对外地址) ‖ 0x00 ‖ utf8(令牌) ‖ 校验 2 字节 ) )

- 校验：对 `地址 0x00 令牌` 计算 FNV-1a 32 位，取低 16 位（大端）。
- mask：第 i 字节 `^ key[i % len(key)] ^ ((i*0x5b + 0x2d) & 0xff)`，key = `nodeseek-helper/sync-code/v1`。
- 服务端 `server/synccode.go` 与客户端 `src/sync/sync-code.ts` 共用测试向量。编码混淆而非加密。

### 接入码

已配置好的客户端可生成「接入码」：与同步码同一格式，明文为 `地址 0x00 令牌 0x00 加密口令`（口令段可选，旧同步码照常解析）。
新设备粘贴后同时得到服务地址、令牌与口令，可直接解密已有数据。接入码包含口令，比同步码更敏感，仅在自己的设备间传递。

## 6. 其他后端的映射

| 后端 | 存储位置 | 版本号 |
|---|---|---|
| WebDAV（坚果云 / Nextcloud / 群晖…） | `<目录>/nodeseek-helper-sync.json` | 响应头 `ETag`，写入用 `If-Match` |
| GitHub Gist | 私密 Gist 中的 `nodeseek-helper-sync.json` | Gist `updated_at` + 内容摘要（Gist 不支持条件写，写前先读比对） |
| OneDrive | 应用文件夹 `approot:/nodeseek-helper-sync.json`（权限 `Files.ReadWrite.AppFolder`） | `eTag`，写入用 `If-Match` |

所有后端在冲突（412 或摘要不一致）时都走同一流程：重新拉取 → 合并 → 再推送，最多重试 3 次。
