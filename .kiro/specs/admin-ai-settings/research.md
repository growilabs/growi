# Gap Analysis: admin-ai-settings

実施日: 2026-06-12(`/kiro-validate-gap`)

## 1. 現状調査(Current State)

### 1.1 ai:* 設定キー(実装済み)

`apps/app/src/server/service/config-manager/config-definition.ts`(L1276-1332)に 8 キーすべて定義済み。

| Config Key | 環境変数 | 型 | isSecret |
|---|---|---|---|
| `ai:provider` | `AI_PROVIDER` | `AiProvider \| undefined` | - |
| `ai:apiKey` | `AI_API_KEY` | `string \| undefined` | ✅ |
| `ai:model` | `AI_MODEL` | `string \| undefined` | - |
| `ai:providerOptions` | `AI_PROVIDER_OPTIONS` | `string \| undefined`(raw JSON) | - |
| `ai:azureOpenaiResourceName` | `AI_AZURE_OPENAI_RESOURCE_NAME` | `string \| undefined` | - |
| `ai:azureOpenaiBaseUrl` | `AI_AZURE_OPENAI_BASE_URL` | `string \| undefined` | - |
| `ai:azureOpenaiApiVersion` | `AI_AZURE_OPENAI_API_VERSION` | `string \| undefined` | - |
| `ai:azureOpenaiUseEntraId` | `AI_AZURE_OPENAI_USE_ENTRA_ID` | `boolean`(default `false`) | - |

- プロバイダー定義: `apps/app/src/features/mastra/interfaces/ai-provider.ts` — `AI_PROVIDERS`(openai, anthropic, google, azure-openai)+ `isAiProvider()` 型ガード
- 消費側: `apps/app/src/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model.ts` — **モジュールスコープでメモ化**(アプリ生存期間中キャッシュ、無効化機構なし)。設定不備時は throw(throw 時はメモ化されない)
- `ai:providerOptions` の JSON パース: `resolve-provider-options.ts`(L29-56)— パース失敗時は警告ログ + `{}` フォールバック(fail-soft)

### 1.2 ConfigManager の優先順位機構

`apps/app/src/server/service/config-manager/config-manager.ts`:

- `getConfig(key)`(L65-91): 既定は **`dbConfig[key] ?? envConfig[key]`(DB 優先)**
- 唯一の例外は `shouldUseEnvOnly(key)`(L100-111): `ENV_ONLY_GROUPS`(config-definition.ts L1552-1588)の controlKey(例: `env:useOnlyEnvVars:app:siteUrl`)が env で `true` の場合のみ env 専用になる **opt-in 機構**
- **「env が設定されていれば常に env 優先」という per-key 機構は存在しない** → 本フィーチャーの中核ギャップ
- `getManagedEnvVars(showSecretValues)`(L189-216): 実際に設定されている環境変数のみを返し、`isSecret` はマスク(`'***'`)。admin-home の apiv3(L106)で管理画面に公開済み — 「env 由来か」の判定に再利用可能
- `updateConfigs()`(L113-166): DB upsert 後に `loadConfigs({source:'db'})` でリロードし、S2S `configUpdated` メッセージを publish(他インスタンスは `handleS2sMessage` で `loadConfigs()` 再実行)

### 1.3 管理画面の既存パターン

**ページ(最新パターン)**: `apps/app/src/pages/admin/vault.page.tsx` — unstated コンテナ不使用。`dynamic(() => import(feature の client/admin), { ssr: false })` + `createAdminPageLayout`(`containerFactories: []`)+ `getServerSideAdminCommonProps`。新規ページはこのパターンに従うべき(`app.page.tsx` の `AdminAppContainer` はレガシー)。

**ナビゲーション**: `apps/app/src/components/Admin/Common/AdminNavigation.tsx` — `MenuLabel` の switch(L16-143)に case 追加 + `MenuLink` 追加 + モバイル dropdown 対応の 3 箇所変更。

**apiv3 ルート**: `apps/app/src/server/routes/apiv3/app-settings/index.ts` が参照実装:
- GET: `accessTokenParser(SCOPE.READ.ADMIN.*)` + `loginRequiredStrictly` + `adminRequired`。DB 値・env 値(`ConfigSource.env`)・制御フラグを併せて返す
- PUT: `accessTokenParser(SCOPE.WRITE.ADMIN.*)` + `adminRequired` + `addActivity` + express-validator + `apiV3FormValidator` → `configManager.updateConfigs()` → `activityEvent.emit('update', ...)`(監査ログ)
- env 固定時の更新拒否の先例: site-url-setting(L665-674)— フラグ確認後 `res.apiv3Err` を返す

**env 固定フィールドの UI 先例**: `apps/app/src/client/components/Admin/App/SiteUrlSetting.tsx`(L59-122)— alert 表示 + `readOnly` 入力 + env 値の併記 + `use_env_var_if_empty` 系 i18n キー。

**データ取得/保存**: SWR フック(`apps/app/src/stores/admin/app-settings.tsx` の `useSWRxAppSettings` パターン)+ `apiv3Put` + `toastSuccess`/`toastError`(`apps/app/src/client/util/toastr.ts`)。

**i18n**: `apps/app/public/static/locales/{en_US, ja_JP, zh_CN, fr_FR, ko_KR}/admin.json`(5 ロケール)。namespace は `admin`。

### 1.4 シークレットの API 応答での扱い

- app-settings GET の先例(L443-449): シークレットは **`undefined` として返す**(マスク値での誤上書き防止)。フロントは「設定済み」プレースホルダ表示で対応
- file-upload-setting には生のシークレットを返す箇所が残るが、新規実装では `undefined` 返却パターンに従うべき(セキュリティ規約とも整合)

### 1.5 旧 AI 管理画面

`/admin/ai-integration` は `deprecate-openai-features` で削除済み(commit `cde93f3d`)。再利用可能なクライアントコードは残っていない。新規構築が前提。

## 2. Requirement-to-Asset Map

| 要件 | 既存アセット | ギャップ |
|---|---|---|
| R1 アクセス・ナビ | `createAdminPageLayout` / `getServerSideAdminCommonProps` / `AdminNavigation` | **Missing**: `/admin/ai` ページ・ナビ項目(パターン確立済み、新規作成のみ) |
| R2 共通設定の管理 | config 定義済み・`updateConfigs`・apiv3 PUT パターン | **Missing**: AI 設定用 apiv3 GET/PUT ルート、admin 用クライアントコンポーネント、SWR フック |
| R2.4 再起動なし反映 | S2S `configUpdated` + MailService 再初期化パターン(`mail.ts` L50-71) | **Missing**: `resolveMastraModel` のメモ化に**無効化機構がない**。設定更新時(ローカル + S2S 受信時)のキャッシュ破棄が必要。**Unknown**: Mastra インスタンス/agent 側(`mastra-modules/index.ts`)にも別のキャッシュ層がないか要確認 |
| R3 Azure 専用画面 | config 定義済み・provider 判定(`isAiProvider`) | **Missing**: Azure 専用セクション UI(provider 値による表示切替) |
| R4 env 優先・上書き不可 | `getManagedEnvVars`(env 設定有無の判定)・`ENV_ONLY_GROUPS`(別目的の opt-in 機構)・site-url の PUT 拒否先例 | **Constraint/Missing**: 既定優先順位は DB 優先。「env が設定されていれば常に env 優先」の解決レイヤー機構が存在しない(§3 参照)。ルート層での拒否だけでは、env 設定前に保存された DB 値が勝ってしまい R4.1 を満たせない |
| R5 シークレット保護 | `isSecret` フラグ・GET で `undefined` 返却の先例 | **Missing**: ai:apiKey 向けの「設定済み」表示 UI(先例に倣い新規実装) |
| R6 入力検証 | express-validator + `apiV3FormValidator` パターン・`isAiProvider` | **Missing**: provider enum / providerOptions JSON のバリデータ(クライアント側 + サーバー側) |

## 3. 実装アプローチ選択肢

中核論点は **R4(env 優先)の実現レイヤー**。

### Option A: ConfigManager に per-key「env 優先」機構を追加(解決レイヤーで保証)

config-definition に新メタデータ(例: `ENV_PRIORITY_KEYS` リスト、または定義フラグ)を追加し、`getConfig` で「対象キーかつ env 値が定義されていれば env を返す」分岐を加える。apiv3 PUT では env 設定済みキーへの更新を拒否(site-url 先例)、GET では env 由来フラグを返す。

- ✅ R4.1 を設定解決のあらゆる消費箇所で構造的に保証(Mastra・将来の消費者も自動的に正しい)
- ✅ `ENV_ONLY_GROUPS` と同様の宣言的パターンで増設でき、既存挙動(他キー)に影響なし
- ❌ コア基盤(`config-manager`)に手を入れるため、優先順位ロジックの単体テストを慎重に追加する必要
- ❌ 「DB 優先」という既存のシステム全体の原則に対する例外が増える(ドキュメント化必須)

### Option B: ルート/UI 層のみで制御(ConfigManager 無変更)

apiv3 GET で env 値と「env 設定済み」フラグを返し UI を readOnly 化、PUT で env 設定済みキーの更新を拒否。`getConfig` の優先順位は変えない。

- ✅ コア基盤に触れず変更範囲が最小
- ❌ **R4.1 を満たせない欠陥がある**: env 設定前に DB へ保存された値が残っている場合、DB 値が有効値になる(運用者が env を後から固定しても画面保存値が勝つ)
- ❌ 「上書き不可」の保証が apiv3 ルートという一面に依存し、別経路の更新で破られる

### Option C: ハイブリッド — A の解決レイヤー機構 + ルート層の防御 + 反映機構(推奨)

Option A の per-key env 優先機構を入れた上で、apiv3 PUT でも env 設定済みキーを拒否(多層防御 + UX 上の明確なエラー)。さらに R2.4 のために、設定更新時(ローカル `updateConfigs` 後と S2S `configUpdated` 受信時)に Mastra のメモ化モデルを破棄する無効化フックを追加(MailService 再初期化パターンを踏襲)。

- ✅ R4 を構造的に保証しつつ、管理者には即時のエラーフィードバック
- ✅ R2.4(再起動なし反映)までカバーする唯一の構成
- ❌ 変更箇所が 3 レイヤー(config-manager / apiv3 / mastra)に渡り、タスク分割と境界定義が必要

## 4. 工数・リスク

- **Effort: M(3–7 日)** — 確立済みパターン(vault ページ、app-settings ルート、SiteUrlSetting の env 表示)の踏襲が大半だが、config-manager 拡張・メモ化無効化・5 ロケール i18n・テスト一式を含むため S では収まらない
- **Risk: Medium** — 新技術なし・パターン明確だが、コア基盤(ConfigManager の優先順位)への変更は影響範囲が全 config に及び得るため、回帰テストの厚さが品質を左右する

## 5. 設計フェーズへの推奨事項

1. **推奨アプローチ: Option C**(解決レイヤーでの env 優先 + ルート層防御 + メモ化無効化)
2. **ページ/クライアント構成**: vault パターン(`features/mastra/client/admin/` または `client/components/Admin/Ai/` 配下、unstated コンテナ不使用、Jotai + SWR)。配置は mastra feature 配下が feature-based architecture と整合的
3. **API 設計**: `/apiv3/ai-settings`(GET/PUT)新設。GET は「DB 値 + env 由来フラグ(+ env 値)」、シークレットは `undefined` 返却。PUT は `addActivity` + 監査ログ(`SupportedAction` の新アクション追加要否を design で判断)
4. **Research Needed(design で解決)**:
   - `mastra-modules/index.ts` の Mastra インスタンス/agent/メモリ層に `resolveMastraModel` 以外のキャッシュがないか(再起動なし反映の完全性)
   - mastra ルートの `isAiEnabled()` ガードの参照 config(AI 機能の有効/無効トグルを本画面に含めるかは要件外だが、画面導線との整合確認)
   - `ai:providerOptions` のサーバー側バリデーション仕様(JSON 形式チェックのみ / 形状 `Record<string, Record<string, JSONValue>>` まで検証するか)
   - 監査ログのアクション名と SCOPE(`SCOPE.READ/WRITE.ADMIN.*`)に AI 用の既存値があるか
   - `getManagedEnvVars` の再利用可否(ai:* キーの env 由来判定を専用 API で返すか、汎用機構を使うか)

## 6. 確定事項: ai:apiKey の永続化方式(2026-06-12 追記)

**hash 化はしない(できない)。既存パターンに倣い平文で永続化し、露出層で防御する。**

- 既存実装: `configManager.updateConfigs()` は `JSON.stringify(value)` をそのまま `configs` コレクションに upsert(`config-manager.ts` L127, L154)。`Config` モデル(`models/config.ts`)に暗号化レイヤーはなく、`isSecret: true` の既存シークレット(S3 シークレット、OAuth クライアントシークレット、Slack トークン等)はすべて平文保存
- hash 化の唯一の先例は `models/access-token.ts`(SHA-256)だが、これは GROWI への**インバウンド**認証情報(照合のみで復元不要)だから成立する。`ai:apiKey` は LLM プロバイダーへ生の値を送信する**アウトバウンド**認証情報のため、一方向変換の hash は用途として成立しない
- 可逆暗号化(AES + env 鍵)は GROWI に前例がなく、鍵管理問題を新規に持ち込むため本フィーチャーでは採用しない。encryption-at-rest が必要なら全シークレット config 横断の別フィーチャーとする
- 防御は露出層で行う: GET 応答で `undefined` 返却(app-settings L443-449 先例)、`getManagedEnvVars` のマスク(`'***'`)、画面はマスク入力(R5 と整合)

## 7. 確定事項: 設定更新の即時反映(R2.4 / メモ化無効化)(2026-06-12 追記)

**結論: メモ化は維持し、`ai:*` 設定更新時に明示的にキャッシュを破棄する。「ローカル(apiv3 PUT 直後)」と「リモート(S2S `configUpdated` 受信時)」の 2 経路を両方塞ぐ。**

### 無効化が必要な状態

- `resolve-mastra-model.ts` L17 の **モジュールスコープ `let memoizedModel`** のみ。`memoizedModel != null` で早期 return するため、`configManager.loadConfigs()` で config 値が更新されても古いモデルを返し続ける(= 中核ギャップ)
- `resolveProviderOptions()`(`resolve-provider-options.ts`)は**メモ化していない**(毎回 `configManager.getConfig('ai:providerOptions')` を読む)ため、対応不要
- agent 側(`growi-agent.ts`)は `model: () => resolveMastraModel()` と遅延評価なので、メモさえ破棄すれば次リクエストで自動的に再構築される。agent インスタンスの作り直しは不要

### 2 つの更新経路(両方塞ぐ必要がある)

1. **ローカル**: 管理画面 PUT → `configManager.updateConfigs({...ai:*})`。`loadConfigs` はローカルで走るが、`publishUpdateMessage` は**他インスタンス宛**のみ。自インスタンスは `handleS2sMessage` を呼ばないため、ここでメモは破棄されない → **apiv3 ルートで明示的に破棄が必要**(MailService が `mailService.initialize()` をルートから直接呼ぶのと同型)
2. **リモート**: 他インスタンスは S2S `configUpdated` 受信 → `configManager.handleS2sMessage()` → `loadConfigs()`。ここでもメモは破棄されない → **mastra 用の `S2sMessageHandlable` を `configUpdated` に登録して破棄**

### 推奨実装

1. `resolve-mastra-model.ts` に破棄関数を追加(export):
   ```ts
   export const clearResolvedMastraModelCache = (): void => {
     memoizedModel = undefined;
   };
   ```
2. **ローカル**: AI 設定 apiv3 PUT で `configManager.updateConfigs(...)` 成功後に `clearResolvedMastraModelCache()` を直接呼ぶ
3. **リモート**: mastra feature に軽量な `S2sMessageHandlable`(`shouldHandleS2sMessage`: `eventName === 'configUpdated'`、`handleS2sMessage`: `clearResolvedMastraModelCache()`)を追加し、`crowi/index.ts` の `setupS2sMessagingService()`(L405-415、`configManager` を登録している箇所)で `s2sMessagingService.addMessageHandler(...)` 登録する

### 設計上の判断根拠

- **メモ化を撤廃して毎回再構築する案は採らない**: OpenAI/Anthropic/Google および Azure(API キー)は構築コストが無視できるが、**Azure + Entra ID** は `new DefaultAzureCredential()` + `getBearerTokenProvider()`(`azure-openai.ts`)のトークンキャッシュがインスタンス内に保持されるため、毎リクエスト再構築するとトークンキャッシュが失われ、リクエスト毎に Azure AD へのトークン取得が走る(レイテンシ + スロットリングリスク)。よってメモ化は維持し、設定変更時のみ破棄する
- **`configUpdated` への相乗り(専用イベントを新設しない)**: `configUpdated` はどのキーが変わったかを運ばないため、mastra ハンドラは ai 以外の設定変更でもメモを破棄する(過剰無効化)。だが設定変更は稀な管理操作であり、次リクエストでの遅延再構築コストは Azure+Entra 以外は無視でき、Azure+Entra でも頻度が低いため許容。専用イベント新設(MailService 型)より配線が少なく単純なこちらを推奨。design でトレードオフを再確認のこと
- **`config-manager.ts` 本体は変更不要**(post-reload コールバック機構は持たないが、S2S ハンドラ追加で完結する)

### Research 解決状況

- ✅ §5 の「`mastra-modules/index.ts` に別キャッシュ層がないか」→ 確認済み。`mastra` インスタンス・`growiAgent`・`memory`(`MongoDBStore`)はいずれもモデル解決とは独立。モデルは agent の `model: () => resolveMastraModel()` 経由でのみ解決され、メモは `resolve-mastra-model.ts` の 1 箇所のみ。**メモ破棄で反映は完結する**

## 8. 設計フェーズの追加調査結果(2026-06-12 `/kiro-spec-design`)

### 8.1 確定した実装パターン(コード確認済み)

- **env 設定有無の検出**: `loadFromEnv()`(`config-loader.ts` L12-37)は env 未設定時に **default 値**を `envConfig[key].value` に格納するため、`envConfig[key].value` では「env が設定されたか」を判定できない(特に `ai:azureOpenaiUseEntraId` は default `false`)。信頼できる判定は **`process.env[envVarName] !== undefined`**(`getManagedEnvVars` L189-216 と同じ手法)
- **`getConfig` 既定解決**(`config-manager.ts` L86-90): `shouldUseEnvOnly(key) ? env : (db ?? env)`。`shouldUseEnvOnly` は `ENV_ONLY_GROUPS` の制御キー(`env:useOnlyEnvVars:*`)が env で `true` のときだけ true。**「キー自身の env が設定されていれば env 優先」という自動機構は存在しない**ため新設が必要
- **SCOPE**: core の `SCOPE_SEED_ADMIN`(`packages/core/src/interfaces/scope.ts` L10-29)に **`admin:ai` は無い**(`features:ai` はユーザー向けスコープ)。管理エリアごとに専用スコープを持つ既存パターンに従い `admin:ai` を新設する(seed + 型 union 2 箇所 + `accesstoken_scopes_desc` 翻訳)
- **apiv3 admin ルート登録**: `src/server/routes/apiv3/index.js` の `routerForAdmin.use('/<name>', require(...)(crowi))`(L50 等)。`/mastra`(L206)は **`isAiEnabled()` ゲート付きのユーザー向け**ルートなので、管理ルートは別途 `routerForAdmin` に登録する(AI 無効時も管理者は設定可能 = R1)
- **Activity**: `src/interfaces/activity.ts` に `ACTION_ADMIN_APP_SETTING_UPDATE` 等のパターン。新規 `ACTION_ADMIN_AI_SETTING_UPDATE` を追加
- **管理ページ雛形**: `pages/admin/vault.page.tsx` = `dynamic(ssr:false)` + `createAdminPageLayout` + `getServerSideAdminCommonProps`。unstated コンテナ不使用。AI ページもこれを踏襲
- **i18n**: `public/static/locales/en_US/admin.json` に AI 設定キーは**未存在**(全て新規追加、5 ロケール: en_US, ja_JP, zh_CN, fr_FR, ko_KR)
- **シークレット応答**: app-settings GET はシークレットを `undefined` 返却。AI 設定 GET も `ai:apiKey` の値は返さず `isApiKeySet: boolean` のみ返す

### 8.2 Synthesis(設計統合の 3 レンズ)

- **一般化**: 8 キーは「provider 共通(R2)」「Azure 専用(R3)」の 2 群だが、API としては**単一の GET/PUT**で全キーを扱い、UI 側でセクション分割する(別エンドポイント化しない)。R4(env 優先)は 8 キー全てに**均一**に適用する単一機構とする
- **Build vs Adopt**:
  - env 優先 → 既存 `ENV_ONLY_GROUPS` は制御フラグ前提で不適合 → 類似の宣言リスト `ENV_PRIORITIZED_KEYS` を**新設(build)**
  - メモ無効化 → S2S `configUpdated` + MailService 再初期化パターンを**採用(adopt)**
  - 管理ページ・apiv3・シークレット応答・env 検出 → 既存パターンを**採用**
- **簡素化**: 接続テスト機能は持たない(範囲外)。エンドポイントは GET/PUT 各 1 本。

## 9. 確定: env 優先は既存 ENV_ONLY_GROUPS 機構を流用(2026-06-12、§8.2 の build 判断を更新)

ユーザー判断により、§8.2 で「新設(build)」とした `ENV_PRIORITIZED_KEYS` は**採用しない**。代わりに既存の `ENV_ONLY_GROUPS` + `shouldUseEnvOnly` 機構(opt-in 制御キー)を `ai` グループに拡張する(Option A)。

### 採用したセマンティクス
- 制御キー `env:useOnlyEnvVars:ai`(env 変数 `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS`)が `true` のとき、`ai:*` 8 キーは env 値のみで固定され DB 値は無視される(UI/API とも編集不可)
- 制御キーが `false`/未設定のときは既存どおり `db ?? env`(env は既定値、UI 保存値が優先)
- 要件 R4 は「env が設定されていれば自動ロック」から「**環境変数専用モード(制御フラグ)有効時にロック**」へ更新(requirements.md R4 改訂済み)

### Option A を選んだ理由
- **コア無変更**: `getConfig`/`shouldUseEnvOnly` に手を入れず、`config-definition` への宣言追加のみ(`initKeyToGroupMap` が自動配線)。回帰リスク最小
- **一貫性**: siteUrl / gcs / azure / fileUploadType と同じ確立パターン。UI も SiteUrlSetting の env 専用モード表示をそのまま流用
- **柔軟性**: env を「上書き可能な既定値」として使え、ロックは明示フラグで opt-in できる

### トレードオフ(許容済み)
- 値 env(例 `AI_API_KEY`)を設定しただけではロックされない。ロックには制御フラグ `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true` も必要(GROWI の他インフラ設定と同じ 2 段階)
- これにより「インフラ設定済み認証情報を UI から絶対に変えさせない」を**自動**強制はしない。必要なら運用者が制御フラグを立てる

### route 層の影響
- env-fixed 判定に `getManagedEnvVars()` を使う案は**不要化**。route は `configManager.getConfig('env:useOnlyEnvVars:ai')` を読むだけ(GET 応答の `useOnlyEnvVars`、PUT の 422 判定)
