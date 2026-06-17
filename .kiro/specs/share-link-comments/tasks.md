# Implementation Plan — share-link-comments

> Redmine の3チケットに対応する3メジャータスク群。各コア作業（1.1 / 2.1 / 3.1）は境界が非重複のため `(P)` で並行実装可能。E2E は全層に依存。

- [ ] 1. Comments コンポーネントの有効化（read-only 描画）
- [x] 1.1 (P) Comments コンポーネントに read-only 対応を追加
  - `isReadOnly` を受け取り `PageComment` に伝播する
  - `isReadOnly` のとき投稿フォーム（`CommentEditorPre`）を描画しない
  - 既存の `isTopPage` ガード（トップページではコメント領域を出さない）を維持する
  - `PageView` からの既存呼び出しは `isReadOnly` 省略で従来動作（投稿フォーム表示）を維持する
  - 完了: read-only で描画するとコメント一覧のみ表示され投稿フォームが出ない。トップページ・既存通常ページの挙動は不変
  - _Requirements: 1.3, 2.1, 2.5, 5.1_
  - _Boundary: Comments_

- [x] 1.2 ShareLinkPageView にコメント領域を描画する
  - `next/dynamic`（`ssr: false`）で `Comments` を読み込む
  - `!isNotFound` かつ `page.revision != null` の分岐内（本文直後・footer 前）に read-only で配置する
  - `isNotFound` / `disableLinkSharing` / コメント取得失敗のときも本文表示を阻害しない。0件時は見出し付き空表示
  - 完了: 有効な共有リンクページを開くとコメント領域（既存コメント or 空状態）が表示され、投稿フォームは存在しない
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 5.1_
  - _Depends: 1.1_
  - _Boundary: ShareLinkPageView_

- [ ] 2. useSWRxPageComment の改善
- [ ] 2.1 (P) コメント取得フックに共有リンク文脈を伝播する
  - 内部で `useShareLinkId()` を取得し、SWR キャッシュキーに `shareLinkId` を含める
  - `shareLinkId` が非null のときのみ取得クエリに `pageId` と `shareLinkId` を併送する（既存 `page_id` は維持）
  - `shareLinkId` が null（通常ページ）のときは従来クエリのまま。`update` / `post` は変更しない
  - 完了: 共有ページではフックが `page_id` + `pageId` + `shareLinkId` を送信し、通常ページでは従来どおり `page_id` のみ送信する
  - _Requirements: 3.1, 5.2_
  - _Boundary: useSWRxPageComment_

- [ ] 3. isAccessiblePageByViewer 問題の解決（認可 + テスト）
- [ ] 3.1 (P) comments.get に共有リンク認可ミドルウェアを結線する
  - query 版 `certify-shared-page` を生成し、`comments.get` の `loginRequired` の前に挿入する
  - `accessTokenParser → certifySharedPage → loginRequired → comment.api.get` の順序を維持する
  - 完了: 有効な `pageId` + `shareLinkId`（ページ一致・未期限切れ）のリクエストで `req.isSharedPage` が立つ
  - _Requirements: 3.1, 4.2, 4.3_
  - _Boundary: comments.get route_

- [ ] 3.2 comment.api.get の取得判定を isSharedPage 尊重に変更する
  - `!req.isSharedPage && !(await isAccessiblePageByViewer)` のときのみ拒否する（`revisions.js` と同形）
  - 投稿者情報は既存の `serializeUserSecurely` を維持する
  - 完了: 共有文脈のゲストがコメントを取得でき、共有文脈なしのゲストは従来どおり拒否される
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 5.2_
  - _Depends: 3.1_
  - _Boundary: comment.api.get_

- [ ] 3.3 /comments.get の統合テストを追加する
  - 有効な共有リンクで取得可 / 共有文脈なし未ログインで拒否 / `pageId`-`shareLinkId` 不一致で拒否 / 期限切れで拒否
  - 負のテスト: 有効な `shareLinkId` を伴っても未ログインの `comments.add` / `comments.update` / `comments.remove` は拒否される（read-only 境界のサーバー側保証）
  - 完了: 上記すべてのケースのテストが緑になる
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.1, 4.1, 4.2, 4.3_
  - _Depends: 3.1, 3.2_

- [ ] 3.4 共有ページコメント表示の E2E 検証
  - 未ログインで有効な共有リンクを開き、既存コメントが表示され投稿フォームが存在しないことを確認する
  - 共有リンク機能の無効化時にコメントが表示されないことを確認する
  - 完了: 上記 E2E が緑になる
  - _Requirements: 1.1, 1.5, 2.1_
  - _Depends: 1.2, 2.1, 3.1, 3.2_
