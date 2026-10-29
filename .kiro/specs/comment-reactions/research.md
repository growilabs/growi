# Research & Design Decisions

## Summary
- **Feature**: `comment-reactions`
- **Discovery Scope**: Extension（既存のコメント機能・監査ログ・G2G 移行・絵文字基盤への統合。認可と情報露出に関わるため、light discovery に加えて認可・データ移行の経路は個別に深掘りした）
- **Key Findings**:
  - コメントの取得は `GET /_api/v3/comments`（`comment` スペック）に一本化され、共有リンク閲覧者にもインラインコメントを返す。リアクションはこの応答の各コメントに載せ、コメント単体の取得 API と書き込みの応答でも同じ形で返す（コメントの API 全体の一貫性を優先）。`ICommentListItem` の項目追加は `comment` スペックの契約の変更なので、`spec-lifecycle.md` に従って `comment` スペックへ書き戻す。
  - Mongoose は退役予定なので、`commentreactions` は Mongoose を持たない Prisma だけのコレクションにする。Mongoose が担っていた2つの操作は、別の既存の仕組みで補える。一意インデックスの作成は migration script（前例: `20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js`）。G2G・インポートでの参照項目の ObjectId への型変換は、コレクションごとの `overwrite-params`（モデルの有無にかかわらず、G2G とファイルインポートの両方で適用される）。
  - emoji-mart 5.6.0 のピッカーは、肌の色付きの絵文字を `shortcodes: ':+1::skin-tone-3:'`、`skin: 3` で返す。Slack のリアクション名 `+1::skin-tone-3` と同じ段階番号（2〜6）なので、変換は区切り文字の付け替えだけで済む。

## Research Log

### コメント取得 API の現状と共有リンク
- **Context**: リアクションの読み取りの認可を、コメント一覧と揃える必要がある（要件 6.1）。
- **Sources Consulted**: `apps/app/src/features/comment/server/routes/list.ts`、`.kiro/specs/comment/{brief,requirements,design}.md`
- **Findings**:
  - 認可の連鎖は `accessTokenParser([SCOPE.READ.FEATURES.PAGE])` → validators → `apiV3FormValidator` → `certifySharedPage` → `loginRequiredFactory(crowi, true)`（ゲスト可）→ handler。handler では、`req.isSharedPage === true` か、`findPageAndMetaDataByViewer(...).meta` が not-found でないことを確認する。失敗したら 404 `notfound_or_forbidden` を返す。
  - 共有リンク経由では `revisionId` を無視し、インラインコメントも返す（comment 要件 3.3）。画面側は、共有リンクの画面と検索結果のプレビューでインラインコメントを描画しない（comment 要件 6.5）。
  - `comment` スペックの Revalidation Triggers には「`ICommentListItem` の項目の追加」「取得フックのキー `['/comments', pageId, shareLinkId]` の変更」が含まれる。
  - コメント単体を取得する API は無い。
  - `certifySharedPage` は、`pageId`（query または body）と `shareLinkId` の組で共有リンクを検証する。`pageId` が無い要求は検証しない。`pageId` と `page_id` が食い違う要求も検証しない（IDOR の防止）。
  - 画面は、共有の取得フック `useSWRxCommentList` から、`useSWRxPageComment`（`isInline` で絞る）と `useSWRxInlineComments`（`groupInlineComments` で組み直す）を派生させている。`groupInlineComments` は必要な項目だけを明示的に写すので、`ICommentListItem` に足した項目はインラインコメントの型（`InlineCommentWithReplies`、`InlineCommentReply`）には現れない。
- **Implications**: リアクションは `ICommentListItem` に載せる。単体取得 API は、`certifySharedPage` のために `pageId` を必須にし、コメントがそのページのものかを確かめる。画面は、インラインコメントの型を変えずに、共有の一覧のキャッシュから `id` でリアクションを読む。

### 監査ログ（Activity）の記録方式
- **Context**: 要件 9（追加・解除の記録、状態を変えない要求や拒否された要求は記録しない、通知しない）。
- **Sources Consulted**: `apps/app/.claude/rules/activity-recording.md`、`apps/app/src/interfaces/activity.ts`、`features/inline-comment/server/service/inline-comment-service.ts`、`server/routes/apiv3/attachment.js`、`prisma/schema.prisma`（`activities`、`ActivitiesSnapshot`）
- **Findings**:
  - 正規の順序は `accessTokenParser → loginRequiredStrictly → excludeReadOnlyUser → addActivity → validators → apiV3FormValidator → handler`。emit は `res.apiv3()` より前に行う。
  - `addActivity` の failsafe finalizer が記録するのは、失敗した応答（4xx/5xx）や切断のときの `ACTION_UNSETTLED` だけ。成功した応答で emit しなければ、何も記録されない。
  - inline-comment は `prisma.activities.createByParameters` で自前に記録している。この経路は `activityService.shoudUpdateActivity`（監査ログの詳細度による絞り込み）を通らない。
  - `activities` には自由に使える項目が無い。action ごとの付随データは `snapshot`（action で絞り込む判別可能ユニオン `ISnapshot`。`activity-log-snapshot` スペックの方針）に置く。
  - 監査ログの絞り込みのカテゴリは `/^COMMENT_/` の正規表現で作られる（`activity.ts` 714 行目付近）。`ACTION_COMMENT_*` は `MediumActionGroup` に属し、`LargeActionGroup` は Medium を継承する。
  - 監査ログの action 名の表示ラベルは `public/static/locales/*/admin.json` にある（`"COMMENT_CREATE": "Create comment"` など）。
  - **snapshot の保存の経路**: route の emit → `ActivityService` の `update` リスナー → `settleActivityRecord`（`service/activity/settle-activity-record.ts`。snapshot を展開し、`username` を補ってそのまま渡す）→ `prisma.activities.createByParameters`。`createByParameters` は、渡された snapshot をそのまま保存せず、`snapshotData` で `id`、`username`、`originalName`、`pagePath`、`pageId`、`fileSize` だけを取り出して組み立て直す。`updateByParameters` の `buildSnapshotUpdateEnvelope` も、同じ項目だけを `{ update }` に詰める。どちらも、受け取った snapshot を `AttachmentRemoveSnapshot` の型として読むので、別の variant の項目を取りこぼしても型の検査では気づけない。
  - 監査ログの一覧は Prisma（`fetch-activity-list.ts` の `prisma.activities.paginate`）で読む。Mongoose を使う Elasticsearch への同期（`search-delegator/elasticsearch.ts`）は `select('snapshot.username').lean()` で `username` しか読まない。
- **Implications**: 正規の `addActivity` ＋ `activityEvent.emit` を使い、状態が変わったときだけ emit する。絵文字は snapshot の新しい variant に入れる。Prisma の composite に `emoji` を足すだけでは保存されないので、`createByParameters` の `snapshotData` と `buildSnapshotUpdateEnvelope` にも `emoji` を足し、両者が読む型を全 variant の項目を持つ型に広げる。Mongoose の `snapshotSchema` は、保存にも読み取りにも関わらないので足さない。確かめは、本物の route を通したあと DB から読み直して行う（返り値では取りこぼしが見えない）。

### 新しいコレクション、インデックス、G2G 移行
- **Context**: 一意制約 `(comment, user, emoji)`（要件 2.4）と G2G 移行（要件 10）。
- **Sources Consulted**: `.claude/rules/model.md`、`apps/app/src/server/models/bookmark.ts`、`features/news/server/models/news-read-status.ts`、`server/service/import/{non-transferable-collections,construct-convert-map,overwrite-function,get-model-from-collection-name,detect-unique-conflicts}.ts`、`server/service/export.ts`、`server/crowi/setup-models.ts`、`utils/prisma.ts`
- **Findings**:
  - 既存のコレクション（`bookmarks`、`newsreadstatuses` など）は、Mongoose スキーマの `schema.index(..., { unique: true })` で一意インデックスを作っている（`.claude/rules/model.md` の移行期間中の方針）。
  - Prisma は MongoDB のインデックスを作らない（デプロイで `prisma db push` は実行されない）。Mongoose スキーマを持たない Prisma だけのコレクション（`auditlog_es_sync_status`、`changestream_resume_tokens`）は、一意インデックスを migration script で作っている（`src/migrations/20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js`）。この script は、`mongoose.connection.collection(name)` に対して、重複を消してから `createIndex(..., { unique: true })` する。モデルは使わない。`down` は、コレクションとインデックスがあるときだけ消す。
  - migration（migrate-mongo）は、本番ではサーバーの起動前に実行される（`package.json` の `preserver` が `pnpm run migrate`、Docker の `docker-entrypoint.ts` も migrate-mongo の `up`）。統合テストでは、テンプレート DB を作るときに一度だけ実行され、各ワーカーの DB はそのインデックスを引き継ぐ（`test/setup/mongo/template-db.ts`）。
  - `prisma/migrate.ts`（umzug、Prisma をコンテキストにした migration）もあるが、`prisma/migrations/` は空で前例が無い。
  - エクスポートは `collection.find()` を JSON 文字列化する。インポートの `convertDocuments` は、Mongoose のモデルがあるコレクションでは `keepOriginal` がスキーマで各項目を型変換する。モデルが無いと、`_id` を ObjectId に、ISO 形式の文字列を Date に戻すだけで、ほかの参照項目は文字列のまま入り、Prisma の `@db.ObjectId` の検索に一致しなくなる。
  - `construct-convert-map.ts` の `SPECIAL_CONVERT_FUNCTIONS` は、`mongoose.modelNames()` を回して変換表を作るときにしか使われないので、モデルの無いコレクションには効かない。一方、`overwrite-params`（`generateOverwriteParams(collectionName, ...)`）は、モデルの有無にかかわらず `convertDocuments` の最後に適用され、ファイルからのインポート（`import-settings-builder.ts`）と G2G（`g2g-transfer.ts`）の両方から呼ばれる。
  - `flushAndInsert` は `collection.deleteMany({})` で空にする（コレクションを drop しない）ので、migration で作ったインデックスは G2G の後も残る。
  - activity の書き込みは Prisma（`createByParameters` / `updateByParameters`）で行われる。Mongoose の `snapshotSchema` は `username` だけを持ち、添付ファイルの snapshot の項目（`originalName`、`pagePath`、`pageId`、`fileSize`）は Prisma の `ActivitiesSnapshot` だけに足されている。G2G のインポートでは `activities.snapshot` は型変換されない（`SPECIAL_CONVERT_FUNCTIONS` の特別扱い）。
  - `non-transferable-collections.integ.ts` は、データベース・Mongoose・Prisma に現れるコレクションが `TRANSFERABLE_COLLECTIONS` と `NON_TRANSFERABLE_COLLECTIONS` のどちらかにあることを検査する。
  - `detect-unique-conflicts.ts` の対象は、自然キー（username など）が環境をまたいで衝突しうる4コレクションだけ。ObjectId で決まる一意キーは対象外。
  - G2G の ID は付け替えずに保持する（`construct-convert-map.ts` の既定は `keepOriginal`）。
- **Implications**: `commentreactions` は Prisma のモデルだけにし、インデックスは migration script で、インポート時の型変換は `overwrite-params/comment-reactions.ts` で補う。`TRANSFERABLE_COLLECTIONS` に登録する（drift テストは Prisma のモデルからもコレクションを拾う）。`detect-unique-conflicts` は不要。snapshot の `emoji` は Prisma の `ActivitiesSnapshot` だけに足す。

### 削除の経路
- **Context**: 要件 8。
- **Sources Consulted**: `features/comment/server/models/comment.ts`（`removeWithReplies`）、`inline-comment-service.ts`（`deleteComment` / `deleteReply`）、`server/routes/comment.js`（`api.remove`）、`server/service/page/delete-completely-operation.ts`
- **Findings**:
  - `removeWithReplies(commentId)` は、返信の `deleteMany` と本体の `delete` を配列トランザクションで行う。通常コメントの削除（apiv1 `comments.remove`）とインラインコメントの起点の削除（`deleteComment`）の両方が、これを使う。
  - インラインコメントの返信の削除（`deleteReply`）は、単独の `prisma.comments.delete`。
  - ページの完全削除は、`prisma.$transaction([comments.deleteMany(返信), comments.deleteMany(全部)])` のあと、`Promise.all` で関連データを消す。
  - ごみ箱への移動と復元では、コメントに触れない。
- **Implications**: 3つの経路（`removeWithReplies`、`deleteReply`、`deleteCompletelyOperation`）に、Prisma の `commentreactions.deleteMany` を同じトランザクションの中で足す。ごみ箱の経路には何もしない（要件 8.4 は自然に満たされる）。

### Prisma の参照の検査（P2014）と削除の順番
- **Context**: 要件 8。コメントの削除経路に、リアクションの削除を足す。
- **Sources Consulted**: `apps/app/prisma/schema.prisma`（`comments` のリレーション）、`src/server/service/page/delete-completely-operation.ts`、`src/server/routes/comment.integ.ts`、`features/comment/server/models/comment.ts`（`removeWithReplies`）、[Prisma: Relation mode](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/relation-mode)、[Prisma: Referential actions](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/referential-actions)
- **Findings**:
  - MongoDB の relation mode は `prisma` で、参照の整合は Prisma Client のクエリのときに Prisma がエミュレートする（生のクエリには効かない）。MongoDB では `Cascade`、`Restrict`、`NoAction`、`SetNull` が使える。エミュレーションは追加のクエリを伴う。`NoAction` が具体的にどう振る舞うかは、公式ドキュメントでは詳しく書かれていない。
  - リポジトリでの実測: `delete-completely-operation.ts` と `comment.integ.ts` のコメントに、必須のリレーション（`onDelete: NoAction`）の親（`pages`）を、子（`revisions`、`comments` など）と同時または先に Prisma で消すと P2014 が出る、と記録されている（同時に実行すると確実に再現し、順に実行すると出ない）。`comments` の返信の削除も、起点より先に返信を消す順にしてある（`removeWithReplies`、`deleteCompletelyOperation`）。
  - 配列形式の `$transaction` は書いた順に実行され、どれか1つが失敗すると全体が取り消される。
  - `comments` の Prisma モデルのリレーションは、すべて `onDelete: NoAction`。
  - 利用者の扱いは、次の「利用者の文書が無いリアクションと Prisma のリレーション」を参照。
- **Implications**: `commentreactions` には、読み取りに不要な `comments` / `pages` へのリレーションを宣言しない。削除の順番は、どの経路でも子から親（リアクション → 返信 → コメント）にする。`users` へのリレーションも宣言しない（次の節）。確認は、本物の DB で削除経路を通す統合テストで行う（モックでは参照の検査が走らない）。

### 利用者の文書が無いリアクションと Prisma のリレーション
- **Context**: 要件 1.9、1.10（退会・削除された利用者のリアクションも人数に数え、押した人の一覧ではコメントの投稿者と同じ規則で表示する）。GROWI では利用者のデータが削除されることがありうる。
- **Sources Consulted**: `apps/app/prisma/schema.prisma`（`bookmarks.user`、`comments.creator`）、`server/routes/apiv3/users.js`（`/users/:id/remove`）、`server/models/user/index.js`（`statusDelete`）、`server/service/import/import.ts`（`pruneOrphanedShareLinks`）、`.claude/skills/mongoose-to-prisma/SKILL.md`（Step 2 の Relation optionality）、`features/comment/server/serializers/to-comment-list-item.ts`、使い捨ての DB での実測
- **Findings**:
  - **実測（生成済みの Prisma Client、Prisma 6.19、使い捨ての DB `growi_scratch_*` を作って消した）**:
    - 必須のリレーション `bookmarks.user` で、参照先の利用者が無い文書を `findMany({ include: { user: true } })` すると、クエリ全体が `PrismaClientUnknownRequestError: Inconsistent query result: Field user is required to return data, got null instead.` で失敗した。`include: { user: { select: { id: true } } }` でも同じ。
    - 任意のリレーション `comments.creator` では、`include: { creator: true }` は失敗せず、`creator: null`、`creatorId` はそのまま返った。
    - 子が残った状態の `prisma.users.deleteMany` は、必須の `bookmarks.user` でも任意の `comments.creator` でも、P2014（`The change you are trying to make would violate the required relation ...`）で失敗した。`onDelete: NoAction` のリレーションは、必須か任意かにかかわらず、Prisma での親の削除を止める。
  - **利用者の文書を物理削除するアプリの経路**: 本番コードには見つからなかった。管理画面の削除（`/users/:id/remove`）は `statusDelete` で、文書を残して `status`、`username`、`name`、`email` などを書き換える。`User.deleteMany` や `prisma.users.delete*` はテストにしか無い。
  - **それでも利用者の文書が無いリアクションは起こりうる**: インポート・G2G はコレクションを選んで取り込めるので、`commentreactions` と `users` が揃わずに入りうる。`import.ts` の `pruneOrphanedShareLinks` は、必須のリレーション（`sharelinks.relatedPage`）が「参照先が無い」を表せず、インポートで実際にその状態が生まれることを記録している。ほかに、DB の直接操作、将来の物理削除の機能がある。
  - `mongoose-to-prisma` スキルの方針: 参照先の削除の経路が不確かなら任意のリレーションにする（必須を誤ると読み取りが 500 になり、任意を誤ってもヌルの確認が1つ増えるだけ）。
  - コメントの投稿者の規則: `comments.creator` は任意のリレーションで、`include` が `null` のときは `creatorId` の文字列を返す（`toCommentListItem`）。
- **Implications**: `commentreactions` から `users` への必須のリレーションを `include` すると、利用者の文書が無いリアクションが1件あるだけで、そのページのリアクションがすべて読めなくなり、要件 1.9、1.10 を満たせない。リレーションを宣言せず、利用者は別に取得して、見つからない ID は文字列として表示する。

### 閲覧専用ユーザー、ゲスト、共有リンクの判定（クライアント）
- **Sources Consulted**: `states/context.ts`、`client/components/NotAvailableForReadOnlyUser.tsx`、`NotAvailableForGuest.tsx`、`components/PageView/PageView.tsx`、`ShareLinkPageView.tsx`、`features/search/.../SearchResultContent.tsx`
- **Findings**:
  - `useIsGuestUser()`、`useIsReadOnlyUser()`、`useIsSharedUser()` と、`useIsCommentActionBlockedForReadOnlyUser()`（`!!isReadOnlyUser && !isRomUserAllowedToComment`）がある。
  - 共有リンクの画面は `<Comments isReadOnly>` を描画し、インラインコメントは渡さない。検索結果のプレビューは `<PageComment isReadOnly>` を描画する。本文のインラインコメント（`PageView`）は、共有リンクの画面では取得されない。
  - サーバー側の `excludeReadOnlyUserIfCommentNotAllowed` は、`security:isRomUserAllowedToComment` が false の閲覧専用ユーザーを `validation_failed` で拒否する。
- **Implications**: クライアントのリアクション可否は、既存のフックと `isReadOnly` の props から作る。サーバー側は既存のミドルウェアをそのまま使う。

### 絵文字ピッカーと絵文字データ
- **Sources Consulted**: `packages/editor/src/client/components-internal/CodeMirrorEditor/Toolbar/EmojiButton.tsx`、`packages/editor/package.json`、`vite.config.ts`、`node_modules/.pnpm/emoji-mart@5.6.0/.../dist/module.js`、`packages/emoji-mart-data/bin/extract.ts`
- **Findings**:
  - `EmojiButton` は `components-internal` にあり、CodeMirror の `editorKey` に依存している。emoji-mart の3パッケージは `packages/editor` の devDependencies で、apps/app は宣言していない。`packages/editor` は `src/client/components/` 以下を `dist/...` として公開している（apps/app は `@growi/editor/dist/client/components/...` を import 済み）。
  - emoji-mart の Picker は `skin`（1〜6）と `skinTonePosition` に対応する。`onEmojiSelect` は `{ id, native, shortcodes, skin? }` を返し、肌の色付きのときは `shortcodes = ':<id>::skin-tone-<n>:'`（n は 2〜6）、既定は `':<id>:'` になる。選んだ肌の色は emoji-mart 自身が localStorage に保存する。
  - `@growi/emoji-mart-data`（`dist/index.js` 約 85KB、ESM）は、各 id の既定の肌の色（`skins[0].native`）だけを持つ。別名と肌の色違いは捨てている。サーバーからも import できる。元データの `@emoji-mart/data` は、肌の色に対応する絵文字に6種類の `skins`（`skins[1..5]` が U+1F3FB〜U+1F3FF）と、`aliases`（例: `thumbsup` → `+1`）を持つ。
- **Implications**: ピッカーは `packages/editor` の公開コンポーネントとして新設し、emoji-mart への依存を editor に閉じ込める。`@growi/emoji-mart-data` を広げて、肌の色違いのグリフと別名の対応表を出力させる。

### Slack の肌の色と並び順
- **Sources Consulted**: [reactions.add](https://docs.slack.dev/reference/methods/reactions.add)、[reactions.get](https://docs.slack.dev/reference/methods/reactions.get)、[Use emoji and reactions](https://slack.com/intl/en-gb/help/articles/202931348-Use-emoji-and-reactions)
- **Findings**:
  - `reactions.add` の `name` は、肌の色の修飾子に対応する Unicode 絵文字に `::skin-tone-` と 2〜6 の数字を付けられる（一次情報で確認）。`already_reacted` は「ユーザーとリアクションの組み合わせ」が既にある場合のエラー。
  - リアクションの並び順は、ヘルプ記事にも `reactions.get` にも記述が無い（要件 1.6 で「最初に付いた順」とした根拠）。
- **Implications**: 保存するキーの名前部分を Slack のリアクション名と同じ形にする。肌の色まで含めた名前で一意性を判定する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| (a) コメントの API に載せる | 一覧の各件に `reactions` を足し、単体取得 API を新設し、PUT の応答でもコメントを返す | 取得が1回で済む。コメントを返す応答がすべて同じ形になる。リアクションの読み取りの範囲がコメントと構造的に一致する | `comment` スペックの契約変更（項目の追加、単体取得 API）。書き戻しが要る。リアクションの不具合がコメントの取得に波及しうる | **採用** |
| (b) 専用の読み取り API | `GET /_api/v3/comment-reactions` を新設 | comment スペックの契約に触れない | 取得が2回になる。認可の判定が2か所に並び、一致をテストで守り続ける必要がある。コメントの API と形が揃わない | 不採用 |
| 埋め込み（`comments.reactions`） | コメントのドキュメントに配列で持つ | 取得が単純 | 同時更新の一意性、Mongoose と Prisma の両方の変更、既存処理への波及 | discovery で不採用済み（brief.md） |

## Design Decisions

### Decision: リアクションはコメントの API に載せる（専用の取得 API は作らない）
- **Context**: 要件 1、6.1。コメントに関する API 全体の一貫性。
- **Alternatives Considered**:
  1. 専用の `GET /_api/v3/comment-reactions?pageId=` を新設し、コメントの API とは別に読む
  2. コメント一覧 API の各コメントに `reactions` を載せ、コメント単体の取得 API を新設し、書き込みの応答でも同じ形のコメントを返す
- **Selected Approach**: 2。コメントを返す3つの応答（`GET /comments` の各件、`GET /comments/:id`、`PUT /comments/:id/reactions` の `comment`）を、同じ `ICommentListItem` にする。書き込みは `comments` のサブリソース `/comments/:id/reactions` にする。
- **Rationale**:
  - API の利用者（画面、MCP、外部スクリプト）が、どの応答でも同じ型でコメントとリアクションを扱える。リアクションはコメントに従属するデータなので、コメントの一部として現れるのが自然である。
  - リアクションの読み取りの範囲が、コメントの読み取りの範囲と構造的に一致する（同じ応答に載る）。専用 API のように、認可の判定を2か所で揃え続ける必要が無い（要件 6.1）。
  - ページ表示時の取得が1回で済む。書き込みの応答で、対象のコメントを最新の状態で返せるので、クライアントは一覧全体を再取得しなくてよい。
- **Trade-offs**:
  - `comment` スペックの契約（応答の項目、単体取得 API）を変えるので、`spec-lifecycle.md` に従った書き戻しが要る（design.md の「Amend Target」）。
  - リアクションの不具合がコメントの取得に波及しうる。取り込みの失敗は `reactions: null` に閉じ込める（要件 6.5）。
  - `comment` の取得が、リアクションのローダーに依存する。依存の向きを一方向に保つため、ローダーは利用者の整形関数を引数で受け取り、`comment` の実行時のコードを import しない。
- **Follow-up**: 書き戻しは tasks.md の最終タスクにする。MCP・SDK が `reactions` を使うかは、それぞれの側で決める。

### Decision: `commentreactions` は Prisma だけで扱い、Mongoose 側の実装を足さない
- **Context**: Mongoose は退役予定。一意制約（要件 2.4）と G2G 移行（要件 10）には、これまで Mongoose スキーマが担っていた「インデックスの作成」と「インポート時の ObjectId への型変換」が要る。
- **Alternatives Considered**:
  1. Mongoose スキーマを作り、インデックスの作成と型変換を任せる（`.claude/rules/model.md` の移行期間中の方針、`bookmarks` などの前例）
  2. Prisma だけにし、インデックスは migration script で、型変換は `construct-convert-map.ts` の `SPECIAL_CONVERT_FUNCTIONS` で補う
  3. Prisma だけにし、インデックスは migration script で、型変換はコレクションごとの `overwrite-params` で補う
  4. 3 のインデックスの作成を、umzug（`prisma/migrate.ts`）の migration で行う
- **Selected Approach**: 3。
- **Rationale**:
  - 1 は、退役予定の Mongoose に新しい実装を足すことになる。
  - 2 は、`SPECIAL_CONVERT_FUNCTIONS` が Mongoose のモデルのあるコレクションにしか適用されないので、効かない。
  - 3 の migration script は、Mongoose を持たない Prisma だけのコレクションに一意インデックスを作る既存の前例（`auditlog_es_sync_status`）と同じ形で、サーバーの起動前と統合テストのテンプレート DB の作成時に実行される。`overwrite-params` は、モデルの有無にかかわらず G2G とファイルインポートの両方で適用される、コレクションごとの既存の拡張点である。
  - 4 は、`prisma/migrations/` に前例が無い。
  - `.claude/rules/model.md` は、移行期間中は Mongoose がインデックスの作成を持つとしている。ただし、これは既存のモデルを Prisma に移すときの方針で、Mongoose を持たない新しいコレクションには、上記の migration の前例がある。
- **Trade-offs**: インデックスの定義が、migration と Prisma の `@@unique` / `@@index` の2か所に現れる（`map` の名前で一致させ、migration の統合テストで確かめる）。参照項目を増やすときは、`overwrite-params` も更新する必要がある。
- **Follow-up**: `comments` の既存の Mongoose スキーマの退役は、本スペックの範囲外とする。

### Decision: `commentreactions` は `comments` へのリレーションを宣言せず、削除は子から親の順にする
- **Context**: 要件 8。Prisma の参照のエミュレーションで、`onDelete: NoAction` のリレーション（必須でも任意でも。「利用者の文書が無いリアクションと Prisma のリレーション」の実測）の子が残ったまま親を消すと P2014 になる。配列形式の `$transaction` は書いた順に実行されるので、コメントの削除の後にリアクションの削除を書くと、リアクションの付いたコメントが削除できなくなり、トランザクション全体が取り消される。
- **Alternatives Considered**:
  1. `comments` へのリレーションを `onDelete: NoAction` で宣言し、すべての削除経路でリアクションを先に消す
  2. `comments` へのリレーションを `onDelete: Cascade` で宣言し、コメントの削除に合わせて Prisma にリアクションを消させる
  3. `comments` へのリレーションを宣言せず（スカラーの `commentId` だけ）、すべての削除経路でリアクションを先に消す
- **Selected Approach**: 3。`pages` へのリレーションも宣言しない。`users` へのリレーションも宣言しない（次の Decision）。
- **Rationale**:
  - 本スペックの読み取りは `commentId` で引くだけで、リアクションからコメントをたどらない。リレーションを宣言しても読み取りの得は無い。
  - 1 は、将来の削除経路でリアクションの削除を忘れたり順番を誤ったりすると、コメント自体が削除できなくなる（P2014 で失敗し、トランザクションも取り消される）。3 なら、忘れても残るのは表示されない孤立したリアクションで、利用者への影響が小さい。
  - 2 は、エミュレーションが `deleteMany` やトランザクションの中でどう振る舞うかが公式ドキュメントで明らかでなく、暗黙の追加クエリになる。削除が `removeWithReplies` などに明示されているほうが、読んで追える。
  - 1・2 は、`comment` スペックが持つ `comments` の Prisma モデルに逆向きのリレーション項目を足す必要がある。3 は不要。
  - 順番を子から親に揃えるのは、既存の返信の削除と同じ形にし、将来リレーションが宣言されても壊れないようにするため。
- **Trade-offs**: Prisma の型から、リアクションとコメントの関係が読み取れない。削除の漏れは P2014 で気づけず、孤立したリアクションとして残る（統合テストと Revalidation Triggers で補う）。
- **Follow-up**: 実装時に、本物の DB で、起点と返信の両方にリアクションの付いたコメントを各削除経路で消し、P2014 が出ないこととリアクションが残らないことを統合テストで確かめる。

### Decision: `commentreactions` は `users` へのリレーションも宣言せず、利用者は別に取得する
- **Context**: 要件 1.9、1.10、6.4。利用者の文書が無いリアクションは、インポート・G2G、DB の直接操作、将来の物理削除で起こりうる。
- **Alternatives Considered**:
  1. `users` への必須のリレーション（`userId String`、`user users`）を宣言し、`include: { user }` で取得する
  2. `users` への任意のリレーション（`userId String?`、`user users?`）を宣言し、`include: { user }` で取得する（`comments.creator` と同じ形）
  3. リレーションを宣言せず、`users.findMany({ where: { id: { in: userIds } }, select: 4項目 })` で別に取得する
- **Selected Approach**: 3。
- **Rationale**:
  - 1 は、利用者の文書が1件でも無いと `include` のクエリ全体が失敗する（実測）。リアクションの一覧がそのページごと読めなくなり、要件 1.9、1.10 を満たせない。
  - 2 は読み取りでは失敗しないが、本来必須の `userId` を型の上で任意にする必要がある。また、`onDelete: NoAction` のリレーションは任意でも Prisma での利用者の削除を P2014 で止める（実測）。
  - 3 は、利用者の文書が無くても読み取りが失敗せず、利用者の削除も止めない。`comments`・`pages` へのリレーションを宣言しない判断とも揃い、`commentreactions` は Prisma のリレーションを1本も持たない。見つからない `userId` は文字列で返すので、`toCommentListItem` の投稿者の規則（オブジェクト、または ID 文字列）と同じ形になる。
- **Trade-offs**: 一覧の取得が1回増える（行数は、そのページでリアクションした利用者の数で上限がある）。Prisma の型から、リアクションと利用者の関係が読み取れない。
- **Follow-up**: 本物の DB に、存在しない `userId` のリアクションを入れて、コメント一覧 API が 200 を返し、その利用者が ID 文字列で人数に数えられることを統合テストで確かめる。

### Decision: 絵文字キーは名前空間の接頭辞付きの文字列にする
- **Context**: 要件 4.5、4.6、将来のカスタム絵文字。
- **Alternatives Considered**:
  1. 種別フィールド（`emojiKind`）と名前を別々に持つ
  2. 1つの文字列に接頭辞を付ける（`unicode:+1::skin-tone-3`）
  3. 標準絵文字は接頭辞なし、カスタム絵文字だけ接頭辞付き
- **Selected Approach**: 2。`<namespace>:<name>` とし、v1 の名前空間は `unicode` だけ。`unicode` の名前部分は Slack のリアクション名と同じ表記（`<shortcode>` または `<shortcode>::skin-tone-<2..6>`）。
- **Rationale**: 一意インデックスが1項目で済む。接頭辞を外すと Slack 名になる（要件 4.6）。3 は、Slack のカスタム名との区別が文字列の形に頼ることになり壊れやすい。
- **Trade-offs**: キーの文字列が少し長くなる。パースが必要になるが、純粋関数1つに閉じ込める。
- **Follow-up**: 将来 `slack:<teamId>:<name>` などを足すときは、パーサーの判別ユニオンに variant を足す。

### Decision: 解除は送られたキーと正規化したキーの両方で削除し、インポートでは `emoji` を正規化する
- **Context**: 絵文字データ（`@growi/emoji-mart-data`）の版が変わると、保存済みの正規のキーが別名になったり（例: `unicode:thumbsup` が正規の id でなくなる）、id そのものが消えたりする。GROWI の更新や、版の違う GROWI 間の G2G・インポートで起きる（design.md の Revalidation Triggers「emoji-mart のバージョン更新」）。route が正規化したキーだけで削除すると、そうした行を利用者が外せない。
- **Alternatives Considered**:
  1. インポートでの正規化だけにする（それ以前に入った行が残る）
  2. 解除だけを両方のキーで削除する（保存する行が正規の形にそろわない）
  3. 両方入れる
- **Selected Approach**: 3。`removeReaction` は送られたままのキーとその正規形の両方を `deleteMany` の対象にし、`overwrite-params/comment-reactions.ts` は `emoji` を正規化する（正規化できない値はそのまま返す）。
- **Rationale**: インポートの正規化で今後の行を正規の形にそろえ、解除の両方削除で、すでに入った行を外せるようにする。
- **解除時の検証**: 追加（`isReacted: true`）は `normalizeReactionKey` で確かめるが、解除（`isReacted: false`）は `tryParseReactionKey` で形式だけを確かめ、今の絵文字データにあるかは問わずに `removeReaction` へ渡す。今の絵文字データに無い id のキーで保存された行も外せるようにするため。形式に合わない値は `invalid-reaction-emoji` の 400。監査ログの snapshot の `emoji` は、正規化できれば正規形、できなければ送られたキー。
- **Trade-offs**: `removeReaction` の引数が `ReactionKey` から送られたままの文字列に広がり、サービスで再度正規化する。別名と正規のキーの行が同じ `(commentId, userId)` に両方あるとき、別名のチップを押して解除すると、送られたキーと正規形の両方が対象になるので両方の行が消える（同じ絵文字なので意図どおり）。正規のチップを押して解除した場合は、送られたキーが正規形そのものなので正規の行だけが消え、別名の行とそのチップは残る。
- **Follow-up**: 次の点は未対応で、先送りにする。表示側で正規化してまとめるか、既存の行を移行で正規化するかを別途決める。
  - 別名のキーの行が別のチップとして表示される（要件 4.5）。
  - 別名と正規のキーの行が同じコメントに両方あると、種類数の上限（`distinct: ['emoji']` で数える）に 2 種類として数えられる。

### Decision: インポート・G2G の置き換えで、消えたコメントとページのリアクションが残るのを許容する
- **Context**: `flushAndInsert` は対象のコレクションを `deleteMany({})` で空にしてから入れ直す。`comments` や `pages` だけが置き換わり、`commentreactions` が置き換わらない（インポートするコレクションに `commentreactions` を選ばなかったとき）と、置き換え前のコメント・ページに付いていたリアクションが残る。この経路は、`removeWithReplies` やページの完全削除のような、削除経路の拡張（design.md「削除経路の拡張」）を通らない。
- **Alternatives Considered**:
  1. 残るのを許容する
  2. `comments` / `pages` の置き換えのとき、`commentreactions` も一緒に消す（インポートの処理に、コレクション間の依存を持ち込む）
  3. インポートの後に、存在しないコメントを指すリアクションを掃除する（`pruneOrphanedShareLinks` と同じ方式）
- **Selected Approach**: 1。
- **Rationale**: 残るのは、存在しなくなったコメントを指す行か、`pages` だけが置き換わって残ったコメントに付いていた行である。前者は、読み取りがコメントの ID で絞るので画面には出ない。後者は元のコメントへのリアクションとして正しく見える。G2G は ID を付け替えないので、同じ ID のコメントが入り直せば、残った行はそのコメントに再び付いて表示される（元のコメントへのリアクションなので、害にならない）。実害はディスクの使用量のわずかな増加に限られ、そのために `import` に別のコレクションの知識を足すほどの理由は無い。
- **Trade-offs**: 存在しないコメント・ページを指す孤立した行が残る。同じ ID で入り直したコメントには、そのコメントのリアクションとして再び付く。
- **Follow-up**: 孤立した行の掃除が必要になったら、案 3 を別のスペックで検討する。

### Decision: 絵文字データは `@growi/emoji-mart-data` を広げて使う
- **Context**: 要件 4.1〜4.5 の検証（サーバー）と、肌の色付きのグリフの表示（クライアント）。
- **Alternatives Considered**:
  1. apps/app に `@emoji-mart/data` を依存として足し、サーバーとクライアントで直接読む
  2. `@growi/emoji-mart-data` の抽出処理を広げ、肌の色違いのグリフと別名の対応表も出力する
- **Selected Approach**: 2。lookup の値を `{ skins: [既定, ...肌の色違い] }`（1件または6件）にする。名前付き export として `aliases` を足す。
- **Rationale**: 本文のレンダラーと同じデータを使える（要件 4.1 の「本文の絵文字表示が対応している」と一致する）。生の `@emoji-mart/data`（数百 KB）を apps/app のバンドルに入れずに済む。
- **Trade-offs**: 出力サイズが増える（肌の色に対応する 305 件 × 5 グリフと別名 61 件。数十 KB 程度の見込み）。型を非空タプルにして、既存の `skins[0]` の利用を壊さない。
- **Follow-up**: 増分のサイズを実測する。

### Decision: ピッカーは `packages/editor` の公開コンポーネントとして新設する
- **Context**: 要件 3。
- **Alternatives Considered**:
  1. apps/app に emoji-mart を依存として足し、apps/app に直接作る
  2. `packages/editor/src/client/components/` に、エディタに依存しない遅延読み込みのピッカーを作る
- **Selected Approach**: 2。`EmojiPicker` を新設し、`EmojiButton` と同じ遅延 import の方式を使う。肌の色の選択を有効にして、`{ kind: 'native', id, skin? }` を返す。
- **Rationale**: emoji-mart への依存とバージョンを1か所に保てる。既存の `EmojiButton` に手を入れない（エディタの挙動は変えない）。
- **Trade-offs**: `EmojiButton` との遅延 import の重複が少し残る。
- **Selection の形**: 選択結果は `kind` で種類を見分ける判別ユニオンにする。`fromPickerSelection` が `kind` で名前空間を決めるので、カスタム絵文字は `kind` の追加と分岐の追加で済み、`id` の文字列の見た目からの推測に頼らない。外から絵文字を渡す props は使う場所がまだ無いので足さない（カスタム絵文字の spec で足す）。
- **読み込み失敗**: 動的 import が失敗したら `onClose` を呼ぶ。呼ばないと、親の開いた状態が残ったまま `Modal` も描画されず、再読み込みまで「＋」が効かなくなる。
- **Follow-up**: 将来、`EmojiButton` を `EmojiPicker` の上に作り直すことは別の作業とする。

### Decision: 監査ログは正規の `addActivity` ＋ emit で、状態が変わったときだけ記録する
- **Context**: 要件 9.1〜9.5。
- **Alternatives Considered**:
  1. inline-comment と同じ `prisma.activities.createByParameters`
  2. 正規の `addActivity` ＋ `activityEvent.emit`
- **Selected Approach**: 2。新しい action `COMMENT_REACTION_ADD` / `COMMENT_REACTION_REMOVE` は `MediumActionGroup` に入れる（Large は継承）。`EssentialActionGroup`（通知）と `ActivityLogActions`（最近のアクティビティ）には入れない。絵文字は snapshot の新しい variant `CommentReactionSnapshot = { username?, emoji }` に入れる。
- **Rationale**: リポジトリの正規の規約で、監査ログの詳細度の設定にも従う。既存のコメント操作（Medium）と同じ扱いになり、`/^COMMENT_/` のカテゴリにも自動で入る（要件 9.3）。状態を変えない要求は emit しないので記録されない。拒否は `ACTION_UNSETTLED` として残るが、追加・解除としては記録されない（要件 9.4）。
- **Trade-offs**: 監査ログが無効（既定）の環境と、詳細度が Small の環境では、既存のコメント操作と同じく記録されない。要件 9.1、9.2 との関係は未決で、design.md の Open Questions に「(a) Small にも入れる」「(b) 要件を記録の設定に従う形に改める」の2案として整理している。
- **Follow-up**: snapshot に variant を足すことは、`activity-log-snapshot` の方針（action で絞り込む判別可能ユニオン、永続層は全 variant の superset）に沿った拡張として扱う。そのために、保存口（`createByParameters` の `snapshotData`、`buildSnapshotUpdateEnvelope`）にも `emoji` を足す。`ISnapshot` の形が変わるので、`activity-log-snapshot` の Revalidation Trigger に当たり、監査ログ画面の snapshot の表示で確かめる。保存の確認は、route を通したあと DB から読み直して `snapshot.emoji` を見る統合テストで行う。

### Decision: 書き込みの応答で対象のコメントを返し、キャッシュの1件を置き換える（楽観的更新はしない）
- **Context**: 要件 2.9、2.10。
- **Alternatives Considered**:
  1. 書き込みの応答は `{ changed }` だけにして、一覧全体を再取得する
  2. 書き込みの応答に、対象のコメント（`ICommentListItem`、最新のリアクションを含む）を載せ、一覧のキャッシュの1件を置き換える
- **Selected Approach**: 2。応答は `{ changed, comment }`。クライアントは `mutate(updater, { revalidate: false })` で該当の1件だけを置き換える。要求中はチップと「＋」を押せなくする。失敗したら、キャッシュは変えずに、失敗の種類（上限、コメントが無い・読めない、それ以外）ごとの文言で `toastError` を出し、一覧を取り直す。成功でも応答の `reactions` が `null` なら、置き換えずに一覧を取り直す。
- **Rationale**: 応答のコメントは書き込みの後にデータベースから読み直すので、他の利用者のリアクションも含めた最新の状態になる。一覧全体の再取得が要らない。ロールバックの処理も要らない（楽観的更新をしない）。
- **Trade-offs**: 押してから反映されるまで、往復1回分の遅れがある。同じページの他のコメントの変化は、次の再取得まで反映されない（従来の SWR の再検証の範囲）。
- **失敗時に一覧を取り直す理由**: 失敗の多くは、画面のキャッシュがサーバーの状態から遅れていることで起きる。409 は他の利用者が付けた絵文字で上限に達したとき、404 はコメントが削除されたときで、どちらもキャッシュに無い変化が原因である。キャッシュを変えないだけでは、利用者には上限未満のチップや消えたはずのコメントが見えたままになり、同じ操作を繰り返して同じ失敗を受ける。取り直しは失敗のときだけで、成功の経路の「一覧全体を再取得しない」は保つ。
- **`reactions: null` の応答で置き換えない理由**: バーは `reactions` が `null` のとき何も描画しない（要件 6.5）。書き込みの応答でそれを1件に入れると、「＋」も消え、次の再検証まで操作できなくなる。
- **読み直しが `null` のときは 404 で、記録しない**: 対象の解決のあとにコメントが削除された場合、利用者から見ると対象はもう無いので、解決で見つからなかったときと同じ 404 にそろえる。監査ログの追加・解除としては残さず（拒否と同じ扱い）、削除は `COMMENT_REMOVE` で追える。emit と 4xx の応答を同じ要求で組み合わせると、`addActivity` の finalizer が残す `ACTION_UNSETTLED` との関係が分かりにくくなることも避けられる。

### Decision: 追加と解除は1つの PUT（`isReacted`）で明示する
- **Context**: 要件 2.7、2.8（反転型にしない）。
- **Alternatives Considered**:
  1. `PUT`（追加）と `DELETE`（解除、クエリで `emoji` を渡す）に分ける
  2. 1つの `PUT` の JSON body に `{ emoji, isReacted }` を載せる（対象のコメントはパスの `/comments/:id/reactions` で示す）
- **Selected Approach**: 2。
- **Rationale**: `apiv3Delete` はパラメータをクエリで送る。クエリでは `unicode:+1` の `+` が、手で書いた要求（curl、SDK）で空白に化けて 400 になる。JSON body なら符号化の問題が無い。ページの「いいね」（`PUT /_api/v3/page/likes` の `{ pageId, bool }`）とも揃う。
- **Trade-offs**: REST の動詞と操作が1対1にならない。

### Decision: 種類数の上限は 1 コメントあたり 20 とする
- **Context**: 要件 7.1（値は設計で定める）。
- **Selected Approach**: 定数 `MAX_REACTION_KINDS_PER_COMMENT = 20` を interfaces に置き、サーバーとクライアントで共有する。
- **Rationale**: コメント幅でチップが2行程度に収まる。通常の利用で達することは少なく、いたずらの抑止になる。
- **Trade-offs**: 同時に別々の新しい絵文字が追加されると、上限を1〜2件超えうる（検査と挿入が原子的でない）。表示の崩れを防ぐという目的には十分なので、厳密な保証はしない。
- **許容の判断**: `addReaction` は「異なる `emoji` の数を数える → 挿入」の2段で、間に別の要求（別の利用者、または同じ利用者の直接の API 呼び出し）が別の新しい絵文字を挿入すると、どちらも上限未満と判定して通る。同じ絵文字は、同時に追加されても種類数が1つしか増えないので、上限を超えるのは異なる絵文字を同時に追加した場合だけである（同じ利用者の同じ絵文字の重複は一意インデックスが防ぐ）。超過する件数は、同時の要求の数より1つ少ない数までで、通常は1〜2件である。超過しても、チップの行が1つ増える程度で、データの整合は壊れない。トランザクションや排他制御でコストをかけるほどの害ではないと判断し、許容する。

## Synthesis Outcomes
- **Generalization**: 通常コメントとインラインコメント（返信を含む）は `commentId` で同じに扱えるので、データモデル、API、表示部品を1つにする。絵文字キーは判別ユニオンのパーサーとして作り、カスタム絵文字は variant の追加で受け入れる（実装は v1 では `unicode` だけ）。
- **Build vs. Adopt**: ピッカーは emoji-mart（採用済みの依存）を使う。検証と表示のデータは `@growi/emoji-mart-data` を広げる。一意性はデータベースの一意インデックスに任せ、インデックスは既存の migration の仕組みで作る。G2G・インポートの型変換は、既存の `overwrite-params` の拡張点を使う。認可と監査ログは既存のミドルウェアを使う。
- **Simplification**: リアクションの取得経路をコメントの取得に一本化した（専用の取得 API、専用の SWR キー、認可の一致を守るテストが要らない）。書き込みの応答の1件でキャッシュを置き換え、楽観的更新を入れない。種類数の上限の競合は厳密にしない。ユーザーごとの既定の肌の色は emoji-mart の localStorage に任せ、サーバーには持たない（要件の Out of scope に合う）。

## Risks & Mitigations
- emoji-mart の id と Slack のショートコードが一部の絵文字で一致しない可能性がある — 要件 4.6 は「1対1に対応づけられる」ことを求めるが、v1 では Slack と連携しない。名前の対応表の検証は、Slack 連携のスペックで行う（Revalidation Trigger に記載）。
- リアクションの不具合がコメントの取得に波及する — 取り込みの失敗は `reactions: null` にしてコメントは返す。集計は1回の `findMany`（一意インデックスの先頭の `comment` を使う）に限る。
- 単体取得 API で、共有リンクの検証と取得の対象がずれる（IDOR） — `pageId` を必須にし、コメントがその `pageId` のものかを確かめる。別ページのコメント ID を統合テストで確かめる。
- `comment` スペックへの書き戻しが漏れ、契約の持ち主が2つに分かれる — tasks.md の最終タスクにし、書き戻した後は `comment` スペックだけが契約を持つ。
- 利用者の文書が無いリアクションで、リアクションの読み取りがページごと失敗する — `users` へのリレーションを宣言せず、利用者を別に取得して、見つからない ID は文字列で表示する。存在しない `userId` のリアクションを入れた統合テストで確かめる。
- コメントの削除経路でリアクションを後に消す（または同時に消す）と P2014 になる、あるいは将来 `comments` へのリレーションが宣言されて同じことが起きる — `comments` へのリレーションを宣言せず、どの経路でもリアクションを先に消す。本物の DB で削除経路を通す統合テストで確かめる。
- `removeWithReplies` で、返信の ID を集めてから削除するまでの間に返信が増えると、その返信のリアクションが残りうる — 起こりにくい競合で、残っても表示されない（コメントが無い）。完全削除のときは pageId で一括削除するので残らない。
- migration と Prisma の宣言でインデックスの名前・キーがずれる — `map` の名前を migration のインデックス名と一致させ、migration の統合テストでインデックスの名前とキーを確かめる。
- 参照項目を増やしたのに `overwrite-params` を更新し忘れ、G2G で文字列のまま入る — G2G の統合テストで、変換後の文書を `loadReactionChips` で取得できることを確かめる。
- `snapshot.emoji` が保存口で黙って捨てられる（Prisma の composite に足しただけでは保存されない） — `createByParameters` と `buildSnapshotUpdateEnvelope` の両方に足し、本物の route を通したあと DB から読み直す統合テストで確かめる。
- `@growi/emoji-mart-data` の出力形の変更が、本文のレンダラーとエディタの自動補完に影響する — 型を非空タプルにして `skins[0]` を保ち、既存の利用者のテストを通す。

## References
- [Slack reactions.add](https://docs.slack.dev/reference/methods/reactions.add) — 肌の色の修飾子の表記（`::skin-tone-2`〜`6`）と `already_reacted`
- [Slack reactions.get](https://docs.slack.dev/reference/methods/reactions.get) — 並び順の記述が無いことの確認
- [Slack Help: Use emoji and reactions](https://slack.com/intl/en-gb/help/articles/202931348-Use-emoji-and-reactions) — 並び順の記述が無いことの確認
- `.claude/rules/model.md`、`apps/app/.claude/rules/activity-recording.md`、`apps/app/.claude/rules/page-write-action-403-404.md` — 本設計が従うリポジトリの規約
- `.kiro/specs/comment/design.md` — コメント一覧 API の契約と Revalidation Triggers
- `.claude/rules/spec-lifecycle.md` — 完了済みのスペックの契約を変える部分の書き戻しの手順
- `apps/app/src/migrations/20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js` — Mongoose を持たない Prisma だけのコレクションに一意インデックスを作る前例
