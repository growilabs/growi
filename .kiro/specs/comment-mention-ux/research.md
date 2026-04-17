# Research & Design Decisions

---

## Summary

- **Feature**: `comment-mention-ux`
- **Discovery Scope**: Extension（既存システムへの拡張）
- **Key Findings**:
  - コメントレンダラーは `generateSimpleViewOptions` で remark/rehype プラグインを積む構造で、新規 remark プラグイン追加が可能
  - CodeMirror エディタへの拡張は `appendExtensions` API と `emojiAutocompletionSettings.ts` パターンで実現可能
  - ユーザー検索 API `GET /_api/v3/users/?searchText=...` が既存で利用可能

---

## Research Log

### コメントレンダラーへの remark プラグイン追加

- **Context**: `@username` のビジュアル強調表示の実装方法
- **Sources Consulted**: `renderer.tsx`, `Comment.tsx`, `stores/renderer.tsx`
- **Findings**:
  - コメント用レンダラーは `generateSimpleViewOptions` を経由する（`useCommentForCurrentPageOptions`）
  - `remarkPlugins.push(...)` で remark プラグインを追加できる
  - 既存 remark プラグイン (`attachment.ts`, `xsv-to-table.ts` 等) を参考にプラグイン作成可能
  - XSS 対策のため sanitize option に `span` タグと `className` 許可を追加する必要あり
- **Implications**: `apps/app/src/services/renderer/remark-plugins/mention.ts` として新規作成し、`generateSimpleViewOptions` に追加

### CodeMirror 拡張パターン

- **Context**: `@` 入力時のユーザーサジェスト実装方法の調査
- **Sources Consulted**: `emojiAutocompletionSettings.ts`, `CodeMirrorEditorComment.tsx`, `useCodeMirrorEditorIsolated`
- **Findings**:
  - `@codemirror/autocomplete` の `autocompletion` + `CompletionContext` パターンが emoji で実証済み
  - `CodeMirrorEditorComment.tsx` の `appendExtensions` API で拡張追加可能
  - `packages/editor` は `apps/app` に依存できないため、ユーザーフェッチ関数を外部から注入する必要がある（ファクトリパターン）
- **Implications**: `createMentionCompletionExtension(fetchUsers)` として設計し、`CommentEditor.tsx` 側でフェッチ関数を渡す

### ユーザー検索 API

- **Context**: オートコンプリートのユーザー一覧取得
- **Sources Consulted**: `apps/app/src/server/routes/apiv3/users.js`
- **Findings**:
  - `GET /_api/v3/users/?searchText=...&selectedStatusList[]=active` が既存
  - `searchText` で前方一致 RegExp 検索を実行
  - 認証必須 (`loginRequired`)
- **Implications**: 新規 API 不要。既存エンドポイントを再利用可能

---

## Design Decisions

### Decision: remark プラグインでメンションをレンダリング

- **Context**: コメント本文内 `@username` の視覚的強調
- **Selected Approach**: `apps/app/src/services/renderer/remark-plugins/mention.ts` として remark プラグインを新規作成。`generateSimpleViewOptions` に追加
- **Rationale**: 既存のレンダリングパイプラインに自然に組み込める。プレビューと投稿後表示の両方で同一のプラグインが適用されるため、一貫性が保てる
- **Trade-offs**: `rehype-sanitize` の設定変更が必要。sanitize option に `span` と `data-mention` 属性を許可する必要がある

### Decision: ファクトリパターンでオートコンプリート拡張を注入

- **Context**: `packages/editor` の CodeMirror 拡張に GROWI API への依存を持ち込まない
- **Selected Approach**: ファクトリ関数 `createMentionCompletionExtension(fetchUsers)` を `packages/editor` に定義。`CommentEditor.tsx` で GROWI API を呼ぶコールバックを渡して初期化
- **Rationale**: パッケージ間の依存方向を維持。`packages/editor` は `apps/app` を知らない
- **Trade-offs**: `CommentEditor.tsx` 側にフェッチ関数の実装が必要

---

## Risks & Mitigations

- remark プラグインの sanitize option 漏れによる XSS → sanitize option の単体テストで検証
- オートコンプリート API のレート制限・パフォーマンス → デバウンス処理（300ms）を実装に含める

---

## References

- `packages/editor/src/client/services-internal/extensions/emojiAutocompletionSettings.ts` — オートコンプリートの参考実装
- `apps/app/src/client/services/renderer/renderer.tsx` — `generateSimpleViewOptions`
- `apps/app/src/server/routes/apiv3/users.js` — ユーザー検索 API
