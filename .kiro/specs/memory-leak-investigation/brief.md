# Brief: memory-leak-investigation

## Problem
GROWI.cloud では各テナント専用に `apps/app` コンテナを 1 つずつ起動しており、低トラフィックでも RSS ベースラインが ~200MB 程度に達する。ノードプール密度の向上のためには「実装上、本当に必要なメモリ」と「不要なベースライン bloat」「実運用で蓄積しうるリーク面」を分離して計測・是正する必要がある。`claude/investigate-growi-memory-leaks-09kl4` ブランチで静的解析レポート（[research.md](./research.md)）まで作成されたが、サンドボックスの outbound network 制限により MongoDB 4.2+ 系の dynamic profiling が実行できないまま中断された。

## Current State
- 静的解析の成果物: [.kiro/specs/memory-leak-investigation/research.md](./research.md)（`support/memory-leak-investigation` ブランチに移植済）。
  - **L1**: `mongoOptions` で `maxPoolSize` 未指定 → Mongoose driver default `100` connections（[apps/app/src/server/util/mongoose-utils.ts:52](../../apps/app/src/server/util/mongoose-utils.ts#L52)）。
  - **L2**: `getNodeAutoInstrumentations()` の 30+ instrumentation がデフォルト ON（[apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts:52](../../apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts#L52)）。
  - **L3**: `y-websocket` `docs` Map が leaked WebSocket session の Y.Doc を保持しうる（[apps/app/src/server/service/yjs/yjs.ts:7](../../apps/app/src/server/service/yjs/yjs.ts#L7)）。
  - **L4**: page-edit event fan-out で `Activity → InAppNotification → search` チェーンの async closure が長時間滞留しうる。
  - **L5**: `PageOperationService.autoUpdateExpiryDate` の `setInterval` callback に try/catch が無く、例外が silently swallowed。
- 本セッションは devcontainer 環境で動作しており、`mongo:27017` (replica set `rs0`) と `elasticsearch:9200` は常時到達可能（参照: [.claude/rules/devcontainer.md](../../.claude/rules/devcontainer.md)）。
- 本番 build 成果物 (`apps/app/dist/server/app.js`, `apps/app/.next/`) は既存（前回セッションでビルド済）。
- 関連 spec: `opentelemetry` (`phase: implementation-complete`) は system metrics に `process.memory.usage` / `process.runtime.v8.heap.*` を既に emit している（[apps/app/src/features/opentelemetry/server/custom-metrics/system-metrics.ts](../../apps/app/src/features/opentelemetry/server/custom-metrics/system-metrics.ts)）。本 spec で追加するメトリクスは同レイヤに新規モジュールとして配置する。

## Desired Outcome
- 静的解析の各 finding (L1-L5) について、**dynamic profiling による裏付け**（または棄却）を伴った検証レポートが残っている。
- ベースライン bloat の修正（L1 + L2）が実装され、RSS が **20–40 MB 程度** 削減されたことが before/after で計測されている。
- リーク面（L3）について、`yjs.docs.count` 等のランタイム監視メトリクスが OpenTelemetry custom-metrics として常時 emit され、本番環境で蓄積を観測可能になっている。
- 観測した結果に応じて、L4 のバックプレッシャ対策、L3 の sweeper、L5 の defensive try/catch を **必要性が示されたものだけ** 実装する。
- 本 spec 完了時点で `research.md` + 新規 `verification-report.md` の 2 文書が成果物として残る。再利用可能な profiling ツール本体は `memory-profiler` spec が所有・メンテする。

## Approach
**Static finding → Dynamic verification → Targeted fix → Re-measure** の 4 フェーズ構成。各フェーズの成果物を文書化する。

1. **Phase 1: Dynamic profiling 基盤の構築**
   - 起動: `node --inspect=0.0.0.0:9229 dist/server/app.js`（devcontainer 内）。`MONGO_URI=mongodb://mongo:27017/growi?replicaSet=rs0` を使用。
   - Snapshot 取得 / Load driver / 出力先構造: いずれも `memory-profiler` spec（`bin/memory-profiling/`、`@growi/bin` workspace）が提供するツールに委譲する。CLI 引数・env var・出力ファイル命名規約は `bin/memory-profiling/README.md` の Stable Contract セクション参照。本 spec は同ツールを **利用するのみ**（ツール本体の責務は持たない）。
   - 出力先: `--outputDir tmp/memory-leak-investigation/runs/{run-name}/`。run ディレクトリ配下に `snapshot-a.heapsnapshot` / `snapshot-b.heapsnapshot` / `snapshot-c.heapsnapshot` / `rss-timeseries.csv` が作成される。`tmp/` は .gitignore 済。
2. **Phase 2: 検証シナリオの実行と diff 分析**
   - **Baseline**: server boot 後 5 分 idle → snapshot A、`process.memoryUsage()` RSS 記録。
   - **Load**: 200 page-create + 200 page-edit + 50 yjs session の open-and-explicit-close + 50 yjs session の **abort-without-close**（NAT half-close 模擬: TCP RST）→ snapshot B。
   - **Drain**: 5 分 idle → snapshot C。
   - 分析: snapshot A vs C を retained-constructor counts で diff（`Y.Doc`, `Activity`, `Comment`, `mongoose Connection`, `EventEmitter` listeners）。`heapsnapshot-parser` か Chrome DevTools UI で確認。
3. **Phase 3: Confirmed finding に対する fix の実装**
   - **L1** (確定): `mongoOptions` に `maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE ?? 15)` / `minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE ?? 2)` を追加。
   - **L2** (確定): `getNodeAutoInstrumentations()` を明示的な instrumentation allow-list へ置き換え（`http`, `express`, `mongodb`, `mongoose` のみ enable）。
   - **L3**:
     - `apps/app/src/features/opentelemetry/server/custom-metrics/` に `yjs-metrics.ts` を追加し、`docs.size` を `yjs.docs.count` Observable Gauge として emit。
     - Snapshot C で Y.Doc 残存が確認できた場合のみ、idle-timeout sweeper を実装。
   - **L4**: Phase 2 で event chain の retained size が問題量に達した場合のみ、emitter ごとの concurrent in-flight handler に上限を導入。
   - **L5**: `setInterval` callback を try/catch でラップし `logger.error` で出力。
4. **Phase 4: Re-measurement と report**
   - L1+L2 を適用したビルドで Phase 2 を再実行し、RSS delta と heap delta を計測。
   - `.kiro/specs/memory-leak-investigation/verification-report.md` を作成し、static finding ごとに「confirmed / refuted / inconclusive」と数値根拠を残す。

## Scope
- **In**:
  - 上記 4 フェーズ全体（profiling 基盤・シナリオ実行・fix 実装・再計測）。
  - 5 findings (L1-L5) の検証と、Phase 2 で確認できたものに対する fix。
  - `yjs.docs.count` を `opentelemetry/custom-metrics/yjs-metrics.ts` として追加する（既存 `opentelemetry` spec の custom-metric レイヤ責務に沿う）。
  - Profiling 手順の再利用可能化に最低限必要なスクリプト・ドキュメント。
  - `verification-report.md` の作成。
- **Out**:
  - ブラウザ／クライアント側のメモリ分析（Next.js client bundle のヒープ等）。
  - OpenTelemetry SDK ライフサイクル設計の再構築（`opentelemetry` spec の責務）。
  - `BatchSpanProcessor` / `PeriodicExportingMetricReader` のパラメータ全面チューニング（L2 で必要な範囲を超える変更）。
  - 既存 `growi.*` メトリクスの名称変更や schema 変更。
  - 永続化レイヤ（MongoDB / Elasticsearch）側のメモリ最適化。
  - **Profiling ツール本体（`bin/memory-profiling/` / `@growi/bin`）の実装・設計・interface** — `memory-profiler` spec の責務。本 spec は同ツールを **利用するのみ**。
  - 一般化された profiling フレームワーク（`@growi/profiling` のような汎用 npm package 化）。

## Boundary Candidates
1. **Baseline-bloat fixes (L1 + L2)** — `mongoose-utils.ts` の pool size 設定と `node-sdk-configuration.ts` の instrumentation allow-list 化。両方とも 1 ファイル局所の修正で、互いに独立。
2. **Leak-surface instrumentation (L3 metric)** — `features/opentelemetry/server/custom-metrics/yjs-metrics.ts` の新規モジュール（`setupCustomMetrics()` に組み込む）。
3. **Leak mitigation (L3 sweeper + L4 backpressure + L5 try/catch)** — Phase 6 の dynamic 結果が問題量を示した場合のみ実装する条件付き作業。
4. **Verification report** — `research.md` の各 finding に対する裏付け結果と数値根拠を `verification-report.md` にまとめる。
5. **Profiling tool 利用** — `memory-profiler` spec が提供するツールを使った計測セッションの実行。ツール本体の責務は持たず、env var / op count 設定など consumer-side の判断のみを所有。

## Out of Boundary
- `features/opentelemetry/` の SDK ライフサイクルや既存 Resource Attribute / Metric schema の変更 → `opentelemetry` spec の責務。本 spec は `custom-metrics/` に **追加** のみを行う。
- `@growi/core`, `@growi/logger` の API 変更 → 各 package spec の責務。
- `mongoose` / `y-websocket` / `@opentelemetry/auto-instrumentations-node` 等のサードパーティパッケージ自体への patch / fork。
- `apps/app/src/server/service/yjs/create-mongodb-persistence.ts` の persistence プロトコル設計変更（`collaborative-editor` spec の責務）。L3 では metric 追加と sweeper のみ扱う。
- 本番環境（GROWI.cloud）での RSS / メトリクス監視ダッシュボード設定 → 下流の運用領域。

## Upstream / Downstream
- **Upstream**:
  - 既存 build 成果物 `apps/app/dist/server/app.js`（dynamic profiling の対象）。再ビルドが必要な場合は `pnpm run build` を再実行。
  - `opentelemetry` spec の custom-metrics 合成基盤（`setupCustomMetrics()`）。`yjs-metrics.ts` をここに登録する。
  - devcontainer サービス `mongo:27017` (replica set `rs0`) と `elasticsearch:9200`。
- **Downstream**:
  - 将来の memory-leak 調査や capacity planning。本 spec の `verification-report.md` を結果テンプレートとして再利用でき、`memory-profiler` spec のツールで再現実行できる。
  - GROWI.cloud の node-pool sizing。L1+L2 で RSS が 20–40 MB 程度下がれば、テナントあたりの packing 密度を再計算可能。
  - 受信側 OTel ダッシュボード。`yjs.docs.count` をパネルに追加することで本番のリーク兆候を検出可能になる。

## Existing Spec Touchpoints
- **Adjacent**: `opentelemetry` (`phase: implementation-complete`)。本 spec は `features/opentelemetry/server/custom-metrics/` に新規モジュール `yjs-metrics.ts` を追加する。`opentelemetry` spec の Boundary は「新規メトリクスの追加自体」は in-boundary と扱っており（`setupCustomMetrics()` の合成は同 spec の責務）、metric 命名・unit 規約に従う必要がある。
- **Adjacent**: `collaborative-editor`。`y-websocket` の `docs` Map と `create-mongodb-persistence.ts` の挙動に関わる L3 sweeper を実装する場合、`collaborative-editor` の責務と衝突しないか design phase で要確認。本 spec では metric 追加のみは独立に進められる。
- **Touched but not extended**: `growi-logger`。L5 で `setInterval` の defensive logging を追加する際は既存 logger を consume するのみ。

## Constraints
- **環境制約**: 検証は devcontainer 内の `mongo:27017` (replica set `rs0`) を使用する。本番 mongo / staging mongo へのアクセスは不要。
- **観測専用**: dynamic profiling は read-only な観測活動。production には影響を与えない。本 spec で実装する fix は production 影響があるが、すべて環境変数で disable 可能な形にする（例: `MONGO_MAX_POOL_SIZE`）。
- **新規 npm dependency の追加は最小限**。本 spec の対象範囲（apps/app への server-side fix）では Production runtime に dependency 追加しない。Profiling ツール側の dependency は `memory-profiler` spec が管理する。
- **Cross-platform**: 検証は devcontainer (Linux) 前提でよい。Windows / macOS native での実行は scope 外。
- **記録の永続化**: `.heapsnapshot` は数十 MB〜数百 MB になりうるため、`tmp/memory-leak-investigation/` 配下に置き、リポジトリには `verification-report.md` のサマリ数値のみコミットする。
- **Node.js version**: `^24` 系（既存 runtime と同一）。`--inspect` / `v8.writeHeapSnapshot` / CDP は標準機能。
