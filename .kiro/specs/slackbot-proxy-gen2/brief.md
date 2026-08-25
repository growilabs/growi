# slackbot-proxy Generation 2 — Discovery Brief

`apps/slackbot-proxy` を「Slack 専用プロキシ」から「複数チャットプラットフォームのハブ」へ作り直すための構想メモ。
**このドキュメントは discovery 段階であり、要件・設計として承認されたものではない。** 未決の意思決定は
[未決の意思決定](#4-未決の意思決定) に、選択肢と判断材料をセットで並べてある。

調査日: 2026-08-25

## 前提（2026-08-25 確定）

**Gen 2 は完全なスクラッチ開発とする。Gen 1 との後方互換は取らない。段階的移行も考えない。**
既存のデータモデル・プロトコル・依存ライブラリのいずれにも縛られず、一から最良を目指してよい。

この前提は以下の判断を確定させる:

- **データベースは自由に選べる** — MySQL / TypeORM 0.2.45 の古い組み合わせから抜けられる（決定 1）
- **認証方式を 2 段階で移行する必要が無い** — 最初から公開鍵暗号で作れる（決定 6）
- `@growi/slack` に互換レイヤーを残す必要は無い
- Ts.ED 6.43 のバージョン固定など、Gen 1 が抱える技術的負債を引き継がない

**一方で新しく必要になる判断**: Gen 1 と Gen 2 はしばらく**併存**する（既存利用者は Gen 1 proxy を使い続ける）。
GROWI 本体が両プロトコルを同時に話すのか、Gen 2 は別デプロイとして利用者が一括移行するのかは
決定 8（Gen 1 をいつまで動かし続けるか）で扱う。

なお **Gen 1 側には手を入れない**。本ブリーフが Gen 1 の実装に言及するのは、
Gen 2 で何を変えるかの根拠を示すためだけである。

---

## 1. 出発点

### Gen 1 の課題（起票時の整理）

| 課題 | 補足 |
|---|---|
| Slack にしか対応していない | `@slack/oauth` / `@slack/web-api` / Block Kit がコードベース全域に露出している |
| オフィシャルアプリでもない | 各利用者が自前で Slack App を作る必要がある |
| private channel への投稿に事前準備が必要 | bot の招待が前提（`join-to-conversation` ミドルウェアが存在する理由） |

### 維持したい機能

- GROWI → 外部システムへの Post（channel への notification）
- **複数 GROWI 対 複数 Slack workspace のハブ**（← Gen 2 でも核心。後述のとおり、ここは既製ライブラリでは代替できない）

### Gen 2 に求めること

- Mattermost / Discord / Teams / Chatwork など複数チャットシステムへの対応

---

## 2. 調査: チャットプラットフォームのアダプタライブラリはあるか

> 問い:「Mastra が複数 LLM Provider を吸収してくれたように、複数チャットプロダクトのアダプタになるライブラリはないか。
> ただし OSS として再配布できることが重要」

### 結論

**ある。[Vercel Chat SDK](https://github.com/vercel/chat)（npm パッケージ名 `chat`）が、まさに「チャット版 Mastra」に相当する。**

**ライセンスは論点にならない** — 本体・公式アダプタ・調査した community アダプタまで、すべて **MIT**。
GROWI（MIT）に同梱して再配布することに支障はない。

真の論点は**ライセンスではなく、プラットフォームごとの「メンテナンス階層」**である。
Chat SDK はアダプタを「Vercel 公式 / チャットサービス側の公式 / 有志作」の 3 段階に分けており、
**GROWI が最も必要とする 2 つ（Mattermost・Chatwork）が、いちばん弱い有志作にあたる**。

### 2.1 パッケージ実測（npm registry / 同梱 docs より、2026-08-25 時点）

| パッケージ | 最新 | ライセンス | 最終公開 | 誰が作っているか |
|---|---|---|---|---|
| `chat`（本体） | 4.38.1 | MIT | 2026-08-17 | 公式（Vercel） |
| `@chat-adapter/slack` | 4.38.1 | MIT | 2026-08-17 | 公式 |
| `@chat-adapter/teams` | 4.38.1 | MIT | 2026-08-17 | 公式 |
| `@chat-adapter/discord` | 4.38.1 | MIT | 2026-08-17 | 公式 |
| `@chat-adapter/gchat` | 4.38.1 | MIT | 2026-08-17 | 公式 |
| `@chat-adapter/telegram` / `whatsapp` / `github` / `linear` / `notion` / `twilio` / `x` / `messenger` / `instagram` / `web` | 4.38.1 | MIT | 2026-08-17 | 公式 |
| `@chat-adapter/state-{memory,redis,ioredis,pg}` | 4.38.1 | MIT | 2026-08-17 | 公式 |
| **`chat-adapter-mattermost`** | **1.1.3** | MIT | **2026-05-28** | **community（個人メンテナ 1 名 / 全 4 リリース）** |
| **`chat-adapter-chatwork`** | **0.1.0-alpha.0** | MIT | **2026-06-03** | **community（alpha / 全 2 リリース）** |
| `@larksuite/vercel-chat-adapter`（Lark/Feishu） | 0.1.2 | MIT | 2026-05-14 | vendor-official |
| `@beeper/chat-adapter-matrix` | 0.2.0 | MIT | 2026-03-16 | community |

Node.js `>=20` 要求。GROWI は Node 24 系なので問題なし。

### 2.2 slackbot-proxy にとって「効く」機能

同梱ドキュメント（`node_modules/chat/docs`）と `@chat-adapter/slack` の README から確認した、
**Gen 1 が手書きしている部分をそのまま置き換えられる**もの:

| Chat SDK の機能 | Gen 1 で対応する自前実装 |
|---|---|
| **multi-workspace OAuth モード** — `handleOAuthCallback()` / `getInstallation()` / `setInstallation()` / `deleteInstallation()`、webhook の `team_id`・`enterprise_id` からトークンを自動解決 | `InstallerService`、`entities/installation.ts`、`@slack/oauth` の InstallationStore |
| **`installationProvider`** — 外部トークンストアを差し込んで webhook 時のトークン解決だけ委譲できる（read-only） | 既存 MySQL の `Installation` テーブルをそのまま活かす差込口になる |
| **トークンの保存時暗号化**（AES-256-GCM / `encryptionKey`） | 無し（平文 JSON カラム） |
| **`withBotToken(token, fn, { installationId })`** — webhook 外（cron / GROWI からの push）から任意テナントとして送信。`AsyncLocalStorage` でテナント分離 | `generateWebClient()` + `callSlackApi` の手書きルーティング |
| **`bot.channel("slack:C123").post(...)` / `bot.thread(id).post(...)`** — イベント外からの channel 投稿 | `growi-to-slack.ts` の `POST /g2s/:method` 汎用プロキシ |
| **プラットフォーム中立なメッセージ表現**（markdown / mdast AST / Card）→ 各プラットフォームのネイティブ形式へ変換（Block Kit / Adaptive Cards / Google Chat Cards） | `@growi/slack` の `block-kit-builder`、`growi-uri-injector/*` の Delegator ツリー |
| **Enterprise Grid 対応**（org-wide install、`event_id` による重複排除、per-installation のユーザキャッシュ分離） | 部分的（`isEnterpriseInstall` フラグのみ） |
| **Socket Mode** | 無し（公開 HTTP エンドポイント必須） |
| webhook ハンドラが Web 標準 `Request`/`Response`（`bot.webhooks.slack`） | Ts.ED コントローラに手書き |

**self-host に有利な点**: Discord アダプタは Gateway の常時 WebSocket 接続を要するため、Chat SDK 公式ドキュメントは
Vercel Pro/Enterprise の cron で接続を維持する回避策を案内している。slackbot-proxy は**常駐 Node プロセス**なので、
ここは self-host 側が有利。Slack Socket Mode も同様に常駐プロセスだから素直に使える
（= ファイアウォール内 GROWI 向けの選択肢が増える）。

### 2.3 比較検討して落とした選択肢

| 候補 | ライセンス | 落とした理由 |
|---|---|---|
| [Novu](https://github.com/novuhq/novu) + `@novu/chat-sdk-adapter` | MIT（core） | chat providers（Slack/Discord/Mattermost/Teams/Zulip/WhatsApp）は魅力的だが、Chat SDK アダプタは **inbound を Novu Cloud の bridge 経由でルーティングする**。self-host 再配布と矛盾する。self-host 版も Mongo + Redis + 複数サービスで重い |
| [Apprise](https://github.com/caronc/apprise) | BSD-2 | outbound 通知専用（100+ サービス）。**Python**、双方向不可、Chatwork 非対応。インタラクティブ機能を捨てる場合のみ検討価値あり |
| [Matterbridge](https://github.com/42wim/matterbridge) | Apache-2.0 | 対応プラットフォームは最多（Teams / Mattermost / Discord / Matrix / Zulip …）だが、**Go の別プロセス**かつ本質は「ブリッジ（中継）」。bot としての slash command / interactive 処理には向かない |
| [Botkit](https://github.com/howdyai/botkit) | MIT | **死んでいる**（最終公開 2022-03） |
| [Microsoft Bot Framework SDK](https://github.com/microsoft/botframework-sdk)（`botbuilder`） | MIT | **アーカイブ済み・LTS は 2025-12 で終了**。後継は Microsoft 365 Agents SDK（`@microsoft/teams.*`）で、これは Chat SDK の Teams アダプタが既に採用している |
| [Hubot](https://github.com/hubotio/hubot) | MIT | 生存中（v14, 2026-02）だが設計が古く、OAuth マルチテナント・interactive component・カード表現の面倒を見てくれない |

### 2.4 Chat SDK を採用しても残るリスク 4 点

1. **Mattermost / Chatwork が有志作**
   - Mattermost: メンテナ 1 名・4 リリース。REST API v4 + `/api/v4/websocket` 実装。post / reaction / slash command 対応。
   - Chatwork: `0.1.0-alpha.0`・2 リリース。そもそも Chatwork には thread も interactive component も無いため、
     Chat SDK が前提とする Thread / Card / Action というモデルと噛み合わない部分が大きい。
   - → **GROWI が fork してメンテするか、vendor-official として引き取る覚悟が要る**。
     アダプタ実装インタフェースは公開されており（`docs/contributing/building`）、自前実装は現実的。

2. **state adapter が必須で、MySQL 実装が無い**
   Chat SDK は subscription / 分散ロック / dedup のため state adapter を**必須**とする。
   公式は memory / redis / ioredis / **pg** のみ。slackbot-proxy は現在 **MySQL + TypeORM 0.2.45**。
   → スクラッチ前提により **PostgreSQL へ移行**して解消する。決定 1 参照。

3. **リリースの頻度が非常に高い**
   約 8 か月で 54 リリース。公式ドキュメントも `protected` 拡張面について
   「まだ完全に安定とは見なしていない。マイナーリリースでシグネチャが変わりうる」と明記している。
   → 緩和策は **(a) 完全固定バージョン**（本リポジトリが `@tsed/*` で既にやっている `=x.y.z` 方式）と
   **(b) GROWI 側の薄い facade で包み、アップグレードの影響を 1 モジュールに閉じ込める**。これは設計判断として明記する。

4. **Teams は簡単な導入方法が既に無くなっている**
   Office 365 Connector（incoming webhook）の廃止は **2026-05 に完了済み**。つまり「Webhook URL を貼るだけ」は**もう使えない**。
   `@chat-adapter/teams` は Bot Framework 系エンドポイント（`@microsoft/teams.*`）を通るため、
   **self-host する運用者ごとに Azure Bot 登録が必要**。Discord や Mattermost のような「環境変数だけ」では済まない。

### 2.5 プラットフォーム別 導入コスト

| プラットフォーム | アダプタ | 運用者側の準備 | コスト |
|---|---|---|---|
| Slack | 公式 | OAuth App（現状と同じ） | 低 |
| Discord | 公式 | Bot Token + Application。常駐プロセスなので Gateway も素直 | 低 |
| Google Chat | 公式 | Service Account | 中 |
| Mattermost | **有志作** | Bot Account + Token（self-host 同士なので相性は良い） | 中（アダプタ保守リスク） |
| Teams | 公式 | **Azure Bot 登録が必須** | **高** |
| Chatwork | **有志作 / alpha** | API Token | **高**（抽象とのミスマッチ + alpha） |

---

## 3. Gen 2 アーキテクチャの方向性

### 3.1 レイヤー分割

```
GROWI (N 台)
  │  チャットサービスに依存しないメッセージ形式（markdown / AST / Card）+ 認証情報
  ▼
┌─────────────────────────────────────────────┐
│ slackbot-proxy Gen 2                        │
│                                             │
│ ① GROWI 関係管理レイヤー ★GROWI 自前・維持   │
│    Relation / Order / トークンペア /         │
│    どの GROWI へルーティングするかの解決      │
│                                             │
│ ② Chat SDK facade ★薄く保つ                 │
│                                             │
│ ③ Chat SDK (`chat` + adapters) ★既製        │
│    OAuth / installation / webhook 検証 /     │
│    ネイティブ形式変換 / 分散ロック            │
└─────────────────────────────────────────────┘
  ▼
Slack / Mattermost / Discord / Teams / Chatwork ...
```

### 3.2 Chat SDK に**寄せられない**もの — ハブ機能は GROWI 自前のまま

Chat SDK の multi-workspace は **`team_id` → bot token 1 本**の解決しかしない。
GROWI のハブ役にはもう 1 軸ある:

- `Relation` は `[installation, growiUri]` の複合ユニークインデックスを持つ ＝ **1 workspace : N GROWI**
- `SelectGrowiService` は「このコマンドはどの GROWI に流すのか」を利用者に選ばせるために存在する
- `tokenGtoP` / `tokenPtoG` のトークンペア、`permissionsFor{Broadcast,SingleUse}Commands` によるチャンネル単位権限

**Chat SDK が置き換えるのは「プラットフォーム配管層」だけであり、関係管理・トークンペア・ルーティングは Gen 2 でも GROWI が持ち続ける。**
Chat SDK の `installationProvider` は、この自前ストアを webhook 経路に差し込むための正規の口として使える。

### 3.3 移行の本丸は proxy ではなく **GROWI 本体側**

ここが工数の重心。プロキシの中身の入れ替えは簡単な方の半分でしかない。

現状、GROWI は **Slack Block Kit をそのまま喋る**:

- `packages/slack` の `block-kit-builder.ts`、`interaction-payload-accessor.ts`
- `apps/slackbot-proxy/src/services/growi-uri-injector/*` の Delegator ツリー
  （`ActionsBlockPayloadDelegator` / `SectionBlockPayloadDelegator` / `ViewInteractionPayloadDelegator` /
  `ButtonActionPayloadDelegator` / `CheckboxesActionPayloadDelegator`）
  — **これらは payload が Slack のものだから必要になっている**
- `apps/app/src/server/service/slack-integration.ts`（401 行）と
  `slack-command-handler/*`（help / keep / note / search / togetter / create-page）

Chat SDK 化すると:

- GROWI は**プラットフォーム中立なメッセージ**（mdast AST もしくは Chat SDK Card）を出す側になる
- `growi-uri-injector` ツリーは**役目を終える**（GROWI URI の埋め込みは中立表現側のメタデータに移す）

→ **Gen 2 で最も重要な設計判断は「チャットサービスに依存しないメッセージ形式をどう定義するか」** である。
具体的には `@growi/slack` の Block Kit 表面を置き換える **`@growi/chat`（仮）** を新設し、
`@growi/slack` は Gen 1 互換のためのレガシーとして凍結する。

---

## 4. 未決の意思決定

各フォークについて、**それを決める制約**を併記する。

### 決定 1: どのデータベースを使うか → **PostgreSQL に決定**

Chat SDK は subscription / 分散ロック / dedup のため state adapter を**必須**とする。
公式実装は memory / redis / ioredis / **pg** のみで、MySQL は無い。

スクラッチ前提により、**PostgreSQL + `@chat-adapter/state-pg`（公式・MIT）**が素直な結論になる:

- self-host 運用者にとっては **MySQL → PostgreSQL の付け替え**であり、
  ミドルウェアの新規追加ではない（Gen 1 も RDBMS を要求している）
- 公式 state adapter に乗れるので、MySQL adapter の自前実装・保守を負わなくて済む
- TypeORM 0.2.45（`package.json` に「アップグレードに大幅な変更が要る」とコメントされた塩漬け）から脱出できる

**残る小さな判断**: 分散ロックと dedup のためだけに Redis を併用するか、`state-pg` 一本で足りるか。
シングルインスタンス運用が主流なら `state-pg` のみで十分。水平スケールを前提にするなら
`state-redis` との併用を測ってから決める。

### 決定 2: Teams をどこまでサポートするか

Azure Bot 登録が運用者ごとに必要。「オフィシャルアプリでない」という Gen 1 の課題が Teams では更に重くなる。

**Teams はサポートする方針で確定**（2026-08-25）。残るのは導線をどこまで用意するかだけ。

- 案 1: ドキュメントとセットアップ UI まで用意する
- 案 2: 対応はするが導線は用意せず、上級者向けとする

Azure Bot 登録が運用者ごとに必要な点は変わらないので、案 1 を採るならその手順書が主な作業になる。
決定 7 で確定した閉域向け推奨構成のドキュメントと、内容がかなり重なる。

### 決定 3: 複数 GROWI の検索結果をどう並べるか → **proxy が RRF で 1 本のリストに統合**（2026-08-25 確定）

**前提の訂正: 複数 GROWI にまたがる検索は LLM 抜きで Gen 1 に既にある。**

- `packages/slack/src/consts/index.ts`: `defaultSupportedCommandsNameForBroadcastUse = ['search']`
  — search は全 GROWI へ配られる唯一のコマンドとして定義されている
- `controllers/slack.ts`: 1 つの workspace に紐づく全 `Relation` に対して
  `/_api/v3/slack-integration/proxied/commands` を `Promise.allSettled` で並列 POST
- 各 GROWI が自分の Elasticsearch で検索し、**自分の権限判定を自分で適用して**、
  それぞれ独立に `response_url` へ返す（実際には proxy の `/g2s/respond` を経由するので、
  **結果は既に全台ぶん proxy を通過している**）

したがって分岐は「やるかどうか」ではなく「**結果をどう見せるか**」だった。

#### 決定内容

proxy が全 GROWI の結果を待ち合わせ、**Reciprocal Rank Fusion（RRF）** で 1 本のリストに統合して投稿する。
LLM は使わない。

#### この構成での RRF の挙動を正確に理解しておくこと

RRF は本来、**同じ文書集合に対する複数のランキング**（BM25 とベクトル検索など）を融合する手法で、
「複数のリストで上位に来る文書ほど強い」という性質で効く。

しかしここでは GROWI ごとに文書集合が互いに素であり、**同じ文書が 2 つのリストに現れることはない**。
RRF の式 `Σ 1/(k + 順位)` は各文書につき 1 項しか持たないので、
出力は「各 GROWI の 1 位 → 各 GROWI の 2 位 → …」という**交互配置と数学的に等価**になる。

これは欠点ではなく、この状況で妥当な既定動作である:

- 比較できないスコアを比較せずに済む
- どの GROWI も平等に扱われる
- 挙動が予測可能で説明しやすい

ただし**関連度順に並ぶわけではない**。「1 件だけ完璧にマッチする GROWI」と
「50 件そこそこマッチする GROWI」が同じ扱いになる点は許容する。

**実装は RRF の式のまま持つ**（単なる交互配置として書かない）。GROWI ごとの重み `w` を掛けた
`w / (k + 順位)` にすれば、アルゴリズムを変えずに「この GROWI が主、こちらは参考」という調整ができる。
定数 `k` は慣例どおり 60。

#### LLM による並べ替えは将来の選択肢として残す

RRF が原理的にできないのは「別々の文書集合をまたいだ関連度判定」であり、これは LLM にしかできない。
やる場合は **proxy が集めた結果を代表 GROWI に渡して並べ替えてもらう**形にする:

- proxy には結果が既に全台ぶん通過しているので、**新しい資格情報が 1 つも要らない**
- 代表 GROWI が他の GROWI に問い合わせる能力を得るわけではない。
  見えるのは「各 GROWI がそのユーザーに見せてよいと判断して返したもの」だけ
- proxy に GROWI 全台分のアクセストークンを持たせる案は**採らない**。
  結果を渡すだけで済む話に、proxy が長期資格情報を抱えるリスクを負う理由がない

要約まで踏み込む場合だけは本文取得が必要になり、代表 GROWI が他 GROWI を読む手段が要る。
**要約はやらない**と決めておけば、この論点自体が発生しない。

#### この決定が確定させること

- **検索結果は整形済みの表示物ではなく構造化データで返す。** 順位・パス・タイトル・URL・更新日時を
  proxy が受け取れる形にする。チャットサービスに依存しないメッセージ形式（`@growi/chat`）の要件が 1 つ具体化した
- **proxy が待ち合わせる。** 投げっぱなしではなくなり、検索中だけ proxy が状態を持つ
- **締め切りと、応答しなかった GROWI の扱いを設計する。** 全台揃うまでは待てないのでタイムアウトを設け、
  間に合わなかった GROWI は「応答なし」として明示する。
  そのまま並べる方式が持っていた「障害が見える」性質は、ここを作り込んだ場合にだけ保たれる
- **検索結果の整形は proxy が行う**（検索に限る）。並べ替えた後に組み立てるため
- **各行にどの GROWI の結果かを表示する。** 交互配置されるので出典表示が必須
- **権限判定は変わらない。** 各 GROWI がローカルに適用してから返す構造はそのまま

### 決定 4: ページ作成を決まったコマンドのままにするか、自由な文章から作れるようにするか

**注意: これも Gen 1 に既にある。** `slack-command-handler/create-page-service.js` と `note` コマンドが該当する。
したがって真の問いは「新機能として作るか」ではなく **「固定コマンドのままか、LLM / MCP 経由の自由入力にするか」**。

認証機構はもう揃っている: `access-token-parser` spec（実装完了済み）により、
GROWI は**スコープ付きアクセストークン**を `X-GROWI-ACCESS-TOKEN` ヘッダで受け付ける。
プロキシがページ作成を代行するなら、この scoped token が使うべき正規の仕組みであり、
「読み取りのみ」「特定スコープのみ」の絞り込みもトークン側で表現できる。

- 案 1: Gen 1 と同じ固定コマンドを、チャットサービスに依存しない形で作り直すだけ（LLM 不要）
- 案 2: MCP サーバを GROWI 側に立て、LLM は GROWI 内のエージェントが動かす（= 決定 3 の「そのまま並べる」案、または集約役 GROWI 案と整合）
- 案 3: プロキシが MCP クライアントになり、LLM もプロキシ側で動かす（= proxy 自身がまとめ役になる案と整合）

**決める材料**: 決定 3 と同じ論点（書き込み権限を誰が持つか）。
決定 3 が「LLM を使わず proxy が RRF で並べる」に決まったので、**案 1（決まったコマンドを作り直すだけ）が既定**になる。
自由入力にするかは、Gen 2 の初版を出してから別途判断してよい。

### 決定 5: 各チャットサービスの公式アプリ審査を通すか

Gen 1 の課題として挙がっているが、これは**アーキテクチャではなく組織・審査の問題**（Slack App Directory 申請、
Discord の verified bot、Teams の AppSource 申請）。プラットフォームごとに審査要件も期間も違う。

**決める材料**: Gen 2 の技術スコープに含めず、別トラックとして扱うのが妥当か。含めるならプラットフォームごとに個別判断が要る。

### 決定 6: proxy と GROWI がお互いを本物だと確認する方法

#### Gen 1 の方式と、その限界

GROWI が `tokenGtoP` / `tokenPtoG` の 2 本を発行し、双方が相手の DB に登録し合う。
以降は静的な bearer 文字列をカスタムヘッダ（`x-growi-gtop-tokens` / `x-growi-ptog-tokens`）に載せ、
受け側は DB 照合するだけ。

設計上の限界は 4 点:

1. **トークン生成に CSPRNG 由来のランダム性が無い**（`SlackAppIntegration.generateAccessTokens`）。
   秘密の強度が設定値と生成時刻に依存する。Gen 2 では鍵生成をこの方式から完全に置き換える。
2. **リクエストへの束縛が無い** — 署名が無いので、メソッド・パス・ボディのいずれとも紐づかない。
   トークン文字列を持つ者は任意のリクエストを送れる。
3. **有効期限・失効・ローテーションの手段が無い** — 発行したら手動で消すまで永続。
4. **平文の共有秘密が両側に置かれる** — GROWI 側 MongoDB、プロキシ側 MySQL の両方。
   どちらかが漏れれば即座に相手を騙れる。

さらに、プロキシの `POST /g2s/:method` は **Slack Web API の汎用パススルー**であり、
`tokenGtoP` 1 本が「その workspace の bot 権限そのもの」に等しい。信頼確立の強度が
そのまま被害の上限を決める構造になっている。

#### 何を Web 標準に置き換えられるか

置き換えの対象は、実は**独立した 3 層**であり、まとめて論じると設計を誤る。

| 何をする部分か | Gen 1 | Gen 2 候補（Web 標準） |
|---|---|---|
| **(a) 最初の紐付け** — proxy と GROWI が初めて相手を登録するとき | `/growi register` → `Order`（10 分で失効）→ 相互登録 | 形は既に正しい。**短時間だけ有効な登録コード + 相手の URL の所有確認**として整理し直す |
| **(b) 毎回のリクエスト認証** — 紐付け後、リクエストごとに相手を確認する | 固定文字列をカスタムヘッダに入れるだけ | **RFC 9421 HTTP Message Signatures** + **RFC 9530 Content-Digest** |
| **(c) 誰の代理か** — 「どの GROWI ユーザとして書くのか」を伝える | 無し（各 GROWI が Slack ユーザを自分で解決している） | 必要になったら **RFC 8693 Token Exchange** の `act` クレーム |

#### 本命は (b) の毎回のリクエスト認証 — RFC 9421 HTTP Message Signatures

[RFC 9421](https://datatracker.ietf.org/doc/html/rfc9421)（2024-02 発行）は、HTTP メッセージの
**メソッド・ターゲット URI・選択したヘッダ・ボディダイジェスト**に対する署名を標準化したもの。
[RFC 9530](https://www.rfc-editor.org/rfc/rfc9530.html) の `Content-Digest` と組み合わせる。

Gen 1 の限界との対応:

| Gen 1 の限界 | RFC 9421 での解消 |
|---|---|
| リクエストへの束縛が無い | `@method` / `@target-uri` / `content-digest` を署名対象に含める |
| 有効期限が無い | `created` / `expires` パラメータ + `nonce` でリプレイ窓を閉じる |
| 平文の共有秘密が両側に | **非対称鍵なら秘密鍵は送信も共有もされない**。相手側が持つのは公開鍵だけ |
| ローテーション手段が無い | `keyid` で複数鍵を併存させ、無停止でローテーションできる |

**スクラッチ前提なので、最初から Ed25519（非対称鍵）で作る。**
RFC 9421 は HMAC-SHA256 でも使えるため「共有秘密のまま署名だけ導入する」中間段階を取ることもできるが、
それは既存ペアリング UX を壊さずに移行するための妥協策であり、後方互換を捨てる本件では採る理由が無い。

非対称にすることで得られるのは、署名の強度そのものより**運用上の性質**である:

- 秘密鍵は**一度もネットワークに出ない**。相手側 DB に置かれるのは公開鍵だけ
- したがって**相手側の DB 漏洩が、自分になりすまされることを意味しない**（Gen 1 はこれが成立していない）
- `keyid` で新旧鍵を併存させ、無停止でローテーションできる

→ ユーザの問いへの直接の答え: **「相互登録」というセレモニー自体は無くならない。無くなるのはその"秘密"の半分である。**

#### 公開鍵をどう配るか — self-host の実情に合わせる

JWKS には by-reference（`jwks_uri` を相手が取得しに行く）と by-value（ペアリング時に公開鍵そのものを登録）がある。
**GROWI は firewall 内に置かれ inbound 到達性が無いことが多い**（Socket Mode を検討する理由と同じ制約）ため、
**by-value をデフォルト**とし、公開到達可能な構成向けに by-reference + ローテーション用ポーリングを opt-in とする。

> 要検証: 実際の self-host 利用者のうち GROWI を inbound 公開している割合。
> 公開が普通なら by-reference を既定にした方が単純になる。

#### (a) 最初の紐付け — Gen 1 の良い部分は残す

`urlVerificationRequestToGrowi()` が、主張された GROWI URL に challenge を POST して応答を確認している。
これは**エンドポイント所有証明**であり、正しいプリミティブなので**残して形式化する**。
`Order` の 10 分失効も、実質的に短命 enrollment code として既に正しい形をしている。

非対称化後のペアリングは「公開鍵を交換し、エンドポイントの所有を相互に証明する」だけになる。

#### 検討して採らなかったもの

| 候補 | 採らない理由 |
|---|---|
| **mTLS**（[RFC 8705](https://www.rfc-editor.org/rfc/rfc8705.html)） | self-host 運用者の大半はリバースプロキシで TLS 終端しており、クライアント証明書の受け渡し・更新の運用負荷が現実的でない |
| **OAuth 2.0 Client Credentials + private_key_jwt**（[RFC 7523](https://www.rfc-editor.org/rfc/rfc7523.html)） | **GROWI を Authorization Server にする**必要がある（現状は OIDC の *クライアント* でしかない）。トランスポート信頼のためだけには過大 |
| **DPoP**（[RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html)） | OAuth の上に載る仕組みなので、上と同じ AS 要件を継承する |
| **MCP の認可モデル**（OAuth 2.1 + [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html) + DCR + RFC 8707） | これは「ユーザの代理としてアクセスする」ための標準なので **(c) の話**。**(b) と混ぜてはいけない。** 決定 4 で LLM / MCP 経由を選ぶ場合に、(b) の上に載せる形で使う |

なお、RFC 7523（署名付き JWT を bearer として提示）だけなら `jose` で完結し、依存の信頼コード面は小さい。
ただし**メソッド・パス・ボディへの束縛は得られない**ので、RFC 9421 の代替にはならない。

#### 依存の健全性（実測 / 2026-08-25）

| パッケージ | 最新 | ライセンス | 最終公開 | 総リリース数 |
|---|---|---|---|---|
| `http-message-signatures`（RFC 9421） | 1.0.6 | ISC | 2026-06-04 | **10** |
| `jose`（JWS / JWKS / Ed25519） | 6.2.10 | MIT | 2026-08-21 | 243 |
| `oauth4webapi` | 3.8.7 | MIT | 2026-08-11 | 78 |

**注意**: `http-message-signatures` は総リリース 10 本と薄い。セキュリティ検証パスの依存としては
「知った上で受け入れる」か、「正準化処理だけ自前で書き `jose` のプリミティブに載せる」かを明示的に決める必要がある。
スクラッチで移行期限に追われないぶん、後者（署名・鍵管理は `jose`、RFC 8941 Structured Fields の
正準化のみ薄く自前 or `structured-headers`）を選ぶ余地は大きい。**暗号そのものは絶対に自前で書かない。**

#### 決める制約

(b) の毎回のリクエスト認証（RFC 9421 + Ed25519）は他の決定に依存しないので、**単独で設計を確定できる**。
公開鍵の配り方は、決定 7 が「proxy から GROWI へ」で確定したことにより
**ペアリング時に公開鍵そのものを登録する方式に決まった**。
(c) の「誰の代理か」は決定 3・4 次第 — 検索結果をそのまま並べる案なら当面不要。

### 決定 7: proxy と GROWI のどちらから接続しに行くか → **proxy から GROWI へ（Gen 1 と同じ）に決定**

Gen 1 は proxy が各 GROWI の URL に HTTP リクエストを送る形になっている
（`axios.post(new URL('/_api/v3/slack-integration/proxied/commands', relation.growiUri))`、
`urlVerificationRequestToGrowi()` も同様）。つまり GROWI が proxy から到達可能である必要がある。

これを逆にして「GROWI が proxy へ接続しに行き、その接続を保持し続ける」形も検討したが、**採らない**。

#### なぜ採らないか

まず、GROWI を外部公開できない環境は **Gen 1 の時点で既に自前 proxy でサポートされている**。
`slackbot:proxyUri` にデフォルト値は無く管理者が任意の URL を指定でき、proxy 側にも `OFFICIAL_MODE`
環境変数がある。つまり「自前 proxy を立てる」は正式なデプロイ形態である。
Slack が到達する必要があるのは proxy だけなので、**GROWI 全体を公開するより小さな proxy を 1 つ公開する方が
はるかに現実的**という前提で作られている。

したがって常時接続方式が実際に買うものは「できないことをできるようにする」ではなく
「**社内ネットワークのみの GROWI でも、自前 proxy を運用せずに公式 proxy を使える**」という運用負荷の削減に留まる。
その見返りに対して、以下のコストが釣り合わない:

- 登録された GROWI 1 台につき接続を 1 本常時保持する。**使われていない登録もリソースを消費する**
  （Gen 1 はアイドル時のコストがゼロ）。公式 proxy が受け入れられる登録数の上限が、
  スループットではなく同時接続数で決まるようになる
- proxy を複数台にすると、その GROWI の接続を保持しているインスタンスへ転送する仕組みが要る。
  1 つの workspace に複数 GROWI が紐づくため、ロードバランサのスティッキーセッションでは解決できない
- 再接続処理、1 本の接続上でのリクエストと応答の対応付け、素の HTTP より難しい障害調査

#### 閉域ネットワークはこの構成で満たす

proxy と GROWI の両方を閉域に置き、**proxy にだけ穴を開ける**。GROWI は一切公開しない。

サービスごとに必要な穴は異なる:

| サービス | proxy への穴 | 理由 |
|---|---|---|
| Slack | **不要** | Socket Mode（proxy から Slack へ接続しに行く） |
| Mattermost | **不要** | 閉域内にあるので proxy から接続するだけ |
| Teams | **必要** | Bot Framework が proxy の messaging endpoint へ POST してくる |
| Google Chat | 不要にできる可能性 | [Pub/Sub 経由で受け取るモード](https://developers.google.com/workspace/chat/quickstart/pub-sub)があり公開エンドポイント不要。ただしダイアログが使えない制約あり、かつ Chat SDK のアダプタが対応しているかは**未確認** |
| Discord | たぶん必要 | Chat SDK のアダプタがスラッシュコマンドとボタンを HTTP で受ける作り。**要確認** |

Teams の穴もインターネット全体に開ける必要はない。Microsoft は Azure Bot Service の IP レンジを
[`AzureBotService` service tag](https://techcommunity.microsoft.com/blog/iis-support-blog/service-tags-for-azure-bot-simplifying-ip-management/4369246)
として公開しており、ファイアウォールをそのレンジに絞れる
（Microsoft 自身が静的リストの手書きを非推奨とし、公式の IP レンジファイルの定期取得を案内している）。

**残るリスクとして明示しておくこと**: proxy が侵害された場合、閉域内の GROWI への足がかりになる。
セキュリティレビューで必ず問われるので、DMZ から GROWI への通信を GROWI 側でも認証する。
これは決定 6 の署名方式がそのまま効くので追加実装は不要。
また proxy は PostgreSQL を必要とするため、DB を DMZ に置くか DMZ から内側の DB への経路を開けるかの判断が要る。

#### やること: 閉域向け推奨構成を正式に設計・ドキュメント化する

この構成を「仕方なくそうする」で終わらせず、**名前を付けた推奨デプロイ構成**として、
構成図・ファイアウォール設定手順・proxy と GROWI の役割分担を用意する。
実装コストはほぼゼロだが、顧客のセキュリティレビューを通す際の効果が大きい。

#### この決定が確定させること

- proxy の接続受け口、GROWI 側の接続クライアント、インスタンス間転送 — **いずれも作らない**
- 公式 proxy のキャパシティ特性は Gen 1 と同じ（アイドルコストゼロ、ステートレスに水平スケール）
- 決定 1 のデータベースは PostgreSQL 1 つで足りる見込み（接続の所在管理が不要なので Redis 併用の検討が要らない）
- 決定 6 の公開鍵の配り方は「ペアリング時に登録」で確定

### 決定 8: Gen 1 をいつまで動かし続けるか

後方互換を取らないと決めた以上、Gen 1 と Gen 2 は**しばらく併存する**。既存利用者は Gen 1 proxy を使い続けるからである。
なお `RegisterService` に `OFFICIAL_MODE` 環境変数があるとおり、**公式ホスト版プロキシ**の運用も絡む
（公式版を切り替えるタイミングは全利用者に一斉に影響する）。

- **案 1: GROWI 本体が両方のプロトコルを同時にサポート** — 既存の `/_api/v3/slack-integration/proxied/*` を残したまま
  Gen 2 用のエンドポイント群を追加する。利用者は任意のタイミングで乗り換えられる。
  GROWI 側に 2 系統のコードが残る期間が長引くリスク。
- **案 2: Gen 2 を別製品として扱う** — GROWI の特定メジャーバージョンで Gen 1 サポートを打ち切る。
  移行期限を切れるので負債が残らない。利用者に一括移行を強いる。
- **案 3: feature flag でどちらか一方だけ有効にする** — GROWI インスタンスごとにどちらかを有効化し、同時有効化は禁止。
  案 1 より状態が単純で、案 2 より移行を急がせずに済む。

**決める材料**: 公式ホスト版プロキシの利用者数と、Gen 1 サポート打ち切りを宣言できるメジャーバージョンの見通し。
どちらも社内で既に把握している情報なので、調査ではなく**方針決定**の問題。

---

## 5. 次のアクション

**大きな判断は出揃った。** 残るのは決定 8（Gen 1 をいつまで動かし続けるか）だけで、これは独立に決められる。

1. **`/kiro-spec-init` で Gen 2 の spec を起こす。** 本ブリーフがその入力になる。
2. **`@growi/chat`（チャットサービスに依存しないメッセージ形式）のインタフェース草案を書く。**
   決定 3 で「検索結果は構造化データで返す」が確定したので、要件が 1 つ具体化している。
   **Gen 2 の工数はここに最も集中する。**
3. **閉域向け推奨構成のドキュメントを起こす**（決定 7）。Teams のセットアップ手順（決定 2）と内容が重なるのでまとめて作る。
4. **決定 6 の毎回のリクエスト認証（RFC 9421 + Ed25519）の設計を確定する。** 他の決定に依存しない。
5. 並行して、リスクの実測を取る:
   - `chat-adapter-mattermost` を実際に GROWI からの通知経路で動かし、fork 保守の現実味を測る
   - `@chat-adapter/state-pg` 単体で足りるか、`state-redis` 併用が要るかを水平スケール前提で測る
   - Google Chat アダプタが Pub/Sub 経由の受信に対応しているか、Discord アダプタが公開エンドポイント無しで
     スラッシュコマンドとボタンを受けられるかを確認する（決定 7 の穴の一覧に影響する）


---

## 参考

- [vercel/chat（Chat SDK, MIT）](https://github.com/vercel/chat) — [chat-sdk.dev](https://chat-sdk.dev)
- [Office 365 Connector の Teams における廃止（Microsoft 365 Developer Blog）](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)
- [Bot Framework SDK（アーカイブ済み）](https://github.com/microsoft/botframework-sdk) / [Bot Service 概要](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-overview?view=azure-bot-service-4.0)
- [Novu](https://github.com/novuhq/novu) / [Novu Chat Integrations](https://docs.novu.co/platform/integrations/chat)
- [Apprise（BSD-2）](https://github.com/caronc/apprise)
- [Matterbridge（Apache-2.0）](https://github.com/42wim/matterbridge)
- [Botkit](https://github.com/howdyai/botkit)
- 関連 spec: [access-token-parser](../access-token-parser/)（scoped access token / `X-GROWI-ACCESS-TOKEN`）
