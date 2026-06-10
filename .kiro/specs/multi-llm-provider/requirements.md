# Requirements Document

## Project Description (Input)
mastra の agent で利用する LLM のベンダーを OpenAI 以外にも対応させたい。

- 現状: GROWI の mastra agent（`growiAgent`）は `@ai-sdk/openai` の `createOpenAI` を用いた `getOpenaiProvider()` 経由で OpenAI に固定されており、API キーは `openai:apiKey`、モデルは `openai:assistantModel:mastraAgent` 設定から取得している。OpenAI 以外の LLM ベンダーを利用する手段がない。
- 変えたいこと: 自前ホスティングしている GROWI 運用者が、mastra agent で利用する LLM ベンダーとして OpenAI / Anthropic / Google を選択できるようにする。

要件メモ:
- OpenAI, Anthropic, Google が選択できるようにする。
- API キー、LLM ベンダー名、（必要であれば）Model 名は環境変数から指定できるようにする。
- 1 App につき 1 LLM ベンダー。1 つの App の中で複数ベンダーを同時利用できなくてよい。
- LLM クライアントを生成する際に `@ai-sdk/openai` のような ai-sdk 由来のプロバイダーを使うのか、`@mastra/core/agent`（https://mastra.ai/docs/agents/overview）の仕組みを使うのかは、メリット・デメリットを洗い出して議論したうえで実装方針を決めたい。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->


