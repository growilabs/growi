# Requirements Document

## Project Description (Input)

GROWI のユーザーは「自然言語で問いを投げて根拠つきの回答を得る」体験を必要としているが、現在の全文検索はキーワード一致のリストを返すまでで止まっており、AI assistant 側にも ElasticSearch を活用した検索能力が組み込まれていない。そのため、既存 wiki 内コンテンツを根拠とした RAG 的な回答ができていない。

本 spec では、既に Mastra (`@mastra/core` ほか) が導入され `growiAgent` が稼働している `apps/app/src/features/mastra/` に対し、以下の最小拡張を行う:

- **`getPageContentTool` を新設**: `pageId` または `pagePath` で本文を取得する Mastra tool。`Page.findByIdAndViewer` / `Page.findByPathAndViewer` 経由で grant（GRANT_PUBLIC / GRANT_SPECIFIED / GRANT_OWNER / GRANT_USER_GROUP）を完全準拠。grant 判定は既存メソッド側に委譲し、tool / agent レイヤーで独自実装しない（閲覧不能・存在しない場合は取得失敗を共通の戻り値で返し、agent の振る舞いは LLM の標準挙動に委ねる）。
- **`growiAgent` の `tools` に新 tool を登録**、instructions に「全文検索でヒットしたページのうち、回答の根拠が必要なものは本文取得 tool を呼んで引用せよ」を追記。
- **`requestContext` の型を `{ vectorStoreId; userId }` に拡張**、`post-message.ts` でリクエスト発行ユーザーの `_id` をセット（grant チェックに必要）。
- **既存 `fileSearchTool` を暫定無効化**: Agentic search の動作確認中に OpenAI Files ベースの fileSearch が邪魔になるため `growiAgent.tools` から外す（コードは残してコメントアウト）。最終削除は本 spec のスコープ外（フォローアップ別タスク）。

前提として、既存の ElasticSearch service (`SearchService.searchKeyword()` / `ElasticsearchDelegator.search()` の `filterPagesByViewer()`) をラップした **全文検索 tool は別途存在する**（ユーザー作業ブランチで先行作成済み）。本 spec は新 tool（`getPageContentTool`）の追加と、それを使った agent ループの確立に集中する。

期待される動作は、ユーザープロンプトに対して agent が「全文検索 tool で候補抽出 → `getPageContentTool` で本文取得 → 必要に応じて再検索 → 引用つき Markdown 回答」を自律的に反復する RAG 的フローである。

### 想定ユーザープロンプトの代表類型

本 spec が確実にサポートを目指す類型:

- **直接知識質問**: 「GROWI で SAML を有効化する手順は?」
- **手順抽出**: 「Docker でのインストール方法を教えて」
- **存在確認**: 「監査ログに関するドキュメントはある?」
- **比較・違い**: 「ページ削除と完全削除の違いは?」
- **曖昧クエリの段階的洗練**: 「権限まわりの設定について」（agent が複数回検索しながらキーワードを洗練）

本 spec で **明示的に要件化しない** 類型（将来別 spec で扱う、または LLM 標準挙動に委ねる）:

- メタ・時系列クエリ（「最近更新されたページは?」など — 別 spec：関連/最近ページ tool）
- タグ絞り込み前提クエリ（「`#meeting` のページから議事録要約」など — 別 spec：タグ検索 tool）
- 書き込み系プロンプト（「このページを編集して」など — 本 spec は読み取り専用）
- wiki 内にヒットがない場合の振る舞い（「Next.js とは?」「ジョーク言って」など — LLM 標準挙動に委ねる）

### 出力フォーマット

- Markdown 回答（既存 `growiAgent` の instructions を維持）
- 入力言語と同じ言語で回答（既存 instructions の "ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT" を維持）
- 引用元のページパス/リンクを回答に含めることを推奨（必須要件にするかは requirements フェーズで確定）

### スコープ外

Chat UI / ChatSidebar の改修、タグ検索 / 関連ページ tool、ベクトル検索 / 埋め込み統合、アクセスログ・評価基盤、`fileSearchTool` の最終削除は **本 spec のスコープ外**。

詳細な背景・スコープ境界・上下流依存・制約は [brief.md](./brief.md) を参照。

## Boundary Context

- **In scope**:
  - 既存 `growiAgent` の道具立てとして「ページ本文を取得する手段」を新設すること
  - agent が自然言語クエリに対し、全文検索 tool（既存）と本文取得 tool（新設）を反復的に呼び出して回答を組み立てること
  - リクエスト発行ユーザーの識別情報を tool 実行コンテキストに伝搬し、tool の本文取得がそのユーザーの閲覧権限に従うこと
  - 既存 `fileSearchTool` を agent の利用 tools から一時的に外すこと（コードは残置）
- **Out of scope**:
  - タグ検索 / 関連・最近ページ / クエリ再構成のための新規 tool
  - ベクトル検索 / 埋め込み統合
  - Chat UI / ChatSidebar の改修
  - アクセスログ・検索品質評価基盤
  - `fileSearchTool` の最終削除
  - wiki 内にヒットがない場合の応答方針の明示的な要件化
  - 書き込み系プロンプト（編集・削除など）への対応
- **Adjacent expectations**:
  - 既存の ElasticSearch service をラップした全文検索 tool が `growiAgent` の tools として利用可能な状態であること（ユーザー作業ブランチで先行作成済みであることを前提）
  - 既存のページ閲覧権限ロジック（grant: GRANT_PUBLIC / GRANT_SPECIFIED / GRANT_OWNER / GRANT_USER_GROUP）が `Page` モデルの取得経路で適用される状態を維持していること
  - 既存 `growiAgent` のメモリ・スレッド管理および AI SDK ストリーミング応答が現状の挙動を維持していること
  - 既存の認証・ログイン必須ミドルウェアによって、本機能のエンドポイントは認証済みユーザーのみが利用可能であること

## Requirements

### Requirement 1: 自然言語クエリに対する RAG 的回答生成
**Objective:** GROWI ユーザーとして、自分が閲覧できる wiki コンテンツに関する自然言語の質問を投げ、根拠を踏まえた Markdown 回答を得たい。なぜなら、キーワード一致のリストではなく要点をまとめた回答を素早く受け取りたいから。

#### Acceptance Criteria
1. When ユーザーが wiki コンテンツに関する自然言語の質問を入力したとき、the GROWI Agent shall 既存の全文検索 tool を呼び出して関連ページ候補を取得すること。
2. When 全文検索 tool が候補を返したとき、the GROWI Agent shall 回答の根拠として本文が必要かを判断し、必要な場合は本文取得 tool を呼び出して本文を取得すること。
3. When 取得した情報で回答に不足があると判断したとき、the GROWI Agent shall 別のクエリで全文検索 tool を再度呼び出すこと、または別ページに対して本文取得 tool を呼び出すこと。
4. The GROWI Agent shall 「想定ユーザープロンプトの代表類型」に列挙された直接知識質問・手順抽出・存在確認・比較・曖昧クエリの段階的洗練の各類型に対して、上記の反復ループを通じて回答を試みること。
5. When 反復が完了したと agent が判断したとき、the GROWI Agent shall 収集した情報を要約・整形して 1 つの回答メッセージとして返すこと。
6. The GROWI Agent shall ユーザーが明示的にコード出力を依頼した場合を除き、回答本体を JSON やコードフェンスで包まずに返すこと。

### Requirement 2: ページ本文取得 tool の提供
**Objective:** GROWI Agent として、検索ヒットしたページの本文を引用根拠として参照したい。なぜなら、ハイライト断片だけでは要点を抽出して引用つきの回答を組み立てられないから。

#### Acceptance Criteria
1. When agent が pageId を指定して本文取得 tool を呼び出したとき、the Page Content Tool shall 既存の grant 考慮済みページ取得経路を介して該当ページの本文を返すこと。
2. When agent が pagePath を指定して本文取得 tool を呼び出したとき、the Page Content Tool shall 既存の grant 考慮済みページ取得経路を介して該当ページの本文を返すこと。
3. If pageId と pagePath のいずれも与えられずに本文取得 tool が呼び出された場合、the Page Content Tool shall 入力エラーを示す結果を返すこと（成功・取得失敗と区別可能な形式で）。
4. If 指定されたページが存在しない、または呼び出しユーザーに閲覧権限がない場合、the Page Content Tool shall 取得失敗を表す共通の戻り値を返すこと（成功時と区別可能な形式で）。
5. The Page Content Tool shall ページ本文を Markdown のまま改変せずに返すこと。
6. The Page Content Tool shall 応答に少なくとも該当ページのパスを含めること（agent が回答に引用元として利用できるよう）。
7. The Page Content Tool shall ページ閲覧権限の判定ロジックを自前で実装せず、既存の grant 考慮済みページ取得経路の結果に従うこと。

### Requirement 3: ユーザー識別情報の tool への伝搬
**Objective:** GROWI 運用者として、本機能が呼び出しユーザーの閲覧権限を漏れなく反映していることを保証したい。なぜなら、権限のないユーザーに非公開ページの内容が露出することは絶対に許されないから。

#### Acceptance Criteria
1. When 認証済みユーザーが本機能のメッセージ投稿エンドポイントにリクエストを送ったとき、the Post-Message Handler shall そのユーザーの識別情報を tool 実行コンテキストに付与すること。
2. While 本機能の tool が実行されている間、the Page Content Tool shall 当該リクエストの呼び出しユーザーを判別可能な状態で本文取得を行うこと。
3. If 呼び出しユーザーの識別情報が tool 実行コンテキストから取得できない場合、the Page Content Tool shall ページ本文を返さず、取得失敗を表す共通の戻り値を返すこと。
4. The Post-Message Handler shall 既存の認証・ログイン必須チェックを通過したリクエストに対してのみ tool 実行コンテキストを構築すること。

### Requirement 4: 既存 OpenAI Files 検索 tool の暫定無効化
**Objective:** 開発・動作確認担当者として、Agentic Search の挙動を検証する間、OpenAI Files ベースの旧 `fileSearchTool` が agent から呼ばれないようにしたい。なぜなら、新フローと旧フローが混在すると挙動の検証や原因切り分けが困難になるから。

#### Acceptance Criteria
1. While 本機能が有効な期間中、the GROWI Agent shall `fileSearchTool` を呼び出し可能な tool として保持しないこと。
2. The agentic-search feature shall `fileSearchTool` のソースコードをリポジトリから削除せず、登録のみをコメントアウトによって無効化すること。
3. The GROWI Agent shall `fileSearchTool` を呼ばないことを除き、メモリ・スレッド管理および AI SDK によるストリーミング応答の現状挙動を変更しないこと。

### Requirement 5: 回答の出力フォーマット
**Objective:** GROWI ユーザーとして、根拠と本文位置が分かる形で回答を読みたい。なぜなら、要約だけでなく一次情報のページにも辿り着いて自分で確認したいから。

#### Acceptance Criteria
1. The GROWI Agent shall 回答本体を Markdown 形式で返すこと。
2. The GROWI Agent shall ユーザーの入力言語と同じ言語で回答すること。
3. When 回答の根拠としてページ本文を参照した場合、the GROWI Agent should 該当ページのパスまたはリンクを回答内に含めること。
4. The GROWI Agent shall 回答を AI SDK 互換のストリーミング応答として逐次返すこと（応答完了まで一括待機させないこと）。
