# 実装タスク: growi-vault-gateway

## タスク概要

本 spec の実装タスクは以下の依存順序で進める:

1. 共通 DTO 型（@growi/core）— 両 spec 共通の契約基盤
2. 設定 config 定義（apps/app）— 他コンポーネントの前提
3. Mongoose モデル（vault_instructions / vault_sync_state）
4. PAT 認証ミドルウェア
5. VaultNamespaceMapper サービス
6. VaultSettingsService
7. VaultDispatcher（イベント購読 + outbox 書き込み）
8. VaultManagerClient（RPC + proxy）
9. VaultBootstrapper
10. VaultGatewayRouter（エンドポイント統合）
11. Admin API ルート
12. VaultAdminSettings UI
13. feature 登録と routes 統合
14. テスト

---

## タスク 1: @growi/core の vault DTO 型定義

_要件: 9_
_Boundary: `packages/core/src/interfaces/vault/`_

### [x] 1.1 vault-instruction.ts の作成

`packages/core/src/interfaces/vault/vault-instruction.ts` を新規作成する。

- `VaultInstructionOp` 型（union: `'upsert' | 'bulk-upsert' | 'remove' | 'rename-prefix' | 'grant-change-prefix' | 'reset-all'`）を定義する
- `Namespace` 型（string alias）を定義する
- `VaultBulkUpsertEntry` インターフェース（pageId / pagePath / revisionId）を定義する
- `VaultInstructionPayload` インターフェースを定義する（全フィールド readonly、namespace は optional（`op === 'reset-all'` の場合は undefined）、その他フィールドも optional）
- `VaultInstructionDoc` インターフェース（_id / op / payload / issuedAt / processedAt / attempts / lastError）を定義する（`op` は payload の外、`VaultInstructionDoc` のトップレベルフィールド）
- 全型を named export する
- **完了確認**: TypeScript コンパイルが通ること。各型に意図が明確なコメントが付いていること

### [x] 1.2 vault-compose-view.ts の作成

`packages/core/src/interfaces/vault/vault-compose-view.ts` を新規作成する。

- `ComposeViewRequest` インターフェース（userId: string | null、namespaces: ReadonlyArray\<Namespace\>）を定義する
- `ComposeViewResponse` インターフェース（viewRef: string、commitOid: string）を定義する
- 全型を named export する
- **完了確認**: TypeScript コンパイルが通ること

### [x] 1.3 vault-storage-stats.ts の作成

`packages/core/src/interfaces/vault/vault-storage-stats.ts` を新規作成する。

- `StorageStatsResponse` インターフェース（namespaceCount: number、totalCommitCount: number、looseObjectCount: number、repoSizeBytes: number、lastSquashAt: string | null、lastGcAt: string | null）を定義する。全フィールド readonly
- 全型を named export する
- **完了確認**: TypeScript コンパイルが通ること

### [x] 1.4 vault index.ts バレルと package.json exports 追加

`packages/core/src/interfaces/vault/index.ts` を作成して全型を re-export する。

- `packages/core/src/interfaces/vault/index.ts` を作成する
- `vault-instruction.ts`・`vault-compose-view.ts`・`vault-storage-stats.ts` から全 named exports を re-export する
- `packages/core/package.json` の `exports` フィールドに `"./dist/interfaces/vault": { "types": "./dist/interfaces/vault/index.d.ts", "default": "./dist/interfaces/vault/index.js" }` を追加する
- `packages/core` のビルドが通ること（`pnpm --filter @growi/core build`）を確認する
- **完了確認**: `import { VaultInstructionOp, ComposeViewRequest, StorageStatsResponse } from '@growi/core/interfaces/vault'` が型エラーなく通ること

---

## タスク 2: config-definition.ts への vault 設定追加

_要件: 7_
_Boundary: `apps/app/src/server/models/config-definition.ts`_

### [x] 2.1 vault 関連の config key 定義

`apps/app/src/server/models/config-definition.ts` を編集する。

- `app:vaultEnabled`（envVarName: `VAULT_ENABLED`、isSecret: false、publishToClient: false、defaultValue: false）を追加する
- `app:vaultManagerEndpoint`（envVarName: `VAULT_MANAGER_ENDPOINT`、isSecret: false、publishToClient: false、DB ストア無効）を追加する
- `app:vaultManagerInternalSecret`（envVarName: `VAULT_MANAGER_INTERNAL_SECRET`、isSecret: true、publishToClient: false、DB ストア無効）を追加する
- TypeScript の型エラーがないこと
- **完了確認**: `turbo run build --filter @growi/app` がエラーなく通ること

---

## タスク 3: Mongoose モデルの実装

_要件: 4、5_
_Boundary: `apps/app/src/features/growi-vault/server/models/`_

### [x] 3.1 vault-instruction Mongoose model の作成

`apps/app/src/features/growi-vault/server/models/vault-instruction.ts` を新規作成する。

- `VaultInstructionDoc` インターフェースを `@growi/core/interfaces/vault` からインポートする
- Mongoose Schema を定義する（op / payload フィールド / issuedAt / processedAt / attempts / lastError）
- `{ processedAt: 1, issuedAt: 1 }` の複合インデックスを定義する
- `{ processedAt: 1 }` の TTL インデックス（expireAfterSeconds: 86400）を定義する
- Mongoose モデルを named export する
- **完了確認**: TypeScript コンパイルが通ること。スキーマが `VaultInstructionDoc` インターフェースと整合していること

### [x] 3.2 vault-sync-state Mongoose model の作成

`apps/app/src/features/growi-vault/server/models/vault-sync-state.ts` を新規作成する。

- `vault_sync_state` コレクションの Mongoose Schema を定義する（`_id: 'singleton'`）
- apps/app owned フィールド（bootstrapState / bootstrapCursor / bootstrapStartedAt / bootstrapCompletedAt / bootstrapTotalEstimated / bootstrapProcessed）を定義する
- vault-manager owned フィールド（resumeToken / lastProcessedAt / watcherInstanceId）を read 用に含める（apps/app は write しない）
- Mongoose モデルを named export する
- **完了確認**: TypeScript コンパイルが通ること。singleton doc のアップサート操作が型安全に書けること

---

## タスク 4: VaultPatAuth ミドルウェアの実装

_要件: 2_
_Boundary: `apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.ts`_
_Depends: 1.1_

### [x] 4.1 vault-pat-auth.ts の作成

`apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.ts` を新規作成する。

- `VaultAuthResult` 型（`{ userId: string; scopes: ReadonlyArray<string> } | null`）を定義する
- `VaultPatAuth` インターフェースを定義する
- `authenticate(req: Request): Promise<VaultAuthResult>` を実装する:
  - `Authorization: Basic ...` ヘッダーを解析し base64 decode する
  - password 部を PAT として既存 `access-token-parser` の `findUserIdByToken` を呼ぶ
  - `Authorization` ヘッダーが存在しない場合は `null`（匿名）を返す
  - PAT 検証失敗時は `WWW-Authenticate: Basic realm="GROWI Vault"` ヘッダーを含む 401 を返す
  - エラーメッセージにページリスト・存在情報を含めない
- named export する
- **完了確認**: 有効 PAT・無効 PAT・匿名・scope 制限の各パターンで単体テストが通ること

### [x] 4.2 VaultPatAuth の単体テスト

`apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.spec.ts` を作成する。

- 有効 PAT → `{ userId, scopes }` を返すことをテストする
- 無効 / revoke 済み PAT → 401 + WWW-Authenticate ヘッダーをテストする
- `Authorization` ヘッダーなし → `null`（匿名）を返すことをテストする
- scope 制限 PAT → scopes フィールドに制限が反映されることをテストする
- エラーレスポンスにページ情報が含まれないことをテストする
- **完了確認**: `pnpm vitest run vault-pat-auth.spec` が全テスト通過すること

---

## タスク 5: VaultNamespaceMapper の実装

_要件: 3_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-namespace-mapper.ts`_
_Depends: 1.1, 1.2_

### [x] 5.1 vault-namespace-mapper.ts の作成

`apps/app/src/features/growi-vault/server/services/vault-namespace-mapper.ts` を新規作成する。

- `VaultNamespaceMapper` インターフェース（`computeAccessibleNamespaces` / `computePageNamespaces`）を定義する
- `computeAccessibleNamespaces(userId: string | null)`:
  - `userId` が null の場合は `['public']` のみを返す
  - 認証済みの場合は `['public', 'restricted-link']` + ユーザーが所属する全 group の `'group-<gid>'` + `'user-<uid>-only-me'` を返す
  - 既存 `findAllUserGroupIdsRelatedToUser` を使用して group ID を解決する
- `computePageNamespaces(page: IPage)`: 戻り値は `{ current: ReadonlyArray<Namespace>; previous?: ReadonlyArray<Namespace> }`
  - GRANT_PUBLIC → `{ current: ['public'] }`
  - GRANT_RESTRICTED → `{ current: ['restricted-link'] }`
  - GRANT_USER_GROUP → grantedGroups 全要素を `'group-<gid>'` にマップし `{ current: ['group-<gid1>', 'group-<gid2>', ...] }` として返す（1 ページが複数 group を持つ場合は複数要素の配列）
  - GRANT_OWNER → `{ current: ['user-<creator-id>-only-me'] }`
  - `/trash` 配下または status !== 'published' → namespace を発行しない
  - ACL 変更検出のために `previous` フィールドを含める
- named export する
- **完了確認**: 各 GRANT 種別の単体テストが全て通ること

### [x] 5.2 VaultNamespaceMapper の単体テスト

`apps/app/src/features/growi-vault/server/services/vault-namespace-mapper.spec.ts` を作成する。

- `computeAccessibleNamespaces` の各パターン（null / 認証済み / group 所属 / only-me）をテストする
- `computePageNamespaces` の各 GRANT 種別をテストする
- 複数 group の場合に `ReadonlyArray<Namespace>` が返ること（`current` が複数要素の配列）をテストする
- `/trash` 配下のページが namespace を返さないことをテストする
- status !== 'published' のページが namespace を返さないことをテストする
- ACL 変更時に `previous` と `current` の両方を返すことをテストする
- **完了確認**: `pnpm vitest run vault-namespace-mapper.spec` が全テスト通過すること

---

## タスク 6: VaultSettingsService の実装

_要件: 7_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-settings-service.ts`_
_Depends: 2.1_

### [x] 6.1 vault-settings-service.ts の作成

`apps/app/src/features/growi-vault/server/services/vault-settings-service.ts` を新規作成する。

- `VaultSettings` インターフェース（enabled / managerEndpoint / managerInternalSecret）を定義する
- `VaultSettingsService` インターフェースを定義する
- `getSettings()` を実装する:
  - 既存 ConfigManager を `ConfigSource.env` 付きで使用して `app:vaultEnabled` を env のみから取得する（DB フォールバック禁止）
  - `app:vaultManagerEndpoint` / `app:vaultManagerInternalSecret` は env var からのみ取得する
  - デフォルト値: `enabled: false`
- named export する
- **完了確認**: TypeScript コンパイルが通ること。env var のみ設定が DB に保存されないことをテストで確認すること

---

## タスク 7: VaultDispatcher の実装

_要件: 4_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts`_
_Depends: 3.1, 5.1_

### [x] 7.1 vault-dispatcher.ts の作成

`apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts` を新規作成する。

- `VaultDispatcher` インターフェース（`onPageChanged` / `onBulkOperation`）を定義する
- `onPageChanged(event: PageChangedEvent)` を実装する:
  - `create` / `update` イベント → current namespace に `upsert` instruction を挿入する
  - `delete` イベント → current namespace に `remove` instruction を挿入する（pagePath は削除直前の値）
  - ACL 変更時 → `previous` namespace に `remove` + `current` namespace に `upsert` の 2 件を挿入する
  - coalesce window（既定 1 秒）内に同一 namespace で 100 件以上の `upsert` が発生した場合は `bulk-upsert` にまとめる（chunk size 上限 1000）
- `onBulkOperation(event: BulkPageOperationEvent)` を定義する（API・発火経路ともに実装済み — タスク 21.1-A / 21.1-B）:
  - 親ページ rename → 影響 namespace ごとに `rename-prefix` instruction を挿入する — **タスク 21.1-B で配線済み**
  - 親ページ grant 一括変更 → 個別ページ単位の `acl-change` instruction（既存 dispatcher 経路）で per-page に remove + upsert を発行する — **タスク 21.1-B で配線済み**（`grant-change-prefix` op は subtree 単位の prefix scope を持たないため将来の vault-manager 設計改修まで使用しない）
- 書き込み失敗時は WARN ログ + リトライ（ページ編集 response とは切り離す）
- named export する
- **完了確認**: イベント種別ごとの単体テストが全て通ること（`onBulkOperation` の rename-prefix / grant-change-prefix 発火は Stage 2 で実装）

### [x] 7.2 VaultDispatcher の単体テスト

`apps/app/src/features/growi-vault/server/services/vault-dispatcher.spec.ts` を作成する。

- create イベント → `upsert` instruction が発行されることをテストする
- delete イベント → `remove` instruction が発行されることをテストする
- ACL 変更イベント → `remove` + `upsert` の 2 件が発行されることをテストする
- 同 namespace への高頻度 event（100+）が `bulk-upsert` に coalesce されることをテストする
- coalesce window 外の event は単発 `upsert` で発行されることをテストする
- 親 rename → `rename-prefix` が発行されることをテストする — **タスク 21.1-B 実装済み（`server/index.spec.ts` の Stage 2 describe ブロック）**
- 親 grant 変更 → per-page `acl-change`（remove + upsert）が発行されることをテストする — **タスク 21.1-B 実装済み（同上）**
- **完了確認**: `pnpm vitest run vault-dispatcher.spec` が全テスト通過すること

### [x] 7.3 PageService event 購読の組み込み（**全 Stage 実装完了 — Stage 1: タスク 21.1-A, Stage 2: タスク 21.1-B**）

`apps/app/src/features/growi-vault/server/index.ts` で VaultDispatcher の event 購読を実装する。

- `'create' | 'update' | 'delete'` に subscribe する（**実装済み**）
- `'updateMany'` に subscribe する：
  - 4 つ目の payload `{ oldPagePathPrefix, newPagePathPrefix }` が存在する場合 → 影響 namespace 集合を計算し `rename-prefix` instruction を 1 件 / namespace 発行（Stage 2 fast path）
  - 4 つ目の payload が無い場合（legacy emit） → per-page upsert にフォールバック（Stage 1 fallback）
- `'rename'` の `{ page, oldPath, newPath, user }` payload を subscribe → `rename-prefix` instruction を 1 件 / namespace 発行（**実装済み**）
- `'descendantsGrantChanged'` の `{ affectedPages, user }` payload を subscribe → per-page `acl-change` instruction を発行（既存 dispatcher 経路を流用）（**実装済み**）
- `'syncDescendantsUpdate'` / `'syncDescendantsDelete'` は debug ログのみの no-op（前者は `'updateMany'` で、後者は per-page `'delete'` で吸収されるため）
- feature 有効時（vaultEnabled）のみ購読を開始する（**実装済み**）
- **完了確認**: `server/index.spec.ts` に 14 件のテストを実装。全イベントで dispatcher が期待通り呼び出されることを検証済み。`pnpm vitest run src/features/growi-vault/server/index.spec.ts` PASS

---

## タスク 8: VaultManagerClient の実装

_要件: 6_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-manager-client.ts`_
_Depends: 1.2, 6.1_

### [x] 8.1 vault-manager-client.ts の作成

`apps/app/src/features/growi-vault/server/services/vault-manager-client.ts` を新規作成する。

- `VaultManagerClient` インターフェース（`composeView` / `proxyGitRequest` / `getStorageStats`）を定義する
- `composeView(req: ComposeViewRequest): Promise<ComposeViewResponse>` を実装する:
  - `POST {managerEndpoint}/internal/compose-view` を呼び出す
  - `Authorization: Bearer ${managerInternalSecret}` ヘッダーを付与する
  - vault-manager エラー時は `Error` を throw する（呼び出し元が 502 を返す）
- `proxyGitRequest(opts)` を実装する:
  - 指定された path への GET / POST を vault-manager に転送する
  - `X-Vault-View-Ref: {viewRef}` ヘッダーを付与する
  - `Authorization: Bearer ${managerInternalSecret}` ヘッダーを付与する
  - request body を stream で転送し（フルバッファ化しない）、response body を stream で返す
  - 接続エラー時は適切なエラーを throw する
- `getStorageStats(): Promise<StorageStatsResponse>` を実装する:
  - `GET {managerEndpoint}/internal/storage-stats` を呼び出す
  - `Authorization: Bearer ${managerInternalSecret}` ヘッダーを付与する
  - レスポンスを `@growi/core` の `StorageStatsResponse` 型として返す
  - vault-manager エラー時は `Error` を throw する（admin API が 502 を返す）
- named export する
- **完了確認**: shared secret の付与、proxy stream の正常系・異常系、getStorageStats の正常系・異常系の単体テストが通ること

### [x] 8.2 VaultManagerClient の単体テスト

`apps/app/src/features/growi-vault/server/services/vault-manager-client.spec.ts` を作成する。

- composeView の正常系（viewRef / commitOid を返す）をテストする
- composeView の異常系（vault-manager が 500 → Error を throw）をテストする
- proxyGitRequest の shared secret 付与をテストする
- proxyGitRequest のストリーム転送（バッファ化されないこと）をテストする
- getStorageStats の正常系（StorageStatsResponse を返す）をテストする
- getStorageStats の異常系（vault-manager が 500 → Error を throw）をテストする
- **完了確認**: `pnpm vitest run vault-manager-client.spec` が全テスト通過すること

---

## タスク 9: VaultBootstrapper の実装

_要件: 5_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts`_
_Depends: 3.1, 3.2, 5.1_

### [x] 9.1 vault-bootstrapper.ts の作成

`apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts` を新規作成する。

- `VaultBootstrapper` インターフェース（`start` / `getStatus`）を定義する
- `start(opts?)` を実装する:
  - bootstrapState が `'running'` の場合は即リターン（二重起動防止）
  - vault_sync_state.bootstrapState を `'running'` に遷移させる
  - vault_sync_state.bootstrapTotalEstimated を `pages.estimatedDocumentCount()` で更新する
  - `op: 'reset-all'` を vault_instructions に insert する
  - `pages.find({ status: 'published', path: { $not: /^\/trash/ } }).cursor()` で pages を stream 処理する
  - `VaultNamespaceMapper.computePageNamespaces` で namespace を計算する
  - namespace 単位のバッファに蓄積し CHUNK_SIZE（既定 1000）に達したら `bulk-upsert` instruction を insert する
  - 各 page 処理後に vault_sync_state.bootstrapCursor / bootstrapProcessed を更新する
  - cursor 走査完了後に残バッファを flush する
  - bootstrapState を `'done'` に遷移させる
  - 例外が発生した場合は bootstrapState を `'failed'` に遷移させ lastError を記録する
- `getStatus()` を実装する（vault_sync_state から現在の状態を返す）
- `bootstrapCursor` が存在する場合は resume を考慮する（`page._id > bootstrapCursor` でフィルター）
- named export する
- **完了確認**: bootstrap の各フェーズが正しく遷移することの単体テストが通ること

### [x] 9.2 VaultBootstrapper の単体テスト

`apps/app/src/features/growi-vault/server/services/vault-bootstrapper.spec.ts` を作成する。

- `reset-all` instruction が最初に発行されることをテストする
- pages cursor stream から namespace 単位の `bulk-upsert` が発行されることをテストする
- CHUNK_SIZE 境界（999/1000/1001 ページ）での flush 動作をテストする
- bootstrap 完了後に bootstrapState が `'done'` になることをテストする
- failure 時に bootstrapState が `'failed'` になり lastError が記録されることをテストする
- bootstrapCursor からの resume 動作をテストする
- 二重起動が防止されることをテストする（state が `'running'` の間は start が即リターン）
- **完了確認**: `pnpm vitest run vault-bootstrapper.spec` が全テスト通過すること

---

## タスク 10: VaultGatewayRouter の実装

_要件: 1, 2.4, 10_
_Boundary: `apps/app/src/features/growi-vault/server/routes/vault-gateway.ts`_
_Depends: 4.1, 5.1, 6.1, 8.1_

### [x] 10.1 vault-gateway.ts の作成

`apps/app/src/features/growi-vault/server/routes/vault-gateway.ts` を新規作成する。

- Express Router を作成する
- `GET /vault.git/info/refs` ハンドラーを実装する:
  - `VAULT_ENABLED` env を確認し false なら 404 を返す（環境変数による永続的な設定状態であり Retry-After は付与しない）
  - bootstrapState を確認し done 以外なら 503 + Retry-After を返す（bootstrap は一時的な状態のため 503 が適切）
  - `service=git-upload-pack` のみ許可し、それ以外は 400 を返す
  - VaultPatAuth.authenticate を呼び出す（認証失敗時は 401）
  - VaultNamespaceMapper.computeAccessibleNamespaces を呼び出す
  - VaultManagerClient.composeView を呼び出す
  - VaultManagerClient.proxyGitRequest（GET /internal/git/info/refs）を呼び出す
  - response を stream forward する
  - audit log に 'vault.clone-prepare' を記録する
- `POST /vault.git/git-upload-pack` ハンドラーを実装する:
  - 同様の auth / feature flag チェック
  - VaultManagerClient.proxyGitRequest（POST /internal/git/git-upload-pack）を呼び出す
  - response を stream forward する
  - audit log に 'vault.clone-complete' を記録する
- `/vault.git/git-receive-pack` への全リクエストに 403 `read-only repository` を返す
- その他の `/vault.git/*` パスに 404 を返す
- エラーハンドリング: compose-view / proxy 失敗時は 502、接続不能は 503
- named export する
- **完了確認**: 各 HTTP パスの正常系・異常系が期待通りのステータスコードを返すことをテストで確認すること

### [x] 10.2 VaultGatewayRouter の統合テスト

`apps/app/src/features/growi-vault/server/routes/vault-gateway.spec.ts` を作成する。

- `VAULT_ENABLED=false`（env）の場合に 404 を返すことをテストする（Retry-After なし）
- `bootstrapState !== 'done'` の場合に 503 + Retry-After を返すことをテストする
- push 試行（git-receive-pack）が 403 を返すことをテストする
- 認証失敗時に 401 + WWW-Authenticate を返すことをテストする（ページ情報を含まない）
- 正常な clone sequence で compose-view と proxy が呼ばれることをテストする
- audit log への記録をテストする
- **完了確認**: `pnpm vitest run vault-gateway.spec` が全テスト通過すること

---

## タスク 11: Admin API ルートの実装

_要件: 8_
_Boundary: `apps/app/src/features/growi-vault/server/routes/vault-admin.ts`_
_Depends: 6.1, 9.1_

### [x] 11.1 vault-admin.ts の作成

`apps/app/src/features/growi-vault/server/routes/vault-admin.ts` を新規作成する。

- Express Router を作成する（管理者認証ミドルウェアを適用）
- `GET /_api/v3/vault/status` エンドポイントを実装する:
  - VaultBootstrapper.getStatus() の結果を返す
  - `VaultManagerClient.getStorageStats()` を呼び出して `StorageStatsResponse`（namespaceCount / totalCommitCount / looseObjectCount / repoSizeBytes / lastSquashAt / lastGcAt）をレスポンスに含める
  - vault-manager 側のエラー時は storage stats を null として返し、admin UI 側で「取得失敗」を表示できるようにする（bootstrap status は引き続き返す）
- `POST /_api/v3/vault/bootstrap` エンドポイントを実装する:
  - VaultBootstrapper.start({ triggerSource: 'admin-ui' }) を呼び出す
  - bootstrapState が既に 'running' の場合は 409 を返す
- `POST /_api/v3/vault/wipe` エンドポイントを実装する（kill switch）:
  - VaultBootstrapper.wipeAndRebootstrap({ triggerSource: 'admin-force-wipe' }) を呼び出す
  - `op: 'reset-all'` が vault_instructions に発行され、bootstrapState が ANY state → running に強制遷移する
  - audit log に `vault.wipe`（実行ユーザ・タイムスタンプを含む）を必ず記録する
- `PUT /_api/v3/vault/enabled` エンドポイントは提供しない（`VAULT_ENABLED` は env のみ、ランタイム書き換え不可）
- named export する
- **完了確認**: 管理者 API の各エンドポイントが期待通りのレスポンスを返すことをテストで確認すること

---

## タスク 12: VaultAdminSettings UI の実装

_要件: 8_
_Boundary: `apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx`_
_Depends: 11.1_

### [x] 12.1 VaultAdminSettings.tsx の作成

`apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx` を新規作成する。

- React 関数コンポーネントとして実装する
- SWR を使用して `GET /_api/v3/vault/status` を定期ポーリングする
- Feature status (read-only) セクション:
  - `VAULT_ENABLED` の現在値を read-only で表示する（環境変数による制御である旨を併記）
  - 変更には apps/app の再起動が必要である旨を併記する
- Bootstrap operation セクション:
  - "Prepare GROWI Vault" ボタンを表示する
  - ボタン押下時に `POST /_api/v3/vault/bootstrap` を呼び出す
  - bootstrapState が `running` の間はボタンを disabled にする
- Kill switch セクション:
  - "Wipe Vault" ボタンを表示する（赤系の destructive スタイル）
  - 押下時に確認モーダル（Yes / Cancel、テキスト入力なし）を表示する
  - 確認後に `POST /_api/v3/vault/wipe` を呼び出す
  - bootstrapState が `running` の間はボタンを disabled にする
- Bootstrap status セクション:
  - `state` / `processed` / `totalEstimated` / `startedAt` / `completedAt` / `lastError` を表示する
  - `running` の間は進捗バー（processed / totalEstimated）を表示する
- Storage observability セクション:
  - `GET /_api/v3/vault/status` のレスポンスから storage stats を取得し、namespace 数 / 合計 commit 数 / loose object 数 / repo size / 最終 squash・gc 時刻を表示する
  - storage stats が null の場合（vault-manager 取得失敗時）は「取得失敗」を表示する
- Audit log filter link セクション:
  - 既存 audit log UI に "vault.*" フィルターを適用するリンクを表示する
- named export する
- **完了確認**: コンポーネントが TypeScript エラーなくビルドできること。各セクションが意図通りにレンダリングされることを確認すること

### [x] 12.2 admin UI の index.ts バレル

`apps/app/src/features/growi-vault/client/admin/index.ts` を作成し、`VaultAdminSettings` を re-export する。

- **完了確認**: `import { VaultAdminSettings } from '~/features/growi-vault/client/admin'` が型エラーなく通ること

---

## タスク 13: feature 登録と routes 統合

_要件: 1、7_
_Boundary: `apps/app/src/features/growi-vault/server/index.ts`、`apps/app/src/server/routes/index.ts`_
_Depends: 7.3, 10.1, 11.1_

### [x] 13.1 feature 登録ファイルの作成

`apps/app/src/features/growi-vault/server/index.ts` を新規作成する。

- VaultDispatcher のインスタンスを作成し、PageEvent への購読を登録する（vaultEnabled 時のみ）
- VaultBootstrapper のインスタンスを作成し、`VAULT_BOOTSTRAP_ON_START=true` の場合は起動時に `start()` を呼ぶ
- VaultGatewayRouter・VaultAdminRouter を export する
- named export する
- **完了確認**: apps/app 起動時に vault feature が正しく初期化されることを確認すること

### [x] 13.2 VaultGatewayRouter の routes/index.ts への登録

`apps/app/src/server/routes/index.ts`（または app 起動箇所）を編集する。

- `VaultGatewayRouter` を `/vault.git` パス配下に登録する
- `VaultAdminRouter` を適切な admin ルート配下に登録する
- **完了確認**: `GET /vault.git/info/refs` が 404（feature disabled 時）または正常なレスポンスを返すこと

---

## タスク 14: 統合テストの作成

_要件: 1–10_
_Boundary: `apps/app/src/features/growi-vault/__tests__/`_
_Depends: 10.1, 11.1, 12.1, 13.1, 13.2_

### [x] 14.1 clone E2E 統合テストの作成

`apps/app/src/features/growi-vault/__tests__/clone-e2e.integ.ts` を作成する。

- docker-compose 環境で apps/app + vault-manager + MongoDB を起動する
- 実際に `git clone http://user:PAT@localhost:3000/vault.git` を実行する
- clone 結果のファイル一覧と内容が期待通りであることを確認する
- **完了確認**: `dev-verification.md` の「clone-e2e.integ.ts の手動確認（タスク 14.1 / 18.3）」セクションを実行し、全確認項目がパスすること。
  （integ テストは `describe.skip` のまま運用する — タスク 23.2 選択肢 B による正式承認）

### [x] 14.2 ACL 隔離・bootstrap・coalesce の統合テスト

`apps/app/src/features/growi-vault/__tests__/vault-gateway.integ.ts` を作成する。

- vaultEnabled=false の場合に `info/refs` および `git-upload-pack` が 404 を返すことを確認する（Retry-After なし）
- bootstrapState が running の間 clone が 503+Retry-After を返すことを確認する
- push 試行が 403 を返すことを確認する
- bootstrap 完了後に clone が成功することを確認する
- ACL で保護されたページが clone 結果に含まれないことを確認する
- 同 namespace への高頻度 edit が bulk-upsert に coalesce されることを確認する
- **完了確認**: `dev-verification.md` の「vault-gateway.integ.ts の手動確認（タスク 14.2 / 18.3）」セクションを実行し、全確認項目がパスすること。
  （integ テストは `describe.skip` のまま運用する — タスク 23.2 選択肢 B による正式承認）

---

## タスク 15: Admin 画面への VaultAdminSettings 導線追加

_要件: 8_
_Boundary: `apps/app/src/pages/admin/vault.page.tsx`_
_Depends: 12.1_

### [x] 15.1 admin/vault.page.tsx の作成

`apps/app/src/pages/admin/vault.page.tsx` を新規作成する。

- Next.js Pages Router の規約に従い `VaultAdminSettings` コンポーネントを表示するページを実装する
- 既存の admin ページ（例: `apps/app/src/pages/admin/app.page.tsx`）を参考に `AdminLayout` でラップする
- admin サイドバーのナビゲーションに "GROWI Vault" エントリを追加する（既存の admin ナビ定義ファイルを確認して追記する）
- **完了確認**: `http://localhost:3000/admin/vault` にアクセスして VaultAdminSettings が表示されること。"Prepare GROWI Vault" ボタンが押下可能であること

---

## タスク 16: bootstrap 未完了時の git クライアント向けメッセージ改善

_要件: 1.5_
_Boundary: `apps/app/src/features/growi-vault/server/routes/vault-gateway.ts`_
_Depends: 10.1_

### [x] 16.1 503 レスポンスボディへの状態詳細追加

`vault-gateway.ts` の `assertGatewayReady` 関数を修正する。

- `bootstrapState` が `'pending'` の場合: `"GROWI Vault has not been initialised. Please ask your administrator to run the bootstrap from the Admin UI (/admin/vault)."` を返す
- `bootstrapState` が `'running'` の場合: `"GROWI Vault is initialising (bootstrap in progress). Please retry in a few minutes."` を返す（既存の Retry-After ヘッダーは維持する）
- `bootstrapState` が `'failed'` の場合: `"GROWI Vault initialisation failed. Please ask your administrator to re-run the bootstrap from the Admin UI (/admin/vault)."` を返す
- エラーメッセージにページリスト・存在情報を含めないこと（セキュリティ要件維持）
- **完了確認**: bootstrap 未実行の状態で `git clone` を実行したとき、git クライアントのエラー出力に上記メッセージが表示されること。`pnpm vitest run vault-gateway.spec` が全テスト通過すること

---

## タスク 17: Vault 関連 env の configManager 経由読み込みへの統一

_要件: 7_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-settings-service.ts`、`apps/app/src/features/growi-vault/server/index.ts`、`apps/app/src/server/service/config-manager/config-definition.ts`_
_Depends: 2.1, 6.1, 13.1_

### [x] 17.1 managerEndpoint / managerInternalSecret を configManager から読む

`apps/app/src/features/growi-vault/server/services/vault-settings-service.ts` を修正する。

- 現状は `process.env.VAULT_MANAGER_ENDPOINT` / `process.env.VAULT_MANAGER_INTERNAL_SECRET` を直接参照しているが、両キーはすでに `config-definition.ts` に `app:vaultManagerEndpoint` / `app:vaultManagerInternalSecret` として登録されているため、configManager から取得するように統一する
- env-only を強制するために `configManager.getConfig('app:vaultManagerEndpoint', ConfigSource.env)` のように `ConfigSource.env` を明示的に渡す（DB へのフォールバックを禁止）
- `ConfigSource` は `@growi/core/dist/interfaces` から import する（`config-manager.ts` と同一パターン）
- `app:vaultEnabled` も既に configManager 経由になっているので変更不要
- **背景**: env からの直接読み込みは config-definition.ts の登録を迂回しており、設定キーの一元管理（型安全な参照、isSecret マスキング、テスト時の上書き API）を破る。configManager 経由に統一することで env-only という制約を保ちつつ、他の設定キーと同一の仕組みに揃える
- **完了確認**: process.env 直接参照が消え、`ConfigSource.env` 経由に統一されていること

### [x] 17.2 VAULT_BOOTSTRAP_ON_START を config-definition に登録し configManager から読む

`apps/app/src/server/service/config-manager/config-definition.ts` と `apps/app/src/features/growi-vault/server/index.ts` を修正する。

- `config-definition.ts` の Vault Settings セクションに `app:vaultBootstrapOnStart` を追加する:
  - `envVarName: 'VAULT_BOOTSTRAP_ON_START'`
  - `defaultValue: false`（boolean）
  - `isSecret: false`、`publishToClient: false`
  - 既存 `app:vaultEnabled` と同等の挙動（env または DB から読める）でよい。ただし「起動時の bootstrap 自動起動」というフラグの性質上、運用上は env で渡すケースを想定
- `apps/app/src/features/growi-vault/server/index.ts` の `process.env.VAULT_BOOTSTRAP_ON_START === 'true'` 判定を `configManager.getConfig('app:vaultBootstrapOnStart')` に置き換える
  - boolean 化は configManager 側のキャストに任せる（envVar は文字列で渡るので `getConfig` 経由なら自動で型変換される）
- **背景**: 現状はこの env 変数のみ config-definition に登録されておらず、Vault feature 内で唯一 `process.env` 直参照が残る。タスク 17.1 と合わせて Vault feature 全体で「環境変数は必ず config-definition に登録 → configManager 経由で読む」という方針に統一する
- **完了確認**: Vault feature 配下から process.env 直参照が消え、configManager 経由で読まれていること

---

## タスク 18: bulk-upsert 障害修正（**P0 / 最優先・結合試験ブロッカー**）

_要件: 5（タスク 9 の追補）_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts`、`apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts`、`apps/app/src/features/growi-vault/__tests__/`_
_Depends: 9.1, 9.2, 14.1_

GROWI が階層整合性のために自動生成する「revision を持たないページ」（例: `/user`、`/empty`、`/user/<name>/メモ/2025/12` 等の中間パスページ）を bulk-upsert / upsert instruction の entries から除外する。

**現象**: これらのページは `revisionId: ''`（空文字列）で payload に積まれる。vault-manager 側の `RevisionModel.bodyQueryByIds` が `find({_id:{$in: ids}}, {body})` を発行する際、Mongoose の ObjectId キャストが空文字列で `Cast to ObjectId failed for value "" (type string) at path "_id" for model "Revision"` を throw。`vault_instructions` の対象ドキュメントが `attempts >= 5` まで失敗継続し、`vault_user_views.<viewRef>.mergedTreeOid` が empty tree（`4b825dc642cb6eb9a060e54bf8d69288fbee4904`）のまま固定され、`git clone` が `the remote end hung up unexpectedly` で停止する。

**一次原因箇所**: [vault-bootstrapper.ts:204-208](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts#L204-L208) の `revisionId: page.revision?.toString() ?? ''` フォールバック。

### [x] 18.1 bootstrapper で null revision page をスキップする

`apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts` を修正する。

- pages cursor の各イテレーション冒頭で `page.revision == null` を判定し、空であれば当該 page を全 namespace buffer への push 前に `continue` する
- `revisionId: page.revision?.toString() ?? ''` のフォールバック空文字列を撤去し、`revisionId: page.revision.toString()` に変更する
- `bootstrapProcessed` カウンタは「cursor で見たページ全件」を引き続き計上する（進捗表示の連続性を保つ）。スキップ件数は `logger.debug` で記録する
- **完了確認**: 既存の `vault-bootstrapper.spec.ts` に「revision フィールド未設定の page は payload に積まれない」テストを追加し `pnpm vitest run vault-bootstrapper.spec` が通ること

### [x] 18.2 dispatcher で null revision page をスキップする

`apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts` を修正する（PageEvent 起点の `upsert` instruction 発行経路）。

- `upsert` instruction 発行前に `revisionId` が空または null の場合は instruction 発行をスキップし `logger.debug` で記録する
- **完了確認**: 親パス自動生成イベントを模した PageEvent（revision 未設定）を発火し、`VaultInstruction.create` が呼ばれないことを単体テストで確認する

### [x] 18.3 結合試験 fixture へ null revision page を追加し回帰防止する

`apps/app/src/features/growi-vault/__tests__/clone-e2e.integ.ts`（または vault-gateway.integ.ts）を更新する。

- fixture seed に「中間パス自動生成ページ」（revision 未設定）を最低 1 件含める
- これらの page が clone 結果のディレクトリに現れない（または body 空ファイルとして現れる、設計上の選択を文書化）ことを assert する
- **完了確認**: `dev-verification.md` の「clone-e2e.integ.ts の手動確認（タスク 14.1 / 18.3）」セクションを実行し、null-revision ページが clone 結果に含まれないことを確認すること。
  （integ テストは `describe.skip` のまま運用する — タスク 23.2 選択肢 B による正式承認）

### [x] 18.4 既存 DB の修復手順をリリースノート相当でドキュメント化

`growi-vault/dev-verification.md` の「トラブルシュート」節を参照しつつ、apps/app の `CHANGELOG.md` または admin 向けマイグレーション通知に以下の手順を記載する:

1. `db.vault_instructions.deleteMany({processedAt: null, attempts: {$gte: 1}})` で詰まった instruction を削除
2. `db.vault_sync_state.updateOne({_id: 'singleton'}, {$set: {bootstrapState: 'pending', bootstrapCursor: null, bootstrapProcessed: 0}})` で state をリセット
3. `VAULT_BOOTSTRAP_ON_START=true` で apps/app を再起動するか admin UI から bootstrap を再実行
4. `vault_user_views.<viewRef>.mergedTreeOid` が empty tree 以外の値になることを確認

- **完了確認**: 詰まった環境を再現した上で本手順を実行し、`git clone http://x:<PAT>@localhost:3000/vault.git` が成功してファイル一覧が取得できること

---

## タスク 19: bootstrapper spec の型エラー修正（**P0 / CI ブロッカー**）

_要件: 5（タスク 9 の追補）_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-bootstrapper.spec.ts`_
_Depends: 9.2_

`pnpm run lint:typecheck`（`tsgo --noEmit`）が `vault-bootstrapper.spec.ts` の以下 2 行で `error TS2322` を出して落ちる。CI のタイプチェックブロッカーであり、タスク 9.2 の完了基準「TypeScript コンパイルが通ること」を満たしていない。

```
src/features/growi-vault/server/services/vault-bootstrapper.spec.ts(546,9): error TS2322:
  Type '{ toString: () => string; }' is not assignable to type
  '(Ref<IRevision> & { toString(): string; }) | undefined'.
```

### [x] 19.1 revision フィクスチャを IRevision 整合に修正

`vault-bootstrapper.spec.ts` の null revision skip テスト（line 543, 584 周辺）の `revision: { toString: () => 'rev-abc' }` を、`@growi/core` の `Ref<IRevision>` 型に整合する形へ修正する。

- 選択肢 A: `revision: { toString: () => 'rev-abc' } as never` で型キャストする（最小差分）
- 選択肢 B: `buildPage` ヘルパの戻り型を `Partial<IPage>` ベースから外し、test-only の loose 型で受ける
- どちらを採用しても、production 側 [vault-bootstrapper.ts:200-215](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts#L200-L215) の `page.revision == null` 判定が観測できることを保つ
- **完了確認**: 型エラー解消、`vault-bootstrapper.spec` 全件通過、ビルド成功

---

## タスク 20: PAT スコープを実体として取得する（**P0 / 要件 2.5 機能未実装**）

_要件: 2.5_
_Boundary: `apps/app/src/server/models/access-token.ts`、`apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.ts`、`apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.spec.ts`_
_Depends: 4.1, 4.2_

[vault-pat-auth.ts:134](../../../apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.ts#L134) は `tokenDoc.scopes ?? []` を返すが、[access-token.ts:142-146](../../../apps/app/src/server/models/access-token.ts#L142-L146) の `findUserIdByToken` は `.select('user')` で user フィールドのみ取得している。production では `scopes` フィールドはドキュメントに含まれず必ず `[]` になる。要件 2.5「Where PAT がスコープ制限を持つ場合 …そのスコープを namespace 計算に反映」を満たせない。

既存単体テスト [vault-pat-auth.spec.ts:121,151,260](../../../apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.spec.ts#L121) は `scopes` を直接生やしたモックを返しており、`.select('user')` の制約が観測できないため緑のままこの欠陥を見逃している（essential-test-design の "Arrange That Serves the Assert" アンチパターン）。

### [x] 20.1 access-token / vault-pat-auth で scopes を実取得する

以下のいずれかを採用する:

- **選択肢 A（推奨）**: `apps/app/src/server/models/access-token.ts:142` の `.select('user')` を `.select('user scopes')` に変更する
  - 影響範囲: `findUserIdByToken` の戻り値を使う既存呼び出し全件で scopes が露出するが、プロパティ追加なので破壊変更ではない
- **選択肢 B**: `vault-pat-auth.ts` 側で `findUserIdByToken` の戻り値から `_id` を取り、`AccessToken.findById(_id).select('user scopes')` で再 fetch する
  - production 1 リクエストあたり DB 往復が 1 回増える

- **完了確認**: 実 Mongoose schema 経由で scopes が読み出せることをタスク 20.2 で検証

### [x] 20.2 .select() 制約を尊重したテストの追加

production の `findUserIdByToken` 戻り値が `.scopes` を含むことを mock 越しでなく検証する。

- `apps/app/src/server/models/access-token.spec.ts` か新規 `vault-pat-auth.integ.ts` を追加し、実 Mongoose schema に対してドキュメントを insert → `findUserIdByToken` の戻り値が `scopes` フィールドを持つことを assert する
- 既存の `vault-pat-auth.spec.ts` のモックは現実のクエリ整形（`.select('user')` 的な狭めた projection）を反映するよう調整するか、コメントで「production シェイプは別 spec で検証」と明示する
- **完了確認**: production シェイプを反映したテストで `.select` の projection 制約が観測されること

---

## タスク 21: rename / grant 一括変更の MVP 段階実装（**MVP / 要件 4.4・4.5**）

_要件: 4.4, 4.5_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts`、`apps/app/src/features/growi-vault/server/index.ts`、`apps/app/src/server/service/page/index.ts`、`requirements.md`、`design.md`、`dev-verification.md`_
_Depends: 7.1, 7.3_

要件 4.4 / 4.5 を MVP 必須機能として再定義する（以前は P1 future work としていた）。実装は GROWI core の event payload 変更の有無で 2 段階に分割する:

- **Stage 1（21.1-A、本 PR）**: GROWI core を変更せず、現行 event payload の範囲で実装する
- **Stage 2（21.1-B、次 PR）**: GROWI core の event payload を拡張して残ったギャップを埋める

### [x] 21.1-A Stage 1: `'updateMany'` 購読による新パス反映（GROWI core 変更なし）

`apps/app/src/features/growi-vault/server/index.ts` を編集する。

- 既存 PageEvent サブスクリプションに `'updateMany'` を追加する
- payload `(pages, user)` の `pages` 各要素に対し `dispatcher.onPageChanged({ type: 'update', page })` を呼び出して per-page upsert を発行する
- `revision` フィールドが未設定の page はスキップする（タスク 18.2 の既存ガードを尊重）
- `syncDescendantsUpdate` の WARN ログメッセージを更新し、「Stage 1 では新パスを per-page upsert、旧パス削除は Stage 2 で実装予定」と明示する
- **背景・制約**:
  - `pageEvent.emit('rename')`（単一 rename、payload 空）と `updateChildPagesGrant` の bulkWrite（event 発火なし）は Stage 1 では検知できない
  - `'updateMany'` は `renameDescendants` 系から `(pages: 新パス確定後の pages, user)` で発火しており、bulk rename 後の新パスを vault に反映できる。ただし旧パスのファイルは clone に残る（Stage 2 で `rename-prefix` により削除）
- **完了確認**: bulk rename 後の新パスが per-page upsert で発行され、既存 dispatcher テストに regression がないこと

### [x] 21.1-B Stage 2: GROWI core event payload 拡張による完全実装

`apps/app/src/server/service/page/index.ts` と `apps/app/src/features/growi-vault/server/index.ts` を編集する。

- `pageEvent.emit('rename')`（L771, L1063）を `pageEvent.emit('rename', { page, oldPath, newPath, user })` に拡張する
- `pageEvent.emit('updateMany', pages, user)`（L1152, L1216）を `pageEvent.emit('updateMany', pages, user, { oldPagePathPrefix, newPagePathPrefix })` に拡張する（`renameDescendants` 系の関数引数 `oldPagePathPrefix` / `newPagePathPrefix` をそのまま渡す）
- `updateChildPagesGrant`（L3129）に新規イベント `pageEvent.emit('descendantsGrantChanged', { parentPage, oldGrant, newGrant, affectedPages })` を追加する。`oldGrant` は `updatePageSubOperation` の `exPage.grant` を carry する
- vault-dispatcher 側で以下を実装する:
  - `'rename'` 拡張 payload を購読し `dispatcher.onBulkOperation({ type: 'rename-prefix', ... })` を呼ぶ
  - `'updateMany'` 拡張 payload から `oldPagePathPrefix` / `newPagePathPrefix` を取り出して `'rename-prefix'` instruction を発行する（Stage 1 の per-page upsert は Stage 2 と重複するため、`updateMany` の `rename-prefix` 化に置き換えるか、両者の差異を整理する）
  - `'descendantsGrantChanged'` を購読し `'grant-change-prefix'` instruction を発行する
- **既存サブスクライバ互換性**: 追加引数を無視するだけなので後方互換。既存 reg テスト（page service 系の単体・統合）に regression が出ないことを確認する
- **完了確認**: 親 rename / grant 一括変更時に namespace 数ぶんの `rename-prefix` / per-page `acl-change` が自動伝播し、既存 page service テストに regression がないこと

---

## タスク 22: namespace 計算へ PAT スコープを伝播する（**P1 / 要件 2.5 連携**）

_要件: 2.5, 3_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-namespace-mapper.ts`、`apps/app/src/features/growi-vault/server/routes/vault-gateway.ts`_
_Depends: 5.1, 10.1, 20.1_

タスク 20 で PAT scopes を取得できるようになっても、`computeAccessibleNamespaces` のシグネチャが `(userId)` のみで、gateway router も `authResult.scopes` を破棄して呼び出している（[vault-gateway.ts:163,280](../../../apps/app/src/features/growi-vault/server/routes/vault-gateway.ts#L163)）。要件 2.5 を満たすには namespace 計算側でスコープを受け取る経路が必要。

### [x] 22.1 computeAccessibleNamespaces に scopes 引数を追加

`vault-namespace-mapper.ts` を編集する。

- `computeAccessibleNamespaces(userId: string | null, scopes?: ReadonlyArray<string>): Promise<ReadonlyArray<Namespace>>` にシグネチャ変更
- スコープ仕様の文書化:
  - スコープが `read:features:page` 単独のみ → 全 namespace を返す（既存挙動）
  - 将来 vault 専用スコープが追加された場合の絞り込みルールを設計書に追記
  - 現状の MVP では実質スコープ依存の絞り込みは無いが、入り口だけ整える方針で良い（その旨をコメントで明示）
- **完了確認**: 単体テストで scopes 引数が伝播されること、既存の挙動（全 namespace 返却）が破壊されないことを確認

### [x] 22.2 vault-gateway router からスコープを伝播

`vault-gateway.ts` の `info/refs` および `git-upload-pack` ハンドラで、`authResult.scopes` を `computeAccessibleNamespaces` に渡す。

- **完了確認**: gateway router からスコープが伝播され、namespace-mapper と gateway 双方のテストが通ること

---

## タスク 23: 結合試験の位置付けを正規化する（**P1 / 完了基準と実態の乖離**）

_要件: 1〜10（タスク 14 の追補）_
_Boundary: `apps/app/src/features/growi-vault/__tests__/`、`tasks.md`、`growi-vault/dev-verification.md`_
_Depends: 14.1, 14.2, 18.3_

[clone-e2e.integ.ts:70](../../../apps/app/src/features/growi-vault/__tests__/clone-e2e.integ.ts#L70) と [vault-gateway.integ.ts:131](../../../apps/app/src/features/growi-vault/__tests__/vault-gateway.integ.ts#L131) はすべて `describe.skip` で、Vitest 上では何も検証されない。タスク 14.1 / 14.2 / 18.3 の完了基準「`pnpm vitest run *.integ` が通ること」は形式上緑だが実機回帰検出能力ゼロ。さらに integ 内の HTTP パスは実装と整合していない（`/api/v3/vault/...` を叩くが実装は `/_api/v3/vault/...`）。

### [x] 23.1 HTTP パスを実装に合わせる

integ ファイル内の以下を実装と整合させる:

- `${BASE_URL}/api/v3/vault/instructions` → 実装に該当エンドポイント無し。デバッグ用 admin API を新設するか、テストを MongoDB 直 read に置き換える
- `${BASE_URL}/api/v3/vault/bootstrap-state` → 実装に該当無し。`/_api/v3/vault/status` を使う
- `${BASE_URL}/api/v3/vault/bootstrap` → `/_api/v3/vault/bootstrap`（先頭 `_` 必須）
- gateway パス `/vault.git/...` は OK

### [x] 23.2 完了基準を実体に揃える

以下のどちらかを採用:

- **選択肢 A**: integ を Vitest CI で動かす（docker-compose を CI で起動）。`describe.skip` を解除し、CI 設定に integ job を追加する
- **選択肢 B**: integ を `dev-verification.md` の手動確認手順としてのみ運用する。`describe.skip` のまま正式承認とし、tasks.md の 14.1 / 14.2 / 18.3 の完了基準を「`dev-verification.md` の対応セクション実行」に書き換える

- **完了確認**: 完了基準と実態（CI / 手動手順）が一致し、describe.skip と完了基準の矛盾が解消していること

---

## タスク 24: Admin API パスの仕様/実装統一（**P2 / 文書整合性**）

_要件: 8_
_Boundary: `requirements.md`、`growi-vault-gateway/design.md`、`tasks.md`、（必要なら）`apps/app/src/server/routes/apiv3/index.js`、`apps/app/src/features/growi-vault/server/routes/vault-admin.ts`、`apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx`_
_Depends: 11.1_

要件 8.3 / タスク 11.1 は `POST /_api/admin/vault/bootstrap` 等を要求しているが、実装は GROWI の既存 admin route 慣例に従って [apiv3/index.js:82](../../../apps/app/src/server/routes/apiv3/index.js#L82) で `/_api/v3/vault/...` にマウントされている（`/admin` セグメント無し、`/v3` セグメント有り）。クライアント [VaultAdminSettings.tsx:378,398,410](../../../apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx#L378) と server は辻褄が合っているので動作するが、要件文書と乖離している。

### [x] 24.1 要件 / 設計 / タスク文書を実装に揃える

GROWI 既存慣例（`/_api/v3/<resource>` 配下）に合わせるのが現実的:

- `requirements.md` 要件 8.3 を `/_api/v3/vault/bootstrap` に書き換える
- `growi-vault-gateway/design.md` の Admin API テーブルを実装パスに合わせる
- 既存タスク 11.1 のサブタスク本文を実装と整合させる

または、仕様を優先するなら実装側を `/_api/admin/vault/...` に移動する（推奨度低: 既存 admin route 慣例を破る）。

- **完了確認**: 仕様文書・実装・クライアント・integ テスト（タスク 23.1 で修正済みのもの）の 4 点でパスが一致していること

---

## タスク 25: `vault_sync_state.bootstrapLastError` スキーマ欠落の修正（**P0 / 要件 5.4・8.2 永続層欠陥**）

_要件: 5.4, 8.2_
_Boundary: `apps/app/src/features/growi-vault/server/models/vault-sync-state.ts`、`apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts`、`apps/app/src/features/growi-vault/server/services/vault-bootstrapper.spec.ts`、`apps/app/src/features/growi-vault/server/models/vault-sync-state.spec.ts`、`growi-vault-gateway/design.md`、`growi-vault/design.md`_
_Depends: 3.2, 9.1, 9.2_

`vault_sync_state` の Mongoose Schema および `IVaultSyncState` インターフェースに `lastError` フィールドが定義されていなかったため、[vault-bootstrapper.ts:284](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts#L284) の `$set: { lastError: errorMessage }` が Mongoose のデフォルト strict mode によって silent drop され、要件 5.4「failure 発生時に lastError を記録する」が永続層で機能していなかった。要件 8.2 の admin UI 表示も常に `null` を表示する状態だった。spec test [vault-bootstrapper.spec.ts:444-446](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.spec.ts#L444-L446) は `updateOne` の引数のみを assert しており persistence を検証していなかった（essential-test-design の "Arrange That Serves the Assert" に該当）。

### [x] 25.1 schema / interface に `bootstrapLastError` を追加

`apps/app/src/features/growi-vault/server/models/vault-sync-state.ts` を修正する。

- `IVaultSyncState` の apps/app owned フィールド群に `bootstrapLastError: string | null` を追加（命名は `bootstrap*` プレフィクスに揃え、vault-manager owned の `lastProcessedAt` 等と紛れないようにする）
- Schema 定義に `bootstrapLastError: { type: String, default: null }` を追加
- **完了確認**: `apps/app/src/features/growi-vault/server/models/vault-sync-state.spec.ts` を新規作成し、`VaultSyncState.schema.path('bootstrapLastError')` が `instance === 'String'` かつ default が null であることを assert する。`pnpm vitest run vault-sync-state.spec` が通ること

### [x] 25.2 bootstrapper の write/read を新フィールドへ

`apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts` を修正する。

- `start()` の running 遷移時 `$set` の `lastError: null` を `bootstrapLastError: null` に変更
- catch 節の `$set` の `lastError: errorMessage` を `bootstrapLastError: errorMessage` に変更
- `getStatus()` の `(doc as unknown as { lastError?: string }).lastError ?? null` を `doc.bootstrapLastError ?? null` に変更（cast を撤去）
- 公開契約 `BootstrapStatus.lastError` は維持し、DB カラム名（`bootstrapLastError`）と API/UI の field 名（`lastError`）を意図的に分離する。バウンダリは bootstrapper の getStatus で吸収する
- **完了確認**: `pnpm vitest run vault-bootstrapper.spec` が通ること（spec 側の `$set!.bootstrapLastError` 検証へ変更済み）

### [x] 25.3 設計ドキュメントの整合

- `growi-vault/design.md` の field-level owner 分離表に `bootstrapLastError` を apps/app owned として追記
- `growi-vault-gateway/design.md` の `vault_sync_state` スキーマスケッチに `bootstrapLastError: string | null` を追加し、`BootstrapStatus.lastError` との対応を明記
- **完了確認**: 両 design.md と実装で field 名が一致していること

---

## Implementation Notes

実装を経て判明した、refactor 時に押さえるべき設計上の課題・教訓を記録する。

### Bootstrap resilience の構造的欠陥（再設計対象）

現状の `VaultBootstrapper.start()` には「真にレジリエントな resume」を阻む 3 つの問題が同居している:

1. **完了時に `bootstrapCursor` を null にリセットしていない** ([vault-bootstrapper.ts:264-272](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts#L264-L272))
   - `bootstrapState: 'done'` 後に再度 `start()` が呼ばれると、前回最後のページ ID から resume してしまう
   - → `VAULT_BOOTSTRAP_ON_START=true` を「つけっぱなし」にすると、再起動のたびに既存 vault 全消失リスクがある

2. **二重起動ガードが `running` 状態しかブロックしない** ([vault-bootstrapper.ts:113-124](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts#L113-L124))
   - `done` / `failed` / `pending` 状態での再 `start()` は全て新規実行扱い

3. **`reset-all` instruction を resume でも無条件発行する** ([vault-bootstrapper.ts:171-175](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts#L171-L175))
   - 「resume」と呼んでいるが apps/app 側のページ stream の中断点復帰のみで、vault-manager 側には毎回 wipe を要求する
   - resume cursor が non-null かつ reset-all を発行すると、cursor 以前のページが永久に欠落する

4. **fire-and-forget で失敗が握り潰される** ([growi-vault/server/index.ts:401-404](../../../apps/app/src/features/growi-vault/server/index.ts#L401-L404))
   - bootstrap 失敗は log のみで、再起動時の自動再試行・進捗継続の仕組みがない

5. **既存 cron / scheduler は data 補修をしない** ([vault-maintenance-scheduler.ts](../../../apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts))
   - vault-manager の `VaultMaintenanceScheduler` は squash / gc のみで、MongoDB のページと vault tree の reconciliation は行わない
   - bootstrap で欠落したページは、後続の page event が発火するまで永久に同期されない

→ 真にレジリエントな resume を実装するには、これら 5 つを統合的に解決する設計が必要（別 spec で扱う）。

### スケール特性（refactor 時の前提）

- bootstrap 時間 ≈ O(N) where N = 公開ページ数。律速は (a) apps/app の毎ページ `vault_sync_state.updateOne`、(b) vault-manager の sequential tree rebuild、(c) instruction watcher の sequential 処理
- bulk-upsert エントリ総数は N × 平均 (1 ページあたりの granted namespace 数) で膨らむ。GRANT_USER_GROUP × 多人数グループのページ密度が高いと commit 数が大幅に増える
- ユーザー数自体は bootstrap 時間に直接影響しない（per-user view は lazy compose）

### スキーマと API 名の意図的分離

- DB カラム名 `bootstrapLastError` と API/UI フィールド名 `lastError` は意図的に分離している（task 25 を参照）
- 永続層では `bootstrap*` プレフィクスで apps/app 所有フィールドを明示し、vault-manager 所有フィールド（`resumeToken` 等）と紛れないようにする
- 公開契約 `BootstrapStatus.lastError` の互換性は bootstrapper の `getStatus()` で吸収する

### テスト設計の落とし穴

タスク 20 / 25 で発覚した「Arrange That Serves the Assert」アンチパターン:

- **task 20**: spec が `scopes` を直接生やしたモックを返したため、production の `.select('user')` が scopes を返さない欠陥を見逃した
- **task 25**: spec が `updateOne` の引数だけ assert したため、`vault_sync_state` schema に `bootstrapLastError` が定義されておらず Mongoose strict mode で silent drop されている欠陥を見逃した

→ DB 永続化に絡む契約は、できる限り**実 Mongoose schema 経由で persistence を検証**する（mock を経由しない）。

### Null revision page の取り扱い

GROWI が階層整合性のために自動生成する中間パスページ（例: `/user`、`/empty`）は `revision` フィールドが null で、`revisionId: ''` で instruction に積むと vault-manager 側の ObjectId キャストで失敗する。bootstrapper / dispatcher 双方で `page.revision == null` を判定してスキップする（task 18）。新しい instruction op を追加する際も同じガードを適用すること。

### Stage 2 で残った設計負債

`grant-change-prefix` op は subtree 単位の prefix scope を持たないため未使用。現状は `'descendantsGrantChanged'` → per-page `acl-change` instruction（remove + upsert）でカバーしているが、descendants が多い場合の効率は悪い。vault-manager 側で「namespace 間 subtree 移動」の API を再設計する際に解消できる。

---

## Planned Extensions

実装は完了済みだが、別 spec（`growi-vault-resilience`）の確定後に本 spec に追加要件として組み込まれる予定の作業を記録する。

### User-triggered targeted reconcile（着手保留中）

**概要**: admin / 一般ユーザーが任意のサブツリーを再同期できる機能。「このパス配下を vault に再同期せよ」という命令を gateway 経由で発行する。

**要件の出処**: [.kiro/steering/roadmap.md](../../steering/roadmap.md) の `## Existing Spec Updates` セクション

**追加責務（予定）**:
- 新規 API: `POST /_api/v3/vault/reconcile`（body: `{ pathPrefix, namespace? }`）
- 認可: 既存 GROWI session / PAT + page-grant.ts で「ユーザーが read 権限を持つ path 配下のみ reconcile 可能」を強制
- UI surface: admin UI（`/admin/vault`）に加え、PageTree と GrowiContextualSubNavigation にも「このパス配下を再同期」アクションを追加
- Rate limiting: 既存 GROWI の rate limit に従い、reconcile スパムを防ぐ
- 進捗 surface: bootstrap と同じ `processed / total` モデルで状態を表示
- Instruction 経路: 新規 op（`reconcile-prefix` 等）を追加するか、既存 `bulk-upsert` を再利用するかは `growi-vault-resilience` の design で決定

**着手条件（重要）**:
- `growi-vault-resilience` spec の design phase が確定してから本 spec の `/kiro-spec-requirements` を実行する
- 理由: reconcile の instruction 経路は `growi-vault-resilience` の自動 drift 補修の経路と共有される可能性が高く、design を待たずに進めると整合性が崩れる

**境界（参考）**:
- 本 spec が所有: API endpoint、auth、ACL チェック、UI surface、instruction 発行、進捗 surface
- 本 spec が所有しない: 発行された instruction の処理（vault-manager 側）、bootstrap state machine 全体（`growi-vault-resilience` 側）

**次のアクション**:
1. `growi-vault-resilience` の `/kiro-spec-design` 完了を待つ
2. `/kiro-spec-requirements growi-vault-gateway` を再度実行し、新規 Req（例: Req 11）として「user-triggered targeted reconcile」を追加
3. design.md / tasks.md を再生成し、本 Planned Extensions エントリを削除（実装着手時に解消）

---

## タスク完了チェックリスト

すべてのタスク完了後に以下を確認する:

- [ ] `turbo run build --filter @growi/app` がエラーなく通ること
- [ ] `turbo run lint --filter @growi/app` がエラーなく通ること
- [ ] `turbo run test --filter @growi/app` が全テスト通過すること
- [ ] `turbo run build --filter @growi/core` がエラーなく通ること
- [ ] `packages/core/src/interfaces/vault/` の全型が `@growi/core/interfaces/vault` からインポートできること
- [ ] `apps/app` が vault-manager なしで起動したとき、`VAULT_ENABLED=false`（env）では `info/refs` / `git-upload-pack` は 404、`git-receive-pack` は 403 を返し例外が発生しないこと
- [ ] 認証失敗レスポンスにページリスト・存在情報が含まれていないこと
- [ ] vault_instructions への書き込みに shared secret が含まれていないこと
