# Design Document: news-feed-images

## Overview

**Purpose**: 配信フィードに追加される画像情報を安全に取り込み、`/_news` の各ニュースアイテムに画像を表示する。GROWI 運営者はリリース告知等を視覚的に伝えられるようになる。

**Users**: 全ログインユーザーが `/_news` で画像付きニュースを閲覧する。GROWI 運営者はフィードリポジトリに画像を置くだけで全インスタンスに配信できる。

**Impact**: 既存 news 基盤(spec: `news-inappnotification`)への additive 拡張。取込パイプライン(parser → cron → model)とフィード表示(NewsFeed)に画像のサポートを追加する。API・サイドバー・既存データは不変。

### Goals

- フィード画像の安全な取込(検証つき)と `/_news` での表示
- 新規外部依存ゼロ・マイグレーション不要・追加設定不要
- フィード側(スキーマ v1.1)と独立してリリース可能(v8 前 master マージ)

### Non-Goals

- サイドバーへのサムネイル表示 / 画像のサーバ側保存・プロキシ配信 / lightbox / `width`・`height` による CLS 予約
- 配信側リポジトリ(growi-news-feed)の変更(スキーマ・CI・画像配置)— 後続の別作業

## Boundary Commitments

### This Spec Owns

- `image` フィールドの取込検証(path 文法・URL 解決・封じ込め)と `NewsItem.image` のデータ形状
- `/_news` の画像スロットの描画・フォールバック挙動

### Out of Boundary

- news 基盤(cron スケジュール・既読管理・ページネーション等)— 親 spec `news-inappnotification` が正
- フィード側の画像配置・スキーマ定義・CI(アプリ側の path 文法・上限値が正となり、配信側が追従する)

### Allowed Dependencies

- 既存 news feature モジュール(`feed-parser`, `news-cron-service`, `news-item` model, `NewsFeed`)への編集
- 既存ユーティリティ: `resolveLocaleText`(alt のロケール解決)、`isSafeHttpUrl`(描画時再検証)
- 標準 `URL` API のみ(新規 npm 依存禁止)

### Revalidation Triggers

- `NewsItem.image` の形状変更(width/height 追加など)→ 配信側スキーマ・本 spec のテストの再確認
- `FEED_URL` の移転 → 封じ込め基準ディレクトリが変わるため検証テストの再確認
- 画像のサーバ側プロキシ導入 → 本設計の hotlink 前提(Req 2.5, 3.1)全体の再設計

## Architecture

### Existing Architecture Analysis

取込は「zod パーサ(per-item fail-soft)→ cron(URL 取得・検証)→ Mongoose bulkWrite」、表示は「lean() 素通しの list API → SWR → NewsFeed」という一方向パイプライン。画像は各段への additive な変更のみで通し、新コンポーネントは検証純関数と `NewsImage` の 2 つに限定する。

### 依存方向

```
consts(FEED_URL) → resolve-image-url(純関数) → news-cron-service
FeedItemSchema(zod) → feed-parser → news-cron-service
NewsItem model ← news-cron-service(書込) / news-service(読取・変更なし)
NewsImage(UI) ← NewsFeed
```

各要素は左からのみ import する。`resolve-image-url` は feed URL を**引数で受け取り**、`FEED_URL` を import しない(テスト時に任意の base を注入可能にする)。

### Technology Stack

| Layer | Choice | Role in Feature | Notes |
|-------|--------|-----------------|-------|
| Validation | zod(既存) | `image` フィールドの文法検証 | 新規依存なし |
| URL 解決 | 標準 `URL` | 相対パス解決・封じ込め検証 | Node/ブラウザ共通、ESM 安全 |
| Data | Mongoose nested schema | `NewsItem.image` | `_id: false`, `default: undefined` |
| UI | React(既存 NewsFeed に追加) | `NewsImage` コンポーネント | onError state を隔離、`key={url}` remount |

## File Structure Plan

### New Files

```
apps/app/src/features/news/
├── server/services/
│   ├── resolve-image-url.ts        # 純関数: (path, feedUrl) => string | null(https + images/ 封じ込め)
│   ├── resolve-image-url.spec.ts   # 境界マトリクス(拒否側・許可側を対で検証)
│   └── feed-parser.spec.ts         # image 文法境界(従来 parser は cron spec 経由の間接テストのみだった)
├── client/utils/
│   └── is-safe-http-url.ts         # NewsFeed 内ローカル定義から抽出(NewsFeed と NewsImage で共有)
└── client/components/
    ├── NewsImage.tsx               # 画像スロット: lazy / no-referrer / onError 非表示 / isSafeHttpUrl 再検証
    └── NewsImage.spec.tsx          # 表示 / 非表示 / onError リセット
```

### Modified Files

- `server/services/feed-parser.ts` — `FeedItemSchema` に `image { path, alt? }` を追加(厳格 pattern + 長さ上限)。`.catch(undefined)` によるフィールド単位 fail-soft + warn ログ
- `server/services/news-cron-service.ts` — ingest 時に `resolveNewsImageUrl` を適用し、成功時のみ `image` を保存(失敗は warn ログ + image なし)
- `server/services/news-service.ts` — `upsertNewsItems` の `$set` に image を追加。**image が無い入力は明示的 `$unset`**(ドライバは `$set: { image: undefined }` を落とすため、フィードから画像が消えた際の stale image 除去に必須)
- `server/models/news-item.ts` — `image` nested schema(`_id: false`, `default: undefined`)
- `interfaces/news-item.ts` — `INewsItemImage { url, alt? }` を新設し `INewsItem.image?` / `INewsItemInput.image?` に適用(input は cron 解決済みの絶対 URL を運ぶ。生の path は cron より先へ流さない)
- `client/components/NewsFeed.tsx` — body 下に `<NewsImage key={url}>` スロットを追加。`isSafeHttpUrl` を共有 util の import に変更
- 既存 spec ファイル(`news-cron-service.spec.ts`, `news-service.spec.ts`, `NewsFeed.spec.tsx`)— 画像ケースの追加

## Requirements Traceability

| Requirement | Summary | Components |
|-------------|---------|------------|
| 1.1 | 相対パス → 絶対 URL 解決・保存 | resolveNewsImageUrl, NewsCronService |
| 1.2 | https + images/ 封じ込め | resolveNewsImageUrl |
| 1.3 | path 文法・長さ上限 | FeedItemSchema(zod) |
| 1.4 | 検証失敗 → 画像なし取込 + warn | NewsCronService |
| 1.5 | 画像なし → 空 image を作らない | NewsCronService, NewsItem model |
| 2.1 | 本文下の専用スロット表示 | NewsFeed, NewsImage |
| 2.2 | alt のロケール解決 | NewsImage(resolveLocaleText 再利用) |
| 2.3 | 表示高さ上限 | NewsImage |
| 2.4 | 遅延読み込み | NewsImage(`loading="lazy"`) |
| 2.5 | リファラ非送信 | NewsImage(`referrerPolicy="no-referrer"`) |
| 2.6 | 描画時 http(s) 再検証 | NewsImage(isSafeHttpUrl) |
| 3.1 | 取得失敗 → 当該画像のみ非表示 | NewsImage(onError) |
| 3.2 | 失敗状態を次の画像に引き継がない | NewsFeed(`key={url}` remount) |
| 4.1–4.3 | 互換性・リリース独立性 | 全体(additive スキーマ、API 素通し、サイドバー不変) |

## Components and Interfaces

| Component | Layer | Intent | Req | Contracts |
|-----------|-------|--------|-----|-----------|
| resolveNewsImageUrl | Server / Service | path → 検証済み絶対 URL(失敗は null) | 1.1, 1.2 | Service |
| FeedItemSchema(拡張) | Server / Service | image の文法検証 | 1.3 | Service |
| NewsCronService(拡張) | Server / Service | ingest 時の画像検証適用と保存 | 1.1, 1.4, 1.5 | Batch |
| NewsItem model(拡張) | Server / Model | image サブドキュメント | 1.5, 4.2 | State |
| NewsImage | Client / UI | 画像スロット描画 + フォールバック | 2.1–2.6, 3.1 | State |
| NewsFeed(拡張) | Client / UI | スロット配置 + remount キー | 2.1, 3.2 | — |

#### resolveNewsImageUrl

| Field | Detail |
|-------|--------|
| Intent | 相対パスをフィード基準で解決し、https + フィードディレクトリ配下 `images/` を強制する純関数 |
| Requirements | 1.1, 1.2 |

##### Service Interface

```typescript
/**
 * @returns 検証済みの絶対 URL 文字列。検証失敗時は null(呼び出し側が warn ログ + 画像なし取込)
 */
export const resolveNewsImageUrl = (
  imagePath: string,
  feedUrl: string,
): string | null;
```

- Preconditions: `imagePath` は zod 検証済み(ただし本関数は zod を信頼せず単独でも安全)
- Postconditions: 戻り値が non-null なら `https:` かつ pathname が `<feedDir>/images/` で始まる(feedDir = feedUrl の最終セグメントを除いたパス、末尾スラッシュ付き prefix 比較)
- Invariants: `FEED_URL` を import しない(base は引数注入)。例外を投げない(不正入力は null)

**Implementation Notes**
- 封じ込めは `new URL(imagePath, feedUrl)` の解決**後**の pathname で判定する(文字列 prefix 比較は `/images-evil/` 偽装があるため、必ずディレクトリ境界 `/` を含めて比較)
- `growilabs.github.io` は共有オリジンのため origin 比較だけでは不十分(Codex レビュー知見、research.md 参照)

#### FeedItemSchema 拡張(zod)

```typescript
image: z.object({
  // 英数字・._- のみのファイル名、拡張子 png/jpg/jpeg/webp、先頭 "images/" 固定
  path: z.string().max(200).regex(/^images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/),
  alt: z.record(z.string().max(500)).optional(),
}).optional()
```

`%`・`\`・`?`・`#`・`..`・空セグメント・絶対/protocol-relative パスはこの pattern で構文的に到達不能。SVG は許可しない。

#### NewsItem model 拡張

```typescript
image: {
  type: new Schema({
    url: { type: String, required: true },
    alt: { type: Map, of: String },
  }, { _id: false }),
  default: undefined,  // 空 {} の実体化防止
}
```

#### NewsImage

| Field | Detail |
|-------|--------|
| Intent | 検証済み画像の描画と取得失敗時の graceful degradation |
| Requirements | 2.1–2.6, 3.1 |

```typescript
type Props = {
  url: string;
  alt?: Record<string, string>;  // resolveLocaleText で解決
};
```

- `isSafeHttpUrl(url)` が false なら null を返す(2.6)
- `<img loading="lazy" referrerPolicy="no-referrer">`、`max-height` + `object-fit: contain`(2.3–2.5)
- `onError` → `useState` で非表示(3.1)。**呼び出し側(NewsFeed)が `key={url}` を付与**することで URL 変更時に remount され error state がリセットされる(3.2)

## Error Handling

| 段階 | 失敗 | 応答 |
|------|------|------|
| zod(parser) | image 文法不正 | image フィールドのみ drop、アイテムは取込続行(既存 per-item fail-soft の内側でフィールド単位の fail-soft) |
| cron(resolve) | 封じ込め違反・URL 解決不能 | warn ログ + image なしで保存(1.4) |
| 描画 | 画像取得失敗(onError) | 当該画像のみ非表示、テキストは維持(3.1) |

## Testing Strategy

### Unit Tests(resolve-image-url.spec.ts — 境界マトリクス)

拒否側: ディレクトリ脱出を試みる相対パス、`https://growilabs.github.io/other-repo/images/x.png` 相当に解決される入力、偽ディレクトリ(`/growi-news-feed-evil/images/`)、http へのダウングレード、解決不能な入力。許可側: 正常な `images/*.png` 等が期待どおりの絶対 URL になること。

### Unit Tests(feed-parser.spec.ts 追加分)

`%2e%2e`・`\`・`?`・`#`・絶対パス・protocol-relative・`.svg`・長さ超過の拒否、正常 image の受理、**image 不正でもアイテム自体は取り込まれる**こと(フィールド単位 fail-soft)。

### Unit Tests(news-cron-service.spec.ts 追加分)

image 付きアイテムの `image.url` が絶対 URL で保存される / 封じ込め違反は image なしで保存 + warn / image なしアイテムに空 `{}` が生えない。

### Component Tests(NewsImage.spec.tsx / NewsFeed.spec.tsx 追加分)

画像あり(url/alt/lazy/no-referrer)、不正スキーム url 非表示、onError 非表示、**URL 変更で error state がリセットされる**(remount)、NewsFeed で image なしアイテムにスロットが出ない。

### 手動スモーク(レイヤ3、tmp/news-feature-plan.md 記載の手順)

デモスクリプトによる DB 直接投入(死 URL・巨大画像・ページ切替リセット)と、FEED_URL 一時書き換えによる cron 実働確認。

## Security Considerations

- **二段検証**: ingest(zod 文法 + resolve 封じ込め)と描画(`isSafeHttpUrl`)。DB 内容がパーサ以外から投入される可能性への defense-in-depth
- **封じ込め**: 共有オリジン(github.io)上の他サイトを指せない。SVG・http・credentials 付き URL は構文または解決段階で拒否
- **プライバシー**: `referrerPolicy="no-referrer"` でインスタンス URL を配信元に漏らさない
- body のプレーンテキスト描画は不変(本 spec は body の描画方式に触れない)

## アーキテクチャ特性マッピング

12 特性の詳細マッピング(◎9 / △2 / —1)と各トレードオフの理由は `tmp/news-feature-plan.md`「アーキテクチャ特性マッピング(2026-07-23)」を正とする。要点: セキュリティ(二段検証 + 封じ込め)、互換性(additive のみ・リリース順序自由)、耐障害性(全段 fail-soft)。意識的トレードオフ: クライアント egress 制限環境での画像欠落(graceful degradation)、CLS 非ゼロ(max-height で有界)。
