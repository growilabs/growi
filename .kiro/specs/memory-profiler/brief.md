# Brief: memory-profiler

## Problem

`bin/memory-profiler/`（`@growi/bin` workspace package）には、GROWI のメモリ調査に使う CDP-based heap snapshot client、HTTP / yjs 負荷ドライバ、RSS 時系列ロガー、Baseline / Load / Drain シナリオオーケストレーターが揃っている。しかし現状、これら一連のツール群を「公式仕様」として記述した spec が存在しない。歴史的経緯から `memory-leak-investigation` spec の design.md にツール構造の記述が含まれているが、同 spec は 1 回限りの調査記録として凍結されており、今後ツールに変更を加える際の参照元・レビュー基準として安定しない。

調査担当者が次回以降の調査で同ツールを利用するたびに、改善点や新しいシナリオが必要になるが、変更を受け入れる owner spec がないため:

- アーキテクチャ変更（CDP layer の再設計、scenario 拡張、out-of-process metric collector の追加など）の責任所在が曖昧
- どの interface が "stable" でどこが "internal" か明文化されていない
- ツール側の test 戦略・lint / build 基準が package 文書化されていない
- 別の memory 調査が始まった際、メンテ済みの状態としてどこを起点に変更すべきか不明確

## Current State

```
bin/                            # @growi/bin workspace package (private)
├── package.json                # ws, vitest を持つ private package
├── memory-profiler/
│   ├── README.md               # 起動手順・出力レイアウト・コミット禁止ポリシー
│   ├── cdp-snapshot-client.ts  # CDP WebSocket クライアント (HeapProfiler.takeHeapSnapshot)
│   ├── cdp-snapshot-client.spec.ts
│   ├── load-driver.ts          # LoadDriver の合成
│   ├── load-driver.spec.ts
│   ├── rss-time-series-logger.ts  # CDP Runtime.evaluate で process.memoryUsage() を取得
│   ├── rss-time-series-logger.spec.ts
│   ├── run-scenario.ts         # CLI エントリポイント (exit code 0/1/2)
│   ├── run-scenario.spec.ts
│   ├── scenarios/
│   │   ├── baseline.ts         # idle phase
│   │   ├── load.ts             # 7 op を混在実行
│   │   ├── drain.ts            # idle phase (post-load)
│   │   └── scenarios.spec.ts
│   └── lib/
│       ├── installer-driver.ts # /api/v3/installer/ 経由の admin 作成
│       ├── http-client.ts      # undici-based cookie-aware HTTP client
│       └── yjs-client.ts       # ws + minimal Y.Doc client (open/close/abort)
```

- **テスト**: 58 unit tests 全 pass（`pnpm --filter @growi/bin test`）
- **依存**: `ws`（runtime）、`vitest`（dev）。`undici` は Node.js 標準。
- **所有者の現状**: `memory-leak-investigation` spec が当初 design.md でツール構造を記述していたが、その記述は本 spec 確立後に削除され、memory-leak-investigation からは本 spec への参照のみが残る（**片方向参照**: investigation → profiler）。
- **出力先**: `apps/app/tmp/memory-leak-investigation/runs/{before,after}/`（命名は歴史的経緯。本 spec で `apps/app/tmp/memory-profiler/runs/` への移行を扱うかは要検討）。

## Desired Outcome

- `bin/memory-profiler/` の現状のアーキテクチャ・interface・operational procedure を、本 spec の requirements / design として **公式仕様化** する。コードは原則変更しない（必要な小修正のみ）。
- 今後 `bin/memory-profiler/` に変更を加える際、本 spec が **change review の基準** として参照される。
- 新しい memory 調査が始まった際、調査担当者は memory-leak-investigation を読まずに本 spec だけでツールの使い方とアーキテクチャを理解できる。
- どの interface が stable（外部・将来の調査者向け）でどこが internal（実装詳細）かを明文化し、Module Public Surface ルールに沿った形で記述する。

## Approach

**Baseline-only ドキュメント spec**。コード変更は最小限に抑え、現状を「凍結 + 公式化」する。

具体的には:
1. requirements.md で「ツールが提供すべき機能」を AC 形式で記述（既存のツールが満たしている範囲を仕様として固定）。
2. design.md で現在のアーキテクチャ（CDP layer / Load driver / Scenarios / RSS logger / Run scenario orchestrator / `@growi/bin` workspace 構成）を記述し、Boundary Commitments / Out of Boundary / Allowed Dependencies / Revalidation Triggers を明示。
3. tasks.md は **既に実装済みの状態を spec 形式に落とす validation タスク**（lint / test / interface 安定性チェック）のみで構成。新規実装タスクは原則ゼロ。
4. memory-leak-investigation との関係は brief.md / design.md の Related Specs セクションで「歴史的に同ツールを利用した調査の一例」として軽く触れるに留める（オーナーシップの引き継ぎではない）。

## Scope

- **In**:
  - `bin/memory-profiler/` 配下の全モジュール（cdp-snapshot-client / load-driver / rss-time-series-logger / run-scenario / scenarios/* / lib/*）のアーキテクチャ仕様化
  - `@growi/bin` workspace package 定義 (`bin/package.json`) の仕様化
  - CLI interface（`run-scenario.ts` の引数 / env var / exit code）の stable contract 定義
  - LoadDriver の interface（page CRUD / search / yjs op の関数シグネチャ）の stable contract 定義
  - Operational procedure（起動手順、出力レイアウト、heap snapshot 非コミットポリシー）の文書化
  - Test 戦略（unit test の scope、scenario の fake-LoadDriver テストパターン）の仕様化
  - Future evolution path のリスト化（OTLP receiver 連携、distinct run dir、シナリオ DSL 化 等）— 着手は別 spec
- **Out**:
  - `apps/app` の server-side コード（mongoose-utils, opentelemetry config, page-operation 等）— それぞれの owner spec の責務
  - 具体の memory leak 調査結果（L1-L5 verdicts）— `memory-leak-investigation` の責務
  - tool の汎用 npm package 化 / 公開
  - 本 spec を起点とした新機能実装（dist server サポート、OTLP 連携、scenario DSL 等）— follow-up spec で扱う
  - 出力ディレクトリの rename（`tmp/memory-leak-investigation/` → `tmp/memory-profiler/`）の判断 — 要検討項目として記録するが、本 spec では結論を出さない

## Boundary Candidates

- **CDP Communication Layer** — `cdp-snapshot-client.ts` のみが CDP WebSocket / `HeapProfiler.takeHeapSnapshot` の知識を持つ。他モジュールから CDP プロトコルが直接見えない単一接点。
- **Load Generation Layer** — `lib/` 配下（HTTP client / yjs client / installer driver）と `load-driver.ts`。GROWI server に対する全ての send-side インタラクションを集約。
- **Scenario Layer** — `scenarios/{baseline,load,drain}.ts` の各シナリオ定義と、それを直列実行する `run-scenario.ts`。op 回数の const 定義が source of truth。
- **Observation Layer** — `rss-time-series-logger.ts`。CDP `Runtime.evaluate` 経由で `process.memoryUsage()` を読み、CSV に追記。snapshot 取得とは別経路。
- **Package / Workspace Boundary** — `bin/package.json` + `pnpm-workspace.yaml` の `bin` 登録。`@growi/bin` は private で、`apps/app` への依存方向ゼロ。

## Out of Boundary

- GROWI server プロセス内のコード（profiling target としてのみ扱い、変更は other spec）
- OpenTelemetry SDK の構成（`opentelemetry` spec の責務）
- y-websocket の persistence プロトコル（`collaborative-editor` spec の責務）
- MongoDB / Elasticsearch / Prisma の構成（各 owner spec / external 責務）
- 別環境（CI / GitHub Actions 等）への組み込み — 現状は devcontainer ローカルのみ前提
- Heap snapshot ファイル本体の管理（リポジトリにコミットしない方針は引き継ぐが、外部ストレージへのアップロード等は out of scope）

## Upstream / Downstream

- **Upstream**:
  - **devcontainer** (`.claude/rules/devcontainer.md`) — `mongo:27017` (replica set rs0) / `elasticsearch:9200` への到達性を前提とする
  - **`opentelemetry` spec** — custom metrics の存在を観測対象として認識（直接の依存はないが、profiling 中の OTel エクスポート挙動を考慮）
  - **`collaborative-editor` spec** — y-websocket セッションの open / close / abort を負荷の一部として使用
- **Downstream**:
  - **`memory-leak-investigation` spec（既存）** — 本 spec のツールを使って Phase 6（mandatory re-measurement: OTel 有効化下計測 / Yjs sustained-load / L4 retainer / dist server）を進める。同 spec からは本 spec を参照するが、本 spec は memory-leak-investigation の内容を一切参照しない（片方向）。
  - 将来の memory 調査（新しい spot spec）が本 spec のツールを utilize して走る可能性
  - OTLP receiver 連携、dist server サポート、scenario DSL 化、CI 組み込み等の follow-up spec が本 spec をベースに発生する可能性

## Existing Spec Touchpoints

- **Extends**: なし（独立ベースライン）
- **Adjacent / Downstream consumer**:
  - `memory-leak-investigation` — 本ツールを利用する **downstream consumer**。investigation → profiler の **片方向参照**。memory-leak-investigation 側からは本 spec を参照するが、本 spec は investigation の調査内容や verdict には一切依存しない。
  - `opentelemetry` — profiling 中の OTel exporter 挙動 / custom metrics 観測に隣接。直接の依存はない。
  - `collaborative-editor` — yjs セッション API の consumer として隣接。
  - `growi-logger` — ツール内では `growi-logger` は使わず `console` / scenario の stdout summary を採用している点を design.md で明記。

## Constraints

- **Technology**:
  - Node.js v24（CDP / WebSocket / `node:inspector` の挙動に依存）
  - `ws` ^8.17.1（runtime）、`vitest` ^3.2.4（dev）
  - `undici` は Node.js 標準として利用、追加 dependency なし
- **Workspace**:
  - `pnpm-workspace.yaml` の `bin` エントリで `@growi/bin` を登録済み
  - `apps/app` → `bin/` の依存方向はゼロ（profiling は HTTP / WS 越し駆動のみ）
- **Devcontainer**:
  - `mongo:27017` / `elasticsearch:9200` を前提（接続性チェックは行わない）
  - Inspector endpoint（`:9229`）は devcontainer ローカルでのみ listen
- **Output**:
  - 既存出力先 `apps/app/tmp/memory-leak-investigation/runs/` を当面踏襲（rename は本 spec の範囲外）
  - Heap snapshot ファイルはリポジトリにコミットしない（`.gitignore` で除外、verification record は spec 内に集計値のみ）
- **Production**:
  - Profiling tool は devcontainer / ローカル開発専用。production server への接続や本番環境での使用は想定外。
- **Cross-platform**:
  - Devcontainer 内 Linux で動作確認済み。Windows / macOS ホストからの実行は確認していない（要記述 in design.md）。
