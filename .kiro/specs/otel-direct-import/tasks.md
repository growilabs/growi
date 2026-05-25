# Implementation Plan

- [ ] 1. Foundation: package dependency 入れ替え
- [x] 1.1 apps/app/package.json と pnpm-lock.yaml を direct import 構成に更新
  - `apps/app/package.json` の `dependencies` から `@opentelemetry/auto-instrumentations-node` を削除
  - `@opentelemetry/instrumentation-http` (`^0.217.0`)、`@opentelemetry/instrumentation-express` (`^0.65.0`)、`@opentelemetry/instrumentation-mongodb` (`^0.70.0`)、`@opentelemetry/instrumentation-mongoose` (`^0.63.0`) を `dependencies` に追加
  - リポジトリルートから `pnpm install` を実行し `pnpm-lock.yaml` を再生成
  - Observable: `apps/app/package.json` の `dependencies` に `auto-instrumentations-node` が無く、4 instrumentation package が存在することを `grep` / `jq` で確認できる
  - _Requirements: 5.1, 5.2_

- [ ] 2. Core: buildInstrumentations の direct import 再実装
- [x] 2.1 buildInstrumentations を direct import 構成に書き換え
  - `getNodeAutoInstrumentations` の import を削除し、`HttpInstrumentation`、`ExpressInstrumentation`、`MongoDBInstrumentation`、`MongooseInstrumentation` を 4 package から直接 import
  - `ALL_AUTO_INSTRUMENTATION_PACKAGES` および `ALLOW_LIST_INSTRUMENTATION_PACKAGES` 定数を削除
  - 関数本体を「4 instrumentation を `new` で構築して配列で返す」flat な direct factory 構成に置き換え
  - HTTP instrumentation の構築時に `Option.enableAnonymization` が truthy なら `httpInstrumentationConfigForAnonymize` を merge、falsy / 未指定なら anonymization config を含めない
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE === 'all'` のとき deprecation 文言の warn ログを 1 回出し、その後も同じ 4 instrumentation 配列を返す
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE` が `minimal` でも `all` でもない値のとき、既存の `Unknown OTEL_AUTO_INSTRUMENTATION_PROFILE value` 文言の warn を出し、同じ 4 instrumentation 配列を返す
  - 環境変数が unset または `=minimal` のときは warn を出さない
  - いかなる環境変数値でも例外を投げない
  - 戻り型を `Instrumentation[]`（`import type { Instrumentation } from '@opentelemetry/instrumentation'`）に正規化
  - Observable: `buildInstrumentations()` の戻り値が常に長さ 4 の配列で、各要素がそれぞれ `HttpInstrumentation` / `ExpressInstrumentation` / `MongoDBInstrumentation` / `MongooseInstrumentation` の instance となる
  - _Requirements: 1.1, 1.2, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 3. Core: unit test の direct import 構造への書き換え
- [ ] 3.1 node-sdk-configuration.spec.ts を 4 mock 構造に置き換え
  - `vi.mock('@opentelemetry/auto-instrumentations-node', ...)` を削除
  - 4 instrumentation package を個別に `vi.mock` し、各 constructor の mock を保持して `mock.calls` を検査できるようにする
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE` が unset / `=minimal` / `=all` / unknown 値（例: `custom`）の 4 ケースそれぞれで、戻り値が長さ 4 の配列であり、4 constructor がちょうど 1 回ずつ呼ばれることを assert
  - `=all` で deprecation 文言の warn が 1 回呼ばれ、unknown 値で既存 `Unknown OTEL_AUTO_INSTRUMENTATION_PROFILE` 文言の warn が呼ばれ、unset / `=minimal` で warn が呼ばれないことを assert
  - `enableAnonymization=true` のとき `HttpInstrumentation` の constructor 第 1 引数に anonymization config の field が含まれ、`enableAnonymization=false` / 未指定のとき含まれないことを assert
  - Observable: `pnpm vitest run node-sdk-configuration.spec` の出力で全テストケースが green になる
  - _Requirements: 1.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 4. Integration: build artifact と quality gates の検証
- [ ] 4.1 production build と全 quality gates を実行し artifact を検証
  - リポジトリルートから `turbo run build --filter @growi/app`、`turbo run lint --filter @growi/app`、`turbo run test --filter @growi/app` をすべて green で通す
  - `ls apps/app/.next/node_modules/` で 4 instrumentation package のうち少なくとも 1 つが symlink として外部化されていることを確認
  - `ls apps/app/.next/node_modules/` から `@opentelemetry/auto-instrumentations-node` の symlink が消えていることを確認
  - `node-sdk-configuration.spec.ts` 以外の既存テストが regression していないこと（test 件数 / pass 数が変更前と整合）
  - Observable: 3 つの `turbo` コマンドが exit 0、`.next/node_modules/` 配下に 4 instrumentation のいずれかが externalised として存在し、`auto-instrumentations-node` の symlink が存在しない
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.3_

- [ ] 5. Validation: RSS 削減効果と runtime トレース継続の運用観察
- [ ] 5.1 memory-profiler scenario runner で before / after baseline mean RSS を計測し verification-report.md に記録
  - HEAD（本 spec 適用前のコミット）と本 spec 適用後のコミットそれぞれで、`apps/app` の memory-profiler scenario runner を「OTel ON / 5 分 idle baseline」シナリオで実行
  - 取得した RSS sample 列から baseline mean RSS を算出し、`after - before` の delta を計算
  - 計測中に GROWI のページ表示・編集・検索が機能していることを目視確認し、http / express / mongodb / mongoose のトレースおよび custom metrics 5 個（application / user-counts / page-counts / system / yjs）が OTLP exporter に流れ続けていることをログまたは collector 側で観察
  - 結果（before 平均、after 平均、delta、計測日時、commit SHA、Node.js version、シナリオ条件、トレースおよび custom metrics 継続の観察結果）を `.kiro/specs/otel-direct-import/verification-report.md` に記録
  - Observable: `verification-report.md` に baseline mean before / after / delta（MB 単位）が記載され、delta ≥ 5 MB であることが報告されている
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3_
