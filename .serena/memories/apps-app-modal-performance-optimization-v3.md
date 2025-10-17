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
1. **useLazyLoader**: 汎用的な動的ローディングフック (コンポーネントのアクティブ/非アクティブ状態に応じて動的ロード)
2. **グローバルキャッシュ**: 同じimportの重複実行防止
3. **責務の分離**: モーダルロジックと動的ローディングロジックの分離
4. **Named Export**: コード可読性とメンテナンス性のため、named exportを標準とする

## 実装

### 1. 汎用ローダーの作成

**ファイル**: `apps/app/src/client/util/use-lazy-loader.ts`

```tsx
import { useState, useEffect, useCallback } from 'react';

// Global cache for dynamically loaded components
const componentCache = new Map<string, Promise<any>>();

/**
 * Get cached import or execute new import
 */
const getCachedImport = <T extends Record<string, unknown>>(
  key: string,
  importFn: () => Promise<{ default: React.ComponentType<T> }>,
): Promise<{ default: React.ComponentType<T> }> => {
  if (!componentCache.has(key)) {
    componentCache.set(key, importFn());
  }
  return componentCache.get(key)!;
};

/**
 * Clear the component cache for a specific key or all keys
 * Useful for testing or force-reloading components
 */
export const clearComponentCache = (key?: string): void => {
  if (key) {
    componentCache.delete(key);
  }
  else {
    componentCache.clear();
  }
};

/**
 * Dynamically loads a component when it becomes active
 * 
 * @param importKey - Unique identifier for the component (used for caching)
 * @param importFn - Function that returns a dynamic import promise
 * @param isActive - Whether the component should be loaded (e.g., modal open, tab selected, etc.)
 * @returns The loaded component or null if not yet loaded
 * 
 * @example
 * // For modals
 * const Modal = useLazyLoader('my-modal', () => import('./MyModal'), isOpen);
 * 
 * @example
 * // For tab content
 * const TabContent = useLazyLoader('tab-advanced', () => import('./AdvancedTab'), activeTab === 'advanced');
 * 
 * @example
 * // For conditional panels
 * const AdminPanel = useLazyLoader('admin-panel', () => import('./AdminPanel'), isAdmin);
 */
export const useLazyLoader = <T extends Record<string, unknown>>(
  importKey: string,
  importFn: () => Promise<{ default: React.ComponentType<T> }>,
  isActive: boolean,
): React.ComponentType<T> | null => {
  const [Component, setComponent] = useState<React.ComponentType<T> | null>(null);

  const memoizedImportFn = useCallback(importFn, [importKey]);

  useEffect(() => {
    if (isActive && Component == null) {
      getCachedImport(importKey, memoizedImportFn)
        .then((mod) => {
          if (mod.default) {
            setComponent(() => mod.default);
          }
          else {
            console.error(`Failed to load component with key "${importKey}": default export is missing`);
          }
        })
        .catch((error) => {
          console.error(`Failed to load component with key "${importKey}":`, error);
        });
    }
  }, [isActive, Component, importKey, memoizedImportFn]);

  return Component;
};
```

**テスト**: `apps/app/src/client/util/use-lazy-loader.spec.tsx` (12 tests passing)

### 2. ディレクトリ構造と命名規則

```
apps/app/.../[ModalName]/
├── index.ts           # エクスポート用 (named export)
├── [ModalName].tsx    # 実際のモーダルコンポーネント (named export)
└── dynamic.tsx        # 動的ローダー (named export)
```

**命名規則**:
- Hook: `useLazyLoader` (lazy系の命名)
- 動的ローダーコンポーネント: `[ModalName]LazyLoaded` (例: `ShortcutsModalLazyLoaded`)
- ファイル名: `dynamic.tsx` (Next.jsの慣例を維持)
- 最終エクスポート名: `[ModalName]` (元のモーダル名、後方互換性のため)

**例**:
```tsx
// dynamic.tsx
export const ShortcutsModalLazyLoaded = () => { /* ... */ };

// index.ts
export { ShortcutsModalLazyLoaded } from './dynamic';

// BasicLayout.tsx
import { ShortcutsModalLazyLoaded } from '~/client/components/ShortcutsModal';
```

### 3. Named Exportベストプラクティス

**原則**: 全てのモーダルコンポーネントでnamed exportを使用する

**理由**:
- コード可読性の向上（importで何をインポートしているか明確）
- IDE/エディタのサポート向上（auto-import、リファクタリング）
- 一貫性の維持（プロジェクト全体で統一されたパターン）

**実装例**:
```tsx
// ❌ Default Export (非推奨)
export default ShortcutsModal;

// ✅ Named Export (推奨)
export const ShortcutsModal = () => { /* ... */ };

// dynamic.tsx
export const ShortcutsModalLazyLoaded = () => {
  const Modal = useLazyLoader(
    'shortcuts-modal',
    () => import('./ShortcutsModal').then(mod => ({ default: mod.ShortcutsModal })),
    isOpened,
  );
  return Modal ? <Modal /> : <></>;
};

// index.ts
export { ShortcutsModalLazyLoaded } from './dynamic';

// BasicLayout.tsx
import { ShortcutsModalLazyLoaded } from '~/client/components/ShortcutsModal';
```

---

## リファクタリング手順: 3つのケース別ガイド

### 📋 事前確認: モーダルの現在の状態を判定

既存のモーダルコードを確認し、以下のどのケースに該当するか判定してください：

| ケース | 特徴 | 判定方法 |
|--------|------|----------|
| **ケースA** | Container-Presentation分離なし | 単一のコンポーネントのみ存在 |
| **ケースB** | 分離済み、Container無`<Modal>` | `Substance`があるが、Containerに`<Modal>`なし |
| **ケースC** | 分離済み、Container有`<Modal>` | Containerが`<Modal>`外枠を持つ ⭐最短経路 |

---

### ケースA: Container-Presentation分離されていない場合

**現状**: 単一ファイルで完結しているモーダル

#### 手順

1. **ファイル構造変更**
```
Before: TemplateModal.tsx (単一ファイル)
After:  TemplateModal/
        ├── index.ts
        ├── TemplateModal.tsx
        └── dynamic.tsx
```

2. **TemplateModal.tsx: Named Export化**
```tsx
// default exportの場合は変更
export const TemplateModal = (): JSX.Element => {
  // 既存の実装（変更なし）
};
```

3. **dynamic.tsx作成**
```tsx
import type { JSX } from 'react';
import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { useTemplateModalStatus } from '~/states/...';

type TemplateModalProps = Record<string, unknown>;

export const TemplateModalLazyLoaded = (): JSX.Element => {
  const status = useTemplateModalStatus();

  const TemplateModal = useLazyLoader<TemplateModalProps>(
    'template-modal',
    () => import('./TemplateModal').then(mod => ({ default: mod.TemplateModal })),
    status?.isOpened ?? false,
  );

  // TemplateModal handles Modal wrapper and rendering
  return TemplateModal ? <TemplateModal /> : <></>;
};
```

4. **index.ts作成**
```tsx
export { TemplateModalLazyLoaded } from './dynamic';
```

5. **BasicLayout.tsx更新**
```tsx
// Before: Next.js dynamic()
const TemplateModal = dynamic(() => import('~/components/TemplateModal'), { ssr: false });

// After: 直接import (named)
// eslint-disable-next-line no-restricted-imports
import { TemplateModalLazyLoaded } from '~/components/TemplateModal';
```

---

### ケースB: Container-Presentation分離済み、但しContainerに`<Modal>`外枠なし

**現状**: `Substance`と`Container`があるが、Containerは早期returnのみで`<Modal>`を持たない

**例**:
```tsx
const TemplateModalSubstance = () => { /* 全ての実装 + <Modal> */ };

export const TemplateModal = () => {
  const status = useStatus();
  if (!status?.isOpened) return <></>;  // 早期return
  return <TemplateModalSubstance />;
};
```

#### 手順

1. **ファイル構造変更** (ケースAと同じ)

2. **TemplateModal.tsxリファクタリング**: Containerに`<Modal>`を追加
```tsx
// Substance: <Modal>外枠を削除、<ModalHeader><ModalBody>のみに
const TemplateModalSubstance = ({ 
  someProp, 
  setSomeProp 
}: TemplateModalSubstanceProps) => {
  // 重い処理・hooks
  return (
    <>
      <ModalHeader toggle={close}>...</ModalHeader>
      <ModalBody>...</ModalBody>
    </>
  );
};

// Container: <Modal>外枠を追加、状態管理、named export
export const TemplateModal = () => {
  const status = useStatus();
  const { close } = useActions();
  const [someProp, setSomeProp] = useState(...);

  if (status == null) return <></>;

  return (
    <Modal 
      isOpen={status.isOpened} 
      toggle={close}
      size="xl"
      className="..."
    >
      {status.isOpened && (
        <TemplateModalSubstance 
          someProp={someProp} 
          setSomeProp={setSomeProp} 
        />
      )}
    </Modal>
  );
};
```

3. **dynamic.tsx, index.ts作成** (ケースAと同じ)

4. **BasicLayout.tsx更新** (ケースAと同じ)

---

### ケースC: Container-Presentation分離済み、且つContainerに`<Modal>`外枠あり ⭐

**現状**: 既にV2で理想的な構造になっている（最も簡単なケース）

**例**:
```tsx
const TemplateModalSubstance = (props) => {
  // 重い処理
  return (
    <>
      <ModalHeader>...</ModalHeader>
      <ModalBody>...</ModalBody>
    </>
  );
};

export const TemplateModal = () => {
  const status = useStatus();
  const { close } = useActions();
  
  if (status == null) return <></>;
  
  return (
    <Modal isOpen={status.isOpened} toggle={close}>
      {status.isOpened && <TemplateModalSubstance />}
    </Modal>
  );
};
```

#### 手順

**最短経路**: TemplateModal.tsxの変更は**ほぼ不要**！

1. **ファイル構造変更**
```
Before: TemplateModal.tsx (単一ファイル)
After:  TemplateModal/
        ├── index.ts
        ├── TemplateModal.tsx (移動のみ)
        └── dynamic.tsx (新規)
```

2. **TemplateModal.tsx: Named Export確認**
```tsx
// default exportの場合のみ修正
// Before: export default TemplateModal;
// After:  export const TemplateModal = ...;
```

3. **dynamic.tsx作成** (ケースAと同じ)

4. **index.ts作成** (ケースAと同じ)

5. **BasicLayout.tsx更新** (ケースAと同じ)

**変更内容**: `dynamic.tsx`と`index.ts`の追加、named export化のみ

---

## ケース判定フローチャート

```
[モーダルコード確認]
    ↓
[SubstanceとContainerに分離されている？]
    ↓ No  → ケースA: シンプル、dynamic.tsx追加 + named export化
    ↓ Yes
[Containerに<Modal>外枠がある？]
    ↓ No  → ケースB: Containerリファクタリング必要
    ↓ Yes
    ↓     → ケースC: ⭐最短経路、dynamic.tsx追加 + named export化のみ
```

---

## 実装例

### 例1: PageAccessoriesModal (ケースB→C変換)

詳細は前述のケースB手順を参照

### 例2: ShortcutsModal (ケースC、最短経路) ⭐

**Before**: 単一ファイル、default export
```tsx
// ShortcutsModal.tsx
const ShortcutsModalSubstance = () => { /* ... */ };

const ShortcutsModal = () => {
  return (
    <Modal isOpen={status?.isOpened}>
      {status?.isOpened && <ShortcutsModalSubstance />}
    </Modal>
  );
};

export default ShortcutsModal; // default export
```

**After**: ディレクトリ構造、named export

1. **ShortcutsModal/ShortcutsModal.tsx** (named export化のみ)
```tsx
const ShortcutsModalSubstance = () => { /* 変更なし */ };

export const ShortcutsModal = () => { // named export
  return (
    <Modal isOpen={status?.isOpened}>
      {status?.isOpened && <ShortcutsModalSubstance />}
    </Modal>
  );
};
```

2. **ShortcutsModal/dynamic.tsx** (新規)
```tsx
import type { JSX } from 'react';
import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { useShortcutsModalStatus } from '~/states/ui/modal/shortcuts';

type ShortcutsModalProps = Record<string, unknown>;

export const ShortcutsModalLazyLoaded = (): JSX.Element => {
  const status = useShortcutsModalStatus();

  const ShortcutsModal = useLazyLoader<ShortcutsModalProps>(
    'shortcuts-modal',
    () => import('./ShortcutsModal').then(mod => ({ default: mod.ShortcutsModal })),
    status?.isOpened ?? false,
  );

  return ShortcutsModal ? <ShortcutsModal /> : <></>
};
```

3. **ShortcutsModal/index.ts** (新規)
```tsx
export { ShortcutsModalLazyLoaded } from './dynamic';
```

4. **BasicLayout.tsx**
```tsx
// Before
const ShortcutsModal = dynamic(() => import('~/client/components/ShortcutsModal'), { ssr: false });

// After
import { ShortcutsModalLazyLoaded } from '~/client/components/ShortcutsModal';
```

**作業時間**: 約5分（ケースCは非常に高速）

---

## 最適化判断基準

### ✅ 最適化すべきモーダル

1. **モーダル自身の利用頻度が低い**（親ページの頻度ではない）
2. **ファイルサイズが50行以上**（100行以上は強く推奨）
3. **レンダリングコストが高い**

### 最適化判断フローチャート

```
1. モーダルは常にレンダリングされるか？
   YES → 次へ
   NO → 最適化不要

2. モーダル自身の利用頻度は？
   高頻度 → スキップ（初期ロード維持）
   中〜低頻度 → 次へ

3. ファイルサイズは？
   50行未満 → 効果小、要検討
   50行以上 → V3最適化推奨
   100行以上 → V3最適化強く推奨
```

### 重要な注意点

**親の遅延ロード ≠ 子の遅延ロード**:
```
BasicLayout (常にレンダリング)
  ├─ HotkeysManager (dynamic()) ← 遅延ロード
  │    └─ ShowShortcutsModal (静的import) ← ❌ 遅延ロードされない！
  │
  ├─ SearchPage (dynamic()) ← 遅延ロード
  │    └─ SearchOptionModal (静的import) ← ❌ 遅延ロードされない！
```

**結論**: 親がdynamic()でも、子モーダルは親と一緒にダウンロードされる

---

## チェックリスト

### 実装確認項目
- [ ] **ケース判定完了**: モーダルがA/B/Cのどのケースか確認
- [ ] `useLazyLoader` フックが作成済み
- [ ] モーダルディレクトリが作成済み（index.ts, [Modal].tsx, dynamic.tsx）
- [ ] **Named Export化**: `export const [Modal]` に変更済み
- [ ] **ケースBの場合**: Containerリファクタリング完了（`<Modal>`外枠追加）
- [ ] 動的ローダーが `useLazyLoader` を使用
- [ ] エクスポートファイルが正しく設定済み
- [ ] BasicLayout.tsx/ShareLinkLayout.tsxでNext.js `dynamic()`削除、直接import

### 動作確認項目
- [ ] ページ初回ロード時にモーダルchunkがダウンロードされない
- [ ] モーダルを開いた際に初めてchunkがダウンロードされる
- [ ] 同じモーダルを再度開いても重複ダウンロードされない
- [ ] **Fadeout transition正常動作**: モーダルを閉じる際にアニメーションが発生
- [ ] **Container-Presentation効果**: モーダル閉じている時、Substanceがレンダリングされない
- [ ] TypeScriptエラーが発生しない

### デグレチェック項目 🚨
- [ ] **モーダルが開くか**: トリガーボタンを押してモーダルが正しく開くことを確認
- [ ] **State import パス**: `@growi/editor`パッケージのstateを使用していないか確認
  - LinkEditModal: `@growi/editor/dist/states/modal/link-edit`
  - TemplateModal: `@growi/editor`
  - HandsontableModal (Editor): `@growi/editor` (useHandsontableModalForEditorStatus)
- [ ] **複数ステータス**: モーダルが複数のステータスプロパティを持っていないか確認
  - 例: HandsontableModal は `isOpened || isOpendInEditor` の両方をチェック必要
- [ ] **Export宣言**: モーダルコンポーネントが`export const`で正しくexportされているか
- [ ] **動的ローダーのtrigger条件**: `status?.isOpened`だけでなく、他のプロパティも必要ないか確認

---

## デバッグガイド 🔧

### モーダルが開かない場合のチェックリスト

1. **State import パスの確認**
```bash
# モーダル本体で使用しているstate hookのimport元を確認
grep -n "useXxxModalStatus" path/to/Modal.tsx

# dynamic.tsxで同じimport元を使用しているか確認
grep -n "useXxxModalStatus" path/to/dynamic.tsx
```

**よくある間違い**:
- ❌ dynamic.tsx: `import { useXxxModalStatus } from '~/states/ui/modal/xxx'`
- ✅ 本体と同じ: `import { useXxxModalStatus } from '@growi/editor'`

2. **ステータスプロパティの確認**
```tsx
// モーダル本体で使用しているプロパティを確認
<Modal isOpen={status?.isOpened || anotherStatus?.isOpened}>

// dynamic.tsxで同じ条件を使用
const Component = useLazyLoader(
  'modal-key',
  () => import('./Modal'),
  status?.isOpened || anotherStatus?.isOpened || false, // ⭐すべての条件を含める
);
```

3. **Export宣言の確認**
```tsx
// ❌ 間違い: default export
export default MyModal;

// ✅ 正しい: named export
export const MyModal = () => { ... };
```

4. **Import パスの確認**
```tsx
// dynamic.tsx内
() => import('./Modal').then(mod => ({ default: mod.MyModal }))
//                                              ↑ named exportの名前
```

---

## 注意点

### パフォーマンス
- グローバルキャッシュにより同じimportは1度だけ実行される
- メモ化により不要な再レンダリングを防ぐ
- Container-Presentation分離により、モーダル閉じている時の無駄な処理を回避

### 型安全性
- ジェネリクスを使用して型安全性を保持
- 既存のProps型は変更不要

### 開発体験
- Named exportによりコード可読性向上
- 既存のインポートパスは変更不要
- 各モーダルの状態管理ロジックは維持
- ケースCの場合、既存のモーダルコードはnamed export化のみ

### Fadeout Transition保証の設計原則
- **Container**: 常に`<Modal>`をレンダリング（`status == null`のみ早期return）
- **Substance**: `isOpened && <Substance />`で条件付きレンダリング
- この設計により、`<Modal isOpen={false}>`が正しくfadeout transitionを実行できる

### Cross-Package State Management 🚨
エディター関連のモーダルは`@growi/editor`パッケージでstateを管理している場合があります：
- `~/states`からインポートできると仮定しないこと
- モーダル本体のimport元を必ず確認すること
- dynamic.tsxで同じimport元を使用すること

**例**:
```tsx
// LinkEditModal.tsx (本体)
import { useLinkEditModalStatus } from '@growi/editor/dist/states/modal/link-edit';

// dynamic.tsx (同じimport元を使用)
import { useLinkEditModalStatus } from '@growi/editor/dist/states/modal/link-edit';
```

---

## 最短経路での指示テンプレート

### ケースA向け
```
[モーダル名]を動的ロード化してください。

【現状】単一ファイル構成（Container-Presentation分離なし）

【手順】
1. ディレクトリ化: [Modal].tsx → [Modal]/
2. Named Export化: export const [Modal] = ...
3. dynamic.tsx作成: useLazyLoaderで[Modal].tsxを動的ロード
4. index.ts: dynamic.tsxからexport
5. BasicLayout.tsx: Next.js dynamic()削除、直接import (named)

【変更】[Modal].tsx本体はnamed export化のみ
```

### ケースB向け
```
[モーダル名]を動的ロード化してください。

【現状】Container-Presentation分離済みだが、Containerに<Modal>外枠なし

【手順】
1. [Modal].tsxリファクタリング:
   - Containerに<Modal>外枠を追加
   - Substanceから<Modal>外枠を削除
   - 必要に応じて状態をContainer→Substanceにpropsで渡す
   - Container: <Modal>{isOpened && <Substance />}</Modal>
   - Named Export化: export const [Modal] = ...
2. dynamic.tsx作成: useLazyLoaderで[Modal]全体を動的ロード
3. index.ts: dynamic.tsxからexport
4. BasicLayout.tsx: Next.js dynamic()削除、直接import (named)

【達成】動的ロード + Container-Presentation分離 + Fadeout transition
```

### ケースC向け ⭐
```
[モーダル名]を動的ロード化してください。

【現状】理想的なContainer-Presentation分離済み（Container有<Modal>）

【手順】最短経路（所要時間: 約5分）
1. ディレクトリ化: [Modal].tsx → [Modal]/
2. Named Export確認: export const [Modal] = ... (必要な場合のみ変更)
3. dynamic.tsx作成: useLazyLoaderで[Modal]全体を動的ロード
4. index.ts: dynamic.tsxからexport
5. BasicLayout.tsx: Next.js dynamic()削除、直接import (named)

【変更】[Modal].tsx本体はnamed export化のみ（実装は変更なし）
【達成】動的ロード効果を即座に獲得
【デグレチェック】モーダルが開くか、state import パス、複数ステータス確認
```
