# Origin フィールドの挙動詳細分析

## 実装の確認結果

### 1. PageEditor の挙動 (PageEditor.tsx:240)

```typescript
const { page } = await updatePage({
  pageId,
  revisionId,  // 条件付きで送信
  body: markdown ?? '',
  origin: Origin.Editor,  // ← 常に Editor で固定！
  // ...
});
```

**重要**: PageEditor からの保存は**常に `origin: Origin.Editor` で送信**されます。

### 2. revisionId の送信条件 (PageEditor.tsx:158, 284-286, 308-310)

```typescript
const isRevisionIdRequiredForPageUpdate = currentPage?.revision?.origin === undefined;

const revisionId = isRevisionIdRequiredForPageUpdate
  ? currentRevisionId
  : undefined;
```

**意味**:
- `isRevisionIdRequiredForPageUpdate` は、**ページの最新リビジョンの origin** が undefined かどうかをチェック
- **現在の保存リクエストの origin ではなく、ページに保存されている最新リビジョンの origin を見ている**

### 3. isUpdatable メソッドの挙動 (obsolete-page.js:159-182)

```javascript
pageSchema.methods.isUpdatable = async function (previousRevision, origin) {
  const latestRevisionOrigin = populatedPageDataWithRevisionOrigin.revision.origin;

  const ignoreLatestRevision =
    origin === Origin.Editor &&
    (latestRevisionOrigin === Origin.Editor || latestRevisionOrigin === Origin.View);

  if (ignoreLatestRevision) {
    return true;  // リビジョンチェックをバイパス
  }

  const revision = this.latestRevision || this.revision._id;
  if (revision != previousRevision) {
    return false;  // リビジョンが一致しない場合は保存を拒否
  }
  return true;
}
```

## シナリオ別の挙動分析

### シナリオ A: 最新リビジョンが origin=editor で作成されている場合

1. **フロントエンド**:
   - `isRevisionIdRequiredForPageUpdate = false` (最新リビジョンの origin は undefined ではない)
   - `revisionId = undefined` を送信
   - `origin: Origin.Editor` を送信

2. **API (update-page.ts:301)**:
   ```typescript
   previousRevision = await Revision.findById(undefined);  // → null
   ```

3. **isUpdatable チェック (obsolete-page.js:167-172)**:
   ```javascript
   ignoreLatestRevision =
     (Origin.Editor === Origin.Editor) &&
     (latestRevisionOrigin === Origin.Editor || latestRevisionOrigin === Origin.View)
   // → true (最新リビジョンが editor なので)

   return true;  // バイパス成功
   ```
   **結果**: ✅ 保存成功（リビジョンチェックなし）

4. **prepareRevision (revision.ts:106-108)**:
   ```typescript
   if (pageData.revision != null) {
     newRevision.hasDiffToPrev = body !== previousBody;  // previousBody は null
   }
   ```
   **結果**: ❌ `hasDiffToPrev` が正しく設定されない（`body !== null` は常に true）

### シナリオ B: 最新リビジョンが origin=undefined で作成されている場合（レガシーまたは API 経由）

1. **フロントエンド**:
   - `isRevisionIdRequiredForPageUpdate = true` (最新リビジョンの origin が undefined)
   - `revisionId = currentRevisionId` を送信
   - `origin: Origin.Editor` を送信

2. **API (update-page.ts:301)**:
   ```typescript
   previousRevision = await Revision.findById(sanitizeRevisionId);  // → リビジョンオブジェクト
   ```

3. **isUpdatable チェック (obsolete-page.js:167-172)**:
   ```javascript
   ignoreLatestRevision =
     (Origin.Editor === Origin.Editor) &&
     (latestRevisionOrigin === undefined || latestRevisionOrigin === Origin.View)
   // → false (最新リビジョンが undefined なので Editor || View の条件に合わない)

   // revision != previousRevision チェック実行
   if (revision != sanitizeRevisionId) {
     return false;  // 一致しない場合は拒否
   }
   return true;
   ```
   **結果**: ✅ 保存成功（revisionId が一致する場合）

4. **prepareRevision (revision.ts:106-108)**:
   ```typescript
   if (pageData.revision != null) {
     newRevision.hasDiffToPrev = body !== previousBody;  // previousBody は previous revision の body
   }
   ```
   **結果**: ✅ `hasDiffToPrev` が正しく設定される

### シナリオ C: API 経由での保存（origin=undefined）

1. **API クライアント**:
   - `revisionId` を送信（必須）
   - `origin: undefined` を送信（または省略）

2. **isUpdatable チェック**:
   ```javascript
   ignoreLatestRevision =
     (undefined === Origin.Editor) && ...
   // → false

   // revision != previousRevision チェック実行（厳格）
   ```
   **結果**: revisionId が一致しない場合は保存拒否

## ユーザーの記憶との比較

### ユーザーの理解:
1. ✅ **API 経由（origin=undefined）**: revisionId 必須、厳格なチェック
2. ⚠️ **origin に view/editor が入っている場合**: 緩いチェックで保存許可

### 実際の実装:
1. ✅ **API 経由（origin=undefined）**: revisionId 必須、厳格なチェック → **一致**
2. ⚠️ **origin=editor の場合**:
   - **最新リビジョンも editor または view の場合**: リビジョンチェックをバイパス（緩い）→ **一致**
   - **最新リビジョンが undefined の場合**: revisionId 必須、厳格なチェック → **ユーザーの記憶と異なる**

## 重要な発見: 二段階のorigin チェック

実装は**二段階の origin チェック**をしています:

1. **フロントエンド**: `currentPage.revision.origin === undefined` かチェック
   - undefined なら revisionId を送信
   - そうでなければ revisionId を送信しない

2. **バックエンド**: `(送信された origin === Editor) && (最新リビジョンの origin === Editor || View)` かチェック
   - true ならリビジョンチェックをバイパス
   - false なら revisionId の一致を確認

**この二段階チェックの結果**:
- **通常の Editor 使用時** (最新リビジョンが editor/view):
  - revisionId は送信されない（undefined）
  - リビジョンチェックはバイパスされる
  - **しかし** `previousBody` が null になるため `hasDiffToPrev` が設定できない ❌

- **レガシーページの Editor 使用時** (最新リビジョンが undefined):
  - revisionId が送信される
  - リビジョンチェックが実行される
  - `previousBody` が取得されるため `hasDiffToPrev` が正しく設定される ✅

## 根本原因の特定

**問題の核心**:
- リビジョンチェック（競合検出）と差分検出（hasDiffToPrev）は**別々の目的**を持つ
- 現在の実装では、リビジョンチェックが不要な場合に `previousRevision` の取得も省略している
- しかし、差分検出には **常に** `previousBody` が必要

**解決策の方向性**:
1. **revisionId の送信有無に関わらず**、サーバー側で前のリビジョンを取得
2. リビジョンチェック用と差分検出用で、異なるロジックを使用

## 次のステップ

この分析に基づいて、ギャップ分析を更新し、以下を明確にします:
1. origin の二段階チェックメカニズムの説明
2. リビジョンチェック（競合検出）と差分検出の分離が必要であること
3. サーバー側で `currentPage.revision` から前のリビジョンを常に取得する実装方針
