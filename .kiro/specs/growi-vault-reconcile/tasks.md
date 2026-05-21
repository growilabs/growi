# 実装計画: growi-vault-reconcile

> このタスク計画は `requirements.md` と `design.md` を真実源とする。各サブタスクは 1〜3 時間の実行単位で、観察可能な完了状態を 1 つ以上含む。`(P)` は同一親配下の直前タスクと並列実行可能な印（Foundation phase の完了が前提）。`_Boundary:_` は `(P)` タスクが触れる責務境界、`_Depends:_` は順序からは見えない cross-boundary な依存を示す。

---

## 1. Foundation — schema / 定数 / config / i18n

- [ ] 1. Foundation: 永続化スキーマ・audit 定数・config キー・i18n key の整備

- [x] 1.1 (P) `vault_reconcile_log` の Mongoose model と schema を新規実装
  - フィールドは reconcileId（UUID v4、unique index）/ triggeredBy.userId+isAdmin / targetType / targetPath / **descendantCount（number \| null、target page から読んだ raw 値。target が解決できない reject では null）** / processedCount / status enum / rejectReason / triggeredAt / startedAt / completedAt / lastError を持つ
  - `plannedPageCount` は schema に持たず、`(targetType === 'page') ? 1 : 1 + descendantCount` として導出する（schema は source データ寄せ）
  - `triggeredAt` に TTL index を張り、retention 日数は config から `expireAfterSeconds` を解決する
  - status と triggeredAt の compound index、triggeredBy.userId と triggeredAt の compound index を張る
  - 観察可能: 単体テストで model.create / find / countDocuments / TTL index 定義が確認でき、Mongoose のスキーマ定義から各 index が存在することが verify される
  - _Requirements: 5.1_
  - _Boundary: VaultReconcileLog model_

- [ ] 1.2 (P) `vault.reconcile.*` の audit action 定数を追加
  - `apps/app/src/interfaces/activity.ts` に `ACTION_VAULT_RECONCILE_STARTED` / `_COMPLETED` / `_FAILED` / `_REJECTED` / `_PARTIAL_ACL_FILTERED` の 5 定数を追加（既存 `ACTION_VAULT_RESILIENCE_*` の並びの直後）
  - 既存 audit log の type union に新規定数が含まれることを TypeScript 側で確認
  - 観察可能: 新規 5 定数が export され、TypeScript の `Action` union 型に新値が含まれる
  - _Requirements: 5.4, 6.8_
  - _Boundary: activity.ts interface_

- [ ] 1.3 (P) reconcile 関連の config キーを追加
  - `apps/app/src/server/service/config-manager/config-definition.ts` に `app:vaultReconcileMaxPagesPerUserRequest`（**default 1000**）/ `_MaxPagesPerAdminRequest`（**default 1000**）/ `_MaxConcurrentPerUser`（default 1）/ `_MaxConcurrentSystem`（**default 3**）/ `_ChunkSize`（default 100）/ `_HistoryRetentionDays`（default 30）/ `_RejectWhenBootstrapNotDone`（default true）/ `_AdminBypassCapacityLimit`（default false）の 8 key を追加
  - 各 key に対応する env var name を既存 pattern に合わせて宣言
  - 観察可能: `configManager.getConfig('app:vaultReconcileMaxPagesPerUserRequest')` 等を呼び出すテストで全 8 key が default 値（user/admin upper limit = 1000、system concurrency = 3）を返し、env var override も効く
  - _Requirements: 4.4, 6.1, 6.6, 6.7, 6.10_
  - _Boundary: config-definition.ts_

- [ ] 1.4 (P) reject 理由と submit feedback の i18n message key を追加
  - `growi-vault.reconcile.rejected.invalid-target` / `.bootstrap-not-done` / `.page-count-exceeds-user-limit` / `.page-count-exceeds-admin-limit` / `.user-concurrency-limit` / `.system-concurrency-limit` の 6 key を ja / en で追加
  - `growi-vault.reconcile.accepted.message` / `growi-vault.reconcile.section.title` 等の submit feedback / admin UI 用 key を追加
  - 観察可能: i18n locale ファイルから新規 key が引け、ja / en で内容が揃っている
  - _Requirements: 6.3, 6.4, 6.8_
  - _Boundary: i18n locale files_

---

## 2. Core domain — services/reconcile/ 配下の module group

- [ ] 2. Core: reconcile service の各責務 module を実装

- [ ] 2.1 (P) TargetResolver: target spec → MongoDB FilterQuery の純関数を実装
  - `targetType: 'page' | 'sub-tree'` と `targetPath` を受け取り、`{ ok: true, query }` または `{ ok: false, reason: 'invalid-target' }` を返す
  - page → `{ path: targetPath }`、sub-tree → 自身 + descendants（`$or: [{ path }, { path: { $regex: '^' + escaped + '/' } }]`）
  - regex injection 対策として正規表現メタ文字を必ず escape、null / 空文字 / 改行を含む path は invalid
  - 単体テストで page / sub-tree それぞれの query 生成、invalid path（空文字 / 正規表現 metachar / 連続スラッシュ）の reject、escape の網羅を確認
  - 観察可能: vitest で resolver の全分岐がパスし、escape された regex が確認できる
  - _Requirements: 1.4, 1.5_
  - _Boundary: TargetResolver_

- [ ] 2.2 (P) ConcurrencyController: `tryRunInBackground` 1 本に集約した in-memory slot 管理を実装
  - public API は `tryRunInBackground(opts: { userId, isAdmin, work })` / `getActiveCount` / `reset`（test のみ）の 3 つ
  - 内部で sync な acquire（per-user counter + system-wide counter の check-then-increment）→ `Promise.resolve().then(async () => { try { await work() } finally { release() } })` を schedule → 戻り値で `ok: true | false`
  - admin で `adminBypassCapacityLimit === true` の場合は system-wide 上限を skip
  - work が throw しても internal finally で必ず release されること、release は public surface に存在しないこと（型レベル）
  - 単体テストで上限到達時の reject reason（per-user=1 / system=3 default）、admin bypass、work throw でも counter が必ず戻る挙動を確認
  - 観察可能: vitest で tryRunInBackground の return path 3 通り（ok / user-limit / system-limit）と finally による release が全て検証される
  - _Requirements: 6.6, 6.7, 7.6_
  - _Boundary: ConcurrencyController_

- [ ] 2.3 (P) AclEvaluator: `PageQueryBuilder.addConditionToFilteringByViewer` を使った grant filter adapter を実装（**count は持たない**）
  - 入力 `{ user, isAdmin, baseQuery }` に対し `{ eligibleQuery }` のみを返す純 query builder（受付ゲートの上限判定は ReconcileService 側 `descendantCount` ベースに移譲、ACL filter 由来の差分判定は orchestrator 完了時に `processedCount < plannedPageCount` の heuristic で行う）
  - admin: `eligibleQuery = baseQuery` をそのまま返し DB I/O を発行しない
  - 非 admin: `pageGrantService.getUserRelatedGroups(user)` で group 解決 →  `PageQueryBuilder` で `addConditionToFilteringByViewer(user, groupIds, false, false, false)` を merge → `getFilter()` で eligibleQuery を抽出
  - **`countDocuments` 等の count 系 API は本 adapter から呼ばない**（accept gate のコストを ReconcileService 側 `findOne` 1 件に閉じるため）
  - 副作用を持たない（audit emit は呼ばない、partial-acl-filtered 判定は orchestrator 側）
  - 単体テストで admin / 非 admin それぞれの query merge を確認、`countDocuments` 呼び出しが 0 回であることを spy で assert
  - 観察可能: vitest で baseQuery と user の組み合わせから期待される eligibleQuery が返り、admin path で DB I/O が一切発生しない
  - _Requirements: 2.2, 2.3, 2.4, 2.5_
  - _Boundary: AclEvaluator_

- [ ] 2.4 HistoryStore: `vault_reconcile_log` 操作の CRUD wrapper を実装
  - `create` / `updateStatus` / `listRecent` / `normalizeStaleLifecycle` の 4 操作を提供
  - `normalizeStaleLifecycle()` は **`status: { $in: ['running', 'pending'] }`** の record を `{ status: 'failed', lastError: 'process-restarted', completedAt: now }` に bulk update し、件数を返す。`pending` を対象に含めるのは、accept gate が log を `pending` で insert した直後に process crash した場合の残留を吸収するため
  - `listRecent({ limit, offset })` は triggeredAt desc で取得
  - 単体テストで create → updateStatus → listRecent → normalizeStaleLifecycle の遷移、特に `running` / `pending` 両方が `failed: process-restarted` に正規化されることを assertion。TTL index 削除挙動の確認は integration test に委譲
  - 観察可能: vitest で 4 操作の戻り値と更新後の record 内容が期待通り。`normalizeStaleLifecycle` の対象 status が `running` と `pending` の両方を含むことが確認できる
  - _Depends: 1.1_
  - _Requirements: 5.1, 5.5_

- [ ] 2.5 ReconcileOrchestrator: async cursor stream + namespace 計算 + `bulk-upsert` 発行 worker を実装
  - `run({ reconcileId, eligibleQuery, plannedPageCount, triggeredBy, targetType, targetPath })` を提供（`plannedPageCount` は ReconcileService が `(targetType === 'page') ? 1 : 1 + descendantCount` で計算した処理予定 page 数）
  - 開始時に HistoryStore.updateStatus で `status: 'running', startedAt: now` に更新し audit `started`（payload に `descendantCount` / `plannedPageCount` を含む）を emit
  - **`pageModel.find(eligibleQuery).limit(plannedPageCount + 1).lean().cursor()` で stream を構築**（`.lean()` で Mongoose document inflate を回避、`limit(plannedPageCount + 1)` でハードキャップを付与）
  - 各 page で `vaultNamespaceMapper.computePageNamespaces(page)` を呼んで namespace ごとの buffer に積む（trash 判定は行わない — vault-manager 側 `isExcludedFromVault` に委譲）
  - buffer >= `chunkSize` 到達時に namespace ごとの `vault_instructions` に `bulk-upsert` instruction を insert し buffer clear、stream 終了後に残バッファを flush
  - **processedCount が `plannedPageCount + 1` に到達したら stream を即時停止し `status: 'failed', lastError: 'limit-exceeded', completedAt` を記録、audit `failed` を emit**（要件 6.11、`descendantCount` stale 等で受付ゲートが見積もり違いをした場合の defense-in-depth）
  - 正常完了時、**非 admin かつ `processedCount < plannedPageCount` のとき `vault.reconcile.partial-acl-filtered` audit を emit**（ACL filter で差分があった可能性を示す observability signal。空 namespace を返す page や mid-flight 削除 page も差分に含まれる ambiguous な heuristic）
  - 完了時に HistoryStore.updateStatus で `status: 'completed', completedAt, processedCount` を記録し audit `completed` を emit
  - 失敗時は `status: 'failed', lastError: error.message, completedAt` を記録、WARN log + audit `failed` を emit、その他の reconcile を巻き込まずに自身のみ失敗する
  - slot 管理は本 component に閉じない（ConcurrencyController 側の finally が release を保証する）
  - 単体テストで cursor stream → namespace バッファ → chunk flush → instruction insert の主要 path、`limit-exceeded` 失敗 path、`partial-acl-filtered` audit emission、failed 遷移、空 namespace 配列 page の skip、cursor が `.lean()` 経由で plain object を返すことを確認
  - 観察可能: vitest で N 件（N ≤ plannedPageCount）の page に対し期待件数の bulk-upsert instruction が `vault_instructions` に insert され、`vault_reconcile_log` の status が completed まで遷移。N > plannedPageCount の seed では `limit-exceeded` で failed
  - _Depends: 2.4_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.4, 5.5, 6.10, 6.11, 7.5, 7.8_

- [ ] 2.6 VaultReconcileService: 受付ゲート + barrel + factory を実装
  - acceptance gate を以下順序で同期評価: (1) TargetResolver で targetPath を validate (2) VaultResilienceLayer.getStatus + config で bootstrap reject (3) **`pageModel.findOne({ path: targetPath }, { descendantCount: 1, grant: 1, grantedUsers: 1, grantedGroups: 1 }).lean()` で target page を取得（null なら invalid-target）** (4) `plannedPageCount = (targetType === 'page') ? 1 : 1 + targetPage.descendantCount` を計算し role 別 roleLimit と比較、超過なら page-count-exceeds-*-limit reject（response body には raw `descendantCount` と `roleLimit` を含める） (5) AclEvaluator.buildEligibleQuery で `{ eligibleQuery }` を構築 (6) HistoryStore.create で `status: pending, descendantCount, reconcileId, triggeredAt: now` を insert (7) `ConcurrencyController.tryRunInBackground({ work: () => orchestrator.run({ reconcileId, eligibleQuery, plannedPageCount, ... }) })`
  - **accept gate は `findOne` 1 件 + 非 admin 時のみ `getUserRelatedGroups` 1 query のみ**（`countDocuments` 等の全 scan 系 query は発行しない、要件 6.2）
  - tryRunInBackground の戻り値 ok: false 時は HistoryStore.updateStatus で `status: 'rejected', rejectReason` を記録し audit `rejected` を emit
  - **no-op completed（ACL 全除外）と partial-acl-filtered の判定は orchestrator 完了時に委ねる**（accept gate では countDocuments を打たないため正確な ACL filter 件数を知らず、`processedCount` ベースで判定）
  - **accepted 時の戻り値 shape は `{ status: 'accepted', reconcileId, descendantCount }`**（target page の raw descendantCount を含める。UI 側で `plannedPageCount = (targetType === 'page') ? 1 : 1 + descendantCount` を導出）。`noop` / `eligiblePageCount` は accepted shape に含めない
  - reject 理由 enum を response の `reason` field に転写し、UI 側 i18n key 解決に使う
  - `listHistory` / `stop` を公開、`stop` は orchestrator の in-flight を中断しない（要件 4.2）
  - `services/reconcile/index.ts` を barrel として整え、`createVaultReconcileService(deps)` factory 経由でのみ外部から利用される形にする（internal modules は barrel から re-export しない）
  - 単体テストで accept gate の主要 5 path（invalid-target / bootstrap-not-done / page-count-exceeds-{user|admin} / *-concurrency-limit / accepted）が結果と audit event の両面で正しく動くこと、accepted shape が `{ reconcileId, descendantCount }` を含むこと、422 reject body が `{ reason, descendantCount, roleLimit }` を含むこと、および accept gate が `countDocuments` を呼んでいない（spy で確認）ことを assert
  - 観察可能: vitest で submit の 5 path がそれぞれ期待される ReconcileSubmitResult と vault_reconcile_log record / audit event を生成し、accept gate 中の DB I/O 数が一定（`findOne` × 1 + `getUserRelatedGroups` × {0,1}）に収まる
  - _Depends: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Requirements: 1.1, 1.2, 1.3, 2.6, 4.2, 4.3, 4.4, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4_

---

## 3. Server integration — routes と起動 wiring

- [ ] 3. Server: routes と起動シーケンスを既存 features/growi-vault に組み込む

- [ ] 3.1 (P) admin route handler を `vault-admin.ts` に追加
  - `POST /vault/reconcile`: body `{ targetType, targetPath }` を受け、`req.user` を triggeredBy として `VaultReconcileService.submit({ ..., isAdmin: true })` を呼ぶ薄い adapter
  - `GET /vault/reconcile-history`: query `{ limit, offset }` で `VaultReconcileService.listHistory` を呼び、entries + total を返す
  - 既存 `[loginRequiredFactory(crowi), adminRequiredFactory(crowi)]` middleware chain で保護（admin-only を route 層で強制）
  - reject reason → HTTP status mapping: invalid-target=400 / bootstrap-not-done=409 / page-count-exceeds-*-limit=422 / *-concurrency-limit=429
  - 単体テストで各 status code 分岐、admin 以外の request が middleware で弾かれることを確認
  - 観察可能: supertest で admin token で `POST /vault/reconcile` を叩くと 202 + reconcileId、非 admin は 403、限界超過時に 422/429 を返す
  - _Depends: 2.6_
  - _Requirements: 1.1, 2.1, 2.2, 5.2, 5.6_
  - _Boundary: vault-admin route_

- [ ] 3.2 (P) 一般ユーザー route handler を `vault-page.ts` 新規ファイルとして追加
  - `POST /vault/page/reconcile`: body `{ targetType, targetPath }` を受け、`VaultReconcileService.submit({ ..., isAdmin: false })` を呼ぶ
  - 既存 `loginRequiredFactory(crowi)` のみで保護（admin 不要、PAT 認証も使わない）
  - admin route と同じ reject reason → HTTP status mapping
  - 単体テストで非 admin user の accept、ACL 一部除外 → 200 + accepted + partial-acl-filtered audit、未認証 request は 401 を確認
  - 観察可能: supertest で一般 user token で submit でき、`vault_reconcile_log` に accepted record が残る
  - _Depends: 2.6_
  - _Requirements: 1.2, 2.1, 2.3, 2.4_
  - _Boundary: vault-page route_

- [ ] 3.3 起動 wiring: features/growi-vault/server/index.ts に reconcile init を追加
  - 順序: 既存 resilience migration → 新規 reconcile migration（`HistoryStore.normalizeStaleLifecycle` 呼び出し）→ resilience layer init → reconcile service init（ConcurrencyController の in-memory state を空で生成）→ routes ready
  - graceful shutdown で `reconcileService.stop()` を resilience layer の stop と並列に呼ぶ
  - admin route と user route の登録を server routes 配線に追加し、`/vault/reconcile` / `/vault/reconcile-history` / `/vault/page/reconcile` が期待する path に mount されることを確認
  - `vault_instructions` / `vault_sync_state` / 既存 vault-manager の挙動には触らない（境界遵守）
  - 観察可能: 統合テストで apps/app を起動した直後に `vault_reconcile_log.status === 'running'` および `status === 'pending'` の残留 record が `failed: process-restarted` に正規化され、3 つの reconcile endpoint が全て期待 path で応答する
  - _Depends: 1.1, 2.4, 2.6, 3.1, 3.2_
  - _Requirements: 4.3, 7.3, 7.5, 7.7_

---

## 4. Client UI — admin 拡張と PageTree / SubNav 連携

- [ ] 4. Client: admin section + PageTree / SubNav 起動経路 + 共通 modal を構築

- [ ] 4.1 (P) ReconcileTriggerModal: target type select + path input + confirm modal を新規実装
  - reactstrap Modal で target type radio（page / sub-tree）、path input、confirm ボタンを持つ
  - submit 時に渡された API endpoint（admin / user 用を切替可能）を `apiv3Post` で呼ぶ
  - response が `accepted` なら modal close + 親に accepted feedback を渡す、`rejected` なら reason を i18n key 解決して内部にエラー表示
  - 観察可能: Storybook 等の component test で 3 つの state（idle / submitting / rejected）が描画され、accepted 時に親 callback が呼ばれる
  - _Requirements: 5.3, 6.2, 6.3, 6.7_
  - _Boundary: ReconcileTriggerModal_

- [ ] 4.2 (P) ReconcileHistoryTable: history list 表示 component を新規実装
  - column: triggeredAt / triggeredBy / target (type + path) / processed / status / completedAt / lastError
  - status が `failed` の行は reactstrap の danger badge、`rejected` は warning badge で視覚的に区別
  - prop で entries 配列と loading state を受け取り、empty state も描画
  - 観察可能: component test で 0 件 / N 件 / failed 含む各シナリオの render snapshot が取れる
  - _Requirements: 5.2_
  - _Boundary: ReconcileHistoryTable_

- [ ] 4.3 PageReconcileMenuItem: PageTree / SubNav 共通の reconcile 起動 menu component を新規実装
  - menu item の click handler から `ReconcileTriggerModal`（task 4.1）を user endpoint `/vault/page/reconcile` 設定 + `targetPath` default に現在の page path を fix した状態で起動する thin wrapper
  - 4.1 の modal を再利用し、本 component 自体は独自 modal を持たない（modal の責務は 4.1 に閉じる）
  - submit 結果（accepted / rejected）は 4.1 modal 側の feedback を受けて表示
  - 観察可能: component test で menu item を click すると 4.1 の modal が open し、submit 後に成功 / 失敗メッセージが modal 内に表示される
  - _Depends: 4.1, 3.2_
  - _Requirements: 1.2, 6.2, 6.7_
  - _Boundary: PageReconcileMenuItem_

- [ ] 4.4 PageTree item action に reconcile entry を組み込む
  - `apps/app/src/client/components/Sidebar/PageTreeItem/use-page-item-control.tsx` に `onClickReconcile` callback と menu item rendering を追加
  - 既存の bookmark / rename / delete menu と同じ pattern で reconcile entry を表示
  - 観察可能: PageTree item の dropdown を開くと reconcile entry が見え、選択で PageReconcileMenuItem の modal が起動する
  - _Depends: 4.3, 3.2_
  - _Requirements: 1.2_

- [ ] 4.5 (P) GrowiContextualSubNavigation に reconcile button を組み込む
  - `apps/app/src/client/components/Navbar/GrowiContextualSubNavigation.tsx`（または PageControls 配下）に reconcile button を追加し、PageReconcileMenuItem 経由の modal を起動
  - 既存 PageControls dropdown と同じ rendering pattern を踏襲
  - 4.4 とはファイル境界が別（PageTree vs SubNav）のため並列実行可能
  - 観察可能: ページを開いた状態で sub-navigation に reconcile button が表示され、クリックで modal が起動する
  - _Depends: 4.3, 3.2_
  - _Requirements: 1.2_
  - _Boundary: GrowiContextualSubNavigation_

- [ ] 4.6 VaultAdminSettings に Reconcile section を組み込む
  - 既存 8 セクションの並びに 9 番目として Reconcile section を追加
  - section 内に trigger ボタン（ReconcileTriggerModal を admin endpoint で起動）と ReconcileHistoryTable を配置
  - SWR で `GET /vault/reconcile-history` を 5 秒周期 refresh、submit 直後は `mutate` で即時更新
  - 観察可能: `/admin/vault` を開くと Reconcile section が表示され、trigger → 202 → history table の最上段に新規 entry が表示される
  - _Depends: 3.1, 4.1, 4.2_
  - _Requirements: 5.2, 5.3_

---

## 5. Integration & validation — 横断 / E2E

- [ ] 5. Integration: 実 MongoDB / UI レベルでのシナリオ検証

- [ ] 5.1 reconcile-flow 実 MongoDB integration test を作成
  - `reconcile-flow.integ.ts` で devcontainer の `mongo` service に対し以下 7 シナリオを E2E で実行: (a) admin sub-tree 起動 → completed、(b) user page 起動で ACL 一部除外 → orchestrator 完了時に partial-acl-filtered + completed、(c) **target page の `descendantCount` が 1000 超 → 受付ゲートで rejected（accept gate 中の `countDocuments` 呼び出し回数が 0 であること、追加 query は `findOne` × 1 のみ）**、(d) system concurrency 上限（default 3）超過 → rejected、(e) `vault_reconcile_log` に `status: 'running'` と `status: 'pending'` の record を事前 seed → `HistoryStore.normalizeStaleLifecycle()`（task 3.3 の startup migration が呼ぶ実装）を直接呼んで両方 `failed: process-restarted` 正規化を assertion、(f) `bootstrapState !== 'done'` で default reject、(g) **`descendantCount` が stale で 999 と記録されているのに実際は 1500 件の descendants があるシナリオ → orchestrator が `limit(plannedPageCount + 1)` ハードキャップで停止し `status: 'failed', lastError: 'limit-exceeded'` で終了**
  - 各シナリオで `vault_reconcile_log` の最終状態と `vault_instructions` に積まれた `bulk-upsert` payload を assertion
  - 観察可能: vitest integ で 7 シナリオが全てパスし、test 後に collection が clean up される
  - _Depends: 2.6, 3.3_
  - _Requirements: 2.6, 4.4, 5.5, 6.1, 6.2, 6.7, 6.9, 6.11_

- [ ] 5.2 ReconcileOrchestrator の overhead と冪等性を検証する integration test を追加
  - **1000 件（default 上限）規模の page** を含む eligibleQuery に対し orchestrator を実行し、(i) accept gate latency が p99 ≤ 200ms、(ii) orchestrator 完了時間が ≤ 120s、(iii) `vault_instructions` insert 件数が `ceil(plannedPageCount / chunkSize) × (unique namespace 数)` に有界、(iv) process RSS の増加が 1 reconcile あたり 10 MB 以下に収まることを assertion
  - **`.lean()` 有無の比較テスト**: lean なしの cursor で同じ stream を実行した場合の memory 増分と比較し、`.lean()` 経由の方が memory 効率が良いことを確認
  - **同時 3 reconcile（system 上限）を並列実行**したシナリオで peak RSS と全 reconcile の完了を assertion（要件 6.7 の default 3）
  - 同一 eligibleQuery で 2 回連続 run しても `vault_instructions` に発行される bulk-upsert の冪等性（vault-manager 側の content-addressing 前提）に依存して最終 namespace 状態が変わらないことを assertion
  - 観察可能: vitest integ で 4 つの閾値（accept p99 / orchestrator 完了時間 / instruction 件数 / RSS 増分）と冪等性が全てパスし、`vault_instructions` の payload shape が既存 schema と一致する
  - _Depends: 2.5_
  - _Requirements: 4.1, 4.5, 6.10, 6.11, 7.1, 7.2_

- [ ] 5.3 admin / user UI の E2E シナリオを検証
  - admin が `/admin/vault` の Reconcile section から sub-tree を指定 → 202 → history table に completed として表示されるまでの E2E
  - 一般ユーザーが PageTree の reconcile menu から自分の page を起動 → modal 内で accepted feedback が表示されるまでの E2E
  - reject path（page count 上限超過 / concurrency 上限超過 / bootstrap-not-done）で reject reason に応じた i18n 翻訳メッセージが modal に表示されることを確認
  - 観察可能: E2E test で 3 シナリオ（admin success / user success / reject feedback）が全てパスする
  - _Depends: 4.6, 4.4_
  - _Requirements: 1.1, 1.2, 5.2, 5.3, 6.2, 6.3, 6.7_
