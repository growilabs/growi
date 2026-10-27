# Implementation Plan — chat-integration-notification-load

> amend spec。対象は `chat-integration`（umbrella、要件 2・9）と `chat-integration-app`（design.md の通知と掃除の節）。
> 要件 ID は umbrella の `requirements.md` の続き番号（2.7〜2.9、9.8。2.10・2.11 は空き）。

**「振る舞い」と書いたタスクは、テストを先に書き、失敗することを確かめてから実装する。**
テストは時刻を引数や差し替え口で渡して書く。実時間の待ちも、vitest の偽のタイマーも使わない（design.md「Testing Strategy」）。

**通知の定期処理の間隔は 1 分のまま変えない。** 間隔を延ばす変更は、書き込んだ直後に送る経路と一緒に `chat-integration-agent` で作る（research.md の「先に間隔を延ばす」の Decision）。

---

- [ ] 1. 「連携があるか」の判定を作る
- [ ] 1.1 連携の有無を答え、その答えを 10 分覚える部品を作る（振る舞い）
  - `server/integration-presence.ts` に `IntegrationPresence` と `createIntegrationPresence`、プロセスに 1 つの `integrationPresence` を置く
  - 判定は `chat_relations` に行が 1 つでもあるか。状態で絞らない（解除済みも数える）
  - 「ある」も「無い」も、答えを決めた時刻から 10 分覚える。`markPresent(now)` は問い合わせずに「ある」にする。問い合わせが失敗したら「ある」を返し、覚えない
  - 時刻はすべて引数 `now` で受け取る
  - 期限切れのときの同時の呼び出しは、問い合わせ中の 1 つの Promise を共有する
  - 完了の条件: design.md の Unit Tests 1〜4a と Integration Tests 1 が通る
  - _Requirements: 2.7, 2.8_

- [ ] 2. 通知を書き留めたプロセスに「ある」の印を付ける
- [ ] 2.1 `enqueue` が行を書いた直後に `markPresent` を呼ぶ（振る舞い）
  - `createNotificationOutbox(deps)` を足し、`notificationOutbox` はその既定の値にする。外から見える型と名前は変えない
  - 行の書き込みが失敗したときは印を付けない
  - 完了の条件: design.md の Unit Tests 12 が通り、既存の `notification-outbox.spec.ts` も通る
  - _Requirements: 2.8_
  - _Depends: 1.1_

- [ ] 3. 掃除を通知の定期処理から切り離す
- [ ] 3.1 掃除の定期処理を作り、起動につなぐ（振る舞い）
  - `server/pairing/unpaired-relation-sweep-cron.ts` に `UnpairedRelationSweepCronService` を作る。スケジュールは `'0 2 * * *'`、実行の前に最大 60 分ランダムに待ち、待った後に判定し、「ある」ときだけ `sweepUnpairedRelations(now)` を呼ぶ
  - 差し替え口は `sweep`・`presence`・`clock`・`sleep`
  - `crowi/index.ts` の `setupCron` で、通知の定期処理の起動の直後に `startCron()` を呼ぶ
  - `sweep-unpaired-relations.ts` の冒頭の注記と、`models/chat-relation.ts` の `unpairedAt` の注記にある「通知と同じ回で動く」の記述を直す（注記だけ）
  - 完了の条件: design.md の Unit Tests 10・11 と Integration Tests 3 が通る
  - _Requirements: 9.8, 2.7_
  - _Depends: 1.1_

- [ ] 3.2 通知の定期処理から掃除を外し、判定で問い合わせを飛ばす（振る舞い）
  - `ChatNotificationDispatchCronService` の差し替え口から `sweep` を外し、`presence` と `clock` を足す
  - `executeJob` は `clock()` の時刻で判定し、「無い」なら何もしない。「ある」なら `drain(now)` を呼ぶ
  - スケジュールは変えない（1 分のまま）
  - 3.1 より先に入れない。先に入れると、その間は掃除がどこからも動かない
  - 完了の条件: design.md の Unit Tests 5〜9 が通り、既存の「同じ時刻で drain と sweep を呼ぶ」「drain が失敗しても sweep が動く」のテストを、新しい形に合わせて書き換えている
  - _Requirements: 2.7, 2.9, 9.8_
  - _Depends: 3.1_

- [ ] 4. 全体を確かめる
- [ ] 4.1 apps/app の lint・テスト・build を通す
  - `turbo run lint --filter @growi/app`、`turbo run test --filter @growi/app`、`turbo run build --filter @growi/app`
  - 完了の条件: 3 つとも通る
  - _Requirements: 2.7, 2.8, 2.9, 9.8_

- [ ] 5. Port changes into the target spec and retire this spec
  - [ ] 5.1 Rewrite the relevant section(s) of chat-integration's requirements.md and chat-integration-app's design.md
    - `chat-integration`（umbrella）の `requirements.md`: 要件 2 の末尾に 2.7〜2.9、要件 9 の末尾に 9.8 を足す。既存の番号は振り直さない。2.10・2.11 は空けたままにする（`chat-integration-agent` が間隔の作業で使ってよい）
    - `chat-integration-app` の `design.md`: 「通知を 2 段に分ける」（定期処理の説明。間隔の「既定 1 分」は残す。`IntegrationPresence` と判定、書き込んだ直後に送る経路のための余地）、「紐付けの一意性に workspace の軸が要る」の 45 日の掃除の文、File Structure Plan、Testing Strategy、Revalidation Triggers（この spec の design.md の 3 項目）。この amend が無かったかのように、今の事実だけを書く
  - [ ] 5.2 Move any design rationale into chat-integration-app's research.md
    - この spec の `research.md` の Research Log・Design Decisions・Risks を `chat-integration-app` の `research.md` へ移す
  - [ ] 5.3 Update chat-integration's and chat-integration-app's spec.json (`updated_at`; leave `phase`/`approvals` alone)
    - `chat-integration` と `chat-integration-app` の両方
  - [ ] 5.4 Remove this spec's row/entry from roadmap.md (if listed there)
    - `.kiro/specs/chat-integration/roadmap.md` の「作業の順序」の表の順 6 の行と、「### 6. 通知の定期処理」の節。書き戻しの時点の roadmap の内容に合わせて消す。順 7 の行と節にある「順 6 の説明を参照」は、`chat-integration-app` の design.md の「書き込んだ直後に送る経路のための余地」を指すように直す
  - [ ] 5.5 Delete .kiro/specs/chat-integration-notification-load/
