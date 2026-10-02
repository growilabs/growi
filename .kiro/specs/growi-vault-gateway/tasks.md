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

### [x] 1.2 vault-compose-view.ts の作成

### [x] 1.3 vault-storage-stats.ts の作成

### [x] 1.4 vault index.ts バレルと package.json exports 追加

---

## タスク 2: config-definition.ts への vault 設定追加

_要件: 7_
_Boundary: `apps/app/src/server/models/config-definition.ts`_

### [x] 2.1 vault 関連の config key 定義

---

## タスク 3: Mongoose モデルの実装

_要件: 4、5_
_Boundary: `apps/app/src/features/growi-vault/server/models/`_

### [x] 3.1 vault-instruction Mongoose model の作成

### [x] 3.2 vault-sync-state Mongoose model の作成

---

## タスク 4: VaultPatAuth ミドルウェアの実装

_要件: 2_
_Boundary: `apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.ts`_
_Depends: 1.1_

### [x] 4.1 vault-pat-auth.ts の作成

### [x] 4.2 VaultPatAuth の単体テスト

---

## タスク 5: VaultNamespaceMapper の実装

_要件: 3_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-namespace-mapper.ts`_
_Depends: 1.1, 1.2_

### [x] 5.1 vault-namespace-mapper.ts の作成

### [x] 5.2 VaultNamespaceMapper の単体テスト

---

## タスク 6: VaultSettingsService の実装

_要件: 7_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-settings-service.ts`_
_Depends: 2.1_

### [x] 6.1 vault-settings-service.ts の作成

---

## タスク 7: VaultDispatcher の実装

_要件: 4_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts`_
_Depends: 3.1, 5.1_

### [x] 7.1 vault-dispatcher.ts の作成

### [x] 7.2 VaultDispatcher の単体テスト

### [x] 7.3 PageService event 購読の組み込み（**全 Stage 実装完了 — Stage 1: タスク 21.1-A, Stage 2: タスク 21.1-B**）

`'syncDescendantsUpdate'` / `'syncDescendantsDelete'` は no-op（前者は `'updateMany'` で、後者は per-page `'delete'` で吸収されるため）。

---

## タスク 8: VaultManagerClient の実装

_要件: 6_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-manager-client.ts`_
_Depends: 1.2, 6.1_

### [x] 8.1 vault-manager-client.ts の作成

### [x] 8.2 VaultManagerClient の単体テスト

---

## タスク 9: VaultBootstrapper の実装

_要件: 5_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts`_
_Depends: 3.1, 3.2, 5.1_

### [x] 9.1 vault-bootstrapper.ts の作成

### [x] 9.2 VaultBootstrapper の単体テスト

---

## タスク 10: VaultGatewayRouter の実装

_要件: 1, 2.4, 10_
_Boundary: `apps/app/src/features/growi-vault/server/routes/vault-gateway.ts`_
_Depends: 4.1, 5.1, 6.1, 8.1_

### [x] 10.1 vault-gateway.ts の作成

`VAULT_ENABLED=false` は永続無効化のため 404（Retry-After なし）、bootstrap 未完了は一時状態のため 503 + Retry-After を返す。

### [x] 10.2 VaultGatewayRouter の統合テスト

---

## タスク 11: Admin API ルートの実装

_要件: 8_
_Boundary: `apps/app/src/features/growi-vault/server/routes/vault-admin.ts`_
_Depends: 6.1, 9.1_

### [x] 11.1 vault-admin.ts の作成

`POST /_api/v3/vault/wipe` が admin UI からの唯一の bootstrap 発火経路（kill switch）。非破壊的 bootstrap・`PUT enabled` は提供しない（`VAULT_ENABLED` は env のみ）。

---

## タスク 12: VaultAdminSettings UI の実装

_要件: 8_
_Boundary: `apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx`_
_Depends: 11.1_

### [x] 12.1 VaultAdminSettings.tsx の作成

独立した bootstrap 発火ボタンは追加しない（Wipe と機能的に等価になり UX 混乱を招く。req 8.7 参照）。

### [x] 12.2 admin UI の index.ts バレル

---

## タスク 13: feature 登録と routes 統合

_要件: 1、7_
_Boundary: `apps/app/src/features/growi-vault/server/index.ts`、`apps/app/src/server/routes/index.ts`_
_Depends: 7.3, 10.1, 11.1_

### [x] 13.1 feature 登録ファイルの作成

### [x] 13.2 VaultGatewayRouter の routes/index.ts への登録

---

## タスク 14: 統合テストの作成

_要件: 1–10_
_Boundary: `apps/app/src/features/growi-vault/__tests__/`_
_Depends: 10.1, 11.1, 12.1, 13.1, 13.2_

### [x] 14.1 clone E2E 統合テストの作成

integ テストは `describe.skip` のまま手動確認手順として運用する（タスク 23.2 選択肢 B による正式承認）。

### [x] 14.2 ACL 隔離・bootstrap・coalesce の統合テスト

integ テストは `describe.skip` のまま手動確認手順として運用する（タスク 23.2 選択肢 B による正式承認）。

---

## タスク 15: Admin 画面への VaultAdminSettings 導線追加

_要件: 8_
_Boundary: `apps/app/src/pages/admin/vault.page.tsx`_
_Depends: 12.1_

### [x] 15.1 admin/vault.page.tsx の作成

---

## タスク 16: bootstrap 未完了時の git クライアント向けメッセージ改善

_要件: 1.5_
_Boundary: `apps/app/src/features/growi-vault/server/routes/vault-gateway.ts`_
_Depends: 10.1_

### [x] 16.1 503 レスポンスボディへの状態詳細追加

`pending` / `running` / `failed` で異なるガイダンス文を返す。エラーメッセージにページリスト・存在情報を含めない（セキュリティ要件維持）。

---

## タスク 17: Vault 関連 env の configManager 経由読み込みへの統一

_要件: 7_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-settings-service.ts`、`apps/app/src/features/growi-vault/server/index.ts`、`apps/app/src/server/service/config-manager/config-definition.ts`_
_Depends: 2.1, 6.1, 13.1_

### [x] 17.1 managerEndpoint / managerInternalSecret を configManager から読む

env 直接読み込みは config-definition の登録を迂回し、設定キーの一元管理（型安全な参照・isSecret マスキング・テスト時の上書き API）を破る。`ConfigSource.env` 明示で env-only 制約を保ちつつ他キーと同一の仕組みに揃える。

### [x] 17.2 VAULT_BOOTSTRAP_ON_START を config-definition に登録し configManager から読む

Vault feature 内で唯一 `process.env` 直参照が残っていたため、「env は必ず config-definition に登録 → configManager 経由で読む」方針に統一する。

---

## タスク 18: bulk-upsert 障害修正（**P0 / 最優先・結合試験ブロッカー**）

_要件: 5（タスク 9 の追補）_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts`、`apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts`、`apps/app/src/features/growi-vault/__tests__/`_
_Depends: 9.1, 9.2, 14.1_

GROWI が階層整合性のために自動生成する revision を持たないページ（例: `/user`、`/empty`）は `revisionId: ''` で payload に積まれ、vault-manager 側の ObjectId キャストが空文字列で失敗（`attempts >= 5` まで継続失敗）、`mergedTreeOid` が empty tree のまま固定され `git clone` が停止する。一次原因は bootstrapper の `revisionId: page.revision?.toString() ?? ''` フォールバック。

### [x] 18.1 bootstrapper で null revision page をスキップする

### [x] 18.2 dispatcher で null revision page をスキップする

### [x] 18.3 結合試験 fixture へ null revision page を追加し回帰防止する

integ テストは `describe.skip` のまま手動確認手順として運用する（タスク 23.2 選択肢 B による正式承認）。

### [x] 18.4 既存 DB の修復手順をリリースノート相当でドキュメント化

---

## タスク 19: bootstrapper spec の型エラー修正（**P0 / CI ブロッカー**）

_要件: 5（タスク 9 の追補）_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-bootstrapper.spec.ts`_
_Depends: 9.2_

`tsgo --noEmit` が null revision skip テストの revision フィクスチャ（`Ref<IRevision>` 不整合）で `TS2322` を出して落ちており、タスク 9.2 の「TypeScript コンパイルが通ること」を満たしていなかった。

### [x] 19.1 revision フィクスチャを IRevision 整合に修正

---

## タスク 20: PAT スコープを実体として取得する（**P0 / 要件 2.5 機能未実装**）

_要件: 2.5_
_Boundary: `apps/app/src/server/models/access-token.ts`、`apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.ts`、`apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.spec.ts`_
_Depends: 4.1, 4.2_

`findUserIdByToken` が `.select('user')` で user フィールドのみ取得していたため production では `scopes` が常に `[]` になり、要件 2.5（PAT スコープを namespace 計算に反映）を満たせなかった。既存単体テストは scopes を直接生やしたモックを返しており `.select('user')` 制約が観測できず欠陥を見逃していた（essential-test-design の "Arrange That Serves the Assert"）。

### [x] 20.1 access-token / vault-pat-auth で scopes を実取得する

### [x] 20.2 .select() 制約を尊重したテストの追加

---

## タスク 21: rename / grant 一括変更の MVP 段階実装（**MVP / 要件 4.4・4.5**）

_要件: 4.4, 4.5_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts`、`apps/app/src/features/growi-vault/server/index.ts`、`apps/app/src/server/service/page/index.ts`、`requirements.md`、`design.md`_
_Depends: 7.1, 7.3_

要件 4.4 / 4.5 を MVP 必須機能として再定義する（以前は P1 future work）。GROWI core の event payload 変更の有無で 2 段階に分割: Stage 1 は core 変更なし、Stage 2 は core の event payload を拡張する。

### [x] 21.1-A Stage 1: `'updateMany'` 購読による新パス反映（GROWI core 変更なし）

`'rename'`（payload 空）と `updateChildPagesGrant` の bulkWrite（event 発火なし）は Stage 1 では検知できない。`'updateMany'` で bulk rename 後の新パスは per-page upsert で反映できるが、旧パスは clone に残る（Stage 2 で `rename-prefix` により削除）。

### [x] 21.1-B Stage 2: GROWI core event payload 拡張による完全実装

`'rename'` / `'updateMany'` に prefix 情報を追加し、`'descendantsGrantChanged'` を新設して subtree 単位の伝播を実装する。追加引数を無視するだけなので既存サブスクライバとは後方互換。

---

## タスク 22: namespace 計算へ PAT スコープを伝播する（**P1 / 要件 2.5 連携**）

_要件: 2.5, 3_
_Boundary: `apps/app/src/features/growi-vault/server/services/vault-namespace-mapper.ts`、`apps/app/src/features/growi-vault/server/routes/vault-gateway.ts`_
_Depends: 5.1, 10.1, 20.1_

タスク 20 で取得した scopes を活かす経路が無く（`computeAccessibleNamespaces` が `(userId)` のみ、gateway も `authResult.scopes` を破棄）、要件 2.5 を満たせなかった。MVP では実質スコープ依存の絞り込みは無いが入り口だけ整える方針。

### [x] 22.1 computeAccessibleNamespaces に scopes 引数を追加

### [x] 22.2 vault-gateway router からスコープを伝播

---

## タスク 23: 結合試験の位置付けを正規化する（**P1 / 完了基準と実態の乖離**）

_要件: 1〜10（タスク 14 の追補）_
_Boundary: `apps/app/src/features/growi-vault/__tests__/`、`tasks.md`_
_Depends: 14.1, 14.2, 18.3_

integ ファイルは全て `describe.skip` で Vitest 上は何も検証されず、完了基準「`pnpm vitest run *.integ` が通ること」は形式上緑だが実機回帰検出能力ゼロ。さらに integ 内 HTTP パスが実装と不整合（`/api/v3/vault/...` を叩くが実装は `/_api/v3/vault/...`）。

### [x] 23.1 HTTP パスを実装に合わせる

### [x] 23.2 完了基準を実体に揃える

選択肢 B を採用: integ は `describe.skip` のまま手動確認手順として正式承認し、14.1 / 14.2 / 18.3 の完了基準を「対応する手動確認手順の実行」に書き換える。

---

## タスク 24: Admin API パスの仕様/実装統一（**P2 / 文書整合性**）

_要件: 8_
_Boundary: `requirements.md`、`growi-vault-gateway/design.md`、`tasks.md`、（必要なら）`apps/app/src/server/routes/apiv3/index.js`、`apps/app/src/features/growi-vault/server/routes/vault-admin.ts`、`apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx`_
_Depends: 11.1_

要件 8.3 / タスク 11.1 は `POST /_api/admin/vault/bootstrap` 等を要求していたが、実装は GROWI 既存慣例に従い `/_api/v3/vault/...` にマウントされていた。`bootstrap` 経路は Prepare ボタン削除に伴い廃止され、bootstrap 発火は `POST /_api/v3/vault/wipe` に統一済み。

### [x] 24.1 要件 / 設計 / タスク文書を実装に揃える

---

## タスク 25: `vault_sync_state.bootstrapLastError` スキーマ欠落の修正（**P0 / 要件 5.4・8.2 永続層欠陥**）

_要件: 5.4, 8.2_
_Boundary: `apps/app/src/features/growi-vault/server/models/vault-sync-state.ts`、`apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts`、`apps/app/src/features/growi-vault/server/services/vault-bootstrapper.spec.ts`、`apps/app/src/features/growi-vault/server/models/vault-sync-state.spec.ts`、`growi-vault-gateway/design.md`、`growi-vault/design.md`_
_Depends: 3.2, 9.1, 9.2_

Schema / `IVaultSyncState` に `lastError` が無く、`$set: { lastError }` が Mongoose strict mode で silent drop され、要件 5.4（failure 時 lastError 記録）が永続層で機能していなかった。spec test は `updateOne` の引数のみ assert し persistence を検証していなかった（"Arrange That Serves the Assert"）。

### [x] 25.1 schema / interface に `bootstrapLastError` を追加

### [x] 25.2 bootstrapper の write/read を新フィールドへ

DB カラム名（`bootstrapLastError`）と API/UI の field 名（`lastError`）を意図的に分離し、バウンダリは getStatus で吸収する。

### [x] 25.3 設計ドキュメントの整合

---

## タスク 26: 認証・認可を標準 middleware 構成へ整合（**要件 2.4a・2.6・11 / ACL すり抜け修正**）

_要件: 2.4a, 2.6, 11_
_Boundary: `apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.ts`、`apps/app/src/features/growi-vault/server/routes/vault-gateway.ts`、`apps/app/src/features/growi-vault/server/index.ts`、各 spec、clone 手順ドキュメント_
_Depends: 4.1, 10.1, 13.2_

`/vault.git` ルータが標準 middleware チェーンを通さず認可を自前実装していたため、(1) `restrictGuestMode='Deny'` でも匿名 clone が通る ACL すり抜け（要件 2.4a）、(2) reverse proxy の Basic 認証と PAT が単一 `Authorization` ヘッダーで衝突（要件 2.6）、(3) 同一 feature 内の他ルータとの不整合（要件 11）が生じていた。**タスク 4・10 の認証部分を supersede する。** 26.3 は PR #11244 の `extractAccessToken` に依存し、これは master → dev/8.0.x → feat/growi-vault のマージで到達する（helper 到達後に着手）。本タスクは新規変更のため TDD（RED → GREEN）で進める。

### [x] 26.1 ゲスト gate: 匿名アクセスを `isGuestAllowedToRead()` に従わせる（要件 2.4a）

### [x] 26.2 標準 middleware チェーンへ合成（要件 11）

`certifyOrigin`/CSRF と `excludeReadOnlyUser` は意図的に非適用（git は origin/CSRF を持たず read 系のみ・read-only clone は許可）— 要件 11.4 に従いコメント + テストで意図を明示する。

### [x] 26.3 credential adapter を `extractAccessToken` へ再配線 + Basic fallback（要件 2.6）

`extractAccessToken`（precedence `Bearer` > `X-GROWI-ACCESS-TOKEN` > query > body）に置き換え、null のとき `Authorization: Basic` の password 部を git ネイティブ fallback とする。proxy 配下では proxy パスワードを PAT と誤認せず fail-closed（401）。

### [x] 26.4 運用ガイドの追記（要件 2.6）

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

> User-triggered targeted reconcile は別 spec `growi-vault-reconcile` で実装済み。
