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
- **テーマ前置はクライアント側で現行ロジック再利用**: サーバ側テーマ共有（`.puml.ts` のサーバ解決）の整合性リスクを避け、v1はDOM本文増を許容（Open Question として最適化余地を記録）。

## Key Risks（設計時点）
- テーマ資産のサーバ共有可否（`.puml.ts` インポートのNode解決）→ v1では回避（クライアント前置）。将来最適化時に要検証。
- 新config key 追加に伴う `config-definition.spec.ts` / `PageContentRenderer.spec.tsx` mock の更新漏れ（型崩れ）。
- POST経路のアクセス制御ミドルウェア選定（閲覧同等：ゲスト許可時の扱い）は実装時に既存 `loginRequired` 系と突き合わせて確定。
