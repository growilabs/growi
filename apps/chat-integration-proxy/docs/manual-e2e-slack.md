# Slack を使ったローカルの実機試験

devcontainer の中で proxy と GROWI を動かし、本物の Slack とつないで一通りの機能を確かめる手順。
本番運用向けの準備は [setup-slack.md](./setup-slack.md) を見ること。この文書は、手元で試すときに
それと違うところと、つまずきやすいところを書いている。

## 1. Slack の workspace を用意する

**無料の普通の workspace を新しく作って使う**（https://slack.com/get-started）。本番の workspace は使わない。

Slack Developer Program のサンドボックスは使わない。サンドボックスは必ず Enterprise Grid の形で作られ、
そこで作ったアプリは組織（`E…`）の所属になる。さらにサンドボックスのアプリは配布を有効にできないので、
配下の workspace（`T…`）への OAuth 導入が理由の出ないエラーになる。組織全体への導入
（`org_deploy_enabled: true`）なら入るが、その形には未修正の不具合がある（チャンネル一覧が取れない。
umbrella spec の `roadmap.md` の「リリース前に直すもの」の 3）。普通の workspace への導入を試すなら、
無料の workspace が要る。

試験用のチャンネルは、**導入の前に**作っておく（例: 公開チャンネル `#growi-test`）。
非公開チャンネルは後から作ってよい（bot を招待した直後に一覧が取り直される）。

## 2. Slack CLI で試験用アプリを作る

`slack login` で、1. の workspace にログインしておく。作業用のディレクトリ（リポジトリの外）に次の 3 つを置く。

`.slack/hooks.json` — CLI はフックのコマンドの末尾に `--source` などの引数を付け足すので、
`cat manifest.json` のままでは失敗する。`sh -c` で包む。

```json
{ "hooks": { "get-manifest": "sh -c 'cat manifest.json' get-manifest" } }
```

`.slack/config.json`

```json
{ "manifest": { "source": "local" } }
```

`manifest.json` — [setup-slack.md](./setup-slack.md) のマニフェストに、手元の proxy への戻り先
（`redirect_urls`）を足したもの。

```json
{
  "display_information": { "name": "GROWI (local test)" },
  "features": {
    "bot_user": { "display_name": "GROWI", "always_online": true },
    "app_home": {
      "home_tab_enabled": false,
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    }
  },
  "oauth_config": {
    "redirect_urls": ["http://localhost:8080/install/slack/callback"],
    "scopes": {
      "bot": [
        "app_mentions:read", "channels:history", "channels:read", "chat:write",
        "groups:history", "groups:read", "im:history", "im:read", "im:write",
        "mpim:history", "mpim:read", "reactions:read", "reactions:write", "users:read"
      ]
    }
  },
  "settings": {
    "socket_mode_enabled": true,
    "org_deploy_enabled": false,
    "interactivity": { "is_enabled": true },
    "event_subscriptions": {
      "bot_events": [
        "app_mention", "message.channels", "message.groups", "message.im",
        "message.mpim", "member_joined_channel"
      ]
    },
    "token_rotation_enabled": false
  }
}
```

そのディレクトリで次を実行する。対話の問いが出せない環境では、答えをフラグで渡す。

```bash
slack app install --team <T で始まる workspace の ID> --environment deployed
```

CLI が導入した bot トークンは CLI 用のもので、proxy は使わない。proxy は 6. の OAuth で自分の分を受け取る。

## 3. 認証情報を proxy に渡す

アプリの設定画面（`https://api.slack.com/apps/<App ID>`）の **Basic Information** から 4 つを取り、
`apps/chat-integration-proxy/.env.development.local`（git の対象外）に書く。
**値をチャットや issue に貼らない。**

```bash
SLACK_SIGNING_SECRET=…
SLACK_CLIENT_ID=…
SLACK_CLIENT_SECRET=…
SLACK_APP_TOKEN=xapp-…   # App-Level Tokens で connections:write を付けて作る
```

同じファイルに、試験用のデータベースのスキーマと、手元の GROWI を宛先として許す設定を書く。
`public` スキーマは結合テストが使うので分ける。

```bash
DATABASE_URL="postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy?schema=manual_e2e"
CHAT_SDK_DATABASE_URL="postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy?options=-c%20search_path%3Dmanual_e2e_chat_sdk"
GROWI_ALLOWED_DESTINATIONS='[{"hostname":"localhost"}]'
```

`GROWI_ALLOWED_DESTINATIONS` が無いと、`http://localhost:3000` の GROWI は「https・既定のポート・
公開アドレス」の条件で断られ、ペアリングできない。

GROWI 側は `apps/app/.env.development.local` に、連携の鍵を暗号化する鍵を書く。

```bash
CHAT_INTEGRATION_KEY_ENCRYPTION_KEY=<openssl rand -base64 32 の出力>
```

## 4. データベースを用意する

Postgres は opt-in のサービスなので、docker のホスト側で起動しておく（`.claude/rules/devcontainer.md`）。
スキーマを作ってから、proxy の表を作る。

```bash
# スキーマ manual_e2e と manual_e2e_chat_sdk を作ったうえで
cd apps/chat-integration-proxy
pnpm run db:generate
DATABASE_URL="…?schema=manual_e2e" pnpm run db:migrate
```

## 5. proxy と GROWI を起動する

devcontainer の既定のシェルは Node 20 なので、Node 24 を先頭に足す。

```bash
export PATH=$(ls -d /usr/local/share/nvm/versions/node/v24*/bin | head -1):$PATH

# proxy（ポート 8080）
pnpm --filter @growi/chat-integration-proxy build
cd apps/chat-integration-proxy
node --env-file=.env.development --env-file=.env.development.local dist/runtime/server.js

# GROWI（ポート 3000、別のシェルで）
cd apps/app && pnpm run dev
```

proxy は正常に起動すると `Slack socket mode connected` を出す。`GET http://localhost:8080/health` でも確かめられる。
再起動すると、前の接続のロック（60 秒）が切れるまで接続を待つことがある。

ブラウザから 8080 と 3000 に届くよう、VS Code のポート転送を有効にしておく（6. の戻り先が `localhost:8080`）。

## 6. Slack に導入する（OAuth）

proxy には「Add to Slack」の入口が無いので、導入用の URL を手で組む。
**workspace のドメインを入口にする**こと。`slack.com` を入口にすると、どの workspace かが決まらず、
サインインの画面に戻され続ける。

```
https://<workspace>.slack.com/oauth/v2/authorize?client_id=<Client ID>&scope=<マニフェストの bot スコープをカンマ区切り>&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Finstall%2Fslack%2Fcallback
```

権限の確認画面で、導入先が試験用の workspace になっていることを確かめてから許可する。
「… is now connected to this proxy」と出れば成功。

## 7. 試す順番と、期待する結果

| 順 | 操作（`#growi-test` で） | 期待する結果 |
|---|---|---|
| 1 | `/invite @GROWI` → `@GROWI register` | 本人にだけ見える登録コード（10 分で失効） |
| 2 | GROWI の `/admin/chat-integration` でコードを入力（Proxy URI `http://localhost:8080`、GROWI URI `http://localhost:3000`） | ペアリングが成立する |
| 3 | `@GROWI help` | 使えるコマンドの一覧（使い方が `/growi …` の形で出るのは既知の食い違い） |
| 4 | `@GROWI link` → 届いた URL を開いて承認 | アカウントが紐づく。紐付け前の `search` は紐付けの案内が本人に届く |
| 5 | `@GROWI search <語>` | 結果の一覧、または「結果は得られませんでした」。結果は呼びかけた本人にだけ見える。別のアカウントで同じチャンネルを見ても結果は見えない |
| 6 | 管理画面で `create-page` を「Only these channels」にして `#growi-test` の ID を入力 → `@GROWI create-page /chat-test/hello こんにちは` | ページが作られ、作成者は紐付けた GROWI ユーザー |
| 7 | 管理画面で通知先に `#growi-test` を設定 → 対象のページを更新 | 1 分以内に通知が届く（送信は 1 分ごとの定期処理） |
| 8 | GROWI のページの URL をメンションなしで貼る | プレビューが付く。ログインしていない人の閲覧を許さない GROWI では「存在しないか、全員には見えない」（設計どおり） |
| 9 | 非公開チャンネルを作り `/invite @GROWI` → 数秒後に `help`、通知、URL の展開 | 公開チャンネルと同じに動く |
| 10 | `weight <GROWI名> 5`、`rotate-key`、`rotate-key status`、最後に `unregister` | それぞれの返事。`unregister` は GROWI に知らせないので、GROWI の管理画面は接続の状態を読めなくなる |

## 8. 原因を調べるとき

- **GROWI 側の記録**: 署名付きの依頼が断られると、`signature-guard` が理由（`body-shape-invalid`、`unknown-key` など）を出す。
- **Chat SDK の振り分け**: proxy が反応しないときは、ビルド済みの `dist/platform/index.js` の `new Chat({` に
  一時的に `logger: "debug"` を足して再起動すると、受け取ったメッセージと振り分けの結果
  （`Incoming message`・`Pattern test`・`No handlers matched` など）が出る。ソースは変えず、ビルドし直せば消える。
- **GROWI の生の応答**: proxy の `dist` の `loadConfig`・`createPrismaClient`・`createGrowiClient`・
  `createGrowiUriResolver`・`createRelationKeyService` を使って、署名付きのコマンドを 1 回だけ送る小さなスクリプトを
  書くと、GROWI が返した内容をそのまま見られる。
- **データ**: proxy は `manual_e2e` スキーマの `installation`・`installation_channel`・`relation` など、
  GROWI は MongoDB の `chat_*` コレクション（通知の送信待ちは `chat_notification_outbox`）。

**DM に落ちる場合は、手では確実に起こせないので、この表には入れていない。** Slack では bot がいない
チャンネルの呼びかけはそもそも proxy に届かず、本人だけに見えるメッセージも bot の投稿として直接出る。
DM に落ちるのは、依頼のあとで本人がそのチャンネルを抜けるといった、返事を出す直前の競合に限られる。
次の振る舞いは結合テスト・単体テストで確かめている。

- 返事が DM に届くこと、先頭に「<場所> での「<依頼>」への返事です」の見出しが付くこと、元のメッセージに封筒（email）のリアクションが付くこと、`im:write` が無いなどで DM も送れないときに内容を含まない「DM を送れませんでした…」の知らせだけが出ること — `src/command/private-reply.spec.ts`（本人だけのメッセージ・DM・知らせの成否の全組み合わせ）
- DM に届いた聞き返しに DM で答えると元の依頼が進むこと — `src/command/argument-collector.spec.ts`
- Slack で DM を開いたときのチャンネル id と、DM に打った本文が同じ形になること、同じリアクションの 2 回付け — `src/platform/private-reply-adapters.integ.ts`
