# Brief: revision-diff-api

> 言語メモ: 本 brief は会話言語(日本語)で記述。`/kiro-spec-init` 実行時に spec.json.language を設定する。

## Problem

外部の API 利用者（具体的には PrimaVista の `agent-memory-ingest-growi`）が
「**PAT で認証した本人が GROWI 全体で最近編集した内容を、増分で取り込みたい**」が、
今の GROWI API ではそれができない。

検証で判明した発見ギャップ（discovery gap）:

- `GET /api/v3/revisions/list` … 単一 pageId の版一覧のみ。全ページ横断・著者軸の列挙ができない。
- `GET /api/v3/user-activities` … 本人の編集を全ページ横断で返せるが **PAT 非対応**（cookie/bearer のみ）。
- `GET /api/v3/activity` … PAT 可だが **admin 専用 scope（`read:admin:audit_log`）**で本人限定フィルタも無い。

つまり「**PAT 認証した本人の編集を、全ページ横断・時刻 T 以降で増分取得する**」入口だけが
欠けている。これは PrimaVista が GROWI Vault を取り込み元から外した理由
（編集者軸フィルタ＋差分同期が不可能）そのものであり、case X
（GROWI 本体に「自分の変更フィード API」を新設する）として既に決定済みの設計に対応する。

## Current State

- 差分計算は**クライアント側のみ**存在（`apps/app/src/client/components/PageHistory/RevisionDiff.tsx` が
  `diff` ライブラリの `createPatch()` を使用。`diff2html` で HTML 表示）。サーバ側に差分計算は無い。
- revision モデル（`apps/app/src/server/models/revision.ts`）は
  `pageId / body / author / createdAt / hasDiffToPrev / origin` を持つ。
  **prev ポインタは無く**、「ある版の1つ前」は同一 pageId で createdAt が一つ前の版を引いて求める。
  インデックスは `pageId` のみ（author 横断クエリ用の複合インデックスは無い）。
- PAT 認証基盤は整備済み: `accessTokenParser([SCOPE...])` middleware
  （`apps/app/src/server/middlewares/access-token-parser/`）＋ scope 体系
  （`packages/core/src/interfaces/scope.ts`）。
- OpenAPI は apiv3 各ルートの JSDoc `@swagger` で手書き。`@growi/sdk-typescript` 本体はこの repo に無く、
  SDK は consumer 側。本 spec の責務は API 実装＋swagger 注釈の提供まで。

## Desired Outcome

PAT を持つ利用者が、次の2本の汎用 API を組み合わせて
「自分の最近の変更を差分つきで増分取得」できる:

1. 期間（`since` または `fromDate`/`toDate`）を渡すと、**差分の中身は返さず**
   「どのページの、どの版からどの版を見ればよいか」の参照メタデータをページングで返す。
2. 版ペア（複数ページ対応・バッチ）を渡すと、各ペアの差分を返す。

両 API とも PrimaVista 固有でなく、GROWI 自身の画面や他の利用者も使える**汎用部品**として設計する。

## Approach

**作業を2つの責務に分割し、それぞれ独立した汎用 API にする**（1本の太いフィード API にしない）。

### API① 変更インデックス（discovery / metadata only）

- 入力: `since`（または `fromDate`/`toDate`）＋ keyset(cursor) ページング。
- 認証: PAT。対象ユーザーは **PAT 由来のユーザーに固定**（`userId` 等の入力は受けない）。
- データ源: **revisions コレクションの `author` を直接見る**（activity ログ経由にしない）。
- 出力（1エントリ＝1ページの「自分の連続編集のまとまり」）:
  - `pageId`
  - `fromRevisionId`（baseline = 自分の連続編集が始まる**直前**の版。ページ新規作成時は null）
  - `toRevisionId`（その連続編集の**最後**の版）
  - `author`（=自分）, `latestCreatedAt`
  - フラグ: `accessible`（今読めるか）, `deleted`（削除/ゴミ箱か）
  - `path` は **accessible な場合のみ**返す（後述のセキュリティ決定）
- ページ数不明のため**ページング必須**。`(createdAt, _id)` を鍵にした cursor 方式
  （offset/limit は増分中に境界がずれるため不採用）。

### API② 汎用 diff（複数ページ対応・バッチ）

- 入力: 版ペアの配列 `[{ pageId, fromRevisionId|null, toRevisionId }, ...]`（**最大 ~20 ペア/リクエスト**）。
  必要なら context 行数パラメータ。
- 認証: PAT（`read:features:page`）。
- 出力: ペアごとに unified diff（`fromRevisionId` が null なら「全文追加」）。
  権限が無いペアは**そのペアについて「権限なし」結果**を返す（リクエスト全体は失敗させない）。
- **① が安全に渡してくる前提に依存しない**: 受け取ったペア1件ごとに独立して権限検証する（後述）。

### PrimaVista 同期フロー（想定する使われ方）

1. ① を `since=前回同期時刻` で呼び、ページングしながら全エントリを取得。
2. accessible かつ未削除のエントリの版ペアを ②（最大20件バッチ）に渡し、差分を取得。
3. agent-memory に取り込む。`accessible=false` / `deleted=true` のエントリは consumer 側でスキップ。

## Scope

- **In**:
  - API① 変更インデックス（本人・全ページ横断・期間指定・cursor ページング・権限/削除フラグ）
  - API② 汎用 diff（複数ページ・バッチ・per-item 権限検証・サーバ側 diff 計算）
  - PAT/scope による認可、ページ閲覧権限に基づくフィルタ/フラグ付け
  - 両 API の swagger(JSDoc) 注釈
  - API① のための revisions 複合インデックス追加（migration）
- **Out**:
  - PrimaVista 側（agent-memory-ingest-growi）の consumer 実装・SDK 利用
  - GROWI 画面 UI の変更（本 spec は API のみ）
  - 既存クライアント差分表示（RevisionDiff）のサーバ側移行・置き換え
  - admin 監査ログ（activity）の改修

## Boundary Candidates

- 「変更を**探す**」責務（API①: 著者横断クエリ＋連続編集のまとめ＋ページング＋権限フラグ）
- 「差分の**中身を出す**」責務（API②: 版ペア→unified diff、権限検証、バッチ上限）
- 差分計算のコア（pure function 化して①の内部利用と②で共有可能か検討）

## Out of Boundary

- consumer（PrimaVista）固有のロジックは一切持たない。両 API は汎用部品に徹する。
- 「他人の編集履歴」を返す機能は持たない（本人限定）。
- 全文検索・ページツリー・通知などの他機能は対象外。

## Upstream / Downstream

- **Upstream（依存する既存資産）**:
  - revision モデル / revisions コレクション（`author`, `createdAt`）
  - PAT 認証 `accessTokenParser` ＋ scope 体系（`SCOPE.READ.FEATURES.PAGE`）
  - ページ閲覧権限判定（`Page.isAccessiblePageByViewer` 相当のバルク経路）
  - 差分ライブラリ `diff`（既存依存。`createPatch` をサーバ側で利用）
- **Downstream（利用者）**:
  - PrimaVista `agent-memory-ingest-growi`（case X の consumer。本 API を SDK 経由で利用）
  - 将来的に GROWI 自身の「自分の最近の変更」UI 等にも転用可能

## Existing Spec Touchpoints

- **Extends**: 既存 spec の更新は無い（新規 spec）。
- **Adjacent（重複回避のため意識する隣接領域）**:
  - `access-token-parser`（PAT/scope。本 API はこの基盤を再利用するだけで改修しない想定）
  - 既存 `apiv3/revisions.js`（同じ revisions ドメイン。route 規約・swagger 様式を踏襲）
  - `apiv3/user-activities.ts` / `apiv3/activity.ts`（発見系の隣接機能。本 API は PAT 対応の本人横断という未充足部分を埋める）

## Constraints

- **MongoDB regex 規約**: 動的文字列を query 用 regex に使う場合は `escapeStringForMongoRegex()` を使う
  （`RegExp.escape()` は PCRE2 非対応・禁止）。本 API は主に等価/範囲条件だが、path 前方一致等を使うなら遵守。
- **apiv3 規約**: `accessTokenParser` → `loginRequired` → express-validator → `apiV3FormValidator` の順、
  `res.apiv3(...)` / `res.apiv3Err(...)`、swagger は JSDoc `@swagger`。
- **immutability / named export / 英語コメント** 等のコーディング規約（`.claude/rules/coding-style.md`）。
- **TDD**: 新規変更はテスト先行（red→green）。

## 設計上の決定事項（design で確定済み／要確認）

| # | 項目 | 決定 |
|---|------|------|
| 1 | API① の scope | **`read:features:page` を流用**（activity 経由でなく revisions の author を直接見るため、新 scope は作らない） |
| 2 | `fromRevisionId`（前版）算出 | prev ポインタが無いので design で方式確定（`$setWindowFields` で pageId 分割・createdAt 順に前版 _id を付与、または stored prev）。**N+1 を避けること** |
| 3 | API② バッチ上限 | **最大 ~20 ペア/リクエスト**（差分は版本文を2本ずつメモリに載せるため。差分サイズ上限も検討） |
| 4 | 権限なし/削除の扱い | ①は**フィルタで消さずフラグで返す**（`accessible`/`deleted`）。②は当該ペアに「権限なし」結果を返す。**セキュリティ決定**: 権限なし item では現在の `path` を返さない（移動＋限定公開で現 path が新たな秘密になり得るため）。本人が元々持つ識別子（pageId/revisionId/createdAt）＋フラグのみ |
| 5 | 連続編集のまとめ | **他人の編集で中断されない「自分の連続編集」だけをまとめて1エントリ**。他人が割り込んだら別エントリに分割（他者の変更を自分の diff に混ぜない）。※この解釈で確定でよいか要確認 |

## セキュリティ要件（design/impl で必須）

- **②の IDOR 対策**: ②は①と切り離された汎用エンドポイントのため、①経由を前提にしない。
  受け取った各ペアについて (a) `fromRevisionId`/`toRevisionId` が指定 `pageId` の版か、
  (b) 今この利用者が当該ページを閲覧できるか、を**1件ずつ独立検証**。存在可否を漏らさない形でエラーを返す。
- **①の本人固定**: `userId` 等を入力で受けず、PAT 由来ユーザーに固定。
- **①の現在権限フィルタ**: 「author==自分」だけでなく「今アクセスできるか」でフラグ付け（権限なしは path 非開示）。

## パフォーマンス要件（design/impl で必須）

- **複合インデックス追加（前提条件）**: revisions に `{ author: 1, createdAt: -1 }`（migration）。
  無いと著者横断クエリが全走査になり大規模 wiki で致命的。
- **前版算出の N+1 回避**（決定#2）。
- **権限判定のバルク化**: 多数ページの閲覧可否をページ単位で評価しない。
- **②のバッチ/差分サイズ上限**（決定#3）。サーバ側 diff は新規 CPU 負荷なのでレート制限も検討。
