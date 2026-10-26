# Slack の事前準備

この proxy は Slack と Socket Mode（常時接続の WebSocket）でつながる。外部から
proxy へ HTTP でアクセスする必要はない — Slack 側から見えるのは、この proxy が
自分から Slack へ接続しに行く 1 本の WebSocket だけである。

## 1. Slack app をマニフェストから作る

1. https://api.slack.com/apps を開く
2. **Create New App** → **From an app manifest** を選ぶ
3. 対象の workspace を選び、次のマニフェストを貼り付ける

```yaml
display_information:
  name: GROWI
  description: GROWI との連携 bot

features:
  bot_user:
    display_name: GROWI
    always_online: true
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - im:write
      - mpim:history
      - mpim:read
      - reactions:read
      - reactions:write
      - users:read

settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
      - message.mpim
      - member_joined_channel
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

このマニフェストは Socket Mode 用に、Slack 公式アダプタ（`@chat-adapter/slack`）
の README が挙げる webhook 版マニフェストから直した形になっている
（`request_url` を書かない — Socket Mode ではイベントも interactivity も
WebSocket 経由で届くため、Slack 側に公開の URL を教える必要がない）。

**この proxy は、bot が参加しているチャンネルで bot をメンションして呼びかける形
（`@growi search foo` のように）でのみコマンドを受け付ける。** マニフェストの
`event_subscriptions.bot_events` に含めた `app_mention` がその呼びかけを Socket
Mode 経由で proxy に届ける。**Slack の DM で打ったコマンドは起動しない。** DM で
`search foo` のように打っても、この proxy は DM がどの workspace のものかを特定できないため、
「このチャットの workspace がまだ登録されていません」と返す（workspace を特定する手がかりが
bot の参加しているチャンネルの一覧で、DM はそこに入らないため）。一方、**bot からの DM で
聞き返された質問への答えは DM で受け付ける。** 検索などの返事が DM に届いたとき
（返事を出す前に本人がそのチャンネルを抜けた、本人だけに見えるメッセージを出せない、など）や、
コマンドの引数を聞き返されたときは、利用者がその DM に答えを書けば元の依頼が進む。
そのために、マニフェストに次の 2 つを入れてある。

- `im:write`（bot スコープ）— bot が利用者との DM を開くために要る。無い導入では、
  返事は DM に落ちず、チャンネルに「DM を送れませんでした」という内容を含まない知らせだけが出る
  （返事の内容がチャンネルに出ることはない）。
- `features.app_home` の `messages_tab_enabled: true` と
  `messages_tab_read_only_enabled: false` — App Home の Messages タブを有効にし、利用者が
  bot との DM に書き込めるようにする。これが無いと、DM に届いた聞き返しに答えを書けない。

**すでに導入済みの workspace は、スコープと App Home の設定を足したあとで、アプリを導入し直す
（手順2の「Add to Slack」をもう一度行う）必要がある。** `im:write` は導入し直すまで効かない。
導入し直すまでは、本人だけに見えるメッセージが出せない場面で DM に落ちず、内容を含まない知らせになる。

マニフェストに含めた `message.channels` / `message.groups` / `message.im` /
`message.mpim` の購読は、コマンドの起動のためではなく、投稿された URL を検知して
プレビューを付ける機能（要件6）のためのものなので、この理由で外さないこと。
スラッシュコマンド（`/growi` のような入力）はこの proxy では今のところ
認識できない — 将来のリリースでの対応を検討しているが、現時点ではマニフェスト
に `slash_commands` を追加しても動作しないため、上のマニフェストには含めて
いない。

4. **Create** を押す

## 2. workspace 単位で proxy を紐付けられるようにする（複数 workspace 対応）

この proxy は 1 つの Slack app を複数の workspace にインストールできる形
（multi-workspace OAuth）で動く。そのための設定を 1 つ追加で行う。

1. 作成した app の **Basic Information** → **Add features and functionality**
   の下、あるいは **Manage Distribution** で配布を有効にする
2. **OAuth & Permissions** → **Redirect URLs** に、この proxy が動く場所の
   次の URL を登録する

   ```
   https://<この proxy の公開アドレス>/install/slack/callback
   ```

   運用者がこの workspace へ bot を追加で導入するときは、Slack の
   「Add to Slack」フローでこの URL へ折り返しが届き、proxy 側の
   `routes/install-routes.ts` がその場で installation を作る。

## 3. 認証情報を取得する

**Basic Information** → **App Credentials** から:

| Slack 側の項目 | 環境変数 |
|---|---|
| Signing Secret | `SLACK_SIGNING_SECRET` |
| Client ID | `SLACK_CLIENT_ID` |
| Client Secret | `SLACK_CLIENT_SECRET` |

**Socket Mode** の設定画面（有効化はマニフェストの `socket_mode_enabled: true`
で済んでいるはずだが、念のため **Socket Mode** ページで有効になっていることを
確認する）→ **App-Level Tokens** から、スコープ `connections:write` を持つ
トークンを新規作成する:

| Slack 側の項目 | 環境変数 |
|---|---|
| App-Level Token（`xapp-` で始まる） | `SLACK_APP_TOKEN` |

4 つとも揃って初めて Slack 連携が有効になる（`runtime/config.ts` は
4 つのうち 1 つでも欠けていると起動を拒否し、どれが足りないかを名指しする）。

## 補足

- **bot トークン自体は事前に取得しない。** この proxy は workspace ごとの bot
  トークンを、上記の OAuth 折り返し（`install/slack/callback`）が完了した
  瞬間に Slack から受け取って保存する。運用者が手で **Install to Workspace**
  してトークンをコピーする操作は不要（そのやり方は単一 workspace 向けで、
  この proxy の multi-workspace 構成とは別の認証経路になる）。
- **Enterprise Grid の組織単位インストールにも対応している。** その場合
  Slack は workspace ではなく enterprise 単位で応答を返し、この proxy は
  `enterprise.id` を鍵にして保存する。運用者側で何か追加の準備をする必要は
  ない。
- **TLS を終端する前段（リバースプロキシなど）の後ろでこの proxy を動かして
  いる場合**、Slack へ返す redirect_uri と、Slack から見えるこの proxy の
  アドレスがずれることがある（前段が `https://` を `http://` に、あるいは
  ポートを書き換える場合など）。ずれると Slack 側が `redirect_uri` の不一致
  で折り返しを拒む。その場合だけ `OAUTH_REDIRECT_URI` に、手順2で Slack へ
  登録したのと同じ URL（`https://<公開アドレス>/install/slack/callback`）を
  明示する。前段を挟まない構成では設定不要（折り返しが届いた URL からその場
  で導かれる）。この環境変数は Discord の折り返しにも同じ形で使われる、
  proxy 全体で 1 つの値である。
- proxy 全体の起動に必要な環境変数（保存する認証情報を暗号化する鍵や
  データベース接続文字列など、Slack に限らず proxy 全体で共通に要る値）は
  この文書の対象外。サービスごとの準備ではなく proxy 全体の起動要件であり、
  別途まとめて管理する運用者自身の関心事になる。
