# Research & Design Decisions: growi-vault-reconcile

## Summary

- **Feature**: `growi-vault-reconcile`
- **Discovery Scope**: Extension (apps/app に新規 module group を追加するが、`growi-vault-resilience` で確立した pattern を踏襲する extension）
- **Key Findings**:
  - 既存 `VaultNamespaceMapper.computePageNamespaces(page)` をそのまま再利用すれば、reconcile も resilience の drift detector と同じ「page → namespace → bulk-upsert」pattern で書ける（新規 instruction op なし）。
  - 既存 GROWI Page ACL は `IPageGrantService.calcCanUpdatePageGrant` および page-grant 評価で取得可能。reconcile spec は ACL ロジック本体を持たず、`pageModel.find(query)` 結果を ACL filter する純粋な consumer になる。
  - resilience の bootstrap-runner / drift-detector が cursor-based stream + namespace バッファ + chunk flush の I/O pattern を確立済み。reconcile orchestrator は同 pattern を流用するだけで Implementation 工数を低く保てる。

## Research Log

### gateway / manager / resilience の依存抽出

- **Context**: reconcile は cleanup 済み gateway と完了済み resilience に強く依存する。どの interface を再利用し、どこに boundary を引くかを確定する必要があった。
- **Sources Consulted**:
  - `.kiro/specs/growi-vault-gateway/design.md`
  - `.kiro/specs/growi-vault-manager/design.md`
  - `.kiro/specs/growi-vault-resilience/design.md`
  - `apps/app/src/features/growi-vault/server/services/resilience/` 配下の実装
  - `packages/core/src/interfaces/vault/vault-instruction.ts`
- **Findings**:
  - `VaultNamespaceMapper.computePageNamespaces(page)` は ACL → namespace 配列を返す純関数で、resilience の trash filter 撤廃後は trash 配下のページに対しても grant 由来の namespace を返す（vault-manager 側 `isExcludedFromVault` filter で skip される）。
  - `VaultInstructionPayload` の `bulk-upsert` op は `{ namespace, entries: [{pageId, pagePath, revisionId}] }` の形で、reconcile はこの形を直接生成すれば良い。新規 op の追加は不要。
  - resilience の drift-detector が `pageModel.find({updatedAt: {$gt: watermark}}).cursor()` で stream し、`computePageNamespaces` で namespace 算出し、各 namespace に instruction を発行する pattern を完成させている。reconcile は同 pattern を流用し、cursor の filter 条件のみを差し替える（`updatedAt > watermark` → `path` 一致 / `path` prefix 一致）。
  - resilience の `getStatus()` は `ResilienceStatus.bootstrap.state` を含んでおり、reconcile orchestrator はこれを読んで `bootstrapState !== 'done'` を判定できる。
- **Implications**: reconcile spec は新規 module group `services/reconcile/` を作るが、page → namespace 計算と instruction 発行は既存 component を呼び出すだけで完結する。Boundary は「target 解決 + ACL filter + concurrency 制御 + cursor stream + history 永続化」に限定でき、vault-manager / gateway / resilience の挙動変更は不要。

### apps/app の認証・ACL surface

- **Context**: reconcile は PAT 認証を使わない（UI 経由）。GROWI 既存の web セッション認証と Page ACL 評価をどう繋ぐかを決める必要があった。
- **Sources Consulted**:
  - `apps/app/src/server/middlewares/login-required.ts`
  - `apps/app/src/server/middlewares/admin-required.ts`
  - `apps/app/src/server/service/page-grant.ts`
  - `apps/app/src/features/growi-vault/server/routes/vault-admin.ts`
- **Findings**:
  - `loginRequiredFactory(crowi)` + `adminRequiredFactory(crowi)` の組み合わせが admin 用ルートの既存 pattern（vault-admin.ts:74）。
  - 一般ユーザー用ルートは `loginRequiredFactory(crowi)` のみ適用すれば良い。`access-token-parser`（PAT 用）は不要。
  - Page ACL 評価は `IPageGrantService` 経由で行うが、reconcile 用途では `pageModel.find()` の query 条件に grant 制約を含める方が cursor stream と相性が良い（resilience の bootstrap-runner と同じく、ACL 評価を後段 filter で行う pattern も使える）。
- **Implications**: admin endpoint は `[loginRequiredFactory(crowi), adminRequiredFactory(crowi)]`、user endpoint は `[loginRequiredFactory(crowi)]` のみで保護する。ACL filter は orchestrator 側の page-grant 評価で行う。

### UI 拡張点

- **Context**: 要件 5.3 / 5.4 で `/admin/vault` 拡張と PageTree / GrowiContextualSubNavigation の最小 entry point を要求している。
- **Sources Consulted**:
  - `apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx`
  - `apps/app/src/client/components/Sidebar/PageTreeItem/use-page-item-control.tsx`
  - `apps/app/src/client/components/Navbar/GrowiContextualSubNavigation.tsx`
- **Findings**:
  - VaultAdminSettings.tsx は既存セクションを `<Section>` 単位で分割しており（FeatureToggleSection / BootstrapStatusSection / CompletionReliabilitySection / AutoRetryStatusSection / DriftActivitySection 等）、reconcile section も同 pattern で追加可能。
  - SWR fetch は `useSWR('/vault/resilience-status', apiv3Get, {refreshInterval: 5000})` のような pattern が確立済み。
  - PageTree item action は `usePageItemControl` hook 内で `bookmark / duplicate / rename / delete` のように追加されており、新規 reconcile action もこの hook の延長で実装可能。
  - GrowiContextualSubNavigation は `PageControls` の dynamic import で sub-navigation 用 action button を持つ。reconcile button は PageControls 内に追加するか、別途 dynamic import で同等の dropdown item を追加できる。
- **Implications**: UI 拡張は既存パターンの延長で実装でき、新規 admin 画面を独立に作らないという要件 5 を自然に満たせる。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Drift-detector pattern を流用 | resilience の cursor stream + namespace バッファ + chunk flush をそのまま reconcile orchestrator に移植 | 既存 pattern なので開発・レビュー・テスト負荷が低い。冪等性が自動成立 | reconcile 固有の concurrency 制御 / history 永続化を別 component で持つ必要あり | **採用**。resilience との pattern 一貫性が最重要 |
| 新規 op を導入 (例: `reconcile-target`) | vault-manager 側で reconcile 専用の op handler を実装し、apps/app は op を発行するだけ | apps/app 側のロジックが薄くなる | 新規 op で `growi-vault-manager` の cleanup 済み reference を再編集する必要あり。冪等性契約の再検証も必要 | **却下**。要件 3.3 / 7.5 に反する |
| 同期 reconcile API (instruction outbox を使わない) | reconcile API が直接 vault-manager と通信し、同期的に git tree を更新 | UX が良い (完了まで待てる) | vault-manager の冪等性経路（instruction outbox）をバイパスするため、配送保証が崩れる。HA 対応も別途必要 | **却下**。`growi-vault-ha` の責務に踏み込む |
| Concurrency 制御を Redis lease で実装 | per-user / system-wide active count を Redis に保持 | 高 throughput / 分散環境対応 | GROWI は Redis を必須依存にしていない。single-replica 前提なので不要 | **却下**。in-memory + MongoDB ttl で十分 |
| Reconcile history を `vault_sync_state` に統合 | 専用 collection を作らず singleton doc を拡張 | collection 数が減る | singleton doc が膨らみすぎる。N 件履歴の retention 管理が困難 | **却下**。新規 `vault_reconcile_log` collection を採用 |

## Design Decisions

### Decision: Reconcile orchestrator は resilience の drift-detector pattern を流用する

- **Context**: reconcile は対象ページを `pageModel.find(query).cursor()` で stream し、namespace を計算して `bulk-upsert` を発行する処理が中核。これは resilience の drift-detector とほぼ同じ I/O pattern。
- **Alternatives Considered**:
  1. drift-detector 内部を library 化して reconcile から呼ぶ — 過剰な抽象化。状態管理（watermark 更新 / `bootstrapState !== 'done'` 早期 return 等）は drift-detector 固有の責務
  2. drift-detector の private 関数を export して reconcile から再利用 — barrel 設計原則違反、internal 詳細の漏洩
- **Selected Approach**: drift-detector と reconcile orchestrator は **independent** に同 pattern を実装する。pure な page→namespace 計算は `VaultNamespaceMapper` を共有、instruction 発行は両者が独立に `VaultInstruction.create` を呼ぶ。
- **Rationale**: 責務境界を明確に保つ。drift-detector は「watermark sweep + observability」、reconcile orchestrator は「target-bounded sweep + user-triggered」と異なる責務を持つ。同 pattern を 2 箇所で実装する duplication は、各 spec の boundary 維持コストより低い。
- **Trade-offs**: 似た cursor stream loop が 2 つ存在するが、各々が異なる責務に閉じているため accept。共通化は実装段階で必要に応じて pure helper として抽出する（例: `streamPagesAndEmitBulkUpsert(query, namespaceMapper, ...)`）。
- **Follow-up**: 実装後に code duplication が痛点になれば、`services/_shared/` または同等の場所に pure helper を切り出す検討を行う（本 spec の scope 外）。

### Decision: Concurrency 制御は in-memory counter + MongoDB log で実装

- **Context**: 要件 6.5 / 6.6 で per-user 同時実行上限と system-wide 同時実行上限を強制する必要がある。
- **Alternatives Considered**:
  1. Redis lease — 分散環境前提、GROWI には不要かつ依存追加コスト大
  2. MongoDB atomic counter doc — race condition 制御は可能だが、in-memory より overhead 大
  3. Pure in-memory counter — シンプル、single-replica 前提と整合（要件 7.6）
- **Selected Approach**: in-memory Map<userId, count> + system-wide active counter。reconcile 起動時に `compareAndIncrement` で slot 取得、完了時に decrement。プロセス再起動時は in-memory state がリセットされるが、`vault_reconcile_log` collection の `status === 'running'` レコードを起動時に `failed` 正規化することで整合性を保つ（resilience の stale-running 正規化と同 pattern）。
- **Rationale**: single-replica 運用前提（要件 7.6）であり、in-memory で十分な consistency が得られる。`vault_reconcile_log` で永続化される情報は user-visible な history のみで、concurrency 判定の source of truth ではない。
- **Trade-offs**: multi-replica 化時には Redis lease 等への移行が必要。これは `growi-vault-ha` の責務として明示する（migration 経路を Revalidation Triggers に記録）。
- **Follow-up**: 起動時の `running → failed` 正規化を migration step として `features/growi-vault/server/index.ts` に追加する。

### Decision: Reject 時のメッセージは i18n key で返し、UI が翻訳する

- **Context**: 要件 6.2 / 6.3 で reject 時の誘導メッセージ（「範囲を絞る or 管理者依頼」「範囲を絞る or force re-bootstrap」）が必要。
- **Alternatives Considered**:
  1. サーバー側で i18n された message string を直接返す — locale 解決をサーバー側に持たせる必要があり、現状の REST API pattern と整合しない
  2. Reject reason の enum 値を返し、UI 側で i18n key にマップする — 既存 GROWI の error handling pattern と整合
- **Selected Approach**: API response は `{ status: 'rejected', reason: RejectReason, eligiblePageCount?: number }` の形で reject reason の enum 値を返す。UI 側で reason を見て i18n key を解決し、ローカライズされたメッセージを表示する。
- **Rationale**: API contract が pure data、UI が presentation を担う既存 pattern と整合。テストも容易。
- **Trade-offs**: i18n key と reason の mapping が UI 側に分散するが、reconcile 専用 module 内に閉じれば管理可能。
- **Follow-up**: i18n key は `growi-vault.reconcile.rejected.<reason>` の prefix で統一する。

### Decision: `bootstrapState !== 'done'` の reject は default で有効、env で override 可能

- **Context**: 要件 4.4 で「拒否を default とする」と明示。ただし運用上、resilience の retry が長引いている間も reconcile を試したい運用者もいる可能性。
- **Alternatives Considered**:
  1. Hard reject (config なし) — 柔軟性なし
  2. Default reject + env override — 運用者が判断できる柔軟性
- **Selected Approach**: `VAULT_RECONCILE_REJECT_WHEN_BOOTSTRAP_NOT_DONE` env var、default `true`。`false` 設定時は bootstrap state によらず reconcile を受け付ける。
- **Rationale**: 安全な default を提供しつつ、運用者の判断で override 可能とする pattern。GROWI の他の env 設定と整合。
- **Trade-offs**: override 時に reconcile が部分的にしか効果を持たない可能性（例: bootstrap がまだ partial にしか書いていない状態で reconcile しても、後続 bootstrap で上書きされる）— UI で「override 中」を可視化する。
- **Follow-up**: admin UI でこの設定の現在値を表示し、override 状態を明示する。

### Decision: Reconcile history は `vault_reconcile_log` collection に専用 schema で永続化

- **Context**: 要件 5.1 で reconcile 履歴の永続化が必要。
- **Alternatives Considered**:
  1. `vault_sync_state` singleton 拡張 — singleton doc が肥大化、N 件管理困難
  2. `activities` collection（既存 audit log）に統合 — audit log は append-only の event 記録に特化、reconcile の status 更新（pending → running → completed）と相性が悪い
  3. 新規 `vault_reconcile_log` collection — 専用 schema、retention 制御も独立
- **Selected Approach**: 新規 `vault_reconcile_log` collection。retention は env var で N 日（default 30 日）。
- **Rationale**: reconcile の lifecycle に最適化した schema を持てる。audit log と並列に存在し、各々の責務に閉じる。
- **Trade-offs**: 新規 collection が増えるが、retention TTL index で容量を制御可能。
- **Follow-up**: TTL index を `triggeredAt` に張る。retention 期間は env var で設定可能とする。

## Risks & Mitigations

- **Risk 1**: 一般ユーザーが PageTree から大量の sub-tree reconcile を立て続けに投げると system-wide concurrency limit に達し、admin の reconcile も妨げられる
  - **Mitigation**: per-user concurrency limit (default 1) で個人レベルの暴走を防ぐ。system-wide limit には admin bypass option（`VAULT_RECONCILE_ADMIN_BYPASS_CAPACITY_LIMIT`、default `false`）を提供し、運用上の緊急対応経路を確保する
- **Risk 2**: ACL 評価のタイミングと reconcile 実行中の ACL 変更で「許可されていたはず」のページが reconcile 中に変更される race
  - **Mitigation**: 要件 2.5 通り、ACL 評価はリクエスト時点で確定し、実行中の変更は次回 reconcile で反映する。途中 ACL 変更は冪等性に委ねる（vault-manager 側で実際の write 時点で再検証されない設計だが、event-driven sync が後追いで補正する）
- **Risk 3**: drift-detector と user-triggered reconcile が同一 page に対して同時に bulk-upsert を発行し、vault_instructions outbox が短時間で多数の重複 instruction を持つ
  - **Mitigation**: vault-manager の冪等性で最終状態は一意に収束する（要件 4.1）。outbox の processedAt update + ack 機構で attempts 重複は許容範囲。実運用で観測すれば coalesce を後付け検討
- **Risk 4**: 一般ユーザー向け page count 上限を超過した場合、ユーザーが「自分の操作で何件が対象だったか」を知らないと範囲調整の判断ができない
  - **Mitigation**: reject response に `eligiblePageCount` を含めて返し、UI で「N 件が対象でした。上限 M 件以下に絞ってください」と明示する
- **Risk 5**: in-memory concurrency counter が apps/app プロセス再起動でリセットされ、再起動直後に `vault_reconcile_log.status === 'running'` のレコードが残留する
  - **Mitigation**: 起動時 migration ステップで `status === 'running'` を `failed`（理由: process restarted）に正規化する。resilience の stale-running detection と同 pattern

## References

- `.kiro/specs/growi-vault-gateway/design.md` — PAT 認証 / ACL / namespace mapper の既存 interface
- `.kiro/specs/growi-vault-manager/design.md` — `applyBulkUpsert` の冪等性契約 / `isExcludedFromVault` filter
- `.kiro/specs/growi-vault-resilience/design.md` — Trash 責務分離原則 / drift-detector の cursor stream pattern / 7-state bootstrap state machine / `vault_instructions` outbox
- `apps/app/src/features/growi-vault/server/services/resilience/drift-detector.ts` — cursor stream + namespace 計算 + chunk flush の参照実装
- `apps/app/src/features/growi-vault/server/services/resilience/bootstrap-runner.ts` — concurrency / state 制御の参照実装
- `apps/app/src/features/growi-vault/server/routes/vault-admin.ts` — admin route の既存 pattern
- `apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx` — admin UI セクション拡張の参照実装
