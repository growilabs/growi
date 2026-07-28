# Brief: agentic-search

## Problem
GROWI のユーザーが「自然言語で問いを投げて根拠つきの回答を得る」体験を必要としているが、現在の全文検索は「キーワード一致のリストを返す」までで止まっている。AI assistant 側にも ElasticSearch を活用した検索能力が組み込まれておらず、既存 wiki 内コンテンツを根拠とした RAG 的な回答ができない。

## Current State
- Mastra は `apps/app/src/features/mastra/` に導入済み（`@mastra/core@^1.32.1` ほか）。
- 既存 agent: `growiAgent` ([growi-agent.ts](apps/app/src/features/mastra/server/services/mastra-modules/agents/growi-agent.ts))。現状の tools は OpenAI Files ベクトル検索の `fileSearchTool` のみ。
- ElasticSearch service ([elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts) の `filterPagesByViewer()` ほか) は grant（GRANT_PUBLIC / GRANT_SPECIFIED / GRANT_OWNER / GRANT_USER_GROUP）を反映した検索を実装済み。
- ユーザー作業ブランチ側で、上記 ES service をラップした **全文検索 tool は既に作成済み**（grant を考慮する理由から既存 service を経由）。
- Mastra 公式 `@mastra/elasticsearch` は導入していない。理由: grant を独自に処理する必要があり、純正パッケージでは権限フィルタを差し込めないため。
- ページ本文を grant 付きで取得する側のメソッドも存在: `Page.findByIdAndViewer` / `Page.findByPathAndViewer`。

## Desired Outcome
- `growiAgent` に「ヒット候補から本文を取得して引用根拠とする」道具立てが揃い、ユーザーの自然言語問い合わせに対して **検索 → 本文取得 → 引用つき回答** を agent が自律的に組み立てられる。
- ページの閲覧権限が一切バイパスされない（既存 grant ルール完全準拠）。
- 既存 chat UI に手を入れずとも、agent が新 tool を選択して RAG が成立する。

## Approach
**Approach 1 採用: ページ本文取得 tool を 1 つ追加し、それ以外は既存資産で成立させる。**

- `apps/app/src/features/mastra/server/services/mastra-modules/tools/` 配下に **`getPageContentTool`** を新設。
  - 入力（zod）: `{ pageId?: string; pagePath?: string }`（少なくとも一方は必須）
  - 処理: `requestContext` から `userId` を取り出し、`Page.findByIdAndViewer` または `Page.findByPathAndViewer` を呼び出す。grant 判定は既存メソッド側に委譲する（tool レイヤーで独自実装しない）。
  - 出力: `{ path, revision body (markdown), updatedAt, tags? }` 程度。閲覧不能・存在しない場合は **取得失敗（not found 相当）として共通の戻り値** を返し、agent には特別な扱いをさせない（LLM の標準挙動に委ねる）。
- `growiAgent` の `tools` に新 tool を登録するのみ。agent の instructions に「全文検索でヒットしたページのうち、回答の根拠が必要なものは本文取得 tool を呼んで引用せよ」を 1 行追加。
- `post-message.ts` 側で `requestContext` の型を `{ vectorStoreId: string; userId: string }` に拡張し、リクエスト発行ユーザーの `_id` をセット。
- 既存全文検索 tool（前提として存在）と組み合わせ、agent が反復的に検索 → 本文取得 → 合成を行う。

## Scope
- **In**:
  - `getPageContentTool` の実装（zod スキーマ、execute、grant チェック経由）
  - `growiAgent` への tool 登録と instructions 微調整
  - `requestContext` への `userId` 追加と post-message ルート側のセット
  - tool レベルのユニットテスト（grant あり/なし、path/id 両系統、存在しないページ）
  - **既存 `fileSearchTool` の暫定無効化（コメントアウト）**: Agentic search の動作確認中に OpenAI Files ベースの fileSearch が邪魔になるため、`growiAgent.tools` から外す（コードは残してコメントアウト、削除は次項に委ねる）
- **Out**:
  - タグ検索 tool / 関連ページ tool / クエリ再構成 tool（将来的に別 spec で検討）
  - ベクトル検索 / 埋め込み統合（別スペック）
  - アクセスログ・検索評価基盤（別スペック）
  - Chat UI / ChatSidebar の改修（別スペック）
  - 全文検索 tool 本体の改修（既存資産として参照のみ）
  - **`fileSearchTool` の最終削除**: 本 spec では「コメントアウト無効化」までに留め、Agentic search が想定どおり動作することを確認した後に **別タスク（フォローアップ PR or 別 spec）で完全削除** する

## Boundary Candidates
- **Tool 単体**: `getPageContentTool` の入出力契約と grant チェック挙動
- **Agent 接続**: `growiAgent.tools` への登録と instructions 微調整
- **リクエスト文脈伝搬**: `post-message.ts` の `requestContext` 型と `userId` セット
- **テスト境界**: tool 単体テスト（service 呼び出しはモック）と integration テスト（実 PageModel 経由で grant 反映確認）

## Out of Boundary
- 全文検索 tool 本体の API 変更や戻り値整形（独立した既存資産扱い）
- 他の検索戦略 tool（タグ、関連、クエリ再構成）
- Chat UI 側で本文を表示する見せ方の改修
- Mastra Workflow 化（今回は agent + tools のシンプル構成）
- 非ログインユーザー向けの公開ページ検索特例

## Upstream / Downstream
- **Upstream**:
  - `apps/app/src/server/models/page.ts`（`findByIdAndViewer` / `findByPathAndViewer`）
  - `apps/app/src/server/service/search-delegator/elasticsearch.ts`（既存全文検索 tool 経由）
  - 既存全文検索 tool 実装（ユーザー作業ブランチで先行作成済み）
  - `@mastra/core` の `createTool` API
- **Downstream**:
  - 既存 chat UI / ChatSidebar（本 spec では改修しないが、agent の応答品質を享受する）
  - 将来の追加検索戦略 tool（タグ・関連ページ等）の参照実装

## Existing Spec Touchpoints
- **Extends**: なし（新規 spec）
- **Adjacent**:
  - 既存の `apps/app/src/features/openai/` 配下の AI assistant 実装（将来統合候補だが、本 spec では触らない）
  - 既存全文検索 tool（同じ tools/ ディレクトリ配下に並ぶ）

## Constraints
- **権限**: ページ閲覧権限（grant）は既存 PageService / Page モデル経由で完全準拠。grant 判定を tool 内で独自実装してはならない。
- **依存**: 新規 npm 依存を追加しない。`@mastra/elasticsearch` などの純正パッケージは grant の制約上採用しない。
- **互換性**: `growiAgent` の現状 instructions/メモリ構成を壊さない（追記のみ）。既存 `fileSearchTool` は併存可能。
- **モデル中立**: tool の戻り値は OpenAI 固有形式に依存せず、`@mastra/core` の `createTool` 標準シグネチャに沿う。
- **テスト**: grant 反映の確認はモックではなく実 PageModel を使う integration テストを少なくとも 1 本含める（モック先行で grant 漏れを見落とした過去事例を踏まえる）。
- **言語**: 本 spec の Markdown は日本語で記述（spec.json.language: "ja"）。
