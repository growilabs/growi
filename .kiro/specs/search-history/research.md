# Research & Design Decisions: search-history

## Summary
- **Feature**: `search-history`
- **Discovery Scope**: Extension（既存の検索モーダル・apiv3・Prisma・インポート／g2g への組み込み）。brief.md と requirements.md で決定済みの事項（記録方式・API の窓口・スコープ・保持件数・表示件数・g2g/エクスポート・ユーザー削除時の扱い）は前提とし、再調査していない。
- **Key Findings**:
  - 検索モーダルが空入力のとき、`SearchMethodMenuItem` は 1 項目（index 0）だけを出し、`SearchResultMenuItem` は何も出さない。履歴は空入力のときだけ出すため、履歴の index は常に 1 から始まり、既存項目の index 計算（`isEmptyKeyword ? 1 : 3`）には手を入れずに済む。
  - Downshift の項目は `{ url }` だけで、`SearchMenuItem` が `item: { url }` を内部で組み立てている。履歴項目（URL 遷移ではなく「検索の実行」）と、記録用のキーワードを持つ検索方法項目を表すには、項目型を判別可能な union に拡張し、`SearchMenuItem` が項目そのものを受け取る形に変える必要がある。
  - `/_private-legacy-pages` と `/_search` はどちらも `SearchControl` → `SearchModalTriggerinput` → `open(keyword, onSearchOverride)` という同じ経路でモーダルを開くため、`onSearchOverride` の有無では区別できない。さらに、ショートカットキー `/`（`FocusToGlobalSearch`）など、ページ上のどこからでもモーダルを開く経路がある。履歴を使うかは、開く経路ではなく、モーダルを表示しているページから決める必要がある。

## Research Log

### 検索モーダルの項目と index
- **Context**: 要件 8.2（既存の並びとハイライト起点を変えない）、9.1（既存項目と同じ操作感）。
- **Sources Consulted**: `features/search/client/components/SearchModal.tsx`, `SearchMethodMenuItem.tsx`, `SearchResultMenuItem.tsx`, `SearchMenuItem.tsx`, `interfaces/downshift.ts`
- **Findings**:
  - 空入力時の `SearchMethodMenuItem` は「この階層下の子ページのみ」の 1 項目（index 0、URL は `/_search?q=prefix:<現在のページ> `）。
  - `SearchResultMenuItem` は空入力時に何も描画しない。入力ありのときの起点 index は 3。
  - 選択は `onSelect` → `router.push(item.url)` → `closeSearchModal()`。
  - Enter キーは、ハイライト中の項目があれば Downshift が選択として処理し、フォーム送信は起きない（既存の検索方法項目と同じ）。
- **Implications**: 履歴セクションの index は「空入力時の検索方法項目の数（1）」から始める。この値は `SearchResultMenuItem` の起点計算と同じ知識なので、純粋関数 `getSearchMethodMenuItemCount()` に寄せて両者で共有する。

### 記録点と `prefix:` の付与
- **Context**: 要件 1.1〜1.3、2.3〜2.5、9.3〜9.4。
- **Sources Consulted**: `SearchModal.tsx` の `searchHandler`、`SearchMethodMenuItem.tsx`
- **Findings**:
  - Enter による送信は `searchHandler(keyword)` に集約されている。`onSearchOverride` の分岐と `prefix:` の付与は、どちらもこの中にある。
  - 検索方法項目の URL は `prefix:` を含み、完全一致は `"${searchKeyword}"`（前後の空白は除かれていない）。URL から記録用のキーワードを逆算することはできない。
- **Implications**: 記録は、`searchHandler` の先頭（`onSearchOverride` の分岐より前、`prefix:` の付与より前）で行う。検索方法項目には、記録用のキーワードを項目データとして持たせる。履歴からの再検索は `searchHandler` を通すため、記録・`prefix:` の付与・`onSearchOverride` がすべて Enter と同じになる。

### `/_private-legacy-pages` の除外
- **Context**: 要件 1.8、8.7。brief で「除く方法は設計で考える」とされていた。
- **Sources Consulted**: `PrivateLegacyPages.tsx`, `SearchPage/SearchPage.tsx`, `SearchPage/SearchControl.tsx`, `SearchPage/SearchModalTriggerinput.tsx`, `states/modal/search.ts`, `client/components/Hotkeys/Subscribers/FocusToGlobalSearch.tsx`
- **Findings**: 両ページは同じ `SearchControl` を使い、`onSearchInvoked` を `onSearchOverride` として渡している。`/_private-legacy-pages` 上でもショートカットキー `/` で `open()` が引数なしで呼ばれ、`SearchControl` を通らない。
- **Implications**: 下記 Decision「履歴を使うかはモーダルが表示中のページから決める」を参照。

### Prisma だけのコレクションとインデックス
- **Context**: brief の Constraints（Mongoose を持たない、インデックスは migrate-mongo で作る）。
- **Sources Consulted**: `prisma/schema.prisma`（`bookmarks`, `auditlog_es_sync_status`）、`src/migrations/20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js`、`src/utils/prisma.ts`、`src/server/models/bookmark.ts`
- **Findings**:
  - ユーザーを参照する既存モデルは、`userId String @map("user") @db.ObjectId` の形をとる。
  - `createPrisma()` の結果拡張で、結果に `_id` が付く。
  - Prisma 6 の MongoDB コネクタの `upsert` は DB ネイティブの upsert ではない。同じ一意キーへの upsert が同時に走ると、片方が一意制約違反（P2002）で失敗しうる（Prisma のドキュメントは、アプリ側での再試行を推奨している）。
- **Implications**: Mongo 上のフィールド名は `user`・`keyword`・`lastSearchedAt` に統一し、インデックスのキー・名前、overwrite-params のキーもこの名前を使う。記録処理は、P2002 のときに 1 回だけ再試行する。

### インポートと g2g
- **Context**: 要件 7.3〜7.5。
- **Sources Consulted**: `server/service/import/overwrite-params/index.ts`、`revisions.ts`、`attachmentFiles.chunks.ts`、`non-transferable-collections.ts`、`construct-convert-map.ts`
- **Findings**: `generateOverwriteParams` はコレクション名で分岐し、該当しないものは `{}` を返す。`attachmentFiles.chunks` は ObjectId への変換を `OverwriteParams` の関数として持っている。Mongoose のモデルが無いコレクションは、`constructConvertMap` の対象外になる。
- **Implications**: `overwrite-params/searchhistories.ts` に `user` を ObjectId に戻す関数を置き、`index.ts` の switch に 1 件追加する。指定の無いフィールドは既定の変換で ISO 日時の形の文字列が Date になるため、`keyword` も文字列のまま通す指定を置く（下記 Decision）。

### 読み取り専用ユーザーとアクセストークン
- **Context**: 要件 5.5、11.4（書き込みスコープ）。
- **Sources Consulted**: `server/middlewares/access-token-parser/access-token.ts`
- **Findings**: 読み取り専用ユーザーのアクセストークンは、パーサーで無視される（認証されない）。セッションでログインした読み取り専用ユーザーは、`loginRequired` を通過する。
- **Implications**: 画面から使う読み取り専用ユーザーも、履歴の記録・削除ができる。検索履歴はページの内容を変えないため、`excludeReadOnlyUser` 系のミドルウェアは付けない。

### 以前の `search-history-persistence` の設計との関係
- **Context**: 要件を 1 本の spec にまとめる前に、`search-history-persistence` の design.md が書かれていた（commit `c153436782`。その後 `6db51f80a0` で、spec ごと統合された）。
- **Findings**: 当時の前提（Mongoose のモデルでインデックスを作る、エクスポート・g2g の対象外）は、現在の requirements と brief（Prisma だけ、エクスポート・g2g の対象）で覆っている。コレクション名 `searchhistories`、フィールド名 `user` / `keyword` / `lastSearchedAt`、応答のキー `searchHistories` / `searchHistory`、一意キー (user, keyword)、同時記録時の 1 回の再試行は、本設計でも同じにした。
- **Implications**: 切り詰めで境界 `cutoff`（`lastSearchedAt <= cutoff`）を付けて、直前に繰り上がった履歴を消さないという工夫は、本設計でも採り入れた。並べ替え用のインデックス (user, lastSearchedAt, _id) は、保持の上限で件数が小さいため採らない（下記 Decision）。記録の POST に `keepalive` を付ける案は採らない。遷移は Next.js のクライアント側の遷移で、ページは破棄されず、送信中の要求は中断されないため。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| ページで判定（採用） | モーダル内で、無効にするページの一覧（`SEARCH_HISTORY_DISABLED_PATHNAMES`）に `router.pathname` が含まれるかを見る | 開く経路によらず 1 か所で決まり、入口が増えても漏れない。変更箇所が最小 | 無効にするページが増えたら、一覧に 1 行足す必要がある | ページの一覧はデータとして持ち、判定は汎用にする |
| 宣言フラグ | `open()` のオプションで `isSearchHistoryEnabled` を受け取り、モーダルの状態に持たせる | モーダルが呼び出し元のページを知らずに済む | 開く経路ごとに受け渡しが要り、ショートカットキー `/` のように `SearchControl` を通らない経路で漏れる | 不採用 |
| `onSearchOverride` を包む | `PrivateLegacyPages` 側で、記録を打ち消す関数を渡す | — | 記録はモーダル内で行うため打ち消せない。表示の抑止もできない | 不採用 |

## Design Decisions

### Decision: 履歴を使うかはモーダルが表示中のページから決める
- **Context**: `/_private-legacy-pages` 上で開いたモーダルでは、記録も表示もしない（1.8, 8.7）。
- **Alternatives Considered**:
  1. モーダル内でページ（`router.pathname`）から判定する
  2. `open()` のオプションで、開く側が宣言する
- **Selected Approach**: 1。`SearchModal.tsx` に `SEARCH_HISTORY_DISABLED_PATHNAMES = ['/_private-legacy-pages']` を置き、`isSearchHistoryEnabled = !SEARCH_HISTORY_DISABLED_PATHNAMES.includes(router.pathname)` とする。モーダルの状態と `open()` の引数は変えない。
- **Rationale**: モーダルを開く経路は `SearchControl` だけではなく、ショートカットキー `/` などもある。開く側の宣言では、宣言を通さない経路（`/_private-legacy-pages` 上でのショートカットキー）で履歴が有効のままになる。ページから決めれば、入口が増えても判定が漏れない。
- **Trade-offs**: 無効にするページが増えたら一覧に足す必要がある。`/_private-legacy-pages` のルートが変わると判定が外れる（Revalidation Triggers に記載）。

### Decision: Downshift の項目を判別可能な union にする
- **Context**: 履歴項目は URL 遷移ではなく「その文字列で検索を実行する」アクション（brief）。検索方法項目は、URL とは別に記録用のキーワードを持つ必要がある。
- **Selected Approach**: `DownshiftItem = NavigateItem | SearchItem`。`NavigateItem = { type: 'navigate'; url; historyKeyword?: string }`、`SearchItem = { type: 'search'; keyword }`。`SearchMenuItem` は `item` prop を受け取る。
- **Rationale**: 選択時の分岐を項目のデータで決められる。ページ候補は `historyKeyword` を持たないので、選んでも記録されない（1.5）。
- **Trade-offs**: `SearchMenuItem` を使う既存の 2 コンポーネントに、機械的な修正が入る。

### Decision: 記録の判定は 1 か所に集める
- **Context**: Enter、検索方法項目、履歴からの再検索の 3 つの入口がある（1.1〜1.3, 1.9）。
- **Selected Approach**: `SearchModal` 内の `recordSearch(keyword)` だけが記録 API を呼ぶ。ゲスト、または `isSearchHistoryEnabled === false`（表示中のページが `/_private-legacy-pages`）のときは何もしない。キーワードの正規化と長さの判定は、共有の純粋関数 `toSearchHistoryKeyword()` で行う。
- **Rationale**: 記録の可否が 1 か所で決まるので、入口が増えても判定が漏れない。

### Decision: `/_search` の入力欄に表示された `prefix:` は入力どおりに記録する
- **Context**: 要件 2.3（自動付与の `prefix:` を含めない）と 2.8。`/_search` から開いたモーダルの入力欄には、前回の検索で自動付与された `prefix:<ページ>` を含む `/_search` の検索欄の値が初期値として入る。
- **Alternatives Considered**:
  1. 入力欄に表示されているものは、ユーザーが見て残したものとして入力どおりに記録する
  2. `/_search` に渡すキーワードと、表示・記録に使う入力を分けて持ち、自動付与の `prefix:` を記録から除く
- **Selected Approach**: 1。コードは変えない。
- **Rationale**: 2.3 が除くのは、Enter の処理の中で付与され、入力欄に表示されない `prefix:` である。入力欄に表示されている `prefix:` は、ユーザーが消すこともできたのに残したものなので、ユーザーの入力として扱う。2 は `/_search` の状態の持ち方を変えることになり、本 spec の範囲（検索の実行そのものは変えない）を超える。

### Decision: クライアントは keyword を Date に変換しない経路で検索履歴 API の応答を受け取る
- **Context**: 共通の apiv3 クライアント（`~/utils/axios` の既定の `transformResponse`）は、応答の中の ISO 日時の形の文字列を、キーを問わず Date に変える。`2024-10-30T00:00:00Z` のようなキーワードが Date になり、描画すると React がエラーになる。
- **Alternatives Considered**:
  1. 受け取った Date を文字列に戻す
  2. サーバの応答で keyword を変換されない形に包む
  3. 検索履歴 API だけ、要求ごとの `transformResponse` で応答を自前で解釈する
- **Selected Approach**: 3。`client/services/search-history-api.ts` で `~/utils/axios` に `transformResponse` を渡し、`JSON.parse` の reviver で `lastSearchedAt` だけを Date に戻す。記録（4.1）と一覧の取得（7.1）が同じモジュールを使う。
- **Rationale**: 1 は元の文字列に戻らない（`Z` が `.000Z` になる）。2 は API の応答の形（一覧の 1 件と同じ形）を崩す。3 は共通の変換を変えずに、検索履歴だけを正しく受け取れる。
- **Trade-offs**: 共通の apiv3 クライアントのエラーのログ出力（`apiv3ErrorHandler`）を通らない。記録の失敗は `recordSearchHistory` がログに残す。

### Decision: インポートでは keyword を文字列のまま通す
- **Context**: 要件 7.4。インポートの既定の変換は、`overwriteParams` に指定の無いフィールドのうち ISO 日時の形の文字列を Date に変える。
- **Selected Approach**: `overwrite-params/searchhistories.ts` に `keyword: (value) => value` を置く。
- **Rationale**: keyword が Date で保存されると、Prisma の `keyword String` と型が合わず、そのユーザーの一覧取得が失敗し続ける。同じキーワードを記録し直しても、一意キーが一致しないので修復されない。

### Decision: 履歴の削除をユーザー削除の不可逆な手順より前に行い、失敗したらユーザー削除ごと失敗させる
- **Context**: 要件 7.1。`statusDelete()` の後は username が書き換わり、削除済みのユーザーを管理画面から再度削除できない。履歴の削除をその後に置いて失敗を握りつぶすと、履歴が残ったまま確定し、後片付けの仕組みも無い。
- **Selected Approach**: `removeAllSearchHistoriesOfUser` を、グループ関係の削除・`statusDelete()`・外部アカウントの削除より前に呼ぶ。失敗は既存の `catch` に任せ、削除全体の失敗として返す。
- **Rationale**: 失敗してもユーザーは削除されないので、管理者が同じ操作をやり直せる。履歴の削除は冪等なので、やり直しは安全。残った履歴は、エクスポートや GROWI 間の移行で他のサーバへ運ばれ得るため、要件 7 の趣旨（個人の検索内容を残さない）を守るには、残さない順序にする必要がある。
- **Alternatives considered**: 失敗をログだけに残して続ける（履歴が残ったまま確定する）。起動時や定期処理で削除済みユーザーの履歴を消す（追加の仕組みが要る）。

### Decision: 一覧は全件（最大 50 件）を返し、表示はクライアントで 10 件に絞る
- **Context**: 要件 4.1（本人の履歴を新しい順に返す）、8.1（最大 10 件表示）、10.5（削除後すぐ消える）。
- **Alternatives Considered**:
  1. API に `limit` を設け、10 件だけ返す
  2. 全件（保持の上限 50 件）を返す
- **Selected Approach**: 2。
- **Rationale**: 応答は最大でも 50 件 × 200 文字程度と小さい。楽観的に 1 件消したとき、11 件目がそのまま繰り上がって表示される。API のパラメータも増えない。
- **Trade-offs**: 表示しない 40 件分も転送する（数 KB）。

### Decision: インデックスは一意の (user, keyword) 1 本だけにする
- **Context**: 重複の判定（3.1）、一覧（4.1）、上限 50 件への切り詰め（3.5）。
- **Alternatives Considered**:
  1. 一意の (user, keyword) と、(user, lastSearchedAt) の 2 本
  2. 一意の (user, keyword) の 1 本
- **Selected Approach**: 2。一覧と切り詰めは、`user` の等価条件を (user, keyword) の先頭キーで絞り込み、最大 51 件をメモリ上で並べ替える。
- **Rationale**: 1 ユーザーの件数は保持の上限で 51 件以内に収まるため、並べ替え用のインデックスは不要で、書き込みのたびに更新するインデックスを 1 本減らせる。
- **Trade-offs**: 保持の上限を大きく引き上げる場合は、(user, lastSearchedAt) のインデックスを足す必要がある（Revalidation Triggers に記載）。

### Decision: 長さは Unicode のコードポイント数で数える
- **Context**: 要件 2.7 の「200 文字」。
- **Selected Approach**: `Array.from(text).length`（コードポイント数）で数える。クライアントとサーバで同じ関数を使う。
- **Rationale**: 絵文字などのサロゲートペアを 2 文字と数えないので、ユーザーの「文字」の感覚に近い。

### Decision: 削除キーは Delete
- **Context**: 要件 10.3（キーの割り当ては設計で決める）。
- **Selected Approach**: `KeyboardEvent.key === 'Delete'`（Shift+Delete、Mac の fn+Backspace を含む）。Backspace は対象にしない。
- **Rationale**: 履歴は入力が空のときだけ出るので、Delete キーが入力欄の文字に作用することはない。Backspace も対象にすると、文字を消し終えた直後の連打で履歴まで消える恐れがある（ユーザーと合意済み）。

### Decision: 削除ボタンは Tab で止まらない（`tabIndex={-1}`）
- **Context**: 要件 10.1（支援技術で識別できるラベル）、10.3（キーボードで削除できる）。
- **Selected Approach**: キーボードでの削除は Delete キーで行う。ボタンは `aria-label` を持つが、Tab でフォーカスを受けない。
- **Rationale**: Downshift の combobox は、フォーカスを入力欄に置いたまま項目を操作する形になっている。ボタンにフォーカスが移ると、入力欄からフォーカスが外れてメニューの状態が崩れる。

### Decision: 楽観的な削除には SWR の `mutate` オプションを使う
- **Context**: 要件 10.5、10.6。
- **Selected Approach**: `mutate(deleteFn, { optimisticData, rollbackOnError: true, populateCache: false, revalidate: false })`。失敗したら `toastError` で知らせる。
- **Rationale**: SWR が標準で持つ巻き戻しの仕組みで足り、自前で状態を持つ必要がない（Build vs Adopt）。

## Synthesis Outcomes
- **Generalization**: 3 つの記録の入口は、どれも「ユーザーが入力した文字列で検索を実行した」の一種なので、`recordSearch(keyword)` という 1 つの判定にまとめた。項目の種類は、データ（`type`、`historyKeyword` の有無）で表す。
- **Build vs Adopt**: 楽観的更新は SWR の `optimisticData` / `rollbackOnError` を使う。インデックスの作成は、既存の migrate-mongo の前例をそのまま使う。新しいライブラリは入れない。
- **Simplification**: 一覧 API の `limit` パラメータをなくした。インデックスを 1 本にした。Prisma の `users` へのリレーションは宣言しない（`users` 側に逆参照のフィールドが要るうえ、使い道が無い）。サーバ側は、クラスではなく関数のモジュールにした（`auditlog-es-sync` の前例に合わせる）。

## Risks & Mitigations
- 同じキーワードの記録が同時に走ると、一意制約違反（P2002）になりうる — 1 回だけ再試行する。再試行では既存のドキュメントが見つかるので、更新になる。
- 同じ瞬間に記録が重なり、切り詰めが並行して走る — どちらも「新しい 50 件以外を消す」なので、結果は同じになる（冪等）。並べ替えには `_id` の降順を第 2 キーとして加え、順序を決定的にする。
- インポートの挿入モードで、既存の履歴と (user, keyword) が重なる — 一意インデックスにより、その行は失敗する。インポートの既存の失敗の扱い（コレクション単位の報告）に従う。検索履歴に固有の対処は加えない。
- 既存の `SearchMenuItem` の props を変える — 検索方法項目とページ候補のテストで、並び・index・遷移先が変わらないことを確かめる。

## References
- Prisma: [Upsert — Database upserts and concurrency](https://www.prisma.io/docs/orm/reference/prisma-client-reference#upsert) — 非ネイティブ upsert での一意制約違反と再試行
- SWR: [Mutation — Optimistic Updates](https://swr.vercel.app/docs/mutation#optimistic-updates) — `optimisticData` / `rollbackOnError`
- Downshift v8: [Customizing handlers](https://www.downshift-js.com/downshift#customizing-handlers) — `preventDownshiftDefault`
