# 実装計画

## Phase 1: 基盤整備（Foundation）

- [ ] 1. 基盤: schema 拡張 / config 拡張 / audit 定数 / migration

- [x] 1.1 vault_sync_state schema を 7-state 化し新規 14 フィールドを追加
  - BootstrapState enum を `'pending' | 'running' | 'verifying' | 'done' | 'failed' | 'retrying' | 'escalated'` の 7 値に拡張
  - 新規フィールド 14 件（`bootstrapInstanceId` / `bootstrapHeartbeatAt` / `bootstrapLastTriggerSource` / `bootstrapRetryAttempts` / `bootstrapRetryNextAt` / `bootstrapRetryAborted` / `bootstrapCompletenessLastCheckedAt` / `bootstrapCompletenessLastResult` / `bootstrapStreamSnapshotMaxId` / `driftLastWatermark` / `driftLastSweepAt` / `driftDetectedSinceBoot` / `driftRepairsEmittedSinceBoot` / `driftLastError`）を Mongoose schema に追加し、適切な default 値を設定
  - schema 単体テストで全 14 新規フィールド + 拡張 enum の default / 型制約を確認
  - 観測可能完了条件: 新 schema で `findOne({ _id: 'singleton' })` が全 14 新規フィールドを default 値付きで返し、`bootstrapState` の enum 制約に 7 値全てが含まれる
  - _Requirements: 1.11, 1.12, 3.5, 5.1, 5.2, 5.3_
  - _Boundary: vault-sync-state model_

- [x] 1.2 (P) resilience 関連 config keys を config-definition.ts に追加
  - `app:vaultBootstrapOnStart` を boolean → `'true' | 'false' | 'force'` enum に変更
  - 8 件の新規 config（`app:vaultBootstrapRetryMax` / `app:vaultBootstrapRetryBaseMs` / `app:vaultBootstrapRetryMaxMs` / `app:vaultBootstrapHeartbeatIntervalMs` / `app:vaultBootstrapHeartbeatStaleMs` / `app:vaultBootstrapRetryDisabled` / `app:vaultDriftDetectionIntervalMs` / `app:vaultDriftMaxPagesPerTick` / `app:vaultDriftDetectionDisabled`）を `defineConfig` パターンで追加
  - env var の dispatch を単体テストで確認
  - 観測可能完了条件: `configManager.getConfig('app:vaultBootstrapRetryMax')` 等が env 値・default を期待通り返し、`app:vaultBootstrapOnStart` の型外値は `'false'` 扱いになる
  - _Requirements: 1.13, 3.1, 3.6, 4.4_
  - _Boundary: config-definition_

- [x] 1.3 (P) ACTION_VAULT_RESILIENCE_* audit 定数を interfaces/activity.ts に追加
  - 15 種の event 定数を export: `vault.resilience.bootstrap-started`、`vault.resilience.bootstrap-completed`、`vault.resilience.bootstrap-failed`、`vault.resilience.completeness-check-failed`、`vault.resilience.retry-scheduled`、`vault.resilience.retry-failed`、`vault.resilience.retry-escalated`、`vault.resilience.retry-aborted`、`vault.resilience.force-warning-active`、`vault.resilience.stale-running-detected`、`vault.resilience.drift-sweep-started`、`vault.resilience.drift-detected`、`vault.resilience.drift-repaired`、`vault.resilience.drift-sweep-failed`、`vault.resilience.drift-sweep-out-of-scope`
  - 既存 ACTION_VAULT_* との並びを揃え、命名規則と export 順を統一
  - 観測可能完了条件: 全 15 定数が export され、型補完が効き、`interfaces/activity.ts` の test snapshot が更新される
  - _Requirements: 5.7_
  - _Boundary: interfaces/activity_

- [x] 1.4 起動時 migration 処理（2 段階分離 + stale running 正規化）
  - ステップ 1: `findOneAndUpdate({ _id: 'singleton' }, { $setOnInsert: { 全 default 値 } }, { upsert: true })` で fresh install を保証
  - ステップ 2: `updateOne({ _id: 'singleton', bootstrapRetryAttempts: { $exists: false } }, { $set: { 新フィールド 14 件 } })` で既存 doc を migrate（upsert なし、duplicate key error を回避）
  - ステップ 3: `bootstrapState === 'running' && bootstrapInstanceId == null` の検出時に `failed` 正規化 + `bootstrapLastError` 記録
  - 単体テストで (a) fresh install → 全 default で新規 doc 作成、(b) 既存 4-state doc → 7-state 拡張 + 新フィールド 14 件追加、(c) 2 回目以降の起動 → no-op で E11000 が出ない、(d) running + null instanceId → failed 正規化、を担保
  - 観測可能完了条件: migration を含む resilience layer 初期化が任意の DB 状態から 2 回連続実行できる（冪等）
  - _Depends: 1.1_
  - _Requirements: 1.11, 3.3_
  - _Boundary: resilience layer init（features/growi-vault/server/index.ts の migration block、bootstrap 起動分岐より前）_

## Phase 2: Trash 責務分離

- [ ] 2. Trash 責務分離: apps/app 層を trash-agnostic 化 / vault-manager 側で exclusion filter

- [x] 2.1 (P) vault-namespace-mapper から trash filter / status filter を削除
  - `derivePageNamespaces` 冒頭の `if (page.path?.startsWith('/trash')) return []` および `if (page.status !== STATUS_PUBLISHED) return []` の 2 ガードを撤廃
  - grant 情報のみから namespace を導く純関数に純化
  - vault-namespace-mapper.spec.ts に (a) trashed path (`/trash/foo`) でも grant 由来 namespace が返る、(b) `status !== published` でも grant 由来 namespace が返る、の 2 ケースを追加
  - 観測可能完了条件: trashed path / non-published page 入力時に空集合ではなく grant 由来 namespace が返る
  - _Requirements: 6.3_
  - _Boundary: vault-namespace-mapper (apps/app)_

- [x] 2.2 (P) vault-path-mapper に isExcludedFromVault helper を新設し _orphaned/ 振り分けを撤廃
  - internal `isOrphan` 関数を `isExcludedFromVault` に rename して export 化（純関数: `pagePath === '/trash' || pagePath.startsWith('/trash/')`）
  - `map()` 内の `if (isOrphan(pagePath)) return _orphaned/${relativePath};` 分岐を削除し、純粋な path → encoded git path 変換関数に純化
  - vault-path-mapper.spec.ts を更新: 既存 `_orphaned/` テストを削除し、(a) `isExcludedFromVault('/trash/foo') === true`、(b) `isExcludedFromVault('/foo') === false`、(c) `map('/trash/foo', pageId)` が `_orphaned/` prefix なしの encoded path を返す、を追加
  - 観測可能完了条件: trash path が encoded normal path として変換され、`_orphaned/` prefix が結果に現れない
  - _Requirements: 6.4_
  - _Boundary: vault-path-mapper (vault-manager)_

- [x] 2.3 applyBulkUpsert / applyRemove の入口に isExcludedFromVault filter を追加
  - 両 op handler の冒頭で `entries.filter((e) => !isExcludedFromVault(e.pagePath))` を実行
  - 空 entry になった instruction は commit 発生なし / vault_namespace_state 更新なしで ack
  - vault-namespace-builder.spec.ts に (a) trash entry のみの bulk-upsert → no-op ack（`commitAndUpdateRef` が呼ばれない）、(b) trash + 通常 entry 混在 → 通常 entry のみ commit、(c) trash path を狙った remove → no-op ack、を追加
  - 観測可能完了条件: trash entry が含まれる instruction が processed されても git tree に trash file が現れない
  - _Depends: 2.2_
  - _Requirements: 6.3, 6.4_
  - _Boundary: vault-namespace-builder (vault-manager)_

- [x] 2.4 vault-dispatcher の delete event 経路 回帰確認
  - vault-dispatcher.spec.ts を実行し、pre-deletion state で `remove` instruction が grant 由来 namespace に対して発行される flow が変わらないことを確認
  - 必要に応じて mapper の trash filter 削除に起因する snapshot 差分を test 側で調整
  - 観測可能完了条件: 既存 vault-dispatcher.spec.ts が全て pass、回帰なし
  - _Depends: 2.1, 2.3_
  - _Requirements: 6.3_
  - _Boundary: vault-dispatcher regression_

## Phase 3: 純関数 resilience モジュール

- [ ] 3. 純関数モジュール: state machine / trigger resolver / retry policy

- [x] 3.1 (P) BootstrapStateMachine の純関数遷移
  - 7 値の `BootstrapState` union と `BootstrapEvent` / `TransitionResult` / `SideEffect` 型定義
  - `transition(current, event)` で全 (state × event) ペアを定義
  - 不変条件を実装: (i) `running → done` は必ず `verifying` を経由、(ii) `forceOverride` は任意 state → running を許可（reset-all 副作用記述を含む）、(iii) `done → running` は forceOverride 経由のみ可（通常 start イベントでは不可）
  - bootstrap-state-machine.spec.ts で全 (state × event) ペアの transition 結果を網羅（正常 + 不正遷移 + forceOverride の全 state 起点）
  - 観測可能完了条件: transition がモジュール外への副作用を持たず、不正遷移時に `{ ok: false, reason }` を返す純関数として動作
  - _Requirements: 1.6, 1.9, 1.11, 3.2_
  - _Boundary: bootstrap-state-machine_

- [x] 3.2 (P) BootstrapTriggerResolver の env + state → action 解決
  - `resolveAction(envValue, currentState, retryAllowed, isStaleRunning)` で 4 種の `BootstrapAction`（`skip` / `startNew` / `resumeFromCursor` / `forceWipe`）を決定
  - env=force は常に forceWipe、env=false / unknown は常に skip、env=true + done は skip、env=true + pending は startNew、env=true + failed/escalated/stale + retryAllowed は resumeFromCursor
  - bootstrap-trigger-resolver.spec.ts で env (4 値) × state (7 値) × retryAllowed (2) × isStaleRunning (2) の組み合わせ table テスト
  - 観測可能完了条件: 全 env 値 × 全 state の組み合わせで action が一意に解決され、unknown env で skip にフォールバック
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.13, 3.4_
  - _Boundary: bootstrap-trigger-resolver_

- [x] 3.3 (P) RetryPolicy の exponential backoff 計算
  - `decideRetry(config, previousAttempts)` で `{ shouldRetry, attemptNo, backoffMs }` を返す純関数
  - backoff: `min(maxBackoffMs, baseBackoffMs * 2 ** previousAttempts) + jitter`
  - `previousAttempts >= maxAttempts` で `shouldRetry: false`（escalated 遷移トリガー）
  - retry-policy.spec.ts で (a) exponential 成長（`30s → 60s → 120s → 240s → 480s`）、(b) maxBackoffMs での頭打ち、(c) jitter 範囲、(d) max 到達時の false 返却、を網羅
  - 観測可能完了条件: 5 回連続呼び出しで backoff が exponential order を取り、6 回目で `shouldRetry: false` を返す
  - _Requirements: 3.1, 3.2, 3.5_
  - _Boundary: retry-policy_

## Phase 4: I/O bound モジュール

- [ ] 4. I/O bound モジュール: heartbeat / runner / drift detector / facade composition

- [x] 4.1 BootstrapHeartbeat の instance ID 管理と stale 検知
  - `acquireInstance()` で UUID 生成し vault_sync_state に書き込み
  - `refresh()` で `VAULT_BOOTSTRAP_HEARTBEAT_INTERVAL_MS`（default 10s）周期に `bootstrapHeartbeatAt` を更新する setInterval
  - `detectStaleRunning()` で `bootstrapHeartbeatAt` が `VAULT_BOOTSTRAP_HEARTBEAT_STALE_MS`（default 60s）以上古ければ stale 判定
  - `stop()` で interval を解放
  - bootstrap-heartbeat.spec.ts で (a) UUID 生成、(b) refresh が DB に findOneAndUpdate を発行、(c) 閾値超過で stale 判定 true、を網羅
  - 観測可能完了条件: refresh interval 起動中に `findOneAndUpdate` が周期的に呼ばれ、stop() で次回 tick が発火しない
  - _Depends: 1.1_
  - _Requirements: 1.9, 3.3_
  - _Boundary: bootstrap-heartbeat_

- [x] 4.2 (P) BootstrapRunner の I/O orchestrator
  - state machine / trigger resolver / heartbeat / retry policy を組み立てる唯一の orchestrator
  - bootstrap 実行フロー: trigger resolver で action 決定 → reset-all emit（forceWipe のみ）→ page stream で `streamSnapshotMaxId` 記録 → bulk-upsert per chunk → `verifying` 遷移 → structural completeness check (3 条件 AND) → `done` (cursor null reset) または `failed`
  - structural completeness check: (i) cursor が `streamSnapshotMaxId` に到達、(ii) `namespaceBuffers` が空、(iii) 最後の bulk-upsert instruction が `vault_instructions` に commit 済み、の AND
  - 自動再試行ループ: failed / escalated / stale 検知 → retry policy 適用 → backoff 待機 → resume 経路（reset-all は emit しない）
  - `abortAutoRetry`: 永続化スケジュール打ち切りのみ（`bootstrapRetryAttempts = 0`、`bootstrapRetryAborted = true`、`bootstrapRetryNextAt = null`、`escalated` → `failed` 降格）、in-flight には影響しない（採用方針 A）
  - 全状態遷移と retry / force / stale 検知を `vault.resilience.*` audit log に emit
  - `lastTriggerSource`（`env-true` / `env-force` / `admin-ui`）を vault_sync_state に永続化
  - bootstrap-runner.spec.ts で (a) env=true + pending → done、(b) env=true + done → no-op、(c) env=force + done → 全 wipe + 新規 bootstrap + force warning 立つ、(d) env=true + failed → resume（reset-all なし）、(e) stale running → resume、(f) completeness check 失敗 → failed + `bootstrapLastError` に失敗条件名、(g) max retry → escalated、abortAutoRetry で復旧、(h) abort 中の in-flight が done まで走り切る（採用方針 A の固定 test）、を網羅
  - 観測可能完了条件: `getStatus()` が現在の bootstrap / retry / drift / lastTriggerSource / forceWarningActive を一貫した snapshot として返し、retry 経由 done 後に `bootstrapCursor === null`
  - _Depends: 3.1, 3.2, 3.3, 4.1_
  - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.10, 1.12, 2.1, 2.2, 2.4, 2.5, 2.6, 3.1, 3.5, 3.6, 3.7, 5.4, 5.7_
  - _Boundary: bootstrap-runner_

- [x] 4.3 (P) DriftDetector の周期 sweep と out-of-scope シグナル
  - `VAULT_DRIFT_DETECTION_INTERVAL_MS`（default 5 分）の setInterval、`bootstrapState !== 'done'` で早期 return
  - `pages.find({ updatedAt: { $gt: driftLastWatermark } })` を cursor で読む（trash filter なし、status filter なし）
  - 各ページの `computePageNamespaces(page)` 出力に対して各 namespace へ `bulk-upsert` instruction を発行（`remove` は v1 では発行しない）
  - 完走時のみ watermark を `max(updatedAt)` で更新、失敗時は WARN ログ + audit log emit + watermark 据え置き
  - 上限超過時の挙動（scope-out signal）: cursor が `VAULT_DRIFT_MAX_PAGES_PER_TICK`（default 10,000）に到達したら自動回収を試みず、cursor を閉じ、watermark 据え置き、instruction を 1 件も発行せず、WARN ログに 2 択メッセージ（上限引き上げ / `VAULT_BOOTSTRAP_ON_START=force` で full bootstrap）を出力、`vault.resilience.drift-sweep-out-of-scope` audit event emit、`driftLastError` に同メッセージを格納
  - drift-detector.spec.ts で (a) done 状態で page 変更 → bulk-upsert 発行、(b) trashed page 変更でも bulk-upsert が grant 由来 namespace に発行、(c) trash からの restore → bulk-upsert、(d) `bootstrapState !== 'done'` → tick 早期 return、(e) namespace 計算 throw → watermark 据え置き、(f) drift detector は `remove` を発行しない（v1 固定 test）、(g) 上限超過時の scope-out 動作（instruction 0 件 + watermark 据え置き + out-of-scope event + driftLastError の 4 条件）、を網羅
  - 観測可能完了条件: 5 分後の next tick で sweep が走り、正常完走時に `driftLastSweepAt` / `driftDetectedSinceBoot` / `driftRepairsEmittedSinceBoot` が更新、上限超過時に `driftLastError` が更新され audit event が記録される
  - _Depends: 1.1, 2.1, 2.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.7_
  - _Boundary: drift-detector_

- [x] 4.4 resilience/index.ts barrel と createVaultResilienceLayer factory
  - `apps/app/src/features/growi-vault/server/services/resilience/index.ts` を新設し、`createVaultResilienceLayer(deps)` factory を export
  - factory 内部で BootstrapStateMachine / BootstrapTriggerResolver / RetryPolicy / BootstrapHeartbeat / BootstrapRunner / DriftDetector を組み立て、`VaultResilienceLayer` interface（`bootstrap` / `initOnStartup` / `getStatus` / `abortAutoRetry` / `stop`）を返す
  - `ResilienceStatus` / `BootstrapStatus` / `RetryStatus` / `DriftStatus` 型を再 export
  - 内部実装は import せず外部からは barrel 経由のみアクセス可能（barrel 設計原則）
  - 単体テストで factory が依存を正しく組み立てて返すことを確認
  - 観測可能完了条件: `import { createVaultResilienceLayer } from '.../resilience'` が型解決でき、戻り値が `VaultResilienceLayer` interface 全メソッドを実装している
  - _Depends: 4.2, 4.3_
  - _Requirements: 1.12, 6.6_
  - _Boundary: resilience/index.ts barrel_

## Phase 5: 統合 surface（facade / startup / route / UI）

- [ ] 5. 統合 surface: facade delegation / startup branch / admin API / admin UI

- [x] 5.1 VaultBootstrapper facade を resilience layer への delegation に書き換え
  - 既存 `VaultBootstrapper` interface と `createVaultBootstrapper(namespaceMapper)` factory の signature を維持
  - 内部実装を `createVaultResilienceLayer(...)` 呼び出しへの delegation に置換
  - 既存 `BootstrapStatus` 型を `ResilienceStatus.bootstrap` の subset として再 export（後方互換）
  - 既存 vault-bootstrapper.spec.ts の resume シナリオが回帰しないこと
  - 観測可能完了条件: 既存 consumer（admin route, index.ts）の import 元を変更せずに resilience layer が動作し、`getStatus()` が拡張済 `ResilienceStatus` を返す
  - _Depends: 4.4_
  - _Requirements: 1.12_
  - _Boundary: vault-bootstrapper facade_

- [x] 5.2 (P) 起動分岐を BootstrapTriggerResolver 経由に置き換え
  - `features/growi-vault/server/index.ts` の L396-404 周辺の bootstrap 起動分岐のみを置換（L396-404 区間が boundary、L1-395 の migration block は 1.4 の boundary）
  - 起動シーケンス: 1.4 の migration → trigger resolver → action 解釈 → resilience layer init → drift detector start
  - graceful shutdown フック（既存）で heartbeat / drift scheduler を `stop()` 呼び出しで停止
  - integ test で起動 → 適切な action 実行 → drift scheduler active を確認
  - 観測可能完了条件: apps/app 起動時に env 値に応じた action が startup log に記録され、起動完了後に drift scheduler の setInterval が active
  - _Depends: 1.4, 5.1_
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.13_
  - _Boundary: features/growi-vault/server/index.ts L396-404 bootstrap dispatch only_

- [x] 5.3 (P) vault-admin route に resilience-status / retry-abort endpoint を追加
  - `GET /vault/resilience-status` で `ResilienceStatus` JSON を返す
  - `POST /vault/retry/abort` で `abortAutoRetry()` を呼び `{ aborted: boolean }` を返す（409 if retry 中でない、500 on error）
  - 既存 `GET /vault/status` は後方互換のため維持（内部で resilience-status から bootstrap 部分を抽出）
  - 既存 admin auth middleware（`accessTokenParser + loginRequiredStrictly + adminRequired`）配下に配置
  - vault-admin.spec.ts に新規 endpoint のテストを追加（auth check + 正常系 + 409 異常系）
  - 観測可能完了条件: admin auth 付き request で `/vault/resilience-status` が `ResilienceStatus` JSON を返し、`/vault/retry/abort` が `vault_sync_state` の retry フィールドを更新する
  - _Depends: 5.1_
  - _Requirements: 3.6, 5.1, 5.2, 5.3, 5.7_
  - _Boundary: vault-admin route_

- [ ] 5.4 VaultAdminSettings UI を 3 セクション + 1 banner + confirm modal で拡張
  - Completion Reliability セクション: 最終 completeness check 時刻、結果、processed / estimated、トリガー源（`env-true` / `env-force` / `admin-ui`）
  - Auto-Retry Status セクション: attemptNo / nextAttemptAt / lastError、abort ボタン（`retry.aborted === true` で disabled）、escalated 状態の reactstrap Alert 強調
  - Drift Activity セクション: lastSweepAt / lastWatermark / detectedSinceBoot / repairsEmittedSinceBoot / lastError（out-of-scope メッセージを含む）
  - Force Warning Banner: `forceWarningActive === true` の場合に reactstrap Alert (color="danger") で「`VAULT_BOOTSTRAP_ON_START=force` のままです。次回起動で再度全 wipe が走るため、`true` に戻してください。」を永続表示
  - 既存 "Prepare GROWI Vault" ボタンに reactstrap Modal による confirm を挟む（`bootstrapState === 'done'` のとき「完了済みの再 bootstrap は明示的全 wipe を伴う」旨を表示）
  - UI spec で (a) completion section レンダリング、(b) abort ボタン disabled 状態、(c) drift 累積数値表示が再起動で 0 リセット、(d) force banner 表示条件、(e) done 時の confirm modal 表示、を網羅
  - 観測可能完了条件: `/admin/vault` を開くと 3 新規セクション + 既存 5 セクションが表示され、状態に応じた強調表示（escalation Alert / force banner）が出る
  - _Depends: 5.3_
  - _Requirements: 1.10, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_
  - _Boundary: VaultAdminSettings UI_

## Phase 6: E2E 検証

- [ ] 6. E2E 検証: resilience-flow.integ.ts による実 MongoDB end-to-end

- [ ] 6.1 fresh install / migration 冪等性 / 通常 bootstrap flow の E2E 検証
  - 実 MongoDB（devcontainer の `mongo` service）を使った integration test
  - シナリオ: (a) `VAULT_BOOTSTRAP_ON_START=true` で fresh install 起動 → migration ステップ 1 で singleton 作成 → bootstrap 完了 → cursor null reset → drift sweep 開始、(b) 同じプロセスを 2 回目起動 → migration が duplicate key error を出さない（Issue 1 fix 担保）、(c) 既存 4-state doc を migrate → 7-state + 14 新フィールドが揃う
  - 既存 vault-bootstrapper.spec.ts の resume シナリオが regress しないこと（facade 後方互換）
  - 観測可能完了条件: 上記 3 シナリオが pass し、`vault_instructions` に reset-all + bulk-upsert の正しい順序の instruction が記録される
  - _Depends: 5.2, 5.4_
  - _Requirements: 1.1, 1.2, 1.4, 4.1, 6.1, 6.2, 6.5, 6.6_
  - _Boundary: resilience-flow integration (fresh / migration / normal flow)_

- [ ] 6.2 異常系 / force / abort の E2E 検証
  - シナリオ: (a) 異常終了で `running` 残留 → 次回起動で heartbeat 期限切れ stale 検知 → retry 経由 resume、(b) max retry 到達 → escalated 状態で停留 → `POST /vault/retry/abort` で failed 降格 → env=true 再起動で resume 可能、(c) `VAULT_BOOTSTRAP_ON_START=force` 起動 → 既存 vault データ全 wipe + 新規 bootstrap + `forceWarningActive` が persist
  - 観測可能完了条件: 上記 3 シナリオが pass し、`vault.resilience.*` audit log に対応する event が emit、`force` 完了後に admin UI banner が立つ
  - _Depends: 6.1_
  - _Requirements: 1.6, 1.8, 2.3, 3.1, 3.3, 3.6, 5.6, 6.1, 6.2_
  - _Boundary: resilience-flow integration (stale / abort / force)_
