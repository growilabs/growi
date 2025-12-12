# PageTree 仕様書

## 概要

GROWIのPageTreeは、`@headless-tree/react` と `@tanstack/react-virtual` を使用したVirtualized Tree実装です。
5000件以上の兄弟ページでも快適に動作するよう設計されています。

---

## 1. アーキテクチャ

### 1.1 ディレクトリ構成

```
src/features/page-tree/
├── index.ts                                # メインエクスポート
├── components/
│   ├── ItemsTree.tsx                       # コアvirtualizedツリーコンポーネント
│   ├── ItemsTree.spec.tsx                  # テスト
│   ├── TreeItemLayout.tsx                  # 汎用ツリーアイテムレイアウト
│   ├── TreeItemLayout.module.scss
│   ├── SimpleItemContent.tsx               # シンプルなアイテムコンテンツ表示
│   ├── SimpleItemContent.module.scss
│   ├── TreeNameInput.tsx                   # リネーム/新規作成用入力コンポーネント
│   ├── _tree-item-variables.scss           # SCSS変数
│   └── index.ts
├── hooks/
│   ├── use-page-rename.tsx                 # Renameビジネスロジック
│   ├── use-page-create.tsx                 # Createビジネスロジック
│   ├── use-page-create.spec.tsx
│   ├── use-page-dnd.tsx                    # Drag & Dropビジネスロジック
│   ├── use-page-dnd.spec.ts
│   ├── use-page-dnd.module.scss            # D&D用スタイル
│   ├── use-placeholder-rename-effect.ts    # プレースホルダーリネームエフェクト
│   ├── use-socket-update-desc-count.ts     # Socket.ioリアルタイム更新フック
│   ├── index.ts
│   └── _inner/
│       ├── use-data-loader.ts              # データローダーフック
│       ├── use-data-loader.spec.tsx
│       ├── use-data-loader.integration.spec.tsx
│       ├── use-scroll-to-selected-item.ts  # スクロール制御フック
│       ├── use-tree-features.ts            # Feature統合フック（checkbox・DnD含む）
│       ├── use-tree-revalidation.ts        # ツリー再検証フック
│       ├── use-tree-item-handlers.tsx      # アイテムハンドラーフック
│       ├── use-auto-expand-ancestors.ts    # 祖先自動展開フック
│       ├── use-auto-expand-ancestors.spec.tsx
│       ├── use-expand-parent-on-create.ts  # 作成時親展開フック
│       ├── use-checkbox.ts                 # チェックボックス状態フック
│       └── index.ts
├── interfaces/
│   └── index.ts                            # TreeItemProps, TreeItemToolProps
├── states/
│   ├── page-tree-update.ts                 # ツリー更新状態（Jotai）
│   ├── page-tree-desc-count-map.ts         # 子孫カウント状態（Jotai）
│   ├── index.ts
│   └── _inner/
│       ├── page-tree-create.ts             # 作成中状態（Jotai）
│       ├── page-tree-create.spec.tsx
│       └── tree-rebuild.ts                 # ツリー再構築状態
├── services/
│   └── page-tree-children.ts               # 子ページ取得サービス
└── constants/
    └── _inner.ts                           # ROOT_PAGE_VIRTUAL_ID
```

### 1.2 Sidebar専用コンポーネント（移動しなかったファイル）

以下は `components/Sidebar/PageTreeItem/` に残留：

- `PageTreeItem.tsx` - Sidebar専用の実装
- `CountBadgeForPageTreeItem.tsx` - PageTree専用バッジ
- `use-page-item-control.tsx` - コンテキストメニュー制御

---

## 2. 主要コンポーネント

### 2.1 ItemsTree

**ファイル**: `features/page-tree/components/ItemsTree.tsx`

Virtualizedツリーのコアコンポーネント。`@headless-tree/react` と `@tanstack/react-virtual` を統合。

#### Props

```typescript
interface ItemsTreeProps {
  // 表示対象のターゲットパスまたはID
  targetPathOrId: string | null;
  // WIPページを表示するか
  isWipPageShown?: boolean;
  // 仮想スクロール用の親要素
  scrollerElem: HTMLElement | null;
  // カスタムTreeItemコンポーネント
  CustomTreeItem?: React.ComponentType<TreeItemProps<IPageForTreeItem>>;
  // チェックボックス機能
  enableCheckboxes?: boolean;
  initialCheckedItems?: string[];
  onCheckedItemsChange?: (checkedItems: IPageForTreeItem[]) => void;
}
```

#### 使用している @headless-tree/core Features

- `asyncDataLoaderFeature` - 非同期データローディング
- `selectionFeature` - 選択機能
- `renamingFeature` - リネーム機能
- `hotkeysCoreFeature` - キーボードショートカット
- `checkboxesFeature` - チェックボックス（オプション）
- `dragAndDropFeature` - ドラッグ&ドロップ（オプション）

#### 重要な実装詳細

1. **データローダー**: `use-data-loader.ts` で既存API（`/page-listing/root`, `/page-listing/children`）を活用
2. **Virtualization**: `@tanstack/react-virtual` の `useVirtualizer` を使用、`overscan: 5` で最適化
3. **初期スクロール**: `scrollToIndex` で選択アイテムまでスクロール

### 2.2 TreeItemLayout

**ファイル**: `features/page-tree/components/TreeItemLayout.tsx`

汎用的なツリーアイテムレイアウト。展開/折りたたみ、アイコン、カスタムコンポーネントを配置。

#### Props

```typescript
interface TreeItemLayoutProps {
  page: IPageForTreeItem;
  level: number;
  isOpen: boolean;
  isSelected: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  // カスタムコンポーネント
  customEndComponents?: React.ReactNode[];
  customHoveredEndComponents?: React.ReactNode[];
  customAlternativeComponents?: React.ReactNode[];
  showAlternativeContent?: boolean;
}
```

#### 自動展開ロジック

```typescript
useEffect(() => {
  if (isExpanded) return;
  const isPathToTarget = page.path != null
    && targetPath.startsWith(addTrailingSlash(page.path))
    && targetPath !== page.path;
  if (isPathToTarget) onToggle?.();
}, [targetPath, page.path, isExpanded, onToggle]);
```

### 2.3 PageTreeItem

**ファイル**: `components/Sidebar/PageTreeItem/PageTreeItem.tsx`

Sidebar用のツリーアイテム実装。TreeItemLayoutを使用し、Rename/Create/Control機能を統合。

#### 機能

- WIPページフィルター
- descendantCountバッジ
- hover時の操作ボタン（duplicate/delete/rename/create）
- リネームモード表示
- 新規作成入力表示（子として）

---

## 3. 機能実装

### 3.1 Rename（ページ名変更）

**実装ファイル**:
- `features/page-tree/hooks/use-page-rename.tsx`
- `features/page-tree/components/TreeNameInput.tsx`

#### 使用方法

```typescript
const { rename, isRenaming, RenameAlternativeComponent } = usePageRename(item);

// TreeItemLayoutに渡す
<TreeItemLayout
  showAlternativeContent={isRenaming(item)}
  customAlternativeComponents={[RenameAlternativeComponent]}
/>
```

#### 操作方法

- **開始**: F2キー or コンテキストメニュー
- **確定**: Enter
- **キャンセル**: Escape

### 3.2 Create（ページ新規作成）

**実装ファイル**:
- `features/page-tree/hooks/use-page-create.tsx`
- `features/page-tree/components/TreeNameInput.tsx`
- `features/page-tree/states/_inner/page-tree-create.ts`

#### 状態管理（Jotai）

```typescript
// page-tree-create.ts
creatingParentIdAtom: 作成中の親ノードID
useCreatingParentId(): 現在の作成中親ID取得
useIsCreatingChild(parentId): 特定アイテムが作成中か判定
usePageTreeCreateActions(): startCreating, cancelCreating
```

#### 使用方法

```typescript
const { isCreatingChild, CreateInputComponent, startCreating } = usePageCreate(item);

// PageTreeItemで使用
{isCreatingChild() && <CreateInputComponent />}
```

#### 操作方法

- **開始**: コンテキストメニューから「作成」を選択
- **確定**: Enter → POST /page API → 新規ページに遷移
- **キャンセル**: Escape or ブラー

### 3.3 Drag and Drop（ページ移動）

**実装ファイル**:
- `features/page-tree/hooks/use-page-dnd.tsx`
- `features/page-tree/hooks/use-page-dnd.module.scss`
- `features/page-tree/hooks/_inner/use-tree-features.ts`

#### 機能概要

ページをドラッグ&ドロップして別のページの子として移動する機能。複数選択D&Dにも対応。

#### 使用方法

```typescript
<ItemsTree
  enableDragAndDrop={true}
  // ...他のprops
/>
```

#### 主要コンポーネント

- `usePageDnd(isEnabled)`: D&Dロジックを提供するフック（`UsePageDndProperties`を返す）
  - `canDrag`: ドラッグ可否判定
  - `canDrop`: ドロップ可否判定
  - `onDrop`: ドロップ時の処理（APIコール、ツリー更新）
  - `renderDragLine`: ドラッグライン描画（treeインスタンスを引数に取る）

**統合方法**:
- `useTreeFeatures`が内部で`usePageDnd`を呼び出し、`dndProperties`として返す
- ItemsTree側で`dndProperties.renderDragLine(tree)`を呼び出してドラッグライン表示

#### バリデーションロジック

**canDrag チェック項目**:
1. 祖先-子孫関係チェック: 選択されたアイテム間に祖先-子孫関係がある場合は禁止
2. 保護ページチェック: `pagePathUtils.isUsersProtectedPages(path)`が`true`の場合は禁止

**canDrop チェック項目**:
1. ユーザートップページチェック: `pagePathUtils.isUsersTopPage(targetPath)`が`true`の場合は禁止
2. 移動可否チェック: `pagePathUtils.canMoveByPath(fromPath, newPath)`で検証

#### エラーハンドリング

- `operation__blocked`エラー: 「このページは現在移動できません」トースト表示
- その他のエラー: 「ページの移動に失敗しました」トースト表示

#### ドロップ処理の流れ

1. 移動APIコール: `/pages/rename`エンドポイントで各ページを新しいパスに移動
2. SWRキャッシュ更新: `mutatePageTree()`でページツリーデータを再取得
3. headless-tree更新: `notifyUpdateItems()`で親ノードの子リストを無効化
4. ターゲット更新: `targetItem.invalidateItemData()`でdescendantCountを再取得
5. 自動展開: `targetItem.expand()`でドロップ先を展開

#### 制限事項

- 並び替え（Reorder）は無効（子として追加のみ）
- キーボードD&Dは非対応

### 3.4 リアルタイム更新（Socket.io統合）

**実装ファイル**:
- `features/page-tree/hooks/use-socket-update-desc-count.ts`
- `features/page-tree/states/page-tree-desc-count-map.ts`
- `features/page-tree/states/page-tree-update.ts`

#### 設計方針

**descendantCountバッジの更新** と **ツリー構造の更新** は別々の関心事として分離：

| 更新タイプ | トリガー | 動作 | 対象 |
|-----------|---------|------|------|
| バッジ更新 | Socket.io `UpdateDescCount` | 数字のみ更新（軽量） | 全祖先 |
| ツリー構造更新 | リロードボタン / 自分の操作後 | 子リスト再取得（重い） | 操作した本人のみ |

**この分離の理由:**
- 大規模環境で多くのユーザーが同時に操作する場合、全員のツリーが頻繁に再構築されるとパフォーマンス問題が発生
- バッジ（数字）の更新は軽量なので全員にリアルタイム反映してもOK
- ツリー構造の変更は操作した本人のウィンドウのみで即時反映し、他ユーザーはリロードボタンで対応

#### 使用方法

`ItemsTree`コンポーネント内で自動的に有効化されます。

```typescript
// ItemsTree.tsx内で呼び出し
useSocketUpdateDescCount();
```

#### 受信イベント

- `UpdateDescCount`: ページの子孫カウント（descendantCount）の更新
  - サーバーからページ作成/削除/移動時に発行される
  - 受信データ（Record形式）をMap形式に変換してJotai stateに保存
  - **バッジ表示のみ更新、ツリー構造は更新しない**

#### 実装詳細

```typescript
export const useSocketUpdateDescCount = (): void => {
  const socket = useGlobalSocket();
  const { update: updatePtDescCountMap } = usePageTreeDescCountMapAction();

  useEffect(() => {
    if (socket == null) return;

    const handler = (data: UpdateDescCountRawData) => {
      // バッジの数字のみ更新（ツリー構造は更新しない）
      const newData: UpdateDescCountData = new Map(Object.entries(data));
      updatePtDescCountMap(newData);
    };

    socket.on(SocketEventName.UpdateDescCount, handler);
    return () => socket.off(SocketEventName.UpdateDescCount, handler);
  }, [socket, updatePtDescCountMap]);
};
```

#### ツリー構造の更新

ツリー構造（子リスト）の更新は以下のタイミングで行われる：

1. **リロードボタン**: `notifyUpdateAllTrees()` を呼び出し、全ツリーを再取得
2. **自分の操作後**: 
   - Create/Delete/Move操作の完了コールバックで `notifyUpdateItems([parentId])` を呼び出し
   - 操作した親ノードの子リストのみ再取得

```typescript
// リロードボタンの例
const { notifyUpdateAllTrees } = usePageTreeInformationUpdate();
const handleReload = () => notifyUpdateAllTrees();

// 操作完了後の例（Create, Delete, Move）
const { notifyUpdateItems } = usePageTreeInformationUpdate();
const handleOperationComplete = (parentId: string) => notifyUpdateItems([parentId]);
```

#### 関連状態

- `page-tree-desc-count-map.ts`: 子孫カウントを管理するJotai atom
  - `usePageTreeDescCountMap()`: カウント取得（バッジ表示用）
  - `usePageTreeDescCountMapAction()`: カウント更新（Socket.ioから）

- `page-tree-update.ts`: ツリー更新を管理するJotai atom
  - `generationAtom`: 更新世代番号
  - `lastUpdatedItemIdsAtom`: 更新対象アイテムID（nullは全体更新）
  - `usePageTreeInformationUpdate()`: 更新通知（notifyUpdateItems, notifyUpdateAllTrees）
  - `usePageTreeRevalidationEffect()`: 更新検知と再取得実行

### 3.5 Checkboxes（AI Assistant用）

**使用箇所**: `AiAssistantManagementPageTreeSelection.tsx`

ItemsTreeのcheckboxesオプションを使用。

#### Props

```typescript
<ItemsTree
  enableCheckboxes={true}
  initialCheckedItems={['page-id-1', 'page-id-2']}
  onCheckedItemsChange={(checkedItems) => {
    // チェック変更時の処理
    // ページパスに `/*` を付加して保存
  }}
/>
```

#### 実装詳細

**フック構成**:
- `useTreeFeatures`: feature設定とチェックボックス・D&D機能を統合管理
- `useCheckbox`: チェックボックス状態管理（`checkedItemIds`, `setCheckedItems`, `createNotifyEffect`）
- `createNotifyEffect`: 親コンポーネントへの変更通知用ヘルパー関数を提供

**循環依存の回避**:
- `useTreeFeatures`はtreeインスタンスに依存しない
- `createNotifyEffect`がtreeインスタンスとコールバックを受け取り、useEffectのコールバック関数を返す
- ItemsTree側で`useEffect(createNotifyEffect(tree, onCheckedItemsChange), [createNotifyEffect, tree])`を呼び出す

**設定**:
- `checkboxesFeature` を条件付きで追加
- `propagateCheckedState: false` で子への伝播を無効化
- `canCheckFolders: true` でフォルダもチェック可能

---

## 4. バックエンドAPI

### 4.1 使用エンドポイント

```
GET /page-listing/root
→ ルートページ "/" のデータ

GET /page-listing/children?id={pageId}
→ 指定ページの直下の子のみ

GET /page-listing/item?id={pageId}
→ 単一ページデータ（新規追加）
```

### 4.2 IPageForTreeItem インターフェース

```typescript
interface IPageForTreeItem {
  _id: string;
  path: string;
  parent?: string;
  descendantCount: number;
  revision?: string;
  grant: PageGrant;
  isEmpty: boolean;
  wip: boolean;
  processData?: IPageOperationProcessData;
}
```

---

## 5. @headless-tree/react 基礎知識

### 5.1 データ構造

- **IDベースの参照**: ツリーアイテムは文字列IDで識別
- **フラット構造を推奨**: dataLoaderで親子関係を定義
- **ジェネリック型対応**: `useTree<IPageForTreeItem>` でカスタム型を指定

### 5.2 非同期データローダー

```typescript
const tree = useTree<IPageForTreeItem>({
  rootItemId: "root",
  dataLoader: {
    getItem: async (itemId) => await api.fetchItem(itemId),
    getChildren: async (itemId) => await api.fetchChildren(itemId),
  },
  createLoadingItemData: () => ({ /* loading state */ }),
  features: [asyncDataLoaderFeature],
});
```

#### キャッシュの無効化

```typescript
const item = tree.getItemInstance("item1");
item.invalidateItemData();      // アイテムデータの再取得
item.invalidateChildrenIds();   // 子IDリストの再取得
```

### 5.3 Virtualization統合

```typescript
const items = tree.getItems(); // フラット化されたアイテムリスト

const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollElementRef.current,
  estimateSize: () => 32,
  overscan: 5,
});
```

### 5.4 主要API

#### Tree インスタンス
- `tree.getItems()`: フラット化されたツリーアイテムのリスト
- `tree.getItemInstance(id)`: IDからアイテムインスタンスを取得
- `tree.getContainerProps()`: ツリーコンテナのprops（ホットキー有効化に必須）
- `tree.rebuildTree()`: ツリー構造を再構築

#### Item インスタンス
- `item.getProps()`: アイテム要素のprops
- `item.getId()`: アイテムID
- `item.getItemData()`: カスタムペイロード（IPageForTreeItem）
- `item.getItemMeta()`: メタデータ（level, indexなど）
- `item.isFolder()`: フォルダかどうか
- `item.isExpanded()`: 展開されているか
- `item.expand()` / `item.collapse()`: 展開/折りたたみ
- `item.startRenaming()`: リネームモード開始
- `item.isRenaming()`: リネーム中か判定

---

## 6. パフォーマンス最適化

### 6.1 headless-tree のキャッシュ無効化と再取得

#### 重要な知見

`@headless-tree/core` の `asyncDataLoaderFeature` は内部キャッシュを持ち、`invalidateChildrenIds()` メソッドでキャッシュを無効化できます。

**invalidateChildrenIds(optimistic?: boolean) の動作:**

```typescript
// 内部実装（feature.ts より）
invalidateChildrenIds: async ({ tree, itemId }, optimistic) => {
  if (!optimistic) {
    delete getDataRef(tree).current.childrenIds?.[itemId];  // キャッシュ削除
  }
  await loadChildrenIds(tree, itemId);  // データ再取得
  // loadChildrenIds 内で自動的に tree.rebuildTree() が呼ばれる
};
```

**optimistic パラメータの影響:**

| パラメータ | 動作 | 用途 |
|-----------|------|------|
| `false` (デフォルト) | ローディング状態を更新、再レンダリングをトリガー | 最後の呼び出しに使用 |
| `true` | ローディング状態を更新しない、古いデータを表示し続ける | バッチ処理の途中に使用 |

**パフォーマンス最適化パターン:**

```typescript
// ❌ 非効率: 全アイテムに optimistic=false
items.forEach(item => item.invalidateChildrenIds(false));
// → 各呼び出しで rebuildTree() が実行され、N回の再構築が発生

// ✅ 効率的: 展開済みアイテムのみ対象、最後だけ optimistic=false
const expandedItems = tree.getItems().filter(item => item.isExpanded());
expandedItems.forEach(item => item.invalidateChildrenIds(true));  // 楽観的
rootItem.invalidateChildrenIds(false);  // 最後に1回だけ再構築
```

**実際の実装 (page-tree-update.ts):**

```typescript
useEffect(() => {
  if (globalGeneration <= generation) return;

  const shouldUpdateAll = globalLastUpdatedItemIds == null;

  if (shouldUpdateAll) {
    // pendingリクエストキャッシュをクリア
    invalidatePageTreeChildren();

    // 展開済みアイテムのみ楽観的に無効化（rebuildTree回避）
    const expandedItems = tree.getItems().filter(item => item.isExpanded());
    expandedItems.forEach(item => item.invalidateChildrenIds(true));

    // ルートのみ optimistic=false で再構築トリガー
    getItemInstance(ROOT_PAGE_VIRTUAL_ID)?.invalidateChildrenIds(false);
  } else {
    // 部分更新: 指定アイテムのみ
    invalidatePageTreeChildren(globalLastUpdatedItemIds);
    globalLastUpdatedItemIds.forEach(itemId => {
      getItemInstance(itemId)?.invalidateChildrenIds(false);
    });
  }

  onRevalidatedRef.current?.();
}, [globalGeneration, generation, getItemInstance, globalLastUpdatedItemIds, tree]);
```

#### 注意事項

1. **invalidateChildrenIds は async 関数** - Promise を返すが、await しなくても動作する
2. **loadChildrenIds 完了後に自動で rebuildTree()** - 明示的な呼び出し不要
3. **optimistic=true でもデータは再取得される** - ただしローディングUIは表示されない
4. **tree.getItems() は表示中のアイテムのみ** - 折りたたまれた子は含まれない

### 6.2 Virtualization

- **100k+アイテムでテスト済み**
- `overscan: 5` で表示範囲外の先読み
- `estimateSize: 32` でアイテム高さを推定

### 6.3 非同期データローダーのキャッシング

- asyncDataLoaderFeatureが自動キャッシング
- 展開済みアイテムは再取得なし
- `invalidateChildrenIds()` で明示的に無効化可能

### 6.4 ツリー更新

```typescript
// Jotai atomでツリー更新を通知
const { notifyUpdateItems } = usePageTreeInformationUpdate();
notifyUpdateItems(updatedPages);

// SWRでページデータを再取得
const { mutate: mutatePageTree } = useSWRxPageTree();
await mutatePageTree();
```

---

## 7. 実装済み機能

- ✅ Virtualizedツリー表示
- ✅ 展開/折りたたみ
- ✅ ページ遷移（クリック）
- ✅ 選択状態表示
- ✅ WIPページフィルター
- ✅ descendantCountバッジ
- ✅ hover時の操作ボタン
- ✅ 選択ページまでの自動展開
- ✅ 選択ページへの初期スクロール
- ✅ Rename（F2、コンテキストメニュー）
- ✅ Create（コンテキストメニュー）
- ✅ Duplicate（hover時ボタン）
- ✅ Delete（hover時ボタン）
- ✅ Checkboxes（AI Assistant用）
- ✅ Drag and Drop（ページ移動）
- ✅ リアルタイム更新（Socket.io統合）

---

## 8. 未実装機能

なし（全機能実装済み）

---

## 9. 参考リンク

- @headless-tree/react 公式ドキュメント: https://headless-tree.lukasbach.com/
- GitHub: https://github.com/lukasbach/headless-tree
- @tanstack/react-virtual: https://tanstack.com/virtual/latest

---

## 10. 改修時の注意点

### 10.1 ホットキーサポート

`hotkeysCoreFeature` と `getContainerProps()` の組み合わせが必須。
`getContainerProps()` がないとホットキーが動作しない。

### 10.2 ツリー更新の通知

操作完了後は以下を呼び出す：
1. `mutatePageTree()` - SWRでデータ再取得
2. `notifyUpdateItems()` - Jotai atomで更新通知

### 10.3 旧実装について

以下のファイルはTypeScriptエラーあり（許容）：
- `ItemsTree.tsx` - 旧実装
- `PageTreeItem.tsx` - 旧Sidebar用
- `TreeItemForModal.tsx` - 旧Modal用

---

## 更新履歴

- 2025-11-10: 初版作成（Virtualization計画）
- 2025-11-28: Rename/Create実装完了、ディレクトリ再編成
- 2025-12-05: 仕様書として統合
- 2025-12-08: Drag and Drop実装完了、ディレクトリ構成更新
- 2025-12-08: リアルタイム更新（Socket.io統合）実装完了
- 2025-12-08: headless-tree キャッシュ無効化の知見を追加（invalidateChildrenIds の optimistic パラメータ）
- 2025-12-08: Socket.io更新の設計方針を明確化（バッジ更新とツリー構造更新の分離）
- 2025-12-09: useTreeFeaturesリファクタリング完了（checkboxとDnD機能を統合、循環依存を回避）
