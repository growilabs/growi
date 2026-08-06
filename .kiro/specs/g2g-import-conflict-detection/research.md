# Research & Design Decisions

---
**Purpose**: issue #10151（G2G 転送でグループ公開ページが閲覧不能になる）の実装ギャップ分析と方式決定を記録する。全ソースコードは read-only で調査済み。
---

## Summary
- **Feature**: `g2g-import-conflict-detection`
- **Discovery Scope**: Extension（既存 G2G 転送・取り込みサービスへの追加）
- **Key Findings**:
  - 発生機序は確認済み: `insert` モードの `bulk.insert()` が一意制約違反をサイレントに取りこぼし、`execUnorderedBulkOpSafely` が書き込みエラーを配列で受けて**続行**する。取りこぼされた `users` ドキュメントに紐づく `usergrouprelations` が「存在しないユーザー」を指すため、ログイン後の本人（＝転送先の既存アカウント）はグループ公開ページにアクセスできない。
  - G2G の受信側は、取り込み前にアーカイブを unzip・parse 済み（`innerFileStats` に `collectionName` と `fileName` がある）。**衝突検知を差し込む自然な位置がある**。
  - コレクション取り込みは名前に反して**逐次でなく並行**に走る（`import()` の `collections.map(importCollection)` が各パイプラインを即開始し、`for await` は開始済みの promise を順に await するだけ）。このため「ユーザー/グループを先に入れて ID 対応表を作り、後で関係・ページを貼り替える」型の完全自動修復（Option C）は、取り込み順序の直列化という別課題を先に解く必要がある。
  - 実 DB を使う結合試験基盤が既にある（`^/test/setup/crowi` の `getInstance`、レプリカセット rs0）。受信側サービス単位で衝突検知・関係解決を検証できる。

## Research Log

### 発生機序（失敗の連鎖）の裏付け
- **Sources**: `server/service/import/import.ts`、`server/models/user/index.js`、`server/models/user-group.ts`、`server/models/user-group-relation.ts`、`server/models/page.ts`
- **Findings**:
  - `import.ts` L371-373: 非 upsert 時は `bulk.insert(document)`。
  - `import.ts` L472-501 `execUnorderedBulkOpSafely`: `unorderedBulkOp.execute()` が `MongoBulkWriteError` を投げても `err.result` と `err.writeErrors` を取り出して**正常戻り**する（＝取りこぼしても続行）。
  - `models/user/index.js` L73-75: `username`（`required, unique`）・`email`（`unique, sparse`）・`slackMemberId`（`unique, sparse`）。（タスク指示の「L49-50」は現行では L73-75。）
  - `models/user-group.ts` L26: `name`（`required, unique`）。
  - `models/user-group-relation.ts` L170-180 `findAllUserGroupIdsRelatedToUser(user)` = `find({ relatedUser: user._id }).select('relatedGroup')`。**関係はユーザーの `_id` で引かれる**。取りこぼされた A_userId ではなく既存 B_adminId でログインするため、A_userId に紐づく関係はヒットしない。
  - `models/page.ts` L498-503（`addConditionForParentNormalization`）と L555-573（`addConditionToFilteringByViewer` → `generateGrantCondition`）: グループ公開ページは `grantedGroups: { $elemMatch: { item: { $in: userGroups } } }` で照合。`userGroups` は上記 `findAllUserGroupIdsRelatedToUser` の結果。したがって「ユーザー・グループ・関係」の 3 者が整合して初めて閲覧できる。
- **Implications**: 破壊の起点は **`users` の取りこぼし**（典型は転送元/先で同一人物の管理者アカウント）。`usergroups` 自体は空の転送先には衝突せず取り込まれるので、Option B（`usergroups` を upsert 化）だけでは典型シナリオを直せない。

### G2G 転送の取り込み経路と差し込み位置
- **Sources**: `server/routes/apiv3/g2g-transfer.ts`、`server/service/g2g-transfer.ts`、`client/components/Admin/G2GDataTransfer.tsx`、`G2GDataTransferExportForm.tsx`、`client/components/Admin/ImportData/GrowiArchive/ImportCollectionItem.jsx`
- **Findings**:
  - 受信側ルート `receiveRouter.post('/')`（`routes/apiv3/g2g-transfer.ts` L288-403）は、(1) body parse → (2) `importService.unzip` + `growiBridgeService.parseZipFile`（`innerFileStats`）→ (3) `importService.validate(meta)` → (4) `g2gTransferReceiverService.getImportSettingMap` → (5) `g2gTransferReceiverService.importCollections` の順。**(3)/(4) と (5) の間**が衝突検知の差し込み位置（この時点でアーカイブは tmp 上に展開済み、まだ書き込みは 0）。
  - 取り込みモードは受信側 `getImportSettingMap`（`service/g2g-transfer.ts` L686-736）が転送元の `optionsMap` の mode をそのまま採用。`users`/`usergroups` の mode を検証・制限していない（`pages` の insert 禁止と `configs` の flushAndInsert 限定のみ）。
  - 転送元 UI（`G2GDataTransferExportForm.tsx` L287-302 `setInitialOptionsMap`）の既定 mode: `MODE_RESTRICTED_COLLECTION`（`ImportCollectionItem.jsx` L25-29）にある `users`=`['insert','upsert']`→先頭 `insert`、`pages`=`['upsert','flushAndInsert']`→先頭 `upsert`。`usergroups`/`usergrouprelations` は未登録なので `DEFAULT_MODE='insert'`。**→ G2G 既定は users/usergroups/usergrouprelations すべて insert**。
  - 通知経路: push 側 `startTransfer`（`service/g2g-transfer.ts` L459-559）は fire-and-forget で、失敗時に転送元の admin socket へ `admin:g2gError`（`{ message, key }`）を emit。受信側ルートは push 側の axios 呼び出しにエラー応答を返す（現状は key 固定の汎用エラー）。**衝突を具体的に伝えるには、受信側がエラー本文に衝突情報を載せ、push 側がそれを転送元 admin socket に転送する必要がある**。
- **Implications**: 検知は「転送先の既存データを知っている受信側（B）」でしか行えない（転送元 A は B のユーザー一覧を持たない）。通知は既存の WebSocket 経路で転送元管理者へ返す。

### 取り込みの並行性（Option C の障壁）
- **Sources**: `server/service/import/import.ts` L140-189
- **Findings**: `import()` は「serially と書かれているが実際は並行」。`collections.map(c => this.importCollection(c, ...))` が各 async パイプラインを即時開始し、`for await (const promise of promises)` は開始済み promise を順に await するのみ。`importCollection` の最初の await は `deleteMany`（flushAndInsert 時）か `pipeline(...)`。
- **Implications**: users/usergroups/usergrouprelations/pages は相互に順序保証なく並行取り込み。「先に users/usergroups を入れ、衝突→既存 `_id` を確定→ 後続の usergrouprelations・pages を貼り替える」型の Option C は、取り込みの直列化（依存順の導入）を伴う中〜大の改修になる。本 spec の near-term 範囲外。

### 手動取り込み経路との関係
- **Findings**: 管理画面の GrowiArchive 手動取り込みも同じ `ImportService`（同じ insert 挙動）を使う。ただし手動 UI は per-collection の失敗件数（`errorsCount`）を表示するため、G2G よりは気づけるが、「1 件のユーザー取りこぼしがグループ公開ページ全体の到達不能に波及する」ことは操作者には自明でない。
- **Implications**: 検知の中核は経路非依存の純関数として作り、手動経路への横展開を将来可能にする（本 spec の受け入れ対象は G2G）。

### テスト基盤
- **Sources**: `server/routes/apiv3/import-executor.integ.ts`、`server/service/import/import.spec.ts`、`server/service/import/construct-convert-map.integ.ts`
- **Findings**: unit は `vitest-mock-extended` の `mock<Crowi>()` と `vi.hoisted` によるモジュールモック。integ は `^/test/setup/crowi` の `getInstance()` で実 Crowi + 実 MongoDB（rs0）。`*.integ.ts` は integ プロジェクトで自動的に DB 配線される。
- **Implications**: 衝突検知（Req 1/2）と関係解決（Req 4/5）は integ で実 DB を読み直して検証できる。純関数部は unit でも可。

## Architecture Pattern Evaluation

| Option | 内容 | Strengths | Risks / Limitations | 判定 |
|--------|------|-----------|---------------------|------|
| A. 事前衝突検知＋中断（本 spec 採用） | 取り込み開始前に、アーカイブの users/usergroups と転送先の既存データを突き合わせ、衝突があれば取り込みを行わず操作者へ通知 | サイレント破壊を確実に止める / 書き込み前なので中断が非破壊でクリーン / 経路非依存の純関数として再利用可 / 実 DB で検証容易 / 低リスク | 衝突時に「転送を自動で成功させる」ことはしない（操作者が手当てして再実行）。到達範囲は「壊さない・気づける」まで | ✅ 採用（near-term deliverable） |
| B. `usergroups` を upsert 化 | 既存グループを skip でなく上書き | 実装は小 | 典型シナリオ（空の B・衝突は admin **ユーザー**）を直さない。name 衝突時は `find({_id}).upsert().replaceOne` が別 `_id` を新規 insert しようとして **name 一意違反で再度失敗**（`bulkOperate` の upsert は _id マッチ）。関係・ページの参照ずれも残る | ❌ 単独では不十分（不採用） |
| C. ID 再マッピングによる完全自動修復 | insert 失敗（一意違反）時に既存ドキュメントの `_id` を特定し、後続コレクションの `usergrouprelations.relatedUser`/`relatedGroup`・`pages.grantedGroups.item`・`grantedUsers` 等を貼り替えて転送を成功させる | 衝突があっても転送が成功する最も完全な解 | 取り込みが並行（上記）なので直列化が前提。参照箇所が広範（pages/comments/bookmarks/…）で網羅が難しい。中〜大・中〜高リスク | 将来拡張として design に記載（本 spec 対象外） |

## Design Decisions

### Decision: near-term は Option A（事前衝突検知＋中断）を実装する
- **Context**: 現状は「転送成功と表示されるのにグループ公開ページが閲覧不能」というサイレント破壊。まず止血し、操作者が気づいて手当てできる状態にすることが最優先。
- **Alternatives Considered**:
  1. Option B（usergroups upsert 化）— 典型シナリオを直さない・name 衝突で二次失敗。
  2. Option C（ID 再マッピング）— 完全だが取り込み直列化が前提で中〜大改修。
- **Selected Approach**: 受信側で取り込み開始前に `users`（`username`/`email`/`slackMemberId`）と `usergroups`（`name`）の衝突を検知する純関数を作り、G2G 受信ルートの unzip 後・`importCollections` 前に呼ぶ。衝突が 1 件でもあれば取り込みを開始せず、衝突情報を含むエラーを push 側へ返し、push 側が転送元 admin socket に具体的な `admin:g2gError` を emit する。
- **Rationale**: 書き込み前に検知するため中断が非破壊。検知は転送先の既存データを持つ受信側でしか行えない。純関数化で手動経路への将来横展開と実 DB テストが容易。低リスクで requirements（特に Req 2 の「壊れたデータを作らない」）を確実に満たす。
- **Trade-offs**: 衝突時に転送は成功しない（操作者が衝突を解消して再実行）。issue 報告者はこの「検知＋警告」を許容可能な回避策と明言している。完全自動修復は Option C として将来に残す。
- **Follow-up**:
  - 通知文言（error key / message）は英語ファースト。翻訳は後続タスク（i18n は本機能のゲートにしない）。
  - 検知対象の一意フィールドは users=`username`/`email`/`slackMemberId`、usergroups=`name` に限定（インデックス定義と一致）。
  - `email`/`slackMemberId` は sparse。null/未設定同士は一意違反にならないので、**値が存在するドキュメントのみ**を突き合わせ対象にする。

### Decision: 検知の「同一性」は「一意値の一致 かつ `_id` 不一致」で判定
- **Context**: 同一ドキュメントの再取り込み（同じ `_id`）は衝突でない（upsert/replace で問題にならない）。別 `_id` で同じ一意値を持つものだけが insert を失敗させる。
- **Selected Approach**: アーカイブ側ドキュメント `a` と既存側 `b` について、対象一意フィールドの値が等しく、かつ `a._id !== b._id` のものを衝突とする（Req 1.5）。
- **Trade-offs**: 大量ユーザーの突き合わせは、既存側を対象一意フィールドで一括 `find({ field: { $in: [...values] } })` して Map 化し、アーカイブを走査して照合する（N+1 を避ける）。

## Risks & Mitigations
- **push 側のエラー転送が汎用 key 固定**（`admin:g2g:error_send_growi_archive`）で具体情報が届かない — 受信側エラー本文に衝突サマリを載せ、push 側 catch で axios エラー応答を読んで具体 `admin:g2gError` を emit する。ここは実装時に push 側の catch を要確認。
- **アーカイブが巨大**（数万ユーザー）で全件突き合わせのメモリ/時間 — 対象一意フィールドだけを stream 読みして値集合を作り、既存側は `$in` バッチ照会。まず正しさを優先し、性能は必要時に最適化（design の Performance 節に方針のみ記載）。
- **検知漏れ（false negative）でサイレント破壊が残る** — integ で「衝突あり/なし/同一 _id」を実 DB で検証（Req 5.1）。加えて sparse フィールドの null 同士を衝突扱いしないことを明示的にテスト。
- **正常系リグレッション**（衝突ゼロなのに転送が中断する false positive）— integ で「衝突なし → 従来どおり取り込み完了、かつユーザーに紐づくグループ ID が解決」を検証（Req 4/5.2）。

## References
- GROWI issue #10151 — The page cannot be assigned to the correct group in Transfer data from this GROWI to another GROWI
- `server/service/import/import.ts`（取り込み本体・`execUnorderedBulkOpSafely`）
- `server/service/g2g-transfer.ts`（受信側 `getImportSettingMap` / `importCollections`）
- `server/routes/apiv3/g2g-transfer.ts`（受信ルートの取り込みフロー）
- `server/models/user/index.js` / `user-group.ts` / `user-group-relation.ts` / `page.ts`（一意制約・関係解決・閲覧判定）
