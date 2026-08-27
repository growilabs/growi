# Implementation Plan

- [ ] 1. データモデル基盤：既存commentsモデルの拡張と読み取り経路の隔離
- [x] 1.1 `comments` Prismaモデルにインラインコメント用フィールドを追加する
  - `isInline`（Boolean, default false）、`quote`/`prefix`/`suffix`/`approxOffset`（すべて任意）、`anchorOriginRevisionId`（任意, ObjectId）、`resolvedById`（任意, ObjectId）、`resolvedAt`（任意, DateTime）を `comments` モデルに追加する
  - 既存の無名だった `creator` リレーションに `@relation("CommentCreator", ...)` と明示的な名前を付け、新設する `resolvedBy` リレーション（`@relation("InlineCommentResolver", ...)`）と区別できるようにする。`users` モデル側の `comments` フィールドにも同じリレーション名を付け、`resolvedInlineComments comments[] @relation("InlineCommentResolver")` を追加する
  - `@@index([pageId, isInline])` を追加する
  - 観測できる完了条件：`prisma validate`（または `pnpm run app:build` に含まれるPrisma検証ステップ）が新しいリレーション名・フィールド定義でエラーなく通る
  - _Requirements: 1.2, 1.4, 4.1, 4.5, 5.4, 5.5_

- [x] 1.2 `comments` Mongooseスキーマを同じ形に同期させる
  - `apps/app/src/features/comment/server/models/comment.ts` に1.1と同じフィールド（`isInline`/アンカー4項目/`anchorOriginRevisionId`/`resolvedById`/`resolvedAt`）を追加する
  - `@@index([pageId, isInline])` に対応するインデックスをMongooseスキーマ側で宣言する（`.claude/rules/model.md` の通り、インデックス作成は引き続きMongooseが担う）
  - 観測できる完了条件：新規デプロイ環境でコレクション作成・インデックス作成が完走する（結合テストまたはローカルの `mongosh`/Nodeスクリプトでインデックス一覧に `pageId_1_isInline_1` 相当が存在することを確認する）
  - _Requirements: 1.2, 1.4, 4.1, 4.5, 5.4, 5.5_

- [x] 1.3 既存の読み取り経路にインラインコメント除外フィルタを追加する
  - `findCommentsByPageId`／`findCommentsByRevisionId`／`countCommentByPageId`（`comment.ts` のPrisma拡張メソッド）の `where` 条件に `isInline: { not: true }` を無条件で（`isSharedPage` の値によらず）追加する
  - `/_api/comments.get` を通常文脈・共有リンク文脈の両方で呼び出し、`isInline: true` の行が一切レスポンスに含まれないことを確認する結合テストを追加する
  - `countCommentByPageId` を使うページ末尾コメントの件数バッジが、インラインコメントを作成してもカウントに含めないことを確認する結合テストを追加する
  - 観測できる完了条件：新設した結合テストが2件ともgreenになる
  - _Requirements: 6.1, 6.3_
  - _Depends: 1.1, 1.2_

- [x] 1.4 インラインコメント用の `SupportedAction` 定数を追加する
  - `apps/app/src/interfaces/activity.ts` に `ACTION_INLINE_COMMENT_CREATE`／`ACTION_INLINE_COMMENT_REPLY`／`ACTION_INLINE_COMMENT_RESOLVE`／`ACTION_INLINE_COMMENT_UNRESOLVE` を追加する
  - 観測できる完了条件：4つの定数が `SupportedAction` からimport可能になる
  - _Requirements: 3.2_

- [ ] 2. クライアント側アンカー計算ロジック（サーバー非依存の純粋関数・フック群）
- [x] 2.1 (P) レンダリング状態属性を使った静定検知フックを実装する
  - `GROWI_IS_CONTENT_RENDERING_SELECTOR`（`@growi/core/dist/consts`）でコンテナ内の描画中要素の有無を判定し、ゼロになった時点で「静定」を発火するフックを実装する
  - `watch-rendering-and-rescroll.ts` と同じMutationObserver監視設定（`childList/subtree/attributes` + `attributeFilter`）を使う。初回マウント時にも1回判定する
  - 描画中要素が10秒（`WATCH_TIMEOUT_MS` 相当）経っても消えない場合は監視を打ち切り、その時点で1回だけ発火するタイムアウトフォールバックを実装する
  - 観測できる完了条件：描画中要素が存在する間は発火せず、要素が消えた時点・タイムアウト時点でそれぞれ1回だけ発火することをユニットテスト（MutationObserverモック）で確認できる
  - _Requirements: 2.1, 5.1_
  - _Boundary: use-container-settle_

- [x] 2.2 (P) レンダリング済みプレーンテキストの抽出関数を実装する
  - コンテナDOMから `.katex` サブツリーのみを除いたプレーンテキストと、テキストオフセット→DOM位置の逆引き関数を構築する純粋関数を実装する
  - 観測できる完了条件：`.katex` を含むサンプルDOMに対するユニットテストで、数式部分がテキストに含まれず、コードブロック・`lsx`/`drawio` 相当のダミー要素のテキストは含まれることを確認できる
  - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.2_
  - _Boundary: rendered-text_

- [x] 2.3 (P) テキスト選択キャプチャフックを実装する
  - `Selection` からクオート・前後文脈・おおよそのオフセットを構築する純粋フックを実装する。文字単位で開始・終了を扱い、クオートは正規化せず原文のまま保持する
  - 前後文脈の窓は `Intl.Segmenter(locale, { granularity: 'grapheme' })` を使い、目標窓サイズに収まる直近の書記素境界へ内側にスナップして構築する
  - 選択されたテキストが空の場合は `null` を返す
  - 観測できる完了条件：結合文字・絵文字を含む選択、空選択のそれぞれに対するユニットテストがgreenになる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7_
  - _Boundary: use-text-selection_

- [x] 2.4 (P) NFC正規化後オフセットの原文への逆変換関数を実装する
  - 正規化前後の文字列を先頭から並行して走査し、正規化後の任意のオフセットを正規化前の文字列上のオフセットへ変換する関数を実装する
  - 結合文字・互換分解でコード単位数が変わるケースを扱える
  - 観測できる完了条件：結合文字・互換分解を含むケースを含むユニットテストがgreenになる
  - _Requirements: 2.3, 5.1_
  - _Boundary: normalized-offset-mapping_

- [x] 2.5 あいまい一致マッチャーを実装する
  - `approx-string-match` `^2.0.0` を新規直接依存として追加する
  - 正規化前の `text` に対する完全一致箇所をすべて列挙し、`approxOffset` に最も近い候補を選ぶ。0件ならNFC正規化した上で `approx-string-match` の `search` を実行し（`maxErrors = Math.min(Math.ceil(quote.length * 0.2), 20)`）、複数候補があれば正規化後座標系での `approxOffset` 近さで選ぶ
  - 選ばれた一致位置を2.4の逆変換関数で正規化前オフセットへ変換する。完全一致・あいまい一致とも見つからなければ `not_found` を返す
  - 観測できる完了条件：完全一致優先の分岐、クオート複数出現時のタイブレーク、`maxErrors` 境界、正規化後オフセットの逆変換を検証するユニットテストがgreenになる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3_
  - _Depends: 2.4_
  - _Boundary: quote-matcher_

- [ ] 3. サーバー側：InlineCommentServiceとapiv3ルート
- [x] 3.1 起点インラインコメントの作成ロジックを実装する
  - `comments` テーブルに `isInline: true` の行を挿入する。クオートが空文字の場合はエラーとする。`anchorOriginRevisionId` を作成時にのみ設定する
  - `Activity` レコード（`ACTION_INLINE_COMMENT_CREATE`）を発行してから `crowi.commentService.prepareMentionNotifications` を呼び出す
  - 観測できる完了条件：作成後のレコードに保存したクオート・前後文脈が正規化されず原文のまま残っていることをユニットテストで確認できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 3.2, 5.4, 5.5_
  - _Depends: 1.1, 1.2, 1.4_

- [x] 3.2 インラインコメントへの返信作成ロジックを実装する
  - 指定された親IDが `isInline: true` かつ `replyToId` が `null`（起点コメント）であることを検証し、そうでなければエラーとする
  - `isInline: true, replyToId: <親id>` の行を、アンカー関連フィールドをすべて `null` のまま挿入する。`Activity`（`ACTION_INLINE_COMMENT_REPLY`）発行後に `prepareMentionNotifications` を呼び出す
  - 観測できる完了条件：返信でないコメントIDを親に指定した場合にエラーが返ることをユニットテストで確認できる
  - _Requirements: 1.8, 1.9, 3.2_
  - _Depends: 3.1_

- [x] 3.3 ページ単位の一覧取得ロジックを実装する
  - 指定ページの起点インラインコメントと、それに紐づく返信を取得し、`replyToId` でネスト構造を組み立てる（既存の拡張メソッドに流用できるものはないため自前で実装する）
  - 作成日時順に並べる
  - 観測できる完了条件：返信を持つ起点コメントを含むフィクスチャに対して、ネストした配列が正しい順序で返ることをユニットテストで確認できる
  - _Requirements: 2.5, 2.6_
  - _Depends: 3.2_

- [x] 3.4 解決/未解決トグルのロジックを実装する
  - 対象が起点コメント（`replyToId` が `null`）であることを検証し、返信IDが指定された場合はエラーとする
  - `resolved: true` で `resolvedById`/`resolvedAt` を設定し、`resolved: false` で両方を `null` に戻す。`Activity`（`ACTION_INLINE_COMMENT_RESOLVE`／`ACTION_INLINE_COMMENT_UNRESOLVE`）を発行する
  - 観測できる完了条件：未解決→解決→未解決の状態遷移と、返信IDを指定した場合にエラーになることをユニットテストで確認できる
  - _Requirements: 4.1, 4.2, 4.3, 4.5_
  - _Depends: 3.2_

- [x] 3.5 apiv3ルートを実装し配線する
  - `POST /_api/v3/inline-comments`（3.1）、`POST /_api/v3/inline-comments/:id/replies`（3.2）、`GET /_api/v3/inline-comments`（3.3）、`PUT /_api/v3/inline-comments/:id/resolve`（3.4）を実装する
  - すべてのルートに `accessTokenParser` → `loginRequired` → express-validatorチェーン → `apiV3FormValidator` を適用し、`certifySharedPage` はいずれのルートにも適用しない
  - `apps/app/src/server/routes/apiv3/index.js` に新規ルートをマウントする
  - 観測できる完了条件：ログインなし・ページ権限なしでのアクセスがそれぞれ401/403で拒否されることを結合テストで確認できる
  - _Requirements: 1.5, 1.6, 6.1_
  - _Depends: 3.1, 3.2, 3.3, 3.4_

- [ ] 4. クライアントUI・状態管理
- [x] 4.1 インラインコメント用のSWRストアを実装する
  - ページの一覧取得、起点作成、返信作成、解決トグルをラップするSWRフックを実装する（3.5のAPIを呼び出す）
  - 観測できる完了条件：作成・返信作成・解決トグルの呼び出し後に一覧が再取得されることを確認できる
  - _Requirements: 2.5, 2.6_
  - _Depends: 3.5_

- [x] 4.2 (P) 選択キャプチャとコメント作成フォームを実装する
  - 本文コンテナのテキスト選択を監視し（2.3のフックを使用）、選択があればフォームを表示する。空選択では作成操作を無効化する
  - コメント本文の入力欄は、既存 `CommentEditor.tsx` が確立したメンション対応テキストエリアの入力パターンを踏襲する（既存コンポーネントは変更しない）
  - 送信時に4.1のストア経由で起点作成APIを呼び出す
  - 観測できる完了条件：本文中のテキストを選択するとフォームが表示され、送信すると一覧に新しいインラインコメントが現れることをブラウザ操作で確認できる
  - _Requirements: 1.1, 1.2, 1.7, 3.1_
  - _Depends: 2.3, 4.1_
  - _Boundary: SelectionCapture, InlineCommentForm_

- [ ] 4.3 (P) アンカー再解決とハイライト描画を実装する
  - 2.1（静定検知）→2.2（プレーンテキスト抽出）→2.5（あいまい一致）を合成し、起点コメントごとの `ResolvedRange` を保持するフックを実装する。静定検知のたびに全件を冪等に再計算する（永続キャッシュは持たない）
  - `ResolvedRange` を受け取ってハイライトを描画するコンポーネントを実装する。`not_found` の場合はハイライトを描画しない
  - 観測できる完了条件：完全一致するテキストに対してハイライトが表示され、本文が変わって一致しなくなった場合はハイライトが表示されないことをユニットテストまたはブラウザ操作で確認できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3_
  - _Depends: 2.1, 2.2, 2.5, 4.1_
  - _Boundary: AnchorResolver, InlineCommentHighlight_

- [ ] 4.4 (P) インラインコメント一覧と返信表示を実装する
  - ページ内の全インラインコメントを作成日時順に一覧表示し、解決済み・未解決を区別して表示する
  - 返信は起点コメントにネストして表示する（既存 `ReplyComments.tsx` の表示パターンを踏襲。既存コンポーネントは変更しない）。返信投稿・解決トグル操作のUIを提供する
  - 起点コメント・返信本文中の `@ユーザー名` は、既存コメント機能と同じメンションハイライト表示（既存のremarkプラグインによる描画）を読み取り表示でも適用する
  - 観測できる完了条件：解決済み/未解決が視覚的に区別され、返信が起点コメントの下にネストして表示され、`@ユーザー名` を含む本文がハイライト表示されることをブラウザ操作で確認できる
  - _Requirements: 1.8, 2.5, 2.6, 3.1, 4.4_
  - _Depends: 4.1_
  - _Boundary: InlineCommentList, InlineCommentReplies_

- [ ] 5. 統合：既存ページビューへの配線
- [ ] 5.1 `RevisionRenderer.tsx` にコンテナrefを転送する
  - `ReactMarkdown` を包むコンテナ `div` に `ref` を転送するよう変更する（新規rehype/remarkプラグインは追加しない）
  - 観測できる完了条件：既存のページレンダリングに視覚的な差分がないことを確認した上で、親コンポーネントからコンテナDOMへ `ref` 経由でアクセスできる
  - _Requirements: 2.1, 5.1_

- [ ] 5.2 `PageView.tsx` にインラインコメント機能一式を配線する
  - 5.1のrefを4.2（SelectionCapture/Form）・4.3（AnchorResolver/Highlight）・4.4（InlineCommentList）に配線し、既存の `Comments`（通常コメント）と並置する
  - 共有リンク経由のページ表示（既存の `isSharedPage` 相当のクライアント側判定）では、SelectionCapture/InlineCommentForm/AnchorResolver/InlineCommentListのいずれもマウントしない
  - 観測できる完了条件：通常のページ表示では、本文選択→コメント作成→再読み込み後のハイライト復元が一連の操作として動作する。共有リンク経由のページ表示では、インラインコメントの作成・表示に関するUIが一切描画されない
  - _Requirements: 1.1, 2.1, 2.5, 6.2_
  - _Depends: 4.2, 4.3, 4.4, 5.1_

- [ ] 6. 検証：横断的な結合・E2E確認
- [ ] 6.1 メンション通知の結合テストを追加する
  - 起点コメント作成時・返信作成時それぞれについて、本文中の `@ユーザー名` がメンション通知の対象になることを確認する
  - 観測できる完了条件：結合テストがgreenになる
  - _Requirements: 3.1, 3.2_
  - _Depends: 3.5_

- [ ] 6.2 E2E: 選択から表示までの一連の流れを確認する
  - テキスト選択→コメント作成→ページ再読み込み後にハイライトが復元されること、インラインコメントへの返信が一覧上で起点コメントにネストして表示されることを確認する
  - 観測できる完了条件：E2Eテストがgreenになる
  - _Requirements: 1.1, 1.2, 1.8, 2.1, 2.2, 2.5, 2.6_
  - _Depends: 5.2_

- [ ] 6.3 E2E: 本文編集後のベストエフォート・フォールバックを確認する
  - 本文編集後にページを再読み込みし、対象範囲が完全に失われた場合にハイライトが表示されずコメントが一覧に残ることを確認する
  - 観測できる完了条件：E2Eテストがgreenになる
  - _Requirements: 2.4, 5.3_
  - _Depends: 5.2_

- [ ] 6.4 E2E: 非同期ウィジェット解決後の静定検知の実効性を確認する
  - `lsx` ブロックを含むページで、`lsx` の非同期解決（`GROWI_IS_CONTENT_RENDERING_ATTR` が `"false"` になるまで）を待ってからハイライトが正しい位置に付くことを確認する
  - 観測できる完了条件：E2Eテストがgreenになる
  - _Requirements: 2.1, 5.1_
  - _Depends: 5.2_

## Implementation Notes

- 2.4 (`normalized-offset-mapping.ts`): `NormalizedOffsetMapper` は `toOriginalOffset`/`toNormalizedOffset`/`normalizedText` のみを公開し、セグメントの `originalEnd` は非公開。あいまい一致の終了オフセットをそのまま逆変換すると、正規化で伸びた/書き換わったセグメント内部では境界が `originalStart` に丸まり、範囲が縮む可能性がある（2.5で終了オフセットを扱う際は、原文側で書記素境界にスナップして広げるなど別の対処が必要）。
- 2.5 (`quote-matcher.ts`): 上記の終了オフセット縮み問題は、正規化テキスト側で変換前に書記素境界へスナップすることで対処済み（変換後の原文側スナップは `toOriginalOffset` が常にセグメント先頭＝原文の書記素境界を返すため no-op になる）。`matchQuote(text, anchor)` は呼び出しごとに `createNormalizedOffsetMapper(text)` を作り直す設計（signatureがdesignで固定されているため）。4.3 (AnchorResolver) で複数アンカーを同じ `text` に対して呼ぶ場合、静定1回あたり完全一致しないアンカーの数だけ書記素分割が再実行される点に注意（完全一致経路ではmapperを作らないため、そちらは軽い）。
- 3.1/3.2 (`inline-comment-service.ts`): `create()`／`createReply()` はどちらも `Activity` レコードを `prisma.activities.createByParameters()` で自前生成し、`addActivity` ミドルウェア（`res.locals.activity`／`activityEvent.emit`）には一切依存しない。**3.5でルートを配線する際、この4エンドポイントに `addActivity` ミドルウェアを適用してはいけない** — 適用すると、`activityEvent.emit` で決着されないまま応答が返り、failsafe finalizer が `ACTION_UNSETTLED` の余分な行を書いてしまう（サービスが書いた本来の `ACTION_INLINE_COMMENT_*` 行とは別に）。`prisma.activities.createByParameters` の戻り値の型（`IActivity`）には `id` が無い（実行時には存在するが型からは見えない）ため、両メソッドとも `activityId` を呼び出し側で先に採番して `createByParameters({ id: activityId, ... })` に渡し、`prepareMentionNotifications` にも戻り値からではなくこの自己採番した `activityId` を渡している。3.5配線でも戻り値の `id` を読みに行く必要はない。
- 3.2で判明（3.3/3.4にも適用）：`InlineCommentServiceDeps.prisma` の型は**手書きインターフェースを作らず**、`import type { PrismaClient } from '~/utils/prisma'` を型のみ取り込みして `Pick<PrismaClient, 'comments' | 'activities'>` のように絞り込む。行の型が要る場合も `Prisma.Result<PrismaClient['comments'], {...}, 'create'>`（`import type { Prisma } from '~/generated/prisma/client'`）のように実体から導出する。手書き型を本物のPrismaクライアントに合わせ込もうとすると（オーバーロード／ユニオン型／実行時ガードいずれも）代入不能や実行時の誤判定を繰り返す（3.2で3ラウンド分のレビュー往復の原因になった）。既存の参考実装は `apps/app/src/features/audit-log-bulk-export/server/service/audit-log-bulk-export-job-cron/steps/activity-export-cursor.ts` とその `.spec.ts`（`mock<PrismaClient>({...})` によるモック）。
- 3.2〜3.4：`create()`/`createReply()`/`setResolved()` の事前条件エラーは、いずれも区別のない汎用 `Error` を投げる（対象なし・非インライン行・返信ID指定、いずれも同じ形）。**3.5でルートを配線する際、design.md の API Contract（400 vs 404 の使い分け）をそのままには実現できない** — サービス側は現状「例外を投げるか投げないか」しか教えないため、400/404を分けたいならルート層で対象行を再取得するか、サービス側にエラー種別を持たせる変更が必要（後者は3.2〜3.4の再オープンになるため、3.5側での対応を推奨）。
- 3.4：`comments` テーブルは通常コメントとインラインコメントの共有テーブルであり、通常コメント行も `replyToId: null` を持つ。起点コメントかどうかの事前条件チェックは `replyToId === null` だけでなく **`isInline === true` も必ず確認する**（`setResolved`/`createReply` とも同じ理由でこのチェックが必要）。
- 3.5：`create()`（3.1）が `replyToId` を明示的に `null` セットしていなかったため、MongoDB上でフィールド自体が欠落し、`listByPageId()`（3.3）の `where: { replyToId: null }` に一致しない不具合を発見・修正した（Prismaの Mongo コネクタは `null` フィルタを「欠落」ではなく「明示的なnull」にのみマッチさせる。生ドライバの `null` フィルタは欠落にもマッチするため挙動が異なる点に注意）。`create()` の `data` に `replyToId: null` を追加する1行修正のみ。400/404 の使い分けは `create-reply.ts`/`resolve.ts` がルート側で対象行を `findUnique` により事前取得することで実現（サービス層は変更していない）。ページ権限チェックは `findPageAndMetaDataByViewer` を使い、`apps/app/.claude/rules/page-write-action-403-404.md` に従って403/404を常に404に統一している（design.mdのAPI Contract表が403としている箇所も含む）。未ログイン時はこのリポジトリの `loginRequiredFactory` がapiv3全体で403を返す仕様のため、要件文の「401」はこのタスクでは403として実現されている（コードベース全体の既存挙動）。
- 4.2（未着手のフォローアップ、ブロッキングではない）：`SelectionCapture.tsx` はフォーム表示中に別のテキストを選択し直しても、既にロックされたアンカーを更新しない（フォームを閉じる/送信するまで新しい選択を無視する）。ブラウザのネイティブ選択ハイライトは新しい選択に移動するが、フォームの引用文・送信内容は古いアンカーのままになりうる。要件1.1/1.2/1.7やタスクの完了条件そのものは満たしているため4.2はブロックしていないが、UXとして改善の余地があり、別タスク化を検討。
