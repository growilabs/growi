# Brief: growi-vault-gateway

## Problem

GROWI Vault 機能において、外部 git クライアントからの clone / fetch リクエストを受け、GROWI 既存資産(PAT 認証 / ACL / page・revision モデル / audit log)を用いて認証・認可・namespace 判定・dispatch を行う **唯一の security perimeter** が必要である。これらの責務を `apps/app` 内の 1 feature として実装する spec が存在しない。

## Current State

- `apps/app` には gateway 機能・PAT 認証 middleware の vault scope 拡張・vault_instructions 書き込み機構・vault-manager との RPC client・admin UI のいずれも未実装
- 既存 `growi-vault` umbrella spec の design.md にコンポーネント定義・契約・file structure は定義済み(`apps/app/src/features/growi-vault/` 配下)
- `.kiro/specs/growi-vault-gateway/` ディレクトリは作成済み(空)

## Desired Outcome

- `apps/app` が `GET/POST /_vault/repo.git/...` を提供し、HTTP Basic Auth → PAT 認証 → ACL 評価 → vault-manager への透過 proxy を実現する
- ページ変更イベントを購読して `vault_instructions` コレクションに durable な指示を発行する
- 初回有効化時に bootstrap を主導し、pages cursor stream から seed instructions を発行する
- 管理者が機能 ON/OFF・bootstrap 進捗・audit log を確認できる UI を提供する

## Approach

`apps/app/src/features/growi-vault/` 配下に feature-based 構成で実装。既存 GROWI middleware (access-token-parser) / service (page-grant.ts, PageService) / model (Page, Revision, AccessToken, UserGroupRelation, AuditLog) を read-only で利用。vault-manager 側との通信は HTTP + shared secret(env var)経由。

## Scope

- **In**:
  - `VaultGatewayRouter` — git smart HTTP の唯一の対外 endpoint
  - `VaultPatAuth` middleware — access-token-parser を vault scope で composition
  - `VaultNamespaceMapper` — ACL → namespace 集合計算 / page → 所属 namespace 判定
  - `VaultDispatcher` — PageService event 購読 + `vault_instructions` 書き込み(coalesce 含む)
  - `VaultBootstrapper` — 初回有効化時の reset-all + pages cursor stream + seed instructions
  - `VaultManagerClient` — vault-manager への HTTP RPC + git body proxy
  - `VaultSettingsService` — `vaultEnabled` / endpoint / secret の取得
  - `VaultAdminSettings` UI — 機能 ON/OFF + bootstrap 進捗 + audit log filter リンク
  - `vault_instructions` Mongoose model(write owned by apps/app)
  - `vault_sync_state` の `bootstrap*` フィールド owner として書き込み
  - 既存 audit log への clone / fetch / auth-failure イベント記録
  - `app:vaultEnabled` / `app:vaultManagerEndpoint` / `app:vaultManagerInternalSecret` の config 定義(後者 2 つは env var only)

- **Out**:
  - bare repo 操作・git object I/O・git upload-pack の spawn(→ `growi-vault-manager`)
  - namespace tree の更新・per-user view ref 合成(→ `growi-vault-manager`)
  - change stream による instruction 消化(→ `growi-vault-manager`)
  - shared secret の発行・rotation 機構(env var 注入のみ、UI 機能なし)
  - PAT の発行・管理 UI(既存 AccessToken 機能に委譲)
  - GROWI ACL 評価ロジック本体(既存 page-grant.ts に委譲)

## Boundary Candidates

- **認証境界**: HTTP Basic → PAT → user 解決 → vault scope check
- **ACL 境界**: 既存 page-grant.ts への委譲点とユーザ → namespace 集合の決定論的計算
- **dispatch 境界**: PageService event → instruction 種別判定 → coalesce 適用 → outbox write
- **bootstrap 境界**: pages cursor stream の resume 可能化と進捗監視
- **proxy 境界**: HTTP body の透過転送(stream pipe)と shared secret 付与
- **admin UI 境界**: 機能 ON/OFF と bootstrap 進捗の admin 操作 / 観測

## Out of Boundary

- vault-manager 内部の git object 構築・delta 圧縮(成熟した git binary に委譲)
- bare repo の物理レイアウト・ストレージ選定(共有 fs / Filestore など)
- per-user view ref の合成アルゴリズム(`growi-vault-manager` 側の責務)
- instruction 消化のリトライ戦略(`growi-vault-manager` 側の責務)

## Upstream / Downstream

- **Upstream**:
  - 既存 `apps/app` の `Page` / `Revision` / `AccessToken` / `UserGroupRelation` / `ExternalUserGroupRelation` Mongoose モデル
  - 既存 access-token-parser middleware
  - 既存 `page-grant.ts` の `isUserGrantedPageAccess` / `generateGrantCondition`
  - 既存 PageService の page 変更 EventEmitter
  - 既存 audit log infra
  - umbrella spec(`growi-vault`)が定義する user-facing 要件と境界契約

- **Downstream**:
  - `growi-vault-manager`(`vault_instructions` outbox + `compose-view` RPC + git body proxy 経由)
  - 共通 DTO は `packages/core/src/interfaces/vault/` 経由で共有

## Existing Spec Touchpoints

- **Extends**: `growi-vault`(umbrella)の Req 1〜8 のうち、apps/app に責務が落ちる部分を実装
- **Adjacent**: `growi-vault-manager`(同時並列開発、契約共有先)
- **Related (out of scope)**: 既存 GROWI access-token / audit-log / page-grant 機能(変更せず使う)

## Constraints

- **互換性**: 既存 `pages` / `revisions` / `accesstokens` / `usergrouprelations` / `configs` コレクションのスキーマ変更不可
- **デプロイ**: 単一 apps/app pod 内の追加 feature。新規プロセス分離なし
- **leak 防止**(Req 3.5): clone 応答の ref 一覧 / tree / error message / object 転送のいかなる経路からも、ユーザが閲覧不可のページの存在が観測されないこと
- **PAT 連携**: 既存 GROWI の access-token 機能が PAT を発行する。本 spec では access-token-parser を再利用するのみで、PAT 管理 UI は変更しない
- **bootstrap 単一性**: bootstrap は StatefulSet replicas=1 が前提だが、本 spec の責務範囲では `vault_sync_state.bootstrapState` を check して二重起動を回避する程度に留める
- **環境変数**: `VAULT_MANAGER_ENDPOINT` / `VAULT_MANAGER_INTERNAL_SECRET` は env var only(DB 保存禁止)。`vaultEnabled` のみ DB / env 両対応
