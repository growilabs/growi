# Implementation Plan

- [ ] 1. Foundation: 依存・型・設定
- [x] 1.1 LLM ベンダー SDK 依存の追加
  - `@ai-sdk/anthropic` と `@ai-sdk/google` を `^3.x`（既存 `@ai-sdk/openai ^3` と同じ provider IF）で `apps/app/package.json` の `dependencies` に追加し、ルートで `turbo run bootstrap` を実行して依存解決・lockfile を更新する
  - 観測可能: 両パッケージが `dependencies` に存在し `turbo run bootstrap` がエラーなく完了。`createAnthropic`（`@ai-sdk/anthropic`）/ `createGoogleGenerativeAI`（`@ai-sdk/google`）が型解決する
  - _Requirements: 1.1, 1.2_
  - _Boundary: package.json_

- [x] 1.2 (P) ベンダー識別子の型と型ガード
  - サポートするベンダー集合（openai/anthropic/google）を単一の配列として定義し、そこからベンダー型を導出する
  - 任意の文字列が有効なベンダーかを判定する型ガードを提供する（env 由来の不正値検知の基盤。型は `string` を受けて絞り込む）
  - co-located unit test: 3 値を受理し、未知文字列・非文字列を拒否する
  - 観測可能: 型ガードのユニットテストが green（未知文字列・非文字列で false を返す）
  - _Requirements: 1.1, 1.4_
  - _Boundary: llm-provider interface_

- [x] 1.3 (P) ベンダー設定キーの定義
  - ベンダーセレクタ（`string | undefined`、env 由来、既定なし）と、Anthropic/Google の API キー（secret）・モデル（ベンダー既定値あり）の設定キーを追加する。OpenAI は既存キーを再利用する
  - 設定キー一覧の配列と定義オブジェクトの両方に登録する（キー型・値型は自動導出）。env-only グループには登録せず、既存 API キーと同じ DB+env フォールバックで統一する（管理 UI は追加しない）
  - 観測可能: 新 env（`AI_PROVIDER` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MASTRA_AGENT_MODEL` / `GOOGLE_API_KEY` / `GOOGLE_MASTRA_AGENT_MODEL`）が設定として解決でき、モデル未指定時はベンダー既定値が返る。API キーは secret 扱いになる
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: config-definition_

- [ ] 2. Core: プロバイダー生成とモデル解決
- [x] 2.1 ベンダー別 native provider ファクトリ
  - 各ベンダーの native provider を**明示的な API キー注入**（env 自動検出に依存しない）で生成し、Mastra 互換の言語モデルを返す薄いアダプタを実装する（OpenAI / Anthropic / Google）
  - ベンダー→ファクトリの map を barrel で公開し、consumer がベンダー名で分岐しない構造にする
  - co-located unit test: 各ファクトリが対応する provider 生成関数を API キー付きで呼び、モデル名を適用することを確認（provider 生成関数を mock）
  - 観測可能: 3 ベンダーそれぞれで言語モデルが生成され、生成関数が `{ apiKey }` とモデル名で呼ばれることをテストで確認できる
  - _Requirements: 1.2, 2.1, 2.2_
  - _Boundary: llm-providers_
  - _Depends: 1.1, 1.2_

- [x] 2.2 モデルリゾルバ（判別共用体）
  - セレクタ取得 → 妥当性検証 → API キー/モデル取得 → ファクトリ呼び出しを 1 関数に集約し、`ok` / `disabled`（理由: 未指定 / 不正ベンダー / API キー欠落）の判別共用体を返す。`ok` は memoize する
  - 選択ベンダーに対応するキーのみ参照する（複数キー併存でも 1 つのみ使用）。理由オブジェクトに API キー値を一切含めない
  - co-located unit test: 未指定→vendor-unset、不正→vendor-invalid、キー欠落→api-key-missing、各ベンダー正常→ok、モデル未指定→既定使用、理由に API キー非混入、memoize の各分岐
  - 観測可能: 上記分岐がすべてテストで green になり、`disabled` の理由に API キー文字列が現れない
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.3, 2.5, 3.1, 3.2, 4.1_
  - _Boundary: resolve-mastra-model_
  - _Depends: 1.2, 1.3, 2.1_

- [ ] 3. Integration: エージェントと可用性ゲート
- [x] 3.1 growiAgent のモデル供給を dynamic function 化
  - エージェントの `model` をリゾルバ経由の dynamic function に置換し、`disabled` 時は使用時に throw（理由 type のみ・API キー非出力）する。import 時には解決せず、構築時に例外を投げない
  - 旧 OpenAI 固定プロバイダー生成（`get-openai-provider`）を削除し、唯一の参照元を更新する。spec を dynamic model / 無効時 throw / 構築 no-throw に合わせて更新する
  - 観測可能: throw する設定でもエージェント構築（import）が例外を投げず、`ok` 設定で `model()` が言語モデルを返し、`disabled` 設定で `model()` が throw することをテストで確認できる
  - _Requirements: 3.3, 4.1, 4.3, 5.1_
  - _Boundary: growi-agent_
  - _Depends: 2.2_

- [x] 3.2 起動時可用性ゲートとログ
  - ルート登録時に「AI 有効 かつ リゾルバ=ok」を判定する。不備時は原因（type）をログ出力（API キー非出力）し、汎用メッセージのエラー応答（503）を返す catch-all を実ルートより先に登録する。AI 無効時は既存 501 を維持し、アプリ本体・他 AI 機能の起動は継続させる
  - integration test: AI 無効→501、AI 有効＋vendor 未指定→503 かつ原因ログ（キー非出力）かつ実ルート shadow、AI 有効＋正常→実ルート有効
  - 観測可能: 上記 3 ケースのステータスコード／ログがテストで確認でき、設定不備でもサーバ起動が継続する
  - _Requirements: 2.5, 4.2, 4.3, 4.4_
  - _Boundary: routes/index_
  - _Depends: 2.2, 3.1_

- [ ] 4. Validation: 回帰と本番成果物確認
- [x] 4.1 (P) suggest-path 非影響の回帰確認
  - mastra のベンダー選択（anthropic/google を含む）に関わらず、ページパス提案が現行の OpenAI 経路で動作することをテスト／検証で確認する
  - 観測可能: ベンダーを非 OpenAI に設定しても suggest-path が従来どおり動作する回帰テストが green になる
  - _Requirements: 5.2_
  - _Boundary: suggest-path（参照のみ・変更なし）_
  - _Depends: 3.1, 3.2_

- [x] 4.2 (P) 依存分類の本番成果物検証
  - 本番ビルドを実行し、新規 `@ai-sdk/anthropic` / `@ai-sdk/google` が `apps/app/.next/node_modules` に externalise されることを確認し、`dependencies` 分類の妥当性を検証する（package-dependencies ルール）
  - 観測可能: ビルド後に両パッケージが `.next/node_modules` に出現し、`dependencies` 配置で本番起動時の `ERR_MODULE_NOT_FOUND` が発生しないことを確認できる
  - _Requirements: 1.1, 1.2_
  - _Boundary: build artifact（.next/node_modules）, package.json_
  - _Depends: 1.1, 2.1_

## Implementation Notes
- 1.3: 既存ブランチに **pre-existing な型エラー** `apps/app/src/features/mastra/server/routes/post-message.ts(77,48)` TS2769（`growiAgent.stream(...)` の引数）が存在する。本機能の変更とは無関係（baseline で再現）。タスク 3.1/3.2/4.x で post-message/routes 周辺を触る際、この既存エラーを「新規混入」と誤認しないこと。`pnpm run lint:typecheck` はこの1件で赤になる前提。
- 3.1: 当初 growi-agent の dynamic model 戻り値に `as MastraModelConfig` キャストを置いた（`ai` の `LanguageModel` union の文字列メンバー `GlobalProviderModelId` だけが `MastraModelConfig` に非代入だったため）。**その後リファクタ（commit bc064d6d3a）でキャストを完全除去**: ファクトリ／リゾルバ／エージェントの model 型を `ai` の `LanguageModel` ではなく `@mastra/core/llm` の `MastraModelConfig` で統一。具象 provider オブジェクトは `MastraModelConfig` の正当なメンバーなのでパイプライン全体が cast-free。research D-1 の「assignable」は型注釈次第（広い union を避ければ成立）という補足。
- 3.1(follow-up): **解決済み（bc064d6d3a）** — 削除した `get-openai-provider.ts` を指すコメント残骸（`resolve-mastra-model.ts`・`llm-providers/openai.ts`）を除去。`grep get-openai-provider` は src 全体でゼロ。
- 4.2: `@ai-sdk/anthropic`/`@ai-sdk/google` は **Express サーバ（dist/、`build:server`）** 経由の server-only パッケージで、`next build`（Turbopack）には到達しない → `.next/node_modules` に externalise されない（既存 `@ai-sdk/openai` と同一挙動）。よって design の「`.next/node_modules` で確認」前提は server パッケージには非該当。3つとも `dependencies` 配置で正しい（`pnpm deploy --prod` が devDeps を除去するため runtime require には必須）。確定的な prod ロード検証は CI Level 2（`server:ci` = `node dist/server/app.js`）。
- 4.2(pre-existing / 本仕様スコープ外・要対応): (a) `src/server/routes/apiv3/index.js:205` が `mastraRouteFactory(crowi)` を mount しているが、**本ブランチに import 文が無い**（import を追加した commit `25d076c6a6` は HEAD の ancestor でない＝分岐ブランチ側）。stale な `dist/`（2026-06-05）が require を残しローカルでは露見しないが、dist 再生成で **boot 時 ReferenceError**／CI Level 2 で顕在化。(b) `post-message.ts(77,48)` TS2769（`build:server`/typecheck の唯一の赤）。いずれも multi-llm-provider 由来でなく、support/mastra ブランチのマージ未完状態。本ブランチで別途 import 追加（または `25d076c6a6` cherry-pick）＋ post-message の型修正が必要。
- FB 反映（commit f67933bc44, 設計改訂 D-10）: タスク 1.3 / 2.2 / 3.2 の当初実装を上書き — (1) per-vendor 設定キーを単一 `ai:provider`/`ai:apiKey`/`ai:model` に統一（既定モデルは resolver の map）、(2) resolver を判別共用体から **throw ベース**へ（不備時 throw、`OpenaiClientDelegator` 流儀）、(3) 3.2 の起動時可用性ゲート（routes/index 変更・503）を **revert**（不備時 throw を post-message 既存 catch が処理）。タスクのチェックボックスは完了のまま（成果は最新コミットに反映済み）。
- FB 追加反映（D-11）: (1) `ai:provider` を inline literal union `'openai'|'anthropic'|'google'` に型付け（import 不要・依存逆転回避）、(2) 既定値 `'openai'`（Req 1.3 を「未指定→既定 OpenAI」に反転、vendor-unset throw 撤去）、(3) `ai:model` 既定 `'o4-mini'`・型は `string`（ベンダー横断モデル id union は SDK 未 export のため不可）、(4) resolver の `defaultModels` map 撤去（既定は config defaultValue に集約）。`isAiProvider` は実行時検証として残置（型は実行時強制でないため必須）。
- FB 追加（D-12）: (1) `ai:provider` を共有 `AiProvider` 型で定義（`import type`＝実行時に消えるため依存逆転の実害なし・leaf で循環なし・単一ソース）。(2) 未使用化した `openai:assistantModel:mastraAgent`（`OPENAI_MASTRA_AGENT_MODEL`）と、その唯一の利用元だった `openai` 型 import を削除。
- FB 追加（D-13・dispatch 最終形）: タスク 2.1/2.2（及び Azure 追加時の中間案）の「provider→ファクトリ map ＋ resolver が config を集約して呼ぶ」構造を、**各 provider が config から自己解決する `() => MastraModelConfig`** へ刷新（base タスク 2.x の記述は履歴）。(1) 共有キー（apiKey/model）の読取を `llm-providers/config.ts`（`requireApiKey`/`getApiKey`/`getModel`）に集約、(2) openai/anthropic/google は `resolve<Provider>Model()` の自己解決関数に、azure-openai は `resolveAzureOpenaiModel()` が endpoint/認証を自己完結、(3) barrel は `modelResolvers: Record<AiProvider, () => MastraModelConfig>` を組み立てるだけ、(4) `resolve-mastra-model.ts` は provider 検証 + `modelResolvers[provider]()` dispatch + memo のみ。中間案の `LlmModelFactoryParams`/`buildLlmModel<P>`（provider 別引数型 + correlated dispatch）は**廃止**（apiKey の必須/任意・azure の非均一性を共有経路に漏らさないため）。coding-style.md「Data-Driven Control over Hard-Coded Mode Checks」準拠（consumer は provider 追加で不変）。
- FB 追加（D-14・依存更新）: `@ai-sdk/{openai,anthropic,google,azure}` を最新安定版（3.x 系・`ai`@6 と整合）へ bump。`@azure/identity` は既存依存のため追加なし。
- PR FB 反映（D-15・PR #11297）: (1) **キー名改名** — `mastra:llm*` → `ai:`（`llm` 語を除去）で `ai:provider`/`ai:apiKey`/`ai:model`/`ai:providerOptions`、env は `AI_*`。型族も `AiProvider`（`interfaces/ai-provider.ts`）にリネーム。(2) **既定値の全廃** — provider/model/providerOptions の `defaultValue` を全て `undefined` に。`getModel()` → `requireModel()`（未指定で `AI_MODEL` を案内し throw）。D-11 の「既定 openai」「default o4-mini」と D-13 の「OpenAI reasoning 既定」を撤回。**上記の override により、下記 Scope Expansion (Req 6) タスク本文の「default=現行 OpenAI オプション」「env 未指定で OpenAI 既定が適用」は無効**（未指定時は空 `{}`）。テストに model 欠落 throw を追加。
- Azure 識別子: `ai:provider` の値は `azure-openai`（既存 `openai:serviceType` の `'azure-openai'` と表記統一）。Azure 固有の接続設定は単一の `AI_AZURE_OPENAI_SETTINGS`（JSON 文字列）に集約する。

## Scope Expansion (Req 6 — provider options via env)
- [x] 6.1 provider options の env 指定と適用
  - `ai:providerOptions`（`string`・生 JSON・env `AI_PROVIDER_OPTIONS`・default=現行 OpenAI オプション）を config に追加
  - `resolveProviderOptions()` を新設（parse + 名前空間検証 + 不正時 `{}` fail-soft + warn）。型は `Record<string, Record<string, JSONValue>>`
  - `post-message.ts` のハードコード providerOptions を `resolveProviderOptions()` に置換（variant A）
  - 観測可能: env 未指定で OpenAI 既定が適用、有効 JSON はそのまま適用、不正 JSON はチャットを壊さず `{}`＋warn。resolver 単体テスト 8 件 green
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: resolve-provider-options, post-message, config-definition_

## Scope Expansion (Req 7 — Azure OpenAI provider)
- [ ] 7. Azure OpenAI を 4 番目のベンダーとして追加
- [ ] 7.1 `@ai-sdk/azure` 依存の追加
  - `@ai-sdk/azure` を `^3.x`（既存 `@ai-sdk/*` と同じ provider IF）で `apps/app/package.json` の `dependencies` に追加し、ルートで `turbo run bootstrap` を実行して依存解決・lockfile を更新する
  - 観測可能: `@ai-sdk/azure` が `dependencies` に存在し `turbo run bootstrap` が完了。`createAzure`（`@ai-sdk/azure`）が型解決する
  - _Requirements: 1.1, 7.1_
  - _Boundary: package.json_

- [ ] 7.2 ベンダー集合への `'azure-openai'` 追加
  - `AI_PROVIDERS` に `'azure-openai'` を追加する（`AiProvider` 型・`isAiProvider` は自動拡張）。識別子は既存の `openai:serviceType` の `'azure-openai'` 値と表記を揃える
  - 観測可能: `isAiProvider('azure-openai')` が true を返し、`AI_PROVIDERS` の長さが 4 になる
  - _Requirements: 1.1, 1.4_
  - _Boundary: llm-provider interface_

- [ ] 7.3 Azure 固有の接続設定キー
  - 単一のオブジェクトキー `ai:azureOpenaiSettings`（型 `AzureOpenaiConfig` = `{ resourceName?, baseURL?, apiVersion?, useEntraId? }`・default `{}`・env `AI_AZURE_OPENAI_SETTINGS`・JSON 文字列・非 secret）を `CONFIG_KEYS` と `CONFIG_DEFINITIONS` に追加する。値の型は `apps/app/src/features/mastra/interfaces/azure-openai-config.ts` に定義する。API キー・デプロイ名は既存の `ai:apiKey` / `ai:model` を流用（追加しない）
  - 観測可能: 単一の env（`AI_AZURE_OPENAI_SETTINGS`）が parse 済みのオブジェクト config として解決でき、非 secret
  - _Requirements: 7.1, 7.2, 7.5_
  - _Boundary: config-definition_

- [ ] 7.4 Azure 自己解決 resolver（`resolveAzureOpenaiModel`）
  - `azure-openai.ts` を新設し、`resolveAzureOpenaiModel(): MastraModelConfig` を実装する。自分の config（resourceName/baseURL/apiVersion/apiKey/model）を読み、`resourceName`/`baseURL` 排他（baseURL 優先）・`apiVersion` は設定時のみ付与で `createAzure(...)(deploymentName)` を構築する。明示的 API キー注入（env 自動検出に依存しない）
  - **エンドポイント（resourceName/baseURL）が双方無い場合は throw**（欠落 env 名を名指し・API キー値非含）。共有経路に Azure 固有の型は漏らさない（自己完結）。（Entra ID 認証分岐は 8.x で追加）
  - co-located unit test（`azure-openai.spec.ts`）: resourceName 経路／baseURL 経路／両指定→baseURL 優先／apiVersion 任意／いずれも無い→throw（キー値非含）。configManager + `@ai-sdk/azure` を mock
  - 観測可能: 各経路で言語モデルが生成され、排他・throw 分岐がテストで green
  - _Requirements: 1.2, 7.2, 7.3, 7.4, 7.5_
  - _Boundary: llm-providers（azure-openai）_
  - _Depends: 7.1, 7.2, 7.3_

- [ ] 7.5 共有アクセサ + 各 provider 自己解決 + データ駆動 dispatch
  - `config.ts` に共有アクセサ `requireApiKey()`/`getApiKey()`/`getModel()`（apiKey/model は全 provider 共通）を作る。openai/anthropic/google を `resolve<Provider>Model(): MastraModelConfig`（`create*({apiKey:requireApiKey()})(getModel())`）に整える
  - `index.ts` で `modelResolvers: Record<AiProvider, () => MastraModelConfig>` を組み立て、`resolve-mastra-model.ts` は **provider 検証 + `modelResolvers[provider]()` dispatch + memoize** のみにする（consumer は provider 名で分岐しない＝coding-style.md「Data-Driven Control over Hard-Coded Mode Checks」準拠）
  - co-located unit test: 各 key-based resolver が apiKey+model で `create*` を呼ぶ／`Object.keys(modelResolvers)` が `AI_PROVIDERS` と一致／resolver の provider 検証・dispatch・memo。「未対応プロバイダ」の例示は `'cohere'`
  - 観測可能: 上記が green、provider 追加で resolver 本体が不変であることを構造で担保
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 4.1_
  - _Boundary: llm-providers（config/openai/anthropic/google/index）, resolve-mastra-model_
  - _Depends: 7.4_

- [ ] 7.6 (P) Azure を含めた回帰・型チェック
  - `pnpm vitest run` で mastra LLM 関連テスト（llm-providers / resolve-mastra-model / llm-provider ガード）が全 green、`pnpm run lint:typecheck` に Azure 由来の新規エラーが無いことを確認する（既存の pre-existing TS2769 は本タスク対象外）
  - 観測可能: 上記テストが green、typecheck の差分が pre-existing 既知エラーのみ
  - _Requirements: 1.1, 7.x_
  - _Boundary: mastra LLM modules（参照のみ）_
  - _Depends: 7.4, 7.5_

## Scope Expansion (Req 8 — Azure OpenAI Entra ID auth)
- [ ] 8. Azure OpenAI の Microsoft Entra ID 認証
- [ ] 8.1 認証方式フラグの config
  - 認証方式フラグは `ai:azureOpenaiSettings`（7.3 で追加済み）の `useEntraId` フィールド（`boolean`・既定 false）として表現する（独立キーは追加しない）。`@azure/identity` は既存依存のため追加不要
  - 観測可能: `ai:azureOpenaiSettings` の `useEntraId` が読め、未指定時 false 相当として扱える
  - _Requirements: 8.1, 8.2_
  - _Boundary: config-definition_

- [ ] 8.2 azure resolver に Entra ID 認証分岐を追加
  - `resolveAzureOpenaiModel()` 内で `ai:azureOpenaiSettings` の `useEntraId` を読み、真なら `getBearerTokenProvider(new DefaultAzureCredential(), 'https://cognitiveservices.azure.com/.default')` を `tokenProvider` として `createAzure` に渡す（API キー不使用）。偽なら `getApiKey()` を使い、欠落で throw（`AI_API_KEY`、または `AI_AZURE_OPENAI_SETTINGS` の `"useEntraId": true` を案内・キー値非含）。エンドポイント検証は両認証で共通
  - `@azure/identity` は static import（既存依存・既存 `AzureOpenaiClientDelegator` と同スコープ）。認証ロジックは**すべて azure resolver 内に局在**（共有経路・consumer は変更不要）
  - co-located unit test（`azure-openai.spec.ts`）: Entra ID 経路（`tokenProvider` を渡し apiKey 非送出。configManager + `@ai-sdk/azure` + `@azure/identity` を vi.mock）／apiKey も Entra ID も無い→throw
  - 観測可能: 上記分岐が green（確定的・高速）。key-based の apiKey 必須は `requireApiKey()` が引き続き担保
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: llm-providers（azure-openai）_
  - _Depends: 7.4, 8.1_

- [ ] 8.3 (P) consumer 非変更の確認（認証は azure resolver に完結）
  - 認証方式（API キー / Entra ID）の選択は azure resolver 内で完結し、`resolve-mastra-model.ts`（consumer）と key-based provider は**一切変更不要**であることを確認する（uniform `() => MastraModelConfig` 契約により認証差が共有経路へ漏れない）
  - 観測可能: `resolve-mastra-model.spec.ts`（dispatch/memo/検証）が Entra ID 追加後も無改修で green
  - _Requirements: 8.3, 8.4_
  - _Boundary: resolve-mastra-model（参照のみ）_
  - _Depends: 8.2_
