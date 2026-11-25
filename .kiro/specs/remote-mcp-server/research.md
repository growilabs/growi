# remote-mcp-server Research

discovery（2026-11-24）で確かめた事実をまとめる。sub-spec の要件・設計はここを前提にしてよいが、「第三者の報告」「未確認」と書いた項目は実機で確かめること。

根拠の種類:

- **[src]**: パッケージの tarball またはリポジトリのコードを読んで確認した。
- **[npm]**: `npm view` で確認した。
- **[doc]**: 公式ページで確認した。
- **[3p]**: 第三者の報告だけが根拠。
- **[未確認]**: 確認できなかった。

## A. @mastra/mcp のバージョン

| バージョン | 公開日 | 必要な `@mastra/core` | 同梱の MCP SDK |
|---|---|---|---|
| 1.18.0（1.x の最後） | 2026-09-15 | >=1.64.0 <2 | `@modelcontextprotocol/sdk` ^1.29.0 と分割パッケージ 2.0.0 |
| 2.8.0 | 2026-11-03 | >=1.79.0 <2 | `core` / `server` / `client` 2.4.0、`node` 2.1.2 |
| 2.9.0 / 2.10.0（最新） | 2026-11-12 / 11-17 | >=1.83.0 <2 | 2.8.0 と同じ |

- apps/app の現在の解決バージョンは `@mastra/core` 1.80.0、`@mastra/memory` 1.20.2、`@mastra/ai-sdk` 1.4.4、`zod` 4.6.6。`@mastra/mcp` と `@modelcontextprotocol/sdk` はどの package.json にも無い。[src]
- **core 1.80.x のまま入る最新版は 2.8.0。** zod の peer（^4.2.0）も満たす。ライセンスは Apache-2.0。[npm]
- 2.10.0 に上げるには core 1.83 以上が要る。memory・ai-sdk・mongodb は peer の範囲上は上げなくてよいが、実行時の互換は試していない。[npm] [未確認]
- 2.7.0 以降は `tsx` と `json-schema-to-typescript` を実行時の依存として持つ。展開後のサイズは約 6.6 MB。[npm]
- Node は 22.13 以上が要る。[npm]

## B. MCPServer の動作（2.8.0 の dist を読んで確認）

- **2.x は常にリクエスト単位で動く。** `serverless` と `sessionIdGenerator` のオプションは無くなった。`startHTTP({ url, httpPath, req, res, options })` の `options` は `enableDnsRebindingProtection` / `allowedHosts` / `allowedOrigins` だけ。[src]
- **2025 年系クライアントの扱いは、コンストラクタの `legacy: 'reject' | 'stateless'` で決まる。** Mastra の既定は `'reject'`。`'stateless'` にすると、`initialize` を使うリクエストごとに新しいサーバーを作って応答し、GET と DELETE には 405 を返す。[src]
- **body-parser と衝突しない。** `startHTTP` は `req.body` を使い、ストリームを読み直さない。SDK 側の本文サイズ上限（既定 4 MiB）は、body-parser が先に読んだ場合は効かない。GROWI のグローバルな `bodyParser.json` の上限は 50 MB。[src]
- **認証情報の流れ**: `req.auth` → `context.mcp.extra.authInfo`。`MCPServer` の設定に `mapAuthInfoToUser` を書くと、戻り値が requestContext の `user` に入る。[src]
- **ツールの requestContext に入るもの**: `authInfo`、`user`（mapper が返したときだけ）、`traceContext`（クライアントが送ったときだけ）。既存ツールが読む `searchService` は入らない。[src]
- **複数インスタンスでの注意**: `suspend()` を使うツールは、インスタンス間で共有した `requestState.key` が要る。イベントと購読はプロセス内だけで動く。[src]
- **`createOAuthMiddleware`**: protected-resource メタデータをルートの well-known にだけ出す（`/_api/v3/mcp` つきのパスには出さない）。401 のチャレンジに `scope` が無い。`validateToken` を省くとどのトークンも通す。`req.auth` を設定しない。[src]

## C. プロトコルリビジョン

- **2026-07-28 版は実在する。** セッションと `initialize` を廃止し、各リクエストが `_meta` でバージョンを運ぶ。`server/discover` が必須になった。[doc]
- 同梱 SDK が受ける旧版は 2025-11-25、2025-06-18、2025-03-26、2024-11-05、2024-10-07。新版は 2026-07-28 だけ。[src]
- **claude.ai が送るリビジョンを Anthropic は公表していない。** [doc]
- コネクタ追加時の確認は 2025-11-25 の `initialize` で来て、ツール呼び出しは 2026-07-28 で来るという報告がある。ヘッダーが 2025-11-25、本文が 2026-07-28 と食い違うリクエストが来たという報告もあり、同梱 SDK はこの食い違いを拒否する。[3p]
- **結論**: `legacy: 'stateless'` は事実上必須。claude.ai の実機での確認を早い段階で行う。

## D. claude.ai のカスタムコネクタ

- **認証の種類**: OAuth（DCR）、OAuth（CIMD）、利用者が入力するクライアント ID、固定のリクエストヘッダー、認証なし。**固定のリクエストヘッダーはベータで、一部の組織に限られる。** [doc]
- **コールバック**: `https://claude.ai/api/mcp/auth_callback`。Claude Code は `http://localhost:<port>/callback` と `http://127.0.0.1:<port>/callback` で、ポートを問わない一致が要る。[doc]
- **CIMD のクライアント ID**: `https://claude.ai/oauth/mcp-oauth-client-metadata`（Claude Code は `https://claude.ai/oauth/claude-code-client-metadata`）。どちらも `token_endpoint_auth_method` は `none`。[doc]
- **CIMD が選ばれる条件**: 認可サーバーのメタデータに `client_id_metadata_document_supported: true` があり、`token_endpoint_auth_methods_supported` に `"none"` が含まれること。満たさないと DCR に切り替わる。[doc]
- **discovery**:
  - サインインの開始には、401 と `WWW-Authenticate: Bearer resource_metadata="…"` が要る。200 の応答に付けたヘッダーは無視される。
  - well-known は `/.well-known/oauth-protected-resource/<MCP のパス>` を先に、次にルートを確認する。
  - メタデータの `resource` は、利用者が入力した URL とパスまで一致しなければならない。
  - `authorization_servers` は先頭の 1 件だけが使われる。[doc]
- **スコープ**: 401 のチャレンジの `scope`、無ければ protected-resource の `scopes_supported` から取る。[doc]
- **resource パラメータ**: authorize と token の両方に、MCP の URL（ホストは小文字、末尾のスラッシュなし、パスあり）を送る。[doc]
- **トークン**: 401 を受けたときと、期限の最大 5 分前に更新する。公開クライアントのリフレッシュトークンはローテーションが必須。無効なリフレッシュトークンには `invalid_grant` を返す。`/token` は `application/x-www-form-urlencoded` を受ける。[doc]
- **ネットワーク**: 送信元は `160.79.104.0/21`（IP の一覧ページには `153.61.208.0/20` もある）。IPv4 だけ、標準の HTTPS ポートだけ。ホスト名は公開アドレスにだけ解決されること。[doc]
- **上限**: ツールの結果は約 15 万文字、ツールのタイムアウトは 240 秒。[doc]

## E. MCP の認可仕様（2026-07-28）と CIMD

- **リソースサーバー（`/_api/v3/mcp`）**: RFC 9728 のメタデータが必須。トークンが自分宛てに発行されたことの検証が必須。無効なトークンには 401、スコープ不足には 403。401 のチャレンジに `scope` を入れることが推奨。[doc]
- **認可サーバー**: OAuth 2.1 が必須。RFC 8414 のメタデータが必須で、`code_challenge_methods_supported` が無いとクライアントが先へ進まない。リダイレクト URI は完全一致。公開クライアントのリフレッシュトークンはローテーション必須。CIMD は推奨、DCR は任意（非推奨）。`iss` の返却は推奨。[doc]
- **CIMD の取得**（仕様とドラフト `draft-ietf-oauth-client-id-metadata-document-03`）:
  - `client_id` の URL は https で、パスが `/` 以外、フラグメントなし。
  - リダイレクトを追わない。200 だけを有効とする。
  - 文書の `client_id` が URL と完全に一致することを確かめる。
  - 応答サイズに上限を設ける（5 KB が目安）。
  - 特殊用途のアドレス（RFC 6890）に解決される URL は取得しない。
  - エラーや不正な文書はキャッシュしない。キャッシュ期間に上限を設ける。
  - 同意画面にリダイレクト先のホスト名を表示する。[doc]

## F. クライアントごとの CIMD / DCR 対応

| クライアント | CIMD | DCR | 根拠 |
|---|---|---|---|
| claude.ai / Desktop / mobile | 対応（既定） | 予備 | [doc] |
| Claude Code | 対応 | 予備 | [doc] |
| ChatGPT コネクタ | 対応 | 予備 | [3p] |
| VS Code / Copilot | 対応（1.106 以降） | 予備 | [3p] |
| Cursor | 未対応（報告が割れている） | 必須 | [3p] |
| Gemini CLI | 未対応 | 必須 | [3p] |

## G. 先行事例とライブラリ

- **Postiz**（NestJS + `@mastra/mcp` + 自前の認可サーバー）: セッションを持つ構成では、レプリカ間でセッションが共有されず claude.ai 側で「ツールなし」になり、メモリリークも起きた。ステートレスにして解決した。ディレクトリ審査では、何でも受けるエージェントツールが拒否された。
- **Outline**（wiki。本体に認可サーバーを内蔵）[src]:
  - `@node-oauth/oauth2-server` の上に作っている。
  - トークンは不透明な文字列で、SHA-256 のハッシュで保存する。
  - 有効期間はアクセストークン 1 時間、リフレッシュトークン 30 日、認可コード 300 秒。
  - リフレッシュトークンは毎回入れ替える。再利用を検知すると連携全体を失効する。同時更新のために 10 秒の猶予を置く。
  - protected-resource メタデータをルートと `/mcp` つきの両方のパスに出す。
  - CIMD の取得は、リダイレクトを追わず、タイムアウト 5 秒、上限 5 KB、キャッシュは 5 分から 24 時間。
  - DCR は 1 時間に 5 回までで、使われていないクライアントを毎日掃除する。
  - `resource` パラメータの処理は見当たらない。
- **ライブラリ**:

| ライブラリ | ライセンス | PKCE S256 | RFC 8707 | CIMD | 備考 |
|---|---|---|---|---|---|
| `@node-oauth/oauth2-server` 5.3.1 | MIT | あり（`plain` も許すので自分で絞る） | なし | なし | フレームワークに依存しない。保存先を差し替えられる |
| `oidc-provider` 9.15.1 | MIT | あり | あり | 実験的 | Koa ベース。OIDC 一式を含み重い |
| `@modelcontextprotocol/server-legacy` 2.4.0 | Apache-2.0 | 未確認 | 未確認 | なし | 非推奨。v3 で削除予定 |

## H. GROWI のコードで確かめたこと

パスは `apps/app/src` からの相対。

### accessTokenParser

- シグネチャは `(scopes?: Scope[], opts?: { acceptLegacy: boolean })`。**トークンの取得元をヘッダーに限るオプションは無い。**（`packages/core/src/interfaces/server/access-token-parser.ts`）
- 取得元の順序は、`Authorization: Bearer` → `x-growi-access-token` ヘッダー → `req.query.access_token` → `req.body.access_token`。（`server/middlewares/access-token-parser/extract-access-token.ts`）
- 自分では 401 / 403 を返さない。トークンが無い・不正なときはそのまま `next()` を呼ぶ。
- `req` に設定するのは `req.user` だけ。トークン自体やスコープは残さない。
- スコープは、要求したものをすべて持つトークンだけが通る。

### AccessToken モデル

- Mongoose のモデル（`server/models/access-token.ts`）。フィールドは `user`、`tokenHash`（SHA-256）、`expiredAt`、`scopes`、`description`。
- 期限切れの削除は 1 日 1 回のジョブ（`server/service/access-token/access-token-deletion-cron.ts`）。
- 個人設定の API は `/_api/v3/personal-setting/access-token`（一覧・発行・1 件削除・全削除）。
- **1 件削除は所有者を確かめていない。** `DELETE /access-token?tokenId=` は `AccessToken.deleteTokenById(tokenId)` を利用者の条件なしで呼ぶ（`server/routes/apiv3/personal-setting/delete-access-token.ts`）。ログイン済みの利用者が、他人のトークンの ID を指定して削除できる。この umbrella の範囲外だが、OAuth の発行トークンを同じモデルに載せるなら先に直す必要がある。

### スコープ

- 定義は `packages/core/src/interfaces/scope.ts`。スコープを足すには、種・型・i18n の説明文の 3 か所を変える。
- `read:features:page` は、ページ取得（`GET /_api/v3/page`）と全文検索（`/_api/search`）の両方がすでに要求している。

### 既存の 2 ツール

- `features/mastra/server/services/mastra-modules/tools/full-text-search-tool.ts`: requestContext から `user` と `searchService` を読む。
- `get-page-content-tool.ts`: `user` だけを読む。「見つからない」と「権限がない」を `not_found_or_forbidden` の 1 つにまとめて返す。ただし例外を捕まえたときは `reason` に `err.message` をそのまま入れる。
- 所有する spec は `ai-agentic-search`。
- 全文検索ツールは `agents/suggest-path/limited-search-tool.ts` からも包んで使われている。
- `change-proposal-ai-agent` の設計は、この 2 ツールを `withReadRecording` で包んで登録し直す予定（未実装）。

### Express の配線

- `loginRequired` は、未認証リクエストを `/_api/` 配下では 403、それ以外では `/login` へのリダイレクトにする。どちらも 401 ではないので、`/_api/v3/mcp` には使えない。
- グローバルの回数制限（`features/rate-limiter`）は、ルートごとの `accessTokenParser` より前に走る。トークンだけのリクエストは `req.user` が無いので、IP 単位の制限だけが効く。claude.ai の通信は Anthropic の送信元アドレスに集まるので、全利用者が 1 つの枠を分け合うことになる。
- csurf は `ignoreMethods` に POST を含む設定で、実質的に PATCH しか検査していない。同意画面の POST は自前の CSRF 対策が要る。
- `CertifyOrigin` は `/_api` 全体にかかるので、`/_api/v3/mcp` にもかかる。`Origin` ヘッダーが GROWI のオリジンと違い、クエリにも本文にも `access_token` が無い JSON の POST を拒否する。`Origin` を送らないリクエスト（サーバー間の通信）は通す。
- ログイン後に戻る先は `req.session.redirectTo`。`pages/login/index.page.tsx` は Referer がページのとき、この値を上書きする。
- `/.well-known/*` のルートは存在しない。
- Next のページを Express から描画する前例は `/forgot-password`、`/user-activation/:token`。

### その他

- 遅延ロードの検査は Vitest の spec（`features/mastra/server/no-eager-ai-imports.spec.ts`）。禁止リストは正規表現で、`@mastra/` で始まるパッケージはすでに含まれる。
- `aiReadyGuard` は AI が無効・未設定のとき 501 を返す。
- SSRF を防ぐ汎用の取得関数は無い。`features/search-attachments/server/services/validate-extractor-uri.ts` はクラウドのメタデータのアドレスだけを塞ぎ、ループバックとプライベートアドレスは通す。
- リバースプロキシや Basic 認証の文書はリポジトリ内に無い。外部の docs.growi.org にある。

---
_Updated: 2026-11-24. discovery の調査結果を記録。_
