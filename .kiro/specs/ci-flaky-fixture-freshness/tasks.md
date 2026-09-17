# Implementation Plan

- [x] 1. Foundation: 既存の `.meta.md` 全件を分類し、典型形・非典型形の実例をテスト用に確保する
  - `bin/flaky-ci/fixtures/{api,lockfile,job-logs}/**/*.meta.md` を全件確認し、
    `real-checkable`（`-q` を含まない典型形の `gh api -X GET` コマンドを含む）・
    `synthetic`・`unrecognized`（`-q` 付き・ローカル派生物・
    `api/dashboard/` の別書式など）の3分類に振り分けた一覧を作る
  - 各分類の代表例を最低2件ずつ書き出す（後続タスクのテスト入力にそのまま使う）
  - 観測可能な完了状態: 3分類それぞれについて実際の `.meta.md` 本文の実例が
    最低2件ずつ手元にあり、次のタスクでそのままテストの入力に使える
  - _Requirements: 1.1, 1.4, 5.3_

- [ ] 2. Core: 分類・形比較・参照配線チェックの実装
- [ ] 2.1 (P) `.meta.md` の `# Source` 節を解析し、real-checkable / synthetic / unrecognized を判定するロジックを実装する
  - タスク1で確保した実例を入力に、3分類を返す純粋関数を実装する
    （design.md `meta-source.ts` の Service Interface契約）
  - `real-checkable` と判定するのは、典型形（`-q` を含まない
    `gh api -X GET repos/growilabs/growi/<path>` + 任意の `--paginate` /
    `-f k=v`）に完全一致したときだけとする
  - 観測可能な完了状態: タスク1で集めた実例すべてを入力すると、意図した
    分類（`real-checkable` / `synthetic` / `unrecognized`）がそれぞれ返る
  - _Requirements: 1.1, 1.4, 5.3_
  - _Boundary: meta-source.ts_

- [x] 2.2 (P) JSON値の「形」を計算し、2つの形を比較するロジックを実装する
  - オブジェクトはキーごとに再帰的に、配列は要素0個目だけを代表として、
    値ではなく型のみを保持する「形」を計算する純粋関数を実装する
    （design.md `fixture-shape.ts` の Service Interface契約）
  - キーパスの配列で形の差分を返す比較関数を実装する
  - 観測可能な完了状態: キー追加・削除・型変更を含む2つのJSON値を比較すると
    差分キーパスが返り、値だけが違う2つのJSON値（文字列内容・配列要素数の
    違いのみ）を比較すると空配列が返ることがテストで示される
  - _Requirements: 1.2, 1.3_
  - _Boundary: fixture-shape.ts_

- [ ] 2.3 (P) fixtureファイルがテストから参照されているかを確認するロジックを実装する
  - `bin/flaky-ci/fixtures/` 配下の各データファイル（`.meta.md` 自身は除く）
    について、そのfixtures相対パスが `bin/flaky-ci/**/*.spec.ts` のいずれかの
    ソース文字列として現れるかを確認するCLIを実装する
    （design.md `check-fixture-wiring.ts` の Batch Contract）
  - 観測可能な完了状態: 意図的に未参照のダミーfixtureを1件用意して実行すると、
    そのファイルが `unwired` として報告され、既存の正しく参照されている
    fixtureは報告されない
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: check-fixture-wiring.ts_

- [ ] 3. Core: 実データfixtureについて、分類結果に応じてGitHub APIを再取得し形を比較するCLIを実装する
  - タスク2.1の分類結果が `real-checkable` のものだけ、既存の
    `lib/gh.ts` の `GhApi.get()` で再取得し、タスク2.2の形比較にかける
  - `synthetic` は再取得対象から除外し、`unrecognized` は再取得せず
    `unchecked` に含める
  - GitHub API呼び出しの失敗（`GhError`）は例外を伝播させず `unchecked` に
    分類し、「乖離なし」として扱わない
  - 観測可能な完了状態: 実行すると `{checked, drift[], unchecked[]}` の形の
    JSONが標準出力に出る。意図的に形を変えたモック応答・取得失敗をモックした
    `GhApi` を渡すテストで、それぞれ `drift` / `unchecked` に正しく分類される
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.3_
  - _Depends: 2.1, 2.2_

- [ ] 4. Integration: 定期実行ワークフローの実装
- [ ] 4.1 四半期に1回、両スクリプトを実行し結果を記録するワークフローを作成する
  - `.github/workflows/flaky-repro.yml` の `permissions` パターン
    （`contents: read`, `issues: write`）を踏襲し、`on: schedule`（四半期cron）
    と `workflow_dispatch` の両方で起動できるワークフローを作成する
  - タスク3のドリフト検知CLIとタスク2.3の配線チェックCLIを実行し、
    対象件数・drift件数・unwired件数・unchecked件数を `$GITHUB_STEP_SUMMARY`
    に記録する（issue起票の有無に関わらず必ず記録する）
  - 観測可能な完了状態: `workflow_dispatch` で手動起動すると、ジョブサマリーに
    上記4種の件数が表示される
  - _Requirements: 3.1, 3.2, 5.2_
  - _Depends: 3, 2.3_

- [ ] 4.2 検知結果に応じたissue起票・重複防止ロジックを実装する
  - 前提として、issue起票・検索に使うラベル `flaky-ci/fixture-freshness` が
    リポジトリに存在しない場合は作成する（`gh label create` は既存ラベルに
    対して失敗するため、存在確認または `|| true` 相当の扱いで冪等にする —
    `.github/workflows/flaky-repro.yml` はラベルを使わないため、このラベルの
    作成はこのタスクが初めて行う）
  - drift または unwired が1件以上のとき、そのラベルかつ `state:open` の
    issueを検索し、あれば `gh issue comment` で追記、なければ
    `gh issue create` で同ラベルを付けて新規作成する。0件のときはissueを
    起票しない
  - 観測可能な完了状態: drift/unwiredが出る条件でワークフローを実行すると
    issueが作成され、同条件で再度実行しても新規issueが増えず既存issueに
    コメントが追記される。0件の条件で実行するとissueが作られない
  - _Requirements: 4.1, 4.2, 4.3_
  - _Depends: 4.1_

- [ ] 4.3 `bin/flaky-ci/fixtures/README.md` に、典型形以外の `.meta.md` は自動チェック対象外になる旨を追記する
  - タスク2.1で確定した典型形の書式と、それ以外（`-q` 付き・派生物・別書式）が
    `unrecognized`（未確認）として扱われることを短く追記する
  - 観測可能な完了状態: READMEを読むと、どの `.meta.md` の書き方が自動チェック
    の対象になり、どれがならないかが分かる
  - _Requirements: 5.3_

- [ ] 5. Validation: 実際のワークフローを1回動かし、issue起票と重複防止が設計どおり動くことを確認する
  - 自己検証用の使い捨てissue・ブランチ等を用い、`workflow_dispatch` で
    手動起動する。意図的に未配線のダミーfixtureを1件仕込んだ状態と、
    仕込まない状態の両方で1回ずつ実行する
  - 既存issueがある状態でもう一度実行し、issue番号が変わらずコメントだけが
    追記されることを確認する
  - 観測可能な完了状態: issue起票（1回目）・コメント追記（2回目、重複起票
    なし）が実際のGitHub上で確認され、確認後にダミーfixture・使い捨て
    issue・ブランチを片付けてある
  - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 5.1, 5.2_

## Implementation Notes

### タスク1: `.meta.md` 全件の分類カタログ（後続タスク2.1のテスト入力）

`bin/flaky-ci/fixtures/{api,lockfile,job-logs}/**/*.meta.md` 全50件を確認し、
design.md `meta-source.ts` の分類ルール（典型形の `gh api -X GET
repos/growilabs/growi/<path>[?query][ --paginate][ -f k=v ...]`、`-q` を
含まないもの限定）と research.md Decision 1 に沿って3分類に振り分けた。
`api/dashboard/` 配下2件は `# Source` ではなく `` # `<filename>` `` 見出し
（`<name>.md.meta.md` 命名）を使うため典型形の正規表現に一致せず、
Decision 1 のとおり unrecognized に分類される。個別の実例として下記にも
挙げてある。

以下の各行はファイルの `# Source` 節の該当行をそのまま引用している。

#### real-checkable（典型形に完全一致 — `-X GET` あり・`-q` なし）

- `api/commits/0d1a319a-pulls.json.meta.md` — 引用:
  `` - **Real.** `gh api -X GET repos/growilabs/growi/commits/0d1a319a106b2a791e883170782e856f88b0e178/pulls`. ``
  → `-X GET` + パス、クエリなし・`--paginate` なし・`-q` なしの最小形。
- `api/issues/11821-comments.json.meta.md` — 引用:
  `` - **Real.** `gh api -X GET repos/growilabs/growi/issues/11821/comments --paginate`. ``
  → 典型形 + `--paginate`。
- `api/issues/fetch-flaky-issues-confirmed-page1.json.meta.md` — 引用:
  `` - **Real.** `gh api -X GET repos/growilabs/growi/issues -f state=all -f labels=flaky/confirmed -f per_page=3 -f page=1` against `growilabs/growi`. ``
  → 典型形 + 複数の `-f key=value`。
- `api/pulls/11919-files.json.meta.md` — 引用:
  `` - **Real.** `gh api -X GET repos/growilabs/growi/pulls/11919/files --paginate`. ``
  → 典型形 + `--paginate`（別エンドポイント種別の確認用）。

#### synthetic（`# Source` が `**Synthetic.**` で始まる）

- `api/issues/synthetic-no-date-issue.json.meta.md` — 引用:
  `- **Synthetic.** No real flaky-tracking issue lacks a \`Date:\` line: every open/closed \`flaky/*\` issue checked was filed by \`detect-flaky-ci\`'s template...`
  → 冒頭が `**Synthetic.**` で始まる典型例。
- `api/issues/synthetic-duplicate-sha-repro-result.slurp.json.meta.md` — 引用:
  `- **Synthetic.** Task 1.3 searched for a real issue with two \`### Repro result\` comments naming the *same* commit SHA...`
  → 冒頭が `**Synthetic.**`、実データの一部を手で改変して合成した例。
- `api/issues/synthetic-no-labeled-event-11823-events.json.meta.md` — 引用:
  `- **Synthetic.** No open \`flaky/needs-decision\` issue currently has a missing/truncated \`labeled\` event...`
  → 冒頭が `**Synthetic.**`。

#### unrecognized（典型形に一致しない・`-q` 付き・別語彙・別書式）

- `lockfile/11886-pnpm-lock.patch.meta.md` — 引用:
  `` - **Real.** Extracted with `gh api -X GET repos/growilabs/growi/pulls/11886/files --paginate -q '.[] | select(.filename=="pnpm-lock.yaml") | .patch'` ``
  → 実データの `gh api -X GET` だが `-q` jqフィルタを含むため典型形から除外（design.mdが明示的にunrecognizedとする条件）。
- `lockfile/11886-extracted-package-names.json.meta.md` — 引用:
  `- **Derived, not raw API data.** This is the full set of package names extracted from \`11886-pnpm-lock.patch\` by hand-applying the two rules...`
  → 冒頭が `**Derived, not raw API data.**`。再取得すべき `gh api` エンドポイントが存在しない派生物。
- `api/commits/constructed-empty-pulls.json.meta.md` — 引用:
  `` - **Constructed.** `GET commits/{sha}/pulls` returning `[]` is the shape every "no PR yet found by the direct route" branch needs... ``
  → 冒頭が `**Constructed.**`（`**Synthetic.**` とは異なる語彙）。
- `api/dashboard/11720-body.md.meta.md` — 引用:
  `` # `11720-body.md` `` （見出し行そのもの。本文は `- **Source**: real. Issue **#11720**...`）
  → `# Source` ではなく `` # `<filename>` `` 見出しを使う `api/dashboard/` 配下の別書式（ファイル名も `<name>.md.meta.md`）。
- `api/check-runs/0d1a319a-check-runs.json.meta.md` — 引用:
  `` - **Real**: `gh api repos/growilabs/growi/commits/0d1a319a106b2a791e883170782e856f88b0e178/check-runs?per_page=100`. ``
  → 実際にはGETだが `-X GET` の記述自体が無く、典型形の正規表現に文字どおり一致しないエッジケース。
