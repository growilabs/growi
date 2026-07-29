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

### 追補（スコープ拡張: Azure OpenAI）
当初の対象 3 ベンダー（OpenAI / Anthropic / Google）に加え、**Azure OpenAI** を 4 番目の選択肢として追加する。Azure OpenAI は他 3 ベンダーと異なり「API キー + モデル名」だけでは接続できず、**リソース固有のエンドポイント**（リソース名 or ベース URL）と、任意で **API バージョン**を必要とする。また Azure ではモデル指定が「モデル ID」ではなく運用者が作成した**デプロイ名**である点が異なる。エンドポイントはリソース名・ベース URL の**両対応**とし、ベース URL は主権クラウド（Azure Government 等）/ API Management ゲートウェイ / カスタムドメインの逃げ道として用いる。認証は **API キー方式**に加え、**Microsoft Entra ID（マネージド ID / `DefaultAzureCredential`）方式**にも対応する（環境変数フラグで切替。Entra ID 時は API キー不要）。

## Introduction

GROWI の mastra チャットエージェント（`growiAgent`）は、現在 OpenAI 専用に固定されている。LLM プロバイダーの生成・モデル選択・API キー取得がすべて OpenAI 前提でハードコードされており、他ベンダーへ切り替える手段がない。

本仕様は、自前ホスティングする GROWI の管理者・運用者が、mastra チャットエージェントで使用する LLM ベンダーを **OpenAI / Anthropic / Google / Azure OpenAI** から選択できるようにすることを目的とする。ベンダー・API キー・モデルといった接続設定は、**環境変数のみ**で構成する（管理画面 UI は持たない）。これは、AI 機能を `features/mastra` に集約し AI 連携設定の管理画面を廃止して環境変数設定へ一本化する [deprecate-openai-features](../deprecate-openai-features/) の方針と整合する。

1 つの GROWI アプリインスタンスでは、単一の LLM ベンダーのみを有効にする（同一アプリ内での複数ベンダー同時利用は対象外）。ベンダー未指定時は既定で OpenAI を使用する。設定に不備（対応外のベンダー名・API キー欠落）がある場合は、mastra チャットエージェントを無効化（モデル解決時に失敗）しつつアプリ本体の動作は継続する。

本仕様の利害関係者は、AI チャットを利用する GROWI ユーザー、GROWI を運用する管理者・運用者、および GROWI コードベースを保守する開発者である。

## Boundary Context

- **In scope（本仕様で扱う）**
  - mastra チャットエージェント（`growiAgent`）が使用する LLM ベンダーを OpenAI / Anthropic / Google / Azure OpenAI から選択する仕組み
  - ベンダー名・API キー・モデルの環境変数による接続設定（ベンダー未指定時は既定 OpenAI。モデルは任意指定で、未指定時は単一の既定モデル＝既定ベンダー OpenAI 向け）<br>本実装に整合（mastra-multi-model-chat）: 単一 `ai:model` は許可モデル集合 `ai:allowedModels`（既定は `isDefault` エントリ、env `AI_ALLOWED_MODELS`）へ統合・廃止。ベンダー（プロバイダ）/ API キーは引き続き単一。
  - Azure OpenAI 固有の接続設定（リソース名 or ベース URL の両対応、任意の API バージョン）の環境変数による指定（Requirement 7）
  - Azure OpenAI の認証方式の選択（API キー / Microsoft Entra ID）の環境変数による指定（Requirement 8）
  - LLM provider options（reasoning 等）の環境変数（単一 JSON）による指定と mastra チャット呼び出しへの適用<br>本実装に整合（mastra-multi-model-chat）: グローバル単一の provider options は廃止され、許可モデルごと（`ai:allowedModels` の各エントリ）に保持・使用モデル単位で解決される。
  - 1 アプリインスタンス = 単一ベンダーの制約
  - ベンダー設定の不備（未指定・対応外ベンダー名・必須設定欠落）時の挙動（mastra チャットエージェント無効化＋ログ出力＋アプリ継続）
- **Out of scope（本仕様で扱わない）**
  - 同一アプリ内での複数**ベンダー**の同時利用、およびベンダー（プロバイダ）単位のユーザー／リクエスト切り替え。<br>本実装に整合（mastra-multi-model-chat）: **モデル単位の per-request 選択は mastra-multi-model-chat spec で扱う（同一プロバイダ内）。ベンダー（プロバイダ）切替は引き続き本 spec の対象外。**
  - mastra チャットエージェント以外の LLM 利用機能（ページパス提案 `suggest-path` など）のベンダー切り替え。これらは現行のプロバイダー設定のまま据え置く
  - ベンダー・API キー・モデルを設定するための管理画面 UI（環境変数のみで構成する）
  - OpenAI / Anthropic / Google / Azure OpenAI 以外のベンダーの追加
  - LLM クライアントの生成方式（ai-sdk 由来プロバイダー vs `@mastra/core/agent`）の選定。これは設計上の論点であり design フェーズで比較・決定する
  - intent レベルの per-vendor 自動マッピング（"effort=low" を各ベンダー固有の形へ変換する等）。provider options は**生 JSON を運用者が env で指定**する（Requirement 6）方式とし、モデル世代依存のマッピングロジックはコードに持たない
- **Adjacent expectations（隣接システム・前提）**
  - 既存の AI 有効化ゲート（環境変数 `AI_ENABLED` / `app:aiEnabled`）に依存する。mastra チャットエージェントが動作するには AI が有効であり、かつ有効なベンダー設定が存在する必要がある
  - 接続設定は既存の環境変数ベースの設定読み込み機構を通じて解決される
  - [deprecate-openai-features](../deprecate-openai-features/)（AI 機能の `features/mastra` 集約・AI 連携設定画面の廃止）と整合する

## Requirements

### Requirement 1: LLM ベンダーの選択
**Objective:** As a GROWI を運用する管理者, I want mastra チャットエージェントが使用する LLM ベンダーを OpenAI / Anthropic / Google / Azure OpenAI から選択できる, so that 自組織のポリシー・契約・コストに合った LLM を利用できる

#### Acceptance Criteria
1. The system shall OpenAI / Anthropic / Google / Azure OpenAI を mastra チャットエージェントの選択可能な LLM ベンダーとしてサポートする
2. When 運用者が環境変数で対応ベンダーのいずれかを指定したとき, the system shall そのベンダーを mastra チャットエージェントの LLM プロバイダーとして使用する
3. Where ベンダーが環境変数で指定されていないとき, the system shall それを設定不備として扱う（既定ベンダーは持たず、ベンダーの明示指定を必須とする）
4. If 指定されたベンダー名が対応集合（OpenAI / Anthropic / Google / Azure OpenAI）に含まれないとき, the system shall それを設定不備として扱う

### Requirement 2: 環境変数による接続設定
**Objective:** As a 運用者, I want ベンダー名・API キー・（必要であれば）モデル名を環境変数で設定できる, so that 認証情報や構成をデプロイ環境のシークレット管理で安全に扱える

#### Acceptance Criteria
1. The system shall 選択されたベンダーの API キーを環境変数から取得する
2. The system shall 選択されたベンダーで使用するモデル名を環境変数で設定できるようにする
3. Where モデル名が環境変数で指定されていないとき, the system shall それを設定不備として扱う（既定モデルは持たず、全ベンダーでモデルの明示指定を必須とする）
4. The system shall ベンダー・API キー・モデルの接続設定を環境変数のみから受け付け, これらを設定する管理画面 UI を提供しない
5. The system shall API キーを機密情報として扱い, ログ出力・エラーメッセージ・API 応答のいずれにも平文で含めない

### Requirement 3: 単一ベンダー制約（1 App = 1 Vendor）
**Objective:** As a 運用者, I want 1 つの GROWI アプリインスタンスで単一の LLM ベンダーのみが有効になる, so that 構成がシンプルで挙動が予測可能になる

#### Acceptance Criteria
1. The system shall 1 つのアプリインスタンスにつき単一の LLM ベンダーのみを mastra チャットエージェントで有効にする
2. While 複数ベンダーの接続設定（API キー等）が環境に同時に存在する場合でも, the system shall 明示的に選択された 1 つのベンダーのみを使用する
3. The mastra chat agent shall 同一リクエスト内で複数ベンダーを混在して利用しない

### Requirement 4: 設定不備時の挙動（無効化とログ出力）
**Objective:** As a 運用者, I want ベンダー設定に不備があってもアプリ全体は起動・動作を継続し, 原因がログから判別できる, so that 一部の設定ミスで全体が停止せず, 原因究明が容易になる

#### Acceptance Criteria
1. If 選択ベンダーが未指定・対応外, または選択ベンダーの必須設定（API キー・モデル）が欠落しているとき, the system shall mastra チャットエージェントを無効化する
2. When 上記の設定不備が検出されたとき（モデル解決の実行時）, the system shall 不備の内容（未指定 / 不正なベンダー名 / 欠落している設定項目）を特定できるエラーをログに出力する
3. While 設定不備により mastra チャットエージェントが無効な状態, the system shall アプリケーション本体および他の AI 機能の起動・動作を継続する
4. When 利用者が無効状態の mastra チャットエージェントにチャットを要求したとき, the system shall エラー応答を返して処理を成功させない（具体的な原因はサーバログに記録し、クライアントには平文の機密情報を返さない）

### Requirement 5: 対象範囲の境界（mastra チャットエージェント限定）
**Objective:** As a 開発者・運用者, I want ベンダー選択の適用範囲が mastra チャットエージェントに限定される, so that 他の LLM 利用機能の挙動が変わらないことを保証できる

#### Acceptance Criteria
1. The system shall 本仕様の LLM ベンダー選択を mastra チャットエージェント（`growiAgent`）の LLM 呼び出しにのみ適用する
2. While 本仕様のベンダー設定が適用される状態でも, the system shall ページパス提案（`suggest-path`）を含む既存の他 LLM 利用機能を, 現行のプロバイダー設定のまま動作させる

### Requirement 6: provider options の環境変数指定
**Objective:** As a 運用者, I want LLM の provider options（reasoning 等）を環境変数で渡せる, so that ベンダー/モデルに応じた推論挙動を運用者自身が制御できる

#### Acceptance Criteria
1. The system shall mastra チャットエージェントの LLM 呼び出しに, 環境変数で指定された provider options を適用する
2. The system shall provider options を単一の JSON 環境変数（AI SDK 形式＝プロバイダー名前空間を含む `{ "<provider>": { ... } }`）として受け付ける
3. Where provider options が環境変数で指定されていないとき, the system shall provider options を適用しない（既定値は持たず、空として扱う）
4. If 指定された provider options の JSON が不正（パース不能・非オブジェクト）であるとき, the system shall チャット要求を失敗させず, provider options を適用せずに処理を継続し, 警告をログに出力する

### Requirement 7: Azure OpenAI 固有の接続設定
**Objective:** As a Azure OpenAI を利用する運用者, I want Azure 固有の接続情報（エンドポイントと API バージョン）を環境変数で指定できる, so that 自組織の Azure リソース／主権クラウド／ゲートウェイ構成に合わせて mastra チャットエージェントを Azure OpenAI に接続できる

#### Acceptance Criteria
1. The system shall ベンダーとして Azure OpenAI が選択されたとき, Azure リソースのエンドポイントを環境変数で指定できるようにする
2. The system shall Azure のエンドポイント指定として, リソース名方式（リソース名から標準エンドポイント URL を構成）とベース URL 方式（完全なベース URL を直接指定）の両方を受け付ける
3. While リソース名とベース URL の両方が指定されたとき, the system shall ベース URL 方式を優先する（AI SDK の排他契約に従う）
4. If Azure OpenAI が選択され, かつリソース名・ベース URL のいずれも指定されていないとき, the system shall それを設定不備として扱い（使用時に失敗）, 不備の内容を特定できるエラーをログに出力する（API キー値は含めない）
5. The system shall Azure の API バージョンを任意の環境変数で指定できるようにし, 未指定時は AI SDK の既定バージョンを使用する
6. When ベンダーが Azure OpenAI のとき, the system shall モデル設定（`AI_MODEL`）を Azure の**デプロイ名**として解釈する（OpenAI のモデル ID ではない）<br>本実装に整合（mastra-multi-model-chat）: `ai:model` / `AI_MODEL` は `ai:allowedModels`（env `AI_ALLOWED_MODELS`）へ統合・廃止。Azure ではこの許可リストの各エントリの `model` 値がデプロイ名を指す。

### Requirement 8: Azure OpenAI の認証方式（API キー / Microsoft Entra ID）
**Objective:** As a Azure OpenAI を利用する運用者, I want API キーの代わりに Microsoft Entra ID（マネージド ID）で認証できる, so that 長期シークレットを保管せずに Azure の推奨方式で安全に接続できる

#### Acceptance Criteria
1. The system shall Azure OpenAI の認証方式として, API キー方式と Microsoft Entra ID 方式の両方をサポートする
2. The system shall 認証方式を環境変数フラグで選択できるようにし, 既定は API キー方式とする
3. When Microsoft Entra ID 方式が有効なとき, the system shall `DefaultAzureCredential` 由来のトークンプロバイダで認証し, API キー（`AI_API_KEY`）を要求しない
4. While Microsoft Entra ID 方式が有効でないとき（既定）, the system shall 従来どおり API キーを要求し, 欠落時は設定不備として扱う
5. The system shall いずれの認証方式でも Azure のエンドポイント設定（リソース名 or ベース URL。Requirement 7）を必須とする
