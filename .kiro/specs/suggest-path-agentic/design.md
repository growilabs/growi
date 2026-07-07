# Technical Design: suggest-path-agentic

> **実態追従改訂（2026-07-06）**: 実装完了・A/B 受け入れ後に、support/mastra マージによる provider-agnostic AI レイヤ移行（`getOpenaiProvider` → `resolveMastraModel`、コミット 70bde80571 / c4a58793bf）、listChildren tool の追加（#185213）、instructions チューニング（302d974819 / 066d1776de）を本文へ反映した。要判断として残る 2 点は Config Keys の DEAD KEY 注記と reasoningEffort の provider 名前空間注記を参照。

## Overview

**Purpose**: 本機能は suggest-path API のパス提案エンジンを、ワンショット検索構成（キーワード抽出 → ES 検索 1 回 → LLM 候補評価）から、Mastra Agent による agentic search（検索結果を元文書と照らして検索語・条件を変えながら複数回探索する挙動）に換装可能にする。最初の検索が語彙ミスマッチで外れても API 単体で妥当な保存先候補に辿り着けるようにし、MCP クライアント側の検索肩代わりを不要にする（Redmine #184610）。

**Users**: MCP クライアント（GROWI MCP の suggestPath ツール利用者）は従来通りの API 契約で改善された提案を受け取る。開発チーム・検証者はエンジン切り替えにより #183968 評価環境で A/B 測定を行う。運用者は設定（エンジン・検索回数上限・モデル・タイムアウト）でレスポンス時間と精度のトレードオフを制御する。

**Impact**: 既存の `generate-suggestions.ts` をオーケストレータ（memo 生成 + エンジンディスパッチ + フォールバック）に再構成し、ワンショットパイプラインと新設の agentic エンジンを切り替え式で並存させる。既存ワンショット 4 サービス（analyze / retrieve / evaluate / category）は無改変。API の外部契約（エンドポイント・リクエスト形式・レスポンス型・認証）は維持する。

### Goals

- agentic search エンジンの新設: 複数回検索 + 候補ページ本文参照による試行錯誤で保存先提案を生成する
- フロー/ストック判定を探索の誘導（候補妥当性判断・再検索の方向付け）に反映する
- 検索回数上限・タイムアウト・モデルを設定で制御可能にする
- 新旧エンジンの切り替え並存と、#183968 評価環境での A/B 測定（ベースライン 41/60 との比較）を可能にする

### Non-Goals

- HTC によるリランク（別ストーリー）、セマンティック検索の導入
- MCP クライアント側の挙動変更、チャット機能・`growiAgent` の改修
- ワンショットエンジンの削除（検証結果を踏まえ別途判断）
- 既定エンジンの agentic への切り替え（検証完了後に別途判断。本 spec では既定 'oneshot' を維持）
- `fullTextSearchTool` / `getPageContentTool` の機能改修（必要が生じた場合は agentic-search spec のフォローアップ）

## Boundary Commitments

### This Spec Owns

- suggest-path のエンジン選択機構: `SuggestPathEngine` インターフェース、エンジンディスパッチ、リクエストレベル override、フォールバックポリシー
- agentic エンジン一式: `suggestPathAgent`（Agent 定義 + instructions）、budget 付き検索 wrapper tool、suggest-path 専用 RequestContext 拡張型、structured output の JSON Schema と型ガード、エンジンアダプタ（タイムアウト・出力マッピング・grant 解決・トレースログ）
- 新設定キー 4 つ（エンジン既定・検索回数上限・タイムアウト・agentic 用モデル）の定義と既定値
- 探索過程の記録（トレースログ）の形式と出力
- `suggestPathAgent` の Mastra インスタンスへの登録（`mastra-modules/index.ts` への additive な 1 行。レジストリ機構自体は agentic-search spec の所有）

### Out of Boundary

- チャット向け `growiAgent` の挙動（agentic-search spec が所有）
- 共有 tool（`fullTextSearchTool` / `getPageContentTool`）の本体改修
- ワンショットエンジンを構成する 4 サービス（`analyze-content` / `retrieve-search-candidates` / `evaluate-candidates` / `generate-category-suggestion`）の内部変更
- ワンショットエンジンの削除、既定エンジンの本番切り替え判断
- 評価環境そのもの（#183968 の成果物を利用するのみ）
- 既存 suggest-path spec の記録の書き換え

### Allowed Dependencies

- `features/mastra` の mastra-modules（`fullTextSearchTool` / `getPageContentTool` / `listChildrenTool` / `MastraRequestContextShape` / Mastra インスタンスレジストリ）— **依存方向は ai-tools → mastra の一方向のみ**。mastra 側ファイルが suggest-path の型・モジュールを import することは禁止
- `features/mastra` の AI レイヤ `resolveMastraModel`（support/mastra 所有。アプリ全体設定 `ai:provider` / `ai:apiKey` / `ai:model` / `ai:providerOptions` / `ai:azureOpenaiSettings` に依拠）— 2026-06 マージで `getOpenaiProvider` から置換
- suggest-path のエンジン非依存共通基盤: `generate-memo-suggestion` / `resolve-parent-grant` / `suggest-path-types` / API ルート（Requirement 5.5 の許容範囲）
- `configManager`（設定読み出し）、`@growi/logger`（pino）
- `SearchService.searchKeyword` / `Page.findByIdAndViewer` / `pageListingService.findChildrenByParentPathOrIdAndViewer`（tool 経由の間接利用。権限フィルタはこれらに委譲）
- #183964 / #183967 / #183968 の評価器・ユースケース・ベースライン測定値

**禁止依存**: agentic エンジンからワンショット固有 4 サービスへの import（Requirement 5.5。旧エンジン単独削除可能性の保証）

### Revalidation Triggers

以下の変更が生じた場合、依存元（MCP クライアント・評価器）または本設計の再検証が必要:

- `PathSuggestion` / `SuggestPathResponse` 型の形状変更（API 契約変更）
- エンドポイント・リクエスト形式（`body` / `engine` フィールド）・認証要件の変更
- `MastraRequestContextShape` の形状変更、または `fullTextSearchTool` / `getPageContentTool` の入出力スキーマ変更（support/mastra 側の変動を含む）
- 既定エンジンの 'oneshot' から 'agentic' への切り替え
- support/mastra ブランチの rebase / 上流マージによる Mastra バージョン変動（既知バグ回避方針の再確認が必要）

## Architecture

### Existing Architecture Analysis

- 現行 `generateSuggestions` は「memo 生成 → analyzeContent → retrieveSearchCandidates → 並列 [evaluateCandidates + grant 解決, generateCategorySuggestion]」のワンショットパイプライン。memo 生成と grant 解決はエンジン非依存、残り 4 サービスはワンショット固有
- graceful degradation（analyze/retrieve 失敗時に memo のみ返却）は `generateSuggestions` 内に実装済み — この構造をオーケストレータのフォールバックポリシーとして引き継ぐ
- Mastra 基盤（support/mastra）には per-request `RequestContext` パターン・「tool は throw せず discriminated union を値で返す」規約・権限フィルタの `SearchService` / `Page` モデル委譲が確立済み（agentic-search spec）。本設計はこれらをすべて踏襲する

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    Client[MCP Client] --> Route[suggest-path route]
    Route --> Orch[generateSuggestions orchestrator]
    Orch --> Memo[generateMemoSuggestion]
    Orch --> Disp[engine dispatcher]
    Disp --> OneshotEng[oneshot engine]
    Disp --> AgenticEng[agentic engine]
    OneshotEng --> Analyze[analyzeContent]
    OneshotEng --> Retrieve[retrieveSearchCandidates]
    OneshotEng --> Evaluate[evaluateCandidates]
    OneshotEng --> Category[generateCategorySuggestion]
    AgenticEng --> Schema[agentic output schema]
    AgenticEng --> Agent[suggestPathAgent]
    AgenticEng --> Grant[resolveParentGrant]
    OneshotEng --> Grant
    Agent --> Limited[limited search tool]
    Agent --> PageTool[getPageContentTool]
    Agent --> ListChildren[listChildrenTool]
    Limited --> FullText[fullTextSearchTool]
    FullText --> ES[SearchService]
    PageTool --> Mongo[Page model]
    ListChildren --> PageListing[pageListingService]

    subgraph aitools [features ai-tools suggest-path]
        Route
        Orch
        Memo
        Disp
        OneshotEng
        AgenticEng
        Schema
        Grant
        Analyze
        Retrieve
        Evaluate
        Category
    end

    subgraph mastra [features mastra mastra-modules]
        Agent
        Limited
        FullText
        PageTool
        ListChildren
    end
```

**Architecture Integration**:

- **Selected pattern**: オーケストレータ層エンジンディスパッチ。`generateSuggestions` がエンジン非依存の責務（memo・エンジン選択・フォールバック）を持ち、`SuggestPathEngine` インターフェースの 2 実装（oneshot / agentic）が提案生成を担う
- **Domain boundaries**: agent 定義と tool は `features/mastra/.../agents/suggest-path/`（Mastra プラットフォーム層）、エンジンアダプタと出力スキーマは `features/ai-tools/suggest-path/.../engines/`（feature 層）。structured output スキーマを feature 層に置くことで mastra 側は suggest-path の型を知らない
- **Existing patterns preserved**: per-request RequestContext、tool の discriminated union 返却（throw 禁止）、権限フィルタ委譲、configManager キー命名（`openai:assistantModel:*`）、pino logger
- **New components rationale**: budget 付き wrapper tool は「検索回数の正確なカウント + 上限到達時の graceful 手仕舞い」（Requirement 3.1/3.2）を共有 tool 無改変で実現する唯一の位置。エンジンディスパッチはワンショット固有モジュール非依存（5.5）を物理境界で保証する
- **Steering compliance**: server-side のみの変更（server-client 境界に影響なし）、barrel による module public surface 最小化、pino logger 使用

**依存方向**（違反はエラーとして扱う）:

```
interfaces（types） → services（engines → 既存サービス） → routes
features/ai-tools/suggest-path → features/mastra（一方向。逆方向 import 禁止）
```

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Agent runtime | `@mastra/core` 1.45.0（installed。宣言 `^1.32.1`。設計・スパイク時は 1.41.0） | agent ループ・structured output・requestContext | `generateVNext` は使用しない（mastra-ai/mastra#7662）。スパイク結論（steps/usage 形状・p-map ESM 回避）は 1.41.0 時点の確認であり 1.45.0 での再検証は未実施 |
| LLM provider | provider 非依存の `resolveMastraModel()`（support/mastra の AI レイヤ。openai / anthropic / google / azure-openai に対応） | suggestPathAgent のモデル解決 | 2026-06 の support/mastra マージで `getOpenaiProvider()` から置換（コミット c4a58793bf）。モデルはアプリ全体設定 `ai:provider` / `ai:model` で決まり、memoize + AI 設定保存時の cache clear で再起動なし反映。**suggestPath 専用のモデル選択は廃止**（下記 Config Keys 参照） |
| Schema / validation | JSON Schema 直接記述 + 手書き型ガード | structured output の契約 | Zod 自動変換は OpenAI strict mode 非互換のため不使用（mastra-ai/mastra#16383）。tool 入力は既存どおり zod ^4.1.9 |
| Search / Data | `SearchService`（Elasticsearch）、`Page` model（MongoDB） | 検索・本文参照・grant 解決 | すべて既存共有 tool / サービス経由。権限フィルタは委譲 |
| Config | `configManager`（config-definition.ts） | エンジン・上限・タイムアウト・モデルの設定化 | 新キー 4 つ。per-request 読み出しで再起動なし反映 |
| Logging | `@growi/logger`（pino） | 探索過程トレース・測定メトリクス | logger 名 `growi:ai-tools:suggest-path:agentic-engine` |

## File Structure Plan

### Directory Structure

```
apps/app/src/features/ai-tools/suggest-path/
├── interfaces/
│   └── suggest-path-types.ts                  # 変更: SuggestPathEngineId 追加（client-safe）
└── server/
    ├── routes/apiv3/
    │   └── index.ts                           # 変更: optional engine パラメータの validation + 受け渡し
    └── services/
        ├── generate-suggestions.ts            # 変更: オーケストレータ化（memo + dispatch + fallback）
        ├── generate-suggestions-orchestration.spec.ts  # 追加: オーケストレーションのテスト
        ├── engines/
        │   ├── index.ts                       # barrel: runEngine のみ再エクスポート（ロジックを持たない）
        │   ├── dispatcher.ts                  # runEngine 実装（engine id → 実装の static map 解決）
        │   ├── dispatcher.spec.ts
        │   ├── engine-types.ts                # SuggestPathEngine / SuggestPathEngineInput（server 専用型）
        │   ├── oneshot-engine.ts              # 既存 4 サービスのオーケストレーション（挙動維持の薄い wrapper）
        │   ├── oneshot-engine.spec.ts
        │   ├── agentic-engine.ts              # agent 呼び出し・タイムアウト・出力マッピング・grant
        │   ├── agentic-engine.spec.ts
        │   ├── agentic-trace-log.ts           # 追加: トレースログ整形（agentic-engine から抽出）
        │   ├── agentic-trace-log.spec.ts
        │   ├── agentic-output-schema.ts       # JSON Schema 定数 + AgenticEngineOutput 型 + 型ガード
        │   └── agentic-output-schema.spec.ts
        └── （analyze-content / retrieve-search-candidates / evaluate-candidates /
             generate-category-suggestion / generate-memo-suggestion / resolve-parent-grant
             / call-llm-for-json: すべて無改変。call-llm-for-json.spec.ts のみテスト追加）

apps/app/src/features/ai-tools/suggest-path/server/integration-tests/   # 追加: 統合テスト置き場
├── suggest-path-integration.spec.ts
├── suggest-path-route-integration.spec.ts
└── suggest-path-agentic-integration.spec.ts

apps/app/src/features/mastra/server/services/mastra-modules/
├── index.ts                                   # 変更: Mastra インスタンスに suggestPathAgent を登録（1 行 additive）
├── tools/
│   ├── list-children-tool.ts                  # 追加(#185213): 子ページ一覧 tool（childListingBudget 執行・pageListingService 委譲）
│   └── list-children-tool.spec.ts             #   ※共有 tools/ 配下だが実質 suggest-path 専用（配置は要再考の余地あり）
└── agents/suggest-path/
    ├── index.ts                               # barrel: suggestPathAgent と SuggestPathRequestContextShape のみ公開
    ├── suggest-path-agent.ts                  # Agent 定義（resolveMastraModel・tools 3 構成・memory なし）
    ├── suggest-path-agent.spec.ts
    ├── instructions.ts                        # agent instructions（フロー/ストック判定・探索戦略・提案ルール）
    ├── limited-search-tool.ts                 # budget 執行 wrapper tool（fullTextSearchTool へ委譲）
    ├── limited-search-tool.spec.ts
    └── request-context.ts                     # SuggestPathRequestContextShape / SearchBudget / ChildListingBudget 型
```

### Modified Files

- `apps/app/src/features/ai-tools/suggest-path/server/services/generate-suggestions.ts` — ワンショットパイプライン部分を `engines/oneshot-engine.ts` へ移し、memo 生成 + エンジンディスパッチ + agentic フォールバックポリシーに再構成。**シグネチャは後方互換**（optional な engine 指定を追加）
- `apps/app/src/features/ai-tools/suggest-path/server/routes/apiv3/index.ts` — リクエストボディに optional `engine` フィールド（enum）の validation を追加し、サービスへ受け渡す。ミドルウェアチェーン・レスポンス形式は無変更
- `apps/app/src/features/ai-tools/suggest-path/interfaces/suggest-path-types.ts` — `SuggestPathEngineId`（`'oneshot' | 'agentic'`）const + 型を追加
- `apps/app/src/features/mastra/server/services/mastra-modules/index.ts` — `agents` マップに `suggestPathAgent` を追加（additive のみ）
- `apps/app/src/server/service/config-manager/config-definition.ts` — 新設定キー 4 つを追加（下記 Config Keys 参照）

## System Flows

agentic エンジン選択時のリクエストフロー:

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Route as suggest-path route
    participant Orch as generateSuggestions
    participant Eng as agentic engine
    participant Agent as suggestPathAgent
    participant Search as limited search tool
    participant Page as getPageContentTool
    participant Children as listChildrenTool

    Client->>Route: POST body engine
    Route->>Orch: user body userGroups engine
    Orch->>Orch: generateMemoSuggestion
    Orch->>Eng: dispatch agentic
    Eng->>Eng: config 読み出しと RequestContext budget 構築
    Eng->>Agent: generate structuredOutput maxSteps abortSignal
    loop 提案確定まで 検索上限内
        Agent->>Search: 検索 query
        Search->>Search: budget 確認と消費
        Search-->>Agent: hits または limit_exceeded
        opt 候補本文の確認が必要なとき
            Agent->>Page: 候補ページ参照
            Page-->>Agent: outline または content
        end
        opt 配置先の兄弟確認が必要なとき
            Agent->>Children: 候補親の子ページ一覧
            Children-->>Agent: children または limit_exceeded
        end
    end
    Agent-->>Eng: structured output と steps usage
    Eng->>Eng: 型ガード検証 path 正規化 grant 解決
    Eng->>Eng: トレースログ出力
    Eng-->>Orch: search 提案リスト
    Orch-->>Route: memo と search 提案
    Route-->>Client: 200 suggestions
```

**フローレベルの決定**:

- **フォールバック（4.5）**: agentic エンジンの例外・タイムアウト（`AbortController` による中断）はオーケストレータが捕捉し、memo 提案のみの 200 レスポンスを返す。**oneshot エンジンには適用しない**（現行は予期しない例外が 500 になる挙動であり、5.3 の挙動維持のため現状のまま）
- **budget 手仕舞い（3.2）**: 上限到達時、limited search tool が `limit_exceeded` を**値で**返し（throw しない）、instructions の指示によりエージェントは収集済み情報から提案を確定する。listChildren tool も独立した budget（childListingBudget）で同じ手仕舞い規約に従う（#185213）。ループ暴走への多層防御として `maxSteps = 2 × searchLimit + 2 × childListingLimit + 4` とタイムアウトを併用する
- **memo 提案（4.3）**: エンジン選択・成否にかかわらずオーケストレータが常に先頭に含める

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | 文書に基づく検索と候補妥当性判断 | SuggestPathAgent, AgenticEngine | `agent.generate` 呼び出し契約, instructions | System Flows |
| 1.2 | 不十分なら検索語・条件を変えて再検索 | SuggestPathAgent（instructions の再検索戦略）, LimitedSearchTool | tool 入力スキーマ（query 可変） | System Flows の loop |
| 1.3 | 候補ページ本文の参照 | SuggestPathAgent（tools 構成） | `getPageContentTool`（既存契約） | System Flows の opt |
| 1.4 | 探索完了時に提案を生成 | AgenticEngine, AgenticOutputSchema | `AgenticEngineOutput` + 型ガード | System Flows |
| 1.5 | 検索・本文参照を閲覧権限内に限定 | SuggestPathRequestContext, LimitedSearchTool | `SuggestPathRequestContextShape`（user 伝搬） | — |
| 2.1 | フロー/ストック判定 | SuggestPathAgent（instructions）, AgenticOutputSchema | `informationType` フィールド | — |
| 2.2 | 判定結果を検索誘導に反映 | SuggestPathAgent（instructions） | instructions（誘導規則） | System Flows の loop |
| 2.3 | informationType をレスポンスに含める | AgenticEngine（マッピング） | `PathSuggestion.informationType` | — |
| 2.4 | 判定と探索過程の記録 | AgenticEngine（トレースログ）, LimitedSearchTool（query 記録） | トレースログスキーマ | — |
| 3.1 | 検索回数上限 | LimitedSearchTool, SuggestPathRequestContext | `SearchBudget` | System Flows の budget 確認 |
| 3.2 | 上限到達時は収集済み情報で提案 | LimitedSearchTool（limit_exceeded）, SuggestPathAgent（instructions） | tool 出力 union | System Flows |
| 3.3 | 上限の設定変更反映 | Config Keys, AgenticEngine（per-request 読み出し） | `aiTools:suggestPathAgenticSearchLimit` | — |
| 3.4 | モデルの設定変更反映 | SuggestPathAgent（`resolveMastraModel`。アプリ全体設定・memoize + cache clear で再起動なし反映） | `ai:provider` / `ai:model`（support/mastra 所有） | — |
| 3.5 | 推論強度の設定変更反映 | Config Keys, AgenticEngine（per-request 読み出し → providerOptions） | `openai:reasoningEffort:suggestPathAgent`, `generate` の `providerOptions.openai.reasoningEffort` | — |
| 3.6 | 推論強度未指定時は既定挙動 | AgenticEngine（空文字列なら providerOptions に渡さない） | `generate` 呼び出し契約（条件付き providerOptions） | — |
| 4.1 | エンドポイント・リクエスト形式・認証の維持 | Route（validator は additive のみ） | API Contract | — |
| 4.2 | レスポンス形状と trailing-slash 親パス | AgenticEngine（正規化・検証）, AgenticOutputSchema | `PathSuggestion` | — |
| 4.3 | memo 提案を常に含める | SuggestPathOrchestrator | `generateSuggestions` | System Flows |
| 4.4 | grant に親ページ grant 値 | AgenticEngine → resolveParentGrant（既存） | `resolveParentGrant` | — |
| 4.5 | エンジン失敗・タイムアウト時は memo のみ | SuggestPathOrchestrator（フォールバック）, AgenticEngine（AbortController） | フォールバックポリシー | フローレベルの決定 |
| 5.1 | 新旧エンジンの切り替え並存 | EngineDispatcher, OneshotEngine, AgenticEngine | `SuggestPathEngine` | — |
| 5.2 | 未指定時は既定エンジン | SuggestPathOrchestrator, Route（optional engine）, Config Keys | `aiTools:suggestPathEngine` | — |
| 5.3 | 従来エンジンの挙動不変 | OneshotEngine（薄い wrapper）・既存テスト無修正 green | 既存 4 サービス契約（無改変） | — |
| 5.4 | agentic 選択時は Req 1〜3 の挙動 | EngineDispatcher → AgenticEngine | `SuggestPathEngine` | System Flows |
| 5.5 | ワンショット固有モジュール非依存 | AgenticEngine（import 制約）, File Structure Plan | 依存方向規則 | — |
| 5.6 | 検証完了まで既定は従来エンジン | Config Keys（default 'oneshot'） | `aiTools:suggestPathEngine` | — |
| 6.1 | 同一条件での A/B 測定 | Route（engine override）+ 検証ワークフロー | `engine` リクエストフィールド | Testing Strategy |
| 6.2 | レスポンス時間・検索回数・トークン記録 | AgenticEngine（サマリログ） | トレースログスキーマ | — |
| 6.3 | フロー/ストック誘導の反映確認 | AgenticEngine（トレースログ詳細） | トレースログスキーマ | — |
| 6.4 | 未達時の原因分析と受け入れ判断 | 検証ワークフロー（プロセス） | — | Testing Strategy |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies (P0/P1) | Contracts |
|-----------|--------------|--------|--------------|--------------------------|-----------|
| SuggestPathOrchestrator | ai-tools / service | memo + エンジン選択 + フォールバック | 4.3, 4.5, 5.2 | EngineDispatcher (P0), generateMemoSuggestion (P0) | Service |
| EngineDispatcher | ai-tools / service | engine id → 実装の解決 | 5.1, 5.2, 5.4 | OneshotEngine (P0), AgenticEngine (P0) | Service |
| OneshotEngine | ai-tools / service | 既存パイプラインの挙動維持 wrapper | 5.3, 5.5 | 既存 4 サービス (P0) | Service |
| AgenticEngine | ai-tools / service | agent 呼び出し・出力マッピング・観測 | 1.1, 1.4, 2.3, 3.3, 4.2, 4.4, 4.5, 6.2, 6.3 | SuggestPathAgent (P0), resolveParentGrant (P0), configManager (P0) | Service |
| AgenticOutputSchema | ai-tools / service | structured output の契約と検証 | 1.4, 2.1, 4.2 | — | State |
| SuggestPathAgent | mastra / agent | 探索の実行主体（instructions + tools） | 1.1, 1.2, 1.3, 2.1, 2.2, 3.2, 3.4 | LimitedSearchTool (P0), getPageContentTool (P0), ListChildrenTool (P0), resolveMastraModel (P0) | Service |
| LimitedSearchTool | mastra / tool | 検索回数 budget の執行 + 委譲 | 1.5, 2.4, 3.1, 3.2 | fullTextSearchTool (P0), SuggestPathRequestContext (P0) | Service |
| ListChildrenTool | mastra / tool | 子ページ一覧 budget の執行 + 委譲（#185213 で追加） | 1.5, 2.4 | pageListingService (P0), SuggestPathRequestContext (P0) | Service |
| SuggestPathRequestContext | mastra / types | per-request の user・budget 伝搬 | 1.5, 3.1 | MastraRequestContextShape (P0) | State |
| Route (modified) | ai-tools / route | optional engine の validation | 4.1, 5.2, 6.1 | SuggestPathOrchestrator (P0) | API |
| Config Keys | infra / config | 運用パラメータの設定化 | 3.3, 3.4, 5.2, 5.6 | config-definition (P0) | State |

### ai-tools / suggest-path サービス層

#### SuggestPathOrchestrator（`generate-suggestions.ts`・変更）

| Field | Detail |
|-------|--------|
| Intent | memo 提案を常に含め、選択されたエンジンの提案を合成し、agentic 失敗時のフォールバックを司る |
| Requirements | 4.3, 4.5, 5.2 |

**Responsibilities & Constraints**

- memo 提案の生成（既存 `generateMemoSuggestion` を呼ぶ）を常に実行し、レスポンス先頭に含める
- engine id の決定: リクエスト指定（optional）→ なければ config `aiTools:suggestPathEngine`
- **フォールバックポリシーの非対称性**: agentic エンジンの reject（例外・タイムアウト）は捕捉して memo のみ返す（4.5）。oneshot エンジンの例外は現行同様に伝播させる（5.3 の挙動維持。現行は route の try/catch で 500 になる）
- 公開シグネチャは後方互換: 既存引数列 + optional オプション

##### Service Interface

```typescript
import type { IUserHasId } from '@growi/core';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PathSuggestion, SearchService, SuggestPathEngineId } from '../../interfaces/suggest-path-types';

interface GenerateSuggestionsOptions {
  readonly engine?: SuggestPathEngineId;
}

declare function generateSuggestions(
  user: IUserHasId,
  body: string,
  userGroups: ObjectIdLike[],
  searchService: SearchService,
  options?: GenerateSuggestionsOptions,
): Promise<PathSuggestion[]>;
```

- Preconditions: `body` は validator 検証済み（非空・100,000 文字以下）。`user` は認証済み
- Postconditions: 戻り値の先頭は常に `type: 'memo'` の提案。agentic エンジン失敗時は memo のみの配列
- Invariants: エンジン選択にかかわらず memo 提案の生成ロジックは共通（5.5 の許容依存）

#### EngineDispatcher（`engines/index.ts`）

| Field | Detail |
|-------|--------|
| Intent | engine id から `SuggestPathEngine` 実装を解決して実行する唯一の窓口（barrel） |
| Requirements | 5.1, 5.2, 5.4 |

**Responsibilities & Constraints**

- `{ oneshot, agentic }` の static map による解決（`dispatcher.ts` に実装）。レジストリ等の拡張機構は作らない
- barrel（`index.ts`）は `runEngine` のみ再エクスポートする（ロジックを持たない）。エンジン実装ファイルへの直接 import を禁じる

##### Service Interface

```typescript
import type { IUserHasId } from '@growi/core';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PathSuggestion, SearchService, SuggestPathEngineId } from '../../../interfaces/suggest-path-types';

// engine-types.ts
interface SuggestPathEngineInput {
  readonly user: IUserHasId;
  readonly body: string;
  readonly userGroups: ObjectIdLike[];
  readonly searchService: SearchService;
}

type SuggestPathEngine = (input: SuggestPathEngineInput) => Promise<PathSuggestion[]>;

// dispatcher.ts（barrel index.ts から再エクスポート）
declare function runEngine(
  engineId: SuggestPathEngineId,
  input: SuggestPathEngineInput,
): Promise<PathSuggestion[]>;
```

- Postconditions: 戻り値は `type: 'search' | 'category'` の提案のみ（memo はオーケストレータの責務）。全提案の `grant` は解決済み、`path` は末尾スラッシュ付き

#### OneshotEngine（`engines/oneshot-engine.ts`）

| Field | Detail |
|-------|--------|
| Intent | 既存ワンショットパイプラインを `SuggestPathEngine` 契約に適合させる挙動維持 wrapper |
| Requirements | 5.3, 5.5 |

**Responsibilities & Constraints**

- 現行 `generateSuggestions` 内のパイプライン部分（analyzeContent → retrieveSearchCandidates → 並列 [evaluateCandidates + grant, generateCategorySuggestion]）を**ロジック変更なしで**移設したオーケストレーションのみを持つ
- 既存の内部 degradation を維持: analyze / retrieve 失敗時は空配列を返す（オーケストレータが memo を補うため、最終レスポンスは現行と同一）
- 既存 4 サービスファイルは無改変。本ファイルは import して順序立てるだけ

**Implementation Notes**

- Integration: 既存 `generate-suggestions.spec.ts` および統合テストが**無修正で green** であることが挙動維持（5.3）の受け入れ証拠
- Risks: 移設時の暗黙挙動（Promise.allSettled の部分失敗処理）の取りこぼし → 既存テストで検出

#### AgenticEngine（`engines/agentic-engine.ts`）

| Field | Detail |
|-------|--------|
| Intent | suggestPathAgent の呼び出し・タイムアウト制御・structured output の検証とマッピング・grant 解決・観測ログ |
| Requirements | 1.1, 1.4, 2.3, 3.3, 3.5, 3.6, 4.2, 4.4, 4.5, 6.2, 6.3 |

**Responsibilities & Constraints**

- config（searchLimit / childListingLimit / timeoutMs / reasoningEffort）を**リクエスト毎に** `configManager.getConfig()` で読む（3.3, 3.5）。`reasoningEffort` は空文字列なら未指定として扱う（3.6）
- per-request の `RequestContext<SuggestPathRequestContextShape>` を構築（user / searchService / searchBudget / childListingBudget）。module-scope 共有は禁止（並行リクエストの user 漏れ防止）
- `AbortController` + `setTimeout(timeoutMs)` で `abortSignal` を渡し、中断時は例外として reject（オーケストレータの memo フォールバックへ）
- agent 呼び出し契約:

```typescript
const reasoningEffort = configManager.getConfig('openai:reasoningEffort:suggestPathAgent');
const result = await suggestPathAgent.generate(buildUserPrompt(body), {
  structuredOutput: { schema: AGENTIC_OUTPUT_JSON_SCHEMA },
  maxSteps: 2 * searchLimit + 2 * childListingLimit + 4,
  abortSignal: controller.signal,
  requestContext,
  // Pass reasoning effort only when configured; an empty value leaves the
  // model's default behavior unchanged (3.6). NOTE: the `openai` namespace
  // is hard-coded here — under the provider-agnostic layer this option is
  // silently ignored when `ai:provider` selects a non-OpenAI provider.
  ...(reasoningEffort !== ''
    ? { providerOptions: { openai: { reasoningEffort } } }
    : {}),
});
```

- `reasoningEffort` の値検証はエンジン層では行わない（3.5）。空判定のみ行い、非空ならプロバイダにそのまま透過する。未対応モデル × 非対応値の組み合わせはプロバイダ側のエラーとして表面化し、既存のエンジン失敗フォールバック（4.5）が memo 提案で受け止める

- 出力マッピング規則（4.2）:
  1. `result.object` を型ガード `isAgenticEngineOutput` で検証。不合格は例外（memo フォールバック）
  2. 各 suggestion の `path` を正規化: 先頭 `/` 必須・末尾 `/` を保証。正規化不能なエントリは破棄
  3. 重複 path を除去し、最大 20 件に制限（当初 3 件。A-6 #185211 で候補集合の質を計測可能にするため 20 件に拡張）
  4. 各 path に `resolveParentGrant` を並列適用して `grant` を付与（4.4）
  5. `type: 'search'`、`informationType` は structured output のトップレベル値を全 search 提案に付与（2.3）
- **category 提案は生成しない**（設計決定。浅い親が妥当な場合はエージェントが search 提案として出せるため機能的に包含。research.md 参照）
- ワンショット固有 4 サービスへの import 禁止（5.5）

##### Service Interface

`SuggestPathEngine` 型に適合（EngineDispatcher 参照）。

- Preconditions: `aiTools:suggestPathAgenticSearchLimit` / `aiTools:suggestPathAgenticTimeoutMs` が定義済み（既定値あり）
- Postconditions: 成功時は 0〜20 件の `type: 'search'` 提案（grant 解決済み・informationType 付き）。失敗・タイムアウト時は reject
- Invariants: 1 リクエスト中の検索 tool 実行回数 ≤ searchLimit（budget による執行）

##### State Management（観測ログ）

- logger: `growi:ai-tools:suggest-path:agentic-engine`（整形ロジックは `agentic-trace-log.ts` に抽出）
- **サマリ（info、リクエスト毎 1 行）**: `{ durationMs, searchCount, listChildrenCount, pageReadCount, stopReason, informationType, suggestionCount, tokenUsage }`（6.2。`listChildrenCount` は #185213 で追加、childListingBudget から集計）
  - `pageReadCount` は `result.steps` 中の getPageContent 呼び出し数から集計（レイテンシ分析用の観測値。要件上の上限はなし）
  - `tokenUsage` は入力・出力・合計トークン。**フィールド名はスパイク（1.41.0 時点）で確定済み**: AI SDK v5 命名（`inputTokens` / `outputTokens`）の `totalUsage` を採用（research.md「Spike Results」参照）
  - `stopReason` の判定規則: `timeout` = AbortSignal による中断、`budget_exhausted` = 正常完了かつ `searchBudget.used >= limit`、`error` = その他の例外・structured output 検証不合格、`completed` = 上記以外の正常完了。reject 経路（timeout / error）はエンジン内で catch してサマリログを出力してから rethrow する
- **詳細（debug）**: 実行した検索クエリ列（budget の記録）と各ヒット概要、一覧参照した親パス列（`listedPaths`、childListingBudget の記録）、`result.steps` から再構成した tool 呼び出しシーケンス（2.4, 6.3）
- プライバシー制約: 文書本文・検索クエリ（本文由来）は debug レベルのみに出力。info レベルには件数・時間・トークンなどメタ情報のみ

**Implementation Notes**

- Integration: `result.steps` / usage の形状は @mastra/core の generate 戻り値に依存。スパイク（1.41.0）で実形状を確認しログ整形を確定済み。installed が 1.45.0 に上がったため形状変化がないかは Mastra バージョン変動時の再確認対象（Revalidation Triggers）
- Validation: 型ガードのユニットテストで JSON Schema と TS 型の乖離を防ぐ
- Risks: tool 併用 + structured output の両立（mastra-ai/mastra#3139 系統）→ 実装フェーズ最初のスパイクで実機確認。壊れる場合は `structuredOutput.model` に同一モデルを明示指定して structuring パスを分離する（research.md の Mitigation）
- Open Question: `buildUserPrompt` に渡す本文の長さの扱い。validator 上限（100,000 文字）の本文がそのまま渡ると入力トークンが過大になり得る。トリミング戦略（要約・先頭優先等）の要否は、スパイクと A/B 測定のトークン実測（6.2）を踏まえて検証フェーズで確定する

#### AgenticOutputSchema（`engines/agentic-output-schema.ts`）

| Field | Detail |
|-------|--------|
| Intent | agent の structured output 契約（JSON Schema・TS 型・型ガード）の単一定義 |
| Requirements | 1.4, 2.1, 4.2 |

##### State Management

```typescript
export type AgenticEngineOutput = {
  readonly informationType: 'flow' | 'stock';
  readonly suggestions: ReadonlyArray<{
    readonly path: string;        // 末尾スラッシュ付き親ディレクトリパス
    readonly label: string;
    readonly description: string;
  }>;
};

export const AGENTIC_OUTPUT_JSON_SCHEMA: JSONSchema7; // 下記 Data Models 参照
export function isAgenticEngineOutput(value: unknown): value is AgenticEngineOutput;
```

- OpenAI strict mode 互換のため、全レベルで `additionalProperties: false`・全プロパティ `required` とする
- Zod からの変換は行わない（mastra-ai/mastra#16383 回避。JSON Schema を直接記述）

### mastra / agents 層

#### SuggestPathAgent（`agents/suggest-path/suggest-path-agent.ts` + `instructions.ts`）

| Field | Detail |
|-------|--------|
| Intent | 保存先探索の実行主体。instructions が探索戦略・フロー/ストック誘導・提案ルールを規定する |
| Requirements | 1.1, 1.2, 1.3, 2.1, 2.2, 3.2, 3.4 |

**Responsibilities & Constraints**

- Agent 構成:

```typescript
export const suggestPathAgent = new Agent({
  id: 'suggestPathAgent',
  name: 'Suggest Path Agent',
  instructions: SUGGEST_PATH_INSTRUCTIONS,
  // Provider-agnostic model resolution (support/mastra AI layer).
  // Lazily resolved; memoized and cleared on AI-settings save (3.4).
  model: () => resolveMastraModel(),
  tools: {
    fullTextSearch: limitedSearchTool,
    getPageContent: getPageContentTool,
    listChildren: listChildrenTool, // peer-placement verification (#185213)
  },
  // memory は接続しない（ステートレス。スレッド永続化が不要なため）
});
```

- instructions が規定する内容（実装時に英語で記述。プロンプトチューニングは検証フェーズの作業）:
  1. **役割**: 与えられた文書の保存先として妥当な「親ディレクトリパス（末尾スラッシュ）」を wiki 内の探索に基づいて提案する
  2. **フロー/ストック判定（2.1）**: 最初に文書がフロー情報（時限的・時系列）かストック情報（蓄積・参照）かを判定する
  3. **判定の検索誘導への反映（2.2）**: フローなら時系列・日付・記録系の場所を、ストックなら仕様・ガイドライン等の蓄積系の場所を優先して探索し、候補の妥当性判断にも判定を使う
  4. **探索戦略（1.1, 1.2）**: 検索結果を元文書と照らして判断し、不十分なら語彙を変える（同義語・言語の切り替え・抽象度の変更）、`prefix:` / `tag:` / 除外等の演算子で条件を変える
  5. **本文参照（1.3）**: パス・スニペットで判断できないときは getPageContent で候補ページの内容を確認する
  6. **budget 手仕舞い（3.2）**: 検索 tool が `limit_exceeded` を返したら、それ以上検索せず収集済み情報から提案を確定する
  7. **出力ルール**: 提案は最大 20 件（確からしい順）。それぞれ既存ページ木に整合する親ディレクトリパス（新設パスも可）・簡潔な label・提案理由 description。label / description は文書の言語に合わせる
- **実装後の拡張**（チューニングラウンド 302d974819 / 066d1776de + #185213。現行 instructions.ts に反映済み）:
  - **grep 型クエリ生成**: topic の言い換えではなく path スラッグ・日付・コード識別子など低頻度の具体トークンを優先して撃つ。言語切替（日英）の明示指導を含む（4 の探索戦略の強化）
  - **listChildren 検証プロトコル**: 候補親を提案する前に子ページ一覧で兄弟の実在・命名を確認する（peer-placement verification）。専用 budget の手仕舞い規則も 6 と同型
  - **peer-vs-sub 配置ドクトリン**: 「PARENT DIRECTORY」表現がリーフページ配下の提案を妨げていた A/B 測定の敗因（4/60）への修正。既存リーフの配下（sub）か兄弟（peer）かを内容関係で判断する
  - **出力の下限目標**: 確からしい候補を最低 5 件目指す（7 の補強）
- スキーマ（structured output）は Agent 定義に持たせず、AgenticEngine が generate 呼び出し時に渡す（依存方向: mastra 側が suggest-path の型を知らないため）

**Dependencies**

- Outbound: LimitedSearchTool — 検索（P0）
- Outbound: getPageContentTool — 本文参照（P0・既存共有 tool 無改変）
- Outbound: ListChildrenTool — 子ページ一覧（P0・#185213 で追加。`mastra-modules/tools/` 配下だが実質 suggest-path 専用）
- External: `resolveMastraModel`（support/mastra AI レイヤ）— モデル解決（P0。旧 `getOpenaiProvider` + configManager から置換）

**Implementation Notes**

- Integration: `mastra-modules/index.ts` の Mastra インスタンスに登録（logger / observability の恩恵を受ける）。AgenticEngine からの取得は **`mastra.getAgent('suggestPathAgent')` に統一する**（Agent インスタンスの直接 import は不可。registry 経由に統一することでプラットフォーム設定の一貫性を保証し、チャット側ハンドラと同じ取得パターンに揃える）
- Validation: モデル解決が lazy（import 時に resolver を呼ばない）であること・resolver のモデルをそのまま転送することをユニットテストで検証（provider-agnostic 化後の形。当初のスパイクでは dynamic model の per-generate 評価を確認していた）
- Risks: instructions の品質が命中率を左右する → A/B 測定（6.1〜6.4）+ 探索過程ログ（2.4）で反復改善

#### LimitedSearchTool（`agents/suggest-path/limited-search-tool.ts`）

| Field | Detail |
|-------|--------|
| Intent | 検索回数 budget を執行しつつ `fullTextSearchTool` に委譲する suggest-path 専用 wrapper |
| Requirements | 1.5, 2.4, 3.1, 3.2 |

**Responsibilities & Constraints**

- 入力スキーマは `fullTextSearchTool` と同一（query / limit / sort / order）
- 出力スキーマは元 tool の discriminated union に `{ result: 'limit_exceeded', reason: string }` を追加した union
- 実行規則:
  1. requestContext から `searchBudget` を取得。欠落時は `context_error` を返す（throw しない）
  2. `used >= limit` なら委譲せず `limit_exceeded` を返す
  3. それ以外は `used` をインクリメントし、query を `queries` に記録してから `fullTextSearchTool.execute` へ委譲（権限フィルタは委譲先で `SearchService` に委譲される — 1.5）
- 共有 tool（fullTextSearchTool）は無改変。本 tool は suggestPathAgent のみが使用する

##### Service Interface（tool 出力 union の追加分）

```typescript
type LimitedSearchToolOutput =
  | FullTextSearchToolOutput                          // 既存 union（ok / error / context_error）
  | { result: 'limit_exceeded'; reason: string };     // budget 超過（3.2 の手仕舞いシグナル）
```

**Implementation Notes**

- Integration: 元 tool の `execute` への委譲シグネチャ（context の引き回し）はスパイクで確認。不成立時の代替は wrapper 内で `SearchService.searchKeyword` を直接呼ぶ（research.md の Mitigation）
- Validation: budget 境界（残 1 回・ちょうど上限・超過）のユニットテスト
- Risks: エージェントが `limit_exceeded` 後も検索を試み続ける可能性 → instructions の手仕舞い指示 + maxSteps + タイムアウトの多層防御

#### SuggestPathRequestContext（`agents/suggest-path/request-context.ts`）

| Field | Detail |
|-------|--------|
| Intent | 共有 RequestContext shape を拡張し、検索 budget を per-request で伝搬する |
| Requirements | 1.5, 3.1 |

##### State Management

```typescript
import type { MastraRequestContextShape } from '../../types/request-context';

export type SearchBudget = {
  readonly limit: number;
  used: number;              // per-request スコープの消費カウンタ
  readonly queries: string[]; // 実行クエリの記録（2.4 のトレース用）
};

// #185213 で追加: listChildren tool 用の第二 budget（SearchBudget と同じ規約）
export type ChildListingBudget = {
  readonly limit: number;
  used: number;
  readonly paths: string[];  // 一覧参照した親パスの記録（トレース用）
};

export type SuggestPathRequestContextShape = MastraRequestContextShape & {
  searchBudget: SearchBudget;
  childListingBudget: ChildListingBudget;
};
```

- 共有 shape（`MastraRequestContextShape`）は無改変。追加キーのみの拡張型のため、共有 tool（getPageContentTool 等）は従来どおり user / searchService を読める
- `used` / `queries` はリクエスト内に閉じた累積状態（意図的な mutable。リクエスト境界を越えて共有しない）

### ai-tools / route 層

#### Route（`suggest-path/server/routes/apiv3/index.ts`・変更）

| Field | Detail |
|-------|--------|
| Intent | optional `engine` フィールドの validation 追加。既存契約は不変 |
| Requirements | 4.1, 5.2, 6.1 |

**Responsibilities & Constraints**

- ミドルウェアチェーン（accessTokenParser AI scope → loginRequiredStrictly → certifyAiService → validator → apiV3FormValidator）は無変更（4.1）
- validator に追加: `engine` は optional。指定時は `'oneshot' | 'agentic'` のみ許可（不正値は 400）
- ハンドラは `engine` を `generateSuggestions` の options に受け渡すのみ

##### API Contract

| Method | Endpoint | Request | Response | Errors |
|--------|----------|---------|----------|--------|
| POST | /_api/v3/ai-tools/suggest-path | `{ body: string, engine?: 'oneshot' \| 'agentic' }` | `{ suggestions: PathSuggestion[] }`（形状は現行と同一） | 400（validation）, 401/403（認証・AI 無効）, 500（オーケストレータ外の予期しない例外） |

- `engine` 未指定時のリクエスト・レスポンスは現行と完全互換（4.1）。agentic 失敗時も 200 + memo のみで応答する（4.5。5xx にしない）
- `engine` フィールドは**検証・運用切り替えのための内部パラメータ**であり、MCP ツール（suggestPath）の入力スキーマには公開しない（クライアント側の変更はスコープ外。一般公開の要否は既定エンジン切り替え判断と併せて別途検討）

### infra / config 層

#### Config Keys（`config-manager/config-definition.ts`・変更）

| Field | Detail |
|-------|--------|
| Intent | エンジン・上限・タイムアウト・モデル・推論強度の運用設定化 |
| Requirements | 3.3, 3.4, 3.5, 3.6, 5.2, 5.6 |

| Key | Type | Default | Env Var | 用途 |
|-----|------|---------|---------|------|
| `aiTools:suggestPathEngine` | `'oneshot' \| 'agentic'` | `'oneshot'` | `AI_TOOLS_SUGGEST_PATH_ENGINE` | 既定エンジン（5.2, 5.6。検証完了まで 'oneshot' 固定が既定） |
| `aiTools:suggestPathAgenticSearchLimit` | `number` | `5` | `AI_TOOLS_SUGGEST_PATH_AGENTIC_SEARCH_LIMIT` | 1 リクエストの検索回数上限（3.1, 3.3。合意レンジ 3〜5 の上限を初期値とし、A/B 実測で確定） |
| `aiTools:suggestPathAgenticTimeoutMs` | `number` | `60000` | `AI_TOOLS_SUGGEST_PATH_AGENTIC_TIMEOUT_MS` | agentic エンジンの総時間セーフティネット（4.5。暫定値。A/B 実測とレスポンス時間上限の別途合意を経て確定） |
| `aiTools:suggestPathAgenticChildListingLimit` | `number` | `5` | `AI_TOOLS_SUGGEST_PATH_AGENTIC_CHILD_LISTING_LIMIT` | listChildren tool の 1 リクエスト呼び出し上限（#185213 で追加。検索 budget とは独立の第二 budget） |
| `openai:assistantModel:suggestPathAgent` | `string` | `'gpt-4.1-mini'` | `OPENAI_SUGGEST_PATH_AGENT_MODEL` | **DEAD KEY（2026-06 support/mastra マージ以降）**: 定義は残存するが読み出す実装が存在せず、変更しても何も起きない。モデルはアプリ全体設定 `ai:provider` / `ai:model`（`resolveMastraModel` 経由・memoize + AI 設定保存時 cache clear）で決まる。削除 or 再配線は未決（要判断） |
| `openai:reasoningEffort:suggestPathAgent` | `string` | `''`（空＝未指定） | `OPENAI_SUGGEST_PATH_AGENT_REASONING_EFFORT` | agentic エンジンの推論強度（3.5, 3.6）。空文字列は「未指定」を表し、`providerOptions` に reasoning effort を渡さない（モデル既定挙動）。非空時のみ後述の `providerOptions.openai.reasoningEffort` に渡す。値の妥当性（対応モデル・許容値 `minimal`/`low`/`medium`/`high`）はモデル側が判定し、本キーは文字列をそのまま透過する |

- searchLimit / childListingLimit / timeoutMs / reasoningEffort は利用箇所で per-request に `configManager.getConfig()` を呼ぶことで、再起動なしの変更反映（3.3, 3.5）を保証する
- モデル（3.4）の再起動なし反映は per-request 読みではなく、`resolveMastraModel` の memoize + AI 設定保存（および s2s メッセージ）時の `clearResolvedMastraModelCache()` で実現される（support/mastra レイヤの機構。設計当初の DynamicArgument per-request 解決から変更）
- `openai:reasoningEffort:suggestPathAgent` は空文字列を既定とすることで、設定しない限り現行挙動（reasoning effort 未指定）を変えない（3.6）。型は `string`（enum 化しない）— GPT-5 系のみ `minimal` を許容する等のモデル別制約を config 層に固定化せず、対応値の解釈はモデル／プロバイダ側に委ねる。**注意（provider-agnostic 化後の制約）**: この値は `providerOptions.openai.*` 名前空間に固定で渡るため、`ai:provider` が OpenAI 系以外のときはサイレントに無効。キー名の `openai:` プレフィックスも含め、chat 側の `ai:providerOptions` パターンへの移行 or 「OpenAI 限定」の明文化が要判断

## Data Models

### Data Contracts & Integration

**API レスポンス（変更なし）**: `PathSuggestion` / `SuggestPathResponse`（`suggest-path-types.ts`）の形状は不変。agentic エンジン由来の提案は `type: 'search'` のみで、`informationType` を必ず持つ。

**リクエスト（additive）**: `engine?: 'oneshot' | 'agentic'`（`SuggestPathEngineId`）。

**Agent structured output（新規契約）** — `AGENTIC_OUTPUT_JSON_SCHEMA`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["informationType", "suggestions"],
  "properties": {
    "informationType": {
      "type": "string",
      "enum": ["flow", "stock"],
      "description": "Whether the document is flow (time-bound) or stock (reference) information"
    },
    "suggestions": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["path", "label", "description"],
        "properties": {
          "path": { "type": "string", "description": "Parent directory path with trailing slash" },
          "label": { "type": "string" },
          "description": { "type": "string" }
        }
      }
    }
  }
}
```

- スキーマ検証は二重: Mastra の structuring パス（schema 指定）+ AgenticEngine の型ガード（defense in depth）。`maxItems` がモデル側で無視された場合もアダプタが 20 件に切り詰める

**トレースログ（新規・運用契約）**: AgenticEngine の State Management 節に定義（info サマリ + debug 詳細）。#183968 評価器はサマリ行から検索回数・レスポンス時間・トークン消費を収集する（6.2）

## Error Handling

### Error Strategy

「エージェントループ内は値で返す・エンジン境界は例外で返す・API 境界は memo フォールバックで吸収する」の 3 層。

### Error Categories and Responses

| 層 | エラー | 振る舞い | Requirement |
|----|--------|----------|-------------|
| Route（4xx） | `body` 欠落・空・100k 超過、`engine` 不正値 | 400（express-validator、現行パターン） | 4.1 |
| Route（4xx） | 未認証 / AI scope なし / AI 機能無効 | 401 / 403（既存ミドルウェア、無変更） | 4.1 |
| Tool 層 | 検索失敗・ページ不可視・コンテキスト欠落・budget 超過 | discriminated union を**値で**返す（throw 禁止）。エージェントは再検索（1.2）または手仕舞い（3.2）で回復 | 1.2, 3.2 |
| AgenticEngine | agent 例外・structured output 検証不合格・タイムアウト（AbortController） | reject → オーケストレータが捕捉 | 4.5 |
| AgenticEngine | `ai:provider` / `ai:model` の誤設定・未設定で agentic が選択された | `resolveMastraModel` がリクエスト時に throw → reject → memo フォールバック。（2026-06 の provider-agnostic 化により旧記述「Azure OpenAI 構成では利用不可」は解消: azure-openai は一級プロバイダとして解決される） | 4.5 |
| Orchestrator | agentic エンジンの reject | **memo 提案のみの 200 レスポンス**（5xx にしない） | 4.3, 4.5 |
| Orchestrator | oneshot エンジンの例外 | 現行どおり伝播（route で 500）。挙動変更しない | 5.3 |
| Route（5xx） | 上記以外の予期しない例外（memo 生成失敗等） | 500 + 汎用メッセージ（現行パターン） | — |

### Monitoring

- AgenticEngine のサマリログ（info）に `stopReason` を含め、timeout / error / budget_exhausted の発生率を運用観測できるようにする（6.2 の測定にも利用）
- 失敗時のエラー詳細は `logger.error` で記録（スタック含む）。レスポンスには内部情報を含めない

## Testing Strategy

> 共通規約は steering（tdd.md / testing rule / essential-test-design / essential-test-patterns）に従う。以下は本機能固有の検証項目。

### Unit Tests

1. **agentic-output-schema**: 型ガードの正常系 / informationType 不正 / path 欠落 / 余剰プロパティ拒否。JSON Schema 定数と TS 型の整合（required・enum 値）
2. **limited-search-tool**: budget 残あり → 委譲 + used 増加 + query 記録 / ちょうど上限 → `limit_exceeded` / searchBudget 欠落 → `context_error`。いずれも throw しないこと
3. **agentic-engine**: Agent モック（`mock<T>()`）で (a) 正常出力 → path 正規化・dedupe・20 件制限・grant 付与・informationType 付与、(b) 不正出力 → reject、(c) タイムアウト → reject、(d) searchLimit / timeoutMs が config から per-request に読まれること
4. **engine dispatcher / orchestrator**: engine 未指定 → config 既定（'oneshot'）/ リクエスト指定が優先 / agentic reject → memo のみ返却 / memo が常に先頭
5. **suggest-path-agent**: tools 構成（fullTextSearch = limited wrapper, getPageContent, listChildren）と memory 不接続、model が `resolveMastraModel` を lazy に転送すること

### Integration Tests

1. **既存テストの無修正 green**（最重要・5.3 の受け入れ証拠）: `generate-suggestions.spec.ts` / `suggest-path-integration.spec.ts` / 既存 4 サービスの spec が一切変更なしで通ること
   - 前提: 既存 spec のモジュールモック（`vi.mock`）はモジュール ID 単位で適用されるため、generate-suggestions → oneshot-engine の間接 import 化後も有効である見込み
   - 万一モック方式起因でテスト修正が避けられない場合、修正は**モックパスの機械的変更に限定**し、アサーション（期待挙動）には一切手を入れない。アサーション変更が必要になった時点で 5.3 違反として設計に立ち返る
2. **route**: `engine: 'agentic'` 指定リクエスト（agent モック）で 200 + 契約準拠レスポンス / `engine` 不正値で 400 / 未指定で oneshot 経路
3. **agentic 経路の統合**: モック agent が limit_exceeded を経て出力するシナリオで、レスポンスに informationType 付き search 提案 + memo が含まれること

### 実機検証（実装フェーズ冒頭のスパイク）

1. @mastra/core 1.41.0 実機で「limited search tool 複数回呼び出し → structured output 取得」の両立確認（mastra-ai/mastra#3139 系統の再発検知。壊れた場合は `structuredOutput.model` 明示指定に切り替え）
2. wrapper tool → `fullTextSearchTool.execute` 委譲の成立確認
3. dynamic model（関数指定）が config 変更を再起動なしで反映することの確認（3.4）

### Performance / A/B 測定（検証フェーズ・Requirement 6 の実施手順）

1. **A/B 測定（6.1）**: #183968 評価環境（ローカル GROWI + dev wiki データ、6 ユースケース × 10 回）で、リクエストの `engine` フィールドを切り替えて両エンジンを同一プロセス・同一条件で測定。指標は正解親配下出現率。ベースライン 41/60 と比較
2. **メトリクス記録（6.2）**: サマリログから 1 リクエスト毎のレスポンス時間・実検索回数・トークン消費を収集して記録
3. **誘導反映の確認（6.3）**: debug トレース（クエリ列・tool シーケンス）でフロー/ストック判定が検索誘導に反映されていることをユースケース毎に確認
4. **受け入れ判断（6.4）**: ベースライン未達の場合は探索過程ログに基づく原因分析を記録し、改善継続 / 方針転換を判断。結果は #183967 / #183968 と同じ GROWI 検証ページ群に記録する

## Security Considerations

- **認証・認可**: 既存ミドルウェアチェーン（AI scope の accessTokenParser + loginRequiredStrictly + certifyAiService)を無変更で維持（4.1）
- **権限スコープ（1.5）**: 検索・本文参照はリクエストユーザーの `IUserHasId` を per-request RequestContext で伝搬し、`SearchService.searchKeyword` / `Page.findByIdAndViewer` の既存権限フィルタに委譲。tool 側での再実装はしない（agentic-search spec の確立済み決定の踏襲）。RequestContext の module-scope 共有禁止により並行リクエスト間の user 漏れを防ぐ
- **プロンプトインジェクション**: 文書本文は信頼できない入力としてエージェントに渡る。エージェントが持つ tool は**読み取り専用かつ要求ユーザーの権限内**に限定されており、本文の細工による権限昇格・書き込みは構造的に不可能。出力は JSON Schema + 型ガード + path 正規化で検証され、任意文字列がレスポンス契約を壊すことはない
- **ログのプライバシー**: 本文・本文由来の検索クエリは debug レベル限定。info サマリはメタ情報（件数・時間・トークン）のみ
- **エンジン明示指定の濫用**: 認可済みユーザーは `engine: 'agentic'` を指定してコスト消費を増やせる。検証期は AI scope ゲートで許容し、一般提供時の制限要否は既定エンジン切り替え判断（スコープ外）と併せて検討する

## Performance & Scalability

- **応答時間の構造**: agentic エンジンは LLM ステップ × (検索 ≤ searchLimit + 本文参照 + 最終整形) で、ワンショット（LLM 2 回・数秒）より大幅に長い（searchLimit=5 で p50 15〜40 秒を想定）。これは精度とのトレードオフとして要件上合意済み（3 系・brief）。絶対上限は `aiTools:suggestPathAgenticTimeoutMs`（既定 60s）で保証し、超過時は memo フォールバック（4.5）
- **制御ノブ**: searchLimit（3〜5）・モデル（既定 gpt-4.1-mini）・timeoutMs。すべて設定で運用調整可能。既定値は A/B 測定の実測（6.2）を経て確定し、レスポンス時間上限の別途合意（Redmine #184610）に反映する
- **既定エンジンは 'oneshot'**（5.6）のため、本変更のマージ自体は本番のレスポンス時間・コストに影響しない
- **トークンコスト**: サマリログで毎リクエスト記録（6.2）。A/B でワンショット比のコスト増を定量化する
