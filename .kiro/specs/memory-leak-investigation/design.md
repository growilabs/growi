# Design Document

## Overview

本 spec は、`apps/app` (GROWI server, Node.js) のメモリ特性を **dynamic profiling で実測** し、静的解析レポート [research.md (Part 1)](./research.md) の 5 findings (L1-L5) を裏付け／棄却する。確認できた問題に対してのみ修正を入れ、リーク面には常時可観測な metric を追加する。

**Purpose**: GROWI.cloud のテナント専用 `apps/app` コンテナの baseline RSS を、機能を損なわずに 20–40 MB 程度削減する。並行して、`y-websocket` の collaborative document 数を常時観測可能にし、production でのリーク兆候を OTel ダッシュボードから検知できるようにする。

**Users**:
- メモリ調査担当者 — `bin/memory-profiling/`（`@growi/bin` workspace）のスクリプト群を使って Baseline / Load / Drain シナリオを実行し、`.heapsnapshot` を取得・diff する。
- GROWI.cloud 運用担当者 — 環境変数で `MONGO_MAX_POOL_SIZE` / `MONGO_MIN_POOL_SIZE` / OTel auto-instrumentation profile を制御し、必要時に従来動作へ切り戻す。
- 将来の調査担当者 — `verification-report.md` と profiling 手順を再利用して、別環境・別バージョンで同等の調査を再実施する。

**Impact**: `apps/app` の server コードを 3 ファイル局所修正 + 1 新規 custom-metrics module（合計 4 server-side fix surface）。`bin/memory-profiling/` ディレクトリを新規作成し、独立 workspace package `@growi/bin` として profiling sidecar を集約。Default 値の変更（pool size、auto-instrumentation 範囲）は release notes / CHANGELOG で明示する。

> **Scope change note**: 初期 design では `apps/app/src/server/util/heap-snapshot-handler.ts`（SIGUSR2 in-process fallback）を新規追加する予定だったが、実装過程で CDP (Chrome DevTools Protocol) クライアントが信頼できる主経路として確立したため SIGUSR2 経路は削除した（commit `b8e3efa4c7`）。同時に profiling sidecar を `apps/app/tools/memory-profiling/` から `bin/memory-profiling/` に移し、`apps/app` への結合を物理的に切り離した。

### Goals
- 5 findings (L1-L5) ごとに **confirmed / refuted / inconclusive** 判定を数値根拠付きで残す。
- L1 + L2 適用後の baseline RSS を Drain 後計測で **20–40 MB 削減** を達成する。
- `growi.yjs.docs.count` metric を OTLP に常時 emit し、receiver 側ダッシュボードで閲覧可能にする。
- `bin/memory-profiling/`（`@growi/bin` workspace）配下に再利用可能な profiling スクリプトとシナリオを残す。
- 全ての変更を環境変数で従来動作へ切り戻し可能とする（再ビルド不要）。

### Non-Goals
- 既存 `growi.*` / `system.*` / `process.*` metrics の名称・schema 変更。
- OpenTelemetry SDK ライフサイクルや `BatchSpanProcessor` の全面設計変更。
- `y-websocket` persistence プロトコルや `WSSharedDoc` 構造の変更。
- Profiling フレームワークの汎用 npm package 化。
- ブラウザ／クライアント側のメモリ分析。
- Mongoose / `y-websocket` / `@opentelemetry/auto-instrumentations-node` の major version upgrade。

## Boundary Commitments

### This Spec Owns
- `bin/memory-profiling/` 配下の profiling 関連スクリプト一式（CDP sidecar、load driver、シナリオ定義、RSS time-series logger、README）。`@growi/bin` workspace package として `pnpm-workspace.yaml` に登録される。
- `apps/app/src/server/util/mongoose-utils.ts` の `mongoOptions` への `maxPoolSize` / `minPoolSize` 追加（L1）。
- `apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts` の auto-instrumentation 設定を allow-list 方式へ置換（L2）。
- `apps/app/src/features/opentelemetry/server/custom-metrics/yjs-metrics.ts`（新規。`growi.yjs.docs.count` Observable Gauge）。
- `apps/app/src/features/opentelemetry/server/custom-metrics/index.ts` への `yjs-metrics` 統合（barrel re-export + `setupCustomMetrics()` への組み込み）。
- `apps/app/src/server/service/page-operation.ts` の `autoUpdateExpiryDate` への try/catch + logger 追加（L5）。
- `.kiro/specs/memory-leak-investigation/verification-report.md` の作成（dynamic profiling 結果を 5 findings ごとに記録）。
- 関連する CHANGESET エントリ（default 値変更の告知）。

### Out of Boundary
- 既存 `opentelemetry` spec が定義する SDK ライフサイクル、Resource Attribute 体系、HTTP anonymization、既存 4 custom-metrics module の構造。
- 既存 `collaborative-editor` spec が定義する `y-websocket` セッションの寿命ポリシーと `create-mongodb-persistence.ts` の persistence プロトコル。
- `BatchSpanProcessor` / `PeriodicExportingMetricReader` のパラメータチューニング（L2 の allow-list 化を超える変更）。
- Mongoose / mongoose-driver の API 変更や major version upgrade。
- `growi-info` / `config-manager` / `growi-logger` の API 変更。
- GROWI.cloud 本番監視ダッシュボードの設定変更（receiver 側）。
- L3 sweeper / L4 backpressure の **無条件** 実装（dynamic 検証で confirmed の場合のみ実装、refuted/inconclusive 時は本 spec 外）。

### Allowed Dependencies
- `mongoose` / `@growi/core/dist/consts` — 既存依存。L1 で `mongoOptions` 経由のみ利用。
- `@opentelemetry/auto-instrumentations-node` / `@opentelemetry/sdk-node` — 既存依存。L2 の allow-list 化で個別 instrumentation package を import する場合がある（既存 transitive 内で完結）。
- `@opentelemetry/api` の `metrics` モジュール — 既存パターンに従う（`system-metrics.ts` 参照）。
- `y-websocket/bin/utils` の `docs` Map — **read-only** に限定（`.size` 読み出しのみ。L3 metric callback で利用）。L3 sweeper を実装する場合は `closeConn` 経由の既存 close パスのみ使用。
- Node.js 標準: `node:inspector` — sidecar から CDP 接続用に間接的に利用。runtime dependency 追加なし。
- `~/utils/logger`（`@growi/logger` 経由）— 既存利用パターンに従う。
- devcontainer の `mongo:27017` / `elasticsearch:9200` — profiling 実行時のみの前提（参照: `.claude/rules/devcontainer.md`）。

### Revalidation Triggers
- `setupCustomMetrics()` の合成構造を変更する PR — `yjs-metrics` の組み込み箇所が影響を受ける。
- `y-websocket` package の major version upgrade — `docs` Map の export 形式が変更されると L3 metric が壊れる。
- `@opentelemetry/auto-instrumentations-node` の major version upgrade — allow-list 形式の API が変わる可能性。
- Mongoose の major version upgrade — `ConnectOptions` の `maxPoolSize` / `minPoolSize` の意味変化を確認。
- Node.js の major version upgrade — `inspector` / CDP の挙動を再確認。
- L3 sweeper を本 spec で実装する判断が下された場合 — `collaborative-editor` spec との境界整合を再確認。

## Architecture

### Existing Architecture Analysis

GROWI server (`apps/app`) は Next.js Pages Router + Express ベースで、以下の関連サブシステムが既に存在する。

- **OpenTelemetry custom-metrics 統合パス** — [apps/app/src/features/opentelemetry/server/custom-metrics/index.ts](../../apps/app/src/features/opentelemetry/server/custom-metrics/index.ts) の `setupCustomMetrics()` が dynamic import + `add*Metrics()` 呼び出し列で 4 つの metrics module を合成する。`opentelemetry` spec の Boundary に従い、本 spec は **新規 module の追加** で参加する。
- **`y-websocket` の集約点** — [apps/app/src/server/service/yjs/yjs.ts](../../apps/app/src/server/service/yjs/yjs.ts) で `docs`, `setPersistence`, `setupWSConnection` を import し、`WebSocketServer` に接続する。`docs` Map への read-only アクセスはこの import 経路を共有する。
- **mongoose 接続初期化** — [apps/app/src/server/util/mongoose-utils.ts](../../apps/app/src/server/util/mongoose-utils.ts) の `mongoOptions` が [apps/app/src/server/crowi/index.ts:352](../../apps/app/src/server/crowi/index.ts#L352) の `mongoose.connect()` 呼び出しに渡される。`maxPoolSize` 未指定により driver default `100` が効いている。
- **Process signal hook の典型箇所** — [apps/app/src/server/app.ts](../../apps/app/src/server/app.ts) の boot シーケンス末尾。SIGTERM / SIGINT のグレースフルシャットダウンが既に登録されている。本 spec では当初 SIGUSR2 を env var ガード付きで追加する案を採用したが、CDP 経路が主軸として安定したため削除した（[Scope change note](#overview) 参照）。

### Architecture Pattern & Boundary Map

採用パターン: **External profiling sidecar (CDP-only) + config-driven baseline tuning**。

```mermaid
graph TB
    subgraph DevcontainerEnv[Devcontainer Environment]
        subgraph ServerProcess[GROWI Server Process node --inspect]
            MongoosePool[mongoOptions maxPoolSize minPoolSize]
            OtelConfig[node-sdk-configuration allow-list]
            YjsMetric[yjs-metrics observable gauge]
            CustomMetrics[setupCustomMetrics composition]
            DefensiveTimer[autoUpdateExpiryDate try-catch]
            InspectorEp[Inspector Endpoint 9229]
        end
        subgraph SidecarProcess[Profiling Sidecar Process - bin/memory-profiling]
            Runner[Scenario Runner Baseline Load Drain]
            CdpClient[CDP Snapshot Client]
            LoadDriver[Load Driver undici plus y-websocket]
            RssLogger[RSS Time-Series Logger]
        end
        subgraph SharedFs[Shared tmp Directory]
            Snapshots[heapsnapshot files]
            RssCsv[rss-timeseries csv]
        end
        Mongo[mongo 27017 replica set rs0]
        ES[elasticsearch 9200]
        Otlp[OTLP Collector optional in devcontainer]
    end
    OtelConfig --> CustomMetrics
    YjsMetric --> CustomMetrics
    CustomMetrics -.metrics export.-> Otlp
    CdpClient -.CDP over WebSocket.-> InspectorEp
    LoadDriver -.HTTP and WS.-> ServerProcess
    CdpClient --> Snapshots
    RssLogger --> RssCsv
    Runner --> CdpClient
    Runner --> LoadDriver
    Runner --> RssLogger
    ServerProcess --> Mongo
    ServerProcess --> ES
```

**Architecture Integration**:
- **Selected pattern**: External sidecar (CDP-only) + config-driven baseline tuning（[research.md (Part 2) — Design Decisions](./research.md#design-decisions) 参照）。
- **Domain/feature boundaries**: profiling tooling は `bin/memory-profiling/`（`@growi/bin` workspace）に隔離し、server runtime とは完全に別 package・別プロセスで動く。server 側の追加面は既存 4 ファイルへの局所修正のみ（apps/app への新規 sidecar 結合なし）。
- **Existing patterns preserved**:
  - OTel custom-metrics の `add*Metrics()` + `setupCustomMetrics()` 合成パターン（`opentelemetry` spec 準拠）。
  - mongoose `mongoOptions` を `mongoose.connect()` に渡すパターン。
  - `growi-logger` (pino) 経由の構造化ログ。
- **New components rationale**:
  - `yjs-metrics.ts`: L3 で必要となる「y-websocket の document 数を時系列観測可能にする」唯一の最小実装。
  - `bin/memory-profiling/`: 再利用可能な profiling 手段を、`apps/app` から完全に切り離した独立 workspace package に集約。将来的には独自 `memory-profiling` spec で個別メンテする計画（[Future Work](#future-work) 参照）。
- **Steering compliance**:
  - `.claude/rules/coding-style.md` — 1 ファイル 1 責務、named exports、`import type` の徹底、英語コメント、co-located tests。
  - `.claude/rules/devcontainer.md` — `mongo:27017` / `elasticsearch:9200` は常時前提。接続性チェックは行わない。
  - `apps/app/.claude/rules/package-dependencies.md` — 本 spec は新規 runtime dependency を追加しない（既存 `mongoose`, `@opentelemetry/*`, `ws`, `undici` のみ利用）。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Backend / Services | Node.js ^24 (existing) | Server runtime、`--inspect` で CDP endpoint 公開 | 既存 runtime。追加なし。 |
| Backend / Services | `mongoose` ^6.13.6 (existing) | `ConnectOptions.maxPoolSize` / `minPoolSize` 設定 | 既存依存。設定面のみ修正。 |
| Observability | `@opentelemetry/api` ^1.9.0 (existing) | Observable Gauge 登録 | 既存。`yjs-metrics.ts` で利用。 |
| Observability | `@opentelemetry/auto-instrumentations-node` ^0.75.0 (existing) | allow-list 方式へ置換 | 既存。`getNodeAutoInstrumentations()` を allow-list で wrap。 |
| Profiling Tooling | Node.js `inspector` / `v8` (built-in) | CDP 起動・`writeHeapSnapshot` | 追加 dependency なし。 |
| Profiling Tooling | `ws` (existing, transitive) | sidecar から CDP に WebSocket 接続 | 既存依存。 |
| Profiling Tooling | `undici` (Node 24 built-in / existing) | load driver の HTTP リクエスト | 追加なし。 |
| Profiling Tooling | `y-websocket` client (existing) | yjs セッション再現 | sidecar から再利用。 |
| Profiling Tooling | `tsx` or `ts-node` (existing devDep) | sidecar TypeScript の direct execution | 既存 devDep がない場合のみ devDep 追加。 |
| Persistence | MongoDB (devcontainer `mongo:27017`, replica set `rs0`) | profiling 中の DB 接続先 | devcontainer 既設。 |
| Persistence | Elasticsearch (devcontainer `elasticsearch:9200`) | profiling 中の search backend | devcontainer 既設。 |

## File Structure Plan

### Directory Structure

```
apps/app/
├── src/
│   ├── server/
│   │   ├── util/
│   │   │   └── mongoose-utils.ts                    # [MODIFY] L1: maxPoolSize / minPoolSize 追加
│   │   └── service/
│   │       └── page-operation.ts                    # [MODIFY] L5: setInterval callback の try/catch
│   └── features/
│       └── opentelemetry/server/
│           ├── node-sdk-configuration.ts            # [MODIFY] L2: auto-instrumentation を allow-list 化
│           └── custom-metrics/
│               ├── index.ts                         # [MODIFY] yjs-metrics の barrel と setupCustomMetrics への追加
│               ├── yjs-metrics.ts                   # [NEW] growi.yjs.docs.count Observable Gauge
│               └── yjs-metrics.spec.ts              # [NEW] yjs-metrics の unit test
bin/                                                 # [NEW] @growi/bin workspace
├── package.json                                     # workspace package 定義
├── memory-profiling/                                # profiling sidecar 一式
│   ├── README.md                                    # 使い方・前提・出力場所
│   ├── run-scenario.ts                              # エントリポイント Baseline -> Load -> Drain を順次実行
│   ├── cdp-snapshot-client.ts                       # CDP WebSocket クライアント (HeapProfiler.takeHeapSnapshot)
│   ├── load-driver.ts                               # LoadDriver の実装 (lib/* を合成)
│   ├── rss-time-series-logger.ts                    # process.memoryUsage 時系列ロガー (CSV 出力)
│   ├── scenarios/
│   │   ├── baseline.ts                              # idle phase
│   │   ├── load.ts                                  # page CRUD + search + page read/list + yjs open/close + abort 混在
│   │   └── drain.ts                                 # idle phase (Load 後)
│   └── lib/
│       ├── installer-driver.ts                      # /api/v3/installer/ の自動化
│       ├── http-client.ts                           # undici-based 汎用 HTTP client
│       └── yjs-client.ts                            # minimal y-websocket client (open/close/abort)
.kiro/specs/memory-leak-investigation/
├── brief.md                                         # 既存
├── requirements.md                                  # 既存
├── design.md                                        # 本ファイル
├── research.md                                      # 既存 (Part 1: 静的解析 + Part 2: design discovery)
├── tasks.md                                         # 既存
└── verification-report.md                           # [NEW: Phase 5] 検証結果の集約
```

> SIGUSR2 in-process fallback（旧 `apps/app/src/server/util/heap-snapshot-handler.ts` + `app.ts` への登録 + `.env.development` への `MEMORY_PROFILING_ENABLED` コメント例）は実装中に削除した（commit `b8e3efa4c7`）。CDP-only に集約することで、`apps/app` の signal handler 設置面と新規 env var を排除している。

### Modified Files
- `apps/app/src/server/util/mongoose-utils.ts` — `mongoOptions` に `maxPoolSize` / `minPoolSize` を追加。env var から読み出し（default 10 / 2）。
- `apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts` — `getNodeAutoInstrumentations()` の引数を allow-list ベースに置換。allow set は `http`, `express`, `mongodb`, `mongoose`。`OTEL_AUTO_INSTRUMENTATION_PROFILE=all` で従来動作復元可能。
- `apps/app/src/features/opentelemetry/server/custom-metrics/index.ts` — `yjs-metrics` の re-export を追加し、`setupCustomMetrics()` の dynamic import 列と `add*Metrics()` 呼び出し列に組み込む。
- `apps/app/src/server/service/page-operation.ts` — `autoUpdateExpiryDate` の `setInterval` callback を try/catch でラップし、catch 内で `logger.error` を呼ぶ。
- `pnpm-workspace.yaml` — `bin` を workspace パッケージとして登録する。

> 各ファイルは 1 つの明確な責務を持つ。`bin/memory-profiling/` の各ファイルは「シナリオ orchestration」「CDP 通信」「HTTP 駆動」「yjs 駆動」「RSS ロギング」の 5 つの分離されたモジュールで構成される。

## System Flows

### Profiling Session Sequence

```mermaid
sequenceDiagram
    participant Op as Investigator
    participant Server as GROWI Server (--inspect)
    participant Sidecar as Profiling Sidecar
    participant Cdp as Inspector (CDP)
    participant Fs as tmp/memory-leak-investigation/
    Op->>Server: node --inspect dist/server/app.js (or pnpm run ts-node --inspect)
    Server->>Cdp: open inspector endpoint :9229
    Op->>Sidecar: pnpm run ts-node bin/memory-profiling/run-scenario.ts
    Sidecar->>Cdp: GET /json/list -> webSocketDebuggerUrl
    Sidecar->>Cdp: WebSocket connect
    Sidecar->>Sidecar: start RSS logger (interval 1s)
    Note over Sidecar: --- Baseline phase (5 min idle) ---
    Sidecar->>Cdp: HeapProfiler.takeHeapSnapshot
    Cdp-->>Sidecar: chunked snapshot bytes
    Sidecar->>Fs: write snapshot-A.heapsnapshot
    Note over Sidecar: --- Load phase ---
    loop Load scenario steps
        Sidecar->>Server: HTTP page CRUD + search + read/list + yjs open/close/abort
        Server-->>Sidecar: 2xx / WS frames
    end
    Sidecar->>Cdp: HeapProfiler.takeHeapSnapshot
    Sidecar->>Fs: write snapshot-B.heapsnapshot
    Note over Sidecar: --- Drain phase (5 min idle) ---
    Sidecar->>Cdp: HeapProfiler.takeHeapSnapshot
    Sidecar->>Fs: write snapshot-C.heapsnapshot
    Sidecar->>Fs: write rss-timeseries.csv
    Sidecar-->>Op: scenario summary on stdout
    Op->>Fs: diff A/C -> verification-report.md
```

**Key flow decisions**:
- Snapshot 取得は CDP（Chrome DevTools Protocol）経由のみ。`HeapProfiler.takeHeapSnapshot` を WS で発行し、chunk を結合して `.heapsnapshot` ファイルとして保存する。
- RSS time series は profiling 全期間で 1 秒間隔取得。Baseline / Load / Drain の境界は CSV にラベル列で記録。
- Snapshot 生成は GROWI server を一時停止させるため、Drain 後の最終 snapshot 取得直後にユーザー操作で server 停止する想定。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | profiling モード起動 | ScenarioRunner | `--inspect` で公開された CDP endpoint | Profiling Session Sequence (boot) |
| 1.2 | CDP 経由 snapshot 保存 | CdpSnapshotClient | CDP `HeapProfiler.takeHeapSnapshot` | Profiling Session Sequence (snapshot) |
| 1.3 | tmp ディレクトリ配下集約 | ScenarioRunner, RssTimeSeriesLogger | Output path = `apps/app/tmp/memory-leak-investigation/` | Profiling Session Sequence (write) |
| 1.4 | snapshot 失敗時の非影響 | CdpSnapshotClient | try/catch + logger（GROWI server プロセスは止めない） | — |
| 2.1 | 3 段階シナリオ | ScenarioRunner, scenarios/{baseline,load,drain}.ts | Phase enum | Profiling Session Sequence (phase boundaries) |
| 2.2 | Load 段階の混在負荷 (page CRUD / search / read / abort 混在) | LoadDriver, YjsClient | `socket.destroy()` for abort、Elasticsearch search query 経由 | Profiling Session Sequence (Load) |
| 2.3 | RSS 時系列ログ | RssTimeSeriesLogger | CSV schema (`timestamp,phase,rss,heap_used,heap_total,external`) | — |
| 2.4 | 各段階境界で snapshot | ScenarioRunner | Phase-transition hook | Profiling Session Sequence (snapshots A/B/C) |
| 2.5 | 再現可能性 | ScenarioRunner (deterministic op counts) | Scenario module の op count を const で公開 | — |
| 3.1, 3.2 | MongoDB pool 上下限の env 制御 | MongoosePoolConfig | `mongoOptions: ConnectOptions` extension | — |
| 3.3 | OTel auto-instrumentation allow-list | OtelInstrumentationAllowList | `node-sdk-configuration.ts` の `instrumentations` 配列 | — |
| 3.4 | 従来動作への切戻し | OtelInstrumentationAllowList, MongoosePoolConfig | env var `OTEL_AUTO_INSTRUMENTATION_PROFILE`, `MONGO_MAX_POOL_SIZE` | — |
| 3.5 | 削減効果の数値記録 | VerificationReport | report の RSS delta section | — |
| 3.6 | 機能非破壊 | 全 server-side コンポーネント | 既存テスト群 | — |
| 4.1, 4.2 | `growi.yjs.docs.count` emit | YjsDocsMetric | `addCallback` で `docs.size` 観測 | — |
| 4.3 | 既存エクスポート機構の周期に追随 | YjsDocsMetric | `meter.createObservableGauge` (PeriodicExportingMetricReader と統合) | — |
| 4.4 | `otel:enabled=false` で disable | YjsDocsMetric | `setupCustomMetrics()` のガードを継承 | — |
| 4.5 | 既存 metric 不変更 | YjsDocsMetric | 既存 modules を一切触らない | — |
| 5.1 | L3 sweeper 条件付き | YjsIdleSweeper (conditional) | 内部 idle timer + `closeConn` の既存 path | — |
| 5.2 | L4 backpressure 条件付き | HandlerBackpressure (conditional) | EventEmitter wrapper の concurrent cap | — |
| 5.3 | L5 try/catch + log (常時) | DefensivePageOperationTimer | `setInterval(async () => { try {...} catch (err) { logger.error(...) } })` | — |
| 5.4 | refuted 時の除外記録 | VerificationReport | report の verdict section | — |
| 5.5 | L3 sweeper と collaborative-editor 整合 | YjsIdleSweeper (conditional) | 既存 `closeConn` 経由のみ | — |
| 6.1 | finding ごとの verdict | VerificationReport | report の structured section | — |
| 6.2 | L1+L2 数値比較 | VerificationReport | report の RSS delta section | — |
| 6.3 | 環境メタ情報 | VerificationReport | report の environment section | — |
| 6.4 | 手順ドキュメント化 | `bin/memory-profiling/README.md` | README structure | — |
| 6.5 | snapshot 非コミット | `.gitignore` 確認 / report への集計値のみ記載 | — | — |
| 7.1 | 既存機能非破壊（page CRUD / 検索 / 認証 / yjs / OTel 送出） | 全 server-side コンポーネント, LoadDriver (search / read op で実測) | 既存テスト pass、profiling scenario の Load 段階 | Profiling Session Sequence (Load) |
| 7.2 | env var による切戻し | MongoosePoolConfig, OtelInstrumentationAllowList | env var contracts | — |
| 7.3 | lint/test/build pass | CI 既存パイプライン | turbo run lint/test/build | — |
| 7.4 | metric 意味的変化の告知 | VerificationReport | report の "behavior changes" section | — |

## Components and Interfaces

### Summary Table

| Component | Domain / Layer | Intent | Req Coverage | Key Dependencies (P0/P1) | Contracts |
|-----------|----------------|--------|--------------|--------------------------|-----------|
| MongoosePoolConfig | Server / Persistence | mongoose 接続プールの上下限を env var で制御 | 3.1, 3.2, 3.4, 7.2 | `mongoose` (P0) | Config |
| OtelInstrumentationAllowList | Server / Observability | auto-instrumentation を必要集合のみ enable | 3.3, 3.4, 7.2 | `@opentelemetry/auto-instrumentations-node` (P0) | Config |
| YjsDocsMetric | Server / Observability | `growi.yjs.docs.count` Observable Gauge を emit | 4.1, 4.2, 4.3, 4.4, 4.5 | `y-websocket/bin/utils.docs` (P0), `@opentelemetry/api` (P0), custom-metrics index (P0) | Service (metric registration) |
| DefensivePageOperationTimer | Server / Reliability | `autoUpdateExpiryDate` の例外を捕捉してログ | 5.3 | `growi-logger` (P0) | — |
| YjsIdleSweeper (conditional) | Server / yjs | 確認時のみ idle session を `closeConn` | 5.1, 5.5 | `y-websocket/bin/utils` (P0) | Service |
| HandlerBackpressure (conditional) | Server / events | 確認時のみ concurrent in-flight handler 上限 | 5.2 | EventEmitter (P0) | Service |
| ScenarioRunner | Tooling / Profiling | Baseline → Load → Drain の orchestration | 1.4, 2.1, 2.4, 2.5 | scenarios/, cdp-client, rss-logger (P0) | Service |
| CdpSnapshotClient | Tooling / Profiling | CDP 経由で heap snapshot を取得保存 | 1.1, 1.2, 1.5 | inspector endpoint (P0), `ws` (P0) | Service |
| LoadDriver | Tooling / Profiling | page CRUD / search / page read / yjs / abort の混在負荷生成 | 2.2, 7.1 | `undici` (P0), yjs-client (P0) | Service |
| RssTimeSeriesLogger | Tooling / Profiling | `process.memoryUsage` を CSV に記録 | 2.3 | none (P2) | Batch (output file) |
| VerificationReport | Documentation | 検証結果の構造化レポート | 3.5, 5.4, 6.1, 6.2, 6.3, 7.4 | snapshots, RSS CSV (P0) | — |

> 詳細ブロックは新規コンポーネントと既存コンポーネントへの **責務境界が増減するもの** に絞る。`DefensivePageOperationTimer` は単純な try/catch 追加のため Implementation Note のみで足る。

### Server / Persistence

#### MongoosePoolConfig

| Field | Detail |
|-------|--------|
| Intent | mongoose 接続プールの上下限を env var で制御し、テナント専用コンテナの idle socket を削減 |
| Requirements | 3.1, 3.2, 3.4, 7.2 |

**Responsibilities & Constraints**
- `mongoOptions` に `maxPoolSize` / `minPoolSize` を追加するのみ。pool 周辺の他オプション（read preference 等）は変更しない。
- Default は `maxPoolSize=10`, `minPoolSize=2`。env var で override 可能。

**Dependencies**
- Inbound: `apps/app/src/server/crowi/index.ts:352` — `mongoose.connect(uri, mongoOptions)` (P0)
- External: `mongoose` `ConnectOptions` 型 (P0)

**Contracts**: Service [ ] / API [ ] / Event [ ] / Batch [ ] / State [ ] / Config [x]

##### Config Contract
| Env Var | Default | Allowed Range | Effect |
|---------|---------|---------------|--------|
| `MONGO_MAX_POOL_SIZE` | `10` | positive integer | mongoose pool 上限 |
| `MONGO_MIN_POOL_SIZE` | `2` | non-negative integer, `<= MONGO_MAX_POOL_SIZE` | mongoose pool 下限 |

**Implementation Notes**
- Integration: `mongoose-utils.ts:52` の `mongoOptions` を `{ useUnifiedTopology: true, maxPoolSize: ..., minPoolSize: ... }` に変更。
- Validation: env var が NaN の場合は default にフォールバック（`Number.isFinite` チェック）。
- Risks: 大規模テナントで `maxPoolSize=10` が飽和する可能性 → release notes で env var override を案内。

### Server / Observability

#### OtelInstrumentationAllowList

| Field | Detail |
|-------|--------|
| Intent | auto-instrumentation を GROWI が実際に利用する集合のみに限定 |
| Requirements | 3.3, 3.4, 7.2 |

**Responsibilities & Constraints**
- `getNodeAutoInstrumentations({...})` の deny-list（pino / fs を off）方式から、明示的な allow-list 方式へ置換。
- Allow set 既定: `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-express`, `@opentelemetry/instrumentation-mongodb`, `@opentelemetry/instrumentation-mongoose`。
- `OTEL_AUTO_INSTRUMENTATION_PROFILE=all` の場合は従来動作（pino / fs だけ off の `getNodeAutoInstrumentations`）に戻す。

**Dependencies**
- External: `@opentelemetry/auto-instrumentations-node` (P0)
- Inbound: `node-sdk.ts` 経由で `generateNodeSDKConfiguration()` を呼び出す boot path

**Contracts**: Config [x]

##### Config Contract
| Env Var | Default | Allowed Values | Effect |
|---------|---------|----------------|--------|
| `OTEL_AUTO_INSTRUMENTATION_PROFILE` | `minimal` | `minimal` \| `all` | `minimal` = allow-list、`all` = 既存挙動 |

**Implementation Notes**
- Integration: `node-sdk-configuration.ts:51-66` の `instrumentations: [...]` 配列を分岐させる。
- Validation: 不明な値は warn ログを出して `minimal` 扱い。
- Risks: 意図しないスパン欠落 → 実装前に「現状スパン種」を `OTEL_SDK_DISABLED` を使い実測し、allow-list と diff を取って確認する。

#### YjsDocsMetric

| Field | Detail |
|-------|--------|
| Intent | `y-websocket` の `docs` Map サイズを Observable Gauge として emit |
| Requirements | 4.1, 4.2, 4.3, 4.4, 4.5 |

**Responsibilities & Constraints**
- 既存 `custom-metrics/*.ts` のパターン（`addXxxMetrics()` 関数 export + `meter.createObservableGauge` + `addCallback`）に厳密に従う。
- `docs.size` を読み出すのみ。`docs` の状態変更や iterate は行わない。
- Metric 名: `growi.yjs.docs.count`、unit `{document}`、description は「Current number of collaborative documents held by y-websocket」。

**Dependencies**
- External: `y-websocket/bin/utils` の `docs` Map (P0, read-only)
- External: `@opentelemetry/api` の `metrics` (P0)
- Inbound: `setupCustomMetrics()` の合成パス (P0)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface
```typescript
export function addYjsMetrics(): void;
```
- Preconditions: OpenTelemetry SDK 初期化済み、`otel:enabled` = `true`、`setupCustomMetrics()` から呼ばれる。
- Postconditions: `growi.yjs.docs.count` Observable Gauge が登録され、以降のエクスポート周期で `docs.size` を観測する。
- Invariants: 既存 metrics の登録順序・名称・schema に影響しない。

**Implementation Notes**
- Integration: `custom-metrics/index.ts` の barrel に `export { addYjsMetrics } from './yjs-metrics';` と、`setupCustomMetrics()` の dynamic import / 呼び出し列に 1 行ずつ追加。
- Validation: callback 内で `docs` が undefined だった場合の defensive check（パッケージ未初期化時用）。
- Risks: `y-websocket` の major version upgrade で `docs` の export 形式が変わると壊れる → Revalidation Triggers に記載済。

### Server / Reliability

#### DefensivePageOperationTimer

**Intent**: `PageOperationService.autoUpdateExpiryDate` の `setInterval` callback を try/catch でラップし、例外を `growi-logger` で構造化ログとして残す（要件 5.3）。

**Implementation Notes**
- Integration: `page-operation.ts:236` の `setInterval(async () => { await PageOperation.extendExpiryDate(operationId); }, ...)` を `setInterval(async () => { try { await PageOperation.extendExpiryDate(operationId); } catch (err) { logger.error({ err, operationId }, 'extendExpiryDate failed'); } }, ...)` に変更。
- Validation: 既存 caller `apps/app/src/server/service/page/index.ts:821–851` の try/finally と二重ハンドリングにならないことを確認。
- Risks: なし（純粋に defensive）。

### Server / yjs (Conditional — implemented only if Phase 2 confirms)

#### YjsIdleSweeper

| Field | Detail |
|-------|--------|
| Intent | confirmed の場合のみ、idle セッションを既存 `closeConn` 経由でクローズ |
| Requirements | 5.1, 5.5 |

**Responsibilities & Constraints**
- Sweep 間隔と idle 判定閾値は env var で制御（default は design-time に未確定、検証結果で決める）。
- `closeConn` 等の既存 close path のみ使用。`docs` から直接 delete しない。
- `collaborative-editor` spec の session 寿命ポリシーに整合（要件 5.5）。

**Implementation Notes**
- Phase 2 検証で `Y.Doc` 残存が Baseline 比で有意に確認された場合に限り、本 spec で実装。
- 実装時は別 PR / 別 task として分離し、verification-report.md の confirmed 判定を根拠資料として参照する。

### Server / events (Conditional)

#### HandlerBackpressure

| Field | Detail |
|-------|--------|
| Intent | confirmed の場合のみ、emitter ごとの concurrent in-flight handler 上限を設定 |
| Requirements | 5.2 |

**Implementation Notes**
- 同じく Phase 2 で確認された場合に限る。実装は `Activity → InAppNotification`、`pageEvent → search` 経路の handler に concurrency limiter を導入。

### Tooling / Profiling

#### ScenarioRunner

| Field | Detail |
|-------|--------|
| Intent | Baseline → Load → Drain の 3 段階を順次実行し、各境界で snapshot / RSS log を出力 |
| Requirements | 1.4, 2.1, 2.4, 2.5 |

**Responsibilities & Constraints**
- 各段階の op 回数・interval を const として scenario module に持たせる（再現可能性 — 要件 2.5）。
- CdpSnapshotClient, LoadDriver, RssTimeSeriesLogger を順序通り呼ぶ pure orchestrator。

**Dependencies**
- Outbound: CdpSnapshotClient (P0), LoadDriver (P0), RssTimeSeriesLogger (P0), scenarios/{baseline,load,drain}.ts (P0)

**Contracts**: Service [x]

##### Service Interface
```typescript
type Phase = 'baseline' | 'load' | 'drain';
interface ScenarioRunnerOptions {
  readonly inspectorUrl: string;        // http://127.0.0.1:9229
  readonly outputDir: string;           // tmp/memory-leak-investigation/
  readonly baseUrl: string;             // http://localhost:3000
  readonly idleSeconds: number;         // default 300
  readonly loadOpCounts: {
    pageCreate: number;
    pageEdit: number;
    pageGet: number;
    pageList: number;
    pageSearch: number;
    yjsSessionsCleanClose: number;
    yjsSessionsAbort: number;
  };
}
export async function runScenario(opts: ScenarioRunnerOptions): Promise<void>;
```

**Implementation Notes**
- Integration: エントリポイント `bin/memory-profiling/run-scenario.ts` から CLI 引数 / env var を解釈して `runScenario(opts)` を呼ぶ。
- Risks: server 起動が確認できないと CDP 接続待ちで詰まる → retry with timeout を持つ。

#### CdpSnapshotClient

| Field | Detail |
|-------|--------|
| Intent | inspector endpoint に WS で接続し、`HeapProfiler.takeHeapSnapshot` を発行して chunk を結合保存 |
| Requirements | 1.1, 1.2, 1.5 |

**Dependencies**
- External: `ws` (P0), `undici` で `/json/list` をフェッチ (P0)

**Contracts**: Service [x]

##### Service Interface
```typescript
interface CdpSnapshotClient {
  connect(inspectorUrl: string): Promise<void>;
  takeSnapshot(outputPath: string): Promise<void>;
  close(): Promise<void>;
}
export function createCdpSnapshotClient(): CdpSnapshotClient;
```
- Preconditions: inspector が `--inspect=0.0.0.0:9229` で起動済み。
- Postconditions: `outputPath` に `.heapsnapshot` ファイルが書き込まれる。
- Invariants: snapshot 取得失敗時もコネクションは閉じる（要件 1.5）。

#### LoadDriver

| Field | Detail |
|-------|--------|
| Intent | HTTP（page CRUD / search / page read / page list）+ yjs（open/close/abort）の混在負荷を生成し、GROWI の実利用に近いパスでメモリ挙動を測定可能にする |
| Requirements | 2.2, 7.1 |

**Responsibilities & Constraints**
- Write 系（`pageCreate` / `pageEdit`）と read 系（`pageGet` / `pageList` / `pageSearch`）と yjs 系（`yjsSessionCleanClose` / `yjsSessionAbort`）を独立した op として提供し、ScenarioRunner が任意の比率で混在実行できるようにする。
- `pageSearch` は GROWI の Elasticsearch search endpoint（`/_api/search` 系）を叩く。L2 (OTel auto-instrumentation allow-list) による search パスの非破壊性検証に必須。
- `pageGet` / `pageList` は markdown render / page tree walk が走る代表的な read パスをカバーする。
- Op 関数は内部で並列度を持たない（直列発火）。混在の並列度は scenario module 側で制御する。

**Dependencies**
- External: `undici` (P0, HTTP), `ws` + minimal yjs client (P0)
- Inbound: `bin/memory-profiling/scenarios/load.ts` から op ごとの回数を渡して呼ばれる

**Contracts**: Service [x]

##### Service Interface
```typescript
interface LoadDriver {
  initInstaller(): Promise<{ adminEmail: string; adminPassword: string; cookie: string }>;
  pageCreate(count: number): Promise<void>;
  pageEdit(count: number): Promise<void>;
  pageGet(count: number): Promise<void>;
  pageList(count: number): Promise<void>;
  pageSearch(count: number): Promise<void>;
  yjsSessionCleanClose(count: number): Promise<void>;
  yjsSessionAbort(count: number): Promise<void>;
}
export function createLoadDriver(baseUrl: string): LoadDriver;
```
- Preconditions: GROWI server が listen 中。`pageSearch` は Elasticsearch (`elasticsearch:9200`) との接続が確立済であること（devcontainer の前提）。
- Postconditions: 指定された op 数だけの負荷が発生し終わる。
- Invariants: abort は OS / Node が許す範囲で TCP RST 相当を試みる（`socket.destroy()`）。`pageSearch` の query string は固定パターン（再現可能性のため）。

#### RssTimeSeriesLogger

**Intent**: `process.memoryUsage()` ではなく、sidecar から GROWI server プロセスの RSS を直接観測することは難しいため、sidecar からは「CDP で `Runtime.evaluate` を発行して `process.memoryUsage()` を取得する」または「server 側に専用 admin endpoint を追加する」のどちらかを選ぶ。本 spec では前者（CDP 経由で取得）を採用する。出力は CSV (`timestamp,phase,rss,heap_used,heap_total,external`)。

**Contracts**: Batch [x]（time-series CSV output）

##### Batch / Job Contract
- Trigger: ScenarioRunner が phase 開始時に `start(phase)` 呼び出し、phase 終了時に `mark()` でラベル付け
- Input: CDP `Runtime.evaluate` の戻り値（`process.memoryUsage()` シリアライズ済み）
- Output: `rss-timeseries.csv` を `tmp/memory-leak-investigation/` 配下に append
- Idempotency: 同じ output path に書く場合は既存 CSV を archive してから新規作成

### Documentation

#### VerificationReport

**Intent**: 5 findings ごとの判定（confirmed / refuted / inconclusive）、L1+L2 の RSS delta、環境メタデータ、metric の意味的変化、を構造化されたセクションで残す。

**Required sections**:
1. **Environment** — GROWI commit hash, Node.js version, MongoDB version, Elasticsearch version, profiling 実行日時、シナリオ op count（要件 6.3）。
2. **Per-finding verdicts** — L1, L2, L3, L4, L5 ごとに `verdict`, `evidence`（snapshot 差分 / retained constructor counts / RSS delta）, `decision`（修正実施／不実施／後続 spec へ送る）を記録（要件 6.1, 5.4）。
3. **RSS delta** — L1+L2 適用前後の Baseline RSS を MB 単位で記録、20–40 MB 目標との比較（要件 3.5, 6.2）。
4. **Behavior changes** — metric 値の意味的変化、env var の default 変更の運用影響（要件 7.4）。
5. **Open issues / follow-ups** — refuted / inconclusive 判定の理由と再調査トリガー。

## Error Handling

### Error Strategy
- **Profiling sidecar 内のエラー**: CDP 接続失敗 → retry with exponential backoff（max 5 回）。Snapshot 取得失敗 → 当該 snapshot をスキップし RSS time series ログは続行、最終的に exit code 非 0 で sidecar 終了。
- **L5 callback のエラー**: `extendExpiryDate` 失敗時は構造化ログのみ。`setInterval` 自体は継続。

### Error Categories and Responses
- **Investigator errors**: env var 不足、ポート競合、inspector 未起動 → sidecar が 起動時にプリチェックを行い、不足を明示的にエラーメッセージで表示。
- **System errors**: MongoDB 接続失敗 → 既存 GROWI server の startup error path を継承。Profiling 開始前に server が ready であることを sidecar が確認する。
- **Business logic errors**: なし（profiling は read-only な観測）。

### Monitoring
- 本 spec で追加する metric `growi.yjs.docs.count` は GROWI 既存の OTLP 経由で receiver に送られる。
- Profiling sidecar の動作ログは sidecar 自体の stdout に出す（GROWI logger は使わない）。

## Testing Strategy

### Unit Tests
1. **YjsDocsMetric**: `addYjsMetrics()` 呼出し後、`OpenTelemetry meter` から `growi.yjs.docs.count` が取得可能で、`docs.size` の現在値を返すこと（`y-websocket/bin/utils` の `docs` を mock）。
2. **MongoosePoolConfig**: `MONGO_MAX_POOL_SIZE` / `MONGO_MIN_POOL_SIZE` env var が読み取られ、未指定で `10` / `2`、NaN で fallback、正常値でその値が `mongoOptions` に入ること。
3. **OtelInstrumentationAllowList**: `OTEL_AUTO_INSTRUMENTATION_PROFILE=minimal`（または未指定）で allow-list 由来の instrumentation のみ enabled、`=all` で従来挙動と等価になること。
4. **DefensivePageOperationTimer**: `extendExpiryDate` が reject した時に `logger.error` が呼ばれ、`setInterval` 周期が継続することを fake timer で検証。

### Integration Tests
1. **`setupCustomMetrics()` 合成**: 全 5 modules（既存 4 + `yjs-metrics`）が登録された状態で OTel meter から各 metric を解決できること。
2. **mongoose 接続**: `MONGO_MAX_POOL_SIZE=3` 環境で server を起動した時、mongoose client の `topology.s.maxPoolSize` が 3 を反映していること（devcontainer mongo 利用）。
3. **OTel allow-list 実効性**: `OTEL_AUTO_INSTRUMENTATION_PROFILE=minimal` 時に `@opentelemetry/instrumentation-dns` 等の不要 instrumentation が patch されないこと（patching を spy）。

### E2E / 手動シナリオ
1. **Profiling session 1 周回し**: devcontainer で `pnpm run ts-node --inspect=0.0.0.0:9229 src/server/app.ts`（または production dist 修正後の `node --inspect dist/server/app.js`）を起動し `pnpm run ts-node bin/memory-profiling/run-scenario.ts` を実行 → `apps/app/tmp/memory-leak-investigation/` に snapshot A/B/C + rss-timeseries.csv が生成されることを目視で確認。
2. **L1+L2 適用前後の Baseline RSS 計測**: 同シナリオを「fix なし build」と「fix あり build」で実行し、Drain 後 RSS の delta が 20–40 MB レンジに入ることを確認（verification-report.md に記録）。
3. **`growi.yjs.docs.count` の OTLP 受信**: 受信側 collector のログまたは debug exporter で `growi.yjs.docs.count` が export されることを確認。

### Performance Tests
- E2E #2 が performance 検証を兼ねる（baseline RSS の数値検証）。明示的な load benchmark は本 spec では行わない。

## Migration Strategy

```mermaid
flowchart LR
    Start --> Build[turbo build apps app]
    Build --> StaticVerify[Static verification of L1 L2 L5 patches]
    StaticVerify --> Profile[Profiling session in devcontainer]
    Profile --> Report[Write verification-report.md]
    Report --> ConditionalDecide{Phase 2 confirmed leaks?}
    ConditionalDecide -- L3 Y.Doc retained --> ImplSweeper[Implement YjsIdleSweeper]
    ConditionalDecide -- L4 event chain bloat --> ImplBackpressure[Implement HandlerBackpressure]
    ConditionalDecide -- nothing confirmed --> SkipConditional[Record inconclusive in report]
    ImplSweeper --> Release
    ImplBackpressure --> Release
    SkipConditional --> Release
    Release[CHANGELOG entry default value change notice]
```

**Migration & rollout notes**:
- L1 / L2 / L3 metric / L5 は単独で independent に merge 可能。共通の release 単位とすることで CHANGELOG エントリを 1 つにまとめる。
- 既存 deployment の振る舞い変化（pool size default、auto-instrumentation 範囲）は CHANGELOG / release notes で明示し、env var による rollback 手順を併記。
- 条件付きコンポーネント（YjsIdleSweeper / HandlerBackpressure）は Phase 2 の検証結果次第で、本 spec 内で別 task として追加するか、別 PR / 別 spec に切り出すかを決定する。

## Performance & Scalability

- **Target**: Baseline RSS 削減 20–40 MB（L1 + L2 適用後、Drain 後計測）。
- **Measurement**: `process.memoryUsage().rss` を sidecar 経由（CDP `Runtime.evaluate`）で取得し、5 分 idle の平均を baseline 値とする。
- **Trade-offs**: `maxPoolSize=10` は per-tenant low-traffic 想定。大規模テナントでは env var で引き上げ。auto-instrumentation 絞り込みでスパン種が減るが、減るのは GROWI が使っていない module の wrapping のみで、観測可能性に支障は出ない想定（実装前に diff で確認）。

## Security Considerations

- **Inspector エンドポイント (`:9229`) は devcontainer ローカルでのみ listen** する。production では `--inspect` を付けない。
- **`apps/app/tmp/memory-leak-investigation/*.heapsnapshot` には機密情報を含む可能性** — devcontainer ローカル開発の admin user / page content が snapshot に乗る。リポジトリにコミットしない、共有しない、不要になり次第削除する旨を README に記載。
- 本 spec で追加する metric `growi.yjs.docs.count` はカウント値のみで PII / 機密情報を含まない。

## Future Work

- **`memory-profiling` spec の分離**: 現状 `bin/memory-profiling/` は本 spec が所有しているが、将来は同名の独立 spec を `.kiro/specs/memory-profiling/` として立て、CLI tooling として独立メンテナンスできるようにする。本 spec はその時点で「過去の memory-leak 調査の verification record」としてアーカイブ化（`/kiro-spec-cleanup` 経由）する。
- **Production dist server (Node.js v24) の Prisma ESM/CJS 不整合解消**: `dist/generated/prisma/client.js` が `import.meta.url`（ESM）と `exports`（CJS）を併用しているため、Node.js v24 strict ESM 下で `ReferenceError: exports is not defined` を起こす。これを解消することで dist server 起動下での計測が可能となる（[Phase 6 / Task 6.4](./tasks.md#phase-6) で対応）。
