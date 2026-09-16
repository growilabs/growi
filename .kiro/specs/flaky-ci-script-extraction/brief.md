# Brief: flaky-ci-script-extraction

## Problem

flaky-CI の手順書 3 本（`.claude/commands/flaky-ci-routine.md`、`.claude/skills/detect-flaky-ci/SKILL.md`、`.claude/skills/investigate-flaky-test/SKILL.md`、合計約 4,300 行・227 KiB）は、無人の cloud routine（Sonnet、REST 専用 `gh`、MongoDB 無し）が毎回文字どおりに読む。判断のいらない機械的な処理（時間窓の run 一覧、ログの取得後の FAIL ブロック抽出、識別キーの解析、`### Repro result` の SHA 一致読み取り、check-run の重複排除、ダッシュボードの表の描画と保留窓の計算、放置クローズの日数計算、ロックファイル×スタックトレースのパッケージ名抽出 など）まで散文＋シェル片で LLM に読ませているため、(1) 毎回のトークン費用が高い、(2) シェル片の誤読・環境差（zsh の echo、`head -1` の順序、`-m1` の挙動）による事故が起きる、(3) 単体で検証できない。文章整理（PR #11915、−19 KiB）は済んでおり、残る削減はスクリプト化でしか出ない。

## Approach

判断を通らない処理だけを、各スキル配下の `scripts/`（例 `.claude/skills/detect-flaky-ci/scripts/`、`.claude/commands/scripts/`）に「引数 → stdout（JSON/TSV）」の契約で切り出し、手順書は「このスクリプトを呼び、出力のこの欄を見て判断する」に縮める。ログ取得は cloud routine では MCP ツール呼び出し（シェルから叩けない）なので、「取得」と「解析」を割り、解析側だけ stdin を読むスクリプトにして両経路で共用する。判断（research.md §5 の 3 点＝closed issue の再オープン可否・Playwright 識別の 2 段構え・denylist の拡張、および 6-B 条件 3・巻き添えの畳み先・timeout 増し止めの歯止め・Playwright の段位選択）は Markdown 側に残す。テスト先行（文字列処理は `.ts` + vitest、`gh` を叩く薄い `.sh` は `bash -n` + 応答フィクスチャ）。`flaky-repro.yml` の `run:` 442 行の `.github/scripts/flaky-repro/` への分割は最後（トークンには効かず、価値はテスト容易性のみ）。

## Scope

- In: 監査で挙げた 14 候補のうち、まず上位 4 本（①lockfile×スタックトレースのパッケージ名抽出、②`### Repro result` の SHA 一致読み取り、③放置クローズの日数計算、④判断待ち表と保留窓の計算）。次に run 一覧・check-run 待ち・PR 自身の失敗判定・識別キー分解・FAIL ブロック抽出・Playwright 集計値・Step 1.5 の issue 取得・PR ゲート条件 1/2・②③判定・表の描画。
- Out: 判断点のスクリプト化、`flaky-repro.yml` の分割（最後の任意タスク）、手順書の文章整理（済み）。

## Constraints

- これは完了済み spec `ci-flaky-test-detection` の amend spec（design の File Structure Plan / Components の契約を変える）。spec-lifecycle ルールにより、実装後に元 spec へ移し戻して自己削除する。
- cloud routine の環境: `gh` は REST のみ（GraphQL 遮断）、シェルは zsh の場合がある（スクリプトは `#!/usr/bin/env bash`）、`bats`/`shellcheck` は無い、`pnpm tsx` の有無は要確認（無ければ `.sh` に寄せる）。スキルの `allowed-tools` は 3 本とも `Bash` を含むので変更不要。
- 前例: `.claude/skills/suggest-path-evaluator/scripts/`（`.ts`）、`reusable-app-prod.yml` → `bash apps/app/bin/assemble-prod.sh`。
- スクリプトは判断を埋め込まない。research.md §4 に記録された「固定スクリプトなら止まっていた環境差をモデルがその場で回避した」事例があるため、粘りと確実性の交換は判断を通らない部分に限る。

---

以下は 2026-09-15 の監査報告（Opus、読み取り専用）の全文。

# flaky-CI 一式の肥大化について（読み取り専用の調査結果）

対象: `feat/flaky-ci-closed-loop` / PR #11915。ファイルは一切変更していない。

## 0. 先に結論

**「大きすぎる」という指摘は正しい。ただし「スクリプトに出せば直る」は当たらない。**
3 つの Markdown 合計 246,355 バイト（約 240 KiB）のうち、シェルで実行する行は
**12.5%** しかない。残りの約 84% は散文（ルール・理由・実例）である。
スクリプト化で減らせる量より、文章を整理して減らせる量のほうが**約 3 倍大きい**。

もう 1 つ。`flaky-repro.yml` は毎回の prompt には入らない（cron で動く routine が読むのは
Markdown 3 本だけ）。だから YAML からシェルを出しても**実行コストは 1 バイトも下がらない**。
出す理由があるとすれば、テストしやすさと読みやすさだけ。これは別の話として扱う。

**公平のために 2 点。** ①3 本が毎回読まれるわけではない。routine（61 KiB）と detect（97 KiB）
は毎回だが、investigate（88 KiB＝全体の 36%）は Step 3 でしか読まれず、選択 A・B が両方空の
「静かな run」では Step 3 ごと飛ばされる。つまり実際の 1 回あたりは**仕事が無ければ約 158 KiB
（約 39,000 トークン）、調査がある時だけ約 60,000** である。②master からの増加
（310→1148 / 911→1812）の大半は**機能が増えたから**で、閉ループ化（Requirement 6〜11）の
自動クローズ・ダッシュボード・保留窓は master には存在しなかった。削れるのは §4 の約 54 KiB
であって、増加そのものではない。

## 1. 構成の実測

### 測り方

`awk` の状態機械で 1 行ずつ分類した（`scratchpad/{classify,bytes}.awk`）。
①インデントされた ``` も含めて囲みを検出する（3 ファイルとも開閉数が一致し入れ子は無い）。
②囲みの中では `<<EOF` 形式のヒアドキュメント（コマンドに文章を流し込む書き方）の中身を
「雛形」として実行行と分ける — これをやらないと issue 本文の雛形が実行コードに化けて
数字が 2 倍近く狂う。③囲みの外の散文は**段落単位**で分け、issue 番号や「measured case」
を含む段落を「実例」、`because` / `deliberate` 等を含む段落を「理由」、残りを「ルール」とした。

### 結果（行数 / バイト数）

| ファイル | 合計行 | 実行行 | 雛形 | 囲み記号 | 見出し | ルール | 理由 | 実例 | 空行 |
|---|---|---|---|---|---|---|---|---|---|
| flaky-ci-routine.md | 1148 | 104 | 10 | 64 | 26 | 278 | 379 | 112 | 175 |
| detect-flaky-ci | 1812 | 198 | 55 | 84 | 29 | 660 | 295 | 238 | 253 |
| investigate-flaky-test | 1643 | 246 | 43 | 64 | 32 | 483 | 385 | 154 | 236 |
| **バイト合計** | 246,355 | **30,780** | 3,569 | 1,260 | 3,676 | **98,083** | **73,063** | **35,260** | 664 |
| **割合** | 100% | 12.5% | 1.4% | 0.5% | 1.5% | 39.8% | 29.7% | 14.3% | 0.3% |

`flaky-repro.yml` 567 行の内訳（`run: |` の中身を別に数えた）:
**`run:` ブロック 397 行（実行 255 / コメント 106 / 空行 36）、YAML 本体 164 行（設定 77 /
コメント 76 / 空行 11）**。依頼文の 442 行は `run:` 以外の YAML 行も混ざった数と思われる。

### (e) 他ファイルの言い直し — ほぼ 0

正規化（小文字化・記号除去）した行で 2 ファイル以上に出るものは **6 行だけ**。これは欠陥では
なく**設計が効いている証拠**で、3 ファイルは「定義は 1 か所、他はそこを指す」
（"follow that, do not restate it"）を実際に守っている。つまりこの一式は**重複して長い**のでは
なく**単に長い**。直し方が変わる重要な点。

ただし**同じ理屈を別の言葉で書き直した箇所**は多い（出現行数、routine / detect / investigate）:
`--paginate` が 1 ページずつ効く話 22 / 10 / 9、REST を使う理由 1 / 10 / 8、
時刻を文字列比較してよい理由 10 / 1 / 0、最終段落だけが trailer になる話 0 / 0 / 9（YAML に 5）。

## 2. スクリプトに出す候補（価値の高い順）

判定の物差しは「bash かどうか」ではなく、**途中の値がモデルの判断を通るかどうか**。
通らないものだけが出せる。順位は「消える文章の量」＋「防げる事故」で付けた。

| # | 置き換える箇所 | スクリプト案 | 入出力 | 減る行 | モデルに残す判断 |
|---|---|---|---|---|---|
| 1 | detect ①のロックファイル/スタックトレースからのパッケージ名抽出（L141–266） | `.claude/skills/detect-flaky-ci/scripts/lockfile-overlap.ts` | 引数: patch ファイル + ログ抜粋 → stdout に JSON `{overlap:[名前],versions:{}}` | 約 55 | 無し。①を発火させるかの最終判定だけ残る |
| 2 | investigate の `### Repro result` 読み取り（2-D と 6-A に**二重**にある） | `.claude/skills/investigate-flaky-test/scripts/read-repro-result.sh` | 引数: issue 番号 + SHA → stdout に TSV `runs/failed/per_run/run_url`、無ければ空 | 約 45 | 無し（2-E の判定表は残す） |
| 3 | routine 4-B/4-E の放置クローズ計算 | `.claude/commands/scripts/newest-observation.sh` | 引数: issue 番号 → stdout に ISO 日時。読めなければ終了コード 2 | 約 40 | 「読めなかったら閉じない」は残す |
| 4 | routine Step 5 の判断待ち表・保留窓の計算（L929–1050） | `.claude/commands/scripts/awaiting-decision-rows.sh` | 引数: issue 番号 → TSV `paused_at/recommendation/stale_flag/new_obs` | 約 35 | 無し |
| 5 | detect Step 1 の窓・run 一覧（L505–547） | `.claude/skills/detect-flaky-ci/scripts/list-candidate-runs.sh` | 引数: `--window-hours --max-runs` → stdout に JSONL | 約 45 | 打ち切りを報告する義務は残す |
| 6 | investigate 6-A の check-run 待ち・同名重複の除去 | `.../scripts/wait-for-checks.sh` | 引数: SHA + `--playwright` → 終了コードと JSON | 約 50 | 無し |
| 7 | detect「PR 自身の失敗」判定（祖先確認 + PR 一覧 + パス後方一致、L1211–1300） | `.../scripts/pr-owns-failure.sh` | 引数: SHA + spec パス → `exclude/keep` + 理由 | 約 55 | エラー時に除外しない方針は残す |
| 8 | investigate Step 1 の識別キー分解（L309–338） | `.../scripts/parse-identity-key.ts` | 引数: title → JSON `{kind,browser,spec,title}` | 約 25 | `playwright:{browser}` だけの時の扱い |
| 9 | detect Step 2 の ANSI 除去と FAIL ブロック切り出し | `.../scripts/extract-fail-blocks.sh`（**標準入力から読む**） | stdin: ジョブログ → stdout に JSONL | 約 30 | 無し |
| 10 | Playwright の段位判定の材料（注釈の個数と集計行の数字） | `.../scripts/playwright-shard-facts.sh`（stdin） | stdin: ログ → JSON `{annotations,flaky,failed}` | 約 20 | 段位 1/2 の**選択そのもの**は残す |
| 11 | detect Step 1.5 の既存 issue 取得とスキップ集合 | `.../scripts/fetch-flaky-issues.sh` | 無し → JSON（issue 一覧 + run URL 集合） | 約 20 | 無し |
| 12 | investigate 6-B の PR ゲート条件 1・2 | `.../scripts/pr-gate-facts.sh` | 引数: SHA → `cond1/cond2` の可否と根拠 | 約 25 | **条件 3（差分の範囲）は判断なので残す** |
| 13 | detect ②（挟み込み）と③（matrix の食い違い）の判定（L268–287） | `.../scripts/mining-2-3.sh` | 引数: run 一覧 JSONL + 識別キー → `hit/miss` + 根拠 | 約 20 | 無し。tier をどう付けるかは残る |
| 14 | routine Step 5 の表の組み立て | `.../scripts/render-dashboard.sh` | 引数: issue 一覧 JSON → Markdown | 約 45 | 65536 字を超えた時の切り詰め方針 |

#13 を入れると research.md §5 が示した分割線（「①〜④の機械的な判定・Step1.5 のスキップ
リスト・時間窓計算はスクリプト側へ」）をちょうど覆う。⑤（setup hook の遅さ比較）は #9 と
同じ割り方で、比較する側の run のログ取得は下の制約に当たり、差分の計算だけ出せる。
#14 は描画だけが移り、2 つの決まり文句（`No active flaky tests right now.` /
`No issues are waiting for a human decision.`）と 65536 字の規則と「両方の節を落とすな」は
Markdown 側に残るので、80 行ではなく約 45 行が実際のところ。

**#9 には制約がある。** ログ取得そのものは出せない。cloud routine が使う経路は
`mcp__github__get_job_logs(...)` という**ツール呼び出し**で書かれていて、シェルから叩けない
（`gh` 経路だけがシェル）。だから「取得」と「解析」を割って、解析側だけを標準入力を読む
スクリプトにする。こうすれば両方の経路で同じスクリプトが使える。

### flaky-repro.yml を `.github/scripts/` に出すか

**出してよい。ただし急ぎではない。** 根拠と注意点:

- GitHub 自身が長い `run:` の外出しを勧めており、前例もある
  （`reusable-app-prod.yml` が `bash apps/app/bin/assemble-prod.sh` を呼ぶ）。
- 今は `bash -n`（文法確認）すら回せない。出せば CI でも手元でも回せる。
- 分割案: `.github/scripts/flaky-repro/parse-request.sh`（trailer の読み取りと検証、
  現在 L45–189 の 145 行）、`run-repro.sh`（N 回回して集計、L337–507 の 171 行）、
  `render-result.sh`（結果の整形）。
- **prompt のトークンは 1 バイトも減らない。**効くのはテストのしやすさだけ。
- ワークフロー本体が push 済みブランチ上に必要な点はスクリプトを分けても変わらない
  （`actions/checkout` 後に同じ木から読む）ので支障は無い。

## 3. 出してはいけないもの

**残す基準: その 1 文を消すと、文字通り読む読み手の動きが変わるなら、それはルールである。**

- **research.md §5 が挙げた 3 つの判断** — 今も有効。①closed issue を再オープンするか
  （#11711 は再発証拠が修正マージ前のコミット由来だったので再オープンしなかった）、
  ②Playwright の識別名が取れない時の 2 段構え、③infra noise の除外リストを広げる判断。
- **§5 以降に増えた判断** — 6-B 条件 3（差分が Step 3 の見立てを超えていないか）、
  巻き添え/連鎖をどの issue に畳むか、timeout を増やすだけの修正を止める歯止め、
  共有 setup hook かどうかをスタックフレームで見分けるところ。
- **毎回変わるもの** — 窓の中に何が入るか、どの tier に落ちるか、報告の文面。
- **誤読を防ぐための文** — 「`[ ]` の中の `>` はリダイレクトになる」「空の `PAUSED_AT` に
  `date -d` を渡すと今から 120 秒前が返って成功してしまう」「`==` に単純化するな」など。
  ただし**スクリプトに出した箇所は注意書きごと消える**（中で事故が起きなくなる）。
  これが #1〜#4 を上位に置いた理由。

**反対材料。** research.md §4 に、実行中にモデルが環境由来の不具合 2 件をその場で回避して
処理を続けた記録がある（「固定スクリプトなら止まって終わっていた」）。スクリプト化はこの
粘りを確実性と引き換えにするので、判断を通らない部分だけに絞る。

## 4. 文章の削減

こちらが本命。**目標は約 54 KB（全体の 22%）。**
削る順は **routine と detect を先に**。この 2 本は毎回読まれるので、1 KiB 削るたびに毎回
返ってくる。investigate の分（最大の塊である L961–1084 を含む）は効きが薄いので後回しでよい。

| 対象 | 場所 | 減る量 | やり方 |
|---|---|---|---|
| 実例・事故の語り | 全体（実例 35.3 KB） | 約 25 KB | research.md へ移し、本文には**理由を 1 節だけ**残す |
| 同じ理屈の書き直し | `--paginate` が 1 ページずつ効く話、REST を使う理由、時刻の文字列比較、trailer の最終段落 | 約 12 KB | routine の **Shared constants** に「読み取りの約束事」を足し、他は 1 行で指す（既にこの書き方をしている箇所がある） |
| 言い換えの重複 | detect L96–140（①〜⑤を全部評価せよ、を 4 回言い直している）、L1171–1190、routine L767–801 | 約 8 KB | 1 回言って表にする |
| 廃止済みの手順の説明 | investigate L1248–1255（`gh pr create --draft` 時代の説明）、L1553–1568 | 約 3 KB | research.md の決定記録へ |
| 長い理由づけの圧縮 | 理由 73 KB のうち | 約 6 KB | 段落を 1〜2 文に詰める |

具体例: detect L188–240（パッケージ名の取り出し方 2 表 + 規則）は #1 で丸ごと消える。
detect L390–406（#11707 の 2 run を巡る 17 行の語り）→「両方のふるいを通す」1 文 + research.md。
detect L1194–1202（#11864 / #11799 の由来）→ 1 文。
investigate L961–1084（timeout を増やすだけの修正の歯止め、124 行）→ ルールは残し
#11824 / #11826 / #11718 の顛末 約 35 行を research.md へ。
routine L652–675（`Fixed by` 行を書いてはいけない理由、24 行）→ 8 行。

注意: 「理由」73 KB は**削れる上限**であって見込みではない。分類は `because` 等の語で
機械的に拾っているので、ルールの文にも当たっている。

## 5. 手直しのリスクと費用

- **テスト手段**: `bats` も `shellcheck` もこの devcontainer に入っていない。文字列を扱う
  だけのもの（#1 #8 #10）は **`.ts` + 隣に `*.spec.ts`（vitest）** がこのリポジトリの作法に合う
  （`.claude/skills/suggest-path-evaluator/scripts/` に `.ts` を置く前例あり）。`gh` を叩くもの
  （#2 #3 #5 #6 #11）は薄い `.sh` にして `bash -n` と応答の見本で確かめる程度が限界。
- **zsh か bash か**: 先頭に `#!/usr/bin/env bash` を書けば呼び出し元が zsh でも中は bash で動く。
  detect L533–540 の「zsh の `echo` が `\n` を展開して jq が壊れる」注意書きはこれで不要になる。
- **ツールの許可設定**: `detect-flaky-ci` は `allowed-tools: Bash, Read, Grep`、
  `investigate-flaky-test` は `Bash` を含むので**変更不要**。`.ts` を使う場合だけ
  `pnpm tsx` が routine の環境にあるか確認が要る（無ければ `.sh` に寄せる）。
- **見込み（3 ファイル合計）**

| | 行 | バイト | 毎回のトークン概算 |
|---|---|---|---|
| 今 | 4,603 | 246 KiB | 約 60,000 |
| 文章の整理だけ | 約 3,600 | 約 192 KiB | 約 47,000 |
| ＋スクリプト化（#1〜#12） | 約 3,150 | 約 174 KiB | 約 42,500 |

スクリプト化の正味は約 18 KiB にとどまる。呼び出し行と入出力の説明を書き足す分が戻るため。

## 6. 進め方

- **PR #11915 は今のまま出す。** 検証 GO 済みで、amend spec も畳み終わっている。
  `flaky-repro.yml` は測定中の依頼が push 済みブランチ上のファイルに依存するので、
  マージ前に触らない。
- **マージ前にやるなら文章だけ**（§4）。振る舞いが変わらないので差分を読んで確かめられる。
  実例を research.md へ移し、本文には理由を 1 節残す。**毎回読まれる routine と detect から**。
- **スクリプト化は別の spec を立てて後続で。** 先にテストを書いて赤→緑で進める
  （このリポジトリの決まり）。最初は #1〜#4 だけ — 文字列処理が主で、決定的で、
  注意書きごと消える 4 本。
- **`flaky-repro.yml` の分割は最後**。実行コストには効かないので、`.github/scripts/` を
  作るのは他が落ち着いてからでよい。
- **やめどきを決めておく**。1 回の実行で判断を通らない処理だけを出す。research.md §5 の
  3 つ（＋その後増えた判断）に手を出し始めたら、それは行き過ぎ。
