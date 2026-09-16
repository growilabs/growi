# Requirements Document

## Project Description (Input)

flaky-ci-script-extraction — 完了済み spec `ci-flaky-test-detection` の amend spec（spec-lifecycle ルール適用: 実装後に元 spec へ移し戻して自分を削除する）。

## Amend target

`.kiro/specs/ci-flaky-test-detection/`（design.md の File Structure Plan と Components（detect-flaky-ci / investigate-flaky-test / flaky-ci-routine の内部構成）、Testing Strategy）。要件 1〜11 の契約（利用者から見える振る舞い）は変えない。

## 誰が困っているか

GROWI のメンテナ（flaky-CI routine の運用者）と、その routine を無人で実行する cloud セッション（Sonnet、REST 専用 `gh`、MongoDB 無し）。

## 現状

flaky-CI の手順書 3 本（`.claude/commands/flaky-ci-routine.md`、`.claude/skills/detect-flaky-ci/SKILL.md`、`.claude/skills/investigate-flaky-test/SKILL.md`、合計約 4,300 行・227 KiB）は、無人の routine が毎回文字どおりに読む。判断のいらない機械的な処理（時間窓内の run 一覧、ログ取得後の FAIL ブロック抽出、識別キーの解析、`### Repro result` の SHA 一致読み取り、check-run の重複排除、ダッシュボードの表の描画と保留窓の計算、放置クローズの日数計算、ロックファイル×スタックトレースのパッケージ名抽出 など）まで散文＋シェル片で LLM に読ませているため、

1. 毎回のトークン費用が高い（調査が無い run でも約 39,000 トークン、調査ありで約 60,000）
2. シェル片の誤読や実行環境の差（zsh の `echo`、`head -1` の順序、`-m1` の挙動）による事故が起きる
3. 手順の機械的な部分を単体で検証できない

2026-09-15 の監査（`brief.md` に全文）では、3 本のうち実行シェル行は 12.5%、散文が 84%。文章整理（PR #11915、−19 KiB）は済んでおり、残る削減はスクリプト化でしか出ない。

## 変えること

判断を通らない処理だけを、各スキル配下の `scripts/` に「引数 → stdout（JSON/TSV）」の契約で切り出し、手順書は「このスクリプトを呼び、出力のこの欄を見て判断する」に縮める。ログ取得は cloud routine では MCP ツール呼び出し（シェルから叩けない）なので、「取得」と「解析」を割り、解析側だけ stdin を読むスクリプトにして両経路で共用する。判断は Markdown 側に残す。テスト先行。`flaky-repro.yml` の分割は最後の任意タスク。

### 範囲（監査の 14 候補）

まず上位 4 本: ①lockfile×スタックトレースのパッケージ名抽出、②`### Repro result` の SHA 一致読み取り（investigate に二重にある）、③放置クローズの日数計算、④判断待ち表と保留窓の計算。次に: 時間窓の run 一覧、check-run 待ちと同名重複の除去、「PR 自身の失敗」判定、識別キー分解、FAIL ブロック抽出（stdin）、Playwright 集計値（stdin）、Step 1.5 の issue 取得、PR ゲート条件 1・2、判定②③、表の描画。

## 制約

- cloud routine の環境: `gh` は REST のみ（GraphQL 遮断）、シェルは zsh の場合がある、`bats` / `shellcheck` は無い。スキルの `allowed-tools` は 3 本とも `Bash` を含む。
- 前例: `.claude/skills/suggest-path-evaluator/scripts/`（`.ts`）、`reusable-app-prod.yml` → `bash apps/app/bin/assemble-prod.sh`。
- スクリプトは判断を埋め込まない。research.md §4 に「固定スクリプトなら止まっていた環境差をモデルがその場で回避した」記録があるため、粘りと確実性の交換は判断を通らない部分に限る。
- 状態は GitHub issue/label/PR のみ（元 spec の原則）。既存の Requirement ID は変更せず、追加分は末尾に追記する。

---

## Introduction

本ドキュメントは、flaky-CI routine の手順書 3 本から「判断を通らない機械的な処理」を実行可能なスクリプトに切り出し、手順書を「スクリプトを呼び、その出力を見て判断する」形に縮めるための要件を定義する。目的は 3 つ — 無人実行 1 回あたりの読み込み量を減らすこと、シェル片の誤読や実行環境の差による事故を無くすこと、機械的な処理を単体で検証できるようにすること — であり、`ci-flaky-test-detection` の Requirement 1〜11 が定める利用者から見える振る舞い（何を検出し、どう issue を扱い、いつ PR を開くか）は一切変えない。

「判断」とは、同じ入力に対して読み手の解釈で結論が変わりうる箇所を指す。元 spec の research.md §5 が挙げた 3 点（クローズ済み issue を再オープンするか、Playwright の識別名が取れないときの 2 段構え、インフラノイズの除外一覧を広げるか）と、その後に増えた 4 点（修正の差分が見立ての範囲を超えていないか、巻き添え・連鎖をどの issue に畳むか、timeout を増やすだけの修正を止める歯止め、Playwright の精密／粗い識別の選択）が該当する。これらはスクリプトに移さない。

## Boundary Context

- **In scope**:
  - 手順書 3 本の中で判断を通らない処理を、引数と入力を受けて結果を出力するスクリプトに置き換えること（監査で挙げた 14 候補。優先順は brief.md の表のとおり）
  - 置き換えた箇所の手順書本文を「呼び出し・出力の読み方・判断」だけに縮めること
  - 各スクリプトに、実際の CI ログや API 応答を素材にした自動テストを付け、リポジトリの通常のテスト実行で検証されること
  - 元 spec `ci-flaky-test-detection` の design.md（File Structure Plan・Components・Testing Strategy）を現在の事実で書き直し、本 spec を削除すること（spec-lifecycle）
- **Out of scope**:
  - 上記「判断」7 点のスクリプト化
  - `ci-flaky-test-detection` の Requirement 1〜11 が定める振る舞いの変更
  - 手順書の文章整理（PR #11915 で済み）
  - `flaky-repro.yml` の分割は必須ではない（Requirement 6 の Where 条件として任意）
- **Adjacent expectations**:
  - routine は cloud セッションとメンテナの手元（devcontainer）の両方から実行される。スクリプトは両方で同じ結果を返す
  - cloud セッションではジョブログの取得がシェルからではなくツール呼び出しで行われる。ログを解析するスクリプトは取得手段に依存しない
  - GitHub への書き込み（issue・ラベル・コメント・PR）は引き続き手順書の明示的な手順として行われ、スクリプトは行わない

## Requirements

### Requirement 1: 機械的な処理のスクリプトへの置き換え

**Objective:** As a flaky-CI routine の運用者, I want 判断を通らない処理が手順書の散文ではなくスクリプトとして存在すること, so that 無人実行のたびに同じ処理が同じ結果を返し、読み込み量と誤読の余地が減る

#### Acceptance Criteria

1. When 監査で挙げた候補のうち採用された処理が実行される場合, the flaky-ci-routine shall その処理をスクリプトの呼び出しで行い、手順書の本文には呼び出し方・出力の各欄の意味・出力を受けての判断だけを残す。
2. The flaky-ci-routine shall スクリプトに置き換えた処理の手順を手順書の本文に重複して記述しない（処理の定義はスクリプトだけが持つ）。
3. When 置き換え前の手順が特定の入力に対して返していた結果（識別キー、集計値、日時、一致・不一致）がある場合, the flaky-ci-routine shall 置き換え後のスクリプトが同じ入力に対して同じ結果を返す。
4. When 置き換えによって不要になった誤読防止の注意書き（シェルの挙動差に関する注記など）がある場合, the flaky-ci-routine shall その注意書きを手順書から削除する。
5. The flaky-ci-routine shall 置き換えの前後で `ci-flaky-test-detection` の Requirement 1〜11 の受け入れ条件を同じように満たす。

### Requirement 2: 判断と書き込みは手順書に残す

**Objective:** As a GROWI のメンテナ, I want スクリプトが「事実」だけを返し、結論と GitHub への書き込みは手順書側の明示的な手順として残ること, so that 自動化の結論がどの判断から出たかを手順書だけ読めば追え、スクリプトの不具合が黙って issue や PR を変えることがない

#### Acceptance Criteria

1. The flaky-ci-routine shall スクリプトの出力を「観測された事実」（一覧・件数・日時・一致の有無とその根拠）に限り、確信度の段階付け・issue を閉じる／開く・PR を開くといった結論をスクリプトの出力に含めない。
2. The flaky-ci-routine shall issue・ラベル・コメント・PR への書き込みをスクリプトから行わず、手順書に書かれた明示的な手順として行う。
3. The flaky-ci-routine shall Introduction に挙げた 7 つの判断を手順書の本文に残し、スクリプトに移さない。
4. When スクリプトの出力が判断の材料として手順書に読み込まれる場合, the flaky-ci-routine shall どの出力欄をどの判断に使うかを手順書に明記する。

### Requirement 3: 両方の実行環境で同じ結果を返す

**Objective:** As a flaky-CI routine の運用者, I want スクリプトが cloud セッションとメンテナの手元の両方で同じ結果を返すこと, so that 無人実行の結果を手元で再現・検証できる

#### Acceptance Criteria

1. The flaky-ci-routine shall 各スクリプトを、cloud セッション（GitHub への読み取りは REST のみ、呼び出し元のシェルの種類は固定されない、データベースやブラウザは無い）とメンテナの手元の両方で追加の準備なしに実行できるようにする。
2. When ジョブログを解析するスクリプトが実行される場合, the flaky-ci-routine shall ログの本文を入力として受け取り、ログの取得手段（シェルからの取得かツール呼び出しか）に依存しない。
3. If スクリプトが前提を満たせずに処理を完了できない場合（入力が読めない、GitHub からの応答が得られない、期待した形式でない）, the flaky-ci-routine shall スクリプトを失敗として終了させ、その理由を出力し、空の結果や 0 件を成功として返さない。
4. When スクリプトが失敗した場合, the flaky-ci-routine shall その処理を「測定・取得できなかった」として手順書の既存の扱い（人の判断待ち、または実行サマリーでの明示）に回し、手順書の中でその処理を即興で書き直して続行しない。
5. The flaky-ci-routine shall スクリプトが必要とする実行手段（言語ランタイムなど）が両環境に既に存在することを、実装時に実測して記録する。

### Requirement 4: 自動テストによる検証

**Objective:** As a GROWI のメンテナ, I want 各スクリプトに実データを素材にした自動テストがあり、リポジトリの通常のテスト実行で検証されること, so that 手順書の変更では検知できなかった契約の崩れがテストで見つかる

#### Acceptance Criteria

1. The flaky-ci-routine shall 各スクリプトについて、実際の CI ログの抜粋や GitHub API 応答の記録を素材にした自動テストを持ち、期待する出力（識別キー、集計値、日時、一致の根拠）を検証する。
2. When リポジトリの通常のテスト実行が行われる場合, the flaky-ci-routine shall これらのテストも実行し、スクリプトの契約が崩れたときに失敗する。
3. When 監査や実運用で見つかった誤読・事故の事例（同一ミリ秒比較、別 attempt のログの取り違え、`head -1` の順序、空値の展開など）がスクリプトの責務に含まれる場合, the flaky-ci-routine shall その事例を再現する入力をテストに含める。
4. The flaky-ci-routine shall 各スクリプトの入力と出力の契約（引数、入力の形、出力の各欄）をスクリプトの近くに文書化し、手順書はそれを参照する。

### Requirement 5: 段階的な導入と、導入中も routine が止まらないこと

**Objective:** As a flaky-CI routine の運用者, I want スクリプトが 1 本ずつ導入され、どの時点でも routine が一貫した手順で動くこと, so that 導入の途中で無人実行が壊れたり、半分だけ置き換わった手順を読むことがない

#### Acceptance Criteria

1. When スクリプト 1 本の導入が完了する場合, the flaky-ci-routine shall そのスクリプトが担う処理の手順書本文を同時に置き換え、同じ処理の旧手順と新手順が同時に存在する状態を残さない。
2. The flaky-ci-routine shall 監査の優先順（まず上位 4 本）で導入し、各導入の前後で手順書の行数・容量の変化を記録する。
3. When 全候補の導入が完了する場合, the flaky-ci-routine shall 毎回読まれる 2 本（routine コマンドと detect-flaky-ci）の合計容量が導入前より減っていることを記録し、減っていない候補があればその理由を記録する。
4. The flaky-ci-routine shall 導入したスクリプトの一覧と、手順書のどの箇所がそれを呼ぶかを、元 spec の design.md に現在の事実として記述する。

### Requirement 6: 測定用ワークフローの内部スクリプトの分割（任意）

**Objective:** As a GROWI のメンテナ, I want `flaky-repro.yml` の長い実行部分を単体で構文検査・テストできること, so that ワークフローの変更を CI 実行なしに確かめられる

#### Acceptance Criteria

1. Where ワークフローの実行部分が独立したスクリプトに分割される場合, the flaky-repro workflow shall 分割の前後で同じ trailer の契約を受け付け、同じ `### Repro result` コメントを投稿する。
2. Where 分割される場合, the flaky-repro workflow shall 分割したスクリプトを、リポジトリの通常のテスト実行または lint 実行で構文検査できるようにする。
3. The flaky-repro workflow shall 分割の有無にかかわらず、依頼を含む push 先のブランチにワークフロー本体と分割したスクリプトの両方が存在することだけを前提とする。
