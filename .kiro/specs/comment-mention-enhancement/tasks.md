# Implementation Plan

- [ ] 1. バックエンド: メンション通知パイプラインの整備
- [ ] 1.1 メンション専用アクティビティタイプを追加する
  - `SupportedAction` enum に `ACTION_COMMENT_MENTION` を追加する
  - `AllEssentialActions` 配列に `ACTION_COMMENT_MENTION` を含める（追加しないと通知が発火しないため必須）
  - _Requirements: 1.1_

- [ ] 1.2 メンション対象ユーザーへの通知挿入メソッドを実装する
  - `InAppNotificationService` に `insertMentionNotifications` メソッドを追加する
  - `upsertByActivity` を使わず `InAppNotification.insertMany` で直接挿入することで7日間重複排除を回避する
  - `mentionedUserIds` から `actionUserId`（コメント投稿者自身）を除外する
  - 挿入後に `emitSocketIo` で対象ユーザーへリアルタイム通知を送信する
  - `mentionedUserIds` が空の場合は早期 return する
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 1.3 コメント投稿 API にメンション通知呼び出しを組み込む
  - `api.add` 内でコメント保存・`activityEvent.emit` の後に `getMentionedUsers` を呼び出す
  - `insertMentionNotifications` に取得したユーザー ID、投稿者 ID、アクティビティ、スナップショットを渡す
  - メンション通知の失敗がコメント投稿レスポンスをブロックしないよう try-catch でサイレントフェールさせる（`logger.error` で記録）
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 1.4 バックエンドのユニットテストを作成する
  - `getMentionedUsers` のテスト: `@username` 抽出、重複除去、存在しないユーザーの無視
  - `insertMentionNotifications` のテスト: 投稿者自身の除外、空配列での早期 return、socket イベントの発火
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. (P) フロントエンド: メンションのビジュアルフィードバック実装
  - タスク 3 と並行して実装可能（触るファイルが完全に独立している）

- [ ] 2.1 (P) remark プラグインで `@username` を強調表示用ノードに変換する
  - `apps/app/src/services/renderer/remark-plugins/` に `mention.ts` を新規作成する
  - テキストノードを走査して `/\B@[\w@.-]+/g` にマッチする部分を `mention` カスタムノードに変換する
  - rehype ハンドラで `<span class="mention-user" data-mention="username">@username</span>` として出力する
  - _Requirements: 2.1, 2.2_

- [ ] 2.2 (P) XSS サニタイズ設定にメンション用要素を追加する
  - `mentionSanitizeOption` を作成し `span` タグと `className`・`data-mention` 属性を許可する
  - 既存の sanitize option と deepmerge して適用する
  - _Requirements: 2.1_

- [ ] 2.3 (P) コメントレンダラーにメンションプラグインを組み込む
  - `generateSimpleViewOptions` の `remarkPlugins.push` に `mentionPlugin` を追加する
  - `rehypeSanitizePlugin` の deepmerge に `mentionSanitizeOption` を追加する
  - コメントプレビューと投稿後表示の両方で同一の options が使われることを確認する
  - _Requirements: 2.1, 2.3_

- [ ]* 2.4 (P) remark プラグインのユニットテストを作成する
  - `@username` が正しく AST 変換されること
  - スペースなし連続テキスト・空文字・日本語でのエッジケース
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 3. (P) フロントエンド: メンション入力補完の実装
  - タスク 2 と並行して実装可能（触るファイルが完全に独立している）

- [ ] 3.1 (P) CodeMirror 向けメンション補完拡張のファクトリを作成する
  - `packages/editor/src/client/services-internal/extensions/` に `mentionAutocompletionSettings.ts` を新規作成する
  - `emojiAutocompletionSettings.ts` のパターンを踏襲して `@codemirror/autocomplete` の `autocompletion` + `CompletionContext` を使う
  - `@` に続く1文字以上の入力でトリガーするよう正規表現を設定する（`/(?<!\w)@\w+$/`）
  - 候補取得は外部注入の `fetchUsers` コールバック経由にして `packages/editor` から `apps/app` への依存を持ち込まない
  - 候補選択時に `@文字列` 全体を `@username` に置換する
  - 最大10件（`maxMatches: 10`）に制限する
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3.2 (P) コメントエディタに補完拡張を組み込む
  - `CommentEditor.tsx` に `fetchUsers` 関数を実装する（`/_api/v3/users/?searchText=...&selectedStatusList[]=active`）
  - 300ms デバウンスを `fetchUsers` に適用してリクエスト頻度を抑制する
  - `useEffect` 内で `createMentionCompletionExtension(fetchUsers)` を生成し `codeMirrorEditor?.appendExtensions` で登録する
  - _Requirements: 3.1, 3.2, 3.5_

- [ ]* 3.3 (P) 補完拡張のユニットテストを作成する
  - `@a` でトリガーされること・`a` では非発火であること
  - 最大件数制限（10件）が機能すること
  - 候補選択時の文字列置換が正しく行われること
  - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [ ] 4. 統合テストと動作検証
- [ ] 4.1 メンション通知の統合テストを作成する
  - `POST /comments.add` でメンション含むコメント投稿時に `InAppNotification` が挿入されること
  - 自分自身をメンションした場合に通知が作成されないこと
  - 同一ユーザーへの2回目メンション（7日以内）でも新規通知が作成されること（重複排除バイパスの検証）
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 4.2 ユーザー検索 API の統合テストを作成する
  - `GET /_api/v3/users/?searchText=ab` で前方一致ユーザーが返却されること
  - 認証なしアクセスで 401 が返ること
  - _Requirements: 3.1_
