# Research & Design Decisions

---

## Summary

- **Feature**: `comment-mention-enhancement`
- **Discovery Scope**: Extension（既存システムへの拡張）
- **Key Findings**:
  - メンション通知の繰り返し問題の根本原因は `upsertByActivity` の7日間重複排除ウィンドウ。同じ (user, target, action, snapshot) の組み合わせが7日以内に再発生した場合、通知がマージされる
  - コメントレンダラーは `generateSimpleViewOptions` で remark/rehype プラグインを積む構造で、新規 remark プラグイン追加が可能
  - CodeMirror エディタへの拡張は `appendExtensions` API と `emojiAutocompletionSettings.ts` パターンで実現可能
  - ユーザー検索 API `GET /_api/v3/users/?searchText=...` が既存で利用可能

---

## Research Log

### メンション通知の重複排除問題

- **Context**: ユーザーが「2回目以降メンションされても通知が来ない」と報告
- **Sources Consulted**: `in-app-notification.ts`, `pre-notify.ts`, `comment.js`, `activity.ts`
- **Findings**:
  - `upsertByActivity` フィルター: `{ user, target, action, createdAt: { $gt: lastWeek }, snapshot }`
  - 7日以内に同一ページで同一ユーザーへの `ACTION_COMMENT_CREATE` 通知が重複すると `$addToSet` でマージ
  - サブスクライバー（ページ編集者）とメンション対象ユーザーが同一パスで処理されるため、メンション通知にも重複排除が適用される
  - `commentEvent` の `createSubscription` はページ作成・更新ルートのみで呼ばれ、コメントルートでは呼ばれない
- **Implications**: メンション通知を重複排除の対象外にするか、別アクションタイプで分離する必要がある

### CodeMirror 拡張パターン

- **Context**: `@` 入力時のユーザーサジェスト実装方法の調査
- **Sources Consulted**: `emojiAutocompletionSettings.ts`, `CodeMirrorEditorComment.tsx`, `useCodeMirrorEditorIsolated`
- **Findings**:
  - `@codemirror/autocomplete` の `autocompletion` + `CompletionContext` パターンが emoji で実証済み
  - `CodeMirrorEditorComment.tsx` の `additionalExtensions` 配列または `appendExtensions` API で拡張追加可能
  - `packages/editor` は `apps/app` に依存できないため、ユーザーフェッチ関数を外部から注入する必要がある（ファクトリパターン）
- **Implications**: `mentionAutocompletionSettingsFactory(fetchUsers)` として設計し、`CommentEditor.tsx` 側でフェッチ関数を渡す

### コメントレンダラーへの remark プラグイン追加

- **Context**: `@username` のビジュアル強調表示の実装方法
- **Sources Consulted**: `renderer.tsx`, `Comment.tsx`, `stores/renderer.tsx`
- **Findings**:
  - コメント用レンダラーは `generateSimpleViewOptions` を経由する（`useCommentForCurrentPageOptions`）
  - `remarkPlugins.push(...)` で remark プラグインを追加できる
  - 既存 remark プラグイン (`attachment.ts`, `xsv-to-table.ts` 等) を参考にプラグイン作成可能
  - XSS 対策のため sanitize option に `span` タグと `className` 許可を追加する必要あり
- **Implications**: `apps/app/src/services/renderer/remark-plugins/mention.ts` として新規作成し、`generateSimpleViewOptions` に追加

### ユーザー検索 API

- **Context**: オートコンプリートのユーザー一覧取得
- **Sources Consulted**: `apps/app/src/server/routes/apiv3/users.js`
- **Findings**:
  - `GET /_api/v3/users/?searchText=...&selectedStatusList[]=active` が既存
  - `searchText` で前方一致 RegExp 検索を実行
  - 認証必須 (`loginRequired`)
- **Implications**: 新規 API 不要。既存エンドポイントを再利用可能

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存通知パスに統合 | `notificationTargetUsers` にメンション対象を含めて `upsertByActivity` を通す | 変更最小 | 7日重複排除により繰り返しメンションが無効化される | 現状実装、問題あり |
| B: 専用アクションタイプ `ACTION_COMMENT_MENTION` | 別アクションを追加し独立した通知フローを確立 | 重複排除が分離される、意味的に明確 | enum 拡張・ActivityService の変更が必要 | 採用 |
| C: `insertByActivity` で重複排除スキップ | `upsertByActivity` に加え非 upsert の `insertByActivity` を追加 | 変更範囲が小さい | 通知スパムのリスク、通知モデルの整合性が複雑になる | 非採用 |

---

## Design Decisions

### Decision: メンション通知に専用アクションタイプを使用

- **Context**: 繰り返しメンション通知が7日間重複排除によって抑制される問題
- **Alternatives Considered**:
  1. 既存 `ACTION_COMMENT_CREATE` + `upsertByActivity` のまま（修正なし）
  2. `ACTION_COMMENT_MENTION` を新規追加し専用フロー
  3. `upsertByActivity` にスキップオプションを追加
- **Selected Approach**: `ACTION_COMMENT_MENTION` アクションタイプを `interfaces/activity.ts` の `SupportedAction` に追加。`api.add` でコメント保存後、メンション対象ユーザーに対して `ACTION_COMMENT_MENTION` アクティビティを個別に発行する
- **Rationale**: メンション通知の意味的独立性を保ちつつ、既存の通知パイプライン（ActivityService → InAppNotificationService）を最大限再利用できる
- **Trade-offs**: `interfaces/activity.ts` の変更が必要。ただし enum への追加のみで既存コードへの影響は最小
- **Follow-up**: `AllEssentialActions` への追加を忘れずに（追加しないと通知が発火しない）

### Decision: remark プラグインでメンションをレンダリング

- **Context**: コメント本文内 `@username` の視覚的強調
- **Alternatives Considered**:
  1. フロントエンドで文字列置換（React コンポーネント内）
  2. remark プラグインとして実装
  3. CSS だけで擬似的に対応
- **Selected Approach**: `apps/app/src/services/renderer/remark-plugins/mention.ts` として remark プラグインを新規作成。`generateSimpleViewOptions` に追加
- **Rationale**: 既存のレンダリングパイプラインに自然に組み込める。プレビューと投稿後表示の両方で同一のプラグインが適用されるため、一貫性が保てる
- **Trade-offs**: `rehype-sanitize` の設定変更が必要。sanitize option に `span` と `data-mention` 属性を許可する必要がある

### Decision: ファクトリパターンでオートコンプリート拡張を注入

- **Context**: `packages/editor` の CodeMirror 拡張に GROWI API への依存を持ち込まない
- **Alternatives Considered**:
  1. `packages/editor` 内で直接 fetch
  2. ファクトリ関数でフェッチコールバックを注入
  3. `CommentEditor.tsx` 内で `appendExtensions` で追加
- **Selected Approach**: ファクトリ関数 `createMentionCompletionExtension(fetchUsers)` を `packages/editor` に定義。`CommentEditor.tsx` で GROWI API を呼ぶコールバックを渡して初期化
- **Rationale**: パッケージ間の依存方向を維持。`packages/editor` は `apps/app` を知らない
- **Trade-offs**: `CommentEditor.tsx` 側にフェッチ関数の実装が必要。ただし既存の SWR パターンに沿って実装可能

---

## Risks & Mitigations

- `ACTION_COMMENT_MENTION` の `AllEssentialActions` 追加漏れ → 実装タスクに明示的に記載
- remark プラグインの sanitize option 漏れによる XSS → sanitize option の単体テストで検証
- オートコンプリート API のレート制限・パフォーマンス → デバウンス処理（300ms）を実装に含める
- メンション通知の自分自身へのフィルタリング漏れ → `getMentionedUsers` の返値から action user を除外する処理を明示

---

## References

- `apps/app/src/server/routes/comment.js` — コメント API ルートハンドラ
- `apps/app/src/server/service/comment.ts` — `getMentionedUsers` 実装
- `apps/app/src/server/service/in-app-notification.ts` — `upsertByActivity` 重複排除ロジック
- `apps/app/src/server/service/pre-notify.ts` — 通知対象ユーザー収集
- `apps/app/src/server/service/activity.ts` — `ActivityService` イベントリスナー
- `packages/editor/src/client/services-internal/extensions/emojiAutocompletionSettings.ts` — オートコンプリートの参考実装
- `apps/app/src/client/services/renderer/renderer.tsx` — `generateSimpleViewOptions`
- `apps/app/src/server/routes/apiv3/users.js` — ユーザー検索 API
