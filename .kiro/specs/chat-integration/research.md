# Research & Design Decisions — chat-integration

## Summary

- **Feature**: `chat-integration`
- **Discovery Scope**: New Feature（完全なスクラッチ開発。Gen 1 との後方互換は取らない）
- **調査日**: 2026-08-26。`brief.md` の調査（2026-08-25）を引き継ぎ、**実物のパッケージを取得して確認**した。

### Key Findings

1. **ブリーフが「Gen 2 で最も重要な設計判断」と書いていた「チャットサービスに依存しないメッセージ形式」は、Chat SDK が既に持っている。** 自前で定義する必要が無くなり、`@growi/chat` の位置づけが「メッセージ形式ライブラリ」から「GROWI ⇄ proxy の契約型と署名を置く小さな共有パッケージ」へ縮む。
2. **プラットフォームごとの能力差は、ブリーフの想定より大きい。** Teams と Mattermost は slash command を受けられず、Discord と Mattermost は modal を出せない。**mention をコマンド起動の主経路にする**ことで 4 サービス共通の 1 本の経路にまとめられる。
3. **未決 7-a は解決。Discord に外部からの穴は要らない。** 常駐プロセスなら Gateway だけで slash command もボタンも受けられる。閉域構成で穴が要るのは **Teams だけ**。
4. **未決 6-a は解決。** 暗号は **`node:crypto`** に任せる（決定 7）。**WebCrypto の Ed25519 `verify` は Node v24.17.0 でも workerd でも使えない**ことを実測した（研究ログ 8・9）ため `crypto.subtle` は使わない。`@noble/ed25519` / `jose` / `http-message-signatures` はいずれも不要。
5. **Cloudflare Workers は技術的には成立したが、採用しない**（研究ログ 9・決定 10）。成果物は **Docker image 1 つ**とし、official proxy も custom proxy も同じものを動かす。理由は費用ではなく、Workers では Discord の mention と Mattermost が使えず、2 つ目のビルドを保守し続けることになるため。

---

## Research Log

### 1. Chat SDK の実物確認

- **Context**: ブリーフは npm registry のメタデータと同梱 docs から書かれていたが、その `node_modules` はこの worktree に無い。設計の土台なので実物で確認する必要があった。
- **Sources Consulted**: npm registry API、`npm pack` で取得した tarball（`chat@4.38.1`、`@chat-adapter/{slack,discord,teams,state-pg}@4.38.1`、`chat-adapter-mattermost@1.1.3`）の同梱 `docs/` と `dist/*.d.ts`
- **Findings**:
  - `chat` 4.38.1 / MIT / `node >= 20`。ブリーフの記述どおり。
  - **peer 依存 `ai` / `workflow` / `zod` は 3 つとも `optional: true`。** Vercel AI SDK や workflow ランタイムを引き込まずに使える。
  - `chat-adapter-mattermost` 1.1.3 の peer は `chat: "^4.29.0"` で、4.38.1 と両立する。
  - 公式アダプタは拡張面を `protected` で公開しており、fork せずに subclass で差し替えられる。ただし docs 自身が「まだ完全に安定とは見なしていない。マイナーリリースでシグネチャが変わりうる」と明記している。
- **Implications**: 依存として受け入れられる。ただしバージョンは完全固定し、Chat SDK に触れる範囲を 1 つの層に閉じ込める（設計決定 1・2）。

### 2. メッセージ表現 — 自前で定義する必要があるか

- **Context**: ブリーフ §3.3 は「Gen 2 で最も重要な設計判断は、チャットサービスに依存しないメッセージ形式をどう定義するか」「工数はここに最も集中する」としていた。
- **Sources Consulted**: `chat@4.38.1/docs/cards.mdx`、`docs/posting-messages.mdx`
- **Findings**:
  - `thread.post()` は 4 つの形式を受け付ける — プレーン文字列 / `{ markdown: string }` / `{ ast: <mdast> }` / Card。
  - Card は `Card` / `CardText` / `Section` / `Fields` / `Button` / `Actions` / `CardLink` / `LinkButton` という部品で書き、**SDK が Block Kit・Adaptive Cards・Discord embeds・Google Chat Cards へ変換する**。
  - `{ markdown }` は SDK 内部で mdast へ解析され、各アダプタがネイティブ形式へ落とす。
  - Card は JSX（`jsxImportSource: "chat"`）でも関数呼び出しでも書ける。
- **Implications**: **中立表現は既にある。** GROWI 本体が新しいメッセージ形式を定義する理由が消えた。設計決定 3 へ。

### 3. プラットフォームごとの能力差

- **Context**: 要件 1.2 / 5.6 / 6.5 が「このサービスではこの機能を使えない」を書き分けることを求めている。具体的な差を知らずには書けない。
- **Sources Consulted**: `docs/modals.mdx`、`docs/slash-commands.mdx`、`docs/platform-adapters.mdx`、`chat-adapter-mattermost@1.1.3/README.md` の Feature Support 表、`@chat-adapter/discord` README
- **Findings**:

  | 機能 | Slack | Discord | Teams | Mattermost |
  |---|:--:|:--:|:--:|:--:|
  | slash command | ○ | ○ | **×** | **×** |
  | mention の受信 | ○ | ○ | ○ | ○ |
  | modal（フォーム） | ○ | **×** | ○ | **×** |
  | ボタン等の操作 | ○ | ○ | ○ | **×**（ライフサイクル未完） |
  | Card | ○ | ○ | ○ | △（プレーンテキスト代替） |
  | メッセージ投稿・編集・削除 | ○ | ○ | ○ | ○ |
  | その場限りのメッセージ | ○ | ○ | ○ | ○ |
  | 履歴の取得（`fetchMessages`） | ○ | ○ | ○ | ○ |
  | 外部からの接続が要るか | 不要 | 不要 | **必要** | 不要 |

  - slash command は SDK が Slack / Discord / Telegram のみと明記。
  - modal は「Currently supported on Slack and Teams」と明記。
  - `fetchMessages(threadId, options)` は `Adapter` インタフェースの**必須メソッド**（`dist/types-*.d.ts`）。任意メソッドの `fetchChannelMessages` があればそちらが使われる。
- **Implications**: 4 サービス共通の入口は **mention だけ**。設計決定 4（コマンド起動を mention に寄せる）と設計決定 5（引数収集の切り替え）へ。

### 4. 未決 7-a — Discord に外部からの穴は要るか

- **Context**: ブリーフの決定 7 が「Discord アダプタが公開エンドポイント無しでスラッシュコマンドとボタンを受けられるか」を未確認として残していた。閉域構成で開ける通信が変わる。
- **Sources Consulted**: `@chat-adapter/discord@4.38.1/README.md` の "Architecture: HTTP Interactions vs Gateway"
- **Findings**（原文）:
  > Receives slash commands and button clicks **when no Interactions Endpoint URL is configured** … For resident gateway-only apps, leave the Interactions Endpoint URL unset and start the Gateway listener without `webhookUrl` so interactions are processed directly.
  - Vercel の docs が案内する cron による接続維持は **serverless 向けの回避策**であり、常駐プロセスには当てはまらない。
- **Implications**: **Discord に穴は不要。** chat-integration proxy は常駐プロセスなので Gateway 一本で運用する。Slack も `@slack/socket-mode` 依存があり Socket Mode で穴が要らない。Mattermost は proxy から接続しに行く。**閉域構成で外部から通す必要があるのは Teams だけ**（要件 13.2 / 13.3）。

### 5. 未決 6-a — 署名を何で実装するか

- **Context**: ブリーフが `http-message-signatures`（総リリース 10 本）を「セキュリティ検証パスの依存として知った上で受け入れるか、正準化だけ自前で書くか」を明示的に決める必要がある、としていた。
- **Sources Consulted**: npm registry（実測 2026-08-26）、`node:crypto` の実行確認
- **Findings**:

  | パッケージ | 最新 | ライセンス | 総リリース | 型定義 | 依存 |
  |---|---|---|---|---|---|
  | `http-message-signatures` | 1.0.6 | ISC | 10 | あり | `structured-headers` |
  | `structured-headers` | 2.0.3 | MIT | 14 | **なし** | なし |
  | `jose` | 6.2.10 | MIT | 243 | あり | なし |

  - **`node:crypto` だけで Ed25519 の鍵生成・署名・検証・JWK 書き出しがすべてできる**ことを実行して確認した:
    ```
    generateKeyPairSync('ed25519') → sign(null, data, priv) / verify(null, data, pub, sig) === true
    publicKey.export({ format: 'jwk' }) → { crv: 'Ed25519', x: '...', kty: 'OKP' }
    ```
- **Implications**: 設計決定 7 へ。暗号は `node:crypto`、RFC 8941 の正準化は `structured-headers`、RFC 9421 の署名対象文字列の組み立てのみ自前。`jose` と `http-message-signatures` は採らない。

### 6. GROWI 本体側の実装（Gen 1）

- **Context**: 要件が Gen 1 の機能の作り直しなので、利用者から見える振る舞いの実体を押さえる必要がある。
- **Sources Consulted**: `apps/app/src/server/service/slack-command-handler/*`、`apps/app/src/server/service/global-notification/*`、`apps/app/src/server/models/user/index.js`、`apps/slackbot-proxy/src/**`
- **Findings**:
  - **通知に対話的な要素は無い。** `global-notification-slack.ts` は本文テキストと attachment テキストだけを組み立て、`generateAttachmentBody` は `// TODO: create attachment` のまま空文字を返す。
  - `keep` は「メッセージを選ぶ」のではなく **時間の範囲（`yyyy/MM/dd-HH:mm` の 2 つ）を入力して `conversations.history` をまとめて取得する**機能。private channel では `conversations.join` を試み、失敗したら取得できない旨を返す。
  - **チャット利用者と GROWI ユーザーの対応づけは既に明示的な紐付け**。`User.slackMemberId`（`unique: true, sparse: true`）を個人設定（`Me/BasicInfoSettings.tsx`）で利用者が手入力する。本人確認が無く、他人の ID を先に貼ると本人の紐付けを塞げる。
  - `/growi search` の権限適用は**参照にならない**。`searchKeyword(keywords, null, {}, options)` の 4 引数呼び出しに対し定義は `(keyword, nqName, user, userGroups, searchOpts)` の 5 引数で、引数がずれている。
- **Implications**: 通知は markdown 文字列で足りる（設計決定 3 を支える）。紐付けは新概念ではなく既存の粗さを直す作業（要件 7）。検索の権限適用は要件 3.6 / 3.7 で新たに定めた。

### 7. リポジトリ側の前提

- **Sources Consulted**: `apps/*/package.json`、`.kiro/steering/tech.md`、`apps/app/prisma/`
- **Findings**:
  - **Ts.ED は 8.5.0 が現行**。`apps/pdf-converter` と `apps/growi-vault-manager` が `=8.5.0` で採用している。6.43.0 に取り残されているのは Gen 1 だけ。
  - **Prisma 6.19.2 が既にリポジトリにある**（`apps/app/prisma/`）。
  - `apps/app` のサーバは **Node v24 の型剥がし（strip-only）** で動き、`tsconfig.json` が `erasableSyntaxOnly: true` を設定している（`enum` / パラメータプロパティ / namespace はリポジトリ全体で禁止）。
- **Implications**: Ts.ED 8.5.0 が現行版であり、Gen 1 の 6.43 固定は Ts.ED 自体の問題ではない。**ただし決定 8 は Hono を選び、兄弟アプリには揃えない** — Chat SDK の webhook ハンドラが Web 標準の `Request` / `Response` を取るため、Express だと橋渡しのコードが要るのが理由。**JSX は「剥がすだけ」では実行できないので、apps/app のサーバコードで Chat SDK の Card を書くには実行方式そのものを変える必要がある** — 設計決定 3 の技術的な裏付けになる。

### 8. Node の WebCrypto は Ed25519 の検証が壊れている（2026-08-26 実測）

- **Context**: 署名を「Node と Cloudflare Workers の両方で動く 1 本のコード」で書けるかを確かめた。
- **Findings**: Node v24.17.0 で、`crypto.subtle.sign` は正しい 64 バイトの署名を返す（`node:crypto` の `verify` に通すと true）が、
  **`crypto.subtle.verify` は正しい署名に対して `false` を返す**。ArrayBuffer / Uint8Array / Buffer のどの形で渡しても、
  公開鍵を raw で入れ直しても false。`generateKey` / `sign` / `exportKey` / `digest` は正常で、**壊れているのは `verify` だけ**。
- **Implications**: **`crypto.subtle` を署名の検証に使わない**根拠。決定 7 が使うのは `node:crypto` の `sign` / `verify` であり `crypto.subtle` ではない。
  一時は実行環境の両立のために `@noble/ed25519` を選んだが、決定 10 で Cloudflare Workers を採らないことになり `node:crypto` へ戻した（研究ログ 10）。

### 9. Cloudflare Workers 技術検証（2026-08-27 実施）

- **Context**: 「official proxy は Cloudflare Workers、custom proxy は Docker image」という運用像が出た。採用可否を決める前に、技術的に成立するかを確かめた。
- **方法**: scratchpad に検証用プロジェクトを作り、実パッケージを入れて `wrangler 4.127.0` でビルド（`--dry-run`）と実行（`wrangler dev` = workerd）を行った。`compatibility_flags = ["nodejs_compat"]`、`compatibility_date = 2026-08-01`。

#### ビルド結果 — 全部通った

| 対象 | gzip |
|---|---|
| `chat` core | 110 KiB |
| `@chat-adapter/slack` | 216 KiB |
| `@chat-adapter/discord` | 809 KiB |
| `@chat-adapter/teams` | 737 KiB |
| `chat-adapter-mattermost` | 110 KiB |
| `@chat-adapter/state-pg` | 136 KiB |
| Hono + `@noble/ed25519` | 21 KiB |
| **4 アダプタ + core + Hono + noble の全部入り** | **1612 KiB** |

Workers の上限（無料 3 MiB / 有料 10 MiB）に収まる。**事前の予想は外れた** — `@chat-adapter/discord` は `discord.js` を静的に import しているのでここで落ちると見ていたが、ビルドは通った（`discord.js` への legacy module import という非推奨警告のみ）。

#### 実行結果（workerd 上）

| 項目 | 結果 |
|---|---|
| `chat` core の読み込み | ○ |
| 4 アダプタすべての構築 | ○ |
| `bot.webhooks` に 4 種のハンドラが関数として存在 | ○ |
| **Discord + Teams**: `initialize()` → webhook 実行 | ○ **未署名リクエストを 401 で拒否**（＝署名検証が workerd 上で実際に走っている） |
| **Slack**: `initialize()` | **✗ → パッチ後 ○**（下記） |
| `@noble/ed25519` の署名・検証 | ○（64 バイト、`verify` が true） |
| WebCrypto の Ed25519 `verify` | **✗ workerd でも失敗**（`OperationError: Invalid Ed25519 signature length 5`。`sign` は正しく 64 バイトを返す） |
| `crypto.subtle.digest('SHA-512')` | ○ |
| `@chat-adapter/state-pg` の TCP 到達 | 到達する（PG でないポートへ繋いで `Connection terminated unexpectedly`）。**実 PostgreSQL への接続は未検証** |

#### 唯一の障壁は Slack。ただしパッチは不要だった（2026-08-27 追試）

最初の検証では Slack だけが動かず、原因は依存の 3 段先にあった。

```
@chat-adapter/slack → @slack/web-api 7.19.0 → axios → lib/adapters/fetch.js:21
                                                        cache: 'default'
```

workerd はこの cache mode を受け付けず `Unsupported cache mode: default` を投げる。`@slack/web-api` はこれをネットワーク障害と見なして
再試行を繰り返すため、**エラーで落ちるのではなく応答が返らなくなる**（150 秒待って打ち切った）。

**追試の結果、axios へのパッチは不要と分かった。** 順に 3 つの壁があり、すべて**公式に用意された差し替え口だけ**で越えられる。

| 壁 | 版 | 症状 | 越え方 |
|---|---|---|---|
| 1 | `@slack/web-api` 7.19.0 | axios の `cache: 'default'` を workerd が拒否 | **8.1.0 へ上げる**（axios 依存が消えている） |
| 2 | 8.1.0 | `Illegal invocation`（`fetch` を `this` から切り離して呼んでいる） | `fetch` を束ねて渡す |
| 3 | 8.1.0 | `Invalid redirect value` | 同じラッパで `redirect: 'follow'` に正規化する |

差し替え口は 2 段とも公開されている — `@slack/web-api` 8.x の **`fetch?: FetchFunction`**、`@chat-adapter/slack` の
**`webClientOptions?: Omit<WebClientOptions, "slackApiUrl">`**。したがって設定はこれだけで済む:

```typescript
createSlackAdapter({
  botToken, signingSecret,
  webClientOptions: {
    fetch: (input, init = {}) => {
      const { cache, redirect, ...rest } = init;   // workerd が受け付けない指定を落とす
      return globalThis.fetch(input, { ...rest, redirect: 'follow' });
    },
  },
});
```

**この構成で Slack が完全に動いた** — `initialize()` 成功、未署名 webhook を 401 で拒否、`auth.test()` が Slack から
`invalid_auth`（偽トークンに対する正しい応答）を返した。**リクエストが Slack のサーバまで往復している。**

**ただし `@chat-adapter/slack@4.38.1` は `@slack/web-api: "^7.18.0"` を要求している**ので、8.1.0 を使うには
`pnpm.overrides` が要る。Chat SDK 側が 8.x に追随すれば不要になる（`@slack/web-api` 8.0.0 は 2026-07-14、8.1.0 は 2026-08-27 公開）。

#### この検証が確定させたこと

- **`crypto.subtle` を署名の検証に使えないことが確定した。** WebCrypto の Ed25519 `verify` は **Node v24.17.0 と workerd の両方で使えない**（症状は違う — Node は正しい署名に `false` を返し、workerd は `OperationError` を投げる）。当時はこれを根拠に `@noble/ed25519` を採ったが、決定 10 で Workers を採らないことになり `node:crypto` に戻した（研究ログ 10・決定 7）。
- **決定 9（`runtime/` の線引き）に実利がある。** Workers 上で動く見込みが立った以上、頭脳が Node 固有に触れない状態を保つ価値は仮定ではなくなった。
- **bundle サイズは論点にならない。**

#### 検証の結末

**技術的には成立する見込みが立ったが、採用しないことにした（決定 10）。** 失うもの（Discord の mention、Mattermost、2 つ目のビルドの保守、`@slack/web-api` の override）が、得るもの（コールドスタート無し・アイドルゼロ）を上回ると判断した。以下の未確認項目は、その判断により**追う必要が無くなった**。

#### 残った未確認（追わない）

- **実 PostgreSQL への接続**（Hyperdrive 経由 / 直接）。ローカルの workerd では TCP に到達することまで確認したが、本番 Workers の外向き TCP は制約が異なる
- **Mattermost の起動時接続**。`initialize()` が `/users/me` を叩くため、実サーバが無いと確かめられない。ただし official proxy に Mattermost は来ない想定なので、Workers 側では論点にならない
- **Teams の実際の送信**。`initialize()` と webhook の署名検証は通ったが、外向きの API 呼び出しは検証できていない。
  **Teams アダプタは `@microsoft/teams.*` 経由で axios をまだ引いている**ので、送信時に壁 1 と同じ問題に当たる可能性がある。
  `@slack/web-api` のような fetch の差し替え口が `@microsoft/teams.*` にあるかは未確認
- **`@slack/web-api` を 8.1.0 に上げることの副作用**。semver のメジャー更新なので、`@chat-adapter/slack` が
  7.x 前提で使っている API が変わっていないかを確かめる必要がある（今回の検証で触れたのは `auth.test` と webhook 経路だけ）
- **本番 Workers での実行**（ローカルの workerd で確認したところまで）

### 10. Ed25519 の署名・検証の速度（2026-08-27 実測）

- **Context**: 決定 10 で Workers を採らないことになり、`@noble/ed25519` を採る理由（実行環境の両立）が消えた。`node:crypto` に戻すかを判断するため実測した。
- **方法**: Node v24.17.0、256 バイトのメッセージ、各 2000 回。
- **Findings**:

  | | 1 回あたり | 毎秒 |
  |---|---|---|
  | `node:crypto` verify | **0.075 ms** | 13,368 回 |
  | `@noble/ed25519` verify | 1.115 ms | 897 回 |
  | `node:crypto` sign | **0.025 ms** | 40,505 回 |
  | `@noble/ed25519` sign | 0.306 ms | 3,266 回 |

- **Implications**: **検証で 15 倍、署名で 12 倍の差**。署名検証は proxy と GROWI の全リクエストが通る経路なので、この差はそのまま 1 コアあたりの処理能力の上限になる。
  `@noble/ed25519` は純粋な JavaScript 実装、`node:crypto` は OpenSSL を呼ぶ。実行環境の両立が要らなくなった以上、標準ライブラリを使わない理由が無い。決定 7 を `node:crypto` に戻した。

---

## Architecture Pattern Evaluation

| 案 | 内容 | 強み | 弱み・リスク | 判断 |
|---|---|---|---|---|
| A. GROWI 本体が Card を組み立てる | apps/app が `chat` を依存に持ち、Card を作って proxy へ渡す | 表現力が最大。proxy は素通しでよい | apps/app が Chat SDK のリリース頻度（約 8 か月で 54 本）を直接受ける。**JSX は Node の型剥がしで実行できず、apps/app の実行方式を変えることになる** | **不採用** |
| B. GROWI は markdown と構造化データだけを送る | proxy が Chat SDK に触れる唯一の場所。整形は proxy が持つ | Chat SDK の影響が 1 アプリに閉じる。apps/app の依存も実行方式も変わらない。決定 3「検索結果の整形は proxy が行う」と整合 | GROWI 側から凝った見た目を作れない。ただし Gen 1 の通知に対話的要素は無く、必要が無い | **採用** |
| C. 中立表現を自前で定義する（ブリーフの当初案） | `@growi/chat` が独自のメッセージ形式を持ち、proxy が各サービスへ変換 | 特定 SDK に縛られない | **Chat SDK が既に持っているものを作り直すことになる。** 4 サービス分の変換を自前で保守する | **不採用** |

---

## Design Decisions

### 決定 1: Chat SDK 4.38.1 を採用し、バージョンを完全固定する

- **Context**: 各チャットサービスとのやり取り（OAuth、webhook の検証、ネイティブ形式への変換、分散ロック）を自前で書くか、既製に任せるか。
- **Alternatives Considered**: 自前実装 / Matterbridge（Go の別プロセス）/ Botkit（停止）/ Bot Framework SDK（アーカイブ済み）
- **Selected Approach**: `chat@4.38.1` + `@chat-adapter/{slack,discord,teams}@4.38.1` + `chat-adapter-mattermost@1.1.3`。すべて `=` で完全固定する（リポジトリが `@tsed/*` で既に採っている方式）。
- **Rationale**: 4 サービスのうち 3 つが公式アダプタ。peer 依存はすべて任意で、AI SDK や workflow ランタイムを引き込まない。
- **Trade-offs**: リリース頻度が高く、`protected` の拡張面は「まだ安定と見なしていない」と明記されている。→ 決定 2 で緩和する。
- **Follow-up**: アダプタの能力表（研究ログ 3）は SDK の更新で変わりうる。更新時に必ず突き合わせる（Revalidation Trigger）。

### 決定 2: Chat SDK に触れてよいのは proxy の platform 層だけとする

- **Context**: 決定 1 のリリース頻度リスクを、どこかに閉じ込める必要がある。
- **Selected Approach**: `chat` と `@chat-adapter/*` を `import` してよいのは `apps/chat-integration-proxy/src/platform/**` だけとし、他の層は platform 層が公開する型と関数だけを使う。lint で機械的に守る。
- **Rationale**: SDK の破壊的変更の影響範囲が 1 ディレクトリに収まり、アップグレードの検証範囲が読める。
- **Trade-offs**: 薄い変換層を 1 枚挟むぶん、記述が増える。

### 決定 3: GROWI 本体は Chat SDK に依存しない

- **Context**: ブリーフは `@growi/chat` を「Block Kit 表面を置き換える中立メッセージ形式」として構想し、そこに工数が最も集中すると見ていた。
- **Alternatives Considered**: 上の Architecture Pattern Evaluation の A / B / C
- **Selected Approach**: GROWI 本体が proxy へ渡すのは 2 種類だけ — **通知や案内は markdown 文字列**、**検索結果などは構造化データ**。Card・modal・ボタンの組み立ては proxy が全部持つ。
- **Rationale**:
  1. ブリーフ §3.1 のレイヤ分割そのもの。
  2. 決定 1 のリスク緩和（決定 2）が GROWI 本体にも効く。
  3. 決定 3（ブリーフ）が既に「検索結果の整形は proxy が行う」と決めている。
  4. Gen 1 の通知に対話的な要素は無い（研究ログ 6）ので、markdown で表現力は足りる。
  5. **技術的な裏付け**: apps/app のサーバは Node の型剥がしで動いており、JSX は剥がすだけでは実行できない（研究ログ 7）。
- **Trade-offs**: GROWI 側から凝った見た目を指定できない。将来必要になったら、markdown の代わりに mdast AST を送る余地は残る（`thread.post({ ast })` が受け付ける）。
- **結果として**: `@growi/chat` は**メッセージ形式ライブラリではなく、GROWI ⇄ proxy の契約型と署名を置く小さな共有パッケージ**になる。ブリーフの「工数はここに最も集中する」という見立ては覆る。

### 決定 4: コマンドの起動は mention を主経路とし、slash command は対応サービスでの追加入口に留める

- **Context**: Teams と Mattermost は slash command を受けられない（研究ログ 3）。要件 3 / 4 / 5 / 14 のコマンドをどう起動するか。
- **Alternatives Considered**:
  1. slash command を主とし、Teams / Mattermost は通知専用にする → 要件 1.1 を満たせない
  2. Mattermost アダプタを fork して slash command を実装する → 保守を丸ごと引き受けることになる（未決 M が確定的な作業に変わる）
  3. mention を主経路にする
- **Selected Approach**: 3。`@growi search foo` の形を 4 サービス共通の入口とし、Slack と Discord では `/growi search foo` も同じ処理へ流す。両者を 1 つの内部表現へ正規化する。
- **Rationale**: 4 サービスすべてが mention の受信に対応している唯一の入口。コマンド解釈の経路が 1 本になり、分岐が減る。**Mattermost アダプタに必要な機能が「投稿・mention・その場限りのメッセージ」だけになり、いずれも対応済み（○）なので fork が不要になる。**
- **Trade-offs**: slash command のような入力補完が既定では効かない。対応サービスでは slash command も登録するので、そこでは従来どおり。

### 決定 5: 引数の収集はプラットフォームの能力に応じて切り替える

- **Context**: modal は Slack と Teams でしか出せない（研究ログ 3）。要件 4.1（パスと本文の入力）、5.1（取り込む範囲の指定）、8.2（GROWI の選択）が該当する。
- **Selected Approach**: 「必要な情報を集める」を 1 つの仕組みに抽象化し、能力表を見て手段を選ぶ。modal が使えるなら modal、使えないならコマンド行の引数を読み、足りない分をその場限りのメッセージで聞き返す。
- **Rationale**: 3 つの要件が「利用者から必要な値を集める」という同じ問題の変種。1 か所にまとめれば、対応サービスが増えたときも能力表への 1 行追加で済む。
- **Trade-offs**: modal が使えないサービスでは往復が増える。
- **Follow-up**: 能力表は**データとして 1 か所に宣言し、各所で `if (platform === 'mattermost')` と書かない**（`.claude/rules/coding-style.md` の「モード名で分岐しない」）。

### 決定 6: PostgreSQL を Prisma で扱い、Chat SDK の state は公式の `state-pg` に任せる

- **Context**: ブリーフの決定 1 で PostgreSQL は確定済み。ORM とスキーマ管理をどうするか。
- **Selected Approach**: proxy 自身のテーブル（関係管理・鍵・nonce）は **Prisma 6.19.2**（リポジトリに既にある）。Chat SDK が要求する state（購読・分散ロック・重複排除）は `@chat-adapter/state-pg` が自分のテーブルを持つ。同じ PostgreSQL インスタンスを共有し、スキーマを分ける。
- **Rationale**: モノレポに 2 つ目の ORM を持ち込まない。state は公式実装に任せて自前保守を負わない。
- **Trade-offs**: Prisma と `pg`（state-pg 経由）の 2 つの接続経路がぶら下がる。接続数の上限設定で見る必要がある。
- **Redis は採らない**: ブリーフの決定 7 で「接続の所在管理が不要」が確定したため、`state-pg` 一本で足りる見込み。

### 決定 7: 署名は `node:crypto` + `structured-headers`。RFC 9421 の署名対象文字列の組み立てのみ自前で書く

- **Context**: 未決 6-a。
- **Alternatives Considered**:
  1. `http-message-signatures`（1.0.6 / ISC / 総リリース 10）をそのまま使う
  2. `structured-headers` + `node:crypto` で、署名対象文字列の組み立てだけ自前
  3. `structured-headers` + `@noble/ed25519` で、署名対象文字列の組み立てだけ自前
  4. RFC 8941 の解析まで含めて全部自前
- **Selected Approach**: 2（一度 3 へ変えたが、決定 10 で Workers を採らないことが決まったため 2 に戻した）
- **Rationale**:
  - **暗号は 1 行も自前で書かない。** `node:crypto` が Ed25519 の署名・検証・JWK 書き出しを標準で持つことを実測で確認した（研究ログ 5）。
  - **`@noble/ed25519` を一度採ったが戻した。** 採った理由は Cloudflare Workers との両立だけであり、決定 10 でその前提が消えた。
    加えて**毎リクエストの検証速度が 15 倍違う**（実測、研究ログ 10）。署名検証は全リクエストが通る経路なので、この差はそのまま処理能力の上限になる。
  - **ただし `crypto.subtle`（WebCrypto）は使わない。** Node v24.17.0 の WebCrypto は Ed25519 の検証が壊れている（研究ログ 8）。
    使うのは `node:crypto` の `sign` / `verify` / `createPublicKey`。ハッシュだけは `crypto.subtle.digest('SHA-512')` でも `node:crypto` でもよい。
  - 自前で書くのは RFC 9421 の署名対象文字列（`@method` / `content-type` / `content-digest` / `@signature-params` を規定の順で連結する）だけで、**決まった手順の文字列組み立て**にすぎず、RFC 9421 が公開しているテストベクタで検証できる。
  - **セキュリティの検証経路に総リリース 10 本の依存を置かない**というブリーフの懸念にそのまま答える。
  - `jose` は不要（243 リリースで成熟しているが、JWS / JWE / JWT を使わないため）。
  - `Content-Digest` の SHA-512 は `node:crypto` の `createHash` を使う。
- **Trade-offs**: `structured-headers` に型定義が無いので、薄い型付きラッパを 1 つ書く。
- **Follow-up**: 署名の生成と検証は `@growi/chat` に置き、GROWI 側と proxy 側が**同じコードを使う**。片方だけ直して食い違うことが起きない。

### 決定 8: proxy は Hono で作り、DI コンテナは使わない

- **Context**: スクラッチなので自由に選べる。ブリーフは Gen 1 の Ts.ED 6.43 固定を技術的負債として挙げていた。
- **Alternatives Considered**: Ts.ED 8.5.0 + Express（兄弟アプリに揃う）/ Hono / Fastify
- **Selected Approach**: **Hono `^4.13.5`**（MIT・依存ゼロ）。**DI コンテナは入れず**、`composition-root.ts` で明示的に組み立てる。
- **Rationale**:
  1. **Chat SDK の webhook ハンドラは Web 標準の `(request: Request) => Promise<Response>`。** Hono はこれをそのまま扱えるので、
     Express で必要だった橋渡しのコード（`web-request-bridge.ts`）が丸ごと要らなくなる。
  2. **依存ゼロで軽い。** Hono 自体が Node 上で問題なく動き、Express + Ts.ED より持ち込む依存が少ない。
  3. **DI コンテナを入れない理由**: デコレータによる DI は `emitDecoratorMetadata` を要求し、リポジトリが `erasableSyntaxOnly: true` で
     進めている方向と逆になる。加えて `.claude/rules/coding-style.md` の「Executors Take Their Work-Set as Input」は実質的に手動の組み立てを勧めている。
     この規模なら `composition-root.ts` 1 枚で足り、テストからも同じ形で組める。
- **Trade-offs**: `apps/pdf-converter` / `apps/growi-vault-manager` とは違う HTTP 層になる。
  **揃えることより、Chat SDK との噛み合わせ（橋渡しコードが要らない）を優先する。** 決定 10 で Workers を採らないことになった後も、この理由は変わらない。

### 決定 9: 設定は `runtime/` が組み立て、頭脳へ引数で渡す

- **Context**: もともとは Cloudflare Workers との両立のために「`runtime/` 以外は `node:*` を import しない」という広い制約として置いた。
  決定 10 でその前提が消えたため、**残す価値のある部分だけに絞る**。
- **Selected Approach**: `node:*` の全面禁止はやめる（Docker 一本なら意味が無い）。残すのは 1 点だけ —
  **`process.env` を読んでよいのは `src/runtime/config.ts` だけ**とし、他の層は組み立て済みの設定オブジェクトを引数で受け取る。lint で強制する。
- **Rationale**:
  - **移植性と無関係に元が取れる。** `process.env` を直接読まないコードは、テストで環境変数を書き換えずに済む。
    設定オブジェクトを渡すだけでテストが書ける。
  - `.claude/rules/coding-style.md` の「Executors Take Their Work-Set as Input」と同じ形。
  - 前例がある。`routes/` 配下でトップレベルの初期化呼び出しを禁じる `route-top-level-guard` が既に `pnpm run lint` で回っている。
- **Trade-offs**: ほぼ無い。`runtime/` ディレクトリは残るが、担うのは設定の組み立て・プロセス起動・アダプタ集合の組み立てで、
  「Node 固有を隔離する殻」という位置づけではなくなる。

### 決定 10: official proxy も custom proxy も同じ Docker image を動かす

- **Context**: 「official proxy は Cloudflare Workers、custom proxy は Docker image」という案を技術検証した（研究ログ 9）。
  技術的には成立する見込みが立ったが、**採用しない**と決めた。
- **Selected Approach**: **成果物は Docker image 1 つ。** official proxy も custom proxy も同じものを動かし、置き場所だけが違う。
- **Rationale**: Workers が買うのは「コールドスタート無し」と「アイドル完全ゼロ」。**失うものの方が大きい。**
  - Workers 向けの **2 つ目のビルドを保守し続けることになる**
  - **Discord で mention を受け取れない**（HTTP Interactions のみになるため）。決定 4 が official proxy でだけ成立しなくなる
  - **Mattermost を official proxy で使えない**（常時接続が要る）
  - `@slack/web-api` の `pnpm.overrides` と fetch ラッパが要る（研究ログ 9）
  - Teams の実送信、本番 Workers での PostgreSQL 接続がいずれも未検証のまま
- **この決定が閉じるもの**:
  - **決定 4（mention を主経路）が無条件に成立する。** 常駐プロセスなら Discord も Gateway で mention を受けられる
  - **プラットフォーム能力表に「デプロイ先」の軸を足さずに済む**
  - `@slack/web-api` は Chat SDK が要求する 7.x のままでよい。override も fetch ラッパも要らない
  - PostgreSQL は Hyperdrive を検討せず、素直に接続すればよい
  - 決定 7 が `node:crypto` に戻せる（15 倍速い）
- **Trade-offs**: official proxy はアイドル時もインスタンスを保つか、コールドスタートを受け入れるかの選択になる。
  ただし Slack の Socket Mode と Discord の Gateway、Mattermost の WebSocket を張る以上、**そもそも常駐が要る**ので、
  アイドルをゼロにする選択肢は元から無かった。

---

### 決定 11: 署名の材料は「両側がデータとして同じ値を持つもの」だけにし、口の区別は本体の `op` で行う

- **Context**: 敵対的レビューで、署名対象に入れていた `@target-uri` がリバースプロキシの内側で一致しないと指摘された。
  同じ欠陥に**この設計は 3 回当たっている**。
- **Alternatives Considered**:
  1. `@target-uri` を保つ。両側が保存した相手の URL から組み立てる
  2. `@target-uri` を `@path` に替える
  3. 宛先もパスも署名対象から外し、**どの口を叩いたかを本体の `op` に載せる**（読み取りの口も POST にする）
- **Selected Approach**: 3
- **Rationale**:
  - **判定の基準は「送る側と受ける側が、データとして同じ値を持っているか」である。**
    HTTP の層から取り出す値は途中の機器が書き換えるので、この条件を満たさない。
  - 1 は成立しない。送る側は自分が保存した相手の URL、受ける側は自分の設定値や `Host` ヘッダで、**出どころが違う**。
    これは `pairingChallengePayload` から `proxyUri` を外したのと**同じ理由**である（決定の再演）。
  - 2 も成立しない。nginx の `proxy_pass http://app:3000/;`（末尾スラッシュ）は location の前置きを削るので、
    **前置きを付けて公開している構成で全リクエストが落ちる**。しかも読み取りの 3 つの口では `@path` が唯一の縛りだった。
  - 3 なら `op` は両側がデータとして持つ値で、途中の機器の設定に左右されない。本体は `content-digest` で覆われるので書き換えられない。
  - 守りの分担: **別の口への流用 → `op` の突き合わせ / 別の相手への流用 → 鍵が関係ごと / 同じ口への再送 → `nonce`**。
  - 副産物として、**覆う一覧が本体の有無で 2 つに分かれる問題が消える**。GET には `Content-Type` が無く、
    RFC 9421 は署名対象に挙げた項目がリクエストに無いと組み立てそのものを失敗させるため、
    読み取りの口をそのままにすると署名できなかった。
- **Trade-offs**: 能力の一覧・接続の状態・チャンネルの一覧という**読み取りだけの 3 つの口が POST になる**。
  機械同士の署名付きのやり取りなので、この不格好さは受け入れる。
- **Follow-up**: 口の一覧（`op` ↔ パス ↔ 向き）は `chat-integration-protocol` が持ち、proxy と app は自分の側だけを合わせる。

### 決定 12: 所有確認（⑤）は回数の上限だけで守り、答えた内容を覚えない

- **Context**: ⑤ は鍵がまだ無い時点の口なので署名で守れない。当初は「同じ問いには同じ答え、違う問いには 410」としていた。
- **Alternatives Considered**:
  1. 1 つの保留につき 1 回だけ答える
  2. 答えた `challenge` と署名を記録し、同じ問いには同じ答え、違う問いには 410
  3. 記録できる問いの数に上限（5 件など）を置く
  4. **保留が生きている間はどの問いにも答え、回数の上限（速度制限）だけを置く**
- **Selected Approach**: 4
- **Rationale**:
  - 1 は**正常系を塞ぐ**。proxy の ④ には応答の待ち時間の上限があるので、GROWI が重いと
    「GROWI は答えて印を付け、proxy は受け取れない」が起き、やり直しても通らない。
  - 2 と 3 は**外から潰される**。⑤ は誰でも叩ける口なので、登録コードを盗み見た第三者が
    本物の proxy より先に自分の `challenge` で叩くと、本物の ④ が断られる。
    **3 は攻撃の手数がその数になるだけ**で、性質は 2 と同じである。
  - 4 が安全なのは、**用途を示す接頭辞**（`growi-chat-pairing-challenge:v1:`）を付けた文字列が
    RFC 9421 の署名対象としては絶対に現れないからである。署名を何本集めても本番のリクエストには使えず、
    Ed25519 は署名を集めても秘密鍵が出る方式ではない。
  - あわせて、**`OwnershipChallenge` には送り主を示す値が入っていない**ため、
    「送信先の proxy や申告した `keyId` と突き合わせる」形の確認は書いても実装できないと分かった。
    守りとして数えると、**実際より安全に見える**。
- **Trade-offs**: 保留 1 件あたり 1 分 30 回という上限を持つ必要がある。
- **Follow-up**: `chat_pending_pairings` は `answeredChallenge` / `answeredSignature` を持たず、`answerCount` と窓の開始時刻を持つ。

### 決定 13: `allowList` は 3 つの条件をまとめて外し、証明書の根拠も指定できるようにする

- **Context**: 申告された URL の判定を「https のみ・既定ポートのみ・私的アドレス帯でない」としていた。
- **Alternatives Considered**:
  1. `allowList` は私的アドレス帯の条件だけを外す
  2. **`allowList` は 3 つとも外し、証明書の根拠も指定できるようにする**
- **Selected Approach**: 2
- **Rationale**:
  - 1 だと、閉域の GROWI がふつうに使う `http://growi.internal:3000` が scheme とポートで断られ、
    **要件 13 の構成でペアリングが 1 度も成立しない**。
  - そのとき運用者に見えるのは `ownership-unverified` だけなので、原因に辿り着けないまま
    **証明書の検証を切るなどの、この検証を丸ごと無効にする回避**へ向かう。
    厳しすぎる条件は、守るどころか**守りを外す方向へ人を押す**。
  - 照合するのは **URI に書かれたホスト名**であって引き終わったアドレスではない。
    アドレスで照合すると、名前の引き先が変わっただけで許可が別のホストへ移る。
  - あわせて、判定を**ペアリングのときだけでなく毎リクエストに掛ける**と決めた。
    1 回だけだと、④ で公開アドレスを申告して通したあと名前の引き先を閉域内へ付け替えるだけで、
    **この検証が防ごうとしたものがそのまま成立する**。
- **Trade-offs**: 運用者が `allowList` に書いた宛先については、条件が 3 つとも外れる。明示した宛先に限るので受け入れる。
- **Follow-up**: 判定を毎回掛けるのは `chat-integration-proxy` の `relation/growi-uri-resolver.ts`。

## Risks & Mitigations

| リスク | 緩和 |
|---|---|
| Chat SDK のリリース頻度が高く、`protected` 拡張面が「安定と見なされていない」 | バージョン完全固定（決定 1）+ 触れてよい層を 1 つに限定（決定 2）+ 能力表の突き合わせを Revalidation Trigger にする |
| `chat-adapter-mattermost` が有志作（メンテナ 1 名・4 リリース） | 決定 4 により必要な機能が「投稿・mention・その場限りのメッセージ」だけになり、いずれも対応済み。**fork は現時点で不要**。必要になったら `protected` 拡張面での subclass が先の手段 |
| `structured-headers` に型定義が無い | 薄い型付きラッパを 1 つ書き、そこだけが未型付き API に触れる |
| 自前で書く RFC 9421 の署名対象文字列に取りこぼしがある（例: `@target-uri` を含め忘れる） | 署名対象を 1 か所に定数として宣言し、RFC 9421 のテストベクタと、対象を 1 つずつ削った改ざん検知テストで担保する |
| Teams だけ外部からの接続が要る | Azure Bot Service の IP レンジに絞る手順を導入ドキュメントに含める（要件 13.3） |
| proxy が侵害されたとき閉域内の GROWI への足がかりになる | GROWI 側でも毎リクエストを検証する（要件 10）。導入ドキュメントに影響範囲を明記（要件 13.5） |
| PostgreSQL への接続経路が Prisma と `state-pg` の 2 系統になる | 双方の接続上限を明示的に設定し、合計が PostgreSQL の上限を超えないことを起動時に検査する |
| official proxy が常駐コストを持つ（アイドル時もインスタンスが要る） | Socket Mode / Gateway / Mattermost の WebSocket を張る以上そもそも常駐が要るので、これは Workers を捨てたことによる損失ではない。インスタンス数は installation の数に比例し、登録された GROWI の数には比例しない |

---

## References

- [vercel/chat（Chat SDK, MIT）](https://github.com/vercel/chat) — 本 spec が採用する土台。同梱 docs を tarball から確認
- [RFC 9421 HTTP Message Signatures](https://datatracker.ietf.org/doc/html/rfc9421) — 毎リクエストの相手確認。テストベクタも規定されている
- [RFC 9530 Digest Fields](https://www.rfc-editor.org/rfc/rfc9530.html) — `Content-Digest`
- [RFC 8941 Structured Field Values](https://www.rfc-editor.org/rfc/rfc8941.html) — 署名パラメータの正準化
- [Service tags for Azure Bot](https://techcommunity.microsoft.com/blog/iis-support-blog/service-tags-for-azure-bot-simplifying-ip-management/4369246) — Teams の接続元を絞るための IP レンジ
- `.kiro/specs/chat-integration/brief.md` — discovery 段階の調査と、確定済みの決定 1〜8
