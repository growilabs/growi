# Brief: remote-mcp-server-oauth

> umbrella: [remote-mcp-server](../remote-mcp-server/roadmap.md)。調査で確かめた事実は [research.md](../remote-mcp-server/research.md) にある。
>
> **状態**: `remote-mcp-server-route` の実装を先に進める。この spec の未決の論点（末尾）は、requirements を始める前に決める。

## Problem

`remote-mcp-server-route` の `/_api/v3/mcp` は、暫定として手動発行のアクセストークンで認証している。利用者は GROWI でアクセストークンを発行し、MCP クライアントのリクエストヘッダーに貼る必要がある。claude.ai のカスタムコネクタの既定の手順（URL を入れて「今すぐサインイン」）では接続できない。claude.ai のリクエストヘッダー指定はベータで、一部の組織でしか使えない。

## Current State

- GROWI は OAuth の認可サーバーの機能を持たない。`/.well-known/*` のルートも無い。
- `remote-mcp-server-route` の `/_api/v3/mcp` は、未認証のリクエストにチャレンジなしの 401 を返す。
- アクセストークンは、利用者が個人設定の画面で手動で発行する。有効期限とスコープを持ち、SHA-256 のハッシュで保存される。

## Desired Outcome

- 利用者が claude.ai の「カスタムコネクタを追加」に `https://<site>/_api/v3/mcp` を入れ、既定の設定のまま進むと、GROWI のログイン画面と同意画面を経て接続が完了する。
- 接続後、Claude はその利用者の閲覧権限の範囲で wiki を検索・閲覧できる。
- 利用者は、GROWI の設定画面で連携中のアプリを確認し、失効できる。
- `/_api/v3/mcp` は、認可サーバーが発行したトークンだけを受け付ける。手動発行のアクセストークンは受け付けない。

## Approach

GROWI 本体が OAuth 2.1 の認可サーバーを兼ねる。MCP 仕様は、認可サーバーとリソースサーバーの同居を認めている。

- **discovery**: protected-resource メタデータ（RFC 9728）と認可サーバーのメタデータ（RFC 8414）を well-known に出す。`/_api/v3/mcp` の未認証時の 401 に `WWW-Authenticate: Bearer resource_metadata="..."` と `scope` を足す。
- **認可**: `GET /oauth/authorize` でクライアントを確認し、既存のログインを経て、同意画面を表示する。`POST /oauth/authorize` で、許可なら短命の認可コードを発行する。
- **トークン**: `POST /oauth/token` で、`authorization_code`（PKCE S256）と `refresh_token`（ローテーション）を扱う。
- **クライアントの確認**: CIMD を主とする。
- **`/_api/v3/mcp` の認証の差し替え**: `remote-mcp-server-route` が用意した認証の差し込み口の中身を、暫定の認証（手動発行のアクセストークン）から、認可サーバーが発行したトークンだけを受け付けるものに入れ替える。ツールと、利用者を特定したあとの処理は変更しない。

実装の土台の候補は 2 つある。設計で決める。

- **`@node-oauth/oauth2-server`**（MIT）: Outline が使っている。保存先を差し替えられる。CIMD、`resource` の検証、`iss` の返却は自分で書く。
- **自前の実装**: 扱う grant が 2 種類だけなので、依存を増やさずに書ける。

`oidc-provider` は OIDC 一式を含み、Koa ベースで重いので候補から外す。

## Scope

- **In**:
  - `GET /.well-known/oauth-protected-resource`（ルートと `/_api/v3/mcp` つきの両方のパス）: `resource`、`authorization_servers`、対応スコープ
  - `GET /.well-known/oauth-authorization-server`: `issuer`、各エンドポイント、`code_challenge_methods_supported: ["S256"]`、`client_id_metadata_document_supported: true`、`token_endpoint_auth_methods_supported` に `"none"`
  - `/_api/v3/mcp` の認証の差し替え（発行したトークンだけを受け付ける）と、未認証時の 401 へのチャレンジの追加。どちらも `remote-mcp-server-route` が用意した差し込み口を使う
  - `GET /oauth/authorize`: クライアントの確認 → 既存のログイン → 同意画面（クライアント名、リダイレクト先のホスト名、要求スコープを表示する）
  - `POST /oauth/authorize`: 許可なら認可コードを発行して `redirect_uri` へ戻す。拒否なら `error=access_denied`。CSRF 対策
  - `POST /oauth/token`: `authorization_code`（PKCE S256、`redirect_uri`、`resource` を検証する。コードは 1 回だけ使える）と `refresh_token`（ローテーション。無効なら `invalid_grant`）
  - CIMD によるクライアントの確認と、取得時の SSRF 対策
  - 新しいモデル（OAuth のクライアント / 連携、認可コード、リフレッシュトークン）。Prisma で作る
  - 利用者向けの「連携中のアプリ」一覧と失効
  - Basic 認証つき環境向けの案内
- **Out**:
  - `/_api/v3/mcp` のツールと、利用者を特定したあとの処理（`remote-mcp-server-route` が持つ）
  - 手動発行のアクセストークンでの `/_api/v3/mcp` 利用と、Basic 認証つきの環境向けの代替の認証手段
  - 外部 IdP を認可サーバーにする構成
  - OIDC（ID トークン、userinfo）
  - `client_credentials` などの他の grant
  - claude.ai のディレクトリ掲載

## Boundary Candidates

- **discovery**: well-known 2 本と 401 のチャレンジ。`remote-mcp-server-route` の要求スコープと有効化フラグを読む
- **クライアントの確認**: CIMD の取得・検証・キャッシュ、SSRF 対策
- **認可の画面と手続き**: authorize、ログインからの復帰、同意画面、CSRF 対策
- **トークンの発行と更新**: 認可コード、PKCE、リフレッシュトークンのローテーションと再利用の検知
- **連携の管理**: 利用者向けの一覧と失効、管理者による失効、期限切れの掃除

## Out of Boundary

- `accessTokenParser` のスコープ判定の規則
- 既存のログイン方式（LDAP、SAML、OAuth クライアント、Passkey）の振る舞い
- 手動発行のアクセストークンの発行画面

## Upstream / Downstream

- **Upstream**:
  - `remote-mcp-server-route`: `/_api/v3/mcp`、要求スコープの宣言、有効化フラグ、認証と 401 応答の差し込み口
  - `accessTokenParser` と AccessToken モデル（spec: `access-token-parser`）
  - 既存のログインとセッション、`app:siteUrl`、Prisma、`features/rate-limiter`、Activity の仕組み
- **Downstream**:
  - 将来の DCR 対応、ディレクトリ掲載
  - 将来の書き込み系ツール（`change-proposal-mcp`）が要求する追加のスコープ

## Existing Spec Touchpoints

- **Extends**:
  - `access-token-parser`: 未決 2 で案 A（既存の AccessToken に載せる）を選び、「連携から発行したトークン」の選り分けを parser に持たせる場合は、spec-lifecycle のルールに従った書き戻しが要る。案 B（OAuth 専用のモデル）なら、`/_api/v3/mcp` は parser を使わなくなるので、parser の約束は変わらない。
- **Adjacent**:
  - `oauth2-email-support`: メール送信用の OAuth クライアント。名前が似ているが関係しない。
  - 既存の Passport の OAuth / OIDC ログイン: GROWI が OAuth の**クライアント**になる機能。この spec は GROWI が**認可サーバー**になる機能で、コードを共有しない。

## Constraints

- **`app:siteUrl` が必須**: `issuer`、`resource`、各エンドポイントの URL は `app:siteUrl` から作る。未設定のときは認可サーバーを動かさない。メタデータの `resource` は、利用者が入力した URL とパスまで一致しなければならない。
- **CIMD が選ばれる条件**: 認可サーバーのメタデータに `client_id_metadata_document_supported: true` と、`token_endpoint_auth_methods_supported` の `"none"` の両方が要る。欠けると claude.ai は DCR に切り替え、DCR も無ければ接続を拒否する。
- **claude.ai の動作に合わせること**:
  - コールバックは `https://claude.ai/api/mcp/auth_callback`。Claude Code はループバックで、ポートを問わない一致が要る。
  - `/token` は `application/x-www-form-urlencoded` を受ける。
  - 期限の最大 5 分前と、401 を受けたときに更新する。応答の制限時間は discovery・token が 10 秒、更新が 30 秒。
- **CIMD の取得時の SSRF 対策**: GROWI には、SSRF を防ぐ汎用の取得関数が無い。次を満たすものを新しく作る。https だけ。リダイレクトを追わない。200 だけを有効とする。応答サイズの上限（5 KB が目安）とタイムアウト。名前解決した結果が特殊用途のアドレス（ループバック、プライベート、リンクローカルなど）なら取得しない。文書の `client_id` が URL と完全に一致することを確かめる。エラーはキャッシュしない。
- **CSRF**: GROWI の csurf は POST を検査しない設定になっている。同意画面の POST には自前の対策が要る。
- **ログインからの復帰**: ログイン後に戻る先は `req.session.redirectTo`。ログインページは、Referer がページのときにこの値を上書きする。authorize へ確実に戻れることを確かめる。外部 IdP（SAML、OIDC）を経由するログインでも戻れること。
- **新しいモデル**: Prisma で作る。索引は migrate-mongo のマイグレーションで作り、`schema.prisma` に同じ名前で宣言する。期限つきの索引（TTL）は Prisma で表せないので、マイグレーションで作る。
- **トークンの保存**: 認可コード、アクセストークン、リフレッシュトークンは、ハッシュで保存する。
- **Activity**: 連携の許可・拒否・失効、トークンの発行と更新を記録する。`activity-recording` のルールに従う。未認証で呼べる `/oauth/token` は悪用の対象になりやすいので、失敗の記録と回数制限を要件で決める。
- **置き場所**: 認可サーバーは MCP のために作るが、MCP 専用のものではない。そのため `features/mastra` の下に置くとは限らない。置き場所は設計で決める。`/_api/v3/mcp` の認証の差し替えだけは、`remote-mcp-server-route` が `features/mastra` に用意する差し込み口に入る。
- **Basic 認証つきの環境**: Sign in 方式は `Authorization: Bearer` を使うので、プロキシの Basic 認証と衝突する。プロキシ側で `/_api/v3/mcp`、well-known、`/oauth/token` を Basic 認証の対象から外すことが必須で、代替手段は無い。ブラウザで開く `/oauth/authorize` は対象のままでよい。外したパスはインターネットから直接届くようになるので、回数制限で守る。
- **AccessToken の 1 件削除の不具合**: `DELETE /_api/v3/personal-setting/access-token` は所有者を確かめていない（research.md の H）。発行トークンを AccessToken に載せる場合（未決 2 の案 A）は、この不具合を先に直す。

## 検証方法

- ngrok で開発環境を HTTPS で公開し、claude.ai の既定の手順（今すぐサインイン + CIMD）で接続する。
- 連携を GROWI 側で失効したあと、claude.ai からの呼び出しが 401 になり、再度のサインインを求められることを確かめる。
- アクセストークンの期限が切れたあと、リフレッシュトークンで更新されることを確かめる。

## 未決の論点

requirements を始める前に決める。

1. **DCR（`POST /oauth/register`）に対応するか。**
   - claude.ai・Claude Code・ChatGPT・VS Code は CIMD に対応している。Cursor と Gemini CLI は DCR が必須という第三者の報告がある。
   - `/_api/v3/mcp` は手動発行のトークンを受け付けないので、CIMD だけに対応した場合、DCR が必須のクライアントは接続する手段が無い。
   - DCR は MCP 仕様 2026-07-28 で非推奨。対応すると、登録の回数制限、使われていないクライアントの掃除、Basic 認証の除外パスの追加が要る。
   - 推奨案: 初回は CIMD のみ。DCR は umbrella の Future に残し、要望が出てから足す。
2. **OAuth で発行するアクセストークンの持ち方。**
   - 案 A: 既存の AccessToken に「どの連携から発行したか」の参照を足す。`/_api/v3/mcp` では、参照を持つトークンだけを選り分ける。既存の `accessTokenParser` は利用者しか返さないので、選り分けのための変更が要る。個人設定のトークン一覧からは除外し、既存の「全トークン削除」の対象には含める。発行トークンは、同じスコープを要求する REST API でも通る。
   - 案 B: OAuth 専用の Prisma モデルにする。発行トークンを `/_api/v3/mcp` 専用に閉じられ、MCP 仕様の「自分宛てに発行されたトークンだけを受け付ける」に沿う。`/_api/v3/mcp` は `accessTokenParser` を使わなくなる。
   - 推奨案: B。「認可サーバーが発行したトークンだけを受け付ける」という決定に、そのまま沿う。
3. **`resource`（RFC 8707）の検証の厳しさ。** claude.ai は authorize と token の両方に `resource` を送る。認可コードに紐付けて token で一致を確かめるところまでは行う。未決 2 で案 A を選ぶ場合は、トークン自体に宛先を持たせないので、仕様の audience 検証をどこまで満たすかを設計で明記する。
4. **有効期間。** 参考として、Outline はアクセストークン 1 時間、リフレッシュトークン 30 日、認可コード 300 秒。既存の期限切れ削除のジョブは 1 日 1 回なので、1 時間のトークンは最大 1 日分たまる。
5. **リフレッシュトークンの再利用を検知したときの扱い。** 連携全体を失効するか。同時更新のための猶予を置くか（Outline は 10 秒）。
6. **`iss` の返却（RFC 9207）。** 仕様では推奨。将来必須になる見込みがある。初回から入れるか。
7. **Basic 認証つき環境向けの案内の置き場所。** リポジトリ内にリバースプロキシの文書は無い。推奨案は、外部の docs.growi.org への追記を成果物に挙げ、管理画面の MCP 設定にも要点を表示すること。
8. **閲覧専用の利用者の扱い。** 既存のアクセストークンの検証は、閲覧専用の利用者のトークンを受け付けない。Sign in 方式で、閲覧専用の利用者に接続を許すかを決める。
9. **管理者による連携の一覧と失効。** 利用者向けの一覧に加えて、管理者が全利用者の連携を見て失効できる画面を初回から入れるか。
