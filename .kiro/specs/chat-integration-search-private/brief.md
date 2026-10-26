# Brief: chat-integration-search-private

チャットからの `search` の結果を、チャンネルの全員ではなく、検索した本人にだけ見せるように直す amend spec。

## Amend target

| 対象の spec | 変わる契約 |
|---|---|
| `chat-integration`（umbrella） | 要件 3.2「1 本のリストとして投稿する」— 結果を誰に見せるかを定める受け入れ条件を、要件 3 の末尾に足す（既存の番号は振り直さない） |
| `chat-integration-proxy` | `search` の結果の届け方（今は「いったん投稿して差し替える」段取りでチャンネルに出す。design.md の該当節）。能力表の `ephemeralMessage` が支える機能に `search` が加わる |

- `chat-integration-protocol` と `chat-integration-app` の契約は変わらない見込み。GROWI が返す検索結果の中身（要件 3.9）はそのままで、変わるのは proxy がそれを誰に見せるかだけ。
- Revalidation Triggers（下流の spec を確かめ直す必要が出る条件）への影響: 無い見込み。requirements の段階で確かめる。

## Problem

出荷済みの `search` は、検索した本人の閲覧権限で調べる（要件 3.6）。それなのに、その結果をチャンネルの全員に見える形で投稿している。そのため、本人にしか見えないページの題名とパスが、チャンネルの参加者全員に見えてしまう。社外の人が入るチャンネルでは、社外にも見える。

## Current State

- proxy の `orchestration/command-flow.ts` は、`search` を受けると、まずチャンネルに「「…」を検索しています…」と投稿する。結果が揃ったら、その投稿を一覧で差し替える（`platform.post` → `platform.replace`）。仮の投稿に失敗したときだけ、本人にだけ見えるメッセージで返す。
- 紐付けが要るという案内や、エラーは、すでに本人にだけ見えるメッセージで返している（`tell` → `platform.postEphemeral`）。
- 本人にだけ見えるメッセージを、Discord ではメンションへの返事として出せない。アダプタ側で DM に置き換えている。
- Slack の本人にだけ見えるメッセージは、あとから書き換えられない。今の「いったん投稿して差し替える」段取りをそのまま使えない。届くことの保証も無く、再読み込みで消える。返事の無いメッセージのスレッドに出すと表示されないことがある（https://docs.slack.dev/reference/methods/chat.postEphemeral 。`chat-integration-agent` の brief の「実現性の確認の結果」2）。
- Mattermost で本人にだけ見えるメッセージを出すには、システム管理者の権限（`create_post_ephemeral`）が要る。コミュニティ製のアダプタは DM に切り替えないので、普通の bot ではエラーになる（同 5）。今の `tell` も同じ問題を持つ疑いがある（実機では未確認）。

## Desired Outcome

- `search` の結果の一覧は、検索した本人にだけ見える。Discord では本人への DM で届く。
- チャンネルに共有したいときは、本人が結果のページの URL をチャンネルに貼る。どこまで見せるかは、要件 6（URL の展開）の規則がそのまま決める。
- 本人は、検索を受け付けたことを待ち時間の間に知ることができる。
- 本人にだけ見せる手段がそのサービス・その場所で使えないとき（Mattermost の権限、Slack でスレッドが無いときなど）は、本人への DM で届く。チャンネルの全員に見える形には決して戻らない。

## Approach

**本人にだけ返し、共有は URL を貼る形に任せる**（2026-10-26 の discovery で決定）。

- 新しい共有の仕組み（「共有する」ボタンなど）を作らない。Mattermost はボタン操作を受け取れないので、ボタンに頼ると 4 サービスで同じに動かない。
- URL を貼れば、何を誰に見せるかを要件 6 の規則が決める。`search` と、後に作る `agent` に同じ規則を使える。
- 待ち時間の間の表示は、書き換えの要らない形にする（例: 本人にだけ見える「検索しています…」を出し、結果は別のメッセージで届ける。または元のメッセージにリアクションを付ける）。どれにするかは design で決める。

検討して採らなかった案:
- 誰でも見られるページだけで調べた結果をチャンネルに出し、本人の権限でしか見えない分は本人にだけ返す — 返事が 2 通に分かれる。ゲストの閲覧を許さない GROWI では、チャンネルに出せる結果がほぼ無くなる。
- 今のままチャンネルに出す（管理者がチャンネルごとに許可していることを、参加者を信頼する根拠とみなす）— 社外の人が入るチャンネルで漏れる。

## Scope

- **In**: `search` の結果、検索中の表示、結果の注記（応答しなかった GROWI など）の届け先を本人にする。能力表と導入ドキュメントの関係する記述を直す。
- **Out**: `help` の届け方（GROWI が提供するコマンドの一覧で、閲覧権限に左右される内容を含まない）。`create-page` の成功の知らせ。URL の展開。`agent`（`chat-integration-agent` が扱う）。

## Boundary Candidates

- proxy の `search` の届け方（`orchestration/command-flow.ts` の検索の段取り）
- サービスごとの「本人にだけ見せる」手段の違い（`platform/outbound.ts` の `postEphemeral` と DM への置き換え）

## Out of Boundary

- GROWI 側の検索と権限の適用（要件 3.6・3.7）— 変えない
- 結果をチャンネルに共有する専用の仕組み — 作らない（URL を貼る形に任せる）

## Upstream / Downstream

- **Upstream**: `chat-integration-proxy`（実装済み）の `postEphemeral` と、Discord で DM に置き換える処理
- **Downstream**: `chat-integration-agent` が、同じ「本人にだけ返す」規則を使う

## Existing Spec Touchpoints

- **Extends**: `chat-integration`（要件 3）、`chat-integration-proxy`（design の検索の段取り）
- **Adjacent**: `chat-integration-agent`（同じ規則を使う）。backlog の「要件 6 の見直し」（共有したときに何を見せるかを決める）

## Constraints

- 要件 ID を振り直さない。足す受け入れ条件は要件 3 の末尾に付ける。
- この spec は amend spec なので、最後のタスクを「変更を対象の spec に書き戻し、この spec を削除する」にする（`.claude/rules/spec-lifecycle.md`）。
- 実装中は、対象の spec の本文に「後で変わる」といった注記を書き込まない。
