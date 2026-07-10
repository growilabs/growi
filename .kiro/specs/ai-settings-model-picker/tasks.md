# Implementation Plan

- [ ] 1. 基盤: 共有コントラクトと i18n
- [x] 1.1 選択可能モデル一覧の応答コントラクトを定義する
  - server/client 共有の応答型 `SelectableModelsResponse`（`models: SelectableModel[]` のみ。`SelectableModel = {id,name}`）を interfaces に追加する
  - providerOptions/apiKey などの秘匿情報をフィールドに含めない（id と公式表示名のみ）
  - 完了状態: 型が server ルートと client フックの双方から import 可能で、`models: SelectableModel[]` 以外のフィールドを持たない
  - _Requirements: 1.1, 7.1_

- [x] 1.2 (P) モデル選択 UI 文言を全ロケールに追加する
  - モデル選択プレースホルダ等の新規キーを 5 ロケール（en_US/ja_JP/fr_FR/ko_KR/zh_CN）の admin.json に追加する
  - 完了状態: 5 ロケール全てに同一キーが存在し、欠落キーによる i18n フォールバック警告が出ない
  - _Requirements: 1.1_
  - _Boundary: locales admin.json_

- [ ] 2. 取り込みステップ（リリース前段）の vendoring パイプライン（コミット成果物の生成）
- [x] 2.1 (P) chat/ツール対応モデルの判定（純関数）を実装する
  - 対象プロバイダ（openai/anthropic/google、azure-openai は models.dev 非収録で対象外）を `AI_PROVIDER_DEFS` の `enumerable` フラグから導出する（`CATALOG_PROVIDERS`。宣言データを単一ソース化し別リストとのドリフトを防ぐ）
  - `isSelectableModel(entry) = tool_call===true && modalities.output に text を含む` を純関数で実装（models.dev の権威的フィールドで判定、名前 heuristic は使わない）
  - 完了状態: `tool_call:true & output:['text']` を通し、`tool_call:false` や `output:['image']` 等を除外する単体テストが green。対象プロバイダに azure-openai を含まない
  - _Requirements: 6.1, 6.2_
  - _Boundary: chat-model-filter_

- [x] 2.2 models.dev から取り込む vendoring スクリプトとコミット成果物を作成する
  - `pnpm vendor:models` で `https://models.dev/api.json` を fetch（**取り込みステップ＝リリース前段でのみ／ビルド工程・実行時では fetch しない**）→ 対象プロバイダ選択 → `isSelectableModel` で**生成時フィルタ** → **`{id,name}`**（id と公式表示名。`name` 欠落時は id フォールバック）を `models.<provider> = {id,name}[]` に整形し、`{ _source(MIT帰属), _generatedAt, models }` の形（ヘッダとデータを分離）で決定的（id でソート）に `model-catalog-data.json` を書き出す
  - cross-platform（Node の fetch/fs のみ、curl/rm 不使用）。fetch 失敗時は非ゼロ終了し既存成果物を保持
  - **生成時サニティチェック（Issue 2）**: 取得 JSON を境界で最小スキーマ検証（`providers`/`models` 構造・`tool_call`/`modalities.output` の型）し、**各対象プロバイダ（openai/anthropic/google）で選択可能1件以上**を assert。違反（想定外の形・空結果）なら**非ゼロ終了して既存成果物を保持**（上書きしない）＝スキーマドリフトによる「無言の空カタログ」出荷を防止。欠落内容（プロバイダ名・件数）をログ出力
  - 初回生成した `model-catalog-data.json` をコミットする
  - 完了状態: `pnpm vendor:models` 実行で、chat＋tool 対応の `{id,name}` を含む3プロバイダ分の JSON が生成・コミットされ、fixture の api.json を入力にした変換テストが期待どおり（`tool_call:false` 系が含まれない・`name` 欠落時は id フォールバック）green。加えて、想定外スキーマ／いずれかの対象プロバイダが0件になる fixture で**非ゼロ終了し既存成果物を上書きしない**ことを確認できる
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 6.1_
  - _Depends: 2.1_
  - _Boundary: vendor-model-catalog, model-catalog-data.json_

- [ ] 3. サーバ実行時の読み取りとエンドポイント
- [x] 3.1 コミット成果物からモデル一覧を返す読み取りサービスを実装する
  - `getSelectableModels(provider)` がコミット済み `model-catalog-data.json` を静的 read し `provider` の `{id,name}[]` を返す。**ネットワーク I/O なし**、カタログ非対応プロバイダは空配列
  - 完了状態: コミット成果物をもとに openai が非空・azure-openai が空を返し、実行時にネットワーク呼び出しが発生しないことを単体テストで確認できる
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 3.1_
  - _Depends: 2.2_
  - _Boundary: model-catalog_

- [x] 3.2 available-models エンドポイントを公開し admin ルータに接続する
  - 管理者認可チェーン（read:admin:ai スコープ + login + admin）配下で、プロバイダをクエリに取り選択可能モデル一覧を返すエンドポイントを追加し admin ルータに mount する
  - プロバイダ値を allow-list 検証し不正なら 400、未収録プロバイダは空一覧、応答は id と公式表示名のみ（秘匿情報なし）
  - 完了状態: 非管理者は 401/403、`?provider=openai` は非空 `models`（各要素 `{id,name}`）、`?provider=azure-openai` は空、不正 provider は 400、応答に apiKey/providerOptions を含まないことを統合テストで確認できる
  - _Requirements: 1.1, 3.1, 7.1, 7.2_
  - _Depends: 3.1, 1.1_
  - _Boundary: get-available-models, admin-ai-settings router_

- [ ] 4. クライアントのモデル一覧取得
- [x] 4.1 (P) 選択可能モデル取得フックを実装する
  - 設定中プロバイダをキーに一覧を取得する immutable なデータフックを追加する。プロバイダ未選択時は取得しない。プロバイダ変更で自動再取得する
  - 完了状態: プロバイダ空でフェッチが発生せず、プロバイダ変更でキーが変わり再取得されることをフックのテストで確認できる
  - _Requirements: 1.1, 3.2, 5.1, 5.2_
  - _Depends: 1.1_
  - _Boundary: useSWRxSelectableModels_

- [ ] 5. 管理画面のモデル入力 UI
- [x] 5.1 許可モデル入力を選択式と自由入力で出し分ける
  - 許可モデル行の modelId 入力を、カタログがあるプロバイダでは選択のみのドロップダウン（選択肢＝生成時に絞られた集合）、azure-openai・未選択・取得失敗時は自由入力にする
  - 保存済みだが現一覧に無い modelId は選択済みとして保持し、勝手に変更しない
  - 環境変数専用モードの読み取り専用挙動、既定ラジオ・providerOptions・追加/削除は現行のまま
  - 完了状態: openai でドロップダウン描画・azure で自由入力・取得失敗で自由入力フォールバック・一覧外の保存済み値の保持・env-only で編集不可、をコンポーネントテストで確認できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 5.1, 5.2, 7.3_
  - _Depends: 4.1, 1.2_
  - _Boundary: AllowedModelsField_

- [ ] 6. リリース連動と検証
- [x] 6.1 vendoring をリリースビルドの前段の独立 step として実行する
  - リリースビルドの**前段の独立 step**で `pnpm vendor:models` を実行し、成果物（`model-catalog-data.json`）を（差分があれば）ブランチにコミットする。**リリースビルドはコミット済み成果物を read するだけ**で、refresh/fetch/commit を build 工程に融合しない（毎ビルド fetch＝非決定的・オフライン不可を避ける）
  - 配置: 人手 trigger の prod/タグリリースは「リリースを切る前の pre-release step（手動でも可）」で `vendor:models` を実行し成果物をリリース commit に同梱する。無人の scheduled RC（`release-rc-scheduled.yml`）はコミット済み成果物をそのまま read して build する（RC 側で refresh/commit は行わない）。オンデマンド更新は手動 `pnpm vendor:models` → PR
  - 完了状態: refresh step がリリースビルドより**厳密に前**に実行され成果物をコミットし、build 工程に fetch/commit が一切含まれない（build はコミット済み `model-catalog-data.json` を read するのみ）ことを確認できる
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.2_

- [x] 6.2 実行時の通信ゼロと既存挙動の不変を確認する
  - 一覧提供経路が実行時に外部通信を発生させないこと（成果物 read のみ）を確認する
  - 保存経路（単一 isDefault・providerOptions JSON 検証）、モデル解決の allow-list 検証、チャット側モデル一覧、AI 有効判定が変わっていないことを既存テストで確認する
  - 完了状態: 実行時にネットワーク通信が発生せず、既存の mastra 関連テストスイートが green で保存・推論・チャット UI に差分がない
  - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4_
  - _Depends: 3.2, 5.1_

- [ ] 7. スペック整合更新
- [x] 7.1 (P) mastra-multi-model-chat スペックを整合させる
  - 「モデル一覧取得の仕組みは設けない／許可モデルは管理者が手入力する」という要件・設計の記述を、オフライン vendored カタログに基づく選択方式の採用へ更新する
  - 完了状態: 当該スペックの requirements/design に手入力前提の記述が残らず、vendored カタログ選択方式の採用が明記されている
  - _Requirements: 8.1_
  - _Boundary: spec mastra-multi-model-chat_

- [x] 7.2 (P) multi-llm-provider スペックを整合させる
  - research の D-2/D-3 に、models.dev の runtime fetch（モデルルーター）は不採用のまま／取り込みステップ（リリース前段）で vendoring した静的カタログの read は別物であり推論は native 実装のまま、という注記を追加する
  - 完了状態: 当該 research に「runtime fetch 不採用」と「vendored 静的 read は別物」の区別を示す注記が存在する
  - _Requirements: 8.2_
  - _Boundary: spec multi-llm-provider_

- [x] 7.3 スペック間の矛盾がないことを確認する
  - 関連スペック間でモデル入力方式に関する矛盾記述が残っていないことを確認する
  - 完了状態: mastra-multi-model-chat / multi-llm-provider / ai-settings-model-picker の間にモデル入力方式の矛盾記述がない
  - _Requirements: 8.3_
  - _Depends: 7.1, 7.2_

- [ ] 9. 追補 R: カタログのリフレッシュ（PR #11383 レビューFB 対応）
- [x] 9.1 共有純変換を src へ抽出し ingest script を薄いラッパーにする
  - `buildModelCatalog`＋zod 境界検証＋`MODELS_DEV_URL`/帰属を `build-model-catalog.ts`（src）へ移設し、`bin/vendor-model-catalog.ts` は fetch→変換→write のラッパーのみにする。純変換テストは src 側 spec へ移設
  - 完了状態: ingest script と refresh サービスが同一の変換・サニティチェックを import し、`pnpm vendor:models` と両 spec が green
  - _Requirements: 6.1, 9.1_
  - _Boundary: build-model-catalog, vendor-model-catalog_
- [x] 9.2 更新済みカタログの永続化と effective read を実装する
  - `RefreshedModelCatalog` singleton collection（`{ models, fetchedAt, source }`。`models` は `provider→{id,name}[]`）と `getEffectiveSelectableModels(provider)`（更新済み／同梱の**新しい方**を採用。同梱が厳密に新しい場合のみ同梱優先＝イメージ更新後の stale スナップショット覆い隠し防止。無ければ同梱、9.5）を追加し、`get-available-models` を effective read に切替える
  - 完了状態: 更新済みが新しければそれを返し、同梱が新しければ同梱を返し、なしで同梱へフォールバック、azure は `[]`、read パスに外部通信がないことを単体テストで確認できる
  - _Requirements: 9.4, 9.5, 2.1, 3.1_
  - _Boundary: refreshed-model-catalog, effective-model-catalog, get-available-models_
- [x] 9.3 refresh サービスと管理画面からの手動更新を実装する
  - `refreshModelCatalog()`（固定 URL fetch→共有変換→upsert、失敗時は永続化前に throw）、`POST /ai-settings/refresh-model-catalog`（WRITE スコープ + admin）、`AllowedModelsField` の更新ボタン（確認モーダル→apiv3Post→invalidate→toast。env-only でも有効）、i18n キー×5 ロケールを追加
  - 完了状態: 統合テストで admin 200 `{ fetchedAt, counts }`・失敗 500（内部非漏洩）・非 admin/未認証拒否、UI テストでボタン→確認モーダル→POST→invalidate→toast・キャンセル時は通信ゼロ・失敗フォールバック・env-only で enabled を確認できる
  - _Requirements: 9.1, 9.4, 9.7, 7.1_
  - _Boundary: refresh-model-catalog, post-refresh-model-catalog, admin-ai-settings router, AllowedModelsField, locales admin.json_
- [x] 9.4 起動時・定期リフレッシュの配線を実装する（AI 有効時のみ作動）
  - 設定キー `ai:modelCatalogRefreshOnStartup`（既定 `false`）/ `ai:modelCatalogRefreshCronSchedule`（**既定 `'0 4 * * *'`**＝日次。空文字で無効化）を追加し、`model-catalog-refresh-jobs`（両トリガとも先頭で `isAiEnabled()` ゲート／cron: AI 有効かつ schedule 設定時のみ・invalid でも boot 非破壊／startup: AI 有効かつ opt-in・fire-and-forget）を crowi の `setupCron()` / `asyncAfterExpressServerReady()` に配線する
  - 完了状態: **AI 無効なら cron/startup とも no-op（外部通信ゼロ）**、schedule 未設定/空でも no-op、AI 有効かつ設定時に schedule/起動時リフレッシュが発火し、失敗しても boot・稼働を壊さないことを単体テストで確認できる
  - _Requirements: 9.2, 9.3, 9.4, 9.6_
  - _Boundary: config-definition, model-catalog-refresh-jobs, crowi/index.ts_

## Implementation Notes

- 1.2: i18n プレースホルダの確定キーは `ai_settings.model_placeholder`（既存 `provider_placeholder` に倣う）。design/research では例示的に `model_select_placeholder` と表記されているが、実装・タスク 5.1 が参照するのは `model_placeholder`。5.1 の `<select>` 空 option プレースホルダはこのキーを使うこと。
- プロセス（重要）: **vitest は型チェックしない**。TS 系タスクは完了前に必ず `apps/app` で `pnpm run lint:typecheck`（tsgo）を実行すること。2.1 で `CATALOG_PROVIDERS.includes('azure-openai')` の TS2345 が vitest green のまますり抜けた（後に 5728dab62e で修正）。`out/tsconfig.json` の TSConfck 警告は既存ノイズで無関係。
- 2.2: bin スクリプトは `node bin/*.ts`（Node24 型ストリップ）で実行。bin/ から `src/` の TS を import する際は**明示的 `.ts` 拡張子が必須**（extensionless は ERR_MODULE_NOT_FOUND）。bin/ は `lint:import-convention`（src のみ走査）対象外なので `.ts` は許容。実行時・ビルド工程は fetch せず、この取り込みスクリプトのみが models.dev へ fetch する。成果物 `model-catalog-data.json` は静的 JSON として commit 済み（openai=41/anthropic=24/google=16）。
- 6.1: リリースワークフロー配線は**この環境では CI 実行できず、YAML 妥当性＋構造インスペクションでのみ検証済み**。prod=`release.yml` の `create-github-release` 内で tag commit の前に `vendor:models`（`continue-on-error`）を実行し、成果物をリリース commit に同梱する。無人 RC（`release-rc-scheduled.yml`）はコミット済み成果物から build するのみ（RC 側で refresh/commit は行わない）。オンデマンド更新は手動 `pnpm vendor:models` → PR。build（`reusable-app-build-image.yml`）は不変（read-only 維持）。本番投入前に prod リリースワークフローの人手 CI ドライラン（例: workflow_dispatch）を推奨。
- 9.x: `vendor:models` は `node --import ./bin/dev-esm-resolver.mjs` 経由で起動する（src 側共有変換が `~/` エイリアス・extensionless import を含むため。plain `node bin/*.ts` は ERR_MODULE_NOT_FOUND）。更新済みカタログは config-manager ではなく専用 collection `mastra_refreshed_model_catalog`（設定ではなくキャッシュ・多インスタンス共有）。管理画面の更新ボタンは env-only モードでも有効（カタログは設定ではない。env-only 運用の GROWI.cloud が主対象）。
- プロセス（重要）: **新規 MongoDB モデルは Mongoose ではなく Prisma で作成する**（schema.prisma にモデル追加＋`Prisma.defineExtension` で statics 相当を実装し `createPrisma()` に連結。`external-account.ts` パターン準拠）。`RefreshedModelCatalog` は Prisma-first（新規 collection・二次 index なしのため Mongoose schema 登録も不要）。schema.prisma 変更後は `pnpm prisma generate` の実行が必要。
