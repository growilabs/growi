# remote-mcp-server Sub-spec Roadmap

> 本ファイルは umbrella spec `remote-mcp-server` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md` を参照すること。調査で確かめた事実と出典は [research.md](./research.md) にある。

## Overview

GROWI 本体に MCP サーバーを組み込み、claude.ai（web 版 Claude）のカスタムコネクタから、利用者が自分の閲覧権限の範囲で wiki を検索・閲覧できるようにする。

目標とする体験は次のとおり。

- **管理者**: 管理画面で MCP 連携を有効にし、表示される MCP サーバー URL（`https://<site>/_api/v3/mcp`）を利用者に案内する。
- **利用者**:
  1. claude.ai の「設定」→「コネクタ」→「カスタムコネクタを追加」で名前と URL を入力する。
  2. claude.ai がサーバーを自動確認する。認証は「今すぐサインイン」、OAuth クライアントは「Claude の公開アイデンティティを使用」（CIMD）が既定で選ばれるので、何も変えずに「追加」を押す。
  3. 「連携させる」を押すとブラウザで GROWI が開く。未ログインなら既存のログイン画面を経て、同意画面で「許可」を押す。
  4. claude.ai に戻ると接続済みになり、チャットから wiki を検索・閲覧できる。
  5. 解除は、claude.ai でコネクタを削除するか、GROWI の設定画面で連携を失効させる。

## Approach Decision

- **Chosen**: Mastra の `@mastra/mcp`（`MCPServer`）を既存の Express に `POST /_api/v3/mcp` としてマウントし、GROWI 本体が OAuth 2.1 認可サーバーを兼ねる。接続方式は「カスタムコネクタ + Sign in 方式」でリリースする。
- **Why**:
  - 別サービスを立てないので、セルフホストの構成が増えない。MCP 仕様は認可サーバーとリソースサーバーの同居を認めている。
  - 公開するツールは既存の AI チャットが持つ全文検索とページ本文取得の 2 本で、Mastra のツール定義をそのまま使える。
  - リリース時の `/_api/v3/mcp` は、認可サーバーが発行したトークンだけを受け付ける。`/_api/v3/mcp` に届くトークンが、利用者の同意を経て `/_api/v3/mcp` のために発行されたものに限られる。
- **Rejected alternatives**:
  - **外部 IdP を認可サーバーにする構成**: セルフホストの利用者に IdP の用意を求めることになる。
  - **固定トークン方式だけでリリースする**: 利用者がトークンを発行してヘッダーに貼る手順が必要で、目標の体験にならない。claude.ai のリクエストヘッダー指定は一部の組織向けのベータ機能でもある（research.md の D）。手動発行のアクセストークンは、認可サーバーが揃うまでの開発・検証用にだけ使い、リリース時には受け付けない。
  - **Mastra の `createOAuthMiddleware` を使う**: パスつきの well-known を出さず、401 のチャレンジに `scope` が無く、`validateToken` を省くとどのトークンも通す（research.md の B）。自前のミドルウェアを書く。

## Scope

- **In**:
  - `POST /_api/v3/mcp`（ステートレス）と、全文検索・ページ本文取得の 2 ツールの公開
  - 管理者が切り替える有効化フラグ（既定は無効）
  - OAuth 2.1 認可サーバー（well-known 2 本、`/oauth/authorize`、`/oauth/token`、CIMD によるクライアント確認、同意画面）
  - 利用者向けの「連携中のアプリ」一覧と失効
- **Out**:
  - 手動発行のアクセストークンでの `/_api/v3/mcp` 利用（リリース時）。Basic 認証つきの環境向けの代替の認証手段も用意しない
  - claude.ai の「人気のコネクタ」（ディレクトリ）への掲載
  - 外部 IdP を認可サーバーにする構成
  - 書き込み系ツール（Change Proposal を MCP から作る入口は `change-proposal` umbrella の将来 spec が持つ）
  - エージェントを `ask_*` ツールとして公開すること（運用者側に LLM の費用が発生し、ディレクトリ審査でも拒否されるため）

## Constraints

- apps/app のルールに従う: `server-boot-imports`、`activity-recording`、`page-write-action-403-404`、新しいモデルは Prisma で作る。
- ツールのエラー応答でも、ページの存在を「見つからない」と「権限がない」の違いで漏らさない。
- claude.ai から到達するには、GROWI が公開 HTTPS（443 番、IPv4）で Anthropic のサーバーから見える必要がある。社内ネットワーク内だけの GROWI は対象にできない。
- 複数インスタンス構成を前提にする。プロセス内にセッションや利用者ごとの状態を持たない。
- `@mastra/mcp` は 2.8.0 で始める。`@mastra/core` 1.80.x のまま入る最新版で、Apache-2.0。2.9.0 以降は core 1.83 以上が要る。
- `MCPServer` には `legacy: 'stateless'` を指定する。指定しないと 2025 年系のクライアントをすべて拒否する。claude.ai の接続確認は 2025-11-25 の `initialize` で来るという報告がある（第三者の報告。公式の記載は無い）。

## Boundary Strategy

- **Why this split**: MCP ルートは「特定された利用者としてツールを実行する」ことを持ち、認可サーバーは「トークンを発行・失効し、`/_api/v3/mcp` に届いたトークンを検証する」ことを持つ。前者は、暫定の認証（手動発行のアクセストークン）で動作確認できるので、認可サーバーの未決事項を待たずに実装を進められる。
- **2 spec の接点**: 「リクエストから利用者を得る」認証の差し込み口だけにする。`remote-mcp-server-route` は、中身を暫定の認証（`Authorization: Bearer` のアクセストークンを `accessTokenParser` で検証する）にしておく。`remote-mcp-server-oauth` は、中身を「認可サーバーが発行したトークンだけを受け付ける」認証に入れ替える。ツールと、利用者を特定したあとの処理（回数制限、Activity）は変更しない。
- **Shared seams to watch**:
  - **未認証時の 401 応答**: `remote-mcp-server-route` は `WWW-Authenticate` チャレンジを出さない 401 を返す。`remote-mcp-server-oauth` はここに `resource_metadata` と `scope` を足す。ハンドラを書き換えずに足せるよう、`remote-mcp-server-route` の設計で 401 応答の差し込み口を用意する。
  - **discovery を出すタイミング**: claude.ai は接続のたびに well-known を確認し、認可サーバーのメタデータを見つけたのに CIMD も DCR も無いと接続を拒否する。well-known と 401 のチャレンジは `remote-mcp-server-oauth` が全部そろった状態でだけ出す。
  - **要求スコープ**: `/_api/v3/mcp` が要求するスコープは、`remote-mcp-server-oauth` の protected-resource メタデータ・同意画面・401 のチャレンジが同じ値を使う。値は 1 か所で宣言する。
  - **有効化フラグ**: `/_api/v3/mcp` と認可サーバーのエンドポイントを 1 つのフラグで一緒に切り替えるか、`remote-mcp-server-oauth` の要件で決める。
  - **AccessToken モデル**: 発行トークンを既存の AccessToken に載せるかは未決（下記）。載せる場合、個人設定の一覧・全削除・期限切れ削除のジョブに影響し、`/_api/v3/mcp` では「連携から発行したトークン」だけを選り分ける必要がある。
  - **Basic 認証つきの環境**: プロキシで `/_api/v3/mcp`、well-known、`/oauth/token` を Basic 認証の対象から外すことが必須になる。代替手段は無い。

## Specs (dependency order)

- [ ] remote-mcp-server-route -- `POST /_api/v3/mcp` のマウント、既存 2 ツールの公開、有効化フラグ、回数制限、Activity 記録。この spec だけではリリースしない。Dependencies: none
- [ ] remote-mcp-server-oauth -- OAuth 2.1 認可サーバー（well-known、authorize と同意画面、token、CIMD、連携中のアプリの一覧と失効）と `/_api/v3/mcp` の 401 チャレンジ。`remote-mcp-server-route` と合わせてリリースする。Dependencies: remote-mcp-server-route

## Future (brief はまだ作らない)

- **ディレクトリ掲載**: claude.ai の「人気のコネクタ」への掲載。審査要件の確認から始める。
- **書き込み系ツール**: `change-proposal` umbrella が将来の `change-proposal-mcp` として持つ。
- **DCR 対応**: 下記の未決 1 で初回リリースに入れないと決めた場合、ここに残す。

## 未決の論点

1. **DCR（`POST /oauth/register`）に対応するか。** claude.ai・Claude Code・ChatGPT・VS Code は CIMD に対応している。Cursor と Gemini CLI は DCR が必須という第三者の報告がある。手動発行のトークンを受け付けないので、CIMD だけに対応した場合、これらのクライアントは接続する手段が無い。DCR は MCP 仕様 2026-07-28 で非推奨。推奨案は「初回は CIMD のみ。要望が出てから足す」。`remote-mcp-server-oauth` の要件で決める。
2. **OAuth で発行するアクセストークンの持ち方。** 案 A は既存の AccessToken に「どの連携から発行したか」の参照を足す（`/_api/v3/mcp` では、参照を持つトークンだけを選り分ける。発行トークンは、同じスコープを要求する REST API でも通る）。案 B は OAuth 専用の Prisma モデル（発行トークンを `/_api/v3/mcp` 専用に閉じられる。`/_api/v3/mcp` は `accessTokenParser` を使わなくなるので、同 parser の約束は変わらない）。推奨案は B。「認可サーバーが発行したトークンだけを受け付ける」という決定に、そのまま沿うためである。`remote-mcp-server-oauth` の要件で決める。
3. **Basic 認証つき環境向けのプロキシ除外設定を、どこに書くか。** リポジトリ内にリバースプロキシの文書は無く、外部の docs.growi.org にある。推奨案は docs.growi.org への追記を `remote-mcp-server-oauth` の成果物に挙げ、管理画面の MCP 設定にも要点を表示すること。
4. **`remote-mcp-server-route` を単独でリリースしない方法。** 有効化フラグの既定が無効であることだけで足りるとするか、`remote-mcp-server-oauth` が揃うまで管理画面に項目を出さないか。`remote-mcp-server-route` の要件で決める。

---
_Updated: 2026-11-25. MCP エンドポイントのパスを `/mcp` から `/_api/v3/mcp` に変えた（wiki のページのパスと衝突しないため）。Prior: 2026-11-24. リリース時の `/_api/v3/mcp` は認可サーバーが発行したトークンだけを受け付ける、と決めた。手動発行のトークンを代替手段として残す決定を取り消し、2 spec の接点と未決 1・2 を合わせて直した。Prior: 2026-11-24. discovery で作成。_
