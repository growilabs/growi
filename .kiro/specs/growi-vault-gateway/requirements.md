# 要件定義書: growi-vault-gateway

## プロジェクト概要

### 誰が問題を抱えているか
`apps/app` に git smart HTTP gateway・PAT 認証ミドルウェア・vault_instructions 書き込み機構・vault-manager RPC クライアント・管理 UI のいずれも未実装であるため、GROWI Vault 機能を外部に提供できない状態にある GROWI 管理者・エンドユーザー。

### 現状
- `apps/app` には `/vault.git/...` エンドポイントが存在しない
- PAT 認証の vault スコープ対応が存在しない
- ページ変更を vault-manager に伝える outbox 機構が存在しない
- 初回有効化時の bootstrap 主導ロジックが存在しない
- 管理者が vault 機能を ON/OFF する UI が存在しない

### 何が変わるべきか
`apps/app/src/features/growi-vault/` 配下に feature-based 構成で以下の責務を実装する:
- git smart HTTP の唯一の対外エンドポイント（認証・ACL・proxy・audit を担当）
- PAT 認証ミドルウェア（access-token-parser を vault スコープで利用）
- ACL ベースの namespace 集合計算（VaultNamespaceMapper）
- ページ変更イベントの dispatcher（vault_instructions への durable 書き込み）
- 初回有効化 / 災害復旧 bootstrap 主導（VaultBootstrapper）
- vault-manager RPC クライアント（compose-view RPC + git body proxy）
- 設定サービス（VaultSettingsService）
- 管理者 UI（VaultAdminSettings）

---

## 境界コンテキスト

**スコープ内（本 spec が実装する）**:
- `VaultGatewayRouter` — `GET/POST /vault.git/...` エンドポイント
- `VaultPatAuth` ミドルウェア — HTTP Basic → PAT → ユーザー解決
- `VaultNamespaceMapper` — GROWI ACL → namespace 集合 / ページ → namespace 判定
- `VaultDispatcher` — PageService event 購読 + vault_instructions 書き込み（coalesce 含む）
- `VaultBootstrapper` — reset-all 発行 + pages cursor stream + seed instructions 発行
- `VaultManagerClient` — vault-manager への HTTP RPC + git body proxy
- `VaultSettingsService` — vaultEnabled / endpoint / secret の設定解決
- `VaultAdminSettings` UI — 機能 ON/OFF + bootstrap 進捗 + audit log フィルターリンク
- `vault_instructions` Mongoose model（書き込みオーナー: apps/app）
- `vault_sync_state` の bootstrap* フィールド（書き込みオーナー: apps/app）
- 既存 audit log への vault イベント記録
- `app:vaultEnabled` / `app:vaultManagerEndpoint` / `app:vaultManagerInternalSecret` の config 定義
- `packages/core/src/interfaces/vault/` の共通 DTO 型定義

**スコープ外（本 spec が扱わない）**:
- bare repo 操作・git object I/O・git upload-pack の spawn → `growi-vault-manager`
- namespace tree の更新・per-user view ref 合成 → `growi-vault-manager`
- vault_instructions の change stream 消化 → `growi-vault-manager`
- shared secret の発行・rotation 機構（env var 注入のみ）
- PAT 発行・管理 UI（既存 AccessToken 機能に委譲）
- GROWI ACL 評価ロジック本体（page-grant.ts に委譲）

**隣接する期待**:
- 既存 `pages` / `revisions` / `accesstokens` / `usergrouprelations` モデルはスキーマ変更なしに read-only で利用
- vault-manager との通信は本 spec の実装後も vault-manager が未起動の場合は 502/503 で graceful に失敗する

---

## 要件

### 要件 1: git smart HTTP エンドポイント

**目的:** GROWI ユーザーとして、既存の PAT を使って `git clone /vault.git` を実行できるようにしたい。

#### 受入条件

1. When `GET /vault.git/info/refs?service=git-upload-pack` リクエストを受信した場合, the GROWI Vault Gateway shall HTTP Basic Auth を要求し、PAT 認証を行い、vault-manager へ compose-view RPC を発行してから git body proxy で応答を返す
2. When `POST /vault.git/git-upload-pack` リクエストを受信した場合, the GROWI Vault Gateway shall 認証済みリクエストの HTTP body を vault-manager へ透過的にプロキシし、レスポンス body をクライアントへストリーム転送する
3. When `/vault.git/git-receive-pack` に対するリクエスト（push 試行）を受信した場合, the GROWI Vault Gateway shall HTTP 403 `read-only repository` を返し書き込みを拒否する
4. When 環境変数 `VAULT_ENABLED` が `false`（またはデフォルト）の場合, the GROWI Vault Gateway shall `/vault.git/info/refs` および `/vault.git/git-upload-pack` に対して HTTP 404 を返す（環境変数による永続的な設定状態であり Retry-After は付与しない。git-receive-pack は機能フラグに関わらず常に 403 read-only を返す）
5. When bootstrapState が `done` 以外（`pending` または `running`）の場合, the GROWI Vault Gateway shall すべての clone / fetch リクエストに対して `503 Service Unavailable` と `Retry-After` ヘッダーを返す
6. The GROWI Vault Gateway shall 各 clone / fetch 操作の成功・失敗を既存 audit log（タイムスタンプ・ユーザー・操作種別）に記録する
7. The GROWI Vault Gateway shall `git-upload-pack` に関係しない URL パス（例: `/vault.git/HEAD` 等）に対して HTTP 404 を返す

### 要件 2: PAT 認証ミドルウェア

**目的:** GROWI ユーザーとして、git クライアントから `username:PAT` 形式で認証できるようにしたい。

#### 受入条件

1. When git クライアントが `Authorization: Basic base64(anyuser:PAT)` ヘッダーを送信した場合, the GROWI Vault Gateway shall 既存の access-token-parser を使用して PAT を検証し、対応するユーザーの userId と scopes を解決する
2. When 提示された PAT が存在しない、無効、または revoke されている場合, the GROWI Vault Gateway shall `WWW-Authenticate: Basic realm="GROWI Vault"` ヘッダーを含む HTTP 401 を返す
3. When 認証失敗応答を返す場合, the GROWI Vault Gateway shall エラーメッセージにページリストや存在情報を含めない
4. When 認証ヘッダーが存在しない（匿名アクセス）場合, the GROWI Vault Gateway shall `userId: null` として処理を継続し、public namespace のみにアクセスさせる
5. Where PAT がスコープ制限を持つ場合, the GROWI Vault Gateway shall そのスコープを namespace 計算に反映させる

### 要件 3: ACL ベース namespace 計算（VaultNamespaceMapper）

**目的:** GROWI 管理者・ユーザーとして、既存の GROWI ACL が git 経由アクセスでも一貫して適用されることを保証したい。

#### 受入条件

1. When 認証済みユーザーの accessible namespace 集合を計算する場合, the GROWI Vault Gateway shall `['public', 'restricted-link', 'group-<gid>', ..., 'user-<uid>-only-me']` 形式で namespace 一覧を返す
2. When 匿名ユーザーの accessible namespace 集合を計算する場合, the GROWI Vault Gateway shall `['public']` のみを返す
3. When GRANT_PUBLIC のページの namespace を計算する場合, the GROWI Vault Gateway shall `'public'` namespace を返す
4. When GRANT_USER_GROUP のページの namespace を計算する場合, the GROWI Vault Gateway shall `'group-<gid>'` 形式で grantedGroups に対応する namespace を返す（複数グループが設定されている場合は複数の namespace を返す）
5. When GRANT_OWNER のページの namespace を計算する場合, the GROWI Vault Gateway shall `'user-<creator-id>-only-me'` namespace を返す
6. When status が `published` でないページ、または `/trash` 配下のページの namespace を計算する場合, the GROWI Vault Gateway shall namespace を発行しない（除外する）
7. When ページの ACL が変更された場合, the GROWI Vault Gateway shall `previous` namespace と `current` namespace の両方を返し、dispatcher が remove + upsert の 2 件の instruction を発行できるようにする
8. The GROWI Vault Gateway shall ユーザーが閲覧権限を持たないページの存在がいかなる応答経路からも推測不可能であることを保証する（namespace 計算時点で未認可ページを namespace に含めない）

### 要件 4: vault_instructions への durable 書き込み（VaultDispatcher）

**目的:** GROWI ページ変更が vault-manager に確実に伝達されるように、durable な outbox として vault_instructions コレクションへ指示を書き込みたい。

#### 受入条件

1. When ページが作成または更新された場合, the GROWI Vault Gateway shall 対応する namespace に `op: 'upsert'` instruction を vault_instructions に挿入する（pageId・pagePath・revisionId・issuedAt を含む）
2. When ページが削除された場合, the GROWI Vault Gateway shall 対応する namespace に `op: 'remove'` instruction を vault_instructions に挿入する（pagePath は削除直前の値）
3. When 単一ページの ACL が変更された場合, the GROWI Vault Gateway shall 旧 namespace に `op: 'remove'` + 新 namespace に `op: 'upsert'` の 2 件を vault_instructions に挿入する
4. When 親ページが rename された場合, the GROWI Vault Gateway shall 影響を受ける各 namespace に `op: 'rename-prefix'` instruction を 1 件ずつ挿入する（descendants 数に依らず namespace 数 M 件で収束する）
5. When 親ページの grant が一括変更された場合, the GROWI Vault Gateway shall 影響を受けた各 page に対して per-page `acl-change` instruction を発行する（remove from previous namespaces + upsert to current namespaces）
6. When 同一 namespace 向けの `upsert` イベントが coalesce window（既定 1 秒）内に 100 件以上発生した場合, the GROWI Vault Gateway shall それらを 1 件の `op: 'bulk-upsert'` instruction にまとめる（chunk size 上限 1000 entries）
7. When vault_instructions への書き込みが一時的に失敗した場合, the GROWI Vault Gateway shall WARN ログを記録してリトライする（ページ編集レスポンスとは切り離して処理する）

### 要件 5: bootstrap 主導（VaultBootstrapper）

**目的:** GROWI 管理者として、初回有効化や災害復旧時に全ページを vault-manager に投入する bootstrap を環境変数で開始でき、運用中の手動 re-bootstrap は admin UI の Wipe Vault (kill switch) を通じて実行できるようにしたい。

#### 受入条件

1. When 環境変数 `VAULT_BOOTSTRAP_ON_START=true` が設定されている場合, the GROWI Vault Gateway shall apps/app 起動時に自動的に bootstrap を開始する
2. When bootstrap が完了した場合, the GROWI Vault Gateway shall bootstrapState を `done` に遷移させる
3. When bootstrap 中に failure が発生した場合, the GROWI Vault Gateway shall bootstrapState を `failed` に遷移させ、lastError を記録する
4. When bootstrap が失敗後に再実行される場合, the GROWI Vault Gateway shall bootstrapCursor に保存された最後の page._id から処理を再開する（resume 可能）
5. When pages cursor stream を走査する場合, the GROWI Vault Gateway shall `status: 'published'` かつ `/trash` 配下でないページのみを対象とし、namespace 単位のバッファに蓄積し CHUNK_SIZE（既定 1000）に達するたびに `bulk-upsert` instruction を発行する
6. When bootstrapState が `running` または `pending` の場合, the GROWI Vault Gateway shall VaultBootstrapper.getStatus() が `state / processed / totalEstimated / cursor / startedAt / completedAt / lastError` を返す
7. The GROWI Vault Gateway shall bootstrap の二重起動を防止するため、bootstrapState が `running` の間は新たな bootstrap を開始しない
8. When admin UI の "Wipe Vault" ボタンが押された場合, the GROWI Vault Gateway shall triggerSource `admin-force-wipe` で forceWipe フローを発火し、`op: 'reset-all'` instruction を発行して全 namespace の repository を破棄し、bootstrapState を `running` に強制遷移させた後 pages cursor stream の再投入を開始する。これが管理 UI からの唯一の bootstrap 発火経路である
9. When admin UI から Wipe Vault が発火された場合, the GROWI Vault Gateway shall 操作を audit log に `vault.wipe` として記録する（タイムスタンプ・実行ユーザを含む）
10. The GROWI Vault Gateway shall 「Prepare GROWI Vault」「Bootstrap」等の独立した非破壊的 bootstrap 発火 API・ボタンを提供しない。理由: admin UI の `admin-ui` triggerSource は内部的に Wipe と同じ forceWipe フローを通るため、ユーザにとって 2 つのボタンが同じ振る舞いをすることになり UX 混乱を招く

### 要件 6: vault-manager との通信（VaultManagerClient）

**目的:** GROWI Vault Gateway として、vault-manager の compose-view RPC と git body proxy を経由して git smart HTTP を提供したい。

#### 受入条件

1. When compose-view を呼び出す場合, the GROWI Vault Gateway shall `POST /internal/compose-view` を vault-manager の endpoint に送信し、`{ userId, namespaces }` をリクエスト body に含め、`{ viewRef, commitOid }` を受け取る
2. When git body proxy を実行する場合, the GROWI Vault Gateway shall リクエスト body を vault-manager にストリーム転送し、vault-manager のレスポンス body をクライアントにストリーム転送する（apps/app 上でフルバッファ化しない）
3. When vault-manager へのすべてのリクエストを送信する場合, the GROWI Vault Gateway shall `Authorization: Bearer ${VAULT_MANAGER_INTERNAL_SECRET}` ヘッダーを付与する
4. When vault-manager が HTTP エラーを返した場合, the GROWI Vault Gateway shall git クライアントに HTTP 502 を返す
5. When vault-manager に接続できない場合, the GROWI Vault Gateway shall git クライアントに HTTP 503 を返し warning ログを記録する
6. When admin UI のストレージ観測セクションがデータを必要とする場合, the GROWI Vault Gateway shall `GET /internal/storage-stats` を vault-manager に呼び出し、`StorageStatsResponse`（`namespaceCount` / `totalCommitCount` / `looseObjectCount` / `repoSizeBytes` / `lastSquashAt` / `lastGcAt`）を取得する。`vault_namespace_state` を直接 read することはしない（owner 越境禁止）

### 要件 7: 設定管理（VaultSettingsService）

**目的:** GROWI 運用者として、vault 機能の有効化と vault-manager 接続先を環境変数で設定できるようにしたい。これらの値はデプロイ時に固定され、ランタイムで変更されない。

#### 受入条件

1. When VaultSettingsService.getSettings() を呼び出す場合, the GROWI Vault Gateway shall `app:vaultEnabled`、`app:vaultManagerEndpoint`、`app:vaultManagerInternalSecret` を全て環境変数のみから解決する（DB フォールバック無し）
2. Where `app:vaultEnabled`・`app:vaultManagerEndpoint`・`app:vaultManagerInternalSecret` は, the GROWI Vault Gateway shall 環境変数からのみ読み込み、DB には保存しない
3. The GROWI Vault Gateway shall `app:vaultEnabled` のデフォルト値を `false` とする
4. The GROWI Vault Gateway shall `app:vaultEnabled` の値変更を反映するには apps/app の再起動が必要であることを前提とし、ランタイム書き換えの API・UI を提供しない

### 要件 8: 管理者 UI（VaultAdminSettings）

**目的:** GROWI 管理者として、Vault 機能の状態を確認し、緊急停止 (Wipe)・audit log を確認できる UI を使いたい。機能の ON/OFF はデプロイ時の環境変数で決定するため UI からは操作せず、admin から bootstrap を発火する経路は Wipe Vault のみとする。

#### 受入条件

1. The GROWI Vault Gateway shall admin UI に現在の `VAULT_ENABLED` 設定値（read-only 表示）と bootstrap state を表示する
2. The GROWI Vault Gateway shall admin UI に bootstrap の `state` / `processed` / `totalEstimated` / `startedAt` / `completedAt` / `lastError` を表示する進捗セクションを提供する
3. When "Wipe Vault" ボタンが押された場合, the GROWI Vault Gateway shall 確認モーダル（テキスト入力不要、Yes/Cancel のみ）を表示し、確認後に `POST /_api/v3/vault/wipe` を呼び出して forceWipe フローを発火する
4. The GROWI Vault Gateway shall admin UI に既存 audit log UI への "vault.*" フィルター付きリンクを提供する
5. The GROWI Vault Gateway shall admin UI に `GET /internal/storage-stats` 経由で取得した namespace 数・合計 commit 数・loose object 数・repo size・最終 squash/gc 時刻を表示するストレージ観測セクションを提供する（vault_namespace_state を直接 read しない）
6. The GROWI Vault Gateway shall admin UI から `vaultEnabled` を変更する操作（トグル等）を提供しない
7. The GROWI Vault Gateway shall admin UI に「Prepare GROWI Vault」「Bootstrap」等の独立した bootstrap 発火ボタンを提供しない。理由: admin UI からの bootstrap は内部的に Wipe と機能的に等価 (forceWipe フロー) であり、ボタンが 2 つあると admin が両者の違いを誤認しやすい

### 要件 9: 共通 DTO 型（@growi/core）

**目的:** vault-manager との契約共有のため、vault_instructions スキーマと compose-view RPC の DTO 型を @growi/core に配置したい。

#### 受入条件

1. The GROWI Vault Gateway shall `packages/core/src/interfaces/vault/vault-instruction.ts` に `VaultInstructionDoc`・`VaultInstructionOp`・`VaultBulkUpsertEntry`・`VaultInstructionPayload` 型を定義する
2. The GROWI Vault Gateway shall `packages/core/src/interfaces/vault/vault-compose-view.ts` に `ComposeViewRequest`・`ComposeViewResponse`・`Namespace` 型を定義する
3. The GROWI Vault Gateway shall `packages/core/src/interfaces/vault/vault-storage-stats.ts` に `StorageStatsResponse` 型を定義する
4. The GROWI Vault Gateway shall `packages/core/src/interfaces/vault/index.ts` をバレルとして作成し、上記の全型をエクスポートする
5. The GROWI Vault Gateway shall `packages/core/package.json` の exports フィールドに `./dist/interfaces/vault` を追加する

### 要件 10: エラーハンドリングとセキュリティ

**目的:** GROWI Vault Gateway として、認証失敗・機能無効・proxy 失敗などのエラーを適切に処理し、情報漏洩を防止したい。

#### 受入条件

1. When 認証失敗が発生した場合, the GROWI Vault Gateway shall ページリスト・存在情報を含まないエラーメッセージで 401 を返す
2. When ACL 評価中にエラーが発生した場合, the GROWI Vault Gateway shall 500 を返しエラーをログに記録した後、接続を閉じる
3. The GROWI Vault Gateway shall `/vault.git/*` エンドポイントに既存 GROWI のレート制限を適用する
4. The GROWI Vault Gateway shall 認証失敗（auth-failure）イベントを audit log に記録し、ブルートフォース検出を可能にする
5. When compose-view RPC または upload-pack proxy が失敗した場合, the GROWI Vault Gateway shall vault-manager から受け取ったエラーに GROWI 内部情報を上乗せせずに 502 をクライアントに返す
