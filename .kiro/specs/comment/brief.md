# Brief: comment

## Problem

コメントを API で読む利用者(GROWI MCP の `getComments`、外部スクリプト、GROWI 自身の画面)が、ページの通常コメントとインラインコメントを1回の呼び出しで読めるようにする。共有リンク経由の閲覧者も、同じ API で読み取り専用で読める。

## Current State

- `GET /_api/v3/comments`(`apps/app/src/features/comment/server/routes/list.ts`)が、ページの通常コメントとインラインコメントを1つの平らな一覧で返す。`certifySharedPage` を通すので、有効な共有リンク経由ならログインしていなくても読める。`@swagger` の記述があり、OpenAPI(apiv3)に載る。
- GROWI の画面(ページ末尾のコメント欄、本文のインラインコメント、共有リンクの画面、検索結果のプレビュー)は、共有の取得フック `useSWRxCommentList` を通してこの API から取得する。共有リンクの画面と検索結果のプレビューには、インラインコメントを出さない。
- apiv1 の `GET /_api/comments.get`(`apps/app/src/server/routes/comment.js`)は、外部の利用者のために残っている非推奨の API である。`findCommentsByPageId` / `findCommentsByRevisionId` が `isInline: { not: true }` を固定で付けるため、インラインコメントを返さない。画面からは呼ばない。
- インラインコメント専用の一覧取得(`GET /_api/v3/inline-comments`)は無い。この URL への GET は 404 を返す。インラインコメントの作成、返信、編集、削除、解決の API は `inline-comment` スペックが持つ。
- ページのコメント件数(`Page.commentCount`)は、通常コメントとインラインコメント(返信と解決済みを含む)の合計である。

## 位置づけ

このスペックは、コメントの「取得と件数」の契約を持ち続ける永続的なスペックである。範囲は取得と件数だけで、作成、編集、削除は含めない。

`.claude/rules/spec-lifecycle.md` の amend スペック(最後に自分を削除する)ではない。この契約は通常コメント、インラインコメント、共有リンクにまたがり、`inline-comment` と `share-link-comments` に分けて持たせると、1つの契約の持ち主が2つのスペックに分かれてしまうため。

## 関係するスペック

| スペック | 関係 |
|---|---|
| `inline-comment` | インラインコメントのデータの形と、作成、返信、編集、削除、解決の API を持つ。取得と件数は本スペックに従う(`inline-comment` の要件 6、13.5) |
| `share-link-comments` | 共有リンクの画面のコメント欄(読み取り専用)と、旧式の `comments.get` の共有リンク対応を持つ。共有リンク経由で返すコメントの範囲は本スペックに従う(本スペックの要件 3.3) |

## Scope

- **In**: apiv3 のコメント一覧取得 API と、その `@swagger` 記述。画面側の取得。ページのコメント件数の数え方と更新。旧式の `comments.get` の非推奨の明示。
- **Out**: 旧式の `comments.get` の挙動。コメントの作成、編集、削除、解決の API。MCP サーバー本体と SDK。

## Constraints

- 旧式の取得(`findCommentsByPageId` / `findCommentsByRevisionId`)の `isInline` 除外は、旧 API の挙動を保つために残す。件数の集計(`countCommentByPageId`)は `isInline` で絞らない(要件 7.1)。
- 新 API の認可は、標準の middleware を再利用し、並行実装しない。
- 404 一様応答の規約(`page-write-action-403-404`)と、`apps/app/.claude` 配下の apiv3 ルート規約に従う。
- スペックの文書は `spec.json.language`(ja)で書く。
