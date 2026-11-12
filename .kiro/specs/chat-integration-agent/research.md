# Research & Design Decisions

## Summary

- **Feature**: `chat-integration-agent`
- **Discovery Scope**: Complex Integration（umbrella・protocol・proxy・app の 4 つの spec にまたがる amend）
- **Key Findings**:
  - proxy は、チャットのイベントを受けた時点でスレッドの根元を捨てている。スレッドを読む・スレッドの中に答える・同じスレッドを 1 本の会話にする、のすべてに根元が要る
  - GROWI の AI Agent は、利用者を `RequestContext` で受け取り、会話の id を外から指定できる。チャットのスレッドと AI の会話の対応は、id を計算で決めれば表を持たずに済む
  - 通知の送り直しの仕組み（書き留める → 取る → 送る → 送り直す）は、答えをあとから送る処理にそのまま使える。違うのは「1 件を送る」部分だけ

調べた日は 2026-11-10。コードは `feat/slackbot-proxy-gen2` の `778c0d0b0a`。外部の文書で確かめたことは `brief.md`「実現性の確認の結果」にある。

## Research Log

### protocol: コマンドの語彙と、GROWI から proxy への口

- **Sources Consulted**: `packages/chat/src/commands/command-names.ts`、`contract/command.ts`、`contract/notification.ts`、`contract/settings.ts`、`contract/common.ts`、`endpoints/op-names.ts`、`permission/channel-permission.ts`、`signature/*`
- **Findings**:
  - コマンドは `COMMAND_NAMES` と `COMMAND_TRAITS: Record<CommandName, CommandTraits>`（`writes`・`targeting`）で宣言する。性質の無いコマンドはコンパイルできない
  - 応答の種類（`RESPONSE_KINDS`）に「受け付けた。答えはあとで送る」が無い。エラーの符号に「AI が使えない」「前の依頼を処理中」が無い
  - 口は `OP_NAMES` と `OP_ENDPOINTS`（向き・パス・本文の型）の表で宣言する。proxy の受け口の表（`INBOUND_OP_BY_PATH`）と GROWI の `pathForOp` は、この表から導かれる。向きが `growi-to-proxy` の行を足せば、署名の検査と経路は追加の配線なしで働く
  - 署名は `@method`・`content-type`・`content-digest` に掛かり、本文の `op` が口を縛る（`acceptEnvelope`）。再送の検査は nonce と `requestId` の 2 段
  - 権限の判定は純粋関数 `judge(settings, commandName, channel)`。設定の行が無いと、書き込みを伴うコマンドは `no-settings` で断られる
  - `ChannelRef` に「DM である」ことを表す欄が無い。`allowedChannels` が `'all'` なら DM も通る（proxy の決定 P16）。一覧で絞った設定では、DM は決して一致しない
  - GROWI が受け取る利用者の情報は `ChatAccountRef { platform; accountId; displayName }` だけ。スレッドを表す欄は、コマンドの依頼に無い
- **Implications**: 口は 2 つ足す（答えを送る口、会話を求める口）。どちらも通知と同じ向き・同じ署名。DM の権限には、`ChannelRef` と設定の両方に欄が要る

### proxy: コマンドの流れと、スレッドの根元

- **Sources Consulted**: `apps/chat-integration-proxy/src/command/{command-set,invocation,private-reply,argument-collector}.ts`、`orchestration/{event-sink,command-flow,inbound-flow}.ts`、`platform/{event-mapping,event-handlers,outbound,index,history,adapter-set,ephemeral-ordering}.ts`、`types/{invocation,platform-event}.ts`、`prisma/schema.prisma`
- **Findings**:
  - `fromMessage`（`platform/event-mapping.ts`）は `thread.channelId` と `message.id` だけを写し、`thread.id` を捨てる。`Invocation` にスレッドの欄は無い
  - `postEphemeral`（`platform/outbound.ts`）は、いつも根元なしで `channelThreadId` を呼ぶので、チャンネルの階層に出る。`channelThreadId` 自体は、Slack と Mattermost の根元を受け取れる
  - 履歴は `fetchChannelMessages` でチャンネルの階層だけを読む。スレッドの読み取りも、「直近の何件」という読み方も無い。結果に「頻度の制限で断られた」「途中で切れた」が無い
  - `PrivateReplier` は facade だけを持つ素の部品で、`origin.installationId` があれば、イベントの処理の外でも `bindInstallation` の中で投稿できる（通知と同じ経路）。足りないのは、あとまで残る `origin` と、スレッドの根元
  - `event-sink` は、先頭の語が既知のコマンドのときだけコマンドを始める。それ以外は聞き返しへの答えとして扱い、当てはまらなければ捨てる
  - DM の先頭の語を落とす処理（`stripAddressToken`）は、語の形（`@…`、`<@…>`）だけで判断する。command 層は bot 自身の id を知らない（「既知の問題」2）
  - 通知の宛先は、チャンネルの一覧（inventory）から引く。DM と、一覧にまだ無いチャンネルは引けない
  - 保存先に「答えを待っている依頼」を覚える場所は無い。近いのは `pending_collection`（`Invocation` を JSON で持ち、期限で掃除する）
  - テーブルを足すと、掃除の一覧（`runtime/dependencies.ts`、その spec は「ちょうど 4 つ」を確かめている）、連携の解除で消す順序（`db/relation-cascade.ts`）、保存の往復の試験（`storage-round-trip.integ.ts`）にも足す必要がある
- **Implications**: スレッドの根元を platform 層から command 層まで通す。答えを待つ依頼は proxy の表に覚え、答えの宛先は GROWI から受け取らずに自分の表から引く

### Slack の AI アプリの画面（インストール済みのアダプタ 4.38.1）

- **Sources Consulted**: `node_modules/.pnpm/@chat-adapter+slack@4.38.1_*/dist/index.{d.ts,js}`、`chat/dist/*`
- **Findings**:
  - `createSlackAdapter` は `agentView?: boolean` を受け取る。有効にすると、DM の先頭のメッセージのスレッド id が `slack:D…:<ts>` になり、1 通ごとに別のスレッドの根元になる。無効のときは、先頭のメッセージの `threadTs` は空
  - `postEphemeral(threadId, userId, message)` は `thread_ts` を送るので、スレッドの根元を受け取れる
  - `setAssistantStatus(channelId, threadTs, status)` は `threadTs` が必須。bot のトークンが要るので、イベントの外では `bindInstallation` の中で呼ぶ必要がある
  - コアの SDK は、DM のメッセージすべてに `isMention = true` を付ける。DM の文章は、`@` が無くても proxy の `mention` のイベントとして届く
  - `agent_session_stopped`（利用者が止めるボタンを押した）を扱う処理は無い
- **Implications**: `agentView` を有効にすると、DM のスレッドの扱いが全コマンドで変わる。既存の「DM へ届け直す」「DM での聞き返し」を確かめ直す。運用者が有効にするかを選べる設定にする（Slack アプリの設定の変更が要るため）

### app: コマンドの処理と、通知の送り方

- **Sources Consulted**: `apps/app/src/features/chat-integration/server/{peer/peer-router,signature-guard,proxy-client,integration-presence}.ts`、`command/{command-endpoint,resolve-actor}.ts`、`content/{help-content,conversation-page}.ts`、`settings/*`、`admin/*`、`notification/{notification-outbox,notification-dispatcher,notification-dispatch-cron}.ts`、`notification/models/chat-notification-outbox.ts`
- **Findings**:
  - コマンドの振り分け（`computeResponse`）は if の連なりで、表になっていない
  - `handleWithIdempotency` は「探す → 計算する → 保存する」の順。同じ依頼が同時に 2 つ届くと、両方が計算する
  - `performWriteCommand` は、ページ作成の選択肢を `{}` に固定している。権限が無い場合と想定外の失敗を、同じ `forbidden` にまとめている
  - `resolveActor(relationId, actor)` が、紐付いた GROWI ユーザーとグループを返す。紐付けが無ければ `account-link-required` の応答を作れる
  - ヘルプ（`buildHelpContent`）は引数の無い固定の一覧
  - `sendSigned` は HTTP の打ち切り時間を持たない。proxy が応答しないと、呼び出しが終わらない
  - 通知の送り手（`drain`）は、行ごとの条件つき更新で取り合うので、誰から何度呼ばれても安全。送る部分（`deliverClaimedRow`）だけが通知に固有（宛先ごとの結果の合成、`inventory-not-ready` の特例）
  - 送信済みの行は 30 日で消える。諦めた行は消えない
  - 定期処理の間隔を 5 分にしても、送り直しの定数は変えなくてよい。ただし、止まった送信を取り直す条件（`claimedAt < now − 5 分`、厳密な不等号）のままだと、取り直しは 5〜10 分後で、要件 2.11 の「10 分以内」に余裕が無い
- **Implications**: 送り直しの仕組みを 1 つにして、「1 件を送る」部分を種類ごとに差し替える。取り直しの条件は 4 分に縮める

### GROWI の AI Agent（`features/mastra`）

- **Sources Consulted**: `features/mastra/server/services/mastra-modules/{agents/growi-agent,tools/*,memory/index,types/request-context}.ts`、`services/{is-ai-enabled,is-ai-configured,get-or-create-thread}.ts`、`routes/{index,ai-ready-guard,post-message,get-threads}.ts`、`no-eager-ai-imports.spec.ts`、`features/ai-tools/suggest-path/server/services/engines/agentic-engine.ts`
- **Findings**:
  - `growiAgent` の道具は、`RequestContext` の `user` を見て、その利用者の閲覧権限で検索し、ページを読む
  - サーバ側から止めずに呼ぶ入口は無い。前例は suggest-path の `agent.generate(prompt, { structuredOutput, maxSteps, abortSignal, requestContext })`。`abortSignal` で打ち切れる
  - 使えるかの判定は `isAiReady()`（有効、かつ言語モデルが 1 つ以上ある）。このモジュールは軽く、起動時に読み込んでよい
  - 会話は `getOrCreateThread({ memory, resourceId: userId, threadId? })` で作る。id を外から渡せる。持ち主が違う id を使うと例外になる。ブラウザ側の API は、id が UUID の形であることを検査する
  - 利用者の `resourceId` を持つ会話は、GROWI の AI の画面の一覧に自動で出る
  - `growiAgent` の指示文は、答えに URL やリンクを書かないよう求めている（ブラウザの画面が、開いたページを出典として並べるため）
  - 利用量の記録は、`growiAgent` の中で `'chat'` に固定されている
  - 起動時に AI の部品を読み込まないことを、`no-eager-ai-imports.spec.ts` が静的な import の連なりで検査する。chat-integration の経路は起動時に読み込まれるので、AI に触れるモジュールは dynamic import の向こうに置く
- **Implications**: 会話の id は計算で決める。出典のリンクは、呼び出す側が道具の実行結果から作って答えに添える

### 作成中（WIP）のページの自動削除

- **Context**: 要約のページを WIP で作ると、既定で 2 日後に消えるのではないか、という懸念を確かめた
- **Sources Consulted**: `apps/app/src/server/service/page/index.ts`（`create` の 5136〜5141 行、`updatePage` の 5542〜5549 行）、`server/models/page.ts`（`makeWip`・`publish`・`unpublish`）、`server/service/page/wip-page-cleanup-cron.ts`、`delete-expired-wip-page-by-system.ts`
- **Findings**:
  - `create` に `wip: true` を渡すと、子ページが無ければ `wipExpiredAt`（既定で 2 日後）が付く。本文が空かどうかは見ていない
  - 掃除は「`wip` が真、`wipExpiredAt` が過ぎた、子孫が無い」ページを消す。ここでも本文は見ていない
  - `updatePage` は、`wip` の指定が無い更新で `wipExpiredAt` を外す（コメント「Once updated it's exempt from automatic deletion」）。画面から作った WIP のページは、空で作られ、利用者が本文を保存した時点で期限が外れる。「本文があるページは消えない」のは、この更新のためである
  - `unpublish()` は、`wip` を真にして `wipExpiredAt` を外す
- **Implications**: 本文つきで直接 `create` すると、期限が付いたまま残る。要約のページは、作った直後に期限を外す（要件 5.18）

## Architecture Pattern Evaluation

### 会話を要約する依頼の見分け方

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| GROWI の AI が判断し、要るときだけ会話を求める（採用） | GROWI が依頼文を AI に読ませて種類を決め、要約のときだけ proxy に会話を求める | 自由な文章で頼める。ふつうの質問では会話を読まない | 口が 1 つ増える。AI の呼び出しが 1 回増える | ユーザーが 2026-11-10 に決定 |
| 決まった言葉で頼む | `agent summarize` のように、proxy が言葉で見分ける | 単純で速い | 自由な文章で頼めない | 採らない |
| いつも会話を添える | チャンネルやスレッドからの依頼に、毎回会話を添える | 口が増えない | 質問のたびに履歴を読む（共用の Slack アプリでは 1 分に 1 回の制限に掛かる）。関係ない会話が GROWI に渡る | 採らない |

### 答えを送る仕組み

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 通知の書き留めを種類つきに広げる（採用） | 同じ collection に `kind` を足し、「1 件を送る」部分だけを種類ごとに持つ | 送り直し・取り合い・定期処理が 1 つ。直後に送る経路も 1 つ | 既存の行に `kind` を補う migration が要る | brief の「送り方を 2 通りにしない」 |
| 答え専用の collection と送り手 | 通知とは別に作る | 既存に触れない | 送り直しの仕組みが 2 つになる | 採らない |
| 書き留めずに直接送る | AI の答えができたら、その場で送る | 単純 | 送れなかったときに答えが消える。プロセスが止まると失われる | 採らない |

## Design Decisions

### Decision: 答えの宛先は proxy が覚える

- **Context**: 答えは、依頼の数秒〜数分後に届く。どこへ届けるか（チャンネル、スレッド、本人、installation）が要る
- **Alternatives Considered**:
  1. GROWI に宛先を渡し、答えと一緒に送り返してもらう
  2. proxy が依頼ごとに宛先を覚え、GROWI は依頼の `requestId` だけを送り返す
- **Selected Approach**: 2。proxy に `pending_agent_request` を足す
- **Rationale**: 1 は、GROWI が任意の宛先を指定できることになる。本文の署名はその GROWI のものなので、侵害された GROWI が、同じ workspace の任意の人に DM を送れてしまう。2 なら、答えを届けられる先は、実際に依頼した本人だけに限られる。通知の宛先のようにチャンネルの一覧から引く方法は、DM が一覧に無いので使えない
- **Trade-offs**: proxy にテーブルが 1 つ増える。持つのはチャット側の id と `requestId` だけで、GROWI ユーザーは持たない（要件 7.8 に反しない）
- **Follow-up**: 行の期限（24 時間）を過ぎた答えには `unknown-request` を返し、GROWI は送り直さない

### Decision: チャットのスレッドと AI の会話の対応は、id を計算して決める

- **Context**: 同じスレッドでの続きの依頼を、GROWI の 1 本の会話にする（要件 15.14）。proxy は対応表を持たない（要件 7.8）
- **Alternatives Considered**:
  1. GROWI に対応表（スレッド → 会話の id）を持つ
  2. proxy が、チャット側の id だけから作った文字列（会話の鍵）を依頼に載せる。GROWI は、連携・GROWI ユーザー・会話の鍵から UUID v5 を計算して、会話の id にする
- **Selected Approach**: 2
- **Rationale**: 表も掃除も要らない。同じ入力からは同じ id が出るので、プロセスをまたいでも続きになる。GROWI ユーザーの id を入力に入れるので、紐付けを付け替えた後に、他人の会話の id と重ならない（重なると `getOrCreateThread` が例外を投げる）。UUID の形なので、利用者は GROWI の AI の画面から開いて続けられ、削除もできる
- **Trade-offs**: 利用者が GROWI 側でその会話を削除すると、次の依頼で同じ id の新しい会話が作られる
- **Follow-up**: 会話の鍵は「同じスレッドなら同じ」という 1 つの決まりにする。チャンネルのスレッドでも同じ決まりが働くが、会話は利用者ごとに分かれる

### Decision: DM の権限は、`agent` だけ別の欄で決める

- **Context**: 要件 11.7 は、`agent` を DM で使わせるかを、チャンネルの設定とは別に決められることを求める。既存の決定 P16 は、「すべてのチャンネル」に DM を含める
- **Alternatives Considered**:
  1. 「すべてのチャンネル」なら DM も可、に加えて「DM も許す」欄を足す（欄は、一覧で絞った設定に DM を足すためだけに働く）
  2. コマンドの性質に「DM の扱い」を足し、`agent` は DM を別の欄だけで決める。ほかのコマンドは P16 のまま
- **Selected Approach**: 2。`CommandTraits.directMessagePolicy: 'follows-all-channels' | 'separate-flag'`
- **Rationale**: 1 では「チャンネルは全部許すが、DM では使わせない」を表せない。AI アプリの画面は中身が DM なので、これを切れる必要がある。性質として宣言すれば、判定の関数はコマンドの名前で分岐せずに済む
- **Trade-offs**: `ChannelRef` に `isDirectMessage` を足す。Gen 2 はまだリリースしていないので、古い proxy との互換は考えない

### Decision: 依頼の文章は、platform 層で bot への呼びかけを外してから渡す

- **Context**: DM の先頭の `@誰か` が落ちる（要件 15.17、proxy の「既知の問題」2）
- **Selected Approach**: platform 層が、bot 自身の id や名前を使って、bot への呼びかけだけを外した文章をイベントに載せる。command 層は、語の形で推測するのをやめる
- **Rationale**: bot 自身を知っているのは platform 層（アダプタ）だけである。呼びかけの形はサービスごとに違い（Slack は `@<bot の user id>`、Discord は `<@<application id>>`、Teams は `@<表示名>`、Mattermost は `@<bot のユーザー名>`）、proxy の調査で確かめてある
- **Trade-offs**: `PlatformEvent` の形が変わる。`search` など既存のコマンドの引数の取り方も、同じ文章から始まるようになる

### Decision: Slack のチャンネルでの答えの出し方

- **Context**: Slack は、返事の無いメッセージのスレッドに、本人にだけ見えるメッセージを表示しないことがある（`brief.md`「実現性の確認の結果」2）。実機ではまだ確かめていない
- **Alternatives Considered**:
  1. 全員に見える「受け付けました」を先にスレッドへ返して、スレッドを作る
  2. 依頼がすでにスレッドの中にあるときだけ、そのスレッドに出す。そうでないときは、今と同じくチャンネルの階層に、本人にだけ見えるメッセージを出す
- **Selected Approach**: 2 を既定にする。能力表に「返事の無いメッセージのスレッドに、本人にだけ見えるメッセージを出せるか」を足し、Slack は「未確認」にする。実機で表示されると分かったら、表を書き換えるだけで、スレッドに出すようになる
- **Rationale**: 1 は、依頼のたびに全員に見える投稿が 1 つ増える。受け付けたことは、既にリアクションで本人に示している（要件 15.5）
- **Follow-up**: 実機での確認をタスクに入れる

### Decision: 要約のページは、作った直後に自動削除の期限を外す

- **Context**: 上の Research Log「作成中（WIP）のページの自動削除」
- **Selected Approach**: `performWriteCommand` に、作成の選択肢（`wip`・`grant`）と「自動削除の期限を外す」を渡せるようにする。要約のページは `wip: true` で作り、続けて `unpublish()` と同じ状態（`wip` は真、期限なし）にして保存する
- **Rationale**: 「一度でも更新されたページは自動で消さない」という既存の考え方に合わせる。本文を書いたのは AI だが、頼んだのは本人であり、勝手に消えると困る
- **Trade-offs**: ページの保存が 1 回増える

### Decision: 依頼の種類の判断と要約には、会話の記録を使わない

- **Context**: `growiAgent` を会話の記録つきで呼ぶと、渡した文章がすべて利用者の会話に残り、後の依頼で読み直される
- **Selected Approach**: 種類の判断（質問か、要約か、パスの指定はあるか）と、要約の作成は、会話の記録なし・出力の形を決めた `generate` で行う。質問への答えだけを、会話の記録つきで行う
- **Rationale**: チャットの会話の全文が、利用者の AI の会話に残るのを避ける。要約の結果はページとして残る
- **Trade-offs**: 要約の依頼は、AI の会話の一覧に出ない（要件 15.18 に明記した）

### Decision: 出典のリンクは、呼び出す側が添える

- **Context**: `growiAgent` の指示文は、答えにリンクを書かないよう求めている。チャットには、出典を並べる画面が無い
- **Selected Approach**: 答えを作った実行の中で、ページを読む道具が開いたページを集め、題名と URL の一覧として答えに添える
- **Rationale**: `growiAgent` そのものは変えない（Out of Boundary）
- **Follow-up**: `generate` の戻り値から道具の実行結果を取り出す形は、実装の最初に確かめる

### Decision: Slack の AI アプリの画面は「GROWI の AI と話す欄」として扱う

- **Context**: AI アプリの画面は、Slack がサードパーティーのアプリ向けに用意した会話欄で、中身はアプリが返す。利用者はそこに、ふつうの文章で話しかける
- **Alternatives Considered**:
  1. 先頭の語がコマンド名なら、そのコマンドとして扱う
  2. 書かれた文章は、すべて `agent` の依頼として扱う
- **Selected Approach**: 2（2026-11-12 にユーザーが決定）
- **Rationale**: 1 では、「help me find …」「search for …」のような自然な文章が、別のコマンドとして動く。GROWI の AI は自分で検索できるので、`search` がこの欄で使えなくても困らない。例外の無い決まりの方が、利用者が予想しやすい
- **Trade-offs**: この欄では `search`・`create-page`・`help` を使えない。チャンネルとふつうの DM では使える

### Decision: 独立した確認（2026-11-12、NO-GO）で直した点

- 答えは 1 件の依頼につき 1 つだけ: 実行の側と掃除の側が同時に答えを書き留めうるので、書き留めの collection に一意の部分索引を張る。proxy も、届ける前に記録を「配達中」にする
- proxy が 10 秒で待つのをやめても、GROWI は受け付けて AI を動かしていることがある。時間切れは「失敗」ではなく「分からない」なので、依頼の記録を残し、答えが後から届くことがあると伝える
- `agentView` が無効の Slack の DM では、先頭の発言のスレッドの欄が空になる。DM の依頼は、依頼の発言そのものを根元とみなす
- `drain` の取った時刻を 1 件ごとの現在時刻にする。取り直しを 4 分に縮めると、開始時刻を全件に使う今の形では、送っている最中の行が取り直される
- 打ち切り時間は口ごとにする。通知は proxy が全部の宛先へ投稿し終えてから応答するので、一律 10 秒では、投稿できているのに失敗と数えられる

### Decision: 2 回目の独立した確認（2026-11-12、NO-GO）で直した点

- スレッドの根元を 2 つの欄に分けた。1 つの欄に「答えを置く場所」と「実際にスレッドの中で書いたか」を兼ねさせていたので、DM のスレッドの外での要約の依頼が、依頼の発言だけのスレッドを読んで、いつも「発言がありません」になっていた
- Slack のアダプタは、既定で 429 を約 30 分かけてやり直す（`@chat-adapter/slack` 4.38.1 の `index.d.ts` の `webClientOptions` の説明）。会話の読み取りだけは、やり直さずにすぐ返す呼び出しにした。app も、会話の求めの打ち切りを「時間を置いて」の答えにする
- proxy が答えを届けている途中で止まると、`delivering` が残り、送り直しが「届けた」と数えられて、答えが記録も無く失われていた。`delivering` は 2 分で取り直せるようにし、まだ新しいときは `in-progress` を返して GROWI に送り直させる。止まる直前に投稿が済んでいたときは 2 回届きうるが、黙って失うよりよい
- ほかに: Discord の続けられる場所を `'none'` に、GROWI 側の関門に権限の判定を足す、AI アプリの画面で聞き返しから抜け出せるようにする、打ち切られた `generate` を `signal.aborted` で見分ける、書き留めの collection の形を決める

### Synthesis（まとめ直した点）

- **一般化**: 「GROWI が proxy へ、あとから何かを送る」は、通知と答えで同じ問題である。書き留めに `kind` を足し、送り手は種類ごとの「1 件を送る」関数を表で受け取る。通知を直後に送る経路（要件 2.10）は、この仕組みの「書き留めたらすぐ送り始める」として 1 回だけ作る
- **既にあるものを使う**: 署名・口の表・`PrivateReplier`・`resolveActor`・`performWriteCommand`・`getOrCreateThread`・`isAiReady` は、そのまま使う。suggest-path は使わない（パスは本人のメモ置き場に決めた）
- **削ったもの**: 画面を開いたときの依頼の例の表示、利用者が見ているものの通知（`app_context_changed`）、少しずつの書き出し、止めるボタンへの対応、管理者が決める回数の上限。どれも要件に無い

## Risks & Mitigations

- **`agentView` を有効にすると、DM のスレッドの扱いが変わる** — 運用者が選ぶ設定にし、有効・無効の両方で、既存の「DM へ届け直す」「DM での聞き返し」の結合試験を回す
- **AI の実行の途中でプロセスが止まる** — 依頼を collection に書き留め、時間の上限を過ぎた「実行中」の行を定期処理が見つけて、失敗の答えを送る
- **同じ依頼が同時に 2 つ届き、AI が 2 回走る** — 依頼の行を、計算の前に一意の索引つきで書く
- **答えの文章（本人の権限で読める内容）がデータベースに残る** — 送れた時点で本文を消す。諦めた行は 7 日で消す
- **`keep` の権限の行が残っている** — migration で消す。読み出しでも、知らないコマンドの行は捨てる
- **更新の直後は、`agent` がどこでも断られる** — 仕様どおりの動き（管理者が許すまで使わせない）として、導入ドキュメントに書く
- **Slack の利用規約と、会話の要約の保存**（`brief.md`「実現性の確認の結果」4）— 法務の確認が要る。確認が済むまで、official proxy の導入ドキュメントには会話の要約を載せない
- **利用量の記録が、ブラウザの AI の利用と区別できない** — `growiAgent` の中で固定されているので、この spec では変えない

## References

- `brief.md`「実現性の確認の結果」— Slack・Mattermost・Teams の公式文書で確かめたことと、その出典
- [chat-integration-proxy の research.md](../chat-integration-proxy/research.md) — 決定 P2・P6・P8・P9・P12・P16、「既知の問題」
- [chat-integration-app の research.md](../chat-integration-app/research.md) —「複数台での排他と、通知の定期処理の間隔を延ばしたときの時間の変化」「通知の定期処理の間隔は、直後に送る経路と一緒に延ばす」
