# apps/app アーキテクチャ詳細ガイド

## 概要
`apps/app` は GROWI のメインアプリケーションで、Next.js ベースのフルスタック Web アプリケーションです。

## エントリーポイント
- **サーバーサイド**: `server/app.ts` - OpenTelemetry 初期化と Crowi サーバー起動を担当
- **クライアントサイド**: `pages/_app.page.tsx` - Next.js アプリのルートコンポーネント

## ディレクトリ構成の方針

### フィーチャーベース（新しい方針）
`features/` ディレクトリは機能ごとに整理され、各フィーチャーは以下の構造を持つ：
- `interfaces/` - TypeScript 型定義
- `server/` - サーバーサイドロジック（models, routes, services）
- `client/` - クライアントサイドロジック（components, stores, services）
- `utils/` - 共通ユーティリティ

#### 主要フィーチャー
- `openai/` - AI アシスタント機能（OpenAI 統合）
- `external-user-group/` - 外部ユーザーグループ管理
- `page-bulk-export/` - ページ一括エクスポート
- `growi-plugin/` - プラグインシステム
- `search/` - 検索機能
- `mermaid/` - Mermaid 図表レンダリング
- `plantuml/` - PlantUML 図表レンダリング
- `callout/` - コールアウト（注意書き）機能
- `comment/` - コメント機能
- `templates/` - テンプレート機能
- `rate-limiter/` - レート制限
- `opentelemetry/` - テレメトリ・監視

### レガシー構造（段階的移行予定）

#### ユニバーサル（サーバー・クライアント共通）
- `components/` - React コンポーネント（ページレベル、レイアウト、共通）
- `interfaces/` - TypeScript インターフェース
- `models/` - データモデル定義
- `services/` - ビジネスロジック（レンダラーなど）
- `stores-universal/` - ユニバーサル状態管理（SWR コンテキスト等）

#### サーバーサイド専用
- `server/` - サーバーサイドコード
  - `models/` - Mongoose モデル
  - `routes/` - Express ルート（API v3含む）
  - `service/` - サーバーサイドサービス
  - `middlewares/` - Express ミドルウェア
  - `util/` - サーバーサイドユーティリティ
  - `events/` - イベントエミッター
  - `crowi/` - アプリケーション初期化

#### クライアントサイド専用
- `client/` - クライアントサイドコード
  - `components/` - React コンポーネント
  - `services/` - クライアントサイドサービス
  - `util/` - クライアントサイドユーティリティ
  - `interfaces/` - クライアント固有の型定義
  - `models/` - クライアントサイドモデル

#### Next.js Pages Router
- `pages/` - Next.js ページルート
  - `admin/` - 管理画面ページ
  - `me/` - ユーザー設定ページ
  - `[[...path]]/` - 動的ページルート（Catch-all）
  - `share/` - 共有ページ
  - `login/` - ログインページ

#### 状態管理・UI
- `states/` - Jotai 状態管理（ページ、UI、サーバー設定）
- `stores/` - レガシー状態管理（段階的に states/ に移行）
- `styles/` - SCSS スタイル

#### その他
- `utils/` - 汎用ユーティリティ
- `migrations/` - データベースマイグレーション
- `@types/` - TypeScript 型拡張

## 開発指針

### 新機能開発
新しい機能は `features/` ディレクトリにフィーチャーベースで実装し、以下を含める：
1. インターフェース定義
2. サーバーサイド実装（必要に応じて）
3. クライアントサイド実装（必要に応じて）
4. 共通ユーティリティ

### 既存機能の改修
既存のレガシー構造は段階的に features/ に移行することが推奨される。

### 重要な技術スタック
- **フレームワーク**: Next.js (Pages Router)
- **状態管理**: Jotai (新), SWR (データフェッチング)
- **スタイル**: SCSS, CSS Modules
- **サーバー**: Express.js
- **データベース**: MongoDB (Mongoose)
- **型システム**: TypeScript
- **監視**: OpenTelemetry

## 特記事項
- AI 統合機能（OpenAI）は最も複雑なフィーチャーの一つ
- プラグインシステムにより機能拡張可能
- 多言語対応（i18next）
- 複数の認証方式サポート
- レート制限・セキュリティ機能内蔵