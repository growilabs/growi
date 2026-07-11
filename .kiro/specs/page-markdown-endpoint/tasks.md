# Implementation Plan

> 方針: 新規変更は TDD（テスト先行・red→green）。認可は既存 middleware / viewer ファインダを再利用（並行実装しない）。i18n は英語ファーストで他言語翻訳は後続。純関数（url/parse/build）を先に固め、route 層のレスポンスヘルパで組み立てる。
>
> ベース: 実装ブランチは `origin/dev/8.0.x` から切る（master ではない）。dev/8.0.x 固有の前提として、(1) `routes/index.js` は ESM 化済み（`export const setup`、子ルーターは `import { setup as … }`、catch-all は `:402`/`:403`、手前に `/vault.git`）→ 新ルートも名前付き export ＋ `import` で組む、(2) `findPageAndMetaDataByViewer` が bookmark 集計を Prisma で行う（認可契約は不変）→ この finder を通る結合テストは bootstrap で Prisma 初期化が要る。詳細は research.md「dev/8.0.x 再ベース」節。

- [ ] 1. Foundation: 共有の純関数ユーティリティ（テスト先行）
- [x] 1.1 (P) `.md` URL 生成ユーティリティ
  - permalink 形（`/{pageId}.md`）とパス形（`{path}.md`）を生成する純関数を、先にユニットテストを書いてから実装する。
  - パス形はクエリ／ハッシュがある場合その**前**に `.md` を挿入する。
  - Done: `(pageId または path, origin)` を与えると期待どおりの `.md` URL を返し、クエリ/ハッシュ付きの端ケースもテストが green。
  - _Requirements: 6.1, 7.2, 7.3_
  - _Boundary: pageMarkdownUrl_

- [x] 1.2 (P) Markdown リクエストの意図解釈（純関数）
  - リクエストを `none` / `permalink` / `path` に分類し、`explicit`（`Accept: text/markdown` または `?format=md`）か `.md` サフィックスかを表すフラグを返す純関数を、テスト先行で実装する。
  - permalink 判定は `isPermalink` / `isValidObjectId`。**元のパスは加工せず**そのまま返し、`explicit=false`（サフィックス）時の「literal→base」への落とし込みは 2.2 が担う（ここでは strip しない＝passthrough 用の元パスを失わない）。
  - Done: サフィックス／`Accept`／`?format=md`／permalink／`.md.md` を網羅するテーブルテストが green。
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.4_
  - _Boundary: parseMarkdownRequest_

- [x] 1.3 Markdown 本文＋footer 組立（純関数）
  - 本文に近傍ナビゲーション footer（正規 URL・permalink・親・直下子リンク＋直下子総数・子孫合計 descendantCount・兄弟・更新日時／更新者）を連結する純関数と、403/404 用の案内 Markdown を返す関数を、テスト先行で実装する。footer の列挙上限定数 `MARKDOWN_FOOTER_MAX_LINKS` を定義する。
  - ページ一覧 API 案内を件数不問で常に含め、上限超過時は総数と残数を明記。ルートでは親・兄弟を省略。空ページは本文の代わりに「本文なし」の一文＋footer。
  - Done: footer 各要素と 4.6／4.7／4.8／5.1–5.3／3.5（エラー本文の案内）をユニットテストで検証。
  - _Depends: 1.1_
  - _Requirements: 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3_
  - _Boundary: buildPageMarkdown_

- [ ] 2. Core: サーバ側データ取得とレスポンス組立
- [ ] 2.1 (P) page-listing にメモリ非全件の子取得＋viewer-aware count を追加
  - `limit` を引数で受け取り最大 `limit` 件の viewer フィルタ済み直下子を返す取得と、`addViewerCondition` を共有した `countDocuments({ parent: id })` による正確な直下子総数を、統合テスト先行で追加する（既存の全件返しは本用途に使わない）。
  - Task 1 のユーティリティに依存しない（page-listing サービス境界のみ）ため foundation と並行実行可能。
  - Done: 統合テストで、返る子が `limit` 件に制限され、かつ総数が閲覧不可ページを除いた正確な件数になることを確認。
  - _Requirements: 4.3, 4.7_
  - _Boundary: page-listing service_

- [ ] 2.2 respond-with-page-markdown レスポンスヘルパ
  - 意図（1.2）に従い解決する（permalink は id、path は literal→base の順に `findPageAndMetaDataByViewer` を使用。literal→base の判定はここが所有）。
  - finder は populate しないため `initLatestRevisionField()`＋`populateDataToShowRevision(false)` で本文・更新者を populate し、`page.parent` から親を追加クエリで解決。子・兄弟は 2.1 を `limit=MARKDOWN_FOOTER_MAX_LINKS` で呼び、兄弟は自分を除外。更新者は `serializeUserSecurely` を通す。
  - 結果を `ok` / `forbidden` / `notFound` / `passthrough`（literal `.md` 実在ページ）で返し、`buildPageMarkdown` で本文を組み立てる。
  - Done: 公開ページで本文＋footer 付き `ok`、権限外は `forbidden`＋案内、非存在は `notFound`＋案内、literal `.md` は `passthrough` を返す（3.1 の統合テストで検証）。
  - _Depends: 1.1, 1.2, 1.3, 2.1_
  - _Requirements: 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3_
  - _Boundary: respondWithPageMarkdown_

- [ ] 3. Integration: HTTP ルート・発見リンク・UI
- [ ] 3.1 page-markdown ルートを catch-all 直前に登録
  - GET のみ対象、`parseMarkdownRequest` が `none` なら即 `next()`。`accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true })`＋`loginRequired`（ゲスト許可）を合成し `respondWithPageMarkdown` を呼ぶ。`text/markdown; charset=utf-8` で 200/403/404、`passthrough` は `next()`。`Accept` はメディアタイプ明示一致のみで判定（`req.accepts` の `*/*` 誤爆を避ける）。`routes/index.js`（ESM 化済み。名前付き export を `import` して `setup` 内で `app.use`）の `:402`/`:403` catch-all の直前に登録。
  - Done: `/{pageId}.md`・`{path}.md`・`Accept` 付き平文 URL が 200 Markdown、権限外 403、非存在 404、ゲスト許可時は匿名 200・不許可時はログイン挙動、literal `.md` は HTML passthrough、通常ページの HTML 配信が維持されることを supertest 統合テストで確認。
  - _Depends: 2.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: PageMarkdownRoute, routes/index.js_

- [ ] 3.2 (P) 機械向け発見リンク（alternate link ＋ Link ヘッダ）
  - `[[...path]]` の `<Head>` に `<link rel="alternate" type="text/markdown">` を追加。`pageId` があれば permalink 形、無ければ（空ページ等で props に `_id` が無い）`currentPathname` から path 形にフォールバック。`Link` ヘッダは GSSP で、空ページの早期 return より前のスコープの `_id` を使って設定。
  - Done: ページ HTML の `<head>` に Markdown 版 alternate が出力され、空ページでは path 形になり、`Link` ヘッダも（本文 CSR ページ含め）付与される。
  - _Depends: 1.1_
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: Page Head, page-data-props_

- [ ] 3.3 (P) CopyDropdown に「Markdown URL (.md)」項目＋英語ロケール
  - 既存 CopyDropdown に項目を追加し、値は `{path}.md`（無条件に `.md` を付与し解決はサーバに委ねる）。共有リンク表示モードでは非表示。`en_US` の `commons.json` に `copy_to_clipboard."Markdown URL"` を追加（他 4 言語の翻訳は英語ファースト方針により後続）。
  - Done: 通常ページで項目が表示され `{path}.md` をコピーでき、共有リンクモードでは非表示になることをコンポーネントテストで確認。
  - _Depends: 1.1_
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: CopyDropdown_

- [ ] 4. Validation: 結合と回帰
- [ ] 4.1 エンドツーエンド結合と回帰検証
  - 3 つの URL 形態、ゲスト／PAT 経路、空（コンテナ）ページのナビ中心 Markdown、populate 回帰（本文＋更新者名が含まれる）、footer の直下子総数と子孫合計 descendantCount の併記＋上限超過時の残数明記、メモリ非全件（子は最大 N 件ロード・総数は正確）、interception 登録順序による通常 HTML 配信への非干渉、を通しで検証する。
  - Done: 上記シナリオがすべて green。
  - _Depends: 3.1, 3.2, 3.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4_
