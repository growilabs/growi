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

- [ ] 2. コア: サーバの外部通信なしモデルカタログ
- [ ] 2.1 (P) チャット用途フィルタを実装する
  - 非チャットモデル（埋め込み・画像・tts・whisper・dall-e・moderation・realtime・audio・transcribe 等）の除外パターンを単一の宣言データとして定義し、純関数で判定する
  - 判別できないモデルは除外しない（過剰除外を避ける）
  - 完了状態: `text-embedding-3-small`/`dall-e-3`/`gpt-image-1`/`whisper-1` は除外、`gpt-4o`/`o3`/`claude-*`/`gemini-2.5-flash` は通過する単体テストが green
  - _Requirements: 6.1, 6.2_
  - _Boundary: chat-model-filter_

- [ ] 2.2 プロバイダスコープのモデルカタログ読み取りを実装する
  - 設定中プロバイダのモデル一覧を同梱静的レジストリから取得し（外部通信なし）、チャット用途フィルタを適用して素の modelId 配列を返す
  - openai/anthropic/google は非空、azure-openai など未収録プロバイダは空配列を返す
  - レジストリのリフレッシュ/ネットワーク経路を一切呼ばない（read 専用・同期）
  - 完了状態: レジストリをスタブした単体テストで、openai が非空・azure-openai が空・ネットワーク呼び出しゼロを確認できる
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 3.1, 6.1_
  - _Depends: 2.1_
  - _Boundary: model-catalog_

- [ ] 3. コア: クライアントのモデル一覧取得
- [ ] 3.1 (P) 選択可能モデル取得フックを実装する
  - 設定中プロバイダをキーに一覧を取得する immutable なデータフックを追加する。プロバイダ未選択時は取得しない
  - プロバイダ変更で自動的に再取得する
  - 完了状態: プロバイダ空でフェッチが発生せず、プロバイダ変更でキーが変わり再取得されることをフックのテストで確認できる
  - _Requirements: 1.1, 3.2, 5.1, 5.2_
  - _Depends: 1.1_
  - _Boundary: useSWRxSelectableModels_

- [ ] 4. 統合: 管理者向け available-models エンドポイント
- [ ] 4.1 available-models エンドポイントを公開し admin ルータに接続する
  - 管理者認可チェーン（read:admin:ai スコープ + login + admin）配下で、プロバイダをクエリに取り選択可能モデル一覧を返すエンドポイントを追加し、admin ルータに mount する
  - プロバイダ値を allow-list 検証し、不正なら 400、未収録プロバイダは空一覧、応答は modelId のみ（秘匿情報なし）
  - 完了状態: 非管理者は 401/403、`?provider=openai` は非空 modelIds、`?provider=azure-openai` は空、不正 provider は 400、応答に apiKey/providerOptions を含まないことを統合テストで確認できる
  - _Requirements: 1.1, 3.1, 7.1, 7.2_
  - _Depends: 2.2, 1.1_
  - _Boundary: get-available-models, admin-ai-settings router_

- [ ] 5. 統合: 管理画面のモデル入力 UI
- [ ] 5.1 許可モデル入力を選択式と自由入力で出し分ける
  - 許可モデル行の modelId 入力を、カタログがあるプロバイダでは選択のみのドロップダウン、azure-openai・未選択・取得失敗時は自由入力にする
  - 保存済みだが現一覧に無い modelId は選択済みとして保持し、勝手に変更しない
  - 環境変数専用モードの読み取り専用挙動、既定ラジオ・providerOptions・追加/削除は現行のまま
  - 完了状態: openai でドロップダウン描画・azure で自由入力・取得失敗で自由入力フォールバック・一覧外の保存済み値の保持・env-only で編集不可、をコンポーネントテストで確認できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 5.1, 5.2, 7.3_
  - _Depends: 3.1, 1.2_
  - _Boundary: AllowedModelsField_

- [ ] 6. 検証: 外部通信なし保証と回帰
- [ ] 6.1 オフラインでのモデル一覧取得と本番外部化を検証する
  - 一覧取得経路が外部通信を発生させないことを確認し、静的レジストリ依存が値 import 化後も本番ビルド成果物に含まれる（externalization）ことを検証する
  - 完了状態: プロダクションビルド後に静的レジストリ依存が .next の外部化成果に存在し、サーバ起動（load-only）が成功、一覧取得でネットワーク通信が発生しない
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.2, 4.1_

- [ ] 6.2 既存の許可リスト・解決・チャット挙動が不変であることを確認する
  - 保存経路（単一 isDefault・providerOptions JSON 検証）、モデル解決の allow-list 検証、チャット側モデル一覧、AI 有効判定が変わっていないことを既存テストで確認する
  - 完了状態: 既存の mastra 関連テストスイートが green で、保存・推論・チャット UI の挙動に差分がない
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 4.1, 5.1_

- [ ] 7. スペック整合更新
- [ ] 7.1 (P) mastra-multi-model-chat スペックを整合させる
  - 「モデル一覧取得の仕組みは設けない／許可モデルは管理者が手入力する」という要件・設計の記述を、オフライン静的カタログに基づく選択方式の採用へ更新する
  - 完了状態: 当該スペックの requirements/design に手入力前提の記述が残らず、静的カタログ選択方式の採用が明記されている
  - _Requirements: 8.1_
  - _Boundary: spec mastra-multi-model-chat_

- [ ] 7.2 (P) multi-llm-provider スペックを整合させる
  - research の D-2/D-3 に、外部通信を伴うモデルルーターの不採用を維持しつつ、静的カタログ read 経路は別物であり推論は native 実装のままである旨の注記を追加する
  - 完了状態: 当該 research に static-catalog read と model router の区別を示す注記が存在する
  - _Requirements: 8.2_
  - _Boundary: spec multi-llm-provider_

- [ ] 7.3 スペック間の矛盾がないことを確認する
  - 関連スペック間でモデル入力方式に関する矛盾記述が残っていないことを確認する
  - 完了状態: mastra-multi-model-chat / multi-llm-provider / ai-settings-model-picker の間にモデル入力方式の矛盾記述がない
  - _Requirements: 8.3_
  - _Depends: 7.1, 7.2_
