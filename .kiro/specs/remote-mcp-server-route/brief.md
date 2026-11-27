# Brief: remote-mcp-server-route

> umbrella: [remote-mcp-server](../remote-mcp-server/roadmap.md)。調査で確かめた事実は [research.md](../remote-mcp-server/research.md) にある。

## Problem

GROWI の利用者は、claude.ai などの MCP クライアントから wiki を検索・閲覧する手段を GROWI 本体に持っていない。AI チャット用の全文検索とページ本文取得のツールはすでにあるが、GROWI の中のエージェントからしか呼べない。

## Current State

- 全文検索ツールとページ本文取得ツールが `apps/app/src/features/mastra/server/services/mastra-modules/tools/` にある。GROWI のエージェントに静的に登録されている。
- 2 ツールは Mastra の `createTool` で作られ、利用者と `searchService` を Mastra の requestContext から読む。MCP サーバーからは、そのままでは使えない。
- `accessTokenParser` は、`Authorization: Bearer` と `X-GROWI-ACCESS-TOKEN` ヘッダーに加えて、クエリとボディの `access_token` も受け付ける。取得元をヘッダーに限るオプションは無い。
- MCP の SDK（`@modelcontextprotocol/*`）は依存に入っていない。

## Desired Outcome

- 管理者が MCP 連携を有効にすると、`POST /_api/v3/mcp` が MCP の Streamable HTTP として応答する。
- 有効なアクセストークンを `Authorization: Bearer` ヘッダーで送った MCP クライアントが、全文検索とページ本文取得の 2 ツールを、トークンの持ち主の閲覧権限の範囲で使える。この認証は暫定で、リリース時には認可サーバーが発行したトークンだけを受け付ける。
- 複数インスタンス構成で、どのインスタンスがリクエストを受けても同じ結果になる。
- `remote-mcp-server-oauth` が後から認証を差し替えるとき、この spec のツールと、利用者を特定したあとの処理を変更せずに済む。
- この spec だけではリリースしない。`remote-mcp-server-oauth` と合わせてリリースする。

## Approach

MCP の公式の TypeScript SDK（`@modelcontextprotocol/server` と `@modelcontextprotocol/node`）で MCP サーバーを作り、既存の Express に `POST /_api/v3/mcp` としてマウントする。`@mastra/mcp` は使わない（理由は [research.md](./research.md) の Decision「MCP サーバーは SDK を直接使う」）。

- **ステートレス**: SDK の `createMcpHandler` は、リクエストごとにサーバーを作る。`legacy: 'stateless'` で、2025 年系のクライアントもセッションなしで受ける（claude.ai の接続確認が 2025-11-25 で来るという報告があるため）。
- **認証**: 「リクエストから利用者を得る」処理を 1 つの差し込み口にする。この spec では、中身を、`Authorization: Bearer` のアクセストークンを AccessToken モデルで直接検証する認証にする（`accessTokenParser` は使わない。理由は [design.md](./design.md) の McpAuth）。`remote-mcp-server-oauth` が、中身を「認可サーバーが発行したトークンだけを受け付ける」ものに入れ替える。得た利用者は、IP とエンドポイントと一緒に `req.auth` の `extra` に入れ、ツールが `authInfo.extra` から取り出す。`mapAuthInfoToUser` と requestContext は使わない（[design.md](./design.md) の McpCallerContext）。
- **未認証**: `loginRequired` は `/_api` 配下の未認証リクエストに 403 を返すので使わない。`/_api/v3/mcp` 用に 401 を返す。この時点では `WWW-Authenticate` チャレンジを付けない。
- **全文検索ツール**: 既存の 2 ツールから処理の中身を、依存（利用者、`searchService`）を引数で受け取る関数として取り出す。エージェント用のツールと、MCP 用に別に定義するツールが、同じ関数を呼ぶ。
- **有効化フラグ**: 管理者が切り替える。既定は無効。`aiReadyGuard` は使わない（MCP に LLM の設定は要らない）。
- **遅延ロード**: MCP の SDK は、フラグが有効なときの最初のリクエストで読み込む。起動時には読み込まない。

## Scope

- **In**:
  - `POST /_api/v3/mcp` のマウントとステートレス動作
  - トークンの受け付けを `Authorization: Bearer` ヘッダーに限ること（`X-GROWI-ACCESS-TOKEN` ヘッダー、クエリ、ボディは受け付けない）
  - 認証の差し込み口（`remote-mcp-server-oauth` が中身を入れ替える）
  - 全文検索・ページ本文取得の 2 ツールの公開。MCP クライアント向けの description と annotation（読み取り専用であることなど）を付ける
  - 全文検索ツールの、`searchService` を外から注入する形への作り直し
  - 管理者の有効化フラグと、管理画面での切り替え・MCP サーバー URL の表示
  - MCP の SDK の遅延ロードと、起動時に読み込まれないことの検査
  - `/_api/v3/mcp` の回数制限
  - Activity の記録
  - `remote-mcp-server-oauth` が 401 応答にチャレンジを足せる差し込み口
- **Out**:
  - `/.well-known/*` と、401 の `WWW-Authenticate` チャレンジ（`remote-mcp-server-oauth` が持つ）。claude.ai は認可サーバーのメタデータを見つけたのに CIMD も DCR も無いと接続を拒否するので、認可サーバーが揃う前に出してはいけない
  - OAuth の発行・失効、同意画面、連携中のアプリの一覧
  - 書き込み系ツール、エージェントの公開
  - `GET /_api/v3/mcp` と `DELETE /_api/v3/mcp`（セッションを持たないので不要。405 を返す）

## Boundary Candidates

- **ルートと認証の入口**: フラグの確認、認証の差し込み口と暫定の中身（Bearer のアクセストークンの検証）、401 応答、回数制限
- **MCP サーバーの組み立て**: SDK のハンドラとサーバーのファクトリ、ツールの登録、`req.auth` から呼び出し元への受け渡し、遅延ロード
- **ツールの公開用の定義**: 2 ツールの description・annotation、`searchService` の注入
- **管理者の設定**: 設定キー、管理 API、管理画面
- **記録と制限**: Activity、利用者単位の回数制限

## Out of Boundary

- トークンの発行・失効・一覧。この spec は、渡されたトークンを検証して利用者を特定するところまでを持つ
- `accessTokenParser` のスコープ判定とトークンの保存形式
- 既存の AI チャットでのツールの振る舞い（作り直しの前後で変えない）
- Basic 認証つき環境向けのプロキシ設定の文書

## Upstream / Downstream

- **Upstream**:
  - `accessTokenParser` と AccessToken モデル（spec: `access-token-parser`）
  - 全文検索ツールとページ本文取得ツール（spec: `ai-agentic-search`）
  - `searchService`、`features/rate-limiter`、Activity の仕組み、config-manager
- **Downstream**:
  - `remote-mcp-server-oauth`: `/_api/v3/mcp` の 401 にチャレンジを足し、認証の中身を、発行したトークンだけを受け付けるものに入れ替える
  - 将来の `change-proposal-mcp`（書き込み系ツールの入口）

## Existing Spec Touchpoints

- **Extends**:
  - `ai-agentic-search`: 全文検索ツールが `searchService` を受け取る方法を変える。この spec の設計が決めた約束を変えることになる場合は、spec-lifecycle のルールに従い、最後のタスクで変えた内容を `ai-agentic-search` へ書き戻す（この spec 自体は新しい機能なので削除しない）。
  - `access-token-parser`: 変更しない。MCP エンドポイントの認証は parser を使わないので、書き戻しは要らない。
- **Adjacent**:
  - `suggest-path`: 全文検索ツールを `limited-search-tool` で包んで使っている。作り直しで壊さない。
  - `change-proposal-ai-agent`: 同じ 2 ツールを `withReadRecording` で包んで登録し直す予定（未実装）。ツールの名前と生成方法を変えるときは、この予定と突き合わせる。
  - `ai-usage`: `aiReadyGuard` の振る舞いを変える可能性がある。この spec は `aiReadyGuard` を通らないので影響を受けない。

## Constraints

- **採用バージョン**: `@modelcontextprotocol/server` 2.4.x と `@modelcontextprotocol/node` 2.1.x。`@mastra/core` の版と無関係に上げられる。`node` は実行時に `hono` と `@hono/node-server` を伴うので、`package-dependencies` のルールでの分類を実装で確かめる。
- **遅延ロード**: `server-boot-imports` のルールに従う。MCP のルートの横に `no-eager-mcp-imports.spec.ts` を新設し、起動の入口から `@modelcontextprotocol/` に届かないこと、MCP のハンドラから `@mastra/` に届かないことを検査する。
- **Activity**: `activity-recording` のルールは、応答を返す前に Activity を確定することを求める。`/_api/v3/mcp` は 1 つのエンドポイントで接続確認・ツール一覧・ツール呼び出しをすべて受けるので、記録はツール呼び出しの単位とし、ツールごとのアクションで記録する。接続確認とツール一覧は記録しない（要件 7）。
- **回数制限**: 既存のグローバルな回数制限は `accessTokenParser` より前に走るので、トークンだけのリクエストには IP 単位の制限しか効かない。claude.ai の通信は Anthropic の送信元アドレスに集まるので、IP 単位だけでは全利用者が 1 つの枠を分け合う。認証の後に、利用者単位で数える制限が要る。
- **存在を漏らさない**: ツールのエラー応答で、ページの存在を「見つからない」と「権限がない」の違いで漏らさない。ページ本文取得ツールは、例外を捕まえたときに `err.message` を `reason` へそのまま入れている。MCP で外へ出す前に、この経路で内部の情報が出ないか確かめる。
- **要求スコープ**: `/_api/v3/mcp` が要求するスコープは 1 か所で宣言し、`remote-mcp-server-oauth` が同じ値を使えるようにする。値は既存の `read:features:page`（ページ取得と全文検索の API がすでに要求しているスコープ）とする。
- **本文サイズ**: SDK 側の上限（4 MiB）は、body-parser が先に本文を読むと効かない。グローバルの上限は 50 MB である。本文はルートに届く前に読み終わっているので、ルートで上限を見てもメモリの消費は防げない。`/_api/v3/mcp` だけの上限は、この spec では設けない（design.md の Non-Goals）。
- **メンテナンスモード**: メンテナンス中は、既存の API と同じく 503 を返す（要件 3.10）。
- **パス**: `/_api` 配下はページを作れないパスなので、wiki のページと衝突しない。
- **マウントする位置**: セッションより前（`bodyParser.json` の直後）にマウントする。MCP のリクエストは、セッション、`CertifyOrigin`、`mongoSanitize`、グローバルの回数制限を通らない。必要なもの（メンテナンスモードの判定、IP 単位の回数制限、送信元の検査）は、ルートが自分で行う（[design.md](./design.md) の Existing Architecture Analysis）。
- **複数インスタンス**: プロセス内にセッションや利用者ごとの状態を持たない。`suspend()` を使うツールは公開しない。

## 検証方法

- ngrok で開発環境を HTTPS で公開し、手動発行のアクセストークンで接続する。
- claude.ai の「サインインなし」+ リクエストヘッダー（`Authorization: Bearer ...`）で接続できるか確かめる。**この機能はベータで、一部の組織に限られる**（research.md の D）。使えない場合は、ヘッダーを指定できる Claude Code または MCP Inspector で代える。
- claude.ai が実際に送るプロトコルリビジョンを、このときにログで確かめる。接続確認が 2025-11-25、ツール呼び出しが 2026-07-28 という報告と、ヘッダーと本文でリビジョンが食い違うリクエストの報告がある（research.md の C）。

## 未決の論点

残っていない。discovery の時点の 4 点は、次のとおり決まった。

1. **取得元を `Authorization: Bearer` に限る方法** — `accessTokenParser` を使わず、Bearer のトークンだけを見る認証を MCP のルートに置く。parser は変更しない（[design.md](./design.md) の McpAuth）。
2. **Activity の記録の単位** — ツール呼び出しの単位（要件 7）。
3. **単独でリリースしない方法** — 統合ブランチの運用で守る（requirements.md の要件判断 4）。
4. **フラグを分けるか** — 「MCP 連携全体」で 1 つ（`app:mcpEnabled`）。
