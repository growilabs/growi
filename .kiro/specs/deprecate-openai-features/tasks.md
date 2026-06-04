# Implementation Plan

> 実装順序は design.md「Migration Strategy」に準拠: 前提移設 → mastra 契約変更（サーバ→クライアント）→ 横断参照除去 → openai スリム化 → データ層/設定/i18n → 統合検証。各フェーズ後に `turbo run lint/test/build --filter @growi/app` を実行する。

- [x] 1. Foundation: 残置範囲の確定（検証）
  - 残置対象（クライアントデリゲータ・AI 有効判定・認可ミドルウェア・serviceType 型・suggest-path 用プロンプト定数）の実依存をたどり、最小公開面を確定して記録する
  - 生クライアントの唯一の参照元が削除対象のエディターアシスタントであることを確認し、残置不要（削除可）と判定する
  - エディターの差分マージ表示（unified merge view）連携が AI（エディターアシスタント）専用所有で通常編集に波及しないことを確認する
  - suggest-path 用プロンプト定数（instructionsForInformationTypes）は残置対象とし、未使用の他定数のトリムは消費側を削除する 5.1 で行う（順序: 消費側削除 → トリム）
  - 観測可能な完了条件: 「残す／削る」対象とデリゲータ除去メソッドが Implementation Notes に記録され、後続タスクの削除範囲として参照できる
  - _Requirements: 1.2, 2.5, 6.1, 6.4_

- [ ] 2. mastra チャットのアシスタント非依存化（サーバ）

- [x] 2.1 thread ライフサイクルからアシスタント紐付けを除去（後方互換）
  - thread の生成・取得をユーザー識別子のみで行い、新規 thread のメタデータにアシスタント識別子を書き込まないようにする
  - メタデータ判定を緩和し、アシスタント識別子を保持する既存 thread も余剰フィールドとして許容して閲覧・再開できるようにする
  - 観測可能な完了条件: 新規 thread にアシスタント識別子が付与されず、既存 thread もエラーなく取得・再開できる（ユニットテストで確認）
  - _Requirements: 9.2, 9.4_
  - _Boundary: Thread Lifecycle_

- [x] 2.2 チャット送信エンドポイントからアシスタント／vectorStore 依存を除去
  - リクエスト本文と検証からアシスタント識別子を取り除き、アシスタント読み込み・利用可否判定・vectorStore 識別子の導出を削除する
  - リクエストコンテキストから vectorStore 識別子を取り除く
  - 観測可能な完了条件: アシスタント識別子なしのリクエストでチャットがストリーム応答を返し、既存スレッド識別子で会話を再開できる
  - _Requirements: 5.2, 5.3, 8.3_
  - _Boundary: Mastra Message Route_
  - _Depends: 2.1_

- [x] 2.3 file-search ツールと vectorStore 依存コードを mastra から削除
  - エージェントの利用ツールを全文検索とページ内容取得のみに限定し、file-search ツールおよび OpenAI file_search ラッパーを削除する
  - 観測可能な完了条件: mastra に file-search／vectorStore 依存コードが存在せず、エージェントが全文検索・ページ内容取得のみで応答する
  - _Requirements: 5.1, 5.4, 6.3_
  - _Boundary: Mastra Message Route_

- [ ] 3. mastra チャットのアシスタント非依存化（クライアント）と新規チャット導線

- [ ] 3.1 チャット起動状態をアシスタント非依存へ統合
  - 右サイドバーチャットの起動状態からアシスタントデータ・エディターアシスタント区分を取り除き、起動操作をスレッド識別子のみ任意で受ける形に変更する
  - エディターアシスタント起動アクションを廃止する
  - 観測可能な完了条件: アシスタントを選択せずにチャット起動状態を開閉でき、エディターアシスタント起動経路が存在しない
  - _Requirements: 3.6, 8.3_
  - _Boundary: Chat Sidebar State_
  - _Depends: 2.2_

- [ ] 3.2 ChatSidebar の送信本文と表示をアシスタント非依存化
  - メッセージ送信本文からアシスタント識別子を除去し、ヘッダ表示をスレッドタイトルまたは汎用表示に変更する
  - 観測可能な完了条件: アシスタント名に依存しない表示でメッセージ送受信が成立する
  - _Requirements: 5.2, 8.3_
  - _Boundary: Chat Sidebar State_
  - _Depends: 3.1_

- [ ] 3.3 左サイドバー AI パネルを「新規チャット」＋スレッド一覧に再構成
  - 「アシスタント追加」とマイ／チームアシスタント一覧を撤去し、右サイドバーチャットを開く「新規チャット」ボタンとスレッド一覧のみで構成する
  - スレッド一覧をアシスタント取得フックに依存させず、スレッド識別子のみで会話を再開できるようにする
  - アシスタント一覧・アシスタント削除モーダルのコンポーネントを削除する
  - 観測可能な完了条件: 左 AI パネルに「新規チャット」ボタンとスレッド一覧が表示され、ボタン押下で右サイドバーチャットが開き、AI 無効時はパネル導線が露出しない
  - _Requirements: 3.1, 3.3, 6.5, 8.1, 8.2, 8.4, 9.1, 9.3_
  - _Boundary: Left AI Panel_
  - _Depends: 3.1_

- [ ] 4. openai 由来コードの横断参照を除去

- [ ] 4.1 サーバ起動とルート登録から openai を除去
  - アシスタント／エディターアシスタント／スレッド関連の API ルート登録を撤去し、起動処理から openai サービス初期化と廃止 cron の登録を取り除く
  - 観測可能な完了条件: アシスタント系エンドポイントが公開されず、起動時に廃止 cron が登録されない
  - _Requirements: 1.3, 2.4, 3.4, 4.5_
  - _Boundary: app-wide integration_
  - _Depends: 2.2_

- [ ] 4.2 (P) レイアウト・ページ操作 UI から openai を除去
  - 共通レイアウトからアシスタント管理モーダルを外し、ページ操作ヘッダから既定アシスタント起動ボタンを取り除く
  - 観測可能な完了条件: 画面上にアシスタント管理モーダルとページヘッダの起動ボタンが存在しない
  - _Requirements: 3.2, 3.5_
  - _Boundary: app-wide integration_
  - _Depends: 3.1_

- [ ] 4.3 (P) エディターから AI 編集導線を除去
  - エディターのアシスタント起動トグルを削除し、エディター本体から差分マージ表示連携の参照を取り除く
  - 観測可能な完了条件: エディター内に AI 編集トグル・編集補助導線が存在せず、通常編集は従来どおり動作する
  - _Requirements: 2.2, 2.3, 2.5_
  - _Boundary: app-wide integration_
  - _Depends: 1_

- [ ] 4.4 (P) ページ更新・ユーザー削除・起動時正規化の openai 連携を除去
  - ページ作成・更新時の vectorStore 同期連携、ユーザー削除時のアシスタント削除連携、起動時の thread-relation／vector-store 正規化処理を取り除く
  - 観測可能な完了条件: ページ作成/更新・ユーザー削除・起動時に廃止 AI 連携処理が呼ばれない
  - _Requirements: 4.6, 6.2_
  - _Boundary: app-wide integration_
  - _Depends: 2.2_

- [ ] 5. features/openai のスリム化（削除と整理）

- [ ] 5.1 アシスタント／ナレッジ／エディター／cron／神サービス等を削除
  - assistant・editor-assistant・knowledge・cron・embeddings・normalize・統合サービス（神サービス）・生クライアント（client.ts）・アシスタント系ルート・アシスタント系インターフェイス・アシスタント系クライアント UI を削除する（接続設定 UI は残す）
  - suggest-path 用プロンプト定数ファイルは削除対象から除外し、消費側（assistant 配下）削除後に使用中の定数のみへトリムする（suggest-path の import は不変）
  - 観測可能な完了条件: openai 配下にアシスタント／FileSearch／vectorStore／ナレッジ／エディター関連コードが残らず、残置基盤（デリゲータ／AI 有効判定／認可ミドルウェア／serviceType 型／プロンプト定数）のみが残る
  - _Requirements: 1.1, 2.1, 3.1_
  - _Boundary: app-wide integration_
  - _Depends: 1, 2.2, 2.3, 3.1, 3.3, 4.1, 4.2, 4.3, 4.4_

- [ ] 5.2 LLM クライアントデリゲータをスリム化
  - クライアントデリゲータのインターフェイスと実装から vectorStore・thread・file 系メソッドを除去し、補完呼び出しなど残置に必要な面のみ残す
  - 観測可能な完了条件: デリゲータに vectorStore/thread/file メソッドが型・実装ともに存在せず、suggest-path の補完呼び出しが従来どおり動作する
  - _Requirements: 1.2, 6.1, 6.4_
  - _Boundary: OpenAI LLM Client Base_
  - _Depends: 5.1_

- [ ] 6. データ層・設定・i18n の整理

- [ ] 6.1 (P) 廃止モデルの削除とコレクション破棄マイグレーション
  - 4 つの廃止 Mongoose モデル定義を削除し、対応する 4 コレクションを破棄する冪等なマイグレーションを追加する（不存在時もエラーなく完了、リモート vector store は対象外）
  - 削除対象モデルを参照していた既存マイグレーションを、モデルに依存しない自己完結形へ書き換える
  - 観測可能な完了条件: マイグレーション実行で 4 コレクションが破棄され（または skip され）、モデル削除後も既存マイグレーション群が実行可能
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7_
  - _Boundary: Drop Collections Migration_
  - _Depends: 2.1, 5.1_

- [ ] 6.2 (P) Prisma スキーマから廃止モデルを削除し再生成
  - スキーマ定義から 4 モデルを削除して生成物を再生成する
  - 観測可能な完了条件: 生成物に 4 モデルが含まれず、ビルド・型チェックが通る
  - _Requirements: 4.1_
  - _Boundary: prisma schema_

- [ ] 6.3 (P) 廃止 AI 設定キーの削除と設定表示の整理
  - エディターアシスタント／cron／vectorStore 専用の設定キーを削除し、接続・資格情報・mastra 用モデルキーは残す。設定表示からも削除キーの参照を取り除く
  - 観測可能な完了条件: 廃止設定キーが定義・表示されず、残置 AI 機能が必要とする接続設定キーは維持される
  - _Requirements: 10.1, 10.2, 10.3_
  - _Boundary: Config Cleanup_
  - _Depends: 5.1_

- [ ] 6.4 (P) 管理画面 AI 連携 UI のスリム化
  - 管理画面の AI 連携設定から、アシスタント・vectorStore・検索管理の設定要素を取り除き、接続・資格情報設定は残す
  - 観測可能な完了条件: 管理画面に接続/資格情報設定のみが表示され、アシスタント/vectorStore 設定要素が存在しない
  - _Requirements: 10.2, 10.3_
  - _Boundary: Config Cleanup_
  - _Depends: 5.1_

- [ ] 6.5 (P) openai 専用 i18n キーを全ロケールから削除
  - アシスタント管理・ナレッジ／エディターアシスタント・共有スコープ警告・既定アシスタント等の専用キーを全対応ロケールから削除し、mastra が利用する共有キーは保持する
  - 観測可能な完了条件: 全対応ロケールで専用キーが削除され、残る UI が削除済みキーを参照せず未翻訳表示を出さない
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: i18n locales_
  - _Depends: 5.1_

- [ ] 7. 統合検証

- [ ] 7.1 lint・test・build と型チェックの完走
  - 全体の lint・ユニット/結合テスト・本番ビルド・型チェックを実行し、未解決参照やリグレッションがないことを確認する
  - 観測可能な完了条件: lint/test/build が成功し、AI 以外の既存機能に影響がない
  - _Requirements: 1.4, 1.5_
  - _Depends: 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 7.2 結合テスト: チャット契約・既存スレッド・suggest-path 継続
  - アシスタント識別子なしのチャット送信、既存スレッド再開、AI 無効時の利用不可、suggest-path のパス提案が従来どおり動作することを検証する
  - 観測可能な完了条件: 上記の結合テストがいずれも成功する
  - _Requirements: 6.1, 8.3, 9.2, 10.4_
  - _Depends: 7.1_

- [ ] 7.3 E2E: 新規チャット導線・スレッド一覧・AI 機能の不在確認
  - 左サイドバーからの新規チャット起動と送受信、スレッド一覧の再開・削除・ページング、エディターの AI 不在、アシスタント UI（管理モーダル・一覧・ヘッダ起動ボタン）の不在、各言語での i18n 整合を確認する
  - 観測可能な完了条件: 上記 E2E パスがいずれも成功する
  - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.5, 7.4, 8.1, 8.2, 9.1, 9.3_
  - _Depends: 7.1_

## Implementation Notes

- **Task 1 (Foundation 検証, 完了)** 残置/削除の確定:
  - **残置（retained surface）**: `features/openai/server/services/client-delegator/`（vectorStore/thread/file メソッドを除去しスリム化）、`server/services/is-ai-enabled.ts`、`server/routes/middlewares/certify-ai-service.ts`、`interfaces/ai.ts`（OpenaiServiceType）、`server/services/assistant/instructions/commons.ts`（`instructionsForInformationTypes` のみ・5.1 でトリム）。
  - **削除可と確定**: `server/services/client.ts`（`openaiClient`）の唯一の参照元は削除対象の `server/routes/edit/index.ts`（エディターアシスタント）。client-delegator は client.ts を import していないため client.ts は残置不要 → 5.1 で削除。
  - **unified merge view** は `features/openai/client/states/unified-merge-view.ts` + `client/services/editor-assistant/use-editor-assistant.tsx` 由来で、消費は `PageEditor.tsx` のみ。AI（エディターアシスタント）専用所有のため、4.3 で PageEditor から参照除去して安全。
  - **トリム順序の制約**: `commons.ts` の未使用3定数（system/injection/file-search）は `assistant/editor-assistant.ts`・`chat-assistant.ts` がまだ使用しているため、トリムは消費側削除と同じ 5.1 で実施（先行タスクでトリムするとビルドが壊れる）。
