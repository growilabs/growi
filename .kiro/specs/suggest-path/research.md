# Research & Design Decisions

> **現況注記**: 本ドキュメントは 2 段階の調査記録を統合したものである。前半(GROWI API パターン・grant システム・検索サービス統合)は 2026-02 の初回実装時の調査で、現行の agentic エンジンにもそのまま適用される基盤知識。後半(Mastra 統合・agentic 換装)は 2026-06〜07 の設計時の調査で、現行アーキテクチャの直接の根拠。

## Summary

- **Feature**: `suggest-path`
- **Key Findings**:
  - GROWI はハンドラファクトリパターン(`(crowi: Crowi) => RequestHandler[]`)を API ルートに使う
  - Grant の親子制約は `page-grant.ts` が強制する(GRANT_OWNER の子は同一 owner でなければならない)
  - `searchService.searchKeyword()` はキーワード文字列を受け取り、スコア付き結果をページメタデータ込みで返す
  - agentic エンジンの縫い目は LLM クライアント層ではなく **オーケストレータ層**(`generate-suggestions.ts`)に置くべき — パイプライン全体の差し替えが要件だったため
  - Mastra の structured output は内部 structuring agent による別パスで生成される(tool ループと出力整形が分離されており、tool 併用時に構造化出力が壊れる既知バグ系統への構造的対処が入っている)

## Research Log(初回実装時)

### GROWI API Route Patterns

- **Findings**: 3 種類のルータ(standard / admin / auth)のうち新規エンドポイントは standard に置く。ハンドラファクトリパターンは `(crowi: Crowi) => RequestHandler[]` を返す。ミドルウェア順序は `accessTokenParser → loginRequiredStrictly → validators → apiV3FormValidator → handler`。レスポンスヘルパーは `res.apiv3(data)` / `res.apiv3Err(error, status)`
- **Implications**: suggest-path はこのパターンに従う。ルートファクトリは `features/ai-tools/suggest-path/server/routes/apiv3/`、集約ルータは `features/ai-tools/server/routes/apiv3/`

### Grant System Constraints

- **Findings**: PageGrant の値は PUBLIC(1) / RESTRICTED(2) / SPECIFIED(3, 非推奨) / OWNER(4) / USER_GROUP(5)。OWNER 親の子は同一ユーザーの OWNER でなければならず、USER_GROUP 親の子は PUBLIC にできない。`calcApplicableGrantData(page, user)` がページに許可された grant 種別を返す
- **Implications**: memo パス(`/user/{username}/memo/`)の grant は、ユーザーホームページが既定で GRANT_OWNER(4)であることから固定的に 4 になる。search 提案は実際の親ページ grant を Page モデル経由で解決する必要がある

### Search Service Integration

- **Findings**: `searchKeyword(keyword, nqName, user, userGroups, searchOpts)` は `[ISearchResult, delegatorName]` を返す。`prefix:` クエリでパス配下に絞り込める。権限を反映した結果を返すには userGroups が必要
- **Implications**: `getUserRelatedGroups()` を使い、権限が正しく反映された検索結果を得る

### User Home Path Utilities

- **Findings**: `@growi/core` の `userHomepagePath(user)` が `/user/{username}` を返す
- **Implications**: memo 提案パスの生成に `userHomepagePath(req.user) + '/memo/'` を使う

## Architecture Pattern Evaluation(ルート名前空間の選定・初回実装時)

| Option | Strengths | Risks / Limitations | Notes |
|--------|-----------|---------------------|-------|
| `features/ai-tools/` 配下(採用) | プロバイダ非依存、独立したアクセス制御が可能 | — | 選定理由: 名前空間がプロバイダ実装に縛られず、`/page` からも独立してゲートできる |
| `features/openai/` 配下を拡張 | AI 基盤を再利用でき最小構成 | プロバイダ固有の名前になり、独立したアクセス制御が困難 | 却下: 名前空間はプロバイダ非依存であるべき |
| `routes/apiv3/page/` に追加 | ページ作成に近い | 独立したアクセス制御ができない | 却下: 独立したゲートが必要という要求に反する |

## Post-Implementation Discoveries(初回実装時)

### Lesson: この codebase では feature service 層に DI パターンより `vi.mock()` を優先する

- **Context**: 初回実装で `GenerateSuggestionsDeps`(5 個のコールバック関数を注入する deps パターン)をテスト容易性のために導入した
- **Problem**: 他モジュールは `vi.mock()` でテストしており一貫性がなく、ルートハンドラに配線の boilerplate が増え、`RetrieveSearchCandidatesOptions` のような不要な抽象化を強いた
- **Resolution**: deps パターンを削除。サービス関数は直接 import する。`searchService` のみパラメータとして渡す(静的 import できない唯一の外部依存のため)。テストは `vi.mock()` を使う
- **Guideline**: この codebase では feature 固有のサービス層に DI パターンより `vi.mock()` を優先する。DI は真の横断的関心事、または依存がランタイムで変わるサービスインスタンス(`searchService` のような)にのみ予約する

### Lesson: レガシーコードからの型伝播

- **Context**: `searchService.searchKeyword()`(`src/server/service/search.ts`)は untyped(JS からの移行の名残)で、当初 `userGroups: unknown` を安全策として使っていた
- **Resolution**: 実際の型を `findAllUserGroupIdsRelatedToUser()`(`ObjectIdLike[]` を返す、`@growi/core`)から辿り、`SearchService` インターフェースと全サービス関数に伝播させた
- **Guideline**: 型のないレガシーサービスと統合するときは、`unknown` に既定するのではなく呼び出し元から実際のランタイム型を辿る

## Research Log(agentic 換装時)

### Mastra 基盤の統合パターン(ai-agentic-search spec の踏襲点)

- **Findings**: Agent は `new Mastra({ agents: {...} })` に静的登録し `mastra.getAgent()` で取得する。RequestContext は per-request で生成(module-scope 共有は並行リクエストで user が漏れるため禁止、ai-agentic-search spec の確立済み決定)。tool は `createTool()` + zod discriminated union output で、execute から throw しない。権限フィルタは tool 側で再実装せず `SearchService` / `Page` モデルに委譲する

### @mastra/core の structured output / 制御 API(型定義実機確認、1.41.0)

- **Findings**: `schema` は Zod / AI SDK Schema / **JSON Schema** / StandardSchemaWithJSON を受け付け、JSON Schema 直接指定が第一級サポート(Zod 自動変換バグ mastra-ai/mastra#16383 の回避が公式ルートで可能)。内部 structuring agent 用モデル(`StructuredOutputOptionsBase.model`)は未指定時に親エージェントのモデルへフォールバックし、tool ループ終了後に別パスで整形する構造。`maxSteps` / `stopWhen` / `abortSignal` / `requestContext` が実行オプションに存在

## Design Decisions

### Decision: エンジン分岐はオーケストレータ層に置く

- **Alternatives Considered**: (a) LLM クライアント層(`call-llm-for-json`)だけを Mastra 化 — ワンショット構造(検索 1 回)が残り複数回検索の要件を満たせず不採用。(b) ルート層でエンドポイント分割(`/suggest-path-v2` 等)— API 契約変更になり不採用
- **Selected Approach**: `engines/` ディレクトリに `SuggestPathEngine` インターフェースを置き、`generateSuggestions` は memo 生成 + エンジンディスパッチ + フォールバックのみ担う
- **Rationale**: 「検証結果次第で旧エンジンを単独削除できる」という要求を物理的なファイル境界で保証できる(実際に features/openai 全廃時、engines/oneshot 一式の削除だけで完結した)

### Decision: 検索回数上限は budget 付き wrapper tool + RequestContext カウンタで執行

- **Selected Approach**: suggest-path 専用の `limited-search-tool` が RequestContext 上の `searchBudget` を読み、上限超過時に `{ result: 'limit_exceeded' }` を返す。`maxSteps` とタイムアウトを多層のセーフティネットとする
- **Rationale**: ループ強制打ち切りと違い、エージェントが gracefully に最終出力へ移行できる。共有 tool(`fullTextSearchTool`)は無改変で boundary を侵さない

### Decision: structured output は JSON Schema 直接記述 + generate() 呼び出し時指定

- **Context**: Mastra 既知バグ回避方針(#16383: Zod 変換が OpenAI strict mode 非互換、#7662: generateVNext 不使用)
- **Selected Approach**: 出力スキーマは feature 側(`agentic-output-schema.ts`)に JSON Schema 定数 + TypeScript 型 + 型ガードとして定義し、`agent.generate(prompt, { structuredOutput: { schema } })` で呼び出し時に渡す。Agent 定義(mastra 側ファイル)にはスキーマを持たせない
- **Rationale**: スキーマを suggest-path feature 側に置くことで、mastra-modules 側ファイルが suggest-path の型を知らずに済む(依存方向 ai-tools → mastra の一方向を維持)

### Decision: agentic エンジンは category 提案を生成しない

- **Alternatives Considered**: (1) structured output に category 種別を含めて生成させる、(2) ワンショット側 `generate-category-suggestion` を agentic 検索結果に再適用する、(3) 生成しない
- **Selected Approach**: (3)。agentic エンジンの提案はすべて `type: 'search'`
- **Rationale**: (2) はワンショット固有モジュールへの依存となり、将来のエンジン独立削除という境界に違反する。category(ES 上位ヒットのトップレベルを機械的に切り出す発想)は、複数回検索で適切な親に辿り着く agentic 探索では、浅い親が妥当ならエージェント自身が search 提案としてそれを出せる(機能的に包含)。既存 spec でも category 要件は Under Review であり、新エンジンへ引き継ぐ積極的根拠がなかった
- **Trade-offs**: A/B 比較でワンショット側だけ category 提案を含む非対称が生じたが、評価指標(正解親配下出現率)はレスポンス全体に対して判定するため比較の公平性は保たれた

## Risks & Mitigations

- **tool 併用 + structured output の両立が実機で壊れる(#3139 系統)** — 実装フェーズ最初のスパイクで 1.41.0 実機を確認(両立する、下記 Spike Results 参照)。壊れた場合の代替: `structuredOutput.model` に同一モデルを明示指定して structuring パスを強制分離する
- **agentic の命中率がベースラインを下回る** — 実際に初回 4/60 まで落ち込んだ(instructions の「PARENT DIRECTORY」表現がリーフページ配下への提案を妨げていたことが主因)。原因分析 → instructions チューニング 2 ラウンドで 52/60 まで改善し受け入れ判断済み(詳細は tasks.md 7.1/7.2)
- **Mastra バージョン変動(rebase / 上流マージ)** — `MastraRequestContextShape` や tool シグネチャの変更があれば再検証(design.md の Revalidation Triggers)。support/mastra マージ後の 1.45.0 での再検証は未実施
- **評価環境の fragility(mongo 匿名ボリューム・ES プラグイン設定)** — 再構築手順に従う。測定前にインデックス健全性を確認

## Spike Results(@mastra/core 1.41.0 実機確認)

実行環境: devcontainer(`@mastra/core@1.41.0` 実機 + OpenAI API 実呼び出し)。

### tool 複数回呼び出し + structured output の両立(mastra#3139 系統) — 両立する

- 1 回の `generate` で検索 tool が 2 回呼ばれ、最終 step の後に `result.object` が JSON Schema 準拠の構造化出力として取得できた。2 回連続実行で再現。`structuredOutput.model` の明示指定は不要(`totalUsage` が steps の合計と完全一致しており、構造化のための追加 LLM 呼び出しの消費は観測されなかった)
- **2 回の tool call は同一 step 内で並列発行された**(step 数 ≠ 検索回数の実証)。検索回数を wrapper tool 側の budget でカウントする設計の正しさを裏付ける

### wrapper tool → fullTextSearchTool.execute 委譲 — 成立する

- wrapper の execute から元 tool の execute へ `(inputData, context)` をそのまま転送するだけで委譲が成立。budget 消費・上限到達時の `limit_exceeded`・context 欠落時の `context_error` も期待どおり
- zod の default 適用は Mastra ランタイムの入力 validation(= wrapper の inputSchema)で行われるため、wrapper の入力スキーマは元 tool と同一(default 含む)に保つ必要がある

### dynamic model(関数指定)の per-generate 評価 — 再起動なしで反映される

- `model: () => provider(currentModel)` の Agent で、モデル変数の変更がプロセス再起動なしで次回 generate に反映されることを確認
- モデル解決関数は **1 回の generate につき 2 回**評価される。軽量処理(configManager 読み出し等)なら問題ないが、副作用・高コスト処理を入れないこと

### steps / usage の実形状とトレースログ整形方針

- `agent.generate` 戻り値のトップレベルキー: `text, usage, steps, finishReason, ..., totalUsage, object, error, ...`
- **usage / totalUsage は AI SDK v5 命名**: `{ inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens, raw }`。v4 命名(`promptTokens` / `completionTokens`)は存在しない。`usage` と `totalUsage` は観測上同値(いずれも steps 横断の合計。型定義コメントの「usage = 最終 step」とは異なる挙動)。ログには意味が一意な `totalUsage` を使う
- **tool call / result の位置**: `steps[i].toolCalls[j]` は `{ type: 'tool-call', runId, from: 'AGENT', payload: { toolCallId, toolName, args, providerMetadata } }`。tool 名は `payload.toolName`、引数は `payload.args`、戻り値は `steps[i].toolResults[j].payload.result`

### 副次的発見: pnpm override が @mastra/core の ESM import を壊す

- pnpm-workspace.yaml の `@mastra/core>p-map: 4.0.0` override により、@mastra/core の **ESM ビルドは import 不可**(p-map@4 に `pMapSkip` named export がなく module link エラー)。CJS ビルド(GROWI サーバが実際にロードする側)は正常動作する。vitest から `@mastra/core/agent` を実体 import するとこのエラーで落ちるため、suggest-path-agent のユニットテストは `vi.mock('@mastra/core/agent', ...)`(StubAgent パターン)を使う。`@mastra/core/request-context` / `@mastra/core/tools` は p-map を参照せず vitest からも import 可能

## Reconcile Notes(2026-07-06 実態追従)

実装完了・受け入れ後の変化により、当時の調査記録のうち以下は現状と異なる。

- **@mastra/core のバージョン**: Spike Results 時点の installed は `1.41.0`。support/mastra 上流マージを経て現在は **1.45.0**(宣言 `^1.32.1` は不変)。スパイク結論(steps/usage 形状・structuredOutput 挙動・p-map ESM 回避)の 1.45.0 での再検証は未実施
- **モデル解決方式**: 当初の `getOpenaiProvider()` + `openai:assistantModel:mastraAgent` キーは support/mastra の provider-agnostic 化で消滅。`model: () => resolveMastraModel()`(lazy・memoize・AI 設定保存時 cache clear)に統一され、再起動なし反映は per-generate 評価ではなく memoize + cache clear で実現されている
- **設定キー**: 当初 4 キー計画からその後 reasoning effort キーと `aiTools:suggestPathAgenticChildListingLimit`(#185213)が加わった。一方 `openai:assistantModel:suggestPathAgent` は読み手のいない dead key として削除された
- **tool 構成**: 設計時の 2 tool(limited fullTextSearch + getPageContent)に listChildren tool が追加され 3 tool 構成(#185213、peer-placement verification)

## References

- Redmine #184610 — 対象ストーリー(受け入れ条件: 命中率向上・レスポンス時間・フロー/ストック誘導)
- `.kiro/specs/ai-agentic-search/design.md` — RequestContext パターン・tool 設計規約・グラント委譲の確立済み決定
- [mastra-ai/mastra#7662](https://github.com/mastra-ai/mastra/issues/7662) — generateVNext で tool 後に structured output が出ないバグ(回避: 使用しない)
- [mastra-ai/mastra#16383](https://github.com/mastra-ai/mastra/issues/16383) — Zod → JSON Schema 変換の OpenAI strict mode 非互換(回避: JSON Schema 直接記述)
- [mastra-ai/mastra#3139](https://github.com/mastra-ai/mastra/issues/3139) — structured output 使用時に tools が外れる報告(対処: スパイク実機確認 + structuring model 分離)
- `packages/core/src/interfaces/page.ts` — PageGrant enum 定義
- `apps/app/src/server/service/page-grant.ts` — Grant 検証ロジック
