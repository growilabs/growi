# 技術スタック & 開発環境

## コア技術
- **TypeScript** ~5.0.0 + **Next.js** (React)
- **Node.js** ^20||^22 + **MongoDB** + **Mongoose** ^6.13.6
- **pnpm** 10.4.1 + **Turbo** ^2.1.3 (モノレポ)

## 状態管理・データ
- **Jotai**: アトミック状態管理（推奨）
- **SWR** ^2.3.2: データフェッチ・キャッシュ

## 開発ツール移行状況
| 従来 | 移行先 | 状況 |
|------|--------|------|
| ESLint | **Biome** | 新規推奨 |
| Jest | **Vitest** + **Playwright** | 新規推奨 |

## 主要コマンド
```bash
# 開発
cd apps/app && pnpm run dev

# 品質チェック
pnpm run lint:biome        # 新規推奨
pnpm run lint:typecheck    # 型チェック正式コマンド
pnpm run test:vitest       # 新規推奨

# ビルド
pnpm run app:build
turbo run build           # 並列ビルド
```

## ファイル命名規則
- Next.js: `*.page.tsx`
- テスト: `*.spec.ts` (Vitest), `*.integ.ts`
- コンポーネント: `ComponentName.tsx`

## API・アーキテクチャ
- **API v3**: `server/routes/apiv3/` (RESTful + OpenAPI)
- **Features**: `features/*/` (機能別分離)
- **SCSS**: CSS Modules使用