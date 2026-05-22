# Implementation Plan

> 本 spec は **Foundation → Core → Integration → Validation (Phase 5) → Mandatory Re-measurement (Phase 6) → Conditional Follow-ups (Phase 7)** で進める。Core フェーズの sub-task は責務境界が分離しており、(P) マーク付きの並列実行が可能。
>
> **条件付きコンポーネント**（YjsIdleSweeper / HandlerBackpressure）は Phase 6 の re-measurement 結果が confirmed の場合のみ Phase 7 で着手する。
>
> **Scope change history**: Task 1.2（SIGUSR2 in-process fallback）は実装中に CDP-only 方針に切り替えたため削除した（commit `b8e3efa4c7`）。Task 1.1 で作成した `apps/app/tools/memory-profiling/` は `bin/memory-profiling/`（`@growi/bin` workspace package）に移動した（commit `b8e3efa4c7` / `359a74b405`）。各 task の文言は **現在の実装に揃えて更新済**。

## 1. Foundation

- [x] 1.1 Profiling 出力ディレクトリと workspace package の整備
  - `apps/app/tmp/memory-leak-investigation/` 配下に `runs/` ディレクトリを生成し、`apps/app/.gitignore` の `/tmp/` ルールで除外されていることを確認する。
  - `bin/memory-profiling/` ディレクトリを作成し、`pnpm-workspace.yaml` に `bin` を追加して `@growi/bin` workspace package として登録する。
  - `bin/memory-profiling/README.md` に「起動手順 / 出力先 / heap snapshot を git にコミットしない方針」の見出しを用意する。
  - 観測可能な完了条件: `bin/memory-profiling/README.md` が存在し、`apps/app/tmp/memory-leak-investigation/` が `apps/app/.gitignore` の `/tmp/` ルールで除外され、`@growi/bin` が `pnpm-workspace.yaml` に登録されている。
  - _Requirements: 1.3, 6.4, 6.5_
  - _Scope change_: 初期 spec では `apps/app/tools/memory-profiling/` を作成する予定だったが、実装中に `bin/memory-profiling/`（@growi/bin workspace）に移行した。

> **Task 1.2（旧: Heap snapshot signal handler）は scope change により削除**
> 初期 spec では `apps/app/src/server/util/heap-snapshot-handler.ts` で SIGUSR2 経由の in-process fallback を作る予定だったが、CDP (Chrome DevTools Protocol) クライアント（Task 3.1）が信頼できる主経路として確立したため削除した（commit `b8e3efa4c7`）。Requirements の旧 Req 1.3（SIGUSR2 fallback）も同時に削除済み。

## 2. Core — Server-side fixes (parallel-capable; 異なるファイルへの独立変更)

- [x] 2.1 (P) L1: Mongoose connection pool の上限・下限を環境変数化
  - `mongoOptions` に `maxPoolSize` と `minPoolSize` を追加し、それぞれ `MONGO_MAX_POOL_SIZE`（default 15）と `MONGO_MIN_POOL_SIZE`（default 2）から読む。
  - `Number.isFinite` チェックで NaN は default にフォールバックする。
  - pool 周辺の他オプション（`useUnifiedTopology` 等）は変更しない。
  - Unit test を追加し、未指定 / 正常値 / NaN / `min > max` 異常入力時の挙動を検証する。
  - 観測可能な完了条件: `MONGO_MAX_POOL_SIZE=3` で server を起動した時、mongoose connection の `topology.s.options.maxPoolSize` が 3 を反映している。
  - _Requirements: 3.1, 3.2, 3.4, 3.6, 7.1, 7.2_
  - _Boundary: MongoosePoolConfig_

- [x] 2.2 (P) L2: OpenTelemetry auto-instrumentation を allow-list 方式へ置換
  - `getNodeAutoInstrumentations(...)` の引数を、明示的 allow-list（`@opentelemetry/instrumentation-http`, `instrumentation-express`, `instrumentation-mongodb`, `instrumentation-mongoose`）以外を `enabled: false` にする形に置き換える。
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE=all` のとき従来挙動（pino / fs のみ off）に戻す分岐を実装する。
  - 不明な profile 値は warn ログを残し `minimal` 扱いとする。
  - 既存の HTTP anonymization 設定 (`httpInstrumentationConfigForAnonymize`) との合成は維持する。
  - Unit test で、`minimal` / `all` / 不明値の各分岐が期待される instrumentation 設定オブジェクトを返すことを検証する。
  - 観測可能な完了条件: 現状の起動ログに現れる instrumentation patch ログから、`minimal` 設定では allow-list 由来の 4 種以外の patch 行が消失している。
  - _Requirements: 3.3, 3.4, 3.6, 4.5, 7.1, 7.2_
  - _Boundary: OtelInstrumentationAllowList_

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

## 3. Core — Profiling sidecar (parallel-capable; 独立ファイル群)

- [x] 3.1 (P) CDP snapshot client の実装
  - `bin/memory-profiling/cdp-snapshot-client.ts` を作成し、inspector endpoint (`http://127.0.0.1:9229/json/list`) から `webSocketDebuggerUrl` を取得して WebSocket 接続する API を提供する。
  - `HeapProfiler.takeHeapSnapshot` を発行し、chunked snapshot bytes を結合して `.heapsnapshot` ファイルとして指定パスへ書き出す。
  - 接続失敗時は exponential backoff で最大 5 回 retry し、それでも駄目なら例外で fail する。
  - Snapshot 取得失敗時もコネクションは確実に close する（要件 1.5）。
  - 観測可能な完了条件: scenario runner から `cdpClient.takeSnapshot('/tmp/.../baseline-a.heapsnapshot')` を呼ぶと当該パスに 1 MB 以上のバイナリファイルが生成される（devcontainer での単体動作確認）。
  - _Requirements: 1.1, 1.2, 1.5_
  - _Boundary: CdpSnapshotClient_

- [x] 3.2 (P) Load driver と HTTP / YJS lib の実装
  - `bin/memory-profiling/lib/installer-driver.ts` で `/api/v3/installer/` への自動 admin 作成（既存 endpoint の request payload を再利用）。
  - `bin/memory-profiling/lib/http-client.ts` で `undici` ベースの cookie-aware HTTP client を提供。
  - `bin/memory-profiling/lib/yjs-client.ts` で `ws` + minimal `Y.Doc` の y-websocket クライアント（open / clean close / abort via `socket.destroy()`）を提供。
  - `bin/memory-profiling/load-driver.ts` で上記 lib を合成した `LoadDriver` interface（`pageCreate`, `pageEdit`, `pageGet`, `pageList`, `pageSearch`, `yjsSessionCleanClose`, `yjsSessionAbort`）を実装する。
  - `pageSearch` は GROWI の Elasticsearch search endpoint を叩く（固定の query 文字列パターンを使い、再現可能性を担保）。`pageGet` / `pageList` は markdown render / page tree walk を経由する代表 endpoint を呼ぶ。
  - 観測可能な完了条件: `pnpm --filter @growi/bin test` で load-driver の unit test が green。実機 smoke は Task 4.2 の scenario runner 経由でカバーする。
  - _Requirements: 2.2, 7.1_
  - _Boundary: LoadDriver_

- [x] 3.3 (P) RSS time-series logger の実装
  - `bin/memory-profiling/rss-time-series-logger.ts` を作成し、CDP の `Runtime.evaluate` で `process.memoryUsage()` を 1 秒間隔で取得する。
  - 取得値（`rss`, `heapUsed`, `heapTotal`, `external`）を CSV 形式（schema: `timestamp,phase,rss,heap_used,heap_total,external`）で `apps/app/tmp/memory-leak-investigation/<runDir>/rss-timeseries.csv` に追記する。
  - Phase ラベル（`baseline` / `load` / `drain`）は scenario runner から `mark(phase)` で切り替えられる。
  - 既存 CSV があれば `rss-timeseries.{ISO8601}.csv` へ archive してから新規作成する。
  - 観測可能な完了条件: 30 秒程度動かしたとき CSV が 30 行程度作成され、`phase` 列が想定通り切り替わる。
  - _Requirements: 2.3_
  - _Boundary: RssTimeSeriesLogger_

- [x] 3.4 (P) シナリオモジュールの実装
  - `bin/memory-profiling/scenarios/baseline.ts` を作成し、5 分（env var で override 可）の idle phase を実行する。
  - `bin/memory-profiling/scenarios/load.ts` を作成し、page create / page edit / page get / page list / page search / yjs clean close / yjs abort の各 op 回数を const として定義し、それらを混在実行する。read / search 系は L2 (OTel allow-list) による検索パスの非破壊性を実測する目的を持つ（Req 7.1）。
  - 初期値は再現可能性とランタイム見積もりのバランスを取って次を採用する: `pageCreate=20`, `pageEdit=20`, `pageGet=50`, `pageList=10`, `pageSearch=30`, `yjsSessionsCleanClose=10`, `yjsSessionsAbort=10`。env var / CLI で override 可能。
  - `bin/memory-profiling/scenarios/drain.ts` を作成し、Load 後の 5 分 idle phase を実行する。
  - 各 op 回数は scenario module から named export し、再現可能性のため source of truth とする。
  - LoadDriver の interface は design.md の `Service Interface` 定義を型として受け取り、実装本体への依存は持たない（実際の wire-up は 4.2 の scenario runner が行う）。
  - 観測可能な完了条件: 3 モジュールが LoadDriver interface を受ける関数として実装され、`pnpm vitest run scenarios` の fake-LoadDriver を渡す unit test が green。fake-LoadDriver に対し search / get / list が想定回数呼ばれたことが assertion される。
  - _Requirements: 2.1, 2.2, 2.5, 7.1_
  - _Boundary: scenarios baseline load drain_

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

- [x] 4.2 (P) Scenario runner と sidecar エントリポイントの統合
  - `bin/memory-profiling/run-scenario.ts` を作成し、CLI 引数 / env var を解釈して `runScenario(opts)` を呼ぶ。
  - `runScenario` 内で `cdp-snapshot-client` を接続 → `rss-time-series-logger` start → `scenarios/baseline` → snapshot A → `scenarios/load` → snapshot B → `scenarios/drain` → snapshot C → CSV finalize → close の順序で orchestrate する。
  - 失敗時の exit code は 0 / 1 / 2（成功 / snapshot 取得失敗 / 接続失敗）で区別する。
  - 観測可能な完了条件: `pnpm run ts-node bin/memory-profiling/run-scenario.ts --baseUrl http://localhost:3000 --inspector http://127.0.0.1:9229 --outputDir apps/app/tmp/memory-leak-investigation/runs/after` を実行すると `apps/app/tmp/memory-leak-investigation/runs/after/` に snapshot A/B/C と rss-timeseries.csv が生成され stdout に summary が出力される。
  - _Depends: 3.1, 3.2, 3.3, 3.4_
  - _Requirements: 1.4, 2.1, 2.4, 2.5_
  - _Boundary: ScenarioRunner_

- [x] 4.3 Lint / type-check / unit & integration test / build を pass させる
  - `turbo run lint --filter @growi/app` / `turbo run test --filter @growi/app` / `turbo run build --filter @growi/app` を順に実行する。さらに `pnpm --filter @growi/bin test` も含める。
  - 失敗があれば `build-error-resolver` agent で最小差分修正を試みる。
  - 既存テストが破壊されないこと、新規テストが green であることを確認する。
  - 観測可能な完了条件: 4 コマンド全てが exit code 0。
  - _Depends: 2.1, 2.2, 2.3, 2.4, 4.1_
  - _Requirements: 3.6, 7.1, 7.3_

- [x] 4.4 (P) Default 値変更と新規 metric の CHANGESET 追加
  - `npx changeset` で `@growi/app` 用 changeset を追加し、以下を明示する: (a) `MONGO_MAX_POOL_SIZE` default = 15, `MONGO_MIN_POOL_SIZE` default = 2 へ変更、(b) OTel auto-instrumentation default が allow-list 方式へ変更、(c) 新規 metric `growi.yjs.docs.count` の追加、(d) 従来動作復元の env var 一覧（`MONGO_MAX_POOL_SIZE`, `OTEL_AUTO_INSTRUMENTATION_PROFILE=all`）。
  - 観測可能な完了条件: `.changeset/*.md` 新規ファイルが PR の差分に含まれ、上記 4 点の運用者向け説明が記述されている。
  - _Depends: 2.1, 2.2, 2.3, 4.1_
  - _Requirements: 7.2, 7.4_

## 5. Validation — Dynamic profiling とレポート

- [x] 5.1 Fix なし build での baseline 計測（before スナップショット）
  - 個別 revert によって 2.1 / 2.2 / 2.3 / 2.4 / 4.1 の差分を一時的に外す。**実行手順を `bin/memory-profiling/README.md` に明記**し、再現性を担保する。
  - 起動方法: devcontainer で `pnpm run ts-node --inspect=0.0.0.0:9229 src/server/app.ts`（dist が Prisma ESM 不整合のため dev server を使用、詳細は Phase 6 / Task 6.4）。
  - `pnpm run ts-node bin/memory-profiling/run-scenario.ts` を 1 周回す。
  - 出力された snapshot A / B / C と RSS time-series CSV を `apps/app/tmp/memory-leak-investigation/runs/before/` に隔離保存する。
  - 完了後、HEAD から fix を再適用して fix 適用状態に戻す。
  - 観測可能な完了条件: `runs/before/` 配下に snapshot 3 枚と CSV が 1 セット揃う。手順が README に書かれている。
  - _Depends: 1.1, 4.2_
  - _Requirements: 2.1, 2.4, 3.5_
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

- [ ] 6.1 OTel 有効化下での L2 ランタイム baseline RSS 再計測
  - devcontainer の `apps/app/.env.development` で `OPENTELEMETRY_ENABLED=true` を設定して before / after の両方を再計測する。
  - OTLP receiver が devcontainer 内にない場合は `OTEL_TRACES_EXPORTER=console` または `none` で SDK init のみ実行する形にする。
  - 計測条件: `BASELINE_IDLE_SECONDS=300`、その他のシナリオ op count は default。
  - 観測可能な完了条件: `runs/before-otel-on/` と `runs/after-otel-on/` の双方が揃い、Baseline 5 分 idle 後の平均 RSS の delta が verification-report の RSS Delta セクションに数値で記録される。
  - _Depends: 5.4_
  - _Requirements: 3.5, 3-bis.1, 6.1_

- [ ] 6.2 Yjs sustained-load + 300s drain での L3 再計測
  - `LOAD_YJS_CLEAN_CLOSE=50`、`LOAD_YJS_ABORT=50`、`DRAIN_IDLE_SECONDS=300` で計測する。
  - Snapshot C の `Y.Doc` 残存数を Chrome DevTools または `heapsnapshot-parser` で確認する。
  - 観測可能な完了条件: `Y.Doc` の retained 数が baseline 比で +5 を超えた場合は L3 を `confirmed` に更新し Phase 7 / Task 7.1 を起動する。+5 以下なら `refuted` として verification-report を更新する。
  - _Depends: 5.4_
  - _Requirements: 5.1, 5.4, 6.1_

- [ ] 6.3 拡張シナリオでの L4 retainer 分析
  - `LOAD_PAGE_EDIT=20` 以上、`DRAIN_IDLE_SECONDS=300` で 1 周回す。
  - Snapshot C を Chrome DevTools の Memory タブで開き、Retainers ビューで `Activity` および page-edit event chain の closure を辿る。
  - 観測可能な完了条件: retainer chain に運用上問題となる量の closure が確認された場合は L4 を `confirmed` に更新し Phase 7 / Task 7.2 を起動する。閾値以下なら `refuted` として verification-report を更新する。
  - _Depends: 5.4_
  - _Requirements: 5.2, 5.4, 6.1_

- [ ] 6.4 Production dist server (Node.js v24) の Prisma ESM 不整合を解消
  - `dist/generated/prisma/client.js` が `import.meta.url`（ESM）と `exports`（CJS）を併用しているため、Node.js v24 strict ESM 下で `ReferenceError: exports is not defined in ES module scope` で起動失敗している。Prisma client 生成設定または bundle 設定で解消する。
  - 解消後、`node --inspect dist/server/app.js` を起動し Phase 6 シナリオを 1 周回す（profiling は CDP 経由のみで完結するため `MEMORY_PROFILING_ENABLED` 等の追加 env var は不要）。
  - 観測可能な完了条件: `runs/after-dist/` に snapshot 3 枚と CSV が揃い、verification-report に dist server 経由の数値が追記される。
  - _Depends: 5.4_
  - _Requirements: 2.6, 6.1_

- [ ] 6.5 verification-report.md の Phase 6 update
  - Task 6.1–6.4 の結果を統合し、verification-report の各セクション（Environment / Per-finding verdicts / RSS Delta / Open Issues）を更新する。
  - L3 / L4 の verdict が `confirmed` / `refuted` のいずれに確定したかを明示し、Phase 7 への移行可否を判定する。
  - 観測可能な完了条件: report の Per-finding verdicts セクションが Phase 6 結果で更新され、L3 / L4 の最終 verdict が `confirmed` または `refuted` として確定している。
  - _Depends: 6.1, 6.2, 6.3, 6.4_
  - _Requirements: 5.4, 6.1, 6.2, 6.3_

## 7. Conditional follow-ups（Phase 6 の verdict に応じて発動）

- [ ] 7.1 L3 sweeper（`YjsIdleSweeper`）の実装 — **Task 6.2 で L3 = confirmed のときのみ着手**
  - Idle 判定閾値（最後の awareness update から N 分）と sweep 間隔を env var 化して導入する。
  - 既存の `closeConn` 経由のみで close を発火し、`collaborative-editor` spec の session 寿命ポリシーと整合させる。
  - Unit test と integration test を追加し、idle session が閾値経過後に close されること、active session は影響を受けないことを検証する。
  - 観測可能な完了条件: integration test で 1 active + 1 idle セッションを作り、閾値経過後に idle 側のみ `docs.size` から消える。
  - _Depends: 6.2_
  - _Requirements: 5.1, 5.5_
  - _Boundary: YjsIdleSweeper_

- [ ] 7.2 L4 backpressure（`HandlerBackpressure`）の実装 — **Task 6.3 で L4 = confirmed のときのみ着手**
  - `Activity → InAppNotification`、`pageEvent → search` の各経路に concurrency limit を導入する。
  - Limit 値は env var 化する。閾値超過時は queueing して順次処理する（drop しない）。
  - Unit test で limit 超過時の挙動を fake timer で検証する。
  - 観測可能な完了条件: 同時 200 件 page-edit を発火し、limit=10 で最大 10 件のみが in-flight に存在することを確認するテストが green。
  - _Depends: 6.3_
  - _Requirements: 5.2_
  - _Boundary: HandlerBackpressure_

- [ ] 7.3 7.1 / 7.2 を実装した場合の verification report 追記
  - sweeper / backpressure 実装後に Phase 5 / Phase 6 と同じ scenario を再実行し、`runs/after-mitigations/` を作成。
  - `verification-report.md` の Per-finding verdicts セクションを update し、`confirmed → mitigated` の遷移と数値根拠を追記する。
  - 観測可能な完了条件: report の L3 / L4 セクションに「mitigated」ステータスと再計測値が含まれる。
  - _Depends: 7.1, 7.2_
  - _Requirements: 5.1, 5.2, 6.1_
