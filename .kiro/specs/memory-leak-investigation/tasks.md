# Implementation Plan

> 本 spec は **Core (server-side fixes) → Integration → Validation (Phase 5) → Mandatory Re-measurement (Phase 6) → Conditional Follow-ups (Phase 7)** で進める。Core の sub-task は責務境界が分離しており、(P) マーク付きの並列実行が可能。
>
> **条件付きコンポーネント**（YjsIdleSweeper / HandlerBackpressure）は Phase 6 の re-measurement 結果が confirmed の場合のみ Phase 7 で着手する。
>
> **Dependency on `memory-profiler` spec**: Phase 5 以降のすべての検証セッションは `memory-profiler` spec が提供する profiling ツール（`bin/memory-profiler/`）を利用する。本 spec はそのツールの **consumer** であり、ツール本体の実装・interface・operational procedure の責務は持たない。
>
> **Scope change history**:
> - Task 1.2（SIGUSR2 in-process fallback）は CDP-only 方針へ切り替えたため削除した（commit `b8e3efa4c7`）。
> - 旧 Phase 1（Foundation）/ Phase 3（Core — Profiling sidecar）/ Task 4.2（Scenario runner integration）は profiling ツール開発タスクであり、`memory-profiler` spec に **責務移管**。本 spec からは削除し、Phase 5 以降で同ツールを **利用する** 文脈に置き換えた。
> - Task 2.2（L2）は Phase 6 / Task 6.1 計測後に **設計を 2 度変更**: 初版 allow-list（`getNodeAutoInstrumentations(<deny-list>)` + `OTEL_AUTO_INSTRUMENTATION_PROFILE` env var）→ direct-import の `buildInstrumentations` 関数（commit `0f2cfb77d6`）→ `generateNodeSDKConfiguration` 内へインライン化し env var を撤去（commit `19c56368fc`）。最終 shipped 形は env var なしの直接 instantiate（[node-sdk-configuration.ts:53-58](../../apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts)）。下記 Task 2.2 の本文は最終形に追従する形に書き直した。allow-list 中間形に対する Phase 6 / Task 6.1 計測結果は [verification-report.md / L2](./verification-report.md#l2--otel-instrumentation-set-task-22) に保存。

## 2. Core — Server-side fixes (parallel-capable; 異なるファイルへの独立変更)

- [x] 2.1 (P) L1: Mongoose connection pool の上限・下限を環境変数化
  - `mongoOptions` に `maxPoolSize` と `minPoolSize` を追加し、それぞれ `MONGO_MAX_POOL_SIZE`（default 15）と `MONGO_MIN_POOL_SIZE`（default 2）から読む。
  - `Number.isFinite` チェックで NaN は default にフォールバックする。
  - pool 周辺の他オプション（`useUnifiedTopology` 等）は変更しない。
  - Unit test を追加し、未指定 / 正常値 / NaN / `min > max` 異常入力時の挙動を検証する。
  - 観測可能な完了条件: `MONGO_MAX_POOL_SIZE=3` で server を起動した時、mongoose connection の `topology.s.options.maxPoolSize` が 3 を反映している。
  - _Requirements: 3.1, 3.2, 3.4, 3.6, 7.1, 7.2_
  - _Boundary: MongoosePoolConfig_

- [x] 2.2 (P) L2: OpenTelemetry instrumentation を direct-import 形へ固定
  - `@opentelemetry/auto-instrumentations-node` への依存を廃止し、`HttpInstrumentation` / `ExpressInstrumentation` / `MongoDBInstrumentation` / `MongooseInstrumentation` の 4 つを直接 import & instantiate して `instrumentations` 配列へ渡す。
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE` env var は **存在させない**（外部 instrumentation を追加する場合は `node-sdk-configuration.ts` を編集する運用に統一）。
  - 既存の HTTP anonymization 設定 (`httpInstrumentationConfigForAnonymize`) との合成は維持する。
  - Unit test は 4 instrumentation がコンストラクタ呼び出しされ、`HttpInstrumentation` のみ anonymize-config 経由で初期化されることを検証する形に書き直す（[node-sdk-configuration.spec.ts](../../apps/app/src/features/opentelemetry/server/node-sdk-configuration.spec.ts) 参照）。
  - 観測可能な完了条件: `generateNodeSDKConfiguration()` の戻り値 `instrumentations` が長さ 4、各要素の constructor name が allow-list と一致。31 instrumentation を抱える `getNodeAutoInstrumentations` 依存は import 文ごと消えている。
  - _Requirements: 3.3, 3.4, 3.6, 4.5, 7.1, 7.2_
  - _Boundary: OtelDirectInstrumentations_
  - _Design history_: 初版は allow-list（`getNodeAutoInstrumentations(<deny-list>)` + `OTEL_AUTO_INSTRUMENTATION_PROFILE` env var）で実装。Phase 6 / Task 6.1 計測で RSS delta ≈ 0 MB と判明したため、isolated bench（`apps/app/tmp/otel-import-bench/bench.js`）の予測 −11 MB を採用して direct-import へ再設計（commits `0f2cfb77d6`, `19c56368fc`, `7277daf43a`）。詳細経緯は [verification-report.md / L2](./verification-report.md#l2--otel-instrumentation-set-task-22)。

- [x] 2.3 (P) L3 metric: `growi.yjs.docs.count` Observable Gauge モジュールの新規作成
  - `apps/app/src/features/opentelemetry/server/custom-metrics/yjs-metrics.ts` を新規作成し、既存 `system-metrics.ts` と同じパターン（`addYjsMetrics(): void` named export + `meter.createObservableGauge` + `addCallback`）で実装する。
  - Metric 名 `growi.yjs.docs.count`、unit `{document}`、description は collaborative document の current count を示す英文。
  - Callback は `y-websocket/bin/utils` の `docs.size` を読み出すのみ。`docs` が未初期化のときは 0 を返す defensive check を入れる。
  - Co-located の unit test を追加し、`docs` を fake Map に置換した状態で `addYjsMetrics()` を呼ぶと OTel meter から `growi.yjs.docs.count` が解決でき、`docs.size` の現在値を返すことを検証する。
  - 観測可能な完了条件: vitest で `pnpm vitest run yjs-metrics.spec` が green、metric の name / unit / description が assertion に含まれる。
  - _Requirements: 4.1, 4.2, 4.5_
  - _Boundary: YjsDocsMetric_

- [x] 2.4 (P) L5: `autoUpdateExpiryDate` の defensive 例外捕捉
  - `apps/app/src/server/service/page-operation.ts` の `setInterval` callback を try/catch でラップし、catch 内で `growi-logger` を介して `{ err, operationId }` を含む `error` レベルの構造化ログを残す。
  - `setInterval` の周期自体は継続する（再 throw しない）。
  - 既存 caller (`apps/app/src/server/service/page/index.ts` の try/finally) と二重ハンドリングしないことを確認する。
  - Unit test で、`PageOperation.extendExpiryDate` が reject した次の tick で logger.error が呼ばれ、interval が継続することを fake timer で検証する。
  - 観測可能な完了条件: `pnpm vitest run page-operation.spec` の追加ケースが green。
  - _Requirements: 5.3_
  - _Boundary: DefensivePageOperationTimer_

## 3. Core — Profiling sidecar (責務移管済み)

> Profiling sidecar 群（CDP snapshot client / Load driver / RSS time-series logger / Scenarios）の実装・interface・operational procedure は `memory-profiler` spec の責務。本 spec から実装履歴は削除し、同 spec の `tasks.md` / `design.md` を参照する。本 spec は同ツールの consumer として Phase 5 以降で利用する。

## 4. Integration

- [x] 4.1 (P) `yjs-metrics` を custom-metrics 合成パスに組み込む
  - `apps/app/src/features/opentelemetry/server/custom-metrics/index.ts` に `export { addYjsMetrics } from './yjs-metrics'` を追加する。
  - 同ファイルの `setupCustomMetrics()` 内の dynamic import 列と `add*Metrics()` 呼び出し列に `yjs-metrics` を 1 行ずつ追加する。
  - 既存 4 metrics の登録順序・名称・schema は変更しない。
  - `otel:enabled=false` のとき `addYjsMetrics()` も呼ばれない（既存ガード継承）ことを smoke で確認する。
  - Integration test を追加し、合成後の OTel meter から 5 metrics（既存 4 + 新規 1）が全て解決できることを検証する。
  - 観測可能な完了条件: `pnpm vitest run setupCustomMetrics` 相当の integration test が green。
  - _Depends: 2.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: YjsDocsMetric, opentelemetry custom-metrics index_

- [x] 4.3 Lint / type-check / unit & integration test / build を pass させる
  - `turbo run lint --filter @growi/app` / `turbo run test --filter @growi/app` / `turbo run build --filter @growi/app` を順に実行する。さらに `pnpm --filter @growi/bin test` も含める。
  - 失敗があれば `build-error-resolver` agent で最小差分修正を試みる。
  - 既存テストが破壊されないこと、新規テストが green であることを確認する。
  - 観測可能な完了条件: 4 コマンド全てが exit code 0。
  - _Depends: 2.1, 2.2, 2.3, 2.4, 4.1_
  - _Requirements: 3.6, 7.1, 7.3_

- [x] 4.4 (P) Default 値変更と新規 metric の CHANGESET 追加
  - `npx changeset` で `@growi/app` 用 changeset を追加し、以下を明示する: (a) `MONGO_MAX_POOL_SIZE` default = 15, `MONGO_MIN_POOL_SIZE` default = 2 へ変更、(b) OTel instrumentation set が `@opentelemetry/auto-instrumentations-node` 依存を廃止し 4 instrumentation の direct-import に固定、(c) 新規 metric `growi.yjs.docs.count` の追加、(d) 従来動作復元方法（`MONGO_MAX_POOL_SIZE`; OTel 側は env var なしで `node-sdk-configuration.ts` を編集）。
  - 観測可能な完了条件: `.changeset/*.md` 新規ファイルが PR の差分に含まれ、上記 4 点の運用者向け説明が記述されている。
  - _Depends: 2.1, 2.2, 2.3, 4.1_
  - _Requirements: 7.2, 7.4_

## 5. Validation — Dynamic profiling とレポート

- [x] 5.1 Fix なし build での baseline 計測（before スナップショット）
  - 個別 revert によって 2.1 / 2.2 / 2.3 / 2.4 / 4.1 の差分を一時的に外す。手順は `memory-profiler` の README に従う。
  - `memory-profiler` の scenario runner を 1 周回す（具体的な起動コマンド・引数は同 spec を参照）。
  - 出力された snapshot A / B / C と RSS time-series CSV を `apps/app/tmp/memory-leak-investigation/runs/before/` に隔離保存する。
  - 完了後、HEAD から fix を再適用して fix 適用状態に戻す。
  - 観測可能な完了条件: `runs/before/` 配下に snapshot 3 枚と CSV が 1 セット揃う。
  - _Depends: `memory-profiler` の scenario runner が利用可能であること_
  - _Requirements: 2.1, 2.2, 3.5_
  - _Known limitation_: dev server (ts-node + SWC) 経由のため、`dist/server/app.js` の production 計測値とは差異がある可能性。Phase 6 / Task 6.4 で dist server による再計測を実施。

- [x] 5.2 Fix 適用 build での計測（after スナップショット）
  - 2.1 / 2.2 / 2.3 / 2.4 / 4.1 を全て適用した状態（HEAD）で同じ scenario を 1 周回す。
  - 出力を `apps/app/tmp/memory-leak-investigation/runs/after/` に隔離保存する。
  - 観測可能な完了条件: `runs/after/` 配下に snapshot 3 枚と CSV が 1 セット揃う。
  - _Depends: 5.1_
  - _Requirements: 2.1, 2.4, 3.5_
  - _Known limitation_: dev server 経由（同上）。

- [x] 5.3 各 finding の verdict 判定
  - `before` / `after` の snapshot C を Chrome DevTools または `heapsnapshot-parser` で開き、retained constructor count（`Y.Doc`, `Activity`, `Comment`, mongoose `Connection`, `EventEmitter`）を比較する。
  - L1: `after` の RSS が `before` 比でどれだけ削減されたかを RSS CSV の Drain 平均で算出する。
  - L2: `after` 起動ログから patch されている instrumentation の集合と、`before` の集合を diff し、削減項目とスパン欠落の有無を確認する。
  - L3: `after` の Y.Doc 残存数と Baseline 比較。閾値を超えた残存があれば confirmed と判定し、Phase 6 sweeper 実装の根拠とする。
  - L4: page-edit event chain に紐づく retained objects（preNotify 系の closure と参照される `Activity` 文書）が `after` の Drain で残っているかを確認。
  - L5: defensive 修正は実装済として confirmed 扱い。
  - 観測可能な完了条件: 5 findings ごとに `confirmed` / `refuted` / `inconclusive` と数値根拠（snapshot 差分、retained count、RSS delta）を整理したメモが手元にある。
  - _Depends: 5.2_
  - _Requirements: 5.4, 6.1_

- [x] 5.4 `verification-report.md` の作成
  - `.kiro/specs/memory-leak-investigation/verification-report.md` を新規作成し、design.md の `VerificationReport` で要求された 5 セクション（Environment / Per-finding verdicts / RSS delta / Behavior changes / Open issues）を埋める。
  - **Environment**: GROWI commit hash（before / after それぞれ）、Node.js version、MongoDB version、Elasticsearch version、実行日時、scenario op count。
  - **Per-finding verdicts**: 5.3 のメモを基に L1-L5 ごとに verdict と evidence を記載。
  - **RSS delta**: before / after の Drain 平均 RSS を MB で示し、20–40 MB 目標との達成状況を記録。
  - **Behavior changes**: `MONGO_MAX_POOL_SIZE` / OTel allow-list / `growi.yjs.docs.count` 追加が運用者から見える振る舞いに与える影響を箇条書きする。
  - **Open issues**: refuted / inconclusive 判定の理由と再調査トリガーを記録する。
  - **Snapshot ファイルはコミットしない**: ファイル名・サイズ・SHA256 の表だけを report に含める。
  - 観測可能な完了条件: `verification-report.md` が存在し、5 sections 全てに数値・記述が入っており、L1+L2 の RSS delta が「達成 / 未達成」のいずれかと共に明示されている。
  - _Depends: 5.3_
  - _Requirements: 3.5, 5.4, 6.1, 6.2, 6.3, 6.5, 7.4_

## 6. Mandatory Re-measurement (Phase 6)

> Phase 5 の初回計測は (a) `OPENTELEMETRY_ENABLED=false` のため L2 ランタイム効果未計測、(b) Yjs sessions=5 / drain=60s と縮小しており L3 / L4 が inconclusive、(c) `dist/server/app.js` 起動下での計測が Prisma ESM 不整合により未実施、という制約がある。これらを解消するための **必須** 再計測フェーズ。

- [x] 6.1 OTel 有効化下での L2 ランタイム baseline RSS 再計測 — **完了 (2026-05-25)**
  - devcontainer の `apps/app/.env.development` で `OPENTELEMETRY_ENABLED=true` を設定して before / after の両方を再計測する。
  - OTLP receiver が devcontainer 内にない場合は `OTEL_TRACES_EXPORTER=console` または `none` で SDK init のみ実行する形にする。
  - 計測条件: `BASELINE_IDLE_SECONDS=300`、その他のシナリオ op count は default。
  - 観測可能な完了条件: `runs/before-otel-on/` と `runs/after-otel-on/` の双方が揃い、Baseline 5 分 idle 後の平均 RSS の delta が verification-report の RSS Delta セクションに数値で記録される。
  - **Result**: Baseline mean RSS delta ≈ 0 MB（observed −17 MB は DB-state drift の noise）。事前見積もり 20–40 MB は未達。Functional verdict は維持されるが RSS 削減効果はほぼゼロ。詳細は [verification-report.md](./verification-report.md#l2-otel-auto-instrumentation-allow-list-task-22) を参照。
  - _Depends: 5.4_
  - _Requirements: 3.5, 3-bis.1, 6.1_

- [x] 6.2 Yjs sustained-load + 300s drain での L3 再計測 — **完了 (2026-05-26, L3 = REFUTED)**
  - `LOAD_YJS_CLEAN_CLOSE=50`、`LOAD_YJS_ABORT=50`、`DRAIN_IDLE_SECONDS=300` で production dist server 上で計測（Task 6.3 / 6.4 と combined run）。
  - Snapshot C の `Doc` count は A / B / C 全 snapshot で 1（A→C delta = 0）。`WebSocket` も 1 のまま、`Socket` (net) は load 時 +2 → drain で baseline 復帰。
  - **判定（実データから再算定の閾値）**: A→C delta が +1 以上で confirmed / 0 で refuted。観測値 = 0 → **REFUTED**。Phase 7 / Task 7.1 は起動しない。詳細は [verification-report.md / L3](./verification-report.md#l3--growiyjsdocscount-metric-task-23--41) を参照。
  - _Depends: 5.4_
  - _Requirements: 5.1, 5.4, 6.1_

- [x] 6.3 拡張シナリオでの L4 retainer 分析 — **完了 (2026-05-26, L4 = REFUTED)**
  - `LOAD_PAGE_EDIT=20`、`DRAIN_IDLE_SECONDS=300` で production dist server 上で 1 周回した（Task 6.2 / 6.4 と combined run）。
  - Snapshot 解析は `apps/app/tmp/memory-leak-investigation/scripts/count-constructors.mjs`（v8 heap snapshot を JSON で走査し、object-type の constructor 名を集計）で実施。Chrome DevTools の Retainer ビュー目視解析は将来 follow-up。
  - **判定（実データから再算定の閾値）**: snapshot C に `Activity` / `InAppNotification` / `Comment` instance が 1 個以上残存で confirmed / 0 で refuted。観測値 = 全て 0 → **REFUTED**。Phase 7 / Task 7.2 は起動しない。詳細は [verification-report.md / L4](./verification-report.md#l4--page-edit-event-chain-closure-retention-task-24) を参照。
  - _Depends: 5.4_
  - _Requirements: 5.2, 5.4, 6.1_

- [x] 6.4 Production dist server (Node.js v24) の Prisma ESM 不整合を解消 — **完了 (2026-05-26)**
  - **解消経緯**: `src/generated/prisma/client.ts`（HEAD）は既に commit `70281306d7` の `moduleFormat = "cjs"` 設定で `__dirname` を直接使用しており、`import.meta.url` 不在。`dist/generated/prisma/client.js` が古い世代のまま残っていたのが blocker だった。Phase 6 着手時の `turbo run build --filter @growi/app` リビルドで `dist/` が再生成され、`import.meta.url` 行が消失して `ReferenceError: exports is not defined in ES module scope` は自然解消。
  - **計測**: `node --inspect dist/server/app.js` を起動し、scenario runner を 1 周完走（Task 6.2 / 6.3 と combined run）。出力先: `apps/app/tmp/memory-leak-investigation/runs/after-dist-phase6/`（snapshot 3 枚 + rss-timeseries.csv）。
  - verification-report に dist server 経由の数値（baseline 234 MB / drain 600 MB / +366 MB retained growth）を追記済み。
  - _Depends: 5.4_
  - _Requirements: 2.3, 6.1_

- [x] 6.5 verification-report.md の Phase 6 update — **完了 (2026-05-26)**
  - Task 6.1–6.4 の結果を統合し、verification-report の Section 1（Environment）/ Section 2（L3, L4）/ Section 3.3（RSS Delta）/ Section 5（Open Issues）/ Section 6（Snapshot Inventory）/ Section 7（Phase 6 status）を更新。
  - L3 / L4 ともに **REFUTED** と最終確定。Phase 7（条件付き follow-up）は起動条件を満たさず、本 spec の implementation は closed とする。
  - _Depends: 6.1, 6.2, 6.3, 6.4_
  - _Requirements: 5.4, 6.1, 6.2, 6.3_

## 7. Conditional follow-ups — **未着手 (Phase 6 の verdict により起動条件未充足、closed-as-not-needed)**

> Phase 6 / Task 6.2 で L3 = REFUTED、Task 6.3 で L4 = REFUTED と確定したため、本 phase の全タスクは起動条件を満たさない。実装不要として本 spec ではクローズする。将来 production 環境で対応する leak symptom が再発した場合は別 spec で個別に再評価する。

- [ ] ~~7.1 L3 sweeper（`YjsIdleSweeper`）の実装~~ — **不要 (Task 6.2 で L3 = REFUTED)**

- [ ] ~~7.2 L4 backpressure（`HandlerBackpressure`）の実装~~ — **不要 (Task 6.3 で L4 = REFUTED)**

- [ ] ~~7.3 7.1 / 7.2 を実装した場合の verification report 追記~~ — **不要 (7.1 / 7.2 が起動しない)**
