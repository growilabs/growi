# chat-integration Sub-spec Roadmap

> 本ファイルは umbrella spec `chat-integration` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md` を参照すること。

## Overview

`apps/slackbot-proxy`（Slack 専用の中継サーバ、以下 Gen 1）を、Slack・Mattermost・Discord・Microsoft Teams の
4 サービスに対応した中継サーバへ**完全に作り直す**。Gen 1 との後方互換は取らず、段階的な移行も考えない。
Gen 1 には手を入れず、GROWI 本体で両方を同時に有効にできる形で併存させる。

前提・確定済みの決定（決定 1〜10）・調査の記録は、本ディレクトリの `brief.md` と `research.md` にある。
要件（14 件・受け入れ条件 85 件）は本 umbrella の `requirements.md` が持ち、**sub-spec は要件 ID を参照する。番号は振り直さない。**

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

## Backlog（将来の拡張候補・未着手）

まだ spec 化していない、次に検討したい拡張のアイデア。discovery から着手する際は、このリストの該当行を消して spec ディレクトリへのリンクに差し替えること。

- **要件6（URL展開）の対話的な確認フロー**: 今の展開は「ページの公開範囲だけを見て、事前に何を出すか自動で決める」設計（要件6.6〜6.8の固定リンク対応もこの枠組みの上で直している）。これに対し、「投稿者にだけ見える確認メッセージ（例: Slack の ephemeral message）で『これは○○グループのみアクセスできるページです → Dismiss / 内容を共有する』のような選択肢を出し、『共有する』を選んだ人だけに中身を展開する」という対話的な確認フローが提案された（2026-09-09）。
  - **今の設計との違い**: 「ページの状態」だけでなく「今それを見ている人が誰か」をその場で判定する必要があり、しかもチャット側のボタン操作を GROWI 側へ伝え返す往復が要る。今の `link-preview` は一往復で完結する設計だが、これは成り立たない
  - **想定される影響範囲**: `chat-integration-proxy`（各プラットフォームの ephemeral message・ボタン操作の扱いはサービスごとに異なる）、`chat-integration-protocol`（ボタン操作を GROWI へ伝え返す新しいやり取りが要る可能性）、`chat-integration-app`（その場での権限再判定）——3 sub-spec すべてにまたがる可能性が高く、要件6.6〜6.8のような amend では収まらない
  - **次にやること**: `/kiro-discovery` から着手し、新規 spec として brief を起こす
- **要件7（アカウントの紐付け）の承認画面の作り直し**: 実機試験（2026-10-23、Slack）で、`/me/chat-integration/account-link/:token` の承認画面について次のフィードバックが出た。優先度は低いが、いずれ直す。
  - **体裁**: 見た目にもっと気を配る。サイドバーは要らないので、`BasicLayout` ではなく承認のためだけの簡素なレイアウトにする
  - **誤った承認を防ぐ**: 「どの GROWI（名前）に」「GROWI のどのログイン中ユーザーとして」「どのチャットサービス・workspace の、どのアカウントを」結び付けるのかを整理して見せる。Slack などの他製品の OAuth 承認画面を参考にする
  - **今の実装との差**: 画面は `AccountLinkApproval.tsx` で、文言が英語の直書き（i18n 未対応）。出せる情報は `platform`・`accountId`（Slack なら `U…` の ID のみ）・`workspaceName`・`relationLabel`・`growiUsername`。チャットアカウントの表示名は `chat_account_link_orders` に保存していないので、表示名を出すなら注文を作るとき（`account-link-start` の `actor.displayName`）に保存する必要がある
  - **想定される影響範囲**: `chat-integration-app` が中心（画面・レイアウト・注文の保存項目）。表示名を保存するだけなら protocol の契約は変わらない
  - **次にやること**: 規模が小さければ `chat-integration-app` の amend spec、そうでなければ `/kiro-discovery` から着手する
- **管理画面と通知の見た目の改善**: 実機試験（2026-10-26、Slack）で次の点に気付いた。動作は正しいが、見た目と使い勝手を直す。
  - **管理画面（`/admin/chat-integration`）**: Connected workspaces の「What this service can do」の表示が冗長。Notification destinations と Channel permissions を、それぞれ見出しのあるセクションに分けて見やすくする（画面は `AdminChatIntegration.tsx` など。文言は英語の直書きで i18n 未対応）
  - **ページの編集画面**: 「Chat notification channels」が縦に長く、編集画面のレイアウトを崩している（要件2.2 の保存時の通知先の選択）
  - **Slack への通知の文面**: メッセージの書式が洗練されていない。ページ名・変更の種類・変更した人・リンクを読みやすく並べる。Slack の Block Kit など、サービスごとの表現を使うかも含めて検討する
  - **想定される影響範囲**: 管理画面と編集画面は `chat-integration-app`。通知の文面は GROWI が組み立てる markdown（`chat-integration-app`）と、proxy がサービスごとに描く部分（`chat-integration-proxy` の `outbound.ts`）の両方にまたがりうる
  - **次にやること**: 小さければ `chat-integration-app` の amend spec にまとめる。上の「コマンドの再編」に着手するなら、それと合わせて見直す
- **ユーザー向けコマンドを `search`・`create-page`・`agent` に再編する検討**: 実機試験の途中（2026-10-26）で、機能の在り方を見直した。
  - **方針（決定）**: AI に手伝ってもらう書き込み・検索は、**AI から GROWI MCP を使う形（利用者ごとの認証）を本筋にする**。特定の AI 製品には寄せない（Slack に組み込まれた AI アプリなど、どの AI からでもよい）
  - **候補（決定）**: チャットのコマンドは `search`・`create-page`・`agent` の 3 つにする。`agent`（例: `@GROWI agent "～～を探して"`）は依頼を GROWI の AI Agent に渡す。編集や要約を伴う依頼は `agent` に任せ、単純な作成と検索は AI なしで速く済ませる
    - **`keep` は `agent` に吸収する（決定）**: proxy が今ある会話の読み取りで会話を取り、`agent` に添えて渡し、要約してページにしてもらう。会話はそのまま貼るより要約して残すほうが役に立つ場面が多い。引き換えに、AI を使わない GROWI では会話の取り込みができなくなる
    - **`agent` だけにしない理由**: GROWI AI は管理者が有効にし（`isAiEnabled`）言語モデルを設定して（`isAiConfigured`）初めて使える任意の機能なので、`agent` だけでは AI を使わない GROWI でコマンドが 1 つも無くなる。複数の GROWI をまとめて検索できるのは proxy だけで（要件3、各 GROWI の agent は自分の wiki しか見えない）、読み取りと書き込みが別のコマンドでないとチャンネル単位の権限で「検索は許すが書き込みは許さない」を表せない。`search` は Slack の時間制限内に安く同じ結果を返せる
    - **`agent` で閉域の GROWI でも AI を使える**: 依頼は proxy 経由で GROWI に届き、AI の処理は GROWI の中で行う。紐付け（要件7）をそのまま使うので、誰の依頼かが履歴と監査記録に残る
  - **チャンネル単位の権限（要件11）は残す**: `agent` は書き込みもしうるので、管理者がチャンネルごとに使わせるかを決められる必要がある
  - **決める必要がある論点: 答えを誰が見るか**: `search` と `agent` は依頼した本人の閲覧権限で調べるので、答えをチャンネルに出すと、見る権限の無い参加者（社外の人が入るチャンネルなら社外の人）に漏れる。本人にだけ見える形で返すか、チャンネルに出してよい条件を決める。`search` と `agent` でまとめて 1 回決める
  - **設計上の注意**: `search`・`create-page` の処理と `agent` の道具は、GROWI の同じ処理を呼び、2 通りの実装を持たない。GROWI の AI Agent の道具は今のところ読み取りだけ（`full-text-search-tool`・`get-page-content-tool`）なので、作成・編集を任せるには書き込みの道具を足す必要がある
  - **AI では代わりにならず、残すもの**: 通知（要件2）、URL の展開（要件6）、proxy と GROWI の紐付け（要件9・10）
  - **採らない案**: チャット内の AI bot に `@GROWI create-page` などのコマンドを打たせ、MCP の代わりに使う形。書き込みが bot の名義になり、AI に頼んだ人が履歴と監査記録に残らない（要件7 の目的と食い違う）。本人にだけ見えるメッセージは bot に届かず、応答も人向けの書式で AI が読む仕様になっていない。Slack 側の AI と GROWI 側の AI を連携させるなら、どの人の依頼かを渡す仕組みを別に設計する必要がある
  - **次にやること**: `/kiro-discovery` から着手する（要件の変更は 3 sub-spec すべてにまたがる）
- **既知の不具合（未修正、2026-10-26 時点）**: 実機試験と独立レビューで見つかり、まだ直していないもの。
  - **Enterprise Grid の組織全体への導入で、チャンネル一覧が取れない**: `platform/channels.ts` が `conversations.list` の `team_id` に installation の `workspace_id`（組織全体の導入では組織の `E…`）を渡すため、`team_access_not_granted` になる。本来は `auth.teams.list` で許可された workspace ごとに取る。一覧が空なので、その installation ではコマンドの権限確認も通知もできない
  - **メンションへの返事ではない Slack への投稿で、bot トークンを渡す仕組みがない疑い**: 通知のように、イベントの処理の外から投稿するときの経路。実機ではまだ確かめていない
  - **Discord のスレッド内で打ったスラッシュコマンドの追加入力が結び付かない**: 入力待ちを 4 区切りの `Channel.id`（`discord:<guild>:<parent>:<thread>`）で保存する一方、スレッドでの返答のイベントは 3 区切りの `Thread.channelId` を持つ
  - **DM や一覧にまだ載っていないチャンネルでのコマンドに、的外れな案内が返る**: installation の特定をチャンネル一覧に頼るため、「workspace がまだ登録されていません」と返る

## Scope

- **In**: 要件 1〜14（`requirements.md`）のすべて
- **Out**: Gen 1（`apps/slackbot-proxy`、`packages/slack`）の変更 / Chatwork と Google Chat / 公式アプリ審査 /
  LLM を使ったページ作成 / Cloudflare Workers 向けの 2 つ目のビルド（決定 10 で不採用）

## Constraints

- **要件 ID を振り直さない。** テストとタスクが番号を直接参照するため（`.claude/rules/spec-lifecycle.md`）
- **契約の変更は 3 spec すべてに効く。** `protocol` の design を変えたら `proxy` と `app` を必ず再確認する
- **Gen 1 には手を入れない**
