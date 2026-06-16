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
  // 4 つの論理設定(resourceName / baseURL / apiVersion / useEntraId)を
  // 単一の JSON オブジェクト(AzureOpenaiConfig)として保持する 1 キーへ集約。
  // この AzureOpenaiConfig は storage / API / フォームで共有する単一の正準型で、
  // API でもネストしたオブジェクト(azureOpenaiSettings)として受け渡す。
  // 管理画面は引き続き 4 つの入力欄を表示するが、各欄はこのオブジェクトの
  // フィールドにバインドする。
  'ai:azureOpenaiSettings',
```

## Introduction

GROWI の AI 機能(LLM プロバイダー連携)の設定は、現在環境変数によってのみ構成できる。本フィーチャーは、管理者が `/admin/ai` の管理画面から `ai:` prefix を持つ設定値を参照・更新できるようにするものである。プロバイダー共通の設定に加えて、Azure OpenAI 固有の接続設定を扱う専用の設定画面を提供する。あわせて AI 機能の有効/無効(`app:aiEnabled`)を管理画面から切り替えられるようにし、AI 関連 API の利用可否を「AI が有効 かつ 設定が有効に構成されている」ことに整合させることで、有効化されているが設定不備で動作しない中途半端な状態を防ぐ。さらに既存の「環境変数専用モード」機構(制御用環境変数)を AI 設定にも適用し、当該モードが有効な場合は環境変数の値で AI 設定を固定して管理画面からの上書きを許可しないことで、インフラ側で固定した構成が画面操作によって変更されないことを保証する。

## Boundary Context

- **In scope**:
  - `/admin/ai` 管理画面の新規作成(管理者専用)
  - 以下の `ai:*` 設定キーの表示・更新: `ai:provider`, `ai:apiKey`, `ai:model`, `ai:providerOptions`, `ai:azureOpenaiSettings`(Azure OpenAI 接続設定の 4 論理項目 resourceName / baseURL / apiVersion / useEntraId を 1 つの JSON オブジェクト `AzureOpenaiConfig` として保持し、API でもネストしたオブジェクトとして受け渡す。管理画面は 4 つの入力欄を表示し、各欄はこのオブジェクトのフィールドにバインドする)
  - AI 機能の有効/無効トグル(`app:aiEnabled`)の管理画面からの切り替え
  - AI 関連 API の利用可否を「AI が有効 かつ 設定が有効に構成されている」ことに整合させる(設定不備時はリクエストを拒否し、クライアント導線を無効化して設定画面へ案内する)
  - 環境変数専用モード(制御用環境変数)が有効なときに AI 設定(上記 `ai:*` 5 キー + `app:aiEnabled`)を環境変数で固定し、UI / API ともに上書き不可とする挙動(既存 `ENV_ONLY_GROUPS` 機構を流用)
- **Out of scope**:
  - AI 機能(チャット・エディタ支援等)自体の挙動変更
  - 新しい LLM プロバイダーの追加
  - `ai:` prefix を持たない設定キーの管理(ただし AI 有効化トグル `app:aiEnabled` は本フィーチャーで扱う)
  - LLM への接続テスト(疎通確認)機能
  - 廃止された旧 AI 連携管理画面(`/admin/ai-integration`)の復元
- **Adjacent expectations**:
  - AI 機能のプロバイダー解決処理は、本フィーチャーが保存した設定値を参照して動作することを期待する
  - `ai:providerOptions` の内容(プロバイダー固有オプションの意味的な妥当性)の検証は各プロバイダー連携側の責務であり、本フィーチャーは JSON としての形式的な妥当性のみを扱う
  - `app:aiEnabled` は本フィーチャー外の箇所(旧 openai 機能の認可ミドルウェア等)からも参照される。本フィーチャーは AI 関連 API の利用可否(有効 かつ 設定済み)という観点での整合を担い、各消費者の個別ロジックそのものは変更しない

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

1. The GROWI shall Azure OpenAI 専用設定(resourceName / baseURL / apiVersion / useEntraId の 4 論理項目。これらは単一キー `ai:azureOpenaiSettings` の JSON オブジェクト `AzureOpenaiConfig` として永続化され、API でもネストしたオブジェクトとして受け渡す。画面では 4 つの入力欄として公開し、各欄はこのオブジェクトのフィールドにバインドする)を設定するための専用の設定画面(またはセクション)を提供する
2. While `ai:provider` が `azure-openai` 以外である, the AI 設定管理画面 shall Azure OpenAI 専用設定が現在のプロバイダーには適用されないことが分かる形で提示する(非表示または無効化を含む)
3. When Azure OpenAI 設定の `useEntraId`(`ai:azureOpenaiSettings` オブジェクトの `useEntraId` フィールド)が有効に設定されている場合, the AI 設定管理画面 shall API キーが認証に使用されない旨を管理者に提示する
4. The AI 設定管理画面 shall Azure OpenAI 利用時には `ai:model` がモデル ID ではなくデプロイメント名を指すことを管理者に案内する

### Requirement 4: 環境変数専用モードによる設定の固定

**Objective:** As a GROWI 運用者, I want 環境変数専用モード(制御用環境変数)を有効化したときに AI 設定を環境変数で固定し管理画面からの上書きを禁止できること, so that インフラ側で固定した構成が画面操作によって変更されないことを保証できる

#### Acceptance Criteria

1. While 環境変数専用モードが有効, the GROWI shall 管理画面から保存された値ではなく環境変数の値を AI 設定の有効な設定値として使用する
2. While 環境変数専用モードが有効, the AI 設定管理画面 shall 対象の設定項目を編集不可として表示し、環境変数専用モードである旨を管理者に明示する
3. If 環境変数専用モードが有効な状態で AI 設定の更新が要求された場合, the GROWI shall 設定値を変更せず、更新が許可されないことを管理者に通知する
4. While 環境変数専用モードが無効, the GROWI shall 管理画面から保存された値を有効な設定値として使用し、保存値が存在しない項目では対応する環境変数の値を既定値として使用する

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

### Requirement 7: AI 機能の有効化と利用可否の整合

**Objective:** As a GROWI 管理者, I want AI 機能の有効/無効を管理画面から切り替えられ、かつ設定が不完全なときは AI 機能が利用されないようにしたい, so that 「有効だが設定不備で動作しない」中途半端な状態を避けられる

#### Acceptance Criteria

1. The AI 設定管理画面 shall AI 機能の有効/無効(`app:aiEnabled`)を切り替える操作を提供する
2. While AI 機能が無効である、またはプロバイダーおよびその必須項目が有効に構成されていない, the GROWI shall AI 関連 API へのリクエストを拒否する
3. While AI 機能が有効かつプロバイダーおよびその必須項目が有効に構成されている, the GROWI shall AI 関連 API を利用可能にする
4. While AI 機能が無効である、またはプロバイダーおよびその必須項目が有効に構成されていない, the GROWI shall (次回のページ読み込み以降)クライアントの AI 機能導線(サイドバー等)を無効化し、利用できないこと・設定画面への案内を示す
5. When AI 設定または有効/無効の状態が更新された場合, the GROWI shall サーバーの再起動を必要とせず、以後の利用可否判定に反映する
6. While AI 機能が有効だがプロバイダーおよびその必須項目が有効に構成されていない, the AI 設定管理画面 shall AI 機能が動作しない旨の警告を表示する
