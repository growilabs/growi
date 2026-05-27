# Requirements Document

## Introduction

GROWI の OpenTelemetry 統合 (`apps/app/src/features/opentelemetry/`) を **メンテナンスするための大局的な仕様**。SDK ライフサイクル、Resource Attribute、Custom Metric、HTTP Anonymization の 4 レイヤがそれぞれ「何を担い、何を担わないか」を明文化し、新規メトリクスや anonymization handler の追加、SDK のバージョンアップ、設定キーの追加・改名といった将来のメンテナンス時に、本 spec を 1 か所の参照点として運用できる状態を目標とする。

本 spec は新規実装 spec ではなく、既に実装・稼働している `features/opentelemetry/` の **現状の責務境界をスナップショットとして固定化する** 性格を持つ。個別機能の追加・変更は原則として本 spec の Boundary Commitments の範囲内で行われ、境界をまたぐ変更が必要なときは Revalidation Triggers として再評価される。

## Boundary Context

- **In scope**:
  - NodeSDK の起動・有効化制御・Resource 2 段階初期化 (`node-sdk.ts`, `node-sdk-configuration.ts`, `node-sdk-resource.ts`)。
  - Diag Logger の pino アダプタ (`logger.ts`)。
  - SemConv の不安定 attribute のローカルコピー (`semconv.ts`)。
  - identity 専用の Resource Attribute 供給 (`custom-resource-attributes/`)。
  - Custom Metric の emit と合成 (`custom-metrics/`、合計 4 モジュール: application / user-counts / page-counts / system)。
  - HTTP リクエストの best-effort anonymization (`anonymization/`、4 個の handler + utility)。
  - `otel:*` 設定キー 4 種の利用ポリシー。
- **Out of scope**:
  - `growiInfoService` / `configManager` / `loggerFactory` などの上流サービスの設計や API 変更。
  - 既存メトリクス（`growi.users.total` / `growi.users.active` / `growi.pages.total` / `growi.configs` / `system.*` / `process.*`）の名称変更や再構成。
  - OpenTelemetry のログシグナル統合（log signal は現状未使用）。
  - クライアント側（ブラウザ）からの telemetry 出力。
  - Trace span への独自 attribute 追加（`http.target` 以外）。
  - OTLP Exporter の wire 仕様や受信側ツールチェイン。
- **Adjacent expectations**:
  - 上流: `growiInfoService.getGrowiInfo({ includeAttachmentInfo, includeUserCountInfo, includePageCountInfo })` の API シグネチャ・返り値型が維持されることに依存する。破壊的変更があった場合は Revalidation Triggers として `custom-metrics/` および `custom-resource-attributes/application-resource-attributes.ts` を再評価する。
  - 上流: `configManager.getConfig('otel:*')` の 4 キーが現状の意味で参照可能であることに依存する。
  - 下流: OpenTelemetry Collector およびその先のダッシュボード／アラート群が本 spec の Metric Schema / Resource Attribute 表に整合した参照クエリを保持していること。変更時は PR 説明にて運用者へ通知する。

## Requirements

### Requirement 1: SDK ライフサイクルと有効化制御

**Objective:** GROWI 運用者として、OpenTelemetry SDK を環境変数 1 つで有効／無効を切り替えられ、無効時にはランタイムオーバーヘッドや誤った OTLP 接続試行が発生しないことを保証したい。

#### Acceptance Criteria

1. The GROWI server shall `otel:enabled` 設定が `false` のとき、NodeSDK インスタンスを生成せず Resource Attribute 取得や Custom Metric の登録も行わない。
2. The GROWI server shall `otel:enabled` 設定値と `OTEL_SDK_DISABLED` 環境変数の値が矛盾している場合、`OTEL_SDK_DISABLED` を上書きして整合性を取り、その旨を warn ログとして出力する。
3. The GROWI server shall NodeSDK 初期化を「SDK 構築・Resource 静的部分のセット」「DB 初期化後の Resource 追加注入」「`start()` 呼び出しと Custom Metric 登録」の 3 段階で行う。各段階は `otel:enabled` を再確認した上で実行する。
4. The GROWI server shall 同一プロセス内で `initInstrumentation()` を二重に呼ばれても、SDK インスタンスを重複生成しない（再初期化は警告を出してスキップする）。

### Requirement 2: identity 専用 Resource Attribute

**Objective:** 受信側インフラ管理者として、GROWI が emit する Resource Attribute がテレメトリ発生元エンティティの identity 情報のみであり、測定値や設定値が紛れ込まないことを保証したい。

#### Acceptance Criteria

1. The GROWI server shall Resource Attribute として以下のみを emit する: `service.name`, `service.version`, `service.instance.id`（取得できた場合）, `os.type`, `os.platform`, `os.arch`, `growi.service.type`, `growi.deployment.type`。
2. The GROWI server shall 測定値（メモリ使用量・カウント等）および GROWI のサブシステム設定値（attachment / auth provider 種別等）を Resource Attribute として emit しない。
3. The GROWI server shall Resource Attribute の取得を 2 段階に分け、1 段階目は DB 非依存（service.name / version / OS info）、2 段階目は DB 初期化後（`service.instance.id` / `growi.service.type` / `growi.deployment.type`）に行う。
4. If Resource Attribute 取得処理で例外が発生した場合, the GROWI server shall 当該段階の Resource Attribute を空オブジェクトで返し、SDK 起動自体は継続する。

### Requirement 3: GROWI 設定情報の info-gauge ラベル統合

**Objective:** 運用者として、GROWI インスタンスの設定情報（site URL、wiki type、外部認証種別、添付ストレージ種別）を 1 つの info-gauge メトリクスから一覧できることを保証したい。

#### Acceptance Criteria

1. The GROWI server shall `growi.configs` という ObservableGauge を Prometheus info パターン（値は常に 1、情報はラベルに格納）で emit する。
2. The GROWI server shall `growi.configs` に以下のラベルを付与する: `site_url`, `site_url_hashed`, `wiki_type`, `external_auth_types`, `attachment_type`。
3. If `otel:isAppSiteUrlHashed` が `true`, the GROWI server shall `site_url` を `[hashed]` リテラルにし、`site_url_hashed` に SHA-256 ハッシュ値を入れる。`false` のときは `site_url` に生 URL を入れ `site_url_hashed` は `undefined`（emit されない）。
4. If `external_auth_types` / `attachment_type` の値が `growiInfoService` から取得できない場合, the GROWI server shall 当該ラベルを空文字 `''` でフォールバックする。
5. The GROWI server shall ラベル名を snake_case で統一する。

### Requirement 4: 業務カウントメトリクス

**Objective:** 運用者として、GROWI 上の主要エンティティ（ユーザー、ページ）の総数とアクティビティ指標を継続的に観測したい。

#### Acceptance Criteria

1. The GROWI server shall `growi.users.total` メトリクスを総ユーザー数で観測する（単位 `users`）。
2. The GROWI server shall `growi.users.active` メトリクスをアクティブユーザー数で観測する（単位 `users`）。
3. The GROWI server shall `growi.pages.total` メトリクスを総ページ数で観測する（単位 `pages`）。
4. If `growiInfoService` からのカウント値取得が失敗した場合, the GROWI server shall 0 で観測するか、当該収集サイクルでの観測をスキップし、`diag` ロガーに error を記録する。

### Requirement 5: コンテナ運用に対応したメモリ系メトリクス

**Objective:** コンテナ環境（Docker / Kubernetes）で GROWI を運用する管理者として、「コンテナに割り当てられたメモリ上限（cgroup limit）」「ホスト物理メモリ総量」「プロセス RSS」「V8 ヒープの使用／確保／外部メモリ」を別々のメトリクスとして観測できることを保証したい。

#### Acceptance Criteria

1. The GROWI server shall `system.memory.limit` を `process.constrainedMemory()` の戻り値（>0 のとき）で観測する。値が `0` または falsy のときは当該メトリクスのみ観測をスキップする。
2. The GROWI server shall `system.host.memory.total` を `os.totalmem()` の戻り値で常に観測する。
3. The GROWI server shall `process.memory.usage` を `process.memoryUsage().rss` で観測する。
4. The GROWI server shall `process.runtime.v8.heap.used` / `process.runtime.v8.heap.total` / `process.runtime.v8.heap.external` を `v8.getHeapStatistics()` および `process.memoryUsage().external` から観測する。
5. The GROWI server shall 上記すべてのメトリクスを単位 `By`（bytes）で emit する。

### Requirement 6: HTTP リクエストの best-effort anonymization

**Objective:** プライバシ保護担当者として、`otel:anonymizeInBestEffort` が `true` のとき、ユーザーが入力した検索キーワード・ページパス・ユーザー名がトレース span の `http.target` に平文で残らないことを保証したい。

#### Acceptance Criteria

1. The GROWI server shall `otel:anonymizeInBestEffort` が `true` のとき、HTTP instrumentation の `startIncomingSpanHook` で `anonymizationModules` を順次評価し、`canHandle(url)` が `true` を返した module の `handle()` 結果を span attribute としてマージする。
2. The GROWI server shall 検索 API (`/_api/search`, `/_search`) の `q` クエリパラメータを `[ANONYMIZED]` に置換する。
3. The GROWI server shall page-listing API (`/_api/v3/page-listing/{ancestors-children,children,item}`) および page API (`/_api/v3/pages/list`, `/_api/v3/pages/subordinated-list`, `/_api/v3/page/check-page-existence`, `/_api/v3/page/get-page-paths-with-descendant-count`) の `path` / `paths` パラメータを匿名化する。
4. The GROWI server shall ページアクセス（非 API、permalink でない、創出可能なページパス）に対し、ユーザー名およびページパスを SHA-256 prefix（16 文字）でハッシュし `[USERNAME_HASHED:...]` / `[HASHED:...]` プレースホルダで置換する。permalink（ObjectId）と users top page（`/user`）はそのまま残す。
5. If `otel:anonymizeInBestEffort` が `false`, the GROWI server shall `startIncomingSpanHook` を渡さず、HTTP instrumentation の標準動作のみを行う。

### Requirement 7: Diag Logger と pino の統合

**Objective:** 開発者として、OpenTelemetry 内部の `diag` ログが GROWI の通常のアプリケーションログ（pino）と同一フォーマット・同一出力先で観測できることを保証したい。

#### Acceptance Criteria

1. When `NODE_ENV === 'development'` かつ `otel:enabled` が `true`, the GROWI server shall `DiagLogger` を pino logger にアダプトする実装 (`DiagLoggerPinoAdapter`) をグローバルに登録する。
2. The GROWI server shall `diag.error/warn/info/debug/verbose` で受け取ったメッセージが JSON 文字列の場合に parse して構造化 data に変換し、pino の引数規約（data 第 1 引数・message 第 2 引数）に整合する形で渡す。
3. The GROWI server shall production 環境では `initLogger()` を呼ばない（OpenTelemetry の `diag` 既定動作に委ねる）。

### Requirement 8: メトリクスエクスポートと SDK 設定

**Objective:** 運用者として、OTLP メトリクス／トレースエクスポートが OpenTelemetry SDK 標準の環境変数（`OTEL_EXPORTER_OTLP_ENDPOINT` 等）で制御でき、内部で勝手な default endpoint が固定されないことを保証したい。

#### Acceptance Criteria

1. The GROWI server shall `OTLPTraceExporter` および `OTLPMetricExporter` をコンストラクタ引数なしで生成し、エンドポイントなど exporter 設定は OpenTelemetry SDK 標準の環境変数で解決させる。
2. The GROWI server shall `PeriodicExportingMetricReader` の `exportIntervalMillis` を 300000（5 分）で初期化する。
3. The GROWI server shall auto-instrumentation のうち `@opentelemetry/instrumentation-pino` および `@opentelemetry/instrumentation-fs` を明示的に無効化する（pino: log signal を使用しないため、fs: トレース量が膨大すぎるため）。

### Requirement 9: SemConv の不安定 attribute のローカルコピー

**Objective:** 開発者として、`@opentelemetry/semantic-conventions` の incubating attribute をランタイムコードから直接 import せず、本モジュール内のローカルコピーを参照することで、上流の minor リリースでの破壊的変更からアプリケーションを保護したい。

#### Acceptance Criteria

1. The GROWI server shall incubating attribute（`service.instance.id`, `http.target`）を `semconv.ts` 内に文字列定数として定義し、ランタイムコードはこれを import する。
2. The GROWI server shall `@opentelemetry/semantic-conventions/incubating` からの import をランタイムコードに含めない。

### Requirement 10: 拡張・追加時の境界遵守

**Objective:** 機能を追加・変更するエンジニアとして、新規 Custom Metric や新規 Anonymization Handler を本 spec の境界に従って実装し、レイヤ責務の汚染を回避したい。

#### Acceptance Criteria

1. When 新規 Custom Metric モジュールを追加する, the GROWI server shall `custom-metrics/` 配下にファイルを追加し、`addXxxMetrics(): void` をエクスポートし、`custom-metrics/index.ts` の `setupCustomMetrics()` から呼び出す。
2. When 新規 Anonymization Handler を追加する, the GROWI server shall `anonymization/handlers/` 配下に `AnonymizationModule` 実装ファイルを追加し、`handlers/index.ts` の `anonymizationModules` 配列に登録する。
3. The GROWI server shall identity 情報を Resource Attribute 経由で、設定値を `growi.configs` ラベル経由で、観測値を `growi.*` / `system.*` / `process.*` メトリクス経由でそれぞれ emit する責務分離を維持する。
