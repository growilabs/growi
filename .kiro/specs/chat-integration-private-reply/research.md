# Research & Design Decisions — chat-integration-private-reply

## Summary

- **Feature**: `chat-integration-private-reply`（amend spec。対象は `chat-integration`（umbrella）と `chat-integration-proxy`）
- **Discovery Scope**: Extension（既存の proxy の送信の層・コマンドの流れ・引数の収集に手を入れる）。light discovery に加え、Slack・Mattermost・Teams・Discord の公式文書を確かめた（`chat-integration-agent` の brief の「実現性の確認の結果」と共有）
- **Key Findings**:
  1. **今の本人宛ての返事は、チャンネルの直下に出ている。** `platform/outbound.ts` は `ChannelImpl` をチャンネルの id で作り、Slack のアダプタはスレッドの部分が無い id には `thread_ts` を付けない。そのため、Slack の「返事の無いスレッドでは表示されない」制約は、本 spec の範囲では効かない
  2. **DM への切り替えは、アダプタに本人だけのメッセージの機能が無いとき（Discord）にしか働かない。** Chat SDK の `ChannelImpl.postEphemeral` は、アダプタが `postEphemeral` を持てばそれを呼び、失敗しても DM に切り替えない。Mattermost のアダプタは `/posts/ephemeral` を直接呼ぶので、システム管理者の権限が無い bot ではエラーになり、返事が落ちる
  3. **DM で聞き返しても、今は DM での答えを受け取れない。** Chat SDK は DM のメッセージを mention として届ける（`chat/dist/index.js` で `isDM` のとき `isMention = true`）が、`argument-collector.ts` は答えを (チャンネル, 本人) で探すので、DM のチャンネルでは見つからない。さらに `stripAddressToken` が先頭の語を必ず落とすので、DM で打った答えの最初の語が消える。Discord では今も聞き返しが DM に出ているので、これは出荷済みの不具合でもある

## Research Log

### 本人宛ての返事の今の経路

- **Context**: 要件 1・2 が「どこを通る返事を直すか」を決めるため。
- **Sources Consulted**: `src/orchestration/command-flow.ts`（`tell`・`deliver`・`runSearch`・`reportExpired`）、`src/orchestration/admin-flow.ts`（`say`）、`src/command/argument-collector.ts`（`ask`・選択肢の聞き返し）、`src/platform/outbound.ts`（`postEphemeral`）
- **Findings**:
  - 本人宛ての返事は、`platform.postEphemeral` を直接呼ぶ 5 か所に散っている（`tell`、`reportExpired`、`admin-flow` の `say`、`argument-collector` の 2 か所）
  - `argument-collector` は、聞き返す前に `supports('ephemeralMessage', platform)` を見て、使えなければ「聞き返す手段が無い」と断る
  - `search` は「いったん投稿して差し替える」で、仮の投稿と結果をチャンネルに出す
- **Implications**: 届け方の判断を 1 か所に集め、5 か所すべてをそこへ寄せる。`supports('ephemeralMessage')` による断りは、DM という代わりがあるので不要になる

### サービスごとの本人だけのメッセージと DM

- **Context**: 要件 1.2〜1.4 の「出せる・出せない・失敗する」をサービスごとに確かめる。
- **Sources Consulted**: インストール済みのアダプタ（`@chat-adapter/{slack,discord,teams}@4.38.1`、`chat-adapter-mattermost@1.1.3`）の `postEphemeral`・`openDM`・`addReaction`・`fetchChannelInfo`、`chat@4.38.1` の `ChannelImpl.postEphemeral`、各サービスの公式文書
- **Findings**:
  - **Slack**: `chat.postEphemeral`。利用者か bot がチャンネルにいないと失敗する。届く保証は無く、再読み込みで消える（https://docs.slack.dev/reference/methods/chat.postEphemeral ）。DM は `conversations.open` で開き、**`im:write` の権限が要る**。今のマニフェスト（`docs/setup-slack.md`）には無い
  - **Discord**: アダプタに `postEphemeral` が無い。メンションへの返事を本人だけに見せる手段は Discord 自体に無い（EPHEMERAL のフラグは interaction の応答だけ）。DM は `openDM`。Gateway の intents に `DirectMessages` が入っており（アダプタの `GatewayIntentBits.DirectMessages`）、DM のメッセージは proxy に届く
  - **Teams**: アダプタは targeted message を送る。DM は 1 対 1 の会話を作る。テナントの id が要るが、一度メンションした利用者なら保存済み
  - **Mattermost**: `/posts/ephemeral` は `create_post_ephemeral`（システム管理者だけ）を要する（https://raw.githubusercontent.com/mattermost/mattermost/master/api/v4/source/posts.yaml ）。DM は `/channels/direct`
  - **リアクション**: 4 つのアダプタすべてが `addReaction` を持つ。Chat SDK の共通の絵文字名に `eyes`・`email` がある。Slack は `reactions:write`（マニフェストに有る）が要る。Teams で bot がリアクションを付けられるかは実物で確かめていない
- **Implications**: 本人だけのメッセージ → 失敗・未対応なら DM、の 2 段にする。DM の可否はアダプタに頼らず proxy 側で決める（Discord で Chat SDK 任せにすると、DM に見出しを付けられない）

### 引数の聞き返しと DM

- **Context**: 要件 2.3（DM で聞き返したら DM での答えを受け付ける）。
- **Sources Consulted**: `src/command/argument-collector.ts`（`resume`）、`src/orchestration/event-sink.ts`、`src/db/repositories/pending-collection-repository.ts`、`prisma/schema.prisma`（`PendingCollection`）、`src/platform/event-mapping.ts`
- **Findings**:
  - `resume` は mention を (platform, channelId, actor) で `findInFlight` する。DM での答えはチャンネルが違うので `not-mine` になる
  - `toRecord` は、保存した invocation のチャンネルと行のチャンネルが一致しない行を捨てる。答えを受け付けるチャンネルを別の列で持てば、この検査と衝突しない
  - 再開した後の `runCollected` は、保存した invocation（元のチャンネル）で installation を引く。DM のチャンネルで installation を引く箇所は無いので、「DM で installation を特定できない不具合」（roadmap の 2）に依存しない
  - `reportExpired` は届いたイベントのチャンネル（DM）へ返す。本人宛ての返事の部品を通せば、DM の中では DM に出る
  - `event-mapping.spec.ts` の例は `'@growi search foo'` のような作りもので、各サービスの本物の `message.text` で先頭の呼びかけがどう表れるかは確かめていない
- **Implications**: 答えを受け付けるチャンネルを pending の行に足す。DM かどうかは、推測ではなく対応付けの段階（`event-mapping.ts`。スレッドが DM かを知っている）で印を付ける

### 運用者への報告

- **Context**: 要件 1.7（届けられなかったことを運用者が後から確認できる）。
- **Sources Consulted**: `src/runtime/dependencies.ts`（`ProxyReporters.reportOperationalFailure`）、`src/platform/index.ts`（`createPlatformFacade` の `reportOperationalFailure`）
- **Findings**: proxy は自前の logger を持たず、運用者に見せる事実は注入された `reportOperationalFailure` に渡す。最も外側（`runtime/`）が標準エラー出力に書く
- **Implications**: 同じ関数を本人宛ての返事の部品に注入する。返事の内容は渡さない

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 判断を platform 層に置く | `PlatformFacade` に「本人に届ける」を 1 つ足し、中で本人だけ → DM → 知らせ を決める | 呼ぶ側が最も単純 | 見出しの文言、運用者への報告、場所の名前の引き当て（`db/`）が platform 層に入る。platform 層は Chat SDK を包む層で、文言と方針を持たない（proxy design の決定） | 不採用 |
| **B. 仕組みは platform、判断は command 層の 1 か所** | platform に「本人だけ」「DM」「リアクション」の 3 つの仕組みを置き、`command/private-reply.ts` が順番・見出し・知らせ・報告を決める | platform 層は仕組みだけのまま。`command/`・`orchestration/` の両方から使える（層の順で左にある） | 呼ぶ側が直接 `postEphemeral` を呼べると、判断を飛ばせてしまう → 呼ぶ側の型から外して防ぐ | **採用** |
| C. 判断を orchestration 層に置く | `command-flow` の `tell` を広げる | 変更が少ない | `argument-collector`（`command/`）が使えない（層の順で右の層を import できない） | 不採用 |

## Design Decisions

### 決定 1: 届け方の判断を `command/private-reply.ts` の 1 か所に集め、呼ぶ側の型から `postEphemeral` を外す

- **Context**: 要件 1.1 は「チャンネルの全員に見える形にしない」という保証である。判断が 5 か所に散ったままだと、1 か所の書き忘れで崩れる。
- **Alternatives Considered**: 上の表の A・C。各呼び出し元で個別に DM へ切り替える案（散らばりが残る）。
- **Selected Approach**: B。`CommandFlowPlatform`・`AdminFlowPlatform`・`ArgumentCollectorPlatform` から `postEphemeral` を外し、代わりに `PrivateReplier` を受け取らせる。書き忘れはコンパイルで止まる。加えて `architecture.spec.ts` で「`postEphemeral`・`postDirect` を呼ぶのは `command/private-reply.ts` だけ」を確かめる。
- **Rationale**: 守りを型と試験に任せ、レビューの注意力に頼らない。
- **Trade-offs**: 呼ぶ側の依存が 1 つ増える。

### 決定 2: DM への切り替えは Chat SDK に任せず、proxy が自分で行う

- **Context**: Chat SDK の `fallbackToDM` は、アダプタに本人だけのメッセージの機能が無いときだけ働く。失敗したとき（Mattermost の権限、Slack で本人がチャンネルにいない）には働かない。また SDK が DM に送ると、どの依頼への返事かの見出し（要件 1.8）を付けられない。
- **Selected Approach**: `outbound.ts` の `postEphemeral` は `fallbackToDM: false` で呼び、アダプタに機能が無ければ `unsupported` を返す。DM は新しい `postDirect` で送る。
- **Trade-offs**: Mattermost で権限が無い間は、毎回いったん失敗してから DM に送る。1 回分の無駄な API 呼び出しは許容する（権限の有無を覚えておく仕組みは足さない。簡素さを優先）。

### 決定 3: 「DM に届いた」「受け付けた」の知らせは、依頼のメッセージへのリアクションにする

- **Context**: 要件 1.5（DM に届いたことを、内容を含まない形で知らせる）と 3.3（検索を受け付けたことを知らせる）。Slack の本人だけのメッセージは書き換えられないので、「検索しています…」を結果で差し替える今の段取りは使えない。
- **Alternatives Considered**: 本人だけの「検索しています…」を出して、結果は別のメッセージで届ける（Discord では DM が 2 通になる）。チャンネルに短い文を出す（Discord では毎回チャンネルに文が残る）。
- **Selected Approach**: 受け付けたら依頼のメッセージに `eyes`、DM に届けたら `email` を付ける。リアクションを付けられないとき（依頼にメッセージが無い、サービスが拒んだ）は、受け付けの知らせは本人宛ての返事として「検索しています…」を出し、DM の知らせは内容を含まない短い文をその場に出す。
- **Rationale**: リアクションは内容を含まず、チャンネルに文を増やさない。
- **Trade-offs**: リアクションは誰からも見える（何かを頼んだことは分かる）。頼んだこと自体は、メンションが全員に見えている時点で既に見えている。

### 決定 4: DM の見出しに使う場所の名前は、保存済みのチャンネル一覧から引く

- **Context**: 要件 1.8（DM だけを読んで、どの場所の何の依頼への返事か分かる）。
- **Alternatives Considered**: アダプタの `fetchChannelInfo` で毎回引く（API の往復が 1 回増え、Teams などで権限の問題が出うる）。
- **Selected Approach**: `installation_channel.channel_name` を引く。コマンドはチャンネル一覧で installation を引けたときにしか走らないので、名前はほぼ必ずある。無いときは「元のチャンネル」と書く。

### 決定 5: DM で聞き返したら、答えを受け付けるチャンネルを pending の行に持つ。同じ DM では新しい聞き返しが勝つ

- **Context**: 要件 2.3。Discord では、1 人の利用者と bot の DM は 1 つしか無い。チャンネル A の `search` とチャンネル B の `create-page` が同時に聞き返しを DM に出すと、DM での答えがどちらへのものか決まらない。
- **Selected Approach**: `pending_collection` に `answer_channel_id`（null 可）を足す。聞き返しを DM で届けたら、その DM のチャンネルを書く。同じ (platform, `answer_channel_id`, 本人) の古い行があれば、その行の `answer_channel_id` を消す（古い依頼は元のチャンネルからは引き続き答えられる）。`resume` は、まずイベントのチャンネルで探し、見つからなければ `answer_channel_id` で探す。
- **Rationale**: 既存の「新しいコマンドが優先される」規則と同じ向き。行を消さないので、元のチャンネルでの答え方は残る。

### 決定 6: DM で打たれた文は、先頭の語を呼びかけとして落とさない

- **Context**: Chat SDK は DM のメッセージを mention として届けるが、本文に呼びかけは無い。今の `stripAddressToken` は先頭の語を必ず落とす。
- **Selected Approach**: `event-mapping.ts` が mention に `inDirectMessage`（スレッドが DM か）を付ける。`CommandInvocation.normalize` と `stripAddressToken` は、DM では先頭の語を落とさない。ただし DM でも先頭が bot への呼びかけなら落とす。各サービスの本物の本文で呼びかけがどう表れるかは、本物のアダプタを使う試験で確かめる。
- **Trade-offs**: DM で `search foo` と打てばコマンドとして読まれるが、DM での installation の特定は別の不具合（roadmap の 2）なので、本 spec では「workspace が登録されていない」と返るまでが範囲。

## Synthesis

- **Generalization**: 「本人に届ける」は、検索の結果・聞き返し・エラー・登録コード・後の `agent` の答えに共通する 1 つの問題として扱う。インターフェースは「何の依頼への返事か」を受け取る形にし、`agent` があとで届ける場合にも同じ形で使えるようにする（あとで届ける実装は足さない）
- **Build vs. Adopt**: Chat SDK の `fallbackToDM` を採らない理由は決定 2。リアクションと DM はアダプタの既存の機能を使う
- **Simplification**: 権限の有無を覚える仕組み、DM の既読確認、届いたかの追跡は足さない。能力表の行は `directMessage` を 1 行足すだけにする

## Risks & Mitigations

- Slack の既存の導入は `im:write` を持たない — 導入し直すまで、Slack では本人だけのメッセージが失敗したとき DM に切り替えられず、内容を含まない知らせだけになる。導入ドキュメントと実機試験の手順に「導入し直す」を書く
- Teams で bot がリアクションを付けられない場合 — 決定 3 の代わりの手段（本人宛ての「検索しています…」、内容を含まない短い文）に落ちる
- Mattermost で権限が無い運用者は、毎回 1 回分の失敗する呼び出しを払う — 導入ドキュメントで、権限を与えるか DM で受け取るかを選べることを示す
- DM で打たれた本文の先頭の扱い（決定 6）が、本物の本文の形と食い違う — 本物のアダプタを使う試験で 4 サービスの本文を確かめる

## References

- Slack `chat.postEphemeral`: https://docs.slack.dev/reference/methods/chat.postEphemeral
- Mattermost API `POST /posts/ephemeral`: https://raw.githubusercontent.com/mattermost/mattermost/master/api/v4/source/posts.yaml
- Discord Create Message（EPHEMERAL は interaction の応答だけ）: https://docs.discord.com/developers/resources/message
- Teams targeted messages: https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/targeted-messages
- `chat-integration-agent` の brief「実現性の確認の結果」（同じ調査の全体）
