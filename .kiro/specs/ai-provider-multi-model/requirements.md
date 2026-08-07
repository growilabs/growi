# Requirements Document

## Project Description (Input)

Mastra AI チャットの複数モデル対応 (1 App = 複数 LLM モデル)。

### 背景・目的
現在 GROWI の Mastra AI チャットは 1 App に対して単一 LLM モデルのみ利用可能 (config `ai:provider` + 単一 `ai:model`)。これを「管理者が許可した複数モデルの中から、エンドユーザーがチャット画面でモデルを選択できる」ようにする (ClaudeCode のようなチャット画面からのモデル選択)。

- **問題を抱える人**: (a) 用途に応じてモデルを使い分けたいエンドユーザー、(b) 利用可能なモデルを統制したい管理者。
- **現状**: 1 App = 1 モデル固定。管理者が単一のモデル名を自由入力し、全チャットがそのモデルで動く。
- **変えること**: 管理者が「許可するモデルの集合」を設定し、エンドユーザーがチャットごと (メッセージごと) にその中からモデルを選べるようにする。

### 確定済み設計判断 (会話で合意済み・前提として扱う)
> これらは設計フェーズで詳細化する「HOW」の前提。要件 (WHAT) 自体は本書の Requirements 節に記載する。

1. **同一プロバイダ内の複数モデルに限定。** config の単一 `ai:provider` / `ai:apiKey` / `ai:azureOpenaiSettings` は据え置き。異プロバイダ混在はスコープ外。
2. **実行時にベンダー API からモデル一覧を取得する仕組みは設けない。** 理由: Vercel AI SDK (`ai`/`@ai-sdk/*`) は provider が factory のみでモデル列挙不可。唯一 `@ai-sdk/gateway.getAvailableModels()` はあるが Vercel Gateway 認証 (`AI_GATEWAY_API_KEY`/OIDC) 必須で、provider+apiKey を直接設定する GROWI に不適合。カタログを持つプロバイダ (openai / anthropic / google) の管理者許可リストは、models.dev を取り込んだオフライン同梱カタログ (`model-catalog-data.json`) からの選択方式を採る（一覧提供自体は外部通信を伴わず、カタログの更新時〔管理画面手動／起動時／定期。起動時・定期は AI 機能有効時のみで既定日次〕に限り models.dev へ fetch する）。azure-openai、またカタログ取得に失敗した場合は従来どおり自由入力。詳細は `.kiro/specs/ai-provider-model-picker`。
3. **config:** 新キー `ai:allowedModels`（モデル + providerOptions + `isDefault` を1エントリに同梱、既定は別キーでなくリスト内の `isDefault` で表す）を追加し、**`ai:model` と `ai:providerOptions` は完全廃止**（config キー・env `AI_MODEL`/`AI_PROVIDER_OPTIONS` ともに削除、自動移行なし、グローバル既定オプションも設けない）。`isAiConfigured()` は「provider が有効 + プロバイダ必須の接続設定 + 非空 allowedModels」に更新する。ただし azure-openai は endpoint（resourceName または baseURL）も必須とし、apiKey は Entra ID 認証利用時のみ免除する（endpoint なしで throw する `resolveAzureOpenaiModel` と整合させるため）。
4. **会話ごとの選択モデル:** `modelId`（サーバ永続化なし）。`modelId` は transport が毎リクエスト（`sendMessage`・`regenerate()` 双方）ライブ getter 経由で読み body へ注入する（`useChat` は transport 差し替えを無視するため選択変更時も transport は再生成しない）。
5. **サーバ側検証必須 (セキュリティ):** クライアントが送る `modelId` は信用せず、`resolveEffectiveModelId(modelId?)` で `ai:allowedModels` に対し検証（許可リスト判定は共通 pure 述語 `isModelInAllowList(modelId, allowedModels)` を使う。`resolveEffectiveModelId` と `/mastra/models` ルートが共有する単一ルール）。
6. **リクエスト単位のモデル切替:** Mastra の動的モデル関数（`({ requestContext }) => model`）を使い、リクエストごとに実効モデルを解決する。実効モデルの決定は 1 リクエストにつき 1 回だけ行い、その結果を RequestContext と providerOptions 解決の両方に渡す（二重解決しない）。各 provider の resolver はモデル単位でオブジェクトをキャッシュし、未使用 provider の SDK は読み込まない。
7. **管理 UI:** 「許可するモデル」リストエディタを**共通設定 (ProviderCommonSettings) に単一配置**する（従来 Azure 専用セクションに置いていたモデル=デプロイ名欄を統合。デプロイ名も共有の `ai:allowedModels` に格納されるため、データモデルとも整合する）。ラベルは provider に応じて「デプロイ名」（Azure OpenAI）/「モデル」（他）を切替。共通設定の単一 providerOptions テキストエリアは廃止し、モデルごとの入力へ移す。Azure 専用セクションは接続設定のみに縮小する。
8. **チャット UI:** ベンダリング済み `PromptInputModelSelect*` を ChatSidebar に mount する。command-palette 型 `ModelSelector` は CSP 上の問題があり不採用とした。ユーザーの選択モデルは `UserUISettings`(DB) の `aiChatSelectedModelId` に永続化する。読取は新設のチャット用エンドポイントがサーバ側で許可検証した上で `selectedModelId`（前回選択 ?? デフォルト、常に存在）を返し、書込は既存の共有永続化サービスを使う（チャット専用の状態管理は持たない）。

---

## Introduction

本機能は GROWI の Mastra AI チャットを「1 App = 1 モデル固定」から「1 App = 管理者が許可した複数モデル」へ拡張する。管理者は AI 設定画面で利用を許可するモデルの集合 (各モデルに任意の provider オプションを付与可能) とデフォルトモデルを設定する。エンドユーザーはチャット画面のモデルセレクタから、許可されたモデルの中をメッセージ単位で選んで応答を得られる。プロバイダ (OpenAI / Anthropic / Google / Azure OpenAI のいずれか) と API キーは従来どおり App ごとに単一で、許可モデルはその同一プロバイダ内のモデルに限る。

## Boundary Context

- **In scope (本機能が担う)**:
  - 同一プロバイダ内における複数モデルの許可リスト設定 (管理者)。
  - 許可モデルごとの provider オプション設定。
  - チャット画面でのメッセージ単位のモデル選択 (エンドユーザー)。
  - ユーザーが選択したモデルの個人設定としての永続化（次回の初期選択に使用。`UserUISettings`）。
  - 選択モデルのサーバ側検証と、実際に使用するモデルへの provider オプションの一致適用。
  - 本機能が変更する既存仕様 (`ai-provider-settings`, `ai-provider-selection`) のドキュメント整合更新 (本 spec のタスクとして後続実施。実装タスク完了後に doc を同期し、現時点では他 spec のファイルは変更しない)。これは user-observable な要件ではなく spec 保守タスクのため、EARS 要件ではなくスコープ項目として扱う。
- **Out of scope (本機能は担わない)**:
  - 異なるプロバイダのモデルを 1 つの許可リストに混在させること (モデルごとに別プロバイダ/別 API キーを持つこと)。
  - 実行時にプロバイダやレジストリの API からモデル一覧を自動取得・補完すること（実行時ベンダー API 呼び出しは引き続きスコープ外）。カタログを持つプロバイダの許可リストは models.dev を取り込んだオフライン同梱カタログ (`model-catalog-data.json`) からの選択方式を採り、一覧提供自体は外部通信を伴わない（カタログの更新時〔管理画面手動／起動時／定期。起動時・定期は AI 機能有効時のみで既定日次〕に限り models.dev へ fetch する）。azure-openai、またカタログ取得に失敗した場合は自由入力。詳細は `.kiro/specs/ai-provider-model-picker`。
  - 会話 (スレッド) ごとの選択モデルをサーバに永続化すること (選択はメッセージ単位で、スレッドに保存しない)。
  - プロバイダ/API キーの設定方式そのものの変更。
  - 旧 `ai:model` / `ai:providerOptions`（および env `AI_MODEL` / `AI_PROVIDER_OPTIONS`）からの自動移行。これらは完全廃止し、運用者は `ai:allowedModels`（env `AI_ALLOWED_MODELS`）で再設定する（本機能はプレリリースのため後方互換移行を提供しない）。
- **Adjacent expectations (隣接前提・本機能は変更しない)**:
  - 既存の AI 有効性ゲーティング (AI 無効/未設定時にチャットを提供しない判定) を前提とし、そのまま維持する。
  - 既存のスレッド永続化・ストリーミング配信・チャットエラーのサニタイズ表示を前提とし、そのまま維持する。

## Requirements

### Requirement 1: 許可モデルリストの設定 (管理者)
**Objective:** 管理者として、利用を許可する複数のモデルを設定したい。そうすればユーザーが用途に応じてモデルを使い分けられ、かつ利用可能なモデルを統制できる。

#### Acceptance Criteria
1. When 管理者が AI 設定画面で 1 つ以上のモデル識別子を許可モデルとして登録して保存する, the AI 設定機能 shall それらを許可モデルの集合として永続化する。
2. When 管理者が許可モデルを追加または削除して保存する, the AI 設定機能 shall その変更を以降のチャットリクエストへ再起動なしで反映する。
3. The AI 設定機能 shall 許可モデルの集合のうち 1 つをデフォルトモデルとして保持する。
4. If 管理者が空のモデル識別子、または同一のモデル識別子を重複して登録する, then the AI 設定機能 shall 保存を拒否し、該当箇所にエラーを表示する。
5. If 管理者が既定モデルを 1 つも指定しない、または 2 つ以上指定する, then the AI 設定機能 shall 保存を拒否し、許可集合内から既定をちょうど 1 つ選ぶよう促す。
6. While env-only モード (環境変数のみで設定) が有効, the AI 設定機能 shall 許可モデルおよびデフォルトモデルの編集を読み取り専用にする。

### Requirement 2: モデルごとの provider オプション
**Objective:** 管理者として、provider オプションをモデルごとに設定したい。そうすれば reasoning 等のオプションを対応モデルにのみ適用でき、非対応モデルでのエラーを避けられる。

#### Acceptance Criteria
1. The AI 設定機能 shall 各許可モデルに対し任意の provider オプションを設定できるようにする。
2. Where ある許可モデルに provider オプションが設定されている, the チャットサーバ shall そのモデルを使用する応答生成に限りそのオプションを適用する。
3. When 管理者があるモデルの provider オプションを空のまま保存する, the AI 設定機能 shall そのモデルを「オプションなし」として保存する。
4. If 管理者が provider オプションに不正な JSON、または provider 名前空間形式でない値を入力する, then the AI 設定機能 shall 保存を拒否し、該当行にエラーを表示する。
5. The チャットサーバ shall すべてのモデルへ一律に適用されるグローバルな provider オプションを持たない (オプションは常に使用モデル単位で解決する)。

### Requirement 3: チャット画面でのモデル選択 (エンドユーザー)
**Objective:** エンドユーザーとして、チャット画面でモデルを選びたい。そうすれば質問の用途に応じてモデルを使い分けられる。

#### Acceptance Criteria
1. While チャットが利用可能, the チャット機能 shall 許可モデルの一覧を提示するモデルセレクタを表示する。
2. The チャット機能 shall モデルセレクタの初期選択を、ユーザーが前回選択したモデル（許可モデルの集合に含まれる場合）に、無ければデフォルトモデルにする。
3. When ユーザーがメッセージ送信前にモデルセレクタで別のモデルを選択する, the チャット機能 shall そのメッセージの応答生成に選択したモデルを使用させる。
4. When ユーザーが同一スレッドの会話途中でモデルを切り替える, the チャット機能 shall 以降のメッセージに切り替え後のモデルを使用させる。
5. While 許可モデルが 1 つだけ設定されている, the チャット機能 shall そのモデルを選択状態で表示する。
6. When ユーザーがモデルセレクタでモデルを選択する, the チャット機能 shall その選択をユーザー個人設定として永続化する（次回以降の初期選択に用いる）。
7. If 永続化されたユーザーの選択モデルが許可モデルの集合に含まれない, then the チャット機能 shall デフォルトモデルにフォールバックする。

### Requirement 4: 選択モデルの適用とサーバ側検証
**Objective:** システムとして、選択されたモデルを安全に適用したい。そうすれば許可外のモデルが使用されることを防げる。

#### Acceptance Criteria
1. When チャットメッセージが許可モデルの集合に含まれる選択モデル付きで送信される, the チャットサーバ shall その選択モデルで応答を生成する。
2. If 送信された選択モデルが許可モデルの集合に含まれない, then the チャットサーバ shall その選択モデルを使用せず、デフォルトモデルで応答を生成する。
3. When チャットメッセージにモデル指定が含まれない, the チャットサーバ shall デフォルトモデルで応答を生成する。
4. The チャットサーバ shall 応答生成に用いる provider オプションを、実際に使用するモデルに設定されたものと一致させる。
5. If 選択されたモデルがプロバイダ側で利用できずエラーになる, then the チャット機能 shall 機密情報を含まない安全なエラーメッセージを表示する。

### Requirement 5: 既存チャット資産の維持
**Objective:** 運用者として、本機能導入後も既存スレッドが従来どおり使えてほしい。

#### Acceptance Criteria
1. The チャット機能 shall 既存スレッドの読み込み・継続・ストリーミング表示を本機能導入後も従来どおり維持する。

> 注: 旧 `ai:model` / `ai:providerOptions`（env `AI_MODEL` / `AI_PROVIDER_OPTIONS`）からの自動移行は提供しない（本機能はプレリリースのため完全廃止し、運用者は `ai:allowedModels` で再設定する）。Boundary Context の Out of scope を参照。

### Requirement 6: AI 有効性ゲーティングの維持
**Objective:** 運用者として、AI が無効または未設定のときの挙動を変えたくない。

#### Acceptance Criteria
1. While AI 機能が無効または未設定, the チャット機能 shall チャットを提供しない (従来どおり)。
2. While AI 機能が無効または未設定, the AI 設定機能 shall 管理者による許可モデルおよびデフォルトモデルの設定を引き続き可能にする。
