# Research & Design Decisions

## Summary
- **Feature**: `activity-access-token-redaction`（`activity-log` の amend spec）
- **Discovery Scope**: Extension（既存の activity 記録・インポート・migration への組み込み）
- **Key Findings**:
  - activity の endpoint を実際に書くのは `createByParameters` だけ。`updateByParameters` の本番の呼び出し元はなく、`emit('update')` の payload にも endpoint を渡す箇所はない。ただし型（`IActivityUpdateParameters`）は endpoint を受け付ける。この型は settleActivityRecord の入力 `activityParameters` でもあり、settle は文脈の `endpoint` のあとにそれを展開するので、型の上では payload が文脈の endpoint を上書きできる。
  - migration は migrate-mongo（`src/migrations/*.js`、`db` を受け取る素の driver）で書かれ、`server` スクリプトの前（`preserver`）に流れる。umzug 側（`prisma/migrations/`）は空。
  - 監査ログの索引への同期（change stream）は update イベントを読み飛ばすので、migration で endpoint を書き換えても ES への書き込みは起きない。

## Research Log

### 書き込みの入口の洗い出し
- **Context**: どの経路で記録しても伏せ字にするには、endpoint が DB に入る口をすべて押さえる必要がある。
- **Sources Consulted**: `apps/app/src/server/models/activity.ts`、`service/activity.ts`、`service/activity/settle-activity-record.ts`、`service/activity/record-failsafe-attempt.ts`、`service/import/import.ts`、`grep` による `activities.create|update|upsert` / `Activity.create|insertMany|updateOne|bulkWrite` / `collection('activities')` の全件検索
- **Findings**:
  - 記録の 3 経路（settle、fail-safe、`ActivityService.createActivity` を直接呼ぶ約 20 か所）は、すべて `prisma.activities.createByParameters` を通る。それ以外に `createByParameters` を直接呼ぶ箇所もある（inline-comment のサービスの 7 か所。リクエストの文脈がないので endpoint は渡さない）。
  - `updateByParameters` は extension 内の定義だけで、本番コードからの呼び出しはない。
  - `collection('activities')` を触るのは `service/activity.ts` の TTL インデックス作成だけで、行は書かない。
  - モデルを通らずに行を書くのは、管理画面のデータのインポート（`import.ts` の `initializeUnorderedBulkOp`）だけ。G2G は `activities` を `NON_TRANSFERABLE_COLLECTIONS` に入れているので転送しない。
- **Implications**: 記録時の伏せ字は `createByParameters` の 1 か所で全経路を押さえられる。`updateByParameters` は型から endpoint を外し、実行時にも取り除く（型の除外はオブジェクトリテラルにしか効かないため）。インポートは別の口として扱う。

### インポートでの変換の仕組み
- **Sources Consulted**: `service/import/construct-convert-map.ts`、`service/import/import.ts`（`convertDocuments`）、`service/import/overwrite-function.ts`
- **Findings**:
  - `constructConvertMap` は `mongoose.modelNames()` と各モデルの `schema.paths` から、コレクション×項目ごとの変換関数の表を作る。`SPECIAL_CONVERT_FUNCTIONS` に `activities.snapshot` の特例がすでにある。
  - `convertDocuments` は、取り込む文書の各項目に表の変換関数を適用してから bulk 書き込みする。
  - この表は Mongoose モデルの登録に依存する。`Activity` の Mongoose モデルは、TTL インデックスの作成と統合テストの seed のために今も登録されている。
- **Implications**: `SPECIAL_CONVERT_FUNCTIONS.activities.endpoint` に伏せ字の関数を置けば、インポートでも伏せ字になる。Mongoose の `Activity` モデルがなくなると、この項目は表から黙って消える。そのため Revalidation Trigger にし、統合テストで表に項目があることを確かめる。

### migration の実行方式
- **Sources Consulted**: `apps/app/package.json`（`preserver`、`migrate`）、`prisma/migrate.ts`、`src/migrations/20261111120000-add-endpoint-index-to-activities.js`、`src/migrations/20260901160138-backfill-comments-isinline.js`、`.claude/rules/model.md`
- **Findings**:
  - `server` スクリプトの前（`preserver`）に `migrate`（migrate-mongo → umzug）が流れる。つまり migration はサーバが起動する前に終わる。
  - migrate-mongo の `up(db)` は素の MongoDB driver の `db` を受け取る。既存の migration は `~/` 経由でアプリのコードを import している。
  - Prisma の拡張は `update` / `updateMany` のたびに `v` を増やす（`model.md`）。
  - `activities` には `endpoint_1` インデックスがある（`20261111120000-…`）。
- **Implications**:
  - migration は Prisma ではなく素の `db` で書く。Prisma を使うと `__v` が変わり、要件 6.3 に反する。
  - 素の driver の問い合わせ `{ _id: { $gt }, endpoint: { $regex: '\\?' } }`（`_id` で並べ替え）の実行計画を explain で確かめる。
  - サーバ起動前に流れるので、運用者から見える影響は「記録が止まる」ことではなく「起動が延びる」ことになる。

### 監査ログの索引への同期（auditlog-es-sync）への影響
- **Sources Consulted**: `features/auditlog-es-sync/server/service/auditlog-changestream.ts`、`service/search-delegator/elasticsearch.ts`（`bulkSyncAuditlogs`）、`service/search-delegator/sanitize-endpoint-for-index.ts`、`features/auditlog-es-sync/server/models/*`
- **Findings**:
  - change stream には `$match` がなく、update イベントも受け取る。ただし `flushBuffer` は insert と delete だけを拾い、update は捨てる。
  - `bulkSyncAuditlogs` は本文が空なら何もせずに返る。
  - 残るのは、イベントを読む負荷と、100 件ごとの resume token の書き込みだけ。
  - change stream は `app:auditLogEnabled` が有効な各インスタンスが開く（リーダー選出などの絞り込みはない）。ローリングアップデートでは、migration の間も古いバージョンのインスタンスがイベントを読み続ける。change stream を読むインスタンスが 1 つもない間に、resume token の位置が oplog から消えると、再開時に HistoryLost になり、resume token を消して unsynced を立てる（`auditlog-changestream.ts`）。起動時に索引を作り直した場合は、resume token を捨ててから始めるのでこれは起きない。
  - ES の索引の `endpoint` は `sanitizeEndpointForIndex` でクエリ文字列を落としている。`es-sync-decision` / `anonymous-sync-counter` が持つ endpoint も索引用の値で、TTL は 150 秒。
- **Implications**: migration で書き換えても、ES への書き込みは起きない。負荷は、実際に書き換えた件数ぶんのイベントを読むことと、resume token を書くことに限られる。ただし書き換えが oplog の保持範囲を超えると、起動後に索引の再構築が必要になる。書き換えるのは値が変わる文書だけにして、この量を平文トークンを含む件数に抑える。`auditlog-mapping-sync.ts` のコメントにある「ES が持つ項目は作成時に確定し、変わらない」という前提は、ES に見えている値（パス部分）が変わらないので崩れない。

### endpoint 検索・候補表示への影響
- **Sources Consulted**: `server/interfaces/auditlog-suggestion-field-specs.ts`、`models/activity.ts`（`findEndpointsByEndpointRegex`）
- **Findings**: MongoDB 側の候補表示は、パスの前方一致で絞り込み、`$split: ['$endpoint', '?']` の先頭（パス部分）でまとめる。ES 側はもともとクエリ文字列のない値で引いている。
- **Implications**: 伏せ字はクエリ文字列の中だけを変えるので、検索・候補表示の結果は変わらない（要件 9.2）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| 保存口で伏せ字（採用） | `createByParameters` の中で endpoint を伏せ字にする | 記録の全経路を 1 か所で押さえられる。新しい記録経路が増えても自動で効く | インポートはモデルを通らないので別に手当てが要る |
| 呼び出し元で伏せ字 | `createActivity` を呼ぶ約 20 か所にそれぞれ伏せ字を入れる | モデルを変えない | 漏れが出やすく、新しい経路で必ず忘れる |
| Mongoose / Prisma の hook | ORM の hook で書き込み前に変換する | 自動で効く | 書き込みは Prisma 拡張の自前メソッドで行っている。Prisma の query 拡張は全モデルに効く横断的な仕組みで、1 項目のために持ち込むには重い |

## Design Decisions

### Decision: 伏せ字を保存口（`createByParameters`）で行う
- **Context**: 要件 5.2 は、記録経路を問わず伏せ字にすることを求める。今の伏せ字は middleware の中だけで、`createActivity` を直接呼ぶ経路が漏れている。
- **Alternatives Considered**:
  1. 呼び出し元ごとに伏せ字を入れる
  2. 保存口で伏せ字にする
- **Selected Approach**: `createByParameters` が `endpoint` を受け取ったら、Prisma の `create` に渡す前に伏せ字にする。`updateByParameters` は型（`IActivityUpdateParameters`）から `endpoint` を外し、実行時にも `endpoint` を取り除いてから `update` に渡す。更新で endpoint を書く手段をなくす。
- **Rationale**: activity の行を作る箇所はすべて `createByParameters` を通るので、1 か所で全経路を押さえられる。Prisma の validation error はメッセージに引数を含むが、伏せ字は `create` の前に行うので、エラーログにも平文は出ない。
- **Trade-offs**: 保存口が「中身を書き換える」責務を持つ。ただし対象は endpoint の 1 項目に限られ、関数も純粋なので、保存口の見通しは悪くならない。

### Decision: middleware では伏せ字にしない（`PendingActivityContext` は生の URL を持つ）
- **Context**: 伏せ字を保存口に移すと、middleware が組み立てる文脈（`PendingActivityContext`）の `endpoint` には生の URL が入る。将来この文脈をログに出すと、平文のトークンがログに漏れる。
- **Alternatives Considered**:
  1. middleware でも伏せ字にする（2 か所で呼ぶ。関数は冪等なので結果は同じ）
  2. 保存口だけで伏せ字にする
- **Selected Approach**: 2。middleware は `req.originalUrl` をそのまま文脈に入れる。
- **Rationale**:
  - 文脈が生きているのはリクエストの間だけ。同じ期間、`req.originalUrl` は生の URL を持ったまま `req` にある。文脈を伏せ字にしても、プロセスのメモリから生の値が消えるわけではない。
  - 今は文脈をログに出す箇所がない（`service/activity/` と `models/activity.ts` のログ呼び出しを全件確認した）。
  - HTTP アクセスログ（`crowi/index.ts` で登録する `@growi/logger` の pino-http）は、リクエスト URL を伏せ字にせずに出す。生の URL はアクセスログにも残るので、文脈だけを伏せ字にしてもログからトークンは消えない（アクセスログの伏せ字は本 spec の範囲外）。
  - 伏せ字を呼ぶ箇所を 2 つにすると、片方が冗長に見えて消され、保存口側が消される事故がありうる。保存口だけに置けば、「DB に入る値は必ず伏せ字」という約束の担い手が 1 つに定まる。
- **Trade-offs**: 文脈をログに出すコードを将来足すと、平文が漏れる。そのため、これを activity-log の Revalidation Trigger に加える。

### Decision: migration は素の driver で、`_id` の範囲で区切って処理する
- **Context**: 要件 6 は既存の activity の伏せ字を求める。6.3 は endpoint 以外を変えないこと、6.5 は中断後の再実行を求める。
- **Alternatives Considered**:
  1. Prisma（`prisma.activities.updateMany` など）で書く
  2. 素の driver で、MongoDB 側の正規表現だけで対象を絞って `$set` する
  3. 素の driver で `?` を含む文書を `_id` 順に読み、アプリ側の伏せ字の関数で新しい値を計算し、値が変わる文書だけを書く
- **Selected Approach**: 3。`{ _id: { $gt: lastId }, endpoint: { $regex: '\\?' } }` を `_id` 昇順で一定件数ずつ読み、伏せ字の関数を適用して、値が変わったものだけを `bulkWrite`（`updateOne({ _id, endpoint: 元の値 }, { $set: { endpoint: 新しい値 } })`）で書く。
- **Rationale**:
  - 1 は Prisma の拡張が `v` を増やすので、6.3 に反する。
  - 2 は、キーが自由にパーセントエンコードされうる（`%61ccess_token` など）ため、MongoDB の正規表現では伏せ字の関数と同じ判定ができない。要件 8.1 に反する。
  - 3 は伏せ字の関数をそのまま使うので、記録時と同じ結果になる。書くのは値が変わる文書だけなので、冪等で（6.4）、中断しても再実行すれば続きから直せる（6.5）。oplog と change stream に流れる量も、平文トークンを含む件数に限られる。
  - `_id` の範囲で区切るので、長時間開きっぱなしのカーソルを持たない。
- **Trade-offs**:
  - DB 側は `_id` インデックスを先頭から走査し、`?` の条件を文書ごとに判定するので、コレクション全体を読む。アプリ側に返るのは `?` を含む文書の `endpoint` だけ。読む量は保持期間（`app:activityExpirationSeconds`、既定 30 日）で決まる。保持期間を延ばした環境では、その分だけ起動が延びる。
  - 途中で落ちると、次の起動では先頭から走査し直す。書き換え済みの文書は書かないが、読む量は減らない。走査の途中では進捗のログを出さない。`?` を含む行が少ないと、1 回の問い合わせが 1,000 件に届くまで長い範囲を走査して何も返さないので、件数で進捗を出しても走査の位置は分からない。走査の位置を出すには `_id` の範囲の上限で区切る必要があるが、走査を最初からやり直すことは変わらず、一度しか流れない migration に境目の取りこぼしの余地を足すことになる。activities を全件読む `20261111120000-add-endpoint-index-to-activities` のインデックス作成も進捗を出していない。
  - change stream を読むインスタンスが 1 つもない間に書き換えが oplog の保持範囲を超えると、change stream の再開が HistoryLost になり、索引の再構築が必要になる。
- **Follow-up**: `endpoint_1` が選ばれると、`_id` の範囲で区切っていてもバッチのたびに endpoint のインデックスを全走査し、`_id` 順の並べ替えも挟まる（バッチ数×全件の負荷になる）。そのため `hint({ _id: 1 })` で `_id` インデックスに固定する。実装時に explain で、`_id_` の IXSCAN で SORT ステージがないことを確かめる。explain の対象は migration が export する `findRedactionBatch` のカーソルにして、テストに問い合わせを書き写さない（写しだと、migration の問い合わせを変えてもテストが古い写しを見て通り続ける）。
- **Note**: migrate-mongo は適用済みの migration を `migrations` コレクションに記録し、以後は流さない。ローリングアップデート中やロールバック中に、古いバージョンのコードが migration のあとに書いた平文の行は、この migration では直せず、TTL で消えるまで残る（要件の範囲外）。

### Decision: migration の `down` は何もしない
- **Context**: 伏せ字にした値から元のトークンは戻せない。
- **Selected Approach**: `down` は何もせず、ログに戻せない旨を出す。
- **Rationale**: 戻す手段がなく、戻すべきでもない（平文のトークンを DB に戻すことになる）。

### Decision: 伏せ字の関数を `server/util/` に移す
- **Context**: 伏せ字の関数は今 `middlewares/` にある。保存口（モデル）、migration、インポートの 3 か所から使う。
- **Selected Approach**: `server/middlewares/redact-access-token-from-endpoint.ts` とその spec を `server/util/` に移す。
- **Rationale**: モデルが middleware を import すると、依存の向きが逆になる。`server/util/` は model・service・migration のどこからでも依存してよい場所。

## Synthesis

- **Generalization**: 記録・migration・インポートの 3 つの要件は、どれも「endpoint を DB に入れる前に同じ規則で伏せ字にする」という 1 つの規則の適用先違い。規則は純粋関数 1 つにまとめ、3 か所はそれを呼ぶだけにする（要件 8）。伏せ字にするパラメータは関数内の定数 `SENSITIVE_QUERY_PARAMS` で決まるので、追加すれば以後の記録とインポートに効く（要件 8.2）。migration は一度しか流れないので、追加前に保存済みの行を直すには新しい migration を足す。
- **Build vs. Adopt**: URL のパースに `URL` / `URLSearchParams` を使うと、他のパラメータのエンコードや順序が正規化されて変わってしまい、要件 5.5 に反する。そのため、既存の自前の文字列処理を使い続ける。
- **Simplification**: 伏せ字のための新しいモデル層の仕組み（Prisma の query 拡張など）は作らない。migration のための汎用バッチ基盤も作らない。

## Risks & Mitigations
- Mongoose の `Activity` モデルが廃止されると、インポートの変換表から `activities.endpoint` が黙って消える → `construct-convert-map.integ.ts` で表に変換関数があることを確かめ、activity-log の Revalidation Trigger に書く。
- activity が多い環境（保持期間を延ばした環境）では、全件の走査で起動が延びる → 書くのは値が変わる文書だけ、アプリに返すのは `endpoint` だけ、`_id` の範囲で区切る。終わったら書き換えた件数をログに出す。
- change stream を読むインスタンスが 1 つもない間に書き換えが oplog の保持範囲を超えると、索引の再構築が必要になる → design.md の Migration Strategy に条件と対処を書く。
- 将来、文脈（`PendingActivityContext`）をログに出すと平文が漏れる → activity-log の Revalidation Trigger に書く。
- 作成済みのエクスポートファイルと、TTL で消えた行は直せない → 要件の範囲外として明記済み。

## References
- `.claude/rules/spec-lifecycle.md` — amend spec の書き戻しと自己削除の手順
- `.claude/rules/model.md` — Prisma の拡張が `v` を増やす挙動
- `apps/app/.claude/rules/esm-authoring.md` — migration は ESM で、named export の `up` / `down`
