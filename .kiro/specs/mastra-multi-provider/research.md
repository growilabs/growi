# Gap 分析 (kiro-validate-gap)

- 実施日: 2026-07-02
- 分析基準: requirements 未生成(phase: initialized)のため、`requirements.md` の Project Description(誰が / 現状 / 変えること)を基準に実施。本分析は requirements 生成の入力資料を兼ねる。
- 調査方法: (1) サーバ側設定・モデル解決系、(2) クライアント管理 UI・チャット UI・カタログ、(3) 周辺タッチポイント、の 3 並列コードベース調査

---

## 1. 現状調査 (As-Is)

### 1.1 設定レイヤ (config-manager)

`apps/app/src/server/service/config-manager/config-definition.ts` (L1279–1338, L350)

| キー | 型 / env var | 単一プロバイダ前提 |
|---|---|---|
| `ai:provider` | `AiProvider \| undefined` / `AI_PROVIDER` | アプリ全体で 1 つ |
| `ai:apiKey` | `string`(isSecret) / `AI_API_KEY` | 全プロバイダ共用の単一キー |
| `ai:allowedModels` | `AllowedModel[]` / `AI_ALLOWED_MODELS` | エントリに provider フィールドが**ない** |
| `ai:azureOpenaiSettings` | `AzureOpenaiConfig` / `AI_AZURE_OPENAI_SETTINGS` | Azure 専用・単一 |
| `env:useOnlyEnvVars:ai` | `boolean` / `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS` | AI 設定全体を一括で env-only 化 |

- Config コレクション自体は汎用 key-value(JSON 文字列)であり、スキーマ変更は不要(`server/models/config.ts`)。
- `ai:*` キーに触れる既存 migration は**存在しない**。

### 1.2 モデル解決レイヤ (server)

`apps/app/src/features/mastra/server/services/ai-sdk-modules/`

- `resolve-mastra-model.ts`: `configManager.getConfig('ai:provider')` を読み(L30)、`modelResolvers: Record<AiProvider, (modelId: string) => MastraModelConfig>` でディスパッチ。キャッシュキーは `${provider}:${effectiveModelId}` — **(provider, modelId) 複合キーなので多プロバイダ化しても構造自体は流用可**。ただし provider の決定源がグローバル設定である点が単一前提。
- `llm-providers/config.ts`: `getApiKey()` / `requireApiKey()` / `getAllowedModels()` / `getDefaultModelId()` / `resolveEffectiveModelId()` — すべて**プロバイダ引数なし**のグローバル読取。
- 各 resolver(openai / anthropic / google)は `createXxx({ apiKey: requireApiKey() })(modelId)` の薄い純関数。azure-openai のみ `ai:azureOpenaiSettings`(endpoint / Entra ID)を追加で読む。**resolver 自体はプロバイダごとに分離済みで再利用可能**。
- `resolve-provider-options.ts` の `getProviderOptionsForModel(modelId)`: 素の modelId で allow-list を検索(provider 照合なし)。

### 1.3 許可リストとリクエスト検証

- `interfaces/allowed-model.ts`:
  ```typescript
  export interface AllowedModel {
    readonly modelId: string;            // provider フィールドなし
    readonly providerOptions?: ModelProviderOptions;
    readonly isDefault?: boolean;
  }
  ```
  `isModelInAllowList(modelId, models)` は素の modelId 照合。
- `validate-allowed-models.ts`: 素の modelId の重複禁止 + `isDefault` はリスト全体で厳密に 1 つ。
- `post-message.ts` / `post-message-validator.ts`: クライアントは素の `modelId` を送信 → `resolveEffectiveModelId` で許可リスト外は既定モデルへ丸め → `requestContext.set('modelId', ...)`。`MastraRequestContextShape` にも provider フィールドなし。
- `growi-agent.ts`: `model: ({ requestContext }) => resolveMastraModel(requestContext.get('modelId'))` — Mastra@1.32+ の動的モデル関数は導入済み(リクエスト単位のモデル切替基盤は**既にある**)。

### 1.4 有効判定・ガード

- `is-ai-configured.ts`: 単一 `ai:provider` が有効 + そのプロバイダの必須接続設定(non-Azure は `ai:apiKey`、Azure は endpoint + key/Entra)+ 非空 allow-list。`isAiReady() = isAiEnabled() && isAiConfigured()`。
- `crowi.isAiReady()`(SSR 用、`pages/common-props/commons.ts` L63–70)→ props は `aiEnabled: boolean` のみで**プロバイダ情報を露出しない → 変更不要**。
- `ai-ready-guard.ts`(501 応答)は isAiConfigured の意味論変更に追従するだけ。

### 1.5 管理 API・管理 UI

- GET `admin-ai-settings`(`get-ai-settings.ts`): `provider`(単一)・`isApiKeySet`(単一 boolean)・`allowedModels`・`azureOpenaiSettings` を返す。apiKey 値は返さない。
- PUT(`put-ai-settings.ts` L257–283): 全量置換。**セキュリティルール: プロバイダ変更時に新キー未入力なら保存済み `ai:apiKey` を破棄**(単一キー前提の 1:1 対応)。
- フォーム(`ai-settings-form-values.ts`): `{ aiEnabled, provider, apiKey, allowedModels[], azureOpenaiSettings }` — 単一 provider スカラー。`watch('provider')` が Azure セクション表示・ラベル切替(モデル名 ⇔ デプロイ名)・カタログ取得・providerOptions namespace 初期値を駆動。
- `provider-options-namespace.ts`: `Record<AiProvider, string>`(azure-openai → 'openai' namespace)— データ駆動で再利用可。
- ログへ秘匿値を出さないパターン(request body を stringify しない)が確立済み — 多キー化でも踏襲必須。

### 1.6 チャット UI・ユーザー選択永続化

- GET `/mastra/models`(`get-models.ts`) → `ChatModelsResponse = { modelIds: string[], selectedModelId: string }` — **素の ID のみ、provider 文脈なし**。
- `ChatSidebar.tsx`: フラットな `modelIds` を `PromptInputModelSelect*` で表示(表示名 = 素の ID)。選択は feature ローカル useState + `modelRef` ライブ getter で transport の毎リクエスト body に注入(`chat-sidebar-helpers.ts` L60–86)— **この注入機構は識別子の形が変わっても流用可**。
- 永続化: `UserUISettings.aiChatSelectedModelId: string`(素の ID)。PUT ルート(`server/routes/apiv3/user-ui-settings.ts`)の **updateData 許可リストはハードコード**であり、フィールド変更時は必ず拡張が必要。

### 1.7 モデルカタログ (ai-settings-model-picker、現行ブランチで実装中)

- `model-catalog-data.json`: `models: Record<provider, string[]>` — **最初から provider キー構造**。chat+tool 対応でフィルタ済み・オフライン同梱。
- `AI_PROVIDER_DEFS`(`interfaces/ai-provider.ts`): `{ openai/anthropic/google: { enumerable: true }, 'azure-openai': { enumerable: false } }` — メタデータ駆動でプロバイダ特性を宣言する基盤が**既に整備済み**(displayName 等の追加も自然に可能)。
- `getSelectableModelIds(provider)` / selectable-models エンドポイント / `AllowedModelsField` の select-vs-free-input フォールバック — provider 引数を取る設計のため**プロバイダごとのパネルにそのまま再利用可**。

### 1.8 周辺タッチポイント

| 箇所 | 現状 | 多プロバイダ化の影響 |
|---|---|---|
| suggest-path(`features/ai-tools`) | レガシー `openai:serviceType` / `openai:*` キー + `certifyAiService` を使用。Mastra 系設定と**未統合** | 影響なし(別系統)。統合は本 spec のスコープ判断事項(先行 2 spec は据え置きを選択) |
| SSR props | `aiEnabled: boolean` のみ | 変更不要 |
| i18n | `admin.json` の `ai_settings.*`(en/ja/zh/fr/ko の 5 ロケール)。単一プロバイダ前提の文言(`api_key_provider_change_warning` 等) | プロバイダパネル用キーの追加・一部文言改訂 |
| 単一前提を固定しているテスト | `put-ai-settings.spec` / `get-ai-settings.spec` / `env-only-mode.integ.spec` / `is-ai-configured.spec` / `get-models.spec` / `config-manager.spec` / `ai-settings.spec` ほか | スキーマ変更に伴い広範な改修 |
| Env var ドキュメント | `AI_*` は docs 未記載(growi-docs 側の課題) | 新スキーマの env 表現を確定後に整理 |

---

## 2. 要求実現性分析 — Requirement-to-Asset Map

Project Description の「変えること」を要求領域に分解し、既存資産とギャップをタグ付けする。

| 要求領域 | 既存資産 | ギャップ | タグ |
|---|---|---|---|
| R1: 複数プロバイダの接続設定(資格情報含む)を同時登録 | Config KV ストア、`AI_PROVIDER_DEFS` メタデータ、per-provider resolver 群 | プロバイダごとの資格情報・接続設定を保持する config 構造が存在しない(`ai:apiKey` 単一) | **Missing** |
| R2: モデルとプロバイダの対応付け | `AllowedModel` 型・検証・許可リスト述語 | `AllowedModel` に provider フィールドなし。素の modelId は**プロバイダ間で衝突し得る**(例: Azure デプロイ名は運用者定義で任意)。重複禁止・単一 default の検証も素 ID 前提 | **Missing** |
| R3: リクエスト単位のプロバイダ横断モデル解決 | Mastra 動的モデル関数 + requestContext、(provider, modelId) 複合キャッシュキー、per-provider resolver | provider の決定源がグローバル `ai:provider`。requestContext・transport body・`aiChatSelectedModelId` が素の modelId でプロバイダを運べない → **モデル識別子の設計**が必要 | **Missing / 設計判断** |
| R4: 有効判定の意味論 | `isAiConfigured` / `isAiReady` / ai-ready-guard | 「1 つ以上の有効なプロバイダ + 非空許可リスト」への再定義が必要。不備プロバイダの扱い(スキップ+ログ か 全体無効か)は未決 | **Unknown(要件判断)** |
| R5: 管理 UI での複数プロバイダ編集 | react-hook-form + useFieldArray、カタログ picker、`AzureOpenaiSettings`、apiKey マスク/破棄パターン | 単一 provider select 前提のフォーム構造・レイアウトの再設計。プロバイダ別 apiKey 破棄ルール・env-only 表示の再適用 | **Missing** |
| R6: チャット UI でのプロバイダ横断モデル選択 | `PromptInputModelSelect*`(グルーピング可能な Radix Select)、ライブ getter 注入、`scheduleToPut` | `ChatModelsResponse` に provider 情報がない。表示名・グルーピングの設計。`UserUISettings` フィールドと PUT 許可リストの変更 | **Missing** |
| R7: env var での複数プロバイダ設定 | JSON env のパース実績(`AI_ALLOWED_MODELS` 等)、env-only グループ機構 | N プロバイダ分の env 表現(単一 JSON か プロバイダ別変数か)が未設計。env-only フラグの粒度判断 | **Missing / 設計判断** |
| R8: 既存設定からの移行 | migration 基盤はある(`ai:*` 実績なし) | 先行 2 spec は「プレリリースにつき migration なし」を選択。現行スキーマのリリース済み判定が必要 | **Unknown(要確認)** |

### 制約 (Constraint)

- **C1**: Azure OpenAI はカタログ非対応(デプロイ名自由入力)・endpoint/Entra ID など接続設定の形が他と異なる。プロバイダ別接続設定は「共通形 + プロバイダ固有拡張」で設計する必要がある(`AI_PROVIDER_DEFS` のメタデータ駆動パターンが受け皿)。
- **C2**: 秘匿情報の取り扱い規律(値を返さない・ログに出さない・プロバイダ変更時のキー破棄)を N キーへ一般化して維持する。
- **C3**: ai-settings-model-picker(現行ブランチ、実装中)と本 spec は同じファイル群(`AllowedModelsField` / catalog / selectable-models)に触れる。**着手順序の依存**: picker 完了後に本 spec を設計・実装するのが安全。
- **C4**: `env:useOnlyEnvVars:ai` は AI 設定全体の一括ロック。粒度を細分化するかは要件判断(一括のままが単純で、先行 spec とも整合)。

### 複雑性シグナル

- 単純 CRUD ではなく、**データモデル(識別子設計)+ 設定スキーマ + UI 再構成**が連動する構造変更。外部新技術はなし(既存 ai-sdk / Mastra の範囲内)。

---

## 3. 実装アプローチ選択肢

### Option A: 既存キー・既存コンポーネントの拡張

`ai:provider` を「既定プロバイダ」に読み替えて残し、`ai:apiKey` を維持したままプロバイダ別キー(例: `ai:apiKey:anthropic`)を追加、`AllowedModel` に optional `provider` を足す。

- ✅ 差分が最小に見える。既存テストの多くが生き残る
- ❌ 「単一キー + 追加キー」の二重構造が恒久化し、resolver/検証/管理 UI すべてに分岐が残る(coding-style の「モード分岐をデータ宣言に置き換える」原則に反する)
- ❌ optional `provider` は素 ID 衝突の解決を先送りにする

### Option B: プロバイダ登録を第一級のデータ構造として新設

config を `ai:providers`(`AiProvider` をキーとする Record: 各値 = 資格情報 + プロバイダ固有接続設定)+ `ai:allowedModels`(各エントリに **required な `provider`**)へ再設計。`ai:provider` / `ai:apiKey` / `ai:azureOpenaiSettings` は廃止。`llm-providers/config.ts` のアクセサをプロバイダ引数付きへ全面改修し、管理 UI はプロバイダパネル(useFieldArray or Record ベース)へ再構成。

- ✅ 単一前提が構造から消え、分岐が宣言(メタデータ + データ)に置き換わる — 既存の `AI_PROVIDER_DEFS` / resolver Record / catalog(provider キー)と設計方向が一致
- ✅ `AiProvider` キーの Record は「同一プロバイダ種は最大 1 登録」を型で保証(要件として妥当なら)
- ❌ 変更面積が最大(config・API contract・UI・テスト全面)
- ❌ リリース済み環境が存在する場合は migration 必須

### Option C: ハイブリッド(B のデータモデル + 資産再利用 + 段階実装)

データモデルは B を採用しつつ、実装を「(1) config スキーマ + サーバ解決・検証、(2) 管理 UI、(3) チャット UI・ユーザー設定」の 3 段に分け、各段で既存資産(per-provider resolver、catalog picker、`PromptInputModelSelect*`、ライブ getter 注入、`scheduleToPut`)を最大限流用する。

- ✅ B のクリーンさを保ちつつ、検証済み部品の流用でリスクを分割
- ✅ mastra-multi-model-chat が確立した層別パターン(interfaces 共有 DTO → server resolver → routes → client)にそのまま乗る
- ❌ 段間の中間状態(サーバは多プロバイダ・UI は未対応)の整合管理が必要

---

## 4. 工数・リスク

| 項目 | 評価 | 根拠 |
|---|---|---|
| 工数 | **L(1–2 週間)** | 変更は config スキーマ〜チャット UI まで縦断するが、per-provider resolver・動的モデル関数・カタログ・picker・注入機構など主要部品は実装済みで、新規はデータモデルと UI 再構成が中心 |
| リスク | **Medium** | 未知の外部技術なし。主リスクは (1) モデル識別子設計の波及範囲(DTO/永続化/キャッシュ/検証の全域)、(2) N 秘匿キーのセキュリティ規律維持、(3) ai-settings-model-picker との同時進行によるコンフリクト |

---

## 5. 設計フェーズへの推奨事項

### 推奨アプローチ

**Option C**(B のデータモデルを段階実装)。理由: 既存コードベースの進化方向(メタデータ駆動のプロバイダ宣言・provider キーのカタログ・Record ディスパッチ)と一致し、Option A の二重構造は先行 spec が排除してきた分岐を再導入するため。

### 設計フェーズで確定すべき主要判断

1. **モデル識別子**(最重要・全域に波及): `{ provider, modelId }` タプル vs プロバイダ修飾文字列(例: `openai/gpt-4o`。models.dev・Mastra レジストリと同形)。修飾文字列は既存の string 型配管(transport body・`aiChatSelectedModelId`・requestContext・キャッシュキー)をほぼ温存できるが、Azure デプロイ名(運用者定義)とセパレータの衝突可否の検証が必要。
2. **config 構造と env 表現**: `ai:providers` Record + `AI_PROVIDERS`(単一 JSON)を軸に、同一プロバイダ種の複数登録(例: OpenAI 互換エンドポイント 2 つ)を許すか(許すなら Record ではなく配列 + 一意な登録名が必要 — 要件レベルの判断)。
3. **既定モデルの意味論**: グローバル 1 つ(現行踏襲・推奨)か、プロバイダごとか。
4. **isAiConfigured の再定義**: 「1 つ以上の有効プロバイダ + そのプロバイダに属する許可モデル ≥1」を軸に、不備プロバイダのスキップ + ログ方針(アプリ継続の現行原則を踏襲)。
5. **移行方針**: 現行 `ai:*` スキーマが GA リリース済みかを確認 → 未リリースなら先行 spec 同様 migration なしで置換、リリース済みなら単一 → 複数への migration を設計。
6. **セキュリティ規律の一般化**: プロバイダ別 apiKey の「変更時破棄」「値の非返却」「ログ非出力」ルール。
7. **スコープ確定**: suggest-path(レガシー `openai:*`)は対象外の明記(先行 spec と整合)。`env:useOnlyEnvVars:ai` は一括ロック維持(推奨)。

### Research Needed(設計フェーズへ持ち越し)

- **RN-1**: Mastra `MastraModelConfig` / モデルルーター文字列(`provider/model` 形式)のネイティブ解釈が、自前の修飾文字列パースと競合・代替し得るか(@mastra/core 1.32 系で検証)。
- **RN-2**: Azure デプロイ名の文字種制約(修飾文字列のセパレータ安全性の裏取り)。
- **RN-3**: 現行 `ai:*` config スキーマのリリース状況(migration 要否の判定材料)。
- **RN-4**: providerOptions namespace とエントリの provider の整合検証(例: anthropic のモデルに `openai` namespace のオプション)を新設するか。
- **RN-5**: `ChatModelsResponse` 拡張形(グルーピング構造 vs フラット + provider フィールド)と表示名の出所(カタログは素 ID のみ保持)。
- **RN-6**: ai-settings-model-picker の完了時期と本 spec の着手順序(同一ファイル群への変更が重なるため)。

### 前提の再確認(requirements 生成時に反映すべき点)

- `UserUISettings` のフィールド変更時は PUT ルートのハードコード許可リスト拡張が必須(過去の落とし穴)。
- SSR は `crowi` 経由で設定を読む(直接 import した server シングルトンは Next/Turbopack の SSR realm では未ロード)。

---

## 追記 (2026-07-02, requirements フィードバック反映)

requirements レビュー時のユーザー指示により、本分析の以下の推奨・制約を差し替える:

- **推奨事項 7(env-only は一括ロック維持)を破棄**: `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true` 時は**プロバイダ接続設定(API キー等)のみ env-only・読み取り専用**とし、**許可モデル設定は管理画面から編集可能のまま**とする(部分ロック)。制約 C4 も同様に読み替える。設計への含意: env-only グループの `targetKeys` から許可モデル系キーを外し、接続設定系キーのみを対象にする。
- **config の保持形式は現行構造に縛られない**ことを明示確認: 旧キーの温存・互換は要件でなく、複数プロバイダに最適な保持形式へ再設計してよい(Option B/C のデータモデル方針を後押し)。

---

## 追記 (2026-07-02, UI デザインモック取り込み)

Claude Design プロジェクト「GROWI AI機能設定UI改善」(https://claude.ai/design/p/d2b98505-e2cb-4a5a-87d4-ca8d2e8d2f08) から管理画面モックを取得し、`ui-design/` に保存した(`AI Settings Multi-Provider.dc.html` = 画面全体、`ProviderPanel.dc.html` = プロバイダ単位パネル)。requirements との整合チェックの結果、以下をユーザー確認のうえ requirements に反映した:

- **プロバイダのライフサイクルはモック準拠に変更**: 「登録/削除」モデルを廃し、**対応 4 プロバイダの固定タブ(スロット) + プロバイダごとの有効/無効トグル**へ(Requirement 1 全面改訂)。無効化は許可モデルのチャット選択肢からの除外のみで、接続設定・資格情報・モデル設定は保持。旧 R1.5 の「削除時の資格情報破棄 + 配下モデル除去」カスケードは撤廃。
- **保存済み API キーの消去操作は提供しない**(上書きのみ)。
- 用語の再定義: 「構成済み(接続設定が揃う)」/「有効(トグル ON かつ構成済み)」。R2/R4/R5/R6 の各 AC を新用語・固定スロット前提に整合済み。
- モックが示す設計ヒント(design フェーズで使用): グローバル既定モデルは画面上部のプロバイダ横断ドロップダウン + 各パネルの★の 2 導線(同一のグローバル既定を操作)。プロバイダタブに構成状態ドット表示。モデル追加はカタログ select(非 Azure、登録済みを除外)/デプロイ名自由入力(Azure)。モデル行は折りたたみで provider options JSON 編集(検証 + 「Reset to default」)。単一の Update ボタンで全量保存(現行 PUT パターン踏襲)。
- モックに env-only モードの描写はない → 部分ロック(接続設定 read-only + モデル編集可)の UI 表現は design で確定する。

---

## 設計フェーズ Discovery (2026-07-02, /kiro-spec-design)

- **Discovery Scope**: Extension(light discovery。gap 分析済みのため統合点の精査のみ)

### Research Log

#### env-only モードの機構
- **Sources**: `config-definition.ts` L1556–1612
- **Findings**: `ENV_ONLY_GROUPS: { controlKey, targetKeys[] }[]`。`env:useOnlyEnvVars:ai` の現 targetKeys は `app:aiEnabled` + `ai:provider` / `ai:apiKey` / `ai:allowedModels` / `ai:azureOpenaiSettings`(AI 設定一括)。
- **Implications**: 部分ロック(R5.2/5.3)は targetKeys を接続設定系(`app:aiEnabled`, `ai:providers`, `ai:providerApiKeys`)に差し替えるだけで実現。仕組み自体の変更は不要。

#### モデル解決キャッシュと再起動なし反映
- **Sources**: `resolve-mastra-model.ts`
- **Findings**: `resolvedModelCache: Map`(キー `${provider}:${modelId}`)+ `clearResolvedMastraModelCache()`。AI 設定保存時(ローカル)と s2s `configUpdated` 受信時(他インスタンス)に全クリア。Azure+Entra のトークンキャッシュ保持のためキャッシュ自体は必須。
- **Implications**: 機構を温存し、キャッシュキーを modelKey に変更するのみ。

#### チャット UI のグループ化部品
- **Sources**: `components/ui/select.tsx`, `components/ai-elements/prompt-input.tsx`
- **Findings**: `ui/select.tsx` は `SelectGroup` / `SelectLabel` を既に export。`prompt-input.tsx` の `PromptInputModelSelect*` には Group/Label ラッパが未定義。
- **Implications**: prompt-input.tsx に薄い re-export ラッパ 2 つを追加するだけでプロバイダ別グループ表示が可能(新規依存なし)。

#### RN-2 解決: Azure デプロイ名の文字種
- **Sources**: Microsoft Learn resource-name-rules(Web 検索)
- **Findings**: デプロイ名は 1–64 文字、英数字・アンダースコア・括弧・ハイフン・ピリオド。**`/` は不可**。
- **Implications**: `${provider}/${modelId}` 複合キーのセパレータとして `/` は安全。さらに「最初の `/` で分割」仕様(provider 側に `/` は出現しない)により、万一の逸脱値でも解釈が曖昧にならない。

#### RN-1 解決: Mastra モデルルーター文字列との競合
- **Findings**: 各 resolver は ai-sdk factory で構築済みの LanguageModel(`MastraModelConfig`)を返しており、Mastra の "provider/model" マジック文字列解釈は経由しない。
- **Implications**: 自前 modelKey は GROWI コード内でのみ解釈され、Mastra のルーター意味論と競合しない。

#### 再利用資産の確定
- picker(`admin-ai-settings/get-available-models.ts` + `use-selectable-models.ts`)は provider 引数を取る設計 → プロバイダパネル単位でそのまま再利用。
- `MAX_MODEL_ID_LENGTH`(256)は防御上限として modelKey にも流用可能(名称変更)。

### Design Decisions(要点)

1. **D1 モデル識別子**: config 保存形は `AllowedModel.provider`(必須フィールド)で構造化。境界を渡るスカラー(transport body・UserUISettings・requestContext・キャッシュキー)は複合キー `${provider}/${modelId}`(modelKey)。解析は最初の `/` で分割する pure 関数(`interfaces/model-key.ts`)。tuple 案は既存の string 配管(ライブ getter 注入・単一 String フィールド)を全て二重化するため不採用。
2. **D2 config 構造**: `ai:providers: Record<AiProvider, AiProviderSettings>`(enabled + azure 接続設定、非秘匿)と `ai:providerApiKeys: Partial<Record<AiProvider, string>>`(isSecret)に分離。秘匿/非秘匿を key 単位で分けることで管理 API が非秘匿設定をそのまま返せる。旧 `ai:provider` / `ai:apiKey` / `ai:azureOpenaiSettings` は削除(R7、移行なし)。env: `AI_PROVIDERS` / `AI_PROVIDER_API_KEYS`(JSON。`AI_ALLOWED_MODELS` の JSON env 前例に整合)。
3. **D3 可用性判定の一元化**: `provider-availability.ts`(新規)に「構成済み」「有効」判定と有効モデル集合の導出を集約。`isAiConfigured` / `get-models` / `resolveEffectiveModelKey` が同一述語を共有(判定の drift 防止、R6)。
4. **D4 既定モデル**: `isDefault` フラグ維持(グローバル 1)。実行時の実効既定 = 既定エントリが有効ならそれ、無効なら「有効なエントリの先頭」(決定的、R6.4)。
5. **D5 UserUISettings**: `aiChatSelectedModelId` → `aiChatSelectedModelKey` へ改名(値が modelKey になり意味が変わるため。プレリリース、旧フィールドは放置)。PUT ルートのハードコード allow-list 拡張が必須。
6. **D6 env-only PUT 分割**: env-only 時、PUT は `allowedModels` のみ受理。`providers` / `aiEnabled` を含むリクエストは 400(暗黙無視より明示的、R5.2)。
7. **D7 チャット API**: `ChatModelsResponse = { models: Array<{ key, provider, modelId, displayName }>, selectedModelKey }`(クライアントは parse せず構造化データを使用。`displayName` はカタログ由来の公式表示名で id フォールバック)。post-message body は `modelKey` に改名。
8. **D8 管理 UI**: モック準拠の 3 新コンポーネント(DefaultModelSelector / ProviderTabs / ProviderPanel)+ AllowedModelsField を provider スコープ化。ProviderCommonSettings は削除。フォーム値は `providers: Record<AiProvider, ProviderFormValue>` + フラットな `allowedModels[]`(グローバル既定検証のため単一配列)。

### Risks & Mitigations
- ai-settings-model-picker(現行ブランチ)と同一ファイル群への変更 → **picker マージ後に本 spec を実装**(タスク前提条件に明記)。→ **解消済み(2026-07-03 追記参照)**
- (provider, modelId) 一意性への検証変更で既存テストが広範に破損 → タスクで interfaces → server → routes → client の依存順に段階実装。
- 秘匿値の per-provider 化でログ/応答への漏えい面が増える → 既存の「body を stringify しない」規律を put/get の全 catch に踏襲、Record 全体を isSecret 指定。

---

## 追記 (2026-07-03, ベース変更の影響評価)

feat/186192-ai-settings-model-picker が PR #11383 で dev/8.0.x にマージされ、本ブランチ(feat/186460-mastra-multi-provider)のベースが dev/8.0.x になった(`git merge-base --is-ancestor` で確認済み)。**着手前提条件(C3 / RN-6)は解消**。

### マージされた picker 最終形と設計時スナップショットの差分

picker はマージまでに拡張されており、以下が設計時の想定と異なる:

| 項目 | 設計時の想定 | マージ後の実態 |
|---|---|---|
| 同梱カタログの場所 | `src/features/mastra/server/services/ai-sdk-modules/model-catalog-data.json` | `apps/app/resource/model-catalog-data.json` |
| カタログの提供元 | 同梱資産の read のみ | **実効カタログ** = DB のリフレッシュ済みカタログ(Prisma モデル `refreshed-model-catalog`)?? 同梱資産(`effective-model-catalog.ts`) |
| 外部通信 | なし | **opt-in** のリフレッシュ(既定 OFF): 起動時 `ai:modelCatalogRefreshOnStartup` / cron `ai:modelCatalogRefreshCronSchedule` / 手動 POST `/ai-settings/refresh-model-catalog`(`AllowedModelsField` に導線あり) |
| ロケール | en/ja/zh/fr | **ko_KR が追加**(dev/8.0.x 由来。tasks 6.6 は 5 ロケールに修正済み) |

### 本 spec への影響(確認結果)

- **依拠契約は不変**: `get-available-models` は provider 引数 → `getEffectiveSelectableModelIds(provider)` で `SelectableModelsResponse` を返す(呼び出し契約は設計時と同一)。`AllowedModel` 形・`AI_SETTING_KEYS`・env-only グループ(旧 5 キー)も設計の前提どおり。
- **spec 文書の更新(実施済み)**: design の Out of Boundary / Allowed Dependencies を picker 最終形のファイル群・契約へ更新。カタログリフレッシュ 2 config キーは `ai:*` prefix だが**変更対象外**と明記(task 2.1 に温存 bullet 追加 — `ai:*` 一括整理への巻き込み防止)。`AllowedModelsField` の provider スコープ化(task 6.4)で**手動リフレッシュ導線を維持**する bullet を追加。requirements の関連 spec 記載・Adjacent expectations を「実装済み + 実効カタログ」前提へ更新。
- **タスクグラフへの構造的影響なし**: 追加・削除タスクなし(既存タスクへの bullet 追記のみ)。
