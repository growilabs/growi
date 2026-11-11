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

`opentelemetry-anonymization` の research.md を参照。

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

### データアーカイブ／お引越しの利用状況が見えなかった理由（発生回数メトリクスの背景）

- **Context**: 管理画面のデータアーカイブとお引越し機能（G2G 転送）について、WESEEK 側で「使っているインスタンスがあるか」「どの程度の頻度で使われているか」を把握できなかった。
- **Findings**:
  - データアーカイブの操作（`ADMIN_ARCHIVE_DATA_CREATE` / `DOWNLOAD` / `DELETE` / `UPLOAD`、`ADMIN_GROWI_DATA_IMPORTED`）は監査ログの Large グループにのみ含まれ、監査ログ自体も初期状態で無効のため、多くのインスタンスで記録されない。
  - お引越し機能には監査ログのアクションが存在しない。
  - 監査ログは各インスタンスの DB に保存されるのみで、外部集計の経路がない。
  - 既存の独自メトリクスはすべて ObservableGauge（送信時点の状態値）で、イベントの発生回数を表せない。本番のトレースは 1% サンプリングのため、トレースからも回数は読めない。
- **Implications**: 監査ログの記録有無に依存しない、イベント発生時に加算する Counter で回数を送る。受信側で「期間内に 1 回以上利用したインスタンス数」「利用インスタンスの割合」「インスタンスごとの期間あたり利用回数」を集計できることが目的。

### metrics API に Proxy がなく、SDK 登録前の Meter は Noop に固定される

- **Context**: 計測ポイントはルート／サービス構築時（`growi.start()`）に評価されるコードにあり、SDK 開始（`startOpenTelemetry()` 内の `sdkInstance.start()` → `setupCustomMetrics()`）より前に実行される。
- **Findings**:
  - `@opentelemetry/api` 1.9 の metrics API には trace API のような Proxy プロバイダーがない。`metrics.getMeter()` は呼び出し時点のグローバル MeterProvider（未登録なら Noop）から Meter を返し、後から SDK が登録されても差し替わらない。
  - Meter をモックする単体テストでは、この罠を検出できない（テストは通るが本番で何も送られない）。
- **Implications**: Counter の生成は SDK 開始後に行う。検証は実 `MeterProvider` + `InMemoryMetricExporter` と、実送信の確認で行う。

### お引越しは ExportService / ImportService を再利用している

- **Findings**:
  - 送信側の `startTransfer()` は内部で `exportService.export()` を、受信側の `importCollections()` は `importService.import()` を再利用している。
  - 送信側 `startTransfer()` は route からバックグラウンド実行され、アーカイブ生成失敗・送信失敗・受信側の部分失敗・添付ファイル転送失敗を `admin:g2gProgress` に `ERROR` として emit する。ただし、取り込みが不完全でも throw せず resolve する経路がある（添付ファイル転送は続行し、画面にのみ ERROR を通知する）。route 側で Promise の成否だけを見ると部分失敗を成功と誤計上する。
  - データアーカイブの作成（`export.js` POST `/`）は `exportService.export()` を await しておらず、非同期の失敗は `unhandledRejection` ハンドラ（ログのみ）に流れる。実行中の重複要求（`'There is an exporting process running.'`）も同期 throw ではなく async reject として届く。
  - 通常インポートの route には、受付（`res.apiv3()`）後・`executeImport()` 前に `onErrorForImport` を emit して return する経路が 3 つある。
- **Implications**: 成否の判定点は「操作の入口を知る層」に置き、送信側は取り込みの不完全さを戻り値で返す。

### お引越し受信側の応答の種類

- **Findings**: 受信側 `receiveTransferData()` は 9 種のエラー応答と 1 種の成功応答を持つ。成功応答でも `failedCollections` / `importAborted` / `postProcessFailures` 等により取り込みが不完全な場合がある。`apiv3Err` の戻り値は `any` のため、エラー時は明示的に結果を返す形にする。
- **Implications**: 受信側の判定は戻り値のみで行い、`res.statusCode` を併用しない。「取り込みが不完全」の定義は、送信側の既存判定式を `isTransferImportIncomplete()` として抽出して両側で共有する。

### 手動検証の知見

- devコンテナ内で公式の `otelcol` バイナリ（debug exporter、`localhost:4317`）を立てる方法で、有効時は各操作の件数が操作回数どおり届き、既存メトリクスに影響がなく、無効時は何も送られずアーカイブ作成にも影響しないことを確認できた。手順そのものは design.md の検証手順を参照。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Custom ObservableGauge per layer | 自前で 4 Meter / 7+ gauge を実装し、`@opentelemetry/host-metrics` を採用しない | 完全制御、cgroup / V8 対応、追加 dep ゼロ、Meter ごとに spec 単位でテスト可能 | コード量増（〜500 行） | **採用** |
| `@opentelemetry/host-metrics` 採用 | system / process メトリクスをコミュニティパッケージで自動 emit | 既製、ネットワーク・CPU も追加 | cgroup 未対応、V8 ヒープ非対応、不要メトリクス強制 emit、semconv 古い | 不採用（要件 5 未充足） |
| Single Meter, all metrics | 全 7+ メトリクスを単一 Meter で束ねる | コードが小さい | 観測スコープ（business vs system）の責務が混在、テスト分離困難 | 不採用 |
| 2-stage Resource initialization | DB 非依存 → DB 初期化後 の 2 段階で Resource を構築 | 循環依存回避、DB 接続前に SDK 部分起動可能 | `_resource` private アクセス必要 | **採用** |
| Single-stage Resource | すべての Resource を DB 初期化後に作る | private アクセス不要 | OpenTelemetry の起動が DB 接続まで遅延、`service.name` などの基本属性も遅れる | 不採用 |
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

### Decision: 匿名化は opt-in（`otel:anonymizeInBestEffort`）

- **Selected Approach**: 匿名化 hook は `otel:anonymizeInBestEffort` が true のときだけ HTTP 計測に渡す（要件 1.5）。
- **Rationale**: opt-in にすることで導入リスクを抑える。auto-instrumentation の挙動は完全には制御できないため、匿名化は best-effort の位置づけで、既定では動かさない。
- **匿名化の中身**: 規則の構成・失敗時の扱いなどは `opentelemetry-anonymization` の research.md を参照。

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

### Decision: 記録 API は SDK 開始後に生成した Counter を保持する（呼び出しのたびに getMeter しない）

- **Context**: `@opentelemetry/api` 1.9 の metrics API には Proxy がなく、SDK 登録前に取得した Meter は Noop のまま固定される。業務コードの構築は SDK 開始より前に行われる。
- **Alternatives Considered**:
  1. 記録のたびに `metrics.getMeter().createCounter()` — 同名 instrument の再生成になり、SDK 側のキャッシュ挙動に依存する。
  2. `setupCustomMetrics()` で生成してモジュール変数に保持 — 既存の `addXxxMetrics()` 構成と同じ。
- **Selected Approach**: 2。未生成のあいだの記録は何もしない。記録関数は列挙型の引数のみを受け付け、汎用の `recordEvent(name, attrs)` は作らない（自由文字列を受け付けると、個人やコンテンツを特定しない属性だけを送るという制約を型で守れなくなる）。
- **Rationale**: Noop 固定の罠を構造で避けられ、`OPENTELEMETRY_ENABLED=false` では何も送信されない既存の制御にそのまま従える。
- **Follow-up**: Noop 固定の回帰は Meter モックでは検出できないため、実 `MeterProvider` + `InMemoryMetricExporter` でテストし、devコンテナで実送信を確認する。

### Decision: Counter を 2 つに分ける（アーカイブ用とお引越し用）

- **Context**: アーカイブとお引越しを区別して数える必要がある。
- **Alternatives Considered**:
  1. 1 つの Counter に `feature` 属性を付ける — お引越しにだけ `role`、アーカイブにだけ `operation` が付き、属性の組が系列ごとに揃わない。
  2. 2 つの Counter — 各 Counter の属性が常に同じ組になる。
- **Selected Approach**: 2（`growi.archive.operations`、`growi.g2g_transfer.operations`）。
- **Rationale**: 系列ごとに属性の有無が変わると受信側のクエリが複雑になる。メトリクス名で機能が分かれていれば集計も読みやすい。
- **Trade-offs**: メトリクス名が 2 つになるが、記録モジュールは 1 ファイルで所有する。

### Decision: 受付前に拒否された要求は数えない（全操作共通）

- **Context**: お引越しの事前確認での中止は数えない。他の操作にも同様の「受付前の拒否」（バリデーション 4xx、`validateTransferKey` 等）がある。
- **Selected Approach**: 操作が受け付けられた後の成否のみを数える。アップロードだけは、受け付けたファイルの解析・検証（バージョン不一致）の失敗を失敗として数える。ファイル無し（400）は受付前の拒否として数えない。
- **Rationale**: 受付前の拒否は「利用」ではなく入力不備で、数えると成功率の解釈がぶれる。

### Decision: 計測はサービス層ではなく、操作の入口を知る層で行う

- **Context**: お引越しが `ExportService` / `ImportService` を再利用している。
- **Alternatives Considered**:
  1. 各 route / service に Counter を直接埋め込む — メトリクス名・語彙が散らばり、Noop 固定の回避も各所で必要になる。
  2. `ExportService` / `ImportService` 内で数える — お引越しがアーカイブとしても計上される。
  3. 記録 API は custom-metrics に 1 か所、呼び出しは route / `executeImport()` の呼び出し元 / `startTransfer()` の呼び出し元に限定（採用）。
- **Selected Approach**: 3。送信側の部分失敗は `startTransfer()` の戻り値で route に伝える。
- **Rationale**: サービス層で数えるとアーカイブの回数にお引越しが二重計上される。共通サービスに計測の関心事を持ち込まない。
- **Trade-offs**: 計測ポイントが 6 か所に分散するため、結合テストで G2G 転送がアーカイブとして数えられないこと・各箇所 1 回だけ呼ばれることを確認する。業務コードから `features/opentelemetry` への依存が生じるため、`~/features/opentelemetry/server` の barrel 経由のみに限定する。

### Decision: 失敗は失敗として数え、部分失敗も失敗に含める

- **Context**: 失敗の後にはやり直しが続くことが多く、失敗を数えると回数が水増しされるのではという懸念があった。
- **Selected Approach**: 試行 1 回 = 1 カウントとし、結果（成功／失敗）を属性で区別する。一部のデータを取り込めずに終了した部分失敗は 3 値目を設けず失敗に含め、やり直しは独立した 1 回として数える。
- **Rationale**:
  - 結果ラベル付きカウンターは OTel／Prometheus の一般的な形で、受信側で目的別に絞り込める（有無・割合は全試行、利用頻度は成功のみ、安定性は失敗率）。
  - 失敗を捨てると「使おうとして諦めた」インスタンスが見えなくなり、「利用者がいるか」という目的を損なう。
  - 部分失敗は管理画面でエラーと表示される状態であり、通常インポート（`executeImport`）と送信側転送（`startTransfer`）は既に失敗として扱っている。判定をそれと揃えることで、利用者が見た結果と計測が一致する。
- **却下した案**: 失敗を数えない／「部分失敗」の 3 値目を設ける（目的に対して過剰）。
- **Follow-up**: 判定は `executeImport()` の戻り値（通常インポート）と `server/service/g2g-transfer.ts` の `isTransferImportIncomplete()`（お引越しの送信側・受信側）にある。ダウンロードは成否を区別せず `getFile()` 成功時点（`admin.js` の `actions.export.download`）のみ記録する。

### Decision: 添付ファイルのみ失敗した転送は送信側=失敗・受信側=成功とする

- **Context**: データの取り込みは完了したが、その後の添付ファイル転送だけが失敗した場合、両側で結果が分かれる。
- **Selected Approach**: 送信側は `failure`、受信側は `success` として記録する。各側は、自分の管理画面に表示される結果をそのまま記録する。
- **Rationale**:
  - 送信側の管理画面には、添付ファイル転送の失敗がエラーとして表示される。
  - 受信側では取り込み自体が完了しており、受信側が自分で判定する結果は成功である。
  - 各側の計測を管理画面の表示と一致させることで、利用者が見た結果と計測がずれない。両側を無理に揃える案は、どちらかの画面の表示と食い違う。
- **Trade-offs**: 同一の転送でも送信側と受信側の成功率は一致しないことがある。受信側のクエリでは、これを前提に解釈する。

### Decision: インポートの記録は route の 1 か所に集約し、`executeImport()` は結果を返すだけにする

- **Context**: インポート 1 回分の記録が、`import.ts`（`executeImport()` 前の失敗 3 経路）と `import-executor.ts`（成功・部分失敗・例外）の 2 ファイルに分散しうる。
- **Selected Approach**: `executeImport()` の戻り値を `Promise<OperationResult>` にし、`import.ts` の受付後バックグラウンド処理で結果変数（初期値 `'failure'`）を持ち、`finally` で 1 回だけ記録する。`import-executor.ts` は型 `OperationResult` のみを参照する。
- **Rationale**: 失敗経路が追加されても数え漏れ・二重計上が起きにくく、1 回の操作を 1 回だけ数えることをコードの構造で保証できる。お引越し送信側（route が `startTransfer()` の戻り値を見て記録）と同じ形になる。`executeImport()` のテストは記録関数のモックではなく戻り値で検証できる。

### Decision: ページの一括エクスポート・受信側の設定・過去分の遡及は対象外とする

- **Selected Approach**: 対象は管理画面のデータアーカイブ（作成・ダウンロード・アップロード・インポート）とお引越し（送信側・受信側）に限る。
- **Rationale**:
  - ページの一括エクスポートは、監査ログの Essential グループで常時記録済みのため、新たに数える必要がない。
  - 受信側（コレクター・ダッシュボード）の設定は送信側の責務の外にある。新しいメトリクス名と属性は担当者に共有する（既存の Revalidation Trigger「受信側ダッシュボード／クエリの参照更新」に該当）。累積値のリセット判定は、OTLP 既定の累積値（start time 付き）で受信側が判別できる。
  - リリース以前の利用実績は記録が存在しないため遡及しない。

## Risks & Mitigations

- **下流ダッシュボードの参照切れ**: 既存 Resource Attribute / Metric を将来変更した場合、receiving side のクエリが値を返さなくなる。**Mitigation**: PR 説明とリリースノートに「Removed → Replaced by」の対応表を記載する慣習を維持する。
- **`process.constrainedMemory()` のプラットフォーム依存**: Linux cgroup v1/v2 のみサポートで、macOS/Windows では常に 0 を返す。**Mitigation**: 0 のときは `system.memory.limit` を観測しない挙動が、そのまま非対応プラットフォームの振る舞いと一致するため追加対策不要。
- **新規メトリクスのカーディナリティ**: 観測値メトリクスは label を持たない gauge であり、追加カーディナリティ寄与はインスタンス分のみ。**Mitigation**: 設計上、観測値メトリクスには attribute を付与しないことを徹底（identity は Resource、設定値は `growi.configs` ラベル経由）。
- **NodeSDK private アクセスの破綻**: `_resource` プロパティが SDK メジャー更新で消滅する可能性。**Mitigation**: Revalidation Trigger として SDK バージョンアップ時にチェック。public API が出たら即座に切り替え。
- **Anonymization の網羅性不足**: `opentelemetry-anonymization` の research.md を参照。
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
