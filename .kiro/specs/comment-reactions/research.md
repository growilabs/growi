# Research & Design Decisions

## Summary
- **Feature**: `comment-reactions`
- **Discovery Scope**: Extension（既存のコメント機能・監査ログ・G2G 移行・絵文字基盤への統合。認可と情報露出に関わるため、light discovery に加えて認可・データ移行の経路は個別に深掘りした）
- **Key Findings**:
  - コメントの取得は `GET /_api/v3/comments`（`comment` スペック）に一本化され、共有リンク閲覧者にもインラインコメントを返す。その応答（`ICommentListItem`）の項目追加は `comment` スペックの Revalidation Trigger なので、リアクションは別エンドポイントで読む。
  - 新しいコレクションを G2G 移行で正しく運ぶには、**Mongoose スキーマを起動時に登録することが必須**。エクスポートは JSON 文字列化され、インポート時の ObjectId への型変換は Mongoose スキーマがあるときにしか行われない。一意インデックスの作成も Mongoose が持つ（`.claude/rules/model.md`）。
  - emoji-mart 5.6.0 のピッカーは、肌の色付きの絵文字を `shortcodes: ':+1::skin-tone-3:'`、`skin: 3` で返す。Slack のリアクション名 `+1::skin-tone-3` と同じ段階番号（2〜6）なので、変換は区切り文字の付け替えだけで済む。

## Research Log

### コメント取得 API の現状と共有リンク
- **Context**: リアクションの読み取りの認可を、コメント一覧と揃える必要がある（要件 6.1）。
- **Sources Consulted**: `apps/app/src/features/comment/server/routes/list.ts`、`.kiro/specs/comment/{brief,requirements,design}.md`
- **Findings**:
  - 認可の連鎖は `accessTokenParser([SCOPE.READ.FEATURES.PAGE])` → validators → `apiV3FormValidator` → `certifySharedPage` → `loginRequiredFactory(crowi, true)`（ゲスト可）→ handler。handler では、`req.isSharedPage === true` か、`findPageAndMetaDataByViewer(...).meta` が not-found でないことを確認する。失敗したら 404 `notfound_or_forbidden` を返す。
  - 共有リンク経由では `revisionId` を無視し、インラインコメントも返す（comment 要件 3.3）。画面側は、共有リンクの画面と検索結果のプレビューでインラインコメントを描画しない（comment 要件 6.5）。
  - `comment` スペックの Revalidation Triggers には「`ICommentListItem` の項目の追加」「取得フックのキー `['/comments', pageId, shareLinkId]` の変更」が含まれる。
- **Implications**: リアクションは専用の GET を新設し、`list.ts` と同じ標準ミドルウェアと閲覧判定の部品で組む。comment スペックの契約には触れない。

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
- **Implications**: 正規の `addActivity` ＋ `activityEvent.emit` を使い、状態が変わったときだけ emit する。絵文字は snapshot の新しい variant に入れる。

### 新しいコレクション、インデックス、G2G 移行
- **Context**: 一意制約 `(comment, user, emoji)`（要件 2.4）と G2G 移行（要件 10）。
- **Sources Consulted**: `.claude/rules/model.md`、`apps/app/src/server/models/bookmark.ts`、`features/news/server/models/news-read-status.ts`、`server/service/import/{non-transferable-collections,construct-convert-map,overwrite-function,get-model-from-collection-name,detect-unique-conflicts}.ts`、`server/service/export.ts`、`server/crowi/setup-models.ts`、`utils/prisma.ts`
- **Findings**:
  - Mongoose スキーマは、移行が終わるまでコレクションとインデックスの作成を担う。`bookmarks` と `newsreadstatuses` は、Mongoose スキーマの `schema.index(..., { unique: true })` で一意インデックスを作っている。
  - Prisma だけで作られた `auditlog_es_sync_status` などは `@unique` を宣言しているが、インデックスを作る仕組みが無い。そのため、一意性はデータベースで保証されていない（反面教師）。
  - エクスポートは `collection.find()` を JSON 文字列化する。インポートの `keepOriginal` は、Mongoose スキーマがあるときだけ `schema.path(prop).cast()` で ObjectId に戻す。スキーマが無いと、`_id` 以外の参照項目は文字列のまま入り、Prisma の `@db.ObjectId` の検索に一致しなくなる。
  - `non-transferable-collections.integ.ts` は、データベース・Mongoose・Prisma に現れるコレクションが `TRANSFERABLE_COLLECTIONS` と `NON_TRANSFERABLE_COLLECTIONS` のどちらかにあることを検査する。
  - `detect-unique-conflicts.ts` の対象は、自然キー（username など）が環境をまたいで衝突しうる4コレクションだけ。ObjectId で決まる一意キーは対象外。
  - G2G の ID は付け替えずに保持する（`construct-convert-map.ts` の既定は `keepOriginal`）。
- **Implications**: Prisma モデルに加えて Mongoose スキーマ（ObjectId の参照、一意インデックス、`getOrCreateModel`）を作り、`setupIndependentModels` で起動時に読み込む。`TRANSFERABLE_COLLECTIONS` に登録する。`detect-unique-conflicts` と `overwrite-params` は不要。

### 削除の経路
- **Context**: 要件 8。
- **Sources Consulted**: `features/comment/server/models/comment.ts`（`removeWithReplies`）、`inline-comment-service.ts`（`deleteComment` / `deleteReply`）、`server/routes/comment.js`（`api.remove`）、`server/service/page/delete-completely-operation.ts`
- **Findings**:
  - `removeWithReplies(commentId)` は、返信の `deleteMany` と本体の `delete` を配列トランザクションで行う。通常コメントの削除（apiv1 `comments.remove`）とインラインコメントの起点の削除（`deleteComment`）の両方が、これを使う。
  - インラインコメントの返信の削除（`deleteReply`）は、単独の `prisma.comments.delete`。
  - ページの完全削除は、`prisma.$transaction([comments.deleteMany(返信), comments.deleteMany(全部)])` のあと、`Promise.all` で関連データを消す。
  - ごみ箱への移動と復元では、コメントに触れない。
- **Implications**: 3つの経路（`removeWithReplies`、`deleteReply`、`deleteCompletelyOperation`）に、Prisma の `commentreactions.deleteMany` を同じトランザクションの中で足す。ごみ箱の経路には何もしない（要件 8.4 は自然に満たされる）。

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
| (a) コメント一覧 API に相乗り | `ICommentListItem` にリアクションの集計を足す | 取得が1回で済む | `comment` スペックの契約変更（MCP・SDK・外部利用者に波及）。amend の書き戻しが要る | 不採用 |
| (b) 専用の読み取り API | `GET /_api/v3/comment-reactions` を新設 | comment スペックの契約に触れない。リアクションだけ再取得できる | 取得が2回になる。認可をコメント一覧と揃え続ける必要がある | **採用**。認可の一致は統合テストで守る |
| 埋め込み（`comments.reactions`） | コメントのドキュメントに配列で持つ | 取得が単純 | 同時更新の一意性、Mongoose と Prisma の両方の変更、既存処理への波及 | discovery で不採用済み（brief.md） |

## Design Decisions

### Decision: リアクションの読み取りは専用エンドポイントにする
- **Context**: 要件 1、6.1。comment スペックの Revalidation Trigger。
- **Alternatives Considered**:
  1. `GET /_api/v3/comments` の応答に含める
  2. 専用の `GET /_api/v3/comment-reactions?pageId=` を新設する
- **Selected Approach**: 2。ページ単位でまとめて返す。認可は `list.ts` と同じ部品（`certifySharedPage`、`loginRequiredFactory(crowi, true)`、`findPageAndMetaDataByViewer`）で組む。
- **Rationale**: 既存スペックの契約を変えずに済み、amend の扱いも要らない。追加・解除の後に、リアクションだけを再取得できる。
- **Trade-offs**: ページ表示時の要求が1本増える。認可の判定が2か所に並ぶ。
- **Follow-up**: 「コメント一覧が返す相手にだけリアクションも返す」ことを、同じ条件の組（閲覧権限あり／なし、共有リンク正／誤、ゲスト閲覧可／不可）で両方の API に当てる統合テストで守る。

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
- **Selected Approach**: 2。`EmojiPicker` を新設し、`EmojiButton` と同じ遅延 import の方式を使う。肌の色の選択を有効にして、`{ id, skin? }` を返す。
- **Rationale**: emoji-mart への依存とバージョンを1か所に保てる。既存の `EmojiButton` に手を入れない（エディタの挙動は変えない）。
- **Trade-offs**: `EmojiButton` との遅延 import の重複が少し残る。
- **Follow-up**: 将来、`EmojiButton` を `EmojiPicker` の上に作り直すことは別の作業とする。

### Decision: 監査ログは正規の `addActivity` ＋ emit で、状態が変わったときだけ記録する
- **Context**: 要件 9.1〜9.5。
- **Alternatives Considered**:
  1. inline-comment と同じ `prisma.activities.createByParameters`
  2. 正規の `addActivity` ＋ `activityEvent.emit`
- **Selected Approach**: 2。新しい action `COMMENT_REACTION_ADD` / `COMMENT_REACTION_REMOVE` は `MediumActionGroup` に入れる（Large は継承）。`EssentialActionGroup`（通知）と `ActivityLogActions`（最近のアクティビティ）には入れない。絵文字は snapshot の新しい variant `CommentReactionSnapshot = { username?, emoji }` に入れる。
- **Rationale**: リポジトリの正規の規約で、監査ログの詳細度の設定にも従う。既存のコメント操作（Medium）と同じ扱いになり、`/^COMMENT_/` のカテゴリにも自動で入る（要件 9.3）。状態を変えない要求は emit しないので記録されない。拒否は `ACTION_UNSETTLED` として残るが、追加・解除としては記録されない（要件 9.4）。
- **Trade-offs**: 監査ログの詳細度が Small の環境では、既存のコメント操作と同じく記録されない。要件 9.1 は、監査ログの記録が有効な範囲での記録と解釈する（Open Questions に記載）。
- **Follow-up**: snapshot に variant を足すことは、`activity-log-snapshot` の方針（action で絞り込む判別可能ユニオン）に沿った拡張として扱う。

### Decision: 追加・解除の後はリアクションを再取得する（楽観的更新はしない）
- **Context**: 要件 2.9、2.10。
- **Selected Approach**: 書き込みの応答は `{ changed: boolean }` だけにする。成功したら、そのページのリアクションを再取得する。要求中はチップと「＋」を押せなくする。失敗したら `toastError` を出し、表示は取得済みのまま（操作前の状態）にする。
- **Rationale**: 他の利用者の操作も反映した最新の状態を、単一の取得経路から得られる。ロールバックの処理が要らない（単純化）。
- **Trade-offs**: 押してから反映されるまで、往復1回分の遅れがある。

### Decision: 追加と解除は1つの PUT（`isReacted`）で明示する
- **Context**: 要件 2.7、2.8（反転型にしない）。
- **Alternatives Considered**:
  1. `PUT`（追加）と `DELETE`（解除、クエリで `emoji` を渡す）に分ける
  2. 1つの `PUT` の JSON body に `{ commentId, emoji, isReacted }` を載せる
- **Selected Approach**: 2。
- **Rationale**: `apiv3Delete` はパラメータをクエリで送る。クエリでは `unicode:+1` の `+` が、手で書いた要求（curl、SDK）で空白に化けて 400 になる。JSON body なら符号化の問題が無い。ページの「いいね」（`PUT /_api/v3/page/likes` の `{ pageId, bool }`）とも揃う。
- **Trade-offs**: REST の動詞と操作が1対1にならない。

### Decision: 種類数の上限は 1 コメントあたり 20 とする
- **Context**: 要件 7.1（値は設計で定める）。
- **Selected Approach**: 定数 `MAX_REACTION_KINDS_PER_COMMENT = 20` を interfaces に置き、サーバーとクライアントで共有する。
- **Rationale**: コメント幅でチップが2行程度に収まる。通常の利用で達することは少なく、いたずらの抑止になる。
- **Trade-offs**: 同時に別々の新しい絵文字が追加されると、上限を1〜2件超えうる（検査と挿入が原子的でない）。表示の崩れを防ぐという目的には十分なので、厳密な保証はしない。

## Synthesis Outcomes
- **Generalization**: 通常コメントとインラインコメント（返信を含む）は `commentId` で同じに扱えるので、データモデル、API、表示部品を1つにする。絵文字キーは判別ユニオンのパーサーとして作り、カスタム絵文字は variant の追加で受け入れる（実装は v1 では `unicode` だけ）。
- **Build vs. Adopt**: ピッカーは emoji-mart（採用済みの依存）を使う。検証と表示のデータは `@growi/emoji-mart-data` を広げる。一意性はデータベースの一意インデックスに任せる。認可と監査ログは既存のミドルウェアを使う。
- **Simplification**: 書き込みの応答に集計を返さず、再取得で一本化した。楽観的更新を入れない。種類数の上限の競合は厳密にしない。ユーザーごとの既定の肌の色は emoji-mart の localStorage に任せ、サーバーには持たない（要件の Out of scope に合う）。

## Risks & Mitigations
- emoji-mart の id と Slack のショートコードが一部の絵文字で一致しない可能性がある — 要件 4.6 は「1対1に対応づけられる」ことを求めるが、v1 では Slack と連携しない。名前の対応表の検証は、Slack 連携のスペックで行う（Revalidation Trigger に記載）。
- 認可の判定がコメント一覧と食い違う — 両方の API に同じ条件の組を当てる統合テストで守る。
- `removeWithReplies` で、返信の ID を集めてから削除するまでの間に返信が増えると、その返信のリアクションが残りうる — 起こりにくい競合で、残っても表示されない（コメントが無い）。完全削除のときは pageId で一括削除するので残らない。
- `@growi/emoji-mart-data` の出力形の変更が、本文のレンダラーとエディタの自動補完に影響する — 型を非空タプルにして `skins[0]` を保ち、既存の利用者のテストを通す。

## References
- [Slack reactions.add](https://docs.slack.dev/reference/methods/reactions.add) — 肌の色の修飾子の表記（`::skin-tone-2`〜`6`）と `already_reacted`
- [Slack reactions.get](https://docs.slack.dev/reference/methods/reactions.get) — 並び順の記述が無いことの確認
- [Slack Help: Use emoji and reactions](https://slack.com/intl/en-gb/help/articles/202931348-Use-emoji-and-reactions) — 並び順の記述が無いことの確認
- `.claude/rules/model.md`、`apps/app/.claude/rules/activity-recording.md`、`apps/app/.claude/rules/page-write-action-403-404.md` — 本設計が従うリポジトリの規約
- `.kiro/specs/comment/design.md` — コメント一覧 API の契約と Revalidation Triggers
