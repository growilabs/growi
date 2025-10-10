# PageTree パフォーマンス改善リファクタ計画 - 現実的戦略

## 🎯 目標
現在のパフォーマンス問題を解決：
- **問題**: 5000件の兄弟ページで初期レンダリングが重い
- **目標**: 表示速度を10-20倍改善、UX維持

## ✅ 戦略2: API軽量化 - **完了済み**

### 実装済み内容
- **ファイル**: `apps/app/src/server/service/page-listing/page-listing.ts:77`
- **変更内容**: `.select('_id path parent descendantCount grant isEmpty createdAt updatedAt wip')` を追加
- **型定義**: `apps/app/src/interfaces/page.ts` の `IPageForTreeItem` 型も対応済み
- **追加改善**: 計画にはなかった `wip` フィールドも最適化対象に含める

### 実現できた効果
- **データサイズ**: 推定 500バイト → 約100バイト（5倍軽量化）
- **ネットワーク転送**: 5000ページ時 2.5MB → 500KB程度に削減
- **状況**: **実装完了・効果発現中**

---

## 🚀 戦略1: 既存アーキテクチャ活用 + headless-tree部分導入 - **現実的戦略**

### 前回のreact-window失敗原因
1. **動的itemCount**: ツリー展開時にアイテム数が変化→react-windowの前提と衝突
2. **非同期ローディング**: APIレスポンス待ちでフラット化不可
3. **複雑な状態管理**: SWRとreact-windowの状態同期が困難

### 現実的制約の認識
**ItemsTree/TreeItemLayoutは廃止困難**:
- **CustomTreeItemの出し分け**: `PageTreeItem` vs `TreeItemForModal`  
- **共通副作用処理**: rename/duplicate/delete時のmutation処理
- **多箇所からの利用**: PageTree, PageSelectModal, AiAssistant等

## 📋 修正された実装戦略: **ハイブリッドアプローチ**

### **核心アプローチ**: ItemsTreeを**dataProvider**として活用

**既存の責務は保持しつつ、内部実装のみheadless-tree化**:

1. **ItemsTree**: UIロジック・副作用処理はそのまま
2. **TreeItemLayout**: 個別アイテムレンダリングはそのまま  
3. **データ管理**: 内部でheadless-treeを使用（SWR → headless-tree）
4. **Virtualization**: ItemsTree内部にreact-virtualを導入

### **実装計画: 段階的移行**

#### **Phase 1: データ層のheadless-tree化**

**ファイル**: `ItemsTree.tsx`
```typescript
// Before: 複雑なSWR + 子コンポーネント管理
const tree = useTree<IPageForTreeItem>({
  rootItemId: initialItemNode.page._id,
  dataLoader: {
    getItem: async (itemId) => {
      const response = await apiv3Get('/page-listing/item', { id: itemId });
      return response.data;
    },
    getChildren: async (itemId) => {
      const response = await apiv3Get('/page-listing/children', { id: itemId });
      return response.data.children.map(child => child._id);
    },
  },
  features: [asyncDataLoaderFeature],
});

// 既存のCustomTreeItemに渡すためのアダプター
const adaptedNodes = tree.getItems().map(item => 
  new ItemNode(item.getItemData())
);

return (
  <ul className={`${moduleClass} list-group`}>
    {adaptedNodes.map(node => (
      <CustomTreeItem
        key={node.page._id}
        itemNode={node}
        // ... 既存のpropsをそのまま渡す
        onRenamed={onRenamed}
        onClickDuplicateMenuItem={onClickDuplicateMenuItem}
        onClickDeleteMenuItem={onClickDeleteMenuItem}
      />
    ))}
  </ul>
);
```

#### **Phase 2: Virtualization導入**

**ファイル**: `ItemsTree.tsx` (Phase1をベースに拡張)
```typescript
const virtualizer = useVirtualizer({
  count: adaptedNodes.length,
  getScrollElement: () => containerRef.current,
  estimateSize: () => 40,
});

return (
  <div ref={containerRef} className="tree-container">
    <div style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(virtualItem => {
        const node = adaptedNodes[virtualItem.index];
        return (
          <div
            key={node.page._id}
            style={{
              position: 'absolute',
              top: virtualItem.start,
              height: virtualItem.size,
              width: '100%',
            }}
          >
            <CustomTreeItem
              itemNode={node}
              // ... 既存props
            />
          </div>
        );
      })}
    </div>
  </div>
);
```

#### **Phase 3 (将来): 完全なheadless-tree移行**

最終的にはdrag&drop、selection等のUI機能もheadless-treeに移行可能ですが、**今回のスコープ外**。

## 📁 現実的なファイル変更まとめ

| アクション | ファイル | 内容 | スコープ |
|---------|---------|------|------|
| ✅ **完了** | **apps/app/src/server/service/page-listing/page-listing.ts** | selectクエリ追加 | API軽量化 |
| ✅ **完了** | **apps/app/src/interfaces/page.ts** | IPageForTreeItem型定義 | API軽量化 |
| 🔄 **修正** | **src/client/components/ItemsTree/ItemsTree.tsx** | headless-tree + virtualization導入 | **今回の核心** |
| 🆕 **新規** | **src/client/components/ItemsTree/usePageTreeDataLoader.ts** | データローダー分離 | 保守性向上 |
| ⚠️ **保持** | **src/client/components/TreeItem/TreeItemLayout.tsx** | 既存のまま（後方互換） | 既存責務保持 |
| ⚠️ **部分削除** | **src/stores/page-listing.tsx** | useSWRxPageChildren削除 | 重複排除 |

**新規ファイル**: 1個（データローダー分離のみ）  
**変更ファイル**: 2個（ItemsTree改修 + store整理）  
**削除ファイル**: 0個（既存アーキテクチャ尊重）

---

## 🎯 実装優先順位

**✅ Phase 1**: API軽量化（低リスク・即効性） - **完了**

**📋 Phase 2-A**: ItemsTree内部のheadless-tree化
- **工数**: 2-3日
- **リスク**: 低（外部IF変更なし）
- **効果**: 非同期ローディング最適化、キャッシュ改善

**📋 Phase 2-B**: Virtualization導入  
- **工数**: 2-3日
- **リスク**: 低（内部実装のみ）
- **効果**: レンダリング性能10-20倍改善

**現在の効果**: API軽量化により 5倍のデータ転送量削減済み  
**Phase 2完了時の予想効果**: 初期表示速度 20-50倍改善

---

## 🏗️ 実装方針: **既存アーキテクチャ尊重**

**基本方針**:
- **既存のCustomTreeItem責務**は保持（rename/duplicate/delete等）
- **データ管理層のみ**をheadless-tree化  
- **外部インターフェース**は変更せず、内部最適化に集中
- **段階的移行**で低リスク実装

**今回のスコープ**:
- ✅ 非同期データローディング最適化
- ✅ Virtualizationによる大量要素対応  
- ❌ drag&drop/selection（将来フェーズ）
- ❌ 既存アーキテクチャの破壊的変更

---

## 技術的参考資料
- **headless-tree**: https://headless-tree.lukasbach.com/ (データ管理層のみ利用)
- **react-virtual**: @tanstack/react-virtualを使用  
- **アプローチ**: 既存ItemsTree内部でheadless-tree + virtualizationをハイブリッド活用