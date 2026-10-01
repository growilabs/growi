# Requirements Document

## Project Description (Input)
共有リンク（`/share/{shareLinkId}`）ページでコメントを表示できるようにする機能。

### 背景・目的
通常ページ（`PageView`）では、`Comments` コンポーネントでコメントの表示と投稿ができる。共有リンクページ（`ShareLinkPageView`）でも、共有リンク経由の閲覧者（未ログインのゲストを含む）が、同じ `Comments` コンポーネントでコメントを読めるようにする。

### スコープの方針
- 共有リンクからは「コメントの**閲覧（表示）のみ**」できる。投稿・更新・削除はできない（read-only）。`comments.add` / `comments.update` / `comments.remove` はゲストに使わせない。

### 関連コード
- 共有ページの入口: `apps/app/src/pages/share/[[...path]]/index.page.tsx`
- 共有ページ本体: `apps/app/src/components/ShareLinkPageView/ShareLinkPageView.tsx`（`next/dynamic` で読み込んだ `Comments` を `isReadOnly` 付きで描画する）
- 通常ページ: `apps/app/src/components/PageView/PageView.tsx`（`next/dynamic` で `Comments` を描画する）
- コメントコンポーネント: `apps/app/src/client/components/Comments.tsx`（`isReadOnly` のとき投稿フォームを出さず、0件なら空状態の案内を出す）
- コメント取得フック: `apps/app/src/stores/comment.tsx` の `useSWRxPageComment`。`comment` スペックの `useSWRxCommentList`（`apps/app/src/features/comment/client/stores/comment-list.ts`）を通して `GET /_api/v3/comments?pageId=...&shareLinkId=...` から取得し、通常コメントだけを返す
- 共有リンクの判定: `apps/app/src/server/middlewares/certify-shared-page.js`（`pageId` または `page_id` と `shareLinkId` を、`prisma.sharelinks` の共有リンクと照合し、有効なら `req.isSharedPage = true` を立てる）
- ゲスト許可: `apps/app/src/server/middlewares/login-required.ts`（`isGuestAllowed && req.isSharedPage` なら通す）
- 旧式のコメント取得 API: `apps/app/src/server/routes/index.js` の `/comments.get` と、`apps/app/src/server/routes/comment.js` の `comment.api.get`。外部の API 利用者のために残っている非推奨の API で、画面からは呼ばない。共有リンク経由のときは `Page.isAccessiblePageByViewer` による閲覧権限の確認を省く

## Introduction

本機能は、共有リンク（`/share/{shareLinkId}`）ページを訪れた閲覧者（未ログインのゲストを含む）が、共有対象ページに投稿済みのコメントを**閲覧**できるようにする。コメントの投稿・更新・削除は引き続き不可（read-only）であり、共有リンク経由の閲覧者に対してのみ、対象ページのコメント取得を許可する。許可の判定は、既存の添付ファイル共有と同等の「有効な共有リンクの文脈からのアクセスに限る」境界に従う。

共有リンクページは、`comment` スペックのコメント一覧 API（`GET /_api/v3/comments`）からコメントを取得し、通常コメントだけを表示する。この API が共有リンク経由で何を返すか（通常コメントとインラインコメントの両方を読み取り専用で返す）は `comment` スペックが定める。

Redmine チケットとの対応のため、実装は次の3群に分かれる（詳細は tasks.md）:
1. Comments コンポーネントの有効化（閲覧専用での描画）
2. `useSWRxPageComment` が共有リンクの ID を付けて取得すること
3. 旧式の `/comments.get` で、共有リンク閲覧者を `isAccessiblePageByViewer` で拒否しないこと

## Boundary Context

- **In scope（本機能が担う観測可能な振る舞い）**:
  - 共有リンクページにおける既存コメントの閲覧表示
  - 共有リンク閲覧者（未ログイン含む）に対するコメント**取得**の許可
  - 共有リンクページ上でのコメント投稿・更新・削除手段を提供しないこと（read-only 表示）
- **Out of scope（本機能が担わないこと）**:
  - 共有リンク経由でのコメント投稿・更新・削除の許可（従来どおり拒否を維持）
  - 通常（非共有）ページのコメント機能の挙動変更
  - 共有リンクの発行・期限・有効性そのものの仕様変更
  - コメント一覧 API（`GET /_api/v3/comments`）の契約。共有リンク経由で返すコメントの範囲や、版の指定を無視することを含め、`comment` スペックが定める（`comment` 要件 3.3、3.4、2.5）
- **Adjacent expectations（隣接する前提）**:
  - 有効な共有リンクの存在と、その共有対象ページの特定は既存の共有リンク基盤に依存する
  - 共有リンクページに表示するコメントは、`comment` スペックの取得フック（`useSWRxPageComment`）が返す通常コメントだけである。インラインコメントは表示しない（`comment` スペックの要件 6.5）
  - 共有リンク機能が管理設定で無効化されている場合は、共有ページ自体が閲覧不可であり、コメントも表示されない

## Requirements

### Requirement 1: 共有リンクページでのコメント閲覧
**Objective:** 共有リンクの閲覧者として、共有対象ページに投稿済みのコメントを閲覧したい。ページ上の議論や補足の文脈を把握できるようにするため。

#### Acceptance Criteria
1. When 閲覧者が有効な共有リンクページを開いたとき, the 共有リンクページ shall 共有対象ページのコメント一覧を表示する。
2. While 共有対象ページにコメントが1件も存在しない状態のとき, the 共有リンクページ shall コメントが存在しない旨を示すメッセージ（空状態の案内）を表示し、エラーを表示しない。
3. When 共有対象ページがトップページ（top page）であるとき, the 共有リンクページ shall コメント領域を表示しない。
4. If コメントの取得に失敗したとき, then the 共有リンクページ shall ページ本文の表示を妨げない。
5. While 共有リンク機能が管理設定で無効化されている状態のとき, the 共有リンクページ shall コメントを表示しない。

### Requirement 2: コメントの投稿・更新・削除の不可（read-only）
**Objective:** 運営者として、共有リンク経由の閲覧者にコメントの投稿・更新・削除をさせたくない。共有リンクは閲覧目的であり、未認証ユーザーによる書き込みを防ぐため。

#### Acceptance Criteria
1. While 閲覧者が共有リンクページを閲覧しているとき, the 共有リンクページ shall コメント投稿フォームを表示しない。
2. If 共有リンク経由（未ログイン）でコメントの投稿が要求されたとき, then the コメント投稿機能 shall 当該要求を拒否する。
3. If 共有リンク経由（未ログイン）でコメントの更新が要求されたとき, then the コメント更新機能 shall 当該要求を拒否する。
4. If 共有リンク経由（未ログイン）でコメントの削除が要求されたとき, then the コメント削除機能 shall 当該要求を拒否する。
5. The コメント投稿・更新・削除機能 shall 本機能による緩和を受けず、従来どおりの認証要件を維持する。

### Requirement 3: 共有リンク閲覧者へのコメント取得許可
**Objective:** 共有リンクの閲覧者（未ログインを含む）として、共有対象ページのコメントを取得できるようにしたい。共有リンクページ上で表示するため。

#### Acceptance Criteria
1. When 有効な共有リンクの文脈で共有対象ページのコメント取得が要求されたとき, the コメント取得 API shall ログイン状態に関わらず当該ページのコメント一覧を返す。
2. When 共有対象ページが閲覧者の通常権限では閲覧不可であっても有効な共有リンクの文脈で取得が要求されたとき, the コメント取得 API shall 通常のアクセス権判定によって拒否せず、コメント一覧を返す。
3. While 共有リンクの文脈で取得されたコメントを返す状態のとき, the コメント取得 API shall コメント投稿者の個人情報を安全な形で返す。項目の範囲は `comment` スペックが定める（画面が使う `GET /_api/v3/comments` は ID・ユーザー名・表示名・プロフィール画像の URL の4項目だけ（`comment` 要件 1.9）、旧式の `/comments.get` はパスワード・API トークン・非公開のメールアドレスを除いた形（`comment` 要件 5.4））。

### Requirement 4: 不正・無効アクセスの拒否（セキュリティ境界）
**Objective:** 運営者として、共有リンクを根拠としたコメント閲覧を、許可された文脈だけに限定したい。非公開ページの情報が意図しない経路で漏れることを防ぐため。

#### Acceptance Criteria
1. If 有効な共有リンクの文脈なしに未ログインでコメント取得が要求されたとき, then the コメント取得 API shall 従来どおり当該要求を拒否する。
2. If 取得対象として要求されたページが共有リンクの対象ページと一致しないとき, then the コメント取得 API shall 共有リンクを根拠とした許可を与えない。
3. If 共有リンクが期限切れまたは無効であるとき, then the コメント取得 API shall 共有リンクを根拠とした許可を与えない。

### Requirement 5: 既存（非共有）コメント機能の非回帰
**Objective:** 既存の利用者として、通常ページのコメント機能が本変更によって影響を受けないことを保証したい。回帰による機能低下を防ぐため。

#### Acceptance Criteria
1. When ログインユーザーが通常ページを開いたとき, the PageView shall 従来どおりコメントの一覧表示と投稿フォームを提供する。
2. The コメント取得 API shall 通常（非共有リンク）経由のアクセスに対して、既存のアクセス権判定の挙動を維持する。
