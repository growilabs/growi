# モーダル系コンポーネント パフォーマンス最適化ガイド Version3

## 前提: V2完了状況

**完了日**: 2025-10-15  
**達成**: 46/51モーダル (90%) - Container-Presentation分離完了

### V2の主要成果
1. **Container超軽量化**: 6-15行 (最大85%削減)
2. **Fadeout transition修正**: 全25モーダル
3. **計算処理メモ化**: useMemo/useCallback適用

**詳細**: `apps-app-modal-performance-optimization-v2-completion-summary.md`

---

## 目的

- V2で最適化されたモーダル群について、さらに動的ロード最適化を行う
- モーダル動的ロードに関するリファクタリングガイドである
- Pages Routerにおけるモーダルコンポーネントの遅延ロードを実現し、初期ページロード時のバンドルサイズを削減する

## 問題点

### 現在の状況
- `dynamic()` を使用してもgetLayout内でコンポーネントを配置しているため、ページロード時にすべてのモーダルchunkがダウンロードされる
- 大きなchunkが初期ロード時に不要にダウンロードされる
- 使用頻度の低いモーダルも初期ロード対象となっている

### 理想の動作
- モーダルを開く操作を行った際に初めてchunkがダウンロードされる
- 初期ページロード時のバンドルサイズが削減される

## 解決策

### アーキテクチャ
1. **useDynamicModalLoader**: 汎用的な動的ローディングフック
2. **グローバルキャッシュ**: 同じimportの重複実行防止
3. **責務の分離**: モーダルロジックと動的ローディングロジックの分離

## 実装

### 1. 汎用ローダーの作成

**ファイル**: `apps/app/client/util/use-dynamic-modal-loader.ts`

```tsx
import { useState, useEffect, useCallback } from 'react';

// グローバルキャッシュ
const modalCache = new Map<string, Promise<any>>();

const getCachedImport = <T>(
  key: string,
  importFn: () => Promise<{ default: React.ComponentType<T> }>
): Promise<{ default: React.ComponentType<T> }> => {
  if (!modalCache.has(key)) {
    modalCache.set(key, importFn());
  }
  return modalCache.get(key)!;
};

export const useDynamicModalLoader = <T extends {}>(
  importKey: string,
  importFn: () => Promise<{ default: React.ComponentType<T> }>,
  isOpen: boolean
) => {
  const [Component, setComponent] = useState<React.ComponentType<T> | null>(null);

  const memoizedImportFn = useCallback(importFn, [importKey]);

  useEffect(() => {
    if (isOpen && !Component) {
      getCachedImport(importKey, memoizedImportFn)
        .then(mod => setComponent(() => mod.default));
    }
  }, [isOpen, Component, importKey, memoizedImportFn]);

  return Component;
};
```

### 2. ディレクトリ構造

```
apps/app/.../[ModalName]/
├── index.ts           # エクスポート用
├── [ModalName].ts     # 実際のモーダルコンポーネント
└── dynamic.ts         # 動的ローダー
```

## リファクタリング手順

### ステップ 1: ディレクトリ構造の変更

既存の単一ファイルを以下のように分割：

```
Before:  TemplateModal/
        ├── index.ts
        └── TemplateModal.ts
After:  TemplateModal/
        ├── index.ts
        ├── TemplateModal.ts
        └── dynamic.ts
```

### ステップ 2: モーダルコンポーネントの分離

**Before** (TemplateModal.ts):
```tsx
const TemplateModalSubstance = (props) => { /* heavy component */ };
export const TemplateModal = () => { /* wrapper with useTemplateModal */ };
```

**After** (TemplateModal/TemplateModal.ts):
```tsx
// TemplateModalSubstance を TemplateModal に改名
export const TemplateModal = (props: TemplateModalProps) => {
  // heavy component の実装
};
```

### ステップ 3: 動的ローダーの作成

**ファイル**: `TemplateModal/dynamic.ts`

```tsx
import React from 'react';
import { Modal } from 'reactstrap';
import { useDynamicModalLoader } from '~/utils/use-dynamic-modal-loader';
import { useTemplateModal } from '~/hooks/useTemplateModal';

export const TemplateModalDynamic = (): JSX.Element => {
  const { data: templateModalStatus, close } = useTemplateModal();
  
  const TemplateModal = useDynamicModalLoader(
    'template-modal',
    () => import('./TemplateModal').then(mod => ({ default: mod.TemplateModal })),
    templateModalStatus?.isOpened ?? false
  );

  if (templateModalStatus == null) {
    return <></>;
  }

  return (
    <Modal 
      className="template-modal" 
      isOpen={templateModalStatus.isOpened} 
      toggle={close} 
      size="xl" 
      autoFocus={false}
    >
      {templateModalStatus.isOpened && TemplateModal && (
        <TemplateModal templateModalStatus={templateModalStatus} close={close} />
      )}
    </Modal>
  );
};
```

### ステップ 4: エクスポートファイルの更新

**ファイル**: `TemplateModal/index.ts`

```tsx
export { TemplateModalDynamic as TemplateModal } from './dynamic';
```

## チェックリスト

### 実装確認項目
- [ ] `useDynamicModalLoader` フックが作成済み
- [ ] モーダルディレクトリが作成済み（index.ts, [Modal].ts, dynamic.ts）
- [ ] 実際のモーダルコンポーネントが分離済み
- [ ] 動的ローダーが `useDynamicModalLoader` を使用
- [ ] エクスポートファイルが正しく設定済み

### 動作確認項目
- [ ] ページ初回ロード時にモーダルchunkがダウンロードされない
- [ ] モーダルを開いた際に初めてchunkがダウンロードされる
- [ ] 同じモーダルを再度開いても重複ダウンロードされない
- [ ] モーダルが正常に表示・動作する
- [ ] TypeScriptエラーが発生しない

## 注意点

### パフォーマンス
- グローバルキャッシュにより同じimportは1度だけ実行される
- メモ化により不要な再レンダリングを防ぐ

### 型安全性
- ジェネリクスを使用して型安全性を保持
- 既存のProps型は変更不要

### 開発体験
- 既存のインポートパスは変更不要
- 各モーダルの状態管理ロジックは維持

## 他のモーダルへの適用

同じパターンを、使用頻度が高いとはいえないモーダルに関して適用する

1. LinkEditModal
2. TagEditModal
3. ConflictDiffModal
4. その他の使用頻度が高いとはいえないモーダルコンポーネント

各モーダルで `importKey` を一意にし、適切な状態管理フックを使用することで同様の効果を得られる。