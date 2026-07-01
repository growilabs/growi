# Gap Analysis: ai-settings-model-picker

_作成: 2026-07-01。requirements.md（Req 1–8）と既存コードベースの差分分析。実装判断ではなく、design フェーズへの情報提供が目的。_

すべて実コード／インストール済み `@mastra/core@1.41.0`（`dependencies` に `^1.32.1`）で確認済み。

## 1. 現状調査（Current State）

### 1.1 Admin AI Settings スタック（再利用可能な確立パターン）
- **ページ**: [pages/admin/ai.page.tsx](apps/app/src/pages/admin/ai.page.tsx) — `AiSettings` を `ssr:false` で dynamic import、`createAdminPageLayout`。
- **フォーム container**: [AiSettings.tsx](apps/app/src/features/mastra/client/admin/AiSettings.tsx) — react-hook-form + `FormProvider`、`useAiSettings().data` を `toFormValues` で seed、`buildUpdateRequest`→`save()`。
- **プロバイダ選択 + モデル欄ホスト**: [ProviderCommonSettings.tsx](apps/app/src/features/mastra/client/admin/ProviderCommonSettings.tsx#L83-L95) — reactstrap `<Input type="select">` に `AI_PROVIDERS.map()`。**選択のみ UI の直接の雛形**。
- **モデル入力（変更対象）**: [AllowedModelsField.tsx:234-242](apps/app/src/features/mastra/client/admin/AllowedModelsField.tsx#L234-L242) — `useFieldArray` の各行が `<Input type="text">`（`register('allowedModels.${index}.modelId')`）。行ラベルは `watch('provider')` で「モデル名」↔「デプロイ名」を切替済み（データ駆動の前例）。
- **SWR hook**: [use-ai-settings.ts](apps/app/src/features/mastra/client/admin/use-ai-settings.ts) — `useSWRImmutable(KEY, apiv3Get)` + `save`（`apiv3Put`→`mutate`）。
- **フォーム↔DTO 変換**: [ai-settings-form-values.ts](apps/app/src/features/mastra/client/admin/ai-settings-form-values.ts) — `toFormValues` / `buildUpdateRequest`、`allowedModels` は full-state-replace。

### 1.2 サーバ（route / config / resolver）
- **admin ルータ**: [admin-ai-settings/index.ts](apps/app/src/features/mastra/server/routes/admin-ai-settings/index.ts) — `factory(crowi)` が `router.get('/')` / `router.put('/')` を mount。**サブルート追加の受け皿**。`routerForAdmin.use('/ai-settings', factory(crowi))`（apiv3/index.js）配下。
- **admin GET の認可チェーン**: [get-ai-settings.ts:169-179](apps/app/src/features/mastra/server/routes/admin-ai-settings/get-ai-settings.ts#L169-L179) — `accessTokenParser([SCOPE.READ.ADMIN.AI])` → `loginRequiredFactory` → `adminRequiredFactory` → handler。**新 GET エンドポイントの雛形**。二段 `@swagger`（schema + path、enum フィールドあり）。
- **config アクセサ**: [llm-providers/config.ts](apps/app/src/features/mastra/server/services/ai-sdk-modules/llm-providers/config.ts) — `getApiKey` / `getAllowedModels`（`Array.isArray` ガード）/ `getDefaultModelId` / `resolveEffectiveModelId`（allow-list 検証の唯一のサーバ関門）。
- **provider→モデル生成（不変）**: [llm-providers/openai.ts:10-11](apps/app/src/features/mastra/server/services/ai-sdk-modules/llm-providers/openai.ts#L10-L11) — `createOpenAI({apiKey})(modelId)` に**素の modelId** を渡す。anthropic/google 同型、azure は deployment 名。
- **chat 側モデル一覧エンドポイント（最も近い前例）**: [get-models.ts](apps/app/src/features/mastra/server/routes/get-models.ts) — `GET /_api/v3/mastra/models` が `getAllowedModels().map(m=>m.modelId)` を返す。`ChatModelsResponse = { modelIds, selectedModelId }`、providerOptions は返さない（Security）。

### 1.3 型・DTO
- [ai-provider.ts](apps/app/src/features/mastra/interfaces/ai-provider.ts): `AI_PROVIDERS = ['openai','anthropic','google','azure-openai']` + `isAiProvider` 型ガード。**server-only** モジュール（client import 禁止のコメントあり）。
- [allowed-model.ts](apps/app/src/features/mastra/interfaces/allowed-model.ts): `AllowedModel = { modelId; providerOptions?; isDefault? }`、`isModelInAllowList`、`MAX_MODEL_ID_LENGTH=256`。
- [ai-settings.ts](apps/app/src/features/mastra/interfaces/ai-settings.ts): `AiSettingsResponse` / `AiSettingsUpdateRequest`（full-state-replace 明記）/ `AI_SETTING_KEYS`。
- [chat-models-response.ts](apps/app/src/features/mastra/interfaces/chat-models-response.ts): `string[]` を返す小さな wire 契約の前例。

### 1.4 Mastra 静的レジストリ（検証済みの一次資料）
- `@mastra/core/llm` が **公開 export**: `getProviderConfig` / `PROVIDER_REGISTRY` / `parseModelString` / `modelSupportsAttachments`（`dist/llm/index.d.ts:39`）。
- runtime 実測: `getProviderConfig('openai').models` = 52件、`anthropic` 23件、`google` 21件（すべて**接頭辞なし素ID**）。`getProviderConfig('azure' | 'azure-openai')` = **undefined**。
- read は通信ゼロ（埋め込みリテラル、fetch/fs なし）。GROWI は `@mastra/core` を現状**型のみ import**（値 import は未使用）。
- レジストリ JSON に**チャット/埋め込みの種別フラグは無い**（`models[provider]` は素ID配列）。`dist/capabilities/*.json` は capability→models[]（例: openai は `attachment` キー）で、multimodality の判別はできるが「chat か embedding か」の clean な flag ではない。

### 1.5 i18n
- 対象ロケール: `en_US / fr_FR / ja_JP / ko_KR / zh_CN`（[public/static/locales/*/admin.json](apps/app/public/static/locales)）。
- 既存キー: `ai_settings.model_label`（"Model name"）, `azure_model_deployment_label`（"Deployment name"）, `add_model`, `azure_add_deployment`, `provider_placeholder`（"Select a provider"）, `models_section_title/desc` 等。**新規に必要**: 選択プレースホルダ（"Select a model"）, 一覧空/取得失敗時の注記 等。

## 2. Requirement-to-Asset Map

| Req | 内容 | 既存資産 | ギャップ |
|---|---|---|---|
| 1 | カタログありは選択のみ | `ProviderCommonSettings` の `<select>` パターン、`AllowedModelsField` 行、`register` | **Extend**: 行の `<Input type="text">` を `<Input type="select">` に条件分岐。AC5（保存済みだが一覧外の値を保持）は選択肢に当該値を追加する必要 → **New(小)** |
| 2 | 通信ゼロのオフライン取得 | `getProviderConfig`（検証済み通信ゼロ） | **Reuse**。制約: 値 import 化で `.next/node_modules` externalization 要確認（`@mastra/core` は既に `dependencies`） → **Constraint** |
| 3 | カタログ無し/失敗時は自由入力 | 既存 `<Input type="text">`、`watch('provider')` 分岐前例 | **Extend**: `getProviderConfig(provider)==null`（azure 等）で従来 UI。取得失敗時 fallback → **New(小)** |
| 4 | 既存挙動の不変性 | resolver/認可/chat UI/`isAiConfigured` すべて不変 | **Reuse**（触らない方針の担保） |
| 5 | provider 切替で一覧追従 / 未設定時 | `watch('provider')`、SWR key を provider にする | **New**: provider をキーにした一覧取得（**保存前の form 値**で切替。永続 provider ではない点に注意） |
| 6 | chat 用途への絞り込み | レジストリに種別 flag 無し、`capabilities/*.json` は multimodality | **New + Research Needed**: 判別に clean な flag が無く heuristic 必須。手入力の逃げ道が無い分、品質が UX 直結 |
| 7 | 秘匿非漏洩 / admin 認可 / env-only | `SCOPE.READ.ADMIN.AI` チェーン、`get-models` の modelId-only 応答、`useOnlyEnvVars`→`disabled` | **Reuse**（新エンドポイントは同チェーンを踏襲、`string[]` のみ返す） |
| 8 | 既存スペック整合更新 | `.kiro/specs/mastra-multi-model-chat/*`, `.kiro/specs/multi-llm-provider/*` | **New(doc)**: requirements/design/research の該当記述を更新（実装タスクとして） |

## 3. 実装アプローチ Options

新機能は「既存 admin スタックへの薄い追加」であり、大枠は **Hybrid（C）** が自然。以下は主要な軸ごとの選択。

### 軸1: モデル一覧の取得元アクセサ
- **A（config.ts を拡張）**: `getSelectableModelIds(provider)` を [config.ts](apps/app/src/features/mastra/server/services/ai-sdk-modules/llm-providers/config.ts) に追加。✅ 近接・小差分。❌ config.ts は「configManager 読み取り」責務、こちらは「Mastra レジストリ読み取り＋フィルタ」で責務が異なる。
- **B（新モジュール）**: `ai-sdk-modules/model-catalog.ts`（`getProviderConfig` read + chat フィルタ + azure→空）。✅ 責務分離・単体テスト容易・Req 6 のフィルタロジックを局所化。❌ ファイル増。→ **推奨（B）**。

### 軸2: エンドポイント配置と応答形
- **A（AiSettingsResponse に相乗り）**: GET /ai-settings に `availableModels` を追加。❌ 一覧は**保存前の provider 選択**で変わる必要があり、永続 provider に紐づく GET とは更新タイミングが合わない。
- **B（独立サブルート）**: `router.get('/available-models', ...)` を [admin-ai-settings/index.ts](apps/app/src/features/mastra/server/routes/admin-ai-settings/index.ts) に追加 → `GET /_api/v3/ai-settings/available-models?provider=openai`。`SCOPE.READ.ADMIN.AI` チェーン踏襲。応答は `string[]`（`get-models` の modelId-only 前例に倣う）。✅ provider 単位・client の form 値で切替可。→ **推奨（B）**。

### 軸3: UI（AllowedModelsField）
- **Extend**: 行の modelId 入力を、`getProviderConfig(provider)!=null` かつ取得成功時は `<Input type="select">`、それ以外（azure/未設定/失敗）は現行 `<Input type="text">`。どちらも `register` で動く（`Controller` 不要）。AC5 は保存済み値を `<option>` に補って選択維持。✅ 既存 `<select>`/`register` 資産をそのまま使える。

### 軸4: client データ取得
- **New**: `useSWRxSelectableModels(provider)` を client/admin に新設（provider をキー、`useSWRImmutable`、`use-ai-settings` の型を流用）。provider 未選択時は fetch しない（Req 5.2）。

## 4. Effort & Risk

- **総合 Effort: M（3–7日）** — 既存 admin GET/PUT・form・SWR・`<select>` 資産が揃い、サーバ側は薄いアクセサ＋1エンドポイント。UI は1入力の条件分岐。doc 更新（Req 8）と 5 ロケールの i18n を含む。
- **総合 Risk: Low–Medium**
  - Low: 認可・DTO・form・resolver は確立パターンの再利用（Req 2,4,7,1 の骨格）。
  - Medium: **Req 6 のフィルタ heuristic**（clean flag 無し）と、**`@mastra/core` 値 import 化の Turbopack externalization**（要 build 後確認）。

## 5. Research Needed（design で解決）

1. **Req 6 フィルタ方針**: chat/embedding の clean flag が無い。(a) 名前 heuristic（`embedding|image|tts|whisper|dall-e|moderation|realtime|audio|deep-research` 等を除外）か、(b) `dist/capabilities/*.json`（`modelSupportsAttachments` 等）を判別に使えるか、(c) 過剰除外を避け素通し＋Req 6.2 に委ねるか。除外規則を1箇所の宣言データに。
2. **PUT 側の検証範囲（トレードオフ）**: 「client 値は信用しない」原則からは PUT で covered-provider の modelId をカタログ照合したくなるが、それは Req 1 AC5（保存済み一覧外の保全）と「将来モデルは native @ai-sdk で動く」事実、azure 自由入力と衝突する。→ **PUT はカタログ照合しない**（UI 制約のみ）方針の是非を design で確定。
3. **externalization 検証**: `@mastra/core` を値 import（SSR 実行）に変えた後、`turbo run build` → `ls .next/node_modules | grep @mastra` を確認（`dependencies` 済みだが挙動確認）。client バンドルに引き込まないため **read はサーバ限定**（interface は client-safe な `string[]` のみ）。
4. **エンドポイント詳細**: `?provider=` クエリの妥当性（`isAiProvider` 検証）、未対応 provider は空配列 or 明示フラグ、キャッシュ（静的なので `useSWRImmutable` で十分）。
5. **一覧のノイズ/規模**: openai 52件には日付版スナップショット（`gpt-4o-2024-05-13` 等）が含まれる。表示順・重複・上限の要否を design で判断（過剰キュレーションはしない前提）。
6. **i18n 新規キー**: 5 ロケール（en_US/fr_FR/ja_JP/ko_KR/zh_CN）に「モデル選択プレースホルダ」「一覧空/取得失敗の注記」を追加。
7. **Req 8 の具体差分**: `mastra-multi-model-chat`（requirements 確定判断・design Non-Goals）と `multi-llm-provider`（research D-2/D-3）の**編集箇所を design で特定**し、実装タスク化。

## 推奨（design フェーズへの申し送り）
- **アプローチ**: Hybrid。UI/認可/DTO/SWR は既存 admin パターンを **Extend/Reuse**、モデルカタログ読み取りは **新モジュール（B）+ 新サブルート（B）+ 新 SWR フック** を **New**。
- **キー決定**: (1) Req 6 フィルタの実装形、(2) PUT でカタログ照合しない方針の確定、(3) エンドポイント応答は `string[]`、(4) UI は provider により `<select>`／`<text>` を分岐（`register` ベース、`Controller` 不要）。
- **持ち越し研究**: 上記 Research Needed 1–7。

---

# Design Synthesis & Decisions (design phase, 2026-07-01)

_Discovery type: **Light（Extension）**。新規外部ライブラリなしのため WebSearch は省略。gap 分析（上記）と実コード確認で discovery は充足。_

## Synthesis（3レンズ）
- **Generalization**: 単一目的の read（provider→モデル一覧）。過度な一般化はしない。provider→models の一般化はレジストリ側で既済。
- **Build vs Adopt**:
  - モデル一覧 = **Adopt** `@mastra/core` `getProviderConfig`（既存 dependency・offline 検証済み）。手書き const（Build）は「Mastra から」に反し保守負担のため却下。
  - chat フィルタ = **Build**（小）。レジストリに chat/embedding の clean flag が無く、ライブラリも不要。宣言データ + 純関数。
  - UI = **Adopt** 既存 reactstrap `<Input type="select">` + `register`。typeahead/downshift/datalist は不要（選択のみ確定のため）。
  - 取得 = **Adopt** `useSWRImmutable`。
- **Simplification**:
  - provider→registry-key マッピング表を作らない（openai/anthropic/google は名称一致、azure-openai は `getProviderConfig` が `undefined` を返す）。
  - `Controller` 不要（native `<select>` は `register` で動く）。
  - `GET /ai-settings` に相乗りさせない（一覧は保存前の form provider に追従する必要があるため独立エンドポイント）。
  - `AiProvider`/`isAiProvider`/`AllowedModel` を再利用（新規 provider enum を作らない）。

## 解決した決定（gap 分析の Research Needed の確定）
- **D1（Req6 フィルタ）**: 名前パターンによる除外（`embedding|image|tts|whisper|dall-e|moderation|realtime|audio|transcribe` 等）を `chat-model-filter.ts` に宣言データ化。判別不能は除外しない（6.2）。
- **D2（PUT 検証範囲）**: PUT は **カタログ membership を検証しない**。理由: (a) 保存済み一覧外 ID の保全（1.5）、(b) native `@ai-sdk` は任意 ID を受理し将来モデルも動く、(c) azure 自由入力、(d) バージョン drift。カタログ制約は UI アフォーダンスであり server 不変条件ではない。既存 PUT 検証（単一 isDefault・providerOptions JSON）は不変。
- **D3（エンドポイント）**: `GET /_api/v3/ai-settings/available-models?provider=<AiProvider>`、admin 認可、`SelectableModelsResponse { modelIds }`、azure は `200 { modelIds: [] }`、不正 provider は 400、aiReadyGuard なし。
- **D4（externalization）**: `@mastra/core` を型のみ→値 import（server 限定）。既に `dependencies`。prod ビルド後 `.next/node_modules` を確認（Revalidation Trigger）。client は `string[]` と `AiProvider` のみ参照し `@mastra/core` を client バンドルに入れない。
- **D5（UI 状態）**: provider 空/error/空一覧 → 自由入力、非空 → `<select>`、ロード中 → disabled。保存済み一覧外値は補完 option（1.5）。フィールド単位で1回 fetch。
- **D6（i18n）**: `ai_settings.model_select_placeholder` 等を 5 ロケール（en_US/ja_JP/fr_FR/ko_KR/zh_CN）へ追加。
- **D7（Req8 具体差分）**: `mastra-multi-model-chat`（requirements 確定判断・design Non-Goals）と `multi-llm-provider/research.md`（D-2/D-3）を編集対象として実装タスク化。

## 統合リスク（Light discovery）
- Medium: `@mastra/core` 値 import の Turbopack externalization（要 prod ビルド検証）／chat フィルタ heuristic の品質。
- Low: 認可・DTO・form・SWR は確立パターンの再利用。既存挙動は不変（4.x を回帰テストで担保）。
