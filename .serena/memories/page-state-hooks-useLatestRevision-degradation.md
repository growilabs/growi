# Page State Hooks - useLatestRevision リファクタリング記録

**Date**: 2025-10-31
**Branch**: support/use-jotai

## 🎯 実施内容のサマリー

`support/use-jotai` ブランチで `useLatestRevision` が機能していなかった問題を解決し、リビジョン管理の状態管理を大幅に改善しました。

### 主な成果

1. ✅ `IPageInfoForEntity.latestRevisionId` を導入
2. ✅ `useIsLatestRevision` を SWR ベースで実装（Jotai atom から脱却）
3. ✅ `remoteRevisionIdAtom` を完全削除（状態管理の簡素化）
4. ✅ `useIsRevisionOutdated` の意味論を改善（「意図的な過去閲覧」を考慮）
5. ✅ `useRevisionIdFromUrl` で URL パラメータ取得を一元化

---

## 📋 実装の要点

### 1. `IPageInfoForEntity` に `latestRevisionId` を追加

**ファイル**: `packages/core/src/interfaces/page.ts`

```typescript
export type IPageInfoForEntity = Omit<IPageInfo, 'isNotFound' | 'isEmpty'> & {
  // ... existing fields
  latestRevisionId?: string;  // ✅ 追加
};
```

**ファイル**: `apps/app/src/server/service/page/index.ts:2605`

```typescript
const infoForEntity: Omit<IPageInfoForEntity, 'bookmarkCount'> = {
  // ... existing fields
  latestRevisionId: page.revision != null ? getIdStringForRef(page.revision) : undefined,
};
```

**データフロー**: SSR で `constructBasicPageInfo` が自動的に `latestRevisionId` を設定 → `useSWRxPageInfo` で参照

---

### 2. `useIsLatestRevision` を SWR ベースで実装

**ファイル**: `stores/page.tsx:164-191`

```typescript
export const useIsLatestRevision = (): SWRResponse<boolean, Error> => {
  const currentPage = useCurrentPageData();
  const pageId = currentPage?._id;
  const shareLinkId = useShareLinkId();
  const { data: pageInfo } = useSWRxPageInfo(pageId, shareLinkId);

  const latestRevisionId = pageInfo && 'latestRevisionId' in pageInfo
    ? pageInfo.latestRevisionId
    : undefined;

  const key = useMemo(() => {
    if (currentPage?.revision?._id == null) {
      return null;
    }
    return ['isLatestRevision', currentPage.revision._id, latestRevisionId ?? null];
  }, [currentPage?.revision?._id, latestRevisionId]);

  return useSWRImmutable(
    key,
    ([, currentRevisionId, latestRevisionId]) => {
      if (latestRevisionId == null) {
        return true;  // Assume latest if not available
      }
      return latestRevisionId === currentRevisionId;
    },
  );
};
```

**使用箇所**: OldRevisionAlert, DisplaySwitcher, PageEditorReadOnly

**判定**: `.data !== false` で「古いリビジョン」を検出

---

### 3. `remoteRevisionIdAtom` の完全削除

**削除理由**:
- `useSWRxPageInfo.data.latestRevisionId` で代替可能
- 「Socket.io 更新検知」と「最新リビジョン保持」の用途が混在していた
- 状態管理が複雑化していた

**重要**: `RemoteRevisionData.remoteRevisionId` は型定義に残した
→ コンフリクト解決時に「どのリビジョンに対して保存するか」の情報として必要

---

### 4. `useIsRevisionOutdated` の意味論的改善

**改善前**: 単純に「現在のリビジョン ≠ 最新リビジョン」を判定
**問題**: URL `?revisionId=xxx` で意図的に過去を見ている場合も `true` を返していた

**改善後**: 「ユーザーが意図的に過去リビジョンを見ているか」を考慮

**ファイル**: `states/context.ts:82-100`

```typescript
export const useRevisionIdFromUrl = (): string | undefined => {
  const router = useRouter();
  const revisionId = router.query.revisionId;
  return typeof revisionId === 'string' ? revisionId : undefined;
};

export const useIsViewingSpecificRevision = (): boolean => {
  const revisionId = useRevisionIdFromUrl();
  return revisionId != null;
};
```

**ファイル**: `stores/page.tsx:193-219`

```typescript
export const useIsRevisionOutdated = (): boolean => {
  const { data: isLatestRevision } = useIsLatestRevision();
  const isViewingSpecificRevision = useIsViewingSpecificRevision();

  // If user intentionally views a specific revision, don't show "outdated" alert
  if (isViewingSpecificRevision) {
    return false;
  }

  if (isLatestRevision == null) {
    return false;
  }

  // User expects latest, but it's not latest = outdated
  return !isLatestRevision;
};
```

---

## 🎭 動作例

| 状況 | isLatestRevision | isViewingSpecificRevision | isRevisionOutdated | 意味 |
|------|------------------|---------------------------|---------------------|------|
| 最新を表示中 | true | false | false | 正常 |
| Socket.io更新を受信 | false | false | **true** | 「再fetchせよ」 |
| URL `?revisionId=old` で過去を閲覧 | false | true | false | 「意図的な過去閲覧」 |

---

## 🔄 現状の remoteRevision 系 atom と useSetRemoteLatestPageData

### 削除済み
- ✅ `remoteRevisionIdAtom` - 完全削除（`useSWRxPageInfo.data.latestRevisionId` で代替）

### 残存している atom（未整理）
- ⚠️ `remoteRevisionBodyAtom` - ConflictDiffModal で使用
- ⚠️ `remoteRevisionLastUpdateUserAtom` - ConflictDiffModal, PageStatusAlert で使用
- ⚠️ `remoteRevisionLastUpdatedAtAtom` - ConflictDiffModal で使用

### `useSetRemoteLatestPageData` の役割

**定義**: `states/page/use-set-remote-latest-page-data.ts`

```typescript
export type RemoteRevisionData = {
  remoteRevisionId: string;      // 型には含むが atom には保存しない
  remoteRevisionBody: string;
  remoteRevisionLastUpdateUser?: IUserHasId;
  remoteRevisionLastUpdatedAt: Date;
};

export const useSetRemoteLatestPageData = (): SetRemoteLatestPageData => {
  // remoteRevisionBodyAtom, remoteRevisionLastUpdateUserAtom, remoteRevisionLastUpdatedAtAtom を更新
  // remoteRevisionId は atom に保存しない（コンフリクト解決時のパラメータとしてのみ使用）
};
```

**使用箇所**（6箇所）:

1. **`page-updated.ts`** - Socket.io でページ更新受信時
   ```typescript
   // 他のユーザーがページを更新したときに最新リビジョン情報を保存
   setRemoteLatestPageData({
     remoteRevisionId: s2cMessagePageUpdated.revisionId,
     remoteRevisionBody: s2cMessagePageUpdated.revisionBody,
     remoteRevisionLastUpdateUser: s2cMessagePageUpdated.remoteLastUpdateUser,
     remoteRevisionLastUpdatedAt: s2cMessagePageUpdated.revisionUpdateAt,
   });
   ```

2. **`page-operation.ts`** - 自分がページ保存した後（`useUpdateStateAfterSave`）
   ```typescript
   // 自分が保存した後の最新リビジョン情報を保存
   setRemoteLatestPageData({
     remoteRevisionId: updatedPage.revision._id,
     remoteRevisionBody: updatedPage.revision.body,
     remoteRevisionLastUpdateUser: updatedPage.lastUpdateUser,
     remoteRevisionLastUpdatedAt: updatedPage.updatedAt,
   });
   ```

3. **`conflict.tsx`** - コンフリクト解決時（`useConflictResolver`）
   ```typescript
   // コンフリクト発生時にリモートリビジョン情報を保存
   setRemoteLatestPageData(remoteRevidsionData);
   ```

4. **`drawio-modal-launcher-for-view.ts`** - Drawio 編集でコンフリクト発生時
5. **`handsontable-modal-launcher-for-view.ts`** - Handsontable 編集でコンフリクト発生時
6. **定義ファイル自体**

### 現在のデータフロー

```
┌─────────────────────────────────────────────────────┐
│ Socket.io / 保存処理 / コンフリクト                  │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ useSetRemoteLatestPageData                          │
│  ├─ remoteRevisionBodyAtom ← body                   │
│  ├─ remoteRevisionLastUpdateUserAtom ← user         │
│  └─ remoteRevisionLastUpdatedAtAtom ← date          │
│  (remoteRevisionId は保存しない)                    │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 使用箇所                                             │
│  ├─ ConflictDiffModal: body, user, date を表示     │
│  └─ PageStatusAlert: user を表示                    │
└─────────────────────────────────────────────────────┘
```

### 問題点

1. **PageInfo (latestRevisionId) との同期がない**:
   - Socket.io 更新時に `remoteRevision*` atom は更新される
   - しかし `useSWRxPageInfo.data.latestRevisionId` は更新されない
   - → `useIsLatestRevision()` と `useIsRevisionOutdated()` がリアルタイム更新を検知できない

2. **用途が限定的**:
   - 主に ConflictDiffModal でリモートリビジョンの詳細を表示するために使用
   - PageStatusAlert でも使用しているが、本来は `useIsRevisionOutdated()` で十分

3. **データの二重管理**:
   - リビジョン ID: `useSWRxPageInfo.data.latestRevisionId` で管理
   - リビジョン詳細 (body, user, date): atom で管理
   - 一貫性のないデータ管理

---

## 🎯 次に取り組むべきタスク

### PageInfo (useSWRxPageInfo) の mutate が必要な3つのタイミング

#### 1. 🔴 SSR時の optimistic update

**問題**:
- SSR で `pageWithMeta.meta` (IPageInfoForEntity) が取得されているが、`useSWRxPageInfo` のキャッシュに入っていない
- クライアント初回レンダリング時に PageInfo が未取得状態になる

**実装方針**:
```typescript
// [[...path]]/index.page.tsx または適切な場所
const { mutate: mutatePageInfo } = useSWRxPageInfo(pageId, shareLinkId);

useEffect(() => {
  if (pageWithMeta?.meta) {
    mutatePageInfo(pageWithMeta.meta, { revalidate: false });
  }
}, [pageWithMeta?.meta, mutatePageInfo]);
```

**Note**:
- Jotai の hydrate とは別レイヤー（Jotai は atom、これは SWR のキャッシュ）
- `useSWRxPageInfo` は既に `initialData` パラメータを持っているが、呼び出し側で渡していない
- **重要**: `mutatePageInfo` は bound mutate（hook から返されるもの）を使う

---

#### 2. 🔴 same route 遷移時の mutate

**問題**:
- `[[...path]]` ルート内での遷移（例: `/pageA` → `/pageB`）時に PageInfo が更新されない
- `useFetchCurrentPage` が新しいページを取得しても PageInfo は古いまま

**実装方針**:
```typescript
// states/page/use-fetch-current-page.ts
export const useFetchCurrentPage = () => {
  const shareLinkId = useAtomValue(shareLinkIdAtom);
  const revisionIdFromUrl = useRevisionIdFromUrl();

  // ✅ 追加: PageInfo の mutate 関数を取得
  const { mutate: mutatePageInfo } = useSWRxPageInfo(currentPageId, shareLinkId);

  const fetchCurrentPage = useAtomCallback(
    useCallback(async (get, set, args) => {
      // ... 既存のフェッチ処理 ...

      const { data } = await apiv3Get('/page', params);
      const { page: newData } = data;

      set(currentPageDataAtom, newData);
      set(currentPageIdAtom, newData._id);

      // ✅ 追加: PageInfo を再フェッチ
      mutatePageInfo();  // 引数なし = revalidate (再フェッチ)

      return newData;
    }, [shareLinkId, revisionIdFromUrl, mutatePageInfo])
  );
};
```

**Note**:
- `mutatePageInfo()` を引数なしで呼ぶと SWR が再フェッチする
- `/page` API からは meta が取得できないため、再フェッチが必要

---

#### 3. 🔴 Socket.io 更新時の mutate

**問題**:
- Socket.io で他のユーザーがページを更新したとき、`useSWRxPageInfo` のキャッシュが更新されない
- `latestRevisionId` が古いままになる
- **重要**: `useIsLatestRevision()` と `useIsRevisionOutdated()` が正しく動作しない

**実装方針**:
```typescript
// client/services/side-effects/page-updated.ts
const { mutate: mutatePageInfo } = useSWRxPageInfo(currentPage?._id, shareLinkId);

const remotePageDataUpdateHandler = useCallback((data) => {
  const { s2cMessagePageUpdated } = data;

  // 既存: remoteRevision atom を更新
  setRemoteLatestPageData(remoteData);

  // ✅ 追加: PageInfo の latestRevisionId を optimistic update
  if (currentPage?._id != null) {
    mutatePageInfo((currentPageInfo) => {
      if (currentPageInfo && 'latestRevisionId' in currentPageInfo) {
        return {
          ...currentPageInfo,
          latestRevisionId: s2cMessagePageUpdated.revisionId,
        };
      }
      return currentPageInfo;
    }, { revalidate: false });
  }
}, [currentPage?._id, mutatePageInfo, setRemoteLatestPageData]);
```

**Note**:
- 引数に updater 関数を渡して既存データを部分更新
- `revalidate: false` で再フェッチを抑制（optimistic update のみ）

---

### SWR の mutate の仕組み

**Bound mutate** (推奨):
```typescript
const { data, mutate } = useSWRxPageInfo(pageId, shareLinkId);
mutate(newData, options);  // 自動的に key に紐付いている
```

**グローバル mutate**:
```typescript
import { mutate } from 'swr';
mutate(['/page/info', pageId, shareLinkId, isGuestUser], newData, options);
```

**optimistic update のオプション**:
- `{ revalidate: false }` - 再フェッチせず、キャッシュのみ更新
- `mutate()` (引数なし) - 再フェッチ
- `mutate(updater, options)` - updater 関数で部分更新

---

### 🟡 優先度 中: PageStatusAlert の重複ロジック削除

**ファイル**: `src/client/components/PageStatusAlert.tsx`

**現状**: 独自に `isRevisionOutdated` を計算している
**提案**: `useIsRevisionOutdated()` を使用

---

### 🟢 優先度 低

- テストコードの更新
- `initLatestRevisionField` の役割ドキュメント化

---

## 📊 アーキテクチャの改善

### Before (問題のある状態)

```
┌─────────────────────┐
│ latestRevisionAtom  │ ← atom(true) でハードコード（機能せず）
└─────────────────────┘
┌─────────────────────┐
│ remoteRevisionIdAtom│ ← 複数の用途で混在（Socket.io更新 + 最新リビジョン保持）
└─────────────────────┘
```

### After (改善後)

```
┌──────────────────────────────┐
│ useSWRxPageInfo              │
│  └─ data.latestRevisionId    │ ← SSR で自動設定、SWR でキャッシュ管理
└──────────────────────────────┘
        ↓
┌──────────────────────────────┐
│ useIsLatestRevision()        │ ← SWR ベース、汎用的な状態確認
└──────────────────────────────┘
        ↓
┌──────────────────────────────┐
│ useIsRevisionOutdated()      │ ← 「再fetch推奨」のメッセージ性
│  + useIsViewingSpecificRevision│ ← URL パラメータを考慮
└──────────────────────────────┘
```

---

## ✅ メリット

1. **状態管理の簡素化**: Jotai atom を削減、SWR の既存インフラを活用
2. **データフローの明確化**: SSR → SWR → hooks という一貫した流れ
3. **意味論の改善**: `useIsRevisionOutdated` が「再fetch推奨」を正確に表現
4. **保守性の向上**: URL パラメータ取得を `useRevisionIdFromUrl` に集約
5. **型安全性**: `IPageInfoForEntity` で厳密に型付け
