# Implementation Plan

- [ ] 1. 基盤: 共有コントラクトと i18n
- [ ] 1.1 選択可能モデル一覧の応答コントラクトを定義する
  - server/client 共有の応答型 `SelectableModelsResponse`（`modelIds: string[]` のみ）を interfaces に追加する
  - providerOptions/apiKey などの秘匿情報をフィールドに含めない（modelId 情報のみ）
  - 完了状態: 型が server ルートと client フックの双方から import 可能で、`modelIds: string[]` 以外のフィールドを持たない
  - _Requirements: 1.1, 7.1_

- [ ] 1.2 (P) モデル選択 UI 文言を全ロケールに追加する
  - モデル選択プレースホルダ等の新規キーを 5 ロケール（en_US/ja_JP/fr_FR/ko_KR/zh_CN）の admin.json に追加する
  - 完了状態: 5 ロケール全てに同一キーが存在し、欠落キーによる i18n フォールバック警告が出ない
  - _Requirements: 1.1_
  - _Boundary: locales admin.json_

- [ ] 2. ビルド/リリース時の vendoring パイプライン（コミット成果物の生成）
- [ ] 2.1 (P) chat/ツール対応モデルの判定（純関数）を実装する
  - 対象プロバイダ（openai/anthropic/google、azure-openai は models.dev 非収録で対象外）を宣言データにする
  - `isSelectableModel(entry) = tool_call===true && modalities.output に text を含む` を純関数で実装（models.dev の権威的フィールドで判定、名前 heuristic は使わない）
  - 完了状態: `tool_call:true & output:['text']` を通し、`tool_call:false` や `output:['image']` 等を除外する単体テストが green。対象プロバイダに azure-openai を含まない
  - _Requirements: 6.1, 6.2_
  - _Boundary: chat-model-filter_

- [ ] 2.2 models.dev から取り込む vendoring スクリプトとコミット成果物を作成する
  - `pnpm vendor:models` で `https://models.dev/api.json` を fetch（**build/release 時のみ**）→ 対象プロバイダ選択 → `isSelectableModel` で**生成時フィルタ** → **id のみ**を `provider → string[]` に整形 → 決定的（ソート）に `model-catalog-data.json` を書き出す（`_source`(MIT帰属)/`_generatedAt` 付与）
  - cross-platform（Node の fetch/fs のみ、curl/rm 不使用）。fetch 失敗時は非ゼロ終了し既存成果物を保持
  - 初回生成した `model-catalog-data.json` をコミットする
  - 完了状態: `pnpm vendor:models` 実行で、chat＋tool 対応の id のみを含む3プロバイダ分の JSON が生成・コミットされ、fixture の api.json を入力にした変換テストが期待どおり（`tool_call:false` 系が含まれない）green
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 6.1_
  - _Depends: 2.1_
  - _Boundary: vendor-model-catalog, model-catalog-data.json_

- [ ] 3. サーバ実行時の読み取りとエンドポイント
- [ ] 3.1 コミット成果物からモデル一覧を返す読み取りサービスを実装する
  - `getSelectableModelIds(provider)` がコミット済み `model-catalog-data.json` を静的 read し `provider` の配列を返す。**ネットワーク I/O なし**、カタログ非対応プロバイダは空配列
  - 完了状態: コミット成果物をもとに openai が非空・azure-openai が空を返し、実行時にネットワーク呼び出しが発生しないことを単体テストで確認できる
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 3.1_
  - _Depends: 2.2_
  - _Boundary: model-catalog_

- [ ] 3.2 available-models エンドポイントを公開し admin ルータに接続する
  - 管理者認可チェーン（read:admin:ai スコープ + login + admin）配下で、プロバイダをクエリに取り選択可能モデル一覧を返すエンドポイントを追加し admin ルータに mount する
  - プロバイダ値を allow-list 検証し不正なら 400、未収録プロバイダは空一覧、応答は modelId のみ（秘匿情報なし）
  - 完了状態: 非管理者は 401/403、`?provider=openai` は非空 modelIds、`?provider=azure-openai` は空、不正 provider は 400、応答に apiKey/providerOptions を含まないことを統合テストで確認できる
  - _Requirements: 1.1, 3.1, 7.1, 7.2_
  - _Depends: 3.1, 1.1_
  - _Boundary: get-available-models, admin-ai-settings router_

- [ ] 4. クライアントのモデル一覧取得
- [ ] 4.1 (P) 選択可能モデル取得フックを実装する
  - 設定中プロバイダをキーに一覧を取得する immutable なデータフックを追加する。プロバイダ未選択時は取得しない。プロバイダ変更で自動再取得する
  - 完了状態: プロバイダ空でフェッチが発生せず、プロバイダ変更でキーが変わり再取得されることをフックのテストで確認できる
  - _Requirements: 1.1, 3.2, 5.1, 5.2_
  - _Depends: 1.1_
  - _Boundary: useSWRxSelectableModels_

- [ ] 5. 管理画面のモデル入力 UI
- [ ] 5.1 許可モデル入力を選択式と自由入力で出し分ける
  - 許可モデル行の modelId 入力を、カタログがあるプロバイダでは選択のみのドロップダウン（選択肢＝生成時に絞られた集合）、azure-openai・未選択・取得失敗時は自由入力にする
  - 保存済みだが現一覧に無い modelId は選択済みとして保持し、勝手に変更しない
  - 環境変数専用モードの読み取り専用挙動、既定ラジオ・providerOptions・追加/削除は現行のまま
  - 完了状態: openai でドロップダウン描画・azure で自由入力・取得失敗で自由入力フォールバック・一覧外の保存済み値の保持・env-only で編集不可、をコンポーネントテストで確認できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 5.1, 5.2, 7.3_
  - _Depends: 4.1, 1.2_
  - _Boundary: AllowedModelsField_

- [ ] 6. リリース連動と検証
- [ ] 6.1 vendoring をリリース(RC/本番)パイプラインに組み込む
  - リリース(RC/本番)ワークフローに「`vendor:models` 実行 → 成果物に差分があればコミット/PR → その後 build」の順でステップを差し込む。**build 自体はコミット済み成果物を read し、build 中に live fetch しない**（毎ビルド fetch＝非決定的・オフライン不可を避ける）
  - 完了状態: リリースワークフローに refresh ステップが存在し、ビルドがコミット済み `model-catalog-data.json` を消費する（build task graph には fetch を組み込まない）ことを確認できる
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.2_

- [ ] 6.2 実行時の通信ゼロと既存挙動の不変を確認する
  - 一覧提供経路が実行時に外部通信を発生させないこと（成果物 read のみ）を確認する
  - 保存経路（単一 isDefault・providerOptions JSON 検証）、モデル解決の allow-list 検証、チャット側モデル一覧、AI 有効判定が変わっていないことを既存テストで確認する
  - 完了状態: 実行時にネットワーク通信が発生せず、既存の mastra 関連テストスイートが green で保存・推論・チャット UI に差分がない
  - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4_
  - _Depends: 3.2, 5.1_

- [ ] 7. スペック整合更新
- [ ] 7.1 (P) mastra-multi-model-chat スペックを整合させる
  - 「モデル一覧取得の仕組みは設けない／許可モデルは管理者が手入力する」という要件・設計の記述を、オフライン vendored カタログに基づく選択方式の採用へ更新する
  - 完了状態: 当該スペックの requirements/design に手入力前提の記述が残らず、vendored カタログ選択方式の採用が明記されている
  - _Requirements: 8.1_
  - _Boundary: spec mastra-multi-model-chat_

- [ ] 7.2 (P) multi-llm-provider スペックを整合させる
  - research の D-2/D-3 に、models.dev の runtime fetch（モデルルーター）は不採用のまま／build・release 時に vendoring した静的カタログの read は別物であり推論は native 実装のまま、という注記を追加する
  - 完了状態: 当該 research に「runtime fetch 不採用」と「vendored 静的 read は別物」の区別を示す注記が存在する
  - _Requirements: 8.2_
  - _Boundary: spec multi-llm-provider_

- [ ] 7.3 スペック間の矛盾がないことを確認する
  - 関連スペック間でモデル入力方式に関する矛盾記述が残っていないことを確認する
  - 完了状態: mastra-multi-model-chat / multi-llm-provider / ai-settings-model-picker の間にモデル入力方式の矛盾記述がない
  - _Requirements: 8.3_
  - _Depends: 7.1, 7.2_
