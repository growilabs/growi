# Research & Design Decisions

---

## Summary

- **Feature**: `comment-mention-notification`
- **Discovery Scope**: Extension（既存システムへの拡張）
- **Key Findings**:
  - メンション通知の繰り返し問題の根本原因は `upsertByActivity` の7日間重複排除ウィンドウ。同じ (user, target, action, snapshot) の組み合わせが7日以内に再発生した場合、通知がマージされる
  - `getMentionedUsers` は `CommentService` に実装済み。新規実装不要
  - `InAppNotification.insertMany` で直接挿入することで重複排除を回避できる

---

## Research Log

### メンション通知の重複排除問題

- **Context**: ユーザーが「2回目以降メンションされても通知が来ない」と報告
- **Sources Consulted**: `in-app-notification.ts`, `pre-notify.ts`, `comment.js`, `activity.ts`
- **Findings**:
  - `upsertByActivity` フィルター: `{ user, target, action, createdAt: { $gt: lastWeek }, snapshot }`
  - 7日以内に同一ページで同一ユーザーへの `ACTION_COMMENT_CREATE` 通知が重複すると `$addToSet` でマージ
  - サブスクライバー（ページ編集者）とメンション対象ユーザーが同一パスで処理されるため、メンション通知にも重複排除が適用される
- **Implications**: メンション通知を重複排除の対象外にするか、別アクションタイプで分離する必要がある

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存通知パスに統合 | `notificationTargetUsers` にメンション対象を含めて `upsertByActivity` を通す | 変更最小 | 7日重複排除により繰り返しメンションが無効化される | 現状実装、問題あり |
| B: 専用アクションタイプ `ACTION_COMMENT_MENTION` | 別アクションを追加し独立した通知フローを確立 | 重複排除が分離される、意味的に明確 | enum 拡張が必要 | 採用 |
| C: `upsertByActivity` にスキップオプションを追加 | 重複排除をオプションで無効化 | 変更範囲が小さい | 通知スパムのリスク、通知モデルの整合性が複雑になる | 非採用 |

---

## Design Decisions

### Decision: メンション通知に専用アクションタイプを使用

- **Context**: 繰り返しメンション通知が7日間重複排除によって抑制される問題
- **Selected Approach**: `ACTION_COMMENT_MENTION` アクションタイプを `interfaces/activity.ts` の `SupportedAction` に追加。`api.add` でコメント保存後、メンション対象ユーザーに対して `insertMentionNotifications` で直接挿入する
- **Rationale**: メンション通知の意味的独立性を保ちつつ、既存の通知パイプラインへの影響を最小化できる
- **Trade-offs**: `interfaces/activity.ts` の変更が必要。ただし enum への追加のみで既存コードへの影響は最小
- **Follow-up**: `EssentialActionGroup` への追加を忘れずに

---

## Risks & Mitigations

- `ACTION_COMMENT_MENTION` の `EssentialActionGroup` 追加漏れ → 実装タスクに明示的に記載
- メンション通知の自分自身へのフィルタリング漏れ → `insertMentionNotifications` 内で `actionUserId` を除外する処理を実装

---

## References

- `apps/app/src/server/routes/comment.js` — コメント API ルートハンドラ
- `apps/app/src/server/service/comment.ts` — `getMentionedUsers` 実装
- `apps/app/src/server/service/in-app-notification.ts` — `upsertByActivity` 重複排除ロジック
- `apps/app/src/server/service/pre-notify.ts` — 通知対象ユーザー収集
- `apps/app/src/interfaces/activity.ts` — `SupportedAction`, `EssentialActionGroup` 定義
