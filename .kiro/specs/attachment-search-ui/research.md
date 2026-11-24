# Research: attachment-search-ui

_Generated: 2026-04-17 (3-way split から派生)。2026-11-24 に、今の API と master の画面に合わせて設計を作り直したときの調査と判断で書き直した_

本 spec (画面) の設計判断に関わる調査と判断を記録する。サーバ側や抽出サービス側の調査は、それぞれの spec の research.md にある。

## Summary

- **Discovery の種類**: 既存の画面の拡張 (light discovery)。新しいライブラリは入れない
- **重要な発見**:
  1. 検索結果の一覧は `@tanstack/react-virtual` で見えている行だけを描画する。行ごとに添付ヒットを SWR で引けば、要求は見えている行の組だけに出る
  2. 行の部品 (`PageListItemL`) もプレビュー (`SearchResultContent`) も、ページ文書の `path`・`revision`・`lastUpdateUser` などを使う。添付だけの検索の項目がページ ID しか持たないと描けない
  3. 既存の作り直しの hook (`useIndexManagement`) は `FinishAddPage` で完了とするので、添付の段階が続く間に作り直しを押せてしまう

## 1. 検索結果画面の今の作り (master、2026-11-24 に確認)

- `SearchPage.tsx` は `useSWRINFxSearch` (`stores/search.tsx`、`useSWRInfinite`) で、1 回に `customize:showPageLimitationL` 件 (既定 50) ずつ読む。読んだまとまりは `mergeInfiniteSearchResult` (`features/search/client/util/infinite-search-result.ts`) で 1 つの一覧にする
- 次を読むのをやめるのは、前のまとまりの `meta.hitsCount` が 1 回に読む件数に満たないとき (`getSearchInfiniteKey`)。`mergeInfiniteSearchResult` は `fetchedCount >= total` でも終わりと判定する
- 失敗したまとまりは `setSize(size)` で読み直す (保存されていないまとまりだけが取り直される)。改名・削除は `mutateSearchInfiniteChunks` で、`'/search/infinite'` で始まるキーのまとまりを書き換える
- サーバに送る検索語は、`?q=` (演算子を含む) に `createSearchQuery` が `-prefix:/trash` / `-prefix:/user` を足したもの。`SearchPage` は名前付きの検索 (`nq`) を使わない (常に null)
- `SearchResultList` は `@tanstack/react-virtual` で、見えている行と前後 5 行だけを描画する。行の高さは描画後に測り直す
- 行は `PageListItemL` (`client/components/PageList/`)。行全体が `role="button"` でクリックでき、押すとそのページが選ばれる。外から中身を渡す口は無い
- 選ばれたページは `SearchPageBase` が `IPageWithSearchMeta` のまま持ち、`SearchResultContent` に渡す。プレビューは `data.revision` で本文を読み、`PagePathNav` でパスを出す
- 本文の抜粋 (`elasticSearchResult.snippet`) が無い行は、`useSWRxPageInfoForList` (`GET /_api/v3/page-listing/info`) で本文の冒頭を取る

## 2. 上流の API の今の契約 (2026-11-24 にコードで確認)

- `GET /_api/v3/search/attachments?q=&pageIds=`: `pageIds` は重複を除いて 1〜20 件。`q` は decode しない。応答 `{ enrichments }`。失敗と 500ms 超過は 500、機能が無効なら 503 `feature_disabled`
- `GET /_api/search?facet=attachments`: `q` を 1 回 decode する (ページ検索と同じ)。`limit` は 1〜200 (既定 50)。応答の `meta` は `{ facet: 'attachments', total: null, hitsCount, primaryResultIncomplete }`。各項目は `{ data: { _id }, meta: { attachmentHits } }`
- 添付だけの検索の窓 (`collect-visible-attachment-hits.ts`): `from + size` 件のページに届くまで、添付ヒットを点数順に倍々で取り、権限で選り分ける。窓は最大 200 件で、どの `offset` でも同じ範囲で頭打ちになる
- `POST /_api/v3/attachments/:id/reextract`: ゲストと読み取り専用の利用者は断る。ファイルの抽出が失敗しても 200 で、`outcome.kind` で種類を返す (文は返さない)。429 は本文にコードが無い
- `GET|PUT /_api/v3/admin/attachment-search/config`: トークンは返さず `hasExtractorToken` だけ。PUT はトークンの項目を省くと保存済みのトークンを変えない。URI は http/https だけを通し、クラウドのメタデータの宛先を断る (400 `invalid_extractor_uri`)。`env:useOnlyEnvVars:app:attachmentFullTextSearch` で 4 つの設定が環境変数に固定されていても、GET はそれを返さない
- `GET /_api/v3/admin/attachment-search/failures`: `{ items, total }`。理由コードは 8 種類。同じ添付・同じ理由は 1 時間に 1 行にまとまり、90 日で消える
- `PUT /_api/v3/search/indices` の `includeAttachments: true`: 完了を待たずに応答し、実行中なら 409 `rebuild_in_progress`。ページの作り直しの後に添付を作り直す。ページの段階が失敗すると `RebuildingFailed` と、同じ文の `AttachmentRebuildingFailed` の両方が届く。進行中かどうかを問い合わせる API は無い
- SSR prop `searchConfig.isAttachmentFullTextSearchEnabled` は、基本レイアウトのページと管理画面の検索ページに届く。クライアントの atom はまだ無い

## 3. 既存の部品の拡張点

- **添付ファイル一覧**: `@growi/ui` の `Attachment` (`packages/ui/src/components/Attachment.tsx`) の行の操作はダウンロードと削除で固定されている。操作を足すには `packages/ui` の変更が要る。`@growi/ui` は公開パッケージではない
- **添付の「In Use」**: データベースの状態ではなく、モーダルが本文に添付の ID が含まれるかをその場で調べた目印である。検索では区別しない (上流 research.md 13)
- **管理画面**: `IndexManagementSection` は作り直しの操作の下に `extraContent` を出せる。`ElasticsearchManagementPage` は、ページの索引の管理と監査ログの索引の管理を並べている
- **添付を開く先**: 添付の `filePathProxied` は `/attachment/<id>`。これを新しいタブで開くのが、既存の添付の表示である

## 4. 設計の判断 (2026-11-24)

### 4.1 添付ヒットは 20 ページの組ごとに、行から SWR で引く

- 判断: 読み込んだまとまりごとに先頭から 20 件ずつ組にし、`['/search/attachments', 送る検索語, 組のページ ID]` をキーに SWR で取る。各行とプレビューは、自分のページの組のキーで同じ値を引く
- 理由:
  - 一覧は見えている行だけを描画するので、要求は見えている行の組だけに出る。「表示中のページの添付ヒットを取る」(要件 1.6) がそのまま成り立つ
  - 同じ組を見る行が何行あっても、SWR が同じキーの要求を 1 回にまとめる
  - ページ検索のまとまりに書き込まないので、改名・削除の書き換えや読み直しと干渉しない
  - まとまりごとに区切るので、続きを読み込んでも前の組のキーが変わらない
- 採らなかった案:
  - まとまりを受け取るたびに、そのまとまりの全部の組を `SearchPage` でまとめて取る: 見えていない行の分まで取る。まとまりの一部が失敗したときの持ち方も別に作る必要がある
  - 添付ヒットを `useSWRInfinite` のまとまりに書き込む: `mutateSearchInfiniteChunks` の書き換えと、保存の有無で取り直しを決める読み直しの仕組みに混ざる
  - 一覧全体の先頭から 20 件ずつ区切る: 1 回に読む件数 (50) が 20 で割り切れないと、続きを読み込んだときに最後の組のキーが変わり、取り直しになる
- 受け入れた費用: 行を削除すると、そのまとまりの中で後ろの組の区切りがずれて取り直しになる

### 4.2 失敗は組ごとに、行とプレビューで示す

- 判断: 組の要求が失敗したら、その組の行とプレビューに「確認できませんでした」と再試行の操作を出す。SWR の自動の再試行は止める。503 `feature_disabled` は失敗として見せず、添付の表示を出さない
- 理由: 失敗の単位は要求の単位 (組) と同じにするのがいちばん単純で、再試行もその組のキーの取り直しだけで済む。失敗はまれ (ES の障害か時間切れ) なので、行ごとの表示が並ぶ場面は少ない
- 取得中: 行には何も出さない (多くの行は添付ヒットが無いので、読み込み中の表示がちらつく)。プレビューには小さな読み込み中の表示を出す

### 4.3 「添付ファイル」を対象にした検索は、続きの読み込みを `hitsCount < limit` で終える (上流の未決事項 1)

- 判断: 前のまとまりの `hitsCount` が `limit` に満たなければ終わり。`primaryResultIncomplete` は fetcher で例外にする
- 理由: 窓はどの `offset` でも上位 200 件で頭打ちになり、各要求が同じ範囲を見るので、短い応答の後に続きは出ない (2 を参照)。失敗をデータとして返すと SWR がまとまりを保存し、読み直しで取り直されない
- `mergeInfiniteSearchResult` は使わない: `total` が null だと `fetchedCount >= total` が成り立ち、最初のまとまりで終わりと判定される

### 4.4 添付だけの検索の項目には、サーバがページ文書を入れる (上流の未決事項 2、上流への依頼 U1)

- 判断: 上流の `GET /_api/search?facet=attachments` が、ページ検索と同じ `findPageListByIds` でページ文書を `data` に入れる。MongoDB に無いページは落とし、`hitsCount` は落とす前の数にする
- 理由:
  - 行の中心は親ページ (どのページの添付か) なので、ページの情報を後から取ると、届くまで行に何も書けない。ページ検索で添付ヒットを後から付け足すのは、添付ヒットが補足の情報だからである
  - 複数のページ ID からページ文書 (`path`・`revision`・`lastUpdateUser`・`updatedAt`) をまとめて返す API は無い。`/page-listing/info` は付随情報だけ、`/page-listing/item` と `/page` は 1 回に 1 ページ
  - サーバはページ検索で同じ関数を使っており、1 回呼ぶだけで済む。新しい API も、画面からの追加の要求も要らない
  - 項目の形がページ検索と同じになるので、一覧とプレビューの部品をそのまま使える
- 採らなかった案: 画面がページ ID の一覧から別の要求でページ文書を取る。新しい API が要り、要求も増える (2026-11-24 に利用者と検討)

### 4.5 検索対象の切り替えは `SearchPage` の state にする

- 判断: `useState<SearchTarget>('pages')`。URL には載せない
- 理由: 切り替えを読むのは `SearchPage` と、そこから渡す中身だけなので、atom にする必要が無い。URL に載せると、戻る・進むの動きと、ほかの検索の入口からの扱いを決める必要が出る。要件はそれを求めていない
- 前の設計の Jotai atom (`activeFacetAtom`) はやめる。3 つのタブを複数の部品から読んでいた前提が無くなった

### 4.6 添付を含む作り直しは別の hook で持ち、既存の hook は変えない

- 判断: `useAttachmentRebuild` が PUT と socket のイベントから添付の段階の状態を持つ。作り直しの操作は `isRebuildEnabled && !isRunning` のときだけ押せる
- 理由: 既存の `useIndexManagement` は監査ログの索引の管理でも使われている。添付の段階を入れると、両方の画面の動きに影響する。ページの段階の進み具合と完了はこれまでどおり既存の hook が出せばよい
- ページの段階の失敗では、既存の hook が `RebuildingFailed` を通知するので、続いて届く `AttachmentRebuildingFailed` は通知しない (同じ文の通知が 2 回出るのを防ぐ)
- 失敗の理由は、`AttachmentRebuildingFailed.error` (英語の文) をそのまま出す (上流の未決事項 4)。管理者向けで、文のままでも原因を追える

### 4.7 設定の区画は、環境変数で固定されているときは読み取り専用にする (上流への依頼 U2)

- 判断: 上流の GET `/config` に `useOnlyEnvVars` を足してもらい、true なら 4 つの設定を読み取り専用で出し、保存の操作を出さない。トークンの入力欄を足す (要件 5.1 / 5.5)
- 理由: GROWI.cloud では運用側が 4 つの設定を環境変数で固定し、利用組織の管理者に上書きさせない。いまの GET はそれを返さないので、画面が保存できたように見えてしまう。トークンは機能が有効になる条件の 1 つなので、入力欄が無いと自前の運用では画面から機能を有効にできない (2026-11-20 に利用者と決定)

### 4.8 管理画面の外の機能の判定は SSR の値、管理画面の中は設定の API の値を使う

- 判断: 検索結果画面と添付ファイル一覧は `isAttachmentFullTextSearchEnabledAtom` (SSR の値) を使う。管理画面の設定・作り直しの選択・失敗の区画は、どれも設定の取得 API の `isAttachmentFullTextSearchEnabled` を使い、atom を読まない
- 理由: 管理者以外は設定の API を呼べない。管理画面では、保存の直後に画面を読み込み直さずに切り替える必要がある。設定の API の値なら、保存の後の `mutate` で 3 つの区画がそろって切り替わる。作り直しの選択だけを atom で判定すると、初めて設定を保存した直後に「作り直しが必要」と案内しながら、添付を含める選択が読み込み直すまで出ず、ページだけの作り直しが走ってしまう

## 5. Design Synthesis

- **一般化**: 「行の中」と「プレビューの中」の添付ヒットは、どちらも「1 ページの添付ヒットの状態」を表示する同じ問題である。`useAttachmentHits(source, page)` 1 つにまとめ、取り方の違い (後から取るか、項目に入っているか) は `AttachmentHitsSource` で表した。既存部品への拡張も「差し込み口 1 つ」の形にそろえた (`extraContent` / `headerContent` / `additionalActions`)
- **作るか、使うか**: 新しいライブラリは使わない。無限読み込み・要求のまとめ・キャッシュは SWR、状態は Jotai、表示は Bootstrap と既存の部品で足りる
- **単純化**:
  - 前の設計の `activeFacetAtom`、`score` による並べ替え、再抽出の後の一覧の取り直し、`requiresReindex` の常時の通知、`AttachmentHitViewProps` への詰め替えをやめた。サーバの順と `IAttachmentHit` をそのまま使う
  - 実行中に機能が無効になった場合 (503) のために共有の状態を持たず、組ごとに `unavailable` として扱う。どの組も同じ 503 を受けるので、結果は同じになる
  - 既存の `useIndexManagement` を変えず、添付の段階だけを別の hook にした

## 6. 前の設計から変えたこと

- 「全体 / ページ / 添付」の 3 つのタブ (`SearchResultFacetTabs`) は、「ページ / 添付ファイル」の切り替えにした (上流 research.md 12)
- 呼び先を「apiv3 /search」としていたのは誤りで、ページ検索と添付だけの検索は apiv1 の `/_api/search` である
- 右ペインのカードを「プレビューの最上部」に置くことは要件から外し、形と置き場所は見た目の案で決める (2026-11-20 に利用者と決定)

## 参照

- 上流の設計: [../attachment-search-indexing/design.md](../attachment-search-indexing/design.md)
- 上流の判断の記録: [../attachment-search-indexing/research.md](../attachment-search-indexing/research.md) (8.7 速さ、10.1 見えない添付、12 `facet=all` をやめた理由、13 本文で使われていない添付)
- 元の調査: [../attachment-search/research.md](../attachment-search/research.md)
