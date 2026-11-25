# Research: remote-mcp-server-route

umbrella 全体の調査（claude.ai の挙動、MCP の仕様、先行事例）は [../remote-mcp-server/research.md](../remote-mcp-server/research.md) にある。このファイルは、この spec の要件と既存コードの差を扱う。

## Gap Analysis（2026-11-24）

要件（[requirements.md](./requirements.md)）と既存コードを突き合わせた。コードは読んで確認しただけで、動かしてはいない。`@mastra/mcp` 2.8.0 は依存に入っていないので、tarball の `dist` を読んで確認した。動かさないと分からない項目は「Research Needed」に挙げた。

パスは、断りがなければ `apps/app/src` からの相対。

### 1. 要件に影響する発見

要件を書いた時点で分かっていなかった事実が 4 つある。1.1〜1.3 は要件に反映した。1.4 は設計で扱う。

#### 1.1 エンドポイントのパスと、wiki のページのパス（解決済み）

- GROWI のページは `app.get('/*', ...)` で配信されるので、`/mcp` のような `/_api` の外のパスは、wiki のページのパスと衝突する。
- パスを `/_api/v3/mcp` にすると決めたので、衝突は起きない（要件の確定済みの判断 5）。`/_api` 配下は、ページを作れないパスである（`packages/core/src/utils/page-path-utils/index.ts` の `restrictedPatternsToCreate`）。`utils/is-next-page-route.ts` も、`/_api` をすでに Express 専用として扱う。
- 引き換えに、`/_api` 全体にかかる `CertifyOrigin`（`server/crowi/express-init.js:153`）の検査を受ける。3.9 を参照。

#### 1.2 Activity は、監査ログの設定で記録対象になっているときだけ残る

- `activityService.createActivity` は、`shoudUpdateActivity(action)` が真のときだけ保存する（`server/service/activity.ts:245, 259`）。
- 記録対象は `getAvailableActions()` が決める。`app:auditLogEnabled` の既定は **false** で、そのときは Essential のアクションだけが対象になる。有効のときは、アクションのグループ（Small / Medium / Large）と、追加・除外の設定で決まる。
- 既存の `ACTION_SEARCH_PAGE` は Medium のグループにある。`ACTION_PAGE_VIEW` はどのグループにも入っておらず、追加の設定をしたときだけ残る。
- 要件 7.1 と 7.5 は「記録する」と無条件に書いている。既存の仕組みに乗せるなら、「監査ログの設定で記録対象になっているとき」という条件が付く。
- **決定（2026-11-25）**: どのグループにも入れず、`SupportedAction` に足すだけにする。`ACTION_PAGE_VIEW` と同じ扱いで、追加の設定をしたときだけ残る（要件の確定済みの判断 6、要件 7.1・7.5・7.8）。

#### 1.3 2025 年系のクライアントは、1 リクエストに複数の呼び出しをまとめられる

- `legacy: 'stateless'` のとき、2025 年系のリクエストは JSON-RPC の配列（最大 100 件）を受け付ける。2026-07-28 版は配列を受け付けない。
- 要件 6 は回数を「リクエスト」で数える。配列を使うと、1 リクエストで 100 回のツール呼び出しができる。
- **決定（2026-11-25）**: 配列のリクエストを拒否する（要件の確定済みの判断 7、要件 3.11・6.7）。回数はリクエストで数えたままでよい。`MCPServer` には配列を拒否するオプションが無いので、`startHTTP` に渡す前に、ルートで本文が配列かどうかを見て拒否する。claude.ai が配列を送るかは未確認で、実機で確かめる。

#### 1.4 全文検索が「使えない」の判定が 2 種類ある

- 既存の全文検索ツールは `searchService.isElasticsearchEnabled`（接続先が設定されているか）だけを見る。
- 既存の `/_api/search` は `searchService.isReachable`（設定済みで、かつ接続や検索でエラーが起きていない）を見る。
- 要件 4.7 の「使えない状態」がどちらを指すかで、結果が変わる。接続先が落ちているとき、前者では例外が起きて要件 4.8（検索に失敗した）の経路になる。どちらでも利用者には「検索できない」と伝わるので、設計で決めてよい。

### 2. 要件と既存の資産の対応

凡例: **Reuse** そのまま使える / **Extend** 既存のものを直す / **Missing** 新しく作る / **Constraint** 既存の構造による制約 / **Unknown** 未確認

| 要件 | 既存の資産 | 差 |
|---|---|---|
| 1.1〜1.4 有効化フラグ | `config-definition.ts` の `'app:aiEnabled'`、`'app:vaultEnabled'`（真偽値の設定の前例） | **Missing**: 設定キー。`configManager.getConfig` はリクエストごとに読めるので、再起動なしの切り替えは既存の仕組みで足りる |
| 1.4 無効のときは存在しないパスと同じ応答 | 経路の無い POST は Express の既定の 404（HTML）になる。`/vault.git` は無効のとき 404 のテキストを返す | **Constraint**: 無効のときに `next()` を呼んで素通しすれば、存在しないパスと同じ応答になる。ただし GET は wiki のページ配信に落ちる（1.1） |
| 1.5〜1.6 管理画面 | `pages/admin/vault.page.tsx` と `features/growi-vault/client/admin/VaultAdminSettings.tsx`（`useSiteUrl()` で URL を組み立てて表示する前例）、`AdminNavigation.tsx` | **Missing**: 管理ページ、ナビゲーションの項目、i18n（5 言語） |
| 1.7 管理者だけ | `routerForAdmin` と `adminRequired`。最小の前例は `customize-setting.js` の PUT `/presentation` | **Missing**: 管理 API。**Unknown**: どの管理用スコープを要求するか（新設しない前提で既存から選ぶ） |
| 1.8 AI の設定に左右されない | `aiReadyGuard` は mastra のルートにだけかかる | **Reuse**: `/_api/v3/mcp` を `aiReadyGuard` の外にマウントすれば足りる |
| 2.1 Bearer のアクセストークン | `accessTokenParser`、`extractBearerToken`、`AccessToken.findUserIdByToken(token, scopes)` | **Constraint**: 3.1 を参照 |
| 2.2〜2.4 Bearer 以外は 401 | `extractAccessToken` は Bearer を最優先で読む | **Missing**: 「Bearer が無ければ 401」の判定。parser は変えずに済む |
| 2.6 旧形式の API トークン | `acceptLegacy` を付けなければ通らない | **Reuse** |
| 2.7 セッションだけでは 401 | parser は、トークンが無い・不正なとき、セッションの `req.user` を残す | **Constraint**: 3.1 を参照 |
| 2.9 リダイレクトしない | `loginRequired` は `/_api` 配下ではリダイレクトせず 403 を返す。401 にはならない | **Missing**: `/_api/v3/mcp` 用の 401 応答 |
| 2.11 認証の差し替え | なし | **Missing**: 認証の差し込み口 |
| 3.1〜3.4、3.7〜3.9 MCP の接続 | なし | **Missing**: `@mastra/mcp` 2.8.0 の追加と `MCPServer` の組み立て。annotation は `createTool` の `mcp.annotations` で書ける |
| 3.3 2025 年系のクライアント | なし | `legacy: 'stateless'` で受けられる。**Constraint**: 3.2 を参照 |
| 3.5 複数インスタンス | — | **Reuse**: 2.x はリクエストごとにサーバーを作る。インスタンスに残る状態は無い |
| 3.6 GET / DELETE | `startHTTP` は GET と DELETE に 405 を返す | **Constraint**: 1.1 を参照 |
| 3.10 メンテナンスモード | `generateUnavailableWhenMaintenanceModeMiddlewareForApi`（503 の JSON） | **Reuse**: `/vault.git` と同じく、ルートの先頭に置く |
| 4.x 全文検索ツール | `full-text-search-tool.ts` | **Extend**: `searchService` の受け取り方、エラー文の漏れ（3.4）。3.3 を参照 |
| 5.x ページ本文取得ツール | `get-page-content-tool.ts` | **Extend**: エラー文の漏れ（3.4）。「見つからない」と「権限がない」はすでに同じ結果を返す |
| 6.1〜6.3 利用者単位の回数制限 | `features/rate-limiter` の `consumePoints(method, key, config)` | **Extend**: `consumePoints` は公開されていない（barrel から出ていない）。3.5 を参照 |
| 6.4 未認証は送信元単位 | グローバルの回数制限が IP 単位で数える | **Reuse**: `/_api/v3/mcp` の設定を足す |
| 6.5 上限の変更 | `API_RATE_LIMIT_*` の env（グローバルの制限用） | **Unknown**: ルート内の利用者単位の制限に、同じ env を使えるか |
| 6.6 全インスタンスの合計 | `RateLimiterMongo`（MongoDB に保存） | **Reuse** |
| 7.1〜7.2 ツール呼び出しの記録 | `activityService.createActivity`（ミドルウェアなしで直接記録する経路。`server/routes/search.ts` と growi-vault が使っている） | **Missing**: アクションの定義、グループ、カテゴリ、i18n（5 言語）。**Constraint**: 1.2、3.6 を参照 |
| 7.5 設定変更の記録 | `addActivity` と `activityEvent.emit('update', ...)`（管理 API の標準の形） | **Missing**: アクションの定義（既存の `ACTION_ADMIN_*` に倣う） |
| 7.7 監査ログでの絞り込み | `SelectActionDropdown.tsx` は、カテゴリごとの配列（アクション名の接頭辞で決まる）を表示する | **Constraint**: 既存のカテゴリの接頭辞に合わないアクションは、どのカテゴリにも出ない。カテゴリを足すか、既存の接頭辞に合わせる |
| 8.1〜8.2 既存の AI 機能を変えない | 既存ツールの spec と integ テスト、`limited-search-tool.spec.ts` | **Reuse**: 既存のテストが退行の検査になる |
| 8.3 起動時に読み込まない | `features/mastra/server/routes/index.ts` の遅延ロード、`no-eager-ai-imports.spec.ts` | **Extend**: 3.7 を参照 |
| 8.5〜8.6 読み込みの失敗 | 同上（失敗したら Promise を捨てて、次のリクエストでやり直す） | **Reuse**: 同じ形で書ける |

### 3. 既存の構造による制約

#### 3.1 `accessTokenParser` をそのまま置くと、セッションの利用者が通ってしまう

- parser は、有効なトークンがあれば `req.user` を上書きする。トークンが無い・不正なときは何もせず、セッションが設定した `req.user` を残す（`server/middlewares/access-token-parser/access-token.ts`）。
- `/_api/v3/mcp` のルートで `req.user` があるかどうかだけを見ると、ブラウザのセッションを持つリクエストが、不正なトークンでも通る。要件 2.5 と 2.7 に反する。
- 対処の候補:
  - **(a)** `/_api/v3/mcp` をセッションの対象から外す（3.8 と同じ対処）。`req.user` はトークンからしか入らなくなる。
  - **(b)** parser の前に `req.user` を消す。
  - **(c)** parser を使わず、`extractBearerToken` と `AccessToken.findUserIdByToken` を直接呼ぶ。growi-vault の `resolvePatUser` が同じ形をとっている。parser が行う「閲覧専用の利用者を拒否する」判定を、自分で書き直すことになる。
- 認証は `remote-mcp-server-oauth` が差し替える暫定のものなので、書く量が少ない (a) + parser の組み合わせが有力。

#### 3.2 `mongoSanitize` が、2026-07-28 版のリクエストを壊す

- `express-init.js` は `mongoSanitize()` を全リクエストにかけている。本文・クエリ・ヘッダーの中で、`$` で始まるキーと `.` を含むキーを、深さを問わず削除する。
- 2026-07-28 版のリクエストは、`params._meta` に `io.modelcontextprotocol/protocolVersion` と `io.modelcontextprotocol/clientCapabilities` を必ず持つ。どちらのキーも `.` を含むので、削除される。SDK は、この 2 つが無いリクエストを 400（-32602）で拒否する。
- つまり、何もしなければ、2026-07-28 版のクライアントは 1 件も通らない。2025 年系のリクエストも、ツールの引数に `.` を含むキーがあれば黙って削られる。
- 対処の候補:
  - **(a)** `/_api/v3/mcp` を `mongoSanitize` より前に処理する（`express-init.js` に手を入れる）。
  - **(b)** `mongoSanitize` に、`/_api/v3/mcp` を除外する条件を足す。
  - **(c)** `bodyParser.json` の `verify` で生の本文を残し、`/_api/v3/mcp` で解析し直す。
- どれも `express-init.js` の変更を伴う。`/_api/v3/mcp` の本文は MongoDB のクエリに渡らない（ツールの引数は zod で検証される）ので、除外しても `mongoSanitize` の目的は損なわない。
- **Research Needed**: 実際に削除されることを、動かして確かめる。

#### 3.3 ツールは、モジュールの読み込み時に作られる定数である

- 2 ツールとも `export const xxxTool = createTool({...})` で、ファクトリではない。`searchService` を引数で渡す場所が無い。
- 利用している場所:
  - `agents/growi-agent.ts`（エージェントに静的に登録）
  - `agents/suggest-path/suggest-path-agent.ts`（ページ本文取得ツール）
  - `agents/suggest-path/limited-search-tool.ts`（`fullTextSearchTool.inputSchema` を再利用し、`fullTextSearchTool.execute` へ委譲する）
  - テスト 6 本
- ファクトリに変えると、エージェントもモジュールの読み込み時に作られているので、`searchService` を渡せるタイミングまで生成を遅らせる変更が、エージェント側まで広がる。
- MCP のツール名は、ツールの `id` ではなく、`MCPServer` の `tools` に渡すオブジェクトのキーで決まる。既存ツールの description は、もう一方のツールを `id`（`get-page-content-tool`）で名指ししている。MCP 向けには、名前と説明を別に持つほうが自然である。

#### 3.4 エラーの文面が、3 か所でそのまま外へ出る

- `full-text-search-tool.ts:209-216`: `reason: err.message || 'search_failed'`
- `get-page-content-tool.ts:313-320`: `reason: err.message || 'fetch_failed'`
- `limited-search-tool.ts:109-116`: 同じ形（MCP には公開しないが、同じ問題を持つ）
- `MCPServer` 側にも経路がある。
  - ツールが例外を投げると、`err.message` を含む JSON がクライアントへ返る。
  - 出力が `outputSchema` に合わないと、出力の先頭 200 文字を含むエラー文が返る。
  - 入力が `inputSchema` に合わないと、渡された引数の先頭 200 文字を含むエラー文が返る（利用者自身の入力なので問題は小さい）。
- 要件 4.8 と 5.8 を守るには、MCP に出すツールが例外を投げないことと、`reason` を固定の文言にすることの両方が要る。既存の AI チャットでは、`reason` は GROWI の中の LLM にしか渡らない。そちらを変えるかは、要件 8.1（結果を同じに保つ）との兼ね合いで決める。

#### 3.5 回数制限は、認証の前に走る

- グローバルの回数制限（`server/routes/index.js:84`）は、ルートごとの認証より前に走る。Bearer のリクエストには IP 単位の枠しか効かない。
- `/_api/v3/mcp` に設定を足さない場合、IP 単位の枠は既定の 500 回 × 5 = 1 分あたり 2,500 回になる。claude.ai の通信は Anthropic の送信元アドレスに集まるので、この枠を全利用者で分け合う。要件 6.3（他の利用者を巻き込まない）のためには、IP 単位の枠を十分に大きくし、利用者単位の枠を認証の後に別に数える必要がある。
- `consumePoints` は `middleware/consume-points.ts` から export されているが、feature の barrel（`features/rate-limiter/index.ts`）からは出ていない。ルートから使うには、barrel に足す。
- 利用者単位のキーを、グローバルの制限と同じ形式（`userId_endpoint_method` の md5）にすると、同じ枠を 2 回消費する場合がある。別の形式のキーにする。
- 正規表現で設定するエンドポイントは、前方一致でしか比べない（`/_api/v3/mcp` は `/_api/v3/mcpfoo` にも一致する）。完全一致の設定（`defaultConfig`）に `/_api/v3/mcp` を足す。

#### 3.6 ツール呼び出しを外から観測する仕組みが無い

- `MCPServer` に、ツール呼び出しごとのフックは無い。あるのは `toolResult.transform`（引数を受け取らず、例外のときは呼ばれない）と `mapAuthInfoToUser`（全メソッドで呼ばれる）だけである。
- Activity を記録する場所の候補:
  - **(a)** ツールの `execute` を包む。ツール名と結果が分かる。IP とエンドポイントは、`req.auth.extra` に入れておけば `context.mcp.extra.authInfo` から取れる。
  - **(b)** Express 側で、`startHTTP` の前に本文の `method` と `params.name` を読む。2025 年系の配列を自分で扱う必要がある。
- (a) のほうが、「実際に実行されたツール」と記録が 1 対 1 になる。
- `activities` には `(user, target, action, createdAt)` の一意の索引がある。同じ利用者が同じミリ秒に同じツールを 2 回呼ぶと、2 件目の保存が失敗する（配列のリクエストで起きうる）。`createActivity` は失敗を握りつぶして `null` を返すので、ツールの実行は止まらないが、記録が 1 件欠ける。

#### 3.7 遅延ロードの検査は、いまの起点では `/_api/v3/mcp` を見張れない

- `server/routes/index.js` は、`server/crowi/index.ts` から動的に `import` されている。そのため、`BOOT_ENTRYPOINTS` からの静的な追跡の外にある。`/_api/v3/mcp` のルートを `routes/index.js` にマウントし、そこから `@mastra/mcp` を静的に読み込んでも、既存の検査は失敗しない。
- `/_api/v3/mcp` 用の検査には、ルートの入口のファイルを起点として明示する必要がある（ai-usage が独自の起点リストを持つ前例がある）。
- 禁止リストの正規表現は `@mastra/` を含むので、`@mastra/mcp` はすでに対象である。
- 既存の 2 ツールのファイルは、`@mastra/core/tools`、`mdast-util-*`、Mongoose のモデルを静的に読み込む。MCP のツールがこれらを使うなら、ツールを含めて遅延ロードの内側に置く。
- `@mastra/mcp` の入口は 1 つだけで（約 926 KB）、サーバーだけを読み込む入口は無い。クライアントの部品と `hono` も一緒に読み込まれる。

#### 3.8 `/_api/v3/mcp` のリクエストのたびに、セッションが作られる

- セッションは `saveUninitialized: true` で動いている。Cookie を持たないクライアントのリクエストごとに、新しいセッションの記録が作られ、`Set-Cookie` が返る。MCP クライアントは Cookie を保持しないので、リクエストの数だけ記録が増える。
- 既存の回避策が 2 つある。
  - `routes/avoid-session-routes.js`: セッションのミドルウェア自体を通さない（`/api-docs` が使っている）。
  - `server/crowi/session-id.ts` の `FIXED_SESSION_ID_PATHS`: 固定のセッション ID を共有する（healthcheck と ai-usage が使っている）。
- 前者なら、3.1 の問題（セッションの利用者が通る）も同時に解消する。

#### 3.9 その他

- **`Origin` の検査**: `CertifyOrigin` は `/_api` 全体にかかる。`Origin` ヘッダーが GROWI のオリジンと違い、クエリにも本文にも `access_token` が無い JSON の POST を、ルートに届く前に拒否する（`server/middlewares/certify-origin.ts`）。`Origin` を送らないリクエストは通す。ブラウザの中から直接つなぐ MCP クライアントは拒否される（GROWI は CORS の応答ヘッダーを返さないので、どのみち接続できない）。MCP の仕様が求める `Origin` の検証とは、向きが合う。拒否の応答は apiv3 のエラー形式で、JSON-RPC の形式ではない。
- **メンテナンスモード**: `/_api/v3` の本体のルーターには `unavailableWhenMaintenanceModeForApi` がかかっている（`server/routes/index.js:215`）。その下か、同じミドルウェアを付けてマウントすれば、要件 8 のメンテナンス中の応答は既存の仕組みで満たせる。
- **本文サイズ**: グローバルの `bodyParser.json` の上限（50 MB）は、ルートに届く前に適用される。SDK 側の 4 MiB の上限は、本文が解析済みのときは効かない。`/_api/v3/mcp` だけ上限を下げるには、`Content-Length` を自分で見るか、`express-init.js` に手を入れる。
- **応答の形式**: 2025 年系のリクエストへの応答は、常に SSE（`text/event-stream`）である。JSON に固定するオプションは 2.8.0 に無い。GROWI は全応答に `compression()` をかけており、SSE も圧縮の対象になる。イベントを 1 つ送って接続を閉じるので、応答が失われることはないはずだが、遅れないかは未確認。
- **`startHTTP` のパスの比較**: `url.pathname` と `httpPath` の完全一致で比べる。末尾のスラッシュが付くと 404 になる。
- **`startHTTP` は応答を自分で書いて終える**。呼んだあとに `next()` を呼んだり、応答を書いたりしてはいけない。
- **`requestState.key`**: 指定しないと、起動のたびに乱数の鍵を作って警告のログを出す。`suspend()` を使うツールが無ければ害は無い。
- **型の欠け**: `@mastra/mcp` 2.8.0 の型定義は、`@mastra/core` 1.80.0 に無い型を 2 つ参照している。`skipLibCheck: true` なので、ビルドは通る。
- **バージョンの固定**: `^2.8.0` と書くと 2.9.0 以降が入りうる。2.9.0 以降は `@mastra/core` 1.83 以上を要求するので、2.8.x に固定する。
- **依存の分類**: `package-dependencies` のルールでは、ビルド後に `.next/node_modules/` に現れるパッケージは `dependencies` に置く。`@mastra/mcp` はサーバーだけで使うが、ビルドして確かめる。

### 4. 実装方針の選択肢

#### Option A: `features/mastra` を拡張する

- `/_api/v3/mcp` のルート、管理 API、管理画面を `features/mastra` の下に足す。
- 既存の 2 ツールを、そのまま `MCPServer` に渡す。`searchService` は、`mapAuthInfoToUser` の中で requestContext に入れる（この関数は requestContext を受け取る）。
- **利点**: 新しいファイルが最も少ない。既存ツールを作り直さない。
- **欠点**:
  - `mapAuthInfoToUser`（利用者を返す関数）に、別の値を入れる副作用を持たせることになる。
  - `features/mastra` は LLM のエージェントの feature で、`aiReadyGuard` の内側にあるものが多い。LLM を使わない MCP が同居すると、境界が読みにくくなる。
  - MCP 向けの名前・説明・annotation を、エージェント用のツール定義に混ぜることになる。
  - エラー文の漏れ（3.4）を直すには、結局ツールの中身に手を入れる。

#### Option B: 新しい feature を作り、ツールも別に書く

- `features/` の下に新しい feature を作り、検索とページ取得の処理を MCP 用に書く。
- **利点**: 既存の AI 機能に一切触れない。要件 8.1 と 8.2 を、変更しないことで満たせる。
- **欠点**: 閲覧権限の判定を含む処理が 2 か所に分かれる。片方だけを直す事故が起きる。要件 4.9（画面の検索と同じ範囲）を、2 か所で守り続けることになる。

#### Option C: 新しい feature を作り、ツールの中身を共有する

- ルート、認証の差し込み口、`MCPServer` の組み立て、管理 API、管理画面、Activity、回数制限を、新しい feature に置く。
- 既存の 2 ツールから、処理の中身を「入力と依存（利用者、`searchService`）を受け取って結果を返す関数」として取り出す。既存のツールは、requestContext から依存を取り出してその関数を呼ぶだけにする。
- MCP 用のツールは、新しい feature の中で定義する。名前、説明、annotation を MCP 向けに書き、同じ関数を呼ぶ。Activity の記録と、エラー文を固定の文言にする処理も、ここに置く。
- **利点**:
  - 閲覧権限の判定は 1 か所のままになる。
  - `searchService` を引数で渡す形になり、brief の「外から注入できる形」を満たす。エージェントの生成のタイミングは変えずに済む。
  - リポジトリの規約（フレームワークの包みから、中身を純粋な関数として取り出す）に沿う。
  - `limited-search-tool` は、既存ツールの `execute` と `inputSchema` を使い続けられる。
- **欠点**:
  - `ai-agentic-search` が持つファイルに手を入れる。spec-lifecycle のルールに従い、変えた内容を同 spec へ書き戻す必要があるかを、設計で判断する。
  - `change-proposal-ai-agent` が、同じ 2 ツールを包んで登録し直す予定を持っている。取り出した関数の形を、その予定と突き合わせる。

### 5. 工数とリスク

- **工数: L（1〜2 週間）**。新しいライブラリの組み込みに加えて、既存ツールの作り直し、管理画面と i18n、Activity のアクション追加、回数制限、遅延ロードの検査、`express-init.js` の変更と、触る場所が多い。個々は既存の前例に倣える。
- **リスク: Medium**。
  - `@mastra/mcp` 2.x は新しく（2.0.0 が 2026-09-22）、claude.ai が送るプロトコルは公表されていない。実機で確かめるまで、接続できるかは分からない。
  - `mongoSanitize`（3.2）とセッション（3.8）は、全リクエストに関わる `express-init.js` の変更を伴う。除外の範囲を `/_api/v3/mcp` に限れば、既存の経路への影響は小さい。
  - 既存ツールの作り直しは、テストが揃っているので退行を検出しやすい。

### 6. 設計への申し送り

#### 推奨する方針

- **置き場所は `features/mastra`（2026-11-25、ユーザー確認済み）**。MCP サーバーは Mastra を使う前提なので、ルート、認証の差し込み口、`MCPServer` の組み立て、管理 API、管理画面を `features/mastra` の下に置く。新しい feature は作らない。
- **管理画面は、既存の「AI 連携」の管理ページ（`pages/admin/ai.page.tsx`、`features/mastra/client/admin/`）に MCP の節を足す（2026-11-25、ユーザー確認済み）**。新しい管理ページとナビゲーションの項目は作らない。MCP の節は、GROWI AI の有効・無効や LLM の設定の状態にかかわらず操作できるようにする（要件 1.8・1.9）。既存の AI 設定の画面が、未設定のときに他の項目を隠す・無効にする作りになっていないかを、設計で確かめる。
- **ツールの構成は Option C のまま**。既存の 2 ツールから処理の中身を関数として取り出し、MCP 用のツール定義を `features/mastra` の中に、エージェント用の定義とは別に置く。閲覧権限の判定を 1 か所に保ったまま、MCP 向けの定義を分けられる。Option A の欠点（`mapAuthInfoToUser` の副作用、定義の混在）は、これで避けられる。
- **URL は `/_api/v3/mcp` のまま**。`features/mastra` のルーター（`/_api/v3/mastra`）は、全体に `aiReadyGuard` をかけている（`features/mastra/server/routes/index.ts`）。その下に置くと要件 1.8（AI の設定に左右されない）に反するので、MCP のルートは別にマウントする。`features/mastra` の中のコードを別の URL にマウントする前例は、`routes/admin-ai-settings` にある。
- ~~認証は、`/_api/v3/mcp` をセッションの対象から外したうえで（3.8）、「Bearer が無ければ 401」の判定と `accessTokenParser` を、差し込み口の暫定の中身にする（3.1 の (a)）。~~ 設計で取り下げた。セッションの対象から外すと csurf と passport がエラーになる。下の「Design Discovery」の Decision を参照。
- Activity は、MCP 用のツールの `execute` の中で `createActivity` を直接呼ぶ（3.6 の (a)）。
- `mongoSanitize` は、`/_api/v3/mcp` を除外する（3.2）。

#### 設計の前に、要件で決めること

1. ~~パスを予約するか（1.1）。~~ パスを `/_api/v3/mcp` にすると決めて解決した。
2. ~~Activity のアクションをどのグループに入れるか（1.2）。~~ グループには入れず、`SupportedAction` に足すだけにすると決めて解決した。
3. ~~回数を、リクエストで数えるか、ツール呼び出しで数えるか（1.3）。~~ 配列のリクエストを拒否すると決めて解決した。

#### Research Needed（設計または実装の最初に、動かして確かめる）

1. `mongoSanitize` が、`_meta` の `.` を含むキーを実際に削除すること。除外したあとに、2026-07-28 版のリクエストが通ること。
2. `legacy: 'stateless'` で、`initialize` を経ていないサーバーが `tools/call` に応答すること（Mastra の文書には応答すると書かれているが、コードでは確かめていない）。
3. claude.ai が実際に送るプロトコルリビジョンと、ヘッダーと本文のリビジョンが食い違うリクエストの有無。
4. `compression()` の下で、2025 年系の SSE の応答が遅れずに届くこと。
5. `@mastra/mcp` を読み込んだときのメモリの増加量（要件 8.3 を説明する根拠にする）。
6. ビルド後に、`@mastra/mcp` と `@modelcontextprotocol/*` が `.next/node_modules/` に現れるか。
7. 管理 API に要求する、既存の管理用スコープ。
8. ルート内の利用者単位の回数制限に、運用者が上限を変える手段をどう持たせるか（既存の `API_RATE_LIMIT_*` の env を使えるか）。
9. claude.ai などの MCP クライアントが `Origin` ヘッダーを送るか。送る場合、`CertifyOrigin` に拒否される（3.9）。
10. claude.ai が配列のリクエストを送らないこと（1.3）。

---

## Design Discovery（2026-11-25）

- **Discovery Scope**: Extension（既存の Express と `features/mastra` への組み込み）。ギャップ分析と umbrella の調査が済んでいるので、統合点の確認に絞った。
- **Key Findings**:
  - セッションを通さないリクエストは、csurf と passport でエラーになる。`avoid-session-routes` は `/_api/v3/mcp` に使えない。
  - 既存の回数制限は「利用者 1 人あたり」と「IP 1 つあたり」の 2 つをすでに持っている。足りないのは、認証の後に前者を呼ぶ手段だけである。
  - 監査ログのカテゴリは、アクション名の接頭辞で決まる。接頭辞に合わないアクションは、絞り込みの一覧に出ない。

### Research Log

#### セッションを通さない経路の可否

- **Context**: ギャップ分析の 3.1 と 3.8 は、`/_api/v3/mcp` をセッションの対象から外すことを勧めていた。
- **Sources Consulted**: `server/crowi/express-init.js`、`csurf@1.11.0` の `index.js`、`passport@0.6.0` の `lib/strategies/session.js`。
- **Findings**:
  - csurf は、メソッドの判定より前に `req.session` から secret を読む。`req.session` が無いと `misconfigured csrf` を投げる。
  - passport 0.6 の `SessionStrategy` は、`req.session` が無いと `Login sessions require session support` のエラーにする。
  - `FIXED_SESSION_ID_PATHS`（`server/crowi/session-id.ts`）は、Cookie の無いリクエストに固定のセッション ID を割り当てる。healthcheck と ai-usage が使っている。
- **Implications**: 固定のセッション ID を使う。この場合、ブラウザのセッションを持つリクエストでは `req.user` が入った状態でルートに届く。認証は `req.user` を見ない作りにする。

#### 既存の回数制限の構造

- **Context**: ギャップ分析の Research Needed 8（利用者単位の上限を、運用者がどう変えるか）。
- **Sources Consulted**: `features/rate-limiter/middleware/factory.ts`、`consume-points.ts`、`rate-limiter-factory.ts`、`utils/config-generator.ts`、`config/index.ts`。
- **Findings**:
  - グローバルの制限は、利用者単位（`maxRequests`）と IP 単位（`maxRequests × usersPerIpProspection`）を、同じエンドポイントの設定から数える。
  - エンドポイントの設定は、`defaultConfig` と env（`API_RATE_LIMIT_<名前>_ENDPOINT` / `_METHODS` / `_MAX_REQUESTS` / `_USERS_PER_IP`）を合成して作る。合成の結果は `factory.ts` のモジュールの中にあり、外から読めない。
  - env で `_USERS_PER_IP` を省くと、`Number(undefined)` が `NaN` になり、IP 単位の枠が `NaN` になる。
- **Implications**: 設定の解決を関数として取り出し、`consumeUserPoints` を公開する。同じ設定を使うので、既存の env がそのまま利用者単位の上限にも効く。Research Needed 8 は解決した。

#### 管理 API のスコープ

- **Context**: ギャップ分析の Research Needed 7。
- **Findings**: `admin-ai-settings` は `SCOPE.READ.ADMIN.AI` と `SCOPE.WRITE.ADMIN.AI` を使っている。
- **Implications**: MCP の設定は同じ管理ページに置くので、同じスコープを使う。新しいスコープは作らない。

#### 既存の AI 設定の画面の作り

- **Context**: MCP の節を、AI の設定の状態によらず操作できるようにする（要件 1.9）。
- **Findings**: `AiSettings` は、1 つの react-hook-form と 1 回の PUT で全体を保存する。設定の読み込みが済むまで何も描画しない。env だけで設定する方式では、有効化のスイッチが無効になる。
- **Implications**: MCP の節を `AiSettings` のフォームに入れると、これらの影響を受ける。`AiSettings` と並ぶ独立した部品にして、自分の取得と保存を持たせる。

### Design Decisions

#### Decision: 認証は `accessTokenParser` を使わず、独立した関数にする

- **Context**: 要件 2.2〜2.4（Bearer だけ）と 2.7（セッションだけでは 401）。固定のセッション ID を使うので、`req.user` が入った状態で届くことがある。
- **Alternatives Considered**:
  1. `accessTokenParser` の前に `req.user` を消し、Bearer の有無を先に見る。
  2. parser の中身を関数として取り出し、parser と MCP の両方から使う。
  3. `extractBearerToken` と `AccessToken.findUserIdByToken` を直接使う、独立した認証を書く。
- **Selected Approach**: 3。
- **Rationale**: 認証は `remote-mcp-server-oauth` が置き換える。置き換えたあとに残るものを作らないよう、1 ファイルで消せる形にする。2 は、置き換えの後に使われない公開の関数が `access-token-parser` に残る。1 は、打ち消しの処理が parser の内部の動作に依存する。
- **Trade-offs**: 「閲覧専用の利用者を拒否する」判定が、parser と 2 か所になる。境界のテストで固定する。
- **Follow-up**: `remote-mcp-server-oauth` が認証を差し替えるときに、`access-token-authenticator.ts` を削除する。

#### Decision: 呼び出し元の情報は `AuthInfo.extra` で運ぶ

- **Context**: ツールは、利用者・IP・エンドポイントを必要とする（閲覧権限の判定と Activity）。
- **Alternatives Considered**:
  1. `mapAuthInfoToUser` で利用者を requestContext に入れ、IP とエンドポイントは `authInfo.extra` から読む。
  2. `AsyncLocalStorage` で運ぶ（Postiz の方法）。
  3. 3 つとも `authInfo.extra` に入れ、1 つの関数で取り出す。
- **Selected Approach**: 3。
- **Rationale**: 取り出す場所が 1 か所になり、型ガードも 1 つで済む。ライブラリが用意した経路だけを使う。
- **Follow-up**: `extra` の値がそのまま届くことを、実装の最初に確かめる（design.md の Verification Checkpoints 3）。届かなければ 1 にする。

#### Decision: MCP 用のツールは宣言の一覧にして、実行役を 1 つにする

- **Context**: Activity の記録と、例外を固定の出力に置き換える処理は、どのツールでも同じである。
- **Selected Approach**: ツールごとに宣言（名前、アクション、スキーマ、中身、固定の出力）を書き、`buildMcpTools` が同じ手順で `createTool` のツールにする。
- **Rationale**: リポジトリの規約（実行役は対象の一覧を引数で受け取る）に沿う。ツールを足すときに、記録や例外の扱いを書き忘れない。`change-proposal` umbrella が将来 MCP のツールを足すときも、宣言を足すだけで済む。

#### Decision: 「全文検索が使えない」は、接続先が設定されていないことを指す

- **Context**: ギャップ分析の 1.4。
- **Selected Approach**: 共有関数は、既存のツールと同じ `isElasticsearchEnabled === false` を「使えない」とする。接続先が落ちているときは例外になり、「失敗した」として返る。
- **Rationale**: エージェント用のツールの動作を変えずに、中身を共有できる（要件 8.1）。MCP の利用者には、どちらも「検索できない」ことが伝わる。

#### Decision: 本文サイズの上限は、この spec で扱わない

- **Context**: brief は「`/_api/v3/mcp` に合った上限を設計で決める」としていた。
- **Selected Approach**: 扱わない（design.md の Non-Goals）。
- **Rationale**: 本文は、ルートに届く前にグローバルの `bodyParser.json` が読み終える。ルートで上限を見ても、メモリの消費は防げない。上限を下げるには、全 API に関わる `express-init.js` の変更が要る。

### Synthesis

- **Generalization**: 「利用者単位の回数制限を、認証の後に呼ぶ」は MCP に固有ではないので、`features/rate-limiter` の公開の関数にした。`mongoSanitize` の除外も、パスの一覧を受け取る包みにした。どちらも、今の利用者は MCP の 1 つだけである。
- **Build vs. Adopt**: MCP のプロトコルは `@mastra/mcp` に任せる。回数の計数、Activity、設定、閲覧権限の判定は、既存のものを使う。新しく作るのは、認証の差し込み口と、ツールの宣言と実行役だけである。
- **Simplification**: `mapAuthInfoToUser` と requestContext、MCP 専用の管理ページ、MCP 専用の管理用スコープ、本文サイズの検査を外した。

### Risks & Mitigations

- claude.ai が送るプロトコルの版・`Origin`・バッチの有無が未確認 — 実装の最初と、実機での確認で確かめる（design.md の Verification Checkpoints 8）。
- `@mastra/mcp` 2.8.0 の動作のうち、コードを読んだだけのものがある — Verification Checkpoints 1〜5 を、実装の最初のタスクにする。
- 既存ツールからの取り出しで、AI チャットの結果が変わる — 既存の spec を変えずに通すことを、取り出しのタスクの完了条件にする。

---
_Updated: 2026-11-25. 設計の調査と判断（Design Discovery）を足した。Prior: 2026-11-25. 置き場所を `features/mastra` にする決定を、設計への申し送りに足した。Prior: 2026-11-25. パスを `/_api/v3/mcp` にする決定を反映した（1.1 を解決済みにし、`CertifyOrigin` の制約を 3.9 に足した）。Prior: 2026-11-24. ギャップ分析を記録。_
