# Research & Design Decisions

## Summary
- **Feature**: `ci-flaky-fixture-freshness`
- **Discovery Scope**: Extension（`bin/flaky-ci/` への追加）
- **Key Findings**:
  - `.meta.md` は機械可読なスキーマではなく自由記述のprose。`# Source` 見出しの
    直後に `**Real.**` / `**Synthetic.**` / `**Constructed.**` /
    `**Derived, not raw API data.**` の4種の書き出しが混在し、再取得可能な
    `gh api` コマンドを含むのは "Real" のうち大半だが全部ではない
  - `api/dashboard/` 配下だけファイル名規約が違う（`<name>.meta.md` ではなく
    `<name>.md.meta.md`）
  - `lib/gh.ts` の `GhApi.get()` は `-X GET` + クエリパラメータのみ対応し、
    `-q` jq フィルタ付きの取得コマンドは表現できない
  - `flaky-ci-routine` 等の既存無人routineはLLM判断を要する仕事（検出・調査）
    のために存在し、本specの2チェック（形の比較・参照配線の確認）はどちらも
    判断を要しない機械的な処理 ── これは元の flaky-ci-script-extraction が
    「判断を通らない処理はスクリプトに出す」としてきた対象そのものであり、
    LLMセッション（スキル）ではなく決定的なスクリプト＋スケジュール実行の
    ワークフローで足りる

## Research Log

### `.meta.md` の実際の書式のばらつき
- **Context**: Requirement 1 は「出典から同じ `gh api` エンドポイントを再取得
  する」ことを前提にしていたが、これが `.meta.md` から機械的に抽出できるかを
  確認する必要があった
- **Sources Consulted**: `bin/flaky-ci/fixtures/**/*.meta.md` 全ファイルの
  `# Source` 節冒頭3行
- **Findings**:
  - 典型形（過半数）: `` - **Real.** `gh api -X GET repos/growilabs/growi/<path>[?params][ --paginate]`. ``
  - `-q` フィルタ付き: `11886-pnpm-lock.patch.meta.md` は
    `` gh api -X GET repos/growilabs/growi/pulls/11886/files --paginate -q '...' `` ──
    フィルタ後の値（patch文字列1本）を比較対象にしても、それはAPI応答の形
    ではなく抽出後の値の形になってしまい、Requirement 1.3（値の変化を乖離と
    しない）の意図と矛盾する
  - `Derived, not raw API data.`: `11886-extracted-package-names.json` は
    ローカルスクリプトで計算した派生物で、再取得すべき `gh api` エンドポイント
    が存在しない
  - `Constructed.`: 一部のjob-logフィクスチャは「実在しないため構成した」もの
    で、Syntheticと似ているが語彙が異なり、正規表現の対象語として別途
    扱う必要がある
  - dashboard配下 (`api/dashboard/`) は `<name>.md.meta.md` という別の
    ファイル名規約と、`# Source` ではなく `` # `<filename>` `` という別の見出し
    形式を使う
- **Implications**: 全 `.meta.md` を汎用的にパースする本格的なパーサーを作る
  ことは、今回追加しようとしている「軽量なチェック」を大きく超える作業になる。
  「典型形（`gh api -X GET repos/growilabs/growi/<path>` + 任意の `--paginate`
  / `-f k=v`、`-q` 無し）に一致するものだけを機械的に再検証し、一致しない
  ものは全部 `unrecognized-format`（未確認）として一括で報告する」という
  狭い実装にとどめるのが妥当。Requirement 5 の「確認できなかった対象は
  乖離なしとして扱わない」という原則をそのまま適用できる（後述 Decision 1）

### 実行主体: 無人routine（LLM/スキル） vs GitHub Actions
- **Context**: brief.md の Approach は「月1回、cronでスケジューリングされた
  スキル」を検討候補として挙げていたが、これが適切な実行形態かを確認した
- **Findings**: `flaky-ci-routine` / `detect-flaky-ci` / `investigate-flaky-test`
  がLLMセッション（Claude Codeのスキル）として実装されているのは、
  「クローズ済みissueを再オープンするか」「Playwright識別名の2段構え」等の
  **判断**を要するため。本specの2チェック（応答の形の比較、参照配線の
  有無）はどちらも判断を要しない ── まさに flaky-ci-script-extraction が
  「スクリプトへ出す」としてきた種類の処理そのもの
  - 本リポジトリには `.github/workflows/release-rc-scheduled.yml` など
    `on: schedule` を使う既存の定期実行ワークフローの前例がある
- **Implications**: 新しいスキル（LLMセッション）を1本増やす必要はない。
  `.github/workflows/` に新しい `on: schedule` ワークフローを1本置き、
  そこから `bin/flaky-ci/scripts/` の新スクリプトを直接 `node` で呼べば
  足りる。これは「肥大化を増やさない」というbrief.mdの制約に最も適う
  （後述 Decision 2）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 新規スキル（cronで動くLLMセッション） | brief.md の当初案 | 柔軟（.meta.mdの書式ゆれを都度読んで判断できる） | 無人routineの手順書がまた1本増える。判断不要な処理にLLMを使うのは、本specの前提となった flaky-ci-script-extraction の方針と矛盾する | 不採用 |
| GitHub Actions 定期ワークフロー + 決定的スクリプト | 本design採用案 | 判断不要な処理に対して軽量・決定的・既存の `ci-bin.yml` テスト配線とも整合 | `.meta.md` の書式ゆれを吸収しきれない（未確認として報告するだけに留める） | 採用 |

## Design Decisions

### Decision 1: `.meta.md` は「典型形に一致するものだけ機械チェック、それ以外は一律 unrecognized」とする
- **Context**: `.meta.md` は自由記述のprose。全パターンを解釈する汎用パーサーは
  過剰投資であり、誤って `-q` フィルタ後の値を「応答の形」として比較すると
  Requirement 1.3 と矛盾する
- **Alternatives Considered**:
  1. `.meta.md` を機械可読な構造（YAML frontmatterなど）へ全面的に書き換える
     ── 既存30件超のfixtureへの後方互換のない変更で、範囲が本specを超える
  2. 汎用prose解析（NLP的な抽出）── 過剰。既存の決定的スクリプト志向と
     整合しない
  3. **狭い正規表現で典型形だけ拾い、それ以外は unrecognized として一括報告**
- **Selected Approach**: 3を採用。対象は
  `` gh api -X GET repos/growilabs/growi/<path>[?query][ --paginate][ -f k=v ...] `` の
  形で、`-q` を含まないもの限定。マッチしない実データfixture（Derived /
  Constructed / `-q` 付き / dashboard配下の別書式など）は
  `unrecognized-format` として Requirement 5 の「確認できなかった対象」に
  含める
- **Rationale**: 決定的で誤検知が起きない範囲に絞ることが、値ではなく形の
  比較に限定した Requirement 1.3 の意図とも整合する
- **Trade-offs**: 一部の実データfixture（lockfile由来の派生物、dashboard
  配下など）はドリフト検知の対象外になる。ただしそれらは「未確認」として
  毎回報告され続けるので、見逃されることはない
- **Follow-up**: `.meta.md` の典型形を増やす（例えば dashboard配下の別書式
  にも対応する）ことは、需要が出た時点で正規表現を1パターン追加するだけで
  拡張できる

### Decision 2: 実行主体は新規スキルではなく GitHub Actions 定期ワークフロー
- **Context**: 上記 Research Log 参照
- **Alternatives Considered**:
  1. 新規スキル + Claude Codeのcron routine（brief.mdの当初案）
  2. **GitHub Actions の `on: schedule` ワークフロー + 決定的スクリプト**
- **Selected Approach**: 2。`.github/workflows/flaky-ci-fixture-freshness.yml`
  を新設し、四半期に1回、`bin/flaky-ci/scripts/check-fixture-drift.ts` と
  `check-fixture-wiring.ts` を実行、結果に応じて `gh issue create` /
  `gh issue comment` を行う
- **Rationale**: 判断を要さない機械的な処理をLLMセッションに担わせない、
  という元施策（flaky-ci-script-extraction）の方針と一致する。既存の
  `flaky-ci-routine` 系の手順書に一切変更を加える必要がない
- **Trade-offs**: GitHub Actions側は `gh` の認証を `GITHUB_TOKEN`
  （`permissions: issues: write` は `flaky-repro.yml` に前例あり）で
  行う必要がある。cloud routine環境のREST限定制約はここでは無関係
  （GitHub Actionsのrunner自体がGraphQLも使える環境だが、`lib/gh.ts` を
  再利用するため引き続きREST/`-X GET`のみに揃える）
- **Follow-up**: なし

### Decision 3: 重複起票の判定は固定ラベルによるissue検索で行う
- **Context**: Requirement 4.2「同一種別・同一対象について未解決のissueが
  既に存在する場合は新規issueを起票しない」
- **Alternatives Considered**:
  1. issueタイトルの完全一致で検索
  2. **固定ラベル（例: `flaky-ci/fixture-freshness`）を全実行が共通で使い、
     `state:open` で検索してあれば新規作成せずコメント追記**
- **Selected Approach**: 2。ラベル1つを起票時に必ず付け、次回実行時は
  `gh api -X GET search/issues -f q='repo:growilabs/growi label:flaky-ci/fixture-freshness state:open'`
  で検索する
- **Rationale**: 個別issueの対象（乖離候補・未配線候補の具体的なfixture名）
  は回によって変わりうるため、タイトル完全一致より粗く「今アクション待ちの
  freshness issueが1件でもあるか」で判定するほうがシンプルで、人が対応
  し忘れているものを1箇所に集約できる
- **Trade-offs**: 複数の異なる問題が同一issueに混在しうる。ただし本specの
  想定件数（四半期に1回、実データfixture約30件が対象）では混在しても
  読みにくくなるほどの量にはならない
- **Follow-up**: 実運用で issue が読みにくくなるようなら、対象の種別ごとに
  ラベルを分ける改善は別途検討する

## Risks & Mitigations
- `.meta.md` の典型形以外を機械チェックできない ── Decision 1 のとおり
  「未確認」として毎回報告し続けることで、見逃しではなく可視化された既知の
  制約にする
- GitHub Actions の `GITHUB_TOKEN` に `issues: write` 権限が必要 ──
  `flaky-repro.yml` に既存の前例があり、同じパターンを踏襲する
- 四半期に1回という頻度が実際のAPI変更検知として粗すぎる可能性 ──
  ユーザー判断で採用。実運用で検知が遅すぎると分かれば頻度は
  `cron` の1行を変えるだけで調整できる

## References
- `bin/flaky-ci/fixtures/README.md` — 本specが前提とする `.meta.md` 規約の
  一次情報源
- `.github/workflows/flaky-repro.yml` — `issues: write` 権限と `gh` 呼び出しの
  既存パターン
- `.github/workflows/release-rc-scheduled.yml` — `on: schedule` の既存前例
- `.kiro/specs/ci-flaky-test-detection/research.md` ── 「判断を通らない処理は
  スクリプトへ」という元施策の方針
