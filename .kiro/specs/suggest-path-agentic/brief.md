# Brief: suggest-path-agentic

## Problem

suggest-path API（AI クライアント向けページ保存先提案）のパス提案精度が、ワンショット検索構成の構造的限界に当たっている。一発のキーワード抽出 + ES 全文検索 1 回では、語彙ミスマッチ（例: 内容は「自動スクロール」だが正解ページ名は「アンカーによるページのScroll」）を回復する手段がなく、最初の検索が外れるとそのまま失敗する。

一方、ドッグフーディングで「クライアント側 LLM（Claude 等）が search API を自律的に掘り直すと妥当なパスに辿り着く」ことが実証済み。この agentic search 的挙動を suggest-path 本体に取り込めば、クライアント側の肩代わりを減らし、API 単体で妥当な候補に辿り着ける。

- Redmine ストーリー: #184610「[MCP] suggest-path が agentic search 的動作をすることができる」

## Current State

- 現行 suggest-path（`apps/app/src/features/ai-tools/suggest-path/`）は「analyzeContent（LLM でキーワード抽出 + フロー/ストック判定）→ retrieveSearchCandidates（ES 検索 1 回）→ evaluateCandidates（LLM 候補評価）」のワンショットパイプライン。OpenAI 直叩きでモデルは gpt-4.1-nano ハードコード
- #183968 で評価環境が構築済み: dev.growi.org データをローカル GROWI にインポートし、6 usecases × 10 runs で正解親配下出現率を測定。改修後ベースラインは 41/60
- 既知の弱点: auto-scroll ケース 0/10（語彙ミスマッチで ES top20 圏外）、culling（スコア閾値 + LLM 評価）側の取りこぼし
- support/mastra ブランチに Mastra 基盤が実装済み: `growiAgent`（チャット用）、`fullTextSearchTool`（検索演算子 prefix:/tag:/-除外/sort 対応）、`getPageContentTool`（outline + 行ベース pagination）。agentic-search spec はサブタスク 15/15 完了で実質 implementation-complete

## Desired Outcome

- suggest-path が本体内で複数回の検索を試行錯誤し（検索結果を元文書と照らして検索語・条件を変えながら探索）、API 単体で妥当な保存先候補に辿り着く
- #183968 の評価環境で、トップN命中率がベースライン 41/60 から向上する（特に語彙ミスマッチ起因の全滅ケース）
- レスポンス時間が許容範囲に収まる（検索回数上限 3〜5 回で速度と精度のトレードオフを制御。上限値は別途合意）
- 文書のフロー/ストック判定が検索の誘導に反映される

## Approach

suggest-path のエンジンを Mastra エージェントに換装する（新規 spec として実施）:

- suggest-path 専用 Agent を `mastra-modules/agents/` に新設（チャット用 `growiAgent` とは別定義）。既存の `fullTextSearchTool` / `getPageContentTool` を tools として再利用
- Agent の structured output で既存レスポンス型（suggest-path-types.ts）準拠の提案を返す
- 新旧エンジンは切り替え式で並存させ、同一評価環境で A/B 測定する
- API 層（ルート・バリデーション・grant 解決・memo フォールバック）は現行のまま維持し、`generate-suggestions` のエンジン部分のみ差し替える

**新規 spec とした理由**（discovery 判定: Path C）: 既存 suggest-path spec は implementation-complete + cleanup 済みの閉じた記録であり、今回は design 中核（3 段パイプライン）の全面置換で extension の域を超える。検証主導の仕事のため、結果が悪ければ捨てられる独立境界が望ましい。レビュアー（yuki）と合意した「ガラッと変わるなら新規」の条件に該当。

## Scope

- **In**:
  - suggest-path 専用 Mastra Agent の新設（instructions にフロー/ストック判定と検索誘導、提案ルールを記述）
  - `generate-suggestions` のエンジン分岐（現行ワンショット / agentic の切り替え式並存）
  - 検索回数（step 数）上限の制御
  - #183968 評価環境での A/B 測定（6 usecases × 10 runs、ベースライン 41/60 との比較）
- **Out**:
  - HTC によるリランク（別ストーリー）
  - セマンティック検索の導入
  - クライアント側（MCP クライアント）の挙動変更
  - チャット UI / growiAgent の改修
  - 現行ワンショットエンジンの削除（検証結果を見て別途判断）

## Boundary Candidates

- Agent 定義（instructions / tools / structured output schema）と API 層（ルート・型・grant）の縫い目 — Agent は「提案の生成」だけを所有し、API 契約は既存のまま
- 新旧エンジンの切り替え機構（リクエストパラメータ or config）
- 評価・検証ワークフロー（評価は spec の受け入れ条件、評価環境自体は #183968 の成果物を利用）

## Out of Boundary

- チャット向け `growiAgent` の挙動（agentic-search spec が所有）
- `fullTextSearchTool` / `getPageContentTool` の機能改修（必要が生じた場合は agentic-search 側のフォローアップとして扱う）
- 既存 suggest-path spec の記録の書き換え（完成時に後継ポインタの追記のみ検討）

## Upstream / Downstream

- **Upstream**:
  - agentic-search spec（fullTextSearchTool / getPageContentTool / RequestContext 伝搬パターン）
  - suggest-path spec（API 契約: エンドポイント、レスポンス型、trailing-slash パス規約、grant 制約、memo フォールバック、Client LLM Independence）
  - support/mastra ブランチ（Mastra 基盤。master 未マージのため本 spec のブランチはここから派生）
  - #183964 / #183967 / #183968（評価器・代表ユースケース・ベースライン 41/60）
- **Downstream**:
  - #184975（ユースケース規模拡大による命中率測定）
  - HTC リランク別ストーリー
  - GROWI MCP の suggestPath ツール利用クライアント

## Existing Spec Touchpoints

- **Extends**: なし（新規境界）。完成時に suggest-path spec へ「エンジンは suggest-path-agentic で換装された」旨の後継ポインタ追記を検討
- **Adjacent**: suggest-path（API 契約を維持・参照）、agentic-search（tools とコンテキスト伝搬パターンを共有。境界はチャット vs パス提案で分離）

## Constraints

- support/mastra ブランチ派生で開発する（Mastra 基盤が master 未マージのため）。support/mastra は将来 master にマージ予定
- API 契約の後方互換を維持（レスポンス型、trailing-slash 親パス規約、grant、memo フォールバック保証）
- モデルは config（`configManager`）から取得する方式に揃える（現行のハードコードを踏襲しない）
- レスポンス時間の上限値は別途合意（Redmine #184610 受け入れ条件）。検索回数上限で制御
- 検証は #183968 構築のローカル評価環境（devcontainer + dev wiki インポートデータ）を使用。環境は fragile（mongo 匿名ボリューム・ES プラグイン設定）のため再構築手順に注意
- Redmine #184610 の受け入れ条件（命中率向上・レスポンス時間・フロー/ストック誘導）に準拠

### Mastra 技術的注意点（viability check 済み: @mastra/core 1.41.0、showstopper なし）

- tool use ループ + structured output の併用は `Agent.generate()` / `Agent.stream()` で可能（`structuredOutput` + `maxSteps`（デフォルト 5）+ `stopWhen`）
- **`generateVNext` は使わない**: tool 呼び出し後に structured output が生成されない既知バグ（mastra-ai/mastra#7662）
- **structured output の schema は JSON Schema を直接記述する**: Zod からの自動変換は OpenAI strict mode 非互換の既知バグあり（mastra-ai/mastra#16383）
- structured output 使用時に tools が外れる報告（mastra-ai/mastra#3139）があるため、設計時に tool 呼び出しと最終出力の両立を実機確認すること
- 対象モデルは OpenAI 系に限定（Gemini 2.5 は tool + structured output 同時不可）
