# OpenTelemetry Overview

## 現在の実装状況

### 基本機能
- ✅ **Trace収集**: HTTP、Database等の自動インストルメンテーション
- ✅ **Metrics収集**: 基本的なアプリケーションメトリクス
- ✅ **OTLP Export**: gRPCでのデータ送信
- ✅ **設定管理**: 環境変数による有効/無効制御

### アーキテクチャ
```
[GROWI App] → [NodeSDK] → [Auto Instrumentations] → [OTLP Exporter] → [Collector]
```

### 実装ファイル
| ファイル | 責務 |
|---------|------|
| `node-sdk.ts` | SDK初期化・管理 |
| `node-sdk-configuration.ts` | 設定生成 |
| `node-sdk-resource.ts` | リソース属性管理 |
| `logger.ts` | 診断ログ |

### 設定項目
| 環境変数 | デフォルト | 説明 |
|---------|-----------|------|
| `OTEL_ENABLED` | `false` | 有効/無効 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | エクスポート先 |
| `OTEL_SERVICE_NAME` | `growi` | サービス名 |
| `OTEL_SERVICE_VERSION` | 自動 | バージョン |

### データフロー
1. **Auto Instrumentation** でHTTP/DB操作を自動計測
2. **NodeSDK** がスパン・メトリクスを収集
3. **OTLP Exporter** が外部Collectorに送信

## 制限事項
- 機密データの匿名化未実装
- GROWIアプリ固有の情報未送信

## 参考情報
- [OpenTelemetry Node.js SDK](https://open-telemetry.github.io/opentelemetry-js/)
- [Custom Metrics Documentation](https://opentelemetry.io/docs/instrumentation/js/manual/#creating-metrics)
- [HTTP Instrumentation Configuration](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-instrumentation-http#configuration)
- [Semantic Conventions for System Metrics](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/system/system-metrics.md)
- [Resource Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/resource/README.md)

---
*更新日: 2025-06-19*
