# Implementation Plan

- [ ] 1. メディア解決の基盤を用意する
- [ ] 1.1 (P) resolveNewsMediaUrl 純関数を再導入する
  - PR #11512 の `resolve-image-url.ts` を `server/services/resolve-news-media-url.ts` として移植し、許可拡張子を png/jpg/jpeg/webp/**gif** に(mp4 は含めない)調整する。`(imagePath, feedUrl) => string | null`、https のみ・credentials/query/hash 拒否・同一オリジン・feed の images ディレクトリ配下封じ込め・`%` 含みパス拒否・例外を投げない
  - `resolve-news-media-url.spec.ts` に境界マトリクス(ディレクトリ脱出・他リポジトリ配下・偽ディレクトリ・http ダウングレード・gif 受理・mp4 拒否)を実装し全て green
  - _Boundary: resolveNewsMediaUrl_
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 1.2 FEED_URL を export し描画側から参照可能にする
  - `news-cron-service.ts` の `FEED_URL` 定数を export(または `consts.ts` へ移設)し、クライアント描画から import できるようにする
  - 既存の cron 側 import が壊れていないことを typecheck で確認
  - _Depends: なし_
  - _Boundary: FEED_URL const_
  - _Requirements: 3.1_

- [ ] 2. opt-in ゲート(bodyFormat)を additive に通す
- [ ] 2.1 (P) interface に bodyFormat を追加する
  - `interfaces/news-item.ts` の `INewsItem` / `INewsItemInput` に `bodyFormat?: 'markdown'` を追加。typecheck が通る
  - _Boundary: news interfaces_
  - _Requirements: 1.1, 5.1_

- [ ] 2.2 (P) feed-parser と model に bodyFormat を追加する
  - `feed-parser.ts` の zod に `bodyFormat: z.literal('markdown').optional()` を追加。`news-item.ts` model に `bodyFormat`(enum: 'markdown'、任意、default 無し)を追加
  - feed-parser.spec に「bodyFormat 有り/無し/不正値」ケースを追加し、不正値でもアイテム自体は取り込まれる(フィールドは落ちる)ことを確認
  - _Boundary: feed-parser schema / NewsItem model_
  - _Requirements: 1.1, 5.1, 5.2, 5.3_

- [ ] 2.3 cron で bodyFormat を写経する
  - `news-cron-service.ts` の FeedItem→INewsItemInput 変換に `bodyFormat` を追加(body は従来どおり verbatim)
  - cron spec に「bodyFormat が保存される / 未指定なら undefined」ケースを追加し green
  - _Depends: 2.1, 2.2_
  - _Boundary: NewsCronService_
  - _Requirements: 1.1, 5.1_

- [ ] 3. ニュース専用の制限描画パスを実装する
- [ ] 3.1 (P) newsSanitizeSchema を定義する
  - `client/services/news-sanitize-schema.ts` に hast-util-sanitize 用スキーマを**ゼロベースで**定義(recommended-whitelist は継承しない)。許可タグ: p/br/strong/em/del/a/code/pre/blockquote/ul/ol/li/h2/h3/h4/hr/img。許可属性: a[href,title]/img[src,alt,title]/code[className(言語)]。protocols: a[href]=http,https,mailto / img[src]=https。style・on*・任意 class・iframe/video/script は不許可
  - `news-sanitize-schema.spec.ts`: 許可タグが残り、iframe/video/script/style/on* が除去され、javascript: リンクが無効化され、img src の https が強制されることを検証
  - _Boundary: newsSanitizeSchema_
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 4.3_

- [ ] 3.2 rehypeResolveNewsMedia プラグインを実装する
  - `client/services/rehype-resolve-news-media.ts` に rehype プラグインを実装。hast の img ノードを走査し、src を `resolveNewsMediaUrl(src, FEED_URL)` で解決、成功時は絶対 URL に書換え、失敗時はノードを除去(本文の残りは保持)
  - `rehype-resolve-news-media.spec.ts`: 相対パスが絶対 URL に書き換わる / 不適合 src のノードが除去される / 本文の他要素は残る
  - _Depends: 1.1, 1.2_
  - _Boundary: rehypeResolveNewsMedia_
  - _Requirements: 3.1, 3.2, 4.1_

- [ ] 3.3 newsMarkdownOptions を組み立てる
  - `client/services/news-markdown-options.ts` に react-markdown 用オプションを構成。remarkPlugins: remark-gfm, remark-breaks。rehypePlugins: rehypeResolveNewsMedia → rehype-sanitize(newsSanitizeSchema)。**rehype-raw は含めない**。components: img は lazy/referrerPolicy=no-referrer/max-height/onError 非表示、a は target=_blank rel=noopener noreferrer
  - 単体で「生 HTML が parse されない」「img が指定属性で出る」ことを確認できる最小テスト
  - _Depends: 3.1, 3.2_
  - _Boundary: newsMarkdownOptions_
  - _Requirements: 1.3, 2.2, 2.4, 3.4, 4.2_

- [ ] 3.4 NewsMarkdownBody コンポーネントを実装する
  - `client/components/NewsMarkdownBody.tsx` を新設。react-markdown(または RevisionRenderer 相当)+ newsMarkdownOptions で body(ロケール解決済み文字列)を描画。ErrorBoundary で最悪時もページを保つ
  - `NewsMarkdownBody.spec.tsx`: 見出し/リスト/強調/リンク/複数画像が要素として描画される、生 HTML(<video>,<script>)が実行・描画されない、非同一オリジン/非 https img が出ない、取得失敗で当該 img のみ消える、外部リンクが target=_blank rel=noopener noreferrer
  - _Depends: 3.3_
  - _Boundary: NewsMarkdownBody_
  - _Requirements: 1.3, 1.4, 2.2, 2.4, 3.4, 4.1, 4.2, 4.3_

- [ ] 4. NewsFeed に描画分岐を配線する
- [ ] 4.1 bodyFormat による描画分岐を実装する
  - `NewsFeed.tsx` の body 描画を「`item.bodyFormat === 'markdown'` なら `<NewsMarkdownBody>`、それ以外は従来の pre-wrap プレーンテキスト」に分岐。サイドバー(NewsItem.tsx)は変更しない
  - `NewsFeed.spec.tsx` に追加: bodyFormat=markdown で Markdown 描画される / 未指定で従来プレーンテキスト描画のまま / 画像なし本文でも壊れない。サイドバーに変更が無いことを確認
  - _Depends: 2.1, 3.4_
  - _Boundary: NewsFeed_
  - _Requirements: 1.1, 1.2, 5.1, 5.4_

- [ ] 5. 検証と敵対的テスト
- [ ] 5.1 セキュリティ敵対的テストを追加する
  - XSS ベクタ(`<img onerror>`・`javascript:` href・`<iframe>`・`data:` src・HTML コメント内スクリプト・`<style>`・`on*` 属性)が全て無害化されることを NewsMarkdownBody / newsSanitizeSchema のテストで網羅
  - _Depends: 3.4_
  - _Boundary: security tests_
  - _Requirements: 2.1, 2.2, 2.3, 4.3_

- [ ] 5.2 全体検証と手動スモーク準備を行う
  - `turbo run lint --filter @growi/app` 相当(biome + typecheck)と対象テスト全件が green
  - /_news が完全 client 描画である前提(SSR 経路が無いこと)を実コードで最終確認し、必要なら design の注記を更新
  - `tmp/scripts/insert-demo-news.js` に Markdown 本文ケース(見出し+リスト+複数画像+GIF、不正 img 混在、bodyFormat 未指定の従来ケース)を追加し、手動スモーク可能な状態にする
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1_
