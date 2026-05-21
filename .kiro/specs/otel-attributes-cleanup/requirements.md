# Requirements Document

## Introduction

GROWI の OpenTelemetry 統合における **カスタム Resource Attribute / Metric の責務分離を整理する** リファクタリング。現状、Resource Attribute には (1) ホスト/サービス識別子、(2) 数値の測定値である `os.totalmem`、(3) サブシステム設定値である `growi.attachment.type` の 3 種類が混在しており、Resource は本来「テレメトリ発生元エンティティの identity」を表現するべきであるという OpenTelemetry の設計意図と合致していない。

加えて、GROWI の主要な運用形態はコンテナ（Docker / Kubernetes）であるにもかかわらず、cgroup memory limit やプロセス RSS、V8 ヒープ統計などコンテナ運用に必須のメモリ系メトリクスが一切収集されていない。Resource Attribute の `os.totalmem` はホスト物理メモリを返すため、コンテナ運用ではむしろ誤解を招く位置にある。

本仕様では Resource Attribute から測定値と設定値を取り除き、それらを既存の `growi.configs` info gauge のラベル、もしくは新規の system / process メトリクス群に再配置する。同時にコンテナ運用に耐える静的・動的メモリメトリクスを追加する。

## Boundary Context

- **In scope**:
  - Resource Attribute から `os.totalmem` と `growi.attachment.type` を削除する
  - 既存の `growi.configs` info gauge に `attachment_type` ラベルを追加する
  - 新規メトリクス群（`system.memory.limit`, `system.host.memory.total`, `process.memory.usage`, `process.runtime.v8.heap.used` / `heap.total` / `heap.external`）を追加する
  - 上記新規メトリクスを `setupCustomMetrics()` から起動する
- **Out of scope**:
  - 既存の `growi.*` メトリクス（`growi.pages.total`, `growi.users.total`, `growi.users.active`）の名称変更や再構成
  - `growi.deployment.type` を OTel 標準 `deployment.environment.name` へ移行すること（identity として現状維持）
  - CPU 系・ネットワーク系・GC・event loop lag などの追加メトリクス
  - HTTP の anonymization layer（`http.target` 等の span attribute）の変更
  - 外部パッケージ（OpenTelemetry コミュニティの汎用ホストメトリクス収集パッケージ等）の導入
- **Adjacent expectations**:
  - 上流: `growiInfoService.getGrowiInfo({ includeAttachmentInfo: true })` が `attachmentType` を供給し続けることを前提とする
  - 下流: OpenTelemetry collector / Prometheus / Grafana 等の取り込み側ダッシュボードが、削除された Resource Attribute（`os.totalmem`, `growi.attachment.type`）から新しいメトリクス／ラベルへ参照を切り替えること。本仕様は切替対応に必要な変更内容の通知までを範囲とする

## Requirements

### Requirement 1: Resource Attribute の identity 専用化

**Objective:** OpenTelemetry インフラ管理者として、GROWI が emit する Resource Attribute がホスト／サービスの identity 情報のみで構成されていることを保証したい。それにより Resource Attribute を本来のキー（テレメトリ発生元エンティティの一意識別）として運用できる。

#### Acceptance Criteria

1. When OpenTelemetry SDK が起動し Resource Attribute を構築する, the GROWI server shall `os.totalmem` を Resource Attribute に含めない.
2. When OpenTelemetry SDK が起動し Resource Attribute を構築する, the GROWI server shall `growi.attachment.type` を Resource Attribute に含めない.
3. The GROWI server shall 既存の identity 系 Resource Attribute（`os.type`, `os.platform`, `os.arch`, `growi.service.type`, `growi.deployment.type`, `service.name`, `service.version`, `service.instance.id`）の名称と値の意味を変更せずに emit する.

### Requirement 2: Attachment storage backend を `growi.configs` のラベルとして公開

**Objective:** 運用者として、GROWI が利用している attachment ストレージバックエンド（aws / gcs / gridfs / local / mongodb / azure 等）を従来の設定情報（`wiki_type`, `external_auth_types` 等）と同じ場所で参照したい。それによりインスタンス設定の確認を一つの info-gauge に集約できる。

#### Acceptance Criteria

1. When `growi.configs` observable gauge が観測される, the GROWI server shall 設定された attachment ストレージバックエンド種別を示す `attachment_type` ラベルを付与する.
2. The GROWI server shall `growi.configs` gauge の既存ラベル（`site_url`, `site_url_hashed`, `wiki_type`, `external_auth_types`）の名称・値・付与条件を変更しない.
3. If attachment ストレージバックエンドが特定できない場合, the GROWI server shall `attachment_type` ラベルの値を空文字とする（既存 `external_auth_types` の未取得時挙動と一致させる）.

### Requirement 3: コンテナ環境に対応したメモリ上限メトリクス

**Objective:** コンテナ環境（Docker / Kubernetes）で GROWI を運用する管理者として、「コンテナに割り当てられたメモリ上限（cgroup limit）」と「ホストの物理メモリ総量」を別々のメトリクスとして参照したい。それにより、コンテナ単位のリソース逼迫とホスト単位の容量計画を区別して判断できる。

#### Acceptance Criteria

1. When メトリクス収集コールバックが発火し、実行プロセスに cgroup memory limit が設定されている, the GROWI server shall `system.memory.limit` メトリクスを cgroup memory limit のバイト数値で観測する（単位 `By`）.
2. If 実行プロセスに cgroup memory limit が設定されていない, the GROWI server shall 当該収集サイクルで `system.memory.limit` を観測しない.
3. When メトリクス収集コールバックが発火する, the GROWI server shall `system.host.memory.total` メトリクスをホスト物理メモリの総バイト数で観測する（単位 `By`）.

### Requirement 4: プロセスおよび V8 ヒープのランタイムメトリクス

**Objective:** 運用者として、GROWI プロセスのメモリ使用量と V8 ヒープの内訳を継続的に観測したい。それにより OOM やメモリリークの兆候を早期に検出できる。

#### Acceptance Criteria

1. When メトリクス収集コールバックが発火する, the GROWI server shall `process.memory.usage` メトリクスをプロセスの Resident Set Size のバイト数で観測する（単位 `By`）.
2. When メトリクス収集コールバックが発火する, the GROWI server shall `process.runtime.v8.heap.used` メトリクスを V8 ヒープの使用バイト数で観測する（単位 `By`）.
3. When メトリクス収集コールバックが発火する, the GROWI server shall `process.runtime.v8.heap.total` メトリクスを V8 ヒープの確保済み総バイト数で観測する（単位 `By`）.
4. When メトリクス収集コールバックが発火する, the GROWI server shall `process.runtime.v8.heap.external` メトリクスを V8 外部メモリ（external buffers 等）のバイト数で観測する（単位 `By`）.

### Requirement 5: 新規メトリクスモジュールのライフサイクル統合と耐障害性

**Objective:** 運用者として、新規追加された system / process メトリクス群が既存カスタムメトリクスと同じタイミングで起動・登録され、かつ収集中の例外が他メトリクスの出力を巻き込まないことを保証したい。

#### Acceptance Criteria

1. When サーバー起動時に OpenTelemetry のカスタムメトリクスセットアップが実行される, the GROWI server shall 既存のカスタムメトリクス（application / user-counts / page-counts）と並んで新規 system / process メトリクスの登録を実行する.
2. If 新規メトリクスの収集コールバック内で例外が発生する, the GROWI server shall 例外を吸収し、`diag` ロガーでエラーを記録した上で残りの収集サイクルを継続する.

### Requirement 6: 後方互換性と運用コミュニケーション

**Objective:** リリース管理者として、本リファクタリングが「Resource Attribute の削除と、メトリクス／ラベルの新規追加」のみで構成され、既存テレメトリ受信側にとって移行手順を伴うことを明示したい。

#### Acceptance Criteria

1. The GROWI server shall Requirement 1 で削除対象とされた 2 つの Resource Attribute 以外は、本仕様の前後で既存 Resource Attribute と既存メトリクス（`growi.configs`, `growi.users.total`, `growi.users.active`, `growi.pages.total`）の名称および値の意味を変更しない.
2. The GROWI server shall 本仕様のリリースに際して、削除された Resource Attribute と新規メトリクス／ラベルの対応関係を運用者向けに明示する（リリースノートまたは PR 説明として、削除前後で参照先が分かる形式で記録する）.
