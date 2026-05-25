# Design Document — OTel Instrumentation Direct Import

## Overview

**Purpose**: `apps/app` の OpenTelemetry instrumentation 構成を、`@opentelemetry/auto-instrumentations-node` 経由の deny-list 方式から、必要な 4 instrumentation（HTTP / Express / MongoDB / Mongoose）の direct import 方式へ refactor する。`memory-leak-investigation` spec の L2 finding が「RSS 削減未達」となった根本原因（`getNodeAutoInstrumentations` が `enabled: false` 指定にかかわらず全 31 instrumentation を instantiate する仕様）を解消し、isolated benchmark で確認された約 11 MB / process の RSS 削減を GROWI runtime にも適用する。

**Users**: GROWI を自己ホストし OTel を有効化している運用者・SRE が直接の受益者。トレース機能を消費する開発者・運用者にとっては機能継続が保証される。

**Impact**: `buildInstrumentations` 関数の実装を入れ替え、`apps/app/package.json` の OTel 依存表面を 4 package の direct dep に置き換える。実行時の export 設定、custom metrics、anonymization 契約はすべて維持する。`OTEL_AUTO_INSTRUMENTATION_PROFILE` 環境変数は warn 出力付きで縮退動作させ、後方互換性を保つ。

### Goals

- `buildInstrumentations` が起動時に正確に 4 instrumentation のみを instantiate する状態にする
- `@growi/app` の runtime dependency surface から `@opentelemetry/auto-instrumentations-node` を除去し、4 instrumentation package を direct dep に昇格する
- HTTP anonymization config との合成契約を破壊せず維持する
- `OTEL_AUTO_INSTRUMENTATION_PROFILE` の既存設定値で deployment が破壊されないようにする
- GROWI runtime baseline mean RSS で 5 MB 以上の削減を verification report に記録する

### Non-Goals

- HTTP / Express / MongoDB / Mongoose 以外の新規 instrumentation 追加（必要になれば別 spec）
- BatchSpanProcessor / MetricReader / OTLP exporter 設定の変更
- custom metrics 5 個（application / user-counts / page-counts / system / yjs）の組み込み変更
- anonymization module 自体の変更（合成契約のみを保つ）
- `auto-instrumentations-node` の transitive 残存監視（`package-dependencies` rule の責務）
- `OTEL_AUTO_INSTRUMENTATION_PROFILE` の本 spec での完全削除（次 major bump 以降の課題）

## Boundary Commitments

### This Spec Owns

- `apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts` の `buildInstrumentations` 関数の実装と公開シグネチャ
- `buildInstrumentations` が返す instrumentation 集合（HTTP / Express / MongoDB / Mongoose の 4 個）
- `OTEL_AUTO_INSTRUMENTATION_PROFILE` 環境変数の読み取りと deprecation 通知挙動
- `apps/app/package.json` の OTel 関連 runtime dependency 構成
  - 削除: `@opentelemetry/auto-instrumentations-node`
  - 追加: `@opentelemetry/instrumentation-http`、`@opentelemetry/instrumentation-express`、`@opentelemetry/instrumentation-mongodb`、`@opentelemetry/instrumentation-mongoose`
- 既存 `node-sdk-configuration.spec.ts` の test ケース更新（mock 構造の置き換え）
- 本 spec の verification report（before/after RSS 計測結果の記録）

### Out of Boundary

- `node-sdk.ts` の初期化フロー（`generateNodeSDKConfiguration` 呼び出し側）— `buildInstrumentations` の呼び出し方は変えない
- `setupCustomMetrics()` および `custom-metrics/` 配下の 5 個の metric 実装
- `anonymization/` モジュール内部の sanitization ロジック（合成入力としての contract のみ消費）
- `@opentelemetry/sdk-node`、`@opentelemetry/api`、OTLP exporter 等の SDK 基盤 dep のバージョン管理
- `memory-leak-investigation` の L1 / L3 / L4 / L5 finding
- `@opentelemetry/auto-instrumentations-node` の transitive dep 残存の検出・整理（`package-dependencies` rule の責務）

### Allowed Dependencies

- `@opentelemetry/instrumentation-http`、`@opentelemetry/instrumentation-express`、`@opentelemetry/instrumentation-mongodb`、`@opentelemetry/instrumentation-mongoose` — direct import 対象
- `@opentelemetry/instrumentation`（type-only import）— `Instrumentation` 型の取得用
- `@opentelemetry/sdk-node`、`@opentelemetry/api`、`@opentelemetry/resources`、`@opentelemetry/sdk-metrics`、`@opentelemetry/exporter-{trace,metrics}-otlp-grpc`、`@opentelemetry/semantic-conventions` — 既存依存（変更なし）
- 同モジュール内 `./anonymization` の `httpInstrumentationConfig` export — 既存契約を消費
- 同モジュール内 `./semconv` の `ATTR_SERVICE_INSTANCE_ID` — 既存契約を消費
- `~/utils/logger`、`~/utils/growi-version`、`~/server/service/config-manager` — 既存内部依存

### Revalidation Triggers

以下の変更が発生した場合、本 spec とその consumer の整合再確認が必要になる:

- `buildInstrumentations` の戻り型シグネチャ変更（`Instrumentation[]` 以外への変更）
- 起動時に有効化される instrumentation 集合の追加・削除（4 個から増減）
- `httpInstrumentationConfigForAnonymize` の shape 変更（anonymization 側からの破壊的変更）
- `@opentelemetry/sdk-node` の `NodeSDKConfiguration.instrumentations` 入力型の major 変更
- `OTEL_AUTO_INSTRUMENTATION_PROFILE` 環境変数の完全削除（deprecation phase 終了）

## Architecture

### Existing Architecture Analysis

- 現行 `buildInstrumentations` は `OTEL_AUTO_INSTRUMENTATION_PROFILE` 値で 3 分岐し、いずれも `getNodeAutoInstrumentations(...)` を呼ぶ単一経路に収束する。
- `minimal` 分岐は内部で `ALL_AUTO_INSTRUMENTATION_PACKAGES`（31 entries）と `ALLOW_LIST_INSTRUMENTATION_PACKAGES`（4 entries）を組み合わせ deny-list config を組み立てる。
- `all` 分岐は legacy 互換のため pino / fs のみ disable する deny-list を組み立てる。
- HTTP instrumentation には `enableAnonymization` オプションに応じて `httpInstrumentationConfig`（`./anonymization`）が合成される。
- 戻り型は `ReturnType<typeof getNodeAutoInstrumentations>[]` の cast workaround で表現されている。
- 単一の caller は `generateNodeSDKConfiguration` で、結果配列は `NodeSDKConfiguration.instrumentations` にそのまま渡される。

### Architecture Pattern & Boundary Map

本 refactor は単一関数の internal 実装入れ替えにとどまり、上位 caller の契約（`generateNodeSDKConfiguration` のシグネチャ、`node-sdk.ts` の使用方法）は不変。

```mermaid
graph TB
    subgraph Before
        nodeSdkBefore[node-sdk.ts initInstrumentation]
        configBefore[node-sdk-configuration.ts generateNodeSDKConfiguration]
        buildBefore[buildInstrumentations]
        autoInstr[auto-instrumentations-node getNodeAutoInstrumentations]
        thirtyOne[31 instrumentations instantiated]
        nodeSdkBefore --> configBefore
        configBefore --> buildBefore
        buildBefore --> autoInstr
        autoInstr --> thirtyOne
    end
    subgraph After
        nodeSdkAfter[node-sdk.ts initInstrumentation unchanged]
        configAfter[node-sdk-configuration.ts generateNodeSDKConfiguration unchanged]
        buildAfter[buildInstrumentations reimplemented]
        httpDirect[HttpInstrumentation]
        expressDirect[ExpressInstrumentation]
        mongodbDirect[MongoDBInstrumentation]
        mongooseDirect[MongooseInstrumentation]
        anonymize[anonymization httpInstrumentationConfig]
        nodeSdkAfter --> configAfter
        configAfter --> buildAfter
        buildAfter --> httpDirect
        buildAfter --> expressDirect
        buildAfter --> mongodbDirect
        buildAfter --> mongooseDirect
        anonymize --> httpDirect
    end
```

**Architecture Integration**:
- Selected pattern: **Direct factory function** — 4 instrumentation class を hard-coded で `new` し配列で返す flat factory。speculative な registry / DI を導入しない（YAGNI、Synthesis: Simplification）。
- Domain/feature boundaries: `opentelemetry/server/` モジュール内に閉じる。`anonymization/`・`custom-metrics/` との既存境界（import 経路のみ）を維持。
- Existing patterns preserved:
  - HTTP anonymization config の optional 合成
  - 環境変数による起動時挙動の選択
  - `generateNodeSDKConfiguration` の lazy initialization パターン
- New components rationale: 新規コンポーネントは追加しない（既存関数の内部実装入れ替えのみ）。
- Steering compliance: `tech.md` の Turbopack externalisation 規律に従い、SSR 経路で static import される 4 package を `dependencies` に追加。`package-dependencies` rule に従い production deploy artifact から欠落しないことを `.next/node_modules/` で検証可能。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Backend (OTel SDK base) | `@opentelemetry/sdk-node` `^0.217.0`（既存） | `NodeSDK` instance を生成 | 変更なし |
| Backend (Instrumentation, removed) | ~~`@opentelemetry/auto-instrumentations-node` `^0.75.0`~~ | 旧 deny-list builder | 本 spec で `apps/app` の direct dep から削除 |
| Backend (Instrumentation, added) | `@opentelemetry/instrumentation-http` `^0.217.0` | HTTP server / client span 出力 | direct import 用、lockfile に既存解決あり |
| Backend (Instrumentation, added) | `@opentelemetry/instrumentation-express` `^0.65.0` | Express middleware / route span 出力 | direct import 用、lockfile に既存解決あり |
| Backend (Instrumentation, added) | `@opentelemetry/instrumentation-mongodb` `^0.70.0` | MongoDB driver span 出力 | direct import 用、lockfile に既存解決あり |
| Backend (Instrumentation, added) | `@opentelemetry/instrumentation-mongoose` `^0.63.0` | Mongoose 層 span 出力 | direct import 用、lockfile に既存解決あり |
| Backend (Instrumentation, type-only) | `@opentelemetry/instrumentation`（transitive） | `Instrumentation` 型の取得 | `import type` のみ、runtime dep 追加不要 |

> 上記バージョンは既に lockfile 内で `auto-instrumentations-node@0.75.0` 経由で解決済み（`research.md` 参照）。新規追加時のレンジは同一マイナーラインを採用する。

## File Structure Plan

### Directory Structure

```
apps/app/
├── src/features/opentelemetry/server/
│   ├── node-sdk-configuration.ts            # 本 spec の主改修対象（buildInstrumentations 再実装）
│   ├── node-sdk-configuration.spec.ts       # mock 構造を direct import 用に置換
│   ├── node-sdk.ts                          # 変更なし（caller 側、契約不変）
│   ├── anonymization/                       # 変更なし（合成入力としてのみ消費）
│   └── custom-metrics/                      # 変更なし（boundary 外）
├── package.json                             # OTel 依存表面の入れ替え
└── tmp/otel-import-bench/                   # 既存 benchmark（参考、変更なし）
.kiro/specs/otel-direct-import/
├── verification-report.md                   # 新規: before/after RSS 計測結果
├── requirements.md / design.md / research.md / tasks.md
└── spec.json
pnpm-lock.yaml                                # `pnpm install` で再生成
```

### Modified Files

- `apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts` — `buildInstrumentations` を direct import 構成に再実装。`ALL_AUTO_INSTRUMENTATION_PACKAGES` / `ALLOW_LIST_INSTRUMENTATION_PACKAGES` 定数を削除。`getNodeAutoInstrumentations` import を削除し、4 instrumentation class を import。戻り型を `Instrumentation[]` に正規化。`OTEL_AUTO_INSTRUMENTATION_PROFILE=all` への deprecation warn を追加。
- `apps/app/src/features/opentelemetry/server/node-sdk-configuration.spec.ts` — `@opentelemetry/auto-instrumentations-node` mock を削除し、4 instrumentation package を個別に mock。各 constructor の `mock.calls[0]` を検査する形に test 構造を組み替え。anonymization 合成 / 環境変数分岐 / unknown 値 warn の検証は新 mock 上で再構成。
- `apps/app/package.json` — `dependencies` から `@opentelemetry/auto-instrumentations-node` を削除し、4 instrumentation package を追加。
- `pnpm-lock.yaml` — `pnpm install` 実行による自動再生成。

### Added Files

- `.kiro/specs/otel-direct-import/verification-report.md` — devcontainer での before / after RSS 計測結果（baseline mean、delta、scenario 条件）の記録。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | 起動時に 4 instrumentation を有効化 | `buildInstrumentations` | `Instrumentation[]` 戻り型 | initInstrumentation → generateNodeSDKConfiguration → buildInstrumentations |
| 1.2 | 4 個以外を instantiate しない | `buildInstrumentations` | 4 class の direct constructor 呼び出しのみ | 同上 |
| 1.3 | 集合を unit test で assertable | `buildInstrumentations` + spec | 4 instrumentation の constructor mock 呼び出し検査 | テスト経路 |
| 2.1 / 2.2 / 2.3 | http / express / mongodb / mongoose の span 出力継続 | `HttpInstrumentation`、`ExpressInstrumentation`、`MongoDBInstrumentation`、`MongooseInstrumentation`（4 class の instantiation） | NodeSDKConfiguration.instrumentations 入力 | NodeSDK.start() → instrumentations 起動 |
| 2.4 | custom metrics の継続出力 | （境界外：`setupCustomMetrics`）依存契約として保持 | OTLP metric exporter 経路（不変） | startOpenTelemetry → setupCustomMetrics |
| 3.1 / 3.2 / 3.3 | HTTP anonymization 合成 | `buildInstrumentations` の HTTP 構築箇所、`httpInstrumentationConfigForAnonymize` 入力 | `Option.enableAnonymization` フラグ → HTTP instrumentation config | anonymization 合成経路 |
| 4.1 / 4.2 | env var 未設定 / `=minimal` で無警告起動 | `buildInstrumentations` の profile 分岐 | `process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE` 読み取り | env var → 分岐 → 4 instrumentation 起動 |
| 4.3 | `=all` で deprecation warn + 縮退 | `buildInstrumentations` の deprecation 通知箇所、`logger.warn` | 同上、warn ログ contract | env var → warn → 縮退 |
| 4.4 | unknown 値で warn + 縮退 | 既存 unknown 値 warn 箇所 | 同上 | 同上 |
| 4.5 | startup を throw しない | `buildInstrumentations` 例外契約 | 例外を投げない契約 | 起動経路 |
| 5.1 / 5.2 | package.json 依存表面 | `apps/app/package.json` | npm dependencies 表面 | パッケージ install 経路 |
| 5.3 | production artifact で 4 package が解決可能 | `apps/app/package.json` + Turbopack externalisation | `.next/node_modules/` 配下の symlink | build → assemble-prod → CI |
| 6.1 / 6.2 / 6.3 | RSS 削減効果の運用観察 | `verification-report.md`、memory-profiler scenario runner（既存ツール） | scenario 実行 → 計測値記録 | verification 実行経路 |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies (P0/P1) | Contracts |
|-----------|--------------|--------|--------------|--------------------------|-----------|
| `buildInstrumentations` | Backend / OTel init | 4 instrumentation を direct 構築して `Instrumentation[]` を返す | 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5 | 4 instrumentation package (P0)、`./anonymization` (P0)、`~/utils/logger` (P1) | Service |
| `apps/app/package.json`（OTel 依存表面） | Build / Packaging | runtime dependency surface を direct import 構成に整える | 5.1, 5.2, 5.3 | pnpm workspace（P0）、Turbopack externalisation（P0） | State |
| `verification-report.md` | Spec verification | before / after の RSS 計測結果を記録 | 6.1, 6.2, 6.3 | memory-profiler scenario runner（P0） | Batch |

### Backend / OTel init

#### `buildInstrumentations`

| Field | Detail |
|-------|--------|
| Intent | `Option` を受け取り、HTTP / Express / MongoDB / Mongoose の 4 instrumentation を direct で構築して返す |
| Requirements | 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5 |

**Responsibilities & Constraints**
- 4 instrumentation の class を直接 `new` で構築し、それ以外の instrumentation を一切 instantiate しないことを唯一の責務とする。
- HTTP instrumentation には `Option.enableAnonymization` に応じて `httpInstrumentationConfigForAnonymize` を合成する。
- `process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE` を読み、`all` / unknown 値の場合は warn ログを出力するが、いずれの場合も同じ 4 instrumentation を返す。
- 任意の入力値で例外を投げない（startup を破壊しない）。
- 戻り型は `Instrumentation[]`（`@opentelemetry/instrumentation` の型を `import type` で取得）。

**Dependencies**
- Inbound: `generateNodeSDKConfiguration`（同モジュール内、変更なし）— 戻り値を `NodeSDKConfiguration.instrumentations` に渡す（P0）
- Outbound: `HttpInstrumentation`、`ExpressInstrumentation`、`MongoDBInstrumentation`、`MongooseInstrumentation` の 4 class（P0）
- Outbound: `httpInstrumentationConfigForAnonymize`（`./anonymization`）— anonymization 合成入力（P0）
- Outbound: `~/utils/logger` の `loggerFactory('growi:opentelemetry:node-sdk-configuration')`（P1）
- External: `@opentelemetry/instrumentation` の `Instrumentation` 型（type-only、P2）

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface

```typescript
import type { Instrumentation } from '@opentelemetry/instrumentation';

type Option = {
  enableAnonymization?: boolean;
};

export const buildInstrumentations = (opts?: Option): Instrumentation[];
```

- Preconditions:
  - `process.env.OTEL_AUTO_INSTRUMENTATION_PROFILE` が任意の string か未定義。値による分岐は本関数内で完結する。
  - `httpInstrumentationConfigForAnonymize` が `./anonymization` から既存と同じ shape で export されている。
- Postconditions:
  - 戻り値配列の長さは常に 4。
  - 配列要素はそれぞれ `HttpInstrumentation`、`ExpressInstrumentation`、`MongoDBInstrumentation`、`MongooseInstrumentation` の instance。
  - `opts.enableAnonymization === true` のとき、HTTP instrumentation の constructor 引数に anonymization config が merge された状態で渡る。
  - `opts.enableAnonymization` が falsy のとき、HTTP instrumentation の constructor 引数は anonymization 由来の field を含まない。
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE === 'all'` のとき、`logger.warn` が deprecation 文言で 1 回呼ばれる。
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE` が `minimal` でも `all` でもない値のとき、`logger.warn` が unknown-value 文言で 1 回呼ばれる（既存 message を維持）。
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE` が unset または `minimal` のとき、`logger.warn` は呼ばれない。
- Invariants:
  - 戻り値配列に 4 instrumentation 以外を含めない。
  - 戻り値は同一呼び出しで毎回新規 instance を生成する（既存挙動を維持。lazy cache は `generateNodeSDKConfiguration` 側の責務）。
  - 関数本体内で `getNodeAutoInstrumentations` を import しない、`ALL_AUTO_INSTRUMENTATION_PACKAGES` / `ALLOW_LIST_INSTRUMENTATION_PACKAGES` を参照しない。

**Implementation Notes**
- Integration: caller `generateNodeSDKConfiguration` の使用方法は不変。`node-sdk.ts` 経由の起動フローも不変。
- Validation: 戻り値配列を unit test で `instanceof` 検査するか、mock した 4 constructor の呼び出し有無 / 順序 / 引数を `vi.mocked(...).mock.calls` で検査する。
- Risks: `Instrumentation[]` 型のために `@opentelemetry/instrumentation` の transitive 解決が必要。lockfile 再生成で 4 instrumentation package が同 package の同一バージョンを共有することを確認する。

### Build / Packaging

#### `apps/app/package.json`（OTel 依存表面）

| Field | Detail |
|-------|--------|
| Intent | runtime dependency surface を direct import 構成に整える |
| Requirements | 5.1, 5.2, 5.3 |

**Responsibilities & Constraints**
- `dependencies` から `@opentelemetry/auto-instrumentations-node` を削除する。
- `dependencies` に `@opentelemetry/instrumentation-http`、`@opentelemetry/instrumentation-express`、`@opentelemetry/instrumentation-mongodb`、`@opentelemetry/instrumentation-mongoose` を追加する。バージョンは lockfile 解決済みのレンジ（`^0.217.0` / `^0.65.0` / `^0.70.0` / `^0.63.0`）を採用。
- Turbopack の `.next/node_modules/` 経由で 4 package が production artifact に含まれることを `check-next-symlinks.sh`（CI）で確認可能とする。

**Dependencies**
- Inbound: `apps/app` の SSR コードからの static import（P0）
- Outbound: pnpm workspace 解決（P0）、Turbopack externalisation（P0）

**Contracts**: State [x]（package dependency 表面の状態）

**Implementation Notes**
- Integration: `pnpm install` を root から実行して `pnpm-lock.yaml` を再生成。
- Validation: `pnpm run build` 実行後に `ls apps/app/.next/node_modules/ | grep instrumentation-` で 4 package symlink を確認。CI の `reusable-app-prod.yml` 経由で `check-next-symlinks.sh` と `server:ci` を通す。
- Risks: 旧 `auto-instrumentations-node` が他 package の transitive dep として残る可能性は `package-dependencies` rule の責務（本 spec の boundary 外）。
- Notes: `@growi/app` は internal package（npm 公開対象は `@growi/core` / `@growi/pluginkit` のみ）のため、changeset は作成しない。`OTEL_AUTO_INSTRUMENTATION_PROFILE` の deprecation は runtime の warn ログ（Req 4.3）で運用者に通知される。

### Verification

#### `verification-report.md`

| Field | Detail |
|-------|--------|
| Intent | devcontainer 上の memory-profiler scenario runner で取得した before / after baseline mean RSS と delta を記録する |
| Requirements | 6.1, 6.2, 6.3 |

**Responsibilities & Constraints**
- before / after それぞれを「OTel ON、5 分 idle baseline」シナリオで計測した結果として記録する。
- baseline mean RSS（before）、baseline mean RSS（after）、delta（MB）、計測日時、計測環境（devcontainer / Node.js version / commit SHA）を含める。
- delta が 5 MB 未満の場合、本 spec は要件 6.1 不達と判定する。
- 計測中 / 直後に既存 4 instrumentation のトレースが OTLP exporter に流れていることを確認した事実を記録する（要件 6.2 への観察的根拠）。

**Contracts**: Batch [x]（verification pipeline で 1 回作成）

**Implementation Notes**
- Integration: `apps/app` の memory-profiler scenario runner を使用（既存ツール、`memory-leak-investigation` spec で導入）。
- Validation: scenario runner の出力 JSON / log から baseline mean RSS を抽出し、本ファイルに転記。
- Risks: DB drift / ホスト負荷の noise — sample 数を確保し中央値ベースで評価する。

## Error Handling

### Error Strategy

- **環境変数値による起動阻害は行わない**: `OTEL_AUTO_INSTRUMENTATION_PROFILE` のすべての値（unset / `minimal` / `all` / unknown）に対して、`buildInstrumentations` は 4 instrumentation を返して正常終了する。throw しない。
- **deprecation 通知は log warn**: 起動を中断せず、warn ログのみで運用者に通知する。
- **instrumentation 構築時の内部エラー**: 各 instrumentation の constructor が throw する可能性は OTel SDK 側の責務であり、本 spec では握りつぶさず上位（NodeSDK の起動）に伝搬する（既存挙動を維持）。

### Error Categories and Responses

- **User Errors（env var 誤設定）**: `OTEL_AUTO_INSTRUMENTATION_PROFILE` の `all` / unknown 値に対して個別文言の warn ログを出す。
- **System Errors（instrumentation 構築失敗）**: 個別の instrumentation constructor が throw した場合、現状どおり起動が失敗する。本 spec では新規ハンドリングを追加しない（speculative）。
- **Business Logic Errors**: 該当なし。

### Monitoring

- 起動時の deprecation warn は `growi:opentelemetry:node-sdk-configuration` logger 経由で既存 log pipeline に流す。
- 起動後の trace / metric 出力は既存 OTLP exporter を通じて観察可能。

## Testing Strategy

### Unit Tests（`node-sdk-configuration.spec.ts`）

- `buildInstrumentations()` の戻り値が `HttpInstrumentation`、`ExpressInstrumentation`、`MongoDBInstrumentation`、`MongooseInstrumentation` の 4 instance を含むことを確認（4 constructor を `vi.mock` でスタブし、各 constructor の呼び出し回数を assert）。
- `buildInstrumentations({ enableAnonymization: true })` で HTTP constructor の第 1 引数に `httpInstrumentationConfigForAnonymize` の field が含まれることを確認。
- `buildInstrumentations({ enableAnonymization: false })` および `buildInstrumentations()` で HTTP constructor の引数に anonymization 由来の field が含まれないことを確認。
- `OTEL_AUTO_INSTRUMENTATION_PROFILE=all` で `logger.warn` が deprecation 文言で 1 回呼ばれ、戻り値の構成（4 instrumentation）が unset 時と同一であることを確認。
- `OTEL_AUTO_INSTRUMENTATION_PROFILE` に unknown 値（例: `custom`）を設定したとき、既存の `Unknown OTEL_AUTO_INSTRUMENTATION_PROFILE value` 文言で warn が呼ばれ、戻り値が 4 instrumentation であることを確認。
- `OTEL_AUTO_INSTRUMENTATION_PROFILE` unset または `=minimal` のとき、warn が呼ばれないことを確認。

### Integration Tests

- `pnpm run build` 後に `apps/app/.next/node_modules/` 配下に 4 instrumentation package の symlink が存在することを目視 / スクリプトで確認（既存の `check-next-symlinks.sh` に依存）。
- `apps/app/package.json` の OTel 関連 `dependencies` が「`auto-instrumentations-node` 不在 / 4 instrumentation 存在」となっていることを確認。

### Verification（要件 6 系の運用観察）

- devcontainer で memory-profiler scenario runner を本 spec 適用前後のコミットそれぞれで実行し、OTel ON / 5 分 idle baseline の baseline mean RSS を取得。
- before / after の delta が 5 MB 以上であることを `verification-report.md` に記録（要件 6.1）。
- 計測中に GROWI のページ表示・編集・検索が機能することを目視確認（要件 6.2）。
- 計測結果を `verification-report.md` に転記し、commit SHA・Node.js version・計測日時を含める（要件 6.3）。

### Performance Sanity

- 4 instrumentation 起動による span emit のオーバーヘッドは既存と同等（同じ 4 instrumentation を有効化していたため）。新規ベンチマークは不要。

## Migration Strategy

### Rollout Phases

```mermaid
graph LR
    A[Phase 1 Implement] --> B[Phase 2 Verify]
    B --> C[Phase 3 Deprecation window]
    C --> D[Future Spec env var removal]
```

- **Phase 1 — Implement**: `buildInstrumentations` 再実装、`package.json` 入れ替え、test 更新、`pnpm install`、`pnpm run lint` / `pnpm run test` / `pnpm run build` を通す。
- **Phase 2 — Verify**: memory-profiler scenario runner で before / after RSS 計測、`verification-report.md` 記録、`.next/node_modules/` の symlink 確認。
- **Phase 3 — Deprecation Window**: 数マイナーリリース以上、`OTEL_AUTO_INSTRUMENTATION_PROFILE` を warn 付きで保持する。`@growi/app` は internal package のため、利用者通知は startup warn ログ（Req 4.3）で行う。
- **Future Spec — Env var Removal**: 別 spec で完全削除する（本 spec の boundary 外）。

### Rollback Triggers

- 本 spec 適用後に 4 instrumentation のいずれかでトレース欠落が発生した場合（要件 2.1〜2.3 違反）。
- `verification-report.md` の RSS delta が 5 MB 未満で再現する場合（要件 6.1 違反）。
- production deployment で 4 package のいずれかが `ERR_MODULE_NOT_FOUND` を起こした場合（要件 5.4 違反）。

いずれも `apps/app/package.json` と `node-sdk-configuration.ts` を git revert することで rollback 可能（本 spec の変更範囲が狭い）。

## Performance & Scalability

- **Target metric**: per-process RSS（baseline mean、OTel ON / 5 分 idle）。
- **Expected delta**: isolated benchmark で −11 MB（auto-deny → direct-import）。GROWI runtime での閾値は −5 MB（DB drift noise の下限）。
- **Measurement**: memory-profiler scenario runner（既存ツール、`memory-leak-investigation` spec で導入）。
- **No additional caching / batching changes**: span / metric 出力 frequency、batch サイズはすべて既存設定を維持。
