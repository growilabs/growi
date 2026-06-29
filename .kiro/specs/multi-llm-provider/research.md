# Gap Analysis: multi-llm-provider

_生成日: 2026-06-10 / 対象要件: requirements.md (Requirement 1–5)_

## 分析サマリ

- **現状**: mastra チャットエージェント（`growiAgent`）は OpenAI 専用。プロバイダー生成（`createOpenAI`）・モデル選択・API キー取得がモジュール読み込み時（import 時）にハードコードされており、ベンダー切り替えの抽象化が一切ない。
- **設定基盤は再利用可能**: `defineConfig<T>({ envVarName, defaultValue, isSecret })` と Union 型設定（`openai:serviceType: 'openai'|'azure-openai'`）の前例があり、ベンダー選択キー・ベンダー別キーを同じ仕組みで追加できる。環境変数のみの構成（Req 2）と整合する。
- **最大の構造的ギャップ**: エージェントは**モジュール読み込み時に singleton 生成**され、`getOpenaiProvider()` は設定不備時に `throw` する。Req 4（設定不備でも**アプリ起動継続**＋mastra のみ無効化＋ログ）を満たすには、生成を**遅延化／ガード化**して import 時に throw しない構造へ変える必要がある。
- **ユーザーの設計論点（ai-sdk vs @mastra/core）には明確な選択肢がある**: Mastra v1.x の `Agent.model` は (a) ルーター文字列 `"provider/model"`、(b) 明示 `apiKey` を渡せる設定オブジェクト `{ id, apiKey, url, headers }`、(c) AI SDK の LanguageModel オブジェクト、の 3 形式を受け付ける。**Approach B（Mastra ルーターのオブジェクト形式）**なら新規依存ゼロかつ明示的キー注入が可能。**Approach A（`@ai-sdk/anthropic` / `@ai-sdk/google` を導入）**は推論オプション等の型付き制御が最も強い。
- **スコープ確認済み**: suggest-path は独自の client-delegator 経由で LLM を呼びており mastra プロバイダーから独立。Req 5（mastra 限定・他機能据え置き）は技術的に成立する。

---

## 1. 現状調査（Current State）

### 1.1 設定定義パターン
`apps/app/src/server/service/config-manager/config-definition.ts`

```typescript
'app:aiEnabled': defineConfig<boolean>({ envVarName: 'AI_ENABLED', defaultValue: false }),
'openai:serviceType': defineConfig<'openai' | 'azure-openai'>({ envVarName: 'OPENAI_SERVICE_TYPE', defaultValue: 'openai' }),
'openai:apiKey': defineConfig<string | undefined>({ envVarName: 'OPENAI_API_KEY', defaultValue: undefined, isSecret: true }),
'openai:assistantModel:mastraAgent': defineConfig<OpenAI.Chat.ChatModel>({ envVarName: 'OPENAI_MASTRA_AGENT_MODEL', defaultValue: 'o4-mini' }),
```

- `defineConfig<T>` は `@growi/core`（`packages/core/src/interfaces/config-manager.ts`）由来。フィールドは `envVarName?`, `defaultValue: T`, `isSecret?`。
- **Union 型設定の前例あり**: `openai:serviceType`。検証は `apps/app/src/features/openai/interfaces/ai.ts` の `OpenaiServiceType` enum/`OpenaiServiceTypes` 配列で行う（`certify-ai-service.ts` が `includes()` で妥当性チェック）。
- **モデル型は OpenAI 専用**: `OpenAI.Chat.ChatModel`（`openai` npm パッケージのリテラル Union）。多ベンダー化には `string` 等へ一般化が必要。

### 1.2 設定の読み込み・env 解決
`apps/app/src/server/service/config-manager/config-loader.ts` / `config-manager.ts`

- env 値は `typeof defaultValue` に基づき型変換（boolean/number/object）。`getConfig(key)` の優先順位は「env-only グループは env のみ／それ以外は DB 値 ?? env 値」。
- **起動時の設定妥当性検証は存在しない**。不備は `getOpenaiProvider()` の初回呼び出し時に `throw` される（lazy）。

### 1.3 mastra プロバイダー／エージェントの結線
- `apps/app/src/features/mastra/server/services/ai-sdk-modules/get-openai-provider.ts`
  - `createOpenAI({ apiKey })` の singleton。`isAiEnabled()===false` または `apiKey==null` で `throw new Error('GROWI AI is not enabled')`。
- `apps/app/src/features/mastra/server/services/mastra-modules/agents/growi-agent.ts`
  - **module-level で `new Agent({ ..., model: getOpenaiProvider()(model) })`**。`model` は import 時に `configManager.getConfig('openai:assistantModel:mastraAgent')` で確定 → **ベンダー／モデル変更にはサーバー再起動が必要**。
- `mastra-modules/index.ts`: `new Mastra({ agents: { growiAgent } })`。
- リクエスト時は `mastra.getAgent('growiAgent')`（`server/routes/post-message.ts`）で取得。

### 1.4 AI 有効化ゲート
- `apps/app/src/features/openai/server/services/is-ai-enabled.ts`: `configManager.getConfig('app:aiEnabled')`。
- ルーター: `mastra/server/routes/index.ts` で `!isAiEnabled()` のとき全ルートを **501** で短絡。
- ミドルウェア `openai/server/routes/middlewares/certify-ai-service.ts`: AI 無効なら **403**、`serviceType` 不正なら **403**。

### 1.5 suggest-path（独立経路・Req 5 の対象外）
- `features/ai-tools/suggest-path/server/services/call-llm-for-json.ts` が `features/openai/server/services/client-delegator`（`get-client.ts`）経由で OpenAI/Azure を呼ぶ。**mastra プロバイダーとは別経路**で、本仕様では据え置き可能。

### 1.6 テスト
- 設定: `config-manager.spec.ts` / `config-loader.spec.ts` / `config-definition.spec.ts`
- mastra: `mastra-modules/agents/growi-agent.spec.ts`（configManager・Agent・provider を `vi.mock`）, `routes/post-message.spec.ts`
- 方針: Vitest + `vi.mock()`。実 API 呼び出しは行わずモック。

### 1.7 依存パッケージ（`apps/app/package.json`）
- 導入済: `@ai-sdk/openai ^3.0.63`, `@ai-sdk/react ^3.0.178`, `@mastra/core ^1.32.1`, `@mastra/ai-sdk ^1.4.1`, `@mastra/memory`, `@mastra/mongodb`, `@azure/openai ^2.0.0`, `openai ^4.96.2`。
- **未導入**: `@ai-sdk/anthropic`, `@ai-sdk/google`。

---

## 2. Requirement-to-Asset マップ

| 要件 | 既存資産 | ギャップ | タグ |
|---|---|---|---|
| **R1** ベンダー選択（OpenAI/Anthropic/Google・明示必須・既定なし） | `openai:serviceType` Union 型の前例 | ベンダー選択キー（例 `ai:provider` の `'openai'\|'anthropic'\|'google'`）が無い。未指定＝設定不備として扱う分岐が無い | Missing |
| **R2** env による接続設定（ベンダー/APIキー/モデル、モデルは任意・既定あり） | `defineConfig`／`OPENAI_API_KEY`／`OPENAI_MASTRA_AGENT_MODEL`、`isSecret` | Anthropic/Google の APIキー・モデルキーが無い。モデル型 `OpenAI.Chat.ChatModel` は OpenAI 限定で要一般化 | Missing / Constraint |
| **R2-5** APIキーをログ等に出さない | `isSecret: true` で DB マスキング | エラーログ整形時に値を含めない実装規律が必要（既存 throw メッセージは値非出力で良好） | Constraint |
| **R3** 1 App = 1 ベンダー | singleton provider/agent | ベンダー選択値で 1 つに解決するロジックが必要（複数キー併存時も選択 1 つのみ使用） | Missing |
| **R4** 不備時に無効化＋ログ＋アプリ継続＋チャットはエラー応答 | 501/403 のゲート機構、`isAiEnabled` | **import 時 singleton 生成＋throw** が起動継続と矛盾。遅延化／ガード化が必須。「未指定/不正/欠落」を判別しログ出力する経路が無い | **Missing / Constraint（最重要）** |
| **R5** mastra 限定・他機能据え置き | suggest-path は独立経路 | 影響範囲を mastra に閉じる設計が必要（既存 `openai:*` キーを openai ベンダーで再利用する場合の名前衝突に留意） | Constraint |

---

## 3. 技術的論点: LLM クライアント生成方式（ユーザー指定の検討事項）

Mastra v1.x の `Agent.model`（型 `MastraModelConfig`）は次の 3 形式を受け付ける（出典: mastra.ai/docs/agents/overview, mastra.ai/blog/model-router）:
1. ルーター文字列 `"openai/gpt-4o"` / `"anthropic/claude-..."` / `"google/gemini-..."`
2. 設定オブジェクト `{ id: "anthropic/claude-...", apiKey, url?, headers? }` ← **明示 APIキー注入が可能（env 自動検出に依存しない）**
3. AI SDK の LanguageModel（`createOpenAI({apiKey})(name)` 等の戻り値）

| 観点 | **Approach A: `@ai-sdk/*` プロバイダー導入** | **Approach B: Mastra ルーターのオブジェクト形式** |
|---|---|---|
| 依存追加 | `@ai-sdk/anthropic` `@ai-sdk/google` の +2（openai も統一可） | **0**（`@mastra/core` に内蔵） |
| 明示 APIキー注入（Req 2 必須） | ✅ `createAnthropic({apiKey})` / `createGoogleGenerativeAI({apiKey})` | ✅ `{ id, apiKey }` |
| 型安全性 | 最強（`LanguageModelV2` と provider option が型付き） | 良（`id` は補完あり、provider option は緩め） |
| 推論/thinking 等の制御 | first-class（`thinking`/`thinkingBudget`/`thinkingLevel` 等） | provider-options のパススルー中心で間接的 |
| バージョン結合リスク | `@ai-sdk/*` の major を `@mastra/core` 対応 IF と揃える必要 | 最小（Mastra が内部で吸収） |
| 現行 Mastra での idiom 度 | サポートされるがルーターが推奨パス | **v1.x で最も idiomatic** |

### バージョン互換（npm 実データ 2026-06-10 時点）
- `@ai-sdk/openai 3.0.69` / `@ai-sdk/anthropic 3.0.82` / `@ai-sdk/google 3.0.80` はいずれも `@ai-sdk/provider@3.0.10`（= AI SDK v6 系）で**相互整合**。既存 `@ai-sdk/openai ^3.x` に合わせ `^3.x` で導入すれば不整合なし。
- 注意: `@ai-sdk/google` の "2.0.x" は旧 **ai-v5 dist-tag** で v6 系と不整合 → 使用しない。
- `@mastra/core` は v5/v6 provider IF を両対応。**[Research Needed]** 現行ピン `^1.32.1` が v6 alias を確実に含むかは未検証（最新 1.4x では確認済み）。`LanguageModelV2` 型エラーが出たら `@mastra/core` を最新へ bump で解消見込み。

### 明示 APIキーのオプション名（A の場合）
- `createOpenAI({ apiKey })` / `createAnthropic({ apiKey })` / `createGoogleGenerativeAI({ apiKey })`。省略時の自動読み取り env は順に `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`。Req 2 を満たすため**必ず明示注入**する。

### モデル識別子の例
| ベンダー | AI SDK id 例 | ルーター id 例 |
|---|---|---|
| OpenAI | `gpt-4o` / `o4-mini`(既定) | `openai/gpt-4o` |
| Anthropic | `claude-sonnet-4-5` 等 | `anthropic/claude-...` |
| Google | `gemini-2.5-pro` / `gemini-2.5-flash` | `google/gemini-2.5-pro` |

> 既定モデル `o4-mini` は推論モデル。Anthropic/Google で推論/thinking の細かな制御が必要なら **Approach A** が有利。要件上はベンダー別「既定モデル」を持てれば足りる（Req 2-3）。

---

## 4. 実装アプローチ（Extend / New / Hybrid）

### Option A: 既存ファイルを拡張
- `get-openai-provider.ts` にベンダー分岐を追加し、`growi-agent.ts` 内で切替。
- ✅ 新規ファイル最小。❌ `get-openai-provider` の責務肥大（要改名）、import 時 throw 問題が未解決のまま、テスト分離が難しい。

### Option B: 新規プロバイダー解決モジュール
- 例 `ai-sdk-modules/resolve-mastra-model.ts`（または `llm-provider/`）: ベンダー設定を受け、Mastra 互換の `model`（ルーターオブジェクト or AI SDK モデル）を返す純関数＋薄いアダプタ。
- ✅ 単一責務・テスト容易・無効化を返り値で表現可能。❌ ファイル増・IF 設計が必要。

### Option C: Hybrid（推奨ベース）
- **新規**: ベンダー解決モジュール（純関数）＋ **エージェントの遅延/ガード生成**（import 時に throw しない／無効時は「無効」を表すパスへ）。
- **拡張**: `config-definition.ts` にベンダー選択キーとベンダー別キーを追加（openai は既存 `openai:*` を再利用、anthropic/google を新設）。`growi-agent.ts` を解決モジュール利用へ差し替え。
- **境界**: 変更は `features/mastra` と config 定義に閉じ、suggest-path/`features/openai` の LLM 経路は不変（Req 5）。
- ✅ 既存設定基盤・ゲート機構を活かしつつ Req 4 の起動継続を満たせる。❌ 計画がやや複雑。

> 方式（A/B for `model`）の最終決定は design フェーズ。制約（明示キー注入・新規依存最小）からは **Mastra ルーターのオブジェクト形式（外部研究の Approach B）** が第一候補だが、**推論オプションの型付き制御が要るなら `@ai-sdk/*` 導入（同 Approach A）** を選ぶ、という分岐で評価する。

---

## 5. Effort & Risk

- **Effort: M（3–7 日）** — 設定キー追加・ベンダー解決モジュール・エージェント遅延化・テスト更新。新規パターンは限定的だが起動経路の改修を伴う。
- **Risk: Medium** — (1) import 時 singleton→遅延/ガード化の改修が起動経路に触れる、(2) `@mastra/core ^1.32.1` の provider IF バージョン整合の未検証点、(3) 既定モデル/推論モデルのベンダー差異。いずれも既知の解決パスあり。

---

## 6. Research Needed（design へ持ち越し）

1. `Agent.model` のオブジェクト形式 `{ id, apiKey, url?, headers? }` の正確なフィールド名を、導入予定の `@mastra/core` バージョンの型定義で byte-level 確認（ドキュメントは client-rendered で WebFetch 404 のため二次情報）。
2. `@mastra/core ^1.32.1` が AI SDK v6（`@ai-sdk/provider@3.x`）provider IF を受理するか実機型チェックで確認。NG なら最新 1.4x へ bump 要否を判断。
3. 設定キー設計の確定: 「ベンダー選択 + ベンダー別キー（`openai:*` 再利用 + `anthropic:*`/`google:*` 新設）」か「汎用キー（`ai:vendor`/`ai:apiKey`/`ai:model`）」か。env サーフェスと既存キー再利用のトレードオフ。
4. ベンダー別「既定モデル」の具体値（Anthropic/Google）と、推論オプション制御の要否（→ 方式 A/B 選定に直結）。
5. エージェント遅延/ガード生成の具体形（リクエスト時 lazy build か、起動時に有効/無効を確定して保持か）と、無効時のチャット応答（既存 501/403 を踏襲するか）。

---

## 7. 設計フェーズへの推奨

- **推奨アプローチ**: Option C（Hybrid）。ベンダー解決を新規純関数に切り出し、`growi-agent` を遅延/ガード生成へ。設定は既存 `defineConfig`/Union 型前例を踏襲。
- **キー設計の初期推奨**: ベンダー選択キー（Union 型）＋ベンダー別 APIキー/モデルキー。openai は `OPENAI_API_KEY`/`OPENAI_MASTRA_AGENT_MODEL` を再利用し、`anthropic:*`/`google:*` を新設。モデル型は `string` へ一般化。
- **`model` 生成方式**: 第一候補は Mastra ルーターのオブジェクト形式（依存ゼロ・明示キー注入）。推論制御要件が固まれば `@ai-sdk/anthropic`/`@ai-sdk/google`（`^3.x`）導入へ切替検討。
- **Req 4 最優先**: import 時 throw を排し、設定不備でもアプリ起動継続・mastra のみ無効化・原因をログ（APIキー非出力）・チャット時はエラー応答、という不変条件を設計の中心に据える。

---

# Design Discovery & Synthesis (2026-06-10)

_Light discovery（Extension）。Research Needed 1–5 を実機の型定義 + バンドル JS で検証し、設計決定を確定。_

## D-1. 検証結果: インストール済み `@mastra/core` の実体

`^1.32.1` は実際には **`@mastra/core@1.41.0`** に解決（pnpm path: `ai@6.0.197`, `zod@4.4.3`）。app は `@ai-sdk/openai@3.0.68`。

`@mastra/core@1.41.0` の `Agent.model` 型（`dist/llm/model/shared.types.d.ts`、verbatim）:

```typescript
export type MastraModelConfig =
  | LanguageModelV1            // _types/@internal_ai-sdk-v4
  | LanguageModelV2            // _types/@ai-sdk_provider-v5
  | LanguageModelV3            // _types/@ai-sdk_provider-v6
  | ModelRouterModelId         // "provider/model" 文字列（生成 union）
  | OpenAICompatibleConfig     // 下記オブジェクト形式
  | MastraLanguageModel;

export type OpenAICompatibleConfig =
  | { id: `${string}/${string}`; url?: string; apiKey?: string; headers?: Record<string,string> }
  | { providerId: string; modelId: string; url?: string; apiKey?: string; headers?: Record<string,string> };
```

→ **Research Needed #1 解決**: オブジェクト形式のフィールドは `{ id, url?, apiKey?, headers? }`（または `{ providerId, modelId, ... }`）で確定。
→ **Research Needed #2 解決**: `MastraModelConfig` に `LanguageModelV3`（AI SDK v6 IF）が含まれ、runtime は `ai@6`。`@ai-sdk/openai@3.x`（および `@ai-sdk/anthropic@3.x`/`@ai-sdk/google@3.x`、いずれも `@ai-sdk/provider@3.x` = v6）の model は**型エラーなく** `Agent.model` に代入可能。バージョン整合 OK（bump 不要）。

## D-2. ルーター（Approach B）の実体 = models.dev ゲートウェイ + OpenAI 互換層

`@mastra/core` の文字列/オブジェクト形式は **model router** 経由で解決される（`dist/llm/model/gateways/`, `gateway-resolver.d.ts`）:

- `ModelsDevGateway` が **`https://models.dev/api.json`** から provider 構成（base URL・`apiKeyHeader`・`apiKeyEnvVar`・model 一覧）を取得（runtime fetch）。バンドル fallback `dist/provider-registry.json` + `dist/capabilities/*.json`（anthropic 等）も同梱。
- model は **`createOpenAICompatible`（`@ai-sdk/openai-compatible`）** で生成し、解決した URL（例 `api.anthropic.com`＋`x-api-key`、`generativelanguage.googleapis.com`＋`x-goog-api-key`）に対して呼ぶ。
- `{ id, apiKey }` の `apiKey` は当該 provider の認証ヘッダへ注入される（明示キー注入は可能）。

→ **Research Needed #4（方式選定）解決の決め手**: Approach B は (a) **models.dev への runtime ネットワーク依存**（fallback はあるが)、(b) **native provider ではなく OpenAI 互換エンドポイント経由**、という性質を持つ。

## D-3. Build vs Adopt 決定: **Approach A（native `@ai-sdk/*` provider）を採用**

`Agent.model` は AI SDK の `LanguageModel` オブジェクト（form (c)）を直接受理するため、「ai-sdk か mastra か」は二択ではなく **「ai-sdk の native provider を mastra の Agent に渡す」** が成立する。

| 判断軸 | A: native `@ai-sdk/*` | B: mastra router `{id,apiKey}` |
|---|---|---|
| 既存コードとの一貫性 | ✅ 現行 `get-openai-provider.ts` が既に `createOpenAI`（native）を使用。最小の概念差分 | ❌ 別パラダイム導入 |
| runtime ネットワーク依存 | ✅ なし | ❌ models.dev fetch（fallback あり）。自己ホスト/エアギャップに不向き |
| provider 忠実度 | ✅ native（認証・パラメータ・推論オプションを正規サポート） | ❌ OpenAI 互換層経由で Anthropic/Google のドリフト懸念 |
| 型安全/明示制御 | ✅ `LanguageModelV3` 直渡し・明示 `apiKey` | △ gateway 間接・provider option 緩い |
| 依存追加 | ❌ `@ai-sdk/anthropic` `@ai-sdk/google`（`^3.x`）+2 | ✅ 0 |

**決定**: GROWI のエンタープライズ/自己ホスト前提（models.dev への runtime 依存は受け入れ難い）と既存 native 実装との一貫性から **Approach A**。+2 依存は server-only import（`features/mastra/server/...`）ゆえ `dependencies` 分類で吸収可（package-dependencies ルールの Turbopack 検証手順を実施）。
→ provider factory 関数・明示キー option（research §3）: `createOpenAI({apiKey})` / `createAnthropic({apiKey})` / `createGoogleGenerativeAI({apiKey})`。

## D-4. Generalization / Simplification

- **Generalization**: R1–R5 は「ベンダーに依存しない LLM モデル解決」という単一問題の変奏。`vendor → LanguageModel` を返す**純関数リゾルバ 1 つ**にデータ駆動（`AI_PROVIDERS` 配列＋ per-vendor factory map）で集約し、consumer（agent/route）はベンダー名で分岐しない（coding-style の data-driven 原則）。
- **Simplification**: 「lazy per-request build」ではなく、`@mastra/core` がサポートする **dynamic model 関数**（`model: () => resolveModelConfig()`）を `Agent` に渡す。これにより (1) import 時に throw しない（R4: 起動継続）、(2) model 解決はエージェント使用時に遅延、(3) 余分な singleton/再構築ロジック不要。起動時に 1 度リゾルバを呼んで有効性をログ（R4.2）、route 層で可用性ゲート（R4.4）。
- **設定キー設計（Research Needed #3）決定**: ベンダーセレクタ（新設）＋ per-vendor キー。openai は既存 `openai:apiKey`（suggest-path と共有。R5 整合）・`openai:assistantModel:mastraAgent` を再利用し、anthropic/google を対称に新設。汎用単一キー案は既存キー再利用・per-vendor 既定モデルを失うため不採用。model 型は新設キーで `string`（OpenAI 専用 `OpenAI.Chat.ChatModel` を一般化）。

## D-5. 残課題（実装時に確定）

- ベンダー別**既定モデル**の具体値（Anthropic/Google）は最新の提供モデルで確定する（暫定: anthropic=`claude-sonnet-4-5`, google=`gemini-2.5-flash`）。openai は既存 `o4-mini`。
- `@ai-sdk/anthropic` / `@ai-sdk/google` の導入バージョンは既存 `@ai-sdk/openai@^3.x` に合わせ `^3.x`。導入後 `apps/app/.next/node_modules` で externalise を確認し `dependencies` 分類を検証（package-dependencies ルール）。

---

# Design Discovery (追補): ベンダー別 reasoning providerOptions（2026-06-10）

_スコープ拡張: `post-message.ts` の `providerOptions` を解決済みベンダーに応じて出し分け、OpenAI の `reasoningEffort`/`reasoningSummary` に等価なオプションを各ベンダーで適用する。_

## D-7. 検証: 各ベンダーの reasoning providerOptions（npm `.d.ts` 一次情報）

対象: `@ai-sdk/anthropic@3.0.82` / `@ai-sdk/google@3.0.80`（いずれも `@ai-sdk/provider@3.0.10` = AI SDK v6 系。既存 `@ai-sdk/openai@^3` と整合）。

| 意図 | OpenAI `providerOptions.openai` | Anthropic `providerOptions.anthropic` | Google `providerOptions.google` |
|---|---|---|---|
| ①reasoning コスト抑制 | `reasoningEffort: 'low'\|'medium'\|'high'` | `thinking: { type:'enabled', budgetTokens?:number }` / `{ type:'adaptive', display?:'omitted'\|'summarized' }`、または兄弟フィールド `effort: 'low'\|'medium'\|'high'\|'xhigh'\|'max'`（Opus 4.5+） | `thinkingConfig: { thinkingBudget?:number, includeThoughts?:boolean, thinkingLevel?:'minimal'\|'low'\|'medium'\|'high' }` |
| ②サマリを UI に出す | `reasoningSummary: 'auto'` | `type:'enabled'` は reasoning を自動 emit。adaptive は `display:'summarized'` | `includeThoughts: true` |

補足（検証済 / 一部は基盤 API ドキュメント由来）:
- UI へ流す `sendReasoning: true` は `post-message.ts` の `toAISdkStream(..., { sendReasoning: true })` で**既に有効**。各 provider オプションで summary を「要求」すれば UI に届く。
- `effort` は Anthropic では `thinking` の**兄弟**フィールド（ネストではない）。Opus 4.5+ 系で対応。Sonnet 系は `thinking.budgetTokens`（≥1024、基盤 API 制約）が無難。
- Google は **Gemini 2.5 = `thinkingBudget`（数値）**、**Gemini 3 = `thinkingLevel`（列挙）** とモデル世代で異なる。混在不可。
- AI SDK の `parseProviderOptions` は**アクティブ provider 自身の名前空間**のみ検証（`.strict()`）。他 provider のキーは無視。ただし**自 provider 名前空間内に当該モデル非対応の値を入れると runtime でエラー/無視**になり得る（モデル世代依存）。

## D-8. 決定: ベンダー別固定値（既定モデル準拠）

ユーザー選択により、reasoning providerOptions は**各ベンダーの既定モデルに適合する固定値**としてコードに持つ（env 上書きは導入しない＝MVP）。提案値（暫定。既定モデル確定とあわせて実装時に確定）:

| Vendor | 既定モデル | providerOptions（提案・暫定） |
|---|---|---|
| openai | `o4-mini` | `{ openai: { reasoningEffort: 'low', reasoningSummary: 'auto' } }`（現状維持） |
| anthropic | `claude-sonnet-4-5` | `{ anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } }` |
| google | `gemini-2.5-flash` | `{ google: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } } }` |

設計: `ai-sdk-modules` に**ベンダー→providerOptions の map と解決関数**（`resolveMastraModel()` の vendor を用いて map を引く純関数）を追加し、`post-message.ts` のハードコード `{ openai: {...} }` を当該関数の戻り値に置換。

**残るリスク（運用者向けに明記）**: reasoning オプションはモデル世代依存（Gemini 3=`thinkingLevel`、Opus 4.5+=`effort`、adaptive=`display`）。運用者が既定モデルを上書きすると固定オプションが不整合になり得る。この場合でもチャット要求は失敗させない（オプション不適合は無視 or 当該 provider のバリデーションに委ねる）方針とし、Open Questions / 運用ドキュメントに明記する。

---

# D-9. 方針転換: reasoning providerOptions パリティを本仕様から除外（後追い）

ユーザー協議の結果、ベンダー別 reasoning providerOptions（Req 6 として一旦追加）は**本仕様から除外**し、別仕様へ後追いとする。

**理由**: reasoning オプションはベンダー横断で統一されておらず、同一ベンダー内でも世代依存（Gemini 2.5=`thinkingBudget` / 3=`thinkingLevel`、Claude Sonnet=`budgetTokens` / Opus 4.5+=`effort` / adaptive=`display`）。固定値で持つと値の継続的な保守・陳腐化リスクを本仕様（multi-vendor のコア）に持ち込むことになる。AI SDK / Mastra にも reasoning を抽象化した統一ノブは無い。

**本仕様の扱い**: OpenAI は既存挙動を維持。Anthropic/Google は各モデル既定の reasoning に委ねる（`providerOptions` 未設定）。`post-message.ts` の `providerOptions.openai` は変更しない（非 OpenAI では無視＝D 検証済）。

**保持**: D-7（各ベンダーの reasoning オプションの `.d.ts` 検証）/ D-8（マッピング案・固定値案）は、後追い仕様の着手時に再利用できるよう本ログに残す。後追い仕様では実モデルでの検証（オプションのモデル適合・サマリ表示・コスト）を前提に設計する。

---

# D-10. FB 反映: 単一設定キー + throw ベース + route ゲート撤回（2026-06-10）

実装後のユーザー FB により、承認済み設計の以下3点を改訂（コミット f67933bc44）:

1. **設定を単一キーセットに統一**（FB#1）: per-vendor キー（`anthropic:*`/`google:*` 新設、`openai:*` 再利用）を撤回し、ベンダー非依存の `ai:provider` / `ai:apiKey` / `ai:model` に統一。1 App = 1 Vendor に一致し env 最小。既定モデルは config の defaultValue ではなく resolver 内の per-vendor `defaultModels` map で解決。トレードオフ: vendor=openai でも mastra は `AI_API_KEY` を要し、suggest-path の `OPENAI_API_KEY` とキー重複（許容）。`openai:assistantModel:mastraAgent` は未使用化（pre-existing のため残置）。

2. **throw ベースに変更**（FB#3）: `resolveMastraModel` は判別共用体（`MastraModelResolution`/`MastraModelDisabledReason`）を廃し、成功時 `MastraModelConfig` を返し不備時 throw（既存 `OpenaiClientDelegator` のコンストラクタ throw 流儀に一致）。throw メッセージに API キー値は含めない。

3. **起動時可用性ゲート（route 変更）を撤回**（FB#2）: `routes/index.ts` を pre-3.2 状態へ revert（`isAiEnabled` の 501 のみ残置、503 ゲート削除）。設定不備の throw は `growiAgent.model` の遅延 dynamic function で使用時に発生し、`post-message.ts` の既存 try/catch がエラー応答（500）を返す。原因は per-request で `logger.error` 記録。

要件影響: Req 4.4 を「機能利用不可である旨のエラー応答」→「エラー応答を返す（原因はサーバログ、クライアントに機密非出力）」に緩和。Req 4.2 は検出タイミングが起動時→使用時に。Req 4.1/4.3/5.x は維持。

検証: feature テスト 84 passed、typecheck は既存の post-message.ts:77 のみ。cast-free（D-9）維持。

---

# D-11. FB 追加反映: vendor 型付け + 既定 openai + 単一既定モデル（2026-06-10）

実装後の追加 FB を反映（commit は本コミット）:

1. **`ai:provider` を型付け**（config-definition レベル）: `string | undefined` → **inline literal union `'openai' | 'anthropic' | 'google'`**。`AiProvider` を import せず（core→feature 依存逆転を回避、`openai:serviceType` と同流儀）。
2. **`ai:provider` default を `'openai'`** に: Req 1.3 を「明示必須・フォールバックなし」→「未指定時は既定 OpenAI」に反転（当初の私の推奨に回帰）。resolver の vendor-unset throw は撤去。
3. **`ai:model` default を `'o4-mini'`**（FB の "gpt-o4" は正式 id でないため確認のうえ `o4-mini` を採用）。型は `string`（**ベンダー横断のモデル id union は不可** — `@ai-sdk/{openai,anthropic,google}` の `*ModelId` 型はいずれも未 export。probe で `TS2459/2724` 確認）。
4. **`defaultModels` map を撤去**: 既定モデルは config の defaultValue に集約。非 OpenAI ベンダー利用時は `AI_MODEL` の明示指定が必要。

**重要な結論（`isAiProvider` の要否）**: config-definition で型を付けても `isAiProvider` は**不要にならない**。config-manager は env 文字列を宣言型で検証しないため、`AI_PROVIDER=azure` は型上 union でも実行時に通り、`llmModelFactories['azure']` undefined でクラッシュする。Req 1.4 のため resolver の実行時検証が必須（`openai:serviceType` も型 union＋`OpenaiServiceTypes.includes` の二段構え）。

検証: feature テスト 79 passed、typecheck は既存 post-message.ts:77 のみ。

---

# D-12. FB 追加: AiProvider 型の共有 + 未使用 openai キー削除（2026-06-10）

1. **`ai:provider` を共有 `AiProvider` で型付け**: inline literal `'openai'|'anthropic'|'google'` をやめ、`import type { AiProvider }` で単一ソース化。**type-only import は実行時に消える**ため core→feature の runtime エッジは無く、`ai-provider.ts` は依存ゼロの leaf なので循環もない（D-11 で懸念した依存逆転は type-only なら実害なし）。`isAiProvider` の実行時検証は引き続き必須（型は実行時強制でない）。
2. **`openai:assistantModel:mastraAgent`（`OPENAI_MASTRA_AGENT_MODEL`）を削除**: 再設計で mastra は `ai:model` を使うため未使用化。CONFIG_KEYS / CONFIG_DEFINITIONS から除去し、唯一の利用元だった `import type OpenAI from 'openai'`（`OpenAI.Chat.ChatModel`）も除去。app 全体で参照ゼロを確認済み。

検証: typecheck は既存 post-message.ts:77 のみ。config テスト含め 132 passed。

---

# D-13. スコープ拡大: provider options を env から指定（Req 6, variant A）（2026-06-11）

ユーザー FB により reasoning/provider options の env 設定を本仕様に取り込み（以前 defer したものを「per-vendor マッピングを持たない生 JSON エスケープハッチ」として実装）:

- **config**: `ai:providerOptions`（`string` 型・生 JSON、env `AI_PROVIDER_OPTIONS`）。object 型 config は loader の JSON.parse が malformed で起動クラッシュするため、string＋resolver graceful parse を採用。default は現行 OpenAI オプション `{"openai":{"reasoningEffort":"low","reasoningSummary":"auto"}}`（ユーザー指定）。
- **resolver**: `resolveProviderOptions()`（新規）。parse → provider 名前空間オブジェクト検証 → 返す。不正 JSON/非オブジェクトは `{}`＋warn（fail-soft、Req 6.4）。型は `ai` の `ProviderOptions` が未 export のため `Record<string, Record<string, JSONValue>>`（`JSONValue` は `ai` から export 済）。
- **wiring**: `post-message.ts` のハードコード `providerOptions: { openai/anthropic ... }` を `resolveProviderOptions()` に置換。**variant A**（プロバイダー名前空間を含むフル JSON を operator が指定）。
- 既存ハードコードにあった `anthropic: { thinking: { type: 'adaptive' } }` は default から除外（ユーザー指定 default=OpenAI のみ。anthropic 運用者は env で指定）。

要件: Req 6 を追加、Req 5(out-of-scope) の「reasoning パリティ別仕様送り」を「intent マッピングのみ非対応・生 JSON は対応」に更新。
検証: feature テスト 97 passed、typecheck は既存 messages-arg エラーのみ（providerOptions 変更による新規エラーなし）。

---

# D-14. 依存更新: `@ai-sdk/*` provider packages の bump（2026-06-11）

Azure 追加（Req 7/8）に伴い `@ai-sdk/{openai,anthropic,google,azure}` を最新安定版（3.x 系・`ai`@6 と整合）へ bump（commit `adc1065d43`）。`createAzure` / `tokenProvider` の型は bump 後の `.d.ts` で確認。`@azure/identity` は既存依存（`AzureOpenaiClientDelegator`）のため追加なし。

---

# D-15. PR #11297 レビュー反映: `ai:` 名前空間へ改名 + 既定値の全廃（2026-06-12）

PR #11297（base `support/mastra`）の @yuki-takei インラインレビューを反映。2 段階で実施。

**FB#1（config-definition.ts:296）— キー名: `mastra:` prefix と `llm` 語を落とす**
- `mastra:llm*` → **`ai:`** 名前空間に統一し、キー名から `llm` を除去 → `ai:provider` / `ai:apiKey` / `ai:model` / `ai:providerOptions`（env: `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` / `AI_PROVIDER_OPTIONS`）。理由: 将来 SLM 等も扱う余地を残し、キー名に特定モデル分類（`llm`）を先入れしない。
- 型族も合わせて **`LlmVendor`/`LlmProvider` → `AiProvider`** にリネーム（`interfaces/llm-provider.ts` → `ai-provider.ts`、`AI_PROVIDERS`/`isAiProvider`）。

**FB#2（config-definition.ts:1277）— `defaultValue: 'openai'` を削除**
- レビューで「default は不要」。これを起点に、ユーザー判断で **provider だけでなく model・providerOptions の既定値も全廃**（「provider を削除するなら model も providerOptions も undefined でよい」）。
  - `ai:provider`: `AiProvider | undefined` / default `undefined`（D-11 の「既定 openai」を再反転 → 当初の「明示必須」へ回帰）。未指定は `isAiProvider` が弾き throw（Req 1.3/4.1）。
  - `ai:model`: `string | undefined` / default `undefined`。`getModel()` → **`requireModel()`** に変更し未指定で throw（`AI_MODEL`）。D-11 の `o4-mini` 既定を撤回（SLM/特定モデルへの先入れ回避）。
  - `ai:providerOptions`: default `undefined`。未指定時は `resolveProviderOptions()` が空 `{}` を返す（D-13 の OpenAI reasoning 既定を撤回）。
- requirements の Req 1.3 / 2.3 / 6.3 を「既定使用」から「未指定は設定不備（throw / 空）」へ更新。Req 4.1 の必須設定に model を追加。

検証: LLM 関連 + config のユニットテスト 94 passed（`llm-providers.spec` に `requireModel` の model 欠落 throw を 1 件追加）、mastra feature 全体 181 passed、typecheck は既存 `post-message.ts(78,48)` の messages-arg エラーのみ（本変更による新規エラーなし）。
