# apps/app 開発ワークフロー・パターン集

## よくある開発パターン

### 新しいページ作成
1. `pages/` にページファイル作成（`.page.tsx`）
2. 必要に応じてレイアウト定義
3. サーバーサイドプロパティ設定 (`getServerSideProps`)
4. 状態管理セットアップ
5. スタイル追加

### 新しい API エンドポイント
1. `server/routes/apiv3/` にルートファイル作成
2. バリデーション定義
3. サービス層実装
4. レスポンス形式定義
5. OpenAPI 仕様更新

### 新しいフィーチャー実装
1. `features/新機能名/` ディレクトリ作成
2. `interfaces/` で型定義
3. `server/` でバックエンド実装
4. `client/` でフロントエンド実装
5. `utils/` で共通ロジック

### コンポーネント作成
1. 適切なディレクトリに配置
2. TypeScript プロパティ定義
3. CSS Modules でスタイル
4. JSDoc コメント追加
5. テストファイル作成

## 重要な設計パターン

### SWR データフェッチング
```typescript
const { data, error, mutate } = useSWR('/api/v3/pages', fetcher);
```

### Jotai 状態管理
```typescript
const pageAtom = atom(initialPageState);
const [page, setPage] = useAtom(pageAtom);
```

### CSS Modules スタイリング
```scss
.componentName {
  @extend %some-placeholder;
  @include some-mixin;
}
```

### API ルート実装
```typescript
export const getPageHandler = async(req: NextApiRequest, res: NextApiResponse) => {
  // バリデーション
  // ビジネスロジック
  // レスポンス
};
```

## ファイル構成のベストプラクティス

### フィーチャーディレクトリ例
```
features/my-feature/
├── interfaces/
│   └── my-feature.ts
├── server/
│   ├── models/
│   ├── routes/
│   └── services/
├── client/
│   ├── components/
│   ├── stores/
│   └── services/
└── utils/
    └── common-logic.ts
```

### コンポーネントディレクトリ例
```
components/MyComponent/
├── MyComponent.tsx
├── MyComponent.module.scss
├── MyComponent.spec.tsx
├── index.ts
└── sub-components/
```

## 開発時のチェックリスト

### コード品質
- [ ] TypeScript エラーなし
- [ ] ESLint ルール準拠
- [ ] テストケース作成
- [ ] 型安全性確保
- [ ] パフォーマンス影響確認

### 機能要件
- [ ] 国際化対応（i18n）
- [ ] セキュリティチェック
- [ ] アクセシビリティ対応
- [ ] レスポンシブデザイン
- [ ] エラーハンドリング

### API 設計
- [ ] RESTful 設計原則
- [ ] 適切な HTTP ステータスコード
- [ ] バリデーション実装
- [ ] レート制限対応
- [ ] ドキュメント更新

## デバッグ・トラブルシューティング

### よくある問題
1. **型エラー**: tsconfig.json 設定確認
2. **スタイル適用されない**: CSS Modules インポート確認
3. **API エラー**: ミドルウェア順序確認
4. **状態同期問題**: SWR キー重複確認
5. **ビルドエラー**: 依存関係バージョン確認

### デバッグツール
- Next.js Dev Tools
- React Developer Tools
- Network タブ（API 監視）
- Console ログ
- Lighthouse（パフォーマンス）

## パフォーマンス最適化

### フロントエンド
- コンポーネント lazy loading
- 画像最適化
- Bundle サイズ監視
- メモ化（useMemo, useCallback）

### バックエンド
- データベースクエリ最適化
- キャッシュ戦略
- 非同期処理
- リソース使用量監視

## セキュリティ考慮事項

### 実装時の注意
- 入力サニタイゼーション
- CSRF 対策
- XSS 防止
- 認証・認可チェック
- 機密情報の適切な取り扱い

## デプロイ・運用

### 環境設定
- 環境変数管理
- データベース接続
- 外部サービス連携
- ログ設定
- 監視設定

このガイドは apps/app の開発を効率的に進めるための包括的な情報源として活用してください。