# Brief: comment-reactions

## Problem

ページのコメントに対して「いいね」「確認しました」「ありがとう」のような軽い意思表示をしたいとき、今は返信コメントを書くしかない。手間がかかるうえ、スレッドが短い相づちで埋まって本来の議論が読みにくくなる。Slack のメッセージリアクションに慣れた利用者からは、同じ感覚で絵文字を付けたいという要望がある。

- GitHub Discussion #11137「スタンプリアクション（Slack 互換）」（2026-05-14 起票、メンテナー返信なし）。要望の対象は**ページとコメントの両方**。
- Redmine ストーリー #191055。

本スペックでは、このうち**コメントへのリアクション**だけを扱う（ページへのリアクションは Scope の Out を参照）。

## Current State

- **リアクション・スタンプに相当する機能はコードにも spec にも存在しない。** `.kiro/specs/` と `apps/`・`packages/` を検索して確認した。
- **コメントの保存先**: 通常コメントもインラインコメントも、同じ `comments` コレクションに入っている（Prisma `model comments`: `apps/app/prisma/schema.prisma`。インラインコメントは `isInline: true` で区別）。legacy の Mongoose スキーマ（`apps/app/src/features/comment/server/models/comment.ts`）は、コレクションとインデックスの作成と、G2G のインポートでの型変換のために残っている。Mongoose は退役予定。
- **コメント取得 API**（取得と件数の契約は [comment](../comment/) スペックが持つ）
  - apiv3 の `GET /_api/v3/comments`（`apps/app/src/features/comment/server/routes/list.ts`）が、ページの**通常コメントとインラインコメントの両方**を、返信も含めて1つの平らな一覧で返す。両者は `isInline` で区別する。コメント単体を取得する API は無い。
    - `certifySharedPage` → `loginRequired` を通り、ページ閲覧権限（または有効な共有リンク）を確認してから返す。ゲスト閲覧が許可されている Wiki のゲストも読める。
    - **共有リンク閲覧者にも、インラインコメントを含めて読み取り専用で返す**（comment 要件 3.3）。ただし、共有リンクの画面と検索結果のプレビューでは、インラインコメントの UI を出さない（comment 要件 6.5、inline-comment 要件 6）。つまり「API では返すが、画面には出さない」という方針。
    - 投稿者の情報は、ID・ユーザー名・表示名・プロフィール画像 URL の4項目に絞って返す。投稿者の文書が無いときは ID の文字列を返す（`comments.creator` は任意のリレーション）。共有リンク経由でも同じ（comment 要件 1.9）。
  - legacy apiv1 の `GET /_api/comments.get` は**非推奨**。外部の利用者のために挙動を変えずに残している（インラインコメントは返さない。comment 要件 5）。GROWI 自身の画面からは呼ばない。
  - 書き込み系は従来どおり。通常コメントは apiv1 の `comments.add`/`update`/`remove`（`loginRequiredStrictly` と `excludeReadOnlyUserIfCommentNotAllowed`）、インラインコメントは apiv3 の `/_api/v3/inline-comments` 配下の作成・返信・編集・削除・解決。
- **クライアント**: 画面（ページ末尾のコメント欄、本文のインラインコメント、共有リンクの画面、検索結果のプレビュー）は、共通の取得フック `useSWRxCommentList`（`apps/app/src/features/comment/client/stores/comment-list.ts`、SWR キー `['/comments', pageId, shareLinkId]`）を通して `GET /_api/v3/comments` から取得する。共通の外枠 `PageComment/CommentCard/CommentCard.tsx`（slot: `headerEnd` / `beforeBody` / `children` / `footer`）は、通常コメントとインラインコメントの両方の表示で使われている。
- **リアルタイム更新**: コメントには socket.io のイベントが無い。表示が更新されるのは、自分の操作の後に SWR の `mutate()` を呼んだときと、再検証が走ったときだけ。
- **ユーザーごとのトグルとして参考にできる既存実装**
  - ページの「いいね」: `pages.liker` に userId の配列を持つ。トグルは `PUT /_api/v3/page/likes`（`{ pageId, bool }` で追加・解除を明示し、`ACTION_PAGE_LIKE`/`UNLIKE` の Activity と通知を伴う）。UI は `LikeButtons.tsx`。
  - ブックマーク: 別コレクション `bookmarks` に `@@unique([pageId, userId])` を張った正規化モデル。
- **Prisma だけのコレクションとインデックス**: Prisma は MongoDB のインデックスを作らない。Mongoose スキーマを持たない Prisma だけのコレクションの一意インデックスは、migration script で作っている（前例: `apps/app/src/migrations/20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js`）。
- **絵文字の基盤**
  - ピッカー: `packages/editor` が `emoji-mart` / `@emoji-mart/react` / `@emoji-mart/data` に依存している。エディタツールバーの `EmojiButton.tsx`（`components-internal`、遅延ロード）がこれを使っている。エディタ専用の内部コンポーネントで、外部には公開されていない。
  - 表示: Markdown 中の `:shortcode:` は、独自の remark プラグイン（`apps/app/src/services/renderer/remark-plugins/emoji.ts`）がワークスペースパッケージ `@growi/emoji-mart-data` の対応表を引いてネイティブ絵文字に変換している。この対応表は各絵文字の**既定の肌の色（`skins[0]`）だけ**を持ち、肌の色違いのグリフと別名の対応表は持たない（`packages/emoji-mart-data/bin/extract.ts`）。
  - カスタム絵文字: 仕組みは無い。Slack 連携（`slack-integration`、`apps/slackbot-proxy`、`packages/slack`）にも、絵文字や `emoji.list` を扱う処理は無い。

## Desired Outcome

- ログインユーザーが、通常コメントとインラインコメント（どちらも返信を含む）に標準絵文字でリアクションを付けられる。
- 同じ絵文字のリアクションは1つのチップ（絵文字＋人数）にまとめて表示される。誰がリアクションしたかも確認できる。
- 自分が付けたリアクションは見た目で区別でき、チップを押すと追加・解除できる。
- 「リアクション追加」ボタンから絵文字ピッカーを開き、まだ付いていない絵文字を追加できる。
- API の利用者（GROWI MCP、外部スクリプトなど）が、コメントと一緒にリアクションを読める。
- 将来、Slack ワークスペースのカスタム絵文字を足すときに、データモデルと API の作り直しが要らない。

## Approach

**採用: Prisma だけで扱う正規化した専用コレクション（1ユーザー × 1コメント × 1絵文字 = 1ドキュメント）＋名前空間付きの絵文字キー＋コメントの API への統合**

- **データ**: 新しいコレクション `commentreactions` に `{ commentId, pageId, userId, emoji(キー), createdAt }` を保存する。
  - Prisma のモデルだけを持ち、Mongoose のスキーマ・モデルは作らない（Mongoose は退役予定）。
  - `(commentId, userId, emoji)` の一意インデックスと `pageId` のインデックスは、migration script で作る（上記の前例と同じ形）。
  - Prisma のリレーションは1本も宣言しない（`commentId`・`pageId`・`userId` はスカラーの項目だけ）。理由は Constraints の「Prisma のリレーションを宣言しない理由」を参照。
- **読み取り**: リアクション専用の取得 API は作らない。コメントの API に載せる。
  - コメント一覧 API（`GET /_api/v3/comments`）の各コメントに `reactions` を足す。
  - コメント単体の取得 API（`GET /_api/v3/comments/:id`）を新設し、一覧の1件と同じ形で返す。
  - リアクションを取得できなかったときは、コメントは返して `reactions` を `null` にする。
- **書き込み**: `PUT /_api/v3/comments/:id/reactions` に `{ emoji, isReacted }` を送り、追加・解除を明示する（反転型にしない）。応答には、対象のコメントを最新のリアクションとともに、一覧の1件と同じ形で返す。
- **絵文字キー**: `unicode:<shortcode>[::skin-tone-<2..6>]` の形式にする（例: `unicode:+1`、`unicode:+1::skin-tone-3`）。先頭の名前空間で、将来の Slack カスタム絵文字（例: `slack:<workspace>:<name>`）と区別する。名前空間を外した部分は Slack のリアクション名と同じ表記になる。
- **肌の色（skin tone）は Slack に準拠する。** 肌の色ごとに別のリアクションとして数える。詳細は Constraints の「肌の色（skin tone）の扱い」を参照。
- 選定理由:
  - 一意インデックスで「同じ人が同じ絵文字を二重に付ける」状態をデータベース側で防げる。同時に操作されても競合しない。
  - 既存の `comments` ドキュメントに手を入れないので、通常コメント側とインラインコメント側の既存の仕組みに影響しない。
  - コメントを返す応答（一覧、単体、書き込みの応答）がすべて同じ形になり、API 全体の一貫性が保てる。リアクションの読み取りの範囲が、コメントの読み取りの範囲と構造的に一致する。

**不採用の案**

- **コメントドキュメントに埋め込む（`comments.reactions: [{ emoji, userIds[] }]`）**: 取得は簡単になる。しかし、配列の中の配列を更新する際の一意性を保証しにくく、同時の操作で競合する。通常コメントとインラインコメント両方の既存処理に影響が広がる。
- **ページの「いいね」を絵文字の種類だけ増やす（`liker` 方式の一般化）**: 種類が自由に増える絵文字には合わない。カスタム絵文字に拡張することもできない。
- **リアクション専用の取得 API**: `comment` スペックの契約に触れずに済むが、取得が2回になり、認可の判定を2か所で揃え続ける必要がある。コメントを返す API の形も揃わない。

## Amend Target

本スペックは、リアクションという新しい機能を持つスペックである。それと同時に、完了済みの [comment](../comment/) スペックの契約を一部変える。変える部分について、本スペックは `.claude/rules/spec-lifecycle.md` の amend spec として振る舞う。

| 対象スペック | 変わる契約 |
|---|---|
| `comment` | `GET /_api/v3/comments` の応答の各コメント（`ICommentListItem`）に `reactions` を足す |
| `comment` | コメント単体の取得 API `GET /_api/v3/comments/:id` を新設する（応答は一覧の1件と同じ形） |
| `comment` | 一覧と単体の取得が、リアクションの集計に依存する |

- **Revalidation Triggers への影響**: `comment` スペックの Revalidation Triggers のうち「`ICommentListItem` の項目の追加」が発火する。MCP、SDK、画面、外部の利用者が再確認の対象になる。項目の追加なので後方互換である。
- **書き戻し**: tasks.md の最終タスクで、上記の変更を `comment` スペックの requirements.md（受け入れ条件・要件は末尾に追加し、既存の番号は変えない）、design.md、research.md、spec.json（`updated_at`）に書き戻す。書き戻した後は、`comment` スペックがその契約の唯一の持ち主になる。
- **本スペック自体は削除しない**: リアクションのデータ、キーの規則、書き込みの API、表示部品は、本スペックが持ち続ける新しい機能で、spec-lifecycle の「新しい機能のスペックには当てはまらない」に当たる。書き戻すのは `comment` の契約に当たる部分だけ。本スペックは roadmap.md に載っていない。
- **実装中の扱い**: `comment` スペックの本文には、書き戻しのタスクまで手を入れない。

## Scope

- **In**:
  - 通常コメントとインラインコメント（どちらも返信を含む）への標準絵文字リアクションの追加と解除
  - 絵文字ごとにまとめた表示（チップ＋人数）、自分のリアクションの強調表示、リアクションした利用者の確認
  - 「リアクション追加」から開く絵文字ピッカーによる新しい絵文字の追加
  - Slack 準拠の肌の色（`::skin-tone-2`〜`6`）付きリアクション
  - ゲスト（ゲスト閲覧が許可されている Wiki）と共有リンク閲覧者への読み取り専用表示。共有リンクの画面と検索結果のプレビューでは、インラインコメントのリアクションは表示しない
  - コメント一覧 API の応答へのリアクションの追加と、コメント単体の取得 API の新設（`comment` スペックへの書き戻しを含む）
  - 1つのコメントに付けられる絵文字の種類数の上限（20）
  - コメント・ページの削除に伴うリアクションの削除
  - **リアクションの追加・解除の Activity（監査ログ）への記録**（`COMMENT_REACTION_ADD` / `COMMENT_REACTION_REMOVE`。snapshot に絵文字を残す）
  - **GROWI 間移行（G2G）・インポートへの対応**（リアクションのコレクションは移行対象）
  - 将来のカスタム絵文字を受け入れられる絵文字キーの設計（受け入れられる形にすることがスコープで、カスタム絵文字の実装は Out）
- **Out**:
  - Slack ワークスペースのカスタム絵文字の取得・同期・表示（将来の別スペック）
  - GROWI 独自のカスタム絵文字のアップロード・管理
  - **ページ**へのリアクション（Discussion #11137 では要望されているが、今回は対象外。ページの「いいね」とどう関係づけるかを含めて別スペックで検討する）
  - リアクションのリアルタイム反映（コメント自体にも socket.io イベントが無いので、それに合わせる）
  - リアクションに関する通知
  - Slack 側のリアクションとの双方向同期
  - 複数人の絵文字（🤝 など）で人ごとに異なる肌の色を付けること。Slack でのリアクション名の表現を一次情報で確認できなかったため、v1 は単一の `::skin-tone-N` だけを扱う
  - ユーザーごとの「既定の肌の色」設定（Slack にはある）。v1 ではピッカーでその都度選ぶ

## Boundary Candidates

- **データモデルと永続化**: Prisma だけのモデル、インデックスを作る migration script、名前空間付き絵文字キーの型と検証
- **コメントの API への統合**: 一覧・単体の取得の応答へのリアクションの取り込みと、コメント単体の取得 API（`comment` スペックへの書き戻しの対象）
- **書き込みの API と認可**: `PUT /_api/v3/comments/:id/reactions`、閲覧権限の確認、監査ログの記録
- **絵文字ピッカー**: `packages/editor` に、エディタに依存しない遅延ロードのピッカー部品 `EmojiPicker` を新設して公開する（既存の `EmojiButton` には手を入れない）
- **リアクションバー UI**: チップ、人数、自分のリアクションの強調、利用者の一覧、「リアクション追加」ボタン。`CommentCard` の `footer` に差し込む
- **削除と監査ログ**: 削除経路へのリアクションの削除の追加、Activity の action と snapshot の追加
- **G2G 移行・インポート**: 移行対象コレクションとしての登録と、インポート時の参照項目の型変換

## Out of Boundary

- **共有リンク経由で何を返すかの方針。** 共有リンク閲覧者にどのコメントを返すかは [comment](../comment/) スペックが決めており（要件 3.3: インラインコメントも含めて読み取り専用で返す）、本スペックはそれを変えない。リアクションはコメントと同じ応答に載るので、読み取りの範囲はコメントと一致する。
- コメント本文、投稿・編集・削除・解決、メンションの仕様変更。既存のまま変えない（削除経路にリアクションの削除を足すことだけを持つ）。
- `comments` の既存の Mongoose スキーマの退役。本スペックはそれに触れず、手も足さない。
- 旧式の `GET /_api/comments.get` の応答（リアクションを載せない）。
- エディタ本体の絵文字入力（ツールバーの EmojiButton、`:` からの自動補完）の挙動変更。
- カスタム絵文字の配信基盤（画像のプロキシ・キャッシュなど）。
- GROWI MCP サーバーと SDK（別リポジトリ）。`reactions` を使うかどうかは、それぞれの側で決める。

## Upstream / Downstream

- **Upstream**:
  - `comments` コレクション（Prisma `model comments`）と `features/comment` の Prisma 拡張
  - コメント一覧 API（`list.ts`）と取得フック `useSWRxCommentList`
  - ミドルウェア（`certifySharedPage`、`loginRequired` / `loginRequiredStrictly`、`excludeReadOnlyUserIfCommentNotAllowed`、`accessTokenParser`、`addActivity`）
  - `@growi/emoji-mart-data`（本文レンダラーと共有）、`packages/editor` の emoji-mart 依存
  - `CommentCard` を含む `PageComment/` の共通コンポーネント群
  - Activity・監査ログの仕組み（`apps/app/src/interfaces/activity.ts`、`apps/app/src/server/models/activity.ts`、`apps/app/.claude/rules/activity-recording.md`）
  - migrate-mongo の migration の仕組み（`apps/app/src/migrations/`）
  - GROWI 間移行・インポートの仕組み（`apps/app/src/server/service/import/`）
- **Downstream**:
  - Slack カスタム絵文字対応（将来の別スペック。本スペックの名前空間付き絵文字キーを前提にする）
  - ページへのリアクション（将来の別スペック。モデルを共通化するかはそのときに判断する）
  - コメントのリアルタイム更新（将来入れる場合は、リアクションもその対象になる）
  - GROWI MCP・SDK（コメントの応答の `reactions` を使う場合）

## Future Direction: 絵文字基盤の独立パッケージ化（構想・本スペックの対象外）

PR レビューでの指摘に基づく構想の記録。**本スペックではリファクタしない。** 実施する場合は、Slack カスタム絵文字の別スペックで扱う。

- **指摘**: `EmojiPicker` を `packages/editor` に置き、コメントリアクション（`apps/app`）が使うのは、責務の分離の観点でよくない。`packages/editor` はエディタのためのパッケージで、エディタ以外の画面が使う部品を置く場所ではない。
- **構想**: Slack カスタム絵文字に対応するとき、`EmojiPicker` を含む絵文字まわりの部品を、`apps/app` からも `packages/editor` からも独立した新規パッケージに置く。`apps/app` と `packages/editor` はどちらもそのパッケージに依存する。
- **現在の置き場所**（実コードで確認）:
  - ピッカー部品 `EmojiPicker`: `packages/editor/src/client/components/EmojiPicker/`（`@growi/editor/dist/client/components/EmojiPicker` として公開。`@emoji-mart/react` と `@emoji-mart/data` を遅延ロードする）。利用側は `apps/app` の `features/comment-reaction/client/components/CommentReactionBar/AddReactionButton.tsx`。
  - エディタツールバーの `EmojiButton`: `packages/editor/src/client/components-internal/CodeMirrorEditor/Toolbar/EmojiButton.tsx`。`EmojiPicker` は使わず、自前で同じ emoji-mart を遅延ロードしている（重複あり）。
  - 絵文字データ `@growi/emoji-mart-data`: `packages/emoji-mart-data/`（private パッケージ。`apps/app` と `packages/editor` の両方が依存）。利用側は本文レンダラーの `apps/app/src/services/renderer/remark-plugins/emoji.ts`、リアクションキーの `apps/app/src/features/comment-reaction/utils/reaction-key.ts`、エディタの `:` 自動補完 `packages/editor/src/client/services-internal/extensions/emojiAutocompletionSettings.ts`。
  - emoji-mart 本体への依存: `packages/editor/package.json`（`emoji-mart`、`@emoji-mart/react`、`@emoji-mart/data`）。`apps/app` は `@emoji-mart/data` を devDependency に持つ。
- **新パッケージに集めることを検討する対象**: `EmojiPicker`、`@growi/emoji-mart-data` に相当する絵文字データと別名の対応表、カスタム絵文字を足すための拡張点（標準絵文字とカスタム絵文字を同じ形で扱う入口）、`EmojiButton` との重複の解消。
- **未決**: パッケージ名と、既存の `@growi/emoji-mart-data` を取り込むか並べるか。カスタム絵文字の取得元（Slack API）をパッケージに含めるか、`apps/app` 側に置いてパッケージには注入するだけにするか。
- **前提となる設計**: 絵文字キーの名前空間（`unicode:` / `slack:<workspace>:<name>`）は本スペックで決めてあり、パッケージを分けてもキーの形式は変わらない。

## Existing Spec Touchpoints

- **Extends**: [comment](../comment/)（コメント一覧 API の応答への `reactions` の追加と、コメント単体の取得 API の新設）。「Amend Target」のとおり、この部分は最終タスクで `comment` スペックへ書き戻す。それ以外のリアクション機能は、本スペックが新しい機能として持ち続ける。
- **Adjacent**:
  - [inline-comment](../inline-comment/): 同じ `comments` コレクションと `CommentCard` を共有している。インラインコメントの削除経路（起点・返信）にリアクションの削除を足す。インラインコメントの型（`InlineCommentWithReplies` など）は変えない。
  - [share-link-comments](../share-link-comments/): 共有リンク閲覧者はコメントを読み取り専用で見られる、という前提。リアクションも読み取り専用で見せ、追加・解除は禁止する。
  - [comment-mention](../comment-mention/): コメントエディタの絵文字自動補完（`emojiCompletionSource`）。関心は重ならないが、絵文字のデータソースは揃える。
  - [activity-log](../activity-log/) / [activity-log-snapshot](../activity-log-snapshot/): 新しい Activity アクションを足す場合の記録方針と、snapshot の判別可能ユニオン。snapshot に variant を足すので、`activity-log-snapshot` の Revalidation Trigger（`ISnapshot` の形の変更）に当たる。

## Constraints

- **認可**
  - 追加・解除には `loginRequiredStrictly` と `excludeReadOnlyUserIfCommentNotAllowed` に加え、**対象コメントのページを閲覧できるか**の確認が要る。権限の無いページのコメントと存在しないコメントには、同じ 404 を返す。
  - ゲストと共有リンク閲覧者は読み取り専用とする。
  - コメント単体の取得 API は、共有リンクの検証のために `pageId` を必須にし、コメントがそのページのものかを確かめる（ページ A の共有リンクでページ B のコメントを読ませない）。
- **インデックスの作成**: Prisma は一意インデックスを作らないので、`(comment, user, emoji)` の一意インデックスと `page` のインデックスは migration script で作る。migration はサーバーの起動前と統合テストの DB の作成時に実行される。インデックス名は Prisma の `@@unique` / `@@index` の `map` と一致させる。
- **Prisma のリレーションを宣言しない理由**（いずれも実コード・実 DB で確認）
  - MongoDB には外部キーが無く、Prisma が参照の整合をエミュレートする。`onDelete: NoAction` のリレーションは、必須でも任意でも、子が残った状態で親を Prisma で削除すると P2014 で失敗する。
  - 必須のリレーションを `include` すると、参照先の文書が1件でも無いと、クエリ全体が `Inconsistent query result` で失敗する。利用者の文書が無いリアクションは、インポート・G2G（コレクションを選んで取り込める）、DB の直接操作、将来の物理削除で起こりうる。
  - そのため、`comments`・`pages`・`users` のどれにもリレーションを宣言しない。リアクションした利用者の情報は `users` から別に取得し、見つからない利用者は ID の文字列として表示して人数に数える（コメント投稿者と同じ規則）。
- **削除の経路と順番**: 次の経路すべてでリアクションも消す。どの経路でも、配列形式のトランザクションの先頭でリアクションを消す（リアクション → 返信 → コメントの順。既存の返信の削除と同じ「子から親」）。
  - `removeWithReplies`（通常コメントとその返信の削除、インラインコメントの起点の削除）
  - インラインコメントの返信の削除（`deleteReply`）
  - `apps/app/src/server/service/page/delete-completely-operation.ts`（ページの完全削除）
- **追加・解除の API の形**: 「押すたびに反転する」トグル API にはせず、クライアントが「追加」か「解除」かを明示して送る（ページの「いいね」と同じ考え方）。
  - コメントにはリアルタイム更新が無いので、画面の状態が古いまま操作されることがある。反転型では、別タブで付けた 👍 を古い画面から押すと、本人の意図（追加）に反して解除になってしまう。
  - 明示型なら、既に付いているものへの「追加」や、付いていないものへの「解除」は何もせずに成功扱いにでき、何度送っても結果が変わらない。
  - `emoji` はクエリではなく JSON body で送る（`unicode:+1` の `+` がクエリでは空白に化けるため）。
- **GROWI 間移行（G2G）・インポート**: リアクションのコレクションは移行対象とし、`non-transferable-collections.ts` の `TRANSFERABLE_COLLECTIONS` に登録する。Mongoose のモデルが無いコレクションは、インポート時に `_id` と日付以外の参照項目が文字列のまま入るので、コレクションごとの `overwrite-params` で `comment` / `page` / `user` を ObjectId に戻し、`emoji` を正規のキーにそろえる（G2G とファイルインポートの両方で適用される）。
- **監査ログ**: 新しい action は `MediumActionGroup` に入れ（既存のコメント操作と同じ扱い）、通知のグループには入れない。snapshot の `emoji` は、Prisma の `ActivitiesSnapshot` に足すだけでは保存されない（`createByParameters` などが決まった項目だけを取り出して保存し直すため）ので、保存口にも足す。Mongoose の `snapshotSchema` には足さない（書き込みも読み取りも Prisma で行われるため）。
- **絵文字キー**
  - 標準絵文字は `@growi/emoji-mart-data` に存在するショートコードだけを受け付け、サーバー側で検証する（任意の文字列を保存させない）。
  - 別名は正規のショートコードにそろえて保存する（例: `thumbsup` → `+1`）。同じ絵文字が別名で別のチップに分かれないようにするため。
- **肌の色（skin tone）の扱い（Slack 準拠）**
  - **キーの形式**: Slack の `reactions.add` は、肌の色の修飾子に対応する Unicode 絵文字について、名前の後ろに `::skin-tone-` と 2〜6 の数字を付けた名前（例: `thumbsup::skin-tone-6`）を受け付ける（[reactions.add](https://docs.slack.dev/reference/methods/reactions.add)）。本スペックの名前部分もこの形式とし、Slack のリアクション名と1対1で対応させる。
  - **`skin-tone-1` は無い**: Unicode は Fitzpatrick の1型と2型を1つの修飾子（U+1F3FB）にまとめており、Slack は `skin-tone-2`（U+1F3FB）〜`skin-tone-6`（U+1F3FF）を使う。修飾子の無い名前（例: `+1`）が既定（黄色）の絵文字にあたる。
  - **肌の色ごとに別のリアクションとして数える**: Slack API のリアクションは `name` だけで区別され、肌の色も `name` に含まれる。本スペックも、肌の色ごとに別のチップとし、同じ人が既定の 👍 と 👍🏽 を両方付けることも許す。Slack の画面が肌の色違いを1つにまとめて表示しているかは、一次情報で確認できなかった。
  - **肌の色を付けられる絵文字**: 絵文字データに肌の色違いがある Unicode 絵文字だけ。それ以外への `::skin-tone-N` はサーバー側で拒否する。
  - **絵文字データ**: `@growi/emoji-mart-data` の出力を広げ、肌の色違いのグリフと別名の対応表も持たせる（サーバーの検証とクライアントの表示の両方で使う）。ピッカーが読み込む `@emoji-mart/data` の既定のデータは、`@growi/emoji-mart-data` の抽出元と同じ。
- **ピッカーのバンドルサイズ**: emoji-mart はデータが大きいので、エディタと同じく遅延ロードにして、ページ閲覧時の初回ロードを増やさない。
- **i18n**: UI 文言（ツールチップ、「リアクション追加」ボタンのラベル、利用者の一覧など）は既存の i18n の仕組みに乗せる。
