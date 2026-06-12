# Technical Design: admin-ai-settings

## Overview

**Purpose**: 本フィーチャーは、GROWI 管理者が `/admin/ai` の管理画面から AI(Mastra LLM プロバイダー)連携の `ai:*` 設定値を参照・更新できるようにする。これまで環境変数でのみ構成可能だった 8 つの設定キーを UI から管理可能にし、Azure OpenAI 固有の接続設定は同画面内の専用セクションで扱う。

**Users**: GROWI 管理者が AI 機能の構成(プロバイダー選択・認証情報・モデル・プロバイダーオプション・Azure 接続設定)を、環境変数を編集せずに変更するために利用する。

**Impact**: 既存の「環境変数専用モード」機構(`ENV_ONLY_GROUPS` + `shouldUseEnvOnly`)を `ai:*` グループに拡張する。制御用環境変数(`env:useOnlyEnvVars:ai`)が有効なとき、AI 設定は環境変数の値で固定され DB 値は無視される。`getConfig` のコアロジックは変更せず、設定定義に制御キーとグループを宣言するのみ。さらに、設定更新がサーバー再起動なしに反映されるよう、メモ化された Mastra モデルの無効化機構を追加する。

### Goals
- `ai:*` 8 キーを `/admin/ai` から参照・更新できる(共通設定 + Azure 専用設定)
- 環境変数専用モードが有効なときは環境変数で固定し、UI 上で編集不可・モード明示、API でも更新を拒否する
- 設定更新後、サーバー再起動なしに次回の AI 実行へ反映する
- API キーを画面・API 応答で露出させない

### Non-Goals
- AI 機能(チャット・エディタ支援)自体の挙動変更
- 新しい LLM プロバイダーの追加
- `app:aiEnabled`(AI 機能の有効/無効トグル)の管理 ― 本画面では扱わない
- LLM への接続テスト(疎通確認)機能
- `ai:` 以外の設定キーの管理、保存時暗号化(encryption-at-rest)
- 旧 AI 連携画面(`/admin/ai-integration`)の復元

## Boundary Commitments

### This Spec Owns
- `/admin/ai` 管理ページ、AI 設定クライアントコンポーネント群、ナビゲーション項目
- AI 設定専用の apiv3 ルート(GET/PUT)とその入力検証・監査ログ発火
- `ai:*` 8 キーに対する**環境変数専用モード**(既存 `ENV_ONLY_GROUPS` への新グループ + 制御キー `env:useOnlyEnvVars:ai` の宣言)
- 設定更新時の **Mastra モデルメモ無効化**(ローカル + S2S 経由)
- 新スコープ `admin:ai`(read/write)の定義

### Out of Boundary
- `configManager.updateConfigs` / `loadConfigs` / S2S `configUpdated` の発行機構そのもの(既存を利用するのみ)
- Mastra のモデル構築ロジック(`modelResolvers`、各 provider resolver)の内容 ― メモの**破棄点**のみ追加し、構築の中身は変更しない
- `getConfig` / `shouldUseEnvOnly` のコアロジック(変更せず、宣言データ `ENV_ONLY_GROUPS`/`CONFIG_DEFINITIONS` の追加のみ)
- `ai:*` 以外のキーの解決順序
- `app:aiEnabled` および `isAiEnabled()` ゲートの挙動

### Allowed Dependencies
- `@growi/core`(`SCOPE`, `ConfigSource`, 型)― scope 追加のためのみ編集
- `~/server/service/config-manager`(`configManager` シングルトン、`ConfigKey`/`ConfigValues`)
- `~/features/mastra/interfaces/ai-provider`(`AI_PROVIDERS`, `isAiProvider`)
- 管理ページ共通基盤(`createAdminPageLayout`, `getServerSideAdminCommonProps`)、apiv3 ミドルウェア(`accessTokenParser`, `adminRequired`, `addActivity`, `apiV3FormValidator`)、`apiv3Get`/`apiv3Put`、`toastSuccess`/`toastError`
- 依存方向: **Core(scope/types) → config-manager → mastra server(resolver / route / sync) → apiv3 登録**。client は interfaces にのみ依存。config-manager は mastra に依存しない(`config-definition.ts` の `AiProvider` は型限定 import で既存・許容)

### Revalidation Triggers
- `ai:*` キーの追加/削除/リネーム → `ENV_ONLY_GROUPS` の `ai` グループ・DTO・UI・検証の同期が必要
- `env:useOnlyEnvVars:ai` 制御キー / グループ対象キーの変更 → 固定対象の AI 設定消費者の挙動に波及
- `configUpdated` S2S メッセージ契約の変更 → メモ無効化ハンドラの再確認
- `AiProvider` union(サポートプロバイダー)変更 → provider 検証・UI 選択肢の同期

## Architecture

### Existing Architecture Analysis
- **設定解決**: `ConfigManager.getConfig`(`config-manager.ts` L65-91)は既定で `dbConfig ?? envConfig`(DB 優先 + env フォールバック)。env 専用化は `ENV_ONLY_GROUPS` の制御キー(`env:useOnlyEnvVars:*`)が env で true の場合のみ作用する opt-in 機構。本フィーチャーは既存 `ENV_ONLY_GROUPS` に `ai` グループ(制御キー `env:useOnlyEnvVars:ai`)を追加して env 専用化を実現する。`getConfig`/`shouldUseEnvOnly` のコアは無変更。
- **設定書込・伝播**: `updateConfigs` → DB upsert → ローカル `loadConfigs` → S2S `configUpdated` publish。他インスタンスは `configManager.handleS2sMessage` で `loadConfigs` 再実行。
- **モデルメモ**: `resolve-mastra-model.ts` のモジュールスコープ `memoizedModel` は無効化されない。agent は `model: () => resolveMastraModel()` と遅延評価のため、メモ破棄だけで次回リクエストに反映される(agent 再生成不要)。`resolveProviderOptions` は非メモ化のため対応不要。
- **管理ページ**: 最新は vault パターン(`dynamic(ssr:false)` + `createAdminPageLayout` + `getServerSideAdminCommonProps`、unstated コンテナ不使用)。

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph Client
        Page[admin ai page]
        UI[AiSettings component]
        Hook[useAiSettings SWR hook]
    end
    subgraph Server_apiv3
        Route[ai-settings admin router]
    end
    subgraph ConfigCore
        CM[ConfigManager shouldUseEnvOnly]
        Def[config-definition ENV_ONLY_GROUPS ai]
    end
    subgraph MastraFeature
        Resolver[resolve-mastra-model cache]
        Sync[model-config-sync handler]
    end
    subgraph Infra
        DB[(configs collection)]
        S2S[s2s messaging configUpdated]
    end

    Page --> UI --> Hook --> Route
    Route -->|getConfig| CM
    Route -->|updateConfigs| CM
    Route -->|clear after update| Resolver
    CM --> Def
    CM --> DB
    CM -->|publish| S2S
    S2S -->|configUpdated| Sync
    Sync -->|clear| Resolver
    Sync -->|handlable| S2S
```

**Architecture Integration**:
- 選択パターン: feature-based(AI 設定一式を `features/mastra` 配下に集約)+ 既存設定基盤の宣言的拡張。
- 境界分離: env 専用化は既存 `ENV_ONLY_GROUPS` 機構を利用し、宣言(制御キー + グループ)は `config-definition` に集約。`config-manager` のコアは無変更。UI/route は mastra feature。core 変更は scope のみ。
- 保持する既存パターン: apiv3 admin ルート(scope + adminRequired + addActivity + apiV3FormValidator)、vault 管理ページ雛形、S2S 再初期化(MailService 型)、シークレット `undefined` 返却。
- Steering 準拠: feature-based、named export、server/client 分離、immutability、type-safe(`any` 不使用)。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Frontend | Next.js Pages Router, React 18, Jotai + SWR, reactstrap | `/admin/ai` ページと設定 UI、設定の取得/保存 | vault 管理ページ雛形を踏襲 |
| Backend | Express apiv3, express-validator | AI 設定 GET/PUT、入力検証、監査ログ | 既存 admin ルートパターン |
| Config | ConfigManager `ENV_ONLY_GROUPS` 機構 | 環境変数専用モードによる固定 | 制御キー + グループ宣言の追加のみ(コア無変更) |
| Messaging | S2S messaging(`configUpdated`) | モデルメモの multi-instance 無効化 | 既存メッセージを購読 |
| Data | MongoDB `configs` コレクション | `ai:*` 値の永続化(平文、既存方式) | スキーマ変更なし |

## File Structure Plan

### New Files
```
packages/core/src/interfaces/
└── scope.ts                       # [modified] admin:ai を seed と型 union に追加

apps/app/src/features/mastra/
├── interfaces/
│   └── ai-settings.ts             # GET/PUT DTO 型、編集対象キー一覧 (AI_SETTING_KEYS)
├── server/
│   ├── routes/
│   │   └── admin-ai-settings/
│   │       ├── index.ts           # ルータ factory (GET /, PUT /)
│   │       ├── get-ai-settings.ts # GET ハンドラ: 有効値 + isApiKeySet + useOnlyEnvVars
│   │       ├── put-ai-settings.ts # PUT ハンドラ: 検証→env専用モード拒否→updateConfigs→cache clear→activity
│   │       └── validators.ts      # express-validator チェーン(provider enum / providerOptions JSON / boolean)
│   └── services/
│       └── model-config-sync.ts   # S2sMessageHandlable: configUpdated 受信で resolveMastraModel cache を破棄
└── client/
    └── admin/
        ├── index.ts               # barrel: AiSettings を公開
        ├── AiSettings.tsx         # コンテナ: 取得・保存・トースト・セクション統合
        ├── ProviderCommonSettings.tsx  # ai:provider / apiKey / model / providerOptions
        ├── AzureOpenaiSettings.tsx     # azure 4 キー(provider=azure-openai 時に有効化)
        ├── EnvOnlyModeNotice.tsx       # 環境変数専用モード有効時の alert(各入力は flag 連動で readOnly)
        └── use-ai-settings.ts          # SWR フック(apiv3Get) + 保存関数(apiv3Put)

apps/app/src/pages/admin/
└── ai.page.tsx                    # vault パターン: dynamic(ssr:false) で AiSettings を描画
```

### Modified Files
- `apps/app/src/server/service/config-manager/config-definition.ts` — 制御キー `env:useOnlyEnvVars:ai`(env 変数 `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS`)を `CONFIG_KEYS` + `CONFIG_DEFINITIONS` に追加し、`ENV_ONLY_GROUPS` に `ai:*` 8 キーを対象とするグループを追加(`config-manager.ts` のコアは変更不要)
- `apps/app/src/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model.ts` — `clearResolvedMastraModelCache()` を追加・export
- `apps/app/src/server/crowi/index.ts` — `setupS2sMessagingService()` で `model-config-sync` ハンドラを `addMessageHandler` 登録
- `apps/app/src/server/routes/apiv3/index.js` — `routerForAdmin.use('/ai-settings', ...)` でマウント
- `apps/app/src/interfaces/activity.ts` — `ACTION_ADMIN_AI_SETTING_UPDATE` を追加し SupportedAction に登録
- `apps/app/src/components/Admin/Common/AdminNavigation.tsx` — `'ai'` メニュー(MenuLabel case + MenuLink + モバイル MenuLabel)
- `apps/app/public/static/locales/{en_US,ja_JP,zh_CN,fr_FR,ko_KR}/admin.json` — `ai_settings.*` キー群、`commons` の activity ラベル

## System Flows

### 設定保存と即時反映(ローカル + マルチインスタンス)

```mermaid
sequenceDiagram
    participant Admin
    participant UI as AiSettings
    participant API as ai-settings PUT
    participant CM as ConfigManager
    participant Cache as resolveMastraModel cache
    participant S2S as s2s configUpdated
    participant Other as Other instance Sync

    Admin->>UI: 値を編集して保存
    UI->>API: PUT ai-settings
    API->>API: 検証 (provider enum, providerOptions JSON)
    API->>CM: 環境変数専用モードか確認 (env:useOnlyEnvVars:ai)
    alt 環境変数専用モードが有効
        API-->>UI: 422 更新拒否
    else 正常
        API->>CM: updateConfigs(ai 値)
        CM->>S2S: publish configUpdated
        API->>Cache: clearResolvedMastraModelCache (local)
        API-->>UI: 200 + 最新値
        S2S-->>Other: configUpdated
        Other->>CM: loadConfigs
        Other->>Cache: clearResolvedMastraModelCache (remote)
    end
    Note over Cache: 次回 chat 要求で resolveMastraModel が<br/>最新 config から再構築される
```

ゲーティング決定: 環境変数専用モード時の拒否は防御的多重化(UI でも入力 disable 済)。`getConfig` が既にこのモードで env 値を返すため DB へ書けても効果はないが、R4.3 として明示的に拒否する。ローカルはメモを直接破棄、リモートは `configUpdated` 購読で破棄(`updateConfigs` は自インスタンスへ配信しないため両経路が必要)。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | 管理者が `/admin/ai` 表示 | ai.page, AiSettings | getServerSideAdminCommonProps | — |
| 1.2 | 非管理者アクセス拒否 | admin-ai-settings router, ai.page | adminRequired, accessTokenParser(admin:ai) | — |
| 1.3 | ナビに AI 項目 | AdminNavigation | MenuLabel/MenuLink 'ai' | — |
| 1.4 | 現在有効値の表示 | get-ai-settings, useAiSettings | GET ai-settings | 保存反映フロー |
| 2.1 | 共通設定の入力欄 | ProviderCommonSettings | AiSettingsDto | — |
| 2.2 | provider 選択肢を限定 | ProviderCommonSettings, validators | AI_PROVIDERS, isAiProvider | — |
| 2.3 | 保存と結果通知 | AiSettings, put-ai-settings | PUT, toastSuccess/Error | 保存反映フロー |
| 2.4 | 再起動なし反映 | resolve-mastra-model, model-config-sync | clearResolvedMastraModelCache | 保存反映フロー |
| 3.1 | Azure 専用設定欄 | AzureOpenaiSettings | AiSettingsDto(azure 群) | — |
| 3.2 | 非 azure 時の非適用提示 | AzureOpenaiSettings | provider 状態 | — |
| 3.3 | EntraId 時の apiKey 不使用提示 | AzureOpenaiSettings | azureOpenaiUseEntraId | — |
| 3.4 | deployment 名の案内 | AzureOpenaiSettings | i18n 注記 | — |
| 4.1 | env 専用モード時は env 値を使用 | config-definition(ai グループ), ConfigManager.shouldUseEnvOnly | ENV_ONLY_GROUPS | — |
| 4.2 | env 専用モード時に編集不可 + モード明示 | EnvOnlyModeNotice, get-ai-settings | useOnlyEnvVars フラグ | — |
| 4.3 | env 専用モード時の更新を拒否 | put-ai-settings | PUT(422) | 保存反映フロー |
| 4.4 | モード無効時は画面値優先・env を既定値 | ConfigManager.getConfig, put-ai-settings | updateConfigs(db ?? env) | — |
| 5.1 | apiKey をマスク入力 | ProviderCommonSettings | password input | — |
| 5.2 | apiKey を平文表示しない | get-ai-settings | isApiKeySet(値非返却) | — |
| 5.3 | エラーに機密を含めない | put/get ハンドラ | ErrorV3 | — |
| 6.1 | provider 不正を拒否 | validators, put-ai-settings | isAiProvider | — |
| 6.2 | providerOptions JSON 検証 | ProviderCommonSettings, validators | JSON.parse チェック | — |
| 6.3 | 保存失敗時に通知 + 入力保持 | AiSettings | toastError, ローカル state | 保存反映フロー |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|-----------|--------------|--------|--------------|------------------|-----------|
| config-definition (ai env-only グループ) | Config core | `env:useOnlyEnvVars:ai` 制御キー + グループ宣言で env 専用化 | 4.1, 4.4 | ENV_ONLY_GROUPS (P0) | — |
| admin-ai-settings router | Server apiv3 | GET/PUT、検証、env 専用モード拒否、監査、cache clear | 1.2,1.4,2.2,2.3,4.3,5.2,5.3,6.1,6.2 | configManager (P0), resolver (P0) | API |
| model-config-sync | Mastra server | `configUpdated` 購読で model cache 破棄 | 2.4 | s2s, resolver (P0) | Event |
| resolve-mastra-model (cache 拡張) | Mastra server | メモ破棄点の提供 | 2.4 | — | Service |
| AiSettings | Client | 取得/保存/トースト/セクション統合 | 1.1,2.3,6.3 | useAiSettings (P0) | State |
| ProviderCommonSettings / AzureOpenaiSettings / EnvOnlyModeNotice | Client UI | 各設定欄、env 専用モード表示、azure 専用 | 2.1,3.x,4.2,5.1,6.2 | AiSettings (P1) | — |

### Config core

#### config-definition (ai env-only グループ)

| Field | Detail |
|-------|--------|
| Intent | 既存 `ENV_ONLY_GROUPS` 機構に `ai` グループを宣言し、制御キーが有効なとき `ai:*` を env 専用化する |
| Requirements | 4.1, 4.4 |

**Responsibilities & Constraints**
- 宣言のみ。`getConfig` / `shouldUseEnvOnly` のコアロジックは**変更しない**(既存の opt-in 機構をそのまま流用)。
- 制御キー `env:useOnlyEnvVars:ai` が env で `true` のとき、グループ対象の `ai:*` 8 キーは `getConfig` が **env 値のみ**を返す(DB 無視)。`false`/未設定なら既存どおり `db ?? env`(R4.4: env は既定値、UI 値が優先)。
- グループ対象キーは provider 共通 4 + Azure 4 の計 8。1 制御キーで一括(gcs/azure グループと同型)。
- `ConfigKey` は `CONFIG_KEYS` 由来のため、制御キーを `CONFIG_KEYS` と `CONFIG_DEFINITIONS` の両方に登録する。

**Dependencies**
- Outbound: `ENV_ONLY_GROUPS`(既存)、`shouldUseEnvOnly`(既存、無変更で利用)(P0)
- External: なし

**Contracts**: なし(設定定義データの追加のみ)

##### 宣言内容
```typescript
// config-definition.ts — CONFIG_DEFINITIONS に追加
'env:useOnlyEnvVars:ai': defineConfig<boolean>({
  envVarName: 'AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS',
  defaultValue: false,
}),

// ENV_ONLY_GROUPS に追加
{
  controlKey: 'env:useOnlyEnvVars:ai',
  targetKeys: [
    'ai:provider', 'ai:apiKey', 'ai:model', 'ai:providerOptions',
    'ai:azureOpenaiResourceName', 'ai:azureOpenaiBaseUrl',
    'ai:azureOpenaiApiVersion', 'ai:azureOpenaiUseEntraId',
  ],
},
```
- Precondition: 制御キーが `CONFIG_KEYS`/`CONFIG_DEFINITIONS` に登録済み。
- Postcondition: `getConfig('env:useOnlyEnvVars:ai') === true` のとき、`shouldUseEnvOnly('ai:*')` が true を返し env 値のみ解決。
- Invariant: 制御キーが false のとき、既存挙動(`db ?? env`)から変化しない。

**Implementation Notes**
- Integration: `config-manager.ts` の `initKeyToGroupMap()` が起動時に自動でマッピングを構築するため、追加コードは不要。
- Validation: 制御キー true/false での `getConfig('ai:provider')` 解決を単体テストで固定。
- Risks: 既存 `ai:*` 利用者は現状ほぼ全員 `AI_*` env を設定済み。env 専用モードを有効化しない限り挙動は不変(env は従来どおりフォールバック)であることをテストで担保。

### Server apiv3

#### admin-ai-settings router

| Field | Detail |
|-------|--------|
| Intent | AI 設定の取得/更新 API。検証・env 専用モード拒否・監査・キャッシュ破棄を担う |
| Requirements | 1.2, 1.4, 2.2, 2.3, 4.3, 5.2, 5.3, 6.1, 6.2 |

**Responsibilities & Constraints**
- 全エンドポイントに `accessTokenParser([SCOPE.READ|WRITE.ADMIN.AI])` + `loginRequiredStrictly` + `adminRequired`。
- `routerForAdmin` 配下にマウント(`/_api/v3/ai-settings`)。`isAiEnabled()` ゲートは**付けない**(AI 無効時も設定可能=R1)。
- GET は `ai:apiKey` の値を返さない(`isApiKeySet: boolean` のみ)。`useOnlyEnvVars: boolean`(`env:useOnlyEnvVars:ai` の状態)を返し、UI の編集可否を決定させる。
- PUT は環境変数専用モード有効時(`getConfig('env:useOnlyEnvVars:ai') === true`)に 422 で拒否(SiteUrlSetting の拒否パターン)。`apiKey` が空/未指定なら既存値を保持(クリアしない)。
- 例外メッセージに機密値を含めない(`ai:apiKey` を出力しない)。

**Dependencies**
- Outbound: `configManager`(getConfig/updateConfigs)(P0)、`clearResolvedMastraModelCache`(P0)、`activityEvent`(P1)
- External: express-validator(P1)

**Contracts**: API [x]

##### API Contract
| Method | Endpoint | Request | Response | Errors |
|--------|----------|---------|----------|--------|
| GET | /_api/v3/ai-settings | — | `AiSettingsResponse` | 401, 403, 500 |
| PUT | /_api/v3/ai-settings | `AiSettingsUpdateRequest` | `AiSettingsResponse` | 400, 403, 422, 500 |

```typescript
// interfaces/ai-settings.ts
export interface AiSettingsResponse {
  provider?: AiProvider;
  model?: string;
  providerOptions?: string;            // raw JSON string
  azureOpenaiResourceName?: string;
  azureOpenaiBaseUrl?: string;
  azureOpenaiApiVersion?: string;
  azureOpenaiUseEntraId: boolean;
  isApiKeySet: boolean;                // ai:apiKey の値は返さない (5.2)
  useOnlyEnvVars: boolean;             // env:useOnlyEnvVars:ai 有効時 全項目編集不可 (4.2)
}

export interface AiSettingsUpdateRequest {
  provider?: AiProvider;
  apiKey?: string;                     // 空/未指定なら既存保持 (5.x)
  model?: string;
  providerOptions?: string;
  azureOpenaiResourceName?: string;
  azureOpenaiBaseUrl?: string;
  azureOpenaiApiVersion?: string;
  azureOpenaiUseEntraId?: boolean;
}
```
- Idempotency: PUT は冪等(同値再送で副作用は cache clear のみ)。
- Validation: `provider ∈ AI_PROVIDERS`(6.1)、`providerOptions` は非空時 `JSON.parse` 可能(6.2)、`azureOpenaiUseEntraId` は boolean。
- 成功時副作用: `updateConfigs` → `clearResolvedMastraModelCache()` → `activityEvent.emit('update', _id, { action: ACTION_ADMIN_AI_SETTING_UPDATE })`。

**Implementation Notes**
- Integration: ハンドラを `get-ai-settings.ts` / `put-ai-settings.ts` に分割、検証を `validators.ts` に抽出(pure functions)。
- Validation: env 専用モード拒否、apiKey 非返却、provider/providerOptions 検証、activity 発火を integ テスト。
- Risks: `apiKey` の「未指定=保持/空=保持」境界を明確化(誤クリア防止)。

#### model-config-sync

| Field | Detail |
|-------|--------|
| Intent | 他インスタンスでの設定更新を受けて model cache を破棄 |
| Requirements | 2.4 |

**Contracts**: Event [x]

##### Event Contract
- Subscribed: `configUpdated`(`S2sMessageHandlable`)。`shouldHandleS2sMessage`: `eventName === 'configUpdated'`。`handleS2sMessage`: `clearResolvedMastraModelCache()`。
- Published: なし。
- Delivery: `configManager` ハンドラと並行登録。順序非依存(メモ破棄は config 再ロードに先行しても次回 `getConfig` が最新を読むため安全)。

**Implementation Notes**
- Integration: `crowi/index.ts setupS2sMessagingService()` で `addMessageHandler` 登録。
- Risks: `configUpdated` は全 config 更新で発火 → ai 以外の更新でも破棄(過剰無効化)。設定変更は稀のため許容。Azure+Entra のトークンキャッシュ消失は変更時のみで影響軽微。

#### resolve-mastra-model (cache 拡張)

**Contracts**: Service [x]
```typescript
export const clearResolvedMastraModelCache = (): void => { /* memoizedModel = undefined */ };
```
- メモ撤廃ではなく破棄関数の追加(Azure+Entra のトークンキャッシュ維持のため毎回再構築は不可 — 詳細は research.md §7)。

### Client UI

#### AiSettings(コンテナ)
- 取得: `useAiSettings`(SWR, `apiv3Get('/ai-settings')`)。保存: `apiv3Put('/ai-settings', body)` → 成功 `toastSuccess` + SWR `mutate`、失敗 `toastError` かつ入力 state を保持(6.3)。
- `provider` 状態を子へ渡し、`azure-openai` 選択時のみ `AzureOpenaiSettings` を有効化(3.2)。

#### ProviderCommonSettings / AzureOpenaiSettings / EnvOnlyModeNotice(Summary-only)
- `ProviderCommonSettings`: provider(select、`AI_PROVIDERS` のみ=2.2)/ apiKey(`type=password`=5.1)/ model / providerOptions(JSON、クライアント側 parse 検証=6.2)。各入力は `useOnlyEnvVars` 連動で `readOnly`/`disabled`。
- `AzureOpenaiSettings`: azure 4 キー。`useEntraId=true` 時は apiKey 不使用を明示(3.3)、model=deployment 名の注記(3.4)、非 azure 時は非適用提示(3.2)。
- `EnvOnlyModeNotice`: `useOnlyEnvVars` が true のとき alert を表示し、全項目が環境変数で固定され編集不可である旨を明示(4.2)。SiteUrlSetting の env 専用モード表示パターンを踏襲。

## Data Models

スキーマ変更なし。`ai:*` は既存の `configs` コレクション(`{ ns, key, value }`、`value` は JSON 文字列)に既存方式で永続化。`ai:apiKey` も平文保存(他シークレット config と同方針)。保存時暗号化は範囲外(research.md §6)。

## Error Handling

### Error Strategy
- **入力検証(400)**: provider が `AI_PROVIDERS` 外(6.1)、`providerOptions` が非空かつ JSON 不正(6.2)、boolean 不正 → `apiV3FormValidator` で 400。クライアントは保存前にも JSON 検証してエラー表示。
- **env 専用モード時の更新(422)**: 環境変数専用モードが有効な状態の PUT は `ErrorV3` で拒否(4.3、SiteUrlSetting 拒否パターン)。
- **保存失敗(5xx)**: `toastError` で通知、入力 state 保持(6.3)。
- **機密保護**: 例外・ログに `ai:apiKey` を出力しない(5.3)。GET は apiKey 値を返さない(5.2)。

### Monitoring
- 設定更新成功は `activityEvent`(`ACTION_ADMIN_AI_SETTING_UPDATE`)で監査ログ化。検証/拒否エラーは `logger.warn`(機密除外)。

## Testing Strategy

### Unit Tests
- `ConfigManager.getConfig`(`ai:provider`): `env:useOnlyEnvVars:ai`=true で env 値のみ、=false で `db ?? env`(DB 優先・env 既定)を返す(4.1, 4.4)。
- `ENV_ONLY_GROUPS`: `ai` グループが 8 キーすべてを対象とし、`initKeyToGroupMap` で制御キーへ正しくマップされる(4.1)。
- `config-definition`: `env:useOnlyEnvVars:ai` が `CONFIG_KEYS`/`CONFIG_DEFINITIONS` に登録され、既存キーの解決に影響しない(回帰)。
- `validators`: provider enum、`providerOptions` JSON 妥当性、boolean(6.1, 6.2)。

### Integration Tests
- PUT 正常: `updateConfigs` 反映 + `clearResolvedMastraModelCache` 呼出 + `ACTION_ADMIN_AI_SETTING_UPDATE` 発火(2.3, 2.4)。
- PUT env 専用モード: `env:useOnlyEnvVars:ai`=true の状態で要求が 422(4.3)。
- GET: apiKey 値が応答に含まれず `isApiKeySet` と `useOnlyEnvVars` が正しい(4.2, 5.2)。
- PUT apiKey 未指定: 既存 apiKey が保持される(誤クリアしない)。
- アクセス制御: 非管理者は GET/PUT で 403(1.2)。

### E2E/UI Tests
- 管理者が `/admin/ai` で provider/model を保存 → 成功トースト + 再読込で反映(1.1, 1.4, 2.3)。
- env 専用モード有効環境: 全フィールドが readOnly + モード明示の alert(4.2)。
- provider=azure-openai 選択時に Azure セクションが有効化、`useEntraId` で apiKey 不使用提示(3.2, 3.3)。

## Security Considerations
- **アクセス制御**: 新スコープ `admin:ai`(read/write)+ `adminRequired`。PAT の最小権限を担保。
- **機密保護**: `ai:apiKey` は GET 非返却(`isApiKeySet` のみ)、入力は `type=password`、例外/ログに非出力(5.1–5.3)。
- **改変防止**: 環境変数専用モード有効時は API/UI 双方で更新不可(多重防御、4.2/4.3)。
- core scope 追加時は `accesstoken_scopes_desc`(全ロケール)を更新。
