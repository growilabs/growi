# Research & Design Decisions — revision-diff-api

## Summary

- **Feature**: `revision-diff-api`
- **Discovery Scope**: Extension（既存 GROWI apiv3 / revision モデル / PAT 認証への拡張）
- **Key Findings**:
  - サーバ側の差分計算は存在せず、差分はクライアント（`PageHistory/RevisionDiff.tsx`）が `diff`(v5) の `createPatch` で生成している。`diff` は既存依存で再利用可能（新規依存なし）。
  - 「PAT 認証した本人の編集を全ページ横断・増分で取得する」入口が無い。`revisions/list` は単一 pageId、`user-activities` は PAT 非対応、`activity` は admin 専用 scope。
  - revision は prev ポインタを持たず、`author` 横断クエリ用インデックスも無い。`{ author: 1, createdAt: -1 }` の追加が前提。

## Research Log

### 既存の revision データモデルと API
- **Sources**: `apps/app/src/server/models/revision.ts`, `apps/app/src/server/routes/apiv3/revisions.js`, `packages/core/src/interfaces/revision.ts`
- **Findings**:
  - revision フィールド: `pageId, body, format, author, hasDiffToPrev, origin, createdAt`。`pageId` のみ index。
  - 「前の版」は同一 `pageId` で `createdAt` が直前の版を引いて求める（prev ポインタ無し）。
  - 既存ルートは `accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true })` → `loginRequired` → express-validator → `apiV3FormValidator`、応答は `res.apiv3()/res.apiv3Err()`、swagger は JSDoc。
- **Implications**: 本 spec の2ルートも同じミドルウェア順・応答形式・swagger 様式に揃える。scope は `read:features:page` を流用（後述 Decision）。

### サーバ側差分の build vs adopt
- **Findings**: `diff`(v5.0.0) の `createPatch(fileName, oldStr, newStr, oldHeader, newHeader, { context })` が unified diff 文字列を生成。文脈行数は `context` オプションで制御。baseline 空は `oldStr=''` で「全文追加」になる。
- **Implications**: 差分生成は `diff` を adopt。pure function 化してサービスから呼ぶ。`diff2html`（HTML 化）はクライアント表示用途でありサーバ API では不要。

### 連続編集のまとめ（run 検出）と前版算出
- **Context**: Req 4（他者編集に中断されない自分の連続編集だけを1エントリ化）と前版（baseline）算出を N+1 なしで行う必要がある。
- **Findings**:
  - 「run（連続編集）」は *ページの版列における* 連続性で定義される（著者フィルタ後の横断ストリーム上の連続ではない）。よって各ユーザ版について「同一ページの直前の版（著者問わず）」を知る必要がある。
  - 直前版情報の一括取得手段: (a) `$setWindowFields`（`pageId` で partition、`createdAt` 昇順で `$shift` により前版の `author`/`_id` を付与。MongoDB 5.0+。GROWI は 6.x 前提のため利用可）、または (b) 関与ページの版を時間範囲でまとめて取得しローカルで前後関係を解決。
- **Implications**: baseline と run 境界はこの一括取得結果から決定し、版ごとの個別クエリ（N+1）を避ける。ページングは run の `to` 版の `(createdAt, _id)` を鍵にした keyset 方式とし、run が途中で分割されないようにする。

### ページ閲覧権限の一括判定
- **Findings**: ページ単位の判定 `Page.isAccessiblePageByViewer(pageId, user)` が存在。多数ページを1件ずつ評価すると重い（グループ所属・継承の評価）。
- **Implications**: 与えられた pageId 集合のうち閲覧可能なものを一括で絞り込む経路を用いる（実装時に既存の一括判定経路を確認）。インデックス側・diff 側ともこの一括判定を共有する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 既存 `revisions.js` に直接追記 | 2エンドポイントを既存 CommonJS ルートに足す | 配線最小 | 800 行規模の legacy ファイルが肥大化、責務混在、テスト容易性低下 | 不採用 |
| feature モジュール新設（採用） | `features/revision-diff/server` にルート薄層＋サービス＋型を配置、apiv3 index で `/revisions` 配下にマウント | 責務分離・単体テスト容易・legacy 非改変 | apiv3 index への配線が1点必要 | structure.md の feature-based 方針に合致 |

## Design Decisions

### Decision: API を「変更インデックス」と「汎用 diff」の2本に分割
- **Context**: 利用者(primavista)の用途は「自分の変更を発見」＋「差分の中身」。差分計算は既存エンドポイント＋consumer 側でも可能で、真のギャップは発見側。
- **Alternatives**: 1) 1本の太い変更フィード API（差分込み）、2) 汎用 diff API のみ、3) 2分割（採用）。
- **Selected**: ① Changes Index（発見・メタのみ）＋② Revision Diff（差分・複数ページバッチ）。
- **Rationale**: 責務分離で両 API が汎用部品になり consumer 固有結合を避けられる。② は GROWI 画面や他用途にも転用可能。
- **Trade-offs**: 利用者は2回呼ぶ必要があるが、各 API が単純・キャッシュ/上限制御も独立。

### Decision: scope は `read:features:page` を流用
- **Context**: 「全ページ横断で本人の変更履歴を列挙」は単一ページ読みより広いとも言えるが、対象は本人が作成した版（ページ読み取り権限の範囲内）で、可視性は閲覧権限フィルタが境界づける。
- **Selected**: 新 scope を作らず `SCOPE.READ.FEATURES.PAGE` を流用（revisions コレクションの author を直接参照する設計のため、activity 経由の admin scope は不要）。
- **Follow-up**: 露出範囲の上限は Req 5（閲覧不可は path 非開示）と Req 7（ペア単位検証）で担保する。

### Decision: ② は POST + バッチ、ペア単位の独立認可
- **Context**: 複数ページのペアを一括送信、かつ① 経由を信用しない（IDOR 対策）。
- **Selected**: `POST /api/v3/revisions/diff`、body にペア配列（上限 ~20、正確値は実装定数）。ペアごとに (a) 版がそのページに属するか (b) 現在閲覧可能か を独立検証。結果は per-item の discriminated union（`ok|forbidden|invalid`）でリクエスト全体は失敗させない。

### Decision: ページングは keyset(cursor) 昇順
- **Context**: 増分同期中に新規版が増えても重複・取りこぼしを避ける。
- **Selected**: `(toRevision.createdAt, toRevision._id)` を鍵に昇順。cursor は不透明トークン。offset/limit は不採用。ページング単位は run。完結 run のみ emit し、既出 run の from/to は不変（後続編集は新 run になるだけ）。

### Decision: ルート衝突は既存 `/:id` の正規表現制約で解消（design validation 反映）
- **Context**: `GET /revisions/changes` が既存 `/:id` ワイルドカード（MongoId 検証で 400）に飲み込まれる（validation Critical Issue 1）。
- **Alternatives**: 1) 名前空間を `/revision-changes` 等に分離、2) 新ルータを先に登録し順序制御、3) 既存 `/:id` を24桁hex制約（採用）。
- **Selected**: 既存 `revisions.js` の `/:id` を `/:id([0-9a-fA-F]{24})` に制約。`changes` は構造的に非マッチとなり新ルータへ届く。URL は `/revisions/changes`・`/revisions/diff` を維持。
- **Rationale**: GROWI の Express は 4.21（`apps/app/package.json:161` / lock `express@4.21.0`）で正規表現パラメータ制約が使える（Express 5 では廃止のため不可）。登録順依存が消え最も堅牢。
- **Trade-offs**: 既存 `/:id` を1行触る（legacy 非改変方針の最小緩和）。副作用は非 ObjectId 1セグメントが 400→404。回帰テストで担保。

### Decision: 閲覧可否/削除は bulk 2クエリで判定、`deleted` はゴミ箱のみ（design validation 反映）
- **Context**: Req 5 の3状態（閲覧可/閲覧不可/削除）を出すが、`findByIdsAndViewer` は閲覧可ページしか返さず単独では区別不能（validation Critical Issue 2）。
- **Selected**: 索引1ページの pageId 群に (1) `findByIdsAndViewer`（閲覧可集合）＋ (2) 生 `Page.find({_id:{$in}},{status,path})`（存在・status）の bulk 2クエリで accessible/forbidden/trashed/不在 を判定。`deleted: boolean` はゴミ箱(`status='deleted'`)のみ。
- **Rationale**: 完全削除は `deleteCompletelyOperation`（`apps/app/src/server/service/page/index.ts:2378-2390`）が `Revision.deleteMany` も同時実行するため、revision 起点の索引に「完全削除ページ」は出ない。よって purge の区別は不要。区別してもコスト増は status を読むだけで追加クエリ無し。
- **Trade-offs**: `Promise.all`（非トランザクション）由来の稀な orphan revision は「不在」として安全側で索引から除外。

## Risks & Mitigations
- **run 検出とページングの相互作用** — ページング単位を run とし、完結 run のみ emit・cursor は to 版 `(createdAt,_id)`・既出 run 不変、と確定（design.md 参照）。他者割込み＋ページ境界フィクスチャの結合テストで担保（Req 4.1/4.2、3.3）。
- **大規模 wiki での著者横断クエリ** — `{ author: 1, createdAt: -1 }` 複合インデックスを schema 宣言＋autoIndex で構築（専用 migration は設けない）。無いと全走査。共有 MongoDB 構成（GROWI.cloud）では起動時の一斉構築を避けるためオペレーションで事前作成する。
- **前版算出 N+1** — `$setWindowFields`（partition by pageId）で一括取得し回避。
- **MongoDB バージョン** — `$setWindowFields` は 5.0+。GROWI 最小サポートは 6.0 と確認済みのため常に利用可（フォールバック案は不要として設計から除外）。
- **閲覧不可・ゴミ箱エントリの情報漏れ** — path・現内容を返さず識別子＋フラグのみ（Req 5.2）。
- **ルート衝突** — 既存 `/:id` を24桁hex制約にして解消（Express 4.21 で可）。`GET /revisions/changes` 200 の回帰テストで担保。

## References
- `diff` (jsdiff) `createPatch` / `structuredPatch` — unified diff 生成（既存依存 v5.0.0）
- MongoDB `$setWindowFields` `$shift` — partition 内の前後行参照（5.0+）
- `.claude/rules/mongodb-regex.md` — MongoDB 向け regex は `escapeStringForMongoRegex()`（path 前方一致を使う場合）
