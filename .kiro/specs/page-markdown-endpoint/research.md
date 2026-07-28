# Gap Analysis: page-markdown-endpoint

対象: `.kiro/specs/page-markdown-endpoint/requirements.md`（7 要件）
種別: ブラウングフィールド（既存の GROWI ページ配信・認可・ページツリーを再利用）

## 1. 現状調査サマリ

- ページ配信は最終的に `apps/app/src/server/routes/index.js` の catch-all `app.get('/*', loginRequired, autoReconnectToSearch, next.delegateToNext)`（dev/8.0.x では `:403`、その 1 行手前 `:402` に trailing-slash 用 `/*/$`）が Next.js に委譲する。permalink `/{pageId}` 専用の Express ルートは無く、これも catch-all → Next の `[[...path]]` で解決される。※このモジュールは dev/8.0.x で ESM 化（`export const setup`、子ルーターは `import { setup as … }`）され、catch-all 手前に `/vault.git`(:82) が追加されている。
- 認可はファインダに内包: `findByIdAndViewer` / `findByPathAndViewer`（`server/service/page/find-page-and-meta-data-by-viewer.ts:87,89`）が閲覧者の grant フィルタを適用。forbidden/not-found は「フィルタ無しで再カウントし count>0 なら forbidden」で区別（同 `:93-105`）。apiv3 は forbidden→403 / not-found→404（`apiv3/page/respond-with-single-page.ts:50-61`）。
- 本文は `revision.body`。再利用できる「Markdown→Markdown」シリアライザは存在せず、raw の本文をそのまま出すのが既存流儀（bulk-export の md 出力も `revision.body` 逐語; `features/page-bulk-export/.../steps/export-pages-to-fs-async.ts:98-99`）。
- ページツリー: 子は `pageListingService.findChildrenByParentPathOrIdAndViewer(parentPathOrId, user, ...)`（`server/service/page-listing/page-listing.ts:58-109`、viewer grant フィルタ込み）。`descendantCount` は永続フィールド（`models/page.ts:214`）。**兄弟の専用取得は無い** → 対象の `parent`（`models/page.ts:208-213`）を親として同メソッドを呼び、自分自身を除外して導出する。
- `<head>` は SSR される（`pages/[[...path]]/index.page.tsx:160-162`、現状 `<title>` のみ。OG/description 等は未実装）。

### 重要な発見（R2 の前提に直結）
- **末尾 `.md` のページは元々作成禁止**: `packages/core/src/utils/page-path-utils/index.ts:110` の `restrictedPatternsToCreate` に `/.+\.md$/` があり、`isCreatablePage()`（同 `:119-121`）が `.md` 終わりパスを弾く。作成・リネームの経路で `/foo.md` は作れない。
  - 帰結: R2 の「実在ページ優先(literal-wins)」で守るべき衝突（`/README.md` という**通常ページ**）は、通常操作では発生しない。literal-wins は「DB 直挿し・インポート・過去バージョンで作られた `.md` パス」向けの**安全網**として意味を持つ（廃止はしないが、実装上のホットパスではない）。
  - 逆に「`.md` という名前空間が予約済みで空いている」ため、`{pagePath}.md` を Markdown フォーマット要求として解釈する設計は既存規約と整合的。

## 2. 要件→資産マップ（ギャップタグ: 再利用可 / 新規 / 要調査）

| 要件 | 使う既存資産 | ギャップ |
|---|---|---|
| R1 取得(URL 形態) | catch-all 手前への route/middleware 追加; `findByIdAndViewer`/`findByPathAndViewer`; `isPermalink`/`isValidObjectId`（`packages/core/.../objectid-utils.ts:3-16`, `page-path-utils/index.ts:21-24`） | **新規**: ルート本体・`Accept`/`?format=md` 判定 |
| R2 `.md` 衝突解決 | `isCreatablePage`（`.md` 予約の裏付け）; パス実在チェック（ファインダ） | **新規**: literal-wins の分岐（安全網）。**要調査**: `.md` サフィックスと `Accept` 明示の優先順位 |
| R3 認可 | `accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy:true })` + `loginRequired`（ゲスト許可）の合成（例: `routes/index.js:200-205`, `routes/attachment/get-brand-logo.ts:21,28-29`） | **再利用可**（並行実装しない）。403/404 意味論もファインダ流用 |
| R4 ナビ footer | `findChildrenByParentPathOrIdAndViewer`; `page.parent`; provenance（`page.updatedAt` `models/page.ts:262`, `page.lastUpdateUser.username` `:255`）; `serializeUserSecurely`（`@growi/core/dist/models/serializers`） | **新規**: footer 組立の純関数; 兄弟導出（親→子→自分除外）; ページ一覧 API 誘導文。**要調査**: 子/兄弟のインライン列挙上限値 |
| R5 空ページ | ファインダの `isEmpty`/本文有無 | **新規**: 空ページ時の「本文なし＋ナビのみ」応答分岐 |
| R6 発見性(機械) | `<head>`（`index.page.tsx:160-162`, SSR）; GSSP の `context.res` | **新規**: `<link rel=alternate>` 追加 + HTTP `Link` ヘッダ。**要調査**: HTML は Next 配信のため `Link` ヘッダをどこで付けるか（GSSP か手前 middleware か） |
| R7 発見性(人間) | `CopyDropdown.tsx`（`:56-275`）; `useTranslation('commons')`; `encodeSpaces` | **新規（拡張）**: DropdownItem 1 個 + i18n キー `copy_to_clipboard.Markdown URL`（`public/static/locales/*/commons.json`, en は `en_US/commons.json:90-98`） |

## 3. 実装アプローチ（コンポーネント別）

### (a) Markdown 配信エンドポイント本体 — 推奨: Option B（新規）
- catch-all（dev/8.0.x では `routes/index.js:402-403`）の**直前**に、Markdown 判定用のハンドラを 1 枚差し込む。責務が明確で既存の巨大ファイルを汚さない。ESM 化済みのため名前付き export ＋ `import` で組む（CJS `require` は使わない）。
- 判定: パス末尾 `.md`（permalink `/{id}.md` / path `{path}.md`）**または** `Accept: text/markdown` / `?format=md`。該当しなければ `next()` で既存 Next 委譲へフォールスルー。
- ルート構造は TS の factory パターン（`getBrandLogoRouterFactory(crowi): Router` `routes/attachment/get-brand-logo.ts:19` が手本）。Content-Type は `res`（`ogp.ts:119-122` のように明示設定）。
- 認可は `accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy:true })` + `loginRequired` を前段に合成（R3、並行実装しない）。
- トレードオフ: ✅責務分離・単体テスト容易 / ❌ catch-all との**登録順序**が唯一の注意点（順序を誤ると通常ページ配信やアセットを飲み込む）。

### (b) 本文＋footer の組立 — 推奨: Option B（新規・純関数）
- `revision.body` に近傍ナビ footer 文字列を連結する**純関数**として切り出す（`page + revision + parent + children + siblings + counts → markdown` を受け取り出力）。coding-style の「フレームワーク境界から純ロジックを抽出」に合致し、テストが容易。
- 兄弟は親 id で `findChildrenByParentPathOrIdAndViewer` を呼び自分を除外。provenance ユーザは `serializeUserSecurely` を通す。

### (c) CopyDropdown 項目 — 推奨: Option A（既存拡張）
- `CopyDropdown.tsx` に `DropdownItem` を 1 個追加、値は `${pagePathUrl}.md`（クエリ/ハッシュの前に `.md`）。共有リンクモードは対象外（R7.4）。i18n キーを 5 言語 `commons.json` に追加（英語ファースト、他言語は後続タスク可）。
- `.md` URL を作る共有ヘルパは既存に無い（CopyDropdown は URL をインライン組立）。小さな純関数として `~/utils` 等に切り出すと CopyDropdown と `<link rel=alternate>` で共用でき、drift を防げる（要調査: 置き場所）。

### (d) 発見性(head/Link) — 推奨: Option A（既存拡張）
- `<link rel=alternate type=text/markdown href=/{pageId}.md>` を `[[...path]]/index.page.tsx` の `<Head>` に追加（SSR されるので CSR 時も初期 HTML に載る＝R6.3 を満たす）。
- HTTP `Link` ヘッダは HTML が Next 配信のため、GSSP の `context.res.setHeader` か手前 middleware で付与（**要調査**）。

## 4. 工数 / リスク

| 項目 | 工数 | リスク | 一言 |
|---|---|---|---|
| (a) エンドポイント本体・解決・認可 | M | Low〜Medium | 既存パターン流用。唯一の勘所は catch-all との登録順序 |
| (b) footer 組立・兄弟導出 | M | Low〜Medium | 兄弟でクエリ 1 本追加・自分除外。viewer フィルタは既存で担保 |
| (c) CopyDropdown + i18n | S | Low | 項目 1 個 + キー追加 |
| (d) alternate link + Link ヘッダ | S〜M | Low | head は容易。Link ヘッダ位置のみ要判断 |
| R5 空ページ分岐 | S | Low | `isEmpty`/本文有無で分岐 |

全体: **M / Low〜Medium**。新規アルゴリズムは無く、既存の配信・認可・ツリーの再利用が主。

## 5. 設計フェーズへの申し送り

### 推奨アプローチ
- 本体は **Option B（catch-all 手前の新規ハンドラ）**、footer は **純関数として新規**、UI/head は **既存拡張（Option A）**。認可は完全再利用。
- literal-wins（R2）は残すが、`.md` 作成禁止（`isCreatablePage`）の裏付けにより「安全網」と位置づけ、実装をシンプルに保つ。

### 要調査（Research Needed）
1. **interception の実装形態**: catch-all 手前の単一 middleware か、`.md` 用の正規表現ルート + `Accept` 用の別判定か。GET・ページ的パスのみに絞り性能影響を避ける方法。
2. **`.md` サフィックスと `Accept`/`?format=md` の優先順位**（両方与えられた場合）。
3. **HTTP `Link` ヘッダの付与位置**（Next 配信 HTML への付け方: GSSP か middleware か）。
4. **子/兄弟のインライン列挙上限**（定数か config か）と、footer に載せるページ一覧 API 案内 URL の正確な形（`/_api/v3/page-listing/children?path=...`）。
5. **`.md` URL 生成の共有ヘルパの置き場所**（server 応答内リンクと client CopyDropdown・`<link>` で共用し drift を防ぐ）。
6. **provenance の公開範囲**（`serializeUserSecurely` を通し、username/name のみ露出）。
7. 本文は `revision.body` 逐語で返す（lsx 等の動的展開・相対リンク解決は本 Phase の対象外）ことの明文化。
8. キャッシュ方針（ETag / Cache-Control）は任意の NFR として design で検討。

### テスト方針（既存作法）
- サーバルートは supertest + `getInstance()`（`test/setup/crowi`）で bootstrap し、`accessTokenParser`/`login-required` を `vi.mock` する（手本: `apps/app/src/server/routes/apiv3/page/get-page-info.integ.ts:43-216`、plain ルートは `routes/comment.integ.ts`）。dev/8.0.x では `findPageAndMetaDataByViewer` が Prisma（bookmarks）に依存するため、bootstrap で Prisma が初期化されていること（手本 integ が dev/8.0.x で green か先に確認）。
- footer 組立の純関数は fixture で単体テスト。

---

## 設計フェーズの統合結果（design synthesis）

### Generalization
- R1（3 つの URL 形態）・R2（解決）・R3（認可）・R4/R5（footer・空ページ）は「リクエスト → 閲覧者向けにページを解決 → Markdown 文書（本文＋footer）を生成」という単一パイプラインに集約。`PageMarkdownService.resolve` が唯一の入口で、`parseMarkdownRequest`（意図解釈）→ viewer ファインダ（解決＋認可）→ listing（親子兄弟）→ `buildPageMarkdown`（組立）と流す。
- `.md` URL の形（`/{pageId}.md`）は `page-markdown-url` の純関数に一元化し、footer 内リンク・`<link rel=alternate>`・CopyDropdown・（将来 Phase 2 の）全消費者が同じ生成規則を参照する（drift 防止・単一情報源）。

### Build vs Adopt
- Adopt: HTTP 標準の内容ネゴシエーション（`Accept` / `Link` ヘッダ）、既存 viewer ファインダ（認可＋not-found/forbidden 意味論）、`pageListingService`（子・兄弟）、`revision.body` 逐語、`serializeUserSecurely`。
- Build（最小限）: catch-all 手前の interception ルート、literal-wins の解決グルー、footer 組立の純関数、`.md` URL 生成の純関数、CopyDropdown 項目＋head link。
- 理由: 認可・本文・ツリーは実績ある既存実装があり、再実装は drift とセキュリティリスクを生むため採用しない。

### Simplification
- children.md を作らない（決定済み）。footer から既存ページ一覧 API へ案内。
- interception は「`.md` サフィックスと `Accept`/`?format=md` を 1 箇所で判定し、非該当は `next()`」の**単一ミドルウェア**に統一（複数正規表現ルートに分割しない）。
- Phase 1 はキャッシュ層なし。footer のリンク上限は定数 `MARKDOWN_FOOTER_MAX_LINKS`（config 化は Phase 2）。
- 結果型は discriminated union（`ok` / `forbidden` / `notFound` / `passthrough`）で表現し、`passthrough` により literal `.md` 実在ページを既存 HTML 配信へ委ねる。

### 要調査（研究）項目の解決状況
1. interception 形態 → catch-all 直前の単一ミドルウェアに決定。
2. `.md` と `Accept` の優先順位 → 明示（`Accept`/`?format=md`）を最優先し末尾除去しない。`.md` サフィックスは糖衣で literal→base。
3. `Link` ヘッダ位置 → `[[...path]]` の GSSP（`context.res`）で設定。
4. 子/兄弟の列挙上限 → 定数 `MARKDOWN_FOOTER_MAX_LINKS`。案内 URL は `/_api/v3/page-listing/children`。
5. `.md` URL ヘルパ位置 → `apps/app/src/utils/page-markdown-url.ts`（client 安全・共用）。
6. provenance → `serializeUserSecurely` を通し username のみ露出。
7. 本文は `revision.body` 逐語（lsx 展開・相対リンク解決は Non-Goal）。
8. キャッシュ → Phase 1 では Non-Goal。

---

## validate-design（opus 敵対的レビュー）結果と反映

opus サブエージェントが design を実コードと突き合わせて敵対的レビュー。骨格は健全と確認しつつ 3 件の要修正を検出。判定は条件付き NO-GO → 以下を design.md に反映して GO に転じた。

1. **populate 抜け（correctness）**: `findPageAndMetaDataByViewer` は `revision`/`parent`/`lastUpdateUser` を populate しない（本体 page.ts:696-718・830-852 に populate 呼び出し無し）。既存の読み取り経路は route/データ層で `initLatestRevisionField`＋`populateDataToShowRevision` を別途呼ぶ（`respond-with-single-page.ts:78-81`, `page-data-props.ts:226-237`）。→ 慣習に合わせ populate は **route 層のレスポンスヘルパ `respond-with-page-markdown.ts`** の責務とし、`service/page-markdown/` を廃止。親は `page.parent` から追加クエリで解決すると明記。
2. **空ページで pageId 不在（要件間矛盾）**: 空ページは GSSP が `data:null`+`isNotFound:true` を返す（`page-data-props.ts:206-223`）ため、client props に `_id` が無く `/{pageId}.md` の alternate/Link を作れない。→ `<link>`/`Link` を **path 形 `{path}.md` にフォールバック**可能にし、Link ヘッダは空ページ早期 return より前のスコープの `_id` で設定すると明記。R6.1 も pageId 無しは path 形を許すよう整合。
3. **descendantCount ≠ 直下子数（correctness）**: `descendantCount`（page.ts:214）は子孫合計。→ 直下子総数は `findChildrenByParentPathOrIdAndViewer(id)` の結果長（viewer フィルタ済み）を使い、`descendantCount` は footer に**別個に併記**。ユーザ判断で専用 count メソッドは作らない（grant フィルタ二重実装＝drift 回避。将来性能問題時に page-listing service へ count 追加）。R4.3 を更新。

副次対応: トップページ `/` の Accept/`?format=md` 非対応（既知の限界・permalink で代替）、`Accept` はメディアタイプ明示一致のみ（`req.accepts` の `*/*` 誤爆回避）、子・兄弟は id 指定で regex 非生成、root は親・兄弟省略ガード。すべて Implementation Notes / Open Questions に記載。

### メモリ観点の追補（子・兄弟取得）
ユーザ指摘により、直下子/兄弟が大量のページで全件ロードするとメモリを圧迫する点を是正。cursor は「先頭 N 件」用途では利点が無く不要と判断し、リンクは `limit(MARKDOWN_FOOTER_MAX_LINKS + 1)`、正確な総数は `addViewerCondition` を重ねた `countDocuments({ parent: id })`（既存 `countByIdAndViewer` `page.ts:722-729` と同流儀）で取得する方針に変更。`addViewerCondition` を find/count で共有するため grant ロジックの二重実装＝drift は起きない。`PageQueryBuilder` は `addConditionToPagenate(offset, limit, sortOpt)`（`page.ts:579-580`）で limit をサポート。page-listing サービスへ「limit 付き取得＋viewer-aware count」を追加し、既存の全件返し `findChildrenByParentPathOrIdAndViewer` は本用途に使わない。※上記 #3 の『専用 count メソッドは作らない』判断は、このメモリ観点で「viewer-aware count を足す（`addViewerCondition` 共有で drift 無し）」へ更新。既存ページツリーも全件ロードしている点は別課題（本エンドポイントのみ先行改善）。

---

## dev/8.0.x 再ベース（2026-07-11 実測）

本 spec は master(現HEAD) 上で作成された。実装は `origin/dev/8.0.x`(cb655c3) をベースに行う。分岐点から dev は 1389 コミット先行しているため、設計が名指しした既存コードとの整合を実測で確認した。**要件・設計思想・タスク分割はそのまま通用する**。反映した差分は以下。

### 実装前に効く差分（反映済み）
1. **`server/routes/index.js` の ESM 化**: `module.exports = (crowi, app) =>` → `export const setup = (crowi, app) =>`。子ルーターは `require('./page')(crowi, app)` → `import { setup as setupPage } from './page'` ＋ `setupPage(crowi, app)`。新 page-markdown ルートも ESM の名前付き export（TS factory `getBrandLogoRouterFactory` と同型）で組み、`setup` 内で `app.use(...)` する。catch-all は master の `:401`/`:402` → dev では **`:402`/`:403`**。手前に新ルート `/vault.git`(:82) が追加（接頭辞違いで衝突なし）。
2. **`findPageAndMetaDataByViewer` の Prisma 依存**: bookmark 集計が Mongoose→Prisma（`prisma.bookmarks.count` / `findByPageIdAndUserId`）に変更。**認可・not-found/forbidden の契約は master と同一**で設計ロジックに影響しない。ただしこの finder を通る `*.integ.ts` は bootstrap で Prisma 初期化が要る（dev/8.0.x の Mongoose+Prisma 二重書き込み構成由来）。

### 据え置きで良い点（実測で確認）
- literal-wins(R2) の前提 `packages/core/.../page-path-utils/index.ts` の `.md` 予約（`restrictedPatternsToCreate` の `/.+\.md$/`）と `isCreatablePage` は無変更（差分は import への `.js` 拡張子追加=ESM のみ）。
- 認可ミドルウェア API `accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true })` は dev にもそのままの形で残存。
- `models/page.ts`・`service/page-listing/page-listing.ts`・`apiv3/page/respond-with-single-page.ts`・`pages/[[...path]]/page-data-props.ts`・`index.page.tsx`・`routes/attachment/get-brand-logo.ts` は master と**バイト一致**（引用した行番号アンカーも有効）。`initLatestRevisionField` は `obsolete-page.js` に健在。
- 軽微: `en_US/commons.json`(+47 行) と `CopyDropdown.tsx`(2 行)・`ogp.ts`(16 行) は行番号がずれるのみで、キー追加・拡張作業自体は変わらない。
