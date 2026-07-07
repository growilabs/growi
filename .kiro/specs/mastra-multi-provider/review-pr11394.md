# PR #11394 レビュー結果 — feat(mastra): support multiple AI providers

- 対象: GitHub PR #11394(`feat/186460-mastra-multi-provider` → `dev/8.0.x`)
- 規模: 104 ファイル / +10,138 / -3,837
- レビュー実施日: 2026-07-06〜07
- 観点: spec 整合性 / dead code / 重複 / 不要コード / 複雑さ / 型 assertion / テスト / セキュリティ

## 概要

AI 機能を「1 App = 単一プロバイダ」から OpenAI / Anthropic / Google / Azure OpenAI の 4 プロバイダ同時利用へ拡張する PR。`modelKey`(`provider/modelId`)導入、config キー再設計(`ai:providers` / `ai:providerApiKeys` / `ai:allowedModels`)、可用性判定の一元化、管理画面・チャット UI の再編を含む。

**全体評価**: 実装は spec に非常に忠実で、秘匿情報の扱い・fail-soft・データ駆動設計など防御的に丁寧。11 観点で探索した候補を個別検証し、修正推奨 8 件+参考多数。セキュリティに重大な問題はなし。

**対応状況(2026-07-07 時点)**: 修正推奨 8 件はすべて対応済み(作業ツリー反映済み・未コミット)。参考レベルの指摘は未対応(任意)。

### 検証済みの良い点

- サーバ/クライアントが可用性判定の純粋関数(`evaluateProviderAvailability`)を共有しており drift しない(PR の主張を確認)。
- プロバイダレジストリ(`AI_PROVIDER_DEFS`)・resolver マップは真にデータ駆動。
- admin ルートの保護、`isSecret` 指定、GET でのマスク、resolve キャッシュの allow-list 有界性、prototype pollution 経路、Mongo 正規表現はクリーン。

---

## 対応状況サマリ

| # | 重要度 | 状態 | ファイル | 概要 |
|---|--------|------|----------|------|
| 1 | 高(正確性) | ✅ 対応済み | ai-settings-form-values.ts | 非表示タブの不正 providerOptions JSON が submit で throw |
| 2 | 高(正確性) | ✅ 対応済み | config.ts:238 / provider-availability.ts:94 | `getAllowedModels` が modelId 未検証 → env 経由で `openai/undefined` |
| 3 | 高(正確性) | ✅ 対応済み | validate-allowed-models.ts:91 / effective-model-key.ts:47 | `isDefault` 型未検査 → 実行時と UI で既定モデルが食い違う |
| 4 | 高(正確性) | ✅ 対応済み | config.ts:48 / put-ai-settings.ts:294 | API キーが trim 判定・未 trim 保存 →「設定済みなのに常に 401」 |
| 5 | 高(テスト/セキュリティ) | ✅ 対応済み | put/get-ai-settings.spec.ts / ProviderPanel.spec.tsx | Req 1.9「キーはログにも漏れない」がテストで半分しか守られていない |
| 6 | 中(正確性) | ✅ 対応済み | validate-allowed-models.ts:63 / ai-settings-form-values.ts:133 | modelId 前後空白が通過 → 重複検出(Req 2.4)を破る |
| 7 | 低(正確性) | ✅ 対応済み | put-ai-settings.ts:346 / config.ts:167 | 生 `getConfig` 読みで不正 env 値がインデックスキー化して DB 永続 |
| 8 | 低(重複/簡素化) | ✅ 対応済み | get-models.ts:66-83 / effective-model-key.ts:98 | 解決チェックポイントの二重実装 + 同一ハンドラ内で可用性 2 回スイープ |

---

## 詳細(修正を推奨する指摘)

### 1. ✅ 対応済み — 非表示タブの不正 providerOptions JSON がバリデーションをすり抜ける

- **ファイル**: `apps/app/src/features/mastra/client/admin/ai-settings-form-values.ts:137`
- **検証**: CONFIRMED(RHF 7.52 のソースで確認)
- **内容**: パネルは `key={activeProvider}` で 1 プロバイダ分しかマウントされず、react-hook-form(`shouldUnregister: false` 既定)はアンマウントされたフィールドの validate ルールを submit 時にスキップし既存エラーもクリアする。`buildUpdateRequest` は全行を `toAllowedModel` → `JSON.parse` に通すため、タブ A で不正 JSON を入力 → タブ B に切替 → 更新、で SyntaxError が「Unexpected token…」という原因不明のトーストになり保存が永久にブロックされる。コード内コメント「インラインバリデータが submit 前に弾く」は事実と逆だった。
- **対応**(コミット前・作業ツリー反映済み):
  - 純粋ヘルパー `findFirstInvalidProviderOptionsIndex` を追加(共有バリデータ `isValidProviderOptionsJson` を使用)。
  - `onSubmit` に submit 時セーフティネット追加: dirty なリスト全行を検証し、不正行があればそのタブへ切替 + `setError` + 明確なトースト + 保存中断。
  - i18n 新キー `provider_options_invalid_json_save_blocked` を 5 ロケールに追加。
  - 純粋ヘルパーの回帰テスト 4 件を追加。
  - `lint:typecheck` exit 0 / `biome check` クリーン / 全テスト green。

### 2. ✅ 対応済み — `getAllowedModels` が modelId を検証せず既定モデルが `openai/undefined` になる

- **ファイル**: `apps/app/src/features/mastra/server/services/ai-sdk-modules/llm-providers/config.ts:238`(バグ源)/ `provider-availability.ts:94`(修正箇所)
- **検証**: CONFIRMED
- **内容**: フィルタは `isRecord(entry) && isAiProvider(entry.provider)` のみで、`AI_ALLOWED_MODELS` 環境変数は PUT バリデータを通らない。`{"provider":"openai","model":"gpt-4o","isDefault":true}`(`modelId` のフィールド名 typo)が生き残ると `isAiConfigured()` が true になり、`buildModelKey` は無検証のテンプレートリテラルなので既定キーが文字列 `'openai/undefined'` になる。さらに `isModelInAllowList` で `'undefined' !== undefined` となり毎リクエスト誤解を招く warn を出しつつ、プロバイダへ literal `undefined` を送って全チャットが 404 する。
- **対応**(コミット前・作業ツリー反映済み): `getAllowedModels` は「valid provider だが modelId 不正なエントリを admin GET で可視化しておく」設計コメントを持つため触らず、チャット経路の `getAvailableModels`(provider-availability.ts:94)に modelId 妥当性ガード(`typeof model.modelId === 'string' && model.modelId.trim() !== ''`)を追加。env 由来の不正エントリは `isAiConfigured` / effective-default / get-models / post-message いずれからも除外される。回帰テスト 1 件(missing/空/空白の modelId 除外)を provider-availability.spec に追加。`lint:typecheck` exit 0 / `biome` クリーン / 関連 spec(provider-availability・effective-model-key・is-ai-configured・get-models)全 green。

### 3. ✅ 対応済み — `isDefault` の型検査がなく既定モデルが実行時と UI で食い違う

- **ファイル**: `apps/app/src/features/mastra/server/routes/admin-ai-settings/validate-allowed-models.ts:91` / `effective-model-key.ts:47`
- **検証**: CONFIRMED
- **内容**: バリデータは `=== true` のみカウントし boolean 型チェックがない(`provider`/`modelId`/`providerOptions` にはある)。API 直叩きで `isDefault: 'false'`(文字列)が検証を通過し verbatim 保存される。実行時の `pickEffectiveDefault`(effective-model-key.ts:47)は truthy `find` なので `'false'` が既定に選ばれ、管理画面(`=== true`)は別のモデルを既定と表示 — サイレントに食い違う。
- **対応**(コミット前・作業ツリー反映済み): 2 層で修正。
  - PUT バリデータ(`isValidNonEmptyAllowedModels`)に boolean 型ガード `entry.isDefault != null && typeof entry.isDefault !== 'boolean' → false` を追加。
  - env 経由(PUT バリデータ迂回)でも堅牢になるよう、実行時 `pickEffectiveDefault` の `find` を truthy から `model.isDefault === true` に変更し、管理 UI の厳格判定と一致させた。
  - 回帰テストを 2 件追加(validate-allowed-models.spec: 非 boolean `isDefault` を拒否 / effective-model-key.spec: truthy 文字列を無視して実 boolean 既定を選択)。`lint:typecheck` exit 0 / `biome` クリーン / 両 spec 全 green(32件)。

### 4. ✅ 対応済み — API キーが trim 判定・未 trim 保存で「設定済みなのに常に 401」を作る

- **ファイル**: `apps/app/src/features/mastra/server/services/ai-sdk-modules/llm-providers/config.ts:48`(読み境界)/ `put-ai-settings.ts:294`(書き込み)
- **検証**: CONFIRMED
- **内容**: `apiKey.trim() !== ''` で存在判定した後**生の値**を保存し、読み側 `asNonBlankString` も trim せず返し、クライアントも trim しない。前後スペース付きで貼り付けると UI は「設定済み」を示すのにチャットは常に 401(改行は UI の input では除去されるため `\n` 起因の undici クラッシュは API/env 経由のみ)。直上のコメント「stray space が configured-yet-failing なキーとして保存されることはあり得ない」は実挙動と正反対。
- **対応**(コミット前・作業ツリー反映済み): 単一 read 境界での正規化を主軸に 2 箇所修正。
  - `asNonBlankString`(config.ts:48)が trim 済み値を返すよう変更。これは getApiKey に加え Azure 接続設定(resourceName/baseURL/apiVersion)の正規化も担う単一 read 境界なので、DB・env の両ソースと Azure エンドポイントの同種問題も同時に解消。
  - 書き込み側 `collectRequestApiKeys`(put-ai-settings.ts:294)も canonical 化して `apiKey.trim()` を保存し、実挙動と逆だったコメントを訂正。
  - 回帰テストを 2 件追加(config.spec: 前後空白/改行付きキーを trim して返す / put-ai-settings.spec: 空白付きキーを trim して永続化)。`lint:typecheck` exit 0 / `biome` クリーン / 関連 spec 全 green(config 28・put 42)。

### 5. ✅ 対応済み — Req 1.9「API キーはログにも漏れない」がテストで半分しか守られていない

- **ファイル**: `apps/app/src/features/mastra/server/routes/admin-ai-settings/put-ai-settings.spec.ts`, `get-ai-settings.spec.ts`, `ProviderPanel.spec.tsx`
- **検証**: CONFIRMED(a/b/c すべて)
- **内容**:
  - (a/b) エラーパスのテストは `apiv3Err` の `message` しか掃引せず、catch 節の `logger.error('Failed to update AI settings', err)` は無検証(logger のモックすらなし)。`logger.error(..., req.body)` のような退行で秘匿キーがログに漏れても green のまま。
  - (c) 旧 ProviderCommonSettings.spec にあった `type="password"` 断言が ProviderPanel.spec に引き継がれておらず、平文表示への退行を検知できない。
- **対応**(コミット前・作業ツリー反映済み。テストのみの追補で本番コードは元々正しい):
  - put / get 両 spec に `~/utils/logger` モック(`loggerError`)を追加し、エラーパステストを強化: `apiv3Err` の**全引数を `JSON.stringify` で掃引**、加えて `logger.error` が呼ばれたこと + その全引数(Error は message 展開)にも `sk-leak-me-not` が含まれないことを検証。
  - ProviderPanel.spec に `type="password"` 断言テストを追加(平文表示 = `type="text"` への退行を検知)。
  - `lint:typecheck` exit 0 / `biome` クリーン / 3 spec 全 green(69件)。

### 6. ✅ 対応済み — modelId の前後空白が検証を通過し重複検出(Req 2.4)を破る

- **ファイル**: `apps/app/src/features/mastra/client/admin/ai-settings-form-values.ts:133`(canonical 化)/ `validate-allowed-models.ts:63`(サーバ防御)
- **検証**: CONFIRMED
- **内容**: `' gpt-4o'` は trim-empty チェックを通過して verbatim 保存され、重複キーは生値 ``${provider}\0${modelId}`` なので `'gpt-4o'` と共存できる。フリーテキスト入力は azure-openai だけでなく**カタログ取得失敗時は全プロバイダ**で有効なため到達性は見た目より広い。
- **対応**(コミット前・作業ツリー反映済み。指摘 4 の API キー trim と同方針):
  - クライアント `toAllowedModel`(ai-settings-form-values.ts:133)で `row.modelId.trim()` を保存し、UI 経路の値を canonical 化。
  - サーバ検証 `isValidNonEmptyAllowedModels`(validate-allowed-models.ts:63)に「前後空白を持つ modelId を拒否」(`entry.modelId.trim() !== entry.modelId → false`)を追加。UI は trim 済みで送るため 400 になるのは直叩き API のみ。これで重複検出の一貫性(`' gpt-4o'` vs `'gpt-4o'`)と provider 側の model-not-found を両方防ぐ。
  - 回帰テストを 2 件追加(form-values.spec: modelId を trim して保存 / validate-allowed-models.spec: 前後空白 modelId を拒否)。`lint:typecheck` exit 0 / `biome` クリーン / 両 spec 全 green(49件)。

### 7. ✅ 対応済み — マージ元をシェイプガード付き accessor でなく生の `getConfig` から読んでいる

- **ファイル**: `apps/app/src/features/mastra/server/routes/admin-ai-settings/put-ai-settings.ts:346` / `config.ts:167`(accessor を export)
- **検証**: CONFIRMED(facet b のみ。facet a の「env キーが保存時に DB へ引き継がれる」挙動は Req 1.3/1.4 として意図的設計と確認 → バグではない)
- **内容**: `AI_PROVIDER_API_KEYS='["sk-a"]'`(valid JSON・不正シェイプ)のとき、読み側は warn して未設定扱いにするのに、この行は `?? {}` しか防御がなく `{...['sk-a'], openai:'new'}` → `{"0":"sk-a","openai":"new"}` というインデックスキー付きのジャンク(旧秘匿値の断片を含む)を DB に永続化する。
- **対応**(コミット前・作業ツリー反映済み):
  - `config.ts` の `readProviderApiKeys`(`isRecord` ガード付き。配列/文字列は未設定扱い + warn)を `export` 化。
  - `buildUpdates`(put-ai-settings.ts:346)のマージ元を `configManager.getConfig('ai:providerApiKeys') ?? {}` から `readProviderApiKeys() ?? {}` に差し替え。不正 env 値はここで未設定扱いになり、ジャンクが永続化されない。
  - テスト: put-ai-settings.spec のモック境界を `readProviderApiKeys` に変更し、①guarded accessor が unset を返したとき request キーのみがマージされること ②生 `getConfig('ai:providerApiKeys')` が使われないこと を検証。config.spec に「配列値を未設定扱いにする(ジャンク経路のガード)」テストを追加。`lint:typecheck` exit 0 / `biome` クリーン / 両 spec 全 green(put 43・config 29)。

### 8. ✅ 対応済み — 解決チェックポイントの二重実装と同一ハンドラ内の可用性 2 回スイープ

- **ファイル**: `apps/app/src/features/mastra/server/services/ai-sdk-modules/llm-providers/effective-model-key.ts:98` / `get-models.ts:66-83`
- **検証**: CONFIRMED
- **内容**: `parseModelKey` → メンバーシップ → 既定フォールバックのルールが `resolveEffectiveModelKey`(自ら「Request-time single validation checkpoint (Req 4.6)」と文書化)と二重に存在。`getEffectiveDefaultModelKey()` が内部で `getAvailableModels()` を再計算するため、2 回のスイープが異なる config 状態を観測すると `selectedModelKey` が `models` 配列に存在しないレスポンスになり得る(軽微な TOCTOU)。warn の要否だけが正当な意味差。
- **対応**(フル案、コミット前・作業ツリー反映済み):
  - `resolveEffectiveModelKey(modelKey?, { availableModels?, warnOnReject? })` にオプションを追加。`availableModels` を渡すと内部スイープを行わず、`warnOnReject:false` で保存済み設定解決時の監査 warn を抑制(唯一の正当な意味差)。既存呼び出し(post-message / resolve-mastra-model)はデフォルト維持で無影響。
  - get-models のインライン parse/membership/default ブロックを削除し、`resolveEffectiveModelKey(saved, { availableModels, warnOnReject: false })` に委譲。手持ちの `availableModels` を渡すのでスイープは 1 回のみ・TOCTOU も解消。「single checkpoint」の宣言が実態と一致。
  - テスト: effective-model-key.spec にオプション 2 件(セット再利用でスイープ無し / warnOnReject:false で warn 抑制)を追加。get-models.spec は `resolveEffectiveModelKey` を実物のまま使う構成に変更(解決ルールは実統合で検証、モックの戻り値再言明を回避)。`lint:typecheck` exit 0 / `biome` クリーン / get-models・effective-model-key・is-ai-configured・post-message・resolve-mastra-model 全 green(59件)。
- **メモ**: 実行中に vite キャッシュ(`node_modules/.vite`)が stale になり `~/` alias 解決が偽陽性で失敗する事象があった。キャッシュ削除で解消(コード起因ではない)。

---

## 参考レベルの指摘(対応任意・すべて未対応)

### spec 整合性 — ✅ 対応済み(ドキュメント整合、2026-07-07)

- **✅** `design.md` の `buildUpdateRequest` 記述を実装に合わせて更新: `allowedModels` は **dirty 時のみ送出**する規則と理由(env シードの 0 件既定リストを毎回送ると 3.2 検証で無関係な保存まで 400 になる)を明文化。
- **✅** `design.md` の API 表 + PUT セマンティクスを訂正: PUT 応答は「AiSettingsResponse 相当」ではなく **空ボディ(`res.apiv3({})`)** で、クライアントは SWR `mutate()` で GET を再取得してフォーム再シード(秘匿規律とも整合)。
- **✅** `tasks.md` の親チェックボックスを更新: 全サブ完了の 1〜7 をチェック。タスク 8 は 8.2(手動スモーク)未完のため未チェックのまま(意図どおり)。

### dead code

- `provider-availability.ts:34` の型 re-export(`ProviderAvailability`/`ProviderUnavailableReason`)は import 実績ゼロ。削除推奨。
- `DefaultModelSelector.tsx:33` の `disabled` prop は「将来の呼び出し元のため」と自認する未使用品(YAGNI)。
- `AllowedModelsField.tsx:34` の `disabled` は唯一の呼び出し元が常に `false` を渡し、JSDoc が R5.3 の実装(env-only でもモデル編集可)と**逆**を記載。将来の誤修正を誘発するため prop 削除か doc 訂正を。

### 重複コード

- `isRecord` ガードが 4 箇所に手書きされ **validate-allowed-models 版だけ配列除外を欠く**(セマンティクス不一致)。feature 共通 util へ抽出推奨。
- 「空白のみ = 未設定」規則が 3 層でコメント相互参照のみで再実装(`asNonBlankString` / `collectRequestApiKeys` / クライアント)。
- `getProviderOptionsJsonStatus` と `isValidProviderOptionsJson` の valid/invalid 判定が規約ベースで二重化。
- ChatSidebar と DefaultModelSelector の「プロバイダ別グループ化 + `provider · modelId` ラベル」が各自実装。
- `openai.ts` / `anthropic.ts` / `google.ts` の 3 モジュールが同形 12 行(factory マップ 1 個に畳める。azure-openai は非対称なので別のまま)。

### 型 assertion

- `config.ts:156/174` の `as AiProvidersConfig` / `as AiProviderApiKeys` が `isRecord` しか検証していない形状を主張。戻り型を `Record<string, unknown>` にして既存の normalizer に絞らせればキャスト不要。
- テスト: `get-models.spec.ts:97` / `post-message-handler.spec.ts:148` の `req as any, res as any`(`mock<Request & {user}>` / `mock<ApiV3Response>` で無キャスト化可能)、`put-ai-settings.spec` の未型付け `vi.fn()` 起因のキャスト連鎖、`get-ai-settings.spec` の `as Record<AiProvider, AiProviderStatus>` は testing.md の `mock<T>` 規則に照らして改善余地。

### 複雑さ / 効率

- チャット POST 1 回につき可用性スイープが 3 回+α(guard → handler → cache 判定**前**の resolver)、`getProviderAvailability` は非 azure でも azure 設定を毎回読む。ただし `getConfig` は純メモリ参照でコストはマイクロ秒級 — **性能問題ではなく可読性の問題**。`getAvailableModels` の config 世代単位メモ化(無効化フックは `clearResolvedMastraModelCache` 呼び出し箇所に既存)を任意改善として提案。
- `reportEnvShadowingIfNeeded` が各 accessor 呼び出しで最大 3 回 `getConfig`(DB 未設定なら 1 回で早期 return)。

### テスト品質

- `AiSettings.spec.tsx:169` の「タブ切替でトグル独立」テストは守るべき退行(`key={activeProvider}` 削除)で fail しないことをテスト自身が自認 — remount ガードが無防備。
- `effective-model-key.spec.ts:111` の `getAvailableModels` 呼び出し回数スパイは実装詳細断言(挙動保存リファクタで壊れる)。
- `AllowedModelsField.spec.tsx` は 1,124 行で coding-style の 800 行上限超過(責務別分割を推奨)。

### altitude(実装の深さ)

- `ai-provider.ts:1` のヘッダ「Server-only module … Do NOT add client imports」は虚偽(クライアント 5+ ファイルが値 import 済み)。`use-selectable-models.ts:8` も同じ誤りを反復。実態に書き換えを。
- azure-openai の特別扱いが約 7 箇所(`provider === 'azure-openai'` 分岐 + リテラルフィールド)。
- 4 プロバイダ列挙が 400 メッセージ + OpenAPI enum 3 箇所にハードコード。第 5 プロバイダ追加時の触り漏れリスク(`AI_PROVIDER_DEFS` に「追加接続設定あり」「列挙可能」等のメタデータスロットを足すのが正攻法)。
- `AllowedModelsField.tsx:161` の `isAzure = provider === 'azure-openai'` はサーバ専用メタデータ(`enumerable: false`)をクライアントで再導出。

### その他

- **[低]** modelId 長の上限が複合キー(`azure-openai/` の +13 文字)を考慮しておらず、244〜256 文字の modelId は管理画面で保存できるのにチャット POST と user-ui-settings PUT が 400 になる。実在のモデル ID では到達不能なため参考扱い(修正は上限を `MAX_MODEL_KEY_LENGTH - 最長プレフィックス` に)。

---

## 推奨対応順序

1. 指摘 1〜4(実挙動バグ)← **1 は対応済み**
2. 指摘 5(秘匿契約のテスト穴)
3. 指摘 6・7(いずれも数行の正規化/差し替え)
4. 指摘 8(重複解消・任意)
5. 参考レベル(dead code / doc 訂正 / 型 assertion など)は時間があれば
