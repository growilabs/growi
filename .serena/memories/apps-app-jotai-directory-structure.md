# Jotai ディレクトリ構造・ファイル配置

## 📁 確立されたディレクトリ構造

```
states/
├── ui/
│   ├── sidebar/                    # サイドバー状態 ✅
│   ├── editor/                     # エディター状態 ✅
│   ├── device.ts                   # デバイス状態 ✅
│   ├── page.ts                     # ページUI状態 ✅
│   ├── toc.ts                      # TOC状態 ✅
│   ├── untitled-page.ts            # 無題ページ状態 ✅
│   ├── page-abilities.ts           # ページ権限判定状態 ✅ DERIVED ATOM!
│   ├── unsaved-warning.ts          # 未保存警告状態 ✅ JOTAI PATTERN!
│   ├── page-tree-desc-count-map.ts # ページツリー子孫カウント ✅ JOTAI PATTERN!
│   └── modal/                      # 個別モーダルファイル ✅
│       ├── page-create.ts          # ページ作成モーダル ✅
│       ├── page-delete.ts          # ページ削除モーダル ✅
│       ├── empty-trash.ts          # ゴミ箱空モーダル ✅
│       ├── delete-attachment.ts    # 添付ファイル削除 ✅
│       ├── delete-bookmark-folder.ts # ブックマークフォルダ削除 ✅
│       ├── update-user-group-confirm.ts # ユーザーグループ更新確認 ✅
│       ├── page-select.ts          # ページ選択モーダル ✅
│       ├── page-presentation.ts    # プレゼンテーションモーダル ✅
│       ├── put-back-page.ts        # ページ復元モーダル ✅
│       ├── granted-groups-inheritance-select.ts # 権限グループ継承選択 ✅
│       ├── drawio.ts               # Draw.ioモーダル ✅
│       ├── handsontable.ts         # Handsontableモーダル ✅
│       ├── private-legacy-pages-migration.ts # プライベートレガシーページ移行 ✅
│       ├── descendants-page-list.ts # 子孫ページリスト ✅
│       ├── conflict-diff.ts        # 競合差分モーダル ✅
│       ├── page-bulk-export-select.ts # ページ一括エクスポート選択 ✅
│       ├── drawio-for-editor.ts    # エディタ用Draw.io ✅
│       ├── link-edit.ts            # リンク編集モーダル ✅
│       └── template.ts             # テンプレートモーダル ✅
├── page/                           # ページ関連状態 ✅
├── server-configurations/          # サーバー設定状態 ✅
├── global/                         # グローバル状態 ✅
├── socket-io/                      # Socket.IO状態 ✅
├── context.ts                      # 共通コンテキスト ✅
└── features/
    └── openai/
        └── client/
            └── states/             # OpenAI専用状態 ✅
                ├── index.ts        # exports ✅
                └── unified-merge-view.ts # UnifiedMergeView状態 ✅
```

## 📋 ファイル配置ルール

### UI状態系 (`states/ui/`)
- **個別機能ファイル**: デバイス、TOC、無題ページ等の単一機能
- **複合機能ディレクトリ**: サイドバー、エディター等の複数機能
- **モーダル専用ディレクトリ**: `modal/` 配下に個別モーダルファイル

### データ関連状態 (`states/`)
- **ページ関連**: `page/` ディレクトリ
- **サーバー設定**: `server-configurations/` ディレクトリ
- **グローバル状態**: `global/` ディレクトリ
- **通信系**: `socket-io/` ディレクトリ

### 機能別専用states (`states/features/`)
- **OpenAI機能**: `features/openai/client/states/`
- **将来の機能**: `features/{feature-name}/client/states/`

## 🏷️ ファイル命名規則

### 状態ファイル
- **単一機能**: `{機能名}.ts` （例: `device.ts`, `toc.ts`）
- **複合機能**: `{機能名}/` ディレクトリ（例: `sidebar/`, `editor/`）
- **モーダル**: `modal/{モーダル名}.ts`（例: `modal/page-create.ts`）

### export/import規則
- **公開API**: `index.ts` でのre-export
- **内部atom**: `_atomsForDerivedAbilities` 特殊名export
- **機能専用**: 機能ディレクトリ配下の独立したstates

## 📊 ファイルサイズ・複雑度の目安

### 適切なファイル分割
- **単一ファイル**: ~100行以内、単一責務
- **ディレクトリ分割**: 複数のhook・機能がある場合
- **個別モーダルファイル**: 1モーダル = 1ファイル原則

### 複雑度による分類
- **シンプル**: Boolean状態、基本的な値管理
- **中程度**: 複数プロパティ、actions分離
- **複雑**: Derived Atom、Map操作、副作用統合

## 🔗 依存関係・インポート構造

### インポート階層
```
components/
├── import from states/ui/          # UI状態
├── import from states/page/        # ページ状態  
├── import from states/global/      # グローバル状態
└── import from states/features/    # 機能別状態

states/ui/
├── 内部相互参照可能
└── states/page/, states/global/ からのimport

states/features/{feature}/
├── states/ui/ からのimport
├── 他のfeatures からのimport禁止
└── 独立性を保つ
```

### 特殊名Export使用箇所
```
states/page/internal-atoms.ts → _atomsForDerivedAbilities
states/ui/editor/atoms.ts → _atomsForDerivedAbilities  
states/global/global.ts → _atomsForDerivedAbilities
states/context.ts → _atomsForDerivedAbilities
```

## 🎯 今後の拡張指針

### 新規機能追加時
1. **機能専用度評価**: 汎用 → `states/ui/`、専用 → `states/features/`
2. **複雑度評価**: シンプル → 単一ファイル、複雑 → ディレクトリ
3. **依存関係確認**: 既存atomの活用可能性
4. **命名規則遵守**: 確立された命名パターンに従う

### ディレクトリ構造維持
- **責務単一原則**: 1ファイル = 1機能・責務
- **依存関係最小化**: 循環参照の回避
- **拡張性**: 将来の機能追加を考慮した構造
- **検索性**: ファイル名から機能が推測できる命名