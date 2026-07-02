# Requirements Document

## Project Description (Input)

GROWI AI において、同時に複数の Provider, Model を登録できる機能。

### 背景・目的（既存 spec・コードベースからの補足）

- **問題を抱える人**: (a) 用途に応じて異なる LLM ベンダーのモデルを使い分けたい GROWI のエンドユーザー、(b) 複数ベンダーの接続設定と利用可能モデルを一元的に統制したい、セルフホスティング GROWI の管理者・運用者。
- **現状**: [multi-llm-provider](../multi-llm-provider/) により LLM プロバイダは OpenAI / Anthropic / Google / Azure OpenAI から選択できるが、**1 App = 単一プロバイダ**（単一の `ai:provider` / `ai:apiKey` / `ai:azureOpenaiSettings`）に固定されている。[mastra-multi-model-chat](../mastra-multi-model-chat/)（実装済み）により、許可モデル集合 `ai:allowedModels` に複数モデルを登録しエンドユーザーがチャット画面でモデルを選択できるが、選択できるのは**その単一プロバイダ配下のモデルに限られる**。複数プロバイダの同時利用は両 spec とも明示的にスコープ外とされてきた。
- **変えること**: 複数のプロバイダ（それぞれの接続設定・API キーを含む）と、各プロバイダ配下のモデルを**同時に登録**できるようにし、許可モデル集合をプロバイダ横断で構成できるようにする。

### 関連 spec

- [multi-llm-provider](../multi-llm-provider/) — プロバイダ選択（1 App = 1 ベンダー）の導入
- [mastra-multi-model-chat](../mastra-multi-model-chat/) — 同一プロバイダ内の複数許可モデル + チャットでのモデル選択（実装済み）
- [ai-settings-model-picker](../ai-settings-model-picker/) — 管理画面の許可モデル入力をオフライン同梱カタログからの選択式にする（実装中・現行ブランチ）

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
