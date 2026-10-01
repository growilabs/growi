# Brief: comment

## Problem

コメントを API で読む利用者(GROWI MCP の `getComments`、外部スクリプトなど)は、apiv1 の `GET /_api/comments.get` 経由ではインラインコメントを取得できない。インラインコメント用の取得 API は別系統で、共有リンクからは使えず、MCP にも対応するツールが無い。

## Current State

- `GET /_api/comments.get`(`apps/app/src/server/routes/comment.js`)は、`findCommentsByPageId` / `findCommentsByRevisionId` が `isInline: { not: true }` を固定で付けるため、インラインコメントを一切返さない。
- `GET /_api/v3/inline-comments?pageId=...`(`apps/app/src/features/inline-comment/server/routes/list.ts`)は `isInline: true` の起点コメントを取り、返信を `replies` にまとめて返す。`certifySharedPage` は通さない。
- 共有リンクからインラインコメントを隠す根拠は薄い。`quote` は本文の一部で、共有リンクの閲覧者は `GET /_api/v3/revisions/list` と `GET /_api/v3/revisions/:id` で、API 経由なら過去リビジョンの本文もすでに読める。隠している実際の理由は、`inline-comment` スペックが共有リンク対応を範囲外としたことによる。

## Desired Outcome

- 通常コメントとインラインコメントを 1 本で取得できる apiv3 の API(`GET /_api/v3/comments`)がある。
- 新 API に `@swagger` の記述があり、OpenAPI と MCP から使える。
- apiv1 の `GET /_api/comments.get` は deprecate として当面維持し、挙動は変えない。

## 位置づけ

このスペックは、コメントの「取得と件数」の契約を持ち続ける永続的なスペックである。現時点の範囲は取得と件数だけで、作成、編集、削除は含めない。

`.claude/rules/spec-lifecycle.md` の amend スペック(最後に自分を削除する)にはしない。理由は、この契約が通常コメント、インラインコメント、共有リンクにまたがり、書き戻し先を `inline-comment` と `share-link-comments` に分けると、1つの契約の持ち主が2つのスペックに分かれてしまうため。新しい取得 API を作る部分は新規機能にあたり、ルールの対象外でもある。

## 移管元

最後のタスクで、次の既存スペックから取得と件数に関する記述をこのスペックへ移し、元の本文は「この変更がなかった前提」で書き直す。このスペック自体は削除しない。

| 移管元スペック | 移す契約 |
|---|---|
| `inline-comment` | 要件 6(共有リンク閲覧者へのデータ非公開)の AC1 と AC3。設計の「アーキテクチャ選定」節。`GET /_api/v3/inline-comments`(`list.ts`、`InlineCommentService.listByPageId`)の扱い |
| `share-link-comments` | 共有リンク閲覧者が取得できるコメントの契約(インラインコメントを含めるか) |

Revalidation Triggers に触れる場合は、要件フェーズで対象スペックごとに明示する。

## Scope

- **In**: 新しい apiv3 のコメント一覧取得 API。`@swagger` 記述。クライアントの移行範囲の決定。既存 `GET /_api/v3/inline-comments` の存続判断。
- **Out**: apiv1 `comments.get` の挙動変更(deprecate の注記のみ)。コメントの作成、編集、削除、解決の API 変更。MCP サーバー本体の変更。

## Constraints

- apiv1 の取得(`findCommentsByPageId` / `findCommentsByRevisionId`)の `isInline` 除外は、旧 API を維持するため残す。件数の集計(`countCommentByPageId`)の除外は外す(要件 7.1)。
- 新 API の認可は、標準の middleware を再利用し、並行実装しない。
- 404 一様応答の規約(`page-write-action-403-404`)と、`apps/app/.claude` 配下の apiv3 ルート規約に従う。
- スペックの文書は `spec.json.language`(ja)で書く。
