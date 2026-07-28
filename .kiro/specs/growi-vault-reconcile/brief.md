# Brief: growi-vault-reconcile

## Problem

GROWI Vault の運用者と一般ユーザーは、MongoDB の `pages` と vault tree（per-ACL namespace の git repo）の乖離（drift）が局所的に発生した場合に、その特定の sub-tree のみを手動で再同期する経路を持たない。現状の選択肢は以下に限られる:

- **自動 drift 検出（`growi-vault-resilience`）**: `pages.updatedAt` watermark sweep が拾える範囲（編集 / trash 移動 / restore 由来の update drift）のみ。`growi-vault-resilience` v1 のスコープ縮退（path change drift / grant drop drift / hard delete drift は構造的に検出不能）に該当する drift は補修されない。
- **全 wipe 再 bootstrap（`VAULT_BOOTSTRAP_ON_START=force` または admin UI 明示トリガー）**: 既存 vault データを全削除して再構築するため、局所 drift の救済としては overkill かつ可用性低下を招く。

結果として「特定のページや sub-tree だけが古い / 欠落している」状態を発見しても、その範囲だけを修復する手段がなく、運用者は drift を放置するか force bootstrap で全削除するかの二択を強いられる。

## Current State

- `growi-vault-gateway` (cleanup 済み reference): PAT 認証 + ACL 評価 + read-only git smart HTTP / read API を提供。user-facing API の owner として確立済み。
- `growi-vault-resilience` (完了, 2026-05-21): system-triggered correctness（bootstrap state machine + 自動 drift detection + 既存 instruction 経路の補修発行）を担う。`vault_instructions` outbox の write owner。
- `growi-vault-manager` (cleanup 済み reference): instruction → git materialization の冪等な consumer。`isExcludedFromVault` filter / namespace mapper 等を所有。
- UI 側: admin UI (`/admin/vault` の `VaultAdminSettings`) は status surface のみ。PageTree / GrowiContextualSubNavigation には vault 操作 entry point が存在しない。

ギャップ:
- user-triggered で「この sub-tree / このページを再同期」を投げる API 経路がない
- ACL-scoped な reconcile 認可（admin は全範囲 / 一般ユーザーは自分が write 権を持つ sub-tree のみ）の評価点がない
- 進捗 / 失敗の user-facing surface（PageTree badge、SubNavigation indicator、admin UI の reconcile history 等）がない

## Desired Outcome

- 運用者 / 一般ユーザーが UI 上で「この範囲を再同期」をトリガーできる
- トリガーされた reconcile は ACL を評価して許可範囲のみ実行する（既存 GROWI ACL を再利用）
- reconcile は既存 `vault_instructions` outbox 経路で表現され、`growi-vault-manager` の冪等性に乗る（新規 op を増やさない）
- system-triggered な resilience の自動補修と user-triggered な reconcile が重複しても、vault-manager 側の冪等性で最終状態が一意に収束する
- admin UI で reconcile の発火履歴・成否を観測できる
- PageTree / GrowiContextualSubNavigation から見える reconcile 状態（pending / failed badge 等、最小限）

## Approach

`growi-vault-gateway` の PAT 認証 + ACL 評価 interface を **dependency として再利用** しつつ、`growi-vault-resilience` が確立した instruction 経路 (`vault_instructions` outbox + 既存 `bulk-upsert` op) に user-triggered reconcile を相乗りさせる。reconcile UI は admin UI の既存 `/admin/vault` 拡張 + PageTree / SubNavigation の最小 entry point として実装する。

新規 op は導入しない: reconcile は対象 sub-tree のページを `pages` から走査して `bulk-upsert` instruction を発行する形で表現する（resilience の drift detector と同じ pattern）。これにより `growi-vault-manager` の冪等性契約は不変。

## Scope

- **In**:
  - reconcile API endpoint（admin 用 / 一般ユーザー用、ACL-scoped）
  - reconcile request → `vault_instructions` への `bulk-upsert` 発行ロジック
  - 既存 GROWI ACL 評価の reconcile スコープへの適用
  - admin UI (`/admin/vault`) の reconcile history / trigger UI セクション拡張
  - PageTree / GrowiContextualSubNavigation の reconcile trigger entry point（最小: 右クリックメニュー or ボタン 1 つ）
  - reconcile 状態の最小 surface（pending / failed badge）
  - reconcile event の audit log 拡張（`vault.reconcile.*`）
  - resilience の自動補修と user-triggered reconcile の競合時挙動定義（冪等性に委ね、両方走らせる方針が default）

- **Out**:
  - 新規 instruction op の導入（既存 `bulk-upsert` 経路を再利用）
  - `growi-vault-manager` 側の挙動変更
  - `growi-vault-resilience` の自動補修ロジック変更
  - 双方向同期 / git 側 → MongoDB 側への push（vault は read-only 公開面のまま）
  - マルチレプリカ writer の serialize（`growi-vault-ha` の責務）

## Boundary Candidates

- **Reconcile API / 認可レイヤ**: HTTP endpoint + GROWI ACL 評価 + reconcile request 受付（`apps/app/src/features/growi-vault/server/routes/` に追加）
- **Reconcile orchestrator**: 受付した request → 対象ページ走査 → `vault_instructions` 発行（`apps/app/src/features/growi-vault/server/services/reconcile/` 新設候補）
- **Reconcile state model**: 進捗 / 履歴の永続化（新規 `vault_reconcile_log` collection か、`vault_sync_state` 拡張か）
- **UI surface（admin）**: `VaultAdminSettings` の reconcile history / trigger セクション拡張
- **UI surface（一般ユーザー）**: PageTree / SubNavigation の reconcile entry point

## Out of Boundary

- 新 instruction op の追加（`growi-vault-manager` 側の change を伴うため）
- vault-manager 側の dispatcher / namespace builder の挙動変更
- resilience の state machine 変更
- PAT 認証ロジック自体の変更（既存 `growi-vault-gateway` 所有）
- ACL ロジック自体の変更（既存 GROWI Page ACL を使用するのみ）
- マルチレプリカ writer serialize（`growi-vault-ha`）

## Upstream / Downstream

- **Upstream**:
  - `growi-vault-gateway` (cleanup 済み): PAT 認証 + ACL 評価 interface の reference
  - `growi-vault-resilience` (完了): `vault_instructions` outbox 経路と冪等性契約、state machine の `bootstrapState === 'done'` 条件
  - 既存 GROWI Page ACL / User Group: ACL 評価の真実源
- **Downstream**:
  - `growi-vault-ha` (future): reconcile 操作が multi-replica 環境で動く要件を ha spec の scope に組み込む必要がある（reconcile の lease / claim 等）

## Existing Spec Touchpoints

- **Extends**: なし（新規 spec として独立。既存 spec への追記はせず、cleanup 済み reference を保全）
- **Adjacent**:
  - `growi-vault-gateway`: PAT 認証 / ACL 評価 / read API の owner として依存
  - `growi-vault-resilience`: instruction 経路 / 冪等性 / state machine の前提として依存
  - `growi-vault-manager`: 受信側として不変、変更なし
  - `growi-vault` umbrella: sub_specs リストに本 spec を追加

## Constraints

- 新規 instruction op を導入しない（vault-manager 不変の制約）
- `growi-vault-resilience` の state machine（7-state）を変更しない
- `growi-vault-gateway` の PAT 認証 / ACL 評価 interface に「依存」として明示し、再実装しない
- 既存 GROWI Page ACL の評価結果を信頼する（再評価ロジックは導入しない）
- single-replica 運用前提（multi-replica 対応は `growi-vault-ha` 適用後）
- resilience との競合は冪等性に委ねる（reconcile 自動 abort 等の専用 serialize ロジックは導入しない）
- UI 拡張は既存 `/admin/vault` / PageTree / SubNavigation の延長で、新規 admin 画面を独立に作らない
