# Gap Analysis — share-link-comments

_生成日: 2026-06-17 / 対象: requirements.md（Requirement 1〜5）_

## 分析サマリー

- 共有リンクページのコメント表示は、UI（Comments 描画）・クライアント取得（useSWRxPageComment）・サーバー認可（isAccessiblePageByViewer バイパス）の3層に分かれ、要件の3タスク群と一致する。
- **重要な発見**: 当初想定の「attachment と同様 referer で許可」よりも、**`/page/info`（get-page-info.ts）や `/revisions/list`（revisions.js）が採用する query ベースの `certify-shared-page.js` + `req.isSharedPage` バイパス**という確立パターンの方が、comments.get（JS 駆動の API 呼び出し）に自然に適合し、リスクが低い。
- `PageComment` は既に `isReadOnly` を完全サポートしており、read-only 表示は `Comments` ラッパーに `isReadOnly` を追加して投稿フォーム（`CommentEditorPre`）を隠すだけで達成できる。
- クライアントには `useShareLinkId()` フックと、shareLinkId を条件付きで query に載せる `buildPageInfoParams` 相当のパターンが既存。useSWRxPageComment はこれに倣って改修できる。
- 主要な統合上の注意点: comments.get の query パラメータは `page_id`（snake_case）。既存 `certify-shared-page.js` は `req.query.pageId`（camelCase）を読むため、パラメータ名の整合（クライアント送信 or ミドルウェア側の読み取り）を設計で確定する必要がある。

## 1. 現状調査（Current State）

### 認可ミドルウェアの2系統（最重要）

GROWI には共有リンク経由アクセスを許可する**2つの既存パターン**が存在する:

| 系統 | ファイル | 入力 | 用途・適用例 | コメントへの適合性 |
|------|----------|------|--------------|---------------------|
| **query ベース** | `certify-shared-page.js` | `req.query.pageId` + `req.query.shareLinkId` を読み、`ShareLink.findOne({_id, relatedPage})` で検証 | `/page/info`, `/revisions/list` 等の **JS 駆動 API** | ◎ comments.get と同型（API 呼び出しで query を制御可能） |
| **referer ベース** | `certify-shared-page-attachment/` | `Referer` ヘッダを解析 → shareLinkId 抽出 → リソース帰属検証 | 添付ファイル（`<img src>` / `<a href>` で query を付与しづらい） | △ 動くが、comments には過剰。referer 偽装耐性のための仕組みで、API には query 方式が標準 |

いずれも最終的に `req.isSharedPage = true` を立て、`login-required.ts`（`isGuestAllowed && req.isSharedPage` で通過）と組み合わせる点は共通。

### ゴールドスタンダードな手本: `/page/info`（get-page-info.ts）

```
[ accessTokenParser, certifySharedPage(query), loginRequired(guest許可), validator, handler ]
handler: const { user, isSharedPage } = req;
         findPageAndMetaDataByViewer(..., { isSharedPage });  // isSharedPage で viewer チェックを内部バイパス
validator: query('shareLinkId').optional({ checkFalsy: true }).isMongoId()
```

`/revisions/list`（revisions.js:126-156）も同型で、ハンドラ内が
`if (!isSharedPage && !(await Page.isAccessiblePageByViewer(pageId, req.user))) → 403` という**バイパス分岐**になっている。これが論点Cの解の直接の手本。

### クライアント側の既存パターン（stores/page.tsx）

- `useShareLinkId()`（`states/page/hooks.ts:57`）: 現在の共有リンクID（hydrate 済み atom）を返す。共有ページでのみ非null。
- `hasShareLinkId()` / `buildPageInfoParams()`: shareLinkId が非空のときだけ query に含めるヘルパ。
- `useSWRxPageInfo(pageId, shareLinkId)`: SWR キーに shareLinkId を含め、query で送信。→ useSWRxPageComment 改修の手本。

### コメント関連の現状

- `Comments.tsx`: `isReadOnly={false}` をハードコードで `PageComment` に渡し、`!isDeleted` の場合は常に `CommentEditorPre`（投稿フォーム）を描画。read-only 入口なし。
- `PageComment.tsx`: `isReadOnly` を**完全サポート済み**。true のとき返信ボタン・返信エディタ・削除モーダルをすべて抑止。
- `useSWRxPageComment(pageId)`: SWR キー `['/comments.get', pageId]`、`apiGet('/comments.get', { page_id })`。shareLinkId は未送信。
- ルート登録（routes/index.js:263-268）: `/comments.get` に `accessTokenParser → loginRequired → comment.api.get`。certify 系ミドルウェアは未適用。
- `comment.api.get`（comment.js:127-159）: 冒頭で `Page.isAccessiblePageByViewer(pageId, req.user)` → 未ログイン＝弾かれる（要件3の核心障害）。投稿者情報は `serializeUserSecurely` 済み（要件3.3を既に満たす）。

## 2. Requirement → Asset マップ（ギャップ）

| 要件 | 既存資産 | ギャップ | 種別 |
|------|----------|----------|------|
| R1 コメント閲覧表示 | PageView の Comments 描画パターン、ShareLinkPageView | ShareLinkPageView に Comments（dynamic, ssr:false）を未配置 | Missing |
| R1.3 トップページ非表示 | Comments 内 `isTopPage` ガード | 既存ガードで充足（追加不要） | — |
| R1.5 共有無効時 非表示 | ShareLinkPageView の `disableLinkSharing`→ForbiddenPage 分岐 | 既存分岐で充足（Comments は !isNotFound 内に置けば自然に非表示） | Constraint |
| R2 read-only | PageComment.isReadOnly | Comments ラッパーに isReadOnly 引数＋投稿フォーム抑止が未実装 | Missing |
| R2.2-2.5 書込拒否維持 | comments.add/update/remove は loginRequiredStrictly | 変更不要（据え置き） | — |
| R3 取得許可 | certify-shared-page.js / get-page-info の isSharedPage バイパス | comments.get に certify 未適用、handler のバイパス分岐なし | Missing |
| R3.3 投稿者情報安全化 | serializeUserSecurely | 既存で充足 | — |
| R4 セキュリティ境界 | certify-shared-page.js の `{_id, relatedPage}`＋`isExpired()` 検証 | comments.get に未適用（適用すれば R4.1-4.3 充足） | Missing |
| R5 非回帰 | revisions.js の `!isSharedPage && !isAccessible` 形 | バイパスを「isSharedPage のときのみ」に限定すれば通常経路は不変 | Constraint |

### 統合上の注意（Research/設計確定事項）

- **パラメータ名の不一致**: comments.get は `page_id`、`certify-shared-page.js` は `pageId` を参照。再利用するなら (a) クライアントが `pageId` も併送、(b) ミドルウェアを `page_id` も読むよう一般化、のいずれかを選ぶ。
- **apiv1 ルートの形**: comments.get は apiv1Router の素朴な関数登録。ミドルウェア追加は routes/index.js の該当行に挿入するだけで可能（factory 化は不要）。
- **エラー表現**: comment.api.get は失敗時 `ApiResponse.error(...)` を返す（HTTP は 200 で `ok:false`）。R4.1 の「拒否」をどの形（200+error か 403 か）で表現するか、既存挙動踏襲を基本に確定。

## 3. 実装アプローチ（論点B = 認可ミドルウェアの選定が中心）

### Option A（推奨）: query ベース `certify-shared-page.js` を comments.get に適用（既存パターン踏襲）
- comments.get ルートに `certifySharedPage` を挿入し、handler を `if (!isSharedPage && !isAccessible) → error` に変更。
- クライアントは `useShareLinkId()` で shareLinkId を取得し、query に `shareLinkId`（必要なら `pageId` も）を併送。
- **Trade-offs**: ✅ get-page-info / revisions と完全一貫、最小リスク、referer 偽装の議論不要 ✅ 投稿フォーム抑止と独立 ❌ パラメータ名整合の一手間 ❌ 当初想定（referer）とは別方式

### Option B: referer ベースの新規ミドルウェア（attachment 流、当初案）
- attachment の validate-referer 系を流用し、検証対象を fileId→page_id（=relatedPage 一致）に置換した新ミドルウェアを作成。
- **Trade-offs**: ✅ 当初タスク記述に忠実 ✅ クライアント改修が最小（referer は自動送信）→ task2 がほぼ不要化 ❌ comments.get（JS API）に referer 方式は標準外で、既存 API 群と不一致 ❌ 新規コード量・テスト増、retrieve-site-url 等への依存

### Option C: attachment ミドルウェアを page_id 検証に一般化（共通化）
- `certify-shared-page-attachment` を「リソース検証関数を差し替え可能」に抽象化し、attachment と comment で共有。
- **Trade-offs**: ✅ 重複削減 ❌ 既存 attachment 経路への回帰リスク、抽象化コスト大、本タスクの範囲を超える

> 論点C（バイパス粒度）はどの Option でも共通で、revisions.js と同じ `!isSharedPage && !isAccessiblePageByViewer` 形に統一するのが最良。

## 4. 工数・リスク

| 項目 | Effort | Risk | 根拠 |
|------|--------|------|------|
| Task1 Comments 有効化（read-only 描画） | S | Low | 既存 PageView パターン＋PageComment.isReadOnly の流用 |
| Task2 useSWRxPageComment 改修 | S | Low | useSWRxPageInfo の shareLinkId 送信パターンを踏襲 |
| Task3 認可（Option A） | S〜M | Low〜Medium | get-page-info/revisions の確立パターン踏襲。パラメータ名整合とテストで M 寄り |
| Task3 認可（Option B/C） | M | Medium | 新規/抽象化ミドルウェア＋テスト、既存添付経路への波及確認 |
| 全体（Option A 採用時） | **S〜M（2〜4日）** | **Low** | 3層とも既存パターンに乗る |

## 5. 設計フェーズへの推奨

- **推奨アプローチ: Option A（query ベース `certify-shared-page.js` 踏襲）**。理由は comments.get が JS 駆動 API であり、get-page-info/revisions と同型にできて最小リスク・最大一貫性のため。当初の「referer/attachment 流」は添付特有の制約（`<img src>` で query 不可）に起因する方式で、コメントには必須でない点を設計で明記する。
- **論点C は revisions.js の `!isSharedPage && !isAccessiblePageByViewer` 形に統一**。
- **read-only は `Comments` に `isReadOnly` を追加**して PageComment へ伝播＋`CommentEditorPre` を非描画（共有ページからは `isReadOnly`/投稿フォーム抑止を渡す）。

### Research Needed（設計で確定）
1. ~~パラメータ名整合~~ → **決定済み（下記）**
2. R4.1 の拒否表現（200+`ok:false` 踏襲 か 403 か）。既存 comment.api.get の返却形に揃える方針の確認。
3. ShareLinkPageView 内の Comments 配置位置（footerContents か本文直下か）と revision 取得元（`page.revision` の null ガード）。
4. テスト方針: certify-shared-page.js の comments.get 適用に対する integ テスト（共有経由許可／非共有拒否／期限切れ拒否／ページ不一致拒否）。

---

## 確定した方針（ユーザー判断 2026-06-17）

- **論点B = Option A（query ベース `certify-shared-page.js` 踏襲）を採用。** comments.get ルートに `certifySharedPage` を挿入し、`comment.api.get` を `if (!isSharedPage && !isAccessible) → error` に変更。referer/attachment 方式（Option B/C）は不採用。
- **論点C** = revisions.js と同じ `!isSharedPage && !isAccessiblePageByViewer` 形に統一。
- ~~**パラメータ名整合 = クライアントが `pageId` を併送する。**~~ → **撤回（2026-06-23、下記参照）。**
- **read-only** = `Comments` に `isReadOnly` を追加 → `PageComment` へ伝播 ＋ `CommentEditorPre` を非描画。共有ページからは read-only で渡す。

## 認可設計の改訂（2026-06-23 — PR #11322 セキュリティレビュー反映）

PR #11322（Task 1）のレビューで、**Task 3 の認可設計に IDOR（認可バイパス）の構造的欠陥**が指摘された。`page_id`（snake_case, 取得対象）と `pageId`（camelCase, 検証対象）という **2 つの page 識別子が併存する設計そのものが脆弱性の温床**であり、当初方針「クライアントが `pageId` を併送して名前の不一致を吸収する」を撤回し、**単一 ID 化（検証対象＝取得対象）** に変更する。

### 欠陥の本質（撤回前の設計だと発生）

ミドルウェア `certify-shared-page.js` は `req.query.pageId` を共有リンクと照合して `req.isSharedPage` を立てるが、ハンドラ `comment.api.get` は別の `req.query.page_id` でコメントを取得する。両方とも攻撃者が制御可能なため、検証と取得が乖離する:

- **CRITICAL-1（page 取り違え / IDOR）**: 有効な共有リンク 1 つ（ページ A）を持つ匿名ユーザーが
  `GET /_api/comments.get?page_id=<非公開ページB>&pageId=<共有ページA>&shareLinkId=<Aの有効リンク>`
  を送ると、ミドルウェアは A で検証成功 → `isSharedPage=true`、ハンドラは B のコメントを返す。
  → **wiki 内の任意ページのコメントが漏洩**。
- **CRITICAL-2（revision 取り違え）**: `comment.api.get` は `revision_id` があると `findCommentsByRevisionId(revisionId)` で **ページと無関係に**取得する。`isSharedPage=true` のまま別ページの `revision_id` を渡すとそのコメントが返る。page 識別子を単一化しても残るため、別途ガードが必要。

手本の `revisions.js`（検証・バイパス・取得すべて `req.query.pageId`）と `get-page-info.ts`（すべて `pageId`）は **単一 ID 不変条件**を守るため取り違えが起きない。comments.get もこれに揃える。

### 改訂後の確定方針（2026-06-23）

- **単一 ID 化（CRITICAL-1 の根本解決）**: `certify-shared-page.js` を `req.query.pageId || req.query.page_id` も読むよう **additive に一般化**（既存呼び出し元は常に `pageId` を送るため後方互換）。クライアント `useSWRxPageComment` は既存の `page_id` ＋ `shareLinkId`（共有時のみ）だけを送り、**別途 `pageId` は併送しない**。これで「ミドルウェアが検証したページ」と「ハンドラが取得するページ」が同一の単一識別子になる。
- **revision_id のガード（CRITICAL-2）**: 共有文脈（`isSharedPage === true`）では `revision_id` 分岐を使わず、**検証済み `page_id` でのみ取得する**（共有 read-only 表示はページ単位の一覧で足り、revision 指定は不要）。`revision_id` が併送されても参照しない。
- **入力バリデーション（HIGH）**: 手本に合わせ `comments.get` に `query('page_id').isMongoId()` / `query('shareLinkId').optional({ checkFalsy: true }).isMongoId()` / `query('revision_id').optional({ checkFalsy: true }).isMongoId()` を追加（NoSQL injection 面の閉塞）。
- **テスト（MEDIUM）**: 「`shareLinkId` が別ページを指す（不一致）で拒否」「共有文脈で `revision_id` に別ページの revision を渡しても、その revision のコメントは返らない（検証済みページのコメントのみ）」の**負のテストを必須追加**。

> certify-shared-page.js を「無改修」とする当初の境界宣言は撤回し、上記 additive な一般化を許容する（design.md の Boundary Commitments も更新済み）。「2 つの page 識別子の併存」を排し単一ソースへ統一することが最善の防御。
