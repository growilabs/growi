# Technical Design: ai-provider-multi-vendor

## この文書に書くこと・書かないこと(Write / Don't-Write test)

本 spec は実装完了済み(PR #11394)。このセクション以下は「将来この機能を改修するときに、コードとテストを読むだけでは分からないことだけを残す」という基準で整理されている。今後この設計書を編集するときも同じ基準を使うこと。

判定は一貫して次の問いに従う: **「コードとテストファイルを読めば再現できる内容か?」** 再現できるなら書かない。

| 書く | 書かない |
|---|---|
| 調査して初めて分かった事実(コードをさっと読むだけでは分からない挙動、外部ライブラリの隠れた仕様) | 関数シグネチャ、ファイル配置図、「どのファイルに何があるか」 |
| 変わった設計を選んだ理由 — **特に、検討して却下した別案とその理由** | ごく普通の実装のごく普通の説明 |
| 自動テストで**検知できない**残課題 | どのテストが何をカバーしているかの一覧(spec/テストファイルを直接読めばよく、書いても陳腐化する) |
| コードから再現できない手動確認手順(再現環境の作り方・見るべき箇所・合格/不合格の基準値) | 差分の有無やいつ実装されたかといった、時点情報の記録 |

迷ったら書かない。コードから読み取れる内容を spec に置くと、コードが変わった瞬間に静かに古くなり、その一箇所の陳腐化が文書全体の信頼性を損なう。

## Overview

**Purpose**: 本機能は GROWI の AI 機能(Mastra チャット)を「1 App = 単一プロバイダ」から「1 App = 複数プロバイダの同時利用」へ拡張する。管理者は対応 4 プロバイダ(OpenAI / Anthropic / Google / Azure OpenAI)を固定の設定領域で同時に構成・有効/無効切替し、エンドユーザーはプロバイダ横断の許可モデルからチャットごとにモデルを選択できる。

**Users**: セルフホスティング GROWI の管理者・運用者(プロバイダ構成・モデル統制)、チャットを利用するエンドユーザー(横断モデル選択)。

**Impact**: 既存の単一プロバイダ設定(`ai:provider` / `ai:apiKey` / `ai:azureOpenaiSettings`)を新しい複数プロバイダ設定(`ai:providers` / `ai:providerApiKeys`)へ**置換**する(移行なし・プレリリース前提)。許可モデルは (provider, modelId) の組となり、境界を渡るモデル識別子は複合キー `${provider}/${modelId}`(**modelKey**)に統一する。モデル解決・可用性判定・管理 UI・チャット UI を多プロバイダ前提へ再構成するが、既存の検証済み機構(動的モデル関数・解決キャッシュ・カタログ picker・ライブ getter 注入・選択永続化)はすべて温存・流用する。

### Goals

- 対応 4 プロバイダの同時構成(各種 1 つ、資格情報の独立永続化・有効/無効トグル)
- プロバイダ横断の許可モデル集合とグローバル既定モデル(ちょうど 1 つ)
- チャットでのプロバイダ横断モデル選択(判別可能な表示・選択の永続化・サーバ検証)
- env-only モードの部分ロック(接続設定 = env のみ、モデル設定 = UI 編集可)
- 一部プロバイダ不備時の部分縮退(除外 + ログ + 継続)

### Non-Goals

- 同一プロバイダ種の複数構成、プロバイダ種の追加、プロバイダ設定領域の動的な追加・削除
- 保存済み API キーの消去操作(上書きのみ)
- レガシー `openai:*` 系統(suggest-path 等)の統合・変更
- 実行時の外部通信によるモデル一覧取得、カタログ vendoring の変更(ai-provider-model-picker の資産をそのまま利用)
- 旧設定からの自動移行(migration)

## Boundary Commitments

### This Spec Owns

- AI プロバイダ構成の**データモデルと config スキーマ**: `ai:providers` / `ai:providerApiKeys` / `ai:allowedModels`(provider フィールド付き)、および env-only グループ `env:useOnlyEnvVars:ai` の targetKeys
- **モデル識別子の規約**: modelKey(`${provider}/${modelId}`)の生成・解析ルール
- **可用性判定の意味論**: 構成済み/有効の述語、部分縮退、実効既定モデルの決定
- 管理 AI 設定 API(GET/PUT `/ai-settings`)と管理画面 UI(AiSettings 一式)
- チャットモデル選択 API(GET `/mastra/models`、POST `/mastra/message` の modelKey)とチャット側セレクタ UI(`ai-elements/prompt-input` への Group/Label ラッパの**追加的** export を含む — 既存 export の変更は不可)
- `UserUISettings.aiChatSelectedModelKey` フィールド(旧 `aiChatSelectedModelId` の置換)

### Out of Boundary

- レガシー `openai:*` 設定と `features/ai-tools`(suggest-path)・`features/openai` — 現状のまま
- カタログデータの vendoring・フィルタ・リフレッシュ機構一式(`resource/model-catalog-data.json` / `bin/vendor-model-catalog.ts` / `chat-model-filter.ts` / `build-model-catalog.ts` / `fetch-model-catalog.ts` / `refresh-model-catalog.ts` / `effective-model-catalog.ts` / `model-catalog-refresh-jobs.ts` / Prisma モデル `refreshed-model-catalog` / POST `/ai-settings/refresh-model-catalog` / config キー `ai:modelCatalogRefreshOnStartup`・`ai:modelCatalogRefreshCronSchedule`)— ai-provider-model-picker の所管。本 spec はこれらを変更しない
- Mastra エージェント本体(tools・memory・stream 処理)— `growi-agent.ts` は modelKey の受け渡し行のみ変更
- `crowi.isAiReady()` の外部契約(boolean のまま。内部意味論のみ本 spec が変更)
- SSR 共通 props(`aiEnabled: boolean` のまま変更なし)

### Allowed Dependencies

- config-manager 基盤(`defineConfig` / `ENV_ONLY_GROUPS` / s2s `configUpdated`)
- `@ai-sdk/{openai,anthropic,google,azure}` ^3 の provider factory、`@mastra/core` ^1.32 の動的モデル関数と `RequestContext`
- picker 資産: `get-available-models` ルート(provider 引数 → `getEffectiveSelectableModels(provider)` で**実効カタログ** = DB リフレッシュ済みカタログ ?? 同梱資産 の `{id,name}[]` を返す現行契約のまま)・`use-selectable-models` フック・AllowedModelsField 内の手動カタログリフレッシュ導線(POST `/ai-settings/refresh-model-catalog`)
- `~/components/ui/select`(SelectGroup / SelectLabel)と `ai-elements/prompt-input` のベンダリング部品
- UserUISettings 基盤(mongoose モデル・PUT ルート・`scheduleToPut`)

依存方向(右のモジュールが左を import する。逆は違反): **interfaces → config-manager 定義 → server services(config アクセサ → provider-availability → 実効キー解決 → resolve)→ routes → client stores/hooks → client components**。client から server への import も違反。

### Revalidation Triggers

- `AllowedModel` / `AiSettingsResponse` / `AiSettingsUpdateRequest` / `ChatModelsResponse` の形状変更
- modelKey の書式(セパレータ・解析規則)変更
- env var 名(`AI_PROVIDERS` / `AI_PROVIDER_API_KEYS` / `AI_ALLOWED_MODELS`)・`ENV_ONLY_GROUPS` targetKeys の変更
- `UserUISettings` フィールドの変更(PUT ルートのハードコード allow-list と連動)

## Architecture

### Design Rationale: 既存機構の流用範囲

複数プロバイダ化にあたり、ai-provider-multi-model / ai-provider-model-picker が確立した以下の機構は変更せず流用する方針を採った(単一プロバイダ前提が残っていたのは provider の決定源とアクセサの引数の部分のみで、そこだけを provider 引数化・複合キー化した):

- **メタデータ駆動のプロバイダ宣言**(`AI_PROVIDER_DEFS`。各 provider は `enumerable` に加え公式表示名 `label` を持ち、UI は `getProviderLabel(provider)` で表示 — 生キーは出さない)と Record ディスパッチ
- **動的モデル関数**: `growiAgent` の `model: ({ requestContext }) => resolveMastraModel(...)`
- **解決キャッシュ + 無効化**: `resolvedModelCache`(Map)+ `clearResolvedMastraModelCache()`(設定保存時 + s2s `configUpdated`)
- **サーバ検証 = 認可境界**: クライアント値を信用せず allow-list へ丸める
- **秘匿規律**: キー値を返さない・request body をログに出さない
- **full-state replace の PUT** と write-only apiKey フィールド

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph InterfacesLayer
        MK[model-key]
        AM[allowed-model]
        PS[provider-settings]
        DTO[ai-settings DTO]
        CMR[chat-models-response]
    end
    subgraph ConfigLayer
        CD[config-definition ai keys]
    end
    subgraph ServiceLayer
        LPC[llm-providers config]
        PA[provider-availability]
        EMK[effective-model-key]
        PRV[per-provider resolvers]
        RMM[resolve-mastra-model]
        IAC[is-ai-configured]
    end
    subgraph RoutesLayer
        GAS[get-ai-settings]
        PAS[put-ai-settings]
        GMS[get-models]
        POM[post-message]
        UUS[user-ui-settings PUT]
    end
    subgraph ClientLayer
        ADM[admin AiSettings UI]
        CHT[ChatSidebar selector]
    end
    CD --> LPC
    LPC --> PA
    LPC --> PRV
    PA --> EMK
    PA --> IAC
    PRV --> RMM
    EMK --> RMM
    PA --> GMS
    EMK --> GMS
    EMK --> POM
    RMM --> POM
    GAS --> ADM
    PAS --> ADM
    GMS --> CHT
    POM --> CHT
    UUS --> CHT
```

**Key Decisions**:

- **modelKey 規約(D1)**: 境界を渡るスカラー識別子は `${provider}/${modelId}`。解析は「最初の `/` で分割」する pure 関数のみが行い、他所は不透明文字列として扱う。config 保存形は `AllowedModel.provider`(必須)で構造化し、保存データに文字列エンコードを持ち込まない。Azure デプロイ名の文字種(英数字・`_`・`()`・`-`・`.`、`/` 不可)によりセパレータは衝突しない。
- **秘匿/非秘匿の key 分離(D2)**: `ai:providers`(非秘匿: enabled + Azure 接続設定)と `ai:providerApiKeys`(isSecret)を分ける。管理 API は前者を素通しで返せ、後者は存在フラグのみ返す。
- **可用性判定の一元化(D3)**: 「有効なプロバイダ」(enabled ∧ 構成済み)と「有効なモデル集合」の導出を `provider-availability.ts` に集約し、`isAiConfigured` / `get-models` / `resolveEffectiveModelKey` が共有する。判定 drift を構造的に防ぐ。
- **Mastra ルーター文字列は不使用**: resolver は ai-sdk factory で構築済みモデルを返すため、modelKey は GROWI コード内でのみ解釈される(Mastra の "provider/model" マジック文字列と競合しない)。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Frontend | React 18 + Next.js Pages Router / react-hook-form / SWR | 管理フォーム(providers Record + allowedModels 配列)・チャットセレクタ | 新規依存なし。`ui/select` の SelectGroup/SelectLabel を再利用 |
| Backend | Express apiv3 + express-validator / config-manager | 設定 API・検証・env-only 部分ロック | ENV_ONLY_GROUPS の targetKeys 差し替えのみ |
| LLM | `@ai-sdk/*` ^3 / `@mastra/core` ^1.32 | provider factory・動的モデル関数・RequestContext | バージョン変更なし |
| Data | MongoDB Config KV(JSON 値)/ UserUISettings | 新 config キー 2 つ・選択モデルキー永続化 | スキーマ変更は UserUISettings の 1 フィールドのみ |

## File Structure Plan

依存方向は Boundary Commitments の「依存方向」節に従う(下層から実装)。決定した分割:

- **サービス層を 3 モジュールに分割**(`warn-dedup.ts` / `provider-availability.ts` / `effective-model-key.ts`)し、既存の `llm-providers/config.ts` には追加しなかった。理由: config アクセサ → 可用性判定 → 実効キー解決という一方向依存を保つため(config.ts が可用性判定を import すると循環 import になる)。dedup レジストリ(warn-dedup.ts)は config アクセサの防御ガードと可用性判定の不備ログの双方が共用するため、両者の外側に切り出した。
- **クロスレイヤ DTO は `interfaces/` に集約**(`model-key.ts` / `provider-settings.ts`)し、どの層からも一方向に参照できる単一の宣言にした。
- **管理画面は単一コンポーネント(旧 `ProviderCommonSettings`)を廃し、3 コンポーネントへ分割**(`DefaultModelSelector` / `ProviderTabs` / `ProviderPanel`)。単一プロバイダ前提の 1 フォームから、プロバイダごとに独立した固定 4 スロットの設定領域へ UI 構造を対応させるための分割。

## System Flows

チャット 1 メッセージのモデル解決(4.3, 4.6, 6.1, 6.4 の実現点):

```mermaid
sequenceDiagram
    participant U as EndUser
    participant CS as ChatSidebar
    participant GM as GET models route
    participant PM as POST message route
    participant PA as provider availability
    participant RM as resolveMastraModel
    participant AG as growiAgent

    CS->>GM: fetch
    GM->>PA: available models and effective default
    GM-->>CS: models with provider info and selectedModelKey
    U->>CS: select model then send
    CS->>PM: body includes modelKey
    PM->>PA: resolveEffectiveModelKey validates against available set
    PM->>AG: stream with requestContext modelKey
    AG->>RM: dynamic model function
    RM-->>AG: cached provider model
    AG-->>CS: response stream
```

- 検証点は `resolveEffectiveModelKey` の 1 箇所(post-message で 1 回だけ解決し、その実効キーを requestContext と providerOptions 解決の両方に渡す — 現行パターン踏襲)。
- 有効集合外の modelKey は実効既定へ丸め(warn ログ、キー値のみ)。既定自体が無効なら「有効なエントリの先頭」へ(決定的、6.4)。
- 管理設定保存 → `clearResolvedMastraModelCache()` + s2s で他インスタンスも無効化(再起動なし反映、現行機構)。

## Components and Interfaces

| Component | Layer | Intent | Req | Key Deps | Contracts |
|-----------|-------|--------|-----|----------|-----------|
| model-key | interfaces | modelKey の生成・解析の単一実装 | 2.1, 4.3, 4.4 | ai-provider (P0) | Service |
| provider-settings / allowed-model / DTO 群 | interfaces | クロスレイヤ型の単一宣言 | 1.2, 2.1, 4.2 | — | State |
| config-definition ai keys | config | 新キー定義・env 対応・env-only 部分ロック | 1.1, 5.1–5.3, 7.1 | config-manager (P0) | State |
| provider-availability | service | 有効プロバイダ/有効モデルの単一述語 + 不備ログ | 1.6, 1.7, 6.1–6.4 | config accessors, warn-dedup (P0) | Service |
| llm-providers config | service | プロバイダ別 config アクセサ(availability 非依存の最下層) | 1.4, 1.9 | config-manager, warn-dedup (P0) | Service |
| effective-model-key | service | 実効既定モデルの決定・リクエスト時の実効キー解決 | 4.6, 6.4 | provider-availability, config accessors (P0) | Service |
| per-provider resolvers | service | 各社 factory の薄いアダプタ | 1.10, 4.3 | @ai-sdk/* (P0) | Service |
| resolve-mastra-model | service | modelKey → キャッシュ済みモデル | 4.3 | resolvers (P0) | Service |
| is-ai-configured | service | AI 有効判定(ガード・SSR 用) | 6.2, 6.3, 7.3 | provider-availability (P0) | Service |
| get/put ai-settings | routes | 管理 API(マスク・merge 例外・env-only 分割) | 1.3–1.9, 2.3–2.5, 3.2, 5.2–5.4 | validate-allowed-models (P0) | API |
| get-models / post-message | routes | チャット API(有効集合・検証) | 4.1–4.6 | availability, resolver (P0) | API |
| user-ui-settings PUT | routes | 選択キーの永続化 | 4.4 | UserUISettings model (P0) | API |
| AiSettings + 新 3 コンポーネント | client | モック準拠の管理画面 | 1.1, 1.5, 1.8, 3.1, 5.2, 5.3 | RHF, use-ai-settings (P0) | State |
| AllowedModelsField(provider スコープ) | client | プロバイダ別モデル編集 | 2.2, 2.4, 2.6–2.8 | use-selectable-models (P1) | State |
| ChatSidebar selector | client | 横断セレクタ・永続化 | 4.1, 4.2, 4.4, 4.7 | stores/models, prompt-input (P0) | State |

### interfaces / model-key

| Field | Detail |
|-------|--------|
| Intent | modelKey の生成・解析を 1 箇所に閉じ込める(他所は不透明文字列として扱う) |
| Requirements | 2.1, 4.3, 4.4, 4.6 |

```typescript
// features/mastra/interfaces/model-key.ts
export type ModelKey = string; // `${AiProvider}/${modelId}`

/** 防御上限 (旧 MAX_MODEL_ID_LENGTH の移管。意味上の制限ではない) */
export const MAX_MODEL_KEY_LENGTH = 256;

export const buildModelKey = (provider: AiProvider, modelId: string): ModelKey;

/**
 * 最初の '/' で分割。prefix が AiProvider でない・modelId 部が空・'/' 不在は null。
 * modelId 側の '/' は許容 (2 番目以降は modelId の一部)。
 */
export const parseModelKey = (
  key: string,
): { provider: AiProvider; modelId: string } | null;
```

- Invariants: `parseModelKey(buildModelKey(p, id))` は常に `{ p, id }`(id が空でない限り)。
- **Implementation Notes** — Validation: post-message validator は長さのみ検査し、意味検証は `resolveEffectiveModelKey` に委ねる(検証点を 1 つに保つ)。

### config / config-definition(ai keys)

| Field | Detail |
|-------|--------|
| Intent | 複数プロバイダ設定の保存形と env 対応の宣言 |
| Requirements | 1.1, 1.2, 5.1, 5.2, 5.3, 7.1 |

```typescript
// features/mastra/interfaces/provider-settings.ts
export interface AiProviderSettings {
  readonly enabled?: boolean; // 省略 = false (無効)
  readonly azureOpenaiSettings?: AzureOpenaiConfig; // 'azure-openai' エントリのみ有意
}
export type AiProvidersConfig = Partial<Record<AiProvider, AiProviderSettings>>;
export type AiProviderApiKeys = Partial<Record<AiProvider, string>>;
```

| Config key | 型 | env var | isSecret |
|---|---|---|---|
| `ai:providers` | `AiProvidersConfig` | `AI_PROVIDERS`(JSON) | no |
| `ai:providerApiKeys` | `AiProviderApiKeys` | `AI_PROVIDER_API_KEYS`(JSON) | **yes** |
| `ai:allowedModels` | `AllowedModel[]`(provider 必須) | `AI_ALLOWED_MODELS`(JSON) | no |

- `ENV_ONLY_GROUPS` の ai グループ: `targetKeys: ['app:aiEnabled', 'ai:providers', 'ai:providerApiKeys']`(モデル設定を外す = 5.3)。
- 削除: `ai:provider` / `ai:apiKey` / `ai:azureOpenaiSettings`(7.1。migration なし = 7.2。新キー不在時は available provider が 0 になり自然に未設定扱い = 7.3)。picker 由来のカタログリフレッシュ 2 キー(`ai:modelCatalogRefreshOnStartup` / `ai:modelCatalogRefreshCronSchedule`)は `ai:*` prefix だが本 spec の対象外 — 削除・移設しない。
- **単一 JSON env への集約 — トレードオフの記録(5.1)**: `AI_PROVIDER_API_KEYS` は全プロバイダの API キーを 1 つの JSON env 値に合成する形であり、K8s の `secretKeyRef` 等でプロバイダごとに別々のシークレットソースから注入することはできない。config-manager の機構(1 config key = 1 env var)と D2 の Record 保存形に整合するため、この形を採る。**非採用代替**: per-provider env var(`AI_OPENAI_API_KEY` 等)は、config key の per-provider 分割(Record 設計の放棄)か config-loader への例外機構の追加を要するため見送り。運用要望が生じた場合は、loader 段で per-provider env を Record へマージする「追加エイリアス」として後方互換に導入できる(拡張余地 — 本 spec では実装しない)。JSON エスケープ誤りは malformed config warn(Error Handling 参照)で観測可能。JSON エスケープ・複数キー合成の具体例は [docs/env-configuration-examples.md](./docs/env-configuration-examples.md) を参照。
- config-manager は値をランタイム検証しないため、アクセサ側で `Array.isArray` / object ガードを行う(現行 `getAllowedModels` の防御パターン踏襲)。ガードが不正形状を検出した場合は「未設定」として fail-soft しつつ、`(config key, 理由)` の warn を dedup 付きで出力する(fail-silent の排除 — Error Handling 参照)。JSON env のタイポ等で `ai:providers` 自体が読めないケースは 6.1 の不備ログ(enabled 判定後)に到達しないため、この warn が唯一の手がかりになる。
- **env 値と DB 値の混在(シャドーイング)の規則**: config-manager の標準解決(env-only グループ外は「DB 値 ?? env 値」を**キー全体**に適用。Record の deep merge はしない)をそのまま踏襲し、アクセサ側で per-provider の deep merge を自作しない(env-only 判定の複製 = drift 源になるため)。したがって `AI_PROVIDERS` / `AI_PROVIDER_API_KEYS` / `AI_ALLOWED_MODELS` の env 値が効くのは同キーの DB 値が存在しない間だけで、管理画面の保存で DB 値が書かれた後は env 側の変更は反映されない(env 値 = 初期値として振る舞う)。接続設定を env で恒久的に統制したい運用は env-only モード(R5.2)を使う — それがモード分割の意図。観測性のため、アクセサは同一キーで DB 値と env 値が同時に定義されているのを検出したら「env 値が DB 値にシャドーされている」旨を dedup 付き info で出力する(「env を変えたのに反映されない」調査の観測点。値そのものは出力しない)。

### service / provider-availability

| Field | Detail |
|-------|--------|
| Intent | 「有効なプロバイダ」「有効なモデル集合」の単一述語と不備ログ |
| Requirements | 1.6, 1.7, 6.1, 6.2, 6.3, 6.4 |

```typescript
export type ProviderUnavailableReason =
  | 'disabled'            // enabled !== true (1.6 — ログ対象外: 管理者の意図)
  | 'missing-api-key'     // 鍵必須プロバイダで未設定 (6.1 — warn)
  | 'missing-azure-endpoint'; // azure で resourceName / baseURL とも未設定 (6.1 — warn)
```

- `disabled` は管理者の意図的な操作のためログ対象外、`missing-api-key` / `missing-azure-endpoint` は設定不備のため warn 対象とする(6.1)、という区別がこの型の設計意図。
- Preconditions: なし(config 未設定でも安全に空集合)。
- Postconditions: `getAvailableModels()` ⊆ `getAllowedModels()`。
- **不備ログ(6.1)**: enabled なのに構成不備のプロバイダは `(provider, reason)` 単位で warn。同一内容はモジュール内 dedup し、`clearAvailabilityLogDedup()`(設定保存 / s2s 更新時に `clearResolvedMastraModelCache` と同時に呼ぶ)でリセット — リクエスト毎のログ洪水を防ぎつつ、設定変更後は再通知する。
- **malformed config warn も同一の dedup・リセット契約を共有**: アクセサの防御ガード(config-definition 節)が出す `(config key, 理由)` warn は、この dedup レジストリと `clearAvailabilityLogDedup()` を共用する。レジストリは共有ヘルパ `warn-dedup.ts` に置き、config アクセサと availability の双方がそこへ依存する — config アクセサ → availability の一方向依存を保ち、循環 import を作らない。
- azure の構成済み条件: endpoint(resourceName または baseURL)必須。Entra ID 時は apiKey 免除(現行 `isAiConfigured` の条件を per-provider 化)。

### service / llm-providers config(アクセサ)

| Field | Detail |
|-------|--------|
| Intent | プロバイダ別 config 読取(availability 非依存の最下層) |
| Requirements | 1.4, 1.9 |

- プロバイダ引数付きの読取 API(設定・API キー・許可モデル)を提供する。キー不在時のエラーメッセージは provider 名 + env var 名のみでキー値を含めない。
- per-provider resolvers(openai/anthropic/google/azure-openai)は署名 `(modelId: string) => MastraModelConfig` を維持し、内部で自プロバイダ名の `requireApiKey` / `getProviderSettings` を呼ぶ。`modelResolvers` Record は不変。
- config.ts は provider-availability / effective-model-key を import しない(依存方向: config アクセサ → availability → 実効キー解決。共用するのは warn-dedup のみ)。

### service / effective-model-key(実効キー解決)

| Field | Detail |
|-------|--------|
| Intent | 実効既定モデルの決定と、リクエスト時の単一検証点 |
| Requirements | 4.6, 6.4 |

実効既定モデルの決定則(6.4)と、リクエスト時の単一検証点(4.6、System Flows 参照)を提供する。0 件の場合は throw する(ai-ready-guard が事前に 501 を返すため通常到達しない)。

- `resolveMastraModel(modelKey?)`: 実効キー解決 → `parseModelKey` → dispatch → `resolvedModelCache.set(modelKey, model)`。`clearResolvedMastraModelCache()` の呼び出し契約(put-ai-settings + s2s)は不変。

### routes / admin ai-settings API

| Field | Detail |
|-------|--------|
| Intent | 複数プロバイダ設定の取得・保存(マスク・merge 例外・env-only 分割) |
| Requirements | 1.3, 1.4, 1.5, 1.8, 1.9, 2.3, 2.4, 2.5, 2.9, 3.2, 5.2, 5.3, 5.4 |

```typescript
// features/mastra/interfaces/ai-settings.ts
export interface AiProviderStatus {
  enabled: boolean;
  isApiKeySet: boolean;                    // キー値は返さない (1.8, 1.9)
  azureOpenaiSettings?: AzureOpenaiConfig; // 'azure-openai' のみ
}
export interface AiSettingsResponse {
  aiEnabled: boolean;
  providers: Record<AiProvider, AiProviderStatus>; // 4 種すべて常に返す (固定スロット)
  allowedModels: AllowedModelForDisplay[]; // AllowedModel & { displayName } — displayName は表示専用でカタログから解決 (PUT では送らない)
  useOnlyEnvVars: boolean;
  isConfigured: boolean;
}

export interface AiProviderUpdateRequest {
  enabled?: boolean;                        // 省略 = false (full-state replace)
  apiKey?: string;                          // merge 例外: 空/省略 = 保存済みキー維持 (1.4)
  azureOpenaiSettings?: AzureOpenaiConfig;  // full-state replace ('azure-openai' のみ)
}
export interface AiSettingsUpdateRequest {
  aiEnabled?: boolean;                      // 省略 = 変更なし
  providers?: Record<AiProvider, AiProviderUpdateRequest>; // 省略 = 変更なし。存在する場合は 4 プロバイダ全エントリ必須 (validator 強制)
  allowedModels?: AllowedModel[];           // 省略 = 変更なし。存在 = full-state replace (空配列 = 許可モデルなし、3.3)
}
```

| Method | Endpoint | Request | Response | Errors |
|--------|----------|---------|----------|--------|
| GET | /_api/v3/ai-settings | — | AiSettingsResponse | 500 |
| PUT | /_api/v3/ai-settings | AiSettingsUpdateRequest | 空ボディ(`{}`) | 400(検証・env-only 違反), 500 |

- **PUT セマンティクス**: トップレベル 3 フィールド(`aiEnabled` / `providers` / `allowedModels`)は**省略 = その区画を変更しない**。存在する区画は full-state replace(暗黙リセットの解釈余地を契約から排除する — 現行の「省略 = クリア」semantics は引き継がない)。`providers` を含むリクエストは**対応 4 プロバイダの全エントリ必須**(validator で強制 — 固定スロットモデルに整合し、省略エントリの暗黙リセットという解釈余地を契約から排除する)。`allowedModels` の**空配列は「許可モデルなし」として受理し、DB に `[]` を保存**する(キー削除による env フォールバックへの暗黙リセットはしない — シャドーイング規則と一貫。0 件状態の可用性は 6.3 の「AI 未設定」に合流し、段階的セットアップ・全モデル撤去を可能にする = 3.3)。各プロバイダの `apiKey` のみ merge 例外(非空のみ更新、消去操作なし)。`ai:providerApiKeys` は「現在値 + 今回の非空キー」で再構成する(1.3, 1.4)。merge の「現在値」の読取ソースは **`getConfig('ai:providerApiKeys')` のマージ後ビュー(DB ?? env)** とする — `isApiKeySet` と同じビューなので、管理画面で「設定済み」と見えているキーは env 由来であっても保存後に必ず維持され(1.4)、稼働中の構成が UI 保存で壊れない。副作用として env 由来キーが DB へ複製され以後その env 変更は効かなくなるが、これはシャドーイング規則(config-definition 節)どおりの標準挙動。さらに**非空の `apiKey` を 1 つも含まないリクエストでは `ai:providerApiKeys` を updates に含めない**(書かない = DB 値を作らない)— トグルや許可モデルだけの保存で env 運用中のキーが DB に複製・固定化されることを防ぐ。
- **並行更新(lost update)の扱い**: PUT は last-write-wins とし、楽観ロック等の並行制御は導入しない(現行 AiSettings と同じ特性。管理画面の同時編集の直列化は保証しない — R1.3 の「独立」は、1 リクエストが他プロバイダの保存値を意図的に変更しないことを指す)。ただし `apiKey` merge の「現在値」は**保存処理内で読み取ることを必須とする**(GET 時点のスナップショットやフォーム由来の値から Record を再構成してはならない)。キー値は応答に含まれず「空 = 維持」のため、フォームの古い状態からキー素材が巻き戻ることは構造的に起きず、他プロバイダのキー(例: ローテーション直後の新キー)が旧値へ戻り得るのは同時 PUT のハンドラ内 read→write 間の短い窓のみに限定される(マルチインスタンス構成では、他インスタンスの直前の保存が s2s `configUpdated` で自インスタンスの config キャッシュに反映されるまでの伝搬遅延分だけ窓が延びる)。`ai:providers`(トグル・Azure 設定)はフォーム全量置換のため同時編集では後勝ちが先の変更を上書きし得るが、これは管理画面上で可視であり再設定で回復可能。
- **env-only 分割(5.2/5.3)**: `env:useOnlyEnvVars:ai` 有効時、`providers` または `aiEnabled` を含むリクエストは 400(明示拒否)。`allowedModels` のみのリクエストは通常どおり検証・保存(5.4: validate-allowed-models は経路共通)。この 400 契約と対になるクライアント側の送出分岐(env-only 時は `allowedModels` のみの body を構成する)は管理画面の `buildUpdateRequest` が担う(client / 管理画面 節参照)— 分岐がないと env-only 時に Update が常に 400 になり R5.3 を満たせない。
- **validate-allowed-models**: 各エントリ = `isAiProvider(provider)`(2.5)∧ modelId 非空 ∧ (provider, modelId) 一意(2.3, 2.4)∧ providerOptions namespace 形式 ∧ isDefault ちょうど 1 つ(3.2 — **非空リストのみに適用**。空配列は「許可モデルなし」として受理する = 3.3)。所属プロバイダの構成状態は検証しない(2.9)。
- **PUT 応答形**: 成功応答は**空ボディ(`res.apiv3({})`)**とし、更新後の設定を返さない。クライアント(`useAiSettings`)は保存成功後に SWR `mutate()` で GET を再取得してフォームを再シードする(秘匿規律とも整合: 応答にキー素材を一切載せない)。
- **秘匿規律(1.9)**: catch でも request body を stringify しない。エラーログ(`logger.error`)にも apiKey を載せない(現行パターン)。保存成功後 `clearResolvedMastraModelCache()` + availability ログ dedup リセット。

### routes / chat API(get-models・post-message)

| Field | Detail |
|-------|--------|
| Intent | 有効モデル集合の提供と、リクエスト単位のモデル検証・切替 |
| Requirements | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.2 |

```typescript
// features/mastra/interfaces/chat-models-response.ts
export interface ChatModelEntry {
  key: ModelKey;         // クライアントが送信・保存に使う不透明キー
  provider: AiProvider;  // 表示用 (グループ見出し。getProviderLabel でラベル表示)
  modelId: string;       // 識別子 (同名モデルの曖昧性解消・キー生成用)
  displayName: string;   // 表示用 (カタログ由来の公式表示名。id フォールバック)
}
export interface ChatModelsResponse {
  models: ChatModelEntry[];      // 有効なプロバイダのモデルのみ・許可リスト順
  selectedModelKey: ModelKey;    // 保存キーが有効なら保存キー、でなければ実効既定 (4.4, 4.5)
}
```

| Method | Endpoint | Request | Response | Errors |
|--------|----------|---------|----------|--------|
| GET | /_api/v3/mastra/models | — | ChatModelsResponse | 501(ai-ready-guard), 500 |
| POST | /_api/v3/mastra/message | `{ threadId, modelKey?, messages }` | SSE stream | 400, 501, 500 |

- post-message は `resolveEffectiveModelKey(modelKey)` を**リクエストで 1 回だけ**解決し、その実効キーを requestContext(`modelKey`)と `getProviderOptionsForModel` の両方に渡す(現行パターン)。
- `UserUISettings.aiChatSelectedModelKey`: PUT /_api/v3/user-ui-settings の validator(長さ ≤ `MAX_MODEL_KEY_LENGTH`)と updateData ハードコード allow-list を改名フィールドへ更新。サーバは保存時に意味検証しない(読出し側 get-models で丸める — 現行方針)。

### client / 管理画面(モック準拠)

Summary-only(新規境界なし。契約は上記 DTO と RHF フォーム値)。

```typescript
// ai-settings-form-values.ts
export interface ProviderFormValue {
  enabled: boolean;
  apiKey: string; // write-only。'' = 変更なし
  azureOpenaiSettings: Required<AzureOpenaiConfig>; // azure-openai パネルのみ使用
}
export interface AllowedModelFormValue {
  provider: AiProvider;
  modelId: string;
  providerOptionsText: string;
  isDefault: boolean;
}
export interface AiSettingsFormValues {
  aiEnabled: boolean;
  providers: Record<AiProvider, ProviderFormValue>;
  allowedModels: AllowedModelFormValue[]; // フラット単一配列 (グローバル既定検証のため)
}
```

- **buildUpdateRequest(フォーム → 更新リクエスト)**: 通常時は `{ aiEnabled, providers(4 エントリすべて) }` を送出。**env-only 時(`useOnlyEnvVars: true`)は `providers` / `aiEnabled` を body に含めない**(PUT の env-only 400 契約に対応するクライアント側責務 — 5.3)。`allowedModels` は**リストが dirty(react-hook-form 上で実際に編集された)ときのみ送出**し、未編集なら省略する(PUT の「省略 = 変更なし」に委ねる)。理由: env シードの許可モデルリストは既定なし(0 件既定)でも実行時は先頭フォールバックで有効だが、PUT の「ちょうど 1 つの既定」検証(3.2)では弾かれる。未編集リストを毎回そのまま送ると、プロバイダトグル/apiKey/aiEnabled だけの無関係な保存まで 400 になるため、dirty 時のみ送る。結果として env-only かつリスト未編集の保存は空 body(`{}`)になり得る(サーバは全区画省略として何も変更しない)。
- **AiSettings.tsx**: AI 有効トグル → DefaultModelSelector → ProviderTabs(アクティブタブ state)→ ProviderPanel(アクティブのみ mount)→ Update。
- **DefaultModelSelector**: `allowedModels` を provider でグループ表示し、選択 = 対象行の `isDefault` を true・他を false(3.1)。ProviderPanel 行内の★と同一の書き換え(共有ヘルパ)。
- **ProviderPanel**: 有効トグル(1.5)・API キー入力(設定済みは `(configured)` placeholder、1.8)・「API key set / not set」チップ・AllowedModelsField(provider prop)・azure のみ AzureOpenaiSettings。env-only 時は接続設定系フィールドを disabled(5.2)、モデル編集は活性のまま(5.3)。
- **AllowedModelsField**: カタログ対応プロバイダは select(登録済み除外)、非対応は自由入力(2.6, 2.7 — picker 実装を provider スコープで流用)。既存の手動カタログリフレッシュ導線は維持する(picker 所管の機能を UI 再構成で失わない)。同一プロバイダ内重複はクライアントでも行エラー表示(2.4。最終判定はサーバ)。既定の不変条件はフォーム操作でも維持する: 空リストへ最初のモデルを追加したときは `isDefault` を自動付与し、既定行を削除したときは残存する先頭行へ既定を付け替える(残 0 件なら既定なし — 3.1/3.3。付替えは共有ヘルパ経由)。これにより通常のフォーム操作から 3.2 の検証エラーに到達しない。**index 整合の制約**: グローバル `allowedModels` 配列に対する単一 `useFieldArray` を維持し、provider によるフィルタは**表示のみ**とする。remove/update/★付替えは必ず原配列 index を保持した対応付け(表示行 → 原 index のマップ)経由で行い、フィルタ後 index を配列操作に直接使わない(越境操作バグの防止。component テストで検証)。
- i18n: 新キーは `ai_settings.providers_*` / `ai_settings.default_model_*` 系。5 ロケール(en/ja/zh/fr/ko)同時更新。

### client / ChatSidebar セレクタ

Summary-only。`useSWRxChatModels` の新型に追従し、`models` を provider でグループ化して `PromptInputModelSelectGroup` + `PromptInputModelSelectLabel`(新設ラッパ、実体は `ui/select` の SelectGroup/SelectLabel)で表示(4.1, 4.2)。グループ見出しは `getProviderLabel(group.provider)`(例「OpenAI」)、各項目は `entry.displayName`(公式表示名)を表示。選択状態は `modelKey`(feature ローカル useState + ライブ getter — 機構不変、4.7)。変更時 `scheduleToPut({ aiChatSelectedModelKey })`(4.4)。トリガ表示は `formatModelLabel(provider, displayName)` = 「\<プロバイダー表示名\> · \<displayName\>」(例「OpenAI · GPT-4o」。プロバイダ間で同名モデルが共存しても閉状態で判別可能 — 4.2)。

## Data Models

### Physical Data Model(MongoDB Config KV)

Config コレクションは key-value(値 JSON)のため**スキーマ変更なし**。保存例:

```json
// ai:providers
{ "openai":  { "enabled": true },
  "azure-openai": { "enabled": true,
    "azureOpenaiSettings": { "resourceName": "my-res", "useEntraId": true } },
  "google":  { "enabled": false } }

// ai:providerApiKeys  (isSecret)
{ "openai": "sk-...", "anthropic": "sk-ant-..." }

// ai:allowedModels
[ { "provider": "openai", "modelId": "gpt-5", "isDefault": true },
  { "provider": "anthropic", "modelId": "claude-sonnet-5",
    "providerOptions": { "anthropic": { "thinking": { "type": "enabled", "budgetTokens": 12000 } } } },
  { "provider": "azure-openai", "modelId": "prod-deployment" } ]
```

- 不変条件: `ai:allowedModels` 内で (provider, modelId) 一意・非空のとき `isDefault: true` はちょうど 1 件(PUT validator が保証。空配列は「許可モデルなし」の正当な状態 = 3.3。env 直書きの逸脱値はアクセサの防御ガード + 実効既定フォールバックで fail-soft)。
- UserUISettings: `aiChatSelectedModelKey: { type: String }`(旧 `aiChatSelectedModelId` は削除。プレリリースにつき残存値は放置 = 参照されない)。

## Error Handling

- **管理 PUT(400)**: 検証失敗(2.4, 2.5, 3.2, providerOptions 不正)は該当箇所を特定できるメッセージで拒否。env-only 違反(5.2)は「接続設定は環境変数でのみ変更可能」の明示エラー。エラーメッセージ・ログに API キー値を含めない(1.9)。
- **チャット経路**: AI 未設定(有効モデル 0)は ai-ready-guard の 501(6.3、既存)。有効集合外の modelKey は例外にせず実効既定へ丸め + warn(4.6 — ユーザー操作を止めない)。resolver の構成不備 throw はキャッシュされず、修正が次リクエストから効く(現行原則)。
- **部分縮退(6.1)**: enabled ∧ 構成不備は選択肢から除外し、`(provider, reason)` dedup 付き warn。アプリ本体は常に継続(6.3)。
- **不正な設定値(malformed config)の観測性**: JSON env(`AI_PROVIDERS` / `AI_PROVIDER_API_KEYS` / `AI_ALLOWED_MODELS`)や DB 値が期待形状でない場合、アクセサは「未設定」として fail-soft しつつ `(config key, 理由)` の warn を dedup 付きで出力する — ログゼロでの AI 機能無効化(fail-silent)を排除する(R5.1 の env-only 運用で特に重要)。warn には値そのもの(特に `ai:providerApiKeys`)を含めず、config key 名と理由のみ。dedup のリセットは 6.1 の不備ログと同一契約(設定保存 / s2s 更新時)。
- **観測性**: ログはプロバイダ名・reason・モデルキーのみ(秘匿値なし)。

## Manual Verification Procedures

自動テストでは検証できない、実 API キー + ブラウザ操作が必要な手動確認手順(コピペ可能な env 例は [docs/env-configuration-examples.md](./docs/env-configuration-examples.md) を参照):

1. **プロバイダ横断のモデル切替**: 実 API キーで OpenAI + Anthropic を有効化し管理画面 `/admin/ai` を開く。4 プロバイダタブが常時表示され、構成済みプロバイダにドット表示があり、保存できることを確認する。チャットサイドバーのモデルセレクタが両プロバイダのモデルをプロバイダ別グループ見出しで表示し、トリガ表示が「プロバイダ名 · モデル名」であることを確認する。一方のプロバイダのモデルで送信して応答を得たあと、他方のプロバイダのモデルへ切替えて送信し、切替後のプロバイダで生成されることを確認する。管理画面で許可モデルを追加保存し、サーバを再起動せずチャットのセレクタに反映されることを確認する。
2. **部分縮退**: 管理画面で一方のプロバイダ(例: Anthropic)を無効化して保存する。チャットのセレクタからそのプロバイダのモデルが消え、他方のみ残ることを確認する。サーバログに、そのプロバイダの構成不備の理由(キー値を含まない)を示す warn が出力され、アプリ本体は継続動作することを確認する。
3. **env-only モード**: `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true` で起動し管理画面を開く。有効トグル・API キー・Azure 接続設定が読み取り専用(disabled)表示であることを確認する。許可モデルの追加・既定モデルの変更・provider オプション編集は保存でき、反映されることを確認する(接続設定は変更不可だがモデル設定は編集可能という部分ロックの目視確認)。

## Security Considerations

- **キーローテーションの巻き戻り窓(既知の制約)**: 同時 PUT では `ai:providerApiKeys` の read-modify-write により直前のキーローテーションが旧キーで上書きされ得る。merge の現在値を保存処理内で読む契約(routes 節参照)により窓はハンドラ内 read→write 間に限定されるが、ゼロにはならない(`isApiKeySet` からは検知できない)。楽観ロックは導入せず既知の制約として許容する。

## Supporting References

- 調査ログ・判断の経緯: [research.md](./research.md)(gap 分析、D1–D8、RN-1/RN-2 の解決)
- env var 構成の記述例(運用者向け): [docs/env-configuration-examples.md](./docs/env-configuration-examples.md)
