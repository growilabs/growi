# タスク完了時のチェックリスト

## コードを書いた後に必ず実行すべきコマンド

### 1. Lint・フォーマットの実行
```bash
# 【推奨】Biome実行（新規開発）
pnpm run lint:biome

# 【過渡期】全てのLint実行（既存コード）
pnpm run lint

# 個別実行（必要に応じて）
pnpm run lint:eslint      # ESLint（廃止予定）
pnpm run lint:styles      # Stylelint
pnpm run lint:typecheck   # TypeScript型チェック
```

### 2. テストの実行
```bash
# 【推奨】Vitestテスト実行（新規開発）
pnpm run test:vitest

# 【過渡期】全てのテスト実行（既存コード）
pnpm run test

# 個別実行
pnpm run test:jest        # Jest（廃止予定）
pnpm run test:vitest {target-file-name}     # Vitest
```

### 3. E2Eテストの実行（重要な機能変更時）
```bash
cd apps/app
npx playwright test
```

### 4. ビルドの確認
```bash
# メインアプリケーションのビルド
pnpm run app:build

# 関連パッケージのビルド
turbo run build
```

### 5. 動作確認
```bash
# 開発サーバーでの動作確認
cd apps/app && pnpm run dev

# または本番ビルドでの確認
pnpm start
```

## 特別な確認事項

### OpenAPI仕様の確認（API変更時）
```bash
cd apps/app
pnpm run openapi:generate-spec:apiv3
pnpm run lint:openapi:apiv3
```

### データベーススキーマ変更時
```bash
cd apps/app
pnpm run dev:migrate:status  # 現在の状態確認
pnpm run dev:migrate         # マイグレーション実行
```

## テストファイル作成時の注意

### 新規テストファイル
- **単体テスト**: `*.spec.{ts,js}` (Node.js環境)
- **統合テスト**: `*.integ.ts` (Node.js + MongoDB環境)  
- **コンポーネントテスト**: `*.spec.{tsx,jsx}` (happy-dom環境)
- test-with-vite/ または対象ファイルと同じディレクトリに配置

### 既存テストの修正
- test/ 配下のJestテストは段階的に移行
- 可能であればtest-with-vite/にVitestテストとして書き直し

## コミット前の最終チェック
1. Biome（または過渡期はESLint）エラーが解消されているか
2. Vitestテスト（または過渡期はJest）がパスしているか
3. 重要な変更はPlaywright E2Eテストも実行
4. ビルドが成功するか
5. 変更による既存機能への影響がないか
6. 適切なコミットメッセージを作成したか

## 移行期間中の注意事項
- 新規開発: Biome + Vitest を使用
- 既存コード修正: 可能な限り Biome + Vitest に移行
- レガシーツールは段階的に廃止予定