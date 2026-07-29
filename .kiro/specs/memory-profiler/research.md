# Research & Design Decisions

## Summary
- **Feature**: `memory-profiler`
- **Discovery Scope**: Extension（既存実装のベースライン化）— code archeology が中心。新機能の architecture 探索ではなく、現状実装を「公式仕様」として固定する作業。
- **Key Findings**:
  - `bin/memory-profiler/` 配下の全モジュールは過去の memory 調査作業の中で実装済み。58 unit tests が green。
  - Architecture pattern は **External profiling sidecar (CDP-only) + workspace-isolated package**。SIGUSR2 fallback は実装中に棄却（commit `b8e3efa4c7`）。
  - Boundary 上、`apps/app` への依存方向はゼロ。GROWI server には CDP（観測）と HTTP / WS（負荷）の 2 経路のみで到達する。
  - 任意の downstream consumer（調査 spec）から本 spec への片方向参照モデルを確立する必要がある。

## Research Log

### Architecture (実装状態の確認)
- **Context**: `bin/memory-profiler/` の現状アーキテクチャを spec として固定するため、実装ソースから構成を読み取る。
- **Sources Consulted**:
  - [bin/memory-profiler/cdp-snapshot-client.ts](../../bin/memory-profiler/cdp-snapshot-client.ts) — CDP WebSocket クライアント
  - [bin/memory-profiler/load-driver.ts](../../bin/memory-profiler/load-driver.ts) — Load 合成
  - [bin/memory-profiler/rss-time-series-logger.ts](../../bin/memory-profiler/rss-time-series-logger.ts) — RSS CSV ロガー
  - [bin/memory-profiler/run-scenario.ts](../../bin/memory-profiler/run-scenario.ts) — シナリオオーケストレーター
  - [bin/memory-profiler/scenarios/](../../bin/memory-profiler/scenarios/) — baseline / load / drain
  - [bin/memory-profiler/lib/](../../bin/memory-profiler/lib/) — installer-driver / http-client / yjs-client
- **Findings**:
  - 全モジュールが named export + factory pattern (`createXxx()`) で実装されており、test 用に fake を差し替え可能。
  - `CdpSnapshotClient` は exponential backoff（base 1000ms, max 5 retries）を持ち、`HeapProfiler.takeHeapSnapshot` を chunk 結合で受信。
  - `ScenarioRunner` の `LoadOpCounts` 型と `ScenarioRunnerError`（exitCode 1/2）が CLI contract の中核。
  - `LoadDriver.pageSearch` は固定 query `'profiling-test'` を使用し再現可能性を担保。
  - 各 scenario module は `LoadDriver` interface を型として受け取り、実装本体には依存しない（fake-LoadDriver でテスト可能）。
- **Implications**: Design 上、これらの contract をそのまま stable interface として記述すればよい。新規 interface を作らず、現状実装を仕様として「凍結」する。

### Workspace Boundary (apps/app への依存方向)
- **Context**: `@growi/bin` が `apps/app` への workspace 依存を持たないことを確認する。
- **Sources Consulted**:
  - [bin/package.json](../../bin/package.json)
  - [pnpm-workspace.yaml](../../pnpm-workspace.yaml)
- **Findings**:
  - `bin/package.json` の `dependencies` は `ws` のみ、`devDependencies` は `vitest` のみ。`@growi/app` への依存なし。
  - `pnpm-workspace.yaml` で `bin` が workspace package として登録済み。
  - 本 package のコードは `apps/app/dist/` / `apps/app/.next/` に含まれない（build 対象外）。
- **Implications**: Boundary Commitments で「apps/app への依存方向ゼロ」「production 成果物に含めない」を明示できる。

### Downstream consumer pattern
- **Context**: 任意の memory 調査 spec が本 spec の consumer になり得、interface 仕様への安定参照を必要とする。
- **Findings**:
  - Consumer 側は本 spec の CLI / env var / exit code / 出力ファイル命名規約のみを通じてツールを利用すれば良く、ツール内部実装には依存しない設計が成立する。
  - 過去の調査での Phase 6 相当タスク（OTel 有効化下計測、Yjs sustained-load、retainer 解析、dist server 計測）はすべて本 spec のツール CLI / env var を通じて完遂可能であることが実証されている。
- **Implications**: Design の Boundary Commitments で「片方向参照（consumer → tool）」を明示。Revalidation Triggers に「CLI / env var / exit code の変更」を入れる。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| External sidecar (CDP-only) | 別 process / 別 workspace から CDP + HTTP/WS で server を観測・駆動 | Production 影響ゼロ、apps/app との完全分離、Node.js 標準 protocol 活用 | CDP 不可時の fallback なし（devcontainer 前提では問題なし） | **採用（既存実装）** |
| External sidecar + SIGUSR2 hook | 上記 + server 側に SIGUSR2 in-process snapshot fallback | CDP 不可時の retreat 経路あり | apps/app への signal handler 追加面が必要、env var 追加 | 初期 design で採用 → 実装中に棄却（commit `b8e3efa4c7`） |
| Inline profiling code | server 内に profiling code を埋め込み env var gate | Single process で完結 | Production 混入リスク、責務肥大 | 不採用 |
| Forked binary (`clinic` 等) | 既製プロファイラに丸投げ | 自前実装ゼロ | Custom シナリオ表現困難、実行モデル不一致 | 不採用 |

## Design Decisions

### Decision: ベースライン化（コード変更ゼロ）方針
- **Context**: 既に実装され green な状態で稼働しているツールを、新規 spec の対象として扱う。
- **Alternatives Considered**:
  1. ベースライン spec — 現状を「公式仕様」として固定し、コード変更は最小限（lint/test 通過のみ）
  2. 改修同時 spec — ベースライン化と同時に新機能（OTLP receiver / dist server / DSL 化等）も入れる
- **Selected Approach**: 1（ベースライン spec）。現状をそのまま requirements / design / tasks に落とす。
- **Rationale**: ユーザーから明示的に「現状のツールを公式仕様としてベースライン化」を選択された。新機能は follow-up spec で扱うことで scope creep を防ぐ。
- **Trade-offs**: + 短期で安定 spec を確立可能 / − 改善余地のある実装ディテール（例: scenario DSL 化）は別 spec 待ち。

### Decision: Downstream consumer との片方向参照モデル
- **Context**: 任意の investigation spec と本 spec の境界をどう設計するか。
- **Alternatives Considered**:
  1. 双方向参照（互いに interface 名 / 調査 verdict を引用）
  2. **片方向参照（consumer → tool のみ）** — investigation が本 spec を参照するが、本 spec は investigation の調査内容に依存しない
  3. 完全独立（クロスリファレンスを最小化）
- **Selected Approach**: 2（片方向参照）。
- **Rationale**: 本 spec はツールの安定供給を責務とし、特定の調査内容に縛られない。Investigation spec が増減・削除しても本 spec の責務は変わらない。
- **Trade-offs**: + 各 investigation spec が独立に増加・削除可能 / − consumer 側の参照漏れに気づく仕組み（change review プロセス）を要求事項にする必要あり。

### Decision: CLI / env var / exit code を Stable Contract として宣言
- **Context**: Downstream consumer は CLI 引数・env var・exit code・出力ファイル命名規約のみで本ツールに依存する。
- **Alternatives Considered**:
  1. 全 public API（TypeScript export）を stable contract とする
  2. **CLI surface のみを stable contract とする** — TypeScript export 側は internal（factory 関数も含めて自由に変更可能）
- **Selected Approach**: 2。
- **Rationale**: Investigation spec は CLI を介してツールを使うため、TypeScript 内部実装は柔軟に変更したい。Test と CLI で実質的な interface coverage が確保できる。
- **Trade-offs**: + 内部リファクタの自由度が高い / − 内部 import の安定性は将来別 spec で利用する場合に再検討。

## Synthesis Outcomes

### Generalization
- 7 op 種類（pageCreate/Edit/Get/List/Search + yjsCleanClose/Abort）は「count を受け取る Promise 関数」という generic interface に統一されている。新 op を追加する場合も同 interface に従う（汎用化済み）。
- RSS time-series logger は CDP 経由で `process.memoryUsage()` を取るが、将来 GROWI 内 admin endpoint を追加して直接取得する方式に切り替える場合も、CSV schema（`timestamp,phase,rss,heap_used,heap_total,external`）は同じものを使う設計。

### Build vs. Adopt
- `undici`（HTTP）、`ws`（WebSocket）、`@opentelemetry/api`（型）— 既存依存または Node.js 標準を採用。自前実装した layer は (a) GROWI 特有の installer flow と (b) Y.Doc minimal client のみ。これらは既存 npm package で代替不能（GROWI の installer payload / yjs-client の minimal subset）。

### Simplification
- 当初設計の SIGUSR2 in-process fallback は実装中に削除し、CDP-only に簡素化（apps/app への追加面ゼロ）。
- Scenario layer と LoadDriver layer は型のみで結合（fake-LoadDriver による test を可能にする）。
- `growi-logger` を取り込まず、sidecar の stdout に直接出力する（依存簡素化）。

## Risks & Mitigations
- **Node.js v24 → v25+ への major upgrade**: CDP / `node:inspector` の挙動変化リスク → Revalidation Triggers に明記、change review でチェック。
- **`y-websocket` major upgrade**: minimal yjs client の互換性に影響 → 同じく Revalidation Triggers。
- **`@growi/bin` の workspace registration 解除 / `bin/` 構造変更**: downstream consumer の参照が壊れる → Revalidation Triggers、change review に含める。
- **CLI / env var / exit code の breaking change**: 任意の investigation spec が動作不能になる → change review で必ず downstream への影響評価を要求（design.md と README に明記）。

## References
- [.claude/rules/devcontainer.md](../../.claude/rules/devcontainer.md) — devcontainer 前提（`mongo:27017` / `elasticsearch:9200`）
- [.claude/rules/coding-style.md](../../.claude/rules/coding-style.md) — Module Public Surface（barrel files）、Pure Function Extraction、Single Responsibility 等の coding 規約
