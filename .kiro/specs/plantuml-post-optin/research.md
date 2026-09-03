# Gap Analysis — plantuml-post-optin

対象要件: `.kiro/specs/plantuml-post-optin/requirements.md`（Req 1〜9）
調査日: 2026-07-31 / 対象バージョン: 8.0.1-RC.0（`dev/8.0.x` ライン）

## 1. 現状（既存実装の把握）

PlantUML描画は feature モジュール `apps/app/src/features/plantuml/` に集約されている。

- 描画変換（remark）: [plantuml.ts](../../../apps/app/src/features/plantuml/services/plantuml.ts) — 各図の先頭にテーマ（`carbon-gray-*.puml`）を前置し、`@akebifiky/remark-simple-plantuml` で `GET /svg/<deflate+base64>` URL を持つ `<plantuml src>` 要素を生成。`sanitizeOption`（tag `plantuml`, attr `src`/`GROWI_IS_CONTENT_RENDERING_ATTR`）も同ファイル。
- 表示: [PlantUmlViewer.tsx](../../../apps/app/src/features/plantuml/components/PlantUmlViewer.tsx) — 単純な `<img src>`。`onLoad/onError` で描画ステータス属性を制御（auto-scroll 連携）。
- 設定: `config-definition.ts` の `app:plantumlUri`（`PLANTUML_URI`、既定 `https://www.plantuml.com/plantuml`）。

**設定がクライアント描画へ届く経路（確立済みチェーン）**:
`config-definition.ts` → `pages/general-page/configuration-props.ts`（`getServerSideRendererConfigProps` L32 で `plantumlUri` をprops化）→ `interfaces/services/renderer.ts`（`RendererConfig.plantumlUri` L13）→ `pages/general-page/hydrate.ts`（`rendererConfigAtom` へ hydrate）→ `states/server-configurations/server-configurations.ts`（atom 既定 L169-182）→ `client/services/renderer/renderer.tsx`（remark plugin を view/preview/others の3箇所 L75-76/244-245/366-367 で登録、`components.plantuml = PlantUmlViewer`）。

**サーバ→外部HTTP**: axios。apiv3ルートから外部へ取得しバイナリを返す既存の相似例が [ogp.ts](../../../apps/app/src/server/routes/ogp.ts)（`axios.get/post` L63/109、ストリーム→バッファ変換、`responseType`）。プロジェクトは bare `axios` を Biome で制限、原則 `~/utils/axios` を使用。

**apiv3ルート追加規約**: feature 型ファクトリ（`features/mastra/server/routes` 例）を `server/routes/apiv3/index.js` に import + `router.use('/xxx', factory(crowi))` で登録。検証は `express-validator` + `apiV3FormValidator`。SVGを返すなら `res.type('image/svg+xml').send(...)`。

## 2. 要件 → 資産マップ（ギャップ）

| Req | 必要な要素 | 既存資産 | ギャップ判定 |
|---|---|---|---|
| 1 送信方式設定 | 新config `PLANTUML_HTTP_METHOD`（get/post）＋クライアント伝播 | 伝播チェーン確立済み | **Missing**（新key追加。下記6ファイル） |
| 2 POST描画 | 図ソースをbody送信する経路 | ogp.ts の外部POST相似例、plantuml.ts分岐点 | **Missing**（送信経路・plantuml.ts/Viewer分岐） |
| 3 後方互換(GET既定) | 既定GET維持 | 現行GET経路そのまま | Low（分岐で既定GET） |
| 4 SVG安全表示 | SVGサニタイズ or `<img>`維持 | rehype-sanitize（**markdown ASTのみ。非同期SVGは対象外**） | **Missing/Constraint**（インラインSVGは既存サニタイズ非適用） |
| 5 再描画キャッシュ | ソースハッシュでSVGキャッシュ | **汎用キャッシュ基盤なし**（lru-cache等未導入） | **Missing**（Map/LRU等を新設） |
| 6 エラー処理 | 図単位のエラー表示 | PlantUmlViewer `onError` 既存 | Low（拡張） |
| 7 テーマ維持 | テーマ前置 | plantuml.ts の theme prepend 既存 | Low（POSTでもbodyに載せる） |
| 8 auto-scroll連携 | 描画ステータス属性 | `GROWI_IS_CONTENT_RENDERING_ATTR` 既存 | Low（非同期fetchでも属性維持） |
| 9 運用境界明示 | 設定説明・ドキュメント | config説明/管理画面i18n | Low（文書化・i18n 5ロケール） |

**新config追加で触るファイル（順序）**: ①`config-definition.ts`（CONFIG_KEYS + defineConfig）②`interfaces/services/renderer.ts`（`RendererConfig`）③`configuration-props.ts`（props化、share-link版 L125 も）④`server-configurations.ts`（atom既定）⑤`renderer.tsx`（plugin optionsへ受け渡し3箇所）⑥`plantuml.ts`（`PlantUMLPluginParams` 拡張＋GET/POST分岐）。テスト側 `PageContentRenderer.spec.tsx` の `mockRendererConfig` と `config-definition.spec.ts`（key一覧スナップショット）も要更新。

## 3. 実装アプローチ案

### Option A: 既存拡張＋クライアント直POST
plantuml.ts/PlantUmlViewer に分岐を足し、ブラウザから `PLANTUML_URI` へ直接 `fetch` POST → SVGをインライン表示。
- ✅ 新規ファイル最少・最短
- ❌ **CORS必須**／PlantUMLサーバをブラウザ公開する必要／**インラインSVGのサニタイズが新たに必要**（既存rehype-sanitize非適用）／サーバ側キャッシュ不可

### Option B: サーバプロキシ＋`<img>`維持（ハッシュ配信）
apiv3に描画プロキシを新設。クライアントは図ソースをPOST→サーバが `PLANTUML_URI` へ外部POST→SVGをハッシュキーでキャッシュしハッシュを返す→クライアントは `<img src="/_api/v3/plantuml/svg?h=<hash>">`（GET・短URL・キャッシュ可）で表示。
- ✅ CORS不要／PlantUMLサーバを社内秘匿／**`<img>`維持でスクリプト非実行（Req4を自然充足、インラインサニタイズ不要）**／サーバキャッシュでReq5充足／ogp.ts の前例に合致
- ❌ 新規ルート＋2ステップ設計／サーバ負荷／キャッシュ設計が必要

### Option C: ハイブリッド（推奨方向）
設定＋plantuml.ts分岐は「既存拡張」、送信は「新設プロキシ（Option B）」。GETは現行のまま温存し、POST時のみプロキシ経路。
- ✅ 後方互換（Req3）と安全性（Req4）・キャッシュ（Req5）を両立、変更を局所化
- ❌ 計画がやや複雑

**設計フェーズでの推奨検討**: Option C（B寄り）。特に「インラインSVG＋サニタイズ」より「**ハッシュ配信で `<img>` 維持**」の方が、Req4（スクリプト非実行）とReq5（キャッシュ）を同時に、かつ既存サニタイズのギャップを回避して満たせる可能性が高い。

## 4. 複雑度・リスク

- **Effort: M（3〜7日）** — 個々は既存パターン（config伝播・apiv3・axios・img描画）だが、6ファイルの配線＋新プロキシ＋キャッシュ＋テスト更新で中規模。
- **Risk: Medium** — 未知技術はないが、(a) SVG安全性の設計判断、(b) キャッシュの境界（TTL/上限/キー）、(c) プロキシ悪用（未認証のGROWIが任意PlantUML描画の踏み台になり得る）の設計が品質を左右する。

## 5. Research Needed（設計フェーズへ持ち越し）

1. **SVG安全性の方式決定**: 「ハッシュ配信で`<img>`維持（インライン回避）」 vs 「インラインSVG＋DOMPurify(SVGプロファイル)サニタイズ」。前者推奨だが、`<img>`だと図内リンク等の一部機能が使えない点を確認。
2. **キャッシュ設計**: 保存先（モジュール内Map/LRU vs `lru-cache`新依存）、キー（`hash(生ソース＋method＋theme/darkmode)`）、TTL・最大件数・エビクション。`.claude/rules/package-dependencies.md` に従い依存分類。
3. **プロキシのアクセス制御**: 送信先を `PLANTUML_URI` に固定（SSRF回避）。加えて未認証利用・DoS（巨大図連投）対策として loginRequired / レート制限の要否。
4. **送信元**: ブラウザ直POST vs サーバプロキシ経由 → 秘匿性・CORS・キャッシュの観点でプロキシ経由を推奨。
5. **テスト影響**: `PageContentRenderer.spec.tsx` の `mockRendererConfig` 追加、`config-definition.spec.ts` のkey一覧、`plantuml.spec.ts`（GET/POST分岐）、`PlantUmlViewer.spec.tsx`（POST描画分岐）、新プロキシの `*.integ.ts`。
6. **運用ドキュメント/i18n**: 「自前サーバ前提・公開plantuml.com非対応」を設定説明に明記（i18n 5ロケール: en/ja/fr/ko/zh）。対応する plantuml-server バージョン要件も記載。
7. **Changeset**: 公開パッケージ非該当だが、GROWI本体の機能追加として changeset 要否を確認。

## 6. 既存テストの参照先
- `features/plantuml/services/plantuml.spec.ts`（remark プラグイン unit、`@akebifiky/...` を `vi.mock`）
- `features/plantuml/components/PlantUmlViewer.spec.tsx`（RTL、rendering-status属性・`img.src`）
- `components/PageView/PageContentRenderer.spec.tsx`（`mockRendererConfig` に `plantumlUri: ''`）
- apiv3ルートは `server/routes/apiv3/*.integ.ts`（例 `bookmarks.integ.ts`）

---

# Design Synthesis Outcomes（設計フェーズ）

## Generalization
- GET/POST 双方とも最終的に `<img src>` で描画する形へ統一（GET=encoded URL、POST=blob URL）。送信方式の分岐は remark プラグインと Viewer の2箇所に限定し、描画の下流は共通化。

## Build vs Adopt
- **HTTP**: 既存 `axios`（`ogp.ts` 前例）を採用。ブラウザ直POSTは CORS/秘匿/キャッシュの観点で不採用、サーバプロキシを採用。
- **キャッシュ**: `lru-cache`（TTL＋件数上限内蔵）を採用。自作の無制限 `Map` はメモリ境界が無く不採用（代替として上限付きMapは可）。
- **ハッシュ**: Node 標準 `crypto`（sha256）。追加依存なし。
- **GETエンコード**: 現行 `@akebifiky/remark-simple-plantuml` を継続（GET経路は不変）。

## Simplification
- **XSSはサニタイザ新設不要**: SVGを `<img>`（blob URL）でのみ描画 → 画像コンテキストでスクリプト非実行。research の「SVGサニタイザ gap」は、インラインSVG化を避けることで回避。
- **ハッシュ2段配信（B2）は不採用**: プロキシが直接SVGを返す1往復（B1）で十分。クライアント側のハッシュURL生成という間接を排除。
- **誤設定検知（9.3）は最小実装**: `render-plantuml` が `maxRedirects: 0` とし、3xx/非2xxを一律失敗扱い（公開plantuml.comの302を検知）。専用の対応判定ロジックは不要。
- **テーマ前置はサーバ（プロキシ）へ集約**: クライアントは生ソース＋darkModeのみ送信し、`render-plantuml` が `themes/*.puml.ts` をサーバ import して前置。これにより図が多いページのDOM/転送量増（当初のOpen Question）を解消。

## 設計レビュー（validate-design）での3 Critical Issue と解決
1. **アクセス制御/CSRF（10.1）**: プロキシを `loginRequired`（ゲスト許可はインスタンス設定に追従）で保護＝ページ閲覧と同ポリシー。ページ単位権限は文脈なしのため Out of Boundary。非変更エンドポイント（コンテンツ addressable なキャッシュ、ユーザー状態を変えない）のため CSRF は要件としない。
2. **キャッシュ方式（5.x）**: B2（ハッシュ別GET配信）はマルチインスタンスで GET 側キャッシュミス→404の失敗モードがあるため不採用。**B1（プロキシが直接SVG返却）を正式採用**（本文完結で水平スケールに堅牢）。ブラウザHTTPキャッシュ喪失は、サーバLRU＋クライアントのセッション内メモで緩和（Req 5 は SHOULD）。
3. **テーマDOM同梱（7.x）**: 上記のとおりサーバ前置へ移設して解消。

## Key Risks（設計時点）
- テーマ資産のサーバ import 可否（`.puml.ts` の Node/サーバビルドでの解決）→ **採用**方針。実装時に import 解決を smoke で確認（純粋な文字列 export モジュールのため低リスク）。
- 新config key 追加に伴う `config-definition.spec.ts` / `PageContentRenderer.spec.tsx` mock の更新漏れ（型崩れ）。
- `loginRequired` のゲスト許可挙動が、対象インスタンスの閲覧ポリシーと一致するかを実装時に確認。

---

# 差分ギャップ分析（要件改訂 Req 4/5/8/9 改訂・Req 10 追加後 / 2026-08-03）

改訂要件と設計で新たに採用した統合点（アクセス制御・サイズ/タイムアウト上限・LRU・SSRF/誤設定検知）を、コードベースの実在パターンに突合して feasibility を確認した。

## 新規/改訂要件 → 資産マップ（追補）

| Req | 必要な要素 | 既存資産（file:line） | 判定 |
|---|---|---|---|
| 10.1 アクセス制御 | 閲覧同等の認証（ゲスト許可追従） | `server/middlewares/login-required.ts:32` `loginRequiredFactory(crowi, isGuestAllowed)`。ゲスト分岐 L57-66（`aclService.isGuestAllowedToRead()`）。使用例 `apiv3/page/get-page-info.ts:59,72` | **OK**（`loginRequiredFactory(crowi, true)` で閲覧同等） |
| 10.2 サイズ上限(413) | 本文サイズ制限 | グローバル body parser は 50mb（`server/crowi/express-init.js:116-117`）。**このグローバル parser がルート到達前に本文を消費するため、ルート単位 `express.json({ limit })` は効かない**（design.md の結論に統一）。**ハンドラ内で `Content-Length`/`req.body` サイズを明示検査して413を返す** | **OK**（ハンドラ内サイズ検査。ルートスコープ parser 案は不採用） |
| 10.2 過負荷(レート制限) | レート制限 | 既存 `features/rate-limiter/`（`rate-limiter-flexible`+Mongo）。グローバル適用 `server/routes/index.js:82`。エンドポイント別は `API_RATE_LIMIT_*` env で調整（`middleware/factory.ts:17-19,64`） | **OK**（グローバルで自動被覆＋env で厳格化可能） |
| 10.2 タイムアウト | 上流タイムアウト | axios `timeout` 実例 `apiv3/slack-integration-settings.js:124,143`。`maxRedirects` は未使用だが標準config（`g2g-transfer.ts:251` が per-request config 実績） | **OK**（`timeout`＋`maxRedirects:0` 可） |
| 4.2 SSRF/9.3 誤設定 | 送信先固定・リダイレクト非追従 | 上記 axios per-request config で `maxRedirects:0` 指定可 | **OK** |
| 5.1/5.2 キャッシュ | LRU（TTL/上限） | `lru-cache` は **直接依存に無し**（apps/app/root package.json 未記載）。pnpm store に transitive のみ（複数版） | **needs-new-dep**（`lru-cache` を apps/app `dependencies` へ。代替 `rate-limiter-flexible` 流用も可） |
| 5.x キャッシュキー | sha256 | `crypto.createHash('sha256')` 実例 `server/models/access-token.ts:16`、`import { createHash } from 'node:crypto'`（`attachment.ts:1,17`） | **OK**（追加依存なし） |

## 判定サマリ
- **新規依存は `lru-cache` のみ**（point 4）。`.claude/rules/package-dependencies.md` に従い SSR ランタイムコードとして `apps/app/package.json` の `dependencies` に追加。上限付き `Map` 自作、または既存 `rate-limiter-flexible` を KV 代替に使う選択肢もある。
- **その他はすべて実在パターンあり**（loginRequired / body limit / rate-limiter / axios timeout / crypto）。設計の統合点に致命的ギャップなし。

## 設計への反映（実装時に確定させる細目）
1. プロキシルートで **`loginRequiredFactory(crowi, true)`** を適用（Req 10.1）。
2. 本文サイズ超過の 413 は **ハンドラ内で `Content-Length` / パース後の `req.body` サイズを明示検査**して返す（Req 10.2）。⚠️ **ルートスコープの `express.json({ limit })` は効かない**: `express-init.js:116-117` のグローバル body parser（50mb）がルート到達前に本文を読み切っているため、ルート側で limit を絞っても 413 は発生しない（design.md の結論に統一）。
3. レート制限は**グローバル適用で自動被覆**。必要なら `API_RATE_LIMIT_*` env でこのエンドポイントを厳格化（Req 10.2）。
4. 上流呼び出しは `{ responseType: 'text', maxRedirects: 0, timeout }`（Req 9.3, 4.2, 10.2）。
5. キャッシュキーは `createHash('sha256').update(source + darkMode).digest('hex')`（Req 5）。

---

# PlantUML サーバの POST 契約（ソース＋実測で裏取り済み / 2026-08）

`plantuml/plantuml-server` の実コード・PR・実機で確認した、POST実装の前提。

- **POST対応は本体標準**: `UmlDiagramService.doPost()` がリクエスト**body の生テキスト**を読み、リダイレクトせず画像を直接返す。**PR #74「Add POST support」（2018-04-19 merged）以降**。設定・改造不要。
- **POST可能エンドポイント**（`UmlDiagramService` 継承 servlet）: `/svg` `/png` `/img` `/pdf` `/eps` `/epstext` `/base64` `/txt`。`/map` `/check` は非継承で **405**、`/uml` `/form` はフォーム系で **302**（URL長回避には使えない）。→ 本実装は `/svg` を使用。
- **body は生テキスト**（deflate+base64 は不要。GETのみエンコード）。
- **文字コード**: `doPost` は charset を設定しないため、**`Content-Type: text/plain; charset=UTF-8` の明示が必須**（未指定は ISO-8859-1 で日本語が文字化け）。← design の render-plantuml に反映済み。
- **応答**: 成功=200＋画像。構文エラー=400（`X-PlantUML-Diagram-Error` ヘッダ）。CORSは `Access-Control-Allow-Origin: *`。
- **公開 plantuml.com は非対応（実測）**: `/plantuml/svg` へ POST すると body が無視され **302 で既定サンプル図**にリダイレクト。理由は未確定（前段CDN/WAF/プロキシ説が有力）。→ **POSTは自前サーバ前提**。
- **PoC 実測**: 自前 plantuml-server で URL 17,929文字の図が **GET=414 / 同内容 POST=200（正しいSVG）**。GETの文字数制限を回避できることを実証。
- **前段プロキシ**: nginx は `client_max_body_size` 既定 1MB 超で 413。大きい図を通すなら引き上げが必要（design にも記載）。
- **出典**: `plantuml-server` の `UmlDiagramService.java`(doGet/doPost) / `SvgServlet.java` / `web.xml` / PR #74 / `DiagramResponse.java`。

---

# 差分ギャップ（Req 11 追加後 / 2026-08-13）: 大きい図へのPOST推奨メッセージ

Req 11（GET時・上限超過で、POST利用可能なら「自前サーバ＋POSTで解決可」を案内）の統合点を確認した。

## 現状の統合機構（確認済み）
- `plantuml.ts`(:53-64) が `<plantuml>` 要素の **`hProperties`（現状 `src` と `GROWI_IS_CONTENT_RENDERING_ATTR`）** を設定 → `PlantUmlViewer` の props になる。`sanitizeOption`(:73) が許可属性を列挙。
- **上限超過エラーの表示体＝`PlantUmlViewer` のエラーUI**は別spec `plantuml-large-diagram-get` が新設する（本specはそこに**POST推奨行を相乗り**）。
- `plantumlHttpMethod`（get/post）は本specで RendererConfig へ伝播済み。remark プラグイン `plantuml.ts` は既に受け取る。

## 要件 → 資産マップ（Req 11）
| Req | 必要な要素 | 既存/前提資産 | ギャップ |
|---|---|---|---|
| 11.1 | GET時・上限超過で「POSTで解決可」を案内 | large-diagram-get のエラーUI（`PlantUmlViewer`） | **Missing/Cross-spec**（エラーUIにPOST推奨行を追加） |
| 11.1 | 「URL長超過が疑わしい」の判定 | large-diagram-get の `consts.ts`（`PLANTUML_GET_URL_MAX_LENGTH`＋実測失敗点ベースの目安値 `PLANTUML_GET_URL_LIKELY_OVERSIZE_LENGTH`） | Low（`src.length` と2定数の比較） |
| 11.2 | 「POST利用可能」の判定 | `plantumlUri` は `PlantUMLPluginParams` に伝播済み。公開 plantuml.com が POST 非対応であることは本 research で実測確認済み | **Missing**（送信先ホストを見る実行時判定 `isPlantumlPostCapableUri` を新設） |
| 11.2 | POST未対応環境では出さない | ─（コード存在では担保できない） | **要注意**: 「Bのコード存在＝利用可能」は**誤り**。コードがマージされた GROWI.cloud 等では送信先が公開 plantuml.com のままで POST は原理的に使えず、常時表示＝実現不可能な対処の案内になる。**判定すべきは方式ではなく相手先**（`plantumlHttpMethod` で判定すると GET 時のみ表示する本メッセージが常に非表示になり 11.1 が死ぬ） |
| 11.3 | i18n（5ロケール） | large-diagram-get と同じ locale 追加パターン | Low（B用キーを5ロケール追加） |

## 実装アプローチ（Extend・cross-spec 協調）
- **推奨**: `plantuml.ts` の GET分岐で、Viewer に**送信方式と「POST可否（送信先由来）」を `hProperties`（`data-*`）で渡す**（`sanitizeOption` に新属性追加）。`PlantUmlViewer` のエラーUI（large-diagram-get 実装）で **`method==='get'` かつ POST可否=true かつ URL長超過が疑わしい時だけ POST推奨行（`t()`）を追記**。POST可否は `isPlantumlPostCapableUri(plantumlUri)`（空/解析不能・`plantuml.com` ドメイン → false）で remark 側が評価する。
- POST推奨の文言キーは **B が5ロケールへ追加**（large-diagram-get の汎用文言とは別キー）。

## ⚠️ クロススペック依存（設計/実装で必ず扱う）
- **同一ファイルを2 spec が変更**: `PlantUmlViewer.tsx`（large-diagram-get=エラーUI新設 / B=POST推奨行追加）、`plantuml.ts` `sanitizeOption`、`locales/*`。
- **順序依存**: B の Req 11 は **large-diagram-get のエラーUIが前提**。PR/実装は **large-diagram-get 先 → B の Req 11 後**（または同時）で整合させる。design の Boundary/Revalidation に明記する。
- 代替（結合回避）: B が独自のエラーUIを持つ案もあるが、UIが二重化し保守が増えるため**非推奨**。相乗り方式が単純。

## Research Needed（設計へ）
1. Viewer への「送信方式/POST可否」受け渡し方（`data-*` hProperty か、renderer 経由 prop か）を確定。→ **決定: `data-*` hProperty**（`plantumlUri` は既に remark プラグインへ伝播済みで、追加の設定伝播が不要なため）。
2. large-diagram-get 側エラーUIの**拡張点**（POST行を差し込むための構造）を design で合意（両spec整合）。
3. POST推奨文言（対処: 管理者が自前サーバ＋POSTを設定）と5ロケール。
4. 「POST利用可能」の実行時判定条件。→ **決定: 送信先ホストで判定**（`isPlantumlPostCapableUri`）。空/解析不能・`plantuml.com` ドメインは false。方式（`plantumlHttpMethod`）やコード存在では判定しない。
