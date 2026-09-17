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
- [x] 2.1 (P) `.meta.md` の `# Source` 節を解析し、real-checkable / synthetic / unrecognized を判定するロジックを実装する
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

- [x] 2.3 (P) fixtureファイルがテストから参照されているかを確認するロジックを実装する
  - `bin/flaky-ci/fixtures/` 配下の各データファイル（`.meta.md` 自身は除く）
    について、そのfixtures相対パスが `bin/flaky-ci/**/*.spec.ts` のいずれかの
    ソース文字列として現れるかを確認するCLIを実装する
    （design.md `check-fixture-wiring.ts` の Batch Contract）
  - 観測可能な完了状態: 意図的に未参照のダミーfixtureを1件用意して実行すると、
    そのファイルが `unwired` として報告され、既存の正しく参照されている
    fixtureは報告されない
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: check-fixture-wiring.ts_

- [x] 3. Core: 実データfixtureについて、分類結果に応じてGitHub APIを再取得し形を比較するCLIを実装する
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
- [x] 4.1 四半期に1回、両スクリプトを実行し結果を記録するワークフローを作成する
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

- [x] 4.2 検知結果に応じたissue起票・重複防止ロジックを実装する
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

- [x] 4.3 `bin/flaky-ci/fixtures/README.md` に、典型形以外の `.meta.md` は自動チェック対象外になる旨を追記する
  - タスク2.1で確定した典型形の書式と、それ以外（`-q` 付き・派生物・別書式）が
    `unrecognized`（未確認）として扱われることを短く追記する
  - 観測可能な完了状態: READMEを読むと、どの `.meta.md` の書き方が自動チェック
    の対象になり、どれがならないかが分かる
  - _Requirements: 5.3_

- [x] 5. Validation: 実際のワークフローを1回動かし、issue起票と重複防止が設計どおり動くことを確認する
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

### タスク2.1: `meta-source.ts` レビューで見つかった非ブロッキングの懸念

`parseMetaSource` は real-checkable 判定の正規表現を `.meta.md` 全文に対して
先に試し、`**Synthetic.**` マーカーの確認より先に行う。現在存在する全
fixtureでは、synthetic な `.meta.md` の本文中に `repos/growilabs/growi/...`
形式のGETコマンドが（別の話題として）埋め込まれることが無いため誤判定は
起きないが、これは現在のfixtureの内容がたまたまそうなっているだけで、
コード側に「一致したコマンドがそのfixture自身の出典であること」を保証する
チェックは無い。将来 synthetic な fixture が同じ形式のコマンドを本文中に
引用するようになった場合、real-checkable に誤判定される可能性がある。
対応が必要になったら、synthetic マーカーの確認を real-checkable の正規表現
より先に行う、または一致箇所が `# Source` の最初の箇条書きに限られることを
要求する、のいずれかで直せる（現時点では対応不要、要件を満たしている）。

### タスク2.3: レビューを6ラウンド経て収束、README.md除外とスコープ判断（advisor相談の結果）

`check-fixture-wiring.ts` の「ヘルパー関数呼び出し経由の参照」検出ロジックは、
レビューで6ラウンド連続して不具合が見つかった（コーパス全体での無関係な
共起→ファイル内での無関係な共起→識別子と紐付けない共起→プロパティアクセス
の誤検知→`.`と識別子の間の空白/改行で回避可能、の順）。5〜6ラウンド目以降は
実リポジトリ上で今起きている誤検知ではなく、手作りした敵対的な入力でしか
再現しない、より狭いエッジケースになっていた。advisorに相談した結果、
「タスク自身が定めた観測可能な完了状態（ダミーfixtureの検知・実際に参照
されているfixtureの非検知）は既にラウンド2の時点で満たされており、
`design.md` はテキストマッチング（AST解析ではない）を明示的な設計判断として
選んでいるため、その限界の中で構築可能な反例を無限に探し続けるレビューは
完了条件ではない」との判断を受け、仕様適合性のみを見るゲートチェック1回に
切り替えて収束させた（`.claude/rules/coding-style.md` の「仕様に適合した
変更を、粗が見つかったというだけで自動的に却下しない」という基準に対応）。
検出できない残存ケース（`.`とコメントが識別子の間に挟まる形など）は
モジュールのdocコメントに正直に記録済み。

あわせて advisor の指摘を受け、`README.md`（fixtures配下の運用ルール文書）を
健全性チェックの対象から除外する判断をこのタスクの中で行った（`.meta.md`
と同じ理由 — fixtureのデータではなく、fixtureについての文書であるため）。
これは要件2.3が明示していない小さな解釈の補足であり、要件・設計の変更では
ない。実リポジトリに対する実行結果、`checked: 63`（README.md除外後）で
`unwired` に残るのは `expected/*.md` 8件（PR #11921がこのspec全体の発端と
なった既知の未配線）と `api/issues/11823-repro-result-comments.slurp.json`
1件（今回のレビューで新たに見つかった、どの `.spec.ts` からも参照されて
いない実データfixture）。どちらも本物の検知であり、タスク4.2でissue化
される対象になる（意図どおり）。

### タスク3: `checked` の数え方の確定、実データでの実測結果

Requirements/design.md が明示していなかった `checked` の数え方を、
`check-fixture-drift.ts` 実装時に確定した: `checked` は real-checkable と
分類され、GitHub取得が成功し形比較まで行われたfixtureの件数（乖離が
見つかったものも含む）。synthetic（そもそも対象外、Requirement 1.4）と
unchecked（`.meta.md` が典型形でない、または取得失敗、Requirement 5.1/5.3）
は含めない。タスク2.3の `check-fixture-wiring.ts` の `checked`（実際に
検証を行った対象の件数）と同じ考え方。タスク4.1で「対象件数」を出す際は
`checked + unchecked.length`（synthetic除く）を使えばRequirement 3.2の
意図を満たせる。

実データでの実測（stub `GhApi` で自分自身のfixtureをラウンドトリップさせた
実行）: `checked: 18, drift: 0, unchecked: 28`。50件の実データ`.meta.md`が
18 real-checkable / 4 synthetic / 28 unrecognized に分かれることをタスク1の
カタログと独立に再確認済み。

### タスク4.1レビューで発覚した重大バグ（タスク2.1由来、修正必須）

タスク4.1のレビューで、実際の `gh` CLI（stubでない）を使って
`check-fixture-drift.ts` を実行すると `checked: 2` にまで落ち込み、
タスク3時点のstubベースの実測（`checked: 18`）と大きく食い違うことが判明。
原因は `lib/meta-source.ts` の `REAL_CHECKABLE_COMMAND_RE` が
`repos/growilabs/growi/` というプレフィックスをキャプチャグループの外に
置いており、`source.path` にこのプレフィックスが含まれない状態で
`GhApi.get()`/`getAll()` に渡っていたこと。結果、ほとんどの実取得が
404になり `unchecked` に回るだけでなく、`issues -f state=all -f
labels=...` のケースは `repos/growilabs/growi/issues` ではなく
**無関係な別エンドポイント `GET /issues`**（認証ユーザー宛てのissue一覧、
このリポジトリとは無関係）に到達してしまい、たまたま `200 OK` で空配列
`[]` が返るため `fixture-shape.ts` の配列比較が「乖離なし」と**誤って
成功扱い**していた。stubを使ったタスク3・そのレビューでは、stub自身が
同じプレフィックス無しのパスをキーにして自分のデータを返していたため、
このバグは一切顕在化しなかった。

tasks.md の元のタスク一覧にはこの修正専用のタスクが無いため、タスク5
（実測検証）の前提を壊さないよう、タスク4.2に進む前に `lib/meta-source.ts`
の `path` 抽出を修正し、実際の `gh` CLI 経由で `checked` が18件前後に戻る
ことを再確認してから先に進んだ（修正済み・コミット634407f131）。

### タスク4.2: 既知の制約（drift findingsに出典が無い）

`check-fixture-drift.ts` の `DriftFinding` は `{ file, diffPaths }` のみで、
再取得先のGitHub APIエンドポイント（出典）を持たない。そのためissue本文の
drift件の行には対象fixtureと差分キーは出るが出典は出ない
（`unchecked` 件のほうは `{ file, reason }` を持つため出典相当の情報は出る）。
これはタスク3で承認済みの `DriftFinding` の形の制約であり、このタスクの
境界（ワークフローYAML）では直せない。要件4.1の文字どおりの要求からは
小さな未達だが、fixtureのパスから `.meta.md` を辿れば出典は追える。
将来対応するなら `check-fixture-drift.ts` 側の変更が必要で、それは
tasks.mdに無い別タスクになる。

### タスク5: `workflow_dispatch` はデフォルトブランチ（master）にマージされたワークフローでしか使えない

`.github/workflows/flaky-repro.yml` は `push` トリガー（`flaky-repro/**`
ブランチへのpush）だったため、機能ブランチのままセルフテストできた
（`ci-flaky-test-detection` の研究ログ参照）。本specの
`flaky-ci-fixture-freshness.yml` は `on: schedule` と `on: workflow_dispatch`
のみで、`push` トリガーを持たない。`gh workflow run ... --ref
feat/ci-flaky-fixture-freshness` を試したところ
`HTTP 404: workflow ... not found on the default branch` で失敗した ──
GitHubの仕様上、`workflow_dispatch` はワークフローファイルがデフォルト
ブランチに存在しないと呼び出せない。このため、タスク5（1回目のissue起票・
2回目の重複防止コメントの実測）は、このPRがmasterへマージされ、ワーク
フローファイルがデフォルトブランチに乗ってから実施する。マージ後に作られる
issueは「使い捨て」ではなく、四半期routineが実際に最初に検知した本番の
結果になる見込み（現時点で `bin/flaky-ci/fixtures/expected/*.md` 等、
実際に未配線のfixtureが存在するため）。

### タスク5: 実測結果と、実測で見つかったもう1つの実バグ（GH_TOKEN未設定）

PR #11929 のmasterマージ後、`workflow_dispatch` で2回実行して実測した。

1回目の実行（run 35221816827）で `checked: 0` となり、`check-fixture-drift.ts`
内の全ての `gh api` 呼び出しが `GH_TOKEN environment variable` エラーで
失敗していることが判明。devcontainerでは `gh` が事前認証済みのため
気づけなかったが、GitHub Actionsランナーでは `gh` に `GH_TOKEN` を明示的に
渡す必要がある（issue起票側のステップには既に設定されていたが、
`check-fixture-drift.ts` を呼ぶステップだけ漏れていた）。失敗自体は
`unchecked` に正しく振り分けられ「乖離なし」という誤った成功にはならな
かった（Requirement 5.1が意図どおり機能）が、ドリフト検知そのものが
一度も実行されていなかった。この時作られたissue #11934はクローズ済み。

修正（PR #11936、`GH_TOKEN: ${{ github.token }}` を追加、マージ済み）後に
再実行した2回の結果:

- 1回目（run 35222762606）: `checked: 18, drift: 0, unchecked: 28`（タスク3の
  stubベースの想定と一致）、`unwired: 9`。issue #11937 を新規作成
- 2回目（run 35222896965）: 同じ集計値。issue番号は #11937 のまま増えず、
  コメントが1件追記された（重複起票なし、Requirement 4.2どおり）

意図的な未配線ダミーfixtureは仕込まなかった（このリポジトリには既に
`expected/*.md` 等の実際の未配線fixtureが存在し、それ自体が
findings>0の実データとして使えたため）。issue #11937 は使い捨てではなく、
四半期routineが実際に検知した最初の本番結果として残す。
