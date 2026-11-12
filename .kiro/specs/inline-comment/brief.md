# Brief: inline-comment

## Problem

閲覧者・編集者は、ページ本文の**特定の範囲**に対してコメントを付けたい。ページ末尾に積む1本のスレッド（通常コメント）だけでは、本文のどの部分について話しているのかが分からなくなる。

## Desired Outcome

- 閲覧者が本文中の任意のテキスト範囲を選び、その場でコメントを作成できる。
- 作成したインラインコメントは、選んだテキスト範囲のハイライトと、ページ下部のコメント一覧の両方に表示される。
- 対象範囲がのちの本文編集で変わっても、可能な範囲でコメントの位置を探し直す（ベストエフォート）。見つからなければ、コメント自体は残り、本文中のハイライトだけが消える。
- 起点コメントに返信でき、投稿者本人は起点コメントと返信を編集・削除できる。起点コメントは解決済み／未解決を切り替えられ、解決済みのコメントは本文中にハイライトを出さない。

## Approach

**レンダリング後のテキストに対する「選択文字列＋前後の文脈＋おおよその位置」で位置を持つ（ベストエフォートで探し直す）**

- コメント作成時に保存する位置情報は、markdown ソースの文字オフセットでも DOM の XPath でもなく、レンダリングされたページのプレーンテキストに対する「選択文字列（`quote`。正規化せず、選ばれたままの原文）＋前後の文脈（`prefix` / `suffix`）＋テキスト全体の中でのおおよその位置（`approxOffset`）」である。W3C Web Annotation Data Model の TextQuoteSelector / TextPositionSelector にあたる。
- 表示するときは、その時点でレンダリングされている本文のテキストから選択文字列を探す。完全一致が無ければ NFC 正規化したうえであいまい一致（`approx-string-match`）を試す。同じ文字列が複数見つかったときは、`approxOffset` に最も近いものを選ぶ。前後の文脈は保存するが、探すときには使わない（理由は `research.md`）。見つからなければハイライトを出さず、コメントは一覧に残す。
- アンカーを作ったときの版は、`Comment.revisionId` とは別の `anchorOriginRevisionId` に、作成時に一度だけ記録する。位置を探し直しても書き換えない。
- この方式を選んだ理由:
  - markdown ソースの文字オフセットで持つと、`**太字**` や `[リンク](url)` をまたぐ選択で、レンダリング後のテキストとソースの文字列が一致しない（記法そのものが選択範囲に入ってしまう）。
  - 版の本文に注釈を埋め込んで持つ方式（`Revision.markedBody` のような別フィールド）は、本文が変わるたびにサーバー側で計算し直して保持する手間がかかる一方、クライアント側で探し直さずに済むという利点は小さい。
  - ブロック単位でソースの行番号を DOM に埋める `data-line` 機構（`add-line-number-attribute.ts`）は、プレビューとスクロール同期（`generatePresentationViewOptions` / `generatePreviewOptions`）でだけ使われ、通常の読み取りビュー（`generateViewOptions`）には入っていない。文字単位まで広げるには、読み取りのレンダリング全体と sanitize の前段を変える必要があり、段落の移動にはどのみちあいまい一致が要る。

## Scope

- **In**:
  - 本文中のテキスト範囲を選んで、インラインコメントを作成する
  - インラインコメントを閲覧する（本文中のハイライト、本文上のポップオーバー、ページ下部の一覧）
  - 起点コメントへの返信
  - 投稿者本人による起点コメント・返信の編集と削除（権限の判定は通常コメントと同じ）
  - 解決済み／未解決の切り替え
  - `@メンション`（[comment-mention](../comment-mention/) のハイライトと通知の経路を、インラインコメントの本文にもそのまま使う）
- **Out**:
  - 共有リンク画面でのインラインコメントの表示・作成

## Out of Boundary

- **エディタ（Yjs の共同編集セッション）の中でのインラインコメントの作成・表示。** インラインコメントは、読み取り専用のレンダリング済みページビュー（`PageView.tsx` → `RevisionRenderer.tsx` → react-markdown）に付ける。CodeMirror / Yjs のドキュメントモデル、カーソル、awareness には触れない。
- **共有リンク画面でのインラインコメントの表示・作成。** 共有リンク画面にインラインコメントの UI を出さないことは本スペックの範囲に含める。共有リンク経由の API が何を返すか（インラインコメントも読み取り専用で返す）は [comment](../comment/) スペックが定める。
- **コメントの取得と件数。** コメント一覧 API（`GET /_api/v3/comments`）、画面側の取得、ページのコメント件数は [comment](../comment/) スペックが持つ。
- **通常コメント（ページ末尾のスレッド）の作成・編集・削除・通知の仕様。**
- **`@メンション` 機能そのものの追加要件**（自動補完の仕組みなど）。[comment-mention](../comment-mention/) の実装を使うだけ。

## Upstream / Downstream

- **Upstream**:
  - `Comment`（Prisma の `comments` モデル、`apps/app/prisma/schema.prisma`）。コレクションとインデックスを作るための Mongoose スキーマ（`apps/app/src/features/comment/server/models/comment.ts`）も残っている
  - ページのレンダリング（`RevisionRenderer.tsx`、react-markdown、rehype プラグイン群）
  - [comment](../comment/) のコメント一覧 API と取得フック（`useSWRxCommentList`）
  - [comment-mention](../comment-mention/) のメンションのハイライトと通知の経路（使うだけ）
- **Downstream**:
  - 「エディタ内でのインラインコメント表示」（必要になれば新しいスペックで扱う）

## Existing Spec Touchpoints

- **Adjacent**:
  - [comment](../comment/) — コメントの取得と件数の契約の持ち主。
  - [comment-mention](../comment-mention/) — メンションのハイライトと通知の依存先。
  - [share-link-comments](../share-link-comments/) — 共有リンク閲覧時のコメントのアクセス制御（`certify-shared-page.js`・`isSharedPage`）。本スペックは、共有リンク画面にインラインコメントの UI を出さないという形でだけ関わる。
  - [collaborative-editor](../collaborative-editor/) / [collaborative-editor-awareness](../collaborative-editor-awareness/) — Yjs の共同編集。本スペックは意図して依存しない。

## Constraints

- アンカーの精度は**文字単位**（ブロック・行単位では足りない）。
- 対象範囲が共同編集で書き換わったときは**ベストエフォート**（追従できなければハイライトが外れるだけでよい。リアルタイムの追従はしない）。
- あいまい一致は、NFC 正規化した文字列どうしで比べ、単語の区切りや空白でのトークン化を前提にしない（CJK には単語の区切りが無いため）。一致した位置は正規化後の文字列上の位置なので、原文上の位置へ変換し直す（`normalized-offset-mapping.ts`）。
- 前後の文脈の窓（`prefix` / `suffix`）は、書記素クラスタの境界（`Intl.Segmenter` の `granularity: 'grapheme'`）に内側へ寄せた固定長にする。結合文字や ZWJ の絵文字の並びを途中で切らないため。
- アンカーのフィールド（`isInline`、`quote`、`prefix`、`suffix`、`approxOffset`、`anchorOriginRevisionId`、`resolvedById`、`resolvedAt`）は、Mongoose スキーマと `prisma/schema.prisma` の**両方**にある。フィールドを足すときは両方をそろえる（`.claude/rules/model.md`）。
- 既存の `commentPosition`（常に `-1`）は位置情報に使わない。
