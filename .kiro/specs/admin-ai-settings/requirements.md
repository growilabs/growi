# Requirements Document

## Project Description (Input)
- AI 機能の管理画面 (/admin/ai) の作成する
- "ai:" prefix がついている config 値を設定できるようにする
- Azure OpenAI 専用の設定画面も用意する
- 環境変数の値を優先にする
- 環境変数の値が設定されている場合は上書きできないようにする

設定できる値
```
  // Mastra LLM Settings (provider-agnostic: one provider per app)
  'ai:provider',
  'ai:apiKey',
  'ai:model',
  'ai:providerOptions',
  // Azure OpenAI-only connection config (ai:provider='azure-openai')
  'ai:azureOpenaiResourceName',
  'ai:azureOpenaiBaseUrl',
  'ai:azureOpenaiApiVersion',
  'ai:azureOpenaiUseEntraId',
```

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->


