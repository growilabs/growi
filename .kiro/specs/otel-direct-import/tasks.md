# Implementation Plan

- [ ] 1. Foundation: package dependency 入れ替え
- [x] 1.1 apps/app/package.json と pnpm-lock.yaml を direct import 構成に更新
  - `apps/app/package.json` の `dependencies` から `@opentelemetry/auto-instrumentations-node` を削除
  - `@opentelemetry/instrumentation-http` (`^0.217.0`)、`@opentelemetry/instrumentation-express` (`^0.65.0`)、`@opentelemetry/instrumentation-mongodb` (`^0.70.0`)、`@opentelemetry/instrumentation-mongoose` (`^0.63.0`) を `dependencies` に追加
  - リポジトリルートから `pnpm install` を実行し `pnpm-lock.yaml` を再生成
  - Observable: `apps/app/package.json` の `dependencies` に `auto-instrumentations-node` が無く、4 instrumentation package が存在することを `grep` / `jq` で確認できる
  - _Requirements: 5.1, 5.2_

- [ ] 2. Core: generateNodeSDKConfiguration の instrumentations 配列を direct import 構成に書き換え
- [x] 2.1 generateNodeSDKConfiguration を direct import 構成に書き換え
  - `getNodeAutoInstrumentations` の import を削除し、`HttpInstrumentation`、`ExpressInstrumentation`、`MongoDBInstrumentation`、`MongooseInstrumentation` を 4 package から直接 import
  - `ALL_AUTO_INSTRUMENTATION_PACKAGES` および `ALLOW_LIST_INSTRUMENTATION_PACKAGES` 定数を削除
  - 旧 `buildInstrumentations` helper を廃止し、`generateNodeSDKConfiguration` 内に「4 instrumentation を `new` で構築して `instrumentations` 配列に詰める」flat な inline 構成として吸収
  - HTTP instrumentation の構築時に `Option.enableAnonymization` が truthy なら `httpInstrumentationConfigForAnonymize` を constructor 第 1 引数として渡し、falsy / 未指定なら constructor を引数 `undefined` で呼ぶ
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE` を含む `OTEL_AUTO_INSTRUMENTATION_*` 系の環境変数を一切参照しない（実装内に当該キー名・分岐・warn 出力を持たない）
  - いかなる環境変数値でも例外を投げない
  - 戻り値 `Configuration` の `instrumentations` 配列は常に長さ 4
  - Observable: `generateNodeSDKConfiguration()` 呼び出し時、`vi.mock` 済の 4 constructor がそれぞれちょうど 1 回ずつ呼ばれ、戻り値の `instrumentations` 配列の長さが 4 となる
  - _Requirements: 1.1, 1.2, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4_

- [ ] 3. Core: unit test の direct import 構造への書き換え
- [x] 3.1 node-sdk-configuration.spec.ts を 4 mock 構造に置き換え
  - `vi.mock('@opentelemetry/auto-instrumentations-node', ...)` を削除
  - 4 instrumentation package を個別に `vi.mock` し、各 constructor の mock を保持して `mock.calls` を検査できるようにする
  - `generateNodeSDKConfiguration()` 呼び出しで 4 constructor がそれぞれちょうど 1 回ずつ呼ばれることを assert
  - `enableAnonymization=true` のとき `HttpInstrumentation` の constructor 第 1 引数に anonymization config の field が含まれることを `toMatchObject` 等で assert
  - `enableAnonymization=false` / 未指定のとき `HttpInstrumentation` の constructor 第 1 引数が `undefined` であることを assert
  - 本実装は `OTEL_AUTO_INSTRUMENTATION_PROFILE` 環境変数を参照しないため、当該変数に関するテストケース（unset / `minimal` / `all` / unknown 値・warn 出力検査）は spec から除去する
  - Observable: `pnpm vitest run node-sdk-configuration.spec` の出力で全テストケースが green になる
  - _Requirements: 1.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4_

- [ ] 4. Integration: build artifact と quality gates の検証
- [x] 4.1 production build と全 quality gates を実行し artifact を検証
  - リポジトリルートから `turbo run build --filter @growi/app`、`turbo run lint --filter @growi/app`、`turbo run test --filter @growi/app` をすべて green で通す
  - `ls apps/app/.next/node_modules/` から `@opentelemetry/auto-instrumentations-node` の symlink が消えていることを確認
  - 4 instrumentation package は direct named import 化により Turbopack が chunk bundle 側に取り込むため、`.next/node_modules/` 配下に symlink は生成されない。代わりに `.next/server/chunks/` 配下のいずれかの chunk に 4 instrumentation の少なくとも 1 つの package 名 / module 識別子（例: `instrumentation-http` / `instrumentation-express` / `instrumentation-mongodb` / `instrumentation-mongoose`）が `grep -r` でヒットすることを確認（bundle 形式での同梱を観測）
  - `bash apps/app/bin/check-next-symlinks.sh` が `OK: All apps/app/.next/node_modules symlinks resolve correctly.` を返し、broken symlink が 1 件もないことを確認
  - `node-sdk-configuration.spec.ts` 以外の既存テストが regression していないこと（test 件数 / pass 数が変更前と整合）
  - Observable: 3 つの `turbo` コマンドが exit 0、`auto-instrumentations-node` の symlink が `.next/node_modules/` に存在しない、4 instrumentation のいずれかが `.next/server/chunks/` 配下で grep ヒットする、`check-next-symlinks.sh` が exit 0
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.3_

- [ ] 5. Validation: RSS 削減効果と runtime トレース継続の運用観察
- [x] 5.1 memory-profiler scenario runner で before / after baseline mean RSS を計測し verification-report.md に記録
  - HEAD（本 spec 適用前のコミット）と本 spec 適用後のコミットそれぞれで、`apps/app` の memory-profiler scenario runner を「OTel ON / 5 分 idle baseline」シナリオで実行
  - 取得した RSS sample 列から baseline mean RSS を算出し、`after - before` の delta を計算
  - 計測中に GROWI のページ表示・編集・検索が機能していることを目視確認し、http / express / mongodb / mongoose のトレースおよび custom metrics 5 個（application / user-counts / page-counts / system / yjs）が OTLP exporter に流れ続けていることをログまたは collector 側で観察
  - 結果（before 平均、after 平均、delta、計測日時、commit SHA、Node.js version、シナリオ条件、トレースおよび custom metrics 継続の観察結果）を `.kiro/specs/otel-direct-import/verification-report.md` に記録
  - Observable: `verification-report.md` に baseline mean before / after / delta（MB 単位）が記載され、delta ≥ 5 MB であることが報告されている
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3_
