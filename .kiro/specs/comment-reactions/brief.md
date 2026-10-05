# Brief: comment-reactions

## Problem

ページのコメントに対して「いいね」「確認しました」「ありがとう」のような軽い意思表示をしたいとき、今は返信コメントを書くしかない。手間がかかるうえ、スレッドが短い相づちで埋まって本来の議論が読みにくくなる。Slack のメッセージリアクションに慣れた利用者からは、同じ感覚で絵文字を付けたいという要望がある。

- GitHub Discussion #11137「スタンプリアクション（Slack 互換）」（2026-05-14 起票、メンテナー返信なし）。要望の対象は**ページとコメントの両方**。
- Redmine ストーリー #191055。

本スペックでは、このうち**コメントへのリアクション**だけを扱う（ページへのリアクションは Scope の Out を参照）。

## Current State

- **リアクション・スタンプに相当する機能はコードにも spec にも存在しない。** `.kiro/specs/` と `apps/`・`packages/` を検索して確認した。
- **コメントの保存先**: 通常コメントもインラインコメントも、同じ `comments` コレクションに入っている（Prisma `model comments`: `apps/app/prisma/schema.prisma`。インラインコメントは `isInline: true` で区別）。legacy の Mongoose スキーマ（`apps/app/src/features/comment/server/models/comment.ts`）は、コレクションとインデックスを作るためだけに残っている（`.claude/rules/model.md`）。
- **コメント取得 API**
  - 通常コメント: legacy apiv1 の `GET /_api/comments.get` が、ページの全コメント（返信を含む、非インラインのみ）を1回で返す。`certifySharedPage` → `loginRequired` を通るので、ゲスト閲覧が許可されている Wiki のゲストと共有リンク閲覧者も**読み取り**はできる。書き込み系（`comments.add`/`update`/`remove`）は `loginRequiredStrictly` と `excludeReadOnlyUserIfCommentNotAllowed` で守られている。
  - インラインコメント: apiv3 の `/_api/v3/inline-comments`。`certifySharedPage` を意図的に通していないため、共有リンク閲覧者には返らない（[inline-comment](../inline-comment/) の brief でスコープ内と定めたデータ露出対策）。
- **クライアント**: 通常コメントは `useSWRxPageComment`（`apps/app/src/stores/comment.tsx`）で取得し、`Comments.tsx` → `PageComment.tsx` → `PageComment/Comment.tsx` の順に描画する。共通の外枠 `PageComment/CommentCard/CommentCard.tsx`（slot: `headerEnd` / `beforeBody` / `children` / `footer`）は、インラインコメント側（`InlineCommentItem.tsx`、`InlineCommentReplies.tsx`、`InlineCommentPopoverEntry.tsx`）でも使われている。
- **リアルタイム更新**: コメントには socket.io のイベントが無い。表示が更新されるのは、自分の操作の後に SWR の `mutate()` を呼んだときと、再検証が走ったときだけ。
- **ユーザーごとのトグルとして参考にできる既存実装**
  - ページの「いいね」: `pages.liker` に userId の配列を持つ。トグルは `PUT /_api/v3/page/likes`（`ACTION_PAGE_LIKE`/`UNLIKE` の Activity と通知を伴う）。UI は `LikeButtons.tsx`（件数ボタンからポップオーバーで `UserPictureList` を開く）。
  - ブックマーク: 別コレクション `bookmarks` に `@@unique([pageId, userId])` を張った正規化モデル。
- **絵文字の基盤**
  - ピッカー: `packages/editor` が `emoji-mart` / `@emoji-mart/react` / `@emoji-mart/data` に依存している。エディタツールバーの `EmojiButton.tsx`（`components-internal`、遅延ロード、reactstrap `Modal`）がこれを使っている。エディタ専用の内部コンポーネントで、外部には公開されていない。
  - 表示: Markdown 中の `:shortcode:` は、独自の remark プラグイン（`apps/app/src/services/renderer/remark-plugins/emoji.ts`）がワークスペースパッケージ `@growi/emoji-mart-data` の対応表を引いてネイティブ絵文字に変換している。
  - カスタム絵文字: 仕組みは無い。Slack 連携（`slack-integration`、`apps/slackbot-proxy`、`packages/slack`）にも、絵文字や `emoji.list` を扱う処理は無い。

## Desired Outcome

- ログインユーザーが、各コメントに標準絵文字でリアクションを付けられる。
- 同じ絵文字のリアクションは1つのチップ（絵文字＋人数）にまとめて表示される。誰がリアクションしたかも確認できる。
- 自分が付けたリアクションは見た目で区別でき、チップをクリックすると追加・解除を切り替えられる。
- 「＋」ボタンから絵文字ピッカーを開き、まだ付いていない絵文字を追加できる。
- 将来、Slack ワークスペースのカスタム絵文字を足すときに、データモデルと API の作り直しが要らない。

## Approach

**採用: 正規化した専用コレクション（1ユーザー × 1コメント × 1絵文字 = 1ドキュメント）＋名前空間付きの絵文字キー**

- 新しいコレクション（仮称 `commentreactions`）に `{ commentId, pageId, userId, emoji(キー), createdAt }` を保存し、`(commentId, userId, emoji)` に一意制約を張る。追加は upsert、解除は delete として別々の操作で受け付け、どちらも何度送っても結果が変わらない（冪等）ようにする（Constraints の「追加・解除の API の形」を参照）。`pageId` を持たせるのは、ページ単位でまとめて取得するためと、ページ削除時に一括で消すため。
- 表示用の集計（絵文字ごとの人数、自分が付けたか、リアクションしたユーザー）は、読み取り時にページ単位でまとめて作る。通常コメントとインラインコメントは `commentId` で同じように扱えるので、モデルは1つで足りる。
- **絵文字キーには名前空間を持たせる。** 標準絵文字は `@growi/emoji-mart-data`（本文レンダラーと同じ対応表）のショートコードで識別する。将来の Slack カスタム絵文字とキーが衝突しないよう、種別を区別する仕組み（例: 種別フィールド、または `std:+1` / `slack:<workspace>:<name>` のような接頭辞）を最初から入れる。どちらの形式にするかは設計フェーズで決める。
- 選定理由:
  - 一意制約で「同じ人が同じ絵文字を二重に付ける」状態をデータベース側で防げる。同時に操作されても競合しない。
  - 既存の `comments` ドキュメントに手を入れないので、通常コメント側とインラインコメント側の既存の仕組み（スキーマ、Prisma 拡張、検索インデックス更新）に影響しない。
  - ブックマーク（`bookmarks`）と同じ形で、リポジトリ内に前例がある。

**不採用の案**

- **コメントドキュメントに埋め込む（`comments.reactions: [{ emoji, userIds[] }]`）**: 取得は簡単になる。しかし、配列の中の配列を更新する際の一意性を保証しにくく、同時トグルで競合する。Mongoose スキーマと Prisma の両方に変更が入り、通常コメントとインラインコメント両方の既存処理に影響が広がる。ページの `liker` 配列は単一の真偽値なので埋め込みで成り立っているが、絵文字ごとの集合はその延長では扱いにくい。
- **ページの「いいね」を絵文字の種類だけ増やす（`liker` 方式の一般化）**: 種類が自由に増える絵文字には合わない。カスタム絵文字に拡張することもできない。

## Scope

- **In**:
  - 通常コメント（ページ末尾のスレッド。返信も含む）への標準絵文字リアクションの追加と解除
  - 絵文字ごとにまとめた表示（チップ＋人数）、自分のリアクションの強調表示、リアクションしたユーザーの確認（ツールチップかポップオーバーかは設計で決める）
  - 「＋」から開く絵文字ピッカーによる新しい絵文字の追加
  - ゲスト（ゲスト閲覧が許可されている Wiki）と共有リンク閲覧者への読み取り専用表示。共有リンク閲覧者への表示は通常コメントに限る（Out of Boundary を参照）
  - コメント・ページの削除に伴うリアクションの連鎖削除
  - 将来のカスタム絵文字を受け入れられる絵文字キーの設計（受け入れられる形にすることがスコープで、カスタム絵文字の実装は Out）
- **インラインコメントへの適用（設計フェーズで最終判断）**: `CommentCard` と `commentId` を共有しているので、低コストで対象にできる見込みがある。対象にする場合は、Out of Boundary に書いた共有リンク経由の露出対策が必須になる。
- **Out**:
  - Slack ワークスペースのカスタム絵文字の取得・同期・表示（将来の別スペック）
  - GROWI 独自のカスタム絵文字のアップロード・管理
  - **ページ**へのリアクション（Discussion #11137 では要望されているが、今回は対象外。ページの「いいね」とどう関係づけるかを含めて別スペックで検討する）
  - リアクションのリアルタイム反映（コメント自体にも socket.io イベントが無いので、それに合わせる）
  - Slack 側のリアクションとの双方向同期

## Boundary Candidates

- **データモデルと永続化**: 新しいコレクションと Prisma モデル、一意インデックス、名前空間付き絵文字キーの型定義（`@growi/core` に置くかは設計で決める）
- **サーバー API と認可**: リアクションの追加・解除と、ページ単位の一括取得。`comments.get` のレスポンスに含めるか、別エンドポイントにするかは設計で決める。後から作る API は apiv3 が基本になる
- **絵文字ピッカーの再利用**: `packages/editor` の `EmojiButton`（内部コンポーネント）から、エディタに依存しない遅延ロードのピッカー部品を切り出して公開するか、apps/app 側に新しく作るか
- **リアクションバー UI**: チップ、人数、自分のリアクションの強調、ユーザー一覧、「＋」ボタン。`CommentCard` の slot（既存の `footer` か新しい slot）に差し込む想定
- **連鎖削除と Activity 記録**: 削除経路への後始末の追加と、監査ログ・通知の扱い

## Out of Boundary

- **共有リンク経由でのインラインコメント情報の露出。** インラインコメントにもリアクションを付ける場合、`certifySharedPage` を通る読み取り経路（例: `comments.get` に含める案）で `isInline` コメントのリアクションを返してはならない。返すと、共有リンク閲覧者にインラインコメントの存在と ID が漏れる。[inline-comment](../inline-comment/) がスコープ内と定めた露出対策を崩さないことは、本スペックの**必須要件**とする。
- コメント本文、編集・削除、メンションの仕様変更。既存のまま変えない。
- エディタ本体の絵文字入力（ツールバーの EmojiButton、`:` からの自動補完）の挙動変更。ピッカー部品の切り出しに伴うリファクタリングはあり得るが、エディタ側の挙動は変えない。
- カスタム絵文字の配信基盤（画像のプロキシ・キャッシュなど）。

## Upstream / Downstream

- **Upstream**:
  - `comments` コレクション（Prisma `model comments`）と `features/comment` の Prisma 拡張
  - legacy apiv1 のコメント API（`apps/app/src/server/routes/comment.js`）とミドルウェア（`certifySharedPage`、`loginRequired` / `loginRequiredStrictly`、`excludeReadOnlyUserIfCommentNotAllowed`）
  - `@growi/emoji-mart-data`（ショートコードからネイティブ絵文字への変換。本文レンダラーと共有）、`packages/editor` の emoji-mart 依存
  - `CommentCard` を含む `PageComment/` の共通コンポーネント群
  - Activity・監査ログの仕組み（`apps/app/src/interfaces/activity.ts`、`apps/app/.claude/rules/activity-recording.md`）
  - GROWI 間移行・インポートの仕組み（`apps/app/src/server/service/import/`。新しいコレクションの登録先）
- **Downstream**:
  - Slack カスタム絵文字対応（将来の別スペック。本スペックの名前空間付き絵文字キーを前提にする）
  - ページへのリアクション（将来の別スペック。モデルを共通化するかはそのときに判断する）
  - コメントのリアルタイム更新（将来入れる場合は、リアクションもその対象になる）

## Existing Spec Touchpoints

- **Extends**: なし（新規スペック）。既存スペックの契約を変えない純粋な追加なので、`.claude/rules/spec-lifecycle.md` の amend spec には**当たらない**。
- **Adjacent**:
  - [inline-comment](../inline-comment/): 同じ `comments` コレクションと `CommentCard` を共有している。インラインコメントを対象にする場合は、削除経路（origin・返信の DELETE）への連鎖削除の追加と、共有リンク経由の露出防止で関わる。
  - [share-link-comments](../share-link-comments/): 共有リンク閲覧者はコメントを読み取り専用で見られる、という前提。リアクションも読み取り専用で見せ、追加・解除は禁止する。
  - [comment-mention](../comment-mention/): コメントエディタの絵文字自動補完（`emojiCompletionSource`）。関心は重ならないが、絵文字のデータソースは揃える。
  - [activity-log](../activity-log/): 新しい Activity アクションを足す場合の記録方針。

## Constraints

- **認可**
  - 追加・解除には `loginRequiredStrictly` と `excludeReadOnlyUserIfCommentNotAllowed` に加え、**対象コメントのページを閲覧できるか**の確認が要る。認証だけでは、閲覧権限の無いページのコメント ID を指定されたときにリアクションを付けられてしまう。
  - ゲストと共有リンク閲覧者は読み取り専用とする。
- **インデックス作成**: Prisma（MongoDB プロバイダ）は一意インデックスを自動では作らない。新しいコレクションの `(commentId, userId, emoji)` 一意インデックスと `pageId` インデックスを何で作るかは、`.claude/rules/model.md` の移行ルールに従って設計で決める。`bookmarks` の一意インデックスがどう作られているかを前例として確認すること。
- **連鎖削除の経路**: 次の経路すべてでリアクションも消す必要がある。
  - `removeWithReplies`（通常コメントとその返信の削除）
  - インラインコメントの origin 削除と返信削除（対象に含める場合）
  - `apps/app/src/server/service/page/delete-completely-operation.ts`（ページの完全削除）
- **追加・解除の API の形**: 「押すたびに反転する」トグル API にはせず、クライアントが「追加」か「解除」かを明示して送る形にする（ページの「いいね」の `PUT /_api/v3/page/likes` が `{ pageId, bool }` を受け取るのと同じ考え方）。
  - コメントにはリアルタイム更新が無いので、画面の状態が古いまま操作されることがある。たとえば別タブで既に 👍 を付けている状態で古い画面から 👍 を押すと、反転型では本人の意図（追加）に反して解除になってしまう。
  - 明示型なら、既に付いているものへの「追加」や、付いていないものへの「解除」は何もせずに成功扱いにでき、何度送っても結果が変わらない。
- **GROWI 間移行（G2G）・インポートへの対応**: 新しいコレクションを足すと、移行・インポートの仕組みにも申告が要る。
  - `apps/app/src/server/service/import/non-transferable-collections.ts` の `TRANSFERABLE_COLLECTIONS`（移行で運ぶ）と `NON_TRANSFERABLE_COLLECTIONS`（運ばない）の**どちらかに必ず登録する**。どちらにも無いコレクションは drift test（`non-transferable-collections.integ.ts`）で失敗する。
  - どちらに入れるかは設計で決める（メンター確認事項）。同ファイルの基準では、リアクションは環境固有の運用状態ではなくコンテンツなので、`TRANSFERABLE_COLLECTIONS` が有力。
  - 運ぶ場合は、インポート時に `commentId`・`pageId`・`userId` が移行先の ID と正しく対応するか（`construct-convert-map.ts` 周辺）を確認する。
  - `(commentId, userId, emoji)` の一意制約を持つので、インポート時の一意制約衝突検出（`detect-unique-conflicts.ts` と、その drift test `detect-unique-conflicts.drift.spec.ts`）の対象に加える必要があるかも確認する。
- **絵文字キー**
  - 標準絵文字は `@growi/emoji-mart-data` に存在するショートコードだけを受け付け、サーバー側で検証する（任意の文字列を保存させない）。
  - カスタム絵文字を足しても衝突しない名前空間を持たせる。
  - 肌の色（skin tone）の違いを別の絵文字として扱うか、まとめるかは設計で決める（未決）。
- **設計で決める事項**
  - 1コメントあたりに付けられる絵文字の種類数、1ユーザーあたりのリアクション数の上限を設けるか。
  - Activity・監査ログ: `COMMENT_REACTION_ADD` / `_REMOVE` のような名前にすれば、監査ログの既存のコメントカテゴリ（`COMMENT_` 接頭辞の正規表現）に自動で入る。どのアクションサイズのグループに入れるかは設計で決める。
  - **コメント投稿者への通知**: ページの「いいね」（`PAGE_LIKE`）は通知しているが、リアクションは頻度が高いので通知しないことも考えられる。
- **ピッカーのバンドルサイズ**: emoji-mart はデータが大きいので、エディタと同じく遅延ロードにして、ページ閲覧時の初回ロードを増やさない。
- **i18n**: UI 文言（ツールチップ、「＋」ボタンのラベル、ユーザー一覧など）は既存の i18n の仕組みに乗せる。
