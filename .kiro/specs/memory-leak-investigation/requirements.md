# Requirements Document

## Introduction

本 spec は、GROWI のサーバサイド (`apps/app`, Node.js) のメモリ特性を計測・最適化する。`claude/investigate-growi-memory-leaks-09kl4` ブランチで作成された静的解析レポート（[research.md](./research.md)）の 5 findings (L1-L5) を、devcontainer 環境で実行可能となった dynamic profiling で **裏付ける／棄却する** ことを軸に、確認できた問題に対してのみ修正と監視を導入する。最終成果物は、(1) ベースライン RSS の低減（L1+L2）、(2) リーク面の常時可観測化（L3 metric）、(3) 検証根拠を残した `verification-report.md`、(4) 将来の調査で再利用可能な profiling 手順、の 4 点である。

詳細な背景・アプローチ・スコープは [brief.md](./brief.md) を参照。

## Boundary Context

- **In scope**:
  - Dynamic profiling の実行（devcontainer 上の `mongo:27017` / `elasticsearch:9200` を利用）と、その結果を残す verification report。
  - 静的解析で確認済の 5 findings (L1-L5) の検証および、確認できたものに対する fix。
  - `y-websocket` が保持する Y.Doc 数の runtime metric 追加（既存 OpenTelemetry custom-metrics レイヤへ）。
  - 環境変数で挙動を制御可能な形での baseline-bloat 削減（pool size、auto-instrumentation 範囲）。
  - 再利用可能な profiling スクリプトとシナリオの最小ドキュメント化。
- **Out of scope**:
  - ブラウザ／クライアント側のメモリ分析。
  - OpenTelemetry SDK ライフサイクル設計の再構築（`opentelemetry` spec の責務）。
  - `BatchSpanProcessor` / `PeriodicExportingMetricReader` のパラメータ全面チューニング。
  - 既存メトリクス（`growi.*` / `system.*` / `process.*`）の名称変更・schema 変更。
  - `y-websocket` persistence プロトコルの設計変更（`collaborative-editor` spec の責務）。
  - GROWI.cloud 本番監視ダッシュボードの設定変更。
  - Profiling フレームワークの汎用 npm package 化。
- **Adjacent expectations**:
  - `opentelemetry` spec（`phase: implementation-complete`）の custom-metrics 合成基盤（`setupCustomMetrics()`）は本 spec が新規モジュール `yjs-metrics.ts` を追加する受け皿として維持される。metric 命名・unit 規約は同 spec に準拠する。
  - `collaborative-editor` spec が定義する `y-websocket` の `docs` Map の取り扱いは本 spec から変更しない。L3 mitigation の sweeper を実装する場合は、close 判定ロジックを `collaborative-editor` の責務と衝突しない範囲に留める。
  - devcontainer の MongoDB (`mongo:27017`, replica set `rs0`) および Elasticsearch (`elasticsearch:9200`) は常時到達可能である前提を取る（参照: `.claude/rules/devcontainer.md`）。

## Requirements

### Requirement 1: Dynamic profiling 実行基盤

**Objective:** メモリ調査担当者として、devcontainer 内で GROWI server を profiling 可能な状態で起動し、任意のタイミングで heap snapshot を取得して保存できるようにしたい。これにより、静的解析の各 finding を実測値で裏付け／棄却できる。

#### Acceptance Criteria

1. When 調査担当者が profiling モードで GROWI server を起動した時, the profiling workflow shall devcontainer の `mongo:27017` (replica set `rs0`) と `elasticsearch:9200` に接続した状態で server を立ち上げ、外部の snapshot 取得ツールから到達可能な inspector インターフェースを公開する。
2. When 調査担当者が外部ツールから heap snapshot の取得を要求した時, the profiling workflow shall `.heapsnapshot` 形式のスナップショットを生成し、指定された出力ディレクトリ配下にファイル名で識別可能な形で保存する。
3. The profiling workflow shall heap snapshot およびその他の計測成果物（RSS 時系列ログ等）を `apps/app/tmp/memory-leak-investigation/` 配下に集約し、リポジトリには直接コミットされないパスへ書き出す。
4. If profiling 中に snapshot 取得が失敗した場合, the profiling workflow shall エラー内容を標準ログに出力した上で、GROWI server 本体の動作には影響を与えない（プロセスを停止させない）。

> **Note**: 初期 spec では SIGUSR2 in-process fallback（旧 Acceptance Criteria 3）を要求していたが、実装過程で CDP (Chrome DevTools Protocol) クライアントが信頼できる主経路として確立したため、SIGUSR2 経路は冗長と判断して削除した（commit `b8e3efa4c7`）。CDP 接続不能時の fallback が将来再び必要になった場合は本 spec で再評価する。

### Requirement 2: 検証シナリオの再現可能な実行

**Objective:** メモリ調査担当者として、Baseline / Load / Drain の 3 段階からなる検証シナリオを再現可能な形で実行し、各 finding (L1-L5) の前後で計測値を比較できるようにしたい。

#### Acceptance Criteria

1. The profiling workflow shall **Baseline**（boot 後の idle 状態）/ **Load**（page 操作と y-websocket セッションを含む負荷）/ **Drain**（負荷停止後の idle 状態）の 3 段階を 1 回の調査セッション内で順序通り実行できる手順を提供する。
2. When 調査担当者が Load 段階を実行した時, the profiling workflow shall page 作成・page 編集・y-websocket セッションの open/close／**clean close されない異常系セッション**（NAT half-close 相当）の各シナリオを混在させた負荷を生成する。
3. While 各段階を実行している間, the profiling workflow shall プロセスの RSS / V8 heap used / V8 heap total / external メモリの各値を一定間隔で時系列ログとして記録し、段階の境界（Baseline / Load / Drain）が後から特定できる形で残す。
4. The profiling workflow shall 各段階の境界（Baseline 終了時点 = snapshot A、Load 終了時点 = snapshot B、Drain 終了時点 = snapshot C）で heap snapshot を取得する。
5. When 同じ調査セッションを別環境で再実行した時, the profiling workflow shall シナリオ定義（操作の種類・回数・タイミング）が同一であれば、再現可能な範囲で比較可能な計測結果を生成する。
6. The profiling workflow shall production `dist/server/app.js` 起動下で 1 周の計測を完了できる（dev server 経由の SWC transpile / source-map overhead を含まない計測値も取得可能）。

> **Note**: AC 6 は実装過程で発覚した Prisma client の ESM/CJS 不整合（`ReferenceError: exports is not defined in ES module scope` on Node.js v24）への対応として Phase 6 で扱う。

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
4. The investigation workflow shall profiling 手順（起動コマンド、snapshot 取得方法、シナリオ実行スクリプトの場所と使い方）を本 spec 配下のドキュメントとして残し、将来の調査担当者が同じ手順を再実行できるようにする。
5. The investigation workflow shall heap snapshot ファイル本体（数十〜数百 MB）をリポジトリにコミットせず、verification report 内の集計値・差分・観察事項のみをコミット対象とする。

### Requirement 7: 既存運用への非破壊性

**Objective:** GROWI.cloud の運用担当者として、本 spec の変更が production にデプロイされた後も、既存テナントの可用性・データ整合性・既存メトリクス／ダッシュボードを壊さないことを保証したい。

#### Acceptance Criteria

1. The GROWI server shall 本 spec で導入する全ての fix（L1, L2, L3 metric, L5）を有効化したビルドで、既存テナントの page CRUD・検索・認証・y-websocket 同時編集・OTel メトリクス／トレース送出を従来通り動作させる。
2. Where 運用者が本 spec の挙動変更を一時的に無効化したい場合, the GROWI server shall 環境変数による既存挙動への切り戻し手段を、Requirement 3 で挙げた pool size と auto-instrumentation 範囲の両方について提供する。
3. The GROWI server shall 本 spec で追加・変更するコードについて、既存の lint / type-check / unit test / integration test を全て pass させる。
4. If 本 spec の変更によって既存メトリクス（`growi.*` / `system.*` / `process.*`）の値が **意味的に変化する** 場合, the verification report shall 変化したメトリクスとその理由を運用者向けに明示する。
