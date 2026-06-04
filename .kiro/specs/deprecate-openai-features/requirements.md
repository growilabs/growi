# Requirements Document

## Introduction

GROWI の AI 機能は現在 `features/openai`（OpenAI/Azure ベースのナレッジアシスタント・エディターアシスタント・アシスタント管理・vectorStore による FileSearch）と `features/mastra`（Mastra ベースのチャット／エージェント検索）に二分されている。本仕様は、`features/openai` を完全に廃止し、AI 機能を `features/mastra` に一本化することを目的とする。

これにより「アシスタント」「マイアシスタント」「チームアシスタント」という概念、ナレッジアシスタント／エディターアシスタント、および `ai-assistant` / `thread-relation` / `vector-store` / `vector-store-file-relation` モデルと、mastra 側の vectorStore 依存・`file-search` ツールが取り除かれる。`features/mastra` が依存していた UI コンポーネント・i18n・サービスのうち、廃止後も必要なものは `features/mastra` 側へ移設する。

アシスタント概念がなくなりチャット起点（アシスタント選択 → チャット開始）が失われるため、左サイドバーから右サイドバーのチャットを直接開く導線を新設する。mastra が管理する thread 一覧（最近のスレッド）を表示する UI は存続させる。

本仕様の利害関係者は、GROWI の利用ユーザー（AI チャットを使う／編集者）、GROWI を運用する管理者・運用者、および GROWI コードベースを保守する開発者である。

## Boundary Context

- **In scope（廃止・整理する）**
  - `features/openai` ディレクトリ配下の全ファイルの削除
  - ナレッジアシスタント・エディターアシスタント機能の廃止
  - 「アシスタント／マイアシスタント／チームアシスタント」概念と、その管理 UI・CRUD API の廃止
  - `ai-assistant` / `thread-relation` / `vector-store` / `vector-store-file-relation` モデルの削除と、対応する MongoDB コレクションの破棄（マイグレーション）
  - `features/mastra` の vectorStore 依存および `file-search` ツールの除去
  - `features/openai` でのみ使用していた i18n キーの削除
  - `features/openai` 由来で `features/mastra` がまだ必要とするコード・UI・i18n の `features/mastra` への移設
  - 左サイドバーから右サイドバーチャットを開く導線の新設
- **In scope（存続させる）**
  - mastra が管理する thread 一覧（最近のスレッド）を表示する UI と、その閲覧・再開・削除
  - 管理画面の AI 連携設定および `features/mastra` が利用する環境変数（OpenAI/Azure 資格情報）
  - mastra の全文検索ツール・ページ内容取得ツールによる知識検索
- **Out of scope（本仕様では行わない）**
  - OpenAI 側に存在するリモート vector store の削除（既存のリモートデータは放置する）
  - mastra のチャット／エージェント体験そのものの機能拡張（移行に伴う最小限の改変を除く）
  - AI 以外の GROWI 機能の挙動変更
- **Adjacent expectations**
  - 既存デプロイのアップグレード時、廃止対象の MongoDB コレクションはマイグレーションによって破棄される。リモート OpenAI vector store は破棄されず孤立データとして残る。
  - mastra のスレッドは Mastra Memory ストレージ（廃止対象 4 コレクションには含まれない）に保持されるため、既存スレッドはアップグレード後も閲覧・再開できる。スレッドが保持していた `aiAssistantId` メタデータは以後参照されない。

## Requirements

### Requirement 1: features/openai ディレクトリの全廃
**Objective:** 開発者として、`features/openai` を完全に削除したい。これにより OpenAI FileSearch 系の旧 AI 実装を保守対象から外し、AI 機能を `features/mastra` に一本化できる。

#### Acceptance Criteria
1. The GROWI codebase shall `features/openai` ディレクトリおよびその配下のいかなるファイルも保持しない。
2. The GROWI codebase shall `features/openai` 配下のモジュールを解決する import 文を保持しない。
3. When ビルドおよび型チェックを実行したとき, the application shall `features/openai` を参照することなく成功する。
4. The application shall `/api/v3/openai/*` ルートを公開しない。
5. While `features/openai` 由来のサーバーサイドコードが削除された状態で, the application shall AI 以外の既存機能を従来どおり提供する。

### Requirement 2: ナレッジアシスタント・エディターアシスタント機能の廃止
**Objective:** 利用ユーザーとして、旧ナレッジアシスタント／エディターアシスタントの提供が終了することを理解したい。これにより AI チャットが mastra のチャットへ一本化される。

#### Acceptance Criteria
1. The application shall ナレッジアシスタント専用の UI・API エントリポイントを提供しない。
2. When ユーザーがマークダウンエディターを開いたとき, the application shall エディターアシスタント（AI による編集補助）の操作要素を表示しない。
3. The application shall エディターアシスタントのリクエストを受け付けるサーバーエンドポイントを提供しない。
4. The application shall ナレッジアシスタント／エディターアシスタント由来の SSE ストリーミング処理・スキーマを保持しない。

### Requirement 3: 「アシスタント」概念の廃止
**Objective:** 利用ユーザーとして、「アシスタント」「マイアシスタント」「チームアシスタント」という概念がなくなることを把握したい。これにより AI 利用フローが単純化される。

#### Acceptance Criteria
1. The application shall UI のいずれの箇所にも「アシスタント」「マイアシスタント」「チームアシスタント」の概念を提示しない。
2. The application shall アシスタントの作成・編集・削除を行う管理モーダルを提供しない。
3. When ユーザーが左サイドバーの AI パネルを開いたとき, the application shall マイアシスタント／チームアシスタントの一覧を表示しない。
4. The application shall アシスタントの作成・取得・更新・削除・既定設定を行う API エンドポイントを提供しない。
5. While アシスタント概念が廃止された状態で, the application shall アシスタントの選択なしに AI チャットを利用できるようにする。

### Requirement 4: 廃止対象モデルの削除と既存データのマイグレーション
**Objective:** 運用者として、廃止される AI 関連データが既存デプロイから明確に取り除かれてほしい。これによりアップグレード後にデータベースが孤立したコレクションを抱えないようにする。

#### Acceptance Criteria
1. The GROWI codebase shall `ai-assistant` / `thread-relation` / `vector-store` / `vector-store-file-relation` の Mongoose モデルを定義しない。
2. When 既存デプロイをアップグレードしてマイグレーションが実行されたとき, the migration shall `aiassistants` / `threadrelations` / `vectorstores` / `vectorstorefilerelations` コレクションを破棄する。
3. The migration shall OpenAI 側のリモート vector store を削除しない。
4. The application shall 廃止対象モデルに対して動作していた定期ジョブ（スレッド削除・vectorStore ファイル削除の cron）を実行しない。
5. If マイグレーションの対象コレクションが既に存在しない場合, then the migration shall エラーを発生させずに完了する。

### Requirement 5: mastra の vectorStore 依存・file-search ツールの除去
**Objective:** 開発者として、`features/mastra` から vectorStore 依存と `file-search` ツールを取り除きたい。これによりアシスタント概念や OpenAI vector store に依存しないチャットを実現する。

#### Acceptance Criteria
1. The GROWI codebase shall mastra の `file-search` ツールおよび vectorStore に依存するコードを保持しない。
2. The mastra チャットエンドポイント shall リクエストに `aiAssistantId` を要求しない。
3. When mastra エージェントが応答を生成するとき, the agent shall リクエストコンテキストに `vectorStoreId` を含めずに動作する。
4. The mastra エージェント shall 知識検索の手段として全文検索ツールおよびページ内容取得ツールのみを用いる。

### Requirement 6: features/openai 由来コード・UI の移設と参照の整理
**Objective:** 開発者として、`features/openai` 由来で `features/mastra` がまだ必要とする要素を `features/mastra` へ移設し、その他の参照を綺麗にしたい。これにより削除後もビルドと機能が成立する。

#### Acceptance Criteria
1. Where `features/openai` に存在していた UI コンポーネント・サービス・ユーティリティ・型が `features/mastra` でなお必要とされる場合, the application shall それらを `features/mastra` 配下から提供する。
2. The GROWI codebase shall `features/mastra` から `features/openai` への import を保持しない。
3. The GROWI codebase shall `features/openai` 由来のコードを使用していた他の箇所（レイアウト・サイドバー・ルーティング等）の参照を、削除または `features/mastra` への移設後の参照へ置き換える。
4. The mastra feature shall AI の有効・無効判定を `features/openai` に依存せずに行う。

### Requirement 7: features/openai 専用 i18n の削除
**Objective:** 開発者として、`features/openai` でのみ使用していた i18n を削除したい。これにより未使用の翻訳キーを残さない。

#### Acceptance Criteria
1. The application shall `features/openai` でのみ使用していた i18n キー（アシスタント管理・エディターアシスタント・共有スコープ警告・既定アシスタント等）を保持しない。
2. Where `features/openai` 由来の i18n キーが `features/mastra` でなお使用される場合, the application shall そのキーを保持または `features/mastra` 側へ移設する。
3. When 移行後の UI を各対応言語で表示したとき, the application shall 削除済み i18n キーを参照せず、未翻訳フォールバックを表示しない。

### Requirement 8: 左サイドバーから右サイドバーチャットを開く導線
**Objective:** 利用ユーザーとして、左サイドバーから AI チャットを直接開きたい。アシスタント選択というチャット開始点がなくなるため、代替の起点が必要となる。

#### Acceptance Criteria
1. The application shall 左サイドバーに、右サイドバーのチャットを開くための導線を提示する。
2. When ユーザーが左サイドバーの当該導線を操作したとき, the application shall 右サイドバーのチャットを開く。
3. While 右サイドバーチャットが当該導線から開かれている状態で, the user shall アシスタントを選択することなく新規会話を開始できる。
4. While AI が無効化されている（必要な資格情報が未設定の）状態で, the application shall 当該チャット導線を提示しない。

### Requirement 9: thread 一覧の存続
**Objective:** 利用ユーザーとして、最近のスレッド（thread 一覧）を引き続き閲覧・再開・削除したい。これにより過去の会話に戻れる。

#### Acceptance Criteria
1. The application shall mastra が管理する thread 一覧（最近のスレッド）を表示する UI を提供する。
2. When ユーザーが thread 一覧から既存スレッドを選択したとき, the application shall アシスタントの紐付けを要求せずにその会話を再開する。
3. The thread 一覧 shall アシスタント概念の廃止後も、ページング表示およびスレッド削除を引き続き提供する。
4. While アップグレードによりマイグレーションが完了した状態で, the application shall 既存の mastra スレッドを閲覧可能なまま保持する。

### Requirement 10: 管理画面 AI 連携設定と環境変数の整理
**Objective:** 運用者として、mastra が動作するために必要な AI 連携設定・環境変数を維持しつつ、廃止された機能の設定項目を取り除きたい。これにより設定画面が現行機能と一致する。

#### Acceptance Criteria
1. The application shall `features/mastra` が利用する AI 連携の環境変数（OpenAI/Azure 資格情報）を引き続きサポートする。
2. The application shall 管理画面の AI 連携設定のうち、mastra が必要とする接続設定を保持する。
3. The application shall 管理画面の AI 連携設定から、アシスタント・vectorStore 専用の設定項目を取り除く。
4. While AI 連携に必要な資格情報が未設定の状態で, the application shall AI チャット機能を利用不可として扱う。
