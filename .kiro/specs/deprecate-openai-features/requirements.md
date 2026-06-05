# Requirements Document

## Project Description (Input)
features/oepnai ディレクトリを削除し OpenAI の FileSearch 関連機能を廃止したい。そして AI 機能は完全に features/mastra に移行したい。

- ナレッジアシスタント、エディターアシスタントの全ての機能を廃止する
- ai-assistant, thread-relation, vector-store-file-relation, vector-store モデル の廃止
- 一部 features/mastra で利用している UI コンポーネントがあるのでそれを features/mastra に移動
- 「アシスタント」という概念がなくなる。「マイアシスタント」「チームアシスタント」も廃止
- Mastra も一部 vectorStore に依存しているが、それも削除し file-search tool も削除する
- features/openai でしか使っていない i18n も全て削除
- 最終的には features/openai ディレクトリは全て消え、必要なファイルは features/mastra に移行する
- features/openai 由来のコードを使っている部分も綺麗にする
- mastra 版 AI 機能にチャットを開始するボタンがなくなるので左サイドバーに右サイドバーを開く導線を用意する
- thread 一覧機能は残す

> **改訂メモ（ギャップ分析後の合意）**: 当初は「`features/openai` ディレクトリを全廃」する想定だったが、ギャップ分析で `features/ai-tools/suggest-path`（ページパス提案）が `features/openai` の OpenAI/Azure LLM クライアント基盤に依存していることが判明した。協議の結果、**suggest-path は存続させ、それが依存する OpenAI クライアント周りのコードは残置**する方針に変更した。したがって本要件では `features/openai` を「FileSearch／アシスタント関連のみ削除してスリム化する（LLM クライアント基盤は残す）」と定義する。エディター AI 編集機能は代替を設けず完全削除する。

## Introduction

GROWI の AI 機能は `features/openai`（OpenAI/Azure ベースのアシスタント／ナレッジ・エディターアシスタント／vectorStore による FileSearch／LLM クライアント基盤）と `features/mastra`（Mastra ベースのチャット・エージェント検索・thread）に分かれている。本仕様は、`features/openai` から FileSearch・アシスタント関連機能を削除して `features/mastra` に AI チャットを一本化しつつ、`features/ai-tools/suggest-path` および `features/mastra` が依存する OpenAI/Azure の LLM クライアント基盤は残置することを目的とする。

これにより「アシスタント」「マイアシスタント」「チームアシスタント」という概念、ナレッジアシスタント／エディターアシスタント、`ai-assistant` / `thread-relation` / `vector-store` / `vector-store-file-relation` モデル、mastra 側の vectorStore 依存・`file-search` ツール、およびそれらに紐づく定期ジョブ・ページ連携・i18n が取り除かれる。一方で、ページパス提案（suggest-path）と mastra チャットを動作させ続けるために必要な LLM クライアント基盤は維持する。

アシスタント概念がなくなりチャット起点（アシスタント選択 → チャット開始）が失われるため、左サイドバーから右サイドバーのチャットを直接開く導線を新設する。mastra が管理する thread 一覧（最近のスレッド）を表示する UI は存続させる。

本仕様の利害関係者は、GROWI の利用ユーザー（AI チャットを使う／編集者）、GROWI を運用する管理者・運用者、および GROWI コードベースを保守する開発者である。

## Boundary Context

- **In scope（削除・整理する）**
  - ナレッジアシスタント・エディターアシスタント機能の廃止（エディターからの AI 編集導線は代替なしで完全削除）
  - 「アシスタント／マイアシスタント／チームアシスタント」概念と、その管理 UI・CRUD API の廃止
  - `ai-assistant` / `thread-relation` / `vector-store` / `vector-store-file-relation` モデルの削除と、対応する MongoDB コレクションの破棄（マイグレーション）
  - 上記モデルに紐づく定期ジョブ、ページ作成/更新時の vectorStore 同期連携、ユーザー削除時のアシスタント削除連携、起動時の正規化処理の除去
  - `features/mastra` の vectorStore 依存および `file-search` ツールの除去
  - Elasticsearch 検索の `@ai` メンション処理・`vector` 検索オプション（廃止された vectorStore 検索の起動経路で、現在は未消費の dead code）の除去
  - `features/openai` でのみ使用していた i18n キーの削除
  - 管理画面の AI 連携設定ページ（admin AI integration page）の廃止（接続/資格情報は環境変数のみで設定するため、管理画面の設定フォームは持たない）
  - `features/mastra` がまだ必要とする UI・コード・i18n の整理（移設または残置参照への置換）
  - 左サイドバーから右サイドバーチャットを開く導線の新設
- **In scope（存続させる）**
  - `features/ai-tools/suggest-path`（ページパス提案）と、それが依存する OpenAI/Azure LLM クライアント基盤（クライアントデリゲータ・AI サービス認可・AI 有効判定等）
  - mastra が管理する thread 一覧（最近のスレッド）を表示する UI と、その閲覧・再開・削除
  - `features/mastra` および `features/ai-tools/suggest-path` が利用する環境変数（OpenAI/Azure 資格情報）による AI 連携設定
  - mastra の全文検索ツール・ページ内容取得ツールによる知識検索
- **Out of scope（本仕様では行わない）**
  - `features/openai` ディレクトリの完全削除（LLM クライアント基盤は残置するため、ディレクトリは残る）
  - suggest-path 自体の廃止、および残置する LLM クライアント基盤の中立な場所への大規模な移設・再設計（必要なら別仕様で扱う）
  - OpenAI 側に存在するリモート vector store の削除（既存のリモートデータは放置する）
  - mastra のチャット／エージェント体験そのものの機能拡張（移行に伴う最小限の改変を除く）
  - AI 以外の GROWI 機能の挙動変更
- **Adjacent expectations**
  - 既存デプロイのアップグレード時、廃止対象の MongoDB コレクションはマイグレーションによって破棄される。リモート OpenAI vector store は破棄されず孤立データとして残る。
  - mastra のスレッドは Mastra Memory ストレージ（廃止対象 4 コレクションには含まれない）に保持されるため、既存スレッドはアップグレード後も閲覧・再開できる。スレッドが保持していた `aiAssistantId` メタデータは以後参照されない。
  - 残置する LLM クライアント基盤は FileSearch・vectorStore・アシスタントの能力を含まない、最小限の OpenAI/Azure クライアント機能に限られる。

## Requirements

### Requirement 1: OpenAI FileSearch・アシスタント機能の削除と features/openai のスリム化
**Objective:** 開発者として、OpenAI FileSearch／アシスタント系の実装を削除しつつ、他の AI 機能（suggest-path・mastra チャット）が依存する OpenAI/Azure の LLM クライアント基盤は残したい。これにより不要機能を排除しつつ既存の AI 機能を壊さない。

#### Acceptance Criteria
1. The GROWI codebase shall `features/openai` 配下のアシスタント・ナレッジアシスタント・エディターアシスタント・FileSearch・vectorStore に関するコードを保持しない。
2. The application shall `features/ai-tools/suggest-path` および `features/mastra` が依存する OpenAI/Azure の LLM クライアント基盤（クライアントデリゲータ・AI サービス認可・AI 有効判定など）を引き続き提供する。
3. The application shall `/api/v3/openai/*` のアシスタント・エディターアシスタント・スレッド関連エンドポイントを公開しない。
4. When ビルドおよび型チェックを実行したとき, the application shall 未解決参照を生じることなく成功する。
5. While 削除・スリム化が完了した状態で, the application shall AI 以外の既存機能を従来どおり提供する。

### Requirement 2: ナレッジアシスタント・エディターアシスタント機能の廃止
**Objective:** 利用ユーザーとして、旧ナレッジアシスタント／エディターアシスタントの提供が終了することを理解したい。これにより AI チャットが mastra のチャットへ一本化される。

#### Acceptance Criteria
1. The application shall ナレッジアシスタント専用の UI・API エントリポイントを提供しない。
2. When ユーザーがマークダウンエディターを開いたとき, the application shall エディターアシスタント（AI による編集補助）の操作要素を表示しない。
3. The application shall エディター内の AI 編集導線に対する代替機能を提供しない。
4. The application shall エディターアシスタントのリクエストを受け付けるサーバーエンドポイントを提供しない。
5. The application shall ナレッジアシスタント／エディターアシスタント由来の SSE ストリーミング処理・スキーマ・差分マージ表示（unified merge view）を保持しない。

### Requirement 3: 「アシスタント」概念の廃止
**Objective:** 利用ユーザーとして、「アシスタント」「マイアシスタント」「チームアシスタント」という概念がなくなることを把握したい。これにより AI 利用フローが単純化される。

#### Acceptance Criteria
1. The application shall UI のいずれの箇所にも「アシスタント」「マイアシスタント」「チームアシスタント」の概念を提示しない。
2. The application shall アシスタントの作成・編集・削除を行う管理モーダルを提供しない。
3. When ユーザーが左サイドバーの AI パネルを開いたとき, the application shall マイアシスタント／チームアシスタントの一覧を表示しない。
4. The application shall アシスタントの作成・取得・更新・削除・既定設定を行う API エンドポイントを提供しない。
5. The application shall ページヘッダから既定アシスタントのチャットを開く起動ボタンを提供しない。
6. While アシスタント概念が廃止された状態で, the application shall アシスタントの選択なしに AI チャットを利用できるようにする。

### Requirement 4: 廃止対象モデルの削除・データマイグレーション・関連連携の除去
**Objective:** 運用者として、廃止される AI 関連データと連携処理が既存デプロイから明確に取り除かれてほしい。これによりアップグレード後にデータベースが孤立したコレクションを抱えず、不要なバックグラウンド処理も止まる。

#### Acceptance Criteria
1. The GROWI codebase shall `ai-assistant` / `thread-relation` / `vector-store` / `vector-store-file-relation` の Mongoose モデルを定義しない。
2. When 既存デプロイをアップグレードしてマイグレーションが実行されたとき, the migration shall `aiassistants` / `threadrelations` / `vectorstores` / `vectorstorefilerelations` コレクションを破棄する。
3. The migration shall OpenAI 側のリモート vector store を削除しない。
4. If マイグレーションの対象コレクションが既に存在しない場合, then the migration shall エラーを発生させずに完了する。
5. The application shall 廃止対象モデルに対して動作していた定期ジョブ（スレッド削除・vectorStore ファイル削除の cron）を実行しない。
6. The application shall ページ作成・更新時の vectorStore 同期連携、ユーザー削除時のアシスタント削除連携、および起動時の thread-relation／vector-store 正規化処理を実行しない。
7. While 廃止対象モデルが削除された状態で, the application shall 既存のマイグレーション群を、削除されたモデルに依存することなく実行できる状態に保つ。

### Requirement 5: mastra の vectorStore 依存・file-search ツールの除去
**Objective:** 開発者として、`features/mastra` から vectorStore 依存と `file-search` ツールを取り除きたい。これによりアシスタント概念や OpenAI vector store に依存しないチャットを実現する。

#### Acceptance Criteria
1. The GROWI codebase shall mastra の `file-search` ツールおよび vectorStore に依存するコードを保持しない。
2. The mastra チャットエンドポイント shall リクエストに `aiAssistantId` を要求しない。
3. When mastra エージェントが応答を生成するとき, the agent shall リクエストコンテキストに `vectorStoreId` を含めずに動作する。
4. The mastra エージェント shall 知識検索の手段として全文検索ツールおよびページ内容取得ツールのみを用いる。

### Requirement 6: 残置 LLM クライアント基盤と suggest-path の継続、参照整理
**Objective:** 開発者として、削除後も suggest-path を動作させ、`features/mastra` などの参照を破綻させたくない。これによりスリム化後もビルドと既存 AI 機能が成立する。

#### Acceptance Criteria
1. While OpenAI 機能のスリム化が完了した状態で, the application shall `features/ai-tools/suggest-path`（ページパス提案）を従来どおり動作させる。
2. The application shall 削除された AI モデル・vectorStore・アシスタントを参照していた箇所（mastra・レイアウト・エディター・ページ作成/更新・ユーザー削除・起動時 normalize 等）の参照を、除去または残置コードへの参照に置き換える。
3. The features/mastra feature shall アシスタント・vectorStore・削除済みモデルに依存せずに動作する。
4. Where 残置された LLM クライアント基盤を `features/mastra` または `features/ai-tools/suggest-path` が必要とする場合, the application shall その参照を有効なまま維持する。
5. Where `features/openai` に存在していた UI コンポーネントが `features/mastra` でなお必要とされる場合, the application shall それを `features/mastra` 配下から提供する。
6. The application shall Elasticsearch 検索から、廃止された vectorStore 検索を起動していた `@ai` メンション処理および `vector` 検索オプションを除去する。
7. When ユーザーが検索キーワードに `@ai` を入力したとき, the application shall それを特別扱いせず通常の検索語として扱う（専用アイコン・vector 検索フラグを伴わない）。

### Requirement 7: features/openai 専用 i18n の削除
**Objective:** 開発者として、削除対象機能でのみ使用していた i18n を取り除きたい。これにより未使用の翻訳キーを残さない。

#### Acceptance Criteria
1. The application shall 削除対象機能（アシスタント管理・ナレッジ／エディターアシスタント・共有スコープ警告・既定アシスタント等）でのみ使用していた i18n キーを保持しない。
2. Where 該当 i18n キーが `features/mastra` でなお使用される場合, the application shall そのキーを保持または `features/mastra` 側へ移設する。
3. The application shall 上記 i18n の削除をサポート対象の全ロケールに対して一貫して適用する。
4. When 移行後の UI を各対応言語で表示したとき, the application shall 削除済み i18n キーを参照せず、未翻訳フォールバックを表示しない。

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

### Requirement 10: AI 連携設定（環境変数）の維持と管理画面の廃止
**Objective:** 運用者として、mastra と suggest-path が動作するために必要な AI 連携の環境変数を維持しつつ、実質的に空となった管理画面の AI 連携設定ページを取り除きたい。これにより設定面が現行機能（環境変数による設定）と一致する。

#### Acceptance Criteria
1. The application shall `features/mastra` および `features/ai-tools/suggest-path` が利用する AI 連携の環境変数（OpenAI/Azure 資格情報、`app:aiEnabled` 等）を引き続きサポートする。
2. The application shall 管理画面の AI 連携設定ページ（admin AI integration page）を提供しない。
3. The application shall AI 連携の接続・資格情報設定を環境変数のみで構成し、管理画面の設定フォームを持たない。
4. While AI 連携に必要な資格情報が未設定の状態で, the application shall AI チャット機能を利用不可として扱う。

> **改訂メモ**: 当初は「管理画面の AI 連携設定を残し、接続設定のみ保持」する方針だったが、接続/資格情報は元々環境変数で設定する構造であり、アシスタント設定削除後の管理画面が実質ヘッダのみの空ページとなった。協議の結果、当該ページ・コンポーネント・admin ナビ参照・専用 i18n を完全削除する方針に変更した（環境変数による設定は維持）。
