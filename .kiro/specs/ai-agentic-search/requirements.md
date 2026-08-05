# Requirements Document

## Project Description (Input)

GROWI のユーザーは「自然言語で問いを投げて根拠つきの回答を得る」体験を必要としているが、現在の全文検索はキーワード一致のリストを返すまでで止まっており、AI assistant 側にも ElasticSearch を活用した検索能力が組み込まれていない。そのため、既存 wiki 内コンテンツを根拠とした RAG 的な回答ができていない。

本 spec では、既に Mastra (`@mastra/core` ほか) が導入され `growiAgent` が稼働している `apps/app/src/features/mastra/` に対し、以下の拡張を行う:

- **`fullTextSearchTool` を新設**: 自然言語クエリ文字列を受け取り、既存 `SearchService.searchKeyword()` 経由で wiki 内のヒット候補（`pageId` / `pagePath` / `snippet`）を返す Mastra tool。grant（GRANT_PUBLIC / GRANT_SPECIFIED / GRANT_OWNER / GRANT_USER_GROUP）の判定は SearchService 内部の `filterPagesByViewer()` に完全委譲し、tool / agent レイヤーで独自実装しない。ページ本文（`body`）は返さず、責務を `getPageContentTool` に閉じる。
- **`getPageContentTool` を新設**: `pageId` または `pagePath` で本文を取得する Mastra tool。`Page.findByIdAndViewer` / `Page.findByPathAndViewer` 経由で grant を完全準拠。grant 判定は既存メソッド側に委譲し、tool / agent レイヤーで独自実装しない（閲覧不能・存在しない場合は取得失敗を共通の戻り値で返し、agent の振る舞いは LLM の標準挙動に委ねる）。
- **`growiAgent` の `tools` に上記 2 つの新 tool を登録**、instructions に「全文検索 tool でヒット候補を集め、回答の根拠が必要なものは本文取得 tool を呼んで引用せよ」を追記。
- **`requestContext` の型を `{ vectorStoreId; user; searchService }` に拡張**、`post-message.ts` で認証ミドルウェア通過後の `req.user`（`IUserHasId`）と `crowi.searchService` をそのままセット（grant チェック・ES 検索委譲に必要）。`RequestContext` インスタンスはモジュールスコープではなくハンドラ関数内で `new` し、並列リクエスト下の `user` / `searchService` 漏洩を防ぐ。詳細な型シェイプと伝搬経路は design.md「MastraRequestContextShape」を参照。
- **既存 `fileSearchTool` を暫定無効化**: Agentic search の動作確認中に OpenAI Files ベースの fileSearch が邪魔になるため `growiAgent.tools` から外す（コードは残してコメントアウト）。最終削除は本 spec のスコープ外（フォローアップ別タスク）。

期待される動作は、ユーザープロンプトに対して agent が「全文検索 tool で候補抽出 → `getPageContentTool` で本文取得 → 必要に応じて再検索 → 引用つき Markdown 回答」を自律的に反復する RAG 的フローである。

なお、本 spec 完了後の別変更で AI のベクトルストア（OpenAI Files）依存が撤廃され、`fileSearchTool` のソースおよび `requestContext` の `vectorStoreId` は現在は存在しない。`growiAgent` の tools は `fullTextSearchTool` と `getPageContentTool` の 2 本のみである。

### 想定ユーザープロンプトの代表類型

本 spec が確実にサポートを目指す類型:

- **直接知識質問**: 「GROWI で SAML を有効化する手順は?」
- **手順抽出**: 「Docker でのインストール方法を教えて」
- **存在確認**: 「監査ログに関するドキュメントはある?」
- **比較・違い**: 「ページ削除と完全削除の違いは?」
- **曖昧クエリの段階的洗練**: 「権限まわりの設定について」（agent が複数回検索しながらキーワードを洗練）
- **タグ絞り込み前提クエリ**: 「`#meeting` のページから議事録要約」など。agent は `fullTextSearchTool` の `query` に既存 `SearchService.parseQueryString` の `tag:foo` / `-tag:foo` 演算子を組み込んで絞り込むことができる（タグ専用 tool は導入しない — design.md「サポートするクエリ構文」を参照）

本 spec で **明示的に要件化しない** 類型（将来別 spec で扱う、または LLM 標準挙動に委ねる）:

- メタ・時系列クエリ（「最近更新されたページは?」など — 別 spec：関連/最近ページ tool）
- 書き込み系プロンプト（「このページを編集して」など — 本 spec は読み取り専用）
- wiki 内にヒットがない場合の振る舞い（「Next.js とは?」「ジョーク言って」など — LLM 標準挙動に委ねる）

### 出力フォーマット

- Markdown 回答（既存 `growiAgent` の instructions を維持）
- 入力言語と同じ言語で回答（既存 instructions の "ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT" を維持）
- 引用元のページパス/リンクを回答に含めることを推奨（`should`、必須ではない。Requirement 5 参照）

スコープ境界の詳細は下記「Boundary Context」を参照。詳細な背景・上下流依存・制約は [brief.md](./brief.md) を参照。

## Boundary Context

- **In scope**:
  - 既存 `growiAgent` の道具立てとして「ES ベース全文検索 tool」と「ページ本文取得 tool」の 2 つを新設すること
  - agent が自然言語クエリに対し、全文検索 tool と本文取得 tool を反復的に呼び出して回答を組み立てること
  - リクエスト発行ユーザーの識別情報を tool 実行コンテキストに伝搬し、tool の検索・本文取得がそのユーザーの閲覧権限に従うこと
  - 既存 `fileSearchTool` を agent の利用 tools から一時的に外すこと（コードは残置）
- **Out of scope**:
  - タグを主軸とした専用 tool（タグ一覧 / ファセット）/ 関連・最近ページ / クエリ再構成のための新規 tool（`tag:foo` 演算子の `fullTextSearchTool.query` 経由での利用は in scope）
  - ベクトル検索 / 埋め込み統合
  - Chat UI / ChatSidebar の改修
  - アクセスログ・検索品質評価基盤
  - `fileSearchTool` の最終削除
  - wiki 内にヒットがない場合の応答方針の明示的な要件化
  - 書き込み系プロンプト（編集・削除など）への対応
- **Adjacent expectations**:
  - 既存の `SearchService.searchKeyword()` / `ElasticsearchDelegator.search()` および `filterPagesByViewer()` が利用可能で、grant 反映済みのヒット結果を返すこと
  - 既存のページ閲覧権限ロジック（grant: GRANT_PUBLIC / GRANT_SPECIFIED / GRANT_OWNER / GRANT_USER_GROUP）が `Page` モデルの取得経路と `SearchService` の両方で適用される状態を維持していること
  - 既存 `growiAgent` のメモリ・スレッド管理および AI SDK ストリーミング応答が現状の挙動を維持していること
  - 既存の認証・ログイン必須ミドルウェアによって、本機能のエンドポイントは認証済みユーザーのみが利用可能であること

## Requirements

### Requirement 1: 自然言語クエリに対する RAG 的回答生成
**Objective:** GROWI ユーザーとして、自分が閲覧できる wiki コンテンツに関する自然言語の質問を投げ、根拠を踏まえた Markdown 回答を得たい。なぜなら、キーワード一致のリストではなく要点をまとめた回答を素早く受け取りたいから。

#### Acceptance Criteria

agent は、ユーザーの自然言語の質問に対して「全文検索 tool で候補ページを取得 → 回答の根拠に本文が必要なら本文取得 tool を呼ぶ → 情報が不足していれば別クエリで再検索または別ページを取得」を自律的に繰り返し、十分と判断した時点で収集した情報を要約して 1 つの回答メッセージにまとめる。この反復ループは「想定ユーザープロンプトの代表類型」に挙げた直接知識質問・手順抽出・存在確認・比較・曖昧クエリの段階的洗練のいずれに対しても試みられる。回答本体は、ユーザーが明示的にコード出力を求めた場合を除き JSON やコードフェンスで包まない。

**自動テストで検証できない残存ギャップ**: 反復ループが実際に「良い」回答（関連性・要約の質）を生成するかどうかは LLM の判断に依存し、自動テストでは検証できない。手動確認、または将来の回答品質評価基盤（本 spec のスコープ外）に委ねる。

### Requirement 2: ページ本文取得 tool の提供
**Objective:** GROWI Agent として、検索ヒットしたページの本文を引用根拠として参照したい。なぜなら、ハイライト断片だけでは要点を抽出して引用つきの回答を組み立てられないから。

#### Acceptance Criteria

`getPageContentTool` は `pageId` または `pagePath`（少なくとも一方が必須。両方欠如は `missing_input`）を受け取り、既存の grant 考慮済みページ取得経路（`Page.findByIdAndViewer` / `findByPathAndViewer`）経由でのみ内容を取得する。存在しないページと閲覧権限がないページは区別せず、共通の `not_found_or_forbidden` を返す。

応答内容は `offset` の有無で切り替わる。**省略時**（初回読み出し）は見出し一覧である `outline`（行番号・level・見出しテキスト）を返し、長いページ（`totalLines > limit`）では本文（`content`）を返さない。ページ全体が 1 回の呼び出しで収まる小さいページに限り `outline` と `content` の両方を返す。**指定時**（2 回目以降のドリルダウン）は、その行から始まる範囲のみを `content`（1-indexed、`limit` デフォルト 200・最大 500）として返し、`outline` は返さない。`content` は元の Markdown 本文を改変しない slice である。`offset` が `totalLines` を超える場合はエラーにせず `result: 'ok'` + 空の `content` + `hasMore: false` を返す。

成功応答には常に `path` と `totalLines` を含み、`content` を返す場合は `offset` / `limit` / `hasMore`（sanitize 後の echo 値）も含める。ページ閲覧権限の判定ロジックは自前実装せず、既存の grant 考慮済みページ取得経路の結果にすべて従う。

### Requirement 3: ユーザー識別情報の tool への伝搬
**Objective:** GROWI 運用者として、本機能が呼び出しユーザーの閲覧権限を漏れなく反映していることを保証したい。なぜなら、権限のないユーザーに非公開ページの内容が露出することは絶対に許されないから。

#### Acceptance Criteria

Post-Message Handler は、既存の認証・ログイン必須チェックを通過したリクエストに限り、そのユーザーの識別情報を tool 実行コンテキストに付与する。`getPageContentTool` はこの識別情報を使って本文取得を行い、識別情報が取得できない場合はページ本文を返さず取得失敗の共通戻り値を返す。

### Requirement 4: 既存 OpenAI Files 検索 tool の暫定無効化
**Objective:** 開発・動作確認担当者として、Agentic Search の挙動を検証する間、OpenAI Files ベースの旧 `fileSearchTool` が agent から呼ばれないようにしたい。なぜなら、新フローと旧フローが混在すると挙動の検証や原因切り分けが困難になるから。

#### Acceptance Criteria

本機能が有効な間、GROWI Agent は `fileSearchTool` を呼び出し可能な tool として保持しない。無効化は `growiAgent.tools` への登録行をコメントアウトすることで行い、`fileSearchTool` 自体のソースコードは本 spec の範囲では削除しない（即時削除ではなくロールバックコストの低い無効化を選んだ理由は design.md 参照）。`fileSearchTool` を呼ばないこと以外、メモリ・スレッド管理および AI SDK によるストリーミング応答の既存挙動は変更しない。

（本 spec 完了後、`fileSearchTool` は別の変更で完全に削除されており、本要件が求めていた「無効化に留め削除しない」という制約自体は現在は該当しない。）

### Requirement 5: 回答の出力フォーマット
**Objective:** GROWI ユーザーとして、根拠と本文位置が分かる形で回答を読みたい。なぜなら、要約だけでなく一次情報のページにも辿り着いて自分で確認したいから。

#### Acceptance Criteria

GROWI Agent は回答本体を Markdown 形式・ユーザーの入力言語と同じ言語で返し、AI SDK 互換のストリーミング応答として逐次返す（一括待機はしない）。ページ本文を回答の根拠として参照した場合は、該当ページのパスまたはリンクを回答内に含めることが望ましい（`should`、必須ではない）。

**自動テストで検証できない残存ギャップ**: 回答に実際に引用パスが含まれるかどうかは LLM の判断に委ねられており、自動テストでは強制できない。

### Requirement 6: ES 全文検索 tool の提供
**Objective:** GROWI Agent として、自然言語クエリを受けて wiki 内の候補ページを grant 反映済みで列挙したい。なぜなら、ユーザー入力から関連ページを発見できなければ本文取得や反復ループに進めず RAG が成立しないから。

#### Acceptance Criteria

`fullTextSearchTool` は自然言語クエリ文字列（`SearchService.parseQueryString` が解釈する演算子を含む）を受け取り、既存の全文検索経路を介して呼び出しユーザーの閲覧可能なヒット候補のみを返す。各ヒットには少なくとも `pagePath` を含み、`pageId` を含める場合は MongoDB ObjectId 文字列形式とする。`snippet`（ハイライト断片）を含めることが望ましいが、ページ本文（フル Markdown `body`）は返さない（本文取得は `getPageContentTool` の責務）。

ページ閲覧権限の判定ロジックは自前実装せず、既存の grant 反映済み検索経路の結果にすべて従う。呼び出しユーザーの識別情報が取得できない場合、または既存検索経路が例外を発生させた場合は、いずれも例外を agent ループへ throw せず、取得失敗を表す戻り値に変換する（agent ループの継続を保証する）。

agent が `SORT_AXIS`（`relationScore` / `createdAt` / `updatedAt`）および `SORT_ORDER`（`desc` / `asc`）から選んだ `sort` / `order` を指定した場合、tool はそれらを変換せずそのまま `SearchService.searchKeyword` の `searchOpts` に forward する（ユーザーが「最新」「古い」を明示的に求めた際に並び替えを指定できるようにするため）。
