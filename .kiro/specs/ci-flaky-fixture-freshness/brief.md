# Brief: ci-flaky-fixture-freshness

## Problem

`bin/flaky-ci/fixtures/` には実際の GitHub API 応答・ジョブログ・lockfile 差分を
素材にした自動テスト用fixtureが約21,000行ある（PR #11921、flaky-ci-script-extraction
の実装）。これらは `bin/flaky-ci/fixtures/README.md` に書かれた運用ルール
（実データを `gh api` で取得し、`.meta.md` に出典・取得日・実データか合成データかを
記録する）に従って作られているが、このルールは**人（またはAIセッション）が
`bin/flaky-ci/` を手作業で触るときにだけ読まれる受動的な文書**でしかない。

1. GitHub の REST API 応答の形（フィールド構成）が将来変わっても、それを検知して
   fixtureを更新するきっかけが存在しない。fixtureは取得した時点の形のまま固定され、
   実際のAPIとの乖離に誰も気づかない可能性がある。
2. fixtureファイルが実際にテストから読まれているかどうかを機械的に検証する仕組みが
   ない。PR #11921 のレビューでは、`fixtures/expected/*.md` 8ファイル（635行）が
   どの `.spec.ts` からも読み込まれていない ── READMEはこれを「テストが差分比較する
   一次情報源」と説明していたが実際はテスト側に決め打ちの値が別途書かれているだけ、
   という乖離が見つかった（修正済み: コミット51483394a2）。今後また同じ種類の乖離が
   起きても検知する手段がない。
3. README自体は `flaky-ci-routine` / `detect-flaky-ci` / `investigate-flaky-test`
   のいずれの無人routineからも参照されておらず（意図どおり — これらのrouteineは
   flaky-CIの検出・調査が仕事で、`bin/flaky-ci/` 自体の保守は仕事ではない）、
   「READMEの決まりに沿って運用する」ことを能動的に実行する主体が repo 内に存在しない。

## Current State

- `bin/flaky-ci/fixtures/README.md` に、fixtureの追加・記録方法（Real vs. synthetic
  の判断、`.meta.md` の書式）は文書化済み。
- `.github/workflows/ci-bin.yml` が `bin/**` の変更に反応してテストを実行するので、
  fixtureを**変更したとき**の検証は自動で走る。
- fixtureが**変更されないまま古くなっていく**ケース（実際のAPI応答は変わったのに
  fixtureは据え置き）を検知する仕組みは無い。
- fixtureが実際にテストから使われているかを検証する仕組みは無い（README上の説明と
  実態が乖離していても、CIは気づかない）。

## Desired Outcome

- 実データ由来のfixture（`.meta.md` に real と記録されているもの）について、出典の
  issue/PR/run番号から同じ `gh api` エンドポイントを再取得し、**値ではなく応答の形
  （トップレベルのキー構成・型）**が保存済みfixtureと一致するかを定期的に確認できる。
  形が変わっていれば、人が見直すべき対象として報告される。
- fixtureファイルが実際に `.spec.ts` から読み込まれているかどうかを機械的に確認でき、
  読み込まれていない・READMEの説明と実態が食い違っているファイルを検出できる。
- 上記が一度きりの手動チェックではなく、定期的に（頻度は要検討）無人で回る。

## Approach

未定（このbriefの次段階 `/kiro-spec-requirements` 以降で検討）。検討候補として
挙がっていたのは「月1回、cronでスケジューリングされたスキルとして、`bin/flaky-ci/`
配下を対象に鮮度チェックを走らせる」という形。ただし以下は要検討:
- 頻度（月次 vs 四半期 ─ GitHub REST APIの後方互換性の強さを踏まえるとオーバースペック
  の可能性がある）
- 検知後のアクション（issue自動起票 か レポートのみ か）
- 独立スキルとして作るか、既存の `bin/flaky-ci/` に軽量スクリプトを1本足すだけに
  留めるか（後者のほうが「手順書の肥大化を減らす」という元の施策の精神に近い）

## Scope

- **In**: 実データfixtureの応答形ドリフト検知、fixture-テスト間の参照配線の健全性
  チェック、これらを定期的に実行する仕組み
- **Out**: fixtureの中身そのものの正しさ（実データの再取得・再判定は本specの対象外。
  形が変わったことを検知して人に投げるところまで）、`bin/flaky-ci/` のスクリプト自体
  の機能追加・変更

## Boundary Candidates

- 応答形ドリフト検知（GitHub APIを叩き直して形を比較する部分）
- fixture-テスト参照配線の健全性チェック（grepベースの静的チェックで足りる可能性が
  高く、上記とは独立に実装できる）
- 定期実行の仕組み（cron/routine化）

## Out of Boundary

- `bin/flaky-ci/` のスクリプト・手順書の機能変更
- fixtureの内容そのものの正誤判定（形の一致だけを見る。中身の値が古くなっているかは
  対象外）
- 無人routine（flaky-ci-routine等）の検出・調査ロジック自体の変更

## Upstream / Downstream

- **Upstream**: `ci-flaky-test-detection`（`bin/flaky-ci/` の実装元）、
  `bin/flaky-ci/fixtures/README.md`（今回の運用ルールの一次情報源）
- **Downstream**: なし（現時点で本specに依存する後続作業は無い）

## Existing Spec Touchpoints

- **Extends**: なし（`ci-flaky-test-detection` の契約は変えない。amend specでは
  なく独立した新規spec）
- **Adjacent**: `ci-flaky-test-detection`（`bin/flaky-ci/` を保守対象として共有する
  が、責務は「flaky-CIの検出」ではなく「flaky-CI検出ツール自身の保守」なので別spec
  境界とする）

## Constraints

- 頻度・自動アクションの有無は未決（Approach参照）
- 新しいスキルを1本丸ごと増やすのか、既存の `bin/flaky-ci/` に軽量スクリプトを足す
  だけにするのかは、要件定義時に「肥大化を増やさない」という元施策の精神と照らして
  判断する
