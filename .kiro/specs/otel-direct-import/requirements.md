# Requirements Document

## Project Description (Input)

# OTel Instrumentation Direct Import (memory-leak-investigation L2 follow-up)

## 背景・動機

`memory-leak-investigation` spec の Phase 6 / Task 6.1 で L2 fix の RSS 削減効果が ≈ 0 MB（事前見積もり 20-40 MB は未達）であることが計測で実証された。

続いて isolated benchmark（[apps/app/tmp/otel-import-bench/bench.js](../../apps/app/tmp/otel-import-bench/bench.js)）で 5 つの import 戦略を比較した結果、`getNodeAutoInstrumentations(<deny-list>)` は **`enabled: false` を渡しても 31 個全 instrumentation を instantiate する** ため、L2 の現実装（minimal profile）は RSS 削減になっていないことが判明した。

| Strategy | RSS | vs sdk-only |
|---|---:|---:|
| sdk-only (`NodeSDK` + `[]`) | 82.39 MB | — |
| auto-all (`getNodeAutoInstrumentations()`) | 93.55 MB | +11.16 MB |
| **auto-deny (現 GROWI minimal)** | **93.22 MB** | **+10.83 MB** ← この 11 MB が無駄 |
| **direct-import (4 instrumentations 直接 import)** | **82.33 MB** | **−0.06 MB** ← 真の改善 |

つまり、`@opentelemetry/auto-instrumentations-node` 依存を外し、必要な 4 instrumentation を直接 import する形に再設計すれば **~11 MB / process の RSS 削減** が実現できる。

## ゴール

`@opentelemetry/auto-instrumentations-node` への依存を `apps/app` から削除し、代わりに必要な 4 instrumentation を直接 import する形に [node-sdk-configuration.ts](../../apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts) の `buildInstrumentations` 関数を再設計する。

## スコープ

### In Scope

1. **`apps/app` の package.json から `@opentelemetry/auto-instrumentations-node` を削除**
2. **4 instrumentation package を direct dep として追加**:
   - `@opentelemetry/instrumentation-http`
   - `@opentelemetry/instrumentation-express`
   - `@opentelemetry/instrumentation-mongodb`
   - `@opentelemetry/instrumentation-mongoose`
3. **`buildInstrumentations` 関数を再実装**:
   - `getNodeAutoInstrumentations` 呼び出しを削除
   - 4 instrumentation を直接 `new HttpInstrumentation(...)` 等で構築
   - 既存 HTTP anonymization config (`httpInstrumentationConfigForAnonymize`) との合成は維持
4. **`OTEL_AUTO_INSTRUMENTATION_PROFILE` env var の deprecation**:
   - `minimal` が default になるため env var の存在意義が消える
   - 後方互換のため `all` 設定は warn log を出して minimal 同等に縮退（旧運用者を破壊しない）
   - CHANGESET で正式に deprecate 通知
5. **`ALL_AUTO_INSTRUMENTATION_PACKAGES` の 31 個 list を削除**（deny-list 不要に）
6. **既存 unit test の更新**:
   - profile=minimal / all の test は 4 instrumentation を return する form の test に置き換え
   - http anonymization config の合成 test は維持
7. **RSS 計測の再検証**:
   - `memory-profiler` の scenario runner で同条件（OTel ON / 5 分 idle）の前後 RSS を再計測
   - benchmark の ~11 MB delta が GROWI runtime でも観察されることを verification report で確認

### Out of Scope

- 他の OTel instrumentation の追加（http/express/mongodb/mongoose 以外、例: socket.io, redis）→ 必要になれば別 spec
- BatchSpanProcessor / MetricReader の調整 → 別 spec
- L2 以外の memory finding（L1/L3/L4/L5）→ `memory-leak-investigation` spec が責務
- `auto-instrumentations-node` の transitive dep（他 package から indirect で残る場合）の確認 → package-dependencies rule の管轄

## 成功条件

1. `apps/app/package.json` の `dependencies` から `@opentelemetry/auto-instrumentations-node` が削除されている
2. 4 instrumentation package が `dependencies` に追加されている
3. `buildInstrumentations` 関数が 4 instrumentation を直接構築する形になっている
4. `pnpm vitest run node-sdk-configuration.spec` が green
5. `pnpm run lint`, `pnpm run test`, `pnpm run build` が全て green
6. devcontainer での RSS 再計測で:
   - before（HEAD = 本 spec 適用前）と after（本 spec 適用後）の baseline mean RSS の delta が **5 MB 以上**（benchmark の 11 MB 削減効果が runtime でも観測できる閾値、DB drift noise を考慮した下限）
   - Functional: 既存 4 instrumentation (http/express/mongodb/mongoose) のトレースが OTLP exporter に流れる
7. CHANGESET が追加され、`OTEL_AUTO_INSTRUMENTATION_PROFILE` の deprecation と direct import への移行が明記されている

## Upstream/Downstream の関係

- **Upstream**: `memory-leak-investigation` spec（L2 finding の母体、本 spec はその follow-up）
- **Downstream**: なし（本 spec の成果物は `apps/app` 内部の最適化、他 spec への波及なし）

## 制約・注意

- GROWI の OTel custom metrics 5 個（application / user-counts / page-counts / system / yjs）の組み込みは `setupCustomMetrics()` 側の責務で、本 spec では触らない（既に動作中）
- HTTP anonymization 設定（`httpInstrumentationConfigForAnonymize`）は維持必須（runtime privacy 要件）
- Production deployment で `OTEL_AUTO_INSTRUMENTATION_PROFILE=all` を設定している運用者が存在する可能性を考慮し、env var 削除ではなく deprecation（warn + minimal 縮退）に留める

## 参考資料

- [memory-leak-investigation verification-report.md L2 section](../memory-leak-investigation/verification-report.md#l2-otel-auto-instrumentation-allow-list-task-22)
- [bench.js](../../apps/app/tmp/otel-import-bench/bench.js) — 5 戦略比較の isolated benchmark
- [node-sdk-configuration.ts](../../apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts) — 改修対象

## Introduction

`memory-leak-investigation` spec の L2 finding に対する follow-up として、GROWI の OpenTelemetry instrumentation 構成を見直す。
現行の minimal profile は `getNodeAutoInstrumentations` の deny-list 方式に依存しているが、isolated benchmark の結果、`enabled: false` を渡された instrumentation も含めて 31 個すべてが instantiate されることが判明し、想定していた RSS 削減効果が得られていない。
本 spec では、GROWI が実際に利用する 4 個の instrumentation（HTTP / Express / MongoDB / Mongoose）のみが起動時に instantiate される構成に切り替え、運用上観察可能な RSS 削減と既存トレーシング機能の継続を両立することを目的とする。

## Boundary Context

- **In scope**:
  - 起動時に有効化される OTel instrumentation 集合（GROWI が実際に依存する 4 個）に対する観察可能な振る舞い
  - HTTP anonymization 設定の継続適用
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE` 環境変数の参照を完全に停止すること（deprecation 通知すら持たず、当該変数の値は runtime 挙動に影響しない）
  - `@growi/app` の依存パッケージ表面（runtime dependencies の構成）
  - GROWI runtime での RSS 削減効果の観察可能性
- **Out of scope**:
  - HTTP / Express / MongoDB / Mongoose 以外の OTel instrumentation の追加（例: socket.io, redis）
  - BatchSpanProcessor / MetricReader / OTLP exporter 設定の変更
  - `memory-leak-investigation` の L1 / L3 / L4 / L5 finding
  - `@opentelemetry/auto-instrumentations-node` が他 package の transitive dependency として残ってしまうケースの監視（`package-dependencies` rule の責務）
- **Adjacent expectations**:
  - OTel custom metrics 5 個（application / user-counts / page-counts / system / yjs）の組み込みは `setupCustomMetrics()` 側で従来どおり動作し続ける前提。本 spec はこれを破壊しない。
  - HTTP anonymization 設定モジュール (`httpInstrumentationConfigForAnonymize`) との合成契約は維持する前提で、anonymization モジュール自身の挙動変更は本 spec では扱わない。
  - OTLP trace / metric exporter は既存設定で稼働する前提で、本 spec の変更によって export の宛先や frequency は変わらない。

## Requirements

### Requirement 1: Instrumentation 構成の最小化

**Objective:** As a GROWI operator running with OTel enabled, I want only the instrumentations actually used by GROWI to be loaded at startup, so that the per-process memory footprint contributed by OTel reflects real usage.

#### Acceptance Criteria

1. When the OTel SDK initializes with default configuration, the OTel SDK shall enable exactly the four instrumentations: HTTP、Express、MongoDB、Mongoose。
2. When the OTel SDK initializes, the OTel SDK shall not instantiate any instrumentation outside the four-package set above（例: pino / fs / redis / socket.io / aws-sdk / graphql 等）。
3. The OTel SDK shall expose the resulting instrumentation set in a form that can be asserted by unit tests（数とクラス種別が検査可能であること）。

### Requirement 2: トレーシング機能の継続性

**Objective:** As an SRE consuming OTel traces from GROWI, I want HTTP/Express/MongoDB/Mongoose spans to continue being exported, so that observability is not regressed by this change.

#### Acceptance Criteria

1. When an incoming HTTP request is handled by the GROWI server, the OTel SDK shall emit an HTTP server span to the configured OTLP trace exporter。
2. When an Express route handler is executed, the OTel SDK shall emit an Express span to the configured OTLP trace exporter。
3. When a database operation is issued through Mongoose, the OTel SDK shall emit MongoDB および Mongoose の span を the configured OTLP trace exporter に出力する。
4. While the OTel SDK is running with the new configuration, the existing OTel custom metrics（application / user-counts / page-counts / system / yjs）は OTLP metric exporter に従来どおり出力され続けるものとする。

### Requirement 3: HTTP anonymization 設定の維持

**Objective:** As a privacy/compliance owner, I want HTTP request anonymization to keep applying to outgoing spans, so that sensitive request attributes are not leaked to OTLP backends after this change.

#### Acceptance Criteria

1. Where the `enableAnonymization` option is set on the SDK configuration call, the OTel SDK shall merge the existing HTTP anonymization configuration（`httpInstrumentationConfigForAnonymize`）into the HTTP instrumentation の設定。
2. Where the `enableAnonymization` option is not set, the OTel SDK shall instantiate the HTTP instrumentation without the anonymization configuration（既存と同じ behavior）。
3. While HTTP instrumentation is active with `enableAnonymization` set, the OTel SDK shall apply anonymization to HTTP spans に対して、anonymization module が宣言する全項目（path / query / header 等の sanitization 対象）を従来と同等の方法で扱う。

### Requirement 4: `OTEL_AUTO_INSTRUMENTATION_PROFILE` 環境変数の参照停止

**Objective:** As an operator/maintainer, I want the OTel SDK to start with a fixed four-instrumentation set without reading the `OTEL_AUTO_INSTRUMENTATION_PROFILE` environment variable, so that the configuration surface is minimal and the variable—deprecated together with the deny-list approach—can no longer alter runtime behavior.

#### Acceptance Criteria

1. The OTel SDK shall not read `process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE` during startup（実装上、当該環境変数を参照する分岐ロジックを持たない）。
2. Regardless of whether `OTEL_AUTO_INSTRUMENTATION_PROFILE` is unset、`minimal`、`all`、または任意の他の値であっても、the OTel SDK shall start with the same fixed four-instrumentation set。
3. The OTel SDK shall not emit any warning log or deprecation message tied to the value of `OTEL_AUTO_INSTRUMENTATION_PROFILE`（このバージョンでは参照自体を行わないため、deprecation 通知の責務も持たない）。
4. The OTel SDK shall not throw or abort startup based on the value of `OTEL_AUTO_INSTRUMENTATION_PROFILE`（既存運用者の deployment を破壊しないため）。

### Requirement 5: 依存パッケージ表面

**Objective:** As an operator/auditor reviewing GROWI's package dependencies, I want the OTel dependency surface to reflect actual usage, so that supply chain audits are clear and production builds resolve only what GROWI runs.

#### Acceptance Criteria

1. The `@growi/app` package shall not declare `@opentelemetry/auto-instrumentations-node` in its `dependencies`。
2. The `@growi/app` package shall declare each of the following packages in its `dependencies`: `@opentelemetry/instrumentation-http`、`@opentelemetry/instrumentation-express`、`@opentelemetry/instrumentation-mongodb`、`@opentelemetry/instrumentation-mongoose`。
3. The OTel SDK shall continue to load successfully in the production deployment artifact（Turbopack externalisation 経由の `.next/node_modules/` を含む）に追加 4 instrumentation を必要なときに解決できる形で含む。

### Requirement 6: RSS 削減効果の運用観察

**Objective:** As an operator deciding whether to adopt this version, I want the memory footprint improvement to be observable on the actual GROWI runtime（not just on the isolated benchmark）, so that the operational benefit of the change is provable.

#### Acceptance Criteria

1. When per-process RSS is measured on the GROWI runtime under the same scenario（OTel ON、5 分間 idle baseline）before and after this change, the GROWI runtime shall show a baseline mean RSS reduction of at least 5 MB after the change relative to before。
2. While verification is performed, the GROWI runtime shall continue to serve normal traffic（ページ表示・編集・検索などの主要操作が機能する）, so that the RSS reduction is not achieved by disabling user-visible functionality。
3. The verification result shall be recorded in a form that documents the before / after baseline mean RSS と the observed delta、so that future regressions can be detected against this baseline。
