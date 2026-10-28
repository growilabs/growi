# Research & Design Decisions — chat-integration-proxy

> 本書は proxy に固有の設計判断の根拠を持つ。いまは **本人宛ての返事の届け方**（umbrella の要件 1.6〜1.19・3.10〜3.14）だけを扱う。
> 4 つの spec に共通する決定 1〜14 は umbrella の `research.md` にある。番号がぶつからないよう、本書の決定には P を付ける（決定 P1 など）。
> 設計そのものは `design.md` の「PrivateReplier — 本人宛ての返事の届け方」と、そこから参照する各節。

## Summary

- **対象**: 本人宛ての返事（登録コード、紐付けの URL と案内、許可されていないことの案内、エラー、引数の聞き返し、本人にだけ返す管理コマンドの返事、検索の結果と注記）を、本人にだけ見えるメッセージか本人への DM で届けること
- **調べたもの**: インストール済みのアダプタ（`@chat-adapter/{slack,discord,teams}@4.38.1`、`chat-adapter-mattermost@1.1.3`）と `chat@4.38.1` のコード、各サービスの公式文書、本物のアダプタを使う結合試験（`src/platform/private-reply-adapters.integ.ts`。送信先の HTTP と Mattermost の WebSocket だけを手元の代役に置き換える）
- **Key Findings**:
  1. **Chat SDK の DM への切り替えは、アダプタに本人だけのメッセージの機能が無いときにしか働かない。** `ChannelImpl.postEphemeral`（`chat` の `dist/chunk-QNDIGWSS.js`）は、アダプタが `postEphemeral` を持てばそれを呼んで結果をそのまま返す。失敗しても DM に切り替えない。`fallbackToDM` が効くのは、アダプタが `postEphemeral` を持たない Discord だけである。しかも SDK が DM に送ると、どの依頼への返事かを示す見出し（要件 1.13）を付けられない
  2. **`ChannelImpl` 経由では、Mattermost の本人だけのメッセージは権限より前に必ず失敗する。** `ChannelImpl` は proxy のチャンネル id（Mattermost は `mattermost:` の付かない素の id）をそのままアダプタに渡す。Mattermost のアダプタの `decodeThreadId` は `mattermost:<base64>` の形以外で例外を投げるので、`/posts/ephemeral` は一度も呼ばれない。普通の投稿は素の id を受ける別の口（`postChannelMessage`）を通るので動いており、見落としやすい。スレッドの形の id（`channelThreadId`）を渡せば `/posts/ephemeral` に届き、そこで初めてシステム管理者の権限（`create_post_ephemeral`）の要否が効く
  3. **Chat SDK は DM のメッセージを mention として届ける**（`chat` の `dist/index.js` で、スレッドが DM なら `isMention = true`）。聞き返しへの答えを (チャンネル, 本人) で探すだけでは、DM で打たれた答えは見つからない。さらに、先頭の語を必ず呼びかけとして落とすと、DM で打った答えの最初の語が消える

## Research Log

### サービスごとの本人だけのメッセージと DM

- **Context**: 要件 1.7〜1.9（出せる・出せない・失敗する）をサービスごとに確かめる。
- **Sources Consulted**: 各アダプタの `postEphemeral`・`openDM`・`addReaction`・`fetchChannelInfo`、`ChannelImpl.postEphemeral`、各サービスの公式文書（References）
- **Findings**:
  - **Slack**: `chat.postEphemeral`。利用者か bot がチャンネルにいないと失敗する。届く保証は無く、再読み込みで消え、あとから書き換えられない。返事の無いメッセージのスレッドの中に出すと表示されないことがある。proxy は本人だけのメッセージをチャンネルの直下に出す（スレッドの部分が無い id を渡すので `thread_ts` が付かない）ので、この制約は効かない。DM は `conversations.open` で開き、**`im:write` の権限が要る**
  - **Discord**: アダプタに `postEphemeral` が無い。メンションへの返事を本人にだけ見せる手段は Discord 自体に無い（EPHEMERAL のフラグは interaction への応答にだけ使える）。DM は `openDM`
  - **Teams**: アダプタは本人だけのメッセージ（targeted message）を送る。Teams の文書では 24 時間で消える。DM は 1 対 1 の会話を作る。テナントの id と接続先が要り、アダプタは利用者が bot に呼びかけたときにそれを記録する（30 日で消える）。一度も呼びかけていない利用者には DM を開けない
  - **Mattermost**: `/posts/ephemeral` は `create_post_ephemeral`（今のところシステム管理者だけが持つ）を要し、普通の bot では 403 になる。DM は `/channels/direct`
  - **リアクション**: 4 つのアダプタとも `addReaction` を持つ。Chat SDK の共通の絵文字名に `eyes`・`email` があり、各アダプタが自分のサービスの名前に直す。Slack は `reactions:write`（マニフェストに有る）が要る
- **利用者が DM に書けるか**: DM を「開く」こと（Slack の `im:write`）と、利用者が bot との DM に「書き込める」ことは別の設定で決まる。Slack は App Home の Messages タブ（マニフェストの `features.app_home.messages_tab_enabled: true` と `messages_tab_read_only_enabled: false`）。Teams は、利用者が 1 対 1 の会話で bot に答えるのに、アプリを `personal` の範囲でも入れる必要があるかは確かめていない（下の「既知の問題」）
- **Slack の本人だけのメッセージの `ts` は作り物**: `chat.postEphemeral` が返す `message_ts` は、秒の部分が Slack の現在の秒で、小数部は時刻ではなく通し番号（`.001000`、`.001100`、`.001200` と、本人だけのメッセージ 1 通ごとに 100 ずつ増える）。利用者の本物のメッセージの ts は本物のマイクロ秒を持つ（例 `1793094041.008789`）。Slack は ts で並べるので、返事の並びは「依頼と同じ秒か、あとの秒か」で決まる（決定 P12）。`chat-integration-agent` の「スレッドの中の本人だけのメッセージ」の設計は、この並び方に頼る
- **installation の指定**: Mattermost は installation ごとに接続を持つので、installation が 2 つ以上開いていると、installation を名指ししない呼び出しは宛先のアダプタを決められない（`platform/index.ts` の `outboundContext`）。Slack はイベントの処理の中ならイベントから token を選べるが、イベントの外（あとで届ける返事）では installation を名指ししないと token が無い
- **Implications**: 本人だけのメッセージ → 失敗・未対応なら DM、の 2 段にする。DM に切り替えるかは SDK に任せず proxy 側で決める（決定 P2）。installation は 4 つの platform 呼び出しすべてに同じ値を渡す（決定 P9）

### 本物のアダプタで確かめたこと

`src/platform/private-reply-adapters.integ.ts`。各サービスの代役（`src/platform/chat-service-stand-in.ts`）は、サービスが返すと分かっている応答を返す。仮定した応答の上で確かめた試験は、名前に「assuming …」と書いてある。

- **DM のチャンネル id が一致する**: 4 サービスとも、`postDirect` が返す DM のチャンネル id と、利用者がその DM に書いたときのイベントの `channel.channelId` が同じ値になった。保存の検査（`parseSdkChannelId`）もその id を受け付ける。DM での答えを受け付ける仕組み（決定 P6）はこの一致に頼っている
- **DM の本文の先頭の形**: bot に呼びかけた DM の本文の先頭は、Slack が `@<bot の user id>`、Discord が `<@<application id>>`、Teams が `@<アプリの Teams での表示名>`、Mattermost が打たれたまま（`@<bot のユーザー名>`）。呼びかけの無い DM は、4 サービスとも本文がそのまま届く。決定 P8 の根拠
- **Discord**: `postEphemeral` は `unsupported` を返し、何も送らない（SDK の自動の DM を通らない）
- **Mattermost（installation が 2 つ開いている場合）**: `scope` が無いと宛先を決められず、何も送らない。`scope` を渡すと、proxy の素のチャンネル id のまま、その installation の接続から `/posts/ephemeral` に要求が出る。403 が返ったあと、同じ `scope` の `postDirect` は同じ installation の `/channels/direct` と `/posts` に届く
- **Teams のリアクション**: `eyes` は Teams の `1f440_eyes` に直るが、`email` はアダプタの対応表に無く、`email` のまま送られる
- **同じリアクションを 2 回付ける**: Slack は 2 回目に `already_reacted` を返し、`addReaction` はそれを成功として返す（アダプタのコードで確かめた）。Discord（204）・Mattermost（200）・Teams（200）は、2 回目も成功を返すと仮定した応答の上で確かめた

### 一覧の行のリンク

2026-10-27 に本物の Slack で、検索結果の行が `[タイトル](URL)` の文字のまま出て、URL の部分だけがリンクになっているのを見た。インストール済みのアダプタ（4.38.1。Mattermost は 1.1.3）のコードを読み、Slack は `cardToBlockKit` に実際に通して確かめた。

- **Slack**: `CardText` は `mrkdwn` の section（`muted` なら context）になる。変換は絵文字と `**太字**` → `*太字*` だけで、`[t](u)` はそのまま送られる。Slack の `mrkdwn` は `[t](u)` を知らないので文字のまま出る。これが見えた症状の原因。
  `CardLink` は `<url|label>` の section になり、リンクとして出る。一方、Card ではない `{ markdown }` の投稿（`postMessage`・`postEphemeral`）は `markdown_text` で送られ、Slack が markdown として描くので `[t](u)` もリンクになる。response_url での書き換えでは、アダプタが markdown を `mrkdwn` に直し、リンクを `<u|t>` にする
- **Discord**: `CardText` の中身はそのまま embed（または Components v2 の text display）に入る。Discord は `[t](u)` をリンクとして描く。`CardLink` は `[label](url)` になる。`muted` は `*…*`（斜体）で囲まれる
- **Teams**: `CardText` は Adaptive Card の TextBlock になる。TextBlock は `[t](u)` をリンクとして描く。`CardLink` は `[label](url)` の TextBlock になる。`muted` は `isSubtle`。Card の `subtitle` も薄い TextBlock として描かれる
- **Mattermost**: 能力表で `card` が `degraded` なので、proxy は Card を送らず markdown を送る。アダプタは markdown をいったん解析してから markdown に戻して送るので、`[t](u)` はリンクになる
- **Implications**: 一覧の行の中身を文字列に組み立てず、リンクを `CardLink` として渡せば、4 サービスとも各アダプタがそのサービスの書き方でリンクを描く。proxy 側にサービスごとの表は要らない（design.md の「一覧の描き方」）。
- **リンクの URL に入る文字**: GROWI はページのパスをエンコードせずにサイトの URL へつなぐ（app の `search-result-mapper.ts` の `urljoin(siteUrl, page.path)`）。そのため URL に空白・`|`・`(`・`)`・`[`・`]`・`` ` `` が入りうる。
  これらはリンクの書き方の区切りと同じ文字なので、そのまま送るとリンクが途中で切れる。Slack の `<url|label>` では、URL の中の `|` から後ろがリンクの文字として読まれ、別のページへのリンクになる。`[label](url)`（Discord・Teams・Mattermost）では、空白や `)` でリンクが終わる。`` ` `` はパスの最後の部分（＝リンクの文字）と URL の両方に入るので、markdown が `](` をまたいで 2 つの `` ` `` を組にしてコードとして読み、リンクが消える（Mattermost で `` [a`b](https://g.example/a`b) `` を解析して戻すと、ただの文字になる。`%60` にすればリンクのまま残る）。Mattermost のアダプタは markdown をいったん解析してから戻すので、そこでリンクでなくなる。
  アダプタはどれも URL をエンコードしない。そこで proxy が `platform/outbound.ts` で、これらの文字と `<` `>` だけをパーセントエンコードしてから `CardLink` と markdown のリンクに渡す。`%` やその他の文字は変えないので、すでにエンコード済みの URL を二重にエンコードしない
- **リンクの文字（label）**: Slack では label の中の `|` は区切りとして扱われず、そのまま表示される。一方、markdown で描くサービス（Discord・Teams・Mattermost）では、組になっていない `[` や `]`、リンクの形をしたタイトル（`foo]` や `[x](https:evil.example)` など）があると、リンクの文字の側が崩れる。
  これはこの変更で生まれたものではない（以前のコードも同じ `[title](url)` を組み立てていた）。バックスラッシュでエスケープすると Slack では `\` がそのまま見えてしまい、サービスごとに扱いを変えるにはサービス名での分岐が要る。また、これを悪用できるのはページを編集できる人だけで、その人はもともとページ本文に任意のリンクを書ける。そのため、あえて対処しない
- **文字参照を含むパス（既知の制限）**: パスに `&lt;` のような HTML の文字参照がそのまま入っていると、Slack の `<url|label>` と、Mattermost のアダプタの解析と組み立て直しで `<` として読まれる。まれなので対処しない
- **薄い文字で出す補足**: パスは Slack の context（mrkdwn）と Discord の `*…*` の中にそのまま入るので、パスに `_x_` や `~x~` があると斜体や取り消し線になる。今は対処しない

### 引数の聞き返しと DM

- **Context**: 要件 1.16（DM で聞き返したら DM での答えを受け付ける）。
- **Sources Consulted**: `src/command/argument-collector.ts`（`resume`）、`src/orchestration/event-sink.ts`、`src/db/repositories/pending-collection-repository.ts`、`prisma/schema.prisma`（`PendingCollection`）、`src/platform/event-mapping.ts`
- **Findings**:
  - `resume` は mention を (platform, チャンネル, 本人) で探す。DM での答えはチャンネルが違うので、そのままでは見つからない
  - `toRecord` は、保存した invocation のチャンネルと行のチャンネルが一致しない行を捨てる。答えを受け付けるチャンネルを別の列で持てば、この検査と衝突しない
  - 答えを受け付けたあとの処理は、保存した invocation（元のチャンネル）で installation を引く。DM のチャンネルで installation を引く箇所は無いので、「DM で installation を特定できない」不具合（umbrella の roadmap「リリース前に直すもの」の 3）に依存しない
  - DM かどうかは、推測ではなく対応付けの段階（`event-mapping.ts`。スレッドが DM かを知っている）で印を付けられる
- **Implications**: 決定 P6・P8

### 運用者への報告

- **Sources Consulted**: `src/runtime/dependencies.ts`（`ProxyReporters.reportOperationalFailure`）、`src/platform/index.ts`（`createPlatformFacade` の `reportOperationalFailure`）
- **Findings**: proxy は自前の logger を持たず、運用者に見せる事実は注入された `reportOperationalFailure` に渡す。最も外側（`runtime/`）が標準エラー出力に書く
- **Implications**: 同じ関数を `PrivateReplier` に注入する。返事の内容は渡さない（要件 1.12）

### DM に落ちる経路は Slack の実機では起こせない

- **Findings**: Slack では、bot がいないチャンネルでの呼びかけはそもそもイベントが proxy に届かない。引数の聞き返しは依頼の直後、本人がチャンネルにいる間に出るので、本人だけのメッセージが成功する。DM に落ちるのは、依頼のあとで本人がチャンネルを抜けるといった、返事を出す直前の競合に限られる
- **Implications**: DM に落ちる経路（見出し、封筒のリアクション、内容を含まない知らせ、DM での答え）は、実機試験の手順に入れず、単体試験（`command/private-reply.spec.ts`・`command/argument-collector.spec.ts`）と結合試験（`platform/private-reply-adapters.integ.ts`）で守る。実機試験の手順（`docs/manual-e2e-slack.md`）もそう書いている

### Discord の Gateway の生涯

- **Context**: Discord の DM と mention は Gateway（Discord への常時接続の WebSocket）でしか届かない。アダプタは初期化しただけでは Gateway を開かない（Slack は `initialize` の中で Socket Mode を開くので違う）。
- **Sources Consulted**: `@chat-adapter/discord@4.38.1` の `dist/index.js`（`startGatewayListener`・`runGatewayListener`・`setupLegacyGatewayHandlers`・`handleGatewayMessage`・`initialize`）、`@discordjs/ws@1.2.3` の `dist/index.js`（`WebSocketShard.onClose`）
- **Findings**:
  - `startGatewayListener(options, durationMs = 180000, abortSignal?, webhookUrl?)` は、ログインを待たずにすぐ `Response` を返す。アダプタが Chat のインスタンスで初期化されていない（`initialize(chat)` を呼んでいない）とき、または `options.waitUntil` が無いときは 500 を返し、何も始めない。それ以外は 200 を返し、聞き続ける処理の promise を `waitUntil` に渡す。promise はここからしか受け取れない
  - 聞き続ける処理は、discord.js の Client を作ってログインし、`durationMs` が過ぎるか `abortSignal` が abort されるまで待ってから Client を壊す。**1 回の呼び出しで聞くのは決まった長さの間だけ**なので、常駐するには呼び直し続けるしかない。abort を待ち始めるのはログインが終わったあとなので、ログインの途中で abort しても、ログインが終わるまで Client は壊れない。Client を壊す `client.destroy()` は待たずに呼ばれるので、聞き続ける処理の promise は WebSocket が閉じ切る前に終わる
  - abort の listener は `{ once: true }` で signal に付けられ、期間が時間切れで終わったときは外されない
  - 期間の途中で接続が切れたとき、`@discordjs/ws` は close code ごとに、同じセッションを続ける（Resume）か、新しく接続し直す（Reconnect）。ただし、認証の失敗（4004）・許されていない intent（4014）・不正な intent・shard の誤り・API の版の誤りでは、エラーを出して接続し直さない。この場合、その期間が終わるまで Gateway は止まったままになる（コードを読んで確かめた。実機では起こしていない）
  - ログインの失敗（トークンの誤り、Message Content Intent が無効で close code 4014 など）は、アダプタが自分のログに書いて握りつぶす。promise は失敗にならず、すぐに終わる。**外から見える失敗の印は「期間より早く終わった」ことだけ**である
  - `durationMs` は `setTimeout` に渡される。2^31-1 ms を超える値は 1 ms として扱われ、すぐ終わってしまう
  - `webhookUrl` を渡さないと、届いたメッセージ・リアクション・interaction をアダプタが自分で処理し、初期化に使った Chat のインスタンスの `handleIncomingMessage` などに渡す。proxy は platform ごとの Chat のインスタンスに `registerEventHandlers` で処理を登録しているので、Slack の Socket Mode と同じ入口（`onNewMention`・`onNewMessage`）に入る
  - アダプタには `disconnect` が無い。止めるには `abortSignal` を使うしかない
  - mention がスレッドの外で届くと、アダプタはそのメッセージに Discord のスレッドを作り、スレッドを宛先にしてイベントを渡す
- **Implications**: 決定 P13

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 判断を platform 層に置く | `PlatformFacade` に「本人に届ける」を 1 つ足し、中で本人だけ → DM → 知らせ を決める | 呼ぶ側が最も単純 | 見出しの文言、運用者への報告、場所の名前の引き当て（`db/`）が platform 層に入る。platform 層は Chat SDK を包む層で、文言と方針を持たない | 不採用 |
| **B. 仕組みは platform、判断は command 層の 1 か所** | platform に「本人だけ」「DM」「リアクション」の 3 つの仕組みを置き、`command/private-reply.ts` が順番・見出し・知らせ・報告を決める | platform 層は仕組みだけのまま。`command/`・`orchestration/` の両方から使える（層の順で左にある） | 呼ぶ側が直接 `postEphemeral` を呼べると判断を飛ばせる → 呼ぶ側の型から外し、層の試験で検査する | **採用** |
| C. 判断を orchestration 層に置く | `command-flow` の `tell` を広げる | 変更が少ない | `argument-collector`（`command/`）が使えない（層の順で右の層を import できない） | 不採用 |

## Design Decisions

### 決定 P1: 届け方の判断を `command/private-reply.ts` の 1 か所に集め、呼ぶ側の型から `postEphemeral` を外す

- **Context**: 要件 1.6 は「チャンネルの全員に見える形にしない」という保証である。判断が呼び出し元ごとに散ると、1 か所の書き忘れで崩れる。
- **Alternatives Considered**: 上の表の A・C。各呼び出し元で個別に DM へ切り替える案（散らばりが残る）。
- **Selected Approach**: B。`CommandFlowPlatform`・`AdminFlowPlatform`・`ArgumentCollectorPlatform` は `postEphemeral` を持たず、代わりに `PrivateReplier` を受け取る。書き忘れは型の検査で止まる。加えて `architecture.spec.ts` が「`src/platform/**` の外で `postEphemeral(`・`postDirect(` を呼ぶのは `command/private-reply.ts` だけ」を確かめる（facade は注入されるオブジェクトなので、import の検査ではこれを表せない）。
- **Rationale**: 守りを型と試験に任せ、レビューの注意力に頼らない。
- **Trade-offs**: 呼ぶ側の依存が 1 つ増える。呼ぶ側の型には `post`・`replace` が残るので、「本人宛てにすべき返事を誤ってチャンネルに出す」ことは型では止まらない。検索の結果はこの道でチャンネルに出うるので、`command-flow.spec.ts` と `testing/command-flow-e2e.integ.ts` が「`search` は `post`・`replace` を呼ばず、結果は本人宛ての返事 1 通で届く」を確かめる。

### 決定 P2: DM への切り替えは Chat SDK に任せず proxy が行い、本人だけのメッセージは `ChannelImpl` を通さずアダプタを直接呼ぶ

- **Context**: Key Findings 1・2。
- **Selected Approach**: `platform/outbound.ts` の `postEphemeral` は、`channelThreadId(adapter, platform, channelId, null)` で作ったスレッドの形の id を宛先にして、アダプタの `postEphemeral` を直接呼ぶ（`replace`・`attachPreview` と同じやり方）。アダプタに機能が無ければ `unsupported` を返し、何も送らない。DM は別の操作 `postDirect` で送る。結果の型は `PostOutcome` を広げず、本人だけのメッセージ（`EphemeralPostOutcome`）・DM（`DirectPostOutcome`）・リアクション（`ReactionOutcome`）にそれぞれ専用の型を置く（`post`・`replace`・`attachPreview` の呼び出し側に、起こりえない場合を扱わせない）。
- **Rationale**: `fallbackToDM` を切るなら `ChannelImpl` に任せる意味が無い。しかも `ChannelImpl` は素の id を渡すので Mattermost で必ず失敗する。`ChannelImpl` を通さずに失う処理はコールバックの URL の差し込み（`processCallbackUrls`）だけで、本人宛ての返事のカード（選択肢）はボタンの id で答えを受け取りコールバックの URL を使わないので、影響は無い。
- **Trade-offs**: SDK の `ChannelImpl` の振る舞いが変わっても追従しない。Chat SDK を更新するときは、`postEphemeral`・`openDM`・`addReaction` の振る舞いを突き合わせる（design.md の Revalidation Triggers）。

### 決定 P3: 本人だけのメッセージが失敗したら、失敗の種類を問わず DM へ進む

- **Context**: 要件 1.9 は「失敗したら DM で届け直す」で、失敗の種類を区別しない。
- **Alternatives Considered**: 失敗の種類（bot がチャンネルにいない、権限が無い、サービスの障害）ごとに、DM に進むか利用者に案内するかを分ける。
- **Selected Approach**: `bot-not-in-channel`・`platform-error`・`unsupported` のどれでも DM へ進み、利用者には何も出さない。
- **Rationale**: どの失敗でも、本人は返事を見ていない。DM は返事の内容をチャンネルに出さない道なので、どの場合に進んでも安全である。また、失敗の種類はいつも正しく見分けられるわけではない（Mattermost の権限不足の 403 は `bot-not-in-channel` に分類される。下の「既知の問題」1）。種類で分けると、その見分けの誤りがそのまま返事の取りこぼしになる。
- **Trade-offs**: Mattermost で権限が無い間は、毎回いったん失敗してから DM に送る。1 回分の無駄な API 呼び出しは許容する（権限の有無を覚えておく仕組みは足さない。簡素さを優先）。

### 決定 P4: 「DM に届いた」「受け付けた」の知らせは、依頼のメッセージへのリアクションにする。付けられなければ内容を含まない短い文にする

- **Context**: 要件 1.10（DM に届いたことを内容なしで知らせる）と 3.12（検索を受け付けたことを知らせる）。Slack の本人だけのメッセージは書き換えられないので、「検索しています…」を結果で差し替える段取りは本人宛てには使えない。
- **Alternatives Considered**: 本人だけの「検索しています…」を出して、結果は別のメッセージで届ける（Discord では DM が 2 通になる）。チャンネルに短い文を出す（Discord では毎回チャンネルに文が残る）。
- **Selected Approach**: 受け付けたら依頼のメッセージに `eyes`、DM に届けたら `email`（封筒）のリアクションを付ける。付けられないとき（依頼のメッセージが無い、サービスが拒んだ）は、受け付けの知らせは本人宛ての返事として「「…」を検索しています…」を出し、DM の知らせは「<表示名> さん、返事を DM で送りました。」という内容を含まない短い文をその場に出す。同じリアクションが既に付いているとき（Slack の `already_reacted`）は成功として扱う。
- **Rationale**: リアクションは内容を含まず、チャンネルに文を増やさない。1 つの依頼から本人宛ての返事が何通も DM に届く（GROWI ごとの紐付けの案内と結果、複数の聞き返し）ので、2 通目以降で短い文に落ちないよう「既に付いている」を成功にする。
- **Trade-offs**: リアクションは誰からも見える（何かを頼んだことは分かる）。頼んだこと自体は、メンションが全員に見えている時点で既に見えている。次の場面ではリアクションが付かず短い文になるが、どれも返事の内容は出ないので受け入れる: Teams（`email` を直せない）、Discord の既存のスレッドの中での依頼（リアクションの宛先が親のチャンネルになって失敗しうる）、依頼のメッセージが無い依頼（slash command から始まった依頼など。下の「既知の問題」4）。

### 決定 P5: DM の見出しに使う場所の名前は、保存済みのチャンネル一覧から引く

- **Context**: 要件 1.13（DM だけを読んで、どの場所の何の依頼への返事か分かる）。
- **Alternatives Considered**: アダプタの `fetchChannelInfo` で毎回引く（API の往復が 1 回増え、Teams などで権限の問題が出うる）。
- **Selected Approach**: `installation_channel.channel_name` を引く（`runtime/describe-place.ts`）。コマンドはチャンネル一覧で installation を引けたときにしか走らないので、名前はほぼ必ずある。無いときは「元のチャンネル」と書く。依頼の要約は `${commandName} ${argsText}` の 1 行目を 80 文字で切ったもの（`privateReplyOriginOf`）。`create-page` の引数はページの本文を含みうるので、見出しに本文を丸ごと載せない。
- **Trade-offs**: 新しい表は作らない。一覧に載っていない場所（DM など）では「元のチャンネル」になる。

### 決定 P6: DM で聞き返したら、答えを受け付けるチャンネルを `pending_collection` の行に持つ。同じ DM では新しい聞き返しが勝つ

- **Context**: 要件 1.16。Discord では、1 人の利用者と bot の DM は 1 つしか無い。チャンネル A の `search` とチャンネル B の `create-page` が同時に聞き返しを DM に出すと、DM での答えがどちらへのものか決まらない。
- **Selected Approach**: `pending_collection` に `answer_channel_id`（null 可）を足す。聞き返しが DM に届いたら、その DM のチャンネルを書く（`routeAnswersVia`）。同じ (platform, `answer_channel_id`, 本人) の古い行があれば、その行の `answer_channel_id` を消す。`findInFlight` は、まずイベントのチャンネルで探し、見つからなければ `answer_channel_id` で探す。DM で新しいコマンドを打っても、DM に経路を向けただけの行（元は別のチャンネルの依頼）は破棄しない。
- **Rationale**: 既存の「新しいコマンドが優先される」規則と同じ向き。行を消さないので、古い依頼は元のチャンネルで引き続き答えられる。

### 決定 P7: `routeAnswersVia` は transaction を開かず、1 つの UPDATE 文で行う

- **Context**: 「古い行の経路を外す」と「この行に書く」は同時に起きなければならない。片方だけが起きると、1 つの DM が 2 つの依頼に答えうる。
- **Alternatives Considered**: 2 つの更新を Prisma の `$transaction` で包む。
- **Selected Approach**: `UPDATE ... SET answer_channel_id = CASE WHEN correlation_id = 対象 THEN DM ELSE NULL END FROM pending_collection AS target WHERE ...` の 1 文で、対象の行と、同じ platform・本人で同じ DM を持つ他の行をまとめて書き換える。対象の行が無ければ例外を投げる。
- **Rationale**: repository は transaction を自分で開かない（`db/prisma-client.ts` の `DbClient` の約束。transaction を開くかは、作業の単位を知っている 1 つ上の層が決める）。PostgreSQL の 1 文は単独で不可分なので、この約束を崩さずに 2 つの書き換えを同時に起こせる。

### 決定 P8: DM で打たれた文は、先頭の語が呼びかけの形のときだけ落とす

- **Context**: Key Findings 3。DM の本文には呼びかけが無いことが多い。
- **Selected Approach**: `event-mapping.ts` が mention に `inDirectMessage`（スレッドが DM か）を付ける。`CommandInvocation.normalize` と `stripAddressToken` は、チャンネルでは先頭の語をいつも落とす。DM では、先頭の語が `@語` か `<@…>` の形のときだけ落とす（`invocation.ts` の `BOT_ADDRESS_SHAPE`）。
- **Rationale**: 本物のアダプタで確かめた呼びかけの形（上の「本物のアダプタで確かめたこと」）は、4 サービスともこの 2 つの形に収まる。command 層には bot 自身の名前や id が届かないので、名前で突き合わせることはできない。
- **Trade-offs**: DM の答えが `@誰か` で始まると、その語が落ちる（下の「既知の問題」2）。DM で `search foo` と打てばコマンドとして読まれるが、DM での installation の特定は別の不具合（umbrella の roadmap「リリース前に直すもの」の 3）なので、「workspace がまだ登録されていません」と返る。

### 決定 P9: 返事の宛先の情報に installation を持たせ、4 つの platform 呼び出しすべてに同じ値を渡す

- **Context**: 上の Research Log の「installation の指定」。
- **Selected Approach**: `PrivateReplyOrigin.installationId: string | null`。`command-flow` と `admin-flow` は、すでに引いた値を渡す。分からない呼び出し元（`argument-collector`、「workspace がまだ登録されていません」の返事、入力の期限切れの知らせ）は `null` を渡し、`PrivateReplier` が依頼のチャンネルから既存の `resolveInstallationId` で引く。引いた installation を、本人だけのメッセージ・DM・リアクション・知らせの 4 つすべてに同じ `scope` として渡す。引けなければ `scope` 無しで呼ぶ。
- **Trade-offs**: `null` のときにチャンネル一覧を 1 回引く。DM の中で届いたイベントでは引けない（下の「既知の問題」5）。

### 決定 P10: 届けられなかった返事を受けた呼び出し元は、重ねて知らせない

- **Context**: `PrivateReplier` は `undeliverable` のとき、内容を含まない知らせと運用者への報告を済ませている。
- **Selected Approach**: `ArgumentCollector` の `StartOutcome` の `unavailable` は理由を持たない。`CommandFlow` は `unavailable` を受けても利用者に何も言わない。
- **Rationale**: 呼び出し元が重ねて知らせると、知らせも報告も 2 回になる。

### 決定 P11: 利用者が DM に書けるようにする設定を、導入の手順に含める

- **Context**: 要件 1.16 は、利用者が bot との DM に書き込めることが前提。
- **Selected Approach**: Slack のマニフェストに `im:write` と、`features.app_home.messages_tab_enabled: true`・`messages_tab_read_only_enabled: false` を入れる（`docs/setup-slack.md`・`docs/manual-e2e-slack.md`）。導入済みの workspace は導入し直さないと `im:write` を持たない。
- **Trade-offs**: 導入し直すまでは、本人だけのメッセージが失敗したときに DM に落ちず、内容を含まない知らせになる。返事の内容がチャンネルに出ることは無い。

### 決定 P12: Slack の本人だけのメッセージは、依頼のメッセージの次の秒まで待ってから出す

- **Context**: Slack で、bot の本人だけのメッセージ（返事）が、利用者自身の依頼のメッセージより上に並ぶことがある。proxy は依頼のイベントを、依頼の ts の 0.3〜0.6 秒後に受けるので、すぐ出すと依頼と同じ秒に入りやすい。
- **Evidence**（実機 5 回の手動試行の全件。時刻はタイミング記録 `CHAT_INTEGRATION_TRACE_PRIVATE_REPLY_TIMING=1` で取った）:

  | 試行 | 依頼の ts | 返事の `message_ts` | 依頼と同じ秒か | 実際の並び |
  |---|---|---|---|---|
  | 1 | 1793094041.008789 | 1793094041.001000 | 同じ秒 | 依頼の上 |
  | 2 | 1793094048.046589 | 1793094048.001100、1793094048.001200 | 同じ秒（2 通とも） | 2 通とも依頼の上 |
  | 3 | 1793094055.650889 | 1793094056.001300、1793094056.001400 | 次の秒（2 通とも） | 2 通とも依頼の下 |
  | 4 | 1793094064.140309 | 1793094064.001500、1793094065.001600 | 同じ秒、次の秒 | 前者が上、後者が下 |
  | 5 | 1793094077.494289 | 1793094077.001700、1793094078.001800 | 同じ秒、次の秒 | 前者が上、後者が下 |

  「同じ秒なら上、次の秒なら下」の予測が 5 回すべてで合った。
- **Selected Approach**: 待つかどうかはサービスごとの表 `EPHEMERAL_MUST_FOLLOW_REQUEST_SECOND`（`capabilities/platform-capabilities.ts`。今は Slack だけ `true`）で宣言し、Slack では、依頼の ts の秒の次の秒の頭 + 時計のずれの余裕（250 ms）まで待ってから `chat.postEphemeral` を呼ぶ。待ちは最大 1500 ms で、その時刻をすでに過ぎていれば待たない。依頼の id は `PrivateReplier` が `origin.sourceMessageId` から `postEphemeral` の `scope.requestMessageId` に渡す。Slack の ts の形（`^\d+\.\d+$`）でないときは待たない。時計と sleep は差し替えられるので、試験は実時間を待たない。
- **Rationale**: 並びを決めるのは ts で、呼び出す側が ts を指定できない。次の秒へ送れば、小数部の通し番号が何であっても依頼より後ろに並ぶ。上限を置くのは、proxy の時計が大きくずれていても返事を止めないため。
  余裕の 250 ms が守るのは、proxy の時計が Slack の時計より進んでいるときだけである。proxy の時計が Slack より遅れている場合は、proxy が目標の時刻に着いたとき、Slack の時計はもう「依頼の次の秒 + 余裕」を過ぎている。待ちが上限に当たっても、投稿は Slack の時計で「依頼の ts + 1.5 秒以上」になり、次の秒に入るので、対策は効く。危ないのは proxy が Slack より 250 ms を超えて進んでいる場合で、待ちが短く、または 0 になり、返事が依頼と同じ秒に入りうる。タイミング記録の `request_ts` と `returned_id` の整数部（秒）が同じなら、その返事は依頼の上に出る。
- **Alternatives considered**:
  - `thread_ts` を付けてスレッドの中に出す: 依頼にスレッドが無いと表示されないことがあり（上の「サービスごとの本人だけのメッセージと DM」）、チャンネル直下に出す今の作りを変えてしまう
  - あとから本人だけのメッセージを差し替えて並べ直す: Slack は本人だけのメッセージを書き換えられない
  - 待たない: 依頼と同じ秒に入る場合が多く、上に並ぶ問題が残る
- **Trade-offs**: 返事が最大でおよそ 1.25 秒遅れる（依頼の次の秒の頭までの残り + 余裕。proxy の時計が Slack より遅れているときの最悪値は上限の 1.5 秒）。余裕の 250 ms は、proxy と Slack の時計のずれが分からないまま置いた未検証の初期値で、実機で確かめて直す。待ちは本人だけのメッセージの投稿の前に入るので、それが失敗して DM に進む場合は DM も同じだけ遅れ、依頼にリアクションを付けられないときの `acknowledge`（本人だけのメッセージで「検索しています…」を出す経路）も同じ待ちを受けて、検索の問い合わせの開始が遅れる。DM を直接出す経路とリアクションそのものは並びの問題が無いので待たない。

### 決定 P13: Discord の Gateway は `app:discord` のロックを持つ間だけ、24 時間ずつ呼び直して開き続ける

- **Context**: 上の「Discord の Gateway の生涯」。同じ bot トークンで 2 つの Gateway を開くと、すべてのイベントが 2 回処理される。
- **Selected Approach**:
  - Gateway を開くのは、`ConnectionManager` が `app:discord` のロックを取って接続を開くとき（`platform/index.ts` の `openConnection`）。閉じるのは、ロックを失ったときと終了するとき（`closeConnection`）。サービス名で分けず、`ADAPTER_FACTORIES` のエントリに「1 回分の期間だけ聞く」関数 `startListenerWindow` を持たせ、持っているサービスだけで動かす。今は Discord だけが持つ
  - 呼び直しは `platform/listener-loop.ts` が受け持つ。期間は 24 時間（`LISTENER_WINDOW_MS`）。期間いっぱい聞いて終わったら、すぐ次を開く。早く終わったら（＝ログインの失敗）運用者への報告（`reportOperationalFailure`）に経過時間と次の試行までの待ちを書き、5 秒から倍々で最大 5 分まで待ってから開き直す。期間いっぱい聞けたら待ちを最初に戻す。開き直しが拒まれたときも同じく報告して待つ
  - 最初の 1 回が開けないとき（500 が返ったとき）だけは、接続を開く処理そのものを失敗させる。`ConnectionManager` がロックを返し、自分の間隔で再試行する
  - 閉じるときは abort してから、聞き続ける処理が終わるまで待つ。終わった時点で、アダプタはイベントの処理をやめ、Client を閉じ始めている（アダプタは `client.destroy()` の完了を待たないので、WebSocket はまだ閉じている途中のことがある）。そのあとでロックを返すので、別のインスタンスが Gateway を開く時点では、こちらはもうイベントを処理しない。ただし待つのは最大 5 秒（`STOP_WAIT_MS`）で、超えたら運用者への報告に残して先へ進む。閉じる処理は `ConnectionManager` の周回の中で走るので、ログインが長引いたときに待ち続けると、他の接続のロックの延長が止まって期限が切れ、別のインスタンスとの二重処理を招くため。超えた場合の短い重なりは、design.md の「(c) で閉じ終わるまでの短い間」と同じく、state による重複の取り除きが受け止める。開き直しの途中で止められたときは、開きかけの期間も同じく待つ。間隔を空けている間の abort は、待ちをすぐ終わらせる
  - 期間ごとに新しい `AbortController` を作り、その期間にだけ渡す。アダプタは期間が時間切れで終わっても abort の listener を signal から外さないので、1 つの signal を使い回すと、終わった期間の Client がその listener から参照され続けてメモリに残る
  - `webhookUrl` は渡さない。イベントは他のサービスと同じ入口に入る
- **Rationale**: 1 回の期間を長くするほど、開き直しの回数（＝開き直しのログインの間に送られたイベントを取りこぼす回数）が減る。24 時間はタイマーの上限（約 24.8 日）より十分短く、1 日 1 回の短い切れ目で済む。期間の途中の切断は discord.js が自分で再接続する。
- **Trade-offs**:
  - 開き直しのたびに、ログインの間（数秒）に送られたイベントは届かないと見込む。開き直しは新しいセッションを始める（Resume しない）ためで、Discord が前のセッションの間のイベントを新しいセッションに送らないことは Gateway の仕組みからの推定であり、実機では確かめていない
  - 期間の途中で、接続し直さない種類の切断（上の Findings。例: 運用中に bot トークンを作り直した）が起きると、その期間が終わるまで最大 24 時間、Discord のイベントが届かない。proxy はこれを検知しない。トークンを作り直したら proxy を再起動する（`docs/setup-discord.md`）
  - ログインに失敗し続けても、`ConnectionManager` の状態は `connected` のままになる。接続を開く処理はログインを待たずに終わり、ログインの成否は外から分からないため。失敗は運用者への報告に毎回残る。アダプタのログの文言を読んで判定する作りは、アダプタの更新で黙って壊れるので採らない
  - ログインの失敗の理由そのものは、アダプタのログ（標準出力）にしか出ない。proxy の報告は「早く終わった」ことと経過時間だけを書く

## Synthesis

- **Generalization**: 「本人に届ける」は、検索の結果・聞き返し・エラー・登録コードに共通する 1 つの問題として扱う。インターフェースは「何の依頼への、どの installation としての返事か」を受け取る形である。あとから（イベントの処理の外で）届ける返事も、installation を名指しすれば token の問題は解ける。ただし「スレッドの中で本人だけに見せる」ためのスレッドの根元は持たないので、それが要る機能（`chat-integration-agent`）が `PrivateReplyOrigin` に足す（design.md の Revalidation Triggers）
- **Build vs. Adopt**: Chat SDK の `fallbackToDM` を採らない理由は決定 P2。リアクションと DM はアダプタの既存の機能を使う
- **Simplification**: 権限の有無を覚える仕組み、DM の既読の確認、届いたかの追跡は足さない。能力表に足すのは `directMessage` の 1 行だけである

## Risks & Mitigations

- Slack の既存の導入は `im:write` を持たない — 導入し直すまで、DM に切り替えられず内容を含まない知らせだけになる。導入ドキュメントに「導入し直す」と書いてある
- Mattermost で権限が無い運用者は、毎回 1 回分の失敗する呼び出しを払う — 導入ドキュメント（`docs/setup-mattermost.md`）で、権限を与えるか DM で受け取るかを選べることが書いてある
- Mattermost の本人だけのメッセージの id の形の問題が再発する — 本物のアダプタに proxy の id を渡し、`/posts/ephemeral` への要求が実際に出ることを結合試験で確かめる（HTTP の 403 を真似るだけの試験では、要求の前の例外を見逃す）
- Slack の Messages タブの設定が無い導入では、DM の聞き返しに答えられない — マニフェストと導入ドキュメントに含まれている
- DM で打たれた本文の先頭の扱いが、本物の本文の形と食い違う — 4 サービスの本文を本物のアダプタの試験で確かめており、その形が試験の中に事実として書いてある

## 既知の問題（未解決）

1. **Mattermost の 403 が「bot がチャンネルにいない」と分類される。** `/posts/ephemeral` が権限不足（`create_post_ephemeral` が無い）で 403 を返すと、`classifyOutboundFailure`（`platform/outbound.ts`）は `bot-not-in-channel`（「bot を招待して」）と分類する。アダプタが投げる `PermissionError` は応答の本文を持たないので、権限不足とチャンネル不参加を見分けられない。利用者への影響は無い（決定 P3 によりどちらでも DM に進む）が、DM も届かなかったときの運用者向けの報告（`reportUndeliverable`）に誤った理由が載る。今の分類は `platform/private-reply-adapters.integ.ts` の Mattermost の試験（「reaches /posts/ephemeral with the proxy's bare channel id …」）が固定しているので、分類を直すとその試験が落ちて気づける。`docs/setup-mattermost.md` にも既知の不整合として書いてある
2. **DM の先頭の `@誰か` が落ちる。** 決定 P8 の規則は形で判定するので、DM での答えが `@誰か` で始まると、その語が呼びかけとして落ちる。command 層は bot 自身の名前や id を知らないので、今の作りでは避けられない。直すなら、platform 層が「呼びかけの語を外した本文」を渡す形に変える
3. **Teams と、2 回目のリアクションは一部が未確認。** Teams の `email` リアクションはアダプタの対応表に無く、Teams が受け付けるかは実機で確かめていない（受け付けなければ短い文の知らせに落ちる。決定 P4）。同じリアクションの 2 回付けが成功になることは、Slack だけアダプタのコードで確かめた。Discord・Mattermost・Teams は仮定した応答の上での確認である。Teams で、利用者が 1 対 1 の会話で bot に答えるのにアプリを `personal` の範囲でも入れる必要があるかも未確認（`docs/setup-teams.md`）
4. **依頼のメッセージが無い依頼では、DM に届くたびにその場に短い文が出る。** slash command から始まった依頼は依頼のメッセージの id（`sourceMessageId`）を持たない（`sourceMessageId` が無い古い保存済みの行から再開した依頼も同じ）ので、リアクションを付けられない。DM に届くたびに「返事を DM で送りました」という内容を含まない文がその場に出る。うるさいが、返事の内容は漏れない
5. **Mattermost で installation が複数あるとき、DM の中で届いたイベントの「入力の期限切れ」の知らせは installation を引けない。** `reportExpired`（`orchestration/command-flow.ts`）はイベントのチャンネル（DM）を宛先にし、`installationId` を `null` で渡す。DM はチャンネル一覧に載らないので `resolveInstallationId` が引けず、`scope` 無しの呼び出しは宛先の接続を決められずに失敗する（その場合は運用者への報告だけが残る）
6. **DM に落ちる経路は Slack の実機では起こせない**（上の Research Log）。結合試験と単体試験で守る
7. **（本機能の外）`src/testing/instance-ownership-e2e.integ.ts` の「runs the periodic sweep on one instance at a time」は、この開発環境で失敗する。** 5 秒の上限に当たるか、試験が `proxy:sweep` のロックを取れずに失敗する。定期処理は起動時には動かない（`runtime/sweeper.ts` の `start`）ので、原因は、同じ試験の前の実行が残したロック（寿命 60 秒）か、同じ DB を使う別のプロセス（開発用に動かしている proxy など）が持つロックと見られる。Discord の Gateway の変更とは関係なく、変更より前のコミット（`59ef6d38d5`）でも同じく失敗した

## References

- Slack `chat.postEphemeral`: https://docs.slack.dev/reference/methods/chat.postEphemeral
- Mattermost API `POST /posts/ephemeral`: https://raw.githubusercontent.com/mattermost/mattermost/master/api/v4/source/posts.yaml
- Discord Create Message（EPHEMERAL は interaction への応答だけ）: https://docs.discord.com/developers/resources/message
- Teams targeted messages: https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/targeted-messages
- `chat-integration-agent` の brief「実現性の確認の結果」（Slack・Mattermost・Teams の同じ調査の全体）
