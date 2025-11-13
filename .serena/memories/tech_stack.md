# 技術スタック

## プログラミング言語
- **TypeScript**: メイン言語（~5.0.0）
- **JavaScript**: 一部のコンポーネント

## フロントエンド
- **Next.js**: Reactベースのフレームワーク
- **React**: UIライブラリ
- **Vite**: ビルドツール、開発サーバー
- **SCSS**: スタイルシート
- **SWR**: グローバルステート管理、データフェッチ・キャッシュ管理（^2.3.2）

## バックエンド
- **Node.js**: ランタイム（^20 || ^22）
- **Express.js**: Webフレームワーク（推測）
- **MongoDB**: データベース
- **Mongoose**: MongoDB用ORM（^6.13.6）
  - mongoose-gridfs: GridFS対応（^1.2.42）
  - mongoose-paginate-v2: ページネーション（^1.3.9）
  - mongoose-unique-validator: バリデーション（^2.0.3）

## 開発ツール
- **pnpm**: パッケージマネージャー（10.4.1）
- **Turbo**: モノレポビルドシステム（^2.1.3）
- **ESLint**: Linter（weseek設定を使用）【廃止予定 - 現在は過渡期】
- **Biome**: 統一予定のLinter/Formatter
- **Stylelint**: CSS/SCSSのLinter
- **Jest**: テスティングフレームワーク【廃止予定 - 現在は過渡期】
- **Vitest**: 高速テスティングフレームワーク【統一予定】
- **Playwright**: E2Eテスト【統一予定】

## その他のツール
- **SWC**: TypeScriptコンパイラー（高速）
- **ts-node**: TypeScript直接実行
- **nodemon**: 開発時のホットリロード
- **dotenv-flow**: 環境変数管理
- **Swagger/OpenAPI**: API仕様

## 移行計画
- **Linter**: ESLint → Biome に統一予定
- **テスト**: Jest → Vitest + Playwright に統一予定