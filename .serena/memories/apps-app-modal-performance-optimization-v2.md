# モーダル系コンポーネント パフォーマンス最適化ガイド Version2

## 概要

モーダル系コンポーネントは通常時は非表示状態であるにも関わらず、不適切な実装により常時リソースを消費している場合があります。本ドキュメントは、モーダルコンポーネントのパフォーマンス最適化の指針と具体的な手法を提供します。

## 最適化の要否の評価基準

### 高優先度（必須対応）

以下の条件に**複数該当**する場合は、必ず最適化を実施してください：

- ✅ **重い計算処理**: `useMemo`を使わずに毎レンダリングで配列操作（filter、map、reduce等）を実行
- ✅ **外部データフェッチ**: SWRやカスタムフックによるAPI呼び出しが常時発生
- ✅ **多数のフック**: useState、useEffect、useCallbackが5個以上存在
- ✅ **インライン関数**: イベントハンドラーが関数宣言で定義されている
- ✅ **複雑な条件分岐**: レンダリング時に重い条件判定を実行

### 中優先度（推奨対応）

以下の条件に該当する場合は、開発工数と効果を検討して対応を判断：

- 🔶 **軽微な計算処理**: 単純な文字列操作や数値計算を毎レンダリングで実行
- 🔶 **少数のフック**: useState、useEffect、useCallbackが2-4個存在
- 🔶 **モーダル表示頻度**: ユーザーが頻繁に開閉するモーダル

### 低優先度（対応不要）

以下のような単純なモーダルは最適化不要：

- ⚪ **静的コンテンツのみ**: テキストやボタンのみで計算処理なし
- ⚪ **最小限のフック**: useState 1-2個程度のシンプルな実装
- ⚪ **使用頻度が低い**: エラー表示など限定的な用途

## 主要なパフォーマンス問題パターン

### 1. コンテナ・プレゼンテーション分離の欠如

**❌ 問題のあるパターン**
```typescript
const MyModal: FC = () => {
  const { isOpen } = useModalStatus();
  
  // モーダルが閉じていても以下が常に実行される
  const heavyData = useMemo(() => processHeavyData(data), [data]);
  const { data: apiData } = useSWR('/api/data');
  
  return (
    <Modal isOpen={isOpen}>
      {/* 内容 */}
    </Modal>
  );
};
```

**✅ 最適化されたパターン**
```typescript
const MyModalSubstance: FC = () => {
  // 重い処理はモーダルが開いている時のみ実行される
  const heavyData = useMemo(() => processHeavyData(data), [data]);
  const { data: apiData } = useSWR('/api/data');
  
  return (
    <>
      <ModalHeader>...</ModalHeader>
      <ModalBody>...</ModalBody>
      <ModalFooter>...</ModalFooter>
    </>
  );
};

const MyModal: FC = () => {
  const { isOpen } = useModalStatus();
  
  if (!isOpen) {
    return <></>;  // 早期リターンで不要な処理を完全回避
  }
  
  return (
    <Modal isOpen={isOpen}>
      <MyModalSubstance />
    </Modal>
  );
};
```

### 2. 計算処理の最適化不足

**❌ 問題のあるパターン**
```typescript
// 毎レンダリングで実行される重い計算
const filteredItems = items.filter(item => item.status === 'active');
const processedData = filteredItems.map(item => transformItem(item));
const targetPath = clickedItem?.path || defaultPath;
```

**✅ 最適化されたパターン**
```typescript
const filteredItems = useMemo(() => 
  items.filter(item => item.status === 'active'), 
  [items]
);

const processedData = useMemo(() => 
  filteredItems.map(item => transformItem(item)), 
  [filteredItems]
);

const targetPath = useMemo(() => 
  clickedItem?.path || defaultPath, 
  [clickedItem, defaultPath]
);
```

### 3. イベントハンドラーの最適化不足

**❌ 問題のあるパターン**
```typescript
// 毎レンダリングで新しい関数が作成される
function handleSubmit() {
  // 処理
}

function handleCancel() {
  closeModal();
}
```

**✅ 最適化されたパターン**
```typescript
const handleSubmit = useCallback(() => {
  // 処理
}, [dependencies]);

const handleCancel = useCallback(() => {
  closeModal();
}, [closeModal]);
```

### 4. レンダリング関数の最適化不足

**❌ 問題のあるパターン**
```typescript
const renderItems = () => {
  const displayItems = items.length > 0 ? items : defaultItems;
  return displayItems.map(item => <ItemComponent key={item.id} item={item} />);
};

return (
  <Modal>
    {renderItems()}
  </Modal>
);
```

**✅ 最適化されたパターン**
```typescript
const displayItems = useMemo(() => 
  items.length > 0 ? items : defaultItems, 
  [items, defaultItems]
);

const renderedItems = useMemo(() =>
  displayItems.map(item => <ItemComponent key={item.id} item={item} />),
  [displayItems]
);

return (
  <Modal>
    {renderedItems}
  </Modal>
);
```

### 5. JSX.Element依存関係の問題

**❌ 問題のあるパターン**
```typescript
const renderContent = useMemo(() => (
  <div>{processData(data)}</div>
), [data]);

const bodyContent = useMemo(() => (
  <ModalBody>
    {renderContent}  // JSX.Element型をdependencyに使用
  </ModalBody>
), [renderContent]); // 毎回新しい参照で無効化される
```

**✅ 最適化されたパターン**
```typescript
const bodyContent = useMemo(() => {
  // 内部で直接処理を統合
  const processedContent = processData(data);
  return (
    <ModalBody>
      <div>{processedContent}</div>
    </ModalBody>
  );
}, [data]); // 原始値による正確なメモ化判定
```

### **重要** メモ化の判断基準

ただし、過度なメモ化は避ける

- ✅ 重い計算処理: useMemoで保護
- ✅ 複雑なオブジェクト構築: useMemoで保護
- ✅ 外部依存のあるハンドラ: useCallbackで保護
- ✅ **JSX.Element型の統合**: 分離せずに内部で直接処理
- ❌ 単純な条件分岐: メモ化不要
- ❌ 軽量なsetter関数: useCallback不要
- ❌ **JSX.Element型のdependency**: 参照型による無効化を避ける



## 最適化チェックリスト

### 🔍 診断フェーズ

- [ ] モーダルが閉じている状態でのフック実行数を確認
- [ ] React DevTools Profilerでレンダリング回数を測定
- [ ] Network タブで不要なAPI呼び出しがないか確認
- [ ] コンソールで不要なログ出力がないか確認

### 🚀 実装フェーズ

#### 必須対応項目
- [ ] **コンテナ・プレゼンテーション分離**: 早期リターンによる完全な処理回避を実装
- [ ] **計算処理のメモ化**: 配列操作や文字列処理のうち、メモ化すべきと判断したものを `useMemo` でラップ
- [ ] **イベントハンドラーのメモ化**: イベントハンドラーのうち、メモ化すべきと判断したものを `useCallback` でラップ
- [ ] **外部依存関数の安定化**: 親から渡される関数の依存関係を明確化
- [ ] **JSX.Element依存関係の排除**: 参照型dependency回避のため内部統合を実装

#### 推奨対応項目
- [ ] **レンダリング関数の最適化**: 条件付きレンダリングを事前計算
- [ ] **状態の適切な初期化**: useEffect での状態リセット処理を最適化
- [ ] **型安全性の向上**: 分離後のコンポーネントでのnon-null assertionを活用

### 🧪 検証フェーズ

- [ ] **レンダリング回数の削減**: React DevTools Profilerで改善を確認
- [ ] **メモリ使用量の削減**: 閉じた状態でのヒープ使用量を確認
- [ ] **ネットワークリクエストの削減**: 不要なAPI呼び出しの停止を確認
- [ ] **ユーザー体験の向上**: モーダル開閉速度の改善を確認

## 実装テンプレート

### 基本的なモーダル分離パターン

```typescript
// Substance: 実際のモーダル内容（重い処理を含む）
const MyModalSubstance: FC = () => {
  const { data, opts } = useMyModalStatus()!; // 非null確定
  const { close } = useMyModalActions();
  
  // 重い処理はここで実行（モーダルが開いている時のみ）
  const processedData = useMemo(() => 
    heavyProcessing(data), 
    [data]
  );
  
  const handleAction = useCallback((item: Item) => {
    // アクション処理
    opts?.onAction?.(item);
    close();
  }, [opts?.onAction, close]);
  
  return (
    <>
      <ModalHeader toggle={close}>タイトル</ModalHeader>
      <ModalBody>
        {processedData.map(item => (
          <ItemComponent key={item.id} item={item} onAction={handleAction} />
        ))}
      </ModalBody>
      <ModalFooter>
        <Button onClick={close}>キャンセル</Button>
      </ModalFooter>
    </>
  );
};

// Container: モーダルの表示制御のみ
export const MyModal: FC = () => {
  const { isOpen } = useMyModalStatus() ?? {};
  const { close } = useMyModalActions();
  
  if (!isOpen) {
    return <></>;
  }
  
  return (
    <Modal isOpen={isOpen} toggle={close}>
      <MyModalSubstance />
    </Modal>
  );
};
```

### 複雑なデータ処理を含むモーダルパターン

```typescript
const ComplexModalSubstance: FC = () => {
  const { items, filters, opts } = useComplexModalStatus()!;
  const { close } = useComplexModalActions();
  
  // Step 1: 基本フィルタリング
  const filteredItems = useMemo(() => 
    items.filter(item => applyFilters(item, filters)),
    [items, filters]
  );
  
  // Step 2: 権限チェック
  const accessibleItems = useMemo(() =>
    filteredItems.filter(item => hasPermission(item)),
    [filteredItems]
  );
  
  // Step 3: ソート・グループ化
  const organizedItems = useMemo(() => 
    groupAndSort(accessibleItems),
    [accessibleItems]
  );
  
  // イベントハンドラー群
  const handleSelect = useCallback((item: Item) => {
    opts?.onSelect?.(item);
    close();
  }, [opts?.onSelect, close]);
  
  const handleBulkAction = useCallback((action: string) => {
    const selectedItems = organizedItems.filter(item => item.selected);
    opts?.onBulkAction?.(action, selectedItems);
    close();
  }, [organizedItems, opts?.onBulkAction, close]);
  
  return (
    <>
      <ModalHeader toggle={close}>複雑なモーダル</ModalHeader>
      <ModalBody>
        <ComplexContent 
          items={organizedItems}
          onSelect={handleSelect}
          onBulkAction={handleBulkAction}
        />
      </ModalBody>
      <ModalFooter>
        <ActionButtons onBulkAction={handleBulkAction} />
      </ModalFooter>
    </>
  );
};
```

## 測定・監視のベストプラクティス

### 開発時の測定
```bash
# React DevTools Profilerを使用
# 1. モーダル閉じた状態でのベースライン測定
# 2. モーダル開いた状態での差分測定
# 3. 最適化前後での比較

# Performance.measureUserTiming API活用例
performance.mark('modal-render-start');
// レンダリング処理
performance.mark('modal-render-end');
performance.measure('modal-render', 'modal-render-start', 'modal-render-end');
```

### 本番環境での監視
- **Core Web Vitals**: FCP、LCP への影響を測定
- **カスタムメトリクス**: モーダル開閉時間、レンダリング回数
- **エラー監視**: メモリリークやパフォーマンス劣化の検知

## まとめ

モーダル系コンポーネントのパフォーマンス最適化は、**段階的なアプローチ**が重要です：

### 🏃‍♂️ **Phase 1: 基本最適化（必須・全モーダル対象）**
- **コンテナ・プレゼンテーション分離**: 早期リターンによる完全な処理回避
- **適切なメモ化**: useMemo、useCallbackによる不要な再計算・再生成の回避
    - ただし過度なメモ化をさけるためメモ化するかどうかの判断は適切に

### 🚀 **Phase 2: 高度な最適化（条件次第で効果的）**
- **Dynamic Import**: バンドル削減と初期読み込み速度向上
- **プリロード戦略**: UXを損なわずにCode Splittingの効果を最大化

### ⚠️ **実装時の重要な注意点**

1. **技術的判断vs UX判断の区別**
   - バンドルサイズ・使用頻度：技術的に測定可能
   - 応答速度の期待値・ユーザー体験：**必ずステークホルダーに確認**

2. **測定による検証**
   - 最適化前後の具体的な数値比較を実施
   - React DevTools Profiler、webpack-bundle-analyzerの活用

3. **段階的実装**
   - 高効果期待の重要モーダルから開始
   - 効果を測定しながら対象を拡大

特に**Dynamic Importの適用判断**では、技術的メトリクス（バンドルサイズ、使用頻度）は客観的に測定できますが、**ユーザー体験への影響は主観的**です。リファクタ前に必ず関係者との合意形成を行い、適切なフォールバック（プリロード、スケルトン表示等）を実装することを強く推奨します。

最適化実施時は、必ず事前・事後の測定を行い、実際のパフォーマンス改善とユーザー体験の両面を数値で確認することが成功の鍵となります。