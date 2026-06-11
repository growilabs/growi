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
  - 観測可能: 新 env（`MASTRA_LLM_PROVIDER` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MASTRA_AGENT_MODEL` / `GOOGLE_API_KEY` / `GOOGLE_MASTRA_AGENT_MODEL`）が設定として解決でき、モデル未指定時はベンダー既定値が返る。API キーは secret 扱いになる
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
- FB 反映（commit f67933bc44, 設計改訂 D-10）: タスク 1.3 / 2.2 / 3.2 の当初実装を上書き — (1) per-vendor 設定キーを単一 `mastra:llmProvider`/`mastra:llmApiKey`/`mastra:llmModel` に統一（既定モデルは resolver の map）、(2) resolver を判別共用体から **throw ベース**へ（不備時 throw、`OpenaiClientDelegator` 流儀）、(3) 3.2 の起動時可用性ゲート（routes/index 変更・503）を **revert**（不備時 throw を post-message 既存 catch が処理）。タスクのチェックボックスは完了のまま（成果は最新コミットに反映済み）。
- FB 追加反映（D-11）: (1) `mastra:llmProvider` を inline literal union `'openai'|'anthropic'|'google'` に型付け（import 不要・依存逆転回避）、(2) 既定値 `'openai'`（Req 1.3 を「未指定→既定 OpenAI」に反転、vendor-unset throw 撤去）、(3) `mastra:llmModel` 既定 `'o4-mini'`・型は `string`（ベンダー横断モデル id union は SDK 未 export のため不可）、(4) resolver の `defaultModels` map 撤去（既定は config defaultValue に集約）。`isLlmProvider` は実行時検証として残置（型は実行時強制でないため必須）。
- FB 追加（D-12）: (1) `mastra:llmProvider` を共有 `LlmProvider` 型で定義（`import type`＝実行時に消えるため依存逆転の実害なし・leaf で循環なし・単一ソース）。(2) 未使用化した `openai:assistantModel:mastraAgent`（`OPENAI_MASTRA_AGENT_MODEL`）と、その唯一の利用元だった `openai` 型 import を削除。

## Scope Expansion (Req 6 — provider options via env)
- [x] 6.1 provider options の env 指定と適用
  - `mastra:llmProviderOptions`（`string`・生 JSON・env `MASTRA_LLM_PROVIDER_OPTIONS`・default=現行 OpenAI オプション）を config に追加
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
  - `LLM_PROVIDERS` に `'azure-openai'` を追加する（`LlmProvider` 型・`isLlmProvider` は自動拡張）。識別子は既存の `openai:serviceType` の `'azure-openai'` 値と表記を揃える
  - 観測可能: `isLlmProvider('azure-openai')` が true を返し、`LLM_PROVIDERS` の長さが 4 になる
  - _Requirements: 1.1, 1.4_
  - _Boundary: llm-provider interface_

- [ ] 7.3 Azure 固有の接続設定キー
  - `mastra:llmAzureOpenaiResourceName` / `mastra:llmAzureOpenaiBaseUrl` / `mastra:llmAzureOpenaiApiVersion`（いずれも `string | undefined`・default `undefined`・非 secret）を `CONFIG_KEYS` と `CONFIG_DEFINITIONS` に追加する。API キー・デプロイ名は既存の `mastra:llmApiKey` / `mastra:llmModel` を流用（追加しない）
  - 観測可能: 3 つの新 env（`MASTRA_LLM_AZURE_OPENAI_RESOURCE_NAME` / `MASTRA_LLM_AZURE_OPENAI_BASE_URL` / `MASTRA_LLM_AZURE_OPENAI_API_VERSION`）が config として解決でき、いずれも非 secret
  - _Requirements: 7.1, 7.2, 7.5_
  - _Boundary: config-definition_

- [ ] 7.4 Azure native provider ファクトリ
  - `azure-openai.ts` を新設し、`createAzure` を明示的 API キー注入で生成して `(deploymentName)` を適用する薄いアダプタを実装する。`resourceName`/`baseURL` は排他（baseURL 優先）で渡し、`apiVersion` は設定時のみ付与する
  - **いずれのエンドポイント設定も無い場合はファクトリ内で throw**（欠落 env 名を名指し・API キー値非含）。`AzureOpenaiProviderConfig` 型を定義し、barrel の provider 別引数型マップ（`LlmModelFactoryParams`）に azure-openai 用の引数型を加え、`llmModelFactories` に `'azure-openai': createAzureOpenaiModel` を登録する
  - co-located unit test: resourceName 経路／baseURL 経路／両指定→baseURL 優先／apiVersion 任意／いずれも無い→throw（メッセージにキー値非含）（`@ai-sdk/azure` を mock）
  - 観測可能: 各経路で言語モデルが生成され、排他渡し・throw 分岐がテストで green。`Object.keys(llmModelFactories)` が `LLM_PROVIDERS` と一致
  - _Requirements: 1.2, 7.2, 7.3, 7.4, 7.5_
  - _Boundary: llm-providers_
  - _Depends: 7.1, 7.2_

- [ ] 7.5 resolver の Azure config 受け渡し
  - resolver で Azure 固有 config（resourceName/baseUrl/apiVersion）を読み、**いずれかが非 null のときだけ** `azureOpenai` を factory params に付与する（provider 名で分岐しない／非 Azure の呼び出し形状 `{apiKey, model}` を不変に保つ）
  - co-located unit test 更新: provider=azure-openai で azure 固有 config を収集し factory に `azure` を渡す／azure config 未指定時は `{apiKey, model}` のみ。**「未対応プロバイダ」の例示値（旧 `'azure'`）を真に未対応の値（例 `'cohere'`）へ差し替え**（`'azure-openai'` が有効化されたため）、mock の `llmModelFactories` に azure を追加
  - 観測可能: 既存 resolver テストが green を維持し（非 Azure 経路の呼び出し形状不変）、azure 経路の新ケースが green
  - _Requirements: 1.2, 7.2, 7.6_
  - _Boundary: resolve-mastra-model_
  - _Depends: 7.3, 7.4_

- [ ] 7.6 (P) Azure を含めた回帰・型チェック
  - `pnpm vitest run` で mastra LLM 関連テスト（llm-providers / resolve-mastra-model / llm-provider ガード）が全 green、`pnpm run lint:typecheck` に Azure 由来の新規エラーが無いことを確認する（既存の pre-existing TS2769 は本タスク対象外）
  - 観測可能: 上記テストが green、typecheck の差分が pre-existing 既知エラーのみ
  - _Requirements: 1.1, 7.x_
  - _Boundary: mastra LLM modules（参照のみ）_
  - _Depends: 7.4, 7.5_

## Scope Expansion (Req 8 — Azure OpenAI Entra ID auth)
- [ ] 8. Azure OpenAI の Microsoft Entra ID 認証
- [ ] 8.1 認証方式フラグの config
  - `mastra:llmAzureOpenaiUseEntraId`（`boolean`・default `false`・env `MASTRA_LLM_AZURE_OPENAI_USE_ENTRA_ID`・非 secret）を追加する。`@azure/identity` は既存依存のため追加不要
  - 観測可能: フラグが config として解決でき、未指定時 false
  - _Requirements: 8.1, 8.2_
  - _Boundary: config-definition_

- [ ] 8.2 認証契約を型で表現（provider 別引数型 + ジェネリックディスパッチ）
  - factory 引数を provider ごとに型付け（`LlmModelFactoryParams`）: key-based（openai/anthropic/google）は `apiKey: string` **必須**、azure-openai は `apiKey?: string`。key-based のランタイム null ガードは持たない（型で保証）。resolver は `buildLlmModel<P>(provider, params)`（correlated dispatch・キャストなし）経由で呼ぶ
  - azure-openai factory: `AzureOpenaiProviderConfig` に `useEntraId?` を追加し、真なら `getBearerTokenProvider(new DefaultAzureCredential(), 'https://cognitiveservices.azure.com/.default')` を `tokenProvider` として渡す（apiKey 不使用・`@azure/identity` は static import）。偽なら apiKey（欠落で throw）。エンドポイント検証は両方式共通
  - co-located unit test: Entra ID 経路（tokenProvider を渡し apiKey 非送出・`@azure/identity` は vi.mock で確定化）／apiKey も Entra ID も無い→throw／key-based factory の apiKey 欠落 throw
  - 観測可能: 上記分岐が green（確定的・高速）
  - _Requirements: 8.1, 8.3, 8.4, 8.5_
  - _Boundary: llm-providers（azure-openai, openai, anthropic, google, index）_
  - _Depends: 8.1_

- [ ] 8.3 resolver の apiKey 必須チェック緩和
  - `useEntraId` を読み、`apiKey == null && !useEntraId` のときだけ throw に緩和する（provider 名ではなく config フラグで分岐）。`azureOpenai` には `useEntraId` を**有効時のみ**付与し、非破壊（API キー経路の呼び出し形状を不変に保つ）
  - co-located unit test: provider=azure-openai + useEntraId + apiKey 無し→throw せず `useEntraId: true` を付与／既存の apiKey 欠落 throw（非 Entra ID）は維持
  - 観測可能: 上記が green、既存テスト不変
  - _Requirements: 8.3, 8.4_
  - _Boundary: resolve-mastra-model_
  - _Depends: 8.1, 8.2_
