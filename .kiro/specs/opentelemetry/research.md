# Research & Design Decisions — opentelemetry

## Summary

- **Feature**: `opentelemetry`（`apps/app/src/features/opentelemetry/` の大局的メンテナンス spec）。
- **Discovery Scope**: Extension／Refactor — 既存実装を保ったまま、4 レイヤの責務境界を明文化する。

## Research Log

### 既存 ObservableGauge 実装パターン

- **Context**: 新規 Custom Metric を追加するときに既存パターンと整合させる必要がある。
- **Sources Consulted**:
  - `custom-metrics/application-metrics.ts`, `user-counts-metrics.ts`, `page-counts-metrics.ts`, `system-metrics.ts`。
- **Findings**:
  - 各モジュールは `addXxxMetrics(): void` を export する。
  - `metrics.getMeter('growi-<scope>-metrics', '1.0.0')` で Meter を取得し、`meter.createObservableGauge(name, { description, unit })` で gauge を作る。
  - 観測は `meter.addBatchObservableCallback(async (result) => { try { ... } catch (e) { loggerDiag.error(...) } }, [gauge, ...])` で登録。
  - ロガー初期化: `loggerFactory('growi:opentelemetry:custom-metrics:<scope>')`（pino）と `diag.createComponentLogger({ namespace: 'growi:custom-metrics:<scope>' })`（OTel diag）の 2 つ。
- **Implications**: 拡張テンプレートとしてこのパターンを design.md に記載済み（File Structure Plan の "Extension Templates"）。

### Anonymization Handler の登録順とパターン

- **Context**: 新規 anonymization handler を追加するとき、`canHandle` の衝突を避ける必要がある。
- **Sources Consulted**: `anonymization/handlers/index.ts`、各 handler の `canHandle` 実装。
- **Findings**:
  - 配列順 = 評価順だが、すべてが OR で集約される（複数 module が同一 URL を匿名化することは現状無いが、可能性としては存在する）。
  - より具体的なパス（API 系）を先、汎用パス（page access）を最後に配置するのが現状の慣習。
  - `canHandle` は副作用無しで判定のみ、`handle` は失敗時に `null` を返すか元の URL を維持する。
- **Implications**: 新規 handler 追加時は、既存 4 handler の対象 URL と衝突しないかを `canHandle` ロジックで確認する。

### `process.constrainedMemory()` の挙動

- **Context**: コンテナ環境とそれ以外で挙動が異なるため、`system.memory.limit` の skip 条件を確定する必要がある。
- **Sources Consulted**: Node.js v20.12 / v24 公式ドキュメント。
- **Findings**:
  - 戻り値: cgroup v1 / v2 から取得した「プロセスに割り当てられたメモリ上限のバイト数」。
  - cgroup が未設定 / detection 失敗時 / macOS・Windows では `0` を返す（v24 でも継続）。
  - Node.js v19.6 で導入、v20.12 で stable。
- **Implications**: `value > 0`（falsy）で判定すれば、macOS・Windows・cgroup なし Linux すべてで一貫した「skip」挙動になる。

### NodeSDK `_resource` への private アクセス

- **Context**: 2 段階目の Resource を NodeSDK に注入する必要があり、public API が見当たらない。
- **Sources Consulted**: `@opentelemetry/sdk-node` の TypeScript 型定義、`node-sdk-resource.ts`。
- **Findings**:
  - NodeSDK は constructor で受け取った resource を内部に保持するが、外部から書き換える public API は存在しない（`sdk-node 0.217.0` 時点）。
  - `_resource` プロパティを直接書き換えることで、`start()` 前に Resource を差し替えられる。
- **Implications**: `(sdk as any)._resource` への reflective アクセスを `getResource` / `setResource` で隔離。SDK のメジャー更新時に public API が出ていないか Revalidation Trigger として確認する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Custom ObservableGauge per layer | 自前で 4 Meter / 7+ gauge を実装し、`@opentelemetry/host-metrics` を採用しない | 完全制御、cgroup / V8 対応、追加 dep ゼロ、Meter ごとに spec 単位でテスト可能 | コード量増（〜500 行） | **採用** |
| `@opentelemetry/host-metrics` 採用 | system / process メトリクスをコミュニティパッケージで自動 emit | 既製、ネットワーク・CPU も追加 | cgroup 未対応、V8 ヒープ非対応、不要メトリクス強制 emit、semconv 古い | 不採用（要件 5 未充足） |
| Single Meter, all metrics | 全 7+ メトリクスを単一 Meter で束ねる | コードが小さい | 観測スコープ（business vs system）の責務が混在、テスト分離困難 | 不採用 |
| 2-stage Resource initialization | DB 非依存 → DB 初期化後 の 2 段階で Resource を構築 | 循環依存回避、DB 接続前に SDK 部分起動可能 | `_resource` private アクセス必要 | **採用** |
| Single-stage Resource | すべての Resource を DB 初期化後に作る | private アクセス不要 | OpenTelemetry の起動が DB 接続まで遅延、`service.name` などの基本属性も遅れる | 不採用 |
| Module-based anonymization | `AnonymizationModule` interface + 配列順評価 | 新規パス追加が局所変更で済む、handler ごとに spec | 配列順への暗黙依存 | **採用** |
| Centralized anonymization (switch / regex map) | 1 ファイルで if/else または map で振り分け | フローが見やすい | 拡張ごとに 1 ファイルが肥大化、spec が結合 | 不採用 |
| 4 instrumentation の direct import | `HttpInstrumentation` 等 4 class を `new` で構築し配列に詰める | actual usage と依存表面が一致、RSS が真に削減される（isolated benchmark で −11 MB）、`OTEL_AUTO_INSTRUMENTATION_*` 系の制御変数 / 分岐が不要 | 新 instrumentation 追加時にコード変更（1 import + 1 `new` 行）が必要 | **採用** |
| `@opentelemetry/auto-instrumentations-node` の deny-list | `getNodeAutoInstrumentations({ pino: false, fs: false, ... })` で不要 instrumentation を無効化 | 設定が宣言的、追加 instrumentation のオプトインが容易 | `enabled: false` でも 31 instrumentation 全件が instantiate される仕様で、約 11 MB の RSS オーバーヘッドが発生（`memory-leak-investigation` L2 finding で実証） | 不採用 |

## Design Decisions

### Decision: 4 レイヤの責務分離（identity / 設定 / 観測 / anonymization）

- **Context**: Resource Attribute / Metric / Span Attribute それぞれの本来の用途を運用ガイドラインとして固定したい。
- **Selected Approach**: 以下の 4 分類で責務を分離する。
  - **identity**（不変または起動時固定） → Resource Attribute
  - **設定値**（インスタンス設定の確認用、ラベル次元として参照する） → `growi.configs` info gauge ラベル
  - **観測値**（時間と共に変化するスカラー） → `growi.*` / `system.*` / `process.*` ObservableGauge
  - **span attribute**（リクエスト単位の情報、必要なら匿名化） → `http.target` 等 incubating semconv
- **Rationale**: OpenTelemetry の data model（Resource / Metric / Span）に対する公式の意味論に沿う。Resource に measurement や設定値を載せると receiving side でカーディナリティ爆発・誤った集計の原因になる（特に Resource に乗ったホストメモリ量はコンテナ環境で「ホストの値」を返してしまい運用上の判断を誤らせる典型例）。
- **Trade-offs**: 設計時の判断分岐が増えるが、ダッシュボード保守の堅牢性が大きく上がる。

### Decision: `system.memory.limit` と `system.host.memory.total` を別メトリクスに分離

- **Context**: コンテナ環境で「コンテナの上限」と「ホストの物理メモリ」のどちらを参照したいかは運用観点が異なる。
- **Alternatives Considered**:
  1. 単一メトリクス `system.memory.limit` を cgroup → fallback で `os.totalmem` にする。
  2. `system.memory.limit` と `system.host.memory.total` を別メトリクスにする。
- **Selected Approach**: 2。`system.memory.limit` は cgroup limit が取れたときのみ観測、`system.host.memory.total` は常に観測。
- **Rationale**: 「コンテナ上限の有無」自体が運用上の情報。fallback されると bare-metal でも cgroup でも同じシリーズに混在し、ダッシュボードで見分けが付かない。
- **Trade-offs**: 出力メトリクス数が 1 つ増えるが、運用観点での明瞭さが勝る。
- **Follow-up**: ダッシュボード移行時の運用者向け説明に「cgroup limit 未設定では `system.memory.limit` が emit されない」を明記する。

### Decision: サブシステム設定値（`attachment.type` 等）は `growi.configs` のラベルへ統合

- **Context**: GROWI インスタンスの設定値（`wiki_type`, `external_auth_types`, `attachment_type` 等）を Resource Attribute に載せるか、専用 info-gauge のラベルに載せるかという選択。
- **Alternatives Considered**:
  1. Resource Attribute として emit する。
  2. `growi.configs` ObservableGauge（値は常に 1）のラベルへ統合（Prometheus info パターン）。
  3. 設定値ごとに独立した info gauge を新設する。
- **Selected Approach**: 2。snake_case 統一の単一 info-gauge のラベル群として集約する。
- **Rationale**: identity（Resource）と設定値を分離することで Resource を「テレメトリ発生元の不変識別子」として清潔に保てる。複数の設定値を 1 つの info-gauge に集約することで「インスタンス設定を 1 か所で見られる」運用が成立する。
- **Trade-offs**: `growi.configs` のラベル数は機能追加と共に増える。各値が固定 enum 由来のためカーディナリティ影響は限定的。
- **Follow-up**: 値の取得不能時は空文字 `''` フォールバックで統一する（`undefined` ラベル attribute が emit されないことを利用しない）。

### Decision: `growi.deployment.type` は OTel 標準 `deployment.environment.name` に寄せない

- **Context**: OTel 標準には `deployment.environment.name`（"production"/"staging" 等）があるが、GROWI の `growi.deployment.type`（"docker"/"k8s"/"growi-docker-compose" 等）はランタイム形態を表し、環境分類とは別概念。
- **Selected Approach**: `growi.deployment.type` のまま据え置く（Resource Attribute）。
- **Rationale**: 値の意味が semconv 標準と乖離するため、無理に標準名を当てると誤解を招く。
- **Follow-up**: 将来的に「環境（prod/stg）」の表現が必要になった時点で、別途 `deployment.environment.name` を追加導入する。

### Decision: 単一 Meter `growi-system-metrics` で system / process / V8 を束ねる

- **Context**: 既存パターンでは目的別に Meter を分けている（application / user-counts / page-counts）。System / Process / V8 のメトリクス群も同様に分けるか統合するかの判断が必要。
- **Selected Approach**: System / Process / V8 を `growi-system-metrics` 単一 Meter で束ねる。
- **Rationale**: いずれも「ランタイム / ホストのリソース観測」という単一目的で、`system.*`/`process.*` の prefix で十分名前空間が分離できる。Meter を分けると `addBatchObservableCallback` の呼び出しと spec も二重になり管理コスト増。
- **Trade-offs**: 将来「process 系のみオフにする」のような細かい制御が困難になるが、現時点で必要性なし。

### Decision: Anonymization は best-effort, module-based, opt-in

- **Context**: 個人情報（検索クエリ・ページパス・ユーザー名）が `http.target` 経由でトレースに残るリスクを下げたいが、auto-instrumentation の挙動を完全に制御することはできない。
- **Selected Approach**:
  1. `otel:anonymizeInBestEffort` が `true` のときのみ `startIncomingSpanHook` を注入。
  2. handler は `AnonymizationModule` interface に従い、`canHandle` で対象選別 / `handle` で attribute を返す。
  3. 4 つの handler を配列順で評価し、複数 module がマッチしたら `Object.assign` でマージ。
- **Rationale**: opt-in にすることで導入リスクを抑え、module 化により拡張時の差分が局所化される。
- **Trade-offs**: 配列順への暗黙依存があり、追加時に既存 handler との衝突確認が必要。

### Decision: SemConv の不安定 attribute は `semconv.ts` にコピー

- **Context**: `@opentelemetry/semantic-conventions/incubating` は minor リリースで破壊的変更を含む可能性があるとアナウンスされている。
- **Selected Approach**: `service.instance.id`, `http.target` をローカル定数として保持し、ランタイムコードからは local file のみを import する。
- **Rationale**: OpenTelemetry の[公式推奨](https://opentelemetry.io/docs/specs/semconv/non-normative/code-generation/#stability-and-versioning)に沿う。
- **Follow-up**: 該当 attribute が stable promotion されたら、stable import に切り替えて local 定数を撤去（Revalidation Trigger）。

### Decision: Metric export interval は 5 分

- **Context**: メトリクス export 頻度は OTLP 帯域と receiving side の負荷、観測解像度のトレードオフ。
- **Selected Approach**: `PeriodicExportingMetricReader` の `exportIntervalMillis` を 300000（5 分）に設定。
- **Rationale**: GROWI のメトリクスは business カウント（users / pages）と config 情報が中心で、秒オーダーの解像度は不要。export 頻度を下げることで OTLP 帯域と receiving side の負荷を抑える。
- **Trade-offs**: メモリ使用量の急変は最大 5 分遅れて観測される。OOM 直前検知などの用途には不十分だが、本 spec の範囲ではトレードオフを受容する。

### Decision: 4 instrumentation の direct import 採用（`@opentelemetry/auto-instrumentations-node` は不採用）

- **Context**: GROWI が必要とする instrumentation は HTTP / Express / MongoDB / Mongoose の 4 個のみ。当初は `@opentelemetry/auto-instrumentations-node` の `getNodeAutoInstrumentations({ pino: { enabled: false }, fs: { enabled: false }, ... })` で deny-list 方式（minimal profile）を採用していたが、`memory-leak-investigation` spec の L2 finding と isolated benchmark（`apps/app/tmp/otel-import-bench/bench.js`）により、`enabled: false` を渡しても 31 instrumentation 全件が instantiate される `getNodeAutoInstrumentations` の仕様が判明し、RSS に約 11 MB のオーバーヘッドが乗ることが実証された。
- **Alternatives Considered**:
  1. Deny-list 継続（`getNodeAutoInstrumentations` + `enabled: false`）— RSS 削減効果ゼロのため却下。
  2. **4 instrumentation の direct import（採用）** — `HttpInstrumentation` / `ExpressInstrumentation` / `MongoDBInstrumentation` / `MongooseInstrumentation` を direct named import で構築し `instrumentations` 配列に渡す。
  3. Registry pattern（map で instrumentation を動的に解決）— speculative abstraction で現要件外。却下（YAGNI）。
- **Selected Approach**: `generateNodeSDKConfiguration` 内で 4 instrumentation を直接 `new` し、`instrumentations` 配列に inline で組み立てる。専用の helper / registry / DI は導入しない。HTTP instrumentation には `enableAnonymization` が truthy のときのみ `httpInstrumentationConfigForAnonymize` を constructor 引数として渡す。
- **Rationale**:
  - isolated benchmark で `auto-deny` strategy（旧 GROWI minimal）と比べ約 −11 MB の RSS 削減を実測（`sdk-only` と同等の 82 MB 台）。
  - 依存表面（`apps/app/package.json` の `dependencies`）が actual usage と一致し、supply chain audit が明瞭になる。
  - pino / fs を含む 27 個の不要 instrumentation の常駐コストを排除できる。
  - `OTEL_AUTO_INSTRUMENTATION_PROFILE` 環境変数による分岐 / deny-list 構築 / 31 entry の package 名 list を保持する必要が無くなり、実装が単純化される。
- **Trade-offs**: 新規 instrumentation を追加するときに `generateNodeSDKConfiguration` のコード変更（1 つの import 行 + 1 行の `new ...()`）が必要だが、4 → 5 への変化は単純な追記で済むため、registry 化のコスト > 利得。
- **Follow-up**: 新規 instrumentation 追加時は `generateNodeSDKConfiguration` の `instrumentations` 配列に direct import を追加する。`@opentelemetry/auto-instrumentations-node` の transitive dep 残存監視は本 spec の boundary 外（`.claude/rules/package-dependencies.md` の責務）。`OTEL_AUTO_INSTRUMENTATION_PROFILE` の参照ロジックは実装から完全に削除済みであり、当該環境変数を deployment 環境で設定していても runtime 挙動には影響しない（無視される）。

### Decision: `service.instance.id` は config 値の passthrough、自動生成しない

- **Context**: OTel SDK には `service.instance.id` を UUID 等で自動生成する resource detector があるが、GROWI ではどう扱うか。
- **Selected Approach**: `otel:serviceInstanceId`（env: `OPENTELEMETRY_SERVICE_INSTANCE_ID`）を優先、フォールバックで `app:serviceInstanceId`（DB 由来）を使用。両方 undefined の場合は emit しない。
- **Rationale**: 自動生成すると再起動ごとに ID が変わり「同じ GROWI インスタンス」の経時観測が困難になる。明示的に与えられた ID のみを passthrough することで、運用者がレプリカの境界を制御できる。
- **Trade-offs**: ID 未指定時に emit されないため、レプリカ識別が必要なクエリは値の有無を考慮する必要がある。

## Risks & Mitigations

- **下流ダッシュボードの参照切れ**: 既存 Resource Attribute / Metric を将来変更した場合、receiving side のクエリが値を返さなくなる。**Mitigation**: PR 説明とリリースノートに「Removed → Replaced by」の対応表を記載する慣習を維持する。
- **`process.constrainedMemory()` のプラットフォーム依存**: Linux cgroup v1/v2 のみサポートで、macOS/Windows では常に 0 を返す。**Mitigation**: 0 のときは `system.memory.limit` を観測しない挙動が、そのまま非対応プラットフォームの振る舞いと一致するため追加対策不要。
- **新規メトリクスのカーディナリティ**: 観測値メトリクスは label を持たない gauge であり、追加カーディナリティ寄与はインスタンス分のみ。**Mitigation**: 設計上、観測値メトリクスには attribute を付与しないことを徹底（identity は Resource、設定値は `growi.configs` ラベル経由）。
- **NodeSDK private アクセスの破綻**: `_resource` プロパティが SDK メジャー更新で消滅する可能性。**Mitigation**: Revalidation Trigger として SDK バージョンアップ時にチェック。public API が出たら即座に切り替え。
- **Anonymization の網羅性不足**: 新規 API パスが追加されたとき、対応する handler を忘れると平文の URL が span に残る。**Mitigation**: 新規 API 追加時のレビューで `anonymization/handlers/` の更新有無を確認する文化を維持。`handlers/index.ts` の `anonymizationModules` 配列が単一の真実ソース。
- **SemConv 不安定 attribute の stable promotion 漏れ**: `service.instance.id` / `http.target` が stable 化されているのに local 定数を放置すると、最新 OTLP 受信側との互換性が崩れる可能性。**Mitigation**: `@opentelemetry/semantic-conventions` メジャー / minor 更新時に Revalidation Trigger で見直す。

## References

- [OpenTelemetry Node.js SDK](https://open-telemetry.github.io/opentelemetry-js/)
- [Custom Metrics Documentation](https://opentelemetry.io/docs/instrumentation/js/manual/#creating-metrics)
- [HTTP Instrumentation Configuration](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-instrumentation-http#configuration)
- [Semantic Conventions for System Metrics](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/system/system-metrics.md)
- [Semantic Conventions for Process](https://opentelemetry.io/docs/specs/semconv/runtime-environment/process/)
- [Resource Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/resource/README.md)
- [SemConv Stability and Versioning](https://opentelemetry.io/docs/specs/semconv/non-normative/code-generation/#stability-and-versioning) — incubating attribute のローカルコピー推奨。
- [Node.js process.constrainedMemory()](https://nodejs.org/api/process.html#processconstrainedmemory) — cgroup ベースのメモリ上限取得 API。
- [Node.js v8.getHeapStatistics()](https://nodejs.org/api/v8.html#v8getheapstatistics) — V8 ヒープ統計取得 API。
- [OpenTelemetry — disabling instrumentations](https://opentelemetry.io/docs/languages/js/libraries/#registration) — fs instrumentation の無効化推奨。
- 既存実装: `apps/app/src/features/opentelemetry/server/custom-metrics/application-metrics.ts` — ObservableGauge + addBatchObservableCallback のリファレンス実装。
