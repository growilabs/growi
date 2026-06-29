# 実装ギャップ分析: activities-prisma-migration

対象スペック: `activities-prisma-migration`（Activity モデルの Mongoose→Prisma 移行）
分析フレームワーク: `.claude/skills/kiro-validate-gap/rules/gap-analysis.md`
移行手順の正典: `.claude/skills/mongoose-to-prisma/SKILL.md`

このドキュメントは「決定」ではなく「情報と選択肢」を提示する。設計フェーズの入力として使う。

---

## 1. 現状調査

### 1-1. 移行対象モデル
- `apps/app/src/server/models/activity.ts`（160行）。default export `Activity`、collection `activities`。
- スキーマフィールド: `user`(ObjectId, ref:'User', index), `ip`, `endpoint`, `targetModel`(enum), `target`(ObjectId, `refPath:'targetModel'` の polymorphic 参照), `eventModel`(enum), `event`(ObjectId, リレーション無し), `action`(enum, required), `snapshot`(サブドキュメント `{ username: String, index }`)。`createdAt` のみ `timestamps`（`updatedAt: false`）。
- `_id`／`__v` はどちらも既定で有効（`{ _id:false }`/`{ versionKey:false }` の指定なし）→ 拡張に `_id`/`__v` の両方の result alias が必要（activity.ts:48-89）。
- index: `{ target:1, action:1 }`、複合 unique `{ user:1, target:1, action:1, createdAt:1 }`（activity.ts:91-100）。`createdAt` の index は schema では作らず、ActivityService が TTL index として作る（activity.ts:90 のコメント）。
- plugin: `mongoose-paginate-v2`（activity.ts:101）。
- hook: `post('save')` でデバッグログを出すだけ（activity.ts:103-105）。**副作用のない純粋なログ**なので、Prisma 移行時に再現する必要はない（必要なら拡張の `query.create` で同等のログを出せる）。
- statics: `createByParameters`、`updateByParameters`、`findSnapshotUsernamesByUsernameRegexWithTotalCount`（activity.ts:107-155）。
- **factory パターンは無い**。`getOrCreateModel('Activity', schema)` をそのまま default export しているだけで、`crowi` を closure で受け取らない。crowi 依存は ActivityService 側にあり、モデル自体は素である（後述 5）。
- `ActivityModel` interface に宣言された `getActionUsersFromActivities` は **schema.statics に実装が無い**（activity.ts:38-41 のインターフェース宣言のみ）。実体は `routes/apiv3/in-app-notification.ts:172` でインラインのローカル関数として再定義されており、`Activity` の static は呼んでいない。→ 移行対象 static は実質 3 つ。

### 1-2. schema.prisma（introspect 済み・変更ほぼ不要）
`apps/app/prisma/schema.prisma:50-71` に `model activities`、16-19 行に `type ActivitiesSnapshot` が既に存在する。
- `id String @id @default(auto()) @map("_id") @db.ObjectId` / `v Int @map("__v")` がある（`_id`/`__v` の後方互換に必要なエイリアスが揃っている）。
- `userId String? @map("user") @db.ObjectId` ＋ `user users? @relation(...)`（リレーション名 `user`、Mongoose の `user` フィールドが Prisma では `userId`+`user` に分裂）。
- `target String? @db.ObjectId` ＋ `targetModel String?`（**リレーション強制なしの緩い参照**＝要件で維持すべき性質。schema 上もリレーション宣言が無い）。`event`/`eventModel` も同様にスカラーのみ。
- `snapshot ActivitiesSnapshot`（composite type。`ActivitiesSnapshot` は `id @map("_id") @db.ObjectId` ＋ `username String`）。
- 複合 unique `@@unique([userId, target, action, createdAt])`、`@@index([snapshot.username])`、`@@index([target, action])`、`@@index([createdAt])`、`@@index([userId])` が宣言済み。
- **`user` リレーションに `onDelete/onUpdate` の明示が無い**（comments/externalaccounts は `NoAction` を明示）。スキルは「リレーションは `onDelete: NoAction, onUpdate: NoAction` を常に使う」と指示。要 確認（設計フェーズで `NoAction` 明示を追加するか）。**Constraint**。
- Prisma 6.19.2（`@prisma/client`/`prisma` とも `^6.19.2`）。MongoDB コネクタなので `aggregateRaw` / `findRaw` / `runCommandRaw` / `groupBy` が利用可能。generated client（`src/generated/prisma`）はビルド時生成でリポジトリには未コミット。

### 1-3. 既存の移行済みパターン（正解の型）
- `external-account.ts`（.ts モデル）: Mongoose schema を残したまま、同一ファイル末尾に `export const extension = Prisma.defineExtension(...)` を追加。`result.<col>._id/__v`、`model.<col>.<method>` を定義。`Prisma.getExtensionContext<typeof prisma.<col>>(this)` で context を取得。**Activity は .ts なのでこの型に一致**（別ファイル `.prisma.ts` 方式の user は不要）。
- `utils/prisma.ts`: `createPrisma()` が `$allModels` の `result._id/__v`（型は `any`）、`query.update/updateMany` で **毎回 `v` を increment**、`model.$allModels.paginate({ where, orderBy, include, select, page, limit })`（mongoose-paginate-v2 互換の戻り shape）を定義し、各モデル拡張を `.$extends(CommentExtension).$extends(ExternalAccountExtension).$extends(UserExtension)` でチェーン。**ここに `.$extends(ActivityExtension)` を追加する必要がある**（現状未追加＝Missing）。
- `paginate` ヘルパの引数は `{ where, orderBy, page, limit, include, select }`。mongoose-paginate-v2 の `paginate(query, { offset, limit, sort, populate, lean })` とは **引数 shape が違う**（後述 6 の重要ギャップ）。

---

## 2. 要件→資産マップ（Missing / Unknown / Constraint タグ付け）

### 要件1: Activity 記録の挙動保持（create / update）
| 観点 | 既存資産 | ギャップ |
|---|---|---|
| 記録の create | `createByParameters`（activity.ts:107）= `this.create(parameters)` 薄いラッパ。呼び出し元: `add-activity.ts:38`、`service/activity.ts:207`、`service/page/index.ts:2842`、page-bulk-export 経由 | **Constraint**: 呼び出し側が `user`/`target` に **ID ではなく Mongoose ドキュメント／オブジェクトを渡している**（`page/index.ts:2832-2834` は `user`(オブジェクト)・`target: page`(Page)）。Mongoose は save 時に ObjectId へ coerce するが、Prisma の `create({ data: { userId, target } })` は **string の ObjectId を要求**する。create 内で `user._id?.toString()`/`page._id?.toString()` への正規化が必要。**この正規化ロジックの所在（拡張内 vs 呼び出し側）が未決＝Unknown** |
| 確定後の update | `updateByParameters`（activity.ts:116）= `findOneAndUpdate({_id}, params, {new:true})`。`service/activity.ts:100` の `activityEvent.on('update')` から呼ばれる。`update` 可否は `shoudUpdateActivity`（= `getAvailableActions().includes(action)`）で判定（service/activity.ts:98,188） | `findOneAndUpdate(...,{new:true})` → Prisma `update({ where:{id}, data })`（`update` は更新後を返す）。**Constraint**: 戻り値（後述）に `user` 等のリレーションが必要なら `include` 指定が要る |
| 記録対象外 action の不記録 | 判定は ActivityService 側（`createActivity`/`shoudUpdateActivity`、service/activity.ts:188-214）。モデルは判定しない | ギャップ無し（移行で挙動変わらず）。判定ロジックはモデル外なので Prisma 化の影響を受けない |
| 全 action 種別の記録 | enum は `~/interfaces/activity` の `AllSupportedActions` 等。Prisma 側は `action String`（enum 制約なし） | **Constraint**: Mongoose の enum バリデーションが Prisma では効かない。ただし値はアプリ側で固定生成されるため観察可能な差は出にくい。設計で言及推奨 |

### 要件2: 参照・一覧の挙動保持（paginate / フィルタ / レスポンス shape）
| 観点 | 既存資産 | ギャップ |
|---|---|---|
| 監査ログ一覧の paginate | `routes/apiv3/activity.ts:294` が `Activity.paginate(query, { lean, limit, offset, sort:{createdAt:-1}, populate:'user' })` | **Missing/最重要ギャップ**: `utils/prisma.ts` の `paginate` は引数 shape が違う（`{ where, orderBy, page, limit, include }`、`offset` ではなく `page`、`populate` ではなく `include`）。`offset` の意味も要確認（mongoose-paginate-v2 では `offset` はドキュメント数オフセット、`page` ではない）。**呼び出し側の書き換え＋戻り shape の検証が必須**。`offset`→`page` 換算で観察挙動を変えないことが鍵 |
| フィルタ（username/action/date） | activity.ts:240-291 で query を組み立て。`'snapshot.username': [...]`（配列）、`action: [...]`（配列）を **Mongoose の暗黙 `$in` coerce** に依存。date は `createdAt: { $gte, $lt }` | **Constraint**: Prisma の `where` は **配列を暗黙 `$in` にしない**。`{ in: [...] }` へ明示変換が必要。ネストの `snapshot.username` は composite type フィルタ（`snapshot: { is: { username: { in:[...] } } }` 形）。設計で where 変換表を要定義＝**Unknown**（composite type のフィルタ構文が Prisma で意図通り効くか裏取り要） |
| レスポンス shape（`snapshot`/`user`/`_id`/`__v`） | `serializeUserSecurely(user)` + `...rest` で返す（activity.ts:302-308）。OpenAPI に `_id`,`id`,`__v`,`user`,`snapshot.username`,`snapshot._id` を明記 | **Constraint**: Prisma 結果は `user` ではなく `userId`＋（`include:{user:true}` 時の）`user`。フロント互換のため `userId`→`user` の remap が要る可能性。`_id`/`__v` は computed alias で互換。`snapshot._id` は composite type の `id @map("_id")`。要 remap 範囲の確定 |

### 要件3: 集計・エクスポートの挙動保持
| 観点 | 既存資産 | ギャップ |
|---|---|---|
| 貢献度グラフ集計 | `contribution-graph/.../activity-aggregation-service.ts:19` `Activity.aggregate(pipeline)`。pipeline: `$match`(user/action `$in`/createdAt範囲) → `$group`(`$dateTrunc` 日単位 UTC) → `$project`(date文字列/count) → `$sort` | **Missing/難所**: `$dateTrunc` による日単位グルーピングは **Prisma `groupBy` では表現できない**（groupBy はフィールド完全一致のみ。日付トランケート不可）。`aggregateRaw`（= MongoDB aggregation pipeline をそのまま投げる）で raw 化が現実的。pipeline をほぼそのまま流用可。**実現方式が Effort を律速** |
| ユーザー別アクティビティ集計 | `routes/apiv3/user-activities.ts:215-276` `Activity.aggregate`。`$match` → `$facet`(totalCount + docs(sort/skip/limit + `$lookup` pages/users + `$unwind` + `$project`)) | **Missing/難所**: `$facet`＋2つの `$lookup`＋`$unwind` は groupBy で不可能。`aggregateRaw` で pipeline をそのまま投げるのが妥当。**ただし** `aggregateRaw` の戻りは BSON 拡張 JSON（`$oid`/`$date`）になり得るため、`serializeUserSecurely`/`res.apiv3` に渡す前の shape 正規化が要る＝**Unknown**（raw 戻り値の型・日付/ObjectId 表現の裏取り要） |
| 監査ログのバルクエクスポート | `audit-log-bulk-export/.../exportAuditLogsToFsAsync.ts`: `Activity.exists(query)`（112）→ `Activity.find(query).sort({_id:1}).lean().cursor({batchSize})`（126）を Node stream `pipeline` で `Writable` へ流す。query は `action $in`/`createdAt` 範囲/`user $in`/`_id: {$gt: lastExportedId}`（resume 用） | **Missing/難所**: Prisma には **Mongoose の `.cursor()` 相当のストリームが無い**。選択肢は (a) `_id` カーソルページング（`findMany({ where:{ id:{ gt:lastId } }, orderBy:{ id:'asc' }, take:batch })` を繰り返し、ReadableStream/async generator 化）か (b) `findRaw` + ネイティブ cursor。`_id` 昇順 resume は **ObjectId を保持するので順序は不変**（テストエージェントの「UUID 化で順序が変わる」懸念は GROWI では非該当）。`exists`→`count(...)>0` か `findFirst`。**(a) のバッチング実装が新規＝Effort 寄与**。`lastExportedId` の `_id > x` 比較は ObjectId 文字列比較で機能する |
| ユーザー名補完（snapshot.username 検索） | `findSnapshotUsernamesByUsernameRegexWithTotalCount`（activity.ts:129）。`aggregate().skip(0).limit(10000).match({'snapshot.username':{$regex,$options:'i'}}).group(_id:'$snapshot.username').sort.skip.limit` ＋ 別途 `find(conditions).distinct('snapshot.username').length`。呼び出し: `routes/apiv3/users.js:1595`（**.js 呼び出し元**） | **Missing/難所**: distinct + regex + ページングの集計。`aggregateRaw`（pipeline 流用）＋ distinct 用に `findRaw`/別 aggregate が妥当。**正規表現は MongoDB へ渡るため `escapeStringForMongoRegex` 規約に注意**（ただし現状は生 `q` を `$regex` に渡しており現挙動維持＝エスケープ追加は挙動変更になり得る点を設計で確認）。**呼び出し元が .js のため型の取り回しに注意**＝Constraint |

### 要件4: 保持・unique・index の維持
| 観点 | 既存資産 | ギャップ |
|---|---|---|
| TTL（保持期間） | `service/activity.ts:216 createTtlIndex` が `Activity.createIndexes()` ＋ raw collection 操作（`mongoose.connection.collection('activities')` の `indexes()`/`dropIndex`/`createIndex({createdAt:1},{expireAfterSeconds})`）。`crowi/index.ts:874` から起動時に呼ぶ | **Constraint（据え置きで良い）**: スキル方針「全モデル移行完了まで Mongoose が index 作成を担う」に合致。`createTtlIndex` は Mongoose ドキュメントへ依存せず raw collection を叩くだけなので、Activity static を Prisma 化しても **そのまま動く**。`Activity.createIndexes()` は Mongoose static だが「Mongoose 専用の記録・更新・一覧・集計メソッド」ではなく index 作成なので要件5-1 の撤去対象外。**移行中は据え置きが妥当**。ただし `service/activity.ts` 冒頭の `import Activity from '~/server/models/activity'` を残すか、index 用途だけ別経路にするかは設計判断 |
| 複合 unique | schema.prisma で `@@unique([userId, target, action, createdAt])` 宣言済み | ギャップ無し。Mongoose schema 側の unique index も残る（重複作成にならないよう map 名一致を確認＝Unknown 程度） |
| collection/index 作成の仕組み | `setup-models.ts:63 import('../models/activity')` で schema 登録。Mongoose が autoIndex で作成 | **Constraint**: Mongoose schema ブロックは残す（スキル必須）。`export default` を最終的に外せるかは要件5 と連動 |

### 要件5: 完了基準・非破壊性
| 観点 | 既存資産 | ギャップ |
|---|---|---|
| 全消費者が Prisma 経由 | 消費者 15+ ファイル（下表）。statics 直呼びの除去がゲート | **Missing**: `utils/prisma.ts` への `.$extends(ActivityExtension)` 追加 ＋ 各呼び出し元の書き換えが未着手 |
| 破壊的データ移行不要 | `_id`/`__v` は computed、ObjectId 保持、schema 不変更（field 追加なし） | ギャップ無し。**純粋にアクセス層の移行**。データ変換は不要 |
| 観察挙動の不変 | `__v` を読む箇所は **コードベースに存在しない**（grep 確認: activity に対する `.__v` 読み取り 0 件） | **Constraint（好材料）**: Prisma が全 update で `__v` increment しても、UNSETTLED→settled 更新で `__v` を読む/assert する箇所が無いため **観察可能な不具合は生じない**。設計で「__v 差は許容」と明記すれば足りる |
| フロント不変更 | フロントは Activity static を直接呼ばない（API 経由のみ） | ギャップ無し（スコープ外） |
| 完了の確認可能性 | 完了基準 = 「記録・更新・一覧取得が Prisma 経由、Mongoose 専用メソッド非依存」 | 完了判定は「`add-activity.ts`/`service/activity.ts`/`apiv3/activity.ts` が `Activity.create/update/paginate` を呼ばない」を grep で確認可能にする設計が必要 |

---

## 3. 各消費者の移行難易度表

| 消費者ファイル | 使用メソッド | 変換先（mongoose-to-prisma 対応表） | 分類 | 根拠 |
|---|---|---|---|---|
| `middlewares/add-activity.ts:38` | `createByParameters({ip,endpoint,action,user,snapshot:{username}})` | 拡張 `createByParameters` → `context.create({ data:{...} })`。`user` は ID 化 | **クリーン** | 単純 create。`user` は `req.user?._id`(既に ID 寄り) |
| `service/activity.ts:207` | `createByParameters`（GET 用 `createActivity` 経由） | 同上 | **クリーン** | 薄いラッパ |
| `service/activity.ts:100` | `updateByParameters(activityId, params)` | `update({where:{id},data})`（更新後返却。リレーション要なら `include`） | **やや難** | 戻り値を event で下流（pre-notify/in-app-notification）に渡す→ `user`/`target`/`_id` フィールド名互換が要 |
| `service/page/index.ts:2842` | `createByParameters({user(obj), target:page(obj), targetModel, snapshot})` | `create`。**`user`/`target` をオブジェクト→ID 正規化必須** | **やや難** | Mongoose の暗黙 coerce に依存。正規化の所在が論点 |
| `routes/apiv3/activity.ts:294` | `paginate(query,{lean,limit,offset,sort,populate})` | `utils/prisma` `paginate({where,orderBy,page,limit,include})` ＋ where/配列→`{in}` 変換 ＋ レスポンス remap | **難** | 引数 shape 不一致・`offset`→`page` 換算・配列フィルタ・composite type フィルタ・`populate:'user'`→`include:{user:true}`＋remap |
| `routes/apiv3/user-activities.ts:276` | `aggregate($match/$facet/$lookup/$unwind/$project)` | `aggregateRaw({ pipeline })`（pipeline 流用）＋ 戻り shape 正規化 | **難（律速）** | `$facet`＋`$lookup` は groupBy 不可。raw 必須。BSON 拡張 JSON の正規化が新規 |
| `contribution-graph/.../activity-aggregation-service.ts:19` | `aggregate($match/$group $dateTrunc/$project/$sort)` | `aggregateRaw({ pipeline })`（pipeline 流用） | **難（律速）** | `$dateTrunc` 日単位は groupBy 不可。raw 必須 |
| `audit-log-bulk-export/.../exportAuditLogsToFsAsync.ts:112,126` | `exists` ＋ `find().sort({_id:1}).lean().cursor()` | `count>0`/`findFirst` ＋ `_id` カーソルページング（findMany バッチ反復）or `findRaw` cursor | **難（律速）** | Prisma に cursor stream 無し。バッチング実装が新規。`_id` 昇順 resume は ObjectId 保持で順序不変 |
| `contribution-migration-service.ts:90` | `findById(activityId).select('user')` | `findUnique({where:{id},select:{userId:true}})` | **クリーン** | 単純取得。`.select('user')`→`select:{userId:true}` |
| `service/activity/update-activity-logic.ts:25` | `findOne({target,action:{$in},_id:{$ne}}).sort({createdAt:-1})` | `findFirst({where:{target,action:{in:[...]},id:{not}},orderBy:{createdAt:'desc'}})` | **やや難** | unique でないので `findFirst`。`$ne`→`{not}`、`$in`→`{in}`、sort 1件取得 |
| `routes/apiv3/users.js:1595` | `findSnapshotUsernamesByUsernameRegexWithTotalCount(q,{offset,limit})` | 拡張メソッドを `aggregateRaw` 等で再実装 | **難** | 集計＋distinct＋regex。**.js 呼び出し元**で型取り回しに注意 |
| `routes/apiv3/in-app-notification.ts:172` | （static 不使用。インライン関数で `activity.user` を読むだけ） | **変更不要** | **影響なし** | InAppNotification(Mongoose 未移行) の `populate` 経由で Activity を読む。Activity schema を残すので populate は機能継続 |
| `service/pre-notify.ts:43`, `service/in-app-notification.ts:90` | （static 不使用。event で渡された activity の `.user/.target/._id/.targetModel/.action` を読む） | **要 確認** | **影響あり（間接）** | `updateByParameters` の Prisma 戻り値が `user`(relation) を持つか。`getIdForRef(activity.user)` が `userId`(string) でも動くか裏取り要＝Unknown |
| `crowi/setup-models.ts:63` | `import('../models/activity')`（schema 登録） | **変更不要（schema 残置）** | **影響なし** | index/collection 作成のため import は残す |
| `service/activity.ts:225 createTtlIndex` | `Activity.createIndexes()` ＋ raw collection | **据え置き** | **影響なし** | index 作成は移行対象外（要件4-3） |

テスト（要件: テストの移行要否）:
| テスト | 種別 | Activity 操作 | 移行要否 |
|---|---|---|---|
| `add-activity.spec.ts` | unit(mock) | `createByParameters` を spy | 低。spy 対象を Prisma メソッドへ差し替え |
| `update-activity.spec.ts` | integ | `deleteMany`/`insertMany`（明示 `_id` 付き） | 中。`insertMany`→`createMany`。**明示 `_id` は ObjectId 保持なので Prisma でも `id` 指定で可**（要 裏取り） |
| `activity-aggregation-service.spec.ts` | integ | `deleteMany`/`insertMany` | 中。集計実装の raw 化に追随 |
| `contribution-migration-service.spec.ts` | integ | `create`/`insertMany`/`deleteMany` | 中。メソッド名変換中心 |
| `contribution-orchestration.spec.ts` | integ | `deleteMany`/`create`/`findById`（settled action assert） | 中。`findById`→`findUnique`。`__v` の assert は無い |
| `audit-log-...integ.ts` | integ(実DB) | `insertMany`/`deleteMany`/`find().sort({_id:1})`/`countDocuments` | 中。`_id` 昇順は ObjectId 保持で順序不変。timestamp 抽出も ObjectId 保持なので維持 |
| `activity.spec.ts`, `activity-vault-reconcile.spec.ts` | unit | なし（定数 export のみ） | 不要 |

> 注: 並行で行ったテスト調査が「Prisma 化で `_id` が UUID 文字列になり順序/timestamp が変わる」と懸念した点は、**GROWI の移行方針では誤り**。schema は `@db.ObjectId @default(auto())` で **MongoDB ObjectId を保持**するため、`_id` 昇順 resume・ObjectId からの timestamp 抽出・明示 `_id` 指定は移行後も成立する。

---

## 4. 実装アプローチ Options A/B/C

このスペックは「新規コンポーネント作成」ではなく「既存 Mongoose static の Prisma 拡張への置換」なので、A/B/C は **置換の一括度・難所の扱い方** の軸で整理する（gap-analysis.md の A=既存拡張 / B=新規分離 / C=ハイブリッドに対応づけ）。

### Option A: スキル準拠で全 static を一括移行（既存拡張パターンに全面準拠）
- `activity.ts` 末尾に `ActivityExtension`（`createByParameters`/`updateByParameters`/`findSnapshotUsernames...`/必要なら集計・cursor 用メソッド）を追加し、`utils/prisma.ts` に `.$extends(ActivityExtension)` を足す。集計・cursor も拡張メソッド内で `aggregateRaw`/バッチングとして実装。全消費者を一度に Prisma 経由へ。
- **Trade-off**: ✅ 単一 PR で完了基準（要件5）を満たし、Mongoose 依存が一掃される。external-account の確立パターンに最も忠実。 ❌ 難所（aggregateRaw 戻り正規化・cursor バッチング・paginate shape）を同時に解くため PR が大きく、レビュー・検証負荷が高い。挙動同一性の回帰確認（一覧・集計・エクスポート）を一度に行う必要。

### Option B: 読み書き（クリーン群）を先に移行し、集計/cursor は段階的に raw 化
- フェーズ1: `createByParameters`/`updateByParameters`/`findById`/`findOne`(update-logic)/`paginate`(activity 一覧) を Prisma 拡張へ。これで要件5 の完了ゲート（「記録・更新・一覧取得が Prisma 経由」）を満たす。
- フェーズ2: `aggregate`×2・`find().cursor()`・`findSnapshotUsernames` を `aggregateRaw`/バッチングへ。これらは難所だが要件5 ゲートには直接含まれない（ゲートは記録・更新・一覧）。
- **Trade-off**: ✅ 後続スペック `activity-log` のハードブロッカー解除を最短化（ゲート＝記録/更新/一覧のみ）。PR を小さく刻める（feedback: こまめにコミット に整合）。難所を分離して個別検証できる。 ❌ フェーズ間は「一覧は Prisma・集計は Mongoose」の混在状態が残る（`models/activity.ts` の static が一部生存）。完了基準の「Mongoose 専用メソッド非依存」を満たすのはフェーズ2完了時。

### Option C: ハイブリッド（拡張＋集計を別モジュールに分離）
- statics は拡張へ移すが、難所の集計（aggregateRaw pipeline）と cursor バッチングは **拡張メソッドに詰め込まず、`features`/`service` 配下の専用関数**（pure function、pipeline を引数で受ける executor 型）として切り出し、拡張からも呼べる形にする。`utils/prisma` の汎用 paginate はそのまま流用。
- **Trade-off**: ✅ coding-style の「executor は work-set を入力で受ける／責務分割」に最も整合。pipeline がテストしやすく、`activity-log` 側からの再利用も容易。集計の単体テストが pipeline 注入で書ける。 ❌ 拡張メソッドと外部関数の二層になり、external-account の「単一ファイルに全部」パターンから外れる。どこまでを拡張の公開 API にするかの線引きが必要（barrel/public surface 設計が増える）。

> いずれの Option も共通の必須作業: `utils/prisma.ts` への `ActivityExtension` チェーン追加、`_id`/`__v` の result alias（両方）、`paginate` 呼び出し shape の書き換え＋レスポンス remap、where の配列→`{in}`／`$ne`→`{not}`／composite type フィルタ変換、aggregateRaw 戻り値の BSON 正規化。

---

## 5. Effort / Risk

| 項目 | 評価 | 一言根拠 |
|---|---|---|
| **Effort** | **L（1〜2週間）** | クリーン statics は S だが、`aggregate`×2 の raw 化＋cursor ストリームのバッチング＋paginate shape 変換＋集計戻り値の BSON 正規化＋integ テスト追随が積み上がる。消費者 15+ ファイル横断。external-account 型の単純 CRUD 移行（S〜M）より一段重い |
| **Risk** | **Medium** | 既存の確立パターン（external-account / utils/prisma）と既 introspect 済み schema があり技術的未知は小さい。一方 (1) aggregateRaw の戻り型（`$oid`/`$date`）正規化、(2) cursor バッチングでの順序・resume 同一性、(3) paginate の `offset`→`page` 換算、(4) composite type フィルタ構文 が「挙動同一性」リスクの中心。`__v` 差は読み手が無く Low。データ移行不要で破壊リスクは Low |

難所別の内訳: 集計 raw 化＝M/Med、cursor バッチング＝M/Med、paginate 互換＝S〜M/Med、クリーン statics＝S/Low、TTL/index 据え置き＝S/Low。

---

## 6. 設計フェーズへの申し送り

### 推奨アプローチ
- **Option B（読み書き先行・集計/cursor を段階化）を基線に、難所の実装は Option C の分離（pipeline を引数で受ける pure executor）で書く** ハイブリッドを推奨。理由: (1) `activity-log` のハードブロッカー解除を最短化（ゲートは記録/更新/一覧）、(2) 難所を個別 PR で挙動同一性検証でき回帰リスクを局所化、(3) coding-style（executor の入力受け取り・責務分割・テスト容易性）に整合。ただし最終的に `models/activity.ts` の全 static を撤去し要件5 を満たすこと。

### Key Decisions（設計で決める）
1. **paginate の引数互換**: `apiv3/activity.ts` の `paginate(query,{offset,limit,sort,populate})` を `utils/prisma` の `paginate({where,orderBy,page,limit,include})` にどう写すか。特に `offset`（ドキュメント数）→`page` の換算規則と、`populate:'user'`→`include:{user:true}`＋レスポンスの `userId`→`user` remap。
2. **集計の実現手段**: `aggregate`×2 と `findSnapshotUsernames` を `aggregateRaw`（pipeline 流用）で実装する前提で、戻り値の `$oid`/`$date` を既存の `serializeUserSecurely`/`res.apiv3` が期待する shape へ正規化する共通ユーティリティを置くか。
3. **cursor ストリームの設計**: `_id` カーソルページング（findMany バッチ反復を `Readable`/async generator 化）か `findRaw` ネイティブ cursor か。`lastExportedId` resume の `_id > x` 比較・`sort({_id:1})` 同一性を担保する方式。
4. **create 時の ID 正規化の所在**: `user`/`target` にオブジェクトを渡す呼び出し元（`page/index.ts`）を、拡張内で `_id` 正規化するか、呼び出し側で ID 化するか。
5. **`updateByParameters` の戻り値 shape**: 下流 event 消費者（pre-notify/in-app-notification）が読む `user`/`target`/`_id`/`targetModel`/`action` を満たすため `include:{user:true}` が要るか、`getIdForRef` が `userId`(string) で足りるか。
6. **TTL/index の据え置き範囲**: `createTtlIndex`（`Activity.createIndexes()`＋raw collection）は据え置き（要件4-3）。`service/activity.ts` で Activity を index 用途のみ import し続けるか、別経路にするか。schema.prisma の `user` リレーションに `onDelete/onUpdate: NoAction` を明示するか（スキル指示）。
7. **完了ゲートの検証手段**: 「記録・更新・一覧が Prisma 経由」を grep 等で機械確認できる状態にする（`activity-log` 着手ゲート、要件5-5）。

### Research Needed（設計フェーズで裏取り）
- **R1**: Prisma 6.19.2 MongoDB の composite type（`snapshot.username`）への `where` フィルタ構文（`snapshot: { is: { username: { in:[...] } } }` 等）が introspect 済み `ActivitiesSnapshot` で意図通り効くか。
- **R2**: `aggregateRaw` の戻り値の正確な型と BSON 拡張 JSON（`$oid`/`$date`）の表現。`$facet`/`$lookup`/`$dateTrunc` を含む既存 pipeline をそのまま渡せるか。
- **R3**: cursor 相当の最適手段（findMany バッチ反復のメモリ/性能 vs `findRaw` cursor）と、Node stream `pipeline` への組み込み方。
- **R4**: Prisma の `createMany`/`create` で **明示 `_id`（ObjectId 文字列）を指定**できるか（integ テストが明示 `_id` を使うため）。
- **R5**: `utils/prisma` の `paginate` 戻り shape が mongoose-paginate-v2 の `serializedPaginationResult`（`offset` フィールド含む）と完全一致するか（`offset` が無い点に注意）。
- **R6**: `findSnapshotUsernames` の regex を MongoDB へ渡す際、現状の生 `q`（未エスケープ）を維持するか、`escapeStringForMongoRegex` を入れるか（後者は挙動変更になり得る）。

---

# 設計フェーズ確定事項（2026-06-29 ユーザー承認）

ギャップ分析後の対話で、以下2点を設計判断として**確定**した。`/kiro-spec-design` 時に Boundary Commitments / File Structure Plan / Key Decisions へ反映する。

## 確定1: 共有 paginate ヘルパの入力を offset に一本化する（page との両対応にしない）

- `apps/app/src/utils/prisma.ts` の `paginate`（`$allModels`）の**入力を `offset` 一本に統一**する（現状は `page` 入力 → `skip=(page-1)*limit`）。`page` 入力は廃止し、`skip = offset`（exact）とする。
- **出力は page 由来フィールド（`page`/`totalPages`/`hasNextPage`/`pagingCounter` 等）を内部計算で残す**。これにより external-account UI も監査ログ画面もフロント無変更（要件2-3 と整合）。
- **唯一の現 Prisma 消費者 external-account を巻き込んで揃える**: [external-account.ts](apps/app/src/server/models/external-account.ts) の `findAllWithPagination({page})` を offset 化（呼び出し元 [users.js:1070](apps/app/src/server/routes/apiv3/users.js) はフロントの `?page=N` を受けるので、`offset=(page-1)*limit` 変換を1箇所入れる）。
- **採否理由**: 入力規約が1つになり優先順位ルール不要 / offset→page 変換の端数ずれが原理的に消える / 未移行の多数派（mongoose-paginate-v2 の offset スタイル: User/Attachment/Revision/ShareLink…）と揃い将来移行のコストも減る。additive（両対応）より綺麗。
- **境界メモ（scope-creep を silent にしない）**: これは activities 移行に付随する**共有ヘルパの意図的な小改修**。移行スペックの Boundary に「shared paginate の入力を offset に統一（external-account の1呼び出し箇所の変換を含む）」と明記する。external-account の観察可能な挙動（一覧・件数・ページ情報）は不変であることを回帰確認する。
- 関連: R5 はこの確定で「出力は page 系フィールドを保持しつつ入力 offset」に解決方針が定まる。Key Decision 1（offset→page 換算）は「換算せず offset を直接 skip に使う」に確定。

## 確定2: 実装アプローチは「Option C の構造 ＋ Option B の順序」

- **構造 = Option C（難所を pure executor に分離）**: 拡張（`Prisma.defineExtension`）は薄いアダプタにし、難所＝集計（`aggregateRaw` の pipeline）と cursor バッチングを **pipeline / work-set を引数で受ける pure executor 関数**として `service`/`features` 配下に分離する。`utils/prisma` の汎用 paginate は流用。
  - 理由: Activity は単純 CRUD でなく**難所が2系統（aggregate×2・cursor ストリーム）ある複雑モデル**。coding-style の「責務でサブモジュール分割」「executor は work-set を入力で受ける」に従うと自然に C になる。external-account の「単一ファイルに全部」は単純モデル向けの前例で、複雑モデルでは分割が正解。集計を pipeline 注入で単体テストでき回帰検知が強い。activity-log からの再利用も効く。
- **順序 = Option B（読み書き先行 → 難所を段階）**: フェーズ1で `createByParameters`/`updateByParameters`/`findById`/`findOne`(update-logic)/`paginate`(activity 一覧) を Prisma 化し、要件5 の完了ゲート（記録・更新・一覧が Prisma 経由）を満たして **activity-log のハードブロッカーを最短解除**。フェーズ2で `aggregate`×2・`find().cursor()`・`findSnapshotUsernames` を `aggregateRaw`/バッチングへ。各難所を個別に挙動同一性検証する。
  - 注: A と B の最終コードは同一（差は納品の刻み方）。最終的に `models/activity.ts` の全 static を撤去して要件5 を満たす。
- **不採用 = Option A（一括 big-bang・拡張に全部）**: 速いが、太った拡張内の raw 集計・cursor が単体テストしづらく回帰が隠れる＋一覧/集計/エクスポートの挙動同一性を一度に検証＝デグレ見落としリスク増。回帰リスクを飲む妥協案として記録（不採用）。

## 確定3（cursor 設計の方向づけ・R3 への回答）

- 監査ログ CSV エクスポート（[exportAuditLogsToFsAsync.ts](apps/app/src/features/audit-log-bulk-export/server/service/audit-log-bulk-export-job-cron/steps/exportAuditLogsToFsAsync.ts)）の `find().sort({_id:1}).cursor()` は、**Prisma の `cursor`+`take`（または `id:{gt:lastId}`）バッチングを async generator にして `Readable.from(...)` で既存 `pipeline` に流す**方式を採用方向とする。一定メモリ・`_id` 昇順 resume（ObjectId 保持で現状と同一）を維持。`findRaw` 全件メモリ載せは大規模監査ログでデグレ（OOM/timeout）のため不採用。詳細は design で確定（R3）。
