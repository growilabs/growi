# Discord の事前準備

この proxy は Discord と Gateway（常時接続の WebSocket）でつながる。Slack と
同じく、外部から proxy へ HTTP でアクセスできる必要はない。

Discord のアプリには「Interactions Endpoint URL」という、外部から HTTP で
呼ばれる口を設定する欄があるが、**この proxy ではその欄を空欄のままにする。**
Discord は Interactions Endpoint URL が設定されていない限り、ボタン操作や
スラッシュコマンドも Gateway 側へ流してくる（アダプタ本体の README がこの
挙動を明記している）。空欄のままにしないと、通常メッセージは Gateway、
ボタン操作だけは HTTP という 2 経路に割れてしまい、Gateway だけを常時接続で
待ち受けるこの proxy の作りと噛み合わなくなる。

## 1. アプリケーションを作る

1. https://discord.com/developers/applications を開く
2. **New Application** を押し、名前を付ける
3. **General Information** ページで次の 2 つを控える:
   - **Application ID**
   - **Public Key**
4. **Interactions Endpoint URL** の欄は**空欄のまま**にする（上記の理由）

## 2. bot を作る

1. 左側メニューの **Bot** を開く
2. **Reset Token** を押して bot トークンを発行する
3. 発行されたトークンを控える（この画面を離れると再表示されない）
4. **Privileged Gateway Intents** のうち **Message Content Intent** を
   **必ず有効にする。** この proxy が使う Discord アダプタは Gateway に
   接続するとき、この intent を含む固定のセットを常に要求する構成になって
   おり、これを個別にオン・オフする設定はない。Discord Developer Portal で
   有効にしていないと、Gateway への接続そのものが拒否される（WebSocket が
   close code 4014 で切断される）。「通知の投稿だけなら要らない」という
   部分的な運用はできない。会話取り込み（要件5）で、他の人が投稿した本文を
   bot 自身が読む必要がある点も、この intent が要る理由の一つである。

## 3. サーバーへの招待リンクを作る

1. **OAuth2** → **URL Generator** を開く
2. **SCOPES** で `bot` と `applications.commands` を選ぶ
3. **BOT PERMISSIONS** で、投稿・スレッド作成・履歴の読み取り・リアクション
   に必要な権限（Send Messages / Send Messages in Threads /
   Create Public Threads / Manage Threads / Read Message History /
   Add Reactions / Attach Files）を選ぶ
4. 生成された URL を、対象の Discord サーバーの管理権限を持つ人が開き、bot を
   招待する

この招待の操作そのものが「installation を作る」操作ではない点に注意する。
この proxy が実際に installation を記録するのは、次の OAuth 折り返しが完了
した時である。

## 4. OAuth 折り返し先を登録する（新しいサーバーへ導入するとき）

1. **OAuth2** → **General** を開く
2. **Redirects** に、この proxy が動く場所の次の URL を登録する

   ```
   https://<この proxy の公開アドレス>/install/discord/callback
   ```

Discord は Application 単位で 1 本の bot トークンしか持たない（Slack と違い、
サーバーごとに別のトークンにはならない）。それでも「どのサーバーに導入
済みか」を proxy 側が把握する必要があるため、この折り返しは今も必要である。

## 5. 認証情報を取得する

| Discord 側の項目 | 取得場所 | 環境変数 |
|---|---|---|
| Application ID | General Information | `DISCORD_APPLICATION_ID` |
| Public Key | General Information | `DISCORD_PUBLIC_KEY` |
| Client Secret | OAuth2 → General | `DISCORD_CLIENT_SECRET` |
| Bot Token | Bot（手順2で発行したもの） | `DISCORD_BOT_TOKEN` |

4 つとも揃って初めて Discord 連携が有効になる。

## 6. TLS を終端する前段がある場合

Slack と同じ理由で、`OAUTH_REDIRECT_URI` に手順4で登録したのと同じ URL
（`https://<公開アドレス>/install/discord/callback`）を明示する必要が
出ることがある（前段がアドレスを書き換える構成のときだけ）。
`OAUTH_REDIRECT_URI` は proxy 全体で 1 つの値であり、Slack の折り返しにも
同じ値が使われる。前段を挟まない構成では設定不要。

## 7. 本人宛ての返事がどこに届くか

Discord には本人だけに見えるメッセージを出す機能がこの proxy の使う
アダプタに無いため、本人宛ての返事（登録コード、紐付けの URL、エラーの
案内など）は**常に本人への DM で届く**。DM が届いたときは、元の発言に封筒の
リアクション（`email`）が付く。

bot に必要な権限と、利用者側の条件:

- **Add Reactions**: 封筒のリアクションを付けるのに要る。手順3の招待時の
  権限に既に含めてある。リアクションを付ける先のチャンネルを bot が見られる
  こと（View Channel / Read Message History）も要る。
- **DM を送る**: bot 側に追加の権限は要らない。ただし利用者が Discord の
  プライバシー設定で「サーバーのメンバーからのダイレクトメッセージを許可
  する」を無効にしていると、DM は送れない。その場合は返事の内容を含まない
  短い知らせが元の場所に出て、運用者向けにも報告が残る。
- 既存のスレッドの中で頼まれた場合、リアクションの付け先がスレッドの親の
  チャンネルになって失敗することがある。その場合も DM は届き、元の場所に
  内容を含まない短い知らせが出る。

> 確認の範囲: 「本人だけのメッセージの機能が無く常に DM になる」ことと
> DM の開き方は、アダプタのコードと結合試験で確かめた。必要な権限の名前と、
> DM を許可する設定の影響は Discord の仕様に基づく説明で、実機では確かめて
> いない。

**Gateway のつながり方**: proxy のインスタンスが何台あっても、Gateway を開くのは
`app:discord` のロックを持つ 1 台だけである。その台は Gateway を 24 時間ごとに
開き直す。開き直しのログインの数秒の間に送られたメッセージは proxy に届かない。
ログインに失敗すると（bot トークンの誤り、Message Content Intent が無効など）、
proxy の標準エラーに「the discord listener ended after …ms」という報告が出て、
5 秒から最大 5 分まで間隔を空けて開き直し続ける。失敗の理由は、その直前に
Discord アダプタが出すログ（「Discord Gateway listener error」）に書いてある。

運用中に bot トークンを作り直したときは、新しいトークンを設定して proxy を
再起動する。古いトークンのままの接続は Discord に切られ、次に開き直すまで
（最大 24 時間）Discord のメッセージが届かない。

## 補足

- **Discord の OAuth 交換は、この proxy では公開ドキュメントの記述だけを
  頼りに実装されており、実物の API とはまだ突き合わせていない**
  （Slack 側は SDK 本体のコードを読んで確認済みだが、Discord には対応する
  SDK 側の OAuth 機能が無いため、この proxy が自前で実装した）。導入直後に
  予期しないエラーが出た場合は、既知の未検証点として報告してほしい。
- 会話履歴の取得（要件5）は Discord では REST API（チャンネルのメッセージ
  一覧取得）で都度取りに行く形になる。手順3で招待した bot に **Read Message
  History** 権限を付けていれば追加の権限申請は不要——この権限を外すと会話の
  取り込みが失敗するので、Slack のような別途の申請こそ不要だが、この招待時
  権限自体は要件5に必須である。
- **URL 展開（要件6）は Discord では使えない。** 投稿された URL のプレビュー
  を作って持ってくるのは Slack アダプタだけの機能で、Discord を含む他の
  3 サービスは対応していない。要件6.5が定める代替として、Discord では
  「このサービスでは URL のプレビューが使えない」旨をユーザーに伝える形に
  なる。
