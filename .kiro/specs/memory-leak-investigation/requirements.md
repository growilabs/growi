# Requirements Document

## Introduction

本 spec は、GROWI のサーバサイド (`apps/app`, Node.js) のメモリ特性を計測・最適化する。静的解析レポート（[research.md](./research.md)）の 5 findings (L1-L5) を、devcontainer 環境で実行可能となった dynamic profiling で **裏付ける／棄却する** ことを軸に、確認できた問題に対してのみ修正と監視を導入する。最終成果物は、(1) ベースライン RSS の低減（L1+L2）、(2) リーク面の常時可観測化（L3 metric）、(3) 検証根拠を残した `verification-report.md`、の 3 点。

> **依存スペック**: profiling ツール本体（`bin/memory-profiler/` / `@growi/bin`）の実装・設計・interface 定義は別 spec `memory-profiler` の責務。本 spec は consumer（片方向参照）。

詳細な背景・アプローチ・スコープは [brief.md](./brief.md) を参照。

## Boundary Context

- **In scope**:
  - 5 findings (L1-L5) の検証と、確認できたものに対する fix。
  - `y-websocket` が保持する Y.Doc 数の runtime metric 追加。
  - 環境変数による pool size / auto-instrumentation 範囲の baseline-bloat 削減。
  - `memory-profiler` ツールを利用した検証セッションと verification report への結果集約。
- **Out of scope**:
  - profiling ツール本体（`bin/memory-profiler/`）の実装・設計（別 spec の責務）。
  - ブラウザ／クライアント側のメモリ分析。
  - OpenTelemetry SDK ライフサイクル設計の再構築（`opentelemetry` spec の責務）。
  - 既存メトリクス（`growi.*` / `system.*` / `process.*`）の名称・schema 変更。
  - `y-websocket` persistence プロトコルの設計変更（`collaborative-editor` spec の責務）。
  - GROWI.cloud 本番監視ダッシュボードの設定変更。
- **Adjacent expectations**:
  - **`memory-profiler` spec** — profiling ツールの interface と起動手順は同 spec の責務。本 spec は consumer。
  - `opentelemetry` spec — custom-metrics 合成基盤（`setupCustomMetrics()`）が `yjs-metrics.ts` の受け皿。metric 命名・unit 規約は同 spec に準拠。
  - `collaborative-editor` spec — `y-websocket` の `docs` Map の取り扱いは本 spec から変更しない。L3 sweeper 実装時は既存 close 判定パスとの整合が必要。
  - devcontainer の `mongo:27017` (rs0) と `elasticsearch:9200` は常時到達可能前提。

## Requirements

### Requirement 1: 検証ツールの利用と検証成果物の保存

**Objective:** メモリ調査担当者として、`memory-profiler` の profiling ツールを利用し、各 finding を実測値で裏付け／棄却できる状態にする。

#### Summary
- `memory-profiler` の Baseline / Load / Drain シナリオ実行ツールを利用して、devcontainer 内で 1 回の調査セッションを完遂できる。
- 取得した heap snapshot と RSS 時系列ログを `apps/app/tmp/memory-leak-investigation/runs/{before,after,...}/` 配下に保管し、リポジトリには直接コミットしない。
- ツール起動・snapshot 取得・シナリオ実行のいずれかが失敗した場合、失敗内容を verification-report に記録する。

### Requirement 2: 検証シナリオの op 設定

**Objective:** メモリ調査担当者として、シナリオに渡す op count / idle duration を本調査の目的に合わせて設定し、L1-L5 各 finding が観測できる規模で検証する。

#### Summary
- `memory-profiler` の env var / CLI 引数（`LOAD_PAGE_*` / `LOAD_YJS_*` / `BASELINE_IDLE_SECONDS` / `DRAIN_IDLE_SECONDS`）を調整可能にする。
- 必要な負荷規模を Phase 6 で達成する: L3 (Yjs sessions ≥ 50, drain ≥ 300s) / L4 (page-edit ≥ 20, drain ≥ 300s) / L1+L2 ランタイム (baseline ≥ 300s)。
- production `dist/server/app.js` 起動下での 1 周計測を完遂する（Prisma ESM/CJS 不整合の解消を含む）。

### Requirement 3: ベースライン RSS の削減（L1 + L2）

**Objective:** GROWI.cloud の運用担当者として、テナント専用 `apps/app` コンテナのベースライン RSS を、機能を損なわずに 20–40 MB 程度削減し、ノードプール密度を改善したい。

#### Summary
- MongoDB 接続プールの上限・下限を env var で制御可能とし、default を driver の従来値（100）より小さい値に設定する（最終 default: `MONGO_MAX_POOL_SIZE=15` / `MONGO_MIN_POOL_SIZE=2`）。
- OpenTelemetry の auto-instrumentation を GROWI が実際に利用する範囲（`http` / `express` / `mongodb` / `mongoose`）のみに限定する。
- 運用者が従来の挙動（pool 上限引き上げ等）を必要とする場合、env var による override 手段を提供し再ビルドなしで切り替えられる。OTel instrumentation は最終形では env var 切り替えなしの direct-import に固定（追加が必要なら `node-sdk-configuration.ts` を編集）。
- L1+L2 を適用したビルドで Requirement 2 の検証シナリオを実行した時、verification report に Baseline RSS 差分を MB 単位で記録する。
- 既存の機能要件（page CRUD、検索、認証、y-websocket 編集、OTel メトリクス／トレース送出）を破壊しない。

### Requirement 3-bis: L1 / L2 ランタイム計測の完了

**Objective:** L1 / L2 の効果を production 相当のランタイム条件下で実測値として残し、定量的根拠を verification report に記録する。

#### Summary
- `OPENTELEMETRY_ENABLED=true` でのランタイム計測を before/after 両方で実施し、L2 による baseline RSS 削減量を MB 単位で記録する。
- MongoDB を空 DB に揃えた状態で before/after を再計測し、L1 の baseline RSS の比較値を記録する。
- 計測が devcontainer 制約で実施できない場合、制約と推奨計測環境を verification report に明記する。

### Requirement 4: y-websocket Y.Doc の常時可観測化（L3 metric）

**Objective:** GROWI.cloud の運用担当者として、`y-websocket` が保持する Y.Doc 数を本番環境で常時観測し、リーク兆候を OTel ダッシュボードで早期検知できるようにしたい。

#### Summary
- `y-websocket` が保持する collaborative document の現在件数を Observable Gauge として emit する。
- `opentelemetry` spec の custom-metrics 規約（命名・unit・登録手順）に従い、既存統合パスに組み込む。
- 既存エクスポート機構の周期に従って OTLP 受信側へ送出する。`otel:enabled=false` 時は登録・送出を行わない。
- 既存 OpenTelemetry 設定キー（`otel:*`）や既存メトリクスの名称・schema を変更しない。

### Requirement 5: 確認された問題のみへの限定的修正

**Objective:** 推測ベースの追加実装を避け、Requirement 2 で実測された問題のみに対して fix を入れ、機能変更の影響範囲を最小化する。

#### Summary
- **L3 sweeper (conditional)**: Drain 後 snapshot で y-websocket の collaborative document が Baseline 比で有意に残存していると確認された場合、idle-timeout sweeper を導入する。実装する場合は `collaborative-editor` spec の session 寿命ポリシーと整合する形（既存 `closeConn` 経由）で行う。
- **L4 backpressure (conditional)**: page-edit event chain の retained メモリが運用上問題となる量に達することが確認された場合、emitter ごとの同時 in-flight handler 数に上限を設けるバックプレッシャ機構を導入する。
- **L5 defensive logging (常時)**: `PageOperationService.autoUpdateExpiryDate` の自動更新タイマー処理内で発生した例外を捕捉し、`growi-logger` で構造化ログとして記録する。
- L3 / L4 の残存・滞留が観測されなかった場合、verification report に refuted または inconclusive として記録し、sweeper / backpressure を本 spec の対象から除外する。

> **Phase 6 確定**: L3 / L4 ともに **REFUTED**。L5 のみ実装。L3 sweeper / L4 backpressure は本 spec では実装しない。

### Requirement 6: 検証根拠を残す verification report と再現可能な調査手順

**Objective:** 将来の調査担当者が本 spec の検証結果と profiling 手順を再利用し、別環境や別バージョンでも同じ調査を再実施できる。

#### Summary
- 各 finding (L1–L5) ごとに **confirmed / refuted / inconclusive** と判定根拠の数値（snapshot 差分、retained constructor 数、RSS delta）を記録する。
- L1+L2 適用前後の Baseline RSS の比較を MB 単位で示し、20–40 MB 削減目標との到達度を記録する。
- 検証時の GROWI commit hash、Node.js version、MongoDB / Elasticsearch version、実行日時、シナリオ設定を記録する。
- 利用した `memory-profiler` の commit hash と本調査の env var / CLI 引数を記載する。手順本体は `memory-profiler` spec の README / design に従う。
- heap snapshot ファイル本体（数十〜数百 MB）はリポジトリにコミットせず、集計値・差分・観察事項のみコミットする。

### Requirement 7: 既存運用への非破壊性

**Objective:** GROWI.cloud の運用担当者として、本 spec の変更が production にデプロイされた後も、既存テナントの可用性・データ整合性・既存メトリクス／ダッシュボードを壊さないことを保証する。

#### Summary
- 本 spec で導入する全ての fix（L1, L2, L3 metric, L5）を有効化したビルドで、既存テナントの page CRUD・検索・認証・y-websocket 同時編集・OTel メトリクス／トレース送出を従来通り動作させる。
- env var による既存挙動への切り戻し手段を、pool size について提供する（OTel instrumentation は最終形では env var 切り替えなしで `node-sdk-configuration.ts` の直接編集に統一）。
- 追加・変更するコードについて、既存の lint / type-check / unit test / integration test を全て pass させる。
- 既存メトリクスの値が意味的に変化する場合、変化したメトリクスとその理由を verification report に運用者向けに明示する。
