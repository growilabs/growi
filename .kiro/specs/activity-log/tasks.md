# Implementation Plan

> **方式**: lazy fail-safe（Option C）。事前作成（`add-activity` middleware / ページ復元フロー）を**廃止**し、記録対象内と確定した操作だけを settle 時に**作成**、記録対象外は何も作らない。失敗・中断（エラー応答 4xx/5xx・クライアント中断）した操作だけ、リクエスト終了時の finalizer が `ACTION_UNSETTLED` の試行記録を作る。プロセス即時終了時の試行記録は対象外（要件 4.4）。
>
> **設計の要**: 事前作成は「文脈（IP・エンドポイント・操作者・**到着時刻**）と後から確定する action の合流点」も兼ねていた。廃止に伴い、`activityId → 文脈` のプロセスローカルマップで突き合わせを行う（要件 2.6）。settle リスナーは `req`/`res` を持たないため、文脈はマップから同期 `take` してから create に混ぜる。採番＋stash は共有ヘルパ `beginActivity` に集約（middleware と復元フローが共用）、失敗判定＋`res` 配線＋map の掃除は `registerFailsafeFinalizer` に分離（middleware から追い出す）。マップの掃除は**イベント駆動で確定的**（`res` の close/finish・実測で検証済み）に行い、time-based TTL や最古 eviction は使わない（数分かかる処理でも in-flight を落とさない）。記録行の `createdAt` は settle/finalizer 時刻でなく**到着時刻**を保つ。二重作成防止は事前 read せず duplicate-key 吸収で行う。
>
> **依存**: 保存口＋文脈マップ＋`beginActivity`（基盤）→ settle 抽出／`recordFailsafeAttempt`・`registerFailsafeFinalizer` 抽出 → middleware 組み替え → リスナー組み替え → 復元フロー → 結合検証、の順。後段が前段の成果物を import・呼び出しする。
>
> **進め方**: TDD（RED→GREEN）。記録ゲートの中核（対象外の行が実際に作られない／試行記録が実際に残る／記録行が IP・エンドポイントを保持する）は、モック単体でなく **実 DB（レプリカセット rs0）を読み直す結合試験**で合否を判定する。結合試験の設定（記録対象/対象外・`auditLogEnabled`）は明示注入し、`process.env` を直接書き換えない。テスト分離は per-worker。型安全モック（型アサーションを避け `mock<T>()`）。

- [ ] 1. 採番 id での作成に対応し、文脈マップを新設（基盤）
- [x] 1.1 `createByParameters` を採番 id で作成できるようにする
  - `IActivityParameters` に `id?: string` を追加し、呼び出し側が採番した ObjectId 文字列で行を作れるようにする（`_id` で渡された場合は `id` にマップ）。Prisma unchecked create は明示 id を通すため、型の追加とマッピングが主変更。スキーマ変更はしない。
  - `createdAt?: Date` は `IActivityParameters` が既に受け付ける（Issue 3＝到着時刻の保持に model 変更は不要）。この事実を確認するにとどめる。
  - RED→GREEN: integ で「採番した id を渡して作成 → その id で読み直せる」「id 未指定なら従来どおり自動採番」を実 DB で確認する。
  - Observable: 採番 id 指定の作成がグリーンで、指定した id の行が実 DB に存在する。
  - _Requirements: 1.2, 2.6, 4.1_
  - _Boundary: ActivityExtension.createByParameters_

- [x] 1.2 `activityId → リクエスト文脈` のプロセスローカルマップを新設
  - `service/activity/pending-activity-context.ts` を作り、`set(id, ctx)` / `take(id)`（get+delete・同期）/ `clear(id)` を提供する。文脈は `{ ip, endpoint, userId, username, createdAt }`（`createdAt` は到着時刻＝Issue 3）。バレル `service/activity`（`index.ts`）に re-export を追加する。
  - 掃除はイベント駆動のみ（呼び出し側の `take`／`clear`）で、**time-based TTL 掃引や最古 eviction のような live エントリを消す機構は持たせない**（数分かかる in-flight を落とさない・要件 2.6 非回帰）。
  - RED→GREEN: unit で「`set`→`take` で文脈（`createdAt` 含む）が返り `take` 後は空」「存在しない id の `take` は undefined」「`clear` は冪等」を確認する。
  - Observable: マップの unit テストがグリーンで、`take` の get+delete 同期性が保証される。かつバレル経由で import できる。
  - _Requirements: 2.6_
  - _Boundary: pendingActivityContext（service/activity/pending-activity-context.ts, service/activity/index.ts）_

- [x] 1.3 `beginActivity` 共有ヘルパを新設
  - `service/activity/begin-activity.ts` を作り、`beginActivity(context)` が `new Types.ObjectId().toString()` で id を採番し `pendingActivityContext.set(id, context)` して `{ activityId }` を返すようにする。middleware と復元フローが共用し、採番＋stash を重複実装させない（要件 3.3）。バレルに re-export を追加する。
  - RED→GREEN: unit で「呼ぶと採番 id を返し、その id で `take` すると渡した文脈が返る」を確認する。
  - Observable: `beginActivity` の unit がグリーンで、採番 id と stash が期待どおり。
  - _Requirements: 2.6_
  - _Boundary: beginActivity（service/activity/begin-activity.ts, service/activity/index.ts）_
  - _Depends: 1.2_

- [x] 2. 記録ライフサイクルを確定する `settleActivityRecord` を抽出
  - 記録可否の判断結果 `shouldPersist`（真偽）と、リスナーがマップから取り出した**文脈**・emit パラメータを**引数で受け取り**、真なら採番 id ＋文脈＋action をマージして作成の保存口を呼び、偽なら `null` を返して何もしない薄い純関数にする。戻り値は activity（対象内かつ作成成功）または null（対象外／作成失敗）。
  - 記録可否の判断を内部で行わない（単一情報源 `getAvailableActions`/`shoudUpdateActivity` を複製しない）。貢献度・通知・snapshot・ルート固有ペイロード・マップ取得に依存しない（文脈は引数で受領）。
  - バレルに re-export を追加する。
  - RED→GREEN: unit で「`shouldPersist=false` → 作成口を呼ばず null を返す」「`shouldPersist=true` → 採番 id ＋文脈（`createdAt` 含む）＋action をマージした引数で作成口を呼び activity を返す」を確認する。作成口は型安全にモックする（`mock<T>()`）。
  - Observable: `settleActivityRecord` の unit テストがグリーンで、両分岐の呼び分け・戻り値・文脈マージ（`createdAt` が到着時刻として渡る）が期待どおり。
  - _Requirements: 1.1, 1.2, 2.6, 3.1, 3.2_
  - _Boundary: settleActivityRecord（service/activity/settle-activity-record.ts, service/activity/index.ts）_
  - _Depends: 1.1, 1.2_

- [ ] 3. 失敗・中断時の記録経路（`recordFailsafeAttempt` ＋ `registerFailsafeFinalizer`）を新設

- [x] 3.1 `recordFailsafeAttempt` を新設（事前 read なし・duplicate-key 吸収）
  - 採番済み id・文脈（`createdAt` 含む）を受け取り、`ACTION_UNSETTLED` を採番 id 指定で1件作る。**事前 read はしない**: settle が既に作っていれば主キー重複で create が弾かれるので、duplicate-key を良性として握りつぶすことで二重作成を防ぐ（Issue 1・失敗経路に read を足さない）。duplicate-key 以外の作成失敗は例外を投げず logger.error（best-effort）。バレルに re-export を追加する。
  - RED→GREEN: unit/integ で「未作成の id → UNSETTLED を1件作る」「settle 済みの id → duplicate-key を握りつぶし二重作成しない」「作成失敗しても throw しない」「`findFirst` 等の事前存在確認を呼ばない」を確認する。
  - Observable: `recordFailsafeAttempt` のテストがグリーンで、1件作成・二重作成なし・例外を投げない・事前 read を発行しない。
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: recordFailsafeAttempt（service/activity/record-failsafe-attempt.ts, service/activity/index.ts）_
  - _Depends: 1.1_

- [x] 3.2 `registerFailsafeFinalizer` を新設（失敗判定＋res 配線＋掃除の分離）
  - `service/activity/register-failsafe-finalizer.ts` を作り、`registerFailsafeFinalizer(res, activityId, context)` が `res.on('finish')`（`statusCode >= 400`）と `res.on('close')`（`writableFinished === false`＝真の中断）で `recordFailsafeAttempt` を呼び、どちらのイベントでも最後に `pendingActivityContext.clear(activityId)` するようにする。失敗判定ロジックはここが唯一の持ち主にする（middleware に持たせない）。バレルに re-export を追加する。
  - RED→GREEN: unit で「status>=400 の finish → `recordFailsafeAttempt` を呼ぶ」「status<400 の finish → 呼ばない」「`writableFinished=false` の close → 呼ぶ」「正常完了 → 呼ばない」「全経路で `clear` が呼ばれる」を確認する（`res` は fake の EventEmitter、`recordFailsafeAttempt`/`clear` は型安全モック）。
  - Observable: `registerFailsafeFinalizer` の unit がグリーンで、失敗・中断時のみ試行記録を呼び、全経路で clear する。
  - _Requirements: 4.1_
  - _Boundary: registerFailsafeFinalizer（service/activity/register-failsafe-finalizer.ts, service/activity/index.ts）_
  - _Depends: 1.2, 3.1_

- [x] 4. `add-activity` middleware を「事前作成廃止」の薄いアダプタに組み替え
  - 非 GET で DB に書かない。文脈 `{ ip: req.ip, endpoint: req.originalUrl, userId: req.user?._id, username: req.user?.username, createdAt: new Date() }`（`createdAt`＝到着時刻・Issue 3）を1つ組み立て、`beginActivity(context)` で id 採番＋stash、`res.locals.activity = { _id: activityId }`（37 箇所の emit と `getIdStringForRef` を無改修で温存）、`registerFailsafeFinalizer(res, activityId, context)` を呼ぶ。失敗判定と `res` 配線は middleware に持たせない（`registerFailsafeFinalizer` の責務）。
  - RED→GREEN: 既存 `add-activity.spec.ts` の「無条件に create する」契約を「**DB に書かず・`beginActivity` で採番 id を `res.locals.activity._id` に格納・文脈（createdAt 含む）を stash・`registerFailsafeFinalizer` を呼ぶ**」へ改訂する（失敗判定の網羅は 3.2 のテストで担保し、ここでは重複させない）。
  - Observable: 改訂した `add-activity.spec.ts` がグリーン（DB 書き込みなし・`res.locals.activity._id` に採番 id・マップに文脈・`registerFailsafeFinalizer` が呼ばれる）。
  - _Requirements: 2.6, 4.1_
  - _Boundary: add-activity middleware_
  - _Depends: 1.3, 3.2_

- [x] 5. `update` リスナーを lazy fail-safe に組み替え
  - 「`activityId` の文脈をマップから**同期 take**（await より前）→ `contributor` 分離 → 貢献度を先行処理（不変）→ `shouldPersist` を単一情報源で算出 → `settleActivityRecord` に文脈と結果を渡して委譲 → 戻り値が非 null のときだけ従来どおり `updated` を emit（`generatePreNotify` 有無の分岐も保存）」の順に組む。
  - 対象内分岐を現行の「更新」から「作成」に変える。対象外分岐は何もしない（残す行がない）。settle 呼び出しをエラー境界（try/catch＋`logger.error`）で囲み、記録の失敗がリクエスト本体を止めないようにする。
  - RED→GREEN: 既存 `activity.spec.ts` の「対象外 → 更新しない・`updated` を emit しない」契約を「**対象外 → 作成口を呼ばない・行を作らない・`updated` を emit しない**」に改訂する。essential では文脈 take ＋作成＋`updated` emit、貢献度の先行処理が保存されることも確認する。
  - Observable: 改訂した `activity.spec.ts` がグリーン（対象外で作成口非呼び出し＋`updated` 非 emit、essential で文脈 take＋作成＋`updated` emit、貢献度先行が保存）。
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.3, 2.4, 2.6, 3.3_
  - _Boundary: ActivityService update listener_
  - _Depends: 2_

- [ ] 6. 復元フロー（`revertDeletedPage`）の自前 pre-create を畳む
  - 現行の自前 `createByParameters(ACTION_UNSETTLED)`（L2830 付近）を廃止し、`beginActivity(context)`（文脈は ip/endpoint/user/username＋到着時刻 createdAt）で id 採番＋stash、その id で `emit('update', ...)`（L2847 / 2912 / 2990）に変える。`revertRecursivelyMainOperation` へは `activity` オブジェクトでなく id 文字列を渡す。
  - 掃除は `res` finalizer を持たないので、**emit を含む async スコープの error ハンドラでのみ `pendingActivityContext.clear(activityId)`**（emit 前 throw の孤児を確定的に消す。同期 emit 経路と、切り離し実行される再帰経路の catch の両方に置く）。emit が飛べば listener の同期 `take` が消すので正常時は何もしない。
  - 復元 action は essential かつ contribution action なので常に対象内で settle 作成される（②にならない）。特別扱いは足さない（要件 3.3）。
  - RED→GREEN: 既存の復元系テスト（`service/page/*-cascade-activity.integ.ts` 等）で、自前 pre-create を畳んでも実 action の行が作られ、通知・貢献度が従来どおりであること、および emit 前 throw で map エントリが残らないことを確認する。
  - Observable: 復元系テストがグリーンで、事前作成を畳んでも復元行が実 action として作られ、二重作成が起きず、emit 前 throw でも孤児が残らない。
  - _Requirements: 1.2, 3.3_
  - _Boundary: revertDeletedPage（service/page/index.ts）_
  - _Depends: 5, 1.3_

- [ ] 7. 記録ゲート挙動の結合検証（本 spec の受け入れ条件）
  - 実 DB を読み直す結合試験で記録ゲートの中核挙動と非回帰を確認する。設定は明示注入（`process.env` を直接書き換えない）、per-worker 分離。
  - 7.1–7.4 は共有セットアップ（per-worker DB・設定注入ヘルパ）のため**同一の integ ファイル**に置き、並列（P）にはしない。観察成果物は各子タスクが持つ。

- [ ] 7.1 対象外は作らない／対象内・essential は作る、を実 DB で検証
  - 非 GET・対象外 action を settle → その id の行が `activities` に**存在しない**ことを実 DB の読み直しで確認する（②が作られない＝write なし。R1.1 の権威ある証拠）。
  - 非 GET・対象内 action を settle → 実 action の行が永続化されることを確認する。
  - `auditLogEnabled=false` → essential のみ作成、非 essential は作られないことを確認する。
  - Observable: 対象外 id の行が DB に無く、対象内・essential の行が作られることを読み直しで確認できる。
  - _Requirements: 1.1, 1.2, 2.1, 2.2_
  - _Boundary: ActivityService 記録ゲート結合試験（同一 integ ファイル・並列不可）_
  - _Depends: 5_

- [ ] 7.2 記録行が操作文脈（IP・エンドポイント・操作者・到着時刻）を保持することを検証
  - 非 GET・対象内 action を settle → 作成された行が、middleware が焼き付けていた IP・エンドポイント・操作者・操作者名を従来どおり保持し、かつ `createdAt` が settle 時刻でなく**リクエスト到着時刻**であることを実 DB の読み直しで確認する（事前作成廃止で欠損・時刻ずれを起こさない。R2.6／Issue 3 の権威ある証拠）。
  - Observable: 作成行の ip / endpoint / user / snapshot.username が期待値どおりで、`createdAt` が到着時刻に一致する。
  - _Requirements: 2.6_
  - _Boundary: ActivityService 記録ゲート結合試験（同一 integ ファイル・並列不可）_
  - _Depends: 5_

- [ ] 7.3 fail-safe（試行記録）の保持・②との区別・掃除の確定性を実 DB で検証
  - 非 GET・ルートがエラー応答（status>=400）で終了 → 当該 id の `ACTION_UNSETTLED` 行が実 DB に残ることを確認する（`registerFailsafeFinalizer` → `recordFailsafeAttempt` が試行記録を作成。R4.1 の権威ある証拠）。成功完了（status<400）では残らないことも確認する。
  - クライアント中断（`writableFinished=false` の close）→ `ACTION_UNSETTLED` 行が残ることを確認する。
  - 対象外だった②の行は作られない一方、失敗・中断の UNSETTLED は残る、という差（R4.2/4.3 の区別）を確認する。
  - **掃除の確定性（長時間処理）**: 応答までに遅延のある対象内リクエストでも、settle 時に作成される行が文脈（ip/endpoint/user/`createdAt`）を保持することを確認する（＝処理中に pending エントリが誤って掃除されない・time-based sweep を持たないことの回帰防止・要件 2.6）。
  - Observable: 失敗・中断時に `ACTION_UNSETTLED` 行が実 DB に残り、成功時・対象外時には残らない差が確認でき、遅延処理でも作成行の文脈が欠けない。
  - _Requirements: 4.1, 4.2, 4.3, 2.6_
  - _Boundary: ActivityService 記録ゲート結合試験（同一 integ ファイル・並列不可）_
  - _Depends: 4, 5_

- [ ] 7.4 既存挙動の非回帰を検証（貢献度・GET 経路・グループ構成）
  - 貢献度 action（例: `ACTION_PAGE_CREATE`）で、変更前後の貢献度集計が不変であることを確認する（別コレクション・行の存在に非依存・contribution は settle 前に先行）。
  - GET 経路の記録挙動（対象のみ作成）が変わっていないことを確認する（`createActivity` を無改修）。
  - action グループ／essential の構成が変わっていないことを確認する（`interfaces/activity.ts` を無改修）。
  - Observable: 貢献度・GET 経路・グループ構成の各テストがグリーンで、本変更による差分が出ない。
  - _Requirements: 1.3, 2.4, 2.5_
  - _Boundary: ActivityService 記録ゲート結合試験（同一 integ ファイル・並列不可）_
  - _Depends: 5_

## Implementation Notes

- 1.1: この worktree のローカル Prisma 生成クライアント（`src/generated/prisma`・gitignore 済み）が schema.prisma より古いと、無関係の integ テストまで失敗する。integ 実行前に `pnpm run prisma:generate` で再生成すると解消（tracked 差分なし）。
- 1.2: `service/activity.ts`（ActivityService 本体）がディレクトリを覆い隠すため、素の `~/server/service/activity` はバレルに解決されない。バレル（`pendingActivityContext` 等）を import する側は `~/server/service/activity/index` か相対 `./index` を使うこと（design.md L541 の表記どおりには書けない）。
- 2: 文脈は `createByParameters` が実際に消費する形へ**マッピング**して渡す（design 擬似コードの raw spread `{...context}` は不可）。操作者 id は `user`（→ `normalizeToId(user)` で `data.userId` を算出。top-level `userId` は無視される）、操作者名は `snapshot.username`（`activities` に top-level `username` 列は無く、stray な top-level `username` は Prisma create が Unknown argument で throw する）、到着時刻は `createdAt`。middleware（Task 4）・復元フロー（Task 6）で文脈を組み立てる際も、この「userId/username を top-level で持つ context」→「user/snapshot.username で作成」の対応を守ること。
- 2→5: `createByParameters` は `include: { user: true }` を付けない＝返り値に `user` リレーションが populate されない（`updateByParameters` は付ける・Key Decision 5）。通知経路 `toGeneratePreNotifyActivity`（service/activity.ts）/`generatePreNotify`（pre-notify.ts）は `activity.user` を読んで操作者を通知対象から除外する（null なら除外せず＝クラッシュはしないが操作者が自分の操作通知を受ける挙動差）。Task 5 で settle の作成行をそのまま通知に渡すと `user` 欠落で要件 2.3 の挙動差になる。listener が保持する `context.userId` から `user` を付与する等で補い、7.x（または 5 のテスト）で「操作者が自分の操作通知から除外される」ことを検証すること。**（Task 5 で解決済み: listener が `toGeneratePreNotifyActivity(activity, context?.userId)` で actor id を notify 経路にだけ補填し、`updated` には原型を emit。配線は activity.spec.ts の「actor-exclusion wiring」テストで検証。pre-notify.ts の除外ロジック自体は不変。）**
- 3.1: 採番 id の主キー重複は Prisma の `P2002`（constraint 名 `_id_`・実 DB で確認済み）で surface する。dup-key の良性握りつぶし判定は `err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'`（`Prisma` は `~/generated/prisma/client` から import）。復元フロー等で同種の二重作成を吸収する場合も同じ判定を使う。
