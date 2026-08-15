# Requirements Document

## Project Description (Input)

# Brief: flaky-ci-routine

## Problem

GROWI の CI（GitHub Actions, `ci-app.yml` / `ci-app-prod.yml`）で発生する flaky
test（非決定的に失敗するテスト）は、放置すると (1) PR のマージを妨げる無駄な
再実行を誘発し、(2) 本物の回帰と区別がつかず開発者の注意力を消耗させ、(3) 誰も
追跡していないため同じ flake が何度も踏まれる、という3つの実害を生む。人手で
CI ログを遡って「これは flaky か本物の回帰か」を判定し、issue化し、原因調査
まで行うのは継続的に回せる作業量ではない。

## Current State

このdiscovery時点で、既に以下が実装・運用中（既存実装の事後spec化）:

- `.claude/skills/detect-flaky-ci/` — CI run を時間窓でスキャンし、非決定的な
  失敗を検出して GitHub issue として追跡する（コード変更なし）
- `.claude/skills/investigate-flaky-test/` — `flaky/confirmed` または
  `flaky/suspected` の issue を調査し、原因分類・修正・PR作成まで行う
- `.claude/commands/flaky-ci-routine.md` — 上記2スキルを順に呼ぶオーケストレー
  ションコマンド
- cron ルーティン `growi-flaky-ci-routine`（1日3回、JST 9:00/17:00/1:00）が
  `/flaky-ci-routine` を無人実行
- 関連PR: #11701（下敷きとなる先行修正）, #11704, #11706, #11716, #11717（すべて
  マージ済み）
- 2026-08-14 時点の実運用結果: 初回runで新規issue 7件・自律的なマージ可能PR
  1件（#11715）を生成。実行中に2件の環境起因バグ（gh CLIバージョン差異、
  `gh api -f` のPOSTデフォルト挙動）を自己修正
- 2026-08-14 に既存ツールとの比較調査を実施（`research.md` 参照）。結論:
  同じ形（cross-run検出+GitHub Issue自動化+修正PRまでの一気通貫）を無料で
  やる現役ツールは実質存在しない。最も近かった Google の `flakybot` は
  2025年8月に廃止済み

## Desired Outcome

このspecが目指すのは「ゼロから機能を作る」ことではなく、既に動いている仕組み
の設計判断・既知の未解決課題を明文化し、今後の変更（改善・縮小・再設計いずれ
も）が根拠を持って進められる状態にすること。将来この仕組みに手を入れる人（人
間・エージェント問わず）が、`research.md` と本specを読めば「なぜこの形にした
か」「何がまだ未確定か」を再調査なしに把握できることがゴール。加えて、今回の
ツール調査で得た「可視化だけでもflaky率低減に効果がある」という知見を、常設
ダッシュボードissueという新規要件として組み込む。

## Approach

（提案ではなく、既に採用・実装済みの設計。ダッシュボードのみ本spec化時点での
新規追加）

- **3層の確信度**: `flaky/observing`（弱い単発観測）→ `flaky/suspected`
  （①diff/PR不一致 ②サンドイッチパターン ③matrix分岐 ④既存observingへの
  的を絞った深掘りbackfill、のいずれかにヒット）→ `flaky/confirmed`
  （playwrightは in-run retry で即座に、vitestは1回のみのrerunで実証してから）
- **時間窓ベースのスキャン**（`--window-hours`、既定はcron間隔の2倍）。固定
  件数(`--lookback`)は実行数の多い日に古い失敗を無音で取りこぼすため廃止
- **状態を持たない設計を維持**: 実行間の記憶は一切持たず、GitHub issue/label
  だけを状態として扱う（専用の状態issueを置く案は明示的に見送った、
  `research.md` 参照）
- **ツール選択の決定論性**: ログ取得手段（`gh` vs GitHub MCPサーバー）は実行
  開始時に一度だけ判定し、以降は固定する（per-log try/fallbackを明示的に
  却下）
- **検出と調査の分離**: `detect-flaky-ci` はコードに一切触れず、修正は
  `investigate-flaky-test` に委譲する
- **常設ダッシュボードissue（新規）**: 毎回のroutine実行時にcreate-or-update
  する単一のissueで、アクティブなflakyテストの一覧を俯瞰できるようにする。
  日次/週次のアーティファクト出力は不採用（理由は `research.md` 参照）

## Scope

- **In**: GROWI (`growilabs/growi`) の `ci-app.yml` / `ci-app-prod.yml` 上の
  vitest / playwright テストに対する flaky 検出・追跡・自律調査・修正PR作成、
  および常設ダッシュボードissueによる可視化
- **Out**:
  - 商用SaaS導入の検討・比較（調査対象外と明示済み、`research.md` 参照）
  - CIインフラそのものの信頼性向上（ネットワーク・OOM等のインフラ起因の失敗
    はdenylistで除外するのみで対象外）
  - 検出ロジックの完全なスクリプト化（機械的な部分のみ切り出す将来案として
    `research.md` に記録、今回は着手しない）

## Boundary Candidates

- 検出（`detect-flaky-ci`）と調査・修正（`investigate-flaky-test`）は既に
  スキル単位で分離されている
- 「機械的に決定できる部分」（①〜④の安価な判定、Step1.5のスキップリスト、
  時間窓計算）と「判断が必要な部分」（reopen可否、Playwright識別名のフォール
  バック、infra denylistの拡張）は、将来スクリプト化する場合の分割線として
  `research.md` に記録済み

## Out of Boundary

- 商用SaaSの導入検討
- CIインフラ自体の信頼性向上
- 検出ロジックの完全な非LLM化（将来の選択肢としてのみ記録）

## Upstream / Downstream

- **Upstream**: GitHub Actions の実行履歴、GitHub Issues/Labels、GitHub MCP
  サーバー（クラウド実行環境でのログ取得に使用）
- **Downstream**: このルーティンが作成する `flaky: *` issue とその修正PRは、
  通常のGROWI開発ワークフロー（レビュー・マージ）にそのまま合流する

## Existing Spec Touchpoints

- **Extends**: なし（既存specとの重複なし）
- **Adjacent**: なし

## Constraints

- クラウド実行環境（cronルーティン実行環境）は `gh` CLI のバージョンが
  固定されておらず（2.45.0で`attempt`フィールド未対応等）、egressプロキシが
  GraphQL系コマンドとblob storageへのリダイレクトを両方ブロックする、という
  環境固有の制約がある（対処済み、`research.md` および両スキルのError
  Handlingセクション参照）
- investigate-flaky-test は同一チェックアウト内で逐次実行が前提（並列実行は
  worktree分離が必要になるため現状スコープ外）

## Introduction

本ドキュメントは、GROWI の CI（GitHub Actions）上で発生する非決定的なテスト
失敗（flaky test）を、無人のルーティンとして検出・追跡・調査・修正する
仕組みの要件を定義する。対象範囲は既に実装・運用済みであり、本要件は主として
その挙動を明文化し、今後の変更判断の起点とすることを目的とする。唯一の新規
要件は、常設ダッシュボードissueによる可視化（Requirement 5）である。

## Boundary Context

- **In scope**:
  - `ci-app.yml`（vitest）/ `ci-app-prod.yml`（playwright）上の非決定的な
    テスト失敗の検出・確信度別の追跡・自律調査・修正PR作成
  - アクティブなflakyテスト全体を俯瞰できる常設ダッシュボードissueの維持
- **Out of scope**:
  - インフラ起因の失敗（ネットワーク断・OOM等）そのものの信頼性向上。本
    ルーティンはこれらを除外分類するのみで、根本対処は行わない
  - `ci-app.yml` / `ci-app-prod.yml` 以外のワークフローで発生する失敗
  - 商用SaaSの導入・比較検討
- **Adjacent expectations**:
  - 本ルーティンが作成する issue / PR は、GROWI の通常の開発ワークフロー
    （レビュー・マージ・ラベル運用）にそのまま乗ることを前提とする。独自の
    レビュー・マージ経路は持たない

## Requirements

このspecはClaude Codeスキル/コマンドのMarkdown手順として実装されており、
自動テストスイートを持たない。各Requirementの検証は、実際の`gh` / GitHub
API呼び出しを伴うシナリオベースの手動・run now検証で行っている（詳細は
`design.md`のTesting Strategy参照）。つまり、将来この手順書の文言が変わっ
ても、それを機械的に検知して落ちるテストは存在しない。以下の各Requirement
末尾には、この一般的な制約に加えて、それぞれ固有の既知の残課題（自動検証
では担保できていない部分）を記載する。

### Requirement 1: 非決定的な失敗の検出とissue追跡

**Objective:** GROWIのコミッターとして、CIの失敗が非決定性の観点で自動的にふるい分けられてほしい。それにより、誰もCIログを手で読み返すことなくflakyテストが追跡される。

#### Acceptance Criteria

1. When 監視対象のCIワークフローの完了したrunが設定済みのスキャン窓に含まれる場合, the flaky-ci-routine shall それをスキャン候補に含める。
2. If 失敗したジョブのログが既知のインフラノイズパターン（接続断・メモリ不足・ディスク枯渇等）に一致する場合, the flaky-ci-routine shall それをflaky分類から除外し、インフラノイズとして別途報告する。
3. When テストの失敗が既知のインフラノイズパターンに一致せず、かつ既存の追跡issueがその識別に一致しない場合, the flaky-ci-routine shall 失敗の証拠（run へのリンク・コミット・ログ抜粋）を記録した新しいGitHub issueを作成する。
4. When テストの失敗の識別が既存のオープンな追跡issueに一致する場合, the flaky-ci-routine shall 重複issueを作らず、その新しい証拠を既存issueに追記する。
5. When Playwrightのテストが失敗し、同一ジョブ内のリトライで成功した場合, the flaky-ci-routine shall それ以上の観測を必要とせず、確定済みflakyの証拠として記録する。
6. If スキャン対象のrunのジョブログ内容がいずれの手段でも取得できない場合, the flaky-ci-routine shall 証拠化できなかったジョブを実行サマリーで無言で省略せず、明示的に報告する。

### Requirement 2: 段階的な確信度によるエスカレーション

**Objective:** GROWIのコミッターとして、flakyの疑いが証拠の強さに応じて段階的に確信度を上げてほしい。それにより、強い兆候は速やかに調査に回り、弱い兆候は早まって扱われない。

#### Acceptance Criteria

1. While テストの失敗の識別がルーティンの定義する安価な証拠シグナル（例: 変更内容と無関係な失敗、同一識別が失敗→成功→再失敗したサンドイッチパターン、同一runの兄弟variantが成功している等）のいずれかに一致する, the flaky-ci-routine shall その追跡issueを単なる観測ではなく疑いありとしてラベル付けする。
2. When 疑いあり状態のissueの証拠が、コード変更なしの1回の確認試行で再現された場合, the flaky-ci-routine shall そのissueを確定済みに格上げする。
3. If 疑いあり状態のissueの確認試行が失敗を再現しなかった場合, the flaky-ci-routine shall issueを疑いあり状態のまま維持し、確定済み扱いにせず未確定の結果として記録する。
4. When テストの失敗が安価な証拠シグナルのいずれにも一致せずに観測された場合, the flaky-ci-routine shall 追跡issueを確定済みへ格上げする前に、最低限の独立した観測回数（設定可能、既定2回）を要求する。
5. When 過去に解決済みとされた追跡issueの識別が再び失敗した場合, the flaky-ci-routine shall その再発を全く新しい無関係な観測として扱わず、issueを再オープンし確定済み状態に戻す。
6. If 再発の証拠が、そのissueを解決したとされる変更より前の時点のものである場合, the flaky-ci-routine shall issueを誤って再オープンせず、その証拠を過去の記録としてissueに残す。

**既知の残課題**: AC 2.6の判定は、issueのコメントから`Fixed by #NNNN`という
記載を探して解決コミットを特定する。同一issueにこの記載が複数回付いた場合
（修正が2度目に及んだ場合等）、どちらを正とするかのタイブレークルールが
未定義（`detect-flaky-ci/SKILL.md`参照）。

### Requirement 3: 確認済み・疑いのあるflakyの自律調査と修正

**Objective:** GROWIのメンテナーとして、確定済み・疑いありのflaky issueが自動で調査され、原因が明確な場合は修正までされてほしい。それにより、発生の都度、人手でのトリアージが不要になる。

#### Acceptance Criteria

1. When issueが確定済みまたは疑いありのラベルを持つ場合, the flaky-ci-routine shall 再現を試み、ルーティンの定義するカテゴリ（テスト側・製品コード側・環境要因のみ・本物の回帰）のいずれかに原因を分類することで調査する。
2. If 調査の結果、原因と手術的な修正の両方について高い確信度が得られた場合, the flaky-ci-routine shall 修正を実装し、追跡issueを参照するプルリクエストを作成する。
3. If 調査の確信度が中程度または低い場合, the flaky-ci-routine shall 推測で修正を適用せず、修正の適用を見送りギャップ（再現結果・疑われる原因・推奨事項）を報告する。
4. The flaky-ci-routine shall テストの隔離（skip/disable）を自律モードの既定の結果として選ばない。隔離は、停止して確認を求めるゲートで選ばれた場合、または環境要因のみで直せるコード箇所が無いと分類された場合に限る。
5. When 修正のプルリクエスト自身のCIがそれ以上のコード変更なしに繰り返し成功した場合, the flaky-ci-routine shall そのプルリクエストをレビュー可能な状態に切り替え、追跡issueの状態も合わせて更新する。

### Requirement 4: 実行環境差異への耐性

**Objective:** このルーティンを無人実行（例: スケジュール済みのクラウドセッション）するオペレーターとして、実行環境の違いによらず動き続けてほしい。それにより、自動化が無言で失敗したり、実行ごとに挙動が変わったりしない。

#### Acceptance Criteria

1. If 起動時にルーティンが必要とするGitHub APIへのアクセスが確認できない場合, the flaky-ci-routine shall 追跡状態への変更を一切行う前に停止し、失敗の理由を明確に報告する。
2. While 現在の実行環境でCIジョブログの取得手段が複数存在する, the flaky-ci-routine shall 実行開始時に手段を1つ選び、そのrunの間は一貫してその手段を使い続ける。
3. If 既知の回避策がある環境固有の不具合が実行途中で発生した場合, the flaky-ci-routine shall run全体を中断せず、回避策を適用して処理を継続する。

### Requirement 5: 常設ダッシュボードによる可視化

**Objective:** GROWIのメンテナーとして、現在アクティブな全flakyテストを常に俯瞰できる場所がほしい。それにより、個々のテストが直っていなくても、チームがflaky傾向を把握し反応できる。

#### Acceptance Criteria

1. When ルーティンの実行が完了した場合, the flaky-ci-routine shall 単一の常設ダッシュボードissueを更新し、現在アクティブな全flakyテストの状態を反映する。
2. The flaky-ci-routine shall 2つ目のダッシュボードissueを作らず、全ての実行を通じて同一のissueを更新し続ける。
3. The flaky-ci-routine shall アクティブな各flakyテストについて、その識別・確信度のtier・初回観測日・最終観測日・観測回数・追跡issueへのリンク（および修正PRが存在すればそのリンク）をダッシュボードissueに含める。
4. When 追跡中のflakyテストの追跡issueが解決済みになった場合, the flaky-ci-routine shall そのテストをダッシュボード上のアクティブな一覧から外す。
5. If 現在アクティブなflakyテストが1件も無い場合, the flaky-ci-routine shall 古い内容を残したままにせず、その状態を反映してダッシュボードissueを更新する。

**既知の残課題**（2026-08-15、最終レビューで発見・GO判定を妨げない
レベルとして記録）:
- ダッシュボードissue自体が手動でcloseされた場合、現在の実装は`state`を
  見ておらず再オープンしない（重複作成はしないため実害は限定的）
- ダッシュボードissueの作成・更新手順に、他の箇所と比べて具体的な
  `gh api`コマンド例が少ない
