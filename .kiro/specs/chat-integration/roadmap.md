# chat-integration Sub-spec Roadmap

> 本ファイルは umbrella spec `chat-integration` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md` を参照すること。

## Overview

`apps/slackbot-proxy`（Slack 専用の中継サーバ、以下 Gen 1）を、Slack・Mattermost・Discord・Microsoft Teams の
4 サービスに対応した中継サーバへ**完全に作り直す**。Gen 1 との後方互換は取らず、段階的な移行も考えない。
Gen 1 には手を入れず、GROWI 本体で両方を同時に有効にできる形で併存させる。

前提・確定済みの決定（決定 1〜10）・調査の記録は、本ディレクトリの `brief.md` と `research.md` にある。
要件（14 件・受け入れ条件 129 件）は本 umbrella の `requirements.md` が持ち、**sub-spec は要件 ID を参照する。番号は振り直さない。**

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
| 7 | コマンドの再編 | `agent` の追加、`keep` の吸収。通知の「書いてすぐ送る」を同じ口で作り、それと同時に定期処理の間隔を延ばす。DM の先頭の `@誰か` の扱いと、Teams の `personal` 範囲を要件で決める | amend spec [chat-integration-agent](../chat-integration-agent/)。`brief.md` だけがあり、要件・設計・タスクの承認がこれから | umbrella、protocol、proxy、app |
| 8 | 管理画面の作り直し | 管理画面のうち、チャンネルの権限と「できること」の表 | amend spec `chat-integration-admin-ui`（名前は仮） | app |
| 9 | コマンドの表示の締め | スラッシュコマンドの実機確認、`help` の一覧の書き方、Discord のスレッドでの追加入力 | proxy の残タスク 12.4 | proxy |
| 10 | URL の展開の確認フロー | 共有してよいかを本人に尋ねてから展開する | `/kiro-discovery` から着手する。`agent` の「本人にだけ届ける」しくみの上に作るので、`agent` の後 | 3 spec すべて |

- 順 3（proxy の不具合の一括修正: Enterprise Grid のチャンネル一覧、installation の特定、Mattermost の 403、接続の更新の失敗）はすべて直したので表から外した。ほかの順の番号を変えないよう、3 は空き番号のまま残す。直した内容は [chat-integration-proxy の research.md](../chat-integration-proxy/research.md) の決定 P14・P15・P16 と「既知の問題」1。
- 順 4（app の見え方: 承認画面、ページの編集画面、紐付け解除後のバッジ）は済んだので表から外した。4 も空き番号のまま残す。決まったことは要件 2.12〜2.14・7.9〜7.12・9.10〜9.13（[requirements.md](./requirements.md)）、設計は [chat-integration-app の design.md](../chat-integration-app/design.md)、理由は [chat-integration-app の research.md](../chat-integration-app/research.md)。
- 順 5（URL の展開の方針: ログインが必要な GROWI でも、公開範囲が「公開」のページは題名と更新日時を出す）は済んだので表から外した。5 も空き番号のまま残す。決まったことは要件 6.9〜6.13（[requirements.md](./requirements.md)）、設計は [chat-integration-app の design.md](../chat-integration-app/design.md)「LinkPreviewMapper（URL の展開の応答）」、理由は [chat-integration-app の research.md](../chat-integration-app/research.md) と本ディレクトリの research.md の決定 15。
- 順 6（通知の定期処理の負荷: 連携が無いテナントの問い合わせを飛ばす、解除済みの連携の掃除を 1 日 1 回にする）は済んだので表から外した。6 も空き番号のまま残す。決まったことは要件 2.7〜2.9・9.8（[requirements.md](./requirements.md)）、設計は [chat-integration-app の design.md](../chat-integration-app/design.md)「通知を 2 段に分ける」、理由は [chat-integration-app の research.md](../chat-integration-app/research.md) と本ディレクトリの research.md の決定 16。定期処理の間隔を延ばすのは順 7 で行う。
- 順 11（順 5・6 の実装で見つかった小さな直し: 繋ぎ直しの引き継ぎ元の期限、掃除の 1 回の上限、空ページの扱い）は直したので表から外した。11 も空き番号のまま残す。決まったことは要件 6.14・9.9（[requirements.md](./requirements.md)）、設計は [chat-integration-app の design.md](../chat-integration-app/design.md)、理由は [chat-integration-app の research.md](../chat-integration-app/research.md)。ゴミ箱に入ったページは、除かないままにした（同 research.md）。
- 順 1（表示順: Slack で、本人にだけ見える返事が入力より上に出る）は直したので表から外した。1 も空き番号のまま残す。原因は、`chat.postEphemeral` が返す `message_ts` が合成した値であること。直し方は、Slack だけ依頼の次の秒まで待ってから出すこと。決まったことは [chat-integration-proxy の design.md](../chat-integration-proxy/design.md) と [research.md](../chat-integration-proxy/research.md) の `EPHEMERAL_MUST_FOLLOW_REQUEST_SECOND` の決定にある。
- 順 2（proxy の見え方: 検索結果のリンクの描き方、Slack への通知の文面）は直したので表から外した。2 も空き番号のまま残す。検索結果はサービスごとの組み版で出し、通知は 1 行の文面にした。決まったことは [chat-integration-proxy の design.md](../chat-integration-proxy/design.md)（`ListRow`）と [chat-integration-app の design.md](../chat-integration-app/design.md)（`NotificationContent`）にある。
- 順 7 の前提（順 1・2・3）はすべて済んだ。順 7 は、要件の承認に入れる。

### 7. コマンドの再編（amend spec [chat-integration-agent](../chat-integration-agent/)）

`search`・`create-page`・`agent` に再編する。`keep` は `agent` に吸収する。`brief.md` だけがあり、`spec.json` は無い。要件・設計・タスクの承認がこれから。答えを本人にだけ届ける仕組みは実装済み（[chat-integration-proxy の design.md](../chat-integration-proxy/design.md)「PrivateReplier — 本人宛ての返事の届け方」）。前提の installation の特定は直した（proxy の research.md の決定 P16）。

- **この spec の要件で決めること（roadmap から移した）**:
  - **DM の先頭の `@誰か` が落ちる**: `agent` は DM や AI アプリの画面で自由な文章を受け取るので、「@alice について…」の先頭の語が落ちる。command 層が bot 自身の名前や id を知らないために起きる（[proxy の research.md](../chat-integration-proxy/research.md)「既知の問題」2）。直し方を要件で決める
  - **Teams で、1 対 1 の会話で bot に答えるのに、アプリを `personal` の範囲でも入れる必要があるか**: 未確認。`agent` の Teams の経路がこれに依存する（同 research.md の Research Log）
  - **通知の「書き込んだ直後に送る」と、定期処理の間隔の延長**: `agent` の「あとから送る口」と同じ送り方で作り、それと同時に通知の定期処理の間隔を延ばす。邪魔をしないための今の設計は [chat-integration-app の design.md](../chat-integration-app/design.md)「書き込んだ直後に送る経路のための余地」、間隔を先に延ばさない理由と、延ばしたときの時間の変化は [chat-integration-app の research.md](../chat-integration-app/research.md)「通知の定期処理の間隔は、直後に送る経路と一緒に延ばす」。受け入れ条件には要件 2.10・2.11 を使ってよい
- **制約（直せない。`agent` の設計で扱い方を決める）**: official proxy では Slack の会話の取り込みが事実上使えない。Slack Marketplace の外で配布するアプリは、2025-05-29 以降、`conversations.history` が 1 分に 1 回・1 回 15 件までに制限される（組織が自分で作るアプリは対象外）。GROWI が運営する 1 つのアプリを多くの workspace に導入する形では、`keep`（要件 5）がこの制限を受ける。詳しくは [chat-integration-agent の brief](../chat-integration-agent/brief.md) の「実現性の確認の結果」3

### 8. 管理画面の作り直し（amend spec `chat-integration-admin-ui`、名前は仮）

`agent` が、チャンネルの権限と能力表に `agent` の行と DM の権限を足すので、その後に作り直す。先に作り直すと、もう一度直すことになる。

- **管理画面（`/admin/chat-integration`）**: Connected workspaces の「What this service can do」の表示が冗長。Notification destinations と Channel permissions を、それぞれ見出しのあるセクションに分けて見やすくする（画面は `AdminChatIntegration.tsx` など。文言は英語の直書きで i18n 未対応）

### 9. コマンドの表示の締め

- **スラッシュコマンドを実際に動かす**: proxy の残タスク 12.4（`chat-integration-proxy/tasks.md`）。意図して未着手のまま追跡している。
- **`help` の一覧の書き方**: コマンドの使い方が `/growi search [keyword]` のようなスラッシュコマンドの形で出るが、スラッシュコマンドは未対応（`chat-integration-proxy` のタスク 12.4）で、実際には `@GROWI search …` と打つ必要がある
- **Discord のスレッド内で打ったスラッシュコマンドの追加入力が結び付かない**: 入力待ちを 4 区切りの `Channel.id`（`discord:<guild>:<parent>:<thread>`）で保存する一方、スレッドでの返答のイベントは 3 区切りの `Thread.channelId` を持つ。スラッシュコマンドから始めた場合の不具合である（メンションから始めた場合は、始めるときも続きも同じ 3 区切りの id を使うので影響しない）。スラッシュコマンドは上の残タスク 12.4 に含まれるので、ここで直す

### 10. URL の展開の確認フロー

- **案**: 投稿者にだけ見える確認メッセージ（例: Slack の ephemeral message）で「全員に見せるか」を尋ね、「共有する」を選んだ場合だけ中身を展開する対話的な確認フロー（2026-09-09 の提案）。「今それを見ている人が誰か」をその場で判定し、チャット側のボタン操作を GROWI へ伝え返す往復が要るので、今の一往復の `link-preview` では成り立たない

- **リリースに含める**（2026-10-27 に決定）。`agent` が作る「本人にだけ届ける」しくみと近いので、`agent` の後に、`/kiro-discovery` から着手する。要件 6 の受け入れ条件の追記になるので、番号は振り直さず、6.15 から振る。投稿者が「共有する」を選ぶ前に出すものは、要件 6.9〜6.12 で決めた範囲（公開範囲が「公開」のページの題名と更新日時など）の上に乗る

## リリース判定に入れていないもの

直さずにリリースしてよいかの判断を、ユーザーに預けている。リリースに含めるなら、「リリース前に直すもの」へ移す。

- **Teams の `email` リアクションが未確認**: Teams が受け付けるかは実機でしか分からない（[proxy の research.md](../chat-integration-proxy/research.md)「既知の問題」3）
- **依頼のメッセージが無い依頼で、短い知らせが繰り返される**: slash command から始まった依頼など（同 4）。順 9 でスラッシュコマンドを扱うときに、あわせて見直せる
- **Mattermost で installation が複数あるとき、DM での「入力の期限切れ」の知らせが installation を引けない**（同 5）
- **通知の書き込み口と定期処理が、同じ「連携があるか」の記憶（IntegrationPresence）を共有していることを確かめる結合試験が無い**: 今は書き込み口が `createNotificationOutbox` の 1 か所だけで、既定で同じインスタンスを使うので壊れていない。書き込み口が増えるときに足す
- **表示順の待ちの配線と、続けて返した 2 つの返事の順番の試験が無い**: `runtime/dependencies.spec.ts` に `onOrderingWait` の配線を確かめる試験が無く、2 つの返事を続けて返したときの順番も確かめていない。順 7 で proxy の返事の経路を触るときに足す

## Scope

- **In**: 要件 1〜14（`requirements.md`）のすべて
- **Out**: Gen 1（`apps/slackbot-proxy`、`packages/slack`）の変更 / Chatwork と Google Chat / 公式アプリ審査 /
  LLM を使ったページ作成 / Cloudflare Workers 向けの 2 つ目のビルド（決定 10 で不採用）

## Constraints

- **要件 ID を振り直さない。** テストとタスクが番号を直接参照するため（`.claude/rules/spec-lifecycle.md`）
- **契約の変更は 3 spec すべてに効く。** `protocol` の design を変えたら `proxy` と `app` を必ず再確認する
- **Gen 1 には手を入れない**
