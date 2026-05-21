# Research & Design Decisions — otel-attributes-cleanup

## Summary

- **Feature**: `otel-attributes-cleanup`
- **Discovery Scope**: Extension（既存 `features/opentelemetry/` モジュールの再編成 + 小規模追加）
- **Key Findings**:
  - Resource Attribute と Metric の責務分離が崩れており、`os.totalmem` と `growi.attachment.type` が Resource Attribute 側に紛れ込んでいる。
  - GROWI のランタイム要件は Node.js `^24`（`apps/app/package.json` 経由）なので、`process.constrainedMemory()`（Node 20.12+）が無条件で利用可能。
  - `@opentelemetry/host-metrics` パッケージは cgroup 非対応かつ `system.memory.limit` を emit しないため、要件を満たさず採用不可。

## Research Log

### 既存 ObservableGauge 実装パターン

- **Context**: 新規 `system-metrics.ts` を既存パターンに整合させる必要がある。
- **Sources Consulted**:
  - `apps/app/src/features/opentelemetry/server/custom-metrics/application-metrics.ts`
  - `apps/app/src/features/opentelemetry/server/custom-metrics/page-counts-metrics.ts`
  - `apps/app/src/features/opentelemetry/server/custom-metrics/user-counts-metrics.ts`
- **Findings**:
  - 各モジュールは `addXxxMetrics(): void` 関数を export する。
  - `metrics.getMeter('growi-<scope>-metrics', '1.0.0')` で Meter を取得し、`createObservableGauge(name, { description, unit })` で gauge を作る。
  - 観測は `meter.addBatchObservableCallback(async (result) => { ... }, [gauge, ...])` で登録し、try/catch でエラーを `diag.createComponentLogger(...)` 経由でログ出力する。
  - 直接 `getMeter` の戻り値で `addBatchObservableCallback` を呼ぶ実装は無く、必ず `meter.` プレフィックスを介する。
- **Implications**: 新規 `addSystemMetrics()` も同じシグネチャ・同じ Meter 命名・同じバッチコールバック構造で実装し、レビュー差分を最小化する。

### 既存 spec.ts のモッキングパターン

- **Context**: 新規モジュール用の spec.ts と既存 spec.ts 修正の作業負荷を見積もる必要がある。
- **Sources Consulted**:
  - `os-resource-attributes.spec.ts`（`vi.mock('node:os')` で stdlib をモック）
  - `application-metrics.spec.ts`（`vi.mock('@opentelemetry/api')` で Meter / Gauge / diag をすべてモック）
- **Findings**:
  - `vi.mock('node:os')` で `totalmem` などの関数を `vi.fn()` 化する手法が確立済み。
  - `vitest-mock-extended` の `mock<Meter>()` / `mock<ObservableGauge>()` で OpenTelemetry の型をモックし、`addBatchObservableCallback.mock.calls[0][0]` でコールバック関数を取り出して直接実行する。
  - エラー時挙動は `mockGrowiInfoService.getGrowiInfo.mockRejectedValue(...)` → `expect(mockResult.observe).not.toHaveBeenCalled()` の形でテストされている。
- **Implications**: 新規 `system-metrics.spec.ts` は `node:os` / `node:v8` / `node:process` を `vi.mock` し、`process.constrainedMemory` の 0/undefined 分岐を含めた網羅テストが可能。

### `process.constrainedMemory()` の挙動

- **Context**: cgroup limit が取れない環境での挙動を要件 3.2 に反映するため API 仕様を確定する。
- **Sources Consulted**: Node.js v20.12 ドキュメント `process.constrainedMemory()`、Node.js v24 同 API ドキュメント。
- **Findings**:
  - 戻り値: `cgroup v1` / `cgroup v2` から取得した「プロセスに割り当てられたメモリ上限のバイト数」。
  - cgroup が未設定 / detection 失敗時は `0` を返す。
  - Node.js v19.6 で導入、v20.12 で stable、v24 でも継続。
- **Implications**: 要件 3.1/3.2 の「設定されている / されていない」分岐は `value > 0` で判定する。`undefined` は実質的には返らないが、防御的に `value > 0` チェックでカバー可能。

### Build vs Adopt: `@opentelemetry/host-metrics` 比較

- **Context**: メトリクス追加の実装手段としてカスタム ObservableGauge を書くか、コミュニティパッケージを採用するか。
- **Sources Consulted**: discovery 段階で別 subagent が実施した調査結果（最新 0.38.3、2026-02 リリース）。
- **Findings**:
  - cgroup 検出を行わず、`os.totalmem()`/`os.freemem()` 直読み。コンテナ環境での `system.memory.limit` を emit しない。
  - V8 ヒープ統計を出力しない。
  - 出力可否は `metricGroups` で粗いフィルタができるのみ。リネーム不可、属性追加不可。
  - 追加 dep `systeminformation`、内包 semconv は 1.25.0（GROWI は 1.34.0）。
- **Implications**: 採用しても要件 3.1（cgroup limit）と要件 4.2-4.4（V8 ヒープ）を別途自前で書く必要があり、結局二重実装になる。**カスタム ObservableGauge を選択**。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Custom ObservableGauge (`system-metrics.ts`) | Node.js stdlib + 既存 `@opentelemetry/api` のみで自前実装 | 完全な制御、既存パターンと整合、追加 dep ゼロ | 約 50 行の実装と spec を書く必要 | **採用** |
| `@opentelemetry/host-metrics` 採用 | コミュニティパッケージで `system.*`/`process.*` を自動 emit | 既製、network/CPU も無料で得られる | cgroup 未対応、V8 ヒープ非対応、semconv が古い、不要メトリクス強制 emit | 不採用（要件未充足） |
| `os.totalmem` を削除のみで終了 | 新規メトリクスを追加せず Resource Attribute 削除だけ | 最小工数 | 要件 3/4（コンテナ運用メトリクス）が満たされない | 不採用 |

## Design Decisions

### Decision: `system.memory.limit` と `system.host.memory.total` を別メトリクスに分離

- **Context**: コンテナ環境で「コンテナの上限」と「ホストの物理メモリ」のどちらを参照したいかは運用観点が異なる。単一メトリクスでは判別が困難。
- **Alternatives Considered**:
  1. 単一メトリクス `system.memory.limit` を cgroup → fallback で `os.totalmem` にする。
  2. `system.memory.limit` と `system.host.memory.total` を別メトリクスにする。
- **Selected Approach**: 2。`system.memory.limit` は cgroup limit が取れたときのみ観測、`system.host.memory.total` は常に観測。
- **Rationale**: 「コンテナ上限の有無」自体が運用上の情報となる。fallback されると bare-metal でも cgroup でも同じシリーズに混在し、ダッシュボード側で見分けが付かない。
- **Trade-offs**: 出力メトリクス数が 1 つ増えるが、運用観点での明瞭さが勝る。
- **Follow-up**: ダッシュボード移行時の運用者向け説明（リリースノート相当）に「cgroup limit 未設定では `system.memory.limit` が emit されない」を明記する。

### Decision: `growi.attachment.type` を `growi.configs` のラベルへ統合

- **Context**: `growi.attachment.type` は「サブシステム設定値」であり identity ではない。同等の設定情報（`wiki_type`, `external_auth_types`）は既に `growi.configs` info gauge のラベルに集約されている。
- **Alternatives Considered**:
  1. Resource Attribute に残す。
  2. `growi.configs` ラベルへ統合（Prometheus info パターン）。
  3. 独立した info gauge を新設。
- **Selected Approach**: 2。既存ラベル群（snake_case）に揃え `attachment_type` として追加。
- **Rationale**: 「インスタンス設定」を一箇所で見られるという既存設計意図に沿う。Resource Attribute は identity 専用に整理できる。
- **Trade-offs**: `growi.configs` のラベル数が増える（4 → 5）。カーディナリティ影響は限定的（attachment.type は固定 enum）。
- **Follow-up**: ラベル命名は `attachment_type`（snake_case）に統一。値の取得不能時は空文字 `''` フォールバック（既存 `external_auth_types` と整合）。

### Decision: `growi.deployment.type` は現状維持

- **Context**: OTel 標準には `deployment.environment.name`（"production"/"staging" 等）があるが、GROWI の `growi.deployment.type`（"docker"/"k8s"/"growi-docker-compose" 等）はランタイム形態を表し、環境分類とは別概念。
- **Alternatives Considered**:
  1. `deployment.environment.name` に寄せる。
  2. `growi.deployment.type` のまま据え置く。
- **Selected Approach**: 2。Resource Attribute として現状維持。
- **Rationale**: 値の意味が semconv 標準と乖離するため、無理に標準名を当てると誤解を招く。
- **Follow-up**: 将来的に「環境（prod/stg）」の表現が必要になった時点で別属性として導入する。

### Decision: 単一 Meter `growi-system-metrics` で system / process / V8 を束ねる

- **Context**: 既存パターンでは目的別に Meter を分けている（`growi-application-metrics`, `growi-user-counts-metrics`, `growi-page-counts-metrics`）。
- **Alternatives Considered**:
  1. `growi-system-metrics` 単一 Meter で 6 メトリクスをまとめる。
  2. `growi-system-metrics` と `growi-process-metrics` に Meter を分ける。
- **Selected Approach**: 1。
- **Rationale**: いずれも「ランタイム / ホストのリソース観測」という単一目的であり、`system.*`/`process.*` の prefix で十分名前空間が分離できる。Meter を分けると `addBatchObservableCallback` の呼び出しと spec も二重になり、管理コスト増。
- **Trade-offs**: 将来「process 系のみオフにする」のような細かい制御が難しくなるが、現時点で必要性なし。

## Risks & Mitigations

- **下流ダッシュボードの参照切れ** — 削除される Resource Attribute（`os.totalmem`, `growi.attachment.type`）を引いていたクエリは値を返さなくなる。**Mitigation**: PR 説明とリリースノートに「Removed → Replaced by」の対応表を記載（要件 6.2）。
- **`process.constrainedMemory()` のプラットフォーム依存** — Linux cgroup v1/v2 のみサポートで、macOS/Windows では常に 0 を返す。**Mitigation**: 0 のときは `system.memory.limit` を観測しないという挙動（要件 3.2）が、そのまま非対応プラットフォームの振る舞いと一致するため追加対策不要。`os.totalmem()` 経由の `system.host.memory.total` は全プラットフォーム共通で動作する。
- **新規メトリクスのカーディナリティ** — 新しい 6 メトリクスは label を持たない gauge であり、追加カーディナリティ寄与はインスタンス分のみ。**Mitigation**: 設計上追加の attribute を付与しないことを徹底（要件 4 系の AC が暗黙に保証）。
- **テストの cgroup mock 容易性** — `process.constrainedMemory` は `vi.mock` でモックすることになるが、Node.js グローバル `process` をモックするのは記法に注意が必要。**Mitigation**: `vi.spyOn(process, 'constrainedMemory').mockReturnValue(...)` を使う方針を spec パターンとして確立する。

## References

- [Node.js process.constrainedMemory()](https://nodejs.org/api/process.html#processconstrainedmemory) — cgroup ベースのメモリ上限取得 API。
- [Node.js v8.getHeapStatistics()](https://nodejs.org/api/v8.html#v8getheapstatistics) — V8 ヒープ統計取得 API。
- [OpenTelemetry semantic conventions — system memory](https://opentelemetry.io/docs/specs/semconv/system/system-metrics/#metric-systemmemoryusage) — `system.memory.*` の semconv。
- [OpenTelemetry semantic conventions — process](https://opentelemetry.io/docs/specs/semconv/runtime-environment/process/) — `process.memory.usage` の semconv。
- 既存実装: `apps/app/src/features/opentelemetry/server/custom-metrics/application-metrics.ts` — ObservableGauge + addBatchObservableCallback のリファレンス実装。
