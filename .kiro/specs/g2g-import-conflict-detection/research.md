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
  - 同じ機序は SSO/LDAP/SAML 連携環境では `externalaccounts`（`{providerType, accountId}` の複合一意制約）・`externalusergroups`（`{externalId}` 単体、`{name, provider}` の複合一意制約）経由でも再現する。検知ロジックをフィールド単独一致から「フィールドの組一致」へ一般化し、この2コレクションを検知対象に含める。

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

### `externalaccounts` / `externalusergroups` の一意制約の実際の形
- **Sources**: `server/models/external-account.ts`、`features/external-user-group/server/models/external-user-group.ts`、`prisma/schema.prisma`
- **Findings**:
  - `ExternalAccount`: `schema.index({ providerType: 1, accountId: 1 }, { unique: true })`。フィールドはいずれも `required: true`、`sparse` 指定なし。Prisma 側にも `@@unique([providerType, accountId])` として同じ制約が存在する（Mongoose スキーマは索引作成のためだけに残置）。デフォルト/named export が無く、`mongoose.model('ExternalAccount')`（グローバルなモデルレジストリ経由）で取得する。
  - `ExternalUserGroup`: 単一フィールド `externalId`（`unique: true`、`sparse` 指定なし、`required: true`）と、複合 `schema.index({ name: 1, provider: 1 }, { unique: true })` の**2つ**の一意制約を持つ。デフォルトエクスポートをそのまま使える。
  - `ExternalUserGroupRelation`: 一意インデックスなし（`parent` への非一意インデックスのみ）。`usergrouprelations` と同型。
  - どの一意制約にも `sparse` 指定が無い。既存の `users.username`/`usergroups.name` と同じパターン（`sparse` なしだがフィールドが `required: true` なので実運用では欠落ドキュメントが作れない）。
  - `providerType` は `ldap`/`saml`/`oidc`/`google`/`github` の5種類しか値を取らない（`interfaces/external-auth-provider.ts`）。
- **Implications**: `externalaccounts` は複合キー1つ、`externalusergroups` は単一キー1つ+複合キー1つを検知対象として宣言する。ドリフト試験は4モデルとも同じ方法（`model.schema.indexes()`）で実際の一意インデックスを読める。

## Architecture Pattern Evaluation

| Option | 内容 | Strengths | Risks / Limitations | 判定 |
|--------|------|-----------|---------------------|------|
| A. 事前衝突検知＋中断（本 spec 採用） | 取り込み開始前に、アーカイブの users/usergroups と転送先の既存データを突き合わせ、衝突があれば取り込みを行わず操作者へ通知 | サイレント破壊を確実に止める / 書き込み前なので中断が非破壊でクリーン / 経路非依存の純関数として再利用可 / 実 DB で検証容易 / 低リスク | 衝突時に「転送を自動で成功させる」ことはしない（操作者が手当てして再実行）。到達範囲は「壊さない・気づける」まで | ✅ 採用（near-term deliverable） |
| B. `usergroups` を upsert 化 | 既存グループを skip でなく上書き | 実装は小 | 典型シナリオ（空の B・衝突は admin **ユーザー**）を直さない。name 衝突時は `find({_id}).upsert().replaceOne` が別 `_id` を新規 insert しようとして **name 一意違反で再度失敗**（`bulkOperate` の upsert は _id マッチ）。関係・ページの参照ずれも残る | ❌ 単独では不十分（不採用） |
| C. ID 再マッピングによる完全自動修復 | insert 失敗（一意違反）時に既存ドキュメントの `_id` を特定し、後続コレクションの `usergrouprelations.relatedUser`/`relatedGroup`・`pages.grantedGroups.item`・`grantedUsers` 等を貼り替えて転送を成功させる | 衝突があっても転送が成功する最も完全な解 | 取り込みが並行（上記）なので直列化が前提。参照箇所が広範（pages/comments/bookmarks/…）で網羅が難しい。中〜大・中〜高リスク | 将来拡張として design に記載（本 spec 対象外） |

検知対象を `externalaccounts` / `externalusergroups` へ広げる際に検討した、複合一意キーへの対応方式:

| Option | 内容 | Strengths | Risks / Limitations | 判定 |
|--------|------|-----------|---------------------|------|
| D. 一意キー宣言の一般化（採用） | `collectConflicts` をフィールドの組（1つ以上）で判定できるよう一般化し、コレクション→一意キー定義の宣言を1箇所にまとめる | 複合キーを正確に判定できる。単一の情報源。ドリフト試験と自然に一体化する | `detect-unique-conflicts.ts` のコア型・アルゴリズムを書き換える必要がある | ✅ 採用 |
| E. 片方のフィールドだけ近似的に見る | 複合キーの代表フィールド1つだけを見て衝突判定 | 変更が最小 | 複合キーの片方だけを見るのは不正確で偽陽性が増える。ドリフト試験の宣言リストも複合キーを正しく表現できない | ❌ 不採用 |
| F. 別モジュールとして並存 | `externalaccounts`/`externalusergroups` 専用の検知関数を新設し、既存コードへの変更をゼロにする | 既存コードへの変更ゼロ | 検知ロジックが2箇所に分かれ「単一の情報源」の原則に反する。ドリフト試験の宣言リストも2つに分かれ、将来の検知漏れ防止という目的を弱める | ❌ 不採用 |

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

### Decision: 複合キーの合成値は文字列連結ではなく `JSON.stringify` で作る

- **Context**: `externalaccounts`（`providerType` + `accountId`）・`externalusergroups`（`name` + `provider`）は、フィールドの組み合わせ全体が一致してはじめて一意制約違反になる。合成した1つの値でMap索引するために、複数フィールドの値を1つの文字列にまとめる必要がある。
- **Alternatives Considered**: 区切り文字による文字列連結（例: `providerType + '|' + accountId`）。実装は単純だが、値自体に区切り文字と同じ文字列が含まれると、異なるフィールドの組み合わせが同じ合成値になってしまう。たとえば `providerType="a", accountId="b|c"` と `providerType="a|b", accountId="c"` は、どちらも連結すると `"a|b|c"` になり、実際には別の組み合わせなのに同じ合成値として衝突と誤判定される。SAML の `accountId` のように任意の文字列が入り得るフィールドでは、区切り文字を選んでもこの衝突を排除できない。
- **Selected Approach**: `JSON.stringify(fields.map(f => doc[f]))` で配列表現の文字列を作る。各要素の境界が引用符とカンマで構造的に決まるため、値の中身がどんな文字列であっても、フィールドごとの値が混ざり合わない。
- **Rationale**: 複合キーの「組み合わせの一部だけが一致する場合は衝突として扱わない」という要件を、値の中身に依存せず安全に満たせる。
- **Trade-offs**: なし（`JSON.stringify` は標準 API で追加依存が不要）。

### Decision: 複合キーの既存候補取得は、フィールド単独の `$in` ではなくタプル単位のバッチ `$or` にする

- **Context**: 既存の `findExistingCandidates`（単一フィールド向け）は、キーのフィールドごとに1本 `$in` クエリを打ち、アーカイブ側が実際に使っている値に一致する既存ドキュメントを取得する。これは `username`/`email` のように値の種類が非常に多いフィールドでは有効な絞り込みになる。
- **Alternatives Considered**: この方式をそのまま複合キーにも流用する。しかし `externalaccounts` の `providerType` は `ldap`/`saml`/`oidc`/`google`/`github` の5種類しか値を取らない、値の種類が少ないフィールドである。`providerType` 単体の `$in` は転送先コレクションのほぼ全件に一致してしまい、既存コードが前提としている「既存データを一括で全部メモリに乗せない」という性能上の制約を崩す。
- **Selected Approach**: 複合キーの候補取得は、アーカイブ側が実際に使っているキーの組み合わせ（タプル）ごとに、そのタプルの全フィールドに完全一致する条件を組み立て、それらをバッチにまとめた `$or` クエリ（例: `{ $or: [{ providerType: 'saml', accountId: 'x' }, ...] }`）で取得する。この方式は `externalaccounts`/`externalusergroups` が実際に持つ複合インデックス（`{providerType, accountId}`/`{name, provider}`）をそのまま使える。単一フィールドキー（`username` 等）は既存の `$in` 方式のままでよい（値の種類が多く、この問題が起きないため）。
- **Rationale**: 複合キーの性質（値の種類が少ないフィールドを含みうる）に対して、単一フィールド向けの絞り込み戦略をそのまま適用しない、という判断。
- **Trade-offs**: `findExistingCandidates` のバッチ構築ロジックが、単一キー用と複合キー用の2通りになる。判定そのもの（`collectConflicts`）は変わらないため、影響は候補取得の内部実装に閉じる。`EXISTING_LOOKUP_BATCH_SIZE`（1000）を `$or` のタプル件数上限にも流用しているが、`$in` の1000要素と `$or` の1000分岐はクエリの重さが同じではない。複合索引（`{providerType, accountId}` 等）が実際に使われコレクションスキャンにならないことは、まだ確認していない。`detect-unique-conflicts.integ.ts` / `g2g-transfer.integ.ts` の実 DB 結合試験は、この `$or` クエリが返す結果（衝突あり/なしの判定）を検証しているだけで、`explain()` によるインデックス使用の確認は行っていない（コードベース内に `explain(` の呼び出しは無い）。インデックス利用の裏付けは今後の課題として残る。

### Decision: コレクションごとの一意キー宣言は、`Record` ではなく「`T` を閉じ込めるヘルパー関数」で持つ

- **Context**: コレクションごとに一意キーの型 `T`（`UserUniqueFields`/`GroupUniqueFields`/`ExternalAccountUniqueFields`/`ExternalUserGroupUniqueFields`）が異なる。宣言を `Record<CollectionName, {keys, pick}>` のような連想配列で素直に持とうとすると、値の型を `T` ごとに書き分けられず、`pick` 関数を `(doc: RawDocument) => RawDocument` へ広げる必要が出る。しかし `UserUniqueFields` のような具体的なインターフェースには索引シグネチャが無いため、この代入は実際に tsc でエラーになる（`Index signature for type 'string' is missing in type 'UserUniqueFields'`）。
- **Alternatives Considered**:
  1. `Record<CollectionName, {keys, pick}>` を型アサーション（`as`）で無理やり通す — `.claude/rules/coding-style.md` の型アサーション回避方針に反するため却下。
  2. `collection` で判別できる合併型にして、orchestrator の中でコレクションごとに `switch` 分岐する — 型アサーションは避けられるが、今度は orchestrator に「コレクション名で分岐する処理」が復活し、「新しいコレクションが増えたときに宣言へ1エントリ追加するだけで済む」という Revalidation Trigger の前提を壊す。却下。
- **Selected Approach**: `declareDetector<T>(collection, keys, pick)` というジェネリックなヘルパー関数を用意し、コレクションごとに1回呼び出す。この呼び出し1回1回が独立したジェネリック呼び出しなので、その場で `T` が確定し、返り値の `CollectionDetector`（`{ collection, detect(jsonPath, lookup) }`）自体はジェネリック引数を持たない（`T` は `detect` メソッドの中に閉じ込められる）。そのため `COLLECTION_DETECTORS: readonly CollectionDetector[]` は型アサーションなしで均質な配列として持てる。`CollectionDetector` 型は `collection` と `detect` のみを公開し、キー宣言（`fields`）自体は公開しない（`T` を消してしまい、型アサーション問題を再導入するため）。ドリフト試験は `COLLECTION_DETECTORS` からコレクション名の一覧だけを読み、キー宣言自体は4つの `*_UNIQUE_KEYS` 定数を直接 import して読む。
- **Rationale**: 「宣言を1箇所にまとめる」という目標と「型アサーションを避ける」という既存の規約の両方を、実装可能な形で両立させる。
- **Trade-offs**: なし（既存の `detectForCollection` をそのまま `declareDetector` の内部から呼ぶだけで、判定ロジック自体は変わらない）。

## Risks & Mitigations
- **push 側のエラー転送が汎用 key 固定**（`admin:g2g:error_send_growi_archive`）で具体情報が届かない — 受信側エラー本文に衝突サマリを載せ、push 側 catch で axios エラー応答を読んで具体 `admin:g2gError` を emit する。ここは実装時に push 側の catch を要確認。
- **アーカイブが巨大**（数万ユーザー）で全件突き合わせのメモリ/時間 — 対象一意フィールドだけを stream 読みして値集合を作り、既存側は `$in` バッチ照会。まず正しさを優先し、性能は必要時に最適化（design の Performance 節に方針のみ記載）。
- **検知漏れ（false negative）でサイレント破壊が残る** — integ で「衝突あり/なし/同一 _id」を実 DB で検証（Req 5.1）。加えて sparse フィールドの null 同士を衝突扱いしないことを明示的にテスト。
- **正常系リグレッション**（衝突ゼロなのに転送が中断する false positive）— integ で「衝突なし → 従来どおり取り込み完了、かつユーザーに紐づくグループ ID が解決」を検証（Req 4/5.2）。
- **`ExternalAccount` にモデルの export が無い** — `mongoose.model('ExternalAccount')` で取得する（既存の `User` 取得と同じ手法）。この呼び出しより前に一度でも `~/server/models/external-account` がインポートされていることが必要だが、G2G 受信ルートが動く時点ではサーバ起動時に読み込まれているため到達可能（既存の `User`/`UserGroup` と同様、起動グラフに含まれるモデルファイル）。単体テストでは明示的な import が要る。
- **`field` プロパティの意味拡張が将来の読み手に伝わらない** — `UniqueFieldConflict.field` の型は元々 `username`/`email`/`slackMemberId`/`name` だけを受け付ける閉じた合併型だったが、複合キーのラベル（例: `providerType+accountId`）を代入できるよう `string` へ広げた。型のドキュメンテーションコメントで「単一フィールド名、または複合キーのラベル」であることを明記する。
- **ドリフト試験（要件 6）の「実際の一意制約」の正が、`externalaccounts` については将来 Mongoose からずれる** — `external-account.ts` の Mongoose スキーマは「全モデルが Prisma へ移行完了するまでの暫定コード」と明記されており（`.claude/rules/model.md`）、同じ一意制約は既に `prisma/schema.prisma` にも存在する。全モデルの移行が完了し Mongoose スキーマが削除される段階になったら、ドリフト試験の参照先を Prisma スキーマへ切り替える必要がある（design.md の Revalidation Triggers 参照）。
- **`UniqueConflictReport` の形の変更が、想定より広い範囲の既存テストを壊す** — `g2g-transfer.integ.ts` が `report.userConflicts`/`report.groupConflicts` という旧形に直接依存する `expect` を15箇所以上持っていた。`detect-unique-conflicts.spec.ts`/`.integ.ts`/`summarize-unique-conflicts.spec.ts` も、単なるケース追加ではなく既存アサーションの書き換えを要した。

## References
- GROWI issue #10151 — The page cannot be assigned to the correct group in Transfer data from this GROWI to another GROWI
- `server/service/import/import.ts`（取り込み本体・`execUnorderedBulkOpSafely`）
- `server/service/g2g-transfer.ts`（受信側 `getImportSettingMap` / `importCollections`）
- `server/routes/apiv3/g2g-transfer.ts`（受信ルートの取り込みフロー）
- `server/models/user/index.js` / `user-group.ts` / `user-group-relation.ts` / `page.ts`（一意制約・関係解決・閲覧判定）
- `server/models/external-account.ts` / `features/external-user-group/server/models/external-user-group.ts`（`externalaccounts`/`externalusergroups` の一意制約。前者は Mongoose→Prisma 移行の暫定コード、`prisma/schema.prisma` に同じ `@@unique` 定義がある）
- `.kiro/specs/g2g-transfer-migration-mode/design.md`（`deriveReplaceTargets` が宣言データ駆動であり、本 spec の検知対象拡張の影響を受けないことの根拠）
