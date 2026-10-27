# chat-integration Sub-spec Roadmap

> 本ファイルは umbrella spec `chat-integration` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md` を参照すること。

## Overview

`apps/slackbot-proxy`（Slack 専用の中継サーバ、以下 Gen 1）を、Slack・Mattermost・Discord・Microsoft Teams の
4 サービスに対応した中継サーバへ**完全に作り直す**。Gen 1 との後方互換は取らず、段階的な移行も考えない。
Gen 1 には手を入れず、GROWI 本体で両方を同時に有効にできる形で併存させる。

前提・確定済みの決定（決定 1〜10）・調査の記録は、本ディレクトリの `brief.md` と `research.md` にある。
要件（14 件・受け入れ条件 107 件）は本 umbrella の `requirements.md` が持ち、**sub-spec は要件 ID を参照する。番号は振り直さない。**

## 分割の経緯

当初は単一 spec として設計し、`design.md` が 1882 行まで肥大した
（テンプレートの警告水準 1000 行の約 2 倍）。敵対的レビューを Opus のサブエージェント 4 体・のべ 5 巡かけた結果、
**2 種類の欠陥が別々の原因で出続けた**。

1. **修正が別の箇所を壊す。** 4 回の修正すべてが「A 節を直したら B 節と食い違った」型だった
   （口の向きが逆・鍵の口が片方向・資格情報が 1 組・返信の経路が古いまま）。
   1882 行を一望できないことによる取りこぼしで、設計判断の誤りではない
2. **境界に散った欠陥が見つからない。** 新しいレビュアーに替えたところ、
   3 巡かけて誰も見つけていなかった critical が 6 件出た。**うち 2 件は両側の境界の問題**
   （相手が付けた識別子を自分側の一意キーにしていた／層の順序と部品の依存が食い違っていた）で、
   通信契約が独立していれば構造として気づけたはずのものだった

そこで **3 つの sub-spec に分割する**。1 の出血を止め、2 を構造で防ぐことが目的。

## Approach Decision

- **Chosen**: 「どの資格情報とデータストアに触れるか」を境界として 3 つに割る。
  通信契約（`packages/chat`）を独立させ、proxy と GROWI 本体をその両側に置く。
- **Why**: 壊れ続けたのがまさに**両側の境界**だった — 口の向き、鍵の向き、封筒に何を載せるか、識別子の一意性。
  「両者の間を何がどちら向きに流れるか」だけを扱う spec があれば一望できる。
  contract が固まれば proxy と app は**並行して実装できる**。
- **Rejected alternatives**:
  - 単一 spec のまま修正を続ける案: 4 回中 4 回、修正が別の箇所を壊している。5 回目も同じになる公算が高い
  - 機能で割る案（通知 / 検索 / ページ作成 …）: どの機能も 3 つの成果物すべてにまたがるので、境界が引けない
  - proxy と app の 2 つに割る案: 契約が両方に重複して置かれ、食い違いを止められない。**契約を独立させることが分割の主目的**

## Sub-specs

| Sub-spec | 成果物 | 責務 | 状態 |
|---|---|---|---|
| [chat-integration-protocol](../chat-integration-protocol/) | `packages/chat`（`@growi/chat`） | GROWI ⇄ proxy の通信契約、RFC 9421 署名、チャンネル権限の判定（両側が使う純粋関数） | 実装完了（`/kiro-validate-impl` GO） |
| [chat-integration-proxy](../chat-integration-proxy/) | `apps/chat-integration-proxy` | 4 サービスとのやり取り、関係管理、コマンドの解釈、検索の統合、常時接続 | 実装完了（`/kiro-validate-impl` GO。残タスク12.4「スラッシュコマンドを実際に動かす」のみ意図して未着手・追跡中） |
| [chat-integration-app](../chat-integration-app/) | `apps/app/src/features/chat-integration/` | 通知の送出、コマンドの処理、利用者の紐付け、鍵の保持、管理画面 | 実装完了（`/kiro-validate-impl` GO。1回目 NO-GO の是正4件を含む。umbrella 要件6への受け入れ条件6.6〜6.8追加＋固定リンクの非公開・存在確認対策を含む、2026-09-09） |

**依存の向き**: `protocol` ← `proxy` / `app`。protocol は他の 2 つを知らない。
proxy と app は互いを知らず、protocol の契約だけで話す。

## リリース前に直すもの

**この節に載っているものは、すべて直してからリリースする。** 直さずに残すと決めた項目は、この節から「リリース判定に入れていないもの」へ移し、理由を書く。その判断はユーザーが行う。

完了した項目は、この節から消す（経緯は git の履歴に残る）。amend spec は、対象の spec へ書き戻して自分を削除することが最後のタスクになる（`.claude/rules/spec-lifecycle.md`）。

### 並べ方の基準

項目ごとに「`agent`（コマンドの再編、順 7）は、これの上に作るか、これを変えるか」で分ける。

- **上に作る** → 先に直す。
- **変える** → 後に直す。先にやると 2 度手間になる。
- **どちらでもない** → 先に直す。費用が小さく、`agent` を動く土台の上で試せる。

### 作業の順序

| 順 | まとまり | 含む項目 | 進め方 | 対象 |
|---|---|---|---|---|
| 1 | 表示順 | 本人にだけ見える返事が、入力より上に出る | 時刻を測って原因を調べてから直す | proxy |
| 2 | proxy の見え方 | 検索結果の見せ方、Slack への通知の文面 | spec を作らず直接直す（契約は変えない） | proxy（通知の文面は app の markdown にも及びうる） |
| 3 | proxy の不具合の一括修正 | Discord の Gateway、Enterprise Grid のチャンネル一覧、installation の特定、Mattermost の 403 | spec を作らず直接直す。各項目にテストを付ける | proxy |
| 4 | app の見え方（`agent` と重ならない部分） | 承認画面、ページの編集画面、紐付け解除後のバッジ | amend spec `chat-integration-app-ui`（名前は仮） | app |
| 5 | URL の展開の方針 | 公開範囲が「公開」のページは題名だけ出す | amend spec `chat-integration-link-preview`（名前は仮） | app（protocol と proxy にも及びうる） |
| 6 | 通知の定期処理 | 定期処理の間隔、連携が無いテナントの問い合わせを飛ばす | amend spec `chat-integration-notification-load`（名前は仮） | app |
| 7 | コマンドの再編 | `agent` の追加、`keep` の吸収。通知の「書いてすぐ送る」を同じ口で作る。DM の先頭の `@誰か` の扱いと、Teams の `personal` 範囲を要件で決める | amend spec [chat-integration-agent](../chat-integration-agent/)。`brief.md` だけがあり、要件・設計・タスクの承認がこれから | umbrella、protocol、proxy、app |
| 8 | 管理画面の作り直し | 管理画面のうち、チャンネルの権限と「できること」の表 | amend spec `chat-integration-admin-ui`（名前は仮） | app |
| 9 | コマンドの表示の締め | スラッシュコマンドの実機確認、`help` の一覧の書き方、Discord のスレッドでの追加入力 | proxy の残タスク 12.4 | proxy |
| 10 | URL の展開の確認フロー（**リリースに含めるかが未決**） | 共有してよいかを本人に尋ねてから展開する | `agent` が済んでから判断する | 3 spec すべて |

- 順 1〜3 は、順 7 の前提になる。順 3 の installation の特定は、`agent` の `brief.md` が明記している前提である。
- 順 4・5・6 は app だけの変更で、順 1〜3 とは独立している。ただし、どれも `chat-integration-app/design.md` に書き戻すので、`agent` が書き換える節（権限、能力表）に触れるものを `agent` と同時には進めない。
- 順 7 は規模が大きいので、順 1〜3 を終えてから要件の承認に入る。

### 1. 表示順

- **Slack で、本人にだけ見えるメッセージが、呼びかけた入力より上に表示されることがある（優先度は高い）**: 実機試験（2026-10-27）で、`@GROWI search` への聞き返しが、入力の投稿より上に出た。内容は正しく本人にだけ見えるが、読む順序が逆になって使い心地が悪い。原因は未特定（Slack の画面が、本人にだけ見えるメッセージを受け取った順に差し込み、入力の表示より返事の受け取りが先になる短い間がある、という推測のみ）。表示位置を指定する手段は Slack の API に見当たらないので、再現したときの時刻を Slack の表示と proxy のログで数回分取って比べ、出すのを少し遅らせる案などが効くかを確かめてから決める。
- **調べ方**: 時刻を目で比べず、受け取った入力の `ts` と、`chat.postEphemeral` が返す `message_ts` を、ずれたときと普通のときでログに取って比べる。あわせて、[chat-integration-agent の brief](../chat-integration-agent/brief.md)「実現性の確認の結果」2（スレッドの中の本人だけのメッセージは、スレッドが既にあるときだけ出る）も確かめる。`agent` が本人にだけ答える場所の設計が、この結果で決まる

### 2. proxy の見え方

- **検索結果の見せ方を洗練する**: 実機試験（2026-10-27、Slack）で、`search` の結果が次のように見えた。
  - 各行が `[題名](URL) — パス` の形で、`[…](…)` の記号がそのまま見えて読みにくい（Slack のカードでは markdown のリンクが組み版されず、URL だけがリンクになっている）。
  - 題名とパスが同じ内容で重複しやすい。行ごとに GROWI の名前（`growi-chat-test`）が付き、1 つの GROWI しか無くても繰り返される。
  - 直す前に、各サービスで同じ内容がどう見えるかを、サービスごとの組み版（Slack は `<URL|題名>`、他は markdown のリンク）に分けて考える必要がある。
- **Slack への通知の文面**: メッセージの書式が洗練されていない。ページ名・変更の種類・変更した人・リンクを読みやすく並べる。Slack の Block Kit など、サービスごとの表現を使うかも含めて検討する
- **想定される影響範囲**: proxy の `outbound.ts`（サービスごとの描き分け）が中心。通知の文面は、GROWI が組み立てる markdown（`chat-integration-app`）にも及びうる。契約は変えないので、spec は作らず直接直し、proxy の design.md の該当節を更新する。`agent` の答えも同じ描き方を通るので、先に直す

### 3. proxy の不具合の一括修正

実機試験と独立レビューで見つかった。直す順は、Discord 全体が動かない Gateway を先頭にし、次に Enterprise Grid、installation の特定、Mattermost の 403。

1. **Discord の Gateway を開いていないので、Discord の DM と mention が proxy に届かない**: `src/` のどこからもアダプタの `startGatewayListener` を呼んでいない。本人宛ての返事を DM で送ることはできるが、その DM での答え（要件 1.16）もチャンネルでの mention も届かない。umbrella の design.md の「Discord は Gateway で受ける」と食い違う。別の対応で直す。詳しくは [chat-integration-proxy の research.md](../chat-integration-proxy/research.md) の「既知の問題」2
2. **Enterprise Grid の組織全体への導入で、チャンネル一覧が取れない**: `platform/channels.ts` が `conversations.list` の `team_id` に installation の `workspace_id`（組織全体の導入では組織の `E…`）を渡すため、`team_access_not_granted` になる。本来は `auth.teams.list` で許可された workspace ごとに取る。一覧が空なので、その installation ではコマンドの権限確認も通知もできない
3. **DM や一覧にまだ載っていないチャンネルでのコマンドに、的外れな案内が返る**: installation の特定をチャンネル一覧に頼るため、「workspace がまだ登録されていません」と返る（bot が招待された直後は一覧をすぐ取り直すようにしたので、招待後の待ちは無くなった。DM と、bot の招待を伴わずに増えたチャンネルでは残る）
4. **Mattermost で、本人にだけ見えるメッセージの権限不足（403）が「bot がチャンネルにいない」と記録される**: `classifyOutboundFailure` が 403 を `bot-not-in-channel` と分類する（アダプタの例外が応答の本文を持たず、見分けられない）。利用者には DM で届くので影響は無いが、DM も届かなかったときの運用者向けの報告の理由が誤る。同じ research.md の「既知の問題」1

### 4. app の見え方（amend spec `chat-integration-app-ui`、名前は仮）

`agent` が変えない部分だけをここで直す。管理画面は順 8。

- **ページの編集画面と、紐付け解除後の管理画面**: 実機試験（2026-10-26、Slack）で気付いた。動作は正しいが、見た目と使い勝手を直す。
  - **ページの編集画面**: 「Chat notification channels」が縦に長く、編集画面のレイアウトを崩している（要件2.2 の保存時の通知先の選択）
  - **チャット側で紐付けを解除したあとの管理画面**: `@GROWI unregister` は proxy 側の関係と鍵だけを消し、GROWI には知らせない。管理画面は接続の状態・できること・チャンネル一覧を読めないことを赤字で示すので状況は分かるが、右上のバッジは緑の「active」のまま（GROWI 側の関係の記録による表示のため）
- **要件7（アカウントの紐付け）の承認画面の作り直し**: 実機試験（2026-10-23、Slack）で、`/me/chat-integration/account-link/:token` の承認画面について次のフィードバックが出た。優先度は低いが、いずれ直す。
  - **体裁**: 見た目にもっと気を配る。サイドバーは要らないので、`BasicLayout` ではなく承認のためだけの簡素なレイアウトにする
  - **誤った承認を防ぐ**: 「どの GROWI（名前）に」「GROWI のどのログイン中ユーザーとして」「どのチャットサービス・workspace の、どのアカウントを」結び付けるのかを整理して見せる。Slack などの他製品の OAuth 承認画面を参考にする
  - **今の実装との差**: 画面は `AccountLinkApproval.tsx` で、文言が英語の直書き（i18n 未対応）。出せる情報は `platform`・`accountId`（Slack なら `U…` の ID のみ）・`workspaceName`・`relationLabel`・`growiUsername`。チャットアカウントの表示名は `chat_account_link_orders` に保存していないので、表示名を出すなら注文を作るとき（`account-link-start` の `actor.displayName`）に保存する必要がある
  - **想定される影響範囲**: `chat-integration-app` が中心（画面・レイアウト・注文の保存項目）。表示名を保存するだけなら protocol の契約は変わらない
  - **次にやること**: 規模が小さければ `chat-integration-app` の amend spec、そうでなければ `/kiro-discovery` から着手する

### 5. URL の展開の方針（amend spec `chat-integration-link-preview`、名前は仮）

- **要件6（URL の展開）で出す範囲の見直し**: 実機試験（2026-10-26、Slack）で、ログインしていない人の閲覧を許さない GROWI（`security:restrictGuestMode` が `Deny`）では、公開ページでも展開が「存在しないか、全員には見えない」になり、機能がほぼ使えないと分かった。今の判定は「ログインしていない人を含めて誰でも見られるページか」（`command-endpoint.ts` の `buildLinkPreview` に `isGuestAllowedToRead()` を渡す）で、チャンネルの参加者が全員 GROWI のユーザーとは限らないことを理由にしている。
  - **他製品の仕様（公式の説明で確かめた範囲）**: Notion は Slack に貼られたリンクを、ページを見る権限が無い人にも題名と作成者で展開し、見る権限が無い人がいれば貼った本人に権限を与えるかを尋ねる。Confluence Cloud は閲覧を制限したページだけを展開せず、制限の無いページ（ログインしたユーザーなら誰でも見られる）は展開する
  - **方針（決定）: 題名など最小限は出す。ただし公開範囲が「公開」のページに限る**:
    - 公開範囲が「公開」で、ログインしていない人も見られる → 今どおり題名と本文の一部
    - 公開範囲が「公開」で、ログインが必要 → **題名（と更新日など最小限）だけ出す**
    - 公開範囲が「本人だけ」「グループだけ」など → 今どおり何も出さない（存在しないページと見分けがつかない返し方、要件6.8）
  - **公開に限る理由**: GROWI の題名はパスの最後の部分なので、公開範囲を絞ったページでは題名を出すこと自体が漏れになる。パスの形の URL は URL 自体に題名を含むので、この変更が役に立つのは主に固定リンク（`/6adf…` の形）のとき
  - **想定される影響範囲**: 方針の部分は `chat-integration-app`（`buildLinkPreview` の判定）が中心。題名だけを返す状態を `LinkPreviewResponse` で表す必要があれば `chat-integration-protocol` と、表示する `chat-integration-proxy` にも及ぶ。確認フローまで含めると 3 sub-spec すべてにまたがる
  - **次にやること**: 方針の部分だけなら amend spec（要件6 の受け入れ条件を追記し、番号は振り直さない）。確認フロー（順 10）は含めない

### 6. 通知の定期処理（amend spec `chat-integration-notification-load`、名前は仮）

- **通知の遅れと、通知の定期処理の負荷を減らす**: 実機試験（2026-10-26）で、ページの保存から通知が届くまで最大 1 分かかることと、その定期処理がマルチテナント（GROWI.cloud など）で常にかかる負荷について見直した。
  - **今の仕組み**: 通知は「書き留める」と「送る」の 2 段（`chat-integration-app` の設計）。ページの保存では `chat_notification_outbox` に 1 行書くだけで戻り（要件2.5）、`notification-dispatch-cron.ts` が **1 分ごと**（`'* * * * *'`）に送る。この 2 段は、保存をチャットのせいで遅らせない・失敗しても送り直せる（要件2.4）・複数台でも二重に送らない、のために要るので残す
  - **遅れ**: 保存から届くまで 0〜60 秒（平均 30 秒ほど）
  - **負荷**: 定期処理は、チャット連携を使っているかに関係なく、すべてのインスタンスで起動時に始まる（`crowi/index.ts`）。1 分ごとに MongoDB へ 2 回問い合わせる（送信待ちの行を取る `findOneAndUpdate` と、保持期間を過ぎた連携を探す `findOne`）。1 回は索引の効く小さな問い合わせだが、**使っていないテナントも常に払う**ので、テナント数に比例して共有の MongoDB にかかり続ける
  - **ここで直す改善案**: 次の 2 つ。
    1. 定期処理は送り直しと止まった送信の回収だけを担うので、間隔を延ばす（例: 5 分）。保持期間を過ぎた連携の削除は 1 日 1 回で足りる
    2. チャット連携が 1 つも無いテナントでは問い合わせを飛ばす（「連携があるか」の確認結果は一定時間覚えておく）
  - **「書き込んだ直後に送る」は順 7 で作る**: 送り方が 2 通りにならないよう、`agent` が作る「答えをあとから送る口」と同じ経路にする（[chat-integration-agent の brief](../chat-integration-agent/brief.md) の Downstream）
  - **想定される影響範囲**: `chat-integration-app`（`notification-outbox.ts`・`notification-dispatcher.ts`・`notification-dispatch-cron.ts`・`pairing/sweep-unpaired-relations.ts`）。protocol と proxy は変わらない

### 7. コマンドの再編（amend spec [chat-integration-agent](../chat-integration-agent/)）

`search`・`create-page`・`agent` に再編する。`keep` は `agent` に吸収する。`brief.md` だけがあり、`spec.json` は無い。要件・設計・タスクの承認がこれから。答えを本人にだけ届ける仕組みは実装済み（[chat-integration-proxy の design.md](../chat-integration-proxy/design.md)「PrivateReplier — 本人宛ての返事の届け方」）。順 3 の installation の特定が前提。

- **この spec の要件で決めること（roadmap から移した）**:
  - **DM の先頭の `@誰か` が落ちる**: `agent` は DM や AI アプリの画面で自由な文章を受け取るので、「@alice について…」の先頭の語が落ちる。command 層が bot 自身の名前や id を知らないために起きる（[proxy の research.md](../chat-integration-proxy/research.md)「既知の問題」3）。直し方を要件で決める
  - **Teams で、1 対 1 の会話で bot に答えるのに、アプリを `personal` の範囲でも入れる必要があるか**: 未確認。`agent` の Teams の経路がこれに依存する（同 research.md の Research Log）
  - **通知の「書き込んだ直後に送る」**: 順 6 の説明を参照。`agent` の「あとから送る口」と同じ送り方で作る
- **制約（直せない。`agent` の設計で扱い方を決める）**: official proxy では Slack の会話の取り込みが事実上使えない。Slack Marketplace の外で配布するアプリは、2025-05-29 以降、`conversations.history` が 1 分に 1 回・1 回 15 件までに制限される（組織が自分で作るアプリは対象外）。GROWI が運営する 1 つのアプリを多くの workspace に導入する形では、`keep`（要件 5）がこの制限を受ける。詳しくは [chat-integration-agent の brief](../chat-integration-agent/brief.md) の「実現性の確認の結果」3

### 8. 管理画面の作り直し（amend spec `chat-integration-admin-ui`、名前は仮）

`agent` が、チャンネルの権限と能力表に `agent` の行と DM の権限を足すので、その後に作り直す。先に作り直すと、もう一度直すことになる。

- **管理画面（`/admin/chat-integration`）**: Connected workspaces の「What this service can do」の表示が冗長。Notification destinations と Channel permissions を、それぞれ見出しのあるセクションに分けて見やすくする（画面は `AdminChatIntegration.tsx` など。文言は英語の直書きで i18n 未対応）

### 9. コマンドの表示の締め

- **スラッシュコマンドを実際に動かす**: proxy の残タスク 12.4（`chat-integration-proxy/tasks.md`）。意図して未着手のまま追跡している。
- **`help` の一覧の書き方**: コマンドの使い方が `/growi search [keyword]` のようなスラッシュコマンドの形で出るが、スラッシュコマンドは未対応（`chat-integration-proxy` のタスク 12.4）で、実際には `@GROWI search …` と打つ必要がある
- **Discord のスレッド内で打ったスラッシュコマンドの追加入力が結び付かない**: 入力待ちを 4 区切りの `Channel.id`（`discord:<guild>:<parent>:<thread>`）で保存する一方、スレッドでの返答のイベントは 3 区切りの `Thread.channelId` を持つ。スラッシュコマンドから始めた場合の不具合である（メンションから始めた場合は、始めるときも続きも同じ 3 区切りの id を使うので影響しない）。スラッシュコマンドは上の残タスク 12.4 に含まれるので、ここで直す

### 10. URL の展開の確認フロー（リリースに含めるかが未決）

- **併せて検討する案（未決）**: 投稿者にだけ見える確認メッセージ（例: Slack の ephemeral message）で「全員に見せるか」を尋ね、「共有する」を選んだ場合だけ中身を展開する対話的な確認フロー（2026-09-09 の提案）。「今それを見ている人が誰か」をその場で判定し、チャット側のボタン操作を GROWI へ伝え返す往復が要るので、今の一往復の `link-preview` では成り立たない

- **未決の点**: リリースに含めるか。含めないなら、「リリース判定に入れていないもの」へ移す。`agent` が作る「本人にだけ届ける」しくみと近いので、`agent` が済んでから判断する。含める場合は、`/kiro-discovery` から着手する

## リリース判定に入れていないもの

直さずにリリースしてよいかの判断を、ユーザーに預けている。リリースに含めるなら、「リリース前に直すもの」へ移す。

- **Teams の `email` リアクションが未確認**: Teams が受け付けるかは実機でしか分からない（[proxy の research.md](../chat-integration-proxy/research.md)「既知の問題」4）
- **依頼のメッセージが無い依頼で、短い知らせが繰り返される**: slash command から始まった依頼など（同 5）。順 9 でスラッシュコマンドを扱うときに、あわせて見直せる
- **Mattermost で installation が複数あるとき、DM での「入力の期限切れ」の知らせが installation を引けない**（同 6）

## Scope

- **In**: 要件 1〜14（`requirements.md`）のすべて
- **Out**: Gen 1（`apps/slackbot-proxy`、`packages/slack`）の変更 / Chatwork と Google Chat / 公式アプリ審査 /
  LLM を使ったページ作成 / Cloudflare Workers 向けの 2 つ目のビルド（決定 10 で不採用）

## Constraints

- **要件 ID を振り直さない。** テストとタスクが番号を直接参照するため（`.claude/rules/spec-lifecycle.md`）
- **契約の変更は 3 spec すべてに効く。** `protocol` の design を変えたら `proxy` と `app` を必ず再確認する
- **Gen 1 には手を入れない**
