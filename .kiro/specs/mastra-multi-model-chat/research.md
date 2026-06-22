# ギャップ分析: mastra-multi-model-chat

> 対象ブランチ: `support/mastra` / 分析日: 2026-06-20
> 目的: 「1 App = 複数 LLM モデル」要件 (requirements.md) と既存コードの差分を洗い出し、設計フェーズの実装戦略を決める材料にする。

## サマリ
- 既存の Mastra AI チャットは **単一プロバイダ + 単一モデル** の一本道カスケード (config → `resolveMastraModel` 単一メモ → `growiAgent.model` 関数 → `stream`)。複数モデル化は各段に明確な接合点がある。
- **再利用できる土台が厚い**: 動的モデル関数 (Mastra@1.41 で検証済み)、RequestContext の既存プラミング、配列/オブジェクト config キーの前例とローダー対応、ベンダリング済みモデルセレクタ UI、providerOptions の FE/BE 共有バリデータ。ゼロから作る要素は少ない。
- **新規に必要な主なギャップは 3 つ**: (1) per-model 構造の config + 管理リストエディタ UI、(2) チャットクライアントへ許可リストを供給する経路 (現状なし)、(3) サーバ側の許可リスト検証 (`resolveEffectiveModel`)。
- 総合: **Hybrid アプローチ**（サーバ解決とconfigは既存を拡張、管理UIとクライアント供給経路は新規）。総工数 **M〜L**、総合リスク **Medium**（個々は Low、注意点は Azure+Entra のトークンキャッシュ維持とクライアント供給経路の選定）。

---

## 1. 現状調査 (Current State)

### 単一モデルのカスケード (変更対象の接合点)
```
管理フォーム(ModelField 自由入力) + providerOptions テキストエリア
 → PUT /_api/v3/ai-settings (model:string, providerOptions:string)
  → config: ai:model(単一文字列) / ai:providerOptions(単一JSON文字列)
   → growiAgent.model = () => resolveMastraModel()        ← requestContext 無視
    → resolveMastraModel(): ai:provider 検証 → modelResolvers[provider]() → 単一メモ化
     → resolve*Model(): create*({apiKey})(requireModel())  ← requireModel() が ai:model を読む
      → growiAgent.stream(messages, { requestContext, memory, providerOptions: resolveProviderOptions() })
```

### 主要アセットと規約
- **config 定義/ローダー**: `config-definition.ts`（`ai:*` キー :1276-1329、env-only グループ :1593-1601、配列キー前例 `security:registrationWhitelist` :777）。`config-loader.ts` は `typeof defaultValue === 'object'` で env 値を `JSON.parse`（:77-79）、DB 値も `JSON.parse`（:56）。→ **オブジェクト配列キーはローダー対応済み**（`ai:azureOpenaiSettings` が前例）。
- **管理 API 契約**: `interfaces/ai-settings.ts`（`AiSettingsResponse`/`AiSettingsUpdateRequest`、`AI_SETTING_KEYS` :66-73、FULL-STATE-REPLACE セマンティクス）。
- **管理ルート**: `get-ai-settings.ts`（:124 で `ai:model` 読取、scope `READ.ADMIN.AI`、ai-ready ガードなし）。`put-ai-settings.ts`（`clearableConfigString` バリデータ、`buildUpdates`、env-only 422 ゲート :310、`clearResolvedMastraModelCache()` :335、provider 変更時の apiKey クリア）。
- **管理 UI**: `AiSettings.tsx`（単一 FormProvider・FULL-STATE-REPLACE PUT）、`ProviderCommonSettings.tsx`（provider/apiKey、非 Azure 時のみ model :138-140、providerOptions textarea :142-179）、`AzureOpenaiSettings.tsx`（Azure 時のみ model=デプロイ名 :57-60 + 接続設定）、`ModelField.tsx`（`labelKey` prop で provider 別ラベル）、`ai-settings-form-values.ts`（`model:string`/`providerOptions:string`）。
- **モデル解決**: `resolve-mastra-model.ts`（単一スロット `let memoizedModel` :17-38）、`llm-providers/{config.ts(requireModel :23-29), index.ts(modelResolvers :20-25), openai/anthropic/google/azure-openai}.ts`、`resolve-provider-options.ts`（モデル非依存 :27、FE/BE 共有バリデータ `provider-options-validation.ts` を再利用）。
- **エージェント/コンテキスト**: `growi-agent.ts`（`model: () => resolveMastraModel()` :29）、`mastra-modules/types/request-context.ts`（`MastraRequestContextShape = { user, searchService }` :20-23）。Mastra@1.41 の Agent `model` は `DynamicArgument` で `({ requestContext }) => ...` を受ける（検証済み）。`stream()` の call-time `model` オーバーライドも可。
- **チャットサーバ**: `post-message.ts`（`RequestContext` 構築・set :70-77、`stream(messages,{requestContext,memory,providerOptions})` :80-94、providerOptions :93）、`post-message-validator.ts`（`threadId`/`messages` のみ :13-24）。
- **チャットクライアント**: `ChatSidebar.tsx`（transport を `[chatThreadId]` でメモ化、`useChat`、`regenerate()`）、`chat-sidebar-helpers.ts`（`DefaultChatTransport`・body は `{threadId}` のみ :13-45）、`components/ai-elements/prompt-input.tsx`（`PromptInputModelSelect*` :1199-1252、shadcn Select ラッパ・ベンダリング済み）。`ChatSidebarLazyLoaded` は `BasicLayout.tsx:75` で常駐。
- **規約**: feature ベース構成、Jotai(UI)/SWR(server)、named export、テスト co-located（`*.spec.ts(x)`）、`mock<T>()` 使用。

### 統合面 (Integration Surfaces)
- データ: MongoDB config（`config-loader` 経由）。スレッド/メッセージは Mastra memory（MongoDB）。
- 認証/scope: 管理 API は `READ/WRITE.ADMIN.AI`、チャット API は `WRITE.FEATURES.AI` + login required。
- クライアント供給: チャットクライアントは**現状 AI 設定を一切取得していない**（stream のみ）。許可リストを渡す経路が要新設。

---

## 2. 要件→アセット対応表（ギャップタグ: Missing / Unknown / Constraint）

| 要件 | 既存アセット | ギャップ |
|---|---|---|
| **R1 許可リスト設定/デフォルト/重複・空・整合検証/再起動なし反映/env-only** | config 定義+ローダー(配列対応)、`get/put-ai-settings`、`AiSettings` フォーム、`clearResolvedMastraModelCache` | **Constraint**: `ai:allowedModels` をオブジェクト配列で追加（ローダー対応済）。PUT の FULL-STATE-REPLACE に配列バリデータ追加、`buildUpdates` 拡張、`AI_SETTING_KEYS`/env-only targetKeys 更新。デフォルト=`ai:model` 整合チェックは **Missing**（新規バリデーション） |
| **R2 モデルごと providerOptions/不正JSON拒否/グローバル廃止** | `provider-options-validation.ts`（FE/BE 共有）、現 `ai:providerOptions`(単一) | **Constraint**: 同梱構造化。検証は既存バリデータを各エントリへ再利用。`resolveProviderOptions()`→`(modelId)` 化は **Missing**。グローバル `ai:providerOptions` 廃止＝移行が必要 |
| **R3 チャットのモデルセレクタ/初期=デフォルト/メッセージ・途中切替** | `PromptInputModelSelect*`（ベンダリング済）、`ChatSidebar`/`useChat` | **Missing**: セレクタの mount + 状態管理 + `sendMessage(...,{body:{modelId}})`。**Missing**: 許可リストをクライアントへ供給する経路（現状なし） |
| **R4 選択モデル適用/許可外フォールバック/未指定=デフォルト/options一致/エラー安全表示** | `post-message`(RequestContext/stream)、動的モデル関数、既存エラーサニタイズ | **Missing**: `resolveEffectiveModel(modelId?)`（許可検証+フォールバック）。**Constraint**: `growi-agent.model` を `({requestContext})=>...` 化、`resolveMastraModel(modelId?)`+Map 化、validator/route に `modelId` 追加、`request-context.ts` に `modelId?` |
| **R5 後方互換/単一モデルのシード/グローバルoptions引継/既存スレッド維持** | 既存 `ai:model`/`ai:providerOptions`、Mastra memory | **Missing**: 移行ロジック（読取時フォールバック or マイグレーション）。スレッド/ストリーミングは無改変で維持（Constraint=触らない） |
| **R6 AI 無効/未設定時の挙動維持** | `isAiReady()` SSR ゲート、`ai-ready-guard.ts` | **Constraint**: 変更しない。管理側は ai-ready ガードなしで設定可（現状どおり） |

---

## 3. 実装アプローチ（A/B/C）

総合は **Hybrid（C）** を推奨。領域別に最適形が異なるため、主要領域ごとに選択肢を示す。

### 3-1. サーバのモデル解決（R4/R2 中核）
- **A 既存拡張（推奨）**: `growi-agent.model` を `({requestContext})=>resolveMastraModel(requestContext.get('modelId'))` に。`resolveMastraModel(modelId?)` + Map キャッシュ。`requireModel()`→`resolveEffectiveModel(modelId?)`（許可検証）。各 resolver は model 文字列を引数受け取りに（provider ファクトリは1個使い回し）。`resolveProviderOptions(modelId)` 化。
  - ✅ 既存プラミング(RequestContext)再利用、解決ロジックが一箇所
  - ❌ 単一メモ→Map 化で Azure+Entra のトークンキャッシュ維持に注意（モデルオブジェクト単位でキャッシュ）
- **B 新規（stream-time override）**: route で `resolveEffectiveModel` してから `stream(messages,{model})`。agent 定義は触らない。
  - ✅ agent/RequestContext 変更不要・最小
  - ❌ providerOptions も別途渡す必要、解決経路が route に散る
- **採用**: A（要件の「options をモデルに一致」「許可検証集約」と最も整合）。

### 3-2. config & 管理 API（R1/R2/R5）
- **A 既存拡張（推奨）**: `ai:allowedModels` をオブジェクト配列で追加、`ai:providerOptions` 廃止、`ai:model`=デフォルト維持。`get/put-ai-settings` と型を拡張。
  - ✅ ローダー/PUT セマンティクス/キャッシュ無効化を流用
  - ❌ FULL-STATE-REPLACE の配列バリデーション・移行ロジックを丁寧に
- 移行は 3-5 参照。

### 3-3. 管理 UI（R1/R2、Azure 統合）
- **B 新規コンポーネント（推奨）**: `ModelField.tsx` を `AllowedModelsField.tsx`（`useFieldArray` のリストエディタ）に置換し、**`ProviderCommonSettings` に単一配置**（Azure 専用セクションのモデル欄を共通へ統合、ラベルは `provider` watch で「デプロイ名/モデル」切替）。各行=モデルID+既定ラジオ+折りたたみ providerOptions JSON（既存バリデータ流用）+削除。共通の providerOptions textarea は廃止。
  - ✅ 複数行 UI として責務が明確・単一マウント
  - ❌ provider 依存ラベル分岐を共通側に許容（過去の意図的分割を反転）。`ai-settings-form-values` の作業コピー型変更（`allowedModels:{model;providerOptionsText}[]`+`defaultModel`）と保存時パース

### 3-4. チャットへの許可リスト供給（R3）— 要設計判断
チャットクライアントは現状 AI 設定を取得しないため、新経路が必要。
- **B1 新規チャット用エンドポイント（推奨）**: `GET /_api/v3/mastra/models`（login+WRITE.FEATURES.AI、許可リスト+デフォルトのみ返す）。
  - ✅ 管理 API（admin scope）を流用せず最小公開、許可外を晒さない
  - ❌ ルート1本追加
- **B2 SSR プロップ**: ページの `getServerSideProps` で `crowi` 経由（`isAiReady()` 同様）に注入。
  - ✅ 追加 fetch なし
  - ❌ チャットは全ページ常駐（BasicLayout:75）なので注入箇所が広い／設定変更の即時反映が弱い
- **B3 既存 SWR への相乗り**: AI 関連の client store がチャット側には無い（admin の `use-ai-settings` は admin scope）。新規が無難。
- **採用候補**: B1。**Research Needed**: クライアントが既に持つブートストラップ情報（aiReady 等）の供給形を設計時に確認し、相乗りできるなら B2 寄りに。

### 3-5. チャット UI 配線（R3）
- **A 既存拡張（推奨）**: `ChatSidebar` に `useState(defaultModelId)` + `PromptInputModelSelect*` を mount。`sendMessage({text},{body:{modelId}})` で per-call 送信（transport は `[chatThreadId]` メモ化のため body 同梱は不可→per-call）。`chat-sidebar-helpers` の body 型に `modelId?` 追加。
  - ✅ ベンダリング済み部品・新規導入なし
  - ❌ ChatSidebar は現状モデルセレクタを持たないので入力ツールバー構成の追加が要る

---

## 4. 工数・リスク

| 領域 | 工数 | リスク | 根拠 |
|---|---|---|---|
| サーバ解決（動的モデル+Map+検証+options/モデル化） | M | Medium | 既存パターン拡張だが Azure+Entra トークンキャッシュ維持と全 resolver 改修の波及 |
| config & 管理 API | S〜M | Low | ローダー/前例あり。配列バリデータと FULL-STATE-REPLACE 注意 |
| 管理 UI（リストエディタ+Azure 統合） | M | Medium | `useFieldArray`+per-row JSON+ラベル切替+フォーム型変更 |
| チャット供給経路 | S | Low〜Medium | 経路選定（B1/B2）が未確定＝設計で確定 |
| チャット UI 配線 | S | Low | 部品はベンダリング済み |
| 後方互換/移行 | S〜M | Medium | 読取時フォールバック vs マイグレーションの選定とテスト |
| **総合** | **M〜L** | **Medium** | 個々は Low 多め、注意点は限定的 |

---

## 5. 設計フェーズへの申し送り

### 推奨アプローチ（暫定）
- サーバ解決=3-1 A、config/API=3-2 A、管理UI=3-3 B、供給経路=3-4 B1、チャットUI=3-5 A、移行=下記。

### 設計で確定すべき決定 / Research Needed
1. **チャットへの許可リスト供給経路**（B1 新規エンドポイント / B2 SSR / 既存ブートストラップ相乗り）。クライアントが持つ既存 AI 情報の供給形を確認して確定。
2. **後方互換の移行方式**: (a) 読取時フォールバック（`ai:allowedModels` 空かつ `ai:model` 有→デフォルト兼1エントリ扱い、旧 `ai:providerOptions` を既定エントリに合成）か、(b) ワンタイム migration（`apps/app` のマイグレーション機構を使用）か。読取時フォールバックは無破壊だが毎回合成、migration は一度きりだが失敗時設計が要る。
3. **許可外 modelId の挙動**: requirements R4.2 は「デフォルトにフォールバック」を採用済み。設計でログ出力方針（監査）を確定。
4. **Map キャッシュのキーと無効化**: key=実効 modelId（provider 単一前提）。`clearResolvedMastraModelCache()` は Map 全消去で既存呼び出し元（PUT/`model-config-sync`）と整合。Azure+Entra のトークンキャッシュをモデルオブジェクト単位で保持できることを確認。
5. **i18n キー**: モデル/デプロイ名ラベル、追加/削除/既定、providerOptions ヘルプ等の新規キー（`admin` namespace）。
6. **PUT の FULL-STATE-REPLACE と配列**: 空配列 `[]` の意味（=許可なし）と「未指定=env デフォルト復帰」の区別、`removeIfUndefined` との整合。

### 関連既存 spec の整合更新（本 spec のスコープ・タスク化）
本機能は以下 2 spec が記述する領域を変更するため、これらの spec ドキュメントの整合更新を **mastra-multi-model-chat のタスクとして** 行う（実装タスク完了後に doc を同期）。**今すぐ他 spec のファイルは変更しない。** tasks フェーズで明示タスク化する。

- **admin-ai-settings**（`tasks-generated` / `ready_for_implementation: true`＝実装済み）: 以下の記述を更新。
  - `ai:model`（単一自由入力）→ デフォルトモデルとして維持しつつ `ai:allowedModels` を追加。
  - `ai:providerOptions`（単一 textarea）→ 廃止し per-model（各許可モデルに同梱）へ。
  - `ai:*` キー一覧・`AI_SETTING_KEYS`・env-only `targetKeys`（`ai:allowedModels` 追加 / `ai:providerOptions` 除去）。
  - GET/PUT 契約（`AiSettingsResponse`/`AiSettingsUpdateRequest`）。
  - 管理 UI（`ModelField` → 許可モデルリストエディタ、Azure モデル欄を共通設定へ統合）。
- **multi-llm-provider**（`tasks-generated` / `ready_for_implementation: false`＝未実装）: 以下の記述を更新。
  - 単一モデル解決（`resolveMastraModel` 単一メモ・`requireModel`）→ model パラメータ化 + Map キャッシュ + `resolveEffectiveModel`。
  - provider options の単一 env JSON → per-model 解決（`resolveProviderOptions(modelId)`）。
  - Boundary の「per-request 切替は Out of scope（ユーザー/リクエスト単位の切り替えを含む）」記述に、「**モデル単位（同一ベンダー内）の per-request 選択は mastra-multi-model-chat で扱う**（ベンダー単位の切替は引き続き対象外）」旨を追記し、両 spec の境界整合を明示。

### 設計シンセシス / 確定事項（design フェーズで決定）
- **Generalization**: 6 要件は「あるチャットリクエストの実効モデルとその providerOptions を、許可リスト + デフォルトから解決し、サーバ側で検証する」という単一能力の variation。中核を `resolveEffectiveModel(modelId?)` + `resolveProviderOptions(modelId?)`（同一の `ai:allowedModels`/`ai:model` を読む）に集約する。
- **Build vs Adopt（全て Adopt）**: 動的モデル関数（Mastra@1.41）、ベンダリング済み `PromptInputModelSelect*`、既存 `isProviderNamespacedObject`/`isValidProviderOptionsJson`、config-loader のオブジェクト配列対応、react-hook-form `useFieldArray`。新規ビルドは「許可リスト型・リストエディタ UI・チャット用モデル一覧エンドポイント」のみ。
- **Simplification**: グローバル providerOptions 廃止（per-model 化）。会話固定の永続化なし（per-message）。
- **移行方式（決定・更新）= 自動移行なし（破壊的）。** 当初は読取時フォールバックを検討したが、ユーザー決定により旧 `ai:model` / `ai:providerOptions`（env `AI_MODEL` / `AI_PROVIDER_OPTIONS`）を **config 定義ごと完全削除**する。本機能はプレリリース（Mastra AI チャット未リリース・`multi-llm-provider` 未実装）で移行対象が無いため後方互換移行を持たない。`getAllowedModels()` は `configManager.getConfig('ai:allowedModels') ?? []` のみ（合成なし）。運用者は `ai:allowedModels` / `AI_ALLOWED_MODELS` で再設定。DB に残る旧キー値は未定義キーとして無視。
- **`ai:model` / `ai:providerOptions` の扱い（決定・更新）= 完全廃止。** config 定義・env 名・`AI_SETTING_KEYS`・管理 UI/PUT・グローバル適用のすべてから削除し、legacy 読取も行わない（mastra 機能以外は両キーを参照していないことを grep で確認済み）。
- **チャットへの許可リスト供給（決定）= 新規 chat-scoped エンドポイント B1**: `GET /_api/v3/mastra/models` が `{ models: {id,name}[], defaultModelId }` を返す（providerOptions はクライアントへ送らない）。管理用 available-models は新設しない（要件どおりベンダー API も叩かない）。
- **Map キャッシュキー（決定）**: `${provider}:${effectiveModel}`。provider 単一前提だが将来の provider 変更に頑健。`clearResolvedMastraModelCache()` は Map 全消去（PUT / `model-config-sync` の既存呼出と整合）。Azure+Entra のトークンキャッシュはキャッシュされたモデルオブジェクト内に保持されるため維持される。
- **既定モデルの保持（決定・更新）**: 別キー `ai:model` ではなく `ai:allowedModels` 各エントリの `isDefault` フラグ（リスト内 1 つ）で既定を表す。「既定 ∈ 許可集合」の相互検証が不要（既定は本質的にリストの一員）。`ai:model` / `ai:providerOptions` は **完全廃止**（legacy 残置もしない）。既定解決 = `find(isDefault) ?? 先頭`。`isAiConfigured()` を `provider + apiKey + 非空 allowedModels` に更新（先のレビュー Critical Issue 2 を解消）。
- **regenerate のモデル保持（決定）**: `modelId` は per-call ではなく **transport body に固定**し、`modelId` 変更時に transport を再生成する。`sendMessage` / `regenerate()` の双方で現在の選択モデルが送られる（per-call body だと `regenerate()` が modelId を落とす問題への対応＝レビュー Critical Issue 1）。
- **チャットへの許可リスト供給（確定）**: 新 `GET /_api/v3/mastra/models` を既存 mastra クライアントと同じ SWR+`apiv3Get` で取得（`useSWRINFxRecentThreads`/`useSWRxMessages` と同型）。SSR/ブートストラップで AI 設定をチャットへ渡す経路は無いことを確認（ChatSidebar は status atom + SWR のみ・開いた時に lazy mount）→ 相乗り不可、専用エンドポイントが唯一の手段。`routes/index.ts` の `router.use(aiReadyGuard)` で全 mastra ルートが一括ゲートされるため `/models` も自動で「有効かつ構成済み」時のみ応答。scope は get-threads 同様 login + `READ.FEATURES.AI`。
- **ユーザー選択モデルの永続化（決定）= DB（`UserUISettings`）**: localStorage も検討したが、GROWI は個人 UI 設定を `UserUISettings`（user 単位 unique・SSR ハイドレート・`scheduleToPut` デバウンスバルク PUT）で持つ正準パターンがあり、prefs の localStorage 化は flicker で無効化した経緯（`stores/editor.tsx`）もあるため DB を採用（クロスデバイス一貫）。`IUserUISettings` に `aiChatSelectedModel?: string` を追加し、sidebar atom と同型の atom（setter→`scheduleToPut({ aiChatSelectedModel })`）+ SSR ハイドレートで実装。初期選択は許可リスト検証して `saved ?? default`。サーバ側のリクエスト単位検証（`resolveEffectiveModel`）はこの永続値とは独立に維持。

### 持ち越す既知挙動
- ツール呼び出し/結果パートはスレッド再読込後も復元（`convertMessages`→output-available）。チャット UI 派生はこれ前提。
- ストリーミング/エラーサニタイズ（`resolveChatErrorMessage`、`pipeUIMessageStreamToResponse`）は無改変で維持。
