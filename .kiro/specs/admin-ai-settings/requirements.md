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

## Introduction

GROWI の AI 機能(LLM プロバイダー連携)の設定は、現在環境変数によってのみ構成できる。本フィーチャーは、管理者が `/admin/ai` の管理画面から `ai:` prefix を持つ設定値を参照・更新できるようにするものである。プロバイダー共通の設定に加えて、Azure OpenAI 固有の接続設定を扱う専用の設定画面を提供する。環境変数に値が設定されている項目については環境変数の値を常に優先し、管理画面からの上書きを許可しないことで、インフラ側で固定した構成が画面操作によって変更されないことを保証する。

## Boundary Context

- **In scope**:
  - `/admin/ai` 管理画面の新規作成(管理者専用)
  - 以下の `ai:*` 設定キーの表示・更新: `ai:provider`, `ai:apiKey`, `ai:model`, `ai:providerOptions`, `ai:azureOpenaiResourceName`, `ai:azureOpenaiBaseUrl`, `ai:azureOpenaiApiVersion`, `ai:azureOpenaiUseEntraId`
  - `ai:*` 設定キーに限った「環境変数優先・上書き不可」の挙動
- **Out of scope**:
  - AI 機能(チャット・エディタ支援等)自体の挙動変更
  - 新しい LLM プロバイダーの追加
  - `ai:` prefix を持たない設定キーの管理
  - LLM への接続テスト(疎通確認)機能
  - 廃止された旧 AI 連携管理画面(`/admin/ai-integration`)の復元
- **Adjacent expectations**:
  - AI 機能のプロバイダー解決処理は、本フィーチャーが保存した設定値を参照して動作することを期待する
  - `ai:providerOptions` の内容(プロバイダー固有オプションの意味的な妥当性)の検証は各プロバイダー連携側の責務であり、本フィーチャーは JSON としての形式的な妥当性のみを扱う

## Requirements

### Requirement 1: AI 設定管理画面へのアクセスとナビゲーション

**Objective:** As a GROWI 管理者, I want `/admin/ai` で AI 設定管理画面にアクセスしたい, so that AI 機能の設定を一元的に参照・管理できる

#### Acceptance Criteria

1. When 管理者権限を持つユーザーが `/admin/ai` にアクセスした場合, the GROWI shall AI 設定管理画面を表示する
2. If 管理者権限を持たないユーザーが `/admin/ai` にアクセスした場合, the GROWI shall アクセスを拒否し、AI 設定管理画面の内容を表示しない
3. The GROWI shall 管理画面の共通ナビゲーションに AI 設定管理画面への項目を表示する
4. When AI 設定管理画面が表示された場合, the AI 設定管理画面 shall 各設定項目について現在有効な設定値(環境変数由来または管理画面から保存された値)を表示する

### Requirement 2: LLM プロバイダー共通設定の管理

**Objective:** As a GROWI 管理者, I want LLM プロバイダー共通の設定(プロバイダー種別・API キー・モデル・プロバイダーオプション)を画面から設定したい, so that 環境変数を編集することなく AI 機能を構成できる

#### Acceptance Criteria

1. The AI 設定管理画面 shall `ai:provider`, `ai:apiKey`, `ai:model`, `ai:providerOptions` の各設定項目に対応する入力欄を提供する
2. When 管理者が `ai:provider` を設定する場合, the AI 設定管理画面 shall サポート対象のプロバイダー(openai, anthropic, google, azure-openai)のみを選択肢として提示する
3. When 管理者が設定を保存する操作を行った場合, the GROWI shall 入力された値を永続化し、保存の成否をメッセージで管理者に通知する
4. When 設定の保存が完了した場合, the GROWI shall サーバーの再起動を必要とせず、以後の AI 機能の実行において保存された設定値を使用する

### Requirement 3: Azure OpenAI 専用設定の管理

**Objective:** As a GROWI 管理者, I want Azure OpenAI 固有の接続設定を専用の設定画面で管理したい, so that Azure OpenAI を利用する際に必要な接続情報を迷わず構成できる

#### Acceptance Criteria

1. The GROWI shall Azure OpenAI 専用設定(`ai:azureOpenaiResourceName`, `ai:azureOpenaiBaseUrl`, `ai:azureOpenaiApiVersion`, `ai:azureOpenaiUseEntraId`)を設定するための専用の設定画面(またはセクション)を提供する
2. While `ai:provider` が `azure-openai` 以外である, the AI 設定管理画面 shall Azure OpenAI 専用設定が現在のプロバイダーには適用されないことが分かる形で提示する(非表示または無効化を含む)
3. When `ai:azureOpenaiUseEntraId` が有効に設定されている場合, the AI 設定管理画面 shall API キーが認証に使用されない旨を管理者に提示する
4. The AI 設定管理画面 shall Azure OpenAI 利用時には `ai:model` がモデル ID ではなくデプロイメント名を指すことを管理者に案内する

### Requirement 4: 環境変数による設定値の優先と上書き防止

**Objective:** As a GROWI 運用者, I want 環境変数で指定した AI 設定が管理画面の操作より常に優先されること, so that インフラ側で固定した構成が画面操作によって変更されないことを保証できる

#### Acceptance Criteria

1. While `ai:*` 設定キーに対応する環境変数に値が設定されている, the GROWI shall 管理画面から保存された値ではなく環境変数の値を有効な設定値として使用する
2. While 環境変数に値が設定されている, the AI 設定管理画面 shall 該当する設定項目を編集不可として表示し、値が環境変数由来であることを管理者に明示する
3. If 環境変数に値が設定されている設定項目に対して更新が要求された場合, the GROWI shall 当該項目の有効な設定値を変更せず、環境変数の値を引き続き使用する
4. When 環境変数に値が設定されていない設定項目について管理者が保存を行った場合, the GROWI shall 画面から入力された値を有効な設定値として使用する

### Requirement 5: シークレット値の保護

**Objective:** As a GROWI 管理者, I want API キーなどの機密値が画面上で露出しないこと, so that 認証情報の漏洩リスクを抑えられる

#### Acceptance Criteria

1. The AI 設定管理画面 shall `ai:apiKey` の入力欄をマスク形式(パスワード入力形式)で提供する
2. When 保存済みの設定値が画面に表示される場合, the AI 設定管理画面 shall `ai:apiKey` の値を平文で表示しない(マスク表示、または設定済みであることのみの提示を含む)
3. If 設定の保存または取得でエラーが発生した場合, the GROWI shall エラーメッセージに機密値を含めない

### Requirement 6: 入力検証とエラー処理

**Objective:** As a GROWI 管理者, I want 不正な設定値が保存前に検出され、保存失敗時には状況が分かるフィードバックを得たい, so that 誤った構成によって AI 機能が動作しなくなることを防げる

#### Acceptance Criteria

1. If サポート対象外の値が `ai:provider` として保存要求された場合, the GROWI shall 保存を拒否し、エラーを管理者に通知する
2. If `ai:providerOptions` に JSON として解釈できない値が入力された場合, the AI 設定管理画面 shall バリデーションエラーを表示し、保存を実行しない
3. If 設定の保存に失敗した場合, the AI 設定管理画面 shall 失敗をエラーメッセージで通知し、管理者が入力中の値を画面上に保持する
