# Research & Design Decisions: suggest-path-agentic

## Summary

- **Feature**: `suggest-path-agentic`
- **Discovery Scope**: Extension（既存 suggest-path API への統合 + 既存 Mastra 基盤の再利用。統合点重視の light discovery + 型定義の実機確認）
- **Key Findings**:
  - エンジンの縫い目は `call-llm-for-json.ts`（LLM クライアント層）ではなく **`generate-suggestions.ts`（オーケストレータ層）** に置くべき。Requirement 5.5（ワンショット固有モジュールへの非依存）は LLM 呼び出しの差し替えではなくパイプライン全体の差し替えを要求しているため
  - インストール実体は `@mastra/core@1.41.0`（package.json 宣言は `^1.32.1`、pnpm 解決で 1.41.0）。brief の viability check と同一バージョンであり、`Agent.generate()` + `structuredOutput`（JSON Schema 直接指定）+ `maxSteps` / `stopWhen` / `abortSignal` / `requestContext` が型定義上すべて利用可能
  - Mastra 1.41 の structured output は**内部 structuring agent による別パス**で生成される（`StructuredOutputOptionsBase.model`: "Model to use for the internal structuring agent"）。tool ループと出力整形が分離されており、tool 併用時に structured output が壊れる既知バグ系統（mastra-ai/mastra#3139）への構造的対処が入っている。ただし実機確認は実装フェーズ最初のスパイクで行う
  - 既存 `fullTextSearchTool` / `getPageContentTool` は権限スコープを `SearchService.searchKeyword` / `Page.findByIdAndViewer` に完全委譲しており、per-request `RequestContext` で user を渡す設計。Requirement 1.5 はこのパターンの踏襲で満たせる

## Research Log

### 現行 suggest-path の構造とエンジンの縫い目

- **Context**: 新旧エンジン並存（Requirement 5）の分岐点をどこに置くか
- **Sources Consulted**: `apps/app/src/features/ai-tools/suggest-path/` 全ファイル（コードベース調査）
- **Findings**:
  - 現行パイプライン: `generateSuggestions`（オーケストレータ）= memo 生成 → `analyzeContent`（LLM #1: キーワード + flow/stock）→ `retrieveSearchCandidates`（ES 1 回、score >= 5.0 フィルタ）→ 並列 [`evaluateCandidates`（LLM #2）+ grant 解決, `generateCategorySuggestion`]
  - memo 生成（`generate-memo-suggestion.ts`）と grant 解決（`resolve-parent-grant.ts`）はエンジン非依存の共通基盤。それ以外の 4 サービス（analyze / retrieve / evaluate / category）はワンショットエンジン固有
  - graceful degradation は `generateSuggestions` 内に実装済み（analyze/retrieve 失敗 → memo のみ返却）
  - ルート（`suggest-path/server/routes/apiv3/index.ts`）は accessTokenParser（AI scope）→ loginRequiredStrictly → certifyAiService → validator の構成。タイムアウト処理は未実装（Node デフォルト依存）
  - モデルは `call-llm-for-json.ts` に `gpt-4.1-nano` ハードコード（brief の Constraints で踏襲しないことが確定済み）
- **Implications**: エンジン分岐は `generateSuggestions` 内のディスパッチとし、memo + grant 解決を共通基盤として両エンジンから利用する。ワンショット側 4 サービスは無改変のまま `oneshot-engine` がオーケストレーションだけ包む（Requirement 5.3 の挙動維持）

### Mastra 基盤の統合パターン（agentic-search spec の踏襲点）

- **Context**: suggest-path 専用 Agent を既存パターンに整合させる
- **Sources Consulted**: `apps/app/src/features/mastra/server/services/mastra-modules/`、`.kiro/specs/agentic-search/design.md`、`post-message.ts`
- **Findings**:
  - Agent 登録: `new Mastra({ agents: { growiAgent } })` に静的登録し `mastra.getAgent()` で取得するパターン
  - RequestContext: **per-request で `new RequestContext<MastraRequestContextShape>()` を生成**（module-scope 共有は並行リクエストで user が漏れるため禁止。agentic-search spec の確立済み決定）。shape は `{ user: IUserHasId, searchService: SearchService }`
  - tool は `createTool()` + zod discriminated union output で、**execute から throw しない**（失敗も値で返してエージェントループを生かす）
  - 権限フィルタは tool 側で再実装せず `SearchService` / `Page` モデルに委譲
  - モデル解決: `getOpenaiProvider()(configManager.getConfig('openai:assistantModel:mastraAgent'))`、provider は `@ai-sdk/openai`
  - growiAgent は構築時にモデルを解決している（変更にはプロセス再起動が必要）
- **Implications**: suggestPathAgent も同じ登録・コンテキスト・tool 規約に従う。ただしモデルは Requirement 3.4（設定変更の動的反映）のため **`DynamicArgument`（関数指定）で per-request 解決**に改善する（`@mastra/core` 1.41 の Agent constructor は `model: DynamicArgument<MastraModelConfig>` を受け付けることを型定義で確認済み）

### @mastra/core 1.41.0 の structured output / 制御 API（型定義実機確認）

- **Context**: brief の Mastra 技術的注意点（既知バグ回避）が installed バージョンで成立するかの裏取り
- **Sources Consulted**: `node_modules/.pnpm/@mastra+core@1.41.0_*/node_modules/@mastra/core/dist/agent/agent.types.d.ts`, `dist/agent/types.d.ts`
- **Findings**:
  - `PublicStructuredOutputOptions.schema: PublicSchema<OUTPUT>` — コメントに "(Zod, AI SDK Schema, **JSON Schema**, StandardSchemaWithJSON)" と明記。**JSON Schema 直接指定が第一級サポート**（Zod 自動変換バグ mastra-ai/mastra#16383 の回避が公式ルートで可能）
  - `StructuredOutputOptionsBase.model` — 内部 structuring agent 用モデル。未指定時は親エージェントのモデルにフォールバック。tool ループ終了後に別パスで整形する構造
  - `errorStrategy: 'fallback'` + `fallbackValue` — 整形失敗時のフォールバック値指定が可能（本設計では使わず strict のまま例外 → memo フォールバックに統一）
  - 実行オプションに `maxSteps?: number`、`stopWhen?: LoopOptions['stopWhen']`、`abortSignal`、`requestContext?: RequestContext<any>` が存在
- **Implications**: brief の回避方針（generateVNext 不使用 / JSON Schema 直接記述）は 1.41.0 でそのまま実現可能。タイムアウトは `AbortController` + `abortSignal` で実装。tool 併用 + structured output の両立は型定義上問題ないが、**実装フェーズ最初のスパイクタスクで実機確認する**（brief の指示通り）

### configManager のキー追加パターン

- **Context**: エンジン切り替え・検索回数上限・タイムアウト・モデルの設定化（Requirement 3.3, 3.4, 5.2, 5.6）
- **Sources Consulted**: `apps/app/src/server/service/config-manager/config-definition.ts`
- **Findings**:
  - キーは flat な const リストに追加し、`defineConfig<T>({ envVarName, defaultValue, isSecret? })` で定義。例: `'openai:assistantModel:mastraAgent'` → env `OPENAI_MASTRA_AGENT_MODEL`、default `'o4-mini'`
  - `configManager.getConfig(key)` は呼び出し時点の値を返すため、リクエスト毎に読めば再起動なしで変更が反映される
- **Implications**: 新キー 4 つ（engine / searchLimit / timeoutMs / model）を追加。すべてエンジン実行時（per-request）に読む

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| LLM クライアント層差し替え（`call-llm-for-json` を Mastra 化） | 既存 2 段 LLM 呼び出しの中身だけ Mastra に置換 | 変更最小 | ワンショット構造（検索 1 回）が残り Requirement 1.2（再検索）を満たせない。5.5 の分離も不成立 | 不採用 |
| **オーケストレータ層エンジン分岐**（`SuggestPathEngine` interface + 2 実装） | `generateSuggestions` が memo + エンジン選択を担い、ワンショット/agentic を並存 | 5.1〜5.6 を構造的に満たす。ワンショット側コード無改変。将来の旧エンジン削除が engines/oneshot の削除だけで済む | オーケストレータの軽微な再構成が必要（既存テストで挙動維持を担保） | **採用** |
| ルート層分岐（エンドポイント分割） | `/suggest-path-v2` 等を新設 | 完全分離 | API 契約変更になり Requirement 4.1 違反。MCP クライアント側変更が必要 | 不採用 |

**検索回数上限の実現方式**:

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| `stopWhen` / `maxSteps` のみ | ステップ数でループを打ち切り | 実装ゼロに近い | 打ち切り時に最終出力が生成されない恐れ（Requirement 3.2「収集済み情報で提案を生成」に反する）。step ≠ 検索回数（1 step に複数 tool call があり得る） | 補助的セーフティネットとして併用 |
| **budget 付き wrapper tool** | fullTextSearchTool を包む専用 tool が RequestContext 上のカウンタで上限を執行し、超過時は `limit_exceeded` を値で返す | 検索回数を正確にカウント。エージェントが超過を認識して**自発的に手仕舞いできる**（3.2 を自然に満たす）。共有 tool は無改変（boundary 遵守） | wrapper から元 tool の execute 委譲が成立するかの実機確認が必要 | **採用**（maxSteps + タイムアウトを多層防御として併用） |

## Design Decisions

### Decision: エンジン分岐はオーケストレータ層に置く

- **Context**: Requirement 5（切り替え並存・旧エンジン挙動不変・固有モジュール非依存）
- **Alternatives Considered**: 上記 Architecture Pattern Evaluation 参照
- **Selected Approach**: `engines/` ディレクトリに `SuggestPathEngine` インターフェース + `oneshot-engine` / `agentic-engine` の 2 実装。`generateSuggestions` は memo 生成 + エンジンディスパッチ + フォールバックのみ担う
- **Rationale**: 5.5 の分離要求（検証後に旧エンジンを単独削除可能）を物理的なファイル境界で保証できる。coding-style の data-driven dispatch 原則にも整合
- **Trade-offs**: `generateSuggestions` の内部再構成が必要だが、シグネチャと挙動は維持され既存テストがそのまま回帰ガードになる
- **Follow-up**: 既存 `generate-suggestions.spec.ts` / 統合テストが無修正で green であることを実装時に確認

### Decision: 検索回数上限は budget 付き wrapper tool + RequestContext カウンタで執行

- **Context**: Requirement 3.1〜3.3（上限・上限到達時の手仕舞い・設定変更反映）
- **Selected Approach**: suggest-path 専用の `limited-search-tool` が `SuggestPathRequestContextShape`（共有 shape の拡張型）上の `searchBudget` を読み、上限超過時に `{ result: 'limit_exceeded' }` を返す。instructions で「limit_exceeded を受けたら収集済み情報で提案を確定せよ」と指示。`maxSteps`（= 2 × searchLimit + 4）とタイムアウトを多層のセーフティネットとする
- **Rationale**: ループ強制打ち切りと違い、エージェントが gracefully に最終出力へ移行できる。共有 tool (`fullTextSearchTool`) は無改変で boundary（agentic-search spec 所有）を侵さない
- **Trade-offs**: tool 委譲の実装がやや増える。budget が RequestContext 経由になるためテストで shape を組み立てる手間
- **Follow-up**: wrapper → 元 tool の `execute` 委譲のシグネチャをスパイクで確認

### Decision: structured output は JSON Schema 直接記述 + generate() 呼び出し時指定

- **Context**: brief の Mastra 既知バグ回避方針（#16383: Zod 変換が OpenAI strict mode 非互換、#7662: generateVNext 不使用）
- **Selected Approach**: 出力スキーマは `agentic-output-schema.ts` に JSON Schema 定数 + TypeScript 型 + 型ガードとして定義し、`agent.generate(prompt, { structuredOutput: { schema } })` で呼び出し時に渡す。Agent 定義（mastra 側ファイル）にはスキーマを持たせない
- **Rationale**: スキーマを suggest-path feature 側に置くことで、mastra-modules 側ファイルが suggest-path の型を知らずに済む（依存方向: ai-tools → mastra の一方向を維持）。型ガードによる二重検証で LLM 出力の信頼性を担保
- **Trade-offs**: JSON Schema と TS 型の二重管理（型ガードのユニットテストで乖離を検出）
- **Follow-up**: スパイクで tool 併用 + structured output の両立を実機確認（#3139 系統の再発検知）

### Decision: agentic エンジンは category 提案を生成しない

- **Context**: Requirement 5 Note（category 提案の扱いは design で確定）
- **Alternatives Considered**:
  1. エージェントの structured output に category 種別を含めて生成させる
  2. ワンショット側 `generate-category-suggestion` を agentic 検索結果に再適用する
  3. agentic エンジンでは生成しない（対象外とする）
- **Selected Approach**: 3. 生成しない。agentic エンジンの提案はすべて `type: 'search'`
- **Rationale**: (a) 案 2 はワンショット固有モジュールへの依存となり Requirement 5.5 違反。(b) category（トップレベル `/カテゴリ/` 直下）は「ES 上位ヒットのトップレベルを機械的に切り出す」発想で、複数回検索で適切な親に辿り着く agentic 探索では、浅い親が妥当ならエージェント自身が search 提案としてそれを出せる（機能的に包含）。(c) 既存 spec でも category 要件は Under Review であり、新エンジンへ引き継ぐ積極的根拠がない
- **Trade-offs**: A/B 比較でワンショット側だけ category 提案を含む非対称が生じるが、評価指標（正解親配下出現率）はレスポンス全体に対して判定するため比較の公平性は保たれる
- **Follow-up**: A/B 測定で agentic 側のトップレベル提案の出現傾向を観察し、必要なら instructions を調整

### Decision: 設定 4 キーを新設し per-request に解決する

- **Context**: Requirement 3.3（上限変更反映）、3.4（モデル変更反映）、5.2/5.6（既定エンジン）、4.5（タイムアウト）
- **Selected Approach**:
  - `aiTools:suggestPathEngine`（'oneshot' | 'agentic'、default 'oneshot'、env `AI_TOOLS_SUGGEST_PATH_ENGINE`）
  - `aiTools:suggestPathAgenticSearchLimit`（number、default 5、env `AI_TOOLS_SUGGEST_PATH_AGENTIC_SEARCH_LIMIT`）
  - `aiTools:suggestPathAgenticTimeoutMs`（number、default 60000、env `AI_TOOLS_SUGGEST_PATH_AGENTIC_TIMEOUT_MS`）
  - `openai:assistantModel:suggestPathAgent`（string、default 'gpt-4.1-mini'、env `OPENAI_SUGGEST_PATH_AGENT_MODEL`）
  - いずれもエンジン実行時に `configManager.getConfig()` で読む。モデルは Agent の `model` を `DynamicArgument`（関数）にして per-request 解決
- **Rationale**: 既存命名規約（`openai:assistantModel:mastraAgent`）に整合。per-request 読み出しで再起動なしの設定反映（growiAgent の構築時解決より要件適合度が高い）
- **Trade-offs**: searchLimit の既定 5 は精度側に倒した値（合意済みレンジ 3〜5 の上限）。タイムアウト既定 60s は MCP クライアントの一般的タイムアウトを意識した暫定値。いずれも A/B 測定の実測で見直す
- **Follow-up**: A/B 測定でレスポンス時間実測を記録し、既定値（searchLimit / timeoutMs / model）の最終確定を行う（Requirement 6.2 / Redmine #184610 の「別途合意」事項）

### Decision: エンジン選択はリクエストレベル override + config 既定の二段構え

- **Context**: Requirement 5.2「明示的に指定されないとき既定エンジン」、6.1（同一条件 A/B 測定）
- **Selected Approach**: リクエストボディに optional な `engine` フィールド（enum: 'oneshot' | 'agentic'）を追加。未指定時は config `aiTools:suggestPathEngine` の値
- **Rationale**: 5.2 の文言自体が明示指定の存在を前提としている。A/B 測定はサーバ再起動なしで同一プロセス・同一条件の交互測定が可能になる。optional フィールド追加は後方互換（4.1 維持）
- **Trade-offs**: 認可済みクライアントは agentic を明示指定でき、運用者が想定しないコスト消費があり得る。AI scope + ログイン必須で既にゲートされており、初期段階（検証期）は許容。一般提供時に制限が必要なら別途検討
- **Follow-up**: なし

### Decision: suggestPathAgent は memory なし・Mastra インスタンスに静的登録

- **Context**: チャット用 growiAgent との並列定義（brief の Approach）
- **Selected Approach**: `mastra-modules/agents/suggest-path/` サブディレクトリ（barrel 付き）に Agent 定義・instructions・wrapper tool・context 型を配置。memory は接続しない（suggest-path はステートレス）。`mastra-modules/index.ts` の Mastra インスタンスに 1 行追加で登録
- **Rationale**: 登録によりプラットフォーム共通の logger / observability が効く（Requirement 2.4 の探索過程記録を補強）。memory 不接続でスレッド永続化のオーバーヘッドとデータ残留を回避
- **Trade-offs**: `mastra-modules/index.ts`（agentic-search spec の成果物）への 1 行の additive 変更が発生。境界上は本 spec が新規ファイル追加 + レジストリ 1 行のみを所有する

## Synthesis Outcomes

- **Generalization**: ワンショット/agentic を `SuggestPathEngine` インターフェース（入力: user / body / userGroups / searchService、出力: `PathSuggestion[]`）の 2 実装として一般化。インターフェースのみ一般化し、レジストリ等の拡張機構は作らない（実装は 2 つの static map）
- **Build vs. Adopt**:
  - Adopt: Mastra Agent ループ（自前の検索リトライループは書かない）、既存 `fullTextSearchTool` / `getPageContentTool`（無改変）、既存共通基盤（memo 生成・grant 解決・configManager・pino logger）、agentic-search spec の RequestContext パターン
  - Build: budget 付き wrapper tool（既存機構では Requirement 3.2 の graceful 手仕舞いを保証できない）、JSON Schema 定数 + 型ガード（既知バグ回避）、エンジンディスパッチ
- **Simplification**:
  - category 提案を agentic エンジンから除外（上記 Decision）
  - suggestPathAgent に memory を接続しない
  - モデルのリクエストレベル override は作らない（config のみ。Requirement 3.4 は設定変更のみ要求）
  - エンジンレジストリ抽象を作らない（2 実装の単純な分岐）
  - ワンショット側 4 サービスのファイル移動・リファクタをしない（オーケストレーション wrapper のみ新設）

## Risks & Mitigations

- **tool 併用 + structured output の両立が実機で壊れる（#3139 系統）** — 実装フェーズ最初にスパイクタスクを置き、1.41.0 実機で「検索 tool 複数回呼び出し → structured output 取得」を確認。壊れた場合の代替: `structuredOutput.model` に同一モデルを明示指定して structuring パスを強制分離する
- **wrapper tool から元 tool への execute 委譲が成立しない** — スパイクで確認。不成立時の代替: wrapper 内で `SearchService.searchKeyword` を直接呼ぶ（fullTextSearchTool と同等のマッピングを実装。重複は限定的）
- **レスポンス時間が許容範囲を超える** — searchLimit / model / timeoutMs を config 化済み。A/B 測定（Requirement 6.2）でレスポンス時間を記録し、既定値を調整。タイムアウト時は memo フォールバックで API としては応答を保証（4.5）
- **agentic の命中率がベースライン 41/60 を下回る** — Requirement 6.4 の通り原因分析を記録し受け入れ判断。エンジン既定は 'oneshot' のまま（5.6）なので本番影響なし。instructions チューニングの余地（flow/stock 誘導、語彙バリエーション戦略）を探索過程ログ（2.4）で分析
- **support/mastra ブランチの変動（rebase / 上流マージ）** — 本 spec のブランチは support/mastra 派生。`MastraRequestContextShape` や tool シグネチャの変更があれば再検証（design.md の Revalidation Triggers に記載）
- **評価環境の fragility（mongo 匿名ボリューム・ES プラグイン設定）** — #183968 の再構築手順（devcontainer 側ドキュメント）に従う。測定前にインデックス健全性（1405 docs）を確認

## References

- Redmine #184610 — 対象ストーリー（受け入れ条件: 命中率向上・レスポンス時間・フロー/ストック誘導）
- `.kiro/specs/suggest-path-agentic/brief.md` — スコープ境界・Mastra viability check（1.41.0）
- `.kiro/specs/agentic-search/design.md` — RequestContext パターン・tool 設計規約・グラント委譲の確立済み決定
- [mastra-ai/mastra#7662](https://github.com/mastra-ai/mastra/issues/7662) — generateVNext で tool 後に structured output が出ないバグ（回避: 使用しない）
- [mastra-ai/mastra#16383](https://github.com/mastra-ai/mastra/issues/16383) — Zod → JSON Schema 変換の OpenAI strict mode 非互換（回避: JSON Schema 直接記述）
- [mastra-ai/mastra#3139](https://github.com/mastra-ai/mastra/issues/3139) — structured output 使用時に tools が外れる報告（対処: スパイク実機確認 + structuring model 分離）
- `@mastra/core@1.41.0` 型定義（`dist/agent/agent.types.d.ts`, `dist/agent/types.d.ts`）— structuredOutput / maxSteps / stopWhen / abortSignal / requestContext / DynamicArgument の実機確認
- #183964 / #183967 / #183968 — 評価器・代表ユースケース・ベースライン測定（41/60）

## Spike Results (Task 2, 2026-06-11)

実行環境: devcontainer（`@mastra/core@1.41.0` 実機 + OpenAI API 実呼び出し）。スパイクコードは throwaway（コンテナ内のみに配置し、実行後に削除済み）。実行形態は 2 本:

- **OpenAI 実機スクリプト**（項目 1・3・4 + 委譲のランタイム封筒確認）: `node` 直接実行の CJS スクリプト。budget 付き wrapper tool → 内部 canned 検索 tool（初回 0 件 → 2 回目以降ヒット）を持つ Agent に対し、design の呼び出し契約どおり `agent.generate(prompt, { structuredOutput: { schema: AGENTIC_OUTPUT_JSON_SCHEMA }, maxSteps: 14, requestContext })` を実行（JSON Schema 直接指定・generateVNext 不使用）。モデルは gpt-4.1-mini / nano。2 回連続実行していずれも全アサーション PASS
- **委譲 integ テスト**（項目 2）: vitest app-integration プロジェクト（実 MongoDB + dummy ES delegator。`full-text-search-tool.integ.ts` と同一規約）で `pnpm vitest run spike-wrapper-delegation` → 3 tests passed

### 項目 1: tool 複数回呼び出し + structured output の両立（mastra#3139 系統） — ✅ 両立する

- 観測: 1 回の `generate` で検索 tool が 2 回呼ばれ（step 0: finishReason `'tool-calls'`）、最終 step（finishReason `'stop'`）の後に `result.object` が JSON Schema 準拠の構造化出力として取得できた（`informationType: 'flow'`、`suggestions` 3 件、全フィールド string、trailing slash 付き親パス）。2 回連続実行で再現
- `structuredOutput.model` の明示指定（structuring パス分離）は**不要**。`totalUsage` が steps の合計と完全一致しており（452+731=1183 input / 71+161=232 output）、構造化のための追加 LLM 呼び出しの消費は観測されなかった
- 注意: 2 回の tool call は**同一 step 内で並列発行**された（step 数 ≠ 検索回数の実証）。検索回数を wrapper tool 側の budget でカウントする設計の正しさを裏付ける
- **採用方針**: design の呼び出し契約（JSON Schema 直接指定 + `maxSteps` + `requestContext`）をそのまま採用。`structuredOutput.model` は指定しない

### 項目 2: wrapper tool → fullTextSearchTool.execute 委譲 — ✅ 成立する

- 観測（integ・実 SearchService 経路）: wrapper の execute から `fullTextSearchTool.execute!(inputData as never, context as never)` へ (inputData, context) を**そのまま転送**するだけで委譲が成立。dummy delegator のヒットが `{ pageId, pagePath, snippet }` にマッピングされ（body 非漏洩も確認）、user は参照同一性のまま `delegator.search` まで到達。budget 消費（`used` インクリメント・`queries` 記録）、上限到達時の `limit_exceeded`（委譲なし・budget 不変）、`searchBudget` 欠落時の `context_error`（委譲なし）も期待どおり
- 観測（OpenAI 実機・実ランタイム封筒）: Mastra agent ループが wrapper に渡す context 封筒を内部 tool の execute へ転送しても、委譲先から `requestContext`（user / searchBudget）が読めることを確認
- 補足: zod の default 適用は Mastra ランタイムの入力 validation（= wrapper の inputSchema）で行われるため、wrapper の入力スキーマは元 tool と同一（default 含む）に保つこと（design 記載どおり）
- **採用方針**: budget 付き wrapper tool（execute 委譲方式）を採用。`SearchService.searchKeyword` 直接呼び出しの代替案は不要

### 項目 3: dynamic model（関数指定）の per-generate 評価 — ✅ 再起動なしで反映される

- 観測: `model: () => openai(currentModel)` の Agent で、1 回目 generate（currentModel='gpt-4.1-nano'）→ `response.modelId: 'gpt-4.1-nano-2025-04-14'`、変数を変更した 2 回目 generate → `'gpt-4.1-mini-2025-04-14'`。プロセス再起動なしで実使用モデルが追従
- 注意: モデル解決関数は **1 回の generate につき 2 回**評価された（2 generate で計 4 回）。`configManager.getConfig()` のような軽量処理なら問題ないが、副作用・高コスト処理を入れないこと
- **採用方針**: design どおり `model: () => getOpenaiProvider()(configManager.getConfig('openai:assistantModel:suggestPathAgent'))` を採用（Requirement 3.4 の充足を実機実証）

### 項目 4: steps / usage の実形状とトレースログ整形方針

実測（`agent.generate` 戻り値 = `FullOutput`、@mastra/core 1.41.0）:

- **トップレベルキー**: `text, usage, steps, finishReason, warnings, providerMetadata, request, reasoning, reasoningText, toolCalls, toolResults, sources, files, response, totalUsage, object, error, tripwire, traceId, spanId, runId, suspendPayload, resumeSchema, messages, rememberedMessages`
- **usage / totalUsage は AI SDK v5 命名**:

  ```json
  { "inputTokens": 1183, "outputTokens": 232, "totalTokens": 1415, "reasoningTokens": 0, "cachedInputTokens": 0, "raw": { "...": "provider 生値" } }
  ```

  - v4 命名（`promptTokens` / `completionTokens`）は**存在しない**
  - 観測上 `usage` と `totalUsage` は同値（いずれも steps 横断の合計。型定義コメントの「usage = 最終 step」とは異なる挙動）。`raw` サブオブジェクトのみ最終 step のプロバイダ生値だった。**ログには意味が一意な `totalUsage` を使う**
- **steps**: `LLMStepResult[]`。各 step のキー: `stepType, sources, files, toolCalls, toolResults, content, text, tripwire, reasoningText, reasoning, staticToolCalls, dynamicToolCalls, staticToolResults, dynamicToolResults, finishReason, usage, warnings, request, response, providerMetadata`。step ごとの `usage` も同じ v5 形状
- **tool call / result の位置**: `steps[i].toolCalls[j]` は chunk 形式 `{ type: 'tool-call', runId, from: 'AGENT', payload: { toolCallId, toolName, args, providerMetadata } }`。tool 名は **`payload.toolName`**（Agent の tools レコードのキー名。例: `'fullTextSearch'`）、引数は **`payload.args`**、tool 戻り値は `steps[i].toolResults[j].payload.result`。トップレベル `result.toolCalls` には全 step 分の集約が入る（steps の flatMap と同数）
- **トレースログ整形方針（採用）**:
  - 検索回数・クエリ列: requestContext の `searchBudget.used` / `queries` を一次情報とし、`steps[].toolCalls[].payload`（toolName フィルタ）で突合可能
  - getPageContent 呼び出し回数・tool 呼び出し列の再構成: `steps` を順に走査して `toolCalls[].payload.toolName / .args` を抽出
  - トークン: info サマリに `totalUsage.inputTokens / outputTokens / totalTokens` を記録
  - stopReason: トップレベル `finishReason`（`'stop'` 等）を記録

### 副次的発見（実装タスクへの影響）

- **pnpm override `@mastra/core>p-map: 4.0.0`（pnpm-workspace.yaml）の影響**: @mastra/core の **ESM ビルドは import 不可**（p-map@4 に `pMapSkip` named export がなく module link エラー）。CJS ビルド（GROWI サーバが実際にロードする側）は pMapSkip を参照せず正常動作する。vitest（unit / integration いずれのプロジェクトでも）から `@mastra/core/agent` を**実体 import するとこのエラーで落ちる**ため、suggest-path-agent のユニットテストは既存 `growi-agent.spec.ts` と同じく `vi.mock('@mastra/core/agent', ...)`（StubAgent パターン）を踏襲すること。`@mastra/core/request-context` / `@mastra/core/tools` は p-map を参照せず vitest からも import 可能（既存・スパイク両方の integ テストで実証済み）
- 参考実測値: 検索 2 回 + 構造化出力の 1 generate で約 4.2 秒 / 計 1,415 tokens（gpt-4.1-mini、canned tool + 実 LLM。実 ES 検索や getPageContent を含まない下限値）

## Reconcile Notes (2026-07-06 実態追従)

実装完了・受け入れ後の変化により、上記の記録のうち以下は**当時の事実であって現状とは異なる**。原文は当時の調査記録として温存し、supersede をここに集約する（現状の正は design.md 2026-07-06 改訂版）。

- **@mastra/core のバージョン**: 本文・Spike Results の `1.41.0` は設計〜スパイク時点の installed。support/mastra 上流マージを経て現在は **1.45.0**（宣言 `^1.32.1` は不変）。design 自身の Revalidation Trigger（Mastra バージョン変動）が発火した状態であり、スパイク結論（steps/usage 形状・structuredOutput 挙動・p-map ESM 回避）の 1.45.0 での再検証は未実施
- **モデル解決方式（「Mastra 基盤の統合パターン」「Spike 項目 3」「設定 4 キー」Decision）**: `getOpenaiProvider()` と `openai:assistantModel:mastraAgent` キーは support/mastra の provider-agnostic 化（コミット 70bde80571 / c4a58793bf）で**消滅**。suggestPathAgent・growiAgent とも `model: () => resolveMastraModel()`（lazy・memoize・AI 設定保存時 cache clear）に統一され、「growiAgent は構築時解決（再起動必要）」の記述も過去のもの。Requirement 3.4 の再起動なし反映は DynamicArgument の per-generate 評価ではなく **memoize + cache clear** で実現されている
- **設定キー**: 「4 キーを新設」Decision はその後 2 キー増えて 6 キー相当に: reasoning effort キー（タスク 8.x）と `aiTools:suggestPathAgenticChildListingLimit`（#185213、listChildren tool の第二 budget）。一方 `openai:assistantModel:suggestPathAgent` は**読み手のいない dead key**（モデルはアプリ全体設定 `ai:provider` / `ai:model` で決まる。扱い要判断）
- **tool 構成**: 設計時の 2 tool（limited fullTextSearch + getPageContent）に **listChildren tool** が追加され 3 tool 構成（#185213、peer-placement verification。`mastra-modules/tools/list-children-tool.ts`）
- **p-map ESM 回避（副次的発見）**: StubAgent パターンは現行テストでも継続使用中（host で green 実証済み）。ただし 1.45.0 での「実体 import が落ちる」挙動自体の再確認はしていない
