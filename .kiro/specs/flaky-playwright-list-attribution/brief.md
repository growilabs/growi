# Brief: flaky-playwright-list-attribution

完了済みの仕様 `ci-flaky-test-detection` の決まりを変えるための、一時的な仕様
（amend spec）。実装後に変更内容を `ci-flaky-test-detection` へ書き戻し、この
ディレクトリは削除する（`.claude/rules/spec-lifecycle.md`）。

## Amend target

- **対象の仕様**: `ci-flaky-test-detection`
- **変える決まり**: `design.md` の「Playwright の識別と確信度」の節。
  - 現在: テストごとの識別（`playwright:{BROWSER}:{SPEC_PATH}:{TEST_TITLE}`）
    を使えるのは、シャードのログに相異なる `::error file=…,title=…` 注釈が
    ちょうど 1 つあり、かつ集計（`N flaky` ＋ `N failed`）が 1 のときだけ。
    それ以外はジョブ単位の識別 `playwright:{BROWSER}` に記録する。
  - 変更後: テスト名は、Playwright がログ末尾に出す `N flaky` / `N failed`
    の一覧から読む。一覧に載ったテストは 1 件ずつテストごとの識別で記録する。
    ジョブ単位の識別は、一覧を読めなかったときだけ使う。
- **あわせて変える契約**: `bin/flaky-ci/README.md` の `parse-job-log` の出力
  （`playwright.*` の項目）。
- **Revalidation Triggers への影響**: `ci-flaky-test-detection` の
  Revalidation Triggers に、この変更で条件が変わる項目があるかを design の
  段階で確認し、あれば明記する。

## Problem

2026-11-17 に、実際の CI ログ 8 回分（`run-playwright` ジョブ）で次を確認した。

1. Playwright が GitHub Actions 向けに出す注釈は、ログ上で 2 通りの形になる。
   行の途中に出力されると `::error file=…,title=…` のまま残る。行の先頭に
   出力されると、ランナーが注釈として処理し
   `##[error]  1) [firefox] › path:line:col › title` に書き換える。どちらに
   なるかは回ごとに変わり、8 回中 4 回は後者だけだった。
2. `bin/flaky-ci/lib/job-log.ts` の `extractPlaywrightAnnotations` は
   `::error ` の形しか読まない。後者だけの回は注釈 0 件と判定され、失敗は
   ジョブ単位の issue（#12125 `playwright:firefox`、#12079
   `playwright:chromium`）に記録される。
3. その結果、次の 4 つが起きていた。
   - テストごとの issue に再発が記録されない。修正が効いたかどうかは「同じ
     識別がまた失敗するか」で確かめるので、その確認が働かない（2026-11-13
     の `create-page-button.spec.ts` の失敗は、そのテストの issue #11779 では
     なく #12125 に記録された）。
   - 発生回数が実際より少なく数えられる。
   - 同じ 1 回の失敗が 2 つの issue に重ねて記録される（2026-10-26 の失敗が
     #12139 と #12079 の両方に記録された）。
   - 固有の中身がないジョブ単位の issue が、人の判断待ちの一覧に載る。
4. `extractSummary` は件数を「ログ全体で最初に出てきた数字」で取る。1 つの
   ジョブの中で Playwright は 2 回起動される（`--project={browser}` と
   `--project={browser}/guest-mode`）ので、別の起動分の数字が混ざる。8 回中
   3 回で、`119 passed` のはずが `1 passed` と読まれた。

一方、ログ末尾の一覧は 8 回すべてで正確だった。

```
  1 flaky
    [firefox] › playwright/20-basic-features/create-page-button.spec.ts:23:3 › Create page button dropdown menu › open and create today page
  119 passed (5.0m)
```

`N flaky` の行の直後に、ちょうど N 行のテスト名が並ぶ。全試行で失敗した
テストは `N failed` の下に同じ形で並ぶ。同じ内容が 2 回出る（素のものと、
ランナーが `##[notice]` を付けて出し直したもの）。

## Desired Outcome

- 再実行で通った Playwright の失敗が、注釈がログ上でどちらの形になっても、
  テストごとの issue に記録される。
- 1 つのジョブで 2 件以上のテストが不安定だったときも、それぞれのテストの
  issue に記録される。
- 「推測で割り当てない」という方針は保つ。読むのは Playwright 自身が書いた
  一覧だけで、見出しの件数と行数が合わない一覧は読まない。
- 集計の件数が、別の Playwright 起動分と混ざらない。

## Scope

- `bin/flaky-ci/lib/job-log.ts`、`bin/flaky-ci/scripts/parse-job-log.ts` と
  そのテスト、fixture
- `bin/flaky-ci/README.md` の契約表
- `.claude/skills/detect-flaky-ci/SKILL.md` の、Playwright のテストを特定する
  決まり（`investigate-flaky-test` と `flaky-ci-routine` には該当する記述が
  無く、変更しない）
- 既存の `playwright:{BROWSER}` の issue の扱い

## Out of Scope

- vitest 側の検出、Cheap Suspicion Mining、ダッシュボード
- `##[error]` の形の注釈を読めるようにすること（一覧を読めば要らない）
- 既存 issue の題名（識別）の形の変更
