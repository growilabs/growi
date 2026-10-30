# Brief: chat-integration-notification-load

チャットへの通知を送る定期処理（`notification-dispatch-cron.ts`）について、次の 2 つを直す amend spec。

1. チャット連携が 1 つも無いテナントでは、定期処理の問い合わせを飛ばす。「連携があるか」の答えは一定時間（10 分）覚えておく。
2. 保持期間を過ぎた解除済みの連携の掃除を、通知の定期処理から切り離して 1 日 1 回にする。

定期処理の間隔（1 分）は変えない。間隔を延ばす変更は、書き込んだ直後に送る経路と一緒に `chat-integration-agent`（roadmap 順 7）で作る。

umbrella の roadmap「リリース前に直すもの」の順 6 にあたる。

## Amend target

| 対象の spec | 変わる契約 |
|---|---|
| `chat-integration`（umbrella） | `requirements.md` の要件 2（通知）に受け入れ条件 **2.7〜2.9** を末尾に足す（連携が無いときに問い合わせない・通知を書き留めたプロセスは覚えた答えのせいで送信を飛ばさない・書き留めたプロセスが止まったときにほかのプロセスが拾うまでの時間）。要件 9（紐付け）に受け入れ条件 **9.8** を末尾に足す（解除済みの連携の掃除は 1 日 1 回）。既存の番号は振り直さない。`roadmap.md` の順 6 を消す |
| `chat-integration-app` | `design.md` の「通知を 2 段に分ける」節（定期処理の説明。「既定 1 分間隔」は変えない）、「紐付けの一意性に workspace の軸が要る」節の「45 日の掃除は `NotificationDispatcher` と同じく条件つき更新で 1 台だけが回す」の文、File Structure Plan、Testing Strategy。`research.md` に、この spec の判断の理由を移す |

- `chat-integration-app` は自分の `requirements.md` を持たない（要件は umbrella が持つ。`spec.json` の `owned_by_umbrella: true`）。そのため新しい受け入れ条件は umbrella の要件に足す。
- `chat-integration-protocol` と `chat-integration-proxy` は変わらない。通信の契約（`notification` の口、`requestId` の扱い、署名）には触れない。
- **Revalidation Triggers への影響**: 無い。`chat-integration-app` の design.md の Revalidation Triggers に挙がっている条件（`@growi/chat` の契約、検索・権限判定の呼び出し契約、proxy の能力表・通知契約、固定リンクの判定）のどれにも当たらない。

## Problem

- **使っていないテナントにも負荷がかかる。** 通知の定期処理は、チャット連携を使っているかに関係なく、すべてのインスタンスで起動時に始まる（`apps/app/src/server/crowi/index.ts` の `setupCron`）。1 分ごとに MongoDB へ 2 回問い合わせる（送信待ちの行を取る `findOneAndUpdate` と、保持期間を過ぎた解除済みの連携を探す `findOne`）。1 回 1 回は小さいが、GROWI.cloud のように多くのテナントが 1 つの MongoDB を共有する環境では、テナント数に比例した負荷がかかり続ける。
- **掃除が通知と同じ頻度で走っている。** 解除済みの連携は 45 日残す（`unpaired-retention.ts`）。45 日の期限を 1 分の精度で守る必要は無いのに、毎分探している。

## Current State

- 通知は「書き留める」と「送る」の 2 段（`chat-integration-app` の design.md「通知を 2 段に分ける」）。ページの保存は `chat_notification_outbox` に 1 行書いてすぐ戻り（要件 2.5）、定期処理が送る。
- 定期処理は `CronService` を継承した `ChatNotificationDispatchCronService`。スケジュールは `'* * * * *'`（毎分）。1 回の実行で `NotificationDispatcher.drain(now)` と `sweepUnpairedRelations(now)` を続けて呼ぶ。
- **複数台での排他は行ごとの条件つき更新**。`drain` は `findOneAndUpdate` で行の `state` を `claimed` に変えて 1 行ずつ取る。止まったプロセスが持っていた行は、`claimedAt` が 5 分（`CLAIM_STALE_AFTER_MS`）より古ければ別のプロセスが取り直す。この 5 分は定期処理の間隔とは独立した定数。
- **送り直しの間隔**は 60 秒から倍々（上限 30 分）、5 回で諦める（`given-up`）。proxy がチャンネル一覧をまだ取れていない（`inventory-not-ready`）ときは 10 分あけ、諦めの回数に数えない。
- `drain` は 1 回に最大 50 行（`MAX_ROWS_PER_DRAIN`）。
- 通知を proxy へ送るのは `drain` だけで、`drain` は outbox の行しか送らない。outbox の行を書くのは `notificationOutbox.enqueue` の 1 か所だけ。

## Approach

- **「連携があるか」は `chat_relations` に行が 1 つでもあるか（状態を問わない）で決める。** 解除済みの行も数えるのは、掃除の対象が解除済みの行だから。答えはプロセスの中に 10 分覚える。
- **新しい連携を待たせない仕組みは「行を書いたプロセスが自分で印を付ける」にする。** `enqueue` が行を書いた直後に、そのプロセスの覚えた答えを「ある」にする。問い合わせは増えない。送るべきものは必ず outbox の行として書かれるので、ペアリングの時点で印を付ける必要は無い。
- **掃除は別の `CronService` に分け、1 日 1 回にする。** GROWI.cloud の全テナントが同じ時刻に一斉に掃除しないよう、`wip-page-cleanup-cron.ts` と同じく実行前にランダムに待つ。

## Scope

- **In**: 掃除の頻度と起動の仕方、連携が無いときの問い合わせの省略とその答えの覚え方。
- **Out**:
  - **「書き込んだ直後に送る」**。`chat-integration-agent` の「答えをあとから送る口」と同じ経路で作る（roadmap 順 7、`chat-integration-agent/brief.md` の Downstream）。この spec では作らない。ただし設計は、定期処理が唯一の送り手であることを前提にしない（`drain` は誰から何度呼ばれても安全なまま保ち、`enqueue` の後に処理を足せる場所を 1 か所に保つ）。
  - **通知の定期処理の間隔を延ばすこと。** 1 分のまま。`chat-integration-agent` で、書き込んだ直後に送る経路と一緒に作る（下の Constraints）。
  - 送り直しの回数・間隔（`NOTIFICATION_RETRY_CONFIG`）と、止まった送信を取り直すまでの時間（`CLAIM_STALE_AFTER_MS`）の値。変えない。
  - 通信の契約、proxy。

## Constraints

- **間隔を延ばすのは、順 7 の「書き込んだ直後に送る」と一緒にする。** 今は定期処理がすべての通知の最初の送信も担っているので、先に間隔を 5 分にすると、保存から届くまでが 0〜60 秒から 0〜5 分に延び、1 分あたりに送れる行の数も 50 から 10 に減る。そのため、この spec では間隔を変えない。
- この spec は amend spec なので、最後のタスクを「変更を対象の spec に書き戻し、この spec を削除する」にする（`.claude/rules/spec-lifecycle.md`）。
- 要件 ID を振り直さない。

## Upstream / Downstream

- **Upstream**: `chat-integration-app` の通知の 2 段（実装済み）。
- **Downstream**: `chat-integration-agent`（順 7）の「書き込んだ直後に送る」。この spec が `enqueue` に付ける「行を書いた」印の場所と、`drain` を定期処理以外から呼んでも安全であることを、そのまま使える。

## Existing Spec Touchpoints

- **Extends**: `chat-integration`（要件 2・9 に受け入れ条件を追加）、`chat-integration-app`（design.md の通知と掃除の節）
- **Adjacent**: `wip-page-cleanup-cron.ts`（ランダムに待ってから掃除する前例）、`server/service/cron.ts`（`CronService`）
