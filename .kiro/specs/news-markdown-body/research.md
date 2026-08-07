# Research & Gap Analysis

**Feature**: `news-markdown-body`
**Branch**: `feat/news-markdown-body`(master 起点、v8/ESM)
**Phase**: gap analysis(design 前)

## Summary

- Markdown + sanitize の**機構は既に全部揃っている**(react-markdown v9 / remark-gfm / remark-breaks / rehype-sanitize / hast-util-sanitize が apps/app の依存に存在)。新規 npm 依存は不要
- 真に欠けているのは2点だけ: **(a) ニュース専用の制限描画パス**(狭い sanitize スキーマ + body を描画に配線)、**(b) 同一オリジン画像 URL 解決**(この feature に解決純関数は存在しないため design の契約どおり新規実装する)
- GROWI Wiki レンダラは**流用しない方針が gap でも裏付けられた**: Wiki の許可範囲は `iframe`/`video` を許可し `rehype-raw`(`allowDangerousHtml: true`)で生 HTML を通す。外部フィード由来コンテンツにこれは過剰。ただし**同じ機構(react-markdown + RevisionRenderer + rehype-sanitize)を、狭いスキーマ + プラグイン最小で再利用**するのが正解(一から書かない)

## Requirement → Asset Map(gap タグつき)

| Req | 必要な技術要素 | 既存資産 | gap |
|-----|--------------|---------|-----|
| 1 (Markdown 描画) | body(`Record<locale,string>`)を Markdown 描画 | 現状 `NewsFeed.tsx:143` はプレーンテキスト `pre-wrap`。react-markdown / `RevisionRenderer`(単体再利用可)あり | **Constraint**: 描画を差し替え。opt-in ゲート(bodyFormat 相当)は新設 |
| 2 (制限許可範囲) | 狭い sanitize スキーマ・生 HTML 不可・非 http(s) リンク無効化 | rehype-sanitize + hast-util-sanitize あり。`deepmerge` でスキーマ合成する既存パターンあり(client renderer.tsx) | **Missing**: ニュース専用スキーマ。既存 `recommended-whitelist.ts` は広すぎ(iframe/video/raw HTML)ので流用不可 |
| 3 (画像 GIF・同一オリジン) | 相対パス→絶対 URL 解決 + https + images/ 封じ込め、拡張子 png/jpg/jpeg/webp/gif | `FEED_URL` 定数は `news-cron-service.ts:31`(未 export)。cron は body を verbatim コピー(解決ステップ無し) | **Missing**: resolve-image-url がこの branch に無い。要再導入 + Markdown 中の img 参照への適用 |
| 4 (失敗フォールバック) | 検証失敗で該当画像のみ除去/非表示、描画時再検証 | react-markdown の custom component / onError パターンは既存(Wiki の img: LightBox) | **Constraint**: ニュース用に軽量な img コンポーネント + 解決失敗ドロップ |
| 5 (互換・独立) | Markdown 無し=従来動作、旧版は生テキスト描画、マイグレ無し | body は既に `Record<locale,string>`。feed-parser は未知フィールドを落とす(前方互換の下地あり) | **Constraint**: opt-in ゲートで既存表示を保持 |

## 実装アプローチの選択肢

**全体方針(共通)**: react-markdown + `RevisionRenderer` の機構を再利用し、**ニュース専用の option generator**(remark-gfm + remark-breaks のみ、growi-directive/lsx/drawio/plantuml/mermaid/**rehype-raw は入れない**、狭い rehype-sanitize スキーマ)を新設する。= gap 分析の「Option C ハイブリッド」(機構は流用=Extend、スキーマとパスは新規=New)。

### 画像 URL 解決の位置(design で確定すべき KEY DECISION)

- **案I(取込時解決)**: cron が body の Markdown をパースし、相対 img パスを絶対 URL に解決+検証してから保存。長所=セキュリティ境界がサーバ、保存済み body は検証済み絶対 URL、クライアントは描画のみ。短所=cron で Markdown parse/serialize(本文の微細な変形リスク)、FEED_URL 依存の解決がサーバに閉じる
- **案II(描画時解決)**: 描画パイプラインに rehype プラグインを入れ、img src を解決+封じ込め検証(不適合はドロップ)。長所=body を verbatim 保存(変形なし)、解決ロジックがレンダラに一元化、SSR/クライアント両方で同一適用。短所=FEED_URL を描画側(定数 export)にも渡す必要、ingest 時の事前ゲートが無くなる(ただし sanitize がタグ/プロトコルの第2ゲート)
- 補足: `hast-util-sanitize` の defaultSchema は img src を http/https に制限するが**相対 URL は通す**ため、解決ステップが無いと相対パスは `/_news` 基準で誤解決される。どちらの案でも解決ステップは必須
- 推奨の方向性は design で判断(前回の news-feed-images は "取込時解決 + 描画時再検証" の二段。今回は Markdown 埋め込みのため案II 寄りに再検討の余地あり)

### 同一オリジン封じ込めの解決純関数

この feature に解決純関数は存在しないため、design の Service Interface(`resolveNewsMediaUrl`)の契約に沿って**新規実装**する。https のみ・同一オリジン・`images/` 配下封じ込め・拡張子 png/jpg/jpeg/webp/gif(mp4 除外)を満たし、境界テストも新規に書く。

## Effort / Risk

- **Effort: M(3〜7日)**。機構は流用でき新規依存ゼロだが、専用 sanitize スキーマ設計 + 画像解決の配線 + 敵対的テストがある(`/_news` は client 限定描画なので SSR 対応は不要 → 下記 design 確定事項を参照)
- **Risk: Medium**。技術は既知(rehype-sanitize は社内で実績)だが、**外部由来コンテンツの sanitize スキーマ設計はセキュリティ・クリティカル**。スキーマの穴が全インスタンスに波及するため、許可範囲の確定と敵対的テストが要

## design で確定した事項(旧 Research items)

1. 画像 URL 解決の位置 → **案II(描画時)を採択**(design KEY DECISION)
2. ニュース専用 sanitize スキーマの許可タグ・属性 → **design で確定**(h1–h6 + 表を許可、code.className は不許可、strip=['script','style'])
3. opt-in ゲート → **`bodyFormat`(zod は `z.string().optional()`、描画側で `=== 'markdown'` 判定)**
4. SSR 対応の要否 → **不要**。`/_news` の NewsFeed は `dynamic(..., { ssr: false })` で本文描画は client 限定
5. 解決純関数の実装 → **新規実装**(移植元は無し)
6. 画像の配置規約(レビュワー R-1) → **`images/` 直下のみのフラット構成**(サブディレクトリ不許可)。最小権限・配信側 CI の単純さを優先。サイズ上限はアプリ側で設けず配信側の運用/CI に委ねる。検証失敗の画像参照はアプリ側が警告なく除去する(配信前検証は配信側の責務)
