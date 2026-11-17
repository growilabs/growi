# Research & Design Decisions

## Summary

- **Feature**: `flaky-playwright-list-attribution`（`ci-flaky-test-detection` の
  決まりを変える一時的な仕様）
- **Discovery Scope**: Extension（既存の検出の仕組みの一部を置き換える）
- **Key Findings**:
  - Playwright の注釈は、ログ上で 2 通りの形になる。検出スクリプトは片方しか
    読まないので、テストを特定できない回が半分ほどある
  - ログ末尾の一覧は、調べた 8 回すべてで、不安定だったテストを正確に示して
    いた
  - 既存の追跡 issue の題名には、形が 2 種類ある。古いものはテスト名を囲む
    グループ名（`describe` の名前）を欠いている

## Research Log

### 注釈がログ上で 2 通りの形になる

- **Context**: 2026-11-13 の `create-page-button.spec.ts` の失敗が、テストごと
  の issue（#11779）ではなく、ジョブ単位の issue（#12125）に記録されていた。
- **Sources Consulted**: 実際の `run-playwright` ジョブのログ 8 件を
  `gh api --allow-escape-sequences repos/growilabs/growi/actions/jobs/{id}/logs`
  で取得して調べた。

  | run | ジョブ | `::error ` の行 | `##[error]` の行 | 解析結果の注釈数 |
  |---|---|---|---|---|
  | 43419616882 | firefox 1/2 8.0 | 0 | 2 | 0 |
  | 40328009901 | chromium 1/2 8.0 | 0 | 1 | 0 |
  | 40645996312 | chromium 1/2 8.0 | 0 | 1 | 0 |
  | 41984122671 | chromium 1/2 8.0 | 0 | 7 | 0 |
  | 39935584265 | firefox 1/2 6.0 | 2 | 1 | 2 |
  | 39396183542 | webkit 1/2 8.0 | 1 | 1 | 1 |
  | 37614379410 | webkit 1/2 8.0 | 1 | 1 | 1 |
  | 38673655848 | chromium 2/2 8.0 | 1 | 0 | 1 |

- **Findings**:
  - Playwright の `github` reporter は、失敗したテストごとに
    `::error file=…,title=…::メッセージ` を出力する。
  - この行が進捗表示の記号の直後など、行の途中に出力されると、ランナーは
    注釈として処理せず、そのまま残す。
  - 行の先頭に出力されると、ランナーが注釈として処理し、
    `##[error]  1) [firefox] › path:line:col › title` に書き換える。
    `file=` と `title=` の値はログから消える。
  - どちらになるかは出力のタイミングしだいで、回ごとに変わる。
  - `bin/flaky-ci/lib/job-log.ts` の `extractPlaywrightAnnotations` は
    `::error ` の形だけを読む。コメントには「`##[…]` の形の実例が手元に無い
    ので、推測で対応しない」とある。当時は実例が無かった。
- **Implications**: 注釈の行に頼る限り、テストを特定できるかどうかが出力の
  タイミングで決まる。

### ログ末尾の一覧

- **Context**: 注釈の代わりになる、安定した読み取り元があるか。
- **Findings**:
  - 同じ 8 件すべてで、Playwright の実行の終わりに次の形の一覧が出ていた。

    ```
      1 flaky
        [firefox] › playwright/20-basic-features/create-page-button.spec.ts:23:3 › Create page button dropdown menu › open and create today page
      119 passed (5.0m)
    ##[notice]  1 flaky
        [firefox] › playwright/20-basic-features/create-page-button.spec.ts:23:3 › Create page button dropdown menu › open and create today page
      119 passed (5.0m)
    ```

  - `N flaky` の行の直後に、ちょうど N 行のテスト名が並ぶ。全試行で失敗した
    テストは `N failed` の下に同じ形で並ぶ。
  - 同じ内容が 2 回出る。2 回目は、reporter が出した
    `::notice title=…::` をランナーが処理したもので、1 行目に `##[notice]`
    が付く。
  - 一覧の各行は `[project] › path:line:col › グループ名 › テスト名` の形で、
    注釈の `title=` の値と同じである。ただし、一覧の行は末尾に空白が 1 つ
    付く（注釈の値には付かない）。
  - `pnpm playwright test --list` の出力も、各テストを同じ形の行で示す。
    ただし見出しは `Listing tests:` と `Total: …` で、件数の行は無い。
- **Implications**: 一覧を読めば、注釈の形に左右されずにテストを特定できる。
  さらに、再実行で通ったテストと全試行で失敗したテストが、Playwright 自身に
  よって分けて書かれている。

### 1 つのジョブの中で Playwright が 2 回起動される

- **Context**: `extractSummary` の結果で、`119 passed` のはずが `1 passed`
  になっている回があった（8 件中 3 件）。
- **Findings**:
  - `run-playwright` ジョブは `pnpm playwright test --project={browser}` と
    `--project={browser}/guest-mode` を続けて実行する。インストール用の実行
    が先に入る回もある。
  - `extractSummary` は、`failed` / `flaky` / `passed` / `skipped` のそれぞれ
    について、ログ全体で最初に出た数字を採る。そのため、別の実行の数字が
    1 つの集計に混ざる。
- **Implications**: いまの判定は `flaky` と `failed` の合計しか使わないので
  実害は出ていないが、別の実行の `failed` が混ざると判定を誤る。集計は実行
  ごとに読む必要がある。

### 既存の追跡 issue の題名に、形が 2 種類ある

- **Context**: 一覧から作る識別が、既存の issue の題名と一致するか。
- **Sources Consulted**: `flaky: playwright:` で始まる issue 39 件の題名。
- **Findings**:
  - #11903（2026-09）以降の issue は、グループ名を含む形である。
    例: `playwright:chromium:playwright/20-basic-features/inline-comment.spec.ts:Inline comment - … > Req 15.1, …`
  - それより前の issue と #12059 は、テスト名の末尾だけを持つ。
    例: #11779 は `…create-page-button.spec.ts:open and create today page`
    だが、テストは `Create page button dropdown menu` というグループの中に
    ある。
  - ブラウザの部分は、ジョブ名のブラウザではなく project 名の先頭の部分に
    なっている。ゲスト用のテストの #11782 は `chromium`、準備用のテストの
    #11955 は `users` である。
  - #11711 だけはブラウザの部分を持たない。
- **Implications**: いまの形（グループ名を含む）で識別を作ると、古い形の
  issue とは一致しない。古い形の issue を放置すると、同じテストの issue が
  新旧 2 つに分かれる。

## Design Decisions

### Decision: テスト名はログ末尾の一覧から読む

- **Context**: 注釈の行は、ログ上の形が回ごとに変わる。
- **Alternatives Considered**:
  1. `##[error]` の形の注釈も読めるようにする — 1 つの注釈が 2 通りの形で
     出る回があり（run 39935584265）、同じものを同じと判定する処理が要る。
     再実行で通ったのか全試行で失敗したのかは、注釈からは分からない。
  2. ログ末尾の一覧を読む — 形が 1 通りで、再実行で通ったテストと全試行で
     失敗したテストが分かれている。
- **Selected Approach**: 2。注釈の読み取りは削除する。
- **Rationale**: 一覧は Playwright が実行結果として書いたもので、件数の行と
  突き合わせて正しさを確かめられる。注釈を読む処理と、手順書の「注釈が
  ちょうど 1 つで、集計が 1」という条件が要らなくなる。
- **Trade-offs**: 一覧が出力されない状況（実行が途中で打ち切られたなど）
  では、テストを特定できない。その場合は従来どおりジョブ単位の識別に記録
  する。
- **Follow-up**: Playwright の版が上がって一覧の形が変わると読めなくなる。
  件数と行数の突き合わせで検知し、ジョブ単位の識別に記録される。

### Decision: 件数と行数が合わない一覧は読まない

- **Context**: 「推測で割り当てない」という元の仕様の方針を保つ。
- **Selected Approach**: `N flaky` の見出しの下に、テスト名の行がちょうど N
  行あるときだけ、その一覧を読む。1 行でも形が合わない行があれば、その一覧
  全体を読まない。
- **Rationale**: 一部だけ読めた一覧からテストを記録すると、残りのテストが
  記録されないまま「全部記録した」ように見える。

### Decision: `##[notice]` で始まる 2 回目の一覧は捨てる

- **Context**: 同じ一覧が 2 回出るので、数え方を決める必要がある。
- **Alternatives Considered**:
  1. 2 回とも読み、同じテストを 1 件にまとめる
  2. 1 行目に `##[notice]` が付いた一覧を、読む対象から外す
- **Selected Approach**: 2。
- **Rationale**: 2 回目の一覧は 1 行目の形が違うので、見分けられる。
  1 は「同じ実行の重複」と「別の実行で同じテストが不安定だった」を区別
  できない。

### Decision: 集計は Playwright の実行ごとに読む

- **Selected Approach**: 件数の行とテスト名の行が続いている範囲を、1 回の
  実行の集計として読む。ジョブのログからは、実行の数だけ集計が得られる。
- **Rationale**: 確定か観測かの判定に、そのテストが載っている実行の結果
  だけを使える。

### Decision: 識別の組み立てをスクリプトに移す

- **Context**: いまは手順書が、注釈の値から識別を作る手順（先頭の
  `[browser] › ` を外す、位置の部分を外す、` › ` を ` > ` に替える）を文章で
  示し、AI が実行している。
- **Selected Approach**: スクリプトが、一覧の各テストについて識別の文字列を
  返す。ブラウザの部分は project 名の先頭の部分にする。
- **Rationale**: 題名が 1 文字でも違うと、既存の issue と一致せず、重複した
  issue が作られる。文字列の組み立ては機械的な処理である。project 名の先頭
  の部分を使うと、既存の issue（#11782、#11955）の題名と同じになる。

### Decision: 古い形の題名は、一度だけいまの形に直す

- **Context**: 古い形の題名の issue が 26 件ほどある。すべて閉じている。
- **Alternatives Considered**:
  1. 既存 issue を探すときに、古い形でも探す処理を恒久的に足す
  2. 古い形の題名を、一度だけいまの形に直す
- **Selected Approach**: 2。対象のテストがいまのテストの一覧に 1 つだけ
  見つかる issue の題名を直す。1 つも見つからない issue（テストが消えた、
  名前が変わった）は直さない。2 つ以上見つかった issue は、候補を並べて人
  に判断してもらう。
- **Rationale**: 1 は、同じファイルの別のグループに同じ名前のテストがある
  と、別のテストを同じ issue に記録してしまう。2 は、直した後は識別の形が
  1 種類になり、探す処理を増やさずに済む。1 つも見つからなかった issue
  は、その名前のテストがもう無いので、再発が記録されることもない。2 つ
  以上見つかった issue は、テストが今もあるので、放置すると次の発生が
  新しい issue に分かれる。そのため自動では直さず、人の判断に回す。
- **時期**: 題名を直す作業は、検出の変更をマージする前に終える。マージの
  後は、すべての回でグループ名を含む識別が作られるためである。
- **Trade-offs**: issue の題名を 20 件あまり書き換える。書き換えた対応は
  PR の説明に残す。

### Decision: ジョブ単位の issue に記録済みの発生は移さない

- **Rationale**: 過去の発生をテストごとの issue に移すと、コメントの日付と
  発生の日付がずれ、発生回数の計算（コメントの見出しを数える）が実際と合わ
  なくなる。#12125 と #12079 は、記録された発生の出どころを書いたうえで
  閉じてある。

## Risks & Mitigations

- **Playwright の版が上がり、一覧の形が変わる** — 件数と行数の突き合わせに
  失敗するので、ジョブ単位の識別に記録される。誤ったテストに記録されること
  はない。ジョブ単位の issue が増えたら、形が変わった合図になる。
- **一覧の途中に別の出力が挟まる** — 件数と行数が合わなくなり、その一覧は
  読まれない。上と同じ扱いになる。
- **題名を直した issue を、古い題名で参照している箇所がある** — 参照は
  issue 番号で行われているので、題名の変更では切れない。fixture の中に古い
  題名があるが、fixture は取得時点の記録なので書き換えない。

## References

- 実際のログの出どころ: 上の表の run とジョブ
- `apps/app/playwright.config.ts` — reporter は CI で `github` と `blob`
- `ci-flaky-test-detection` の `design.md`「Playwright の識別と確信度」
