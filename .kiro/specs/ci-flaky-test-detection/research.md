# Research: 既存の flaky テスト検出ツールとの比較（Build vs Adopt）

## Design Discovery（`/kiro-spec-design` 実行時追記、2026-08-14）

Requirement 1〜4は既存実装の事後spec化のため "Extension" 分類でlight
discoveryを実施。新規の外部依存・ライブラリ調査は不要（GitHub REST API /
GitHub MCPサーバーの既存利用のみ）。設計判断が必要だったのはRequirement 5
（常設ダッシュボード）のみ:

- **配置場所の決定**: ダッシュボード更新ロジックをどのスキルに置くか検討し、
  `flaky-ci-routine.md`（オーケストレーションコマンド）に新ステップとして
  配置することに決定。理由: detect-flaky-ci単体だと investigate-flaky-test
  によるラベル変化（issueの解決等）を反映できず、investigate-flaky-test単体
  だと新規検出分を反映できない。両方が完了した後の状態を見られるのは
  オーケストレーション層だけ
- **Fix PRリンクの取得方法**: GitHub検索API（`is:pr "Fixes #N"`等）でPRを
  逆引きする案と、investigate-flaky-testが追跡issueに直接マーカーを書き込む
  案を比較し、後者を採用。理由: 検索APIは実行コスト・信頼性ともに劣り
  （タイトル/本文のフリーテキスト一致に依存する）、書き込み側で構造化した
  方が確実で安い
- **本文の更新方式**: 追記型 vs 全置換型を検討し、全置換型を採用。理由:
  解決済みテストの自動除外（Requirement 5.4）とゼロ状態表示（Requirement
  5.5）を、特別な削除ロジックなしに「常に最新のissue一覧から再構築する」
  だけで自然に満たせる

**調査日**: 2026-08-14
**公開版（デザイン付きレポート）**: https://claude.ai/code/artifact/31e6ebb3-9718-470a-b8ac-053d5531539e

### 設計レビュー（advisor + kiro-validate-designループ、2026-08-14）

1回目のレビューでcritical issueを3件検出し、`design.md`を修正した:

1. **Fix-PRマーカーが本spec化以前のissueに無い問題** — `**Fix PR**: {URL}`
   マーカーは今後の追跡issueにしか付かないため、#11711のような既存issueは
   ダッシュボードのFix PR欄が恒久的に`—`のままになる。マーカーが無い場合は
   issue本文・コメントからPR URLを緩く探索するフォールバックを追加して解決
   （この解決策自体に問題があったことが2回目のレビューで判明、後述）
2. **Occurrencesをコメント総数で数える定義が誤り** — 追跡issueには識別キー
   訂正メモやFix-PR報告など、観測でないコメントも付く。見出しが
   `### Additional observation` / `### Backfilled observation` に一致する
   コメントのみをカウントする定義に修正
3. **investigate-flaky-testが人間の判断待ちで停止した場合のダッシュボード
   更新有無が未定義** — ダッシュボード更新は個々の調査の完了を待たず、
   ルーティン1サイクルの完了時点で必ず実行する（停止中issueは現在の
   tierのまま一覧に含める）と明記して解決

2回目のレビューで、1回目の修正自体に含まれていた問題を2件指摘された:

4. **Fix-PRの緩いURLフォールバックが誤ったPRを拾いうる** — 本文やコメントに
   出てくる最初のPR URLを拾う方式にしていたため、#11711のように調査の途中
   で言及しただけの無関係なPR（証拠コミットの由来PR等）を修正PRとして表示
   してしまう可能性があった。これは`research.md`が検索API方式を不採用に
   した理由（フリーテキスト一致の低信頼性）と同じ失敗パターンだったため、
   forward-only方式（マーカー方式導入後に作成・更新された追跡issueのみ
   Fix PR欄を埋め、それ以前は`—`にする）に変更した
5. **未実行のレビュー結果をあらかじめ書いていた** — このセクションの初版で
   「2回目のレビューで新規critical issueは検出されず、GO判定。」という
   一文を、実際に2回目のレビューを依頼するより前に書いていた。指摘を受けて
   その場で書き直し、以後は実行結果が返ってきてから記録するようにした
   （実測前に断定しない、[[feedback_dont_confabulate_verify_runtime_claims]]
   と同種の失敗）

Occurrencesのカウント規則（`### Additional observation` /
`### Backfilled observation` 見出し限定）は、#11711の実際のコメント3件
（`gh api -X GET repos/growilabs/growi/issues/11711/comments`で実測）に
対して検証済み: 「識別キー訂正」「Fixed by #11715」の2件は正しく除外され、
「Backfilled observation」の1件のみカウントされる（本文分と合わせて
Occurrences=2）。

**レビュー結果（実行後に記録）**: 1回目 = critical issue 3件、2回目 =
critical issue 2件（うち1件は1回目の修正自体が生んだ新しい問題）、3回目 =
critical issue 0件・GO判定。

商用SaaS（BuildPulse, Trunk.io 等）はユーザーの指示により比較対象から除外した
（調査エージェントは開始直後に停止）。以下は GitHub Actions エコシステム固有
のツール、テストフレームワーク組み込み機能、学術研究、大手テック企業の公開情
報の3方向を、並列の調査エージェント3体で調査した結果。

## 結論

無料で、cross-run のテスト識別・GitHub Issue自動化・原因特定からの修正PRま
でを一気通貫でやるツールは、調べた範囲では実質的に存在しない。一番近い設計
だった Google の `flakybot`（`googleapis/repo-automation-bots`）は **2025年8
月に廃止済み**。GitHub社内には近い仕組み（3種のretry戦略+影響度スコアリング
+issue自動作成で flaky build率を9%→0.5%未満に削減、と自社ブログで公開）があ
るが、**外部提供はされていない**。

つまり「これを使えばよかったのに」と言えるような既製品は無かった。ただし、
既存のOSSツールや大手テック企業の内製ロジックから、今のスキルを改善するヒン
トはいくつか見つかった（本文後半）。

## 1. GitHub Actions生態系で見つかったもの

Marketplaceで見つかるものの大半は「retryの皮を被った検出」だった。単発の
retryと、テストを識別して履歴を追う検出は別物、という前提で見る必要がある。

| ツール | 正体 | cross-run検出 | issue自動化 | 修正試行 | 現状 |
|---|---|---|---|---|---|
| nick-fields/retry | stepを盲目的に再実行するだけ | 無し | 無し | 無し | 現役（v3.0.2, 2025-02） |
| Wandalen/wretry.action | action単位の盲目的retry | 無し | 無し | 無し | 現役（v3.8.0） |
| WithSecureOpenSource/flaky-tests-detection | 過去のJUnit XMLからflip率を算出 | あり | 無し | 無し | 採用薄い（★26） |
| Staffbase/github-action-find-flaky-tests | スケジュール実行でSlack通知 | 部分的・不明瞭 | 無し（Slackのみ） | 無し | 採用薄い（★1） |
| treebeardtech/get-flakes | restart後の結果差分をjob単位で検出 | job単位のみ | 無し（レポートのみ） | 無し | 明示的に未完成（"do not attempt to use"） |
| Google flakybot | 失敗でissue作成→再発でreopen→flaky判定でラベル、人に引き継ぎ | あり | あり（フルライフサイクル） | 無し | **2025年8月廃止** |
| GitHub「Re-run failed jobs」(純正) | 手動/API起点の再実行のみ | 無し | 無し | 無し | 標準機能として現役 |
| GitHub社内システム（非公開、ブログのみ） | 3種のretry戦略+影響度スコアリング+issue自動割当 | あり | あり | 無し | 社内限定・非公開 |
| Copilot（既知のflakyテストを指示） | 指示されたテストの修正を試みる | 無し（能動スキャンはしない） | N/A | あり（オンデマンド） | 現役だが検出ツールではない |

参考: 商用SaaSは対象外だが、BuildPulseは検出〜隔離〜原因特定の一気通貫パイプ
ラインを持つ唯一の現役有料SaaS（$249/mo〜、AI修正は上位tierのみ）。

## 2. テストフレームワーク組み込みの機能差

GROWIが使う2フレームワークで組み込みのflaky検出能力に大きな差がある。

**Playwright — 組み込みで十分**
- リトライして通ったテストを「flaky」として明示的にタグ付け（HTMLレポート
  で色分け・フィルタ可能）
- リトライ発生時に自動でtraceを記録し、原因調査の材料も標準で揃う
- 今のスキルはこの信号をそのまま使っているだけで、独自に組み立てる必要が
  無い

**Vitest — 組み込みでは何も出ない**
- retryオプションはあるが「flaky」という区分は無い。通常のreporterからは
  「リトライ後に通った」という情報が見えない
- 本体への機能要望（`vitest-dev/vitest#1057`）は未実装のまま放置されている
- npmに流通している専用ツール（`flaky-test-detective`等）も採用実績が薄い
  （0★のものもある）か、フレームワーク限定で汎用性が低い

→ vitest側でCI履歴を横断して自前でflakyを組み立てているのは代替が無いから
であり、車輪の再発明ではない。

## 3. 学術研究・大手テック企業からの示唆

直接使えるツールは無かったが、設計の裏付けや改善のヒントになる知見はあった。

### 研究ツール（そのまま採用はできない）

| ツール | 技術 | 現在の使える度 |
|---|---|---|
| iDFlakies (ICST'19) | rerunベース検出+順序依存/非依存の分類 | Java/Maven限定の学術実装 |
| DeFlaker (ICSE'18) | 変更行のコードカバレッジ差分で判定、rerun不要 | Java/JaCoCo/TravisCI限定 |
| FlakeFlagger (ICSE'21) | 挙動特徴量からのMLclassifier、rerun不要 | Java限定の研究コード |
| CANNIER (2023) | MLスコアでrerun対象を優先順位付け、コスト最大54%削減 | Python/pytest限定の研究フレームワーク |

**注意（同一視しないこと）**:
- 今のスキルの①（diff/PR説明との不一致）は DeFlaker と同じ直感（変更箇所と
  無関係な失敗はflaky）だが、DeFlakerは**コードカバレッジ**で判定するのに
  対し、今のスキルは**変更ファイルパスとの一致だけ**を見ている、より弱い代
  替指標。同一の仕組みではない。
- 今のスキルの「安いヒューリスティックで絞ってから1回だけrerun」は CANNIER
  と同じ形（安い判定→高いrerunを絞る）だが、CANNIERは**MLモデルの予測確率**
  で優先順位付けするのに対し、今のスキルは**二値のルールベース**。仕組みは
  別物。

### 大手テック企業の公開情報（実運用の裏付け）

Google・Meta・Uber・Spotifyの公開ブログは、実装は違えど同じ形に収束してい
る:

1. 単発の失敗を信用しない（再実行や履歴で裏を取る）
2. 単発イベントでなく、一定期間の「flip率」で判定する
3. 担当者に自動で通知・issue化する
4. ブロッキングにせず隔離しつつ記録は残す
5. 可視化するだけでも効果がある（Spotifyは可視化だけでflaky率が6%→4%に下
   がったと報告）

今のスキルの「①〜④の安価な判定→駄目なら閾値蓄積→GitHub issue自動作成→隔
離ガードレール」という骨格は、この5点とおおむね同じ方向。派手な差別化では
なく、既に確立された実務パターンをGROWIの規模で再現した、という位置づけが
正確。

出典（大手テック企業）:
- Google Testing Blog: "Flaky Tests at Google and How We Mitigate Them" (2016), "Where do our flaky tests come from?" (2017)
- Engineering at Meta: "Probabilistic flakiness: How do you test your tests?" (2020), "Predictive test selection" (2018)
- Uber Blog: "Flaky Tests Overhaul at Uber" (2024), "Handling Flaky Unit Tests in Java" (2022)
- Spotify Engineering: "Test Flakiness — Methods for identifying and dealing with flaky tests" (2019)
- Netflix・Microsoftについては、同レベルの検出システムを公式ブログから確認
  できなかった（Netflixは test automation infra / chaos engineering が中心、
  Microsoftは学術論文のみで自社インフラのブログ記事は未確認）

## 4. 実測データ（どのツールのページにも無い数字）

2026-08-14 の実際のcron run nowから:

- 1サイクルの所要時間: 491秒（38ターン）
- cron頻度: 1日3回
- 初回runで新規作成したissue: 7件
- 自律的にマージ可能なPRまで到達: 1件（#11715）
- 実行中にエージェントが自己修正した環境起因の不具合: 2件
  （`gh api`のバージョン差異による`attempt`フィールドの失敗、`-f`使用時に
  暗黙でPOSTになる挙動）

後者2件は、固定スクリプトなら止まって終わっていたところを、その場で気づい
て回避し処理を継続できた。検出ロジック自体の話ではなく、実行環境の揺れに対
する頑健性としてLLM方式が持つ強み。

## 5. 「検出部分はスクリプト化できるのでは」という論点

`detect-flaky-ci` の中身は、実態としてはAPI呼び出し・文字列一致・閾値カウ
ントが大半を占めていて、LLMの読解力を常に必要としているわけではない。ここ
だけ見ると、素朴なスクリプトやGitHub Actionにして、cronの度にLLMを起動する
コストを無くす、という設計は魅力的に見える。

ただし、実際に2回のrun nowで、検出フェーズの中に単純なルールでは対応でき
ない判断が最低3か所出てきている:

1. **#11711の再オープン判断** — スキルの字面通りなら「closeされたissueへ
   の再発証拠→reopen」だが、その証拠が実は修正マージより前のコミット由来
   だったため、モデルはreopenせずbackfillコメントに留めた。ルール通りに実
   行するスクリプトなら誤った再発シグナルを出していた。
2. **Playwrightの識別名の抽出** — スキル自身が「ログからの厳密な対応付け
   は信頼できない」と明記し、確実な場合とそうでない場合で挙動を変える2段
   構えのフォールバックを判断として記述している。正規表現1本では代替でき
   ない。
3. **infra noiseの除外リスト** — 「本物の誤検知が見つかったときだけ広げ
   る」という運用そのものが人間相当の判断を要求している。

したがって「検出をスクリプト化し、調査・修正フェーズだけLLMに残す」は検討
に値する選択肢ではあるが、今すぐ切り替えるべき決定ではない。判断の尻尾（上
記3点）をどう処理するかを先に決めてから動く話。**将来この案を採る場合の分
割線**: ①〜④の機械的な判定・Step1.5のスキップリスト・時間窓計算はスクリプ
ト側へ、reopen可否・identity抽出のフォールバック・denylistの拡張判断はLLM
側に残す。

## 閉ループ化の設計決定（Requirement 6〜11）

疑いありの issue を測って確定させる、巻き添えと連鎖を切り分ける、flaky でない
失敗を追跡対象から外す、人の判断を待つ状態を持つ、放置された観測を自動で閉じる、
routine の運用値を決める — この 6 つ（Requirement 6〜11）について、何をどう
決めたかと、その根拠。

### 確認・検証の測定手段は push で起動する再現 workflow に統一する

- **決定**: `.github/workflows/flaky-repro.yml` を置き、`flaky-repro/**`（確認用の
  空コミットを載せるブランチ）と `fix/flaky-**`（修正ブランチ）への push で起動
  する。測る対象は head コミットの git trailer で渡し、対象ファイルだけを N 回
  流して k/N を集計する。
- **理由**: routine が確実に持っている能力（push できる・REST で読み書きできる）
  だけで成立させたい。CI の再実行 API は使えない。
- **根拠となった実測**: 組織にインストールされた Claude GitHub App の権限は
  `actions: write` を含む（`gh api orgs/growilabs/installations`）。それでも
  routine の実行環境がセッションごとに発行するトークンはこれより狭く、
  `gh run rerun` も REST の `POST .../rerun-failed-jobs` も毎回
  `403 Resource not accessible by integration` になる。広げる設定項目は見つかって
  いない。同じ環境で `git push`・PR 作成・issue コメント・ラベル変更は成功する。

### GitHub への書き込みは REST だけで行う

- **決定**: issue・コメント・ラベル・PR の作成と更新はすべて `gh api`（REST）で
  行う。`gh issue comment` / `gh issue create` / `gh issue edit` / `gh issue reopen`
  / `gh pr ready` といったサブコマンドは使わない。PR は draft を経由せず最初から
  Ready で開く。
- **理由**: これらのサブコマンドは GraphQL を呼ぶが、routine の実行環境の外向き
  proxy が GraphQL を遮断している。
- **根拠となった実測**: `gh pr ready`（draft → Ready）がこの理由で失敗する。

### `gh run rerun` は主手段にしない（測定器の比較）

- **決定**: 権限が将来取れたとしても、主手段は push で起動する再現 workflow の
  ままにする。`rerun` は「元の run と同じ条件で 1 回だけ流す」補助にとどめる。
- **理由**: `rerun --failed` が得られるのは 1 標本で、再び落ちたときに「たまたま
  2 回目も落ちた」のか「本物の回帰」なのかを区別できない。対象ファイルだけを N 回
  流せば k/N の数字が出て、本物の回帰は N/N で落ちるので区別がつく。所要は 1 回
  10〜20 秒で、修正後の「N 回連続成功」も同じ手段で数分で取れる（`rerun` だと
  PR の CI を丸ごと 2〜3 回、30 分前後）。
- **根拠となった実測**: #11853 / #11863 は「1 回再実行して落ちた」だけの材料では
  判断できず却下された。
- **採らなかった案**: `workflow_dispatch` は起動そのものに `actions: write` が要る
  ので不可。ラベルやコメントを起点にする案は、起動時点で「どのコミットの木で測る
  か」が決まらない。再現 workflow は対象の spec ファイルがその木に存在することを
  前提にするので、依頼は測る木そのもの（head コミット）に載せる trailer で渡す。

### 回数は確認 3 回・修正の検証は 3 回連続成功

- **決定**: 既定は確認 3 回、修正の検証は 3 回連続成功。trailer で上書きでき、
  上限は 10。
- **理由**: 疑いあり issue には CI 上の失敗が最低 1 回記録されている。**その記録済み
  の失敗を失敗側の 1 標本として数える**ので、確認に必要なのは「1 回でも成功する
  こと」だけ。本物の決定的な失敗は 3/3 で落ちるので、3 回で区別がつく。当初案の
  10 回 / 5 回は「多すぎる」とユーザーが判断した。
- **トレードオフ**: 3 回連続成功は、失敗率 30% の flake を 34% の確率で見逃す。
  見逃しても PR の通常 CI がもう 1 標本を足し、マージ後は `detect-flaky-ci` の
  再オープン経路が拾うので、無言で消えることはない。
- **根拠となった実測**: #11819 の確認測定は `Runs: 3 / Failed: 0`。記録済みの CI
  失敗 1 回と合わせて 1/4 と読み、`flaky/confirmed` に上げた。

### `on.<push>.<paths>` フィルタと新しいブランチの比較基準

- **決定**: 確認用ブランチ `flaky-repro/**` で通常 CI を増やさない保証は、`paths`
  の挙動に頼らず `ci-app.yml` の `push.branches-ignore` に 1 行書いて明示する。
  `ci-app-prod.yml` は `on.push.branches` の allowlist 方式（GitHub は `branches`
  と `branches-ignore` の併用を許さない）で、`flaky-repro/**` は allowlist に一致
  しないため既に除外されている（その旨をコメントで記録している）。`fix/flaky-**`
  は本物の変更なので除外しない。
- **理由**: GitHub Docs の `on.<push>.<paths>` の説明では、**新しいブランチへの
  push は「push された最も深いコミットの祖先の親」との 2 点間 diff で比較される**
  （"A two-dot diff against the parent of the ancestor of the deepest commit
  pushed"）。「変更ファイルが無ければ workflow は動かない」とも書かれているが、
  比較の基準点の文言が曖昧で、失敗コミット自身の差分が比較に入る可能性を否定
  できない。つまり空コミットを push しても通常 CI が動きうる。1,000 コミットを
  超える push や diff 生成がタイムアウトした場合は常に実行される、とも書かれて
  いる。
- **出典**: GitHub Docs "Workflow syntax" → `on.<push>.<paths>` の Git diff
  comparisons —
  https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

### 再現結果の置き場所は追跡 issue の `### Repro result` コメント

- **決定**: 集計結果は追跡 issue に `### Repro result` という見出しのコメントとして
  書き、人が読む用にジョブサマリにも同じものを出す。読む側は**今回の push の SHA
  で紐づけて**選ぶ（`- Commit: <SHA>` 行を持つ `### Repro result` の最新 1 件）。
- **理由**: 「状態は GitHub の issue / label / PR にだけ置く」という原則に乗り、
  routine 側の読み取り経路を増やさずに済む。routine はジョブログを `gh` では読め
  ず（blob storage へのリダイレクトが遮断される）、MCP の `get_job_logs` は 50 万
  文字級を返すので結果行の抽出が高くつく。見出しは Occurrences の集計が使う
  `### Additional observation` / `### Backfilled observation` と衝突させない。
- **検討した他の案**: check-run の `output` に集計を書く（`checks: write` が要る）、
  ジョブサマリだけに書く（routine から読めない）。
- **根拠となった実測**: 「最新のコメント」で選ぶと、判断待ちからの再開や修正の検証
  で積み重なった古い集計を拾ってしまう。読み取りは `gh api --paginate --slurp | jq`
  で行う（`--slurp` と `-q` は併用できない、`-q` はページごとに当たる、jq の `"m"`
  フラグは行頭に効かない — いずれも実測）。抜粋の中に `- Failed:` で始まる行が
  混ざり得るので、先頭一致で最初の 1 行だけを取る。

### check-run の conclusion は「測定できたか」だけを表す

- **決定**: 前処理（checkout・依存の用意・サービス起動・対象 spec の存在確認）が
  終わってテストを N 回流せたら success、前処理で失敗したら failure。テストの合否
  は issue コメントとジョブサマリにだけ書く。
- **理由**: 確認測定ではテストが落ちることが正常な結果なので、conclusion にテスト
  結果を載せると通常の「赤＝異常」と意味が混ざる。読む側は「success なら結果
  コメントを読む、failure なら確認未実施として扱う」の 2 分岐で済む。
- **注意**: trailer が 1 つも無い `fix/flaky-**` への push は「依頼なし」として
  成功で終わる（後続の step を飛ばす）。Playwright の修正 PR を赤くしないための
  意図的な挙動なので、**check-run が success でも測定が行われた証拠にはならない**。
  判定には結果コメントの `- Failed:` / `- Runs:` 行を使う。

### 依頼は git trailer で渡し、値は allowlist で検証する

- **決定**: 依頼は head コミットの**最後の段落**に `Flaky-Repro-*` の trailer として
  書く。workflow は値を allowlist で検証し、落ちたら前処理失敗として終わる
  （project 名は決められた集合、spec はリポジトリ内に実在するファイルパス、回数は
  1〜10 の整数）。パスはシェルで展開せず vitest の位置引数にそのまま渡す。
- **理由**: 測る対象はその木に存在していなければならないので、依頼は測る木そのもの
  に載せるのが素直。push 権限を持つ人は既に任意の CI を動かせるが、値の取り違えで
  無関係なコマンドが走るのは避けたい。
- **注意**: git はコミットメッセージの最後の段落だけを trailer として読む。
  `git commit -m A -m B` のように `-m` を複数回渡すと段落が分かれて trailer が
  読めなくなるので、依頼行はすべて 1 つの `-m` の中に連続した行として書く。
  `Co-Authored-By:` などを添えるときも同じ段落に置く。workflow は段落の分割と
  重複キーを不正として落とす。
- **トレードオフ**: vitest の project を足すときに allowlist の更新が要る
  （Revalidation Trigger）。

### 測定用ブランチをどこから切るか

- **決定**: 確認用ブランチは `origin/master` の HEAD から切る（失敗した run の SHA
  からではない）。測る問いは「いまの master でその spec が非決定的か」。対象の spec
  が master に無ければ workflow が拒否し、判断待ちになる。修正ブランチも
  `origin/master` から切る。測定した SHA と PR の head SHA が一致する。
- **条件つきの制約**: `flaky-repro.yml` が master に無いリポジトリ状態では、機能
  ブランチの先端から切らないと測定できない（workflow の無い木に push しても起動
  しない）。一方その先端から PR を出すと差分に機能ブランチの内容が混ざり、PR 作成
  ゲートの第 3 条件で落ちる。このときは「機能ブランチ先端で測り、同じ差分のコミット
  を master に載せ直して PR にする」と通せる（PR 本文に 2 つの SHA の対応を書く）。
- **根拠となった実測**: 差分の確認は `git diff origin/master...HEAD`（3 点、
  merge-base 起点）で取る。2 点で取ると master 側にしか無いファイルまで差分に
  混ざる。

### MongoDB は 4 つの vitest project すべてで起動する

- **決定**: 再現 workflow は unit / components / 統合系 2 つのどれを流すときも
  MongoDB を起動する。Elasticsearch は統合系だけ。
- **理由**: unit / components を流す通常 CI のジョブ（`ci-app-test`）も MongoDB を
  起動して `MONGO_URI` を渡している。`test/setup/mongo/self-contained-connection.ts`
  は `MONGO_URI` があれば内蔵の memory server より優先するので、環境変数だけ渡して
  サービスが無いと、安定している spec まで落ちて測定にならない。

### 巻き添えと連鎖の範囲は同じジョブログに限る

- **決定**: 巻き添えの候補にするのは、共有 setup フック（`test/setup/` 配下）の
  `Hook timed out` を含む**同じジョブログ**の中で起きた、他ファイルの
  `Hook timed out` / `Test timed out` だけ。アサーション失敗・unhandled rejection・
  接続エラーは対象にしない。同一ファイル内の連鎖も同じジョブログの中に限り、先頭の
  失敗だけを issue にする。
- **理由**: 範囲は run ではなくジョブログ。ジョブは別プロセスなので、汚れた状態は
  1 つのジョブの中でしか伝わらない。負荷では説明できない失敗（アサーション・
  unhandled rejection）を巻き添えとして片付けると、独立した不具合を取り逃がす。
- **見逃しへの備え**: 巻き添えと判定したコメントは issue に残るので、フック timeout
  の無いジョブで再発すれば独立した issue になる。

### 判定条件の元になった実例

（追跡 issue 20 件を 1 件ずつ読んだ分析は、同じディレクトリの
`flaky-issue-mechanism-review.md` にある。以下はそこから判定条件に落ちたもの。）

- **決定**: 巻き添え・連鎖・誤検出のルールは、追跡 issue 20 件の実例をそのまま判定
  条件にする。
- **根拠となった実測**（2026-09-14 時点の追跡 issue 本文とコメント）:
  - 共有フック timeout（#11752）と同じジョブログの中で、他ファイルの 5000ms
    timeout が独立した issue になった例: #11851 / #11852 / #11858（run
    33650461350 / 33845711223）。#11852 はテスト本体に 5 秒を使い切る要素が無く、
    巻き添えと判定してクローズした
  - 同一ファイル内の連鎖: #11849 の後続 3 テストが #11890 / #11891 / #11892 に
    なった（`Should not already be working` は先頭の失敗の後始末に起因）
  - 対照例として独立と判定したもの: #11864（unhandled rejection）。巻き添えを
    timeout に限る根拠になっている
  - lockfile 起因の**決定的**な失敗: #11849 は dependabot PR の `pnpm-lock.yaml`
    で `@codemirror/state` が 6.7.1 と 6.7.4 に分かれていたもの。判定①は
    `pnpm-lock.yaml` しか触っていない差分を「無関係」と読むので、ここだけでは
    flake と決められない
  - master に無いコミット: #11799（マージキュー上の PR #11750 のコミット）、
    #11864（PR #11827 が追加した spec。マージ先が機能ブランチ）
  - ネットワーク起因: #11708 は github.com からの実ダウンロード

### 人のコメントの判定は「Bot でない」かつ「署名が無い」

- **決定**: 「`user.type` が `Bot` でない」「本文が自動投稿の署名を含まない」
  「`flaky/needs-decision` ラベルが付いた時刻より後」の 3 つを満たすコメントを人の
  返答とみなす。
- **理由**: routine が人のトークンでローカル実行されると、コメントの投稿者は人の
  名義になる。名義だけでは分けられないので署名で分ける。Mannequin は人として扱い
  たいので `== "User"` ではなく `!= "Bot"` で見る。
- **署名の照合**: 囲み記号を含めない素の部分一致（`Investigated by Claude Code` /
  `_Generated by [Claude Code](https://claude.ai/code)_`）。実際のコメントの囲みは
  `*…*`（#11707）、`*…(autonomous flaky-ci-routine)*`（#11851）、`_…_`（#11708）と
  揺れている。文言は 1 か所に定数として置き、3 つのファイルがそれを参照する。
- **自動投稿はすべて署名で終わらせる**（detect が投稿する観測コメントも含む）。
  署名の無い自動投稿は、人のトークンで動いた routine の観測追記を「人の判断」と
  誤読させ、判断待ちを勝手に再開させる。
- **停止コメントだけは並びが違う**: 署名を最後から 2 行目に置き、`- Recommendation:`
  を最終行にする（ダッシュボードが最終行を推奨として読むため）。それ以外のコメント
  は署名が最終行、`**Fix PR**` マーカーは署名を付けない。

### 判断待ちという状態と、再開は人のコメントだけをトリガーにする

- **決定**: `flaky/needs-decision` ラベルで「人の判断待ち」を状態として持ち、再開の
  トリガーは人の新規コメントだけにする。観測数が増えたことや一定日数の経過では再開
  しない（ダッシュボードの表示には反映する）。
- **理由**: 止まった理由が「人の判断が要る」ことなので、判断が来ていないのに再開
  すると同じ場所でまた止まり、費用だけ増える。
- **根拠となった実測**: 直近 20 回の routine 実行ログでは、`flaky/suspected` の
  issue が例外なく確認ゲートで止まり、止まったあとに選び直される経路が無かった。
  ラベルを付けた 14 件のうち、人のコメントが付いた 1 件（#11849）だけが次のサイクル
  で選ばれ、残り 13 件は選ばれなかった。
- **止めるときはラベルを先に付け、コメントを後に投稿する**。ダッシュボードは
  「ラベルが付いた時刻より後のコメント」を推奨として読むので、逆順だと正しく止めた
  issue ほど `(may be stale)` と表示される。記録時刻は数秒ずれることがあるので
  120 秒の幅を許す（実際に −1 秒のずれが観測された）。

### 自動クローズは `flaky/observing` のみ、14 日

- **決定**: 最終観測の `Date:`（本文と観測コメント）から 14 日以上経った
  `flaky/observing` の issue を `not planned` でクローズし、
  `### Auto-closed: not reproduced within 14 days` を書く。
- **理由**: `suspected` / `confirmed` は既に証拠が複数あるか調査の対象なので、時間
  だけで閉じてはいけない。再オープンは既存の CLOSED issue 経路（`Fixed by` が無い
  ＝解決時刻が不明なので再オープンする）でそのまま成立する。
- **根拠となった実測**: 1 サイクルで #11707（最終観測から 17 日）と #11708（18 日）
  の 2 件が対象になった。

### routine は購読も再起床の予約もしない

- **決定**: flaky 系のスキルは PR やコメントのイベント購読・再起床の予約をせず、
  最終報告を書いたらセッションを終える。汎用の issue 調査 routine は `flaky/` で
  始まるラベルを持つ issue を対象から外す。
- **理由**: 汎用 routine が flaky の issue を拾うと、flaky 用の手順（識別キー・
  tier・ダッシュボード）を通らずに処理される。
- **根拠となった実測**: 2026-09-10 の汎用 routine の実行が `flaky/observing` の
  #11870 を拾って PR #11882 を出した。結果自体は正しかったが、PR イベントの購読で
  セッションが 1 日半残った。

### 窓の既定は 32 時間

- **決定**: `detect-flaky-ci` の既定を 32 時間とし、routine の起動プロンプトでも
  `--window-hours=32` を明示する。
- **理由**: `growi-flaky-ci-routine` の cron は `0 0,16 * * *` で、起動間隔は 16 時間
  と 8 時間の交互になる。最長間隔の 2 倍を窓にすれば、1 回抜けても取りこぼさない。
  以前の既定 16 時間は 8 時間の等間隔起動を前提にした値で、最長 16 時間の間隔には
  足りなかった。

### routine のモデル（判断材料。決定していない）

- **現状**: `claude-sonnet-5`。
- **判断材料**: 調査は原因追及の質が結果を左右する。読めば分かる原因（#11818 の
  モック漏れ、#11823 の `fs.rm` の `force` 欠落）を調査コメントが取り逃がしている
  例がある。`investigate-flaky-test` の実行だけ Opus 系にする案があるが、費用と
  見合うかはユーザーの判断で、まだ決めていない。要件では定めない。

### Playwright の検証はマージキューの `run-playwright` に委ねる

- **決定**: Playwright のテストは再現 workflow の対象外。修正は PR を Ready で開き、
  マージキューで動く `run-playwright`（retries 2）を検証とする。マージ後も retry が
  要るなら `detect-flaky-ci` の Step 2b がそれを観測して issue に戻す（既存の経路）。
- **理由**: `reusable-app-prod.yml` は head_ref が `mergify/merge-queue/**` のときか
  `workflow_dispatch` のときだけ Playwright を動かす。**PR を開いただけでは動かず**、
  修正ブランチへの push でも動かない。
- **根拠となった実測**: #11863 の head では `run-playwright` が `skipped` だった。

### 実ログで確定した手順の規則

実際に routine を回して見つかった不具合から確定した規則。どれも「読めば自明」では
なく、実ログや実データで初めて分かったもの。

- **ジョブログを `gh` で読める環境では `gh api --allow-escape-sequences .../jobs/{id}/logs` で取る**
  （取得手段は実行環境ごとに 1 回だけ決める。MCP の `get_job_logs` が使えるなら
  そちら）— `gh run view --job ... --log-failed` は別の attempt を指定しても最新 attempt の
  ログを黙って返すので、再実行のあった run で誤ったログを読む。
- **Playwright の精密な識別（tier 1）は「`::error` 注釈が 1 件で、そのシャードの
  `N flaky` + `N failed` がその 1 件で説明できる」ときだけ成立させる** — 却下した
  案は「注釈を retry の添付ファイルのパスと突き合わせる」形だったが、再試行で
  最終的に通ったテストにも `::error` 注釈は出る一方、再試行そのものの出力ディレ
  クトリ（添付パス）はログに出ない（`screenshot: 'only-on-failure'` なので成果物
  は失敗した 1 回目の分だけ）ので、「0 failed かつ
  1 flaky」という最も普通の形で成立しなかった。現行の条件はこの形でも成立し
  （注釈 1 件、`0 + 1 = 1`）、#11903 で実際に効いた規則。
- **識別キーの解析は「拡張子の直後の `:`」を境界にする** — 共有 setup フックの
  `.ts` を含む題名も通る。実在する追跡 issue の題名 65 件で全件一致を確認。
- **denylist は FAIL ブロック単位で当てる** — 共有 setup フックの中で一致したとき
  だけジョブ全体を除外する。
- **履歴のバックフィルは、denylist と「PR 自身の失敗」の除外を通ったログだけを
  対象にする** — 通さないと、除外すべき失敗で観測数が増えて tier が上がり、自動
  クローズを妨げる（#11707 で発生）。
- **Fix PR マーカーの照合は行単位の完全一致にする** — 署名が付いた形のマーカーを
  取りこぼさない。この変更で #11821 / #11851 / #11858 の 3 件が埋まった。
- **JSON を含む文字列は `printf '%s\n'` で出す** — zsh の `echo` は `\n` を展開して
  しまう。
- **Playwright のジョブ名は完全一致でなく `contains("run-playwright")` で探す** —
  再利用 workflow の名前が前置される。
- **check-run は push と PR で同名が 2 件並ぶので `group_by(.name) |
  map(sort_by(.started_at) | last)` で 1 件に落とす**。
- **ダッシュボードの表の行順は常に規定の順に並べる**（並びが実行ごとに変わると差分
  が読めない）。
- **判断待ちからの再開で答えが「閉じる」だったときは、選んだ選択肢を再開経路が最初
  に投稿するコメントに記録する** — そうしないと、どの選択肢を選んだかがどこにも
  残らない。
- **push の前に、issue 本文の識別キーと trailer の Spec を突き合わせる** — 番号を
  手で書くと取り違える。識別キーから Spec を導く手順に乗っている限り自動で満たされる。

### ゲート全体を通した実測（#11819 / PR #11913）

- #11819: 確認測定が `Runs: 3 / Failed: 0`。記録済みの CI 失敗と合わせて確定し、
  `flaky/suspected` → `flaky/confirmed` の昇格、集計コメント、確認ブランチの削除
  まで手順どおり通った。
- 修正は PR **#11913**（Ready で作成、本文の Verification に `Runs: 3 / Failed: 0`
  と 3 つの run URL）。PR 作成ゲートの 3 条件（修正コミットの SHA に紐づく
  `### Repro result` が `- Failed: 0` かつ `- Runs:` が依頼回数以上、`ci-app-*` の
  check-run が 1 件以上あってすべて success、差分が原因調査で特定した範囲に収まる）
  を REST だけで通し、追跡 issue の `**Fix PR**` マーカーとラベル遷移まで到達した。

## スクリプト抽出の設計決定（Requirement 5）

手順書（`.claude/commands/flaky-ci-routine.md` と 2 本の `SKILL.md`）のうち、判断を
通らない機械的な処理を `bin/flaky-ci/` の TypeScript スクリプトへ切り出した。以下は
その置き場・実装方式・契約・共通化の決定と、それぞれの理由・根拠。

### 置き場は `bin/flaky-ci/`（既存 package `@growi/bin`）

- **決定**: スクリプト・純粋関数・フィクスチャを `.claude/skills/<skill>/scripts/`
  ではなく、既存の `@growi/bin` package の一部として `bin/flaky-ci/{scripts,lib,
  fixtures}/` に置く。手順書からはリポジトリ root を cwd として
  `node bin/flaky-ci/scripts/<name>.ts` の形で呼ぶ。
- **理由**: `vitest.workspace.mts`・`biome check bin`・`.github/workflows/ci-bin.yml`
  が `bin/` を対象に含んでおり、追加の配線なしにテスト・lint・CI が効く。一方
  `.claude/` 配下は `vitest.workspace.mts`（`apps/*`・`bin`・`packages/*` のみ）・
  `biome.json`（`!.claude` で除外）・CI の path filter のいずれからも見えない。
- **根拠となった実測**: `.claude/skills/suggest-path-evaluator/scripts/*.ts` という
  前例は `node` 直接実行の手段が確立されていることを示す一方、テスト・lint の配線が
  無いことも実測で確認した。`bin/` に置く案（root package.json が `"type":"module"`
  であることも含め）は追加設定なしで `turbo run test --filter=./bin` に乗ることを
  確認済み。
- **トレードオフ**: スキルディレクトリとスクリプトの置き場が離れる。契約は
  `bin/flaky-ci/README.md` の契約表と各スクリプト先頭の説明で補い、手順書側は
  そこを指す形にした。
- **採らなかった案**: `.claude/` 直下に新しい package を作る案、skill ごとに
  package を作る案（いずれもテスト・lint・CI の配線を個別に追加する必要がある）、
  root に vitest config を足す案（root には `test` script も対応する turbo task も
  無く、そもそも走らない）。

### 実装言語は TypeScript のみ、`node` で直接実行する

- **決定**: 全スクリプトを `#!/usr/bin/env node` の `.ts` として書き、コンパイルや
  トランスパイラを挟まず `node` で直接実行する。外部ライブラリには依存せず Node
  標準ライブラリのみを使う。`enum`・パラメータプロパティ・namespace など、Node の
  型除去実行で `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` になる構文は使わない。
- **理由**: 手順書の Bash ツール内実行と、実際の bash スクリプト実行では**別の
  プログラムが動く**（`grep` は Bash ツール内で ugrep 7.8.4、スクリプト内では GNU
  grep 3.12。`date`/`head`/`sort`/`cut`/`tr`/`wc` は uutils coreutils 0.8.0、`awk`
  は mawk 1.3.4、シェル自体も zsh 5.9）。日時計算・文字列処理・ページングを JS に
  寄せれば、この環境差そのものが消える。
- **根拠となった実測**: devcontainer で `node --version`（`v24.20.0`）・
  `import` 付き `.ts` の `node` 直接実行（成功）を実測。`date -d ""` が
  「今日 0 時 UTC」を返して終了コード 0 になるなど、手順書の既存の注意書きが
  想定していたのとは別の `date` 実装が実際には動いていたことも実測で確認した。
- **トレードオフ**: cloud routine 側の Node バージョンは実測できておらず
  （`RemoteTrigger` 相当のツールで実際の cloud セッションへ診断プロンプトを
  送り込む経路が無かった）、`^24` という `engines` 指定と全 CI workflow が
  Node 24.x に固定されている、という間接証拠だけを根拠に「素の `node <file>.ts`
  呼び出しをフォールバックなしの既定にする」と暫定判断している。cloud 環境で
  実際に routine を 1 サイクル動かして確認するまでは、この判断は確定ではない。
  Node 24 未満だった場合は `--experimental-strip-types` 付きの呼び出しに
  切り替える設計余地を残してある。
- **採らなかった案**: bash（+ `jq`）での実装も検討したが採らなかった。理由は
  上記「GitHub からの読み取りは `gh api -X GET` を子プロセスで呼ぶアダプタ
  1 つに集約する」の**理由**欄で述べた `jq` の落とし穴（`--paginate -q` が
  ページごとに評価される、`--slurp` と `-q` が併用できない）と同根で、
  日時・文字列処理・ページングを bash に残す限りこの環境差と落とし穴は
  消えない。

### スクリプトは事実だけを返し、書き込みは行わない。失敗は終了コード 2

- **決定**: 各スクリプトは stdout に JSON 1 個（`{ "ok": true, ...facts }`）を
  出して終了コード 0 で終わる。前提を満たせない（API 呼び出し自体が失敗する等）
  ときは stdout を空にし、stderr に理由を 1 行書いて終了コード 2 で終わる。
  終了コード 1 は想定外の例外用に空けておく。複数行（複数 issue 等）を返す
  スクリプトでは、行単位で読めなかった事実だけを「読めなかった」欄で示し、
  呼び出し全体は成功として扱う。
- **理由**: 手順書側は「0 なら事実を読む、2 なら『測定・取得できなかった』の
  既存経路へ回す」という 2 分岐だけで済むようになる。GitHub への issue・
  コメント・ラベルの書き込みは判断を伴うため手順書側に残し、スクリプトは
  読み取りと機械的な変換だけを行う。
- **根拠となった実測**: 空配列や 0 件が「成功」に見えてしまう事故（監査で
  指摘された、読み取り結果が空のまま次の判断へ進んでしまうパターン）を、
  「取れなかった＝終了コード 2」と「0 件で正常＝`ok:true` で空配列」を型として
  区別することで構造的に防いだ。実装（`lockfile-overlap`）では、いったん
  「lockfile を含まない PR」を終了コード 2 で扱う初版を作ったところ、独立
  レビューで「本来異常でないケースを異常扱いすると、Step 6 の『スクリプト
  失敗』報告行が本物の異常を埋もれさせる」と指摘され、契約違反として差し
  戻された。以後、終了コード 2 は「取得そのものが失敗した」場合だけに限定
  している。
- **トレードオフ**: 「0 件で正常」と「取得できなかった」を区別する責任が
  スクリプト側の設計に移る。各スクリプトの契約（README の契約表）で
  `ok:true` かつ空配列の意味を明記する必要がある。

### GitHub からの読み取りは `gh api -X GET` を子プロセスで呼ぶアダプタ 1 つに集約する

- **決定**: `lib/gh.ts` に `GhApi`（`get(path, params)` で単発、`getAll(path,
  params)` でページ番号を自分で回して結合）を実装し、内部は `execFile('gh',
  ['api', '-X', 'GET', …])` の子プロセス呼び出しにする。全スクリプトはこの
  1 つのアダプタ経由でのみ GitHub を読む。テストでは子プロセスを差し替えて
  記録済み応答を注入する。
- **理由**: 認証と outbound proxy の扱いは `gh` に任せたまま、`--paginate -q`
  がページごとに評価される・`--slurp` と `-q` が併用できない、といった
  `gh` の落とし穴を JS 側のページ結合ロジックに閉じ込められる。GraphQL は
  routine の実行環境の outbound proxy が遮断するため、REST の GET 以外は
  最初から選択肢に入れていない。
- **採らなかった案**: Node の `fetch` で `api.github.com` を直接呼ぶ案も
  検討したが採らなかった。認証トークンの取り回しと outbound proxy の扱いが
  `gh` を経由する場合と別物になり（`gh` は認証・proxy 越しの通信を自分で
  面倒を見るが、直接 `fetch` するとその面倒をスクリプト側が肩代わりする
  必要が生まれる）、`gh api --paginate` 案と同様に見送った。
- **根拠となった実測**: `gh pr ready`（draft → Ready、内部で GraphQL の
  `markPullRequestReadyForReview` を呼ぶ）が遮断されて失敗することを実測済み
  （閉ループ化の設計決定「GitHub への書き込みは REST だけで行う」と同根）。
  読み取り側でも `gh api --paginate --slurp | jq` が `-q` と併用できない・
  `-q` がページごとに当たる、という実測済みの落とし穴があり、ページ結合を
  スクリプト側の JS ロジックに移すことでこれらを踏まなくなる。
- **トレードオフ**: `gh` プロセス起動のオーバーヘッド（数十 ms/回）が乗るが、
  routine 全体の所要時間に対しては無視できる範囲。

### ログ解析は stdin 1 本のパーサ `parse-job-log.ts` に統合する

- **決定**: 生のジョブログ（タイムスタンプ前置き・ANSI 混じり）を stdin で
  受け取り、ANSI 制御列と行末 `\r` の除去を 1 つの正規表現に統一したうえで、
  `{ vitest: { failBlocks[] }, playwright: { annotations[], summary: { failed,
  flaky, passed, skipped } | null }, denylistHits[] }` を 1 回のパースで返す。
  段位（tier）の決定や denylist の一覧を広げる判断はこのパーサでは行わず、
  手順書側に残す。
- **理由**: 事実の取り出し（FAIL ブロック・Playwright 注釈・集計行・denylist
  一致）と、その後の判断（段位判定・denylist 拡張・巻き添え/連鎖の切り分け）
  を明確に分離する。`summary: null` を「集計行が取れなかった＝不明」として
  明示的に返すことで、`0` （全部通った）と区別できるようにした。
- **根拠となった実測**: 実装前の調査で、ログ解析にあたる処理（旧 #9・#10 の
  候補）が手順書内の 3 か所に分散し、ANSI 除去の正規表現が `[0-9;]*m` と
  `[0-9;]*[A-Za-z]` の 2 種類に割れていた（後者を正とした。色以外の制御列も
  落とすため）ことを確認済み。1 本のパーサへ統合することでこの重複と表記
  揺れを解消した。
- **トレードオフ**: denylist の**一覧そのもの**はデータとして `lib/
  denylist.ts` に置くが、一覧を広げる（新しい infra noise パターンを追加する）
  判断は手順書側の運用判断として残る。

### 固定文字列は `lib/constants.ts` を機械可読な定義とし、手順書との一致をテストで検証する

- **決定**: `### Repro result`・`### Additional observation`・
  `**Fix PR**: `・各ラベル名・自動投稿の署名など、手順書とスクリプトの
  双方が使う固定文字列を `lib/constants.ts` に定義する。`constants.spec.ts`
  が、各定数について「どのファイル（またはどの節）と突き合わせるか」を
  定数ごとに宣言し、その宣言に基づいて手順書側の実際の記述と一致することを
  検証する（ドリフト検知）。
- **理由**: 「定義は 1 か所」という原則を、人が読む手順書と機械が読む定数の
  両方に対して保ちつつ、二重定義がずれた場合はテストが落ちる形にする。
- **根拠となった実測**: 当初は「全定数が `.claude/commands/flaky-ci-
  routine.md` の `## Shared constants` 節に現れること」を一律に検証する
  設計を想定していたが、実装時に、同節が実際に定義しているのは
  `flaky/needs-decision`・`- Recommendation: `・署名 2 種・保留窓 120 秒
  だけであることが判明した。tier ラベル・コメント見出し・`**Fix PR**: ` は
  同じファイルの別の場所に、`### Repro result` の 7 行は手順書ではなく
  `.github/workflows/flaky-repro.yml` に定義されている。そのため定数ごとに
  実際の定義元を検査する形に設計を修正した。この経緯とその是正内容は本
  spec の design.md（Components・Testing Strategy）にも反映済み。
- **トレードオフ**: 手順書・workflow ファイルの節構造や記述位置が変わると
  `constants.spec.ts` も追随して直す必要がある（本 spec の design.md の
  Revalidation Triggers に記載）。`.github/workflows/ci-bin.yml` の `paths`
  には `.claude/commands/flaky-ci-routine.md` と `flaky-repro.yml` を追加し、
  これらの変更でも一致検証が走るようにした。

### `flaky-repro.yml` の `run:` の分割は任意タスクとし、bash のまま切り出す

- **決定**: `flaky-repro.yml` の `run:` の中身（trailer の解析・検証、N 回
  実行と集計、結果の整形）は TypeScript に書き直さず、bash のまま
  `.github/scripts/flaky-repro/{parse-request,run-repro,render-result}.sh`
  へそのまま移す。workflow は各スクリプトを呼ぶだけにし、最初のステップで
  `bash -n` による構文検査を行う。この切り出し自体を実施するかどうかは
  運用者の任意判断とする。
- **理由**: `flaky-repro.yml` は GitHub Actions runner（GNU bash・GNU
  coreutils）上でのみ動き、routine の実行環境（zsh・ugrep・uutils・mawk）
  との環境差の問題が最初から存在しない。TypeScript に書き直すと、既存の
  bash 実装との振る舞い同一性を検証するコストの方が上回る。
- **根拠となった実測**: 分割を実施する場合は `flaky-repro/selftest-*`
  ブランチで実際に 1 回測定し、`### Repro result` の 7 行が分割前と
  同一であることを確認する、という受け入れ条件で設計した。
- **トレードオフ**: 分割してもしなくても、「測定中の依頼が push 済み
  ブランチ上のファイルに依存する」という前提そのものは変わらない。

### `Date:` 抽出の正規表現とコメント見出し照合ロジックは、3 か所への重複を許容する

- **決定**: `Date:` 行を取り出す正規表現 `/^-?\s*Date:\s*(.+)$/` と、
  それに先立つ観測見出し（`### First observation` / `### Additional
  observation` / `### Backfilled observation`）の判定ロジックは、
  `bin/flaky-ci/scripts/newest-observation.ts`・`bin/flaky-ci/scripts/
  awaiting-decision-rows.ts`・`bin/flaky-ci/lib/dashboard.ts` の 3 か所に
  同一のコードとして重複させる。これらを 1 つの共有 `lib/` モジュールへ
  くくり出すことはしない。
- **理由**: 本 spec の design.md の File Structure Plan は、このロジック用の
  共有 `lib/` モジュールを計画に含めていない。3 か所とも、見出し文字列
  そのものは `lib/constants.ts` の `COMMENT_HEADINGS.*` を共通で参照して
  おり、重複しているのは日付抽出の正規表現という 1 行のロジックだけで、
  見出し文字列という「事実の定義」自体は既に単一の場所（`lib/
  constants.ts`）に集約されている。この重複の程度であれば、新しい共有
  モジュールを追加する複雑さに見合わないと判断した。
- **トレードオフ**: 3 か所のうちどこか 1 か所の `Date:` 抽出ロジックを
  将来変更する場合（例えば `Date:` の書式が変わる、タイムゾーン表記に
  対応する等）、残り 2 か所も同じ変更が必要かどうかを必ず確認する必要が
  ある。見出し文字列自体は `lib/constants.ts` を通じて自動的に追随するが、
  正規表現部分は手動での横展開が要る。将来この 3 か所のいずれかに触れる
  変更が入るときは、この横展開の要否を確認すること。**注**: 2026-09-16
  時点で本 spec の design.md の Revalidation Triggers には、この 3 ファイル
  の組を対象とする項目がまだ無い（`newest-observation` / `awaiting-
  decision-rows` / `dashboard.ts` はそれぞれ別々の行で説明されているのみ）。
  追加する場合は次に design.md を更新する機会に反映すること。

## 未解決のまま残っている論点（今後の改善候補）

`brief.md` の Scope には含めていないが、この調査・実運用の過程で見つかった
ものの、まだ手を付けていない改善余地:

- 再現 workflow のサービス起動手順（pnpm・setup-node・dist キャッシュ・依存の
  install・MongoDB・Elasticsearch）が `ci-app.yml` と重複している。再現専用の
  reusable workflow に切り出して `ci-app.yml` から呼べば重複は消えるが、
  `ci-app.yml` のジョブ構造（YAML anchor）を組み替える必要があるため手を付けて
  いない。当面は両ファイルに相互参照コメントを置き、Revalidation Triggers に
  登録して乖離を防いでいる
- ~~「証拠のコミット日時が修正マージより前か後か」でreopen可否を判断するロ
  ジックは、今回モデルがその場で下した判断であり、スキルに明文化されたルー
  ルではない~~ → **2026-08-15、`/kiro-impl`のタスク1.2（トレーサビリティ確
  認）で発見・タスク1.3で解消**。`detect-flaky-ci/SKILL.md`「Existing
  CLOSED issue found」に日時比較の明文化された手順を追加済み（AC 2.6）
- **2026-08-15、`/kiro-impl`のTask 3（本番`growilabs/growi`でのrun now検証）
  で発見・その場で修正**: `gh api repos/.../actions/workflows/{file}/runs`
  はGitHub Actions APIの仕様上、`status`パラメータが`completed`だけでなく
  `failure`/`success`等の値も直接受け付ける形になっており、独立した
  `conclusion`パラメータは存在しない。④の深掘りbackfillが使っていた
  `-f status=completed -f conclusion=failure`は後者が無視され黙って
  `status=completed`のみで動作し、成功・失敗・キャンセル全てのrunを返して
  いた（false negativeには直結しない設計だが、意図した絞り込みが効いてい
  なかった）。`-f status=failure`単体に修正し、本番で実測（28件全て
  `conclusion=="failure"`）して確認済み
- **未対応のまま記録のみ（2026-08-15発見）**: `gh api`でActions run一覧を
  ページングする際、一部のrunのコミットメッセージに含まれる生の改行文字
  （JSON文字列として本来`\n`にエスケープされるべきところ、エスケープされ
  ていない制御文字のまま）が混入し、`jq`でのパースが
  `Invalid string: control characters ... must be escaped`エラーになる
  ケースがあった。Node.jsで簡易サニタイザ（文字列リテラル内の制御文字だけ
  を検出して`\n`等にエスケープし直すスクリプト）を書いて回避したが、
  `detect-flaky-ci/SKILL.md`のStep1本体はこの対処を明文化していない。
  再現条件（どのコミットメッセージが原因か）は特定していない。将来また
  `jq`パースエラーが出た場合、まずこれを疑う

## 実運転で見つかった規則の出典（実例と事故）

`.claude/commands/flaky-ci-routine.md` と `.claude/skills/detect-flaky-ci/SKILL.md`
は、cron から無人で動く LLM ルーティンが毎回読む手順書なので、短く保つ価値が高い。
そこで、規則そのものは手順書に残したまま、**その規則がなぜ必要になったかを示す実例
（issue 番号・run 番号・実測値）をこの節に移した**。手順書側には理由を 1 文だけ残して
ある。規則を変えようとする人は、変える前にここを読んでほしい。

以下は規則ごとに並べてある。

### 自動投稿の署名は、囲み記号を含めずに部分一致で探す

`flaky-ci-routine.md` の Shared constants → Automated-author signatures。

`Investigated by Claude Code` という文字列を、前後の `*` や `_` を含めずに探す
規則になっているのは、実際に投稿された行の書き方が揃っていなかったため:

- #11851: `*Investigated by Claude Code (autonomous flaky-ci-routine)*`
- #11707: `*Investigated by Claude Code*`
- #11708: `_Investigated by Claude Code_`

語句だけで照合すれば 3 つとも拾えるが、`*...` の形で照合すると `_..._` の形が
人間のコメントとして通り抜けてしまう。

### `gh auth status` の表示だけを見て実行可否を決めない

`flaky-ci-routine.md` の Step 0。

cloud routine の `gh` セッションでは、`gh auth status` が「Active account: true」
と表示しながら、同じ出力の中でそのトークンを invalid とも書く、という状態が実際に
起きた。どちらの表示も実行可否の判断材料にはならない。実際に効いていた制約は
「認証できているか」ではなく「REST は通るが GraphQL は拒否される」という、より
狭い条件だった。そのため REST の read を 1 回投げて確かめる形にしている。

### 観測日時に issue の `updated_at` を使わない

`flaky-ci-routine.md` の 4-B。

`updated_at` はラベル変更・マーカーコメント・人間のメモでも更新されるため、
1 か月観測されていない issue が最新に見える。実例として #11708 は、最新の観測が
2026-08-13 なのに `updated_at` は 2026-09-14 を指していた。

### 人間が reopen したかどうかは `### Auto-closed:` コメントの有無で判断する

`flaky-ci-routine.md` の 4-C。

`reopened` イベントがあるだけでは「人間が追跡を続けたい」とは言えない。#11707 は
`2026-08-15T12:42:30Z` にクローズされ、`2026-08-15T12:43:44Z` に同じ人が reopen して
いる。74 秒後の取り消しなので、誤クリックとその取り消しである。これを判断として扱うと、
その issue は以後ずっと自動クローズの対象から外れてしまう。

### 埋め込む変数が空でないことを、heredoc を実行する同じシェルで確かめる

`flaky-ci-routine.md` の 4-E。

`${NEWEST}` と `${STALE_DAYS}` が空のまま投稿されると、`- Newest observation:` の
後ろに何も無いコメントが残る。エラーは出ず、気づく手がかりも無い。実際に #11707 と
#11708 で、4-B で計算した値がループの途中で失われたまま投稿され、後からコメントを
`PATCH` して直す必要があった。

### Fix PR のマーカーは、コメント本文全体ではなく 1 行ずつ照合する

`flaky-ci-routine.md` の Step 5 item 3。

`**Fix PR**: {URL}` だけの 1 行という書き方が決まる前に投稿されたマーカーは、
マーカー行のあとに空行・`---`・Claude Code の署名が続く形になっている（#11821・
#11851・#11858）。本文全体をマーカーと比較すると、この 3 件の Fix PR 欄は永久に
`—` のままになる。実際、この規則を 1 行照合に変えるまでダッシュボードはそう表示して
いた。

### 購読も通知も起床予約もしない

`flaky-ci-routine.md` の Step 3「Routine discipline」。

この規則は、PR のイベントを購読したセッションが、仕事を終えた後も 1 日半生き続けた
事故を受けて書かれている。次の cron 実行が拾い直す作りになっているので、待つ必要は
無い。

### ロックファイルだけの差分を「無関係」と読んではいけない

`detect-flaky-ci/SKILL.md` の ① 判定。

依存を上げると、テストが実際に動かす相手が変わる。ロックファイルしか触っていない
差分を「この PR は無関係」の証拠と読んだ結果、#11849 は 13 回の観測にわたって flaky
として追跡され続けたが、実際には、その差分を作った dependabot ブランチ上で毎回同じ
ように失敗していた。再生成されたロックファイルが `@codemirror/state` を 2 つの
バージョンで同時に解決してしまい、CodeMirror の `instanceof` チェックでテストが落ちて
いた。

パッケージ名を取り出すときの 2 つの規則（丸括弧の組を先に落とす / 最後の `@` で切る）
が必要な理由も実測から来ている。`snapshots:` の行は、そのパッケージが解決された相手
（peer）を丸括弧の中に記録し、その中にも `@` が含まれる。PR #11886 の patch には
そういう `+`/`-` 行が 36 本あった。先に丸括弧を落とさずに最後の `@` で切ると
`@inquirer/checkbox@5.2.2(@types/node` という、どこにも一致しない名前になる。
表の 1 行目と 3 行目は PR #11886 / #11887 / #11888 の `@codemirror` 関連 patch に、
2 行目は同じ patch 全体に現れる形である。

### 過去にさかのぼって見つけた失敗も、新しい失敗と同じ 2 つの判定を通す

`detect-flaky-ci/SKILL.md` の ④。

#11707 の識別キー（`external-user-group-sync.integ.ts > … > syncs groups and deletes
groups that do not exist externally`）は、run 34838590966 と 34838596432 から
きれいな `FAIL` ブロックとして grep で取り出せる。しかしどちらも証拠ではない。
head コミットは `master` の祖先ではなく、ブランチ `experiment/isolate-false-app-integration`
上にあり、どの PR にも属さないので、新規失敗の経路では「PR が無い → 除外」に当たる。
さらに、この 2 つのジョブログには keycloak のテストが `dummy-keycloak-host.com` を
解決しようとして出す `getaddrinfo ENOTFOUND` も含まれる（denylist が効くかどうかは、
その行がこの識別キー自身の `FAIL` ブロックの中にあるかで決まる）。この 2 つを
判定せずに ④ を発火させると、#11707 は証拠でないものを根拠に `flaky/suspected` へ上がり、
ルーティンの自動クローズ対象（`flaky/observing` のみ）からも外れてしまう。

### 特定の attempt のログは job id で取りに行く

`detect-flaky-ci/SKILL.md` の Step 2。

run 34846386483 が実測例である。attempt 1 が失敗し attempt 2 が成功した run に対して、
失敗したジョブ 103983310790（attempt 1）のログを `gh run view --job … --log-failed`
で求めると、attempt 2 の成功ログが返ってきた。判断材料となるログには `150 passed` と
書いてあり、警告は何も出ない。

### infra noise は失敗ごとに判定する（ジョブログ全体で判定しない）

`detect-flaky-ci/SKILL.md` の Step 2。

run 34838590966 / 34838596432 は 68 個の spec ファイルにまたがる 97 件の失敗を
含んでいた。そのうち 1 件が keycloak のテストで、`dummy-keycloak-host.com` を解決
できず `getaddrinfo ENOTFOUND` を出していた。ジョブログ全体を検索して判定すると、
この 1 件だけでなく残る 96 件も捨てられる。96 件は infra noise ではなく、keycloak の
DNS とは何の関係も無い。

### Playwright の識別キーには必ず browser を含める

`detect-flaky-ci/SKILL.md` の Step 3（Playwright の tier 1）。

spec を特定できた追跡 issue は、すでにすべて browser 入りの形になっている。例:
#11785 のタイトルは
`playwright:webkit:playwright/20-basic-features/comments.spec.ts:...` である。
ここで browser を落とすと、Step 4 が実際に検索するタイトル形式と識別キーがずれ、
重複 issue が立つ。

### `run-playwright` のジョブ選択は前方一致ではなく部分一致で行う

`detect-flaky-ci/SKILL.md` の Step 2b。

再利用可能ワークフロー経由で動くため、ジョブ名は
`test-prod-node24 / run-playwright (chromium, 1/2, 8.0)` の形になる。実測したスキャン
では、同じ run 一覧に対して前方一致は 0 件、部分一致は 61 件だった。

### `error file=` の grep に行頭の `^` を付けない・retry の数字を足さない

`detect-flaky-ci/SKILL.md` の Step 2b。

ジョブ 103921032242 での実測: `^` を付けると 0 件、付けないと 1 件で、その 1 件が
この shard の識別キー全体を決める唯一の注釈だった（ログの各行には先頭に timestamp が
付くので、行頭の照合は決して一致しない）。

`retry0` / `retry1` のような数字付きの選択肢を足してはいけない理由も同じジョブで実測
している。以前の grep にはそれがあり、12 件一致したが、すべて `comment-retry0` という
テスト用データに言及する `pw:api` のデバッグ行で、添付ファイルのパスは 1 件も無かった。

### 1 つの原因が複数の issue に分かれてしまった実例

`detect-flaky-ci/SKILL.md` の「Collateral timeouts」と「Cascaded failures」。

- collateral: #11851 / #11852 / #11858 は、いずれも
  `test/setup/migrate-mongo.ts` の setup hook が timeout した run から来ている。
  別々に issue を立てたので、1 つの原因が 4 つに見えていた。
- cascade: #11890 / #11891 / #11892 は #11849 の後続失敗 3 件である。

### 共有 setup hook の追跡 issue は、閉じているものもパスで探す

`detect-flaky-ci/SKILL.md` の「Reconciliation exception」。

#11752 がこの経路のためにある issue である。開いている間はこれまでどおり見つかるが、
いずれ閉じられた後に同じ hook が再発したとき、閉じた issue も探す経路が無ければ何も
見つからず、重複 issue が立つ。その hook の履歴が 2 つの issue に恒久的に分かれる。

### PR 自身が所有する失敗の実例と、PR が複数ある場合

`detect-flaky-ci/SKILL.md` の「Failures the PR itself owns」。

- #11864 は、PR #11827 がフィーチャブランチ `feat/185872-backlinks` 上で追加している
  最中の spec を追跡してしまったもの。#11799 は、PR #11750 がマージキューを通過する
  最中に追加していた spec を追跡してしまったもの。どちらも誰も対応できない issue に
  なる。
- コミット `537cb7bc96e56cf0d9fa610cb18d2e74128f8394`（#11864 の run 33857470813）は
  2 つの PR に属している。`master` を base とする #11610 と、フィーチャブランチを
  base とする #11827 である。両方が当該 spec を変更していた。`.[0]` だけ見ると片方
  しか報告されない。
- マージキューのコミット `00d87f7cfa520e93f5e407b5996ea837a4db4d0c`（#11799 の元）で
  実測したとおり、`commits/{sha}/pulls` は空で返り、PR 番号はコミットメッセージの
  1 行目（`Merge of #11750`）にしかない。

### 修正マージより前の証拠で reopen しない

`detect-flaky-ci/SKILL.md` の「Existing CLOSED issue found」。

#11711 がこの分岐の実例である。再発の証拠として見つかった失敗のコミット日時が、修正
PR のマージより前だったため、reopen せず履歴として記録するだけにした。また、この
issue の解決記録は自由文の `Fixed by #{PR_NUMBER}` 形式で、構造化された
`**Fix PR**: {URL}` マーカーはまだ付いていない。

### 取り下げた手順: draft PR を作って後から ready にする

`investigate-flaky-test/SKILL.md` の 6-C / 6-D。

以前は `gh pr create --draft` で作り、`gh run rerun` / `gh run watch` で green の回数
を数え、`gh pr ready` で ready にしていた。これは 2 つの理由で動かなかった。cloud
routine のトークンには `actions:write` が無いので rerun は 403 を返し、PR を ready に
するのは GraphQL の mutation（`markPullRequestReadyForReview`）で、そのセッションでは
ブロックされる。`PUT .../ready_for_review` は 404 で、`PATCH .../pulls/{n} -F draft=false`
も #11824 で試したが draft は外れなかった。結果として PR #11824・#11853・#11863 は
どれも draft のまま、集計も無く、「Ready for review を押してください」という段落だけが
残った。現在は、green の回数を数えるのは push で動く再現 workflow の役割であり、
REST で最初から非 draft の PR を作るので、draft を ready に変える手順そのものが
要らなくなっている。

### timeout を増やすだけの修正を止める規則の出典

`investigate-flaky-test/SKILL.md` の「Guardrail — a bare timeout increase is a stopgap」。

- driver 1（テスト自身のパラメータで実行時間が増える形）の手本は、issue #11718 /
  PR #11719 の `consume-points.integ.ts` の修正である。`rate-limiter-flexible` の
  `penalty(key, n)` が `consume()` と同じ内部 upsert の経路を通りながら 1 往復で
  `n` 点消費した状態を作れるので、`consume()` を `n` 回ループする必要が無くなった。
- driver 2（同時に走る setup の量で実行時間が増える形）では、PR #11824 が
  「作り直す対象が無いから timeout を上げてよい」と誤って分類した。それを置き換えた
  PR #11826 も、公開前に確認しないまま同じ「worker ごとに 1 回」という前提を主張して
  おり、数ファイルにまたがる `console.log` の回数を数えて初めてその前提が崩れ、
  最終的に出した説明が変わった。

## 手順書から移した仕組みの説明

手順書（`.claude/commands/flaky-ci-routine.md` と
`.claude/skills/detect-flaky-ci/SKILL.md`）には「何をするか」と「理由が 1 文ある」
ところまでを残し、**なぜそうなるのかという仕組みの説明はここに移した**。手順書側から
は見出し名で参照している。手順を書き換えようとする人は、先にここを読んでほしい。

### pause の順序と current-pause window

参照元: `flaky-ci-routine.md` の Shared constants →「Pause ordering」。

`investigate-flaky-test` が issue を止めるときは、①`flaky/needs-decision` ラベルを
付ける → ②署名付きの pause コメントを投稿する、の順で書き込む。ダッシュボード側は
この 2 つの書き込みを次のように読む。

- **Paused at** = `flaky/needs-decision` が付いた `labeled` イベントのうち最新のもの。
- 採用するコメントの範囲 = `[Paused at − 120 秒, ∞)`。つまり Paused at 以降か、
  その 2 分前までに投稿されたコメント。

ラベルを先に付けると、pause コメントの `created_at` は必ずこの範囲に入る。逆に
コメントを先に投稿すると、そのコメントは Paused at より前になるため範囲から外れ、
ダッシュボードは「範囲内に無い」と判断して検索を広げる経路に入る。広げた経路で
見つけた行には `(may be stale) ` を付ける決まりなので、**正しく止まった issue にだけ
この警告が付く**という、意味が逆さまの結果になる。

下限に 2 分の余裕を置いてあるのは、2 つの書き込みの間の時計のずれと、コメントを先に
投稿していた古い順序で止まった issue を拾うためである。どちらも実際には数秒の差しか
無く、2 分という幅は 1 つ前の pause 周期との間隔よりはるかに短いので、前の周期の
コメントを誤って拾うことはない。

### ジョブログの取得経路が 2 つある理由

参照元: `flaky-ci-routine.md` の Step 0 →「Job Log Fetch Method」。

`gh api --allow-escape-sequences "repos/.../actions/jobs/{JOB_ID}/logs"` は、
GitHub が署名付きの一時 URL を返し、そこへリダイレクトされる作りになっている。
転送先は `results-receiver.actions.githubusercontent.com` や
`*.blob.core.windows.net` という別ドメインで、cloud routine の egress proxy は
この転送先をブロックする。

ブロックしているのは**転送先のドメインに対するネットワーク方針**であって、要求の
形ではない（実測で確認した）。だから `gh` に別の聞き方をしても回避できない。
GitHub MCP サーバーの `mcp__github__get_job_logs` は同じ内容をサーバー側で取得して
返すので、この制限を受けない。取得できるかどうかは実行環境ごとに決まる性質なので、
ルーティンの最初に 1 回だけ判定し、以降は全ログで同じ方法を使う。

### reopen だけでは判断にならない

参照元: `flaky-ci-routine.md` の 4-C。

自動クローズを取り消したい人は issue を reopen する。しかしその issue は定義上まだ
stale なので、次回の実行がまた閉じてしまい、reopen が定着しない。そこで
「`### Auto-closed:` コメントより後の `reopened` イベントがあるなら閉じない」という
形にしてある。

`### Auto-closed:` コメントが無い issue をこの保護の対象から外しているのは、その
issue をこのステップが閉じたことが一度も無いからである。つまり人間が取り消した
ものが何も無く、今回の close が最初の close になる。`reopened` イベントだけを見て
判断すると、誤クリックとその取り消し（実例は上記の #11707、74 秒差）まで「追跡を
続けたいという意思表示」と読んでしまい、その issue は以後ずっと自動クローズの対象
から外れる。

なお `detect-flaky-ci` が再発を見つけて reopen する場合は
`### Additional observation` も一緒に投稿されるので、4-B の日付規則がその issue を
開いたままにする。さらにその経路の reopen は issue を `flaky/confirmed` にするため、
4-A（`flaky/observing` だけが対象）の時点で除外される。
