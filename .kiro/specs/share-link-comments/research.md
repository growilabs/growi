# Research & Design Decisions — share-link-comments

## Summary

- 共有リンクページのコメント表示は、UI（`Comments` の描画）・クライアントの取得（`useSWRxPageComment`）・サーバーの認可の3層に分かれ、要件の3タスク群と一致する。
- 認可は、`/page/info`（`get-page-info.ts`）や `/revisions/list`（`revisions.js`）と同じ、query ベースの `certify-shared-page.js` + `req.isSharedPage` の方式に乗せる。添付ファイルが使う referer ベースの方式は使わない。
- 共有リンクの検証に使うページの ID と、コメントを取得するページの ID は、必ず同じ1つの値にする（単一 ID 不変条件）。これを守らないと、有効な共有リンクを1つ持つだけで別ページのコメントを読める。
- 画面がコメントを取得する `GET /_api/v3/comments` の契約は `comment` スペックが持つ。本スペックの認可の決定（単一 ID、共有文脈で版の指定を使わない）は、旧式の `/comments.get` と、`comment` スペックの新しい API の両方に同じ形で効いている。

## 共有リンク経由のアクセスを許可する2つの方式

GROWI には、共有リンク経由のアクセスを許可するミドルウェアが2つある。

| 方式 | ファイル | 入力 | 使っているところ | コメント取得への適合 |
|------|----------|------|------------------|----------------------|
| **query ベース** | `certify-shared-page.js` | `pageId`（query か body）または `page_id`（query）と、`shareLinkId`（query か body）。`prisma.sharelinks.findFirst({ where: { id, relatedPageId } })` で照合し、`isExpired()` を確かめる | `/page/info`、`/revisions/list`、旧式の `/comments.get`、`GET /_api/v3/comments` などの、JS から呼ぶ API | ◎ API を呼ぶ側が query を付けられる |
| **referer ベース** | `certify-shared-page-attachment/` | `Referer` ヘッダから shareLinkId を取り出し、リソースが共有ページに属するかを確かめる | 添付ファイル（`<img src>` / `<a href>` には query を付けにくい） | △ 動くが、query を付けられる API には要らない |

どちらも最後に `req.isSharedPage = true` を立て、`login-required.ts`（`isGuestAllowed && req.isSharedPage` なら通す）と組み合わせる。

## Design Decisions

### Decision: query ベースの `certify-shared-page.js` を使う（2026-06-17）

- **Context**: 共有リンク閲覧者（未ログインを含む）に、共有対象ページのコメントの取得を許可したい。
- **Alternatives Considered**:
  1. Option A: query ベースの `certify-shared-page.js` をコメント取得のルートに入れる
  2. Option B: 添付ファイルの referer ベースの仕組みをまねた、新しいミドルウェアを作る
  3. Option C: 添付ファイルのミドルウェアを、ページ ID の検証にも使えるよう共通化する
- **Selected Approach**: Option A。ルートに `certifySharedPage` を入れ、ハンドラは `revisions.js` と同じく「`isSharedPage` でなく、かつ閲覧権限が無いときだけ拒否する」形にする。
- **Rationale**: コメントの取得は JS から呼ぶ API で、`/page/info`・`/revisions/list` と同じ形にできる。referer ベースの方式は、添付ファイルの「`<img src>` に query を付けられない」という事情のための仕組みで、コメントには要らない。Option B は API の作法が他とそろわず、新しいコードとテストが増える。Option C は添付ファイルの経路を壊すおそれがあり、共通化の手間も大きい。
- **Trade-offs**: 旧式の `/comments.get` は取得に `page_id`（snake_case）を使い、他のルートの検証は `pageId`（camelCase）を使うため、名前をそろえる手当てが要る（次の Decision）。

### Decision: read-only は `Comments` の `isReadOnly` で実現する（2026-06-17）

- **Selected Approach**: `Comments` に `isReadOnly` を足し、`PageComment` へ渡す。`isReadOnly` のときは投稿フォーム（`CommentEditorPre`）を描画しない。
- **Rationale**: `PageComment` は `isReadOnly` のとき、返信ボタン・返信エディタ・削除モーダルをすべて出さない作りになっている。`Comments` の入口を1つ足すだけで、共有ページから投稿・返信・削除の手段が消える。

## 認可設計の改訂（2026-06-23 — PR #11322 セキュリティレビュー反映）

PR #11322 のレビューで、「`page_id`（取得するページ）と `pageId`（検証するページ）という2つのページ ID を併存させる設計」は IDOR（認可バイパス）を生むと指摘された。クライアントが両方を送って名前の違いを吸収する案は採らず、検証と取得を1つの ID にそろえる（単一 ID 化）。

### 防ぐ攻撃

ミドルウェアが検証する ID と、ハンドラが取得に使う ID が別のパラメータだと、どちらも攻撃者が決められるため、検証と取得がずれる。

- **CRITICAL-1（ページの取り違え / IDOR）**: ページ A の有効な共有リンクを持つ匿名ユーザーが
  `GET /_api/comments.get?page_id=<非公開ページB>&pageId=<共有ページA>&shareLinkId=<Aの有効リンク>`
  を送ると、ミドルウェアは A で検証に成功して `isSharedPage=true` を立て、ハンドラは B のコメントを返す。wiki 内の任意のページのコメントが漏れる。
- **CRITICAL-2（版の取り違え）**: `comment.api.get` は `revision_id` があると、ページと無関係に `findCommentsByRevisionId(revisionId)` で取得する。`isSharedPage=true` のまま別ページの `revision_id` を渡すと、そのコメントが返る。ページ ID を1つにしても残るので、別のガードが要る。

手本の `revisions.js`（検証・バイパス・取得のすべてで `req.query.pageId`）と `get-page-info.ts`（すべて `pageId`）は、検証と取得が同じ1つの ID なので、取り違えが起きない。コメント取得もこれにそろえる。

### 決定

- **単一 ID 化（CRITICAL-1 への対策）**: `certify-shared-page.js` は `pageId` と `page_id` の両方を読む。両方があって値が違うリクエストは、共有リンクとして認めない（一方を優先して読むだけだと、`pageId`=A を検証し `page_id`=B を取得する、というずれを作れてしまうため）。正当な呼び出し元は片方しか送らない。旧式の `/comments.get` は `page_id` だけで検証と取得を行い、`GET /_api/v3/comments` は `pageId` だけで行う。
- **`revision_id` のガード（CRITICAL-2 への対策）**: 共有文脈（`isSharedPage === true`）では版の指定を使わず、検証済みのページ ID だけで取得する。共有ページの read-only 表示はページ単位の一覧で足りる。`GET /_api/v3/comments` も共有文脈では `revisionId` を無視する（`comment` 要件 2.5）。
- **入力の検証（HIGH）**: `comments.get` の `page_id`（必須）、`shareLinkId`・`revision_id`（任意）を、`isString().bail().isMongoId()` で文字列の MongoId に限る。`page_id[$gt]=` のようなオブジェクトや、`page_id[0]=A&page_id[1]=B` のような配列を、共有リンクの照会より前に弾く。
- **負のテストを必須にする（MEDIUM）**: 「`shareLinkId` が別ページを指すと拒否される」「共有文脈で別ページの `revision_id` を渡しても、そのコメントは返らない」を結合テスト（`apps/app/src/server/routes/comment.integ.ts`）で確かめる。

> `certify-shared-page.js` を変えないという境界は採らない。`page_id` も読む形に広げ、2つの ID が食い違うリクエストを認めないことが、もっとも確実な防御になる。
