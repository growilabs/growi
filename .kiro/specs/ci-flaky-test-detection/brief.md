# Brief: ci-flaky-test-detection

> discovery時点（spec名は当時`flaky-ci-routine`）の記録。以下の本文は
> discovery当時のまま。現在の判断は`design.md`・`requirements.md`を正とする。

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
- 関連PR: #11701（下敷きとなる先行修正）, #11704, #11706, #11716, #11717
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
か」「何がまだ未確定か」を再調査なしに把握できることがゴール。

## Approach

（提案ではなく、既に採用・実装済みの設計）

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

### 新規（本spec化にあたり追加検討）: 可視化によるflaky率低減

`research.md` の調査で、Spotifyが「可視化だけで（修正前に）flaky率を6%→4%
に下げた」という知見が見つかった。これを踏まえ、常設の「flaky-ci-routine
ダッシュボード」issueを新設し、毎回のroutine実行時にcreate-or-update（新規
issueを都度作らない）する案を採用する。

- 日次/週次のアーティファクト定期出力は採用しない。理由: (1) 状態を持たない
  設計・GitHub issue/labelのみを状態とする既存の原則から外れる、(2) アーティ
  ファクトの置き場所・「更新をどう知らせるか」という新しいインフラ判断が増
  える、(3) クラウドのcronセッションでArtifact機能が使える保証がない
- 内容: テスト識別子・tier（observing/suspected/confirmed）・初回検出日・
  最終検出日・観測回数・修正PRへのリンクを一覧表にしたissue本文。Spotify
  のような散布図的可視化はGitHub issueの表現力では難しいため、まずは表形式
  のみ
- 既存のflaky issue自体（個別追跡）とは別物 — ダッシュボードは「今アクティ
  ブな全flakyの一覧」を俯瞰する場、個別issueは1テストの経緯を追う場

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
