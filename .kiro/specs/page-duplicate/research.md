# Research & Design Decisions

## Summary

- **Feature**: `page-duplicate`
- **Discovery Scope**: Complex Integration（既存の複製処理の作り直しと、PageOperation・定期処理・アプリ内通知・MongoDB の集計処理との統合）
- **Key Findings**:
  - 複製されたページには、今も revision を1つだけ付けている（過去の revision は写さない仕様）。ただし、その1つを選ぶために各ページの全 revision を読み込み、どれを写すかを検索結果の並び順に任せている。メモリの問題であると同時に、写る本文が最新の revision である保証がない不具合でもある。
  - MongoDB の `$merge` を使えば、revision の本文をアプリへ運ばずに DB の中で複製できる。GROWI の対応版（6.0 以上）で、読み込み元と同じコレクションへの書き込みもできる。ただし、トランザクションの中では使えず、途中で失敗しても書き込み済みの分は残る。
  - PageOperation の期限（`unprocessableExpiryDate`）を延ばす今の仕組み（5秒ごとのタイマー）は、処理が固まっていても延び続ける。止まったことを見分けるには、処理が進むたびに時刻を記録する方式が要る。リポジトリには変更提案の適用処理（change-proposal）に同じ考え方の前例がある。

## Research Log

### 今の複製の流れと、途中で止まったときの状態

- **Context**: 要件4（自動回復）と要件1（最新の revision）の前提を確かめる。
- **Sources Consulted**: `apps/app/src/server/service/page/index.ts`（`duplicate` 1555〜1739、`duplicateRecursivelyMainOperation` 1741〜1791、`duplicateDescendantsWithStream` 2050〜2116、`duplicateDescendants` 1901〜1990、v4 系 1815〜2167、`normalizeParentAndDescendantCountOfDescendants` 4235〜）、`routes/apiv3/pages/index.js`。
- **Findings**:
  - 先頭ページは `create()` で同期的に作られ、ページツリーにつながる。配下は、応答を返した後に裏で走る処理（待たない非同期処理）が複製する。
  - 配下は、親子のつながりを親ごとにたどる読み出し（`PageCursorsForDescendantsFactory`）で、子を親より先に返す順に読み、100件ずつ処理する。「リンクを知っている人のみ」のページは親を持たないので、たどる対象に入らない（要件 6.4 はこの性質で成り立っている）。
  - 1回分（100件）の処理は、ページの挿入 → revision の作成 → タグの複製の順で、トランザクションはない。1回分の例外はログに出して握りつぶし、次へ進む。件数は読み出し時に数えるので、実際より多くなることがある。
  - 複製されたページは親を持たない状態で挿入され、すべて終わった後のサブオペレーション（親の付け直しと配下ページ数の数え直し）でページツリーにつながる。途中で止まると、写しはページツリーから見えない。
  - 裏の処理の例外は、PageOperation を削除したあと、誰も待っていない Promise へ再送出される。プロセスはログに出すだけで終わらない。
  - v4 の経路には PageOperation も重なりの判定もなく、裏の処理には例外の受け止めもない。写しは親を持たないまま残る（旧形式のページはもともとページツリーの外にある）。
- **Implications**: 回復処理は、件数を当てにせず数え直す必要がある。サブオペレーションを成功時と回復時の両方で使える形にする。

### revision のドキュメントの項目と、DB の中で複製するときに必要な値

- **Context**: 要件1・2。`$merge` で作った複製されたページの revision が、通常の経路で作った revision と区別できないようにする。
- **Sources Consulted**: `apps/app/prisma/schema.prisma`（revisions 683〜707、pages 607〜654）、`src/utils/prisma.ts`（全モデル共通の拡張 150〜222）、`src/server/models/revision.ts`、`src/server/models/page.ts`（`pushRevision` 1088〜1129）、`src/server/util/prisma-raw-normalize.ts`。
- **Findings**:
  - 今の配下の複製が作る revision の項目は `_id, pageId, body, author, format: 'markdown', createdAt, __v: 0`。`createdAt` と `__v` は Prisma が補っている。`origin`・`hasDiffToPrev`・`proposalId`・`proposalOperationKey` は持たない。先頭ページの revision も同じ項目になる。
  - Prisma の拡張は、作成時には何もしない（更新時に `__v` を進めるだけ）。DB の中で複製する場合に自分で設定する必要があるのは、`__v: 0`、`createdAt`、`format` の既定値だけ。
  - `pageId` と `author` は ObjectId、`createdAt` は日時型でなければならない。Yjs の同期、revision の差分の索引、履歴の一覧がこれらの型に依存している。
  - Prisma の生の集計（`aggregateRaw`）に ObjectId や日時を渡すときは、拡張 JSON（`{ $oid }` / `{ $date }`）で渡す必要がある。そのまま渡すと文字列になり、照合は黙って何も一致しない（`prisma-raw-normalize.ts` の `toRawObjectId` / `toRawDate` の注記、実機で確認済み）。
  - Mongoose の revision のスキーマは、本文を読むときに CR / CRLF を LF に直す。今の複製は Prisma 経由で読んで書くので、直した後の本文を書いている。DB の中で複製すると、保存されている本文がそのまま写る。読むときに同じく直されるので、表示は変わらない。
  - リポジトリに `$merge` / `$out` の使用例はない（初めての使用になる）。
- **Implications**: 複製されたページの revision の項目は「今と同じ7項目」に固定し、それ以外は持ち込まない。ObjectId と日時の型が正しく保存されることを、結合テストで確かめる。

### MongoDB の `$merge`

- **Context**: 要件2。本文をアプリに読み込まない複製の方法の成立条件。
- **Sources Consulted**:
  - https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/
  - https://www.mongodb.com/docs/manual/reference/command/aggregate/
  - https://www.mongodb.com/docs/manual/core/aggregation-pipeline-limits/
  - https://www.mongodb.com/docs/manual/reference/limits/
  - https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexOfArray/ 、 https://www.mongodb.com/docs/manual/reference/operator/aggregation/arrayElemAt/
  - https://www.mongodb.com/docs/v7.0/reference/operator/aggregation/getField/
  - https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries
- **Findings**:
  - 読み込み元と同じコレクションへの書き込みは 4.4 以降で可能。GROWI の対応版（6.0 以上、CI は 6.0 と 8.0）を満たす。既存の revision を書き換えず、新しい `_id` を持つ revision だけを挿入するので、同じ revision を何度も読み直す問題（Halloween 問題）は起きない。
  - 出力に `_id` があればそのまま使う。照合のキーは既定の `_id` で、既定の索引で条件を満たす。
  - 多文書トランザクションの中では使えない。書き込みの段を含む集計は、ドライバの自動再試行の対象にならない。
  - 途中で失敗しても、書き込み済みの文書は取り消されない。
  - `$match` / `$set` / `$project` / `$merge` は、メモリ上限（100MB）のある段に入らない。結果を返さないので、返す結果の 16MB 上限も関係しない。挿入する各文書は 16MB に収まる必要がある（元の revision が収まっているので、項目を増やさない限り収まる）。集計の命令そのものも 16MB 未満である必要があるが、ID の対応表は十分小さい。
  - 小さな対応表から新しい ID を引く方法は、`$indexOfArray` と `$arrayElemAt` の組み合わせがよい。`$getField` は 6.0・7.0 では項目名に定数しか取れず使えない。`$indexOfArray` は見つからないと -1 を返し、`$arrayElemAt` に -1 を渡すと最後の要素を黙って返すので、照合と対応表を同じ ID の並びから作って「必ず見つかる」状態にする。
  - Prisma 6 では `prisma.revisions.aggregateRaw({ pipeline, options })` が正式な経路で、`options` に `maxTimeMS` などの集計の命令の選択肢を渡せる。`$runCommandRaw` で `aggregate` を送ることは Prisma の文書で非推奨。対応表の中の `{ $oid }` が ObjectId に変換されるかは、文書に明記がない（実装の最初に確かめる）。
  - Amazon DocumentDB・Azure の互換サービスでの、読み込み元と同じコレクションへの `$merge` は文書化されていない。GROWI はこれらを公式に対応していない（リポジトリに言及なし）。
- **Implications**: revision の複製は `aggregateRaw` で行い、トランザクションの外で実行する。複製できた件数を後から数えて確かめる。

### PageOperation と、止まったことの見分け方

- **Context**: 要件3・4。
- **Sources Consulted**: `apps/app/src/server/models/page-operation.ts`、`apps/app/src/server/service/page-operation.ts`、`src/features/change-proposal/server/`（`applyLease`、change-proposal.ts 192〜246、proposal-applier.ts 329・411）、`features/growi-vault/server/resilience/bootstrap-heartbeat.ts`、`server/service/cron.ts`、`server/service/page/wip-page-cleanup-cron.ts`、`crowi/index.ts`（`setupCron` 487〜543、`setupPageService` 954）、`server/util/mongoose-utils.ts`（`mongoOptions`）。
- **Findings**:
  - PageOperation は期限（`unprocessableExpiryDate`、作成時に今から10秒後）を持つが、重なりの判定（`canOperate`）は期限を見ない。期限を延ばすタイマー（`autoUpdateExpiryDate`、5秒ごとに10秒延長）を使うのは、改名の後半の処理だけ。
  - 起動時の掃除（`init()`）は、複製を含む多くの種類の PageOperation を通知なしで削除する。複数のプロセスで動かしている場合、1つが再起動すると、他のプロセスが実行中の PageOperation まで削除する。
  - PageOperation には作成時刻の項目がない（`_id` から分かるだけ）。担当プロセスを表す項目もない。
  - `canOperate` が期限を見るように変えると、改名の後半以外のすべての操作で、開始から約10秒後に重なりの保護が外れる。作成・移動・削除・元に戻す・変更提案の待ち合わせに影響する。
  - 定期処理は `CronService`（node-cron）の派生クラスで、すべてのプロセスで動く。プロセス間の主の選出や分散ロックはない。正しさは「条件付きの原子的な書き換え」で保っている（WIP の掃除は `findOneAndUpdate`、変更提案は担当の印と期限を持ち、処理が1段進むたびに期限を延ばす）。
  - DB の接続設定（`mongoOptions`）に `socketTimeoutMS` の指定がなく、ドライバの既定は時間切れなし。DB の呼び出しが返らなくなると、いつまでも待つ。
- **Implications**: `canOperate` は変えない。複製の PageOperation に `ownerToken`（担当プロセスの ID）と `lastProgressAt` を持たせ、回復は条件付きの書き換えで1回に限る。

### サブオペレーションで呼ぶ既存の処理の例外の扱い

- **Context**: 要件 4.2。設計のレビュー（Opus のサブエージェントによる独立レビュー）で指摘された。
- **Sources Consulted**: `apps/app/src/server/service/page/index.ts`（`_normalizeParentRecursively` 4397〜4548、`recountAndUpdateDescendantCountOfPages` 4663〜4682）、`apps/app/src/server/app.ts` 18〜20。
- **Findings**:
  - 親の付け直しと配下ページ数の数え直しは、Node.js の書き込み用ストリーム（Writable）の `async write` の中で1回分を処理している。Writable は `write` が返す Promise を見ないので、中で投げた例外はストリームに伝わらない。`callback` が呼ばれず、`pipeline` はいつまでも終わらない。例外は、扱われない Promise の拒否として `app.ts` のログに出るだけになる。
  - `_normalizeParentRecursively` は `write` の中で例外を投げ直している。`recountAndUpdateDescendantCountOfPages` の `write` には try がない。
  - 空ページを作る `createEmptyPagesByPaths`（`models/page.ts` 1047〜1060）は「既にあるかを調べてから挿入する」2段の処理で、ページのパスの索引は一意ではない。同じ部分木で親の付け直しが2つ同時に走ると、同じパスの空ページが2つできうる。
- **Implications**: 既存の処理の `write` を try で包んで例外を `callback(err)` で返す。サブオペレーションが同時に2つ走らないことを、`ownerToken` と書き込みの規則で保証する。

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
- **Findings**: 再索引は、本文を `ELASTICSEARCH_MAX_BODY_LENGTH_TO_INDEX`（既定10万文字）で切り詰めてから DB 側の集計で読み、`ELASTICSEARCH_REINDEX_BULK_SIZE`（既定100件）ずつ送る。上限は全文検索の設定で決まり、本文の大きさによらない。
- **Implications**: 全文検索の再索引は、この spec の範囲外とする。その上限は全文検索の機能が持つ。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 最新の revision だけをアプリに読む | 各ページの `revision` を ID で引いて読み、Prisma で書く | 変更が小さい | 本文の大きさ × 件数がアプリに載る。本文は約16MB まで入りうるので上限を保証できない | 要件2を満たさない |
| DB の中で複製する（採用） | `$merge` で revision を複製し、アプリは ID の対応表だけ持つ | 本文の大きさ・件数によらずメモリが一定 | 初めての `$merge`。Prisma の拡張 JSON の扱いと、互換サービスでの動作に確認が要る | 対応表の変換は実装の最初に確かめる |
| 件数を小さくする | 1回あたりの件数を減らす | 単純 | 本文が大きければやはり上限を保証できない。処理の往復が増える | 採用案では件数はメモリに効かない |

## Design Decisions

### Decision: revision の本文を DB の中で複製する

- **Context**: 要件1・2。
- **Alternatives Considered**:
  1. 各ページの最新の revision だけを ID で読み、Prisma で書く。
  2. `$merge` で DB の中で複製する。
- **Selected Approach**: 2。1回分のページについて、写しのページ ID と revision の ID をアプリで先に決め、対応表を集計に渡す。照合は「各ページが指す revision の ID」で行う（ページ ID では行わない）。出力の項目は今と同じ7項目に固定する。
- **Rationale**: 本文の大きさに上限を設けられない以上、メモリを一定にするにはアプリに本文を通さないしかない。照合を revision の ID にすることで、最新の revision だけが写ることも同時に保証できる。
- **Trade-offs**: 複製の処理の負荷が DB 側に移る。GROWI で初めての `$merge` になる。
- **Follow-up**: 対応表の `{ $oid }` が ObjectId として保存されること。複製されたページの revision の項目と型が、Prisma で作った revision と一致すること。

### Decision: 書き込みの順序は revision → ページ → タグ

- **Context**: 要件4（作りかけの写しを残す）。
- **Alternatives Considered**:
  1. 今と同じ ページ → revision → タグ。
  2. revision → ページ → タグ。
- **Selected Approach**: 2。
- **Rationale**: 1だと、ページの挿入と revision の複製の間で止まった場合、存在しない revision を指すページが残り、表示が壊れる。2なら、その間で止まっても残るのはどのページからも参照されない revision だけで、利用者からは見えない。
- **Trade-offs**: 参照されない revision がまれに残る（掃除はこの spec の範囲外）。

### Decision: 止まったことの見分け方は `lastProgressAt` と `ownerToken`

- **Context**: 要件 4.2〜4.4、4.7。
- **Alternatives Considered**:
  1. 今の5秒ごとのタイマーで `unprocessableExpiryDate` を延ばす。
  2. 処理が進むたびに `lastProgressAt` を更新し、`ownerToken`（担当プロセスの ID）で、回復を引き受けられた後の更新を拒む。
  3. `canOperate` が期限を見るようにする。
- **Selected Approach**: 2。`lastProgressAt` が2分以上前の PageOperation を、期限切れと判定する。回復の定期処理は1分ごとに動き、開始時刻を最大30秒ずらす。
- **Rationale**: 1は処理が固まっていても延長が続くので、固まった状態を見分けられない。3は他の操作の重なりの保護を約10秒で外してしまう。2は変更提案の適用処理と同じ考え方で、リポジトリの前例に沿う。`unprocessableExpiryDate` は改名の再開判定が使っているので、意味を変えずに新しい項目を足す。
- **Follow-up**: 2分 + 1分 + 30秒 = 3.5分で回復を始め、サブオペレーションを含めて5分以内に収まることを、性能の検証で確かめる。

### Decision: 書き込みの直前に `lastProgressAt` を更新し、1回の書き込みを小さく保つ

- **Context**: 要件 2.2・4.4・4.5・4.7。設計のレビューで、当初の「1回分（100件）を終えた後に更新する」方式では、更新の間に時間の上限がない処理（100件の revision を1回の `$merge` で写すと最悪で約1.6GB）が入ると指摘された。2分を超えると、動いている複製が期限切れと判定され、回復を引き受けたプロセスと元の担当プロセスが同じ写しに同時に書き込む。
- **Alternatives Considered**:
  1. 更新を1回分の後に行い、判定までの時間を長くする。
  2. 各書き込みの直前に `ownerToken` を条件に更新し、revision の複製を小さく分け、`$merge` に `maxTimeMS` を付ける。
- **Selected Approach**: 2。`REVISION_MERGE_CHUNK_SIZE` は10件（最悪で約160MB）。`MERGE_MAX_TIME_MS` は60秒。ページの挿入とタグの複製は量が小さいので分けず、`maxTimeMS` も付けない。
- **Rationale**: 更新が成功した直後から2分間は、他のプロセスが回復を引き受けられない。各書き込みの直前に更新し、1回の書き込みを2分より十分短くすれば、2つのプロセスが同時に書き込むことはない。レビューは当初 `maxTimeMS` を「大きな複製を失敗させる」として退けていたが、それは100件を一度に写す前提での話で、10件ずつなら当てはまらない。
- **Trade-offs**: `$merge` の呼び出し回数が増える（100件で10回）。ページの挿入またはタグの複製の DB の呼び出しが固まり、2分以上たってから完了する場合は、書き込みが重なりうる。量が小さく、固まる原因は DB 側の障害に限られるので受け入れる。

### Decision: サブオペレーションでも、1回分の処理の前に `lastProgressAt` を更新する（`onBatchStart`）

- **Context**: 要件 4.2・4.4。サブオペレーションは既存の `PageService` の処理（親の付け直し、配下ページ数の数え直し）を呼ぶ。件数に比例して時間がかかる。
- **Alternatives Considered**:
  1. サブオペレーションの間だけ、時間で `lastProgressAt` を更新する。
  2. 既存の処理に「1回分の処理を始める前に呼ぶ関数」を任意の引数として足し、そこで更新する。
- **Selected Approach**: 2。`normalizeParentRecursively`（中で再帰する `_normalizeParentRecursively` を含む）・`updateDescendantCountOfSelfAndDescendants`・`updateDescendantCountOfPagesWithPaths`・`recountAndUpdateDescendantCountOfPages` に任意の `onBatchStart` を足す。
- **Rationale**: DB の接続に時間切れの設定がないので、1では DB の呼び出しが返らなくなったときに更新が続き、4.2 を満たせない。どの処理も1回分（100〜200件）ずつの繰り返しで書かれているので、差し込む場所がある。
- **Trade-offs**: `PageService` の4つの関数に任意の引数が増える。既存の呼び出し元は渡さないので、その部分の挙動は変わらない。

### Decision: 既存の4つの処理の例外を、呼び出し元へ返すようにする

- **Context**: 要件 4.2。上記「サブオペレーションで呼ぶ既存の処理の例外の扱い」のとおり、今は1回分の処理の中の例外で処理全体が固まる。サブオペレーションの途中で `OwnershipLostError` や DB の例外が出ると、回復処理が終わらない。
- **Selected Approach**: 4つの処理の Writable の `write` の中身を try で包み、例外を `callback(err)` で返す。複製処理で新しく書く繰り返しは、Writable を使わず `for await` で書く。
- **Rationale**: 例外が `pipeline` を通って呼び出し元へ返るようになり、回復処理が固まらない。
- **Trade-offs**: 既存の呼び出し元（移行処理など）にとっても、今は固まっていた例外が、例外として返るようになる（挙動の変更）。ユーザーの判断で、この spec の範囲に含める。固まっていた状態より正しい挙動である。

### Decision: 回復の定期処理に「実行中なら何もしない」印を持たせない

- **Context**: 要件 4.2・4.7。既存の定期処理の多くは、プロセス内の実行中の印で、前回の実行と重ならないようにしている。設計のレビューで、回復が一度固まると、この印が立ったままになり、そのプロセスでは以後の回復が一切行われないと指摘された。
- **Selected Approach**: 印を持たない。回復を1回に限ることは、`takeOverStalledDuplicate` の条件付きの書き換えと、`ownerToken` を条件にした削除で保証する。
- **Rationale**: 印が守っているものは、条件付きの書き換えですでに守られている。印がなければ、固まった回復の PageOperation も `lastProgressAt` が古くなれば次の回に引き受け直され、他の止まった複製の回復も止まらない。

### Decision: 成功時と回復時で同じサブオペレーションを使い、祖先の数の直し方だけ分ける

- **Context**: 要件 4.5。今は成功時に「読み出した件数」で祖先の配下ページ数を増やしているが、この件数は失敗した回や除外したページも数えるので実際より多くなりうる。一方、祖先の数え直し（`updateDescendantCountOfPagesWithPaths`）は、子を読んでから値を上書きする処理で、並行して作られた別のページの増分（`$inc`）を消しうる。祖先にはトップページ `/` も含まれるので、複製のたびに数え直すと、利用の多い wiki で増分を失う危険がある。
- **Alternatives Considered**:
  1. 成功時も回復時も、祖先を数え直す。
  2. 成功時は「挿入できた件数」だけ増やし、回復時だけ数え直す。
- **Selected Approach**: 2。写しの先頭から下（写しの部分木）は、どちらでも数え直す。
- **Rationale**: 成功時は今と同じ増分の書き込みなので、並行性の危険を増やさない。数える件数を「挿入できた件数」に変えるので、数え過ぎもなくなる。回復時は、祖先をどこまで増やしたか分からず、回復処理自体が途中で止まって再び回復される場合もあるため、順番に何度行っても同じ結果になる数え直しが必要。回復はまれなので、上書きの危険は小さい。
- **Trade-offs**: 回復時にまれに、並行する他の操作の増分が消える可能性が残る。既存の修復処理（repair-page-tree）で直せる種類のずれである。

### Decision: 前のバージョンが作った PageOperation は、作成から15分たってから回復する

- **Context**: 要件 4.3。前のバージョンは `lastProgressAt` を更新しない。GROWI.cloud のように段階的に入れ替える更新では、古いプロセスが複製を実行している間に、新しいプロセスの定期処理が動く。
- **Selected Approach**: `ownerToken` を持たない複製の PageOperation は、`_id` の作成時刻で判断し、作成から `LEGACY_RECORD_MIN_AGE_MS`（15分）を過ぎたものだけを回復の対象にする。
- **Rationale**: 作成直後から回復の対象にすると、古いプロセスが実行中の複製を誤って回復し、サブオペレーションが重なり、誤った通知が届く。何週間も前に止まった PageOperation（今回の事象のようなもの）は、15分の待ちがあっても回復される。
- **Trade-offs**: 前のバージョンで止まった PageOperation の回復が、最大15分遅れる（更新の直後だけの話）。

### Decision: 1回分の例外で全体を止める

- **Context**: 要件 4.1、5.1。今は1回分の例外を握りつぶして次へ進むため、ページが黙って欠ける。
- **Selected Approach**: 1回分で例外が出たら、配下の複製をそこで止め、回復処理（サブオペレーション → PageOperation の削除 → 通知）を同じプロセスで行う。
- **Rationale**: 欠けを本人に知らせられる。止まった後の扱いが、プロセスが落ちた場合と同じになる。

### Decision: 起動時の掃除から複製の PageOperation を外す

- **Context**: 要件 4.3、5.1。今の起動時の掃除は、複製の PageOperation を通知なしで削除し、写しのサブオペレーションもしない。
- **Selected Approach**: `init()` の削除対象から Duplicate を外す。起動後は回復の定期処理が、期限切れと判定された PageOperation として回復する。
- **Rationale**: 再起動後も、通知とサブオペレーションが行われる。複数のプロセスで動かしている場合に、他のプロセスが実行中の複製の PageOperation を削除してしまう問題も、複製については解消する。

### Decision: 回復の流れを組む責任は回復側に置く

- **Context**: Project Description の4（切り出し）。設計のレビューで、PageOperation を扱うモジュールが回復の材料（`InterruptedDuplicate`）を組み立てて返すと、依存の向きが逆になり、親を付け直すかどうかの規則が2か所にできると指摘された。
- **Selected Approach**: `takeOverStalledDuplicate` は、引き受けた PageOperation の保存値をそのまま返す。回復の材料に変えるのは `recoverInterruptedDuplicate` 側の `toInterruptedDuplicate`。親を付け直すかどうかの規則は `shouldNormalizeParent` の1つにまとめ、run と回復の両方が使う。担当を外れたことの知らせ方は `OwnershipLostError` の1通りにする。型と定数は、種類ごとの入れ物（`types.ts`・`consts.ts`）に集めず、それを持つファイルに置く。

### Decision: 複製の処理を `service/page/duplicate/` に切り出す

- **Context**: Project Description の4。
- **Selected Approach**: 削除の切り出し（`delete-completely-operation.ts`）と同じく、協力する部品を引数で受け取る関数として作り、`PageService.duplicate` は呼び出しを渡すだけにする。配下を読み出す部品（`PageCursorsForDescendantsFactory`）は改名・削除でも使うので、別のファイルに移す。
- **Rationale**: 経路（API）とテストの差し込み口（`vi.spyOn(crowi.pageService, 'duplicate')`）を変えずに済む。

## Risks & Mitigations

- `aggregateRaw` に渡した対応表の `{ $oid }` が ObjectId に変換されず、文字列として保存される — 実装の最初の課題で、保存された型を確かめる結合テストを書く。
- 複製できた revision の件数が想定より少ない（元の revision が欠けている等） — 複製できた件数を数え、複製できなかったページは挿入せず、ログに出す。
- サブオペレーションの親の付け直し（`normalizeParentRecursively` の複製用の呼び出し）は公開範囲で絞り込まないので、複製先の下にもともとあった親のないページもつないでしまう可能性がある — 今の挙動と同じで、この spec では変えない（未検証の既存の性質として記録する）。
- ページの挿入またはタグの複製の DB の呼び出しが固まり、2分以上たってから完了すると、回復を引き受けたプロセスと書き込みが重なりうる — 量が小さく、原因は DB 側の障害に限られるので受け入れる。
- `$merge` を Amazon DocumentDB などの互換サービスで動かした場合の動作は未確認 — GROWI はこれらを公式に対応していない。

## References

- https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/ — `$merge` の仕様（同じコレクションへの出力、失敗時の挙動）
- https://www.mongodb.com/docs/manual/reference/command/aggregate/ — トランザクション内での制限、`maxTimeMS`
- https://www.mongodb.com/docs/manual/core/aggregation-pipeline-limits/ — 集計のメモリ上限
- https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries — `aggregateRaw` と拡張 JSON
- `apps/app/src/server/util/prisma-raw-normalize.ts` — 生の集計に ObjectId・日時を渡す前例
- `apps/app/src/features/page-bulk-export/server/service/page-bulk-export-job-cron/index.ts` — 本人だけに届く失敗通知の前例
- `apps/app/src/features/change-proposal/server/` — 処理が進むたびに期限を延ばす担当の仕組みの前例
