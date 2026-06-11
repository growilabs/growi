# Requirements Document

## Project Description (Input)

suggest-path のエンジンを Mastra の agentic search に換装する（Redmine #184610）。

現行の suggest-path API（`apps/app/src/features/ai-tools/suggest-path/`）は「キーワード抽出 → ES 全文検索 1 回 → LLM 候補評価」のワンショット構成で OpenAI を直接呼んでおり、最初の検索が外れると回復手段がない（語彙ミスマッチ起因の全滅ケースが #183968 の評価で確認済み。ベースライン 41/60）。

これを support/mastra ブランチの Mastra 基盤（`fullTextSearchTool` / `getPageContentTool`）を使う suggest-path 専用 Agent に置き換え、検索結果を元文書と照らして検索語・条件を変えながら複数回探索する agentic search 的挙動を実現する。文書のフロー/ストック判定を検索誘導に使い、検索回数上限（3〜5 回）でレスポンス時間と精度のトレードオフを取る。

API 契約（レスポンス型・trailing-slash 親パス規約・grant 解決・memo フォールバック）は維持し、新旧エンジンは切り替え式で並存させて #183968 のローカル評価環境（6 usecases × 10 runs）で A/B 測定する。

詳細な背景・スコープ境界・上下流依存・技術的制約（Mastra 既知バグの回避方針を含む）は [brief.md](./brief.md) を参照。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
