# Implementation Plan — share-link-comments

> Redmine の3チケットに対応する3メジャータスク群。各コア作業（1.1 / 2.1 / 3.1）は境界が非重複のため `(P)` で並行実装可能。E2E は全層に依存。

- [x] 1. Comments コンポーネントの有効化（read-only 描画）
- [x] 1.1 (P) Comments コンポーネントに read-only 対応を追加
  - `isReadOnly` を受け取り `PageComment` に伝播する
  - `isReadOnly` のとき投稿フォーム（`CommentEditorPre`）を描画しない
  - `isReadOnly` かつコメント0件のとき、空状態案内（`page_comment.no_comments`）を表示する。投稿フォームのある編集可能ビューでは表示しない。`page_comment.no_comments` キーを全ロケール（en_US/ja_JP/fr_FR/ko_KR/zh_CN）に追加
  - 既存の `isTopPage` ガード（トップページではコメント領域を出さない）を維持する
  - `PageView` からの既存呼び出しは `isReadOnly` 省略で従来動作（投稿フォーム表示・空状態案内なし）を維持する
  - 完了: read-only で描画するとコメント一覧のみ表示され投稿フォームが出ない。0件時は空状態案内を表示。トップページ・既存通常ページの挙動は不変
  - _Requirements: 1.2, 1.3, 2.1, 2.5, 5.1_
  - _Boundary: Comments_

- [x] 1.2 ShareLinkPageView にコメント領域を描画する
  - `next/dynamic`（`ssr: false`）で `Comments` を読み込む
  - `!isNotFound` かつ `page.revision != null` の分岐内（本文直後・footer 前）に read-only で配置する
  - `isNotFound` / `disableLinkSharing` / コメント取得失敗のときも本文表示を阻害しない。0件時の空状態案内は Comments 側（1.1）が担う
  - 完了: 有効な共有リンクページを開くとコメント領域（既存コメント or 空状態案内）が表示され、投稿フォームは存在しない
  - _Requirements: 1.1, 1.4, 1.5, 5.1_
  - _Depends: 1.1_
  - _Boundary: ShareLinkPageView_

- [x] 2. useSWRxPageComment の改善
- [x] 2.1 (P) コメント取得フックに共有リンク文脈を伝播する
  - 内部で `useShareLinkId()` を取得し、SWR キャッシュキーに `shareLinkId` を含める
  - `shareLinkId` が非null のときのみ取得クエリに `shareLinkId` を付与する（既存 `page_id` は維持。**別 `pageId` は併送しない** — 単一 ID 不変条件）
  - `shareLinkId` が null（通常ページ）のときは従来クエリのまま。`update` / `post` は変更しない
  - 完了: 共有ページではフックが `page_id` + `shareLinkId` を送信し（`pageId` は送らない）、通常ページでは従来どおり `page_id` のみ送信する
  - _Requirements: 3.1, 5.2_
  - _Boundary: useSWRxPageComment_

- [ ] 3. isAccessiblePageByViewer 問題の解決（認可 + テスト）
  - **設計改訂（2026-06-23）**: PR #11322 のセキュリティレビューを受け、「単一 ID 化（検証対象＝取得対象）」を採用。詳細は research.md「認可設計の改訂」/ design.md「単一 ID 不変条件」参照。

- [x] 3.1 (P) certify-shared-page を一般化し comments.get に結線する
  - `certify-shared-page.js` を `pageId`（camelCase）と `page_id`（snake_case）の両方を読むよう **additive 一般化**する（既存呼び出し元は `pageId` 送信のため後方互換）。**両 ID が存在し値が異なる ambiguous なリクエストは `isSharedPage` を立てずに通し、verify/fetch split による IDOR を防ぐ**（precedence 片寄せは不可）
  - `comments.get` に MongoId バリデータ `comment.api.validators.get()` を追加（`page_id` 必須 / `shareLinkId`・`revision_id` は optional）し、既存 `apiV1FormValidator` で短絡したうえで `accessTokenParser → comment.api.validators.get() → apiV1FormValidator → certifySharedPage → loginRequired → comment.api.get` の順に挿入する（バリデータを certify の前段に置き、不正入力が共有リンク DB クエリ・ハンドラに到達しないようにする）
  - 完了: 有効な `page_id` + `shareLinkId`（ページ一致・未期限切れ）のリクエストで `req.isSharedPage` が立つ。既存の `/page/info`・`/revisions/list` の挙動は不変
  - _Requirements: 3.1, 4.2, 4.3_
  - _Boundary: certify-shared-page.js, comments.get route_

- [x] 3.2 comment.api.get を isSharedPage 尊重 + 単一 ID 化に変更する
  - `!req.isSharedPage && !(await isAccessiblePageByViewer(page_id))` のときのみ拒否する（`revisions.js` と同形）
  - **共有文脈（`isSharedPage`）では `revision_id` 分岐を使わず、検証済み `page_id` でのみ取得する**（CRITICAL-2 の閉塞）。非共有経路の `revision_id` 取得は従来どおり維持
  - 入力検証はルート段の `apiV1FormValidator` が担うため、ハンドラ内に重複チェックは置かない（既存 `api.add` の `validationResult(req.body)` は実質 no-op のため踏襲しない）
  - 投稿者情報は既存の `serializeUserSecurely` を維持する
  - 完了: 共有文脈のゲストが検証済みページのコメントを取得でき、共有文脈なしのゲストは従来どおり拒否される。共有文脈で別ページの `revision_id` を渡してもそのコメントは返らない
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 5.2_
  - _Depends: 3.1_
  - _Boundary: comment.api.get_

- [x] 3.3 /comments.get の統合テストを追加する
  - 正常系: 有効な共有リンクで取得可 / 共有文脈なし未ログインで拒否 / 期限切れで拒否
  - **IDOR 防止（負のテスト・必須）**:
    - `shareLinkId` は A のまま `page_id` を別ページ B にすると拒否される（`relatedPage` 不一致 → `isSharedPage` 立たず、CRITICAL-1）
    - 共有文脈で `revision_id` に別ページ B の revision を渡しても B のコメントは返らない（検証済み `page_id`=A のコメントのみ、CRITICAL-2）
    - `page_id` が非 MongoId（`page_id[$gt]=` 等）はバリデータで拒否される（HIGH）
  - 書き込みの非開放（負のテスト）: 有効な `shareLinkId` を伴っても未ログインの `comments.add` / `comments.update` / `comments.remove` は拒否される（read-only 境界のサーバー側保証）
  - 完了: 上記すべてのケースのテストが緑になる
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.1, 4.1, 4.2, 4.3_
  - _Depends: 3.1, 3.2_

- [ ] 3.4 共有ページコメント表示の E2E 検証
  - 未ログインで有効な共有リンクを開き、既存コメントが表示され投稿フォームが存在しないことを確認する
  - コメント0件の共有リンクを開き、エラーではなく空状態案内（「コメントはありません」）が表示されることを確認する
  - 共有リンク機能の無効化時にコメントが表示されないことを確認する
  - 完了: 上記 E2E が緑になる
  - _Requirements: 1.1, 1.2, 1.5, 2.1_
  - _Depends: 1.2, 2.1, 3.1, 3.2_
