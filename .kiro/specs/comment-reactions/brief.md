# Brief: comment-reactions

## Problem

ページのコメントに対して「いいね」「確認しました」「ありがとう」のような軽い意思表示をしたいとき、今は返信コメントを書くしかない。手間がかかるうえ、スレッドが短い相づちで埋まって本来の議論が読みにくくなる。Slack のメッセージリアクションに慣れた利用者からは、同じ感覚で絵文字を付けたいという要望がある。

- GitHub Discussion #11137「スタンプリアクション（Slack 互換）」（2026-05-14 起票、メンテナー返信なし）。要望の対象は**ページとコメントの両方**。
- Redmine ストーリー #191055。

本スペックでは、このうち**コメントへのリアクション**だけを扱う（ページへのリアクションは Scope の Out を参照）。

## Current State

- **リアクション・スタンプに相当する機能はコードにも spec にも存在しない。** `.kiro/specs/` と `apps/`・`packages/` を検索して確認した。
- **コメントの保存先**: 通常コメントもインラインコメントも、同じ `comments` コレクションに入っている（Prisma `model comments`: `apps/app/prisma/schema.prisma`。インラインコメントは `isInline: true` で区別）。legacy の Mongoose スキーマ（`apps/app/src/features/comment/server/models/comment.ts`）は、コレクションとインデックスを作るためだけに残っている（`.claude/rules/model.md`）。
- **コメント取得 API**（取得と件数の契約は [comment](../comment/) スペックが持つ）
  - apiv3 の `GET /_api/v3/comments`（`apps/app/src/features/comment/server/routes/list.ts`）が、ページの**通常コメントとインラインコメントの両方**を、返信も含めて1つの平らな一覧で返す。両者は `isInline` で区別する。
    - `certifySharedPage` → `loginRequired` を通り、ページ閲覧権限（または有効な共有リンク）を確認してから返す。ゲスト閲覧が許可されている Wiki のゲストも読める。
    - **共有リンク閲覧者にも、インラインコメントを含めて読み取り専用で返す**（comment 要件 3.3）。ただし、共有リンクの画面と検索結果のプレビューでは、インラインコメントの UI を出さない（comment 要件 6.5、inline-comment 要件 6）。つまり「API では返すが、画面には出さない」という方針。
    - 投稿者の情報は、ID・ユーザー名・表示名・プロフィール画像 URL の4項目に絞って返す。共有リンク経由でも同じ（comment 要件 1.9）。
  - legacy apiv1 の `GET /_api/comments.get` は**非推奨**。外部の利用者のために挙動を変えずに残している（インラインコメントは返さない。comment 要件 5）。GROWI 自身の画面からは呼ばない。
  - インラインコメント専用の一覧取得（`GET /_api/v3/inline-comments`）は廃止済みで、404 を返す。
  - 書き込み系は従来どおり。通常コメントは apiv1 の `comments.add`/`update`/`remove`（`loginRequiredStrictly` と `excludeReadOnlyUserIfCommentNotAllowed`）、インラインコメントは apiv3 の `/_api/v3/inline-comments` 配下の作成・返信・編集・削除・解決。
- **クライアント**: 画面（ページ末尾のコメント欄、本文のインラインコメント、共有リンクの画面、検索結果のプレビュー）は、共通の取得フック `useSWRxCommentList`（`apps/app/src/features/comment/client/stores/comment-list.ts`、SWR キー `['/comments', pageId, shareLinkId]`）を通して `GET /_api/v3/comments` から取得する。ページ末尾のコメント欄は `Comments.tsx` → `PageComment.tsx` → `PageComment/Comment.tsx` の順に描画する。共通の外枠 `PageComment/CommentCard/CommentCard.tsx`（slot: `headerEnd` / `beforeBody` / `children` / `footer`）は、インラインコメント側（`InlineCommentItem.tsx`、`InlineCommentReplies.tsx`、`InlineCommentPopoverEntry.tsx`）でも使われている。
- **リアルタイム更新**: コメントには socket.io のイベントが無い。表示が更新されるのは、自分の操作の後に SWR の `mutate()` を呼んだときと、再検証が走ったときだけ。
- **ユーザーごとのトグルとして参考にできる既存実装**
  - ページの「いいね」: `pages.liker` に userId の配列を持つ。トグルは `PUT /_api/v3/page/likes`（`ACTION_PAGE_LIKE`/`UNLIKE` の Activity と通知を伴う）。UI は `LikeButtons.tsx`（件数ボタンからポップオーバーで `UserPictureList` を開く）。
  - ブックマーク: 別コレクション `bookmarks` に `@@unique([pageId, userId])` を張った正規化モデル。
- **絵文字の基盤**
  - ピッカー: `packages/editor` が `emoji-mart` / `@emoji-mart/react` / `@emoji-mart/data` に依存している。エディタツールバーの `EmojiButton.tsx`（`components-internal`、遅延ロード、reactstrap `Modal`）がこれを使っている。エディタ専用の内部コンポーネントで、外部には公開されていない。
  - 表示: Markdown 中の `:shortcode:` は、独自の remark プラグイン（`apps/app/src/services/renderer/remark-plugins/emoji.ts`）がワークスペースパッケージ `@growi/emoji-mart-data` の対応表を引いてネイティブ絵文字に変換している。この対応表は各絵文字の**既定の肌の色（`skins[0]`）だけ**を持ち、肌の色違いのグリフは持たない（`packages/emoji-mart-data/bin/extract.ts`）。元データの `@emoji-mart/data` は肌の色に対応する絵文字について6種類（既定＋5段階）のグリフを持ち、別名（例: `thumbsup` → `+1`）の対応表もある。
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
- **肌の色（skin tone）は Slack に準拠する。** 標準絵文字の名前部分は、Slack のリアクション名と同じ「ショートコード＋任意の `::skin-tone-N`（N は 2〜6）」の形式とする（例: `+1`、`+1::skin-tone-3`）。肌の色ごとに別のリアクションとして数える。詳細は Constraints の「肌の色（skin tone）の扱い」を参照。
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
  - Slack 準拠の肌の色（`::skin-tone-2`〜`6`）付きリアクション（Constraints の「肌の色（skin tone）の扱い」を参照）
  - ゲスト（ゲスト閲覧が許可されている Wiki）と共有リンク閲覧者への読み取り専用表示。リアクションを返す範囲は、コメント一覧 API がそのコメントを返す範囲に合わせる。画面に出す範囲は、コメント本体の UI を出す範囲に合わせる（Out of Boundary を参照）
  - コメント・ページの削除に伴うリアクションの連鎖削除
  - **リアクションの追加・解除の Activity（監査ログ）への記録**。新しい Activity アクション（例: `COMMENT_REACTION_ADD` / `COMMENT_REACTION_REMOVE`）を定義し、追加・解除のたびに記録する。監査ログの絞り込みと表示で既存のコメント系アクションと同じように扱えること、`apps/app/.claude/rules/activity-recording.md` の記録順序の規約に従うことを含む。アクション名、アクションサイズのグループ、「最近のアクティビティ」・コントリビューショングラフに出すかどうかは設計で決める
  - **GROWI 間移行（G2G）・インポートへの対応**。リアクションのコレクションは**移行対象（`TRANSFERABLE_COLLECTIONS`）**とし、移行先でコメント・ページ・ユーザーとの対応が保たれるようにする（Constraints の「GROWI 間移行（G2G）・インポートへの対応」を参照）
  - 将来のカスタム絵文字を受け入れられる絵文字キーの設計（受け入れられる形にすることがスコープで、カスタム絵文字の実装は Out）
- **インラインコメントへの適用（設計フェーズで最終判断）**: `CommentCard` と `commentId` を共有し、コメント一覧 API も両者を1本で返すので、低コストで対象にできる見込みがある。共有リンク閲覧者には API がインラインコメント自体を返しているため、そのリアクションを返しても新たな情報露出にはならない。対象にする場合に要るのは、インラインコメントの削除経路への連鎖削除の追加と、共有リンクの画面でインラインコメントのリアクション UI を出さないこと。
- **Out**:
  - Slack ワークスペースのカスタム絵文字の取得・同期・表示（将来の別スペック）
  - GROWI 独自のカスタム絵文字のアップロード・管理
  - **ページ**へのリアクション（Discussion #11137 では要望されているが、今回は対象外。ページの「いいね」とどう関係づけるかを含めて別スペックで検討する）
  - リアクションのリアルタイム反映（コメント自体にも socket.io イベントが無いので、それに合わせる）
  - Slack 側のリアクションとの双方向同期
  - 複数人の絵文字（🤝 など）で人ごとに異なる肌の色を付けること。Slack でのリアクション名の表現を一次情報で確認できなかったため、v1 は単一の `::skin-tone-N` だけを扱う
  - ユーザーごとの「既定の肌の色」設定（Slack にはある）。v1 ではピッカーでその都度選ぶ

## Boundary Candidates

- **データモデルと永続化**: 新しいコレクションと Prisma モデル、一意インデックス、名前空間付き絵文字キーの型定義（`@growi/core` に置くかは設計で決める）
- **サーバー API と認可**: リアクションの追加・解除と、ページ単位の一括取得（いずれも apiv3）。読み取りの経路は次のどちらかを設計で決める。非推奨の `comments.get` には載せない（comment 要件 5.1 で挙動を変えないと決まっている）。
  - (a) `GET /_api/v3/comments` の各コメントにリアクションの集計を含める: 取得が1回で済む。一方で [comment](../comment/) スペックが持つ応答の契約（要件 1、4）を変えることになるので、その部分を comment スペックに書き戻す作業が要る（Existing Spec Touchpoints を参照）。
  - (b) リアクション専用の一括取得エンドポイントを新設する: comment スペックの契約に触れない。一方で、認可（`certifySharedPage`・ページ閲覧権限・共有リンクの扱い）をコメント一覧 API と揃える必要があり、取得は2回になる。認可は `list.ts` と同じ標準ミドルウェアを再利用し、並行実装しない。
- **絵文字ピッカーの再利用**: `packages/editor` の `EmojiButton`（内部コンポーネント）から、エディタに依存しない遅延ロードのピッカー部品を切り出して公開するか、apps/app 側に新しく作るか
- **リアクションバー UI**: チップ、人数、自分のリアクションの強調、ユーザー一覧、「＋」ボタン。`CommentCard` の slot（既存の `footer` か新しい slot）に差し込む想定
- **連鎖削除と Activity 記録**: 削除経路への後始末の追加、リアクションの Activity アクションの定義と記録、通知の扱い
- **G2G 移行・インポートへの登録**: 移行対象コレクションとしての登録、ID の付け替え、一意制約衝突検出への対応

## Out of Boundary

- **共有リンク経由で何を返すかの方針。** 共有リンク閲覧者にどのコメントを返すかは [comment](../comment/) スペックが決めており（要件 3.3: インラインコメントも含めて読み取り専用で返す）、本スペックはそれを変えない。本スペックが守るのは次の2点で、どちらも**必須要件**とする。
  - リアクションの読み取りは、**そのコメントをコメント一覧 API で取得できる相手にだけ**返す。コメント一覧 API の認可より広くも狭くもしない。
  - 共有リンクの画面と検索結果のプレビューでは、インラインコメントのリアクション UI を出さない（インラインコメント自体を出さない方針（comment 要件 6.5）に合わせる）。
  - なお、リアクションしたユーザーの情報は、コメントの投稿者と同じく4項目（ID・ユーザー名・表示名・プロフィール画像 URL）に絞る（comment 要件 1.9 に揃える）。
- コメント本文、編集・削除、メンションの仕様変更。既存のまま変えない。
- エディタ本体の絵文字入力（ツールバーの EmojiButton、`:` からの自動補完）の挙動変更。ピッカー部品の切り出しに伴うリファクタリングはあり得るが、エディタ側の挙動は変えない。
- カスタム絵文字の配信基盤（画像のプロキシ・キャッシュなど）。

## Upstream / Downstream

- **Upstream**:
  - `comments` コレクション（Prisma `model comments`）と `features/comment` の Prisma 拡張
  - コメント一覧 API（`GET /_api/v3/comments`、`apps/app/src/features/comment/server/routes/list.ts`）と取得フック `useSWRxCommentList`。リアクションの読み取りの認可と、取得のタイミングをここに揃える
  - ミドルウェア（`certifySharedPage`、`loginRequired` / `loginRequiredStrictly`、`excludeReadOnlyUserIfCommentNotAllowed`、`accessTokenParser`）
  - `@growi/emoji-mart-data`（ショートコードからネイティブ絵文字への変換。本文レンダラーと共有）、`packages/editor` の emoji-mart 依存（`@emoji-mart/data` の肌の色違いのグリフと別名の対応表）
  - `CommentCard` を含む `PageComment/` の共通コンポーネント群
  - Activity・監査ログの仕組み（`apps/app/src/interfaces/activity.ts`、`apps/app/.claude/rules/activity-recording.md`）
  - GROWI 間移行・インポートの仕組み（`apps/app/src/server/service/import/`。新しいコレクションの登録先）
- **Downstream**:
  - Slack カスタム絵文字対応（将来の別スペック。本スペックの名前空間付き絵文字キーを前提にする）
  - ページへのリアクション（将来の別スペック。モデルを共通化するかはそのときに判断する）
  - コメントのリアルタイム更新（将来入れる場合は、リアクションもその対象になる）

## Existing Spec Touchpoints

- **Extends**: 原則なし（新規スペック）。ただし、読み取りの経路で (a)（`GET /_api/v3/comments` の応答にリアクションを含める）を選んだ場合は、[comment](../comment/) スペック（実装完了済みで、取得と件数の契約を持ち続ける永続的なスペック）の応答の契約を変えることになる。その場合は、`.claude/rules/spec-lifecycle.md` に従い、応答の変更分を comment スペックの requirements.md / design.md に書き戻す作業を本スペックのタスクに含める。本スペック自体はリアクション機能の持ち主として残るので、自分を削除する amend spec ではない。(b) を選んだ場合は既存スペックの契約に触れず、amend の扱いは要らない。
- **Adjacent**:
  - [comment](../comment/): コメントの取得と件数の契約を持つ。リアクションの読み取りの認可、共有リンク経由で返す範囲、ユーザー情報の絞り込み（要件 1.9）をここに揃える。リアクションはコメント件数には数えない。
  - [inline-comment](../inline-comment/): 同じ `comments` コレクションと `CommentCard` を共有している。インラインコメントを対象にする場合は、削除経路（origin・返信の DELETE）への連鎖削除の追加と、共有リンクの画面でリアクション UI を出さないことで関わる。
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
- **GROWI 間移行（G2G）・インポートへの対応**: リアクションのコレクションは**移行対象**とする（決定済み）。リアクションは環境固有の運用状態ではなくコンテンツなので、`non-transferable-collections.ts` の基準にも合う。
  - `apps/app/src/server/service/import/non-transferable-collections.ts` の `TRANSFERABLE_COLLECTIONS` に登録する。どちらの一覧にも無いコレクションは drift test（`non-transferable-collections.integ.ts`）で失敗する。
  - インポート時に `commentId`・`pageId`・`userId` が移行先の ID と正しく対応するか（`construct-convert-map.ts` 周辺）を確認する。
  - `(commentId, userId, emoji)` の一意制約を持つので、インポート時の一意制約衝突検出（`detect-unique-conflicts.ts` と、その drift test `detect-unique-conflicts.drift.spec.ts`）の対象に加える必要があるかも確認する。
- **絵文字キー**
  - 標準絵文字は `@growi/emoji-mart-data` に存在するショートコードだけを受け付け、サーバー側で検証する（任意の文字列を保存させない）。
  - カスタム絵文字を足しても衝突しない名前空間を持たせる。
  - 別名は正規のショートコードにそろえて保存する（例: `thumbsup` → `+1`）。Slack も `+1` / `thumbsup` を同じ絵文字として扱い、リアクション名は `+1` で返すと報告されている。同じ絵文字が別名で別のチップに分かれないようにするため。emoji-mart のショートコードが Slack（iamcal/emoji-data の `short_name`）とどこまで一致するかは設計で確認する。
- **肌の色（skin tone）の扱い（Slack 準拠）**: Slack のリアクションでの扱いを調べた結果に合わせる。
  - **キーの形式**: Slack の `reactions.add` は、肌の色の修飾子に対応する Unicode 絵文字について、名前の後ろに `::skin-tone-` と 2〜6 の数字を付けた名前（例: `thumbsup::skin-tone-6`、`wave::skin-tone-3`）を受け付ける（[reactions.add](https://docs.slack.dev/reference/methods/reactions.add)）。本スペックの標準絵文字の名前部分もこの形式とし、Slack のリアクション名と1対1で対応させる。
  - **`skin-tone-1` は無い**: Unicode は Fitzpatrick の1型と2型を1つの修飾子（U+1F3FB）にまとめており、Slack は `skin-tone-2`（U+1F3FB）〜`skin-tone-6`（U+1F3FF）を使う。修飾子の無い名前（例: `+1`）が既定（黄色）の絵文字にあたる。
  - **肌の色ごとに別のリアクションとして数える**: Slack API のリアクションは `name` だけで区別される（`{ name, count, users }`）。肌の色も `name` に含まれるので、`+1` と `+1::skin-tone-3` は別の項目になり、人数も別々に数える。本スペックも同じく、肌の色ごとに別のチップとして表示する。
    - 同じ人が既定の 👍 と肌の色付きの 👍🏽 を両方付けることも許す。Slack の `already_reacted` エラーは「ユーザーとリアクションの組み合わせ」が既にある場合に返るので、肌の色まで含めた名前で判定していると考えられる（推測）。本スペックの一意制約 `(commentId, userId, emoji)` も、肌の色まで含めたキーで判定する。
    - Slack の画面が肌の色違いを1つのチップにまとめて表示しているかどうかは、一次情報で確認できなかった。本スペックは API の扱いに合わせ、別々のチップとする。
  - **既存のチップを押したとき**: 他の人が付けた 👍🏽 のチップを押すと、自分にも**同じ肌の色**の 👍🏽 が付く（チップはキーで区別されるため）。Slack の画面での挙動は一次情報で確認できていない。
  - **肌の色を付けられる絵文字**: 絵文字データに肌の色違いがある Unicode 絵文字だけ。それ以外の絵文字に `::skin-tone-N` が付いたキーは、サーバー側の検証で拒否する。カスタム絵文字は肌の色を持たない（Slack の `emoji.list` も肌の色の情報を返さない）。
  - **絵文字データの不足（サーバー・クライアントの両方に影響）**: `@growi/emoji-mart-data` の対応表は、ショートコードから既定の肌の色のグリフを引けるだけで、肌の色違いのグリフも、どの絵文字が肌の色に対応しているかの情報も、別名の対応表も持たない。そのため、今のままでは次の3つができない。
    - 肌の色付きのリアクションの表示（クライアント）
    - 「肌の色に対応した絵文字にだけ `::skin-tone-N` を許す」検証（サーバー）
    - 別名を正規のショートコードにそろえる処理（サーバー）
    - 対応表を広げるか、`@emoji-mart/data` から引く必要がある。`@emoji-mart/data` の `skins` は、`skins[0]` が既定で、`skins[1]`〜`skins[5]` が U+1F3FB〜U+1F3FF（= `skin-tone-2`〜`6`）にあたる（例: `+1` は `1f44d`、`1f44d-1f3fb` … `1f44d-1f3ff`）。どちらにするか（バンドルサイズへの影響を含む）は設計で決める。
- **設計で決める事項**
  - 1コメントあたりに付けられる絵文字の種類数、1ユーザーあたりのリアクション数の上限を設けるか。
  - Activity・監査ログの詳細: `COMMENT_REACTION_ADD` / `_REMOVE` のような名前にすれば、監査ログの既存のコメントカテゴリ（`COMMENT_` 接頭辞の正規表現）に自動で入る。アクションサイズのグループ（リアクションは頻度が高いので、監査ログの詳細度設定との兼ね合い）と、「最近のアクティビティ」に出すかどうか。記録すること自体は Scope の In で決定済み。
  - **コメント投稿者への通知**: ページの「いいね」（`PAGE_LIKE`）は通知しているが、リアクションは頻度が高いので通知しないことも考えられる。
- **ピッカーのバンドルサイズ**: emoji-mart はデータが大きいので、エディタと同じく遅延ロードにして、ページ閲覧時の初回ロードを増やさない。
- **i18n**: UI 文言（ツールチップ、「＋」ボタンのラベル、ユーザー一覧など）は既存の i18n の仕組みに乗せる。
