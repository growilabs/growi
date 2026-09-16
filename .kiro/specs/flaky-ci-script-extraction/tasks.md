# Implementation Plan

監査の候補 14 件はスクリプト 13 本になる（#9 と #10 は 1 本のログ解析にまとめる）。各スクリプトのタスクは「純粋関数＋スクリプト＋テスト＋手順書の該当節の置き換え」を 1 コミットで行う。同じ手順書ファイルと `bin/flaky-ci/README.md` の契約表を複数タスクが書き換えるため、`(P)` は付けず順に実行する。

- [ ] 1. Foundation: 実行環境の実測と `bin/flaky-ci/` の土台
- [x] 1.1 cloud routine の実行環境を実測して記録する
  - 測定だけを行う 1 回限りの実行を用意する: 既存 routine の実行 API に「`node --version`・`gh --version`・Write ツールの有無・`node` で `import` 付きの `.ts` を直接実行できるかを出力して終わる」プロンプトを 1 回だけ渡す（プロンプトの差し替えが API で通らなければ、同じ環境を指す一時的な予定実行を作って 1 回動かし、その後削除する）。通常の routine 処理は行わせない
  - 手元（devcontainer）の同じ値を並べて記録する
  - 観測可能な完了状態: 両環境の Node 版・`gh` 版・Write の可否・`.ts` 直接実行の可否が tasks.md の Implementation Notes に表として残り、Node 24 未満なら呼び出し行の方針（`--experimental-strip-types` か `.js` 出力か）が同じ表に決まっている。後続タスクはこの表を前提にする
  - _Requirements: 3.1, 3.5_

- [x] 1.2 `bin/flaky-ci/` の共通基盤（出力・GitHub 読み取り・固定文字列・日時・ANSI）をテスト先行で作る
  - 成功は stdout に JSON 1 個で終了コード 0、前提不成立は stdout 空・stderr 1 行・終了コード 2 という唯一の書き方を用意し、テストで 0/2 の両方と「stdout が空であること」を検証する。複数行を返すスクリプト向けに「行ごとの読めなかった事実は欄で示し全体は成功」の書き方も同じ場所で用意する
  - GitHub 読み取りの入口を 1 つにし、REST の GET だけを子プロセスで呼び、ページングは自分で回す。テストでは子プロセスを差し替えて記録済み応答を流し、`gh` 不在・非 0 終了・JSON 不正が失敗として区別されることを検証する
  - 手順書の Shared constants にある固定文字列（ラベル名・コメント見出し・マーカー・署名・保留窓の秒数・`### Repro result` の 7 行）を機械可読に定義し、手順書の該当節と一致することを検証するテストを付ける
  - ISO-8601（UTC）の比較・秒の減算・日数差を、形式不正なら例外を投げる形で用意する（空文字が「今日 0 時」に化けないことをテストで固定）
  - ANSI 制御列と行末 `\r` の除去を 1 つの規則に統一し、手順書内にあった 2 種類の入力が同じ結果になることをテストで確認する
  - `ci-bin.yml` の `paths`（push と pull_request の両方）に `.claude/commands/flaky-ci-routine.md` を加え、手順書側の変更でも一致検証が走るようにする
  - 手順書 3 本の行数・容量の基準値（着手時点）を Implementation Notes に控える
  - 観測可能な完了状態: `turbo run test --filter=./bin` でこれらのテストが実行されて通り、`biome check bin` が通る。契約表の雛形（スクリプト名・引数・stdin・出力欄・終了コード・使う判断の列）が `bin/flaky-ci/README.md` にあり、Implementation Notes に基準値の表がある
  - _Requirements: 1.2, 2.1, 2.2, 3.1, 3.3, 4.2, 4.4, 5.2_

- [x] 1.3 Phase 1 で使う実データ由来のフィクスチャを集め、旧手順の出力を控える
  - API 応答の記録: `### Repro result` が同一 commit に 2 件ある issue のコメント一覧、観測コメントと本文だけの issue、`flaky/needs-decision` のラベル付与イベントとその前後のコメント（ラベル先行と、旧手順のコメント先行の両方）、lockfile 差分を含む PR の files
  - lockfile 差分に対応するログ抜粋（スタックトレースにパッケージ名が現れるもの）
  - **置き換え前の出力を控える**: 各素材に対して、手順書に今ある該当のシェル片をそのまま実行し、返った値（Runs/Failed、最新観測日時、Paused at と Recommendation、パッケージ名の交差）を期待値ファイルとして保存する。以降のタスクのテストはこの期待値と比較する
  - 観測可能な完了状態: `bin/flaky-ci/fixtures/` に上記が置かれ、各ファイルの先頭コメントに出所（run / issue / PR 番号）があり、期待値ファイルに「どのシェル片を何日に実行して得たか」が書かれている。Phase 2 の素材は各タスクで同じ要領で追加する
  - _Requirements: 1.3, 4.1, 4.3_

- [ ] 2. Phase 1: 上位 4 本の切り出し（1 本 = 1 コミット、手順書の該当節も同時に置き換える）
- [x] 2.1 再現結果コメントの読み取り（`### Repro result` を commit で選ぶ）
  - issue 番号と commit を受け、その commit の `- Commit:` 行を持つ結果コメントの `Runs / Failed / Per-run / Workflow run` とコメント URL を返す。同一 commit に複数あれば作成時刻→ID の順で最新を選ぶ。該当が無ければ終了コード 2
  - investigate の確認測定側（2-D）と修正検証側（6-A）にある二重の読み取り手順を、この 1 本の呼び出しに置き換え、`jq` の手順とそれに付随する注意書きを消す。判定表（2-E）と「check-run が success でも測ったことにならない」は残す
  - 観測可能な完了状態: 置き換えた 2 節に `gh api` / `jq` が無い。`--help` が終了コード 0、フィクスチャ（同一 commit 2 件）で 1.3 の期待値と一致、該当なしで終了コード 2 のテストが通る。README の契約表に自分の行がある。手順書の行数・容量の前後が Implementation Notes に記録されている
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.4, 3.3, 3.4, 4.1, 4.4, 5.1, 5.2_

- [ ] 2.2 放置クローズの最終観測日時の取得と、報告項目の追加
  - issue 番号を受け、本文の最初の観測日と観測コメント（`### Additional observation` / `### Backfilled observation`）の作成時刻から最新の観測日時と出所を返す。日時が 1 つも読めなければ終了コード 2
  - routine の 4-B の手順を呼び出しに置き換える。4-D「読めなければ閉じない」、4-C の再オープン保護、4-E の書き込みは手順書に残す（4-E の空値ガードはスクリプトの終了コード 2 で担保されるので、その注意書きを短くする）
  - routine の Step 6 の報告項目に「スクリプト失敗: <名前> <理由>」の行（0 件なら `none`）を追加し、各節の「終了コード 2 のときの扱い」がこの行に集約されることを書く
  - 観測可能な完了状態: 4-B に `jq` / `sort | tail -1` が無く、Step 6 に新項目がある。`--help` が 0、「本文のみ」「コメントあり」「日時なし → 終了コード 2」の 3 ケースが 1.3 の期待値と一致するテストが通る。README に行がある。行数・容量の前後を記録
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 3.3, 3.4, 4.1, 4.4, 5.1, 5.2_

- [ ] 2.3 判断待ち一覧の行（Paused at・Recommendation・保留窓）の取得
  - issue 番号（複数可）を受け、行ごとに `flaky/needs-decision` の最新の付与時刻、保留窓（付与時刻 − 120 秒以降）に入る自動コメントの最終行から `- Recommendation:` の値、窓に無ければ広げて取った旨（`in-window` / `widened` / `none`）、窓以降の観測コメント数を返す。付与時刻が読めない行は `pausedAtStatus: unavailable` で示し、一覧全体は成功とする（design の複数行スクリプトの規則）。1 行も作れなければ終了コード 2
  - routine Step 5 item 2〜3 の該当手順を呼び出しに置き換える。「`(may be stale) ` を付けるのは widened のときだけ」「件数が増えても再選択しない」「最終行を読む（4-B の先頭行と混同しない）」は手順書に残す
  - 観測可能な完了状態: 該当節に `date -d` / `jq` が無い。`--help` が 0、ラベル先行・コメント先行（旧手順の逆順、−1 秒）・付与時刻なしの 3 ケースが 1.3 の期待値と一致するテストが通る。README に行がある。行数・容量の前後を記録
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.3, 2.4, 3.3, 4.1, 4.3, 4.4, 5.1, 5.2_

- [ ] 2.4 lockfile 差分とスタックトレースのパッケージ名の交差
  - commit と PR 番号とログ抜粋を受け、PR の lockfile 差分に現れるパッケージ名（peer 接尾辞と `(…)` を落とす）とログ抜粋に現れるパッケージ名の 2 集合と交差を返す。PR が無い・files が取れないときは終了コード 2
  - detect の判定①の抽出手順（2 つの表と規則）を呼び出しに置き換える。「lockfile を既定で無関係にしない」「lockfile だけの PR は決定的失敗のことが多い」は残す
  - 観測可能な完了状態: 判定①の節に抽出手順が無い。`--help` が 0、`@codemirror/state` 二重化 PR のフィクスチャで交差が 1.3 の期待値と一致し、peer 接尾辞の切り落としのテストが通る。README に行がある。行数・容量の前後を記録
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.4, 3.3, 4.1, 4.4, 5.1, 5.2_

- [ ] 2.5 上位 4 本を入れた手順書で routine を 1 サイクル動かす
  - `/flaky-ci-routine --window-hours=32` を新規セッションとして実行し、4 本のスクリプトが呼ばれること、失敗時（意図的に存在しない issue 番号を渡す等）に終了コード 2 が手順書の既存経路と Step 6 の新項目に写ることを確認する
  - ダッシュボード・自動クローズ・判断待ちの結果が導入前と同じ形であることを比較する
  - 観測可能な完了状態: 実行報告に 4 本の呼び出しと「スクリプト失敗」行が記録され、ダッシュボード本文の見出し・行順・決まり文句が導入前と同じ
  - _Depends: 1.1, 2.1, 2.2, 2.3, 2.4_
  - _Requirements: 1.5, 3.4_

- [ ] 3. Phase 2: 残り 9 本の切り出し（同じく 1 本 = 1 コミット。各タスクで素材と旧手順の期待値も 1.3 と同じ要領で追加する）
- [ ] 3.1 ジョブログの解析スクリプト（FAIL ブロック・Playwright の注釈と集計・denylist 一致）
  - stdin のログ（タイムスタンプ前置き・ANSI 混じり）から、vitest の FAIL ブロック（spec パス・テスト題名・抜粋）、Playwright の `::error` 注釈（file / title）、集計行（failed / flaky / passed / skipped、無ければ `null`）、denylist 一致（FAIL ブロック単位、`test/setup/**` 内の一致は `scope: job`）を返す。stdin が空なら終了コード 2。denylist の一覧は純粋関数と同じ層（`lib`）にデータとして置き、スクリプトはそれを受け取って照合する（テストから直接呼べるようにする）
  - 素材: FAIL ブロック・共有 setup フックの timeout・`0 failed / 1 flaky`・`1 failed / 0 flaky`・集計欠落・denylist 語を 1 件だけ含む多数失敗のログ抜粋（実物からタイムスタンプと ANSI を残して切り出す）と、現在の grep 手順の出力
  - 観測可能な完了状態: `--help` が 0、素材 6 種（集計欠落は `summary: null`、「97 件中 1 件の denylist 一致が `scope: failure`」を含む）のテストが期待値と一致して通る。README に行がある。手順書はまだ触らない
  - _Requirements: 1.3, 2.1, 3.2, 3.3, 4.1, 4.3, 4.4_

- [ ] 3.2 ジョブログ解析への手順書の切り替え（detect Step 2・Step 3・取得経路・`allowed-tools`）
  - detect の Step 2（ログ取得後の grep・ANSI 除去・FAIL 書式）、Step 3 の Playwright 事実の取り出し、denylist の一覧を 3.1 の呼び出しに置き換える。段位の決定・denylist の拡張・巻き添えと連鎖の畳み先は残す
  - MCP 経路に「結果を Write でファイルに保存してから流し込む」の 1 段を足し、`gh` 経路は「ファイルに保存して流し込む」に揃える。frontmatter の `allowed-tools` に `Write` と `mcp__github__get_job_logs` を追記する
  - 観測可能な完了状態: 該当節に grep のパターン一覧・ANSI の正規表現・denylist の一覧が無く、両経路が同じ呼び出し行に合流している。行数・容量の前後を記録
  - _Depends: 3.1_
  - _Requirements: 1.1, 1.2, 1.4, 2.3, 2.4, 3.2, 3.4, 5.1, 5.2_

- [ ] 3.3 識別キーの解析
  - issue 題名を受け、種別・ブラウザ・spec パス・テスト題名と、形（精密 / Playwright のジョブ単位 / 不正な vitest キー）を返す
  - 素材: 実在する flaky 追跡 issue の題名一覧（共有 setup フック・`:` を含む Playwright 題名・`.js` を含む題名を含む）と、現在の正規表現の出力
  - investigate Step 1 の解析規則（正規表現と 4 段の手順）を呼び出しに置き換える。3 つの形それぞれの扱いは残す
  - 観測可能な完了状態: 該当節に正規表現が無い。`--help` が 0、題名一覧の全件が期待値と一致するテストが通る。README に行がある。行数・容量の前後を記録
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.4, 4.1, 4.3, 4.4, 5.1, 5.2_

- [ ] 3.4 時間窓内の run 一覧
  - workflow 名・窓の時間・上限件数を受け、完了済み run の一覧（ID・結論・commit・作成時刻・URL・イベント・attempt）と打ち切りの有無を返す。1 件も取れない（API 失敗）ときは終了コード 2、0 件は成功
  - 素材: 記録済み応答 3 ページと、現在の手動ページング手順の出力
  - detect Step 1 の手動ページングの手順を呼び出しに置き換える。「打ち切りを報告する」「同一 commit の attempt 反転は確定扱い」は残す
  - 観測可能な完了状態: Step 1 にページングのシェル片が無い。`--help` が 0、結合と打ち切りのテストが期待値と一致して通る。README に行がある。行数・容量の前後を記録
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 3.3, 4.1, 4.4, 5.1, 5.2_

- [ ] 3.5 flaky 追跡 issue の一括取得
  - ラベル名（既定 3 種）を受け、該当 issue の番号・題名・状態・本文・ラベル・コメント全文を返す（後段の 4 か所が読む欄をすべて含める）
  - detect Step 1.5 の取得手順を呼び出しに置き換える
  - 観測可能な完了状態: Step 1.5 に取得のシェル片が無い。`--help` が 0、記録済み応答のテストが期待値と一致して通る。README に行がある。行数・容量の前後を記録
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 3.3, 4.1, 4.4, 5.1, 5.2_

- [ ] 3.6 判定②（挟み込み）③（matrix の食い違い）の材料
  - run 一覧（3.4 の出力形式）と識別キーとジョブ結果を受け、②と③それぞれの真偽と根拠 1 行を返す（新しい API 呼び出しは無し）
  - detect の②③の節を呼び出しに置き換える。tier の付け方は残す
  - 観測可能な完了状態: ②③の節にシェル片が無い。`--help` が 0、挟み込みあり／なし、matrix 分岐あり／なしの 4 ケースが期待値と一致するテストが通る。README に行がある。行数・容量の前後を記録
  - _Depends: 3.4_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.4, 4.1, 4.4, 5.1, 5.2_

- [ ] 3.7 「PR 自身の失敗」判定の材料
  - commit と spec パスを受け、既定ブランチとの祖先関係、紐づく PR の一覧、各 PR の変更ファイルが spec パスと一致するか、PR が 1 つも無いか、を返す。API が失敗したら終了コード 2
  - detect の該当節（Step A〜C）を呼び出しに置き換える。「失敗時は除外しない」は「終了コード 2 のときは除外せず続行する」として、「`.[0]` でなく全 PR を見る」の結論は残す
  - 観測可能な完了状態: 該当節に `compare` / `pulls` のシェル片が無い。`--help` が 0、祖先あり／なし × PR あり（一致／不一致）／なしのテストが期待値と一致して通る。README に行がある。行数・容量の前後を記録
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.4, 3.3, 3.4, 4.1, 4.4, 5.1, 5.2_

- [ ] 3.8 check-run の事実（同名重複の除去）
  - commit を受け、同名の check-run を開始時刻→ID で最新だけに絞った一覧、`ci-app-*` の総数と非 success の一覧、`flaky-repro` の状態を返す（単発。待ち合わせはしない）。重複除去と集計は純粋関数として置き、3.9 が同じものを使う
  - investigate 2-C と 6-A の待ち合わせ手順を「短いループでこのスクリプトを呼ぶ」に置き換え、重複除去の `jq` を消す。「`ci-app-` 前置きで全部取る」「2 つの終わり方の意味」は残す
  - 観測可能な完了状態: 2 節に `group_by` の `jq` が無い。`--help` が 0、同名 2 件（同着含む）で最新が選ばれるテストが期待値と一致して通る。README に行がある。行数・容量の前後を記録
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.4, 3.3, 4.1, 4.3, 4.4, 5.1, 5.2_

- [ ] 3.9 PR ゲートの条件 1・2 の事実
  - issue 番号・修正 commit・基準ブランチを受け、再現結果（2.1 の純粋関数）、`ci-app-*` の総数と非 success（3.8 の純粋関数）、基準からの変更ファイル一覧を返す
  - investigate 6-B の条件 1・2 の判定手順を呼び出しに置き換える。条件 3（差分の範囲）と HIGH/MEDIUM/LOW の表は残す
  - 観測可能な完了状態: 6-B に `grep -m1` の手順が無い。`--help` が 0、「総数 0 は条件 2 不成立」を含むテストが期待値と一致して通る。README に行がある。行数・容量の前後を記録
  - _Depends: 2.1, 3.8_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.3, 2.4, 3.3, 4.1, 4.4, 5.1, 5.2_

- [ ] 3.10 ダッシュボード本文の描画
  - issue 一覧・判断待ち行・自動クローズの 3 リストを stdin の JSON で受け、表（tier → issue 番号順）、`## Awaiting human decision`、`## Auto-closed this run`、決まり文句 3 つ、65536 字の切り詰め（表の行だけを上から残し節は落とさない）を持つ本文を返す
  - routine Step 5 の描画手順を呼び出しに置き換える。何を載せるか（入力を組む側）と、ダッシュボード issue の検索・作成・全置換の書き込みは手順書に残す
  - 観測可能な完了状態: Step 5 に表の組み立て手順が無い。`--help` が 0、空状態 3 種・行順・切り詰め（節が残る）のテストが期待値（現在のダッシュボード本文）と一致して通る。README に行がある。行数・容量の前後を記録
  - _Depends: 2.3, 3.5_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 4.1, 4.4, 5.1, 5.2_

- [ ] 3.11 全 13 本を入れた手順書で routine を 1 サイクル動かし、容量の前後を記録する
  - `/flaky-ci-routine --window-hours=32` を新規セッションとして実行し、全スクリプトの呼び出しと、Step 6 の「スクリプト失敗」行が（0 件でも）出ることを確認する
  - routine コマンドと detect の合計容量を 1.2 で控えた基準値と比べ、減っていない候補があれば理由を記録する
  - 観測可能な完了状態: Implementation Notes に 3 ファイルの行数・容量の前後表と、毎回読まれる 2 本の合計の増減がある
  - _Depends: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_
  - _Requirements: 1.5, 3.4, 5.3_

- [ ] 4. 任意（Requirement 6 の Where 条件。実施しない場合は運用者の判断として Implementation Notes に記録する）: 測定用ワークフローの実行部分の分割
- [ ] 4.1 `flaky-repro.yml` の `run:` を `.github/scripts/flaky-repro/` に移す
  - trailer の解析と検証、N 回実行と集計、結果の整形の 3 本にそのまま移し、workflow は各スクリプトを呼ぶだけにする。最初のステップで構文検査（`bash -n`）を行う
  - `flaky-repro/selftest-*` ブランチで 1 回測定し、`### Repro result` の 7 行が分割前と同一であることを確認する
  - 観測可能な完了状態: workflow の `run:` が呼び出し行だけになり、self-test の結果コメントが分割前の形式と一致し、構文検査ステップが success
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 5. 元 spec へ移し戻して、この spec を削除する（spec-lifecycle）
- [ ] 5.1 `ci-flaky-test-detection` の design.md を現在の事実で書き直す
  - File Structure Plan に `bin/flaky-ci/` の構成、Components にスクリプト 13 本と手順書のどの節が呼ぶかの表、Testing Strategy にフィクスチャ・旧手順の期待値・ドリフト検知、Revalidation Triggers にスクリプト契約と Shared constants と `ci-bin.yml` の連動を追記する。履歴の語りは書かない
  - 観測可能な完了状態: 元 spec の design.md に 13 本のスクリプトと呼び出し箇所の表があり、本文に「以前は〜」の履歴の語りが無い
  - _Requirements: 5.4_

- [ ] 5.2 本 spec の research.md の設計決定を元 spec の research.md に移す
  - 置き場（`bin/`）、TypeScript 直接実行、事実だけを返す契約、`gh api` アダプタ、stdin パーサ、固定文字列のドリフト検知、任意の workflow 分割、の各決定を「決定 / 理由 / 根拠」で移す
  - 観測可能な完了状態: 元 spec の research.md に上記 7 決定の見出しがある
  - _Requirements: 5.4_

- [ ] 5.3 元 spec の spec.json の `updated_at` を更新し、`.kiro/specs/flaky-ci-script-extraction/` を削除する
  - 観測可能な完了状態: ディレクトリが存在せず、リポジトリ全体で `flaky-ci-script-extraction` への参照が 0 件
  - _Requirements: 5.4_

## Implementation Notes

### タスク 1.1: 実行環境の実測記録（2026-09-16）

cloud routine（`/flaky-ci-routine` を無人実行する Anthropic cloud 側のセッション）に対して、このタスク専用の 1 回限りの診断プロンプトを実際に送り込む手段が、このタスクを実行しているセッションからは無かった。`schedule` スキルが案内する `RemoteTrigger` ツール（routine の一覧・`run` now・実行ログ取得）は、`ToolSearch` で明示的に検索しても見つからず、呼び出し可能な形では提供されていない。そのため cloud 側の値は実測できておらず、下表は devcontainer 側だけが実測値、cloud 側は間接証拠（過去に実際の cloud 実行で記録された値、または `package.json` の `engines` や workflow の Node 版指定からの推測）である。

**追加確認: 実際の cloud routine セッションへの生の診断プローブも不可能だったこと**

この実装者とは別に、親のオーケストレーター（インタラクティブなメインループのセッション）が `RemoteTrigger` ツールの `action: "list"` を使って、実際にスケジュール済みの `/flaky-ci-routine` cloud セッションを見つけ、そこに一回限りの診断プロンプトを直接送り込めないか試した。結果は、一覧に 20 件返ってきたがすべて `created_kind: "reminder"` で、タイトルもすべて「PR #11863 hourly check-in」という別件のリマインダーであり、`flaky-ci-routine` に関係するものは 1 件も含まれていなかった。結果に含まれていた `next_cursor` でページを送っても同じ 20 件が返ってきただけだった。つまり、実際の `flaky-ci-routine` の cron は、このアカウント・このセッションからは `RemoteTrigger` で列挙できる形では見えておらず（別の仕組みで登録されているか、別アカウント経由の可能性がある）、この経路からの生プローブは行き止まりであることが確認できた。これ以上、`RemoteTrigger` の別クエリや `CronList` 相当の手段を追加で試すことはしない。

上記 2 つの独立した試み（本タスクの実装者によるツール探索、および親セッションによる実アカウントでの一覧取得）により、「cloud 側を今すぐ直接測る」経路は現時点でこのセッション環境からは塞がっていることを確認した。

| 項目 | devcontainer（手元、今回実測） | cloud routine |
|---|---|---|
| Node バージョン | `v24.20.0`（`node --version` 実行結果、実測） | 未実測。間接証拠のみ: ルート `package.json` と `apps/app/package.json` の `engines.node` が `^24`、`.github/workflows/*.yml` の `node-version` 行が軒並み `24.x`（GitHub Actions ランナーの話であり、cloud routine が動く Anthropic cloud の CCR サンドボックスの Node 版そのものではない点に注意） |
| `gh` バージョン | `gh version 2.100.0`（`gh --version` 実行結果、実測） | 測定済み（過去）: `research.md`（37 行目）に既存の実記録あり `gh 2.45.0`。これは以前の cloud 実行で実際に観測された値であり、今回新たに測ったものではない |
| Write ツール（またはそれに相当する書き込み手段）の有無 | あり（Write/Edit ツールで本タスクのファイル編集を実行済み、実測） | 未実測。間接証拠のみ: `investigate-flaky-test/SKILL.md` の `allowed-tools` には `Write` が含まれ既に使われている前例があるが、`detect-flaky-ci/SKILL.md` にはまだ `Write` が無く、`research.md` の Risks 節でも「MCP 結果をファイルに落とす手順が cloud で使えない（Write ツールが無い等）」を未解消のリスクとして明記している |
| `node` で `import` 付き `.ts` を直接実行できるか | できる（実測）。`import { strict as assert } from 'node:assert'` を含む一時ファイルを `node <file>.ts` で実行し、`ts-import-direct-exec: OK` を確認（実行後に一時ファイルは削除済み。リポジトリに残存物なし） | 未実測。間接証拠のみ: Node バージョンが `^24` 想定（上記行と同じ根拠）であれば `node <file>.ts` の素の直接実行に対応しているはずという推測に留まる |

**呼び出し行の方針（タスク 1.1 時点・暫定、確定ではない）**: cloud 側の Node バージョンは実測できていないが、(a) このリポジトリ自身の `engines.node: "^24"` という制約（cloud 環境もこれを前提に用意されていると考えられる）と、(b) 全 CI workflow がすでに Node 24.x に固定されていること、という間接証拠の強さに基づき、**`--experimental-strip-types` のフォールバックを付けず、素の `node bin/flaky-ci/scripts/<name>.ts` 呼び出しを当面の既定とする**。

この判断はあくまで暫定であり、リスクは低いものの実測による裏付けが無い。**確定させる場でなく確認する場はタスク 2.5**（「上位 4 本を入れた手順書で routine を 1 サイクル動かす」、design.md の Testing Strategy が実際の routine 環境で回す "run now" サイクルと位置付けている箇所）である。タスク 2.5 の実装者へ: もしこのサイクルでいずれかのスクリプトが Node バージョンや `.ts` インポート非対応が原因で cloud 環境で失敗した場合、それこそが呼び出し行を `--experimental-strip-types` 付きに切り替える、またはコンパイル済み `.js` へのフォールバックに切り替えるべき、という本物のシグナルである。タスク 2.5 は、本タスクのこの暫定判断が正しかったかどうかを実環境で確認する最初の機会として扱うこと。

### タスク 1.2: 手順書 3 本の基準値（2026-09-16、commit `14165274c0`）

スクリプト化に着手する前の行数・バイト数。タスク 2.1 以降の各タスクと、タスク 3.11（Requirement 5.2 / 5.3 の増減の記録）はこの値と比べる。測り方は `wc -l -c <file>`（推定値ではなく実行結果）。

| ファイル | 行数 | バイト数 |
|---|---:|---:|
| `.claude/commands/flaky-ci-routine.md` | 1049 | 54171 |
| `.claude/skills/detect-flaky-ci/SKILL.md` | 1633 | 86011 |
| `.claude/skills/investigate-flaky-test/SKILL.md` | 1630 | 87197 |
| 合計 | 4312 | 227379 |
| うち毎回読まれる 2 本（routine + detect） | 2682 | 140182 |

**固定文字列の検証元について（タスク 1.2 の設計判断）**: `lib/constants.ts` の各定数は「どのファイル（Shared constants 群はどの節）と突き合わせるか」を自分で宣言し、`constants.spec.ts` がその宣言を全件検査する。tasks.md の当初の記述は「全定数が `## Shared constants` 節に現れること」を検査する形だったが、実際の同節が定義しているのは `flaky/needs-decision`・`- Recommendation: `・署名 2 種・保留窓 120 秒だけだった。tier ラベル・コメント見出し・`**Fix PR**: ` は同じファイルの別の場所、`### Repro result` の 7 行は `.github/workflows/flaky-repro.yml` が定義元である。手順書の本文はタスク 1.2 の範囲外なので書き換えず、定数を落とすこともせず、それぞれの実際の定義元に対して検査している。

**タスク 5.1（元 spec への移し戻し）への申し送り**: 現在の design.md には、上の実測と食い違う記述が 2 か所ある。(a) Components の `constants.ts` の説明と、(b) Testing Strategy の該当行で、どちらも「`constants.spec.ts` が `## Shared constants` 節だけを読んで全定数を突き合わせる」と読める書き方になっている。実際には tier ラベル・コメント見出し・`**Fix PR**: ` は `flaky-ci-routine.md` の同節ではない場所にあり、`### Repro result` の 7 行は手順書ではなく `.github/workflows/flaky-repro.yml` が定義元である。移し戻しの際は design.md の文言をそのまま写さず、この 2 か所を実際の定義元に合わせて書き直すこと。あわせて、`ci-bin.yml` の `paths` には `flaky-repro.yml` も入っている（これが無いと同ファイルだけを変える PR でドリフト検知のテストが走らない）ことを Revalidation Triggers に含める。

なお `ci-bin.yml` の `paths` に足した 2 ファイル（`flaky-ci-routine.md` と `flaky-repro.yml`）は、`turbo.json` の `globalDependencies` にも `bin` パッケージの入力にも入っていない。つまり turbo から見ると、これらを変えても `test` タスクのハッシュは変わらない。現状は CI に remote cache の設定（`TURBO_TOKEN` 等）も `.turbo` の復元ステップも無く、毎回キャッシュが空の状態から走るので実害は無く、ジョブが起動すればテストは必ず実行される。ただし将来 remote cache を有効にするなら、この 2 ファイルを `globalDependencies` に宣言しないと、ジョブは起動するがキャッシュヒットでテストが走らない、という同じ見落としが一段下で再発する。

### タスク 2.1: `read-repro-result` の切り出しと手順書の行数・容量（2026-09-16）

`bin/flaky-ci/lib/repro-result.ts`（`parse(body, sha)`、1 コメント単体の判定のみ）と
`bin/flaky-ci/scripts/read-repro-result.ts`（issue の全コメントを取得し、`parse` で
絞り込んだ後に `created_at`→`id` の同着解決を行う）に分けた。設計の component
境界どおり、複数コメントにまたがる同着解決はスクリプト側の責務とし、`parse` は
1 コメントの判定だけに閉じた。

`investigate-flaky-test/SKILL.md` の 2-D と 6-A の二重の読み取り手順（`gh api
... --slurp | jq ...` と `grep -m1`）をこの 1 本の呼び出しに置き換えた。あわせて、
同じ読み取り結果に依存していた 3 箇所（6-B の `runs`/`failed` 抽出、6-C の
`REPRO_RUN_URL` 抽出、2-F の一時ファイル削除、Step 6 冒頭の共有変数一覧）を
`$REPRO_RESULT_FILE`（Markdown ファイル）から `$REPRO_RESULT_JSON`（スクリプトの
JSON 出力）に揃えて更新した。6-B の条件 1・2 の判定基準そのもの（`- Failed: 0`
かつ `- Runs:` が既定回数以上、`ci-app-*` 全件 success）と 6-B の HIGH/MEDIUM/LOW
の表は変更していない（タスク 3.9 の範囲）。2-E の判定表と「check-run が success
でも測ったことにならない」の注記は文言のみ `runs`/`failed`/終了コードに合わせて
更新し、判定基準自体は変えていない。

行数・容量（`wc -l -c`、タスク 1.2 の基準値と比較）:

| ファイル | 変更前（行/バイト） | 変更後（行/バイト） |
|---|---:|---:|
| `.claude/skills/investigate-flaky-test/SKILL.md` | 1630 / 87197 | 1609 / 85676 |

`investigate-flaky-test/SKILL.md` は「毎回読まれる 2 本」（routine + detect）には
含まれないため、5.3 の合計値には影響しない。

