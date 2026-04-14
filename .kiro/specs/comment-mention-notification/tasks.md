# Implementation Plan

- [ ] 1. バックエンド: メンション通知パイプラインの整備
- [ ] 1.1 メンション専用アクティビティタイプを追加する
  - `SupportedAction` enum に `ACTION_COMMENT_MENTION` を追加する
  - `EssentialActionGroup` に `ACTION_COMMENT_MENTION` を追加する（`AllEssentialActions` は自動更新）
  - _Requirements: 1.1_

- [ ] 1.2 メンション対象ユーザーへの通知挿入メソッドを実装する
  - `InAppNotificationService` に `insertMentionNotifications` メソッドを追加する
  - `upsertByActivity` を使わず `InAppNotification.insertMany` で直接挿入することで7日間重複排除を回避する
  - `mentionedUserIds` から `actionUserId`（コメント投稿者自身）を除外する
  - 挿入後に `emitSocketIo` で対象ユーザーへリアルタイム通知を送信する
  - `mentionedUserIds` が空の場合は早期 return する
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 1.3 コメント投稿 API にメンション通知呼び出しを組み込む
  - `api.add` 内で `res.json()` 送信後に `getMentionedUsers` を呼び出す
  - `insertMentionNotifications` に取得したユーザー ID、投稿者 ID、アクティビティ、スナップショットを渡す
  - メンション通知の失敗がコメント投稿レスポンスをブロックしないよう try-catch でサイレントフェールさせる（`logger.error` で記録）
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 1.4 バックエンドのユニットテストを作成する
  - `insertMentionNotifications` のテスト: 投稿者自身の除外、空配列での早期 return、socket イベントの発火
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. 統合テストを作成する
- [ ] 2.1 メンション通知の統合テストを作成する
  - `POST /comments.add` でメンション含むコメント投稿時に `InAppNotification` が挿入されること
  - 自分自身をメンションした場合に通知が作成されないこと
  - 同一ユーザーへの2回目メンション（7日以内）でも新規通知が作成されること（重複排除バイパスの検証）
  - _Requirements: 1.1, 1.2, 1.3_
