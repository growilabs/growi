# OpenTelemetry Custom Metrics Architecture

## 概要

GROWIのOpenTelemetryカスタムメトリクスは、以下の3つのカテゴリに分類して実装されています：

1. **Resource Attributes** - システム起動時に設定される静的情報
2. **Config Metrics** - 設定変更により動的に変わる可能性があるメタデータ
3. **Custom Metrics** - 時間と共に変化する業務メトリクス

## アーキテクチャ

### Resource Attributes

静的なシステム情報をOpenTelemetryのResource Attributesとして設定します。Resource Attributesは2段階で設定されます：

1. **起動時設定**: OS情報など、データベースアクセスが不要な静的情報
2. **データベース初期化後設定**: アプリケーション情報など、データベースアクセスが必要な情報

#### 実装場所
```
src/features/opentelemetry/server/custom-resource-attributes/
├── os-resource-attributes.ts        # OS情報 (起動時設定)
└── application-resource-attributes.ts  # アプリケーション固定情報 (DB初期化後設定)
```

#### OS情報 (`os-resource-attributes.ts`) - 起動時設定
- `os.type` - OS種別 (Linux, Windows等)
- `os.platform` - プラットフォーム (linux, darwin等)
- `os.arch` - アーキテクチャ (x64, arm64等)
- `os.totalmem` - 総メモリ量

#### アプリケーション固定情報 (`application-resource-attributes.ts`) - DB初期化後設定
- `growi.service.type` - サービスタイプ
- `growi.deployment.type` - デプロイメントタイプ
- `growi.attachment.type` - ファイルアップロードタイプ
- `growi.installedAt` - インストール日時
- `growi.installedAt.by_oldest_user` - 最古ユーザー作成日時

### Config Metrics

設定変更により動的に変わる可能性があるメタデータ実装します。値は常に1で、情報はラベルに格納されます。

#### 実装場所
```
src/features/opentelemetry/server/custom-metrics/application-metrics.ts
```

#### 収集される情報
- `service_instance_id` - サービスインスタンス識別子
- `site_url` - サイトURL
- `wiki_type` - Wiki種別 (open/closed)
- `external_auth_types` - 有効な外部認証プロバイダー

#### メトリクス例
```
growi_info{service_instance_id="abc123",site_url="https://wiki.example.com",wiki_type="open",external_auth_types="github,google"} 1
```

### Custom Metrics

時間と共に変化する業務メトリクスを実装します。数値として監視・アラートの対象となるメトリクスです。

#### 実装場所
```
src/features/opentelemetry/server/custom-metrics/
├── application-metrics.ts  # Config Metrics (既存)
└── user-counts-metrics.ts  # ユーザー数メトリクス (新規作成)
```

#### ユーザー数メトリクス (`user-counts-metrics.ts`)
- `growi.users.total` - 総ユーザー数
- `growi.users.active` - アクティブユーザー数

## 収集間隔・設定タイミング

### Resource Attributes
- **OS情報**: アプリケーション起動時に1回のみ設定
- **アプリケーション情報**: データベース初期化後に1回のみ設定

### Metrics
- **Config Metrics**: 60秒間隔で収集 (デフォルト)
- **Custom Metrics**: 60秒間隔で収集 (デフォルト)

### 2段階設定の理由

Resource Attributesが2段階で設定される理由：

1. **循環依存の回避**: アプリケーション情報の取得にはgrowiInfoServiceが必要だが、OpenTelemetry初期化時点では利用できない
2. **データベース依存**: インストール日時やサービス設定などはデータベースから取得する必要がある
3. **起動時間の最適化**: データベース接続を待たずにOpenTelemetryの基本機能を開始できる

## 設定の変更

メトリクス収集間隔は `PeriodicExportingMetricReader` の `exportIntervalMillis` で変更可能です：

```typescript
metricReader: new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter(),
  exportIntervalMillis: 30000, // 30秒間隔
}),
```

## 使用例

### Prometheusでのクエリ例

```promql
# 総ユーザー数の推移
growi_users_total

# Wiki種別でグループ化した情報
growi_info{wiki_type="open"}

# 外部認証を使用しているインスタンス
growi_info{external_auth_types!=""}
```

### Grafanaでの可視化例

- ユーザー数の時系列グラフ
- Wiki種別の分布円グラフ
- 外部認証プロバイダーの利用状況
