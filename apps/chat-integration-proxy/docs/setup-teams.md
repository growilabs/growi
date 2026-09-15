# Microsoft Teams の事前準備

**4 サービスのうち、この Teams だけが「外から接続を受ける」サービスである。**
Slack・Discord・Mattermost は、この proxy が自分から相手へ接続しに行く
（Socket Mode / Gateway / WebSocket）。Teams だけは逆で、Azure Bot Service が
この proxy の HTTP エンドポイントへ向けてメッセージを送ってくる。つまり
Teams だけは、proxy を動かすネットワークの側で「外から HTTP を受け付ける穴」
を意図して開ける必要がある。この文書はその分、他の 3 本より厚く書く。

## 1. 全体の流れ

Teams の bot 登録は Slack や Discord のように developer portal の画面だけでは
完結せず、**Azure AD へのアプリ登録（AAD app registration）と Azure Bot の
登録**という、Azure 側のリソース作成を伴う。Microsoft はこの一連の作業を
1 コマンドにまとめた CLI を配布しており、この proxy の導入でもそれを使う
前提で書く。

```bash
npm install -g @microsoft/teams.cli
```

## 2. アプリを作る（AAD 登録 + Azure Bot 登録を 1 回で行う）

```bash
teams login
teams status          # ログインとサイドロード権限を確認
teams app create --name "GROWI" \
  --endpoint "https://<この proxy の公開アドレス>/webhook/teams" \
  --env .env
```

`--endpoint` に渡す URL が、Azure Bot Service がメッセージを送ってくる先
そのものである。この proxy 側でこのパスを受けるのは `routes/webhook-routes.ts`
で、実際のパスは `webhookPath('teams')` が返す `/webhook/teams` になる
（後述の「受け口を開ける」で、この一致を運用者自身でも確認できるようにして
ある）。

このコマンドは `CLIENT_ID` / `CLIENT_SECRET` / `TENANT_ID` を `.env` に書き
出す。この proxy が実際に読む環境変数名とは異なる（アダプタ本体の既定名
`TEAMS_APP_ID` / `TEAMS_APP_PASSWORD` とも異なる）ので、次の対応で読み替える:

| CLI が書き出す名前 | この proxy が読む環境変数 |
|---|---|
| `CLIENT_ID` | `TEAMS_CLIENT_ID` |
| `CLIENT_SECRET` | `TEAMS_CLIENT_SECRET` |

`TENANT_ID` はこの proxy では環境変数として設定しない。このアプリは
テナントを限定しない構成（マルチテナント）で動かす前提になっており、
どのテナントの Teams かは、実際にメッセージが届いた時に会話ごとに記録される
（`InstallationCredentials.teams.tenantId`）。運用者が起動前に決めて渡す値
ではない。

`TEAMS_CLIENT_ID` / `TEAMS_CLIENT_SECRET` の 2 つが揃って初めて Teams 連携が
有効になる。

## 3. Teams へインストールする

```bash
teams app get <appId> --install-link
```

で直接インストール用のリンクを得るか、あるいは

```bash
teams app package download <appId> -o my-bot.zip
```

でアプリパッケージを取得し、Teams の **アプリ** → **アプリの管理** →
**アプリのアップロード** → **カスタムアプリのアップロード** からサイドロード
する。

## 4. 受け口を開ける（このサービスだけに必要な作業）

Azure Bot Service からこの proxy への接続を通すために、ネットワークの側で
次を行う:

1. **開けるパス**: `/webhook/teams` の 1 本だけ。この proxy が実際に
   webhook を受け付けているパスは、動かしている proxy 自身の
   `GET /health` を叩けば確認できる（`inboundExposure` の中に、実際に
   登録されているパスと接続元の絞り方の両方が返る — この 2 つは実装上
   常に一致するようになっている）。
2. **接続元を Azure Bot Service に絞る**: 全世界からの接続を許すのではなく、
   Azure Bot Service の送信元だけを通す。Azure 上で動かしているなら
   `AzureBotService` という service tag が使える。Azure の外（オンプレミス
   など閉域ネットワークの前段）で絞る場合は、Microsoft が公開している
   Azure の IP Ranges and Service Tags ファイルから、その時点の値を確認する
   （IP アドレスは変わるものなので、この文書やアプリの中に一覧をそのまま
   書き写さない — 参照先を頼りにする）。この 2 点は `GET /health` の応答が
   同じ言葉で示す。

## 5. 受け口の認証について（運用者が追加で何かする必要はない）

「外から接続を受ける」と聞くと、この proxy 自身が届いたリクエストを検証する
仕組みを別途持つ必要があるように見えるが、その心配はない。Teams の webhook
は、上の手順 2 で取得した `TEAMS_CLIENT_ID` / `TEAMS_CLIENT_SECRET` を使って、
Teams SDK 側（`@microsoft/teams.apps`）がリクエストの `Authorization` ヘッダを
検証し、失敗したものは 401 で断る。つまり **この 2 つの認証情報を正しく設定
すること自体が、受け口の認証を成立させる条件**になっている。手順 4 の
接続元の絞り込みは、この認証に加えて行う多重の防御であり、認証の代わりでは
ない。

## 補足

- テナントの種類を「特定の組織だけに公開する（Single Tenant）」に変更したい
  場合は、この proxy の現状の実装ではその設定を渡す経路が無い
  （`PlatformAppConfig.teams` は `clientId` / `clientSecret` の 2 つだけを
  持ち、テナント種別やテナント ID を渡す欄が無い）。マルチテナント運用の
  前提で導入すること。
- **会話履歴の取り込み（要件5）を Teams で使うには、上記に加えて Graph の
  権限が要る。** この proxy はチャンネル・グループチャット・DM のいずれの
  会話履歴取得にも対応する前提で作られている（能力表 `fetchMessages` が
  Teams を含む 4 サービスとも `full`）。ただし実際に取得できるかどうかは
  Azure 側の権限設定に懸かっており、何もしなければ失敗する:

  | 会話の種類 | 必要な権限 | 付与方法 |
  |---|---|---|
  | チャンネル | `ChannelMessage.Read.Group`（RSC） | `teams app rsc add <appId> ChannelMessage.Read.Group --type Application`（管理者の同意は不要） |
  | グループチャット | `ChatMessage.Read.Chat`（RSC） | `teams app rsc add <appId> ChatMessage.Read.Chat --type Application`（管理者の同意は不要） |
  | DM | `Chat.Read.All`（Azure AD） | Azure CLI で付与し、管理者の同意が必要。まず `Chat.Read.All` の権限 ID を確認する（`az ad sp show --id 00000003-0000-0000-c000-000000000000 --query "appRoles[?value=='Chat.Read.All'].id" -o tsv`）。控えた ID を使って `az ad app permission add --id <appId> --api 00000003-0000-0000-c000-000000000000 --api-permissions <確認した ID>=Role` を実行し、続けて `az ad app permission admin-consent --id <appId>` を実行する（権限 ID は Microsoft Graph の更新で変わり得るため、この文書に固定値を書き写さず毎回確認する） |

  いずれも付与しなかった場合、会話取り込みのコマンドを Teams で実行すると
  取得に失敗する。**この失敗は、権限不足を利用者にきちんと示す分かりやすい
  案内（要件5.4）にはならない可能性が高い。** この proxy 自身は Teams の
  権限不足を認識してその案内に変える仕組み（`channelAccessFailure`）を
  持っており、Teams のエラーもいくつかは実際にそこで拾える。ただし
  Graph API の権限不足（HTTP 403）については、Teams アダプタ側の会話履歴
  取得処理がそれを `NotImplementedError` に変えて投げるか、そのまま
  再送出するかのどちらかになっており、どちらの形も上の
  `channelAccessFailure` が認識するエラーの形とは一致しない。そのため、
  権限を付け忘れた場合の失敗はこの案内の仕組みに認識されず、利用者には
  分かりやすい案内ではなく、説明のない失敗が返る可能性が高い。導入時点で
  必ずこの表のとおり権限を付与しておくことを強く勧める。
- ユーザーのメール解決など、会話取り込み以外で Graph API を使う機能を
  この proxy が将来使う場合は、別途 `User.Read.All` 権限などが必要になる。
  現時点の 4 サービス分の準備という範囲では、上記の手順だけで足りる。
