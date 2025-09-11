# Jotai 移行ガイド & 進捗管理（統合版）

## 🎯 移行方針と基本原則

### 移行の背景
- `useSWRStatic` や `useContextSWR` による複雑な状態管理の課題解決
- パフォーマンス改善と責務の明確化

### 役割分担の明確化
- **SWR**: データフェッチング、サーバーキャッシュ管理に特化
- **Jotai**: クライアントサイドUI状態、同期的な状態管理に特化

## ⚠️ 移行作業フロー（必須手順）

### 基本手順（必ず順序通りに実行）
1. **新しいJotaiベースの実装を作成**
2. **使用箇所を新しい実装に置き換え**
3. **【必須】旧コードの削除** ← これを忘れずに！
4. **【必須】型チェックの実行** ← migration完了確認

```bash
# 型チェック実行（migration完了確認）
cd /workspace/growi/apps/app && pnpm run lint:typecheck
```

### ⚠️ 旧コード削除が必須な理由
- **Migration完了の確認**: 旧コードが残っていると、移行が不完全でもtypecheckがパスしてしまう
- **コンパイルエラーによる検証**: 旧コードを削除することで、移行漏れが確実に検出される
- **保守性の向上**: 重複コードがないことで、将来の変更時の混乱を防ぐ

## 📁 ディレクトリ構造と実装パターン

### ディレクトリ構造（確立済み）
```
states/
├── ui/
│   ├── sidebar/                    # サイドバー状態 ✅
│   ├── editor/                     # エディター状態 ✅
│   ├── device.ts                   # デバイス状態 ✅
│   ├── page.ts                     # ページUI状態 ✅
│   ├── toc.ts                      # TOC状態 ✅
│   ├── untitled-page.ts            # 無題ページ状態 ✅ NEW!
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
└── context.ts                      # 共通コンテキスト ✅
```

### 🎯 確立された実装パターン

#### パフォーマンス最適化フック分離パターン
```typescript
// 状態型定義
export type [Modal]Status = {
  isOpened: boolean;
  // その他のプロパティ
};

export type [Modal]Actions = {
  open: (...args) => void;
  close: () => void;
};

// Atom定義
const [modal]Atom = atom<[Modal]Status>({ isOpened: false });

// 読み取り専用フック（useAtomValue使用）
export const use[Modal]Status = (): [Modal]Status => {
  return useAtomValue([modal]Atom);
};

// アクション専用フック（useSetAtom + useCallback）
export const use[Modal]Actions = (): [Modal]Actions => {
  const setStatus = useSetAtom([modal]Atom);

  const open = useCallback((...args) => {
    setStatus({ isOpened: true, ...args });
  }, [setStatus]);

  const close = useCallback(() => {
    setStatus({ isOpened: false });
  }, [setStatus]);

  return { open, close };
};
```

#### デバイス状態パターン（Jotaiベース）
```typescript
// 例: useDeviceLargerThanMd
export const isDeviceLargerThanMdAtom = atom(false);

export const useDeviceLargerThanMd = () => {
  const [isLargerThanMd, setIsLargerThanMd] = useAtom(isDeviceLargerThanMdAtom);

  useEffect(() => {
    if (isClient()) {
      const mdOrAboveHandler = function (this: MediaQueryList): void {
        setIsLargerThanMd(this.matches);
      };
      const mql = addBreakpointListener(Breakpoint.MD, mdOrAboveHandler);
      setIsLargerThanMd(mql.matches); // initialize
      return () => {
        cleanupBreakpointListener(mql, mdOrAboveHandler);
      };
    }
    return undefined;
  }, [setIsLargerThanMd]);

  return [isLargerThanMd, setIsLargerThanMd] as const;
};
```

#### RefObjectパターン（DOM要素管理）
```typescript
// Internal atom for RefObject storage
const tocNodeRefAtom = atom<RefObject<HtmlElementNode> | null>(null);

// Public derived atom for direct access
export const tocNodeAtom = atom((get) => {
  const tocNodeRef = get(tocNodeRefAtom);
  return tocNodeRef?.current ?? null;
});

// Hook for setting with RefObject wrapping
export const useSetTocNode = () => {
  const setTocNodeRef = useSetAtom(tocNodeRefAtom);

  const setTocNode = useCallback((newNode: HtmlElementNode) => {
    const nodeRef: RefObject<HtmlElementNode> = { current: newNode };
    setTocNodeRef(nodeRef);
  }, [setTocNodeRef]);

  return setTocNode;
};
```

#### パフォーマンス最適化Dynamic Import パターン
```typescript
// Cache for dynamic import
let generateTocOptionsCache: typeof generateTocOptions | null = null;

export const useTocOptions = () => {
  // ... dependencies ...
  
  useEffect(() => {
    (async () => {
      try {
        if (!generateTocOptionsCache) {
          const { generateTocOptions } = await import('~/client/services/renderer/renderer');
          generateTocOptionsCache = generateTocOptions;
        }
        
        const data = generateTocOptionsCache(config, tocNode);
        setState({ data, isLoading: false, error: undefined });
      } catch (err) {
        setState({ data: undefined, isLoading: false, error: err instanceof Error ? err : new Error('Failed') });
      }
    })();
  }, [dependencies]);
};
```

#### シンプルなBoolean状態パターン（NEW! 2025-09-11追加）
```typescript
// Atom定義
const isUntitledPageAtom = atom<boolean>(false);

// 読み取り専用フック
export const useIsUntitledPage = (): boolean => {
  return useAtomValue(isUntitledPageAtom);
};

// セッター専用フック（シンプル）
export const useSetIsUntitledPage = () => {
  return useSetAtom(isUntitledPageAtom);
};
```

#### 使用パターン
- **ステータスのみ必要**: `use[Modal]Status()`
- **アクションのみ必要**: `use[Modal]Actions()`
- **両方必要**: 2つのフックを併用
- **デバイス状態**: `const [isLargerThanMd] = useDeviceLargerThanMd()`
- **TOC状態**: `const tocNode = useTocNode()`, `const setTocNode = useSetTocNode()`
- **TOCオプション**: `const { data, isLoading, error } = useTocOptions()`
- **無題ページ状態**: `const isUntitled = useIsUntitledPage()`, `const setIsUntitled = useSetIsUntitledPage()`

#### 重要事項
- **後方互換フックは不要**: 移行完了後は即座に削除
- **型の正しいインポート**: 元ファイルのimport文を参考にする
- **フック分離のメリット**: 不要なリレンダリング防止、参照安定化
- **RefObjectパターン**: mutableなDOM要素の管理に使用
- **Dynamic Import**: 重いライブラリの遅延ロードでパフォーマンス最適化
- **シンプルパターン**: SWR後方互換性が不要な場合のシンプルな実装

## ✅ 移行完了済み状態

### UI関連状態（完了）
- ✅ **サイドバー状態**: `useDrawerOpened`, `useSetPreferCollapsedMode`, `useSidebarMode`, `useCurrentSidebarContents`, `useCollapsedContentsOpened`, `useCurrentProductNavWidth`
- ✅ **デバイス状態**: `useDeviceLargerThanXl`, `useDeviceLargerThanLg`, `useDeviceLargerThanMd`, `useIsMobile` （2025-09-11完了）
- ✅ **エディター状態**: `useEditorMode`, `useSelectedGrant`
- ✅ **ページUI状態**: `usePageControlsX`
- ✅ **TOC状態**: `useTocNode`, `useSetTocNode`, `useTocOptions`, `useTocOptionsReady` （2025-09-11完了）
- ✅ **無題ページ状態**: `useIsUntitledPage`, `useSetIsUntitledPage` （2025-09-11完了）

### データ関連状態（完了）
- ✅ **ページ状態**: `useCurrentPageId`, `useCurrentPageData`, `useCurrentPagePath`, `usePageNotFound`, `usePageNotCreatable`, `useLatestRevision`
- ✅ **サーバー設定**: 全サーバー設定atoms
- ✅ **グローバル状態**: 現在ユーザーなど
- ✅ **Socket.IO状態**: 接続管理

### SSRハイドレーション（完了）
- ✅ `useHydrateSidebarAtoms`, `useHydratePageAtoms`, `useHydrateGlobalAtoms`

### 🎉 モーダル状態移行完了（個別ファイル方式）

#### 第1バッチ（2025-09-05完了）
- ✅ **`useEmptyTrashModal`**: ゴミ箱空モーダル
- ✅ **`useDeleteAttachmentModal`**: 添付ファイル削除モーダル
- ✅ **`useDeleteBookmarkFolderModal`**: ブックマークフォルダ削除モーダル
- ✅ **`useUpdateUserGroupConfirmModal`**: ユーザーグループ更新確認モーダル

#### 第2バッチ（2025-09-05完了）
- ✅ **`usePageSelectModal`**: ページ選択モーダル
- ✅ **`usePagePresentationModal`**: プレゼンテーションモーダル
- ✅ **`usePutBackPageModal`**: ページ復元モーダル

#### 第3バッチ（2025-09-05完了）
- ✅ **`useGrantedGroupsInheritanceSelectModal`**: 権限グループ継承選択モーダル
- ✅ **`useDrawioModal`**: Draw.ioモーダル
- ✅ **`useHandsontableModal`**: Handsontableモーダル

#### 第4バッチ（2025-09-05完了）
- ✅ **`usePrivateLegacyPagesMigrationModal`**: プライベートレガシーページ移行モーダル
- ✅ **`useDescendantsPageListModal`**: 子孫ページリストモーダル
- ✅ **`useConflictDiffModal`**: 競合差分モーダル

#### 第5バッチ（2025-09-05完了）
- ✅ **`usePageBulkExportSelectModal`**: ページ一括エクスポート選択モーダル
- ✅ **`useDrawioModalForEditor`**: エディタ用Draw.ioモーダル
- ✅ **`useLinkEditModal`**: リンク編集モーダル
- ✅ **`useTemplateModal`**: テンプレートモーダル

#### 🏆 完全移行完了（全17個）
**主要モーダル（アプリ内使用）**:
- ✅ `usePageCreateModal`, `usePageDeleteModal` （事前移行済み）

**バッチ移行モーダル（第1〜5バッチ）**:
- ✅ EmptyTrash, DeleteAttachment, DeleteBookmarkFolder, UpdateUserGroupConfirm
- ✅ PageSelect, PagePresentation, PutBackPage
- ✅ GrantedGroupsInheritanceSelect, Drawio, Handsontable
- ✅ PrivateLegacyPagesMigration, DescendantsPageList, ConflictDiff
- ✅ PageBulkExportSelect, DrawioForEditor, LinkEdit, Template

#### 🔥 実装の特徴
- **型安全性**: `@growi/core` からの正しい型インポート
- **パフォーマンス最適化**: `useAtomValue` + `useSetAtom` フック分離による最適化
- **使用箇所完全移行**: 全ての使用箇所を新しいフックに移行済み
- **旧コード削除**: `stores/modal.tsx` からの旧実装削除完了
- **型チェック成功**: `pnpm run lint:typecheck` 通過確認済み
- **統一されたパターン**: 全モーダルで一貫したJotaiパターン適用

#### 📈 効率化された移行パターンの成功事例
- **バッチ処理**: 3-4個のモーダルを同時移行
- **所要時間**: 各バッチ約1時間で完了
- **品質確認**: 型チェック成功、全使用箇所移行済み
- **統一された実装**: 全17個のモーダルで一貫したパターン

### 🆕 デバイス状態移行完了（2025-09-11完了）

#### ✅ Phase 1: デバイス幅関連フック4個一括移行完了
- ✅ **`useIsDeviceLargerThanMd`**: MD以上のデバイス幅判定
  - 使用箇所：8個のコンポーネント完全移行
- ✅ **`useIsDeviceLargerThanLg`**: LG以上のデバイス幅判定
  - 使用箇所：3個のコンポーネント完全移行
- ✅ **`useIsMobile`**: モバイルデバイス判定
  - 使用箇所：1個のコンポーネント完全移行

#### 🚀 移行の成果
- **統一パターン**: 既存の `useDeviceLargerThanXl` パターンに合わせて実装
- **MediaQuery対応**: ブレークポイント監視による動的な状態更新
- **モバイル検出**: タッチスクリーン・UserAgent による高精度判定
- **テスト修正**: モックファイルの更新完了
- **旧コード削除**: `stores/ui.tsx` から3つのフック削除完了

#### 📊 移行詳細
**移行されたファイル数**: 11個
- PageControls.tsx, AccessTokenScopeList.tsx, PageEditorModeManager.tsx
- GrowiContextualSubNavigation.tsx, SavePageControls.tsx, OptionsSelector.tsx
- Sidebar.tsx, PageListItemL.tsx, DescendantsPageListModal.tsx
- PageAccessoriesModal.tsx, PrimaryItem.tsx

**テストファイル修正**: 1個
- DescendantsPageListModal.spec.tsx: モック戻り値を `{ data: boolean }` → `[boolean]` に変更

### 🆕 TOC状態移行完了（2025-09-11完了）

#### ✅ TOC関連フック完全移行完了
- ✅ **`useTocNode`**: TOCノード取得（新API）
- ✅ **`useSetTocNode`**: TOCノード設定（新API）  
- ✅ **`useTocOptions`**: TOCオプション生成（SWRからJotai + Dynamic Import）
- ✅ **`useTocOptionsReady`**: TOCオプション準備完了判定

#### 🚀 移行の成果と技術的特徴

**1. API整理とクリーンアップ**
- **統合**: TOC関連処理を `states/ui/toc.ts` に集約
- **削除**: deprecated API（`useCurrentPageTocNode`, `useSetCurrentPageTocNode`）完全削除
- **リファクタ**: `states/ui/page.ts` からTOC関連re-export削除
- **責務分離**: PageControls関連とTOC関連の完全分離

**2. RefObjectパターンによる型安全なDOM管理**
```typescript
// Internal RefObject storage (hidden from external API)
const tocNodeRefAtom = atom<RefObject<HtmlElementNode> | null>(null);

// Public derived atom for direct access
export const tocNodeAtom = atom((get) => {
  const tocNodeRef = get(tocNodeRefAtom);
  return tocNodeRef?.current ?? null;
});
```

**3. Dynamic Import + Cachingによるパフォーマンス最適化**
```typescript
// Heavy renderer dependencies are lazy-loaded
let generateTocOptionsCache: typeof generateTocOptions | null = null;

if (!generateTocOptionsCache) {
  const { generateTocOptions } = await import('~/client/services/renderer/renderer');
  generateTocOptionsCache = generateTocOptions;
}
```

**4. SWRからJotai完全移行**
- **Before**: SWR-based `useTocOptions` with server-side dependency
- **After**: Pure Jotai state management with optimized caching
- **Code Size**: 50%削減（54行 → 27行）

#### 🎯 パフォーマンス向上効果
1. **Bundle Splitting**: renderer.tsx（20+ dependencies）の遅延ロード
2. **Code Splitting**: KaTeX, Mermaid, PlantUML等の重いライブラリ分離
3. **Caching**: 一度ロード後の同期実行
4. **First Contentful Paint**: 初期バンドルサイズ削減

#### 📊 移行影響範囲
- **更新ファイル**: `states/ui/toc.ts`, `states/ui/page.ts`, `stores/renderer.tsx`
- **使用箇所**: `TableOfContents.tsx`（既に新API対応済み）
- **削除コード**: deprecated hooks, re-exports, 冗長なコメント

### 🆕 無題ページ状態移行完了（2025-09-11完了）

#### ✅ 無題ページ関連フック完全移行完了
- ✅ **`useIsUntitledPage`**: 無題ページ状態取得（シンプルなboolean）
- ✅ **`useSetIsUntitledPage`**: 無題ページ状態設定（直接的なsetter）

#### 🚀 移行の成果と技術的特徴

**1. シンプルなBoolean状態パターン確立**
```typescript
// Atom定義（シンプル）
const isUntitledPageAtom = atom<boolean>(false);

// 読み取り専用フック
export const useIsUntitledPage = (): boolean => {
  return useAtomValue(isUntitledPageAtom);
};

// セッター専用フック（useSetAtom直接使用）
export const useSetIsUntitledPage = () => {
  return useSetAtom(isUntitledPageAtom);
};
```

**2. SWR後方互換性の完全排除**
- **Before**: SWR response形式（`{ data: boolean, mutate: function }`）
- **After**: 直接的なboolean値とsetter関数
- **メリット**: シンプルで理解しやすい、不要な複雑性の排除

**3. 使用箇所の完全移行**
- **読み取り**: `const { data: isUntitled } = useIsUntitledPage()` → `const isUntitled = useIsUntitledPage()`
- **変更**: `const { mutate } = useIsUntitledPage()` → `const setIsUntitled = useSetIsUntitledPage()`
- **直接呼び出し**: `mutate(value)` → `setIsUntitled(value)`

#### 📊 移行影響範囲
- **新ファイル**: `states/ui/untitled-page.ts`（シンプルな実装）
- **移行箇所**: 5個のファイル（PageTitleHeader.tsx, PageEditor.tsx, page-path-rename-utils.ts, use-create-page.tsx, use-update-page.tsx）
- **テスト修正**: PageTitleHeader.spec.tsx（モック戻り値を `{ data: boolean }` → `boolean` に変更）
- **旧コード削除**: `stores/ui.tsx` からの `useIsUntitledPage` 削除完了

#### 🎯 設計原則の明確化
- **SWR後方互換性不要時**: 直接的なgetter/setterパターンを採用
- **パフォーマンス優先**: `useAtomValue` + `useSetAtom` の分離により最適化
- **複雑性排除**: 不要なwrapper関数やcallback不要
- **型安全性**: TypeScriptによる完全な型チェック

## ✅ プロジェクト完了ステータス

### 🎯 モーダル移行プロジェクト: **100% 完了** ✅

**全17個のモーダル**がJotaiベースに移行完了：
- 🏆 **パフォーマンス最適化**: 全モーダルで`useAtomValue`/`useSetAtom`分離パターン適用
- 🏆 **型安全性**: TypeScript完全対応、全型チェック成功
- 🏆 **保守性**: 統一されたディレクトリ構造と実装パターン
- 🏆 **互換性**: 全使用箇所の移行完了、旧実装の完全削除

### 🎯 デバイス状態移行: **Phase 1 完了** ✅

**主要デバイス判定フック4個**がJotaiベースに移行完了：
- 🏆 **統一パターン**: `useAtom` + `useEffect` でのBreakpoint監視
- 🏆 **動的更新**: MediaQuery変更時の自動状態更新
- 🏆 **高精度判定**: モバイル検出の複数手法組み合わせ
- 🏆 **完全移行**: 全使用箇所（11ファイル）の移行完了

### 🎯 TOC状態移行: **完全完了** ✅

**TOC関連フック4個**がJotaiベースに移行完了：
- 🏆 **API整理**: deprecated API削除、責務分離
- 🏆 **RefObjectパターン**: 型安全なDOM要素管理
- 🏆 **Dynamic Import**: パフォーマンス最適化（50%コード削減）
- 🏆 **SWR完全代替**: 純粋なJotai状態管理への移行

### 🎯 無題ページ状態移行: **完全完了** ✅

**無題ページ関連フック2個**がJotaiベースに移行完了：
- 🏆 **シンプルパターン確立**: SWR後方互換性を排除したシンプル実装
- 🏆 **直接的API**: boolean値の直接取得とsetter関数
- 🏆 **完全移行**: 5個のファイル + テストファイル修正完了
- 🏆 **旧コード削除**: `stores/ui.tsx` からの完全削除

### 🚀 成果とメリット
1. **パフォーマンス向上**: 不要なリレンダリングの削減、Bundle Splitting
2. **開発体験向上**: 統一されたAPIパターン、型安全性
3. **保守性向上**: 個別ファイル化による責務明確化、API整理
4. **型安全性**: Jotaiによる強固な型システム
5. **レスポンシブ対応**: 正確なデバイス幅・モバイル判定
6. **DOM管理**: RefObjectパターンによる安全なDOM要素管理
7. **シンプル性**: 不要な複雑性の排除、直接的なAPI設計

### 📊 最終進捗サマリー
- **完了**: 主要なUI状態 + ページ関連状態 + SSRハイドレーション + **全17個のモーダル** + **デバイス状態4個** + **TOC状態4個** + **無題ページ状態2個**
- **モーダル移行**: **100% 完了** （17/17個）
- **デバイス状態移行**: **Phase 1完了** （4/4個）
- **TOC状態移行**: **完全完了** （4/4個）
- **無題ページ状態移行**: **完全完了** （2/2個）
- **品質保証**: 全型チェック成功、パフォーマンス最適化済み
- **ドキュメント**: 完全な実装パターンガイド確立

## 🔮 今後の発展可能性

### 次のフェーズ候補（Phase 2）
1. **残存SWRフック**: `stores/ui.tsx` 内の残り5個のフック
   - `usePageTreeDescCountMap` - ページツリーの子孫数管理（4ファイル使用、Map操作）
   - `useCommentEditorDirtyMap` - コメントエディタのダーティ状態管理（1ファイル使用、Map操作）
   - `useIsAbleToShowTrashPageManagementButtons` - ゴミ箱管理ボタン表示判定（1ファイル使用、boolean計算）
   - `useIsAbleToShowTagLabel` - タグラベル表示判定（1ファイル使用、boolean計算）
   - その他のable系フック - 各種UI表示判定
2. **追加SWRフック検討**: その他のSWR使用箇所の調査
3. **AI機能のモーダル**: OpenAI関連のモーダル状態の統合検討
4. **エディタパッケージ統合**: `@growi/editor`内のモーダル状態の統合

### クリーンアップ候補
- `stores/modal.tsx` 完全削除（既に空ファイル化済み）
- `stores/ui.tsx` の段階的縮小検討（5個のフック残存）
- 未使用SWRフックの調査・クリーンアップ

## 🔄 更新履歴

- **2025-09-11**: 🎉 **無題ページ状態移行完全完了！**
  - useIsUntitledPage, useSetIsUntitledPage 移行完了
  - シンプルBoolean状態パターン確立（SWR後方互換性排除）
  - 5個のファイル + テストファイル完全移行
  - 旧コード削除：stores/ui.tsx から useIsUntitledPage 削除完了
  - 設計原則明確化：直接的なgetter/setterパターン確立
- **2025-09-11**: 🎉 **TOC状態移行完全完了！**
  - useTocNode, useSetTocNode, useTocOptions, useTocOptionsReady 移行完了
  - API整理：deprecated hooks削除、責務分離完了
  - RefObjectパターン：型安全なDOM要素管理確立
  - Dynamic Import：パフォーマンス最適化（50%コード削減）
  - SWR完全代替：Jotai純粋状態管理への移行
  - 旧コード削除：re-exports, deprecated APIs完全削除
- **2025-09-11**: 🎉 **Phase 1完了 - デバイス状態移行100%完了！**
  - useIsDeviceLargerThanMd, useIsDeviceLargerThanLg, useIsMobile移行完了
  - 11個のコンポーネント全使用箇所移行、テストファイル修正
  - `states/ui/device.ts`に4個のデバイス関連フック統一
  - 旧コード削除、不要インポート削除完了
- **2025-09-05**: 🎉 **第5バッチ完了 - モーダル移行プロジェクト100%完了！**
  - PageBulkExportSelect, DrawioForEditor, LinkEdit, Template移行完了
  - 全17個のモーダルがJotaiベースに統一
  - パフォーマンス最適化パターン全適用完了
- **2025-09-05**: 第4バッチ完了（PrivateLegacyPagesMigration, DescendantsPageList, ConflictDiff）
- **2025-09-05**: 第3バッチ完了（GrantedGroupsInheritanceSelect, Drawio, Handsontable）
- **2025-09-05**: 第2バッチ完了（PageSelect, PagePresentation, PutBackPage）
- **2025-09-05**: 第1バッチ完了（EmptyTrash, DeleteAttachment, DeleteBookmarkFolder, UpdateUserGroupConfirm）
- **2025-09-05**: EmptyTrashModal完全移行完了、実装パターン確立、メモリー統合
- **2025-09-05**: 個別モーダルファイル方式採用、重要な移行手順追加
- **2025-09-05**: `usePageControlsX`と`useSelectedGrant`の移行完了
- **2025-07-30**: ドキュメント統合、進捗の実装状況反映
- **2025-07-XX**: サイドバー関連の移行完了
- **2025-07-XX**: SSRハイドレーション対応完了