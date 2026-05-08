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
  - 既存 ConfigManager（または同等の設定取得手段）を使用して `app:vaultEnabled` を取得する
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
- `onBulkOperation(event: BulkPageOperationEvent)` を実装する:
  - 親ページ rename → 影響 namespace ごとに `rename-prefix` instruction を挿入する
  - 親ページ grant 一括変更 → `(fromNamespace, toNamespace)` ペアごとに `grant-change-prefix` instruction を挿入する
- 書き込み失敗時は WARN ログ + リトライ（ページ編集 response とは切り離す）
- named export する
- **完了確認**: イベント種別ごとの単体テストが全て通ること

### [x] 7.2 VaultDispatcher の単体テスト

`apps/app/src/features/growi-vault/server/services/vault-dispatcher.spec.ts` を作成する。

- create イベント → `upsert` instruction が発行されることをテストする
- delete イベント → `remove` instruction が発行されることをテストする
- ACL 変更イベント → `remove` + `upsert` の 2 件が発行されることをテストする
- 同 namespace への高頻度 event（100+）が `bulk-upsert` に coalesce されることをテストする
- coalesce window 外の event は単発 `upsert` で発行されることをテストする
- 親 rename → `rename-prefix` が発行されることをテストする
- 親 grant 変更 → `grant-change-prefix` が発行されることをテストする
- **完了確認**: `pnpm vitest run vault-dispatcher.spec` が全テスト通過すること

### [x] 7.3 PageService event 購読の組み込み

`apps/app/src/features/growi-vault/server/index.ts`（または feature 登録ファイル）に VaultDispatcher の event 購読を追加する。

- 既存 `PageEvent`（`apps/app/src/server/events/page.ts`）の `'create' | 'update' | 'delete' | 'rename' | 'syncDescendants'` に subscribe する
- feature 有効時（vaultEnabled）のみ購読を開始する
- **完了確認**: apps/app 起動時に VaultDispatcher が PageEvent を受信できることを確認すること

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
- `GET /_vault/repo.git/info/refs` ハンドラーを実装する:
  - vaultEnabled フラグを確認し false なら 503 を返す
  - bootstrapState を確認し done 以外なら 503 + Retry-After を返す
  - `service=git-upload-pack` のみ許可し、それ以外は 400 を返す
  - VaultPatAuth.authenticate を呼び出す（認証失敗時は 401）
  - VaultNamespaceMapper.computeAccessibleNamespaces を呼び出す
  - VaultManagerClient.composeView を呼び出す
  - VaultManagerClient.proxyGitRequest（GET /internal/git/info/refs）を呼び出す
  - response を stream forward する
  - audit log に 'vault.clone-prepare' を記録する
- `POST /_vault/repo.git/git-upload-pack` ハンドラーを実装する:
  - 同様の auth / feature flag チェック
  - VaultManagerClient.proxyGitRequest（POST /internal/git/git-upload-pack）を呼び出す
  - response を stream forward する
  - audit log に 'vault.clone-complete' を記録する
- `/_vault/repo.git/git-receive-pack` への全リクエストに 403 `read-only repository` を返す
- その他の `/_vault/repo.git/*` パスに 404 を返す
- エラーハンドリング: compose-view / proxy 失敗時は 502、接続不能は 503
- named export する
- **完了確認**: 各 HTTP パスの正常系・異常系が期待通りのステータスコードを返すことをテストで確認すること

### [x] 10.2 VaultGatewayRouter の統合テスト

`apps/app/src/features/growi-vault/server/routes/vault-gateway.spec.ts` を作成する。

- `vaultEnabled=false` の場合に 503 を返すことをテストする
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
- `GET /_api/admin/vault/status` エンドポイントを実装する:
  - VaultBootstrapper.getStatus() の結果を返す
  - `VaultManagerClient.getStorageStats()` を呼び出して `StorageStatsResponse`（namespaceCount / totalCommitCount / looseObjectCount / repoSizeBytes / lastSquashAt / lastGcAt）をレスポンスに含める
  - vault-manager 側のエラー時は storage stats を null として返し、admin UI 側で「取得失敗」を表示できるようにする（bootstrap status は引き続き返す）
- `POST /_api/admin/vault/bootstrap` エンドポイントを実装する:
  - VaultBootstrapper.start({ triggerSource: 'admin-ui' }) を呼び出す
  - bootstrapState が既に 'running' の場合は 409 を返す
- `PUT /_api/admin/vault/enabled` エンドポイントを実装する:
  - リクエスト body の `enabled` フィールド（boolean）を受け取る
  - VaultSettingsService 経由で `app:vaultEnabled` を更新する
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
- SWR を使用して `GET /_api/admin/vault/status` を定期ポーリングする
- Feature toggle セクション:
  - `vaultEnabled` ON/OFF トグルを表示する
  - bootstrapState が `done` でない状態で enable にしようとした場合は警告を表示する
  - トグル変更時に `PUT /_api/admin/vault/enabled` を呼び出す
- Bootstrap operation セクション:
  - "Prepare GROWI Vault" ボタンを表示する
  - ボタン押下時に `POST /_api/admin/vault/bootstrap` を呼び出す
  - bootstrapState が `running` の間はボタンを disabled にする
- Bootstrap status セクション:
  - `state` / `processed` / `totalEstimated` / `startedAt` / `completedAt` / `lastError` を表示する
  - `running` の間は進捗バー（processed / totalEstimated）を表示する
- Storage observability セクション:
  - `GET /_api/admin/vault/status` のレスポンスから storage stats を取得し、namespace 数 / 合計 commit 数 / loose object 数 / repo size / 最終 squash・gc 時刻を表示する
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

- `VaultGatewayRouter` を `/_vault` パス配下に登録する
- `VaultAdminRouter` を適切な admin ルート配下に登録する
- **完了確認**: `GET /_vault/repo.git/info/refs` が 503（feature disabled 時）または正常なレスポンスを返すこと

---

## タスク 14: 統合テストの作成

_要件: 1–10_
_Boundary: `apps/app/src/features/growi-vault/__tests__/`_
_Depends: 10.1, 11.1, 12.1, 13.1, 13.2_

### [x] 14.1 clone E2E 統合テストの作成

`apps/app/src/features/growi-vault/__tests__/clone-e2e.integ.ts` を作成する。

- docker-compose 環境で apps/app + vault-manager + MongoDB を起動する
- 実際に `git clone http://user:PAT@localhost:3000/_vault/repo.git` を実行する
- clone 結果のファイル一覧と内容が期待通りであることを確認する
- **完了確認**: `pnpm vitest run clone-e2e.integ` が通ること

### [x] 14.2 ACL 隔離・bootstrap・coalesce の統合テスト

`apps/app/src/features/growi-vault/__tests__/vault-gateway.integ.ts` を作成する。

- vaultEnabled=false の場合に全リクエストが 503 を返すことを確認する
- bootstrapState が running の間 clone が 503+Retry-After を返すことを確認する
- push 試行が 403 を返すことを確認する
- bootstrap 完了後に clone が成功することを確認する
- ACL で保護されたページが clone 結果に含まれないことを確認する
- 同 namespace への高頻度 edit が bulk-upsert に coalesce されることを確認する
- **完了確認**: `pnpm vitest run vault-gateway.integ` が通ること

---

## タスク 15: Admin 画面への VaultAdminSettings 導線追加

_要件: 8_
_Boundary: `apps/app/src/pages/admin/vault.page.tsx`_
_Depends: 12.1_

### [ ] 15.1 admin/vault.page.tsx の作成

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

### [ ] 16.1 503 レスポンスボディへの状態詳細追加

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

### [ ] 17.1 managerEndpoint / managerInternalSecret を configManager から読む

`apps/app/src/features/growi-vault/server/services/vault-settings-service.ts` を修正する。

- 現状は `process.env.VAULT_MANAGER_ENDPOINT` / `process.env.VAULT_MANAGER_INTERNAL_SECRET` を直接参照しているが、両キーはすでに `config-definition.ts` に `app:vaultManagerEndpoint` / `app:vaultManagerInternalSecret` として登録されているため、configManager から取得するように統一する
- env-only を強制するために `configManager.getConfig('app:vaultManagerEndpoint', ConfigSource.env)` のように `ConfigSource.env` を明示的に渡す（DB へのフォールバックを禁止）
- `ConfigSource` は `@growi/core/dist/interfaces` から import する（`config-manager.ts` と同一パターン）
- `app:vaultEnabled` も既に configManager 経由になっているので変更不要
- **背景**: env からの直接読み込みは config-definition.ts の登録を迂回しており、設定キーの一元管理（型安全な参照、isSecret マスキング、テスト時の上書き API）を破る。configManager 経由に統一することで env-only という制約を保ちつつ、他の設定キーと同一の仕組みに揃える
- **完了確認**:
  - `pnpm vitest run vault-settings-service` が通ること
  - `process.env` への直接参照が `vault-settings-service.ts` から消えていること（`grep -n "process.env" apps/app/src/features/growi-vault/server/services/vault-settings-service.ts` が 0 件）
  - 既存の Vault 関連テスト（vault-manager-client.spec、vault-gateway.spec、vault-bootstrapper.spec 等）に regression がないこと

### [ ] 17.2 VAULT_BOOTSTRAP_ON_START を config-definition に登録し configManager から読む

`apps/app/src/server/service/config-manager/config-definition.ts` と `apps/app/src/features/growi-vault/server/index.ts` を修正する。

- `config-definition.ts` の Vault Settings セクションに `app:vaultBootstrapOnStart` を追加する:
  - `envVarName: 'VAULT_BOOTSTRAP_ON_START'`
  - `defaultValue: false`（boolean）
  - `isSecret: false`、`publishToClient: false`
  - 既存 `app:vaultEnabled` と同等の挙動（env または DB から読める）でよい。ただし「起動時の bootstrap 自動起動」というフラグの性質上、運用上は env で渡すケースを想定
- `apps/app/src/features/growi-vault/server/index.ts` の `process.env.VAULT_BOOTSTRAP_ON_START === 'true'` 判定を `configManager.getConfig('app:vaultBootstrapOnStart')` に置き換える
  - boolean 化は configManager 側のキャストに任せる（envVar は文字列で渡るので `getConfig` 経由なら自動で型変換される）
- **背景**: 現状はこの env 変数のみ config-definition に登録されておらず、Vault feature 内で唯一 `process.env` 直参照が残る。タスク 17.1 と合わせて Vault feature 全体で「環境変数は必ず config-definition に登録 → configManager 経由で読む」という方針に統一する
- **完了確認**:
  - `apps/app/src/features/growi-vault/server/` 配下に `process.env.` 直参照が 0 件であること（`grep -rn "process.env" apps/app/src/features/growi-vault/server/ | grep -v ".spec.ts" | grep -v "__tests__"` が 0 件）
  - `VAULT_BOOTSTRAP_ON_START=true` で起動した際に bootstrap が自動起動することを動作確認する
  - `turbo run build --filter @growi/app` がエラーなく通ること

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

### [ ] 18.3 結合試験 fixture へ null revision page を追加し回帰防止する

`apps/app/src/features/growi-vault/__tests__/clone-e2e.integ.ts`（または vault-gateway.integ.ts）を更新する。

- fixture seed に「中間パス自動生成ページ」（revision 未設定）を最低 1 件含める
- これらの page が clone 結果のディレクトリに現れない（または body 空ファイルとして現れる、設計上の選択を文書化）ことを assert する
- **完了確認**: 修正前のコードで本テストが失敗し、修正後に成功すること（タスク 18.1 と 18.2 の修正適用前後で diff 検証）

### [ ] 18.4 既存 DB の修復手順をリリースノート相当でドキュメント化

`growi-vault/dev-verification.md` の「トラブルシュート」節を参照しつつ、apps/app の `CHANGELOG.md` または admin 向けマイグレーション通知に以下の手順を記載する:

1. `db.vault_instructions.deleteMany({processedAt: null, attempts: {$gte: 1}})` で詰まった instruction を削除
2. `db.vault_sync_state.updateOne({_id: 'singleton'}, {$set: {bootstrapState: 'pending', bootstrapCursor: null, bootstrapProcessed: 0}})` で state をリセット
3. `VAULT_BOOTSTRAP_ON_START=true` で apps/app を再起動するか admin UI から bootstrap を再実行
4. `vault_user_views.<viewRef>.mergedTreeOid` が empty tree 以外の値になることを確認

- **完了確認**: 詰まった環境を再現した上で本手順を実行し、`git clone http://x:<PAT>@localhost:3000/_vault/repo.git` が成功してファイル一覧が取得できること

---

## タスク完了チェックリスト

すべてのタスク完了後に以下を確認する:

- [ ] `turbo run build --filter @growi/app` がエラーなく通ること
- [ ] `turbo run lint --filter @growi/app` がエラーなく通ること
- [ ] `turbo run test --filter @growi/app` が全テスト通過すること
- [ ] `turbo run build --filter @growi/core` がエラーなく通ること
- [ ] `packages/core/src/interfaces/vault/` の全型が `@growi/core/interfaces/vault` からインポートできること
- [ ] `apps/app` が vault-manager なしで起動したとき、`vaultEnabled=false` では 503 のみを返し例外が発生しないこと
- [ ] 認証失敗レスポンスにページリスト・存在情報が含まれていないこと
- [ ] vault_instructions への書き込みに shared secret が含まれていないこと
