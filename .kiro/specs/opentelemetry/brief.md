# Brief: opentelemetry

## Problem
GROWI は監視・可観測性のために OpenTelemetry を採用しており、`apps/app/src/features/opentelemetry/` 配下に NodeSDK 初期化・Resource Attribute・Custom Metrics・Anonymization の各レイヤを実装している。本 spec は `features/opentelemetry/` の **大局的なメンテナンスリファレンス** として、将来の追加・変更（メトリクス追加、新規 anonymization handler、SDK バージョンアップ）が踏むべき境界線と設計意図を提供する。

## Current State
- ランタイム: Node.js `^24`（cgroup 系 API・V8 統計が利用可能）。
- 依存パッケージ:
  - `@opentelemetry/api ^1.9.0`
  - `@opentelemetry/sdk-node ^0.217.0`
  - `@opentelemetry/instrumentation-http ^0.217.0`, `@opentelemetry/instrumentation-express ^0.65.0`, `@opentelemetry/instrumentation-mongodb ^0.70.0`, `@opentelemetry/instrumentation-mongoose ^0.63.0`（4 instrumentation を direct import で利用。`@opentelemetry/auto-instrumentations-node` は採用しない — Design Decisions 参照）
  - `@opentelemetry/exporter-trace-otlp-grpc`, `@opentelemetry/exporter-metrics-otlp-grpc ^0.202.0`
  - `@opentelemetry/sdk-metrics ^2.0.1`, `@opentelemetry/resources ^2.0.1`, `@opentelemetry/sdk-trace-node ^2.0.1`
  - `@opentelemetry/semantic-conventions ^1.34.0`
- 全コードは server-only。クライアント側からの import は無い。
- ディレクトリ構成 (`apps/app/src/features/opentelemetry/server/`):
  - `node-sdk.ts` — SDK ライフサイクル管理（`initInstrumentation` / `setupAdditionalResourceAttributes` / `startOpenTelemetry`）。
  - `node-sdk-configuration.ts` — `NodeSDKConfiguration` 構築と Resource 構築（2 段階初期化）。
  - `node-sdk-resource.ts` — `NodeSDK._resource` への低レベルアクセサ（リフレクション）。
  - `logger.ts` — `DiagLogger` を pino logger にアダプトする実装。
  - `semconv.ts` — incubating semantic conventions のコピー（`service.instance.id`, `http.target`）。
  - `custom-resource-attributes/` — `os-resource-attributes` / `application-resource-attributes`。identity 専用。
  - `custom-metrics/` — `application-metrics` / `user-counts-metrics` / `page-counts-metrics` / `system-metrics` + `setupCustomMetrics()` 合成。
  - `anonymization/` — `httpInstrumentationConfig` と 4 個の handler（search / page-listing / page / page-access）。
- 設定キー（`config-definition.ts`）:
  - `otel:enabled` (`OPENTELEMETRY_ENABLED`, default `true`)
  - `otel:isAppSiteUrlHashed` (`OPENTELEMETRY_IS_APP_SITE_URL_HASHED`, default `false`)
  - `otel:anonymizeInBestEffort` (`OPENTELEMETRY_ANONYMIZE_IN_BEST_EFFORT`, default `false`)
  - `otel:serviceInstanceId` (`OPENTELEMETRY_SERVICE_INSTANCE_ID`, default `undefined`)
- Exporter: OTLP gRPC（trace / metric とも）。Endpoint は OTel 標準環境変数（`OTEL_EXPORTER_OTLP_ENDPOINT` 等）で制御。
- Metric 出力間隔: `PeriodicExportingMetricReader` の `exportIntervalMillis: 300000`（5 分）。

## Desired Outcome
- `features/opentelemetry/` のすべての公開モジュールが本 spec の Boundary Commitments / Out of Boundary で明示的に分類されており、新規メトリクス追加・新規 anonymization handler 追加・SDK バージョンアップが「どこを触ればよいか / どこを触ってはいけないか」を本 spec 1 か所で参照できる。
- Resource Attribute は identity 専用、設定値は `growi.configs` info-gauge ラベルへ、観測値は `growi.*` または `system.*` / `process.*` メトリクスへ、というレイヤ責務が明文化されている。
- 旧来の `apps/app/src/features/opentelemetry/docs/` 配下の散在ドキュメントは破棄され、本 spec が単一の真実ソースになる。

## Approach
**新規実装ではなくドキュメント統合。** 既に動作している `features/opentelemetry/` の構造を本 spec に固定化する。
1. SDK ライフサイクル・Resource 2 段階初期化・Custom Metrics 合成・Anonymization の 4 レイヤを Boundary Commitments で分割。
2. Configuration（env var / config key）と Metric Schema を表形式で明示。
3. Resource Attribute は identity 専用、設定値は `growi.configs` info-gauge ラベル、観測値（メモリ・ヒープ等）は `system.*` / `process.*` メトリクスへ、というレイヤ責務を Design Decisions として固定する。

## Scope
- **In**:
  - `features/opentelemetry/server/` 配下のすべての公開モジュール（SDK / Resource / Metric / Anonymization / Logger / semconv）の責務と境界の明文化。
  - 設定キー一覧と Resource Attribute / Metric Schema の確定スナップショット。
  - 既存 Anonymization Handler の登録手順（`handlers/index.ts` への module 追加 + `canHandle` / `handle` インターフェース実装）。
- **Out**:
  - 既存メトリクスの名称変更や再構成。
  - Trace span attribute の追加（`http.target` 以外）。
  - GROWI 本体の logger pipeline と OpenTelemetry log signal の統合。
  - フロントエンド（ブラウザ）からの telemetry 出力。
  - サードパーティ製パッケージ（`@opentelemetry/host-metrics` 等）への置き換え。

## Boundary Candidates
1. **SDK ライフサイクル**（`node-sdk.ts`, `node-sdk-configuration.ts`, `node-sdk-resource.ts`, `logger.ts`） — SDK 初期化・enable/disable 制御・Resource 2 段階注入。
2. **Resource Attribute レイヤ**（`custom-resource-attributes/`） — identity 専用属性の供給。
3. **Custom Metric レイヤ**（`custom-metrics/`） — `growi.*` / `system.*` / `process.*` メトリクスの emit と合成。
4. **HTTP Anonymization レイヤ**（`anonymization/`） — `http.target` の匿名化と handler の選択ロジック。
5. **SemConv ローカルコピー**（`semconv.ts`） — 不安定 semconv の固定化。

これら 5 つはそれぞれ独立に拡張・置換可能で、相互の dependency は明確に下流方向に限定されている。

## Out of Boundary
- `~/server/service/growi-info`（`growiInfoService`） — 上流。本 spec は consumer。
- `~/server/service/config-manager`（`configManager`） — 上流。本 spec は consumer。
- `~/utils/growi-version` / `~/utils/logger` — utility。本 spec は consumer。
- Anonymization で参照する `@growi/core/dist/utils/page-path-utils` の各 helper（`isPermalink`, `isUserPage`, `getUsernameByPath` 等） — `@growi/core` の責務。
- Auto-instrumentation（HTTP / Express / Mongoose 等）のチューニング — 設定オブジェクトの構造は本 spec が定義するが、各 instrumentation の挙動は上流パッケージの責務。
- OTLP Exporter の wire 仕様、Prometheus / Grafana / Collector 等の下流ツールチェイン。

## Upstream / Downstream
- **Upstream**:
  - `~/server/service/config-manager` — `otel:*` config 4 種。
  - `~/server/service/growi-info` — `growiInfoService.getGrowiInfo(opts)`。Metric / Resource 双方が consumer。
  - `~/utils/growi-version` — `service.version` Resource Attribute の供給元。
- **Downstream**:
  - OpenTelemetry Collector（OTLP gRPC）。
  - 受信側ダッシュボード（Prometheus / Grafana / Tempo / Loki 等）。otel-infra 管理者は本 spec の Metric Schema と Resource Attribute 表を参照する。

## Existing Spec Touchpoints
- **Adjacent**: なし。`growi-logger` spec はアプリケーションロガーの spec で、`logger.ts` の `DiagLogger` アダプタが pino を経由する点で接点があるが、両者の責務は独立。

## Constraints
- ランタイム要件: Node.js `^24`（cgroup memory API、V8 統計のため）。
- 新規 npm dependency の追加は原則不可（既存 `@opentelemetry/*` パッケージで完結させる）。追加が必要な場合は `apps/app/.next/node_modules/` 残留有無を確認し `dependencies` 分類が必要かを判定する（参照: `.claude/rules/package-dependencies.md`）。
- Semconv の不安定 attribute は `semconv.ts` にローカルコピーする（incubating entry-point は import しない）。詳細は [semconv.ts](../../apps/app/src/features/opentelemetry/server/semconv.ts) のコメント参照。
- `setResource()` は `NodeSDK._resource` への private アクセスを行う（type cast 必須）。OpenTelemetry SDK が public な resource 上書き API を提供したら撤去する。
- Anonymization の出力先 attribute は `http.target`（incubating）。OTLP semconv で対応 stable attribute が決定したら移行する。
