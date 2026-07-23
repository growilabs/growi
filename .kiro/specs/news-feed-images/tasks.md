# Implementation Plan

- [x] 1. サーバ側取込パイプラインを実装する
- [x] 1.1 (P) resolveNewsImageUrl 純関数を実装する
  - `server/services/resolve-image-url.ts` に `(imagePath, feedUrl) => string | null` を実装する。`new URL` で解決し、https かつフィードディレクトリ配下 `images/` への封じ込め(末尾スラッシュ付き prefix 比較)を強制、失敗は null を返し例外を投げない
  - `resolve-image-url.spec.ts` に境界マトリクス(拒否: ディレクトリ脱出・他リポジトリ配下・偽ディレクトリ `/growi-news-feed-evil/images/`・http・解決不能 / 許可: 正常 png/jpg/webp が期待の絶対 URL になる)を実装し、全ケースが green であること
  - _Boundary: resolveNewsImageUrl_
  - _Requirements: 1.1, 1.2_

- [x] 1.2 (P) FeedItemSchema に image 検証を追加する
  - `feed-parser.ts` の zod スキーマに `image { path(厳格 pattern・200 上限), alt?(各 500 上限) }` を optional で追加する
  - `feed-parser.spec.ts` に追加ケース(`%2e%2e`・`\`・`?`・`#`・絶対/protocol-relative パス・`.svg`・長さ超過の拒否 / 正常受理 / image 不正でもアイテム自体は取り込まれる)を実装し green であること
  - _Boundary: FeedItemSchema_
  - _Requirements: 1.3_

- [x] 1.3 (P) モデルと interface に image を追加する
  - `models/news-item.ts` に nested schema(`_id: false`, `default: undefined`)で `image { url, alt? }` を追加する
  - `interfaces/news-item.ts` に `INewsItemImage { url, alt? }` を新設し `INewsItem.image?` / `INewsItemInput.image?` に適用する(input は cron 解決済み URL を運ぶ)。typecheck が通ること
  - _Boundary: NewsItem model_
  - _Requirements: 1.5, 4.2_

- [x] 1.4 cron の ingest に画像解決を統合する
  - `news-cron-service.ts` で FeedItem → NewsItem 変換時に `resolveNewsImageUrl(item.image.path, FEED_URL)` を適用し、成功時のみ `image` を保存、失敗時は warn ログ + image なしで取込続行、image 無しアイテムには image フィールド自体を付けない
  - `news-cron-service.spec.ts` に追加ケース(絶対 URL 保存 / 封じ込め違反 → image なし + warn / 空 `{}` が実体化しない)を実装し green であること
  - _Depends: 1.1, 1.2, 1.3_
  - _Boundary: NewsCronService_
  - _Requirements: 1.1, 1.4, 1.5_

- [x] 2. クライアント表示を実装する
- [x] 2.1 (P) NewsImage コンポーネントを実装する
  - `client/components/NewsImage.tsx` を新設: `isSafeHttpUrl` 再検証(不合格は null)、`loading="lazy"`・`referrerPolicy="no-referrer"`・`max-height` + `object-fit: contain`、alt は `resolveLocaleText` で解決、`onError` で非表示
  - `NewsImage.spec.tsx` で表示属性・不正スキーム非表示・onError 非表示・URL 変更(remount)での error リセットを検証し green であること
  - _Boundary: NewsImage_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1_

- [x] 2.2 NewsFeed に画像スロットを統合する
  - `NewsFeed.tsx` の body 下に `item.image` がある場合のみ `<NewsImage key={url}>` を配置する(`key` により 3.2 の remount リセットを保証)
  - `NewsFeed.spec.tsx` に追加ケース(image 付きアイテムでスロット表示 / image なしでスロット不在)を実装し green、サイドバー(NewsItem.tsx)に変更が無いこと
  - _Depends: 1.3, 2.1_
  - _Boundary: NewsFeed_
  - _Requirements: 2.1, 3.2, 4.1, 4.3_

- [x] 3. 検証とスモーク準備
- [x] 3.1 全体検証とデモデータ整備を行う
  - `turbo run lint --filter @growi/app` 相当(biome + typecheck)と対象テスト全件が green であること
  - `tmp/scripts/insert-demo-news.js` に画像ケース(正常画像・死 URL・巨大縦長画像・alt 長文・画像なし混在)を追加し、レイヤ3 手動スモーク(tmp/news-feature-plan.md 記載)が実行可能な状態にする
  - _Depends: 1.4, 2.2_
  - _Requirements: 4.1, 4.2, 4.3_
