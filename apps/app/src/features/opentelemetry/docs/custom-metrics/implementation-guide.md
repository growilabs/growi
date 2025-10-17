# OpenTelemetry Custom Metrics Implementation Guide

## 改修実装状況

### ✅ 完了した実装

#### 1. Resource Attributes
- **OS情報**: `src/features/opentelemetry/server/custom-resource-attributes/os-resource-attributes.ts`
  - OS種別、プラットフォーム、アーキテクチャ、総メモリ量
  - 起動時に設定
- **アプリケーション固定情報**: `src/features/opentelemetry/server/custom-resource-attributes/application-resource-attributes.ts`
  - サービス・デプロイメントタイプ、添付ファイルタイプ、インストール情報
  - データベース初期化後に設定

#### 2. Config Metrics
- **実装場所**: `src/features/opentelemetry/server/custom-metrics/application-metrics.ts`
- **メトリクス**: `growi.configs` (値は常に1、情報はラベルに格納)
- **収集情報**: サービスインスタンスID、サイトURL、Wiki種別、外部認証タイプ

#### 3. Custom Metrics
- **実装場所**: `src/features/opentelemetry/server/custom-metrics/user-counts-metrics.ts`
- **メトリクス**: 
  - `growi.users.total` - 総ユーザー数
  - `growi.users.active` - アクティブユーザー数

#### 4. 統合作業
- **node-sdk-configuration.ts**: OS情報のResource Attributes統合済み
- **node-sdk.ts**: データベース初期化後のアプリケーション情報設定統合済み
- **メトリクス初期化**: Config MetricsとCustom Metricsの初期化統合済み

### 📋 実装済みの統合

#### Resource Attributesの2段階設定

**1段階目 (起動時)**: `generateNodeSDKConfiguration`
```typescript
// OS情報のみでResourceを作成
const osAttributes = getOsResourceAttributes();
resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: 'growi',
  [ATTR_SERVICE_VERSION]: version,
  ...osAttributes,
});
```

**2段階目 (DB初期化後)**: `setupAdditionalResourceAttributes`
```typescript
// アプリケーション情報とサービスインスタンスIDを追加
const appAttributes = await getApplicationResourceAttributes();
if (serviceInstanceId != null) {
  appAttributes[ATTR_SERVICE_INSTANCE_ID] = serviceInstanceId;
}
const updatedResource = await generateAdditionalResourceAttributes(appAttributes);
setResource(sdkInstance, updatedResource);
```

#### メトリクス収集の統合
```typescript
// generateNodeSDKConfiguration内で初期化
addApplicationMetrics();
addUserCountsMetrics();
```

## ファイル構成

```
src/features/opentelemetry/server/
├── custom-resource-attributes/
│   ├── index.ts                           # エクスポート用インデックス
│   ├── os-resource-attributes.ts          # OS情報
│   └── application-resource-attributes.ts # アプリケーション情報
├── custom-metrics/
│   ├── application-metrics.ts             # Config Metrics (更新済み)
│   └── user-counts-metrics.ts             # ユーザー数メトリクス (新規)
└── docs/
    ├── custom-metrics-architecture.md     # アーキテクチャ文書
    └── implementation-guide.md            # このファイル
```

## 設計のポイント

1. **2段階Resource設定**: データベース依存の情報は初期化後に設定して循環依存を回避
2. **循環依存の回避**: 動的importを使用してgrowiInfoServiceを読み込み
3. **エラーハンドリング**: 各メトリクス収集でtry-catchを実装
4. **型安全性**: Optional chainingを使用してundefinedを適切に処理
5. **ログ出力**: デバッグ用のログを各段階で出力
6. **起動時間の最適化**: データベース接続を待たずにOpenTelemetryの基本機能を開始
