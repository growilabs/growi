# Implementation Plan

> **Implementation Notes**
>
> - 本 spec は **Core (server-side fixes) → Integration → Validation (Phase 5) → Mandatory Re-measurement (Phase 6) → Conditional Follow-ups (Phase 7)** で進めた。Phase 6 で L3 / L4 ともに **REFUTED** と確定したため、Phase 7 は起動条件未充足で closed-as-not-needed。
> - **Dependency on `memory-profiler` spec**: Phase 5 以降のすべての検証セッションは `memory-profiler` spec が提供する profiling ツール（`bin/memory-profiler/`）を利用する。本 spec は consumer。
> - **L2 設計変遷**: Task 2.2 は計測結果を受けて 2 度変更した。初版 allow-list（`getNodeAutoInstrumentations(<deny-list>)` + `OTEL_AUTO_INSTRUMENTATION_PROFILE` env var）→ direct-import の `buildInstrumentations` 関数（commit `0f2cfb77d6`）→ `generateNodeSDKConfiguration` 内へインライン化し env var を撤去（commit `19c56368fc`）。最終 shipped 形は env var なしの 4 instrumentation 直接 instantiate。中間形 → 最終形の遷移計測は [verification-report.md / L2](./verification-report.md#l2--otel-instrumentation-set-task-22) に保存。
> - **Scope migration**: 旧 Phase 1（Foundation）/ Phase 3（Core — Profiling sidecar）/ Task 4.2（Scenario runner integration）は profiling ツール開発タスクであり `memory-profiler` spec へ責務移管。本 spec からは削除済。Task 1.2（SIGUSR2 in-process fallback）は CDP-only 方針へ切り替えて削除（commit `b8e3efa4c7`）。

## 2. Core — Server-side fixes

- [x] 2.1 (P) L1: Mongoose connection pool の上限・下限を環境変数化（`MONGO_MAX_POOL_SIZE` default 15 / `MONGO_MIN_POOL_SIZE` default 2）。NaN は default fallback。Unit test 追加。
  - _Requirements: 3.1, 3.2, 3.4, 3.6, 7.1, 7.2_
  - _Boundary: MongoosePoolConfig_

- [x] 2.2 (P) L2: OpenTelemetry instrumentation を direct-import 形へ固定（`@opentelemetry/auto-instrumentations-node` 依存撤廃、4 instrumentation を直接 `new`）。`OTEL_AUTO_INSTRUMENTATION_PROFILE` env var なし。HTTP anonymization 設定は維持。
  - _Requirements: 3.3, 3.4, 3.6, 4.5, 7.1, 7.2_
  - _Boundary: OtelDirectInstrumentations_

- [x] 2.3 (P) L3 metric: `growi.yjs.docs.count` Observable Gauge を `custom-metrics/yjs-metrics.ts` として新規追加。`docs.size` 読み出しのみ、defensive check 付き。
  - _Requirements: 4.1, 4.2, 4.5_
  - _Boundary: YjsDocsMetric_

- [x] 2.4 (P) L5: `autoUpdateExpiryDate` の `setInterval` callback を try/catch でラップし、`growi-logger` で構造化エラーログを残す。interval 周期は継続。
  - _Requirements: 5.3_
  - _Boundary: DefensivePageOperationTimer_

## 3. Core — Profiling sidecar (責務移管済み)

> Profiling sidecar 群（CDP snapshot client / Load driver / RSS time-series logger / Scenarios）の実装・interface・operational procedure は `memory-profiler` spec の責務。本 spec は同 spec を参照のみ。

## 4. Integration

- [x] 4.1 (P) `yjs-metrics` を `custom-metrics/index.ts` の barrel + `setupCustomMetrics()` 合成パスに組み込む。既存 4 metrics の登録順序・名称・schema は不変更。
  - _Depends: 2.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: YjsDocsMetric, opentelemetry custom-metrics index_

- [x] 4.3 Lint / type-check / unit & integration test / build を pass させる（`turbo run lint|test|build --filter @growi/app` + `pnpm --filter @growi/bin test`）。
  - _Depends: 2.1, 2.2, 2.3, 2.4, 4.1_
  - _Requirements: 3.6, 7.1, 7.3_

- [x] 4.4 (P) CHANGESET 追加（pool default 変更、OTel direct-import への切替、新規 metric、切戻し手順）。
  - _Depends: 2.1, 2.2, 2.3, 4.1_
  - _Requirements: 7.2, 7.4_

## 5. Validation — Dynamic profiling とレポート

- [x] 5.1 Fix なし build での baseline 計測（before スナップショット）。`runs/before/` に snapshot 3 枚 + RSS CSV を出力。
  - _Depends: `memory-profiler` の scenario runner が利用可能であること_
  - _Requirements: 2.1, 2.2, 3.5_
  - _Known limitation_: dev server (ts-node + SWC) 経由のため production との差異あり。Phase 6 / Task 6.4 で dist server による再計測を実施。

- [x] 5.2 Fix 適用 build での計測（after スナップショット）。`runs/after/` に出力。
  - _Depends: 5.1_
  - _Requirements: 2.1, 2.4, 3.5_

- [x] 5.3 各 finding の verdict 判定（retained constructor count 比較 + RSS Drain 平均）。L1 / L5 confirmed、L3 / L4 / L2 ランタイム計測は Phase 6 で再評価。
  - _Depends: 5.2_
  - _Requirements: 5.4, 6.1_

- [x] 5.4 `verification-report.md` 新規作成（Environment / Per-finding verdicts / RSS delta / Behavior changes / Open issues）。snapshot ファイル本体は非コミット、ファイル名・サイズ・SHA256 のみ報告。
  - _Depends: 5.3_
  - _Requirements: 3.5, 5.4, 6.1, 6.2, 6.3, 6.5, 7.4_

## 6. Mandatory Re-measurement (Phase 6)

> Phase 5 計測は (a) OTel 無効、(b) Yjs sessions=5 / drain=60s と縮小、(c) dist server 起動が Prisma ESM 不整合で未実施、の制約があった。本フェーズで解消。

- [x] 6.1 OTel 有効化下での L2 ランタイム baseline RSS 再計測 — **完了 (2026-05-25)**。中間形（allow-list）で `OPENTELEMETRY_ENABLED=true` / `BASELINE_IDLE_SECONDS=300` で before/after を計測。**Result**: RSS delta ≈ 0 MB（事前見積もり 20–40 MB 未達）。isolated bench に基づき direct-import 再設計へ。詳細は [verification-report.md](./verification-report.md#l2--otel-instrumentation-set-task-22)。
  - _Depends: 5.4_
  - _Requirements: 3.5, 3-bis.1, 6.1_

- [x] 6.2 Yjs sustained-load + 300s drain での L3 再計測 — **完了 (2026-05-26, L3 = REFUTED)**。`LOAD_YJS_CLEAN_CLOSE=50` / `LOAD_YJS_ABORT=50` / production dist server。`Doc` count A→C delta = 0。
  - _Depends: 5.4_
  - _Requirements: 5.1, 5.4, 6.1_

- [x] 6.3 拡張シナリオでの L4 retainer 分析 — **完了 (2026-05-26, L4 = REFUTED)**。`LOAD_PAGE_EDIT=20` / production dist server。`Activity` / `InAppNotification` / `Comment` 全 snapshot で 0。
  - _Depends: 5.4_
  - _Requirements: 5.2, 5.4, 6.1_

- [x] 6.4 Production dist server (Node.js v24) の Prisma ESM 不整合を解消 — **完了 (2026-05-26)**。`dist/generated/prisma/client.js` が古い世代のまま残っていたのが blocker。`turbo run build --filter @growi/app` リビルドで `import.meta.url` が消失し自然解消。
  - _Depends: 5.4_
  - _Requirements: 2.3, 6.1_

- [x] 6.5 verification-report.md の Phase 6 update — **完了 (2026-05-26)**。Task 6.1–6.4 の結果を統合し L3 / L4 を最終確定（REFUTED）。Phase 7 は起動条件未充足で本 spec の implementation は closed。
  - _Depends: 6.1, 6.2, 6.3, 6.4_
  - _Requirements: 5.4, 6.1, 6.2, 6.3_

## 7. Conditional follow-ups — **未着手 (closed-as-not-needed)**

> Phase 6 で L3 / L4 ともに REFUTED と確定したため起動条件未充足。将来 production で対応する leak symptom が再発した場合は別 spec で再評価する。

- [ ] ~~7.1 L3 sweeper（`YjsIdleSweeper`）の実装~~ — **不要 (Task 6.2 で L3 = REFUTED)**
- [ ] ~~7.2 L4 backpressure（`HandlerBackpressure`）の実装~~ — **不要 (Task 6.3 で L4 = REFUTED)**
- [ ] ~~7.3 7.1 / 7.2 を実装した場合の verification report 追記~~ — **不要 (7.1 / 7.2 が起動しない)**
