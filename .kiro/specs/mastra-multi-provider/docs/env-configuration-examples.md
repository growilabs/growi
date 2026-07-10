# 環境変数による AI マルチプロバイダ構成 — 記述例

mastra-multi-provider が導入する 3 つの JSON 環境変数(`AI_PROVIDERS` / `AI_PROVIDER_API_KEYS` / `AI_ALLOWED_MODELS`)のコピペ可能な記述例集。**タスク 8.2 のスモークテストは §2 の「2 プロバイダ構成」ブロックをそのまま使って検証する**(記述例の実例検証を兼ねる)。

対応する config キーと env var(定義: `apps/app/src/server/service/config-manager/config-definition.ts`):

| Config key | env var | 値の形式 | isSecret |
|---|---|---|---|
| `app:aiEnabled` | `AI_ENABLED` | boolean | no |
| `ai:providers` | `AI_PROVIDERS` | JSON(Record: `AiProvidersConfig`) | no |
| `ai:providerApiKeys` | `AI_PROVIDER_API_KEYS` | JSON(Record: `AiProviderApiKeys`) | **yes** |
| `ai:allowedModels` | `AI_ALLOWED_MODELS` | JSON(配列: `AllowedModel[]`) | no |
| `env:useOnlyEnvVars:ai` | `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS` | boolean | no |

サポートされるプロバイダ名(`AiProvider`): `openai` / `anthropic` / `google` / `azure-openai`

## 1. 3 つの JSON env var の役割と形式

いずれも **JSON を 1 行の文字列**として env var に設定する。malformed な JSON は fail-soft で「未設定」扱いになり、`(config key, 理由)` の warn ログが出力される(ログゼロで AI 機能が無効化される fail-silent はない — エスケープ誤りはこの warn で観測できる)。

- **`AI_PROVIDERS`**(→ `ai:providers`)— プロバイダ別の非秘匿設定。`{ "<provider>": { "enabled": boolean, "azureOpenaiSettings": {...} } }` の Record。
  - `enabled` 省略時は false(無効)。エントリ自体がないプロバイダは「未設定」。
  - `azureOpenaiSettings` は `azure-openai` エントリでのみ有意(フィールドは §3 参照)。
- **`AI_PROVIDER_API_KEYS`**(→ `ai:providerApiKeys`、秘匿)— プロバイダ別 API キー。`{ "<provider>": "<api key>" }` の Record。
  - **全プロバイダのキーを 1 つの JSON 値に合成する**。1 config key = 1 env var の機構上、K8s の `secretKeyRef` 等でプロバイダごとに別々のシークレットソースから注入することはできない(design 記載のトレードオフ)。
- **`AI_ALLOWED_MODELS`**(→ `ai:allowedModels`)— エンドユーザーが選択できる許可モデルの配列。各エントリ:
  - `provider`(必須)— 所属プロバイダ。モデルは (provider, modelId) の組で識別される。
  - `modelId`(必須)— プロバイダ内のモデル ID。`azure-openai` では **Azure のデプロイメント名**。
  - `providerOptions`(任意)— AI SDK 形式のモデル別オプション(プロバイダ名前空間 → オプション)。
  - `isDefault`(任意)— 既定モデル指定。**配列全体(全プロバイダ横断)でちょうど 1 件だけ true にする**。

### 値の解決規則(シャドーイング)と env-only モードの関係

- 通常時は config-manager の標準解決 **「DB 値 ?? env 値」をキー全体に適用**(Record の per-provider deep merge はしない)。
  - env 値が効くのは同キーの **DB 値が存在しない間だけ**。管理画面で保存して DB 値が書かれた後は、env var を変更しても反映されない(env 値 = 初期値として振る舞う)。
  - 同一キーで DB 値と env 値が両方定義されていると、「env 値が DB 値にシャドーされている」旨の info ログ(dedup 付き)が出る — 「env を変えたのに反映されない」調査の観測点。
- 接続設定を**恒久的に env で統制**したい運用は env-only モード(§5)を使う。これが通常モードと env-only モードの分割の意図。

## 2. 基本例: 2 プロバイダ構成(OpenAI + Anthropic)

> **8.2 スモークテスト用ブロック** — このまま `.env` 等に貼り付け、API キー(`sk-proj-...xxxx` / `sk-ant-...xxxx` はダミー)と必要ならモデル ID を実際の値に置き換えて使う。

```bash
AI_ENABLED=true
AI_PROVIDERS='{"openai":{"enabled":true},"anthropic":{"enabled":true}}'
AI_PROVIDER_API_KEYS='{"openai":"sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx","anthropic":"sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx"}'
AI_ALLOWED_MODELS='[{"provider":"openai","modelId":"gpt-5","isDefault":true},{"provider":"openai","modelId":"gpt-5-mini"},{"provider":"anthropic","modelId":"claude-sonnet-4-5","providerOptions":{"anthropic":{"thinking":{"type":"enabled","budgetTokens":12000}}}}]'
```

各値の中身(整形表示。env var へは上のように 1 行へ潰して設定する):

`AI_PROVIDERS`:

```json
{
  "openai": { "enabled": true },
  "anthropic": { "enabled": true }
}
```

`AI_PROVIDER_API_KEYS`(複数プロバイダのキーを 1 つの JSON に合成):

```json
{
  "openai": "sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx",
  "anthropic": "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx"
}
```

`AI_ALLOWED_MODELS`(プロバイダ横断のモデル集合 + `isDefault` ちょうど 1 件 + `providerOptions` の例):

```json
[
  { "provider": "openai", "modelId": "gpt-5", "isDefault": true },
  { "provider": "openai", "modelId": "gpt-5-mini" },
  {
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-5",
    "providerOptions": {
      "anthropic": { "thinking": { "type": "enabled", "budgetTokens": 12000 } }
    }
  }
]
```

ポイント:

- **既定モデル指定**: `isDefault: true` は配列全体でちょうど 1 件(この例では openai の `gpt-5`)。管理画面の PUT ではバリデータが保証する不変条件だが、env 直書きでも同じ規則を守ること(逸脱値はアクセサの防御ガード + 実効既定フォールバックで fail-soft される)。
- (provider, modelId) の組は一意。**同じ modelId を異なるプロバイダに重複登録するのは可**(同一プロバイダ内の重複は禁止)。
- 空配列 `[]` は「許可モデルなし」(= AI 未設定扱い)の正当な状態。

## 3. Azure OpenAI の例

Azure の接続設定は `AI_PROVIDERS` の `azure-openai` エントリ内の `azureOpenaiSettings` に書く(専用の env var はない)。フィールド(`AzureOpenaiConfig`): `resourceName` / `baseURL` / `apiVersion` / `useEntraId`。

- **endpoint 必須**: `resourceName` **または** `baseURL` のどちらか一方を設定する(AI SDK は両者を排他として扱い、両方あるときは `baseURL` を優先)。
- `apiVersion` は任意(未指定時は SDK 既定)。
- `AI_ALLOWED_MODELS` の `modelId` には Azure の**デプロイメント名**を書く。

### 3.1 API キー認証 + `resourceName`

```bash
AI_ENABLED=true
AI_PROVIDERS='{"azure-openai":{"enabled":true,"azureOpenaiSettings":{"resourceName":"my-growi-resource","apiVersion":"2024-10-21"}}}'
AI_PROVIDER_API_KEYS='{"azure-openai":"00000000000000000000000000000000"}'
AI_ALLOWED_MODELS='[{"provider":"azure-openai","modelId":"my-gpt-5-deployment","isDefault":true}]'
```

(API キー `00000000...` はダミー。Azure ポータルのキーに置き換える)

### 3.2 `baseURL` 指定(`resourceName` の代わり)

```bash
AI_PROVIDERS='{"azure-openai":{"enabled":true,"azureOpenaiSettings":{"baseURL":"https://my-growi-resource.openai.azure.com/openai"}}}'
```

### 3.3 Microsoft Entra ID 認証(API キー免除)

`useEntraId: true` を設定すると API キーが免除される — `AI_PROVIDER_API_KEYS` に `azure-openai` エントリは不要(endpoint は引き続き必須)。OpenAI との併用例:

```bash
AI_ENABLED=true
AI_PROVIDERS='{"openai":{"enabled":true},"azure-openai":{"enabled":true,"azureOpenaiSettings":{"resourceName":"my-growi-resource","useEntraId":true}}}'
AI_PROVIDER_API_KEYS='{"openai":"sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx"}'
AI_ALLOWED_MODELS='[{"provider":"openai","modelId":"gpt-5-mini","isDefault":true},{"provider":"azure-openai","modelId":"my-gpt-5-deployment"}]'
```

## 4. JSON エスケープの注意(シェル / dotenv / docker-compose)

JSON 値は `"` を多数含むため、記述環境ごとのクォート規則に注意する。誤エスケープは malformed config warn(→ 未設定扱い)として観測できる(§1)。

### 4.1 シェル(`export`)

**シングルクォートで囲むのが最も安全**(中の `"` をエスケープ不要):

```bash
export AI_PROVIDERS='{"openai":{"enabled":true}}'
```

ダブルクォートで囲む場合は内側の `"` をすべて `\"` にエスケープする(1 箇所でも欠けると malformed になる):

```bash
export AI_PROVIDERS="{\"openai\":{\"enabled\":true}}"
```

### 4.2 dotenv 系ファイル(`.env` / `.env.development` / docker compose の `env_file`)

`KEY='<JSON>'` の形でシングルクォートで囲む(dotenv 系パーサは囲みクォートを剥がして値にする)。§2 のブロックがそのままこの形式。クォートなしの裸書きも、値に空白・`#` を含まなければ動作するが、`providerOptions` 内などに空白を書いた途端に壊れるため推奨しない。

### 4.3 docker-compose(YAML)

map 形式の `environment:` で **YAML のシングルクォートスカラー**として書くと、JSON の `"` をそのまま書ける:

```yaml
services:
  app:
    environment:
      AI_ENABLED: "true"
      AI_PROVIDERS: '{"openai":{"enabled":true},"anthropic":{"enabled":true}}'
      AI_PROVIDER_API_KEYS: '{"openai":"sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx","anthropic":"sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx"}'
      AI_ALLOWED_MODELS: '[{"provider":"openai","modelId":"gpt-5","isDefault":true},{"provider":"anthropic","modelId":"claude-sonnet-4-5"}]'
```

リスト形式(`- KEY=value`)の場合は要素全体をシングルクォートで囲む(裸だと YAML のフロー記号 `{` `[` `,` の解釈事故が起きうる):

```yaml
    environment:
      - 'AI_PROVIDERS={"openai":{"enabled":true}}'
```

> **秘匿情報の注意**: `AI_PROVIDER_API_KEYS` は isSecret。compose ファイルへの直書きよりも `env_file` や secrets 機構での注入を推奨する。

## 5. env-only モード(接続設定を env で恒久統制)

`AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true`(config キー `env:useOnlyEnvVars:ai`)を設定すると:

- **env からのみ受け付け、管理画面では読み取り専用**になる対象キー: `app:aiEnabled`(`AI_ENABLED`)・`ai:providers`(`AI_PROVIDERS`)・`ai:providerApiKeys`(`AI_PROVIDER_API_KEYS`)— つまり接続設定(有効/無効・資格情報・Azure 接続先)。
- **`ai:allowedModels` は意図的に対象外**(R5.2 / R5.3): 許可モデル(provider / modelId / providerOptions / isDefault)は env-only モード中も管理画面から編集できる。`AI_ALLOWED_MODELS` は初期値として与えられ、管理画面で保存すると DB 値が優先される(§1 のシャドーイング規則どおり)。

例(接続設定は env 固定、モデルは管理画面で運用):

```bash
AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true
AI_ENABLED=true
AI_PROVIDERS='{"openai":{"enabled":true},"anthropic":{"enabled":true}}'
AI_PROVIDER_API_KEYS='{"openai":"sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx","anthropic":"sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx"}'
# AI_ALLOWED_MODELS は任意(初期値)。管理画面からの編集は引き続き可能
AI_ALLOWED_MODELS='[{"provider":"openai","modelId":"gpt-5","isDefault":true},{"provider":"anthropic","modelId":"claude-sonnet-4-5"}]'
```

## 6. 設定値のセルフチェック

設定を反映する前に、値が JSON としてパース可能かをローカルで確認できる:

```bash
node -e 'for (const k of ["AI_PROVIDERS","AI_PROVIDER_API_KEYS","AI_ALLOWED_MODELS"]) { if (process.env[k] != null) JSON.parse(process.env[k]); } console.log("OK")'
```

(env を export したシェルで実行。malformed ならこのコマンドが例外で失敗する — アプリ側では同じ値が warn ログ + 未設定扱いになる)
