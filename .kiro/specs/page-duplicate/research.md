# Research & Design Decisions

## Summary

- **Feature**: `page-duplicate`
- **Discovery Scope**: Complex Integration（既存の複製処理の作り直しと、操作記録・定期処理・アプリ内通知・MongoDB の集計処理との統合）
- **Key Findings**:
  - 配下の複製は、各ページの全版を読み込み、どの版を写すかを検索結果の並び順に任せている。メモリの問題であると同時に、写る本文が最新版である保証がない不具合でもある。
  - MongoDB の `$merge` を使えば、版の本文をアプリへ運ばずに DB の中で写せる。GROWI の対応版（6.0 以上）で、読み込み元と同じコレクションへの書き込みもできる。ただし、トランザクションの中では使えず、途中で失敗しても書き込み済みの分は残る。
  - 操作記録の期限を延ばす今の仕組み（5秒ごとのタイマー）は、処理が固まっていても期限を延ばし続ける。止まったことを見分けるには、処理が1段進むたびに期限を延ばす方式が要る。リポジトリには変更提案の適用処理（change-proposal）に同じ考え方の前例がある。

## Research Log

### 今の複製の流れと、途中で止まったときの状態

- **Context**: 要件4（自動回復）と要件1（最新版）の前提を確かめる。
- **Sources Consulted**: `apps/app/src/server/service/page/index.ts`（`duplicate` 1555〜1739、`duplicateRecursivelyMainOperation` 1741〜1791、`duplicateDescendantsWithStream` 2050〜2116、`duplicateDescendants` 1901〜1990、v4 系 1815〜2167、`normalizeParentAndDescendantCountOfDescendants` 4235〜）、`routes/apiv3/pages/index.js`。
- **Findings**:
  - 先頭ページは `create()` で同期的に作られ、ページツリーにつながる。配下は、応答を返した後に裏で走る処理（待たない非同期処理）が複製する。
  - 配下は、親子のつながりを親ごとにたどる読み出し（`PageCursorsForDescendantsFactory`）で、子を親より先に返す順に読み、100件ずつ処理する。「リンクを知っている人のみ」のページは親を持たないので、たどる対象に入らない（要件 6.4 はこの性質で成り立っている）。
  - 1回分（100件）の処理は、ページの挿入 → 版の作成 → タグの複製の順で、トランザクションはない。1回分の例外はログに出して握りつぶし、次へ進む。そのため、件数の数え方が実際より多くなることがある。
  - 写したページは親を持たない状態で挿入され、すべて終わった後の整え処理（親の付け直しと配下ページ数の数え直し）でツリーにつながる。途中で止まると、写しはツリーから見えない。
  - 裏の処理の例外は、操作記録を消したあと、誰も待っていない Promise へ再送出される。プロセスはログに出すだけで終わらない。
  - v4 の経路には操作記録も重なりの判定もなく、裏の処理には例外の受け止めもない。写しは親を持たないまま残る（旧形式のページはもともとツリーの外にある）。
- **Implications**: 回復処理は、件数を当てにせず数え直す必要がある。整え処理を成功時と回復時の両方で使える形にする。

### 版のドキュメントの項目と、DB の中で写すときに必要な値

- **Context**: 要件1・2。`$merge` で写した版が、通常の経路で作った版と区別できないようにする。
- **Sources Consulted**: `apps/app/prisma/schema.prisma`（revisions 683〜707、pages 607〜654）、`src/utils/prisma.ts`（全モデル共通の拡張 150〜222）、`src/server/models/revision.ts`、`src/server/models/page.ts`（`pushRevision` 1088〜1129）、`src/server/util/prisma-raw-normalize.ts`。
- **Findings**:
  - 今の配下の複製が作る版の項目は `_id, pageId, body, author, format: 'markdown', createdAt, __v: 0`。`createdAt` と `__v` は Prisma が補っている。`origin`・`hasDiffToPrev`・`proposalId`・`proposalOperationKey` は持たない。先頭ページの版も同じ項目になる。
  - Prisma の拡張は、作成時には何もしない（更新時に `__v` を進めるだけ）。DB の中で写す場合に自分で設定する必要があるのは、`__v: 0`、`createdAt`、`format` の既定値だけ。
  - `pageId` と `author` は ObjectId、`createdAt` は日時型でなければならない。Yjs の同期、版の差分の索引、履歴の一覧がこれらの型に依存している。
  - Prisma の生の集計（`aggregateRaw`）に ObjectId や日時を渡すときは、拡張 JSON（`{ $oid }` / `{ $date }`）で渡す必要がある。そのまま渡すと文字列になり、照合は黙って何も一致しない（`prisma-raw-normalize.ts` の `toRawObjectId` / `toRawDate` の注記、実機で確認済み）。
  - Mongoose の版のスキーマは、本文を読むときに CR / CRLF を LF に直す。今の複製は Prisma 経由で読んで書くので、直した後の本文を書いている。DB の中で写すと、保存されている本文がそのまま写る。読むときに同じく直されるので、表示は変わらない。
  - リポジトリに `$merge` / `$out` の使用例はない（初めての使用になる）。
- **Implications**: 写しの版の項目は「今と同じ7項目」に固定し、それ以外は持ち込まない。ObjectId と日時の型が正しく保存されることを、結合テストで確かめる。

### MongoDB の `$merge`

- **Context**: 要件2。本文をアプリに読み込まない写し方の成立条件。
- **Sources Consulted**:
  - https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/
  - https://www.mongodb.com/docs/manual/reference/command/aggregate/
  - https://www.mongodb.com/docs/manual/core/aggregation-pipeline-limits/
  - https://www.mongodb.com/docs/manual/reference/limits/
  - https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexOfArray/ 、 https://www.mongodb.com/docs/manual/reference/operator/aggregation/arrayElemAt/
  - https://www.mongodb.com/docs/v7.0/reference/operator/aggregation/getField/
  - https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries
- **Findings**:
  - 読み込み元と同じコレクションへの書き込みは 4.4 以降で可能。GROWI の対応版（6.0 以上、CI は 6.0 と 8.0）を満たす。既存の版を書き換えず、新しい `_id` を持つ版だけを挿入するので、同じ版を何度も読み直す問題（Halloween 問題）は起きない。
  - 出力に `_id` があればそのまま使う。照合のキーは既定の `_id` で、既定の索引で条件を満たす。
  - 多文書トランザクションの中では使えない。書き込みの段を含む集計は、ドライバの自動再試行の対象にならない。
  - 途中で失敗しても、書き込み済みの文書は取り消されない。
  - `$match` / `$set` / `$project` / `$merge` は、メモリ上限（100MB）のある段に入らない。結果を返さないので、返す結果の 16MB 上限も関係しない。挿入する各文書は 16MB に収まる必要がある（元の版が収まっているので、項目を増やさない限り収まる）。集計の命令そのものも 16MB 未満である必要があるが、100件分の ID 対応表は十分小さい。
  - 小さな対応表から新しい ID を引く方法は、`$indexOfArray` と `$arrayElemAt` の組み合わせがよい。`$getField` は 6.0・7.0 では項目名に定数しか取れず使えない。`$indexOfArray` は見つからないと -1 を返し、`$arrayElemAt` に -1 を渡すと最後の要素を黙って返すので、照合と対応表を同じ ID の並びから作って「必ず見つかる」状態にする。
  - Prisma 6 では `prisma.revisions.aggregateRaw({ pipeline })` が正式な経路。`$runCommandRaw` で `aggregate` を送ることは Prisma の文書で非推奨。対応表の中の `{ $oid }` が ObjectId に変換されるかは、文書に明記がない（実装の最初に確かめる）。
  - Amazon DocumentDB・Azure の互換サービスでの、読み込み元と同じコレクションへの `$merge` は文書化されていない。GROWI はこれらを公式に対応していない（リポジトリに言及なし）。
- **Implications**: 版の写しは `aggregateRaw` で行い、トランザクションの外で実行する。写した件数を後から数えて確かめる。

### 操作記録（PageOperation）と、止まったことの見分け方

- **Context**: 要件3・4。
- **Sources Consulted**: `apps/app/src/server/models/page-operation.ts`、`apps/app/src/server/service/page-operation.ts`、`src/features/change-proposal/server/`（`applyLease`、change-proposal.ts 192〜246、proposal-applier.ts 329・411）、`features/growi-vault/server/resilience/bootstrap-heartbeat.ts`、`server/service/cron.ts`、`server/service/page/wip-page-cleanup-cron.ts`、`crowi/index.ts`（`setupCron` 487〜543、`setupPageService` 954）。
- **Findings**:
  - 操作記録は期限（`unprocessableExpiryDate`、作成時に今から10秒後）を持つが、重なりの判定（`canOperate`）は期限を見ない。期限を延ばすタイマー（`autoUpdateExpiryDate`、5秒ごとに10秒延長）を使うのは、改名の後半の処理だけ。
  - 起動時の掃除（`init()`）は、複製を含む多くの種類の記録を通知なしで消す。複数のプロセスで動かしている場合、1つが再起動すると、他のプロセスが実行中の記録まで消す。
  - 操作記録には作成時刻の項目がない（`_id` から分かるだけ）。持ち主を表す項目もない。
  - `canOperate` が期限を見るように変えると、改名の後半以外のすべての操作で、開始から約10秒後に重なりの保護が外れる。作成・移動・削除・元に戻す・変更提案の待ち合わせに影響する。
  - 定期処理は `CronService`（node-cron）の派生クラスで、すべてのプロセスで動く。プロセス間の主の選出や分散ロックはない。正しさは「条件付きの原子的な確保」で保っている（WIP の掃除は `findOneAndUpdate`、変更提案は持ち主の印と期限を持つ貸し出し（lease）で、処理が1段進むたびに延ばす）。
- **Implications**: `canOperate` は変えない。複製の記録に「持ち主の印」と「進捗で延ばす期限」を持たせ、回復は条件付きの確保で1回に限る。

### アプリ内通知

- **Context**: 要件5。
- **Sources Consulted**: `src/server/service/in-app-notification.ts`、`src/server/service/pre-notify.ts`、`src/server/service/in-app-notification/in-app-notification-utils.ts`、`src/features/page-bulk-export/server/service/page-bulk-export-job-cron/index.ts`（`notifyExportResult` 326〜350）、`src/interfaces/activity.ts`、`src/client/components/InAppNotification/**`。
- **Findings**:
  - 一括エクスポートの失敗通知が手本になる。`createActivity` → 通知先を決める関数（`PreNotify`）→ `activityEvent.emit('updated', ...)` の流れで、要求した本人だけに届く。
  - 新しい操作の種類は、`SupportedAction` と `EssentialActionGroup` の両方に加える必要がある。後者に入れないと、記録も通知も行われない。
  - 既定の通知先の決め方（`generatePreNotify`）は、対象ページの購読者にも送る。写しの先頭ページは複製した本人が購読しているが、他の人が購読している可能性もあるので使わない。
  - 通知の付帯情報（snapshot）は自由な JSON 文字列だが、今は対象のモデルからしか作れない。件数やパスを載せるには、作り方を足す必要がある。
  - 画面では、対象がページの通知は `PageModelNotification` が描き、クリックで対象ページへ移動する。主文（`actionMsg`）は英語の固定文で、多言語の文言は補足欄（`subMsg`）で出す。

### 全文検索の再索引のメモリ

- **Context**: 要件2の「GROWI のプロセスのメモリ」に、複製の後に走る全文検索の再索引が入るかの確認。
- **Sources Consulted**: `src/server/service/search-delegator/elasticsearch.ts`（`updateOrInsertPages` 782〜、`syncDescendantsPagesUpdated` 1518）、`aggregate-to-index.ts`、`config-definition.ts`。
- **Findings**: 再索引は、本文を `ELASTICSEARCH_MAX_BODY_LENGTH_TO_INDEX`（既定 10万文字）で切り詰めてから DB 側の集計で読み、`ELASTICSEARCH_REINDEX_BULK_SIZE`（既定 100件）ずつ送る。上限は全文検索の設定で決まり、本文の大きさによらない。
- **Implications**: 全文検索の再索引は、この spec の範囲外とする。その上限は全文検索の機能が持つ。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 最新版だけをアプリに読む | 各ページの `revision` を ID で引いて読み、Prisma で書く | 変更が小さい | 本文の大きさ × 件数がアプリに載る。本文は約16MBまで入りうるので上限を保証できない | 要件2を満たさない |
| DB の中で写す（採用） | `$merge` で版を写し、アプリは ID の対応表だけ持つ | 本文の大きさ・件数によらずメモリが一定 | 初めての `$merge`。Prisma の拡張 JSON の扱いと、互換サービスでの動作に確認が要る | 対応表の変換は実装の最初に確かめる |
| 件数を小さくする | 1回あたりの件数を減らす | 単純 | 本文が大きければやはり上限を保証できない。処理の往復が増える | 採用案では件数はメモリに効かない |

## Design Decisions

### Decision: 版の本文を DB の中で写す

- **Context**: 要件1・2。
- **Alternatives Considered**:
  1. 各ページの最新版だけを ID で読み、Prisma で書く。
  2. `$merge` で DB の中で写す。
- **Selected Approach**: 2。1回分のページについて、写しのページ ID と版 ID をアプリで先に決め、対応表を集計に渡す。照合は「各ページが指す版の ID」で行う（ページ ID では行わない）。出力の項目は今と同じ7項目に固定する。
- **Rationale**: 本文の大きさに上限を設けられない以上、メモリを一定にするにはアプリに本文を通さないしかない。照合を版の ID にすることで、最新版だけが写ることも同時に保証できる。
- **Trade-offs**: 写しの処理の負荷が DB 側に移る。GROWI で初めての `$merge` になる。
- **Follow-up**: 対応表の `{ $oid }` が ObjectId として保存されること。写しの版の項目と型が、Prisma で作った版と一致すること。

### Decision: 書き込みの順序は 版 → ページ → タグ

- **Context**: 要件4（作りかけの写しを残す）。
- **Alternatives Considered**:
  1. 今と同じ ページ → 版 → タグ。
  2. 版 → ページ → タグ。
- **Selected Approach**: 2。
- **Rationale**: 1だと、ページの挿入と版の写しの間で止まった場合、存在しない版を指すページが残り、表示が壊れる。2なら、その間で止まっても残るのはどのページからも参照されない版だけで、利用者からは見えない。
- **Trade-offs**: 参照されない版がまれに残る（掃除はこの spec の範囲外）。

### Decision: 止まったことの見分け方は「進捗で延ばす期限」と「持ち主の印」

- **Context**: 要件 4.2〜4.4、4.7。
- **Alternatives Considered**:
  1. 今の 5 秒ごとのタイマーで期限を延ばす。
  2. 1回分の処理を終えるたびに期限を延ばし、持ち主の印で、確保された後の延長を拒む。
  3. `canOperate` が期限を見るようにする。
- **Selected Approach**: 2。期限は「止まったとみなすまでの時間」を 2 分とする。回復の定期処理は 1 分ごとに動き、開始時刻を最大 30 秒ずらす。
- **Rationale**: 1は処理が固まっていても延長が続くので、固まった状態を見分けられない。3は他の操作の重なりの保護を約10秒で外してしまう。2は変更提案の適用処理と同じ考え方で、リポジトリの前例に沿う。
- **Trade-offs**: 1回分の処理（100件）が 2 分を超えると、進んでいるのに止まったとみなされる。版の写しは DB の中で行うので、100件で最大約 1.6GB の写しになるが、通常の DB の書き込み速度なら 2 分に十分収まる。整え処理（親の付け直しと配下ページ数の数え直し）は件数に比例して時間がかかるので、整え処理の間だけは時間で期限を延ばす（下記）。
- **Follow-up**: 2 分 + 1 分 + 30 秒 = 3.5 分で検知し、回復処理を終えるまでで 5 分以内に収まることを、結合テストで確かめる。

### Decision: 整え処理の間は時間で期限を延ばす

- **Context**: 要件 4.4。整え処理は既存の `PageService` の処理（親の付け直し、配下ページ数の数え直し）を呼ぶので、途中に進捗の合図を差し込めない。
- **Selected Approach**: 整え処理の間だけ、一定間隔で期限を延ばす。その間に持ち主の印が奪われていたら延長をやめる。
- **Trade-offs**: 整え処理の途中で DB の呼び出しが返らなくなった場合は、プロセスが終了するまで止まったと見分けられない。DB ドライバの通信の時間切れがあるので、無期限には固まらないと判断した。

### Decision: 成功時と回復時で同じ整え処理を使う

- **Context**: 要件 4.5。今は成功時に「数えた件数」で祖先の配下ページ数を増やしているが、この件数は失敗した回や除外したページも数えるので実際より多くなりうる。
- **Selected Approach**: 成功時も回復時も、写しの先頭から下の親の付け直しと、配下ページ数の数え直しを行う。祖先の配下ページ数も、件数で増やさず数え直す。
- **Rationale**: 1つの経路にまとめると、回復時の状態が成功時と同じ規則で作られる。件数の数え違いもなくなる。

### Decision: 1回分の例外で全体を止める

- **Context**: 要件 4.1、5.1。今は1回分の例外を握りつぶして次へ進むため、ページが黙って欠ける。
- **Selected Approach**: 1回分で例外が出たら、配下の複製をそこで止め、回復処理（整え・記録の片付け・通知）を同じプロセスで行う。
- **Rationale**: 欠けを本人に知らせられる。止まった後の扱いが、プロセスが落ちた場合と同じになる。

### Decision: 起動時の掃除から複製の記録を外す

- **Context**: 要件 4.3、5.1。今の起動時の掃除は、複製の記録を通知なしで消し、写しの整え処理もしない。
- **Selected Approach**: `init()` の削除対象から Duplicate を外す。起動後は回復の定期処理が、期限切れの記録として回復する。
- **Rationale**: 再起動後も、通知と整え処理が行われる。複数のプロセスで動かしている場合に、他のプロセスが実行中の複製の記録を消してしまう問題も、複製については解消する。

### Decision: 複製の処理を `service/page/duplicate/` に切り出す

- **Context**: Project Description の4。
- **Selected Approach**: 削除の切り出し（`delete-completely-operation.ts`）と同じく、協力する部品を引数で受け取る関数として作り、`PageService.duplicate` は呼び出しを渡すだけにする。配下を読み出す部品（`PageCursorsForDescendantsFactory`）は改名・削除でも使うので、別のファイルに移す。
- **Rationale**: 経路（API）とテストの差し込み口（`vi.spyOn(crowi.pageService, 'duplicate')`）を変えずに済む。

## Risks & Mitigations

- `aggregateRaw` に渡した対応表の `{ $oid }` が ObjectId に変換されず、文字列として保存される — 実装の最初の課題で、保存された型を確かめる結合テストを書く。
- 版の写しの件数が想定より少ない（元の版が欠けている等） — 写した件数を数え、写せなかったページは挿入せず、通知の件数に反映する。
- 整え処理（`normalizeParentRecursively` の複製用の呼び出し）は公開範囲で絞り込まないので、複製先の下にもともとあった親のないページもつないでしまう可能性がある — 今の挙動と同じで、この spec では変えない（未検証の既存の性質として記録する）。
- `$merge` を Amazon DocumentDB などの互換サービスで動かした場合の動作は未確認 — GROWI はこれらを公式に対応していない。

## References

- https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/ — `$merge` の仕様（同じコレクションへの出力、失敗時の挙動）
- https://www.mongodb.com/docs/manual/reference/command/aggregate/ — トランザクション内での制限
- https://www.mongodb.com/docs/manual/core/aggregation-pipeline-limits/ — 集計のメモリ上限
- https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries — `aggregateRaw` と拡張 JSON
- `apps/app/src/server/util/prisma-raw-normalize.ts` — 生の集計に ObjectId・日時を渡す前例
- `apps/app/src/features/page-bulk-export/server/service/page-bulk-export-job-cron/index.ts` — 本人だけに届く失敗通知の前例
- `apps/app/src/features/change-proposal/server/` — 進捗で延ばす貸し出し（lease）の前例
