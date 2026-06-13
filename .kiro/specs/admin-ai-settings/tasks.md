# Implementation Plan

- [ ] 1. Foundation: 共有型・スコープ・設定・監査アクションの整備
- [x] 1.1 (P) `admin:ai` スコープを @growi/core に追加
  - `SCOPE_SEED_ADMIN` に `ai` を追加し、`ReadAdminScope` / `WriteAdminScope` の型 union に `read:admin:ai` / `write:admin:ai` を追加
  - `SCOPE.READ.ADMIN.AI` / `SCOPE.WRITE.ADMIN.AI` が解決でき、既存スコープのテストが緑のまま
  - _Requirements: 1.2_
  - _Boundary: core scope_

- [x] 1.2 (P) 環境変数専用モードの宣言を AI 設定グループに追加
  - 制御キー `env:useOnlyEnvVars:ai`(env 変数 `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS`、default false)を `CONFIG_KEYS` + `CONFIG_DEFINITIONS` に追加
  - `ENV_ONLY_GROUPS` に `app:aiEnabled` + `ai:*` 8 キーの計 9 キーを対象とするグループを追加
  - 単体テスト: 制御キー true で 9 キーが env 値のみ、false で `db ?? env`、`ai:*` 以外のキーの解決は不変
  - _Requirements: 4.1, 4.4_
  - _Boundary: config-definition_

- [x] 1.3 (P) AI 設定更新の監査アクションを追加
  - `ACTION_ADMIN_AI_SETTING_UPDATE` を定義し `SupportedAction` に登録(既存 `ACTION_ADMIN_APP_SETTING_UPDATE` と同形)
  - アクション定数が `AllSupportedActions` に含まれることをテストで確認
  - _Requirements: 2.3_
  - _Boundary: activity interfaces_

- [x] 1.4 (P) AI 設定の DTO と編集対象キー一覧を定義
  - 取得/更新の DTO(有効/無効・provider・model・providerOptions・azure 4 項目・`isApiKeySet`・`useOnlyEnvVars`・`isConfigured`、更新は apiKey を含む)を型定義
  - 編集対象キー一覧(`AI_SETTING_KEYS`)を定義し server/client から参照可能にする
  - 型が `tsc` を通り、サーバー・クライアント双方から import 可能
  - _Requirements: 1.4, 2.1, 7.1_
  - _Boundary: mastra interfaces_

- [ ] 2. サーバーコア: モデルキャッシュ無効化・利用可否判定・伝播・ゲート
- [x] 2.1 (P) Mastra モデルのキャッシュ破棄関数を追加
  - メモ化されたモデルを破棄する関数を `resolve-mastra-model` に追加・export(メモ自体は維持)
  - 破棄後の次回解決で最新 config から再構築されることを単体テストで確認
  - _Requirements: 2.4_
  - _Boundary: resolve-mastra-model_

- [x] 2.2 (P) AI 設定済み判定と利用可否判定を追加
  - `isAiConfigured()` を `resolveMastraModel()` の try/catch ラップで実装(成功=true、throw=false)、`isAiReady() = isAiEnabled() && isAiConfigured()`
  - 単体テスト: provider 未設定/必須項目欠落で false、provider 別に必須が揃うと true、`isAiEnabled=false` で `isAiReady=false`、`resolveMastraModel` 成否との一致
  - _Requirements: 7.2, 7.3_
  - _Boundary: is-ai-configured_

- [x] 2.3 設定更新の他インスタンス伝播でキャッシュを破棄
  - `configUpdated` を購読する S2S ハンドラを追加し、受信時にモデルキャッシュを破棄。crowi の S2S セットアップに登録
  - 他インスタンスでの設定更新通知受信後、モデルが再構築されることを確認
  - _Requirements: 2.4_
  - _Depends: 2.1_
  - _Boundary: model-config-sync, crowi S2S setup_

- [x] 2.4 mastra ルートゲートをリクエスト毎の利用可否判定へ置換
  - 起動時固定ゲート(`isAiEnabled()` の factory 時評価)を撤去し、`isAiReady()` を毎リクエスト評価する guard ミドルウェアを適用(未 ready で 501、無効と設定不備をメッセージで区別)
  - 統合テスト: 有効かつ未設定で 501、両者揃うと通過、設定変更後に再起動なしで判定が切り替わる
  - _Requirements: 7.2, 7.3, 7.5_
  - _Depends: 2.2_
  - _Boundary: mastra routes (ai-ready-guard, routes factory)_

- [ ] 3. サーバー API: AI 設定の取得/更新エンドポイント
- [x] 3.1 (P) 入力検証ルールを実装
  - provider がサポート対象のみ、`providerOptions` は非空時 JSON として解釈可能、boolean 項目の型検証
  - 単体テスト: 不正 provider と不正 JSON を検出、正常値を通過
  - _Requirements: 6.1, 6.2_
  - _Depends: 1.4_
  - _Boundary: ai-settings validators_

- [x] 3.2 取得エンドポイントを実装
  - 現在有効な設定値を返す。`ai:apiKey` の値は返さず `isApiKeySet` のみ、`useOnlyEnvVars` / `aiEnabled` / `isConfigured` を併せて返す
  - 統合テスト: apiKey 値が応答に含まれず、`isApiKeySet` / `useOnlyEnvVars` / `aiEnabled` / `isConfigured` が状態に応じて正しい
  - _Requirements: 1.4, 4.2, 5.2, 7.1, 7.6_
  - _Depends: 1.2, 1.4, 2.2_
  - _Boundary: get-ai-settings handler_

- [x] 3.3 更新エンドポイントを実装
  - 検証通過後に設定を永続化。文字列項目は空文字を未設定として削除(env フォールバックへ)、boolean は常に保存、apiKey は空/未指定で既存保持。環境変数専用モード有効時は更新を拒否(422)。保存成功でモデルキャッシュを破棄し監査アクションを発火。エラーメッセージに機密値を含めない
  - 統合テスト: 正常保存で値反映+キャッシュ破棄+監査発火、env 専用モードで 422、apiKey 未指定で既存保持、空文字項目が env フォールバックに戻る
  - _Requirements: 2.3, 4.3, 4.4, 5.3, 6.3, 7.1_
  - _Depends: 1.2, 1.3, 1.4, 2.1, 3.1_
  - _Boundary: put-ai-settings handler_

- [x] 3.4 ルータを組み立て管理者ルートに登録
  - 取得/更新ハンドラを 1 つのルータに集約し、`admin:ai` スコープ + 管理者認可を適用して管理者用 apiv3 にマウント(AI 無効時も到達可能、`isAiEnabled` ゲートは付けない)
  - 統合テスト: 管理者は GET/PUT 可、非管理者は 403、エンドポイントが管理者ルート配下で応答
  - _Requirements: 1.1, 1.2_
  - _Depends: 1.1, 3.2, 3.3_
  - _Boundary: admin-ai-settings router, apiv3 admin 登録_

- [ ] 4. クライアント UI: AI 設定画面
- [x] 4.1 (P) 設定の取得・保存フックを実装
  - 取得 API を購読する SWR フックと、更新 API を呼ぶ保存関数(成功/失敗のハンドリング、再検証)を提供
  - フックが取得値を返し、保存関数が更新 API を呼んで再検証をトリガする
  - _Requirements: 1.4, 2.3, 6.3_
  - _Depends: 1.4, 3.4_
  - _Boundary: use-ai-settings_

- [x] 4.2 (P) 設定セクションコンポーネント群を実装
  - 有効化トグル / プロバイダー共通設定(provider 選択肢は対象のみ・apiKey はマスク入力・model・providerOptions の JSON クライアント検証)/ Azure 専用設定(`azure-openai` 選択時のみ表示、Entra ID 時は apiKey 不使用を明示、model はデプロイメント名と案内)/ 環境変数専用モードの通知アラート
  - 各コンポーネントが `useOnlyEnvVars` 連動で readOnly/disabled になり、Azure セクションは非 azure 時に非表示、apiKey 欄がマスク表示される
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 4.2, 5.1, 6.2, 7.1_
  - _Depends: 1.4_
  - _Boundary: client section components_

- [x] 4.3 設定画面コンテナを実装
  - セクションを統合し、フォーム一括保存(トグル含む)・成功/失敗トースト・保存失敗時の入力保持・provider に応じた Azure セクション表示・「有効だが未設定」警告(`aiEnabled && !isConfigured`)を制御
  - コンポーネントテスト: 保存でトースト表示+失敗時に入力保持、env 専用モードで全項目 disabled+通知、未設定警告の表示/非表示、azure 選択での Azure セクション表示
  - _Requirements: 1.1, 2.3, 6.2, 6.3, 7.6_
  - _Depends: 4.1, 4.2_
  - _Boundary: AiSettings container_

- [ ] 5. 統合: ページ・ナビゲーション・サイドバー導線・i18n
- [x] 5.1 管理ページとナビゲーション項目を追加
  - `/admin/ai` ページ(SSR 不要の動的読み込み + 管理共通レイアウト)を追加し、管理ナビゲーションに AI 設定項目を追加
  - 管理者が `/admin/ai` で設定画面に到達でき、ナビに AI 設定項目が表示される
  - _Requirements: 1.1, 1.3_
  - _Depends: 4.3_
  - _Boundary: admin ai page, AdminNavigation_

- [ ] 5.2 (P) サイドバー導線を利用可否に整合
  - 一般ページのサーバー供給値を「AI が有効かつ設定済み」由来へ変更し、クライアントの AI 導線表示判定に反映
  - 設定不備/無効時に(次回読み込み以降)サイドバーの AI 導線が表示されない
  - _Requirements: 7.4_
  - _Depends: 2.2_
  - _Boundary: general-page configuration-props_

- [ ] 5.3 (P) 翻訳リソースを追加
  - AI 設定画面の各ラベル・Azure/Entra ID/デプロイメント名の案内・環境変数専用モード通知・未設定警告・ナビ項目・スコープ説明を 5 ロケールに追加
  - 5 ロケールで対応キーが揃い、未翻訳キーによるフォールバック表示がない
  - _Requirements: 1.3, 3.3, 3.4, 4.2, 7.6_
  - _Boundary: locales (admin.json, accesstoken_scopes_desc)_

- [ ] 6. 検証: 横断結合と回帰・品質ゲート
- [ ] 6.1 横断結合テストと回帰確認、品質ゲートを実行
  - 環境変数専用モードの end-to-end(制御フラグ有効 → 取得で `useOnlyEnvVars` true → 更新が 422)、再起動なし反映(provider 更新 → 次の AI 要求でゲート判定が 501→通過へ遷移)、回帰(`ai:*` 以外の env-only キーが影響を受けない、`isAiConfigured` と `resolveMastraModel` の判定一致)を確認
  - `@growi/app` と `@growi/core` で lint / typecheck / test が緑
  - _Requirements: 4.1, 7.2, 7.3, 7.5_
  - _Depends: 2.4, 3.4, 5.2_

## Implementation Notes
- 1.1 added `admin:ai` to `@growi/core` source, but `packages/core/dist` is **gitignored** and was stale. Any consumer of `SCOPE.READ/WRITE.ADMIN.AI` (e.g. task 3.4) needs `turbo run build --filter @growi/core` locally before `lint:typecheck` passes. CI handles this via turbo build ordering.
- crowi/index.ts and config-manager.spec.ts carry pre-existing biome warnings (type aliases `= any`, non-null assertions, default export, async-without-await on legacy test callbacks). These are outside feature boundaries; biome `--diagnostic-level=error` does not fail on them.
- 4.2 referenced i18n keys (namespace `admin`, prefix `ai_settings.`) that task 5.3 must define in all 5 locales: `ai_enabled_label`, `api_key_label`, `api_key_help`, `api_key_set_placeholder`, `model_label`, `provider_label`, `provider_placeholder`, `provider_options_label`, `provider_options_invalid_json`, `env_only_mode_notice`, `azure_resource_name_label`, `azure_base_url_label`, `azure_api_version_label`, `azure_use_entra_id_label`, `azure_entra_id_api_key_note`, `azure_model_deployment_note`. Task 4.3 (container) and 5.1 (nav) will add more (e.g. save button, page/nav label, unconfigured warning) — 5.3 should sweep all referenced keys.
