# Implementation Plan

## Phase 1(MVP)— Implemented

- [x] 1. Phase 1 MVP — 共有型定義・memo パス提案・エンドポイント登録
- [x] 1.1 提案型の定義と memo パス生成の実装
- [x] 1.2 認証・バリデーション付きのルートエンドポイント登録
- [x] 1.3 Phase 1 統合検証

## Phase 2(ワンショット構成)— 実装後に削除済み

旧ワンショットエンジン(キーワード抽出 → ES 検索 1 回 → LLM 候補評価、OpenAI 直接呼び出し)。features/openai 全廃(2026-07-17)に伴い、Phase 4 で撤去された。

- [x] 2. (P) grant resolver の祖先パス遡上対応
- [x] 3. (P) GROWI AI による内容分析(1st AI call)
- [x] 4. (P) スコア閾値フィルタ付き検索候補取得
- [x] 5. (P) AI による候補評価とパス提案(2nd AI call)
- [x] 6. (P) カテゴリベースのパス提案(Under Review — 既存実装のまま温存)
- [x] 7. Phase 2 改訂版のオーケストレーションと統合
- [x] 7.1 改訂版 Phase 2 パイプラインのオーケストレーション書き直し
- [x] 7.2 Phase 2 統合検証

## Phase 3 — Post-Implementation Refactoring(コードレビュー起因)

- [x] 8. サービス層の抽象化を簡素化
- [x] 8.1 `generate-suggestions.ts` から `GenerateSuggestionsDeps` DI パターンを削除
- [x] 8.2 `retrieve-search-candidates.ts` から `RetrieveSearchCandidatesOptions` を削除
- [x] 8.3 `call-llm-for-json.ts` に JSDoc を追加
- [x] 8.4 `userGroups: unknown` を `ObjectIdLike[]` に絞り込み

## Phase 4 — agentic エンジンへの換装(Mastra、PR #11293)

- [x] 9. Foundation: 設定キーとエンジン識別子の整備
- [x] 9.1 運用設定キーの追加
  - _Requirements: 4_
- [x] 9.2 (P) エンジン識別子型の追加(当時。後に可用性ベース選択へ移行し `engine` フィールド自体は撤去)
  - _Requirements: 6_

- [x] 10. (P) Mastra 実機スパイク: 前提挙動の確認(research.md「Spike Results」参照)
  - _Requirements: 4_
  - _Boundary: スパイク(throwaway コード。本実装ファイルには手を入れない)_

- [x] 11. agentic 探索の実行主体(Mastra agent 層)
- [x] 11.1 検索 budget 付きリクエストコンテキストと budget 執行検索 tool
  - _Requirements: 2, 4_
  - _Depends: 10_
- [x] 11.2 (P) agent instructions の作成(役割・フロー/ストック判定・探索戦略・手仕舞い規則・出力ルール)
  - _Requirements: 2, 3, 4_
  - _Boundary: SuggestPathAgent (instructions)_
- [x] 11.3 suggestPathAgent の定義と Mastra インスタンスへの登録
  - _Requirements: 2, 3, 4_

- [x] 12. エンジン抽象と agentic エンジン(ai-tools サービス層)
- [x] 12.1 エンジン契約の定義とワンショットエンジンの移設(当時。Phase 5 で削除)
  - _Requirements: 6_
- [x] 12.2 (P) structured output 契約(スキーマ・型・型ガード)
  - _Requirements: 1, 3_
  - _Boundary: AgenticOutputSchema_
- [x] 12.3 agentic エンジンアダプタ(コア実行パス)
  - _Requirements: 1, 3, 4_
  - _Depends: 11.3, 12.2_
- [x] 12.4 agentic エンジンの探索過程トレースログ
  - _Requirements: 3_
  - _Depends: 10, 12.3_
- [x] 12.5 エンジンディスパッチャ(当時の oneshot/agentic 静的 map。後に可用性ベース選択へ整理)
  - _Requirements: 6_

- [x] 13. オーケストレータと API の統合
- [x] 13.1 オーケストレータの再構成(memo 常時生成 + エンジンディスパッチ + 非対称フォールバック)
  - _Requirements: 1, 5, 6_
- [x] 13.2 route への optional engine パラメータの追加(当時。後に撤去)
  - _Requirements: 5, 6, 10_

- [x] 14. 統合検証
- [x] 14.1 route 統合テスト
  - _Requirements: 5, 6, 10_
- [x] 14.2 agentic 経路の統合テスト
  - _Requirements: 1, 3, 5_
- [x] 14.3 後方互換の最終確認と全体回帰
  - _Requirements: 6_

- [x] 15. A/B 測定と受け入れ判断
- [x] 15.1 A/B 測定の実施とメトリクス記録
  - _Requirements: 10_
  - _2026-06-12 実施完了。結果: oneshot 再測定 40/60(ベースライン 41/60 を再現)、agentic 4/60。miss の大半が「正解ページの親ディレクトリ」を提案する near-miss で、敗因は instructions の出力規則(PARENT DIRECTORY 表現がリーフページ配下の提案を回避)に集中。運用面は良好(p50 8.5s / avg 9.8k tokens/req / budget 枯渇・timeout・error ゼロ)_
- [x] 15.2 探索誘導の確認と受け入れ判断
  - _Requirements: 3, 10_
  - _2026-06-12 実施完了。debug トレースで誘導反映を確認。instructions チューニング 2 ラウンドで 4/60 → 39/60 → **52/60(ベースライン比 +11、oneshot 再測定比 +12)**。受け入れ判断: agentic エンジンの有効性を確認_

- [x] 16. 推論強度(reasoning effort)の設定化
- [x] 16.1 reasoning effort 設定キーの追加(当時 `openai:reasoningEffort:suggestPathAgent`。後に provider 汎用の `ai:providerOptions:suggestPathAgent` へ移行)
  - _Requirements: 4_
  - _Depends: 9.1_
  - _Boundary: Config Keys(config-definition.ts)_
- [x] 16.2 AgenticEngine への reasoning effort 配線
  - _Requirements: 4_
  - _Depends: 16.1_
  - _Boundary: AgenticEngine(agentic-engine.ts)_

## Phase 5 — features/openai 全廃に伴う整理(2026-07-17)

- [x] 17. 旧ワンショットエンジンの撤去(`analyze-content` / `evaluate-candidates` / `call-llm-for-json` / `oneshot-engine` を削除)
- [x] 18. エンジン選択を可用性ベースへ一本化(`engine` リクエストフィールド・`aiTools:suggestPathEngine`・`SuggestPathEngineId` 型を撤去。`selectEngine` が `isAiConfigured()` のみで判定)
- [x] 19. モデル解決を provider-agnostic 化(`resolveMastraModel()` への統一。`openai:assistantModel:suggestPathAgent` などの dead key を削除)
- [x] 20. listChildren tool の追加(#185213、peer-placement verification。第二 budget `childListingBudget` を含む)

## Phase 6(将来タスク・スコープ外): 非 AI・ES のみ oneshot フォールバックの整備

design.md「将来のロードマップ」参照。

- [ ] F.1 非 AI キーワード抽出の実装(旧 analyze-content の LLM 呼び出しを非 AI 手段に置換)
  - _温存資産: retrieve-search-candidates / generate-category-suggestion / resolve-parent-grant_
- [ ] F.2 非 AI oneshot エンジンを `engines/` に追加し、`select-engine` に record を 1 件追加(Mastra 未設定だが ES 到達可→非 AI oneshot)
- [ ] F.3 ルートガードの見直し(未設定時に非 AI oneshot を通す。`@mastra` 遅延ロードと両立)
- [ ] F.4 品質・レスポンスの測定と許容ライン合意(非 AI 版は旧 oneshot=miss 14% よりさらに落ちる可能性)

## Implementation Notes

- ホスト(Windows)でユニットテストを動かすには `packages/core` の事前ビルドが必要(`pnpm run build`)。アプリ全体の `lint:typecheck` は兄弟パッケージの dist 未ビルドで完走しない(devcontainer 専用)
- pnpm-workspace.yaml の `@mastra/core>p-map: 4.0.0` override により `@mastra/core/agent` は vitest(ESM)で import 不可(pMapSkip link エラー)。agentic エンジン関連のユニットテストは `growi-agent.spec.ts` の StubAgent `vi.mock('@mastra/core/agent', ...)` パターンを踏襲すること。`@mastra/core/request-context` / `tools` は影響なし
- dynamic model 解決関数は 1 generate あたり約 2 回評価される — 副作用なし・軽量に保つこと
- Phase 4 の「既存テスト無修正 green」は additive-mock-wiring の意味で充足していた(engines barrel → agentic-engine → mastra-modules の静的 import チェーンが p-map ESM エラーでロード不能なため、スタブ mock 追加が必須だった)
- devcontainer(HEAD 526c3d3694 時点)で suggest-path 17 files/297 tests + mastra-modules 7 files/83 tests 全 green を確認済み。lint/test/build の非ゼロ exit はすべて feature 起因でないことを当時証明済み(`post-message.ts` の pre-existing TS2769、負荷起因の re-run で green になる fail、コンテナ環境由来の mongod SIGSEGV)
