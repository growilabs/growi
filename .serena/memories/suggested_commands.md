# 推奨開発コマンド集

## セットアップ
```bash
# 初期セットアップ
pnpm run bootstrap
# または
pnpm install
```

## 開発サーバー
```bash
# メインアプリケーション開発モード
cd apps/app && pnpm run dev

# ルートから起動（本番用ビルド後）
pnpm start
```

## ビルド
```bash
# メインアプリケーションのビルド
pnpm run app:build

# Slackbot Proxyのビルド
pnpm run slackbot-proxy:build

# 全体ビルド（Turboで並列実行）
turbo run build
```

## Lint・フォーマット
```bash
# 【推奨】Biome実行（lint + format）
pnpm run lint:biome

# 【過渡期】ESLint実行（廃止予定）
pnpm run lint:eslint

# Stylelint実行
pnpm run lint:styles

# 全てのLint実行（過渡期対応）
pnpm run lint

# TypeScript型チェック
pnpm run lint:typecheck
```

## テスト
```bash
# 【推奨】Vitestテスト実行
pnpm run test:vitest

# 【過渡期】Jest（統合テスト）（廃止予定）
pnpm run test:jest

# 全てのテスト実行（過渡期対応）
pnpm run test

# Vitestで特定のファイルに絞って実行
pnpm run test:vitest {target-file-name}

# E2Eテスト（Playwright）
npx playwright test
```

## データベース関連
```bash
# マイグレーション実行
cd apps/app && pnpm run migrate

# 開発環境でのマイグレーション
cd apps/app && pnpm run dev:migrate

# マイグレーション状態確認
cd apps/app && pnpm run dev:migrate:status
```

## その他の便利コマンド
```bash
# REPL起動
cd apps/app && pnpm run repl

# OpenAPI仕様生成
cd apps/app && pnpm run openapi:generate-spec:apiv3

# クリーンアップ
cd apps/app && pnpm run clean
```

## 注意事項
- ESLintとJestは廃止予定のため、新規開発ではBiomeとVitestを使用してください
- 既存のコードは段階的に移行中です