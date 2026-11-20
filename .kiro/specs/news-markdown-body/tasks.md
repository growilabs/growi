# Implementation Plan

- [x] 1. メディア解決の基盤を用意する
- [x] 1.1 (P) resolveNewsMediaUrl 純関数を新規実装する
  - `features/news/utils/resolve-news-media-url.ts` に純関数 `(imagePath, feedUrl) => string | null` を新規実装する。https のみ・credentials/query/hash 拒否・同一オリジン・feed の `images/` **直下のみ**(単一セグメント。サブディレクトリ不許可)・許可拡張子 png/jpg/jpeg/webp/**gif**(mp4 は含めない)・`%` 含みパス拒否・例外を投げない。基準ディレクトリ名 `images/` は `features/news/consts.ts` の定数を参照する。クライアント(rehype プラグイン)から import するため `server/services/` ではなく共有 `utils/` に置く
  - `resolve-news-media-url.spec.ts` に境界マトリクス(ディレクトリ脱出・他リポジトリ配下・偽ディレクトリ・**サブディレクトリ(`images/sub/x.gif`)拒否**・http ダウングレード・credentials/query/hash・`%` 含みパス・gif 受理・mp4 拒否)を実装し全て green
  - _Boundary: resolveNewsMediaUrl_
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 1.2 FEED_URL を共有 consts へ移設する
  - `news-cron-service.ts` にハードコードされている `FEED_URL` を `features/news/consts.ts`(feature 直下・サーバ依存を含まない)へ移設し、cron とクライアント描画の双方が import する。cron から export する案は採らない(サーバ専用モジュールをクライアントバンドルに引き込むため)
  - 既存の cron 側 import が壊れていないことを typecheck で確認
  - _Boundary: FEED_URL const_
  - _Requirements: 3.1_

- [x] 2. opt-in ゲート(bodyFormat)を additive に通す
- [x] 2.1 (P) interface に bodyFormat を追加する
  - `interfaces/news-item.ts` の `INewsItem` / `INewsItemInput` に `bodyFormat?: string` を追加(literal `'markdown'` にしない。未知値も型で受ける)。typecheck が通る
  - _Boundary: news interfaces_
  - _Requirements: 1.1, 5.1_

- [x] 2.2 (P) feed-parser と model に bodyFormat を追加する
  - `feed-parser.ts` の zod に **`bodyFormat: z.string().optional()`** を追加(literal にしない。feed-parser はアイテム単位 safeParse で失敗アイテムを丸ごと skip するため、未知値を literal で弾くとニュース自体が消え Req 5.3 の前方互換に反する)。`news-item.ts` model に `bodyFormat`(String、任意、enum 制約なし)を追加
  - feed-parser.spec に「bodyFormat=markdown / 未指定 / 未知値(例 'mdx')」ケースを追加し、**未知値でもアイテムが取り込まれ bodyFormat がその値のまま保持される**(＝描画側が markdown 以外を従来描画にフォールバックできる)ことを確認
  - _Boundary: feed-parser schema / NewsItem model_
  - _Requirements: 1.1, 5.1, 5.2, 5.3_

- [x] 2.3 cron で bodyFormat を写経する
  - `news-cron-service.ts` の FeedItem→INewsItemInput 変換に `bodyFormat` を追加(body は従来どおり verbatim)
  - cron spec に「bodyFormat が保存される / 未指定なら undefined」ケースを追加し green
  - _Depends: 2.1, 2.2_
  - _Boundary: NewsCronService_
  - _Requirements: 1.1, 5.1_

- [x] 3. ニュース専用の制限描画パスを実装する
- [x] 3.1 (P) newsSanitizeSchema を定義する
  - `client/services/news-sanitize-schema.ts` に hast-util-sanitize 用スキーマを定義。design の確定スキーマに従う: tagNames = p/br/strong/em/del/a/code/pre/blockquote/ul/ol/li/**h1–h6**/hr/img/**table/thead/tbody/tr/th/td**。attributes = a[href,title]/img[src,alt,title](**code の className は許可しない**)。protocols = `{ href: ['http','https','mailto'], src: ['https'] }`(属性名キー。href は a、src は img のみが持つ)。**strip = null**(hast-util-sanitize は defaultSchema に浅くマージするため、省略すると `['script']` を継承して許可外要素がアンラップされる。`null` で許可外を子ごと除去)。style・on*・任意 class・iframe/video/input は不許可
  - `news-sanitize-schema.spec.ts`: `sanitize(tree, schema)` への契約テスト。許可タグ(表・見出し含む)が残り、iframe/video/script/style/input が除去され、**許可外要素が子ごと除去されアンラップで漏れない**(脚注 section の h2/ol が残らない)、on*/style/class/id が剥がれ、javascript: リンクが無効化され、img src の http(非 https)が除去されることを検証
  - _Boundary: newsSanitizeSchema_
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 4.3_

- [x] 3.2 rehypeResolveNewsMedia プラグインを実装する
  - `client/services/rehype-resolve-news-media.ts` に rehype プラグインを実装。hast の img ノードを走査し、src を `resolveNewsMediaUrl(src, FEED_URL)` で解決、成功時は絶対 URL に書換え、失敗時はノードを除去(本文の残りは保持)
  - `rehype-resolve-news-media.spec.ts`: 相対パスが絶対 URL に書き換わる / 不適合 src のノードが除去される / 本文の他要素は残る
  - _Depends: 1.1, 1.2_
  - _Boundary: rehypeResolveNewsMedia_
  - _Requirements: 3.1, 3.2, 4.1_

- [x] 3.3 newsMarkdownOptions を組み立てる
  - `client/services/news-markdown-options.tsx`(JSX を含むため `.tsx`)に react-markdown 用オプションを構成。remarkPlugins: remark-gfm, remark-breaks。rehypePlugins: rehypeShiftNewsHeadings → rehypeResolveNewsMedia → rehype-sanitize(newsSanitizeSchema)。**rehype-raw は含めない**。components: img は lazy/referrerPolicy=no-referrer/max-height/onError 非表示、a は**外部 http(s) リンクのみ** target=_blank rel=noopener noreferrer(fragment/mailto/href 剥離済みは同タブ)
  - options 単体の spec は作らず、観測境界の `NewsMarkdownBody.spec.tsx` でカバー(生 HTML 非 parse・img 属性・見出しシフト・リンク方針・sanitize 結線の mutation ガード)
  - _Depends: 3.1, 3.2_
  - _Boundary: newsMarkdownOptions_
  - _Requirements: 1.3, 2.2, 2.4, 3.4, 4.2_

- [x] 3.4 NewsMarkdownBody コンポーネントを実装する
  - `client/components/NewsMarkdownBody.tsx` を新設。react-markdown + react-error-boundary の薄いラッパ + newsMarkdownOptions で body(ロケール解決済み文字列)を描画。ErrorBoundary で最悪時もページを保つ
  - `.wiki` を流用しないため、`NewsMarkdownBody.module.scss` にニュース本文の最小スタイル(テーブル罫線/パディング・リンク色/下線、Bootstrap CSS 変数でテーマ対応)をラッパ1クラスの子孫セレクタで用意する
  - ErrorBoundary のフォールバックは `fallbackRender={() => null}`(`fallback={null}` は react-error-boundary@3 が `isValidElement` 検査で無効値として throw するため不可)
  - `NewsMarkdownBody.spec.tsx`: 見出し/リスト/強調/リンク/複数画像が要素として描画される、生 HTML(<video>,<script>)が実行・描画されない、非同一オリジン/非 https img が出ない、取得失敗で当該 img のみ消える、外部 http(s) リンクが target=_blank rel=noopener noreferrer で fragment/mailto は同タブ、sanitize 結線の mutation ガード(input/脚注が漏れない)
  - _Depends: 3.3_
  - _Boundary: NewsMarkdownBody_
  - _Requirements: 1.3, 1.4, 2.2, 2.4, 3.4, 4.1, 4.2, 4.3_

- [x] 4. NewsFeed に描画分岐を配線する
- [x] 4.1 bodyFormat による描画分岐を実装する
  - `NewsFeed.tsx` の body 描画を「`item.bodyFormat === 'markdown'` なら `<NewsMarkdownBody>`、それ以外は従来の pre-wrap プレーンテキスト」に分岐。サイドバー(NewsItem.tsx)は変更しない
  - `NewsFeed.spec.tsx` に追加: bodyFormat=markdown で Markdown 描画される(観測: h4 見出し等)/ 未指定で従来プレーンテキスト描画のまま / **画像なし Markdown 本文でも描画され壊れない**(markdown 経路を実際に通す)/ 本文欠如でも item は描画される
  - _Depends: 2.1, 3.4_
  - _Boundary: NewsFeed_
  - _Requirements: 1.1, 1.2, 5.1, 5.4_

- [x] 5. 検証と敵対的テスト
- [x] 5.1 セキュリティ敵対的テストを追加する
  - XSS ベクタ(`<img onerror>`・`javascript:` href・`<iframe>`・`data:` src・HTML コメント内スクリプト・`<style>`・`on*` 属性)が全て無害化されることを NewsMarkdownBody / newsSanitizeSchema のテストで網羅
  - _Depends: 3.4_
  - _Boundary: security tests_
  - _Requirements: 2.1, 2.2, 2.3, 4.3_

- [x] 5.2 全体検証と手動スモーク準備を行う
  - `turbo run lint --filter @growi/app` 相当(biome + typecheck)と対象テスト全件が green
  - `tmp/scripts/insert-demo-news.js` に Markdown 本文ケース(見出し+リスト+複数画像+GIF、不正 img 混在、bodyFormat 未指定の従来ケース)を追加し、手動スモーク可能な状態にする(実画像は growi-news-feed の `images/` に置くか、スモーク用に base URL 差し替え手段を用意する前提)
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1_
