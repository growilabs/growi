# Requirements Document

## Project Description (Input)

`bin/flaky-ci/fixtures/` には実際の GitHub API 応答・ジョブログ・lockfile 差分を
素材にした自動テスト用fixtureが約21,000行ある（PR #11921、flaky-ci-script-extraction
の実装）。これらは `bin/flaky-ci/fixtures/README.md` に書かれた運用ルール
（実データを `gh api` で取得し、`.meta.md` に出典・取得日・実データか合成データかを
記録する）に従って作られているが、このルールは人（またはAIセッション）が
`bin/flaky-ci/` を手作業で触るときにだけ読まれる受動的な文書でしかない。

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
   のいずれの無人routineからも参照されておらず（意図どおり ── これらのroutineは
   flaky-CIの検出・調査が仕事で、`bin/flaky-ci/` 自体の保守は仕事ではない）、
   「READMEの決まりに沿って運用する」ことを能動的に実行する主体が repo 内に存在しない。

詳細は `.kiro/specs/ci-flaky-fixture-freshness/brief.md` を参照。

## Introduction

本ドキュメントは、`bin/flaky-ci/fixtures/` 配下の実データfixtureが実際の GitHub API
応答と乖離していないか、およびfixtureファイルが実際にテストから読み込まれているかを、
四半期ごとに無人で確認する仕組みの要件を定義する。検知結果は GitHub issue として
報告され、重複起票は避ける。fixtureの中身そのものの正誤判定や自動更新、
`bin/flaky-ci/` 自体の機能変更は対象外とする。

## Boundary Context

- **In scope**:
  - 実データfixture（`.meta.md` の `source` が real のもの）について、出典の
    issue/PR/run番号から同じ `gh api` エンドポイントを再取得し、応答の形
    （トップレベルのキー構成・型）を保存済みfixtureと比較すること
  - `bin/flaky-ci/fixtures/` 配下の各データファイルが `bin/flaky-ci/` 配下の
    いずれかのテストファイルから参照されているかを確認すること
  - 上記2つの確認を四半期に1回、無人で実行すること
  - 検知結果を GitHub issue として報告し、同一対象の重複起票を避けること
- **Out of scope**:
  - fixtureの中身の値（応答の形ではなく内容）そのものの正誤判定
  - 乖離・未配線が見つかったfixtureの自動修正・自動更新
  - `bin/flaky-ci/` のスクリプト・手順書の機能変更
  - 無人routine（`flaky-ci-routine` / `detect-flaky-ci` /
    `investigate-flaky-test`）の検出・調査ロジックの変更
- **Adjacent expectations**:
  - `bin/flaky-ci/fixtures/README.md` の `.meta.md` 記法（`Source` フィールドで
    real / synthetic を区別する規約）を前提とし、変更しない
  - `.github/workflows/ci-bin.yml` の既存のテスト実行配線（`bin/**` の変更で
    自動的にテストが走る）とは独立に動作する

## Requirements

### Requirement 1: 実データfixtureの応答形ドリフト検知

**Objective:** As a GROWI のメンテナ, I want 実データ由来のfixtureが実際の GitHub
API 応答の形と乖離していないかを確認できること, so that フィールド構成の変更に
気づかないまま、古い前提でスクリプトが動き続けることを防げる

#### Acceptance Criteria

1. When 定期実行が行われる場合, the fixture-freshness check shall 各fixtureの
   `.meta.md` の `Source` が実データ (real) であるものだけを対象に、記録された
   出典（issue / PR / run 番号）から同じ `gh api` エンドポイントを再取得する。
2. When 再取得した応答の構成（トップレベルのキー集合と各値の型）が保存済み
   fixture と異なる場合, the fixture-freshness check shall そのfixtureを
   乖離候補として報告する。
3. The fixture-freshness check shall 応答の値そのもの（コメント本文・タイム
   スタンプ・ラベル付与状況など）の変化を乖離として扱わない。
4. If `.meta.md` の `Source` が合成データ (synthetic) と記録されている場合,
   then the fixture-freshness check shall そのfixtureを再取得対象から除外する。

### Requirement 2: fixture-テスト参照配線の健全性チェック

**Objective:** As a GROWI のメンテナ, I want fixtureファイルが実際にテストから
読み込まれているかを機械的に確認できること, so that ドキュメントの説明と実態が
乖離したまま気づかれずに放置される事故を防げる

#### Acceptance Criteria

1. When 定期実行が行われる場合, the fixture-freshness check shall
   `bin/flaky-ci/fixtures/` 配下の各データファイルについて、`bin/flaky-ci/`
   配下のいずれかのテストファイルから参照されているかを確認する。
2. If あるfixtureファイルがどのテストファイルからも参照されていない場合, then
   the fixture-freshness check shall そのファイルを未配線候補として報告する。
3. The fixture-freshness check shall `.meta.md` ファイル自身を健全性チェックの
   対象外とする。

### Requirement 3: 定期・無人実行

**Objective:** As a GROWI のメンテナ, I want 上記2つの確認が無人で定期的に
実行されること, so that 誰かが手作業で思い出して実行する必要がない

#### Acceptance Criteria

1. The fixture-freshness check shall 四半期に1回の頻度で無人実行される。
2. When 1回の実行が完了した場合（乖離候補・未配線候補の有無にかかわらず）, the
   fixture-freshness check shall 対象件数・検出件数を含む実行結果を記録する。

### Requirement 4: 検知結果の報告

**Objective:** As a GROWI のメンテナ, I want 乖離候補・未配線候補が見つかった
ときに見逃さない形で通知されること, so that 次の保守作業に確実につながる

#### Acceptance Criteria

1. When 乖離候補または未配線候補が1件以上見つかった場合, the fixture-freshness
   check shall GitHub issue を起票し、検出内容（対象fixture・出典・種別・
   何が確認されずに終わったか）を本文に記載する。
2. If 同一種別・同一対象について未解決の issue が既に存在する場合, then the
   fixture-freshness check shall 新規 issue を起票せず、実行結果の記録にとどめる。
3. When 乖離候補・未配線候補が0件だった場合, the fixture-freshness check shall
   issue を起票しない。

### Requirement 5: 取得失敗時の扱い

**Objective:** As a GROWI のメンテナ, I want GitHub API の取得に失敗したときに、
それが「乖離なし」と誤って報告されないこと, so that 見せかけの安全を信用して
しまう事故を防げる

#### Acceptance Criteria

1. If 出典への `gh api` 呼び出しが失敗した場合（レート制限・対象の削除・
   ネットワークエラーなど）, then the fixture-freshness check shall そのfixture
   を「乖離なし」として扱わず、確認できなかった対象として別途報告する。
2. The fixture-freshness check shall 確認できなかった対象の件数と理由を実行
   結果に記録する。
3. If 実データfixtureの `.meta.md` が、再取得可能な `gh api` 呼び出しとして
   機械的に認識できる形で書かれていない場合（設計時点の実態調査で判明した、
   `-q` フィルタ付きの記述・ローカル計算による派生物・書式が異なる記録など）,
   then the fixture-freshness check shall そのfixtureを「乖離なし」として
   扱わず、確認できなかった対象として報告する。
