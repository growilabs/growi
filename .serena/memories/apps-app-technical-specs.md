# apps/app 技術仕様

## ファイル構造・命名
- Next.js: `*.page.tsx`
- テスト: `*.spec.ts`, `*.integ.ts`
- コンポーネント: `ComponentName.tsx`

## API構造
- **API v3**: `server/routes/apiv3/` (RESTful + OpenAPI準拠)
- **Features API**: `features/*/server/routes/`

## 状態管理
- **Jotai** (推奨): `states/` - アトミック分離
- **SWR**: `stores/` - データフェッチ・キャッシュ

## データベース
- **Mongoose**: `server/models/` (スキーマ定義)
- **Serializers**: `serializers/` (レスポンス変換)

## セキュリティ・i18n
- **認証**: 複数プロバイダー + アクセストークン
- **XSS対策**: `services/general-xss-filter/`
- **i18n**: next-i18next (サーバー・クライアント両対応)

## システム機能
- **検索**: Elasticsearch統合
- **監視**: OpenTelemetry (`features/opentelemetry/`)
- **プラグイン**: 動的読み込み (`features/growi-plugin/`)

## 開発ガイドライン
1. 新機能は `features/` 実装
2. TypeScript strict準拠
3. Jotai状態管理優先
4. API v3形式
5. セキュリティ・i18n・テスト必須