# モーダルV3動的ロード最適化 - 進捗管理

## 📊 進捗状況サマリー (2025-10-17更新)

**実装完了**: 25モーダル + 4 PageAlerts = 29/48 (60%) 🎉

**V3最適化完了！** 目標の60%達成 ✨

---

## 🔴 重要な学び: 正しい分類基準 (2025-10-17)

### ❌ 誤った判断基準
- "親ページがdynamic()でロードされている → 子モーダルの最適化不要"
- **問題点**: 親が遅延ロードされていても、モーダルは親と一緒にダウンロードされる

### ✅ 正しい判断基準
1. **モーダル自身の利用頻度**（親ページの頻度ではない）
2. **ファイルサイズ/複雑さ**（50行以上で効果的、100行以上で強く推奨）
3. **レンダリングコスト**

### ⚠️ 例外: 親ページ自体が低頻度の場合
- **Me画面**: 個人設定画面、低頻度利用 → 配下のモーダルは最適化不要
  - AssociateModal, DisassociateModal は除外
- **Admin画面**: 管理画面、低頻度利用 → 配下のモーダルは最適化不要
  - ImageCropModal, DeleteSlackBotSettingsModal, PluginDeleteModal は除外
- **理由**: 親ページ自体がdynamic()かつ低頻度なら、子モーダルの最適化効果は限定的

---

## ✅ 完了済みモーダル (25個)

### 高頻度モーダル (0/2 - 意図的にスキップ) ⏭️
- ⏭️ SearchModal (192行) - 検索機能、初期ロード維持
- ⏭️ PageCreateModal (319行) - ページ作成、初期ロード維持

### 中頻度モーダル (6/6 - 100%完了) ✅
- ✅ PageAccessoriesModal (2025-10-15) - ケースB
- ✅ ShortcutsModal (2025-10-15) - ケースC
- ✅ PageRenameModal (2025-10-16) - ケースC
- ✅ PageDuplicateModal (2025-10-16) - ケースC
- ✅ DescendantsPageListModal (2025-10-16) - ケースC
- ✅ PageDeleteModal (2025-10-16) - ケースA

### 低頻度モーダル (19/38完了)

**Session 1完了 (6個)** ✅:
- ✅ DrawioModal (2025-10-16) - ケースC
- ✅ HandsontableModal (2025-10-16) - ケースC + 複数ステータス対応
- ✅ TemplateModal (2025-10-16) - ケースC + @growi/editor state
- ✅ LinkEditModal (2025-10-16) - ケースC + @growi/editor state
- ✅ TagEditModal (2025-10-16) - ケースC
- ✅ ConflictDiffModal (2025-10-16) - ケースC

**Session 2完了 (11個)** ✅:
- ✅ DeleteBookmarkFolderModal (2025-10-17) - ケースC, BasicLayout
- ✅ PutbackPageModal (2025-10-17) - ケースC, JSX→TSX変換
- ✅ AiAssistantManagementModal (2025-10-17) - ケースC
- ✅ PageSelectModal (2025-10-17) - ケースC
- ✅ GrantedGroupsInheritanceSelectModal (2025-10-17) - ケースC
- ✅ DeleteAttachmentModal (2025-10-17) - ケースC
- ✅ PageBulkExportSelectModal (2025-10-17) - ケースC
- ✅ PagePresentationModal (2025-10-17) - ケースC
- ✅ EmptyTrashModal (2025-10-17) - ケースB
- ✅ CreateTemplateModal (2025-10-17) - ケースB
- ✅ DeleteCommentModal (2025-10-17) - ケースB

**Session 3 & 4完了 (2個)** ✅:
- ✅ SearchOptionModal (2025-10-17) - ケースA, SearchPage配下
- ✅ DeleteAiAssistantModal (2025-10-17) - ケースC, AiAssistantSidebar配下

---

## ✅ 完了済みPageAlerts (4個) 🎉

**Session 5完了 (2025-10-17)** ✅:

全てPageAlerts.tsxで`useLazyLoader`を使用した動的ロード実装に変更。
Next.js `dynamic()`から`useLazyLoader`への移行により、表示条件に基づいた真の遅延ロードを実現。

1. **TrashPageAlert** (171行)
   - **表示条件**: `isTrashPage` hook
   - **頻度**: ゴミ箱ページのみ（極めて低頻度）
   - **実装**: `useLazyLoader('trash-page-alert', ..., isTrashPage)`

2. **PageRedirectedAlert** (60行)
   - **表示条件**: `redirectFrom != null && redirectFrom !== ''`
   - **頻度**: リダイレクト時のみ（低頻度）
   - **実装**: `useLazyLoader('page-redirected-alert', ..., redirectFrom != null && redirectFrom !== '')`

3. **FullTextSearchNotCoverAlert** (40行)
   - **表示条件**: `markdownLength > elasticsearchMaxBodyLengthToIndex`
   - **頻度**: 非常に長いページのみ（低頻度）
   - **実装**: `useLazyLoader('full-text-search-not-cover-alert', ..., shouldShowFullTextSearchAlert)`

4. **FixPageGrantAlert** ⭐ 最重要 (412行)
   - **サイズ**: 412行（大規模）
   - **特徴**: 内部にModalコンポーネント含む
   - **表示条件**: `!dataIsGrantNormalized.isGrantNormalized` (権限修正が必要な時)
   - **頻度**: 低頻度
   - **実装**: `useLazyLoader('fix-page-grant-alert', ..., shouldShowFixPageGrantAlert)`
   - **効果**: 最大のバンドル削減効果

### PageAlerts最適化の技術的詳細

**Before**: Next.js `dynamic()` を使用
```tsx
const FixPageGrantAlert = dynamic(
  () => import('./FixPageGrantAlert').then((mod) => mod.FixPageGrantAlert),
  { ssr: false },
);
```
- **問題点**: getLayoutパターンでは初期ロード時にすべてダウンロードされる

**After**: `useLazyLoader` を使用
```tsx
const FixPageGrantAlert = useLazyLoader<Record<string, unknown>>(
  'fix-page-grant-alert',
  () => import('./FixPageGrantAlert').then(mod => ({ default: mod.FixPageGrantAlert })),
  shouldShowFixPageGrantAlert, // 表示条件に基づく
);
```
- **解決**: 表示条件が真になった時のみダウンロード
- **効果**: 全ページの初期ロード時の不要なレンダリングとダウンロードを削減

---

## ⏭️ 最適化不要/スキップ（19個）

### 非モーダルコンポーネント（1個）
- ❌ **ShowShortcutsModal** (35行) - 実体はモーダルではなくホットキートリガーのみ

### 親ページ低頻度 - Me画面（2個）
- ⏸️ **AssociateModal** (142行) - Me画面（低頻度）内のモーダル
- ⏸️ **DisassociateModal** (94行) - Me画面（低頻度）内のモーダル

### 親ページ低頻度 - Admin画面（3個）
- ⏸️ **ImageCropModal** (194行) - Admin/Customize（低頻度）内のモーダル
- ⏸️ **DeleteSlackBotSettingsModal** (103行) - Admin/SlackIntegration（低頻度）内のモーダル
- ⏸️ **PluginDeleteModal** (103行) - Admin/Plugins（低頻度）内のモーダル

### 低優先スキップ（1個）
- ⏸️ **PrivateLegacyPagesMigrationModal** (133行) - ユーザー指示によりスキップ

### クラスコンポーネント（2個）
- ❌ **UserInviteModal** (299行) - .jsx、対象外
- ❌ **GridEditModal** (263行) - .jsx、対象外

### 管理画面専用・低頻度（12個）

管理画面自体が遅延ロードされており、使用頻度が極めて低いため最適化不要:

- SelectCollectionsModal (222行) - ExportArchiveData
- ImportCollectionConfigurationModal (228行) - ImportData
- NotificationDeleteModal (53行) - Notification
- DeleteAllShareLinksModal (61行) - Security
- LdapAuthTestModal (72行) - Security
- ConfirmBotChangeModal (58行) - SlackIntegration
- UpdateParentConfirmModal (93行) - UserGroupDetail
- UserGroupUserModal (110行) - UserGroupDetail
- UserGroupDeleteModal (208行) - UserGroup
- UserGroupModal (138行) - ExternalUserGroupManagement
- PasswordResetModal (228行) - Users
- ConfirmModal (74行) - App

---

## 📈 最適化進捗チャート

```
完了済み: ████████████████████████████████████████████████████████████  29/48 (60%) 🎉
スキップ:  ████████                                                      8/48 (17%)
対象外:   ██                                                            2/48 (4%)
不要:     ███████████                                                  11/48 (23%)
```

**V3最適化完了！** 🎉

---

## 🎉 V3最適化完了サマリー

### 達成内容
- **モーダル最適化**: 25個
- **PageAlerts最適化**: 4個
- **合計**: 29/48 (60%)

### 主要成果

1. **useLazyLoader実装**: 汎用的な動的ローディングフック
   - グローバルキャッシュによる重複実行防止
   - 表示条件に基づく真の遅延ロード
   - テストカバレッジ完備

2. **3つのケース別最適化パターン確立**:
   - ケースA: 単一ファイル → ディレクトリ構造化
   - ケースB: Container-Presentation分離 (Modal外枠なし) → リファクタリング
   - ケースC: Container-Presentation分離 (Modal外枠あり) → 最短経路 ⭐

3. **PageAlerts最適化**: Next.js dynamic()からuseLazyLoaderへの移行
   - 全ページの初期ロード削減
   - FixPageGrantAlert (412行) の大規模バンドル削減

### パフォーマンス効果

- **初期バンドルサイズ削減**: 29コンポーネント分の遅延ロード
- **初期レンダリングコスト削減**: Container-Presentation分離による無駄なレンダリング回避
- **メモリ効率向上**: グローバルキャッシュによる重複ロード防止

### 技術的成果

- **Named Export標準化**: コード可読性とメンテナンス性向上
- **型安全性保持**: ジェネリクスによる完全な型サポート
- **開発体験向上**: 既存のインポートパスは変更不要

---

## 📝 今後の展開（オプション）

### 残りの19個の評価

現在スキップ・対象外としている19個について、将来的に再評価可能：

1. **Me画面モーダル** (2個): Me画面自体の使用頻度が上がれば最適化検討
2. **Admin画面モーダル** (15個): 管理機能の使用パターン変化で再評価
3. **クラスコンポーネント** (2個): Function Component化後に最適化可能

### さらなる最適化の可能性

- 高頻度モーダル (SearchModal, PageCreateModal) のコード分割検討
- 他のレイアウトでの同様パターン適用
- ページトランジションの最適化

---

## 🏆 完了日: 2025-10-17

**V3最適化プロジェクト完了！** 🎉

- モーダル最適化: 25個 ✅
- PageAlerts最適化: 4個 ✅
- 合計達成率: 60% (29/48) ✅
- 目標達成！ 🎊
