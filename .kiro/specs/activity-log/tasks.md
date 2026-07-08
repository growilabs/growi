# Implementation Plan

> **方式**: lazy fail-safe（Option C）。事前作成（`add-activity` middleware / ページ復元フロー）を**廃止**し、記録対象内と確定した操作だけを settle 時に**作成**、記録対象外は何も作らない。失敗・中断（エラー応答 4xx/5xx・クライアント中断）した操作だけ、リクエスト終了時の finalizer が `ACTION_UNSETTLED` の試行記録を作る。プロセス即時終了時の試行記録は対象外（要件 4.4）。
>
> **設計の要**: 事前作成は「文脈（IP・エンドポイント・操作者）と後から確定する action の合流点」も兼ねていた。廃止に伴い、`activityId → 文脈` のプロセスローカルマップで突き合わせを行う（要件 2.6）。settle リスナーは `req`/`res` を持たないため、文脈はマップから同期 `take` してから create に混ぜる。
>
> **依存**: 保存口＋文脈マップ（基盤）→ settle 抽出／failsafe 抽出 → middleware 組み替え → リスナー組み替え → 復元フロー → 結合検証、の順。後段が前段の成果物を import・呼び出しする。
>
> **進め方**: TDD（RED→GREEN）。記録ゲートの中核（対象外の行が実際に作られない／試行記録が実際に残る／記録行が IP・エンドポイントを保持する）は、モック単体でなく **実 DB（レプリカセット rs0）を読み直す結合試験**で合否を判定する。結合試験の設定（記録対象/対象外・`auditLogEnabled`）は明示注入し、`process.env` を直接書き換えない。テスト分離は per-worker。型安全モック（型アサーションを避け `mock<T>()`）。

- [ ] 1. 採番 id での作成に対応し、文脈マップを新設（基盤）
- [ ] 1.1 `createByParameters` を採番 id で作成できるようにする
  - `IActivityParameters` に `id?: string` を追加し、呼び出し側が採番した ObjectId 文字列で行を作れるようにする（`_id` で渡された場合は `id` にマップ）。Prisma unchecked create は明示 id を通すため、型の追加とマッピングが主変更。スキーマ変更はしない。
  - RED→GREEN: integ で「採番した id を渡して作成 → その id で読み直せる」「id 未指定なら従来どおり自動採番」を実 DB で確認する。
  - Observable: 採番 id 指定の作成がグリーンで、指定した id の行が実 DB に存在する。
  - _Requirements: 1.2, 2.6, 4.1_
  - _Boundary: ActivityExtension.createByParameters_

- [ ] 1.2 `activityId → リクエスト文脈` のプロセスローカルマップを新設
  - `service/activity/pending-activity-context.ts` を作り、`set(id, ctx)` / `take(id)`（get+delete・同期）/ `clear(id)` を提供する。文脈は `{ ip, endpoint, userId, username }`。バレル `service/activity`（`index.ts`）に re-export を追加する。
  - RED→GREEN: unit で「`set`→`take` で文脈が返り `take` 後は空」「存在しない id の `take` は undefined」「`clear` は冪等」を確認する。
  - Observable: マップの unit テストがグリーンで、`take` の get+delete 同期性が保証される。かつバレル経由で import できる。
  - _Requirements: 2.6_
  - _Boundary: pendingActivityContext（service/activity/pending-activity-context.ts, service/activity/index.ts）_

- [ ] 2. 記録ライフサイクルを確定する `settleActivityRecord` を抽出
  - 記録可否の判断結果 `shouldPersist`（真偽）と、リスナーがマップから取り出した**文脈**・emit パラメータを**引数で受け取り**、真なら採番 id ＋文脈＋action をマージして作成の保存口を呼び、偽なら `null` を返して何もしない薄い純関数にする。戻り値は activity（対象内かつ作成成功）または null（対象外／作成失敗）。
  - 記録可否の判断を内部で行わない（単一情報源 `getAvailableActions`/`shoudUpdateActivity` を複製しない）。貢献度・通知・snapshot・ルート固有ペイロード・マップ取得に依存しない（文脈は引数で受領）。
  - バレルに re-export を追加する。
  - RED→GREEN: unit で「`shouldPersist=false` → 作成口を呼ばず null を返す」「`shouldPersist=true` → 採番 id ＋文脈＋action をマージした引数で作成口を呼び activity を返す」を確認する。作成口は型安全にモックする（`mock<T>()`）。
  - Observable: `settleActivityRecord` の unit テストがグリーンで、両分岐の呼び分け・戻り値・文脈マージが期待どおり。
  - _Requirements: 1.1, 1.2, 2.6, 3.1, 3.2_
  - _Boundary: settleActivityRecord（service/activity/settle-activity-record.ts, service/activity/index.ts）_
  - _Depends: 1.1, 1.2_

- [ ] 3. 失敗・中断時の試行記録 `recordFailsafeAttempt` を新設
  - 採番済み id・文脈を受け取り、その id の行が**未作成**なら `ACTION_UNSETTLED` を1件作る。既に settle が作っていれば作らない（id で DB 探索、かつ duplicate-key を良性として握りつぶす＝二重作成防止）。作成失敗は例外を投げず logger.error（best-effort）。
  - バレルに re-export を追加する。
  - RED→GREEN: unit/integ で「未作成の id → UNSETTLED を1件作る」「作成済みの id → 作らない」「作成失敗しても throw しない」を確認する。
  - Observable: `recordFailsafeAttempt` のテストがグリーンで、未作成時のみ1件作成・二重作成なし・例外を投げない。
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: recordFailsafeAttempt（service/activity/record-failsafe-attempt.ts, service/activity/index.ts）_
  - _Depends: 1.1_

- [ ] 4. `add-activity` middleware を「事前作成廃止」に組み替え
  - 非 GET で DB に書かず、`new Types.ObjectId().toString()` で id を採番し `res.locals.activity = { _id }` に格納する（37 箇所の emit と `getIdStringForRef` を無改修で温存）。同 id で文脈（`req.ip` / `req.originalUrl` / `req.user?._id` / `req.user?.username`）をマップに `set` する。
  - `res.on('finish')`（`res.statusCode >= 400`）と `res.on('close')`（`res.writableFinished === false`＝真の中断）に finalizer を登録し `recordFailsafeAttempt(activityId, 文脈)` を呼ぶ。どの分岐でも最後にマップエントリを `clear` する。
  - RED→GREEN: 既存 `add-activity.spec.ts` の「無条件に create する」契約を「**DB に書かず・id を採番して `res.locals.activity._id` に格納・文脈を set・finalizer を登録する**」へ改訂する。
  - Observable: 改訂した `add-activity.spec.ts` がグリーン（DB 書き込みなし・`res.locals.activity._id` に採番 id・マップに文脈・`res` に finish/close ハンドラ）。
  - _Requirements: 2.6, 4.1_
  - _Boundary: add-activity middleware_
  - _Depends: 1.2, 3_

- [ ] 5. `update` リスナーを lazy fail-safe に組み替え
  - 「`activityId` の文脈をマップから**同期 take**（await より前）→ `contributor` 分離 → 貢献度を先行処理（不変）→ `shouldPersist` を単一情報源で算出 → `settleActivityRecord` に文脈と結果を渡して委譲 → 戻り値が非 null のときだけ従来どおり `updated` を emit（`generatePreNotify` 有無の分岐も保存）」の順に組む。
  - 対象内分岐を現行の「更新」から「作成」に変える。対象外分岐は何もしない（残す行がない）。settle 呼び出しをエラー境界（try/catch＋`logger.error`）で囲み、記録の失敗がリクエスト本体を止めないようにする。
  - RED→GREEN: 既存 `activity.spec.ts` の「対象外 → 更新しない・`updated` を emit しない」契約を「**対象外 → 作成口を呼ばない・行を作らない・`updated` を emit しない**」に改訂する。essential では文脈 take ＋作成＋`updated` emit、貢献度の先行処理が保存されることも確認する。
  - Observable: 改訂した `activity.spec.ts` がグリーン（対象外で作成口非呼び出し＋`updated` 非 emit、essential で文脈 take＋作成＋`updated` emit、貢献度先行が保存）。
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.3, 2.4, 2.6, 3.3_
  - _Boundary: ActivityService update listener_
  - _Depends: 2_

- [ ] 6. 復元フロー（`revertDeletedPage`）の自前 pre-create を畳む
  - 現行の自前 `createByParameters(ACTION_UNSETTLED)`（L2830 付近）を廃止し、`new Types.ObjectId().toString()` で id を採番、文脈をマップに `set`、その id で `emit('update', ...)`（L2847 / 2912 / 2990）に変える。`revertRecursivelyMainOperation` へは `activity` オブジェクトでなく id 文字列を渡す。
  - 復元 action は essential かつ contribution action なので常に対象内で settle 作成される（②にならない）。特別扱いは足さない（要件 3.3）。
  - RED→GREEN: 既存の復元系テスト（`service/page/*-cascade-activity.integ.ts` 等）で、自前 pre-create を畳んでも実 action の行が作られ、通知・貢献度が従来どおりであることを確認する。
  - Observable: 復元系テストがグリーンで、事前作成を畳んでも復元行が実 action として作られ、二重作成が起きない。
  - _Requirements: 1.2, 3.3_
  - _Boundary: revertDeletedPage（service/page/index.ts）_
  - _Depends: 5_

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

- [ ] 7.2 記録行が操作文脈（IP・エンドポイント・操作者）を保持することを検証
  - 非 GET・対象内 action を settle → 作成された行が、middleware が焼き付けていた IP・エンドポイント・操作者・操作者名を従来どおり保持していることを実 DB の読み直しで確認する（事前作成廃止で欠損させない。R2.6 の権威ある証拠）。
  - Observable: 作成行の ip / endpoint / user / snapshot.username が期待値どおりに残っている。
  - _Requirements: 2.6_
  - _Boundary: ActivityService 記録ゲート結合試験（同一 integ ファイル・並列不可）_
  - _Depends: 5_

- [ ] 7.3 fail-safe（試行記録）の保持と②との区別を実 DB で検証
  - 非 GET・ルートがエラー応答（status>=400）で終了 → 当該 id の `ACTION_UNSETTLED` 行が実 DB に残ることを確認する（finalizer が試行記録を作成。R4.1 の権威ある証拠）。成功完了（status<400）では残らないことも確認する。
  - クライアント中断（`writableFinished=false` の close）→ `ACTION_UNSETTLED` 行が残ることを確認する。
  - 対象外だった②の行は作られない一方、失敗・中断の UNSETTLED は残る、という差（R4.2/4.3 の区別）を確認する。
  - Observable: 失敗・中断時に `ACTION_UNSETTLED` 行が実 DB に残り、成功時・対象外時には残らない、という差が確認できる。
  - _Requirements: 4.1, 4.2, 4.3_
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
