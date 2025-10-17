# モーダル一覧 - V3動的ロード対象

## V2完了モーダル (46個) - V3動的ロード候補

### 高頻度使用 - 動的ロード非推奨 (6個)
初期ロードを維持すべきモーダル:
1. SearchModal.tsx - 検索機能 (頻繁に使用)
2. PageCreateModal.tsx - ページ作成 (重要機能)
3. PageDeleteModal.tsx - ページ削除 (重要機能)
4. TagEditModal.tsx - タグ編集
5. PageAccessoriesModal.tsx - ページアクセサリ
6. UserGroupModal.tsx - ユーザーグループ管理

### 中頻度使用 - 動的ロード推奨 (15個)
状況に応じて動的ロード:
- PageRenameModal.tsx
- PageDuplicateModal.tsx
- PageBulkExportSelectModal.tsx
- LinkEditModal.tsx
- CreateTemplateModal.tsx
- SearchOptionModal.tsx
- ImageCropModal.tsx
- DeleteCommentModal.tsx
- AssociateModal.tsx
- DisassociateModal.tsx
- EmptyTrashModal.tsx
- DeleteBookmarkFolderModal.tsx
- GrantedGroupsInheritanceSelectModal.tsx
- SelectUserGroupModal.tsx
- DescendantsPageListModal.tsx

### 低頻度使用 - 動的ロード強く推奨 (25個)
必ず動的ロード対象:
- PagePresentationModal.tsx - プレゼンテーション
- ConflictDiffModal.tsx - 競合解決
- HandsontableModal.tsx - 表編集
- DrawioModal.tsx - Drawio編集
- TemplateModal.tsx
- DeleteAiAssistantModal.tsx
- ShareScopeWarningModal.tsx
- ShortcutsModal.tsx
- DeleteAttachmentModal.tsx
- PrivateLegacyPagesMigrationModal.tsx
- PluginDeleteModal.tsx
- ShowShortcutsModal.tsx
- PutbackPageModal.jsx
- DeleteSlackBotSettingsModal.tsx
- AiAssistantManagementModal.tsx
- PageSelectModal.tsx
- その他9個

## V3実装方針

### Phase 1: 低頻度モーダル (25個)
動的ロード実装で最大効果

### Phase 2: 中頻度モーダル (15個)
使用状況を見て判断

### Phase 3: 測定・検証
- Bundle size削減効果測定
- 初回ロード時間改善確認
- ユーザー体験への影響評価

## Container-Presentation構造 (V2成果)

全46モーダルは以下の構造:
```
Modal/
  ├── Container (6-15行) - Modal wrapper
  └── Substance (全ロジック) - 動的ロード対象
```

**V3での利点**: Substanceのみ動的ロード可能
