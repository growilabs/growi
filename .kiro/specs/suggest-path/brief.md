# Brief: suggest-path

> 本ファイルは discovery 時点の記録である。以降の内容は策定当時の理解・提案であり、design.md / requirements.md の記述と相違がある場合はそちらを優先する。
>
> この brief は、現行の agentic search エンジンへの換装（旧 suggest-path-agentic spec、PR #11293）の discovery 記録であり、suggest-path 機能そのものの初出（Phase 1 MVP・Phase 2 ワンショット構成、2026-02〜）の discovery ではない（brief.md の運用が導入される前の実装のため記録が残っていない）。

## Problem

suggest-path API（AI クライアント向けページ保存先提案）のパス提案精度が、ワンショット検索構成の構造的限界に当たっている。一発のキーワード抽出 + ES 全文検索 1 回では、語彙ミスマッチ（例: 内容は「自動スクロール」だが正解ページ名は「アンカーによるページのScroll」）を回復する手段がなく、最初の検索が外れるとそのまま失敗する。

一方、ドッグフーディングで「クライアント側 LLM（Claude 等）が search API を自律的に掘り直すと妥当なパスに辿り着く」ことが実証済み。この agentic search 的挙動を suggest-path 本体に取り込めば、クライアント側の肩代わりを減らし、API 単体で妥当な候補に辿り着ける。

- Redmine ストーリー: #184610「[MCP] suggest-path が agentic search 的動作をすることができる」

## Current State（discovery 時点）

- 当時の suggest-path（`apps/app/src/features/ai-tools/suggest-path/`）は「analyzeContent（LLM でキーワード抽出 + フロー/ストック判定）→ retrieveSearchCandidates（ES 検索 1 回）→ evaluateCandidates（LLM 候補評価）」のワンショットパイプライン。OpenAI 直叩きでモデルは gpt-4.1-nano ハードコード
- #183968 で評価環境が構築済み: dev.growi.org データをローカル GROWI にインポートし、6 usecases × 10 runs で正解親配下出現率を測定。改修前ベースラインは 41/60
- 既知の弱点: auto-scroll ケース 0/10（語彙ミスマッチで ES top20 圏外）、culling（スコア閾値 + LLM 評価）側の取りこぼし
- support/mastra ブランチに Mastra 基盤が実装済み: `growiAgent`（チャット用）、`fullTextSearchTool`（検索演算子 prefix:/tag:/-除外/sort 対応）、`getPageContentTool`（outline + 行ベース pagination）。ai-agentic-search spec はサブタスク 15/15 完了で実質 implementation-complete

## Desired Outcome

- suggest-path が本体内で複数回の検索を試行錯誤し（検索結果を元文書と照らして検索語・条件を変えながら探索）、API 単体で妥当な保存先候補に辿り着く
- #183968 の評価環境で、トップN命中率がベースライン 41/60 から向上する（特に語彙ミスマッチ起因の全滅ケース）
- レスポンス時間が許容範囲に収まる（検索回数上限 3〜5 回で速度と精度のトレードオフを制御。上限値は別途合意）
- 文書のフロー/ストック判定が検索の誘導に反映される

## Approach

suggest-path のエンジンを Mastra エージェントに換装する:

- suggest-path 専用 Agent を `mastra-modules/agents/` に新設（チャット用 `growiAgent` とは別定義）。既存の `fullTextSearchTool` / `getPageContentTool` を tools として再利用
- Agent の structured output で既存レスポンス型（suggest-path-types.ts）準拠の提案を返す
- 新旧エンジンは切り替え式で並存させ、同一評価環境で A/B 測定する（測定後、旧エンジンは features/openai 全廃に伴い削除）
- API 層（ルート・バリデーション・grant 解決・memo フォールバック）は現行のまま維持し、`generate-suggestions` のエンジン部分のみ差し替える

## Scope（discovery 時点）

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
  - 現行ワンショットエンジンの削除（検証結果を見て別途判断 → 後に features/openai 全廃で削除確定）

## Constraints

- support/mastra ブランチ派生で開発する（Mastra 基盤が master 未マージのため。当時の制約であり、現在は解消済み）
- API 契約の後方互換を維持（レスポンス型、trailing-slash 親パス規約、grant、memo フォールバック保証）
- モデルは config（`configManager`）から取得する方式に揃える（現行のハードコードを踏襲しない）
- レスポンス時間の上限値は別途合意（Redmine #184610 受け入れ条件）。検索回数上限で制御
- 検証は #183968 構築のローカル評価環境（devcontainer + dev wiki インポートデータ）を使用

### Mastra 技術的注意点（viability check 済み: @mastra/core 1.41.0、showstopper なし）

- tool use ループ + structured output の併用は `Agent.generate()` / `Agent.stream()` で可能（`structuredOutput` + `maxSteps`（デフォルト 5）+ `stopWhen`）
- **`generateVNext` は使わない**: tool 呼び出し後に structured output が生成されない既知バグ（mastra-ai/mastra#7662）
- **structured output の schema は JSON Schema を直接記述する**: Zod からの自動変換は OpenAI strict mode 非互換の既知バグあり（mastra-ai/mastra#16383）
- structured output 使用時に tools が外れる報告（mastra-ai/mastra#3139）があるため、設計時に tool 呼び出しと最終出力の両立を実機確認すること
- 対象モデルは OpenAI 系に限定（Gemini 2.5 は tool + structured output 同時不可）— **この制約は provider-agnostic 化（support/mastra マージ）で解消済み**。現行は `resolveMastraModel()` により openai / anthropic / google / azure-openai を問わず解決される
