# Requirements Document

## Introduction

本 spec は、GROWI のサーバサイド (`apps/app`, Node.js) のメモリ特性を計測・最適化する。`claude/investigate-growi-memory-leaks-09kl4` ブランチで作成された静的解析レポート（[research.md](./research.md)）の 5 findings (L1-L5) を、devcontainer 環境で実行可能となった dynamic profiling で **裏付ける／棄却する** ことを軸に、確認できた問題に対してのみ修正と監視を導入する。最終成果物は、(1) ベースライン RSS の低減（L1+L2）、(2) リーク面の常時可観測化（L3 metric）、(3) 検証根拠を残した `verification-report.md`、の 3 点である。

> **依存スペック**: profiling ツール本体（`bin/memory-profiling/` / `@growi/bin`）の実装・設計・interface 定義は別 spec `memory-profiler` の責務。本 spec は同ツールの **consumer** であり、片方向参照（investigation → profiler）。

詳細な背景・アプローチ・スコープは [brief.md](./brief.md) を参照。

## Boundary Context

- **In scope**:
  - 静的解析で確認済の 5 findings (L1-L5) の検証および、確認できたものに対する fix。
  - `y-websocket` が保持する Y.Doc 数の runtime metric 追加（既存 OpenTelemetry custom-metrics レイヤへ）。
  - 環境変数で挙動を制御可能な形での baseline-bloat 削減（pool size、auto-instrumentation 範囲）。
  - `memory-profiler` ツールを利用した検証セッションの実行と、verification report への結果集約。
- **Out of scope**:
  - **`memory-profiler` ツール本体（`bin/memory-profiling/`）の実装・設計・interface 定義** — 別 spec の責務。
  - ブラウザ／クライアント側のメモリ分析。
  - OpenTelemetry SDK ライフサイクル設計の再構築（`opentelemetry` spec の責務）。
  - `BatchSpanProcessor` / `PeriodicExportingMetricReader` のパラメータ全面チューニング。
  - 既存メトリクス（`growi.*` / `system.*` / `process.*`）の名称変更・schema 変更。
  - `y-websocket` persistence プロトコルの設計変更（`collaborative-editor` spec の責務）。
  - GROWI.cloud 本番監視ダッシュボードの設定変更。
- **Adjacent expectations**:
  - **`memory-profiler` spec** — 本 spec は同 spec が提供する profiling ツール（CDP snapshot client / load driver / scenarios / RSS logger / run-scenario）の **consumer**。ツールの interface と起動手順は `memory-profiler` spec の責務。本 spec は同 spec を **参照のみ**（依存方向は investigation → profiler の片方向）。
  - `opentelemetry` spec（`phase: implementation-complete`）の custom-metrics 合成基盤（`setupCustomMetrics()`）は本 spec が新規モジュール `yjs-metrics.ts` を追加する受け皿として維持される。metric 命名・unit 規約は同 spec に準拠する。
  - `collaborative-editor` spec が定義する `y-websocket` の `docs` Map の取り扱いは本 spec から変更しない。L3 mitigation の sweeper を実装する場合は、close 判定ロジックを `collaborative-editor` の責務と衝突しない範囲に留める。
  - devcontainer の MongoDB (`mongo:27017`, replica set `rs0`) および Elasticsearch (`elasticsearch:9200`) は常時到達可能である前提を取る（参照: `.claude/rules/devcontainer.md`）。

## Requirements

### Requirement 1: 検証ツールの利用と検証成果物の保存

**Objective:** メモリ調査担当者として、`memory-profiler` spec が提供する profiling ツール（`bin/memory-profiling/`）を利用し、各 finding を実測値で裏付け／棄却できる状態にする。

#### Acceptance Criteria

1. The investigation workflow shall `memory-profiler` spec が定義する Baseline / Load / Drain シナリオ実行ツールを利用して、devcontainer 内で 1 回の調査セッションを完遂できる。ツール本体の要件・設計・interface は `memory-profiler` spec に従う。
2. The investigation workflow shall 取得した heap snapshot および RSS 時系列ログを `apps/app/tmp/memory-leak-investigation/runs/{before,after,...}/` 配下に保管し、リポジトリには直接コミットしない。
3. If ツール起動・snapshot 取得・シナリオ実行のいずれかが失敗した場合, the investigation workflow shall 失敗内容を verification-report に記録する（ツール側の挙動仕様は `memory-profiler` spec の責務）。

> **Reference**: profiling ツールの実装・interface・operational procedure は `.kiro/specs/memory-profiler/` を参照。本 spec はそのツールの **consumer** であり、ツール開発の責務は持たない。

### Requirement 2: 検証シナリオの op 設定

**Objective:** メモリ調査担当者として、`memory-profiler` のシナリオに渡す op count / idle duration を本調査の目的に合わせて設定し、L1-L5 各 finding が観測できる規模で検証する。

#### Acceptance Criteria

1. The investigation workflow shall `memory-profiler` の env var / CLI 引数（`LOAD_PAGE_CREATE`, `LOAD_PAGE_EDIT`, `LOAD_PAGE_GET`, `LOAD_PAGE_LIST`, `LOAD_PAGE_SEARCH`, `LOAD_YJS_CLEAN_CLOSE`, `LOAD_YJS_ABORT`, `BASELINE_IDLE_SECONDS`, `DRAIN_IDLE_SECONDS`）を本調査の目的に合わせて設定する。
2. The investigation workflow shall 各 finding の検証に必要な負荷規模（L3: Yjs sessions ≥ 50、drain ≥ 300s。L4: page-edit ≥ 20、drain ≥ 300s。L1/L2 ランタイム: baseline ≥ 300s）を Phase 6 で達成する。
3. The investigation workflow shall production `dist/server/app.js` 起動下での 1 周計測を完遂する（Prisma ESM/CJS 不整合の解消を含む）。

> **Reference**: 各シナリオの op count default / interface は `memory-profiler` spec を参照。

### Requirement 3: ベースライン RSS の削減（L1 + L2）

**Objective:** GROWI.cloud の運用担当者として、テナント専用 `apps/app` コンテナのベースライン RSS を、機能を損なわずに 20–40 MB 程度削減し、ノードプール密度を改善したい。

#### Acceptance Criteria

1. The GROWI server shall MongoDB 接続プールの上限を運用者が環境変数で制御可能とし、未指定時のデフォルトを、driver の従来デフォルト（100）より十分小さい値（目標: `10`）に設定する。
2. The GROWI server shall MongoDB 接続プールの下限を運用者が環境変数で制御可能とし、未指定時のデフォルトを `2` に設定する。
3. The GROWI server shall OpenTelemetry の auto-instrumentation を「GROWI が実際に利用する範囲」のみに限定して有効化し、それ以外をデフォルトで無効化する。有効化する具体的な instrumentation の集合は design phase で確定する。
4. Where 運用者が従来の挙動（接続プール上限の引き上げ、auto-instrumentation 全有効）を必要とする場合, the GROWI server shall 環境変数による override 手段を提供し、再ビルドなしで切り替えられる。
5. When L1 + L2 を適用したビルドで Requirement 2 の検証シナリオを実行した時, the verification report shall 適用前後の Baseline RSS の差分を数値（MB 単位）で記録し、有意な削減があったか判定可能な形にする。
6. The GROWI server shall L1 / L2 の変更によって既存の機能要件（page CRUD、検索、認証、y-websocket 編集、OTel メトリクス／トレース送出）を破壊しない。

### Requirement 3-bis: L1 / L2 ランタイム計測の完了

**Objective:** メモリ調査担当者として、L1 / L2 の効果を **production 相当のランタイム条件下で実測値として残し**、定量的根拠を verification report に記録できるようにしたい。

#### Acceptance Criteria

1. The verification workflow shall `OPENTELEMETRY_ENABLED=true` でのランタイム計測を before / after の両方で実施し、L2 (allow-list) による baseline RSS 削減量を MB 単位で記録する。
2. The verification workflow shall MongoDB を空 DB に揃えた状態で before / after を再計測し、L1 の baseline RSS（retained growth ではなく steady-state baseline）の比較値を記録する。
3. If 上記計測が devcontainer 制約で実施できない場合, the verification report shall 制約と推奨計測環境を明記する。

### Requirement 4: y-websocket Y.Doc の常時可観測化（L3 metric）

**Objective:** GROWI.cloud の運用担当者として、`y-websocket` が保持する Y.Doc 数を本番環境で常時観測し、リーク兆候を OTel ダッシュボードで早期検知できるようにしたい。

#### Acceptance Criteria

1. The GROWI server shall `y-websocket` が保持する collaborative document の現在件数を、時系列で観測可能な OpenTelemetry metric（Observable Gauge）として emit する。
2. The GROWI server shall 上記 metric を `opentelemetry` spec の custom-metrics 規約（命名・unit・登録手順）に従って既存の custom-metrics 統合パスに組み込む。
3. While GROWI server が稼働中である間, the GROWI server shall 既存の OpenTelemetry metrics エクスポート機構の周期に従って当該 metric を OTLP 受信側へ送出する。
4. When `otel:enabled` 設定が `false` である時, the GROWI server shall 当該 metric の登録および送出を行わない（既存 OpenTelemetry 無効化ポリシーを継承する）。
5. The GROWI server shall L3 metric の追加によって既存 OpenTelemetry 設定キー（`otel:*`）や既存メトリクスの名称・schema を変更しない。

### Requirement 5: 確認された問題のみへの限定的修正（L3 sweeper / L4 backpressure / L5 defensive logging）

**Objective:** メモリ調査担当者として、Requirement 2 で実測された問題のみに対して fix を入れ、推測ベースの追加実装を避けることで、機能変更の影響範囲を最小化したい。

#### Acceptance Criteria

1. Where Requirement 2 の Drain 後 snapshot で y-websocket の collaborative document が Baseline 比で有意に残存していると確認された場合, the GROWI server shall idle 状態の y-websocket セッションを検知してクローズする仕組み（idle-timeout sweeper）を導入する。
2. Where Requirement 2 で page-edit event chain の retained メモリが運用上問題となる量に達することが確認された場合, the GROWI server shall emitter ごとの同時 in-flight handler 数に上限を設けるバックプレッシャ機構を導入する。
3. The GROWI server shall `PageOperationService.autoUpdateExpiryDate` の自動更新タイマー処理内で発生した例外を捕捉し、`growi-logger` を介して構造化ログとして記録する（L5: dynamic 検証不要の defensive 変更として常に実装）。
4. If Requirement 2 で L3 / L4 の残存・滞留が **観測されなかった** 場合, the verification report shall その finding を refuted または inconclusive として記録し、sweeper / backpressure を本 spec の対象から除外する。
5. The GROWI server shall L3 sweeper を実装する場合、`collaborative-editor` spec が定義する `y-websocket` セッションの寿命ポリシーと整合する形（既存の close 判定パスを使う、または同等のフックを通す）で実装する。

### Requirement 6: 検証根拠を残す verification report と再現可能な調査手順

**Objective:** 将来のメモリ調査担当者として、本 spec で得られた検証結果と profiling 手順を再利用し、別環境や別バージョンでも同じ調査を再実施できるようにしたい。

#### Acceptance Criteria

1. The verification report shall 各 finding (L1, L2, L3, L4, L5) ごとに **confirmed / refuted / inconclusive** のいずれかの判定と、判定の根拠となる数値（snapshot 差分、retained constructor 数、RSS delta 等）を記録する。
2. The verification report shall L1 + L2 適用前後の Baseline RSS の比較を数値（MB 単位）で示し、Desired Outcome の「20–40 MB 削減」目標に対する到達度を記録する。
3. The verification report shall 検証時に使用した GROWI のコミットハッシュ、Node.js バージョン、MongoDB / Elasticsearch バージョン、実行日時、シナリオ設定（操作回数等）を記録する。
4. The investigation workflow shall 本 spec の verification-report 内で、利用した `memory-profiler` の commit hash と本調査の env var / CLI 引数を記載し、将来の調査担当者が同じ手順を再実行できるようにする。手順本体（起動コマンド、snapshot 取得方法、シナリオ実行スクリプトの場所と使い方）は `memory-profiler` spec の README / design に従う。
5. The investigation workflow shall heap snapshot ファイル本体（数十〜数百 MB）をリポジトリにコミットせず、verification report 内の集計値・差分・観察事項のみをコミット対象とする。

### Requirement 7: 既存運用への非破壊性

**Objective:** GROWI.cloud の運用担当者として、本 spec の変更が production にデプロイされた後も、既存テナントの可用性・データ整合性・既存メトリクス／ダッシュボードを壊さないことを保証したい。

#### Acceptance Criteria

1. The GROWI server shall 本 spec で導入する全ての fix（L1, L2, L3 metric, L5）を有効化したビルドで、既存テナントの page CRUD・検索・認証・y-websocket 同時編集・OTel メトリクス／トレース送出を従来通り動作させる。
2. Where 運用者が本 spec の挙動変更を一時的に無効化したい場合, the GROWI server shall 環境変数による既存挙動への切り戻し手段を、Requirement 3 で挙げた pool size と auto-instrumentation 範囲の両方について提供する。
3. The GROWI server shall 本 spec で追加・変更するコードについて、既存の lint / type-check / unit test / integration test を全て pass させる。
4. If 本 spec の変更によって既存メトリクス（`growi.*` / `system.*` / `process.*`）の値が **意味的に変化する** 場合, the verification report shall 変化したメトリクスとその理由を運用者向けに明示する。
