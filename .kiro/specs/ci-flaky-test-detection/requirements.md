# Requirements Document

## Project Description (Input)

> discovery 時点の入力の記録。以下の本文は discovery 当時のままで、現在の
> 仕様は本ファイルの `## Requirements` 節と `design.md` を正とする。

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
仕組みの要件を定義する。

要件は 2 つのまとまりからなる。Requirement 1〜5 が仕組みの骨格 — 検出と
issue 追跡、確信度の段階付け、自律調査と修正 PR、実行環境の違いへの耐性、
常設ダッシュボード — を定める。Requirement 6〜11 は、その骨格を人手を介さず
に回り続けるループにするための要件で、次の 5 点を定める。(1) CI の再実行
権限を持たない実行環境でも、確認と修正の検証を数値の証拠で終えられること。
(2) 1 つの原因から出た複数の失敗を 1 件として追跡し、flaky でない失敗を
追跡対象から外すこと。(3) 人の判断を待って止まった issue を状態として持ち、
人の返答で再開すること。(4) 再発しない issue を自動で閉じること。(5) 起動
間隔と、隣接する汎用 issue 調査ルーティンとの整合。

## Boundary Context

- **In scope**:
  - `ci-app.yml`（vitest）/ `ci-app-prod.yml`（playwright）上の非決定的な
    テスト失敗の検出・確信度別の追跡・自律調査・修正PR作成
  - アクティブなflakyテスト全体を俯瞰できる常設ダッシュボードissueの維持
  - 疑いあり issue の確認と修正 PR の検証を、CI の再実行権限が無い実行環境
    でも数値の証拠で完了できるようにすること（そのための測定用ワークフロー
    `.github/workflows/flaky-repro.yml` を含む）
  - 1 つの原因から出た複数の失敗を 1 件として追跡し、flaky でない失敗を
    追跡対象から外すこと
  - 人の判断待ちで止まった issue を状態として持ち、ダッシュボードで見え、
    人の返答で再開すること
  - 再発しない issue を自動で閉じること
  - routine の起動間隔と、隣接する汎用 issue 調査ルーティンとの整合
- **Out of scope**:
  - インフラ起因の失敗（ネットワーク断・OOM等）そのものの信頼性向上。本
    ルーティンはこれらを除外分類するのみで、根本対処は行わない
  - `ci-app.yml` / `ci-app-prod.yml` 以外のワークフローで発生する失敗。
    `flaky-repro.yml` は監視対象ではなく、このルーティン自身が使う測定器で
    あり、その失敗は flaky として追跡しない
  - テスト基盤そのものの修正（共有 setup フックの負荷除去など）と、個別
    テストの設計不良の修正。これらは通常の PR として別途行う
  - Playwright（e2e）の再現実行。Playwright は同一 run 内の retry で既に
    確定済みの証拠が得られるため、再現ワークフローによる確認の対象外
  - routine が使うモデルの選択。判断材料は設計で記録するが、要件では定めない
  - 商用SaaSの導入・比較検討
- **Adjacent expectations**:
  - 本ルーティンが作成する issue / PR は、GROWI の通常の開発ワークフロー
    （レビュー・マージ・ラベル運用）にそのまま乗ることを前提とする。独自の
    レビュー・マージ経路は持たない。routine は自分でマージしない
  - 追跡 issue のラベル追加や、cron ルーティンのプロンプト・起動間隔の変更
    は、リポジトリ外のオペレーター作業として扱う（リポジトリへの変更だけ
    では反映されない）

## Requirements

このspecはClaude Codeスキル/コマンドのMarkdown手順として実装されており、
自動テストスイートを持たない。各Requirementの検証は、実際の`gh` / GitHub
API呼び出しを伴うシナリオベースの手動・run now検証で行っている（詳細は
`design.md`のTesting Strategy参照）。つまり、将来この手順書の文言が変わっ
ても、それを機械的に検知して落ちるテストは存在しない。この一般的な制約に
加えて固有の既知の残課題（自動検証では担保できていない部分）を持つものが
あり、その場合は**一部のRequirementの末尾**にそれを記載する。

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
2. When 疑いあり状態のissueに対する確認の測定（Requirement 6.1）で1回以上の成功が得られた場合, the flaky-ci-routine shall そのissueを確定済みに格上げする。
3. If 確認の測定で全ての実行が失敗した場合, the flaky-ci-routine shall そのissueを確定済みに格上げせず疑いあり状態のまま維持し、本物の回帰の可能性が第一の仮説であることを記録する。
4. When テストの失敗が安価な証拠シグナルのいずれにも一致せずに観測された場合, the flaky-ci-routine shall 追跡issueを確定済みへ格上げする前に、最低限の独立した観測回数（設定可能、既定2回）を要求する。
5. When 過去に解決済みとされた追跡issueの識別が再び失敗した場合, the flaky-ci-routine shall その再発を全く新しい無関係な観測として扱わず、issueを再オープンし確定済み状態に戻す。
6. If 再発の証拠が、そのissueを解決したとされる変更より前の時点のものである場合, the flaky-ci-routine shall issueを誤って再オープンせず、その証拠を過去の記録としてissueに残す。
7. If 確認の測定そのものが行えなかった場合, the flaky-ci-routine shall issueに既にある静的な証拠を測定の代わりとして扱わず、確定済みに格上げせずに疑いあり状態のまま人の判断待ち（Requirement 9）へ回す。

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
5. When 修正の検証（Requirement 6.4・6.5）が通った場合, the flaky-ci-routine shall そのプルリクエストを最初からレビュー可能な状態（下書きではない状態）で作成し、追跡issueの状態も合わせて更新する。

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
- ダッシュボードissueの探索と分岐（0件／1件／2件以上）には具体的な
  `gh api`コマンド例があるが、**新規作成と本文の全置換そのもの**は文章で
  書かれているだけで、コマンド例が無い

### Requirement 6: CI 再実行権限に依存しない非決定性の確認と修正の検証

**Objective:** 無人でルーティンを運用するオペレーターとして、実行環境が CI の再実行権限を持たなくても「本当に非決定的か」「修正で直ったか」を数値の証拠で確定してほしい。それにより、確認できないことを理由に調査が全件止まる状態をなくす。

#### Acceptance Criteria

1. When 疑いあり状態の issue の確認が必要になった場合, the flaky-ci-routine shall 対象テストを、コードを変更せずに、独立した複数回（回数は設定可能、既定 3 回）実行した合否の集計を、CI ワークフローの再実行権限を必要としない手段で取得する。
2. When 合否の集計に 1 回以上の成功が含まれる場合, the flaky-ci-routine shall issue に記録済みの CI 上の失敗を失敗側の標本として数え、その issue を確定済みに格上げし、集計値（失敗回数 / 実行回数、記録済みの失敗を含む）を issue に記録する。
3. If 合否の集計が全回失敗だった場合, the flaky-ci-routine shall それを「本物の回帰の可能性」として issue に明示し、flaky の修正として扱わない。
4. When 修正の検証が必要になった場合, the flaky-ci-routine shall 修正後のコードに対して同じ手段で連続成功回数を取得し、既定回数（設定可能、既定 3 回）の連続成功が得られた場合に限り、修正 PR を最初からレビュー可能な状態で作成する（下書き状態を経由しない）。
5. If 修正後の連続実行のいずれかが失敗した場合, the flaky-ci-routine shall 修正 PR を作成せず、失敗の内容を issue に記録して人の判断待ち（Requirement 9）に回す。
6. If 確認手段そのものが利用できなかった場合（実行が始まらない、または結果が取得できない）, the flaky-ci-routine shall 既存の静的な証拠を確認の代わりとして扱わず、「確認未実施」として人の判断待ち（Requirement 9）に回す。
7. The flaky-ci-routine shall コード差分の無い確認実行のために、監視対象の通常 CI ワークフローの実行回数を増やさない。

**既知の残課題**: 確認と検証の測定は、`ci-app.yml` の matrix のうち 1 セル
（MongoDB 8.0 と Elasticsearch 8）だけで行われる。MongoDB 6.0 のセルや
Elasticsearch 9 のセルでしか出ない非決定性は、この手段では測れない。修正の
検証で全回成功（`- Failed: 0`）が得られても、それは他のセルについては何も
言っていない — 他のセルの証拠は修正 PR に走る通常 CI が受け持つ
（`design.md` の Repro Workflow 参照）。

### Requirement 7: 同一原因から出た複数の失敗の集約

**Objective:** GROWI のメンテナーとして、1 つの原因から出た失敗は 1 件の issue として追跡されてほしい。それにより、ダッシュボードの件数が原因の数と一致し、優先順位を正しく判断できる。

#### Acceptance Criteria

1. When 1 つのジョブログで共有 setup フックの timeout が観測され、かつ同じジョブログで別のテストファイルの timeout（フックまたはテスト本体）が観測された場合, the flaky-ci-routine shall 後者を新しい issue にせず、共有 setup フックの追跡 issue に「巻き添えの可能性」として記録する。範囲を run ではなくジョブログとするのは、run の各ジョブが別のランナー上の別プロセスとして走るため、共有フックの timeout が汚す状態は 1 つのジョブの中にしか伝わらないからである。
2. When 前項で「巻き添えの可能性」として記録したテストが、共有 setup フックの timeout を含まないジョブログで再び失敗した場合, the flaky-ci-routine shall そのときに初めて独立した追跡 issue を作成する。
3. When 1 つのテストファイル内で、先頭の失敗に続いて同じジョブログの後続テストが連鎖して失敗した場合, the flaky-ci-routine shall 先頭の失敗だけを識別として issue 化し、連鎖した失敗は同じ issue に列挙する。
4. The flaky-ci-routine shall 「巻き添えの可能性」として記録したテストと、連鎖として列挙したテストを、ダッシュボードの独立した行として数えない。

### Requirement 8: flaky でない失敗の追跡対象からの除外

**Objective:** GROWI のメンテナーとして、決定的に失敗するものや変更中の PR 自身の失敗が flaky として追跡されないでほしい。それにより、追跡 issue はすべて「master 上で非決定的に失敗するもの」だけになる。

#### Acceptance Criteria

1. When 失敗した run のコミットが既定ブランチの履歴に含まれず、かつ次のいずれかに当てはまる場合（(a) その run に紐づく PR が失敗したテストのファイルを追加または変更している、(b) そのコミットに紐づく PR が 1 つも無い）, the flaky-ci-routine shall その失敗を追跡対象外とし（issue を作らず）、実行サマリーに件数を報告する。
2. When 「変更内容と無関係な失敗」の判定を行う際に、PR の差分に依存関係のロックファイルの変更が含まれる場合, the flaky-ci-routine shall 失敗のスタックトレースに現れるパッケージ名がそのロックファイル差分に含まれるかを確認し、含まれる場合は「無関係」と判定しない。
3. When 失敗ログが外部ネットワークからの取得失敗（例: `Failed to download file.`）に一致する場合, the flaky-ci-routine shall それをインフラノイズとして flaky 分類から除外する。
4. When 調査の結果、失敗が非決定的ではなく決定的な原因（依存関係の重複、生成物の不足、ビルド順序など）によるものと判定された場合, the flaky-ci-routine shall 追跡 issue に判定理由を記録して flaky 追跡としてはクローズし、原因の修正は通常の issue / PR として扱う旨を残す。

### Requirement 9: 人の判断待ちの可視化と、人の返答による再開

**Objective:** GROWI のメンテナーとして、自動調査が人の判断を待って止まっている issue がどれで、何を決めればよいかが一目で分かってほしい。それにより、判断を返せばそこから自動で再開する。

#### Acceptance Criteria

1. When 調査が中程度または低い確信度で停止する場合, the flaky-ci-routine shall その issue に「人の判断待ち」を表す状態を付け、推奨する選択肢を 1 行で issue に残す。
2. When ダッシュボードを更新する場合, the flaky-ci-routine shall 判断待ちの issue を専用の節に、停止日と推奨する選択肢とともに一覧する。
3. When 判断待ちの issue に、停止後に自動処理以外の人からのコメントが追加された場合, the flaky-ci-routine shall 次回の実行でその issue を調査対象に再選択し、そのコメントを判断結果として扱って調査を再開する。
4. When 判断待ちの issue に停止後も新しい観測が追加された場合, the flaky-ci-routine shall ダッシュボードの判断待ちの節にその件数を反映する。
5. The flaky-ci-routine shall 停止した issue や作成した PR を、イベントの購読や再起床の予約によって監視し続けない。次回の定期実行で改めて拾う。

### Requirement 10: 再発しない issue の自動クローズ

**Objective:** GROWI のメンテナーとして、1 回観測されただけで再発しない issue が一覧に残り続けないでほしい。それにより、ダッシュボードには対応が必要なものだけが残る。

#### Acceptance Criteria

1. When 観測中（observing）状態の issue の最終観測から既定日数（設定可能、既定 14 日）以上、新しい観測が無い場合, the flaky-ci-routine shall 「期間内に再現せず」の記録を残してその issue をクローズする。
2. When 前項でクローズした識別が再び失敗した場合, the flaky-ci-routine shall 既存の再オープン経路でその issue を再オープンする（修正による解決ではないため、時刻の前後判定を要しない）。
3. When 自動クローズを行った場合, the flaky-ci-routine shall 実行サマリーとダッシュボードにその件数と issue 番号を報告する。

### Requirement 11: 起動間隔と隣接ルーティンとの整合

**Objective:** ルーティンを運用するオペレーターとして、起動間隔の変更や別のルーティンとの重なりで検出漏れや二重処理が起きないでほしい。

#### Acceptance Criteria

1. The flaky-ci-routine shall スキャン窓を、実際の起動間隔のうち最長のものの 2 倍以上にする（起動間隔が不均一な場合は最長間隔を基準とする）。
2. The 汎用 issue 調査ルーティン shall flaky 追跡 issue（flaky 系のラベルを持つ issue）を調査対象から除外する。
3. When ルーティンの実行が完了した場合, the flaky-ci-routine shall 実行サマリーに、確認実行の回数と消費した CI 時間、判断待ちの件数、自動クローズの件数を含める。
