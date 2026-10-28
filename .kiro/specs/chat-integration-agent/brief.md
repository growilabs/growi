# Brief: chat-integration-agent

チャットのユーザー向けコマンドを `search`・`create-page`・`agent` の 3 つに再編する amend spec。
`agent` は、チャットの利用者の依頼を、紐付けた GROWI ユーザーとして GROWI の AI Agent に渡す。
`keep`（会話の取り込み）は `agent` に吸収する。

## Amend target

| 対象の spec | 変わる契約 |
|---|---|
| `chat-integration`（umbrella） | **Out of scope の決定 4「LLM を使った、自由な文章からのページ作成」を撤回する**（下の Approach に理由）。要件 5（会話を原文のまま取り込む）を、`agent` が会話を要約してページにする形に置き換える。要件 11（チャンネル単位の権限）に `agent` と DM での扱いを、要件 14（ヘルプ）に `agent` を足す。要件 1.3 の能力表に、Slack の AI アプリの画面などの項目を足す。新しい要件は **要件 15** として末尾に足し、既存の番号は振り直さない。umbrella の `brief.md` の決定 4 と、`research.md` にも理由を書き戻す |
| `chat-integration-protocol` | コマンドの語彙（`commands/command-names.ts`）から `keep` を外し、`agent` を足す。**GROWI が、受け付けたコマンドの答えをあとから proxy へ送る口**を足す（今は GROWI から proxy への口は通知 `notification` だけ）。署名と向きは通知と同じ |
| `chat-integration-proxy` | コマンドの組（`command/command-set.ts`）。`agent` の答えをスレッドの中で本人にだけ見せる届け方。Slack の AI アプリの画面で依頼を受けて答える経路。チャットのスレッドと、GROWI の AI の会話の記録との対応。能力表 |
| `chat-integration-app` | `agent` の処理（GROWI の AI Agent を、紐付けたユーザーとして呼ぶ）。会話の要約をページにする処理。答えをあとから送る処理。`keep` の処理を外す。ヘルプの内容 |

- Revalidation Triggers への影響: protocol の契約が変わるので、proxy と app の両方を確かめ直す（roadmap.md の Constraints「契約の変更は 3 spec すべてに効く」）。

## Problem

- チャットで話している人が、GROWI を開かずに「〜について書かれたページを探して要点を教えて」「このチャンネルの議論を要約してページにして」と頼みたい。今のコマンドは決まった形の検索・作成・会話の原文の取り込みだけで、要約や、調べながら答える依頼には応えられない。
- AI に頼んだ書き込みや検索が、頼んだ本人の名義で、履歴と監査記録に残る必要がある（要件 7 の目的）。
- GROWI をインターネットに公開できない組織でも、チャットから GROWI の AI を使いたい。

## Current State

- **GROWI の AI Agent**（`apps/app/src/features/mastra/`）: Mastra で作られた `growiAgent`。道具は読み取りの 2 つだけ（`full-text-search-tool`・`get-page-content-tool`）で、どちらも依頼した利用者の閲覧権限で動く。管理者が AI を有効にし（`isAiEnabled`）言語モデルを設定して（`isAiConfigured`）初めて使える。会話の記録は利用者ごとに Mastra のスレッドとして残る。ブラウザからは `POST /_api/v3/mastra/message` で呼び、答えは少しずつ流れてくる。サーバ側から呼ぶための公開された関数は無い（`suggest-path` の `agent.generate` が、サーバ側から呼ぶ前例）。時間の上限は無く、最大 10 手まで回る。
- **chat-integration のコマンド**: `search`（全 GROWI）、`create-page`・`keep`（1 つの GROWI。書き込み）、`help`、`link`。`keep` は proxy が会話の履歴を読み、GROWI が原文のままページにする（要件 5）。
- **時間の制約**: proxy から GROWI への署名付きの依頼は 10 秒で打ち切られる。GROWI があとからコマンドの答えを送る口は無い。AI Agent の答えは 10 秒に収まらないのが普通と見込む。
- **Chat SDK 4.38.1 の Slack アダプタ**は、Slack の AI アプリの画面に対応している（「考えています…」の表示 `setAssistantStatus`、依頼の例の表示 `setSuggestedPrompts`、DM のスレッドでの少しずつの書き出し `chatStream`、利用者が見ているものの通知 `onAppContextChanged`）。ただし proxy は今、この対応を有効にする `agentView` を渡していない（`platform/adapter-set.ts`）。Slack 側の現行の仕組み（agent_view）との関係は、下の「実現性の確認の結果」を見ること。

## Desired Outcome

- チャンネルで `@GROWI agent <依頼>` と打つと、そのスレッドの中に、本人にだけ見える形で答えが届く。続けてやり取りしたいときは、Slack の AI アプリの画面（チャンネルの横に開く）へ移って続けられる。
- Slack の AI アプリの画面では、待っている間「考えています…」が出る。同じスレッドで続けて質問でき、GROWI 側では 1 本の会話として続く。
- 「このチャンネルの議論を要約してページにして」と頼むと、会話を要約したページが、頼んだ本人を作成者として作られる。
- `search` と `create-page` は AI を使わずに今どおり速く動く。AI を使わない GROWI でも使える。
- AI を使えない GROWI では、ヘルプに `agent` が出ず、`agent` を打てば使えない理由が返る。
- 管理者は、`agent` を使わせるチャンネルと、DM（AI アプリの画面を含む）で使わせるかを決められる。

## Approach

**決まっていること**（umbrella の roadmap「リリース前に直すもの」の 7 と、2026-10-26 の discovery）:

1. **コマンドは `search`・`create-page`・`agent` の 3 つ。** 編集や要約を伴う依頼は `agent` に任せ、単純な作成と検索は AI なしで速く済ませる。
   - `agent` だけにしない理由: GROWI の AI は任意の機能なので、AI を使わない GROWI でコマンドが 1 つも無くなる。複数の GROWI をまとめて検索できるのは proxy だけ（各 GROWI の AI は自分の wiki しか見えない）。読み取りと書き込みのコマンドが分かれていないと、チャンネル単位の権限で「検索は許すが書き込みは許さない」を表せない。`search` は、Slack の時間制限の内に安く同じ結果を返せる。
   - チャンネル単位の権限（要件 11）は残す。`agent` は書き込みもしうるので、管理者がチャンネルごとに使わせるかを決められる必要がある。
   - 通知（要件 2）、URL の展開（要件 6）、proxy と GROWI の紐付け（要件 9・10）は、AI では代わりにならないので今のまま残す。
2. **`keep` は `agent` に吸収する。** proxy が会話を読み、`agent` への依頼に添えて渡し、GROWI の AI が要約してページにする。引き換えに、AI を使わない GROWI では会話の取り込みができなくなる。
3. **答えは本人にだけ見せる。** 共有したいときは、本人がページの URL を貼り、要件 6 の規則に任せる（proxy の本人にだけ届ける仕組みを使う。`chat-integration-proxy` の design.md「PrivateReplier — 本人宛ての返事の届け方」）。
4. **答える場所**: チャンネルで頼まれたら、そのスレッドの中で本人にだけ見える形で答え、「AI アプリの画面で続ける」案内を添える。続けてやり取りするなら Slack の AI アプリの画面で行う。Discord は本人にだけ見せる手段が無いので DM。Teams と Mattermost はスレッドの中で本人にだけ見せ、できなければ DM にする（下の「実現性の確認の結果」の 2・5・8）。
5. **答えはあとから届ける。** GROWI はすぐ「受け付けた」と返し、答えができたら新しい口で proxy へ送る。通知と同じ向きと署名なので、閉域の構成でも新しい通信経路は要らない。少しずつの書き出しは、GROWI から proxy へ途中経過を流す仕組みが要るので、今回はやらない。
6. **GROWI の AI Agent に書き込みの道具は足さない。** 会話の要約は AI に作らせ（`agent.generate` の形）、ページの作成は `create-page` と同じ書き込みの処理（`performWriteCommand`）で行う。`search`・`create-page` と `agent` で、GROWI の処理を 2 通り持たない。

**決定 4 を撤回する理由**: 決定 4 は「チャット側に LLM が居るなら、GROWI の MCP サーバで直接作れるので、proxy を経由させる理由が無い」としていた。この理由は今も、チャット側の AI を使う場合には正しく、その経路は本筋として残す（特定の AI 製品には寄せない）。ただし次の 2 つは、チャット側の AI では満たせない。
- GROWI がインターネットから届かない閉域の構成で、GROWI の AI を使うこと。依頼は proxy 経由で GROWI に届き、AI の処理は GROWI の中で行う。
- 紐付け（要件 7）をそのまま使い、頼んだ本人を履歴と監査記録に残すこと。

**採らない案**: チャット内の AI bot に `@GROWI create-page` などのコマンドを打たせ、MCP の代わりに使う形。書き込みが bot の名義になる。本人にだけ見えるメッセージは bot に届かない。応答も、AI が読む前提の書式になっていない。

## Scope

- **In**:
  - コマンドの再編（`keep` を外す。`agent` を足す）
  - `agent` の処理: 紐付けたユーザーとして GROWI の AI Agent を呼ぶ。会話を要約してページにする
  - GROWI が答えをあとから送る口（protocol）と、その送り方
  - 答えの届け方（スレッドの中で本人だけ、Slack の AI アプリの画面、Discord の DM）
  - チャットのスレッドと GROWI の AI の会話の記録の対応
  - `agent` とDM のチャンネル単位の権限、ヘルプ、能力表、導入ドキュメント（Slack アプリのマニフェストに要る設定と権限）
- **Out**:
  - GROWI の AI Agent に書き込みの道具を足すこと（既存のページの編集を AI に任せる依頼は対象外）。必要になったら `features/mastra` 側の spec として別に起こす
  - 答えの少しずつの書き出し（途中経過を流す仕組み）
  - GROWI の MCP サーバ（このリポジトリには無い。チャット側の AI からの経路は別の話）
  - スラッシュコマンド（`chat-integration-proxy` のタスク 12.4）
  - 本人にだけ届ける仕組みそのものと、`search` の公開範囲（実装済み。`chat-integration-proxy` の design.md「PrivateReplier — 本人宛ての返事の届け方」）

## Boundary Candidates

- **protocol**: コマンドの語彙の入れ替えと、答えをあとから送る口
- **app（AI の呼び出し）**: AI Agent をサーバ側から、紐付けたユーザーとして呼ぶ処理。会話の要約。AI の読み込みは遅らせる（起動時に読み込まない）
- **app（届け方）**: 答えをあとから送る処理。送れなかったときの送り直し
- **proxy（受け口）**: チャンネルのメンション、Slack の AI アプリの画面、DM から依頼を受ける。どの installation の依頼かを特定する
- **proxy（届け方）**: スレッドの中で本人にだけ見せる。AI アプリの画面に答える。サービスごとの代わりの手段

## Out of Boundary

- GROWI の AI Agent そのもの（道具、指示文、モデルの選び方）— 使う側に徹する
- GROWI の AI を有効にする設定と、言語モデルの設定 — 既存の管理画面のまま
- GROWI の閲覧権限の判定 — AI の道具が既に依頼した利用者の権限で動く

## Upstream / Downstream

- **Upstream**:
  - proxy の `PrivateReplier`（本人にだけ届ける部品。実装済み。`chat-integration-proxy` の design.md「PrivateReplier — 本人宛ての返事の届け方」）。`agent` はその上に、イベントの処理の外からあとで届ける部分と、スレッドの中で本人にだけ見せるためのスレッドの根元を足す
  - DM やチャンネル一覧にまだ無い場所でのコマンドで installation を特定できない不具合の修正（spec 無しで直す。AI アプリの画面は中身が DM なので、この修正が前提）
  - GROWI の AI Agent（`features/mastra`、実装済み）と、利用者ごとの会話の記録
- **Downstream**:
  - 通知の「書き込んだ直後に送る」と、それと同時にやる定期処理の間隔の延長（umbrella の roadmap「リリース前に直すもの」の 6 と 7）は、この spec で作る「あとから送る口」と同じ送り方で作る。送り方を 2 通りにしないためで、この spec の範囲に含める。連携が無いテナントの問い合わせを飛ばす変更は `chat-integration-notification-load` が先に行う
  - 要件 6 の確認フロー案（共有してよいかを本人に尋ねる。umbrella の roadmap「リリース前に直すもの」の 10。リリースに含めると決めた）は、この spec の本人にだけ見せる届け方と仕組みが近い

## Existing Spec Touchpoints

- **Extends**: `chat-integration`（要件 1・5・11・14、Out of scope、新しい要件 15）、`chat-integration-protocol`、`chat-integration-proxy`、`chat-integration-app`
- **Adjacent**: proxy の `PrivateReplier`（本人にだけ届ける部品。`chat-integration-proxy` の design.md「PrivateReplier — 本人宛ての返事の届け方」）、`ai-agentic-search`・`ai-chat-page-mention` など `features/mastra` の spec（AI Agent を使う側として触れるだけで、変えない）

## 実現性の確認の結果（2026-10-26）

サブエージェントが、公式ドキュメントとインストール済みのアダプタのコードで確かめた。出典は各項目に書く。「未確認」とした項目は、requirements か design の段階で実機か文書で確かめる。

1. **Slack の AI アプリの画面は、新しい仕組み（agent_view）で作る。** Slack は 2026-06-30 に、新しく作るアプリは「Agent messaging experience」（agent_view）しか使えないとした。古い仕組み（assistant_view）は将来なくなる（https://docs.slack.dev/changelog/2026/06/30/agent-messages-tab/ 、https://docs.slack.dev/ai/migrating-to-agent-messaging ）。agent_view でも、チャンネルの横の画面は残る。変わる点は次のとおり。
   - 利用者が画面を開いたことは `app_home_opened`（`tab` が `messages`）で知る。利用者が見ているものは `app_context_changed` で受け取り、`assistant:write` の権限が要る。
   - マニフェストに `features.agent_view`、`assistant:write`、イベント `app_home_opened`・`app_context_changed`・`agent_session_stopped` を足す。proxy はアダプタに `agentView: true` を渡す。
   - アダプタ 4.38.1 は `agent_session_stopped`（利用者が止めるボタンを押した）を扱わない。`setStatus`・`setTitle` は廃止予定で、互換の仕組みで当面は動く。
2. **Slack では、返事の無いメッセージのスレッドに、本人にだけ見えるメッセージを出せないことがある。** `chat.postEphemeral` の文書に「スレッドの中の ephemeral は、スレッドが既にある場合にだけ表示される」とある（https://docs.slack.dev/reference/methods/chat.postEphemeral ）。届くことの保証も無く、再読み込みで消え、あとから書き換えられない。
   - 実機試験（`register` の登録コード、`link` の URL）では、メンションへの本人だけの返事は届いている。スレッドの中に出たのか、チャンネルに出たのかは確かめていない。
   - 対策の候補: 先にスレッドへ全員に見える「受け付けました」を返してスレッドを作り、そのあとで本人だけの答えを出す。答えが消えても困らないよう、同じ答えを AI アプリの画面（DM）にも残し、続きはそこで行う。どちらにするかは design で決める。
3. **Slack Marketplace の外で配布するアプリは、会話の履歴の読み取りが厳しく制限される。** 2025-05-29 以降に作られたアプリ（と新しい導入）は、`conversations.history` が 1 分に 1 回・1 回 15 件までになる。組織が自分で作ったアプリ（社内用）は対象外（https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps ）。
   - 運用者が自分で Slack アプリを作る custom proxy なら影響は無い。GROWI が運営する 1 つのアプリを多くの workspace に導入する official proxy では、チャンネルの議論の要約は事実上できない。今の `keep`（要件 5）も同じ制限を受ける。
4. **（未確認・法務の確認が要る）Slack API の利用規約が、データの保存を制限している。** 組織の外に配布するアプリは、API で得たデータを使い・保存するのに、導入する組織から明示の許可を得る必要があり、使い方は最小限にする（https://slack.com/terms-of-service/api ）。会話の要約を GROWI のページとして残すことが、これに当たるかは確かめていない。今の `keep` も同じ論点を持つ。
5. **Mattermost で本人にだけ見えるメッセージを出すには、システム管理者の権限が要る。** `POST /api/v4/posts/ephemeral` は `create_post_ephemeral` の権限を求め、これは今のところシステム管理者にしか無い。コミュニティ製のアダプタ（`chat-adapter-mattermost@1.1.3`）はこの API を直接呼び、DM に切り替えない。普通の bot ではエラーになる。proxy は、本人にだけ見えるメッセージが失敗したら本人への DM で届ける（`chat-integration-proxy` の design.md「PrivateReplier — 本人宛ての返事の届け方」）。
6. **リンクからチャンネルの横の画面を開く方法は無い。** 文書にある深いリンク（`slack://app?...&tab=messages`、`https://slack.com/app_redirect?...`）は、アプリの Messages タブを開く（https://docs.slack.dev/interactivity/deep-linking ）。案内は「右上の Add agent から GROWI を開く」という文と、`app_redirect` のリンクにする。リンクから来た利用者はチャンネルを見ていないので、どのチャンネルの依頼だったかは proxy 側で覚えておく必要がある（推測、未確認）。
7. **利用者が見ているものが、いつもチャンネルとは限らない。** `app_context_changed` の中身は関連の強い順の一覧で、canvas や list のこともあり、空のこともある。画面が見えている間だけ届く。bot が参加していないチャンネルは読めない。
8. **Teams（未確認）**: 本人にだけ見えるメッセージ（targeted message）がスレッドの中に出るかは確かめていない。Microsoft の文書は、targeted message は返信に対応しないとしている（https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/targeted-messages ）。Teams には、Slack の横の画面にあたるものがアダプタに無い。
9. **あとから届ける答えの投稿**: Slack のアダプタは、イベントの処理の外では bot トークンを持たない。今の `bindInstallation`（通知の投稿で使っている）の中で投稿する必要がある。少しずつの書き出しは、DM（AI アプリの画面を含む）でなら追加の情報なしで使える。チャンネルのスレッドでは使えず、投稿して書き換える形になる。アダプタは、1 つの workspace で書き出しが使えないと分かると、全 workspace で書き出しを止める。
10. **（未確認）Slack のプラン**: ヘルプセンターは「全プランで使える」とし、開発者向けの案内は「AI の機能の一部は有料プランが要る」とする。どの機能が当たるかは書かれていない。無料の workspace で試す。

## Constraints

- 要件 ID を振り直さない。要件 5 を置き換えるときも番号は残す。置き換え方（受け入れ条件を書き換えるか、廃止と明記するか）は requirements の段階で決める。
- この spec は amend spec なので、最後のタスクを「変更を対象の spec に書き戻し、この spec を削除する」にする（`.claude/rules/spec-lifecycle.md`）。
- AI の部品（`@mastra/*`、`ai` など）は起動時に読み込まない。dynamic import で遅らせる（`features/mastra/server/no-eager-ai-imports.spec.ts` が検査している）。
- proxy は、チャットのアカウントと GROWI ユーザーの対応表を持たない（要件 7.8）。スレッドと会話の記録の対応も、この制約の中で決める。

## requirements と design で決めること

- 答えをあとから送る口の信頼性: 送れなかったときに送り直すか。通知と同じく書き留めてから送るか、直接送るか。
- スレッドと GROWI の AI の会話の記録の対応を、どちら側が持つか（要件 7.8 との整合）。
- 会話を要約してページにする前に、下書きを本人に見せて確認を取るか。ページのパスは誰が決めるか（本人が指定するか、AI が提案するか）。
- 1 つのチャンネルに複数の GROWI が紐づくときの `agent` の対象（要件 8.2 の選択を使う見込み）。
- bot がチャンネルに参加していないと会話を読めないとき（今の要件 5.4 と同じ扱いにする見込み）。
- AI の利用量を、利用者ごと・GROWI ごとに制限するか。
- 要件 5 を廃止すると、AI を使わない GROWI で会話の取り込みが無くなる。これを受け入れることの最終確認。
- official proxy（GROWI が運営する 1 つの Slack アプリ）で、会話の要約を提供するか。Marketplace の外では履歴の読み取りが 1 分に 1 回・15 件までになる（実現性の確認の 3）。Marketplace への掲載は umbrella の Out of scope（公式アプリ審査）なので、custom proxy だけの機能とするかを決める。
- Slack の本人だけの答えが届かない・消える場合の扱い（実現性の確認の 2）。
- DM や AI アプリの画面で、答えの先頭が `@誰か` で始まると、その語が落ちる（`chat-integration-proxy` の research.md「既知の問題」2）。自由な文章を受け取るこの spec で起きるので、直し方をここで決める。
- Teams で、1 対 1 の会話で bot に答えるのに、アプリを `personal` の範囲でも入れる必要があるか（実現性の確認の 8 とあわせて確かめる）。
