# Design Document: agentic-search

## Overview

**Purpose**: 既存 Mastra `growiAgent` に「ES 全文検索 tool」と「ページ本文取得 tool」の 2 本を新設し、両者を組み合わせた RAG 的反復ループを成立させる。これにより、GROWI ユーザーが自然言語の問い合わせから根拠つき Markdown 回答を得られるようにする。

**Users**: GROWI の認証済みユーザー（既存 ChatSidebar / `useChat` 経由のすべての利用者）。

**Impact**: agent の `tools` 構成を変更（新 tool 2 本追加 + 既存 `fileSearchTool` 暫定無効化）、`RequestContext` 型を拡張し `userId` を伝搬。既存ストリーミング応答層・メモリ・スレッド管理は不変。

### Goals
- `growiAgent` が「全文検索 → 本文取得 → 必要に応じて再検索 → 合成」を自律的に反復する agentic ループを成立させる
- ページ本文取得経路がページ閲覧権限（grant）を完全に既存メソッドへ委譲する
- 新規 tool 2 本（`fullTextSearchTool` + `getPageContentTool`）+ 既存ファイルの軽微修正で実装を完結させる

### Non-Goals
- タグを主軸とした専用 tool（`fullTextSearchTool` とは独立した、タグ一覧・ファセット・関連ページ提示等の新規 tool）の新設（別 spec）
- 関連ページ / 最近更新ページ / クエリ再構成等の新規 tool（別 spec）
- ベクトル検索・埋め込み統合（別 spec）
- ChatSidebar / Chat UI 改修（別 spec）
- アクセスログ・検索品質評価基盤（別 spec）
- `fileSearchTool` の最終削除(フォローアップ別タスク)
- `RequestContext` のモジュールシングルトン構造の根本修正（既存挙動踏襲、別タスクで議論）
- 書き込み系プロンプト・wiki 外知識への明示対応

> **タグによる絞り込み自体は本 spec の対象**: `fullTextSearchTool.query` の演算子として `tag:foo` / `-tag:foo` を agent に開示し、`SearchService.parseQueryString` 経由で利用可能にする（後述「サポートするクエリ構文」）。Non-Goals に含まれるのは「タグ専用の新規 tool」「タグ一覧 / ファセット UX」のみで、タグを使った検索の **能力** そのものは in scope。

## Boundary Commitments

### This Spec Owns
- `fullTextSearchTool`（新規 Mastra tool）の入出力契約、execute 実装、テスト
- `getPageContentTool`（新規 Mastra tool）の入出力契約、execute 実装、テスト
- `growiAgent.tools` の構成変更（新 tool 2 つ登録 + `fileSearchTool` のコメントアウト）と `growiAgent.instructions` の文言調整（旧 `fileSearch` 行のコメントアウトを含む）
- `RequestContext` の型シェイプ拡張（`{ vectorStoreId; userId; searchService }`）
- `post-message.ts` における `userId` および `searchService` の `requestContext` セット
- **`RequestContext` のリクエストスコープ化**: 既存のモジュールスコープ singleton（[post-message.ts:40](apps/app/src/features/mastra/server/routes/post-message.ts#L40)）をハンドラ関数内で `new RequestContext(...)` する構造に変更し、並列リクエスト下での `userId` 漏洩を防止する

### Out of Boundary
- `SearchService.searchKeyword()` / `ElasticsearchDelegator` 内部実装の変更（既存メソッドを呼ぶだけで、内部の検索アルゴリズムや grant ロジックは触らない）
- `Page` モデル / `Revision` モデル / `populateDataToShowRevision()` 等の挙動変更
- ページ閲覧権限（grant）判定ロジック自体の修正・新規実装
- ChatSidebar / `useChat` / AI SDK ストリーミング層の修正
- `fileSearchTool` 本体ファイル（`tools/file-search-tool.ts`）の削除や API 変更
- メモリ・スレッド永続化（`getOrCreateThread` / Mastra Memory）の挙動変更
- 既存の vectorStoreId 伝搬経路の意味論変更（リクエストスコープ化により実装は変わるが、`vectorStoreId` の意味と寿命は不変）

### Allowed Dependencies
- `@mastra/core/tools` の `createTool`
- `@mastra/core/agent` の `Agent`（既存 instance を再利用、再構築しない）
- `@mastra/core/request-context` の `RequestContext` 型
- `zod` による入出力 schema 定義
- `SearchService.searchKeyword()`（既存 ES 検索経路、grant 委譲先）
- `Page.findByIdAndViewer` / `Page.findByPathAndViewer`（grant 委譲経路）
- `populateDataToShowRevision()` または `.populate('revision')`（revision 取得）
- `Revision` モデル（`body` 参照のみ）
- `~/utils/logger`（pino 経由のロガー）

依存方向は **HTTP Layer → Agent Layer → Tool Layer → Page / Revision Model → Mongoose**。tool 層から HTTP 層を逆参照しない。

### Revalidation Triggers
- `Page.findByIdAndViewer` または `Page.findByPathAndViewer` のシグネチャ・戻り値仕様変更
- `RequestContext` ジェネリクスを共有する他コンポーネントの追加 / 型変更（key 衝突発生時）
- `@mastra/core` の `createTool` / `Agent.stream()` API の破壊的変更
- `SearchService.searchKeyword()` のシグネチャ・戻り値スキーマ変更（特に ES delegator の `result.data[i]._id` / `_source.path` / `_highlight.body` の整合）
- 既存 `growiAgent.instructions` の英語ベース構造を逸脱する変更（多言語応答ルールの再検証要）
- `@mastra/core` の `RequestContext` 実装が AsyncLocalStorage 等のリクエスト隔離機構に変わった場合（本 spec のリクエストスコープ化が冗長になる）

## Architecture

### Existing Architecture Analysis

| 既存要素 | 役割 | 本 spec での扱い |
|---|---|---|
| `post-message.ts` Express route | 認証・スレッド確保・`agent.stream()` の呼び出し・SSE 中継 | 軽微修正（userId セット） |
| `mastra-modules/index.ts` の `Mastra` instance | `growiAgent` 登録 | 不変 |
| `growiAgent` (Agent) | tools / memory / instructions を保持 | 構成差分のみ修正 |
| `fileSearchTool` | OpenAI Files ベクトル検索 | コメントアウトで暫定無効化 |
| `RequestContext<{ vectorStoreId }>` | tool 実行時の文脈伝搬 | 型に `userId` と `searchService` を追加 |
| `Page.findByIdAndViewer` / `findByPathAndViewer` | grant 込みでページ取得 | 委譲先として利用 |

既存パターンの維持事項:
- tool は `tools/*.ts` 1 ファイル 1 export
- 入出力 schema は `zod`
- agent instructions は英語短文ベース
- Express route は `accessTokenParser` → `loginRequiredStrictly` → `validator` → handler の順を維持

### Architecture Pattern & Boundary Map

採用パターン: **Mastra agent + tools (Adapter pattern)**。tool は既存ドメインメソッド（Page モデル）への薄い adapter として実装。

```mermaid
graph TB
    subgraph HTTP_Layer
        PostMessage[Post-Message Handler]
        ReqCtx[RequestContext userId]
    end
    subgraph Agent_Layer
        GrowiAgent[growiAgent]
        Instructions[instructions text]
    end
    subgraph Tool_Layer
        FullText[FullTextSearchTool new]
        GetPage[GetPageContentTool new]
        FileSearch[fileSearchTool disabled]
    end
    subgraph Domain_Layer
        PageModel[Page model findByIdAndViewer]
        RevisionModel[Revision model]
    end
    subgraph External
        Mongo[MongoDB]
        Elasticsearch[Elasticsearch]
    end

    PostMessage --> ReqCtx
    PostMessage --> GrowiAgent
    GrowiAgent --> Instructions
    GrowiAgent -.via tools.-> FullText
    GrowiAgent -.via tools.-> GetPage
    GrowiAgent -. disabled .- FileSearch
    FullText --> ReqCtx
    FullText --> SearchService[SearchService searchKeyword]
    SearchService --> Elasticsearch
    GetPage --> ReqCtx
    GetPage --> PageModel
    PageModel --> RevisionModel
    PageModel --> Mongo
    RevisionModel --> Mongo
```

Key 決定:
- tool 層は agent / HTTP 層を逆参照しない（依存方向は片方向）
- `GetPageContentTool` は `Page.findByIdAndViewer` のみを呼ぶ adapter であり、grant の自前判定をしない
- `RequestContext` 経由で渡る `userId` は HTTP 層の信頼境界を通過済み（認証ミドルウェア後）
- `fileSearchTool` は agent との配線のみコメントアウト、ファイル本体・import 行はコメントとして残置

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|---|---|---|---|
| Backend / Agent | `@mastra/core` ^1.32.1（既存） | Agent + tool フレームワーク | 既存 fileSearchTool で実証済み API のみ使用、新依存追加なし |
| Validation | `zod` ^3.x（既存） | tool 入出力スキーマ | 既存 tools が `z.object` で定義済み、同一パターン踏襲 |
| Domain | Mongoose ^6.13.6（既存） + 既存 `Page` モデルメソッド | grant 込みページ取得 | `findByIdAndViewer` / `findByPathAndViewer` を委譲先に |
| Logging | `@growi/logger`（pino, 既存） | tool 内のデバッグログ | 既存 `loggerFactory` 経由 |
| Testing | `vitest` ^x（既存） + `*.spec.ts` / `*.integ.ts` 規約 | unit + integration | Mastra 配下に初の test を追加 |

> 拡張詳細・代替検討は [research.md](./research.md) の Section 1〜2 を参照。

## File Structure Plan

### Directory Structure

```
apps/app/src/features/mastra/server/
├── routes/
│   └── post-message.ts                         # Modified: RequestContext 型拡張 + userId / searchService set + リクエストスコープ化
└── services/mastra-modules/
    ├── types/
    │   └── request-context.ts                  # New: 共有型 MastraRequestContextShape の単一情報源
    ├── agents/
    │   └── growi-agent.ts                      # Modified: tools 構成変更 + instructions 微調整
    └── tools/
        ├── file-search-tool.ts                 # 不変（コメントアウトは agent 側）
        ├── full-text-search-tool.ts            # New: ES 全文検索 tool 本体
        ├── full-text-search-tool.spec.ts       # New: unit test
        ├── full-text-search-tool.integ.ts      # New: integration test (grant 反映確認)
        ├── get-page-content-tool.ts            # New: 本文取得 tool 本体
        ├── get-page-content-tool.spec.ts       # New: unit test
        └── get-page-content-tool.integ.ts      # New: integration test (grant 反映確認)
```

### Modified Files

| File | 変更内容 |
|---|---|
| `agents/growi-agent.ts` | `fileSearchTool` の import + `tools` 登録をコメントアウト。`fullTextSearchTool` / `getPageContentTool` の import 追加と `tools` への **無条件登録**（ES 判定は tool execute 側）。`instructions` の既存 `Use the fileSearch tool ...` 行をコメントアウトし、「全文検索 → 必要なら本文取得 → 引用パス含有」と「`fullTextSearch` の `query` は `"..."` / `-word` / `prefix:/path` / `tag:foo` 等の演算子を組み合わせ可」を英語短文で追記 |
| `routes/post-message.ts` | **モジュールスコープの `const requestContext = new RequestContext<...>()` を削除し、ハンドラ関数内で `new RequestContext<MastraRequestContextShape>()` を生成する構造に変更**（並列リクエスト干渉防止、`MastraRequestContextShape` は `services/mastra-modules/types/request-context.ts` から import）。`requestContext.set('vectorStoreId', ...)` の直後に `requestContext.set('userId', req.user._id.toString())` と `requestContext.set('searchService', crowi.searchService)` を追加 |

### New Files

| File | 責務 |
|---|---|
| `types/request-context.ts` | **共有型の単一情報源**。`MastraRequestContextShape = { vectorStoreId: string; userId: string; searchService: SearchService }` を export。post-message.ts / 各 tool / 将来追加される tool が全て import して `RequestContext<MastraRequestContextShape>` および `context.requestContext as RequestContext<MastraRequestContextShape>` の形で参照する |
| `tools/full-text-search-tool.ts` | Mastra tool の定義（`createTool` 呼び出し、zod schema、execute）。`SearchService.searchKeyword()` の薄い adapter |
| `tools/full-text-search-tool.spec.ts` | unit test。zod 入力検証、guard ロジック、SearchService をモックして戻り値変換を確認 |
| `tools/full-text-search-tool.integ.ts` | integration test。実 MongoDB / Elasticsearch 上で GRANT_* 各パターンの検索ヒット可否を確認 |
| `tools/get-page-content-tool.ts` | Mastra tool の定義（`createTool` 呼び出し、zod schema、execute）。`Page.findByIdAndViewer` / `findByPathAndViewer` の薄い adapter |
| `tools/get-page-content-tool.spec.ts` | unit test。zod 入力検証、guard ロジック、Page モデルをモックして戻り値変換を確認 |
| `tools/get-page-content-tool.integ.ts` | integration test。実 MongoDB 上で GRANT_* 各パターンの取得可否を確認 |

各ファイルは単一責務。新規 export は `MastraRequestContextShape`（共有型）、`fullTextSearchTool` / `getPageContentTool`（tool 定数）と内部 helper のみ（barrel 不要）。

## System Flows

### 反復ループ全体（Sequence）

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant ChatSidebar
    participant PostMessage as Post-Message Handler
    participant Agent as growiAgent
    participant FullText as FullTextSearchTool
    participant SearchSvc as SearchService
    participant GetPage as GetPageContentTool
    participant Page as Page model
    participant Mongo

    User->>ChatSidebar: 質問入力
    ChatSidebar->>PostMessage: POST /_api/v3/mastra/message
    PostMessage->>PostMessage: 認証 + threadId 確保
    PostMessage->>PostMessage: new RequestContext + set vectorStoreId + userId + searchService
    PostMessage->>Agent: stream messages requestContext
    Agent->>FullText: tool call query
    FullText->>FullText: read userId and searchService from requestContext
    FullText->>FullText: gate on searchService.isElasticsearchEnabled
    FullText->>SearchSvc: searchKeyword query user
    SearchSvc-->>FullText: grant filtered hits
    FullText-->>Agent: hit candidates path id snippet
    Agent->>GetPage: tool call pageId or pagePath
    GetPage->>GetPage: read userId from requestContext
    GetPage->>Page: findByIdAndViewer or findByPathAndViewer
    Page->>Mongo: find with grant condition
    Mongo-->>Page: page document or null
    Page-->>GetPage: page or null
    GetPage-->>Agent: result ok or not_found_or_forbidden
    Agent->>Agent: assess sufficiency
    Note over Agent: loop until enough evidence
    Agent-->>PostMessage: stream tokens reasoning text
    PostMessage-->>ChatSidebar: SSE UIMessage stream
    ChatSidebar-->>User: rendered Markdown
```

主な決定:
- `Agent` のループ判断はモデル任せ（明示の Workflow を組まない）
- `GetPageContentTool` は `RequestContext` から `userId` を取り出して `findByIdAndViewer` に渡す
- `Mongo` 側で grant 条件が AND されるため、tool 層で追加フィルタを掛けない

### Tool Execute 分岐 — GetPageContentTool (Process)

```mermaid
flowchart TD
    Start([execute inputData context]) --> CheckCtx{userId in requestContext?}
    CheckCtx -- No --> ContextError[return result context_error]
    CheckCtx -- Yes --> CheckInput{pageId or pagePath present?}
    CheckInput -- Neither --> MissingInput[return result missing_input]
    CheckInput -- pageId --> ById[Page.findByIdAndViewer]
    CheckInput -- pagePath --> ByPath[Page.findByPathAndViewer]
    ById --> Result{page found?}
    ByPath --> Result
    Result -- null --> NotFound[return result not_found_or_forbidden]
    Result -- found --> Populate[populate revision]
    Populate --> Return[return result ok page body path updatedAt]
```

### Tool Execute 分岐 — FullTextSearchTool (Process)

```mermaid
flowchart TD
    Start2([execute inputData context]) --> CheckUser{userId and searchService in requestContext?}
    CheckUser -- No --> CtxErr[return result context_error]
    CheckUser -- Yes --> CheckES{searchService.isElasticsearchEnabled?}
    CheckES -- false --> EsDisabled[return result error reason elasticsearch_not_configured]
    CheckES -- true --> CallSearch[searchService.searchKeyword query user limit]
    CallSearch -- throws --> Err[return result error reason exception]
    CallSearch -- ok --> Map[map result.data to pageId pagePath snippet]
    Map --> Ret[return result ok hits totalCount]
```

Key 決定:
- `execute` は **throw しない**（agent の反復継続のため、必ず discriminated union を返す）
- `userId` 不在は実運用上発生しないが防御的に判定（R3 #3 由来）
- `not_found` と `forbidden` は既存メソッドが区別不可なので 1 つのケースに統合（R2 #4 と合致）

## Requirements Traceability

| Req | Summary | Components | Interfaces | Flows |
|---|---|---|---|---|
| 1.1 | 全文検索 tool 呼び出し | growiAgent, FullTextSearchTool | `Agent.stream` + tool call | 反復ループ Sequence |
| 1.2 | 必要なら本文取得 tool 呼び出し | growiAgent, GetPageContentTool | tool call + instructions | 反復ループ Sequence |
| 1.3 | 不足時の再検索 / 他ページ取得 | growiAgent | LLM 自律ループ | 反復ループ Sequence |
| 1.4 | 想定 5 類型をループでサポート | growiAgent | instructions | 反復ループ Sequence |
| 1.5 | 完了時に整形回答を返す | growiAgent | `Agent.stream` 出力 | 反復ループ Sequence |
| 1.6 | コードフェンス禁止（ユーザー要求時除く） | growiAgent | instructions | — |
| 2.1 | `pageId` で本文取得 | GetPageContentTool | execute(pageId) | Tool Execute 分岐 |
| 2.2 | `pagePath` で本文取得 | GetPageContentTool | execute(pagePath) | Tool Execute 分岐 |
| 2.3 | 入力エラーで判別可能な戻り値 | GetPageContentTool | zod + discriminated union | Tool Execute 分岐 |
| 2.4 | 存在しない/権限なしで共通戻り値 | GetPageContentTool | discriminated union `not_found_or_forbidden` | Tool Execute 分岐 |
| 2.5 | Markdown を改変せず返す | GetPageContentTool | output `body` | — |
| 2.6 | 応答に `path` を含める | GetPageContentTool | output schema | — |
| 2.7 | grant 自前実装禁止 | GetPageContentTool | `findByIdAndViewer` 委譲 | Tool Execute 分岐 |
| 3.1 | userId を requestContext へ付与 | Post-Message Handler | `RequestContext.set('userId', ...)` | 反復ループ Sequence (step 4) |
| 3.2 | tool 内で呼び出しユーザー判別可 | GetPageContentTool | `RequestContext.get('userId')` | Tool Execute 分岐 |
| 3.3 | userId 取得不可で本文返さない | GetPageContentTool | discriminated union `context_error` | Tool Execute 分岐 |
| 3.4 | 認証通過済みのみ tool 実行 | Post-Message Handler | 既存 `loginRequiredStrictly` | 反復ループ Sequence (step 3) |
| 4.1 | agent から fileSearchTool を保持しない | growiAgent | tools 構成変更 | — |
| 4.2 | fileSearchTool ソースは削除しない | growiAgent | import コメントアウト | — |
| 4.3 | メモリ/スレッド/ストリーミング不変 | growiAgent, Post-Message Handler | 既存挙動踏襲 | — |
| 5.1 | Markdown 形式の回答 | growiAgent | instructions | — |
| 5.2 | 入力言語追従 | growiAgent | instructions (既存維持) | — |
| 5.3 | 引用元 path を含める（推奨） | growiAgent, GetPageContentTool | instructions + output `path` | — |
| 5.4 | ストリーミング応答 | Post-Message Handler | 既存 `toAISdkStream` + `pipeUIMessageStreamToResponse` | — |
| 6.1 | 自然言語クエリで検索ヒット返却 | FullTextSearchTool | execute(query) | 反復ループ Sequence |
| 6.2 | 各ヒットに `pagePath` 必須 | FullTextSearchTool | output schema | — |
| 6.3 | `pageId` 形式 ObjectId 文字列 | FullTextSearchTool | output schema | — |
| 6.4 | `snippet` を含める（推奨） | FullTextSearchTool | output schema | — |
| 6.5 | 本文を返さない | FullTextSearchTool | output schema | — |
| 6.6 | userId 取得不可で失敗戻り値 | FullTextSearchTool | discriminated union `context_error` | Tool Execute 分岐 |
| 6.7 | grant 自前実装禁止 | FullTextSearchTool | `SearchService.searchKeyword` 委譲 | 反復ループ Sequence |
| 6.8 | 例外を throw せず戻り値変換 | FullTextSearchTool | discriminated union `error` | — |

## Components and Interfaces

### Shared Types

#### MastraRequestContextShape (新規)

| Field | Detail |
|---|---|
| Intent | post-message handler が `set` し、各 Mastra tool の execute が `get` する全 key の型シェイプを単一情報源として定義 |
| Requirements | 3.1, 3.2, 3.3, 6.6 (型レベルで「key の存在」を担保) |
| File | `services/mastra-modules/types/request-context.ts` |

```typescript
import type SearchService from '~/server/service/search';

/**
 * post-message handler が set し、Mastra tool の execute が get する
 * RequestContext key 群の型シェイプ。
 * - 追加 / リネーム時はこの 1 ファイルを更新するだけで型不整合が
 *   handler / 全 tool 側に伝播する。
 */
export type MastraRequestContextShape = {
  vectorStoreId: string;
  userId: string;
  searchService: SearchService;
};
```

**利用パターン**:
- **post-message.ts (writer)**: `new RequestContext<MastraRequestContextShape>()` で生成
- **各 tool の execute (reader)**: `context.requestContext as RequestContext<MastraRequestContextShape>` で型付きキャスト後 `get('searchService')` 等を呼ぶ。Mastra ランタイムが `context` を typed で渡せない場合の保険として、`typeof returnValue` のランタイム型ガードは引き続き残す（既存 `fileSearchTool` パターンと整合）
- **将来 tool 追加時**: 新 key を `MastraRequestContextShape` に追加 → 影響箇所が TypeScript エラーで全列挙される

### Summary

| Component | Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|---|---|---|---|---|---|
| `MastraRequestContextShape` (Shared Type) | Types | post-message handler と全 tool 間で `RequestContext` の key 契約を共有 | 3.1, 3.2, 3.3, 6.6 | `SearchService` (type, P0) | — |
| `FullTextSearchTool` | Tool | 自然言語クエリで wiki 検索ヒット（pagePath / pageId / snippet）を grant 委譲取得。ES 未設定環境では execute 内で早期 `result: 'error'` を返す | 6.1–6.8, 3.2 | `MastraRequestContextShape` (P0), `SearchService.searchKeyword` (P0, via requestContext), `SearchService.isElasticsearchEnabled` (P0, via requestContext) | Service |
| `GetPageContentTool` | Tool | `pageId` / `pagePath` で本文を grant 委譲取得 | 2.1–2.7, 3.2, 3.3, 5.3 | `MastraRequestContextShape` (P0), `Page.findByIdAndViewer` (P0), `populateDataToShowRevision` (P0) | Service |
| `growiAgent` (Extension) | Agent | RAG ループの自律実行 + tools 構成 + instructions | 1.1–1.6, 4.1–4.3, 5.1–5.3 | `fullTextSearchTool` (P0), `getPageContentTool` (P0), Memory (P0) | Service |
| Post-Message Handler (Extension) | HTTP | `userId` / `searchService` の `requestContext` 付与 + リクエストスコープ化 | 3.1, 3.4, 5.4, 6.6 | `MastraRequestContextShape` (P0), `loginRequiredStrictly` (P0), `IUserHasId` (P0) | API |

### Tool Layer

#### FullTextSearchTool

| Field | Detail |
|---|---|
| Intent | 自然言語クエリを受け取り、既存 `SearchService.searchKeyword()` 経由で grant 反映済みヒット候補（path / id / snippet）を返す Mastra tool |
| Requirements | 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 3.2 |

**Responsibilities & Constraints**
- 入力検証（`query: string` 非空）
- `requestContext` からの `userId` 取得（不在時は失敗戻り値）
- **`requestContext` から `searchService: SearchService` を取得**（不在時は `result: 'context_error'`）。`crowi` 全体ではなく `searchService` のみを渡すことで、tool 層が触れる surface を最小化する
- **`searchService.isElasticsearchEnabled === false` のとき early return**: `result: 'error', reason: 'elasticsearch_not_configured'` を返し、SearchService を呼ばない（要件 6.8 の例外抑制と同じ戻り値型に統合）
- `userId` から `{ _id: new ObjectId(userId) }` 形状の最小オブジェクトを組み立て、`searchService.searchKeyword(query, null, user, null, options)` に渡す
- 検索結果から `pagePath` / `pageId` / `snippet` を抽出した配列にマップ
- ページ本文（`body`）は **返さない**（責務分離）
- 戻り値の discriminated union 整形（`'ok' | 'error' | 'context_error'`）
- **grant 判定の自前実装をしない**（SearchService 経由のみ）
- **execute から例外を throw しない**（agent のループ継続を保証）
- **クエリ構文のサニタイズをしない**: `query` は `SearchService.parseQueryString` ([search.ts:448-520](apps/app/src/server/service/search.ts#L448-L520)) にそのまま渡される。tool 層は `prefix:` / `tag:` / `"phrase"` / `-` 等の演算子を素通しさせ、agent 側で構文を選択させる（後述「サポートするクエリ構文」を参照）

##### サポートするクエリ構文（LLM への開示範囲）

本 spec は **`SearchService.parseQueryString` が現に解釈する全構文を agent に開示する** 方針（Plan A）を採用する。tool 層で構文を制限したりサニタイズしたりせず、`query` 文字列をそのまま既存パーサに委譲する。

| 構文 | 意味 | LLM への開示 |
|---|---|---|
| `word` | 単語 AND マッチ | ✅ 開示（zod description + agent instructions） |
| `-word` | 単語除外 | ✅ 開示 |
| `"exact phrase"` | フレーズ完全一致 | ✅ 開示 |
| `-"exact phrase"` | フレーズ除外 | ✅ 開示 |
| `prefix:/path` | path subtree 絞り込み | ✅ 開示 |
| `-prefix:/path` | path subtree 除外 | ✅ 開示 |
| `tag:foo` | タグ絞り込み | ✅ 開示 |
| `-tag:foo` | タグ除外 | ✅ 開示 |

**根拠と意思決定**:
- (a) RAG ループの効率: `prefix:` による subtree 絞り込みは「手順抽出」「曖昧クエリの段階的洗練」（Req 1.4）でループ短縮効果が大きい。`-` 除外もノイズ削減に有効
- (b) `tag:` を含めるメリット: 「タグ絞り込み前提クエリ」（Req 想定類型）を `fullTextSearchTool` 内で完結させられ、別 tool を新設せずに対応できる。grant フィルタは既存経路（`SearchService.filterPagesByViewer`）が一括で担保するため安全性も既存ページ検索と同等
- (c) 隠蔽コストが高い: 一部だけ開示（例: `prefix:` のみ）にしようとすると tool 層に query パーサ相当のサニタイザを実装する必要があり、`SearchService.parseQueryString` と二重実装になる（Out of Boundary）

**スコープとの関係**:
- 本 spec の **対象**: agent が `tag:foo` / `-tag:foo` を `query` 演算子として使うこと（タグでの絞り込み能力）
- 本 spec の **非対象（別 spec）**: タグ一覧・ファセット UI・関連ページ提示など、タグを主軸にした **専用 tool / UX** の新設
- 検索結果に grant フィルタが二重で効くため、agent が `tag:` を opportunistic に使っても権限漏洩は発生しない（Req 6.7 と一致）

**Dependencies**
- Inbound: `growiAgent.tools` — agent から呼び出される（P0）
- Inbound: `requestContext.get('searchService')` — Post-Message Handler が `crowi.searchService` をセット（P0）
- Outbound: `SearchService.searchKeyword()` — grant 委譲経路（P0、`requestContext` 経由で取得した同インスタンス）
- External: `@mastra/core/tools` `createTool` — tool 定義 API（P0）
- External: `zod` — schema 定義（P0）

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface

```typescript
import type { Tool } from '@mastra/core/tools';
import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';

import type { MastraRequestContextShape } from '../types/request-context';

// execute 内で参照する型: 共有型を使った typed view
type TypedRequestContext = RequestContext<MastraRequestContextShape>;

const fullTextSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      [
        'Search query for the GROWI wiki full-text index.',
        'Write in the user input language; tokens may be combined with the following operators (all optional):',
        '  - "word"            : phrase match (e.g. "release notes")',
        '  - -word / -"phrase" : exclude term / phrase',
        '  - prefix:/path      : restrict to a page-path subtree (e.g. prefix:/docs/install)',
        '  - -prefix:/path     : exclude a subtree',
        '  - tag:foo           : restrict to pages tagged foo',
        '  - -tag:foo          : exclude pages tagged foo',
        'Operators are AND-combined. Use them only when the user intent clearly maps to a subtree, tag, or exclusion; otherwise prefer plain natural language tokens.',
      ].join('\n'),
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .default(10)
    .describe('Maximum number of hits to return'),
});

type FullTextSearchHit = {
  pageId: string;
  pagePath: string;
  snippet?: string;
};

type FullTextSearchSuccess = {
  result: 'ok';
  hits: FullTextSearchHit[];
  totalCount: number;
};

type FullTextSearchFailure = {
  result: 'error' | 'context_error';
  reason: string;
};

const fullTextSearchOutputSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    hits: z.array(
      z.object({
        pageId: z.string(),
        pagePath: z.string(),
        snippet: z.string().optional(),
      }),
    ),
    totalCount: z.number().int().nonnegative(),
  }),
  z.object({
    result: z.enum(['error', 'context_error']),
    reason: z.string(),
  }),
]);

export const fullTextSearchTool: Tool<
  typeof fullTextSearchInputSchema,
  typeof fullTextSearchOutputSchema
>;
```

- **Preconditions**: `requestContext` に `userId` と `searchService` の両方がセットされている。`searchService` が `isElasticsearchEnabled === true` の場合のみ検索を実行する
- **Postconditions**: 戻り値は必ず `fullTextSearchOutputSchema` を満たす。例外は throw されない
- **Invariants**: 閲覧権限のないページが `hits` 配列に決して現れない（SearchService の `filterPagesByViewer` に委譲、二重実装なし）

**Implementation Notes**
- **`searchService` の取得**: execute 内で `const ctx = context.requestContext as RequestContext<MastraRequestContextShape>; const searchService = ctx.get('searchService');` の形で **共有型経由で型付き取得**（`growi-agent.ts` モジュールから `crowi` を import しない方針）。Post-Message Handler 側の `crowi.searchService` 参照を tool まで `RequestContext` 経由で持ち回ることで、`growi-agent.ts` の module-level export を保ったまま条件分岐を tool 層に閉じ込められる。`searchService` が `undefined` の場合は `result: 'context_error'`（共有型上は必須キーだが、Mastra ランタイムの動的取得である以上、防御的に型ガードを残す）
- Integration: `searchService.searchKeyword(keyword, nqName, user, userGroups, searchOpts)` を呼ぶ。`nqName: null`、`userGroups: null`（SearchService 内部で user から自動解決）、`searchOpts` で limit を渡す。**戻り値は `Promise<[ISearchResult<unknown>, string | null]>` のタプル** であり、`const [result, _delegatorName] = await searchService.searchKeyword(...)` の形で分解する。
- マッピング規則（[elasticsearch.ts:470-484](apps/app/src/server/service/search-delegator/elasticsearch.ts#L470-L484) の ES index 投入ロジックと [elasticsearch.ts:736-750](apps/app/src/server/service/search-delegator/elasticsearch.ts#L736-L750) の delegator 戻り値を根拠）:

  | tool 出力 | 取り出し元 |
  |---|---|
  | `pageId` | `result.data[i]._id`（ES document ID = `page._id` の文字列） |
  | `pagePath` | `result.data[i]._source.path` |
  | `snippet` | `result.data[i]._highlight?.body?.[0]`（ES highlight 結果の先頭） |
  | `totalCount` | `result.meta.total` |

- **`_source` を spread しないこと**: ES に index されたドキュメントには `body`（page revision の Markdown 全文）が含まれる（[elasticsearch.ts:472](apps/app/src/server/service/search-delegator/elasticsearch.ts#L472)）。`{ pageId, ...data[i]._source }` のような無造作な spread は要件 6.5 と本 spec の役割分離（`getPageContentTool` との責務境界）を破壊するため禁止。必要なフィールドのみを明示的に取り出すこと
- Validation: zod 入力で `query.min(1)` を強制し、空クエリで SearchService を呼ばない
- **クエリ構文の素通し**: `query` の中身に対して `prefix:` / `tag:` / `"..."` / `-` 等の演算子検出や除去は行わない。文字列を `SearchService.searchKeyword(query, ...)` にそのまま渡し、`parseQueryString` に解釈させる（[search.ts:448-520](apps/app/src/server/service/search.ts#L448-L520)）。サニタイザを設けると `parseQueryString` の二重実装になり保守コストが増えるため避ける
- Risks: ES がダウンしている場合、SearchService が例外を投げる可能性。tool 内 try/catch で `result: 'error'` に変換し agent ループ継続を保証

#### GetPageContentTool

| Field | Detail |
|---|---|
| Intent | `pageId` / `pagePath` で grant 込みのページ本文を取得する Mastra tool（既存メソッドへの薄い adapter） |
| Requirements | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.2, 3.3, 5.3 |

**Responsibilities & Constraints**
- 入力検証（少なくとも `pageId` または `pagePath`）
- `requestContext` からの `userId` 取得（不在時は失敗戻り値）
- `Page.findByIdAndViewer` / `findByPathAndViewer` への委譲
- revision の populate と `body` の抽出
- 戻り値の discriminated union 整形
- **grant 判定の自前実装をしない**（必ず既存メソッド経由）
- **execute から例外を throw しない**（agent のループ継続を保証）

**Dependencies**
- Inbound: `growiAgent.tools` — agent から呼び出される（P0）
- Outbound: `Page.findByIdAndViewer` / `findByPathAndViewer` — grant 委譲経路（P0）
- Outbound: `populateDataToShowRevision()` — revision 取得（P0）
- External: `@mastra/core/tools` `createTool` — tool 定義 API（P0）
- External: `zod` — schema 定義（P0）

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface

```typescript
import type { Tool } from '@mastra/core/tools';
import type { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';

import type { MastraRequestContextShape } from '../types/request-context';

// execute 内で参照する型: 共有型を使った typed view
type TypedRequestContext = RequestContext<MastraRequestContextShape>;

const getPageContentInputSchema = z
  .object({
    pageId: z
      .string()
      .optional()
      .describe('MongoDB ObjectId of the page to fetch'),
    pagePath: z
      .string()
      .optional()
      .describe('Page path starting with "/"'),
  })
  .refine(
    (input) => input.pageId != null || input.pagePath != null,
    {
      message: 'Either pageId or pagePath must be provided',
    },
  );

type GetPageContentSuccess = {
  result: 'ok';
  page: {
    path: string;
    body: string;
    updatedAt: string;
  };
};

type GetPageContentFailure = {
  result: 'not_found_or_forbidden' | 'missing_input' | 'context_error';
  reason: string;
};

const getPageContentOutputSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    page: z.object({
      path: z.string(),
      body: z.string(),
      updatedAt: z.string(),
    }),
  }),
  z.object({
    result: z.enum(['not_found_or_forbidden', 'missing_input', 'context_error']),
    reason: z.string(),
  }),
]);

export const getPageContentTool: Tool<
  typeof getPageContentInputSchema,
  typeof getPageContentOutputSchema
>;
```

- **Preconditions**: `requestContext` に `userId` がセットされている（`Post-Message Handler` の責務）
- **Postconditions**: 戻り値は必ず `getPageContentOutputSchema` を満たす。例外は throw されない
- **Invariants**: 閲覧権限のないページの内容は決して `result: 'ok'` の `page.body` に現れない（grant 委譲不変条件）

**Implementation Notes**
- Integration: `Page.findByIdAndViewer(id, user)` の `user` 引数は内部で `user._id` のみ参照する（[generateGrantCondition (page.ts:1287)](apps/app/src/server/models/page.ts#L1287) と [findAllUserGroupIdsRelatedToUser (user-group-relation.ts:170)](apps/app/src/server/models/user-group-relation.ts#L170) の両方で `_id` 以外のフィールドを使用しないことを確認済み）。tool 内では `requestContext` の `userId: string` から `{ _id: new mongoose.Types.ObjectId(userId) }` 形状の最小オブジェクトを組み立てて渡せばよく、**追加の `User.findById()` クエリは不要**
- Validation: zod の `refine` で「id/path どちらか必須」を表現、execute 内で zod の validation 結果を直接戻り値に変換しない（Mastra が `outputSchema` 検証を行うため）
- Risks: 既存 `findByIdAndViewer` が `includeAnyoneWithTheLink: true` を内部固定するため、GRANT_RESTRICTED ページが RAG コンテキストに混入する（research.md R-3）。本 spec では既存挙動を踏襲し integration test で挙動を明文化

### Agent Layer

#### growiAgent (Extension)

| Field | Detail |
|---|---|
| Intent | `tools` 構成と `instructions` を本機能向けに更新（既存 Agent インスタンスの設定差分） |
| Requirements | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3 |

**Responsibilities & Constraints**
- `tools` に `fullTextSearchTool` と `getPageContentTool` を **常に登録**（条件分岐なし）
- **ES 有効/無効の判定は tool execute 側に委譲**: `fullTextSearchTool.execute` が `requestContext.get('searchService').isElasticsearchEnabled` を判定し、無効時は `result: 'error', reason: 'elasticsearch_not_configured'` を返す。これにより `growi-agent.ts` は module-level export を保ったまま `crowi` 依存を持たず、Mastra 標準パターンから外れない
- `fileSearchTool` の import 行と tools 登録行をコメントアウト（コードは残置）
- `instructions` に以下の編集を行う（英語短文、既存トーン維持）:
  - **既存の `- Use the fileSearch tool when the question relates to the user's wiki content.` 行はコメントアウト**（即時削除しない理由: `fileSearchTool` 復活時の rollback コストを下げる、要件 4.2 と同一方針）
  - 新規追記 (2〜3 行): 「wiki 内コンテンツ関連の質問はまず `fullTextSearch` tool を呼び、必要に応じて `getPageContent` tool で本文を取得して引用パスを回答に含めること」
  - 新規追記: 「`fullTextSearch` の `query` には自然言語に加えて以下の演算子を必要に応じて組み合わせて良い: `"phrase"`, `-term`, `prefix:/path`, `tag:foo`, `-prefix:` / `-tag:`（全て AND）。これらは subtree / タグ絞り込み・ノイズ除去のために使う」
- メモリ・スレッド・モデル設定は変更しない（4.3）

**Dependencies**
- Inbound: `mastra-modules/index.ts` の `Mastra` instance — agent registration（P0）
- Inbound: `post-message.ts` の `mastra.getAgent('growiAgent')` 呼び出し（P0）
- Outbound: `fullTextSearchTool`（P0）
- Outbound: `getPageContentTool`（P0）

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface

```typescript
// 既存 Agent インスタンスの形状（変更ポイントのみ抜粋）
export const growiAgent = new Agent({
  id: 'growiAgent',
  name: 'GROWI Agent',
  instructions: `You are an AI assistant that helps users search and understand content in their GROWI wiki.

  # CRITICAL INSTRUCTION
  - ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT.
  - Respond in Markdown. Do NOT wrap your response in JSON or code fences unless the user is asking for code.
  // - Use the fileSearch tool when the question relates to the user's wiki content.   // disabled: see spec agentic-search
  - When a question relates to the user's wiki content, first call the fullTextSearch tool to gather candidate pages, then call the getPageContent tool for any page whose body you need as evidence. Include the page path you cited in the answer.
  - The fullTextSearch query supports plain natural-language tokens combined with: "phrase", -term, -"phrase", prefix:/path, -prefix:/path, tag:foo, -tag:foo (all AND-combined). Use these operators only when the user intent maps to a subtree, tag, or exclusion.
  - Keep answers concise and well-structured with headings, lists, and links where helpful.
  `,
  model: getOpenaiProvider()(model),
  tools: {
    // fileSearchTool, // disabled: see spec agentic-search
    fullTextSearchTool,
    getPageContentTool,
  },
  memory,
});
```

**Implementation Notes**
- Integration: `fullTextSearchTool` と `getPageContentTool` の両方を **無条件で** `tools` に登録。両 tool は本 spec で同時に新設するためマージ順序問題なし。ES 無効時の振る舞いは `fullTextSearchTool.execute` 内 (`searchService.isElasticsearchEnabled` 判定) に閉じる
- **`crowi` を import しないこと**: `growi-agent.ts` は module-level export を維持し、`crowi` を直接参照しない。`searchService` は `requestContext` 経由で tool に伝搬される（Post-Message Handler の責務）
- Validation: build + lint で「未使用 import の指摘が出ないこと」を確認（コメントアウトされた `fileSearchTool` の import / instruction 行が lint で警告にならない書き方を選ぶ）
- Risks: instructions の文言が冗長になると LLM のコンテキスト消費が増える。上記 2〜3 行の追記に留め、無関係な装飾は加えない

### HTTP Layer

#### Post-Message Handler (Extension)

| Field | Detail |
|---|---|
| Intent | `RequestContext` 型を拡張し、認証済みユーザーの `_id` を `userId` として tool 実行コンテキストにセットする |
| Requirements | 3.1, 3.4, 5.4 |

**Responsibilities & Constraints**
- `RequestContext<{ vectorStoreId: string }>` を **`RequestContext<MastraRequestContextShape>`** に拡張（`MastraRequestContextShape` は `services/mastra-modules/types/request-context.ts` から import）
- **`RequestContext` インスタンスをハンドラ関数内で `new` する**（モジュールスコープ singleton を廃止）。これにより並列リクエスト下で他リクエストの `userId` / `searchService` が tool に渡る可能性を排除
- 既存の `accessTokenParser` → `loginRequiredStrictly` → `validator` ミドルウェアチェーンを変更しない
- 既存の `requestContext.set('vectorStoreId', ...)` の直後に以下 2 つの `set` を追加:
  - `requestContext.set('userId', req.user._id.toString())`
  - `requestContext.set('searchService', crowi.searchService)` ← `crowi` は route factory 引数として既に scope に存在する
- ストリーミング応答層（`toAISdkStream` / `pipeUIMessageStreamToResponse`）は変更しない

**Dependencies**
- Inbound: Next.js / Express ルーティング（P0）
- Outbound: `growiAgent.stream(messages, { requestContext, memory, providerOptions })`（P0）
- Outbound: `MastraRequestContextShape` ジェネリクス型 — 共有型として全 tool が参照（P0）

**Contracts**: Service [ ] / API [x] / Event [ ] / Batch [ ] / State [ ]

##### API Contract

| Method | Endpoint | Request | Response | Errors |
|---|---|---|---|---|
| POST | `/_api/v3/mastra/message` | `{ threadId?, aiAssistantId, messages: UIMessage[] }`（既存と同一） | `text/event-stream` UI Message Stream（既存と同一） | 400 validation, 401 unauth, 404 missing AI assistant, 500 internal（既存と同一） |

本 spec で API スキーマ自体は変更しない（内部の `requestContext` 構築が変わるのみ）。

**Implementation Notes**
- Integration: `@mastra/core` の `RequestContext` は単純な `Map` ラッパーであり AsyncLocalStorage 等の自動隔離機構を持たない（[chunk-4RQN7U3L.js:20](node_modules/.pnpm/@mastra+core@1.32.1_*/node_modules/@mastra/core/dist/chunk-4RQN7U3L.js)）。そのため本 spec では `new RequestContext()` をハンドラ関数内に閉じ、リクエストごとに独立した Map インスタンスを使う。`vectorStoreId` の値の意味は不変
- **共有型の参照**: `import type { MastraRequestContextShape } from '~/features/mastra/server/services/mastra-modules/types/request-context'`。`SearchService` 型は当該ファイルが `~/server/service/search` の **default export** ([search.ts:673](apps/app/src/server/service/search.ts#L673)) を `import type SearchService` する形で間接的に参照
- Validation: 既存 `validator` チェーンで `req.user` が `IUserHasId` として保証されるため、`req.user._id.toString()` 直呼び出しは安全
- Risks: なし（リクエストスコープ化により既存の潜在的レースコンディションを解消する）

## Data Models

本機能は新規 DB スキーマを追加しない。Mongoose レベルでの参照は既存のみ。

### Tool I/O Schema（再掲）

両 tool の入出力は前掲の zod schema（各 Service Interface 参照）に従う。`outputSchema` はそれぞれ discriminated union で複数の結果型を持つ:

| Tool | `result` 値 | 補足 |
|---|---|---|
| `FullTextSearchTool` | `'ok'` / `'error'` / `'context_error'` | `'ok'` は `hits` + `totalCount`、その他は `reason: string` |
| `GetPageContentTool` | `'ok'` / `'not_found_or_forbidden'` / `'missing_input'` / `'context_error'` | `'ok'` は `page { path, body, updatedAt }`、その他は `reason: string` |

### Page / Revision（既存・参照のみ）

- `Page`: `path: string`, `revision: ObjectId(ref Revision)`, `grant: number`, `grantedUsers`, `grantedGroups`, ほか既存スキーマ
- `Revision`: `body: string`（Markdown、`format: 'markdown'` 注記）, `updatedAt: Date`

本 spec で `Page` / `Revision` スキーマ自体は変更しない。`Page.findByIdAndViewer` 等の戻り値型に依存。

## Error Handling

### Strategy

両 tool（`FullTextSearchTool` / `GetPageContentTool`）とも **例外を throw しない方針**。すべての異常系を discriminated union の戻り値で表現する。これにより:
- agent のループが中断されず、agent が次の判断（再検索 / 別ページ取得 / 回答合成断念）に進める
- HTTP 層の `try/catch` で握り潰される懸念がない

### Categories

#### GetPageContentTool

| Category | 戻り値 | 発生条件 | Handler |
|---|---|---|---|
| Input validation | `result: 'missing_input'` | `pageId` も `pagePath` も与えられない | tool 内 zod refine、`reason` に英語短文 |
| Access denial / missing | `result: 'not_found_or_forbidden'` | `Page.findByIdAndViewer` が `null` を返す | `reason` に「存在しないか閲覧権限がない」旨を含める |
| Context missing | `result: 'context_error'` | `requestContext` から `userId` を取り出せない | 防御的判定、運用上は到達しない（R3 #4 の認証ミドルウェアで保証） |
| Unexpected Mongoose error | log + 共通失敗戻り値（`not_found_or_forbidden`）にフォールバック | DB 接続喪失等 | `logger.error` で記録、agent には共通失敗で返す |

#### FullTextSearchTool

| Category | 戻り値 | 発生条件 | Handler |
|---|---|---|---|
| Input validation | （zod `min(1)` で空クエリ拒否）| `query` が空文字列 | Mastra ランタイムが zod 検証段階で弾く（tool execute に到達しない） |
| Context missing | `result: 'context_error'` | `requestContext` から `userId` または `searchService` を取り出せない | 防御的判定、運用上は到達しない |
| Elasticsearch disabled | `result: 'error', reason: 'elasticsearch_not_configured'` | `searchService.isElasticsearchEnabled === false` | OSS デプロイで ES URI 未設定の場合に発生。agent は LLM 標準挙動で他の応答方針に切り替える |
| Search exception | `result: 'error', reason: <message>` | `searchService.searchKeyword(...)` が reject | `logger.error` で記録、agent には `'error'` で返す（要件 6.8） |

### Monitoring

- `loggerFactory('growi:tools:full-text-search-tool')` と `loggerFactory('growi:tools:get-page-content-tool')` で各 execute 経路をログ
- 失敗戻り値発生時にも warn レベルでログ（grant / ES 設定 / 例外 のどれが起因かの切り分けに必要）
- agent ストリーム経路は既存 `post-message-handler` の `logger.error` を維持

## Testing Strategy

### Unit Tests (`full-text-search-tool.spec.ts`)

1. zod 入力 schema が空クエリを弾く（6.1）
2. `requestContext.get('userId')` が `undefined` のとき `result: 'context_error'` を返す（6.6, 3.2）
3. `requestContext.get('searchService')` が `undefined` のとき `result: 'context_error'` を返す（6.6）
4. `searchService.isElasticsearchEnabled === false` のとき `result: 'error', reason: 'elasticsearch_not_configured'` を返し、`searchKeyword` は呼ばれない（要件 6.1 / OSS デプロイ対応）
5. `searchService.searchKeyword` をモックして結果配列を `{ pageId, pagePath, snippet }` 形にマップ（6.2, 6.3, 6.4）
6. SearchService の戻り値に `body` が含まれていても tool 出力には含めないこと（6.5）
7. SearchService が reject された場合に `result: 'error'` を返し execute が throw しないこと（6.8）
8. `userId` が ObjectId 文字列として SearchService に渡されること（6.7）
9. **クエリ構文の素通し**: `query` に `prefix:/docs -draft tag:meeting "release notes"` 等の演算子を含む文字列を渡したとき、tool 層で文字列が改変されず `SearchService.searchKeyword` の第 1 引数にそのまま渡ること（サニタイザ不在の保証、本 spec の Plan A 採用根拠）

### Unit Tests (`get-page-content-tool.spec.ts`)

1. zod 入力 schema が `pageId` も `pagePath` も無いケースを `missing_input` で弾く（2.3）
2. `requestContext.get('userId')` が `undefined` のとき `result: 'context_error'` を返す（3.3）
3. `Page.findByIdAndViewer` をモックして `null` 返却時に `result: 'not_found_or_forbidden'` を返す（2.4）
4. モックされた成功ケースで `result: 'ok'` + 正しい `path` / `body` / `updatedAt` を返し、`body` が改変されない（2.5, 2.6）
5. `pageId` 指定時に `findByIdAndViewer` が呼ばれ、`findByPathAndViewer` は呼ばれない（2.1）
6. `pagePath` 指定時に `findByPathAndViewer` が呼ばれ、`findByIdAndViewer` は呼ばれない（2.2）
7. tool 内で例外を throw しないこと（agent ループ継続保証のため、Mongoose mock を error reject にしても戻り値で返ること）

### Integration Tests (`full-text-search-tool.integ.ts`)

実 MongoDB + Elasticsearch + SearchService を使い、以下のシナリオを確認:

1. GRANT_PUBLIC ページがインデックスされている状態でクエリ → `hits` に該当 path が含まれる（6.1, 6.7）
2. GRANT_OWNER の他者ページは hits に含まれない（6.7）
3. GRANT_USER_GROUP の所属メンバーは hits に含み、非所属メンバーは含まない（6.7）
4. ヒットなしクエリで `result: 'ok'` かつ `hits: []`, `totalCount: 0`（6.1）
5. Elasticsearch が停止している状態で `result: 'error'` を返し例外を throw しないこと（6.8、可能なら ES 接続文字列をモック）

### Integration Tests (`get-page-content-tool.integ.ts`)

実 MongoDB + Page/Revision モデルで以下のシナリオを確認（`page.integ.ts` パターン踏襲）:

1. GRANT_PUBLIC ページを認証済みユーザーで取得 → `result: 'ok'`（2.1, 2.7）
2. GRANT_OWNER の他者ページを別ユーザーで取得 → `result: 'not_found_or_forbidden'`（2.4, 2.7）
3. GRANT_USER_GROUP の所属メンバーで取得 → `result: 'ok'`、非所属メンバーで取得 → `result: 'not_found_or_forbidden'`（2.7）
4. GRANT_RESTRICTED（リンク共有）を path 指定で取得 → `result: 'ok'`（既存挙動明文化、research.md R-3）
5. 存在しない pageId → `result: 'not_found_or_forbidden'`（権限なしと区別しないことの確認、2.4）
6. `pagePath` 指定でも grant が反映されること（2.2, 2.7）

### Agent Integration Tests（オプション、本 spec 必須ではない）

`growiAgent.tools` のキー一覧で `fullTextSearchTool` と `getPageContentTool` の両方の存在、および `fileSearchTool` の非存在を assertion。さらに `growiAgent.instructions` 文字列に `fileSearch` の文字列が（コメントアウト行を除いて）含まれていないこと、新規追記の「fullTextSearch → getPageContent → 引用パス」と演算子説明が含まれることを assert。mock model で 1〜2 ターン回し agent が両 tool を tool として参照可能であることを確認。実装時に手間が小さいなら追加、`fileSearchTool` 暫定無効化（4.1）と instruction 矛盾（FB Issue 2）の回帰防止に有用。

### E2E / UI

本 spec のスコープ外（Chat UI 改修なしのため）。回帰検出は手動動作確認で行う。

## Security Considerations

- **grant 委譲の完全性（R2 #7）**: tool 内で MongoDB クエリを自前構築しない。すべての本文取得は `findByIdAndViewer` / `findByPathAndViewer` 経由に統一。レビューで既存メソッド以外の Page 読み取り経路を許可しない
- **`requestContext` のリクエスト隔離（本 spec で対処）**: `userId` は認証ミドルウェア通過後の `req.user._id` から派生するため改竄の余地なし。`searchService` も route factory 引数 `crowi` から取得するため改竄不可。`@mastra/core` の `RequestContext` は内部的に単純な `Map` ラッパーで自動的なリクエスト隔離機構を持たないため、本 spec ではモジュールスコープ singleton を廃止しハンドラ関数内で `new RequestContext()` する。この変更により、並列リクエスト下で他リクエストの `userId` / `searchService` が tool 内 `get(...)` で読み出される可能性を排除する
- **`searchService` を `requestContext` に載せる根拠**: `crowi` 全体を渡すと tool 層から DB / メール / 設定など全機能にアクセス可能になりレイヤリングが崩れる。本 spec では「`fullTextSearchTool` が必要とする最小 surface = `searchService`」のみを `RequestContext` に格納し、tool 層の触れる API を意図的に狭める
- **失敗戻り値の情報漏洩防止**: `not_found_or_forbidden` を共通化することで「存在するが閲覧不可」と「そもそも存在しない」を agent に区別させない。回答経由でユーザーに非公開ページの存在が漏れない
- **GRANT_RESTRICTED の扱い**: 既存 `findByIdAndViewer` の `includeAnyoneWithTheLink: true` 仕様により、リンク共有ページが RAG コンテキストに含まれる可能性がある。本 spec ではこれを既存仕様として許容、integration test 5.5 で挙動を明文化（research.md R-3）

## Migration Strategy

- DB マイグレーション不要（スキーマ変更なし）
- フィーチャーフラグ不要（既存 agent への追加であり、有効化/無効化は `growiAgent.tools` 構成変更で即時切替可能）
- **ES 未設定環境への自動対応**: `fullTextSearchTool` は無条件で agent に登録されるが、execute 内の `searchService.isElasticsearchEnabled` ガードにより未設定環境では `result: 'error'` を返すのみで副作用ゼロ。OSS デプロイ向けの追加設定や別ビルドは不要
- Rollback: revert commit のみで復旧。`fileSearchTool` は import / instruction 行ともコメントアウトのため即座に再有効化可能（コメントを外して `fullTextSearchTool` / `getPageContentTool` を再度コメントアウトすれば元の挙動）

## Open Questions

design 段階で残る未確定事項（実装中に解決）:
- **R-2**: Mastra ランタイムで tool execute が throw した場合の UI ストリーム挙動 — 本 spec は throw しない方針なので影響なし、`full-text-search-tool.spec.ts` 7 番および `get-page-content-tool.spec.ts` 7 番で回帰防止
- **R-4**: `fileSearchTool` のコメントアウト後の lint 挙動 — Biome は未使用 import / コメント行を警告しない想定。実装時に build を回して確認

design レビューで解消した項目（参考）:
- ~~**R-1**: `Page.findByIdAndViewer` の `user` 引数最小要件~~ → `user._id` のみ参照と判明。tool 内で `{ _id: new ObjectId(userId) }` を組み立てるだけで十分、追加クエリ不要
- ~~**RequestContext シングルトン問題**~~ → 本 spec で `new RequestContext()` をハンドラ内に閉じる対応を In-Boundary に含めることで解消
- ~~**`crowi.searchService` を `growi-agent.ts` から参照する経路**~~ → `searchService` を `RequestContext` 経由で tool に渡す方針に変更し、`growi-agent.ts` の module-level export を維持しつつ ES 判定を tool execute 内に閉じ込めることで解消（FB Issue 1）

詳細は [research.md](./research.md) Section 5.3 を参照。
