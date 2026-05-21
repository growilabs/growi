# Implementation Plan

- [ ] 1. Resource Attribute cleanup
- [x] 1.1 (P) Remove os.totalmem from OS resource attributes
  - `os-resource-attributes.ts` の `osInfo` オブジェクトおよび返り値 attributes から `totalmem` 関連の行を削除する。`os.type` / `os.platform` / `os.arch` は維持する。
  - `os-resource-attributes.spec.ts` の `vi.mock('node:os')` のスタブから `totalmem: vi.fn()` を除去し、3 つの既存テストケースから `os.totalmem` 関連の期待値および `mockOs.totalmem` 呼び出し検証を削除する。
  - 完了状態: `pnpm vitest run os-resource-attributes.spec` がパスし、`getOsResourceAttributes()` の戻り値が `os.type` / `os.platform` / `os.arch` の 3 キーのみとなる。
  - _Requirements: 1.1, 1.3_
  - _Boundary: OsResourceAttributes_

- [ ] 1.2 (P) Remove growi.attachment.type from application resource attributes
  - `application-resource-attributes.ts` の返り値 attributes から `'growi.attachment.type'` 行を削除する。
  - 同ファイル内の `growiInfoService.getGrowiInfo({ includeAttachmentInfo: true })` 呼び出しから `includeAttachmentInfo: true` を除去する（このモジュールからは `attachmentType` を参照しなくなるため）。
  - `application-resource-attributes.spec.ts` から `growi.attachment.type` 関連の期待値・スタブを削除する。
  - 完了状態: `pnpm vitest run application-resource-attributes.spec` がパスし、`getApplicationResourceAttributes()` の戻り値が `growi.service.type` / `growi.deployment.type` のみとなる。
  - _Requirements: 1.2, 1.3_
  - _Boundary: ApplicationResourceAttributes_

- [ ] 2. (P) Add attachment_type label to growi.configs info gauge
  - `application-metrics.ts` の `result.observe(growiInfoGauge, 1, { ... })` のラベルオブジェクトに `attachment_type: growiInfo.additionalInfo?.attachmentType ?? ''` を追加する。既存の `getGrowiInfo({ includeAttachmentInfo: true })` 呼び出しはそのまま維持する。
  - `application-metrics.spec.ts` に attachment_type ラベル付与の検証を追加する: 通常ケース（例: `attachmentType: 'aws'`）と未取得フォールバックケース（`additionalInfo: undefined` で `attachment_type: ''`）の 2 系統。
  - 既存テストケース（site_url / site_url_hashed / wiki_type / external_auth_types）の期待ラベルオブジェクトに `attachment_type` を追加し、5 ラベル並存を明示的に検証する。
  - 完了状態: `pnpm vitest run application-metrics.spec` がパスし、`growi.configs` gauge の observe 第 3 引数が 5 キー（既存 4 + `attachment_type`）を持つことが確認される。
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: ApplicationMetrics_

- [ ] 3. (P) Implement and test SystemMetrics module
  - `apps/app/src/features/opentelemetry/server/custom-metrics/system-metrics.ts` を新規作成し、`addSystemMetrics(): void` を export する。`loggerFactory('growi:opentelemetry:custom-metrics:system')` と `diag.createComponentLogger({ namespace: 'growi:custom-metrics:system' })` を既存 `application-metrics.ts` と同様のパターンで初期化する。
  - 単一 Meter `growi-system-metrics`（version `'1.0.0'`）を `metrics.getMeter` で取得し、`createObservableGauge` で 6 つの gauge を作成する: `system.memory.limit`, `system.host.memory.total`, `process.memory.usage`, `process.runtime.v8.heap.used`, `process.runtime.v8.heap.total`, `process.runtime.v8.heap.external`。すべて unit は `By`。
  - 1 つの `addBatchObservableCallback` 内で `process.constrainedMemory()` / `os.totalmem()` / `process.memoryUsage()` / `v8.getHeapStatistics()` を 1 回ずつ呼び、戻り値をローカル変数に保持してから各 gauge を `result.observe(...)` で観測する。`process.constrainedMemory()` の戻り値が 0 もしくは falsy のときは `system.memory.limit` のみスキップし、他 5 メトリクスは常に観測する。
  - コールバック全体を try/catch で囲む。例外時は `loggerDiag.error('Failed to collect system metrics', { error })` を呼び、`result.observe` を一切呼ばずに return する。
  - `system-metrics.spec.ts` を新規作成し、以下を網羅する: (a) Meter 名 `growi-system-metrics` と version `'1.0.0'` での `metrics.getMeter` 呼び出し検証、(b) 6 つの `createObservableGauge` の name + unit `By` の検証、(c) `process.constrainedMemory()` が正値時に `system.memory.limit` を当該値で観測、(d) 戻り値 `0` 時に `system.memory.limit` のみスキップしつつ他 5 メトリクスは観測、(e) `process.memoryUsage().rss` / `.external` および `v8.getHeapStatistics().used_heap_size` / `.total_heap_size` が対応 gauge へ正しくマップされる、(f) コールバック内例外時に `loggerDiag.error` が呼ばれ `observe` が 1 度も呼ばれない。`vi.mock('node:os')` / `vi.mock('node:v8')` および `vi.spyOn(process, 'constrainedMemory')` / `vi.spyOn(process, 'memoryUsage')` を使用する。
  - 完了状態: `pnpm vitest run system-metrics.spec` がパスし、新規モジュール `system-metrics.ts` が上記 6 メトリクスと cgroup 分岐・エラーハンドリングを正しく実装している。
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.2_
  - _Boundary: SystemMetrics_

- [ ] 4. Wire addSystemMetrics into setupCustomMetrics
  - `custom-metrics/index.ts` のトップに `export { addSystemMetrics } from './system-metrics';` を追加する。
  - `setupCustomMetrics()` 内で既存 3 関数（`addApplicationMetrics`, `addUserCountsMetrics`, `addPageCountsMetrics`）と同じ dynamic import パターンで `system-metrics` をロードし、`addSystemMetrics()` を呼ぶ。
  - 完了状態: サーバー起動時のログに `growi:opentelemetry:custom-metrics:system` namespace の "Starting system metrics collection" / "...started successfully" が出力される。`pnpm vitest run` で既存の opentelemetry 関連テスト（特に node-sdk.spec）がパスする。
  - _Depends: 3_
  - _Requirements: 5.1_
  - _Boundary: CustomMetricsIndex_

- [ ] 5. Project-wide verification and operator handoff
- [ ] 5.1 Verify lint, typecheck, tests, and build pass
  - `turbo run lint --filter @growi/app` を実行し、Biome / TypeScript エラーがないことを確認する。
  - `turbo run test --filter @growi/app` を実行し、変更対象の 4 spec（os-resource-attributes / application-resource-attributes / application-metrics / system-metrics）および既存全テストがパスすることを確認する。
  - `turbo run build --filter @growi/app` を実行し、Turbopack による本番ビルドがエラーなく完了することを確認する。
  - 完了状態: 上記 3 コマンドすべてが exit code 0 で終了する。
  - _Requirements: 6.1_

- [ ] 5.2 Author operator migration mapping in PR description
  - PR 本文に「削除 Resource Attribute → 代替メトリクス／ラベル」の対応表を記載する。具体的には `os.totalmem` → `system.host.memory.total` および `system.memory.limit`（cgroup 設定時）の 2 メトリクス、`growi.attachment.type` → `growi.configs` の `attachment_type` ラベル、の 2 行。
  - 新規追加された 6 メトリクスの一覧（名前と単位 `By`）を併記する。
  - 完了状態: otel-infra 管理者が PR 本文 1 ページ内で「何が消え、どこに移ったか」「新たに何が出るようになったか」をワンビューで把握できる状態となる。
  - _Requirements: 6.2_
