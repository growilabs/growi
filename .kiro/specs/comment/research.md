# Research & Design Decisions

## Summary
- **Feature**: `comment`
- **Discovery Scope**: Extension(既存のコメント機能への拡張。軽い調査)
- **Key Findings**:
  - 旧 API `comments.get` が返すコメントの形は、Prisma の行 + `page`/`revision`/`replyTo` の別名 + 安全化した `creator` である。この形には、インラインコメント用の列(`isInline`、`quote` など)も全部入る。そこで整形の共通部分を `features/comment/server/serializers/to-comment-list-item.ts` の1か所にまとめ、新 API と旧 API の両方が使う。新 API の項目は旧 API の上位集合になる。ただし `creator` だけは、新 API では画面が使う4項目に絞る(下の「新 API の `creator` は、画面が使う項目だけにする」)。
  - OpenAPI の生成スクリプト(`bin/openapi/generate-spec-apiv3.sh`)は、ルートのディレクトリを**明示的に並べている**。新 API が公開仕様に載るのは、`features/comment/server/routes/*.ts` をこの一覧に入れているため。
  - ページ下部のコメント欄(`PageComment.tsx`)は、通常コメントとインラインコメントを投稿日時順に並べて表示する。新 API への切り替えで画面の「見え方」は変わらず、変わるのは取得経路だけである。
  - コメント件数は `Page.commentCount`(保存値)。通常コメントの追加と削除ではコメントイベントの購読者が、インラインコメントの作成、返信の作成、削除、返信の削除では `InlineCommentService` が直接、`Page.updateCommentCount` を呼んで更新する。

## Research Log

### 共有リンクの判定が読む引数
- **Context**: 新 API を共有リンク経由で使えるようにしたい。
- **Sources Consulted**: `apps/app/src/server/middlewares/certify-shared-page.js`
- **Findings**:
  - `certifySharedPage` は `pageId`(camelCase)と `page_id`(snake_case)の両方を受ける。両方あって値が違えば、認証しない(検証する ID と取得する ID がずれる問題を防ぐため)。
  - `shareLinkId` と、ページの ID が一致する共有リンクが有効なら、`req.isSharedPage = true` を立てる。
  - 旧 API を呼ぶ側は、`page_id` だけを送り、別の ID を併送しない(理由は `share-link-comments` の research.md「認可設計（単一 ID 化）」)。
- **Implications**: 新 API は `pageId` だけを受け付ける。クライアントは `page_id` を送らない。

### 版(リビジョン)を指定したときの旧 API の挙動
- **Context**: Requirement 2 の「次の版より前」と、旧 API の違いを確認する。
- **Sources Consulted**: `features/comment/server/models/comment.ts`、`server/routes/comment.js`
- **Findings**:
  - 旧 API は `where: { revisionId }`(完全一致)で絞る。古い版に付いたコメントは返らない。
  - 共有リンク経由のときは、別ページの版を指定して読まれるのを防ぐため、`revision_id` を無視する。
  - インラインコメントの作成では、`revisionId` を入れない(`anchorOriginRevisionId` だけを入れる)。
- **Implications**: Requirement 2 は、通常コメントの挙動も新 API では旧 API と変わる(完全一致 → 次の版より前)。旧 API は変えないので、利用者への影響は無い。

### 公開仕様(OpenAPI)の生成
- **Context**: 新 API を MCP と SDK から使えるようにする(Requirement 4)。
- **Sources Consulted**: `bin/openapi/generate-spec-apiv3.sh`、`bin/openapi/generate-operation-ids/`
- **Findings**:
  - 生成対象のディレクトリは、スクリプトに明示されている(`features/revision-diff/server/routes/*.ts` など)。
  - `Comment` スキーマは `comment.js` の中(旧 API の仕様)に定義されている。apiv3 の仕様では、新 API のルートファイル(`list.ts`)に `CommentListItem` を定義する。
  - `operationId` は、生成後の処理で自動付与される。
- **Implications**: 新 API の仕様では、別名のスキーマ(`CommentListItem`)を新 API のルートファイル内に定義する。生成スクリプトに、新しいルートのディレクトリを足す。

### 件数(`Page.commentCount`)の更新経路
- **Context**: Requirement 7 で、インラインコメントも件数に入れる。
- **Sources Consulted**: `server/service/comment.ts`、`server/models/obsolete-page.js`、`server/service/search.ts`
- **Findings**:
  - 件数は `Page.updateCommentCount(pageId)` が、`countCommentByPageId` の結果を `pages.commentCount` に書いて更新する。
  - この呼び出しは、コメントイベント(`CommentEvent.CREATE` / `DELETE`)の購読者(`CommentService`)から行われる。
  - 同じイベントを、検索サービス(`search.ts`)も購読していて、ページを再索引する。
  - インラインコメントの書き込みは、このイベントを出さない。
- **Implications**: インラインの書き込みからイベントを出すと、検索の再索引まで動き始め、要件の範囲を超える。件数の更新だけを、直接呼ぶ。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 新 API の項目を旧 API の上位集合にする(採用。`creator` を除く) | 旧 API と同じ整形式を共有し、インライン用の列が足される | 画面の通常コメント側が変更不要。外部利用者の移行が容易。整形の持ち主が1つ | 別名の項目(`page` / `revision` / `replyTo`)が新 API にも残る | apiv1 を廃止するときに、別名を外す別件を検討 |
| B. 新 API をきれいな項目名で作り直す | `pageId` / `revisionId` / `replyToId` だけを返す | 新 API の形が整う | 画面側の通常コメント部品で、項目名の変換が要る。整形の式が2つに分かれる | 変換の部品が増える |

## Design Decisions

### Decision: 新 API の項目は、旧 API の整形を共有した上位集合にする
- **Context**: 旧 API を非推奨にして、新 API を置き換え先として案内する。
- **Alternatives Considered**:
  1. 旧 API と同じ整形式を共有する(Option A)
  2. きれいな項目名で作り直す(Option B)
- **Selected Approach**: 共通の項目の整形を1つの関数にまとめ、旧 API(`comment.js`)と新 API の両方が使う。投稿者(`creator`)の整形だけは引数で受け取り、API ごとに分ける(次の Decision)。
- **Rationale**: 共通の項目の整形の持ち主が1つになり、2つの API の出力が `creator` 以外で食い違わない。画面の通常コメント部品は、項目名を変えずに済む。
- **Trade-offs**: 別名の項目が新 API に残る。旧 API を廃止するときに外せる。
- **Follow-up**: 旧 API の廃止を決めたときに、別名の整理を検討する。

### Decision: 新 API の `creator` は、画面が使う項目だけにする
- **Context**: 旧 API の整形は、ユーザーの行からパスワード、API トークン、非公開のメールアドレスだけを除き、残りの列をすべて返す。新 API は共有リンク経由でログインしていないゲストにも投稿者を返す(要件 3.3)。旧 API と同じ整形のままだと、外部サービスのアカウントの ID(`googleId`、`slackMemberId`)、最終ログイン日時(`lastLoginAt`)、管理者かどうか(`admin`)、アカウントの状態(`status`)などが、共有リンクを知っている誰にでも読めてしまう。また、新 API は MCP や SDK から使われる公開の契約になるので、利用者が使い始めると、あとから項目を減らすのが難しくなる。
- **Alternatives Considered**:
  1. 旧 API と同じ整形を使い続ける
  2. 旧 API の整形から、危ない項目をさらに除く(除く項目を並べる方式)
  3. 画面が読む項目だけを、1つずつ指定して取り出す(残す項目を並べる方式)
- **Selected Approach**: 3。新 API の `creator` は `_id`、`username`、`name`、`imageUrlCached` だけを返す。メールアドレスは本人が公開していても返さない。旧 API は要件 5.1 のとおり出力を変えず、従来の整形を使い続ける(要件 5.4)。
- **Rationale**: 画面のコメント部品(`Username`、`UserPicture`、`Comment.tsx` の自分のコメントかどうかの判定)が読むのは、この4項目だけである(項目ごとの根拠は design.md の toCommentListItem)。コメントの持ち主の判定は `creatorId` で行うので、`creator` に他の項目は要らない。2 の方式では、ユーザーの列が今後増えたときに、その列が新 API にそのまま出てしまう。3 なら、増えた列は出ない。MCP や SDK が新 API を使い始める前に、契約を狭くしておける。
- **Trade-offs**: 新 API と旧 API で `creator` の形が違う。旧 API から新 API へ移る利用者が、`creator` の4項目以外(公開しているメールアドレスなど)を使っていた場合は、別の API(ユーザーの API)から取る必要がある。旧 API からは、引き続き4項目以外のユーザーの項目を読める。旧 API を廃止するときに、この差は無くなる。
- **Follow-up**: 画面が投稿者の新しい項目を表示するようになったら、要件 1.9 と `toCreatorSummary` に、その項目を1つずつ足す。

### Decision: 一覧の取得は、画面側の共有の取得フック1本にまとめる
- **Context**: 末尾のスレッド(通常コメント)と、本文のインラインコメントが、同じページの同じ一覧を別々に取得する。
- **Selected Approach**: `useSWRxCommentList` が一覧を取得する。キーは `['/comments', pageId, shareLinkId]` で固定する。通常コメント用とインラインコメント用の2つのフックが、同じ一覧から、それぞれの見え方を作る。
- **Rationale**: 同じキーの取得は1回にまとまる。どちらの書き込みのあとも、同じ一覧が再取得され、末尾のスレッドと本文のハイライトが一緒に最新になる。
- **Trade-offs**: 2つのフックが、共有のキーに依存する。キーを変えるときは両方に影響する(Revalidation Triggers に記載)。

### Decision: 件数の更新は、イベントを出さずに直接呼ぶ
- **Context**: インラインコメントの作成と削除のあとに、件数を更新したい。
- **Alternatives Considered**:
  1. コメントイベントを出す
  2. `Page.updateCommentCount` を、サービスの依存として注入して、直接呼ぶ
- **Selected Approach**: 2。
- **Rationale**: イベントは検索の再索引も起動する。要件の範囲を超える副作用を避ける。
- **Trade-offs**: 更新の失敗は、記録して続行する(コメントの作成自体は取り消さない)。次のコメントの追加、削除、または再計算の移行で補正される。

### Decision: 版の絞り込みは「次の版の作成日時より前」とする
- **Context**: Requirement 2 の仕様。
- **Selected Approach**: 指定した版の、同じページ内で、作成日時が後の最も古い版を探す。見つかれば、その作成日時より前に作成されたコメントだけを返す。見つからなければ(最新の版)絞り込まない。
- **Rationale**: 通常コメントとインラインコメントを同じ規則で扱える。返信は親より後に作られるので、親が範囲外なら返信も範囲外になり、孤立した返信は出ない。
- **Follow-up**: 同じ作成日時を持つ版が2つある場合は、`gt`(より大きい)で比べるので、同時刻の版は「次の版」にならない。実運用でほぼ起きないため、そのままとする。

### Decision: 共有リンク経由でも、インラインコメントを API の応答に含める
- **Context**: 要件 3.3 で、共有リンクの閲覧者に返すコメントの範囲を決める。インラインコメントの行には、本文の一部(選択した文字列 `quote` と前後の文脈)が入っている。
- **Alternatives Considered**:
  1. 共有リンク経由のときは、インラインコメントの行を応答から除く。画面に出さないだけでは API から読めてしまうので、応答そのものから除くという考え方
  2. 共有リンク経由でも、通常コメントと同じく読み取り専用で返す
- **Selected Approach**: 2。
- **Rationale**: 1 の考え方は、画面に出さないだけでは API からデータを読めてしまう、という点では正しい。しかし、応答から除いても守れる情報がほとんど無い。`quote` と前後の文脈は本文の一部であり、共有リンクの閲覧者は `GET /_api/v3/revisions/list` と `GET /_api/v3/revisions/:id` から、過去の版を含む本文をすでに読める。インラインコメントの行だけを応答から除いても、この本文を読める経路は残る。1 を選ぶと、共有リンクのときだけ応答を絞る分岐が新 API に要る。
- **Trade-offs**: 共有リンクの画面と検索結果のプレビューにインラインコメントを出さないこと(要件 6.5)は、データではなく画面側だけで実現する。実現しているのは次の2か所で、`useSWRxPageComment` が `isInline` の行を除くことと、共有リンクの画面がインラインコメントの親子(`useSWRxInlineComments`)を取得しないこと(`PageView.tsx` も共有リンクの文脈では `null` を渡す)。旧 API の `comments.get` は、共有リンクかどうかによらずインラインコメントを返さないまま残す(要件 5.2)。これは旧 API の挙動を変えないためで、共有リンクから隠すためではない。
- **Follow-up**: 画面に新しい取得の利用先を足すときは、共有リンクの画面で `isInline` の行を出してよいかを、その場で確かめる。

## Risks & Mitigations
- 旧 API を使う画面を取りこぼして、インラインコメントが末尾のスレッドに不意に出る — 通常コメント用のフックで `isInline !== true` を必ず除外し、共有リンクの画面と検索のプレビューの結合テストで固定する。
- 既存ページの件数が古いまま — 再計算の移行を入れ、移行の結合テストで固定する。
- Slack のリンク展開が読む `commentCount` が、インラインを含む値に変わる — 要件 7.1 の結果であり、許容する。検索の索引は、もともと `comments` を `isInline` で絞らずに数えていて、値は変わらない(`search-delegator/aggregate-to-index.ts`)。
- 版の絞り込みで、`getAppliedAtForRevisionFilter`(過去の移行で壊れた版を隠す処理)を使わない — 隠される版は、指定する版としても「次の版」としても通常ほぼ現れない。実装時に結合テストで確認する。

## References
- `.claude/rules/` 配下の 403/404 規約: `apps/app/.claude/rules/page-write-action-403-404.md`
- 既存の共有リンク対応の前例: `apps/app/src/server/routes/apiv3/revisions.js`
- 旧 API の整形: `apps/app/src/server/routes/comment.js`(`api.get`)
