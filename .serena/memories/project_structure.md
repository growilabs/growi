# プロジェクト構造

## ルートディレクトリ構造
```
growi/
├── apps/                    # アプリケーション群
│   ├── app/                # メインのGROWIアプリケーション
│   ├── pdf-converter/      # PDF変換サービス
│   └── slackbot-proxy/     # Slackボットプロキシ
├── packages/               # 共有パッケージ群
│   ├── core/              # コアライブラリ
│   ├── core-styles/       # 共通スタイル
│   ├── editor/            # エディターコンポーネント
│   ├── pluginkit/         # プラグインキット
│   ├── ui/                # UIコンポーネント
│   ├── presentation/      # プレゼンテーション層
│   ├── preset-templates/  # テンプレート
│   ├── preset-themes/     # テーマ
│   └── remark-*/          # remarkプラグイン群
├── bin/                   # ユーティリティスクリプト
└── 設定ファイル群
```

## メインアプリケーション (apps/app/)
```
apps/app/
├── src/                   # ソースコード
├── test/                  # 古いJestテストファイル（廃止予定）
├── test-with-vite/        # 新しいVitestテストファイル
├── playwright/            # E2Eテスト（Playwright）
├── config/                # 設定ファイル
├── public/                # 静的ファイル
├── docker/                # Docker関連
├── bin/                   # スクリプト
└── 設定ファイル群
```

## テストディレクトリの詳細

### test/ (廃止予定)
- Jest用の古いテストファイル
- 段階的にtest-with-vite/に移行予定
- 新規テストは作成しない

### test-with-vite/
- Vitest用の新しいテストファイル
- 新規テストはここに作成
- セットアップファイル: `setup/mongoms.ts` (MongoDB用)

### playwright/
- E2Eテスト用ディレクトリ
- ブラウザ操作を含むテスト

## テストファイルの配置ルール

### Vitestテストファイル
以下のパターンでソースコードと同じディレクトリまたはtest-with-vite/配下に配置：

- **単体テスト**: `*.spec.{ts,js}`
- **統合テスト**: `*.integ.ts` 
- **コンポーネントテスト**: `*.spec.{tsx,jsx}`

例：
```
src/
├── utils/
│   ├── helper.ts
│   └── helper.spec.ts       # 単体テスト
├── components/
│   ├── Button.tsx
│   └── Button.spec.tsx      # コンポーネントテスト
└── services/
    ├── api.ts
    └── api.integ.ts         # 統合テスト
```

## パッケージ（packages/）
各パッケージは独立したnpmパッケージとして管理され、以下の構造を持つ：
- `src/`: ソースコード
- `dist/`: ビルド出力
- `package.json`: パッケージ設定
- `tsconfig.json`: TypeScript設定

## 重要な設定ファイル
- **pnpm-workspace.yaml**: ワークスペース設定
- **turbo.json**: Turbo.jsビルド設定
- **tsconfig.base.json**: TypeScript基本設定
- **biome.json**: Biome linter/formatter設定
- **.eslintrc.js**: ESLint設定（廃止予定）
- **vitest.workspace.mts**: Vitestワークスペース設定