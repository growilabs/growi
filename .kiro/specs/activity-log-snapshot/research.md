# Gap Analysis: activity-log (snapshot 型付け + 添付削除ログ)

調査日: 2026-06-29 / 対象 requirements: Requirement 1〜4

このドキュメントは、requirements.md の各要件と既存コードベースの差分を整理し、設計フェーズに渡す判断材料をまとめたものである。実装方針の最終決定はしない（選択肢と trade-off の提示にとどめる）。

---

## 1. 現状調査（Current State）

### 1.1 関連する主要ファイル

| 役割 | ファイル | 要点 |
|------|---------|------|
| Activity の型・action 定数・グループ定義 | `apps/app/src/interfaces/activity.ts` | `ISnapshot = Partial<Pick<IUser, 'username'>>`（742行）。action 定数、`SmallActionGroup`/`MediumActionGroup`、`SupportedTargetModel`（Page/User/PageBulkExportJob/AuditLogBulkExportJob の4種のみ）を定義 |
| Activity の Mongoose モデル | `apps/app/src/server/models/activity.ts` | `snapshotSchema`（43-45行）、複合 unique index（92-100行）、`createByParameters`/`updateByParameters` |
| Activity サービス（記録の制御） | `apps/app/src/server/service/activity.ts` | `activityEvent.on('update', ...)` ハンドラ、`shoudUpdateActivity`、`getAvailableActions`、`createActivity` |
| 添付の直接削除 API | `apps/app/src/server/routes/attachment/api.js` | `api.remove`（313-345行）。削除後に `activityEvent.emit('update', res.locals.activity._id, { action: ACTION_ATTACHMENT_REMOVE })` |
| 添付サービス（削除実体） | `apps/app/src/server/service/attachment.ts` | `removeAttachment`（140行）/ `removeAllAttachments`（118行） |
| Attachment モデル | `apps/app/src/server/models/attachment.ts` | `page`（ObjectId ref）, `originalName`, `fileSize`, `creator`, `fileName` を保持。**パス文字列は持たない** |
| ページ完全削除（カスケード） | `apps/app/src/server/service/page/index.ts` | `deleteCompletelyOperation`（2375行）が `removeAllAttachments(attachments)` を呼ぶ。`deleteCompletely`（2428行）は親 activity を `createActivity` で作る |
| 監査ログ取得 API | `apps/app/src/server/routes/apiv3/activity.ts` | `Activity.paginate` の結果を `...rest` で展開（302-308行）。snapshot は素通りで応答に乗る |

### 1.2 activity 記録の2つの経路（重要）

添付削除の記録には、性質の異なる2つの経路がある。これを混同しないことが設計の起点になる。

- **直接削除（`/attachments.remove`）**: リクエストごとに `addActivity` middleware が `ACTION_UNSETTLED` の activity を1件先に作り `res.locals.activity` に置く。API はそれを `emit('update', ...)` で**更新**する。**1リクエスト＝1 activity の更新**なので、後述の unique index 衝突は起きない。
- **カスケード削除（ページ完全削除・ゴミ箱を空にする）**: `deleteCompletelyOperation` が `removeAllAttachments` で複数の添付を一括削除する。ここには**添付ごとの activity が存在しない**（親の `PAGE_DELETE_COMPLETELY` などに紐付くのみ）。新たに記録するには activity を**新規作成**する必要があり、ここで unique index と正面衝突する。

### 1.3 snapshot がデータに乗る/乗らない経路

- 直接削除の emit は現在 `{ action }` だけを渡す。`updateByParameters` は渡した parameters をそのまま `findOneAndUpdate` に流すので、`snapshot` / `target` / `targetModel` を **emit の parameters に足せば** 記録経路自体は通る。
- 監査ログ API は `...rest` で snapshot をそのまま応答に含めるため、**Requirement 4 はデータさえ保存されれば自動的にほぼ満たされる**（残るは OpenAPI ドキュメント更新と型）。

---

## 2. 要件 → 資産マップ（Requirement-to-Asset Map）

| 要件 | 使える既存資産 | 差分（Missing / Unknown / Constraint） |
|------|---------------|------|
| **R1**: snapshot を action ベース判別可能ユニオン化 | `ISnapshot`（742行）、`action` フィールドは既に必須 | **Constraint**: TS 型だけ変えても不十分。`snapshotSchema`（model 43-45行）は username しか宣言しておらず、Mongoose の既定（strict）で**未宣言フィールドを黙って捨てる**。型と Mongoose サブスキーマの両方を直す必要がある（後述 §3-1） |
| **R2**: 直接削除時に snapshot 記録 | api.remove に削除対象 `attachment` の doc が残っている（originalName/fileSize/page が読める）。emit→updateByParameters の経路 | **Missing**: emit が snapshot を渡していない。**Unknown**: `pagePath` は attachment に無く `page`（ObjectId）のみ → Page を引く必要（直接削除時はページが存命なので lookup 可能） |
| **R3**: カスケード削除時に添付ごとの activity 記録 | `removeAllAttachments(attachments)` は削除前の doc 配列を持つ。`deleteCompletelyOperation` は `pageIds`/`pagePaths` も持つ | **Constraint（最重要）**: 添付ごとに activity を新規作成すると複合 **unique index `{ user, target, action, createdAt }`** に衝突（E11000）。`targetModel` enum に `Attachment` が無く target を添付にできない（後述 §3-2）。**Unknown**: ゴミ箱を空にする経路が同じ `deleteCompletelyOperation` を通るか要確認 |
| **R4**: 監査ログ API で snapshot 参照 | `...rest` で snapshot は素通り（302-308行）。OpenAPI に snapshot プロパティ記述あり（75行〜） | **Missing**: OpenAPI スキーマに添付フィールドの記述が無い。lean 取得なので型整合のみ注意 |

---

## 3. 設計フェーズで必ず解く2つの論点（critical）

平易な言葉で先に問題を説明する。フォーマットは後段に置く。

### 論点1: snapshot サブスキーマが新フィールドを黙って捨てる

いま `snapshot` を保存するときに使われる Mongoose のサブスキーマ（`models/activity.ts` 43-45行）は

```ts
const snapshotSchema = new Schema<ISnapshot>({ username: { type: String, index: true } });
```

で、`username` しか定義していない。Mongoose のサブドキュメントは既定で「定義されていないフィールドを保存時に取り除く」ので、`snapshot: { username, originalName, pagePath, pageId, fileSize }` を渡しても、**originalName 以下4つは DB に書かれず消える**。

つまり TypeScript の `ISnapshot` を判別可能ユニオンに直すだけでは、添付の情報は1バイトも保存されない。何が起きるかというと、型の上では「保存したつもり」になり、実際の監査ログには username しか残らない、という気づきにくい不整合になる。

直し方の候補（設計で1つ選ぶ）:
- a) `snapshotSchema` に添付用フィールド（originalName / pagePath / pageId / fileSize）を明示的に足す。型は判別可能ユニオン、スキーマは全 variant のフィールドを許す superset、という素直な対応。既存データ（username のみ）とも後方互換。
- b) snapshot を `Schema.Types.Mixed`（または `{ strict: false }`）にして任意の形を許す。柔軟だが型安全性を失い、R1 の「型で縛る」狙いと逆行する。
- c) action ごとに別サブスキーマを持ち discriminator で切り替える。判別可能ユニオンと最も整合するが、既存ドキュメントとの互換・移行の検討が要る。

### 論点2: カスケードで「添付1件＝activity1件」を作ると unique index に衝突する

`activitySchema` には

```ts
activitySchema.index({ user: 1, target: 1, action: 1, createdAt: 1 }, { unique: true });
```

がある（model 92-100行）。R3 で「カスケード削除される添付ごとに `ACTION_ATTACHMENT_REMOVE` を1件ずつ作る」と、同じページ配下の複数添付は

- `user`（同じ削除実行者）
- `target`（添付を指せない。`targetModel` enum は Page/User/PageBulkExportJob/AuditLogBulkExportJob のみで **Attachment が無い**。さらに添付自体は削除中なので ref が宙に浮く）
- `action`（すべて ATTACHMENT_REMOVE）
- `createdAt`（同一処理内で同じミリ秒に入りうる）

が揃いやすく、**2件目以降が E11000（重複キー）で落ちる**。「1件落ちたら削除処理全体が失敗扱いになる」と、ページ完全削除そのものを壊しかねない。

設計で決めるべきこと（どれを採るかは未確定 = Research Needed）:
- a) **1ページの削除につき添付 activity を1件にまとめ、添付の配列を snapshot に持たせる**。unique index に最も素直に収まる（target=ページ）。ただし snapshot が単一サブドキュメントなので「配列を持つ variant」を型・スキーマで設計する必要がある。
- b) target を使わず（null）、添付ごとに1件作るが、衝突を避けるために index の対象を見直す（例: 添付 activity だけ別扱い）。index 変更は既存全 activity に影響するので慎重さが要る。
- c) target を「ページ」にしつつ添付ごとに1件作り、createdAt 以外の何か（snapshot 内の識別子）で区別 — ただし現 unique index は createdAt までしか見ないので、これ単独では衝突は防げない。index 設計とセットになる。

直接削除（R2）は1リクエスト1更新なので衝突しない。**衝突は R3（カスケードの新規作成）に固有の問題**であることを設計で明確に分けること。

---

## 4. 実装アプローチ（Options A/B/C）

### Option A: 既存資産を最小拡張（推奨ベース）
- R1: `ISnapshot` を判別可能ユニオン化（catch-all = 既存 `{ username? }`）＋ `snapshotSchema` に添付フィールドを追加（論点1-a）。
- R2: `api.remove` の emit に `target`(=page)/`targetModel`/`snapshot` を追加。
- R3: `deleteCompletelyOperation` で「ページ1件につき添付 activity 1件・snapshot に添付配列」（論点2-a）。
- R4: OpenAPI 更新のみ（応答整形は既存の `...rest` を流用）。

**trade-off**: ✅ 新規ファイル最小・既存パターン流用 / ✅ 後方互換 / ❌ `snapshotSchema` と `activity.ts` の型を同時に正しく直さないと「型は通るが保存されない」罠 / ❌ R3 の集約方針を snapshot の型に織り込む必要

### Option B: snapshot を action 別 discriminator スキーマに作り替え（新規寄り）
- 論点1-c を採用し、action ごとの snapshot サブスキーマを discriminator で持つ。
- **trade-off**: ✅ 型と保存が action 単位で厳密に一致 / ✅ 将来 action を足すときの拡張点が明確 / ❌ 既存ドキュメント（username のみ）との互換・移行設計が必要 / ❌ 工数増

### Option C: ハイブリッド（段階導入）
- フェーズ1: Option A の最小変更で「添付削除が追える」状態を先に出す。
- フェーズ2: 型安全化の全面適用（target × targetModel の discriminated union 化、別 PR）を見据えて snapshot を B 方式へ寄せる。
- **trade-off**: ✅ 利用者課題（誰が何を消したか）を早く解消 / ✅ 大きな型変更のリスクを分割 / ❌ 2段階の整合管理が必要

---

## 5. 工数・リスク（Effort / Risk）

| 要件/論点 | Effort | Risk | 一言根拠 |
|----------|--------|------|---------|
| R1 型＋snapshotSchema 拡張 | S | Low | 既存パターン内。ただし「型だけ直す」罠に注意 |
| R2 直接削除の snapshot | S | Low | 削除前 doc が手元にあり、emit に足すだけ。pagePath の lookup のみ追加 |
| R3 カスケードの記録 | M | **Medium-High** | unique index 衝突の回避方針が未確定。index に触れると既存全 activity に波及 |
| R4 API 参照 | S | Low | 応答は素通り。OpenAPI 更新中心 |

全体: **M / Medium**（R3 の index 設計が律速かつ最大リスク）。

---

## 6. 設計フェーズへの申し送り（Recommendations & Research Needed）

**推奨アプローチ**: Option A をベースに、R3 は論点2-a（ページ単位で集約・snapshot に添付配列）から検討を始める。これが現 unique index を変えずに済む唯一の素直な案のため。

**必ず設計で決める判断（key decisions）**:
1. snapshot サブスキーマの拡張方式（論点1: a/b/c）。型と Mongoose スキーマの両方を直すことを設計に明記する。
2. R3 のカスケード記録単位（論点2: 添付ごと vs ページ単位集約）と、それに伴う unique index の扱い。

**確認済み（本ギャップ分析で判明）**:
- ゴミ箱を空にする（`emptyTrashPage`, 2627行）は `deleteMultipleCompletely`（2698行）→ `deleteCompletelyOperation` に収束する。完全削除（`deleteMultipleCompletely` 2422行・`deleteCompletely` 経由）も同じ `deleteCompletelyOperation` を通る。**R3 の2つの受け入れ条件（完全削除・ゴミ箱空）は `deleteCompletelyOperation` の1箇所（`removeAllAttachments` の直前/直後）で同時にカバーできる**見込み。

**Research Needed（design フェーズで確認）**:
- カスケード削除時に `pagePath` をどう得るか（`deleteCompletelyOperation` の `pagePaths`/`pageIds` と attachment.page の対応付け）。Page が同時削除されるため、削除前に解決する順序を設計で固定する。
- `ACTION_ATTACHMENT_REMOVE` は既定（Small グループ）では記録されない。本機能の動作確認・受け入れ試験は `AUDIT_LOG_ACTION_GROUP_SIZE`（Medium 以上）または `AUDIT_LOG_ADDITIONAL_ACTIONS` を設定した前提で行う必要がある（設定変更自体はスコープ外）。
- 既存 activity の後方互換（R1.3 / R4.2）: catch-all variant と snapshotSchema 拡張で破壊的移行が不要であることを設計で確認する。


---

# 設計フェーズ追記（2026-06-29）: 方針確定と Discovery 結果

ギャップ分析の §3 で「設計で必ず解く2つの論点」と「Research Needed」を残した。設計フェーズで追加調査と利用者判断を行い、以下のとおり確定した。ギャップ分析当時の前提（Mongoose のまま・index 変更が必要）から重要な変更があるので、ここを最新版とする。

## D-1. 追加 Discovery で判明した重要事実

ギャップ分析は Mongoose を前提に書いたが、設計フェーズの調査で前提が変わった。

1. **`activities` モデルは既に `schema.prisma` に存在する**（introspect 済み、`apps/app/prisma/schema.prisma` 50-71行）。`snapshot` も `ActivitiesSnapshot` という composite type（16-19行、現状 `username` のみ）として定義済み。ただしアプリ側はまだ Mongoose statics を使っており、Prisma 拡張への移行は未実施。GROWI は Mongoose → Prisma を1モデルずつ漸進移行中（comments / users / external-account が移行済み）。**追記（2026-07-01）**: 本節は設計時点（方針3 決定前）の記録。Prisma 拡張への移行は別スペック `activities-prisma-migration` で完了済み（grep 確認＋実 DB 統合テスト 42 件 green）。
2. **Prisma では `target` はリレーション強制のない緩い `String? @db.ObjectId`**、`targetModel` も自由な `String?`。Mongoose の `refPath` のような整合性強制は無い（`onDelete: NoAction` 相当）。
3. **既存の discriminator パターンはモデルレベル**（`GlobalNotificationSetting`、collection 単位の `Model.discriminator()`）であり、single nested subdocument の discriminator ではない。さらに **Prisma + MongoDB の composite type は union 型を表現できない**（固定 shape のみ）。
4. **`activities` モデルの消費者は 15+ ファイル**で、create/update のほか paginate・aggregate（contribution-graph / user-activities）・`find().sort().cursor()`（監査ログ CSV ストリーム）・TTL index・`findSnapshotUsernamesByUsernameRegexWithTotalCount` など多岐にわたる。利用元には contribution-graph / audit-log-bulk-export / page-bulk-export という今回の機能と無関係の feature が複数含まれる。

## D-2. 確定した方針

### 方針1: snapshot は Option B（action を判別子とする判別可能ユニオン）を採用する（論点1の解決）

ギャップ分析の論点1で挙げた a/b/c のうち、利用者は **Option B（action 別の判別可能ユニオン）** を選択した。ただし Mongoose ネイティブの discriminator は採用しない。理由：

- single nested discriminator は snapshot サブドキュメント内に判別キー（`__t` 等）を保存する必要があり、これは「action を唯一の判別子とし、別フィールドを足さない」という **要件 1.4 の意図に反する**（action と同期させる第2の判別子が増える）。
- 直接削除（R2）は `findOneAndUpdate`（updateByParameters）経由で activity を更新する。Mongoose の nested discriminator は `.save()`/`.create()` では効くが `findOneAndUpdate` 経由では適用が不安定で、直接削除とカスケード（create）で挙動が割れる。
- そもそも移行先の Prisma + MongoDB では composite type に union を表現できない。

→ **判別はドメイン層（TypeScript）で行う**。`action` を判別子とする判別可能ユニオン型と type guard（`isAttachmentRemoveActivity`）＋書き込み口を1本化する型付きビルダーで、action 単位の厳密な型を担保する。永続層（Prisma の `ActivitiesSnapshot` composite type）は全 variant のフィールドを許す superset とし、判別キーは保存しない。これで 1.4 を厳密に満たす。論点1（フィールドが黙って捨てられる）への対応は、Mongoose の `snapshotSchema` ではなく **`schema.prisma` の `ActivitiesSnapshot` に添付フィールドを宣言する**ことに置き換わる（宣言しないと Prisma が保存しないのは Mongoose strict と同じ）。

### 方針2: 添付削除は「添付ごとに1件」。target=添付の \_id で unique index 衝突を回避（論点2の解決・**当初想定より低リスク**）

利用者は「添付ファイルごとに1件」を選択した（AskUserQuestion の回答）。AskUserQuestion 提示時は「unique index の変更が必要・中リスク」と説明したが、設計フェーズの追加調査（D-1 の事実2）で **index を変更せずに実現できる**ことが分かった。

- 添付削除 activity の `target` に **削除対象の添付ファイルの `_id`** を入れ、`targetModel` に新値 **`'Attachment'`** を入れる。
- 複合 unique index `{ userId, target, action, createdAt }` は、target（=添付 \_id）が添付ごとに必ず異なるため、**同一ページ配下の複数添付でも自然に一意**になる。同一ミリ秒・同一ユーザー・同一 action でも衝突しない。
- よって **`@@unique([userId, target, action, createdAt])` は変更不要**。ギャップ分析の論点2-a（ページ単位で配列集約）より、要件の文言「添付ごとに1件」に忠実かつ低リスク。
- Prisma では target にリレーション整合性が無く（事実2）、添付が削除済みでも target に \_id を残すのは問題ない（dangling は Mongoose 時代の refPath と同じ許容）。
- 必要な変更は TypeScript の `SupportedTargetModel` に `MODEL_ATTACHMENT = 'Attachment'` を加えるのみ。`target` カラムの schema.prisma 変更は不要。

直接削除（R2）は従来どおり middleware が先に作った activity を **更新**し、その target を添付 \_id に設定する（1リクエスト1更新で衝突しない）。カスケード（R3）は添付ごとに activity を **新規作成**し、各 target に各添付の \_id を設定する。記録の2経路（更新 vs 新規作成）は維持する。

### 方針3: Prisma 移行は別スペックの前提条件とし、本スペックはその上で機能実装する

利用者判断（AskUserQuestion）により、`activities` モデルの Mongoose → Prisma 全面移行は **独立した別スペックで先に完了させる**。本スペック（activity-log）は移行済みの Prisma モデルを前提に、snapshot ユニオン＋添付ログ＋監査ログ API を実装する。

- 理由: 移行は 15+ ファイル・aggregate・cursor・TTL に及び、無関係 feature も巻き込むため、本機能（R1〜R4）とは独立に動かせる別責務。設計レビューゲートの「独立した責務の継ぎ目が複数見えたらスペックを分割せよ」に該当。
- 効果: モデルを触るのは一度だけ（移行スペック）で二度手間を避けられ、各スペックがレビュー可能なサイズに収まる。
- **追記（2026-07-01）**: `activities-prisma-migration` は完了済み。本スペックが依存する具体的な API（`ActivityExtension` の `createByParameters`/`updateByParameters`/`paginate`/`findSnapshotUsernamesByUsernameRegexWithTotalCount`、offset 統一済みの共有 paginate、composite type への native フィルタ、明示 `_id` の受理）は design.md の Overview に転記済み。移行スペック自体の詳細な設計判断は git 履歴（`.kiro/specs/activities-prisma-migration/` 相当のコミット群）に残る。

## D-3. Synthesis（一般化 / Build-vs-Adopt / 簡素化）

- **一般化**: snapshot を「action → snapshot shape」の写像として設計する。今回は `ACTION_ATTACHMENT_REMOVE` のみ特別 variant を持つが、将来別 action が固有 snapshot を必要としたとき、ユニオンに variant を1つ足し catch-all から外すだけで拡張できる。実装は現要件の範囲（添付削除）に限定し、インターフェース（ユニオン＋ guard＋ビルダー）だけを拡張可能にする。
- **Build vs Adopt**: 判別の仕組みはライブラリを導入せず、TypeScript の判別可能ユニオン＋ type guard という言語標準機能を採用。Mongoose/Prisma の discriminator 機構は方針1の理由で不採用。
- **簡素化**: 当初検討した unique index 変更・配列集約 variant・Mongoose discriminator はいずれも不要になった（target=添付 \_id で解決）。snapshot は単一エントリの平坦な型のままでよく、配列 variant を持たない。

## D-4. 工数・リスク（本スペック分、移行スペックを除く）

| 項目 | Effort | Risk | 根拠 |
|------|--------|------|------|
| R1 snapshot ユニオン型＋ guard＋ビルダー＋composite type 拡張 | S | Low | 言語標準機能＋ schema.prisma へのフィールド追加。後方互換（optional） |
| R2 直接削除の snapshot 記録 | S | Low | 既存 emit に target/targetModel/snapshot を追加。pagePath の lookup のみ |
| R3 カスケードの添付ごと記録 | M | Medium | `deleteCompletelyOperation` に actor 引数を足し、**複数の到達経路**（`deleteCompletely` 直接 / `deleteCompletelyV4` / `deleteMultipleCompletely`、stream 経由の `emptyTrashPage`・`deleteCompletelyRecursivelyMainOperation`）を貫通改修。再帰・ゴミ箱空は user のみ（ip/endpoint なし）。添付ごとに createActivity、index 変更不要で衝突なし。シグネチャ変更が複数呼び出し元に波及するため Low→Medium に修正（design レビュー指摘）。大量カスケード時の件数は要件上スコープ外（Open Question） |
| R4 監査ログ API の snapshot 参照 | S | Low | 応答は `...rest` で素通り。OpenAPI 更新中心 |

全体: **S〜M / Low-Medium**（前提の Prisma 移行は 2026-07-01 に完了済み）。移行スペック自体は別途 L〜XL だったが、こちらも完了済み。

## D-5. 残課題（Open Questions）

- **大量カスケード時の activity 件数**: 再帰的な完全削除で数千の添付があると同数の activity が作られる。要件ではボリューム制御を TBD/スコープ外としているため本スペックでは制御しないが、運用上の注意として design に記載する。
- **username が無い削除経路**: 直接削除・ゴミ箱空・完全削除はいずれも user を持つため username は常に取得できる見込み。万一 user 無しの削除経路があれば `ActivitiesSnapshot.username` を optional にして対応する（本スペックで optional 化しておくと安全）。

---

# 増分（2026-07-10）: ADD/DOWNLOAD capture 拡張の Discovery と Synthesis

対象 requirements: Requirement 5〜8（添付系 action 全般への snapshot capture 拡張）。REMOVE（要件1〜4）は実装完了済み（PR #11393）。本増分はその実装を作り直さず、同じ流儀で ADD と DOWNLOAD へ広げる。Discovery type: **Light（Extension）**。

## I-1. 記録経路の実測（capture 箇所）

| action | capture 箇所 | 記録経路 | pagePath 取得 | username |
|--------|------------|---------|--------------|----------|
| **ADD** | `apps/app/src/server/routes/apiv3/attachment.js` POST `/`（emit L421-423、現状 `{ action }` のみ） | `addActivity` middleware が UNSETTLED を先に作り `emit('update')` で更新（REMOVE 直接削除と同型） | **無コスト**（同ハンドラで `Page.findOne` 済みの `page` doc から `page.path`。追加フェッチ不要） | `loginRequiredStrictly` で確定・常に取得可 |
| **DOWNLOAD** | `apps/app/src/server/routes/attachment/download.ts`（L44-51、現状 snapshot は `{ username }` のみ） | `createActivity` 直接呼び・**fire-and-forget（await していない, L51）** | **要追加フェッチ**（`attachment.page` は ObjectId 参照のみ。アクセス権チェック `Page.isAccessiblePageByViewer` は boolean を返し Page doc を保持しない → `Page.findById` が別途必要） | `loginRequired(crowi, true)` = **guest 許可**のため未認証 DL で欠損しうる |
| REMOVE（済・参考） | `attachment/api.js`（直接）/ `service/page/*`（カスケード） | 直接=emit更新／カスケード=添付ごと create | ルート側で `resolvePagePathForRemovalSnapshot`（`Page.findById`）を実行 | 常に取得可 |

## I-2. 保存経路・型は REMOVE 増分で拡張済み（再利用可）

- `IActivityParameters.snapshot` は既に `ISnapshot` union（`models/activity.ts`）。`createByParameters`（新規作成）は snapshot 4フィールドを明示的に永続化、`updateByParameters`（emit更新）は `buildSnapshotUpdateEnvelope` で `{ update }` 変換し既存 `_id`/username を保持。`settleActivityRecord` は action 固有フィールドをスプレッド保持し username のみ context 補完。→ **ADD の emit・DOWNLOAD の createActivity に snapshot を積めばそのまま保存される**。
- Prisma composite `ActivitiesSnapshot` は既に `originalName/pagePath/pageId/fileSize` を保持（REMOVE 増分 task 1.2）。**ADD/DOWNLOAD は同じフィールドなので schema.prisma 変更は不要**。
- `MODEL_ATTACHMENT = 'Attachment'` は `SupportedTargetModel` に登録済み。REMOVE と同じく target=添付 `_id`／targetModel=`Attachment` を使える。

## I-3. Synthesis（一般化 / Build-vs-Adopt / 簡素化）

- **一般化**: ADD/DOWNLOAD/REMOVE の snapshot は `originalName/pagePath/pageId/fileSize(+username)` で**完全に同一形**であり、添付識別子はいずれも snapshot 外（`target`/`targetModel`）に置く既存流儀に揃う。→ 3つの別々な型を作らず、**単一の正準型 `AttachmentSnapshot`** を共有し、action 別の narrowing は type guard 群で行う。`AttachmentRemoveSnapshot` は後方互換のため `AttachmentSnapshot` の別名として残す（viewer が import 済み）。要件5の「action 別 variant＋guard」は、guard を action 単位で提供することで満たす（型の実体を共有するのは HOW の判断）。
- **Build vs Adopt**: 新ライブラリを入れない。REMOVE の純粋関数 builder（`buildAttachmentRemoveSnapshot`）とルート側 pagePath resolver（`resolvePagePathForRemovalSnapshot`）という既存パターンを一般化して再利用する。
- **簡素化**: schema.prisma 変更なし・保存経路の新設なし・判別ユニオンへのフィールド追加なし（形が同一のため）。新規ロジックは「共有 builder＋pagePath resolver の抽出」と「2ルートへの capture 差し込み」に収束する。

## I-4. 確定した設計判断（key decisions）

### 決定1: DOWNLOAD は option a（pagePath も DB 引き当てで記録）。ただし記録は非ブロッキング経路に載せる

利用者判断（AskUserQuestion）で **option a**（DOWNLOAD でも pagePath を引き当てる）を採用。あわせて「実装箇所の**モジュール凝集度・責務分離**に注意（汚いコードにしない）」という制約が付いた。これを次の2点で担保する:

1. **pagePath 解決を単一の共有関数に集約**する。REMOVE がルート内に持つ `resolvePagePathForRemovalSnapshot`（page ref → `Page.findById` → path、失敗時 warn＋undefined）を、activity service 層の共有関数 `resolveAttachmentPagePath` として切り出し、DOWNLOAD が再利用する（REMOVE も behavior-preserving に採用可）。pagePath 解決の実装を2箇所に重複させない。
2. **ホットパスにブロッキングを足さない**。DOWNLOAD の記録は既に fire-and-forget。pagePath の追加 `Page.findById` は**この detached（非同期・await しない）記録クロージャの内側**で行う。→ ダウンロード応答のレイテンシは増えない。増えるのは「ダウンロードごとの非同期 DB 読み1回」の負荷のみで、これは option a の受容済みコスト。記録経路の失敗（lookup 失敗・記録失敗）はダウンロード応答を壊さない（要件7.4、best-effort 維持）。

### 決定2: ルートハンドラは薄く保ち、snapshot 構築は凝集モジュールへ委譲

- ADD ルート・DOWNLOAD ルートに `Page.findById` やオブジェクト手組みを直書きしない。snapshot 構築（＋DOWNLOAD の pagePath 解決）は `service/activity/attachment-snapshot.ts`（新規・共有）の関数に委譲し、ルートは「手元のデータを渡して結果を emit/record するだけ」にする。
- 純粋 builder（`buildAttachmentSnapshot`）は Page を引かず引数の pagePath を受けるだけ、という REMOVE の分離（「データ解決」と「snapshot 組み立て」を分ける）を維持する。DOWNLOAD 用は「解決＋組み立て」をまとめる薄い async ラッパ（`buildAttachmentDownloadSnapshot`）を同モジュールに置く。

### 決定3: DOWNLOAD の createActivity 呼び出しは型付き parameters を渡す

現状の `download.ts` の `createActivity` 呼び出し先 parameters は実質未型付け（`any` 相当）。本増分では snapshot を型付き builder（`AttachmentSnapshot` を返す）経由で構築し、`IActivityParameters` の形で渡すことで、呼び出し口が緩くても最終的に `createByParameters` の型で検査される状態にする（`any` を新たに増やさない）。

## I-5. Open Questions / Risks（増分）

- **DOWNLOAD の unique index 衝突（軽微）**: 複合 unique `{ userId, target, action, createdAt }`。同一ユーザーが同一添付を同一ミリ秒に二重ダウンロードした場合のみ衝突しうる。target に添付 `_id` を入れることで従来（target 無し）より**衝突しにくくなる**。衝突時は fire-and-forget の best-effort で握りつぶす（ダウンロードは成功）。
- **guest DOWNLOAD**: username は optional で欠損吸収（要件7.2）。target=添付 `_id` は guest でも記録できる。
- **記録ゲート依存**: ADD/DOWNLOAD は `MediumActionGroup`。既定 Small では記録されない。動作確認・結合テストは REMOVE と同じく `AUDIT_LOG_ACTION_GROUP_SIZE`（Medium 以上）を明示注入した前提で行う（ゲート設定自体は `activity-log` spec 管轄）。
