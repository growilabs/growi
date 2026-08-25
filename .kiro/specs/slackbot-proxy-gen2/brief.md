# slackbot-proxy Generation 2 — Discovery Brief

`apps/slackbot-proxy` を「Slack 専用プロキシ」から「複数チャットプラットフォームのハブ」へ作り直すための構想メモ。
**このドキュメントは discovery 段階であり、要件・設計として承認されたものではない。** 未決の意思決定は
[未決の意思決定](#未決の意思決定) にフォーク形式で列挙してある。

調査日: 2026-08-25

## 前提（2026-08-25 確定）

**Gen 2 は完全なスクラッチ開発とする。Gen 1 との後方互換は取らない。段階的移行も考えない。**
既存のデータモデル・プロトコル・依存ライブラリのいずれにも縛られず、一から最良を目指してよい。

この前提は以下の判断を確定させる:

- **決定 A は A-3 に決まる** — データストアは自由に選べる（MySQL / TypeORM 0.2.45 の塩漬けから脱出する）
- **決定 F の段階移行（HMAC → 非対称）は不要** — 最初から非対称鍵で作る
- `@growi/slack` に互換レイヤーを残す必要は無い
- Ts.ED 6.43 のバージョン固定など、Gen 1 が抱える技術的負債を引き継がない

**一方で新しく必要になる判断**: Gen 1 と Gen 2 はしばらく**併存**する（既存利用者は Gen 1 proxy を使い続ける）。
GROWI 本体が両プロトコルを同時に話すのか、Gen 2 は別デプロイとして利用者が一括移行するのかは
[決定 H](#決定-h-gen-1-との併存戦略) で扱う。

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
Chat SDK は adapter を 3 ティアに分類しており、**GROWI が最も欲しい 2 つ（Mattermost・Chatwork）が最も弱い**。

### 2.1 パッケージ実測（npm registry / 同梱 docs より、2026-08-25 時点）

| パッケージ | 最新 | ライセンス | 最終公開 | ティア |
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

**追い風**: Discord アダプタは Gateway の常時 WebSocket 接続を要するため、Chat SDK 公式ドキュメントは
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

### 2.4 ただし Chat SDK は「銀の弾」ではない — 4 つのリスク

1. **Mattermost / Chatwork が community ティア**
   - Mattermost: メンテナ 1 名・4 リリース。REST API v4 + `/api/v4/websocket` 実装。post / reaction / slash command 対応。
   - Chatwork: `0.1.0-alpha.0`・2 リリース。そもそも Chatwork には thread も interactive component も無いため、
     Chat SDK の抽象（Thread / Card / Action）とのインピーダンスミスマッチが大きい。
   - → **GROWI が fork してメンテするか、vendor-official として引き取る覚悟が要る**。
     アダプタ実装インタフェースは公開されており（`docs/contributing/building`）、自前実装は現実的。

2. **state adapter が必須で、MySQL 実装が無い**
   Chat SDK は subscription / 分散ロック / dedup のため state adapter を**必須**とする。
   公式は memory / redis / ioredis / **pg** のみ。slackbot-proxy は現在 **MySQL + TypeORM 0.2.45**。
   → スクラッチ前提により **PostgreSQL へ移行**して解消する。[決定 A](#決定-a-state-adapter-とデータストア--postgresql-に決定) 参照。

3. **バージョン churn が速い**
   約 8 か月で 54 リリース。公式ドキュメントも `protected` 拡張面について
   「まだ完全に安定とは見なしていない。マイナーリリースでシグネチャが変わりうる」と明記している。
   → 緩和策は **(a) 完全固定バージョン**（本リポジトリが `@tsed/*` で既にやっている `=x.y.z` 方式）と
   **(b) GROWI 側の薄い facade で包み、アップグレードの影響を 1 モジュールに閉じ込める**。これは設計判断として明記する。

4. **Teams はもう「崖の向こう」**
   Office 365 Connector（incoming webhook）の廃止は **2026-05 に完了済み**。つまり「Webhook URL を貼るだけ」は**もう使えない**。
   `@chat-adapter/teams` は Bot Framework 系エンドポイント（`@microsoft/teams.*`）を通るため、
   **self-host する運用者ごとに Azure Bot 登録が必要**。Discord や Mattermost のような「環境変数だけ」では済まない。

### 2.5 プラットフォーム別 導入コスト

| プラットフォーム | アダプタ | 運用者側の準備 | コスト |
|---|---|---|---|
| Slack | 公式 | OAuth App（現状と同じ） | 低 |
| Discord | 公式 | Bot Token + Application。常駐プロセスなので Gateway も素直 | 低 |
| Google Chat | 公式 | Service Account | 中 |
| Mattermost | **community** | Bot Account + Token（self-host 同士なので相性は良い） | 中（アダプタ保守リスク） |
| Teams | 公式 | **Azure Bot 登録が必須** | **高** |
| Chatwork | **community / alpha** | API Token | **高**（抽象とのミスマッチ + alpha） |

---

## 3. Gen 2 アーキテクチャの方向性

### 3.1 レイヤー分割

```
GROWI (N 台)
  │  中立メッセージ契約（markdown / AST / Card DSL）+ トークンペア
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

→ **Gen 2 の中心的な移行判断は「中立メッセージ契約の定義」** である。
具体的には `@growi/slack` の Block Kit 表面を置き換える **`@growi/chat`（仮）** を新設し、
`@growi/slack` は Gen 1 互換のためのレガシーとして凍結する。

---

## 4. 未決の意思決定

各フォークについて、**それを決める制約**を併記する。

### 決定 A: state adapter とデータストア → **PostgreSQL に決定**

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

### 決定 B: Teams をどのティアで扱うか

Azure Bot 登録が運用者ごとに必要。「オフィシャルアプリでない」という Gen 1 の課題が Teams では更に重くなる。

- B-1: 第一級サポート（ドキュメント・セットアップ UI まで用意）
- B-2: 「上級者向け」として対応はするが導線は用意しない
- B-3: Gen 2 初版のスコープ外

**決める制約**: Teams を求めているのがどの顧客セグメントか。エンタープライズ需要が主なら B-1 のコストは正当化される。

### 決定 C: 串刺し検索 —— 分岐は「やるか」ではなく「配送レベルか統合レベルか」

**前提の訂正: 串刺し検索は LLM 抜きで Gen 1 に既にある。**

- `packages/slack/src/consts/index.ts`: `defaultSupportedCommandsNameForBroadcastUse = ['search']`
  — search は**唯一の broadcast-use コマンド**として定義されている
- `controllers/slack.ts`: 1 つの workspace に紐づく全 `Relation` に対して
  `/_api/v3/slack-integration/proxied/commands` を `Promise.allSettled` で並列 POST
- 各 GROWI が自分の Elasticsearch で検索し、**自分の ACL を自分で適用して**、
  それぞれ独立に `response_url` へ返す

したがって真の分岐は、**串刺しをどのレベルでやるか**である。

| | C-1 配送レベル（fan-out） | C-2 統合レベル（merge / rank / summarize） |
|---|---|---|
| 実体 | **Gen 1 に既にある**。N 台へ配って N 個の結果ブロックが返る | 1 つの統合された回答・ランキングを返す |
| LLM | **不要** | 事実上必須（後述） |
| ACL | 各 GROWI がローカルに適用。統合層は中身を見ない | **統合層が N 台分の ACL 統合責任を負う** |
| 資格情報 | トークンペアのみ（現状どおり） | ページ本文を読むための API 資格情報が N 台分要る |
| 部分障害 | `Promise.allSettled` + `respondRejectedErrors` で**落ちた GROWI が可視化される** | **静かに劣化する**（LLM は欠落を埋めて回答してしまう） |
| UX | GROWI が増えるほどブロックが並びノイズ化。関連度が横断比較できない。レイテンシは最も遅い GROWI に律速 | 一覧性は良い |

**LLM が要るのは「串刺しだから」ではなく「統合するから」**である。異なる GROWI の
Elasticsearch スコアはコーパスサイズもインデックス設定も違うため**素朴には比較できない**。
横断ランキングを作るには結果を横並びで読む主体が要り、さらに要約まで踏み込むなら本文取得が要る。
逆に言えば、C-1 の範囲なら LLM は最後まで不要。

C-2 を選んだ場合でも、**統合層をプロキシに置くとは限らない**:

- **C-2a: aggregator GROWI が担う** — 1 台の GROWI が兄弟 GROWI への scoped access token
  （`access-token-parser` で実装済みの `X-GROWI-ACCESS-TOKEN`）を持ち、既存の `features/mastra`
  （プロバイダ抽象・管理画面の API キー・`full-text-search-tool`・`get-page-content-tool`）で統合する。
  **プロキシは transport のまま**でよい。
- **C-2b: プロキシが担う** — プロキシが N 台分の API 資格情報とテナントごとのモデルキーを保持し、
  自らエージェントを動かす。今はトークンペアしか持たないコンポーネントに、
  **巨大な信頼・課金の面**が生える。

**決める制約**: 「LLM を使うか」ではなく **「N 台分の ACL 統合責任を誰が負うか」**。
プロキシに負わせたくないなら C-1 か C-2a。C-2b を選ぶ理由は
「どの GROWI も他を知らないフラットな構成を保ちたい」場合に限られる。

### 決定 D: GROWI API を叩いてページを作成する機能

**注意: これも Gen 1 に既にある。** `slack-command-handler/create-page-service.js` と `note` コマンドが該当する。
したがって真の問いは「新機能として作るか」ではなく **「固定コマンドのままか、LLM / MCP 経由の自由入力にするか」**。

認証機構はもう揃っている: `access-token-parser` spec（実装完了済み）により、
GROWI は**スコープ付きアクセストークン**を `X-GROWI-ACCESS-TOKEN` ヘッダで受け付ける。
プロキシがページ作成を代行するなら、この scoped token が使うべき正規の仕組みであり、
「読み取りのみ」「特定スコープのみ」の絞り込みもトークン側で表現できる。

- D-1: Gen 1 相当の固定コマンドを中立表現で作り直すだけ（LLM 不要）
- D-2: MCP サーバを GROWI 側に立て、LLM は GROWI 内のエージェントが動かす（= C-1 / C-2a と整合）
- D-3: プロキシが MCP クライアント兼エージェントホストになる（= C-2b と整合）

**決める制約**: 決定 C と同じ軸（書き込み権限を誰が握るか）。C を決めれば D も従属して決まる。

### 決定 E: 「オフィシャルアプリでない」問題を Gen 2 で解くか

Gen 1 の課題として挙がっているが、これは**アーキテクチャではなく組織・審査の問題**（Slack App Directory 申請、
Discord の verified bot、Teams の AppSource 申請）。プラットフォームごとに審査要件も期間も違う。

**決める制約**: Gen 2 の技術スコープに含めず、別トラックとして扱うのが妥当か。含めるならプラットフォームごとに個別判断が要る。

### 決定 F: proxy ↔ GROWI の信頼確立方式（Gen 1 の独自トークン相互登録の置き換え）

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

| 層 | Gen 1 | Gen 2 候補（Web 標準） |
|---|---|---|
| **① ペアリング（初期信頼の確立）** | `/growi register` → `Order`（10 分で失効）→ 相互登録 | 形は既に正しい。**短命な enrollment code + エンドポイント所有証明**として形式化する |
| **② トランスポート認証（リクエストごと）** | 静的 bearer をカスタムヘッダに | **RFC 9421 HTTP Message Signatures** + **RFC 9530 Content-Digest** |
| **③ ユーザ委譲（誰の代理として書くか）** | 無し（各 GROWI が Slack ユーザをローカルに解決） | 必要になったら **RFC 8693 Token Exchange** / `act` クレーム |

#### ② が本命 — RFC 9421 HTTP Message Signatures

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

#### 鍵配布 — self-host の現実に合わせる

JWKS には by-reference（`jwks_uri` を相手が取得しに行く）と by-value（ペアリング時に公開鍵そのものを登録）がある。
**GROWI は firewall 内に置かれ inbound 到達性が無いことが多い**（Socket Mode を検討する理由と同じ制約）ため、
**by-value をデフォルト**とし、公開到達可能な構成向けに by-reference + ローテーション用ポーリングを opt-in とする。

> 要検証: 実際の self-host 利用者のうち GROWI を inbound 公開している割合。
> 公開が普通なら by-reference を既定にした方が単純になる。

#### ① ペアリング — Gen 1 の良い部分は残す

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
| **MCP の認可モデル**（OAuth 2.1 + [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html) + DCR + RFC 8707） | これは **ユーザ委譲アクセス**の標準であり、層③の話。**層②と混ぜてはいけない。** 決定 D-2 / D-3 を採る場合に、トランスポート信頼の *上の層* として適用される |

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

層②（RFC 9421 + Ed25519）は決定 A〜E のどれにも依存しないので、**単独で設計を確定できる**。
残る変数は鍵配布方式（by-value / by-reference）で、これは [決定 G](#決定-g-トランスポート-トポロジ) が決まれば従属して決まる。
層③（ユーザ委譲）は決定 C / D に従属する — C-1 / C-2a を選ぶなら当面不要。

### 決定 G: トランスポート トポロジ

**スクラッチだからこそ再考できる項目。** Gen 1 で暗黙の前提になっていて、今まで動かせなかったもの。

Gen 1 は **proxy → GROWI への inbound HTTP POST** で成立している
（`axios.post(new URL('/_api/v3/slack-integration/proxied/commands', relation.growiUri))`、
`urlVerificationRequestToGrowi()` も同様）。つまり **すべての GROWI がプロキシから到達可能でなければならない**。

これは導入障壁として無視できない。社内イントラにしか露出していない GROWI は、
従業員のブラウザからは見えてもクラウド上のプロキシからは見えない。
Chat SDK の Socket Mode を「ファイアウォール内向けの選択肢」として評価したのと**まったく同じ制約**が、
proxy ↔ GROWI 間にも存在している。

| | G-1 inbound（Gen 1 と同じ） | G-2 outbound 常時接続 | G-3 ハイブリッド |
|---|---|---|---|
| 方向 | proxy が各 GROWI へ POST | **GROWI がプロキシへダイヤルし、接続を保持** | 到達可能なら G-1、不可なら G-2 |
| GROWI の inbound 公開 | **必須** | **不要** | 任意 |
| プロキシの水平スケール | ステートレスで容易 | 接続を保持するインスタンスへの**スティッキールーティングが必要** | 両方の複雑さ |
| 障害時 | リクエスト単位で失敗が可視 | 再接続・バッファリングの設計が要る | 両方 |
| 実装量 | 最小 | 大きい | 最大 |

**決定 F との相互作用が大きい**: G-2 を採ると鍵配布の by-value / by-reference という論点が**消える**。
接続確立時のハンドシェイクで相互認証すれば、以後そのチャネルは認証済みとして扱えるため、
リクエストごとの RFC 9421 署名も原理的には不要になる（監査や多段プロキシ対策として残す選択はあり得る）。
逆に G-1 なら、決定 F に書いたとおり **by-value をデフォルト**にする必要がある。

#### 推奨: G-2（GROWI からの outbound 常時接続）

「現利用者に聞く」のは**この判断の材料にならない**。Gen 1 を使えている時点で全員 inbound 公開済みであり、
到達性が無くて採用を諦めた層は最初から母集団に入らない（生存者バイアス）。
したがってこれは調査で決まる問題ではなく、**「イントラ専用 GROWI をサポート対象に含めるか」という製品判断**である。

含めるなら G-2 を推す。理由は、スクラッチ設計では **G-2 のコストの大半が既に前払い済み**だから:

- Chat SDK は **state adapter（分散ロック付き共有ストア）を必須**とする。
  「どのプロキシインスタンスがどの GROWI 接続を保持しているか」のルーティング表は**そこに置ける**。
  スティッキールーティングという G-2 最大のコストは、Gen 2 がどのみち導入する基盤の上に乗る。
- プロキシは Discord Gateway / Slack Socket Mode のために**どのみち常駐して永続接続を保持する**。
  GROWI との接続を増やすことは、新しいアーキテクチャ類型の追加ではない。
- 決定 F の鍵配布（by-value / by-reference）という論点が消える。
- プロキシが各 GROWI の URL 到達性・TLS 証明書・NAT・動的 IP を気にしなくてよくなる。

残るコストは正味 **GROWI 側の再接続／バックオフ実装**と、**ストリーム上の request/response 相関（フレーミング）**、
そして**プレーン HTTP に比べたデバッグのしにくさ**。いずれも有界で、G-2 が解く導入障壁に見合うと判断する。

G-3（ハイブリッド）は両方の複雑さを抱え込むので採らない。

### 決定 H: Gen 1 との併存戦略

後方互換を取らないと決めた以上、Gen 1 と Gen 2 は**しばらく併存する**。既存利用者は Gen 1 proxy を使い続けるからである。
なお `RegisterService` に `OFFICIAL_MODE` 環境変数があるとおり、**公式ホスト版プロキシ**の運用も絡む
（公式版を切り替えるタイミングは全利用者に一斉に影響する）。

- **H-1: GROWI 本体が両プロトコルを同時サポート** — 既存の `/_api/v3/slack-integration/proxied/*` を残したまま
  Gen 2 用のエンドポイント群を追加する。利用者は任意のタイミングで乗り換えられる。
  GROWI 側に 2 系統のコードが残る期間が長引くリスク。
- **H-2: Gen 2 は別プロダクト扱い** — GROWI の特定メジャーバージョンで Gen 1 サポートを打ち切る。
  移行期限を切れるので負債が残らない。利用者に一括移行を強いる。
- **H-3: feature flag で排他** — GROWI インスタンスごとにどちらかを有効化し、同時有効化は禁止。
  H-1 より状態が単純で、H-2 より移行が緩やか。

**決める制約**: 公式ホスト版プロキシの利用者数と、Gen 1 サポート打ち切りを宣言できるメジャーバージョンの見通し。
どちらも社内で既に把握している情報なので、調査ではなく**方針決定**の問題。

---

## 5. 次のアクション

1. **決定 G を製品判断として決める** — イントラ専用 GROWI をサポート対象に含めるか。
   含めるなら G-2（推奨）。ここが決まると決定 F の鍵配布も従属して決まる。
2. **決定 C を決める** — 串刺しを配送レベルに留めるか、統合レベルへ進めるか。進めるなら統合層をどこに置くか。
   D はこれに従属する。B・H は独立に決められる。
3. **決定 F の層②（RFC 9421 + Ed25519）は他に依存しないので、設計を先に確定してよい。**
4. C・G が決まったら `/kiro-spec-init` で Gen 2 の spec を起こす。本ブリーフはその入力になる。
5. 並行して、リスクの実測を取る:
   - `chat-adapter-mattermost` を実際に GROWI からの通知経路で動かし、fork 保守の現実味を測る
   - `@chat-adapter/state-pg` 単体で足りるか、`state-redis` 併用が要るかを水平スケール前提で測る
6. `@growi/chat`（中立メッセージ契約）のインタフェース草案を書く。**Gen 2 の工数の重心はここ。**

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
