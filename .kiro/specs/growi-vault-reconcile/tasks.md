# 実装計画: growi-vault-reconcile

> このタスク計画は `requirements.md` と `design.md` を真実源とする。各サブタスクは 1〜3 時間の実行単位で、観察可能な完了状態を 1 つ以上含む。`(P)` は同一親配下の直前タスクと並列実行可能な印（Foundation phase の完了が前提）。`_Boundary:_` は `(P)` タスクが触れる責務境界、`_Depends:_` は順序からは見えない cross-boundary な依存を示す。

---

## 1. Foundation — schema / 定数 / config / i18n

- [ ] 1. Foundation: 永続化スキーマ・audit 定数・config キー・i18n key の整備

- [x] 1.1 (P) `vault_reconcile_log` の Mongoose model と schema を新規実装
  - `plannedPageCount` は schema に持たず `(targetType === 'page') ? 1 : 1 + descendantCount` で導出する（schema は source データ寄せ）。`descendantCount` は target が解決できない reject では null。
  - _Requirements: 5.1_
  - _Boundary: VaultReconcileLog model_

- [x] 1.2 (P) `vault.reconcile.*` の audit action 定数を追加
  - _Requirements: 5.4, 6.8_
  - _Boundary: activity.ts interface_

- [x] 1.3 (P) reconcile 関連の config キーを追加
  - user/admin の page 上限は default 1000、system 同時実行は default 3。
  - _Requirements: 4.4, 6.1, 6.6, 6.7, 6.10_
  - _Boundary: config-definition.ts_

- [x] 1.4 (P) reject 理由と submit feedback の i18n message key を追加
  - _Requirements: 6.3, 6.4, 6.8_
  - _Boundary: i18n locale files_

---

## 2. Core domain — services/reconcile/ 配下の module group

- [ ] 2. Core: reconcile service の各責務 module を実装

- [x] 2.1 (P) TargetResolver: target spec → MongoDB FilterQuery の純関数を実装
  - regex injection 対策として正規表現メタ文字を必ず escape し、null / 空文字 / 改行を含む path は invalid とする。
  - _Requirements: 1.4, 1.5_
  - _Boundary: TargetResolver_

- [x] 2.2 (P) ConcurrencyController: `tryRunInBackground` 1 本に集約した in-memory slot 管理を実装
  - acquire / release を内部に閉じ、release 漏れを型レベルで防ぐ（finally で必ず release）。admin の `adminBypassCapacityLimit` 時は system 上限を skip。
  - _Requirements: 6.6, 6.7, 7.6_
  - _Boundary: ConcurrencyController_

- [x] 2.3 (P) AclEvaluator: `PageQueryBuilder.addConditionToFilteringByViewer` を使った grant filter adapter を実装（**count は持たない**）
  - `countDocuments` を呼ばないのは accept gate のコストを ReconcileService 側 `findOne` 1 件に閉じるため。差分判定は orchestrator 完了時の `processedCount < plannedPageCount` heuristic に移譲。
  - _Requirements: 2.2, 2.3, 2.4, 2.5_
  - _Boundary: AclEvaluator_

- [x] 2.4 HistoryStore: `vault_reconcile_log` 操作の CRUD wrapper を実装
  - `normalizeStaleLifecycle()` は `running` に加えて `pending` も対象に含める。accept gate が `pending` insert 直後に crash した残留を吸収するため。
  - _Depends: 1.1_
  - _Requirements: 5.1, 5.5_

- [x] 2.5 ReconcileOrchestrator: async cursor stream + namespace 計算 + `bulk-upsert` 発行 worker を実装
  - cursor に `limit(plannedPageCount + 1)` のハードキャップを付け、超過時 `limit-exceeded` で失敗（`descendantCount` stale 由来の暴走を有界化する defense-in-depth）。`.lean()` で memory 削減、trash 判定は vault-manager 側へ委譲。非 admin かつ `processedCount < plannedPageCount` で `partial-acl-filtered` audit を emit。
  - _Depends: 2.4_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.4, 5.5, 6.10, 6.11, 7.5, 7.8_

- [x] 2.6 VaultReconcileService: 受付ゲート + barrel + factory を実装
  - accept gate は `findOne` 1 件 + 非 admin 時のみ `getUserRelatedGroups` 1 query に閉じ、`countDocuments` 等の全 scan 系 query を発行しない（要件 6.2）。no-op / partial-acl-filtered 判定は orchestrator 完了時に委ねる。
  - _Depends: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Requirements: 1.1, 1.2, 1.3, 2.6, 4.2, 4.3, 4.4, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4_

---

## 3. Server integration — routes と起動 wiring

- [ ] 3. Server: routes と起動シーケンスを既存 features/growi-vault に組み込む

- [x] 3.1 (P) admin route handler を `vault-admin.ts` に追加
  - reject reason → HTTP status mapping: invalid-target=400 / bootstrap-not-done=409 / page-count-exceeds-*-limit=422 / *-concurrency-limit=429。
  - _Depends: 2.6_
  - _Requirements: 1.1, 2.1, 2.2, 5.2, 5.6_
  - _Boundary: vault-admin route_

- [x] 3.2 (P) 一般ユーザー route handler を `vault-page.ts` 新規ファイルとして追加
  - `loginRequiredFactory` のみで保護（admin 不要、PAT も使わない）。admin route と同じ status mapping。
  - _Depends: 2.6_
  - _Requirements: 1.2, 2.1, 2.3, 2.4_
  - _Boundary: vault-page route_

- [x] 3.3 起動 wiring: features/growi-vault/server/index.ts に reconcile init を追加
  - 起動順序は `resilience migration → reconcile migration → resilience init → reconcile init → routes ready` で固定し依存方向を守る。`vault_instructions` / `vault_sync_state` / vault-manager の挙動には触らない。
  - _Depends: 1.1, 2.4, 2.6, 3.1, 3.2_
  - _Requirements: 4.3, 7.3, 7.5, 7.7_

---

## 4. Client UI — admin 拡張と PageTree / SubNav 連携

- [ ] 4. Client: admin section + PageTree / SubNav 起動経路 + 共通 modal を構築

- [x] 4.1 (P) ReconcileTriggerModal: target type select + path input + confirm modal を新規実装
  - submit 先の API endpoint（admin / user）を prop で切替可能にする。
  - _Requirements: 5.3, 6.2, 6.3, 6.7_
  - _Boundary: ReconcileTriggerModal_

- [x] 4.2 (P) ReconcileHistoryTable: history list 表示 component を新規実装
  - _Requirements: 5.2_
  - _Boundary: ReconcileHistoryTable_

- [x] 4.3 PageReconcileMenuItem: PageTree / SubNav 共通の reconcile 起動 menu component を新規実装
  - modal の責務は 4.1 に閉じ、本 component は user endpoint + 現在 page path を fix する thin wrapper に留める。
  - _Depends: 4.1, 3.2_
  - _Requirements: 1.2, 6.2, 6.7_
  - _Boundary: PageReconcileMenuItem_

- [x] 4.4 PageTree item action に reconcile entry を組み込む
  - _Depends: 4.3, 3.2_
  - _Requirements: 1.2_

- [x] 4.5 (P) GrowiContextualSubNavigation に reconcile button を組み込む
  - 4.4 とはファイル境界が別（PageTree vs SubNav）のため並列実行可能。
  - _Depends: 4.3, 3.2_
  - _Requirements: 1.2_
  - _Boundary: GrowiContextualSubNavigation_

- [x] 4.6 VaultAdminSettings に Reconcile section を組み込む
  - 既存 8 セクションの並びに 9 番目として追加。
  - _Depends: 3.1, 4.1, 4.2_
  - _Requirements: 5.2, 5.3_

---

## 5. Integration & validation — 横断 / E2E

- [ ] 5. Integration: 実 MongoDB / UI レベルでのシナリオ検証

- [x] 5.1 reconcile-flow 実 MongoDB integration test を作成
  - 受付ゲートで `countDocuments` 0 回（追加 query は `findOne` × 1 のみ）、`descendantCount` stale 時の orchestrator `limit-exceeded` 停止、`running` / `pending` 両方の startup 正規化を含む 7 シナリオを E2E 検証する。
  - _Depends: 2.6, 3.3_
  - _Requirements: 2.6, 4.4, 5.5, 6.1, 6.2, 6.7, 6.9, 6.11_

- [x] 5.2 ReconcileOrchestrator の overhead と冪等性を検証する integration test を追加
  - 1000 件規模で accept gate p99 ≤ 200ms / orchestrator ≤ 120s / instruction 件数有界 / RSS 増分 ≤ 10MB、`.lean()` の memory 効果、同時 3 並列、冪等性（vault-manager content-addressing 前提）を検証する。
  - _Depends: 2.5_
  - _Requirements: 4.1, 4.5, 6.10, 6.11, 7.1, 7.2_

- [x] 5.3 admin / user UI の E2E シナリオを検証
  - _Depends: 4.6, 4.4_
  - _Requirements: 1.1, 1.2, 5.2, 5.3, 6.2, 6.3, 6.7_
