# Requirements Document

## Introduction

本 spec は、GROWI のメモリ調査用 profiling ツール群（`bin/memory-profiler/`、`@growi/bin` workspace package）を「公式仕様」としてベースライン化することを目的とする。既に実装され 58 unit tests が green で稼働している現状のツールを、requirements / design / tasks の 3 文書として明文化することで、(1) 今後のツール変更時の change review 基準を確立し、(2) downstream の memory 調査 spec（`memory-leak-investigation` 等）が本ツールに対して安定した consumer-side dependency を持てるようにする。

本 spec は **baseline-only ドキュメント spec** であり、コード変更は最小限。新規実装タスクは原則ゼロ、validation タスク（lint / test / interface 安定性チェック）のみを設定する。

詳細な背景・アプローチ・スコープは [brief.md](./brief.md) を参照。

## Boundary Context

- **In scope**:
  - `bin/memory-profiler/` 配下のすべてのモジュール（CDP snapshot client / load driver / lib / scenarios / rss-time-series logger / run-scenario）の振る舞い仕様化
  - `@growi/bin` workspace package（`bin/package.json` + `pnpm-workspace.yaml` 登録）の境界定義
  - CLI interface（`run-scenario.ts` の引数・env var・exit code）の stable contract
  - LoadDriver の interface（op 関数のシグネチャ）の stable contract
  - Operational procedure（起動手順、出力ディレクトリ構造、heap snapshot 非コミットポリシー）の明文化
  - Test 戦略（unit test の scope、fake-LoadDriver による scenario test パターン）の明文化
- **Out of scope**:
  - `apps/app` の server-side コード変更（各 owner spec の責務）
  - 具体の memory 調査結果や finding（`memory-leak-investigation` 等の downstream spec の責務）
  - 本ツールを使った dist server 起動下での計測（`memory-leak-investigation` Phase 6 の責務）
  - OTLP receiver 連携、scenario DSL 化、CI 組み込み等の新機能（follow-up spec で扱う）
  - 汎用 npm package 化 / 外部公開
- **Adjacent expectations**:
  - 本 spec は **downstream consumer から参照される側**。`memory-leak-investigation` 等は本 spec が定義する CLI / interface に対して片方向参照を持つが、本 spec は consumer の調査内容に依存しない。
  - devcontainer の `mongo:27017`（replica set `rs0`）/ `elasticsearch:9200` / Node.js v24（`--inspect`）が到達可能である前提を取る（参照: `.claude/rules/devcontainer.md`）。
  - GROWI server 側に追加の signal handler や env var は要求しない（CDP-only 方針）。

## Requirements

### Requirement 1: Baseline / Load / Drain 3 段階シナリオの順次実行

**Objective:** メモリ調査担当者として、Baseline（idle）→ Load（負荷）→ Drain（idle）の 3 段階を 1 セッション内で順序通り実行し、各段階の境界を後から識別可能な計測結果を得たい。

#### Acceptance Criteria

1. When 調査担当者が scenario runner を起動した時, the memory profiling toolchain shall Baseline → Load → Drain の 3 段階を順序通り直列実行し、最後まで完了するか途中で失敗するかのいずれかで終了する。
2. While 各段階を実行中である間, the memory profiling toolchain shall 現在の phase 名（`baseline` / `load` / `drain`）を識別可能な形で観測ログ（CSV）に記録する。
3. When 調査担当者が `BASELINE_IDLE_SECONDS` / `DRAIN_IDLE_SECONDS` を環境変数で指定した時, the memory profiling toolchain shall 指定値（秒）を idle 期間として採用する。指定がない場合は default `300` を採用する。
4. When 調査担当者が `LOAD_PAGE_CREATE` / `LOAD_PAGE_EDIT` / `LOAD_PAGE_GET` / `LOAD_PAGE_LIST` / `LOAD_PAGE_SEARCH` / `LOAD_YJS_CLEAN_CLOSE` / `LOAD_YJS_ABORT` を環境変数で指定した時, the memory profiling toolchain shall 各 op の実行回数として指定値を採用する。指定がない場合は scenario module で定義された default を採用する。
5. The memory profiling toolchain shall 同じ env var / CLI 引数で起動された 2 回のセッションが、phase 順序・op 実行回数・出力ファイル命名規約のすべてで再現可能な結果を生成する。

### Requirement 2: CDP 経由の Heap Snapshot 取得

**Objective:** メモリ調査担当者として、各 phase 境界で GROWI server の heap snapshot を取得し、retained constructor の比較分析を行いたい。

#### Acceptance Criteria

1. When scenario runner が Baseline phase の終了時刻に達した時, the memory profiling toolchain shall snapshot A を取得し `.heapsnapshot` ファイルとして出力ディレクトリに保存する。
2. When scenario runner が Load phase の終了時刻に達した時, the memory profiling toolchain shall snapshot B を取得し `.heapsnapshot` ファイルとして出力ディレクトリに保存する。
3. When scenario runner が Drain phase の終了時刻に達した時, the memory profiling toolchain shall snapshot C を取得し `.heapsnapshot` ファイルとして出力ディレクトリに保存する。
4. While GROWI server の inspector endpoint (`--inspect=0.0.0.0:9229` 等) が listen 中である間, the memory profiling toolchain shall CDP (Chrome DevTools Protocol) 経由で server に接続し snapshot を取得する。
5. If inspector endpoint への接続が失敗した場合, the memory profiling toolchain shall 一定回数まで再試行を行い、それでも接続できない場合は exit code 2（接続失敗）で終了する。
6. If snapshot 取得自体が失敗した場合, the memory profiling toolchain shall exit code 1（snapshot 取得失敗）で終了し、すでに開いている接続は確実に close する。GROWI server プロセスは停止させない。

### Requirement 3: HTTP + yjs の混在負荷生成

**Objective:** メモリ調査担当者として、Load phase 中に GROWI の実利用に近い HTTP / WS 負荷を生成し、メモリ挙動を測定したい。

#### Acceptance Criteria

1. When Load phase が開始された時, the memory profiling toolchain shall page 作成・page 編集・page 取得・page list・page search（Elasticsearch search endpoint 経由）・yjs session の clean close・yjs session の abort（NAT half-close 相当）の 7 種類の op を、scenario module で指定された比率で混在実行する。
2. While load driver が op を発行中である間, the memory profiling toolchain shall installer endpoint 経由で admin user を作成し、以降の HTTP リクエストに cookie-aware セッションを維持する。
3. While `pageSearch` op を実行中である間, the memory profiling toolchain shall 固定の query 文字列パターンを用いて、複数回実行しても入力条件が変化しないようにする。
4. While yjs session の abort op を実行中である間, the memory profiling toolchain shall TCP RST 相当の半閉鎖（clean close フレームを送らずに socket を destroy）を試行する。
5. The memory profiling toolchain shall LoadDriver の各 op 関数（`pageCreate` / `pageEdit` / `pageGet` / `pageList` / `pageSearch` / `yjsSessionCleanClose` / `yjsSessionAbort`）のシグネチャを stable contract として維持し、count パラメータを受け取り Promise を返す形式から変更しない。

### Requirement 4: RSS 時系列の観測と記録

**Objective:** メモリ調査担当者として、Baseline / Load / Drain の全期間で GROWI server プロセスの RSS / V8 heap 統計を時系列に取得し、phase ごとの平均値や trend を後から計算できるようにしたい。

#### Acceptance Criteria

1. While scenario runner が稼働中である間, the memory profiling toolchain shall 1 秒以下の一定間隔で GROWI server プロセスの RSS / V8 heap used / V8 heap total / external メモリの各値を取得する。
2. The memory profiling toolchain shall 取得値を CSV 形式（schema: `timestamp,phase,rss,heap_used,heap_total,external`）で出力する。
3. When phase が切り替わった時, the memory profiling toolchain shall 当該行の `phase` 列に新しい phase 名（`baseline` / `load` / `drain`）を記録する。
4. If 出力先 CSV ファイルが既に存在する場合, the memory profiling toolchain shall 既存ファイルを `rss-timeseries.{ISO8601}.csv` 形式でアーカイブしてから新規ファイルを作成する。

### Requirement 5: 出力ファイル管理ポリシー

**Objective:** ローカル開発担当者として、profiling の出力ファイルが誤ってリポジトリにコミットされないことと、複数回の実行結果を識別可能な形で隔離できることを保証したい。

#### Acceptance Criteria

1. The memory profiling toolchain shall 出力ファイルを `apps/app/tmp/memory-leak-investigation/` 配下の指定された run ディレクトリ（既定: `runs/<name>/`）に書き出す。
2. The memory profiling toolchain shall `.heapsnapshot` 拡張子のファイルが `.gitignore` 等のリポジトリ除外ルールでコミット対象から外れていることを README で明示する。
3. The memory profiling toolchain shall snapshot ファイルの命名を `snapshot-{a,b,c}.heapsnapshot` 形式（または等価な phase 識別可能な形式）に統一する。
4. When 同じ run ディレクトリへの 2 回目の実行が行われた時, the memory profiling toolchain shall 既存の snapshot を上書きするか、または明確に区別可能な命名で並存させる。

### Requirement 6: CLI / 環境変数 contract の stable interface

**Objective:** 隣接 spec の調査担当者として、本ツールを起動する CLI と環境変数の名前・意味が容易に変更されないことを期待し、investigation spec から再現性を持って参照できるようにしたい。

#### Acceptance Criteria

1. The memory profiling toolchain shall CLI 引数 `--baseUrl <url>`（GROWI server の base URL）、`--inspector <url>`（inspector endpoint）、`--outputDir <path>`（出力ディレクトリ）を提供する。
2. The memory profiling toolchain shall `BASELINE_IDLE_SECONDS` / `DRAIN_IDLE_SECONDS` / `LOAD_PAGE_CREATE` / `LOAD_PAGE_EDIT` / `LOAD_PAGE_GET` / `LOAD_PAGE_LIST` / `LOAD_PAGE_SEARCH` / `LOAD_YJS_CLEAN_CLOSE` / `LOAD_YJS_ABORT` の 9 種類の env var で挙動を制御可能とする。
3. The memory profiling toolchain shall exit code を以下のとおり定義し維持する: `0` = 成功、`1` = snapshot 取得失敗、`2` = inspector 接続失敗。
4. Where 本 spec の change review プロセス上で CLI 引数 / env var 名 / exit code 体系の変更が提案された場合, the memory profiling toolchain shall その変更を **breaking change** として扱い、本 spec の更新と downstream spec への影響評価を伴うことを README / design に明記する。
5. The memory profiling toolchain shall 起動コマンドの代表例（GROWI server を `--inspect` 付きで起動 → scenario runner を起動 → 出力ファイルの所在）を `bin/memory-profiler/README.md` に記載する。

### Requirement 7: `@growi/bin` workspace package としての境界

**Objective:** GROWI 開発者として、profiling ツールが `apps/app` から完全に切り離された独立 package として存在し、production runtime に影響しないことを保証したい。

#### Acceptance Criteria

1. The memory profiling toolchain shall `bin/package.json` に `@growi/bin` という workspace package として宣言され、`pnpm-workspace.yaml` の `bin` エントリで認識される。
2. The memory profiling toolchain shall `@growi/bin` の `dependencies` / `devDependencies` を、profiling を実行するために必要な範囲（`ws`, `vitest` 等）に限定し、`apps/app` への直接の workspace 依存（`@growi/app` 等）を持たない。
3. The memory profiling toolchain shall `apps/app` の production 成果物（`apps/app/dist/`、`apps/app/.next/`）に本 package のコードが含まれないようにする。
4. While 本ツールが起動中である間, the memory profiling toolchain shall GROWI server プロセスに対する作用を CDP（観測）と HTTP / WS（負荷生成）の 2 経路のみに限定し、`apps/app` の signal handler や追加 env var に依存しない。

### Requirement 8: Test 戦略

**Objective:** ツールメンテナとして、本ツールの interface が CI / lint パスでの最小限の検証で stable であることを継続的に確認できるようにしたい。

#### Acceptance Criteria

1. When `pnpm --filter @growi/bin test` が実行された時, the memory profiling toolchain shall 全 unit test が green になる状態を維持する。
2. The memory profiling toolchain shall LoadDriver と scenario module の test において、実 GROWI server を起動せずに fake-LoadDriver を用いる pattern を提供する。
3. Where scenario module の test に新しい op が追加される場合, the memory profiling toolchain shall fake-LoadDriver が当該 op を mock 可能であることを要求する。
4. The memory profiling toolchain shall co-located test 配置（`*.spec.ts` を実装ファイルの隣に置く）を守り、test ファイルの位置を変更しない。

### Requirement 9: Downstream consumer に対する stable interface 提供

**Objective:** `memory-leak-investigation` や将来の memory 調査 spec の担当者として、本 spec が定義するツールを安定した downstream contract として扱い、調査内容と独立にツールを利用できるようにしたい。

#### Acceptance Criteria

1. The memory profiling toolchain shall `memory-leak-investigation` を含むすべての downstream consumer の調査内容・verdict・finding に対し、ツール本体の挙動が依存しない（片方向参照: consumer → tool）。
2. Where downstream consumer が本ツールを利用する場合, the memory profiling toolchain shall env var / CLI 引数 / exit code / 出力ファイル命名規約のみで consumer-side の判断を表現できるようにする（ツール内部の改変を要求させない）。
3. While ツール本体の変更レビュー中である間, the memory profiling toolchain shall 既存の downstream consumer（`memory-leak-investigation` 等）の参照仕様との整合性を確認することを change review プロセスとして要求する（design.md に明記）。
4. If downstream consumer 由来の新規要望（新シナリオ、新メトリクス、dist server サポート等）が発生した場合, the memory profiling toolchain shall それらを本 spec の更新または follow-up spec のいずれで受けるかを判断するルートを提供する（汎用化は別 spec で扱う方針を明記する）。
