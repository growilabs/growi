# 実装計画

## Phase 1: 基盤整備（Foundation）

- [ ] 1. 基盤: schema 拡張 / config 拡張 / audit 定数 / migration

- [x] 1.1 vault_sync_state schema を 7-state 化し新規 14 フィールドを追加
  - _Requirements: 1.11, 1.12, 3.5, 5.1, 5.2, 5.3_
  - _Boundary: vault-sync-state model_

- [x] 1.2 (P) resilience 関連 config keys を config-definition.ts に追加
  - WHY: `app:vaultBootstrapOnStart` の型外値は `'false'` 扱いにフォールバックする（暗黙起動の安全側倒し）
  - _Requirements: 1.13, 3.1, 3.6, 4.4_
  - _Boundary: config-definition_

- [x] 1.3 (P) ACTION_VAULT_RESILIENCE_* audit 定数を interfaces/activity.ts に追加
  - _Requirements: 5.7_
  - _Boundary: interfaces/activity_

- [x] 1.4 起動時 migration 処理（2 段階分離 + stale running 正規化）
  - WHY: `$setOnInsert` 単体では既存 doc に新フィールドが入らず、追加フィルタ + upsert は E11000 を招くため fresh install 用 upsert と既存 doc 用 no-upsert を分離する。`running` + null instanceId は stale 扱いに正規化（migration 前の crash 残骸を安全側で回収）
  - _Depends: 1.1_
  - _Requirements: 1.11, 3.3_
  - _Boundary: resilience layer init（features/growi-vault/server/index.ts の migration block、bootstrap 起動分岐より前）_

## Phase 2: Trash 責務分離

- [ ] 2. Trash 責務分離: apps/app 層を trash-agnostic 化 / vault-manager 側で exclusion filter

- [x] 2.1 (P) vault-namespace-mapper から trash filter / status filter を削除
  - WHY: trash/status filter は materialization 責務が apps/app 層に漏れた layering 違反。grant 情報のみから namespace を導く純関数に純化する
  - _Requirements: 6.3_
  - _Boundary: vault-namespace-mapper (apps/app)_

- [x] 2.2 (P) vault-path-mapper に isExcludedFromVault helper を新設し _orphaned/ 振り分けを撤廃
  - WHY: trash exclusion を vault-manager 側の単一判定点に集約するため、internal `isOrphan` を export 化し `map()` を純粋な path 変換に純化
  - _Requirements: 6.4_
  - _Boundary: vault-path-mapper (vault-manager)_

- [x] 2.3 applyBulkUpsert / applyRemove の入口に isExcludedFromVault filter を追加
  - WHY: git tree に trash page を一切出さない exclusion semantics を成立させる。空 entry の instruction は commit なしで ack
  - _Depends: 2.2_
  - _Requirements: 6.3, 6.4_
  - _Boundary: vault-namespace-builder (vault-manager)_

- [x] 2.4 vault-dispatcher の delete event 経路 回帰確認
  - WHY: mapper の trash filter 削除が既存 delete event 経路（pre-deletion state での remove emit）を回帰させないことを担保
  - _Depends: 2.1, 2.3_
  - _Requirements: 6.3_
  - _Boundary: vault-dispatcher regression_

## Phase 3: 純関数 resilience モジュール

- [ ] 3. 純関数モジュール: state machine / trigger resolver / retry policy

- [x] 3.1 (P) BootstrapStateMachine の純関数遷移
  - WHY: 不変条件（`running → done` は必ず `verifying` 経由 / `forceOverride` は任意 state → running / `done → running` は forceOverride 経由のみ）をモジュール外副作用なしに enforce
  - _Requirements: 1.6, 1.9, 1.11, 3.2_
  - _Boundary: bootstrap-state-machine_

- [x] 3.2 (P) BootstrapTriggerResolver の env + state → action 解決
  - WHY: unknown env で skip にフォールバックし、全 env × state で action を一意決定
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.13, 3.4_
  - _Boundary: bootstrap-trigger-resolver_

- [x] 3.3 (P) RetryPolicy の exponential backoff 計算
  - WHY: backoff = `min(maxBackoffMs, baseBackoffMs * 2 ** previousAttempts) + jitter`、max 到達で escalated トリガーとして `shouldRetry: false`
  - _Requirements: 3.1, 3.2, 3.5_
  - _Boundary: retry-policy_

## Phase 4: I/O bound モジュール

- [ ] 4. I/O bound モジュール: heartbeat / runner / drift detector / facade composition

- [x] 4.1 BootstrapHeartbeat の instance ID 管理と stale 検知
  - _Depends: 1.1_
  - _Requirements: 1.9, 3.3_
  - _Boundary: bootstrap-heartbeat_

- [x] 4.2 (P) BootstrapRunner の I/O orchestrator
  - WHY: 唯一の I/O orchestrator。completeness は 3 条件 AND（cursor が snapshotMaxId 到達 / buffer 空 / 最終 instruction commit 済み）で判定。`abortAutoRetry` は永続化スケジュール打ち切りのみで in-flight には影響しない（採用方針 A）。resume / retry では reset-all を emit しない
  - _Depends: 3.1, 3.2, 3.3, 4.1_
  - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.10, 1.12, 2.1, 2.2, 2.4, 2.5, 2.6, 3.1, 3.5, 3.6, 3.7, 5.4, 5.7_
  - _Boundary: bootstrap-runner_

- [x] 4.3 (P) DriftDetector の周期 sweep と out-of-scope シグナル
  - WHY: trash filter なし（exclusion は vault-manager 側）。`remove` は v1 では発行しない（per-page state 不在の構造的帰結）。上限超過時は scope-out 4 条件（instruction 0 件 + watermark 据え置き + out-of-scope event + driftLastError）で自動回収を見送り運用者判断に委ねる
  - _Depends: 1.1, 2.1, 2.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.7_
  - _Boundary: drift-detector_

- [x] 4.4 resilience/index.ts barrel と createVaultResilienceLayer factory
  - WHY: 内部実装を barrel 経由のみで露出する単一公開面（barrel 設計原則）
  - _Depends: 4.2, 4.3_
  - _Requirements: 1.12, 6.6_
  - _Boundary: resilience/index.ts barrel_

## Phase 5: 統合 surface（facade / startup / route / UI）

- [ ] 5. 統合 surface: facade delegation / startup branch / admin API / admin UI

- [x] 5.1 VaultBootstrapper facade を resilience layer への delegation に書き換え
  - WHY: 既存 consumer の import 元を変えず後方互換を保つため、公開 interface / factory signature を維持し内部を delegation に置換
  - _Depends: 4.4_
  - _Requirements: 1.12_
  - _Boundary: vault-bootstrapper facade_

- [x] 5.2 (P) 起動分岐を BootstrapTriggerResolver 経由に置き換え
  - WHY: L396-404 区間のみが boundary（L1-395 の migration block は 1.4 の boundary）。graceful shutdown で heartbeat / drift scheduler を stop()
  - _Depends: 1.4, 5.1_
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.13_
  - _Boundary: features/growi-vault/server/index.ts L396-404 bootstrap dispatch only_

- [x] 5.3 (P) vault-admin route に resilience-status / retry-abort endpoint を追加
  - WHY: 既存 `GET /vault/status` は後方互換のため維持（resilience-status から bootstrap 部分を抽出）。既存 admin auth middleware 配下に配置
  - _Depends: 5.1_
  - _Requirements: 3.6, 5.1, 5.2, 5.3, 5.7_
  - _Boundary: vault-admin route_

- [x] 5.4 VaultAdminSettings UI を 3 セクション + 1 banner + confirm modal で拡張
  - WHY: drift 累積数値は再起動で 0 リセット。force banner は env を true に戻すまで永続表示。done 時の再 bootstrap は明示的全 wipe を伴うため confirm modal を挟む
  - _Depends: 5.3_
  - _Requirements: 1.10, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_
  - _Boundary: VaultAdminSettings UI_

## Phase 6: E2E 検証

- [ ] 6. E2E 検証: resilience-flow.integ.ts による実 MongoDB end-to-end

- [x] 6.1 fresh install / migration 冪等性 / 通常 bootstrap flow の E2E 検証
  - WHY: migration が 2 回目起動で E11000 を出さないこと（Issue 1 fix）と facade 後方互換を実 MongoDB で担保
  - _Depends: 5.2, 5.4_
  - _Requirements: 1.1, 1.2, 1.4, 4.1, 6.1, 6.2, 6.5, 6.6_
  - _Boundary: resilience-flow integration (fresh / migration / normal flow)_

- [x] 6.2 異常系 / force / abort の E2E 検証
  - WHY: stale 検知 → resume、escalated → abort → 再起動 resume、force 全 wipe + forceWarningActive persist を実 MongoDB で担保
  - _Depends: 6.1_
  - _Requirements: 1.6, 1.8, 2.3, 3.1, 3.3, 3.6, 5.6, 6.1, 6.2_
  - _Boundary: resilience-flow integration (stale / abort / force)_
