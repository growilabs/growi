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

## 未解決のまま残っている論点（今後の改善候補）

`brief.md` の Scope には含めていないが、この調査・実運用の過程で見つかった
ものの、まだ手を付けていない改善余地:

- `flaky/observing` のまま何日も2回目の観測が来なかった場合の自動クローズ
  ・タイムアウトの仕組みが無い（放置されたobservingが残り続ける）
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
