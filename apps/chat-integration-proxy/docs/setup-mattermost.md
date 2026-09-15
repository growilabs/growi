# Mattermost の事前準備

Mattermost は他の 3 サービスと導入の形が違う。Slack・Discord は
「Add to Slack」のような OAuth の折り返しで proxy が installation を作り、
Teams はチャットの管理コマンドで登録する。**Mattermost にはそのどちらの経路
も無い** — bot がまだそのサーバーに接続していない段階では、チャットの管理
コマンドを打つ相手が存在しないためである。そのためこの proxy は、Mattermost
の接続先を**起動前に環境変数で宣言する**形を取る。

複数の Mattermost サーバー（複数 workspace）を 1 つの proxy に紐付けること
もでき、その場合は宣言を並べるだけでよい。

## 1. bot アカウントを作る

1. 対象の Mattermost サーバーの管理者権限で、**System Console** →
   **Integrations** → **Bot Accounts** を開く
2. 新しい bot アカウントを作成する
3. 発行されたアクセストークンを控える（この画面を離れると再表示されない）

REST API と WebSocket（`/api/v4/websocket`）は既定で有効になっているため、
サーバー側で追加の設定をする必要は通常ない。

## 2. bot をチャンネルに参加させる

bot が通知・応答する必要のあるチャンネルへ、bot アカウントを参加させる。
**bot は自分が参加しているチャンネルのイベントしか受け取れない** — 通知先
チャンネルに bot がいなければ、その通知は Slack・Discord・Teams と同じく
「投稿できなかった」ことが運用者向けに記録される（要件2.4）が、まず参加
させておけば避けられる問題である。

## 3. 接続情報を環境変数として宣言する

Mattermost だけは、他の 3 サービスのように 1 組の値を個別の環境変数に置く
のではなく、**`MATTERMOST_INSTALLATIONS` という 1 本の環境変数に、
サーバーごとの宣言を JSON の配列として入れる**。

```bash
MATTERMOST_INSTALLATIONS='[
  {
    "workspaceId": "team-a",
    "workspaceName": "Team A",
    "baseUrl": "https://mattermost-a.example.com",
    "botToken": "<手順1で発行したトークン>"
  },
  {
    "workspaceId": "team-b",
    "workspaceName": "Team B",
    "baseUrl": "https://mattermost-b.example.com",
    "botToken": "<別サーバー用のトークン>"
  }
]'
```

4 つのフィールドはどれも省略できない:

| フィールド | 意味 |
|---|---|
| `workspaceId` | この proxy の中でこの Mattermost サーバーを指す識別子。Mattermost 自身が発行する値ではなく、**運用者が決める一意な文字列**（例: サーバーの短い呼び名）。複数のチャンネル紐付けやチャット workspace の切り替えの中で、この値がその Mattermost サーバーを指し続ける。 |
| `workspaceName` | 運用者やチームメンバーに表示される、その Mattermost サーバーの分かりやすい名前 |
| `baseUrl` | その Mattermost サーバーの URL |
| `botToken` | 手順1で発行したアクセストークン |

一部のフィールドだけを書いて残りを省く、ということはできない —
この proxy は 1 つのサーバーの宣言を「全部揃っているか、全く無いか」でしか
扱わない。

宣言した内容は起動のたびに読み直される。トークンを設定の中で入れ替えれば、
次回の起動から新しいトークンが使われる。

## 補足

- ボタンや選択メニューのような対話的な操作（Requirement 1.2 が言う
  「対話的な入力部品」）は、この proxy では Mattermost 向けに配線していない。
  Mattermost 自身のインタラクティブメッセージ機能は、コールバック先の URL
  （`callbackUrl`）を渡せば動く作りになっているが、この proxy はその値を
  渡していない。そのため能力表でも Mattermost はこの機能を `none` として
  扱い、代わりの手段（番号付き一覧と、呼びかけ付きの返信での選択）を使う。
  運用者側で追加の設定は不要。
- proxy 全体で共通に必要な `SECRET_ENCRYPTION_KEY`（保存する認証情報を
  暗号化する鍵）は、この文書の対象外（サービスごとの準備ではなく proxy
  全体の起動要件）。この鍵はここで宣言した bot トークンも含め、保存される
  認証情報すべての暗号化に使われる。
