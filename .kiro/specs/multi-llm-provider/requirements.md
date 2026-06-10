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

## Introduction

GROWI の mastra チャットエージェント（`growiAgent`）は、現在 OpenAI 専用に固定されている。LLM プロバイダーの生成・モデル選択・API キー取得がすべて OpenAI 前提でハードコードされており、他ベンダーへ切り替える手段がない。

本仕様は、自前ホスティングする GROWI の管理者・運用者が、mastra チャットエージェントで使用する LLM ベンダーを **OpenAI / Anthropic / Google** から選択できるようにすることを目的とする。ベンダー・API キー・モデルといった接続設定は、**環境変数のみ**で構成する（管理画面 UI は持たない）。これは、AI 機能を `features/mastra` に集約し AI 連携設定の管理画面を廃止して環境変数設定へ一本化する [deprecate-openai-features](../deprecate-openai-features/) の方針と整合する。

1 つの GROWI アプリインスタンスでは、単一の LLM ベンダーのみを有効にする（同一アプリ内での複数ベンダー同時利用は対象外）。運用者がベンダーを明示指定しない場合、または設定に不備がある場合は、mastra チャットエージェントを無効化しつつアプリ本体の動作は継続する。

本仕様の利害関係者は、AI チャットを利用する GROWI ユーザー、GROWI を運用する管理者・運用者、および GROWI コードベースを保守する開発者である。

## Boundary Context

- **In scope（本仕様で扱う）**
  - mastra チャットエージェント（`growiAgent`）が使用する LLM ベンダーを OpenAI / Anthropic / Google から選択する仕組み
  - ベンダー名・API キー・モデルの環境変数による接続設定（モデルは任意指定で、未指定時はベンダーごとの既定モデルを使用）
  - 1 アプリインスタンス = 単一ベンダーの制約
  - ベンダー設定の不備（未指定・対応外ベンダー名・必須設定欠落）時の挙動（mastra チャットエージェント無効化＋ログ出力＋アプリ継続）
- **Out of scope（本仕様で扱わない）**
  - 同一アプリ内での複数ベンダーの同時利用（ユーザー／リクエスト単位の切り替えを含む）
  - mastra チャットエージェント以外の LLM 利用機能（ページパス提案 `suggest-path` など）のベンダー切り替え。これらは現行のプロバイダー設定のまま据え置く
  - ベンダー・API キー・モデルを設定するための管理画面 UI（環境変数のみで構成する）
  - OpenAI / Anthropic / Google 以外のベンダーの追加
  - LLM クライアントの生成方式（ai-sdk 由来プロバイダー vs `@mastra/core/agent`）の選定。これは設計上の論点であり design フェーズで比較・決定する
  - ベンダー別 reasoning provider options のパリティ（`reasoningEffort` / `reasoningSummary` 相当）。reasoning オプションはモデル世代依存で保守コストが高いため、本仕様では OpenAI 既存挙動を維持し、Anthropic/Google は各モデル既定の reasoning に委ねる（providerOptions 未設定）。reasoning パリティは実モデルで検証できる別仕様へ後追いとする
- **Adjacent expectations（隣接システム・前提）**
  - 既存の AI 有効化ゲート（環境変数 `AI_ENABLED` / `app:aiEnabled`）に依存する。mastra チャットエージェントが動作するには AI が有効であり、かつ有効なベンダー設定が存在する必要がある
  - 接続設定は既存の環境変数ベースの設定読み込み機構を通じて解決される
  - [deprecate-openai-features](../deprecate-openai-features/)（AI 機能の `features/mastra` 集約・AI 連携設定画面の廃止）と整合する

## Requirements

### Requirement 1: LLM ベンダーの選択
**Objective:** As a GROWI を運用する管理者, I want mastra チャットエージェントが使用する LLM ベンダーを OpenAI / Anthropic / Google から選択できる, so that 自組織のポリシー・契約・コストに合った LLM を利用できる

#### Acceptance Criteria
1. The system shall OpenAI / Anthropic / Google を mastra チャットエージェントの選択可能な LLM ベンダーとしてサポートする
2. When 運用者が環境変数で対応ベンダーのいずれかを指定したとき, the system shall そのベンダーを mastra チャットエージェントの LLM プロバイダーとして使用する
3. Where ベンダーが環境変数で明示指定されていないとき, the system shall それを設定不備として扱い, 既定ベンダーへのフォールバックを行わない
4. If 指定されたベンダー名が対応集合（OpenAI / Anthropic / Google）に含まれないとき, the system shall それを設定不備として扱う

### Requirement 2: 環境変数による接続設定
**Objective:** As a 運用者, I want ベンダー名・API キー・（必要であれば）モデル名を環境変数で設定できる, so that 認証情報や構成をデプロイ環境のシークレット管理で安全に扱える

#### Acceptance Criteria
1. The system shall 選択されたベンダーの API キーを環境変数から取得する
2. The system shall 選択されたベンダーで使用するモデル名を環境変数で設定できるようにする
3. Where モデル名が環境変数で指定されていないとき, the system shall そのベンダーの既定モデルを使用する
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
1. If 選択ベンダーが未指定・対応外, または選択ベンダーの必須設定（API キー）が欠落しているとき, the system shall mastra チャットエージェントを無効化する
2. When 上記の設定不備を検出したとき, the system shall 不備の内容（未指定 / 不正なベンダー名 / 欠落している設定項目）を特定できるエラーをログに出力する
3. While 設定不備により mastra チャットエージェントが無効な状態, the system shall アプリケーション本体および他の AI 機能の起動・動作を継続する
4. When 利用者が無効状態の mastra チャットエージェントにチャットを要求したとき, the system shall 機能が利用不可である旨のエラー応答を返す

### Requirement 5: 対象範囲の境界（mastra チャットエージェント限定）
**Objective:** As a 開発者・運用者, I want ベンダー選択の適用範囲が mastra チャットエージェントに限定される, so that 他の LLM 利用機能の挙動が変わらないことを保証できる

#### Acceptance Criteria
1. The system shall 本仕様の LLM ベンダー選択を mastra チャットエージェント（`growiAgent`）の LLM 呼び出しにのみ適用する
2. While 本仕様のベンダー設定が適用される状態でも, the system shall ページパス提案（`suggest-path`）を含む既存の他 LLM 利用機能を, 現行のプロバイダー設定のまま動作させる
