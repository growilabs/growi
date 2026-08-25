# slackbot-proxy Generation 2 — Discovery Brief

`apps/slackbot-proxy` を「Slack 専用プロキシ」から「複数チャットプラットフォームのハブ」へ作り直すための構想メモ。
**このドキュメントは discovery 段階であり、要件・設計として承認されたものではない。** 未決の意思決定は
[未決の意思決定](#未決の意思決定) にフォーク形式で列挙してある。

調査日: 2026-08-25

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
   → [決定 A](#決定-a-state-adapter-とデータストア) 参照。

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

### 決定 A: state adapter とデータストア

Chat SDK は state adapter 必須。公式に MySQL は無い。現行は MySQL + TypeORM 0.2.45。

| 選択肢 | 内容 | トレードオフ |
|---|---|---|
| A-1 | Redis または PostgreSQL を新たな必須インフラにする | self-host 運用者に**新規ミドルウェア追加を強制**する（デプロイのリグレッション）。ただし公式サポートに乗れる |
| A-2 | MySQL state adapter を GROWI が実装する | 追加インフラ不要。実装・保守コストを GROWI が負う。インタフェースは公開されている |
| A-3 | Gen 2 でデータストアを移行し TypeORM 0.2.45 からも脱出する | 破壊的だが、TypeORM 0.2.45 は既に「アップグレードに大幅な変更が要る」と `package.json` にコメントされた塩漬け状態 |

**決める制約**: Gen 2 を「Gen 1 からのインプレース移行」と位置づけるか「別プロダクトとして並走・段階移行」と位置づけるか。
後者なら A-3 の破壊的変更を許容できる。

### 決定 B: Teams をどのティアで扱うか

Azure Bot 登録が運用者ごとに必要。「オフィシャルアプリでない」という Gen 1 の課題が Teams では更に重くなる。

- B-1: 第一級サポート（ドキュメント・セットアップ UI まで用意）
- B-2: 「上級者向け」として対応はするが導線は用意しない
- B-3: Gen 2 初版のスコープ外

**決める制約**: Teams を求めているのがどの顧客セグメントか。エンタープライズ需要が主なら B-1 のコストは正当化される。

### 決定 C: 複数 GROWI に対する串刺し検索 —— これが LLM 配置を決める

**この機能だけが、プロキシを「エージェントホスト」に変質させることを強制する。** 迷いの正体はここにある。

- C-1（スコープ外）: **プロキシは transport のまま**。LLM は GROWI 側に残る。
  既存資産（`features/mastra`: プロバイダ抽象、管理画面で設定する API キー、`growi-agent.ts`、
  `full-text-search-tool`、`get-page-content-tool`）をそのまま再利用でき、プロキシは何も新しい信頼境界を持たない。
- C-2（スコープ内）: プロキシが **N 台の GROWI の API 資格情報とテナントごとのモデルキーを保持**し、
  自らエージェントを動かす。現在トークンペアしか持たないコンポーネントに、**巨大な信頼・課金の面**が生える。

**決める制約**: 串刺し検索を出すか否か。出すなら C-2、出さないなら C-1。**A/B/C は別問題ではなく、C が LLM 配置を一意に決める。**

### 決定 D: GROWI API を叩いてページを作成する機能

**注意: これは Gen 1 に既にある。** `slack-command-handler/create-page-service.js` と `note` コマンドが該当する。
したがって真の問いは「新機能として作るか」ではなく **「固定コマンドのままか、LLM / MCP 経由の自由入力にするか」**。

認証機構はもう揃っている: `access-token-parser` spec（実装完了済み）により、
GROWI は**スコープ付きアクセストークン**を `X-GROWI-ACCESS-TOKEN` ヘッダで受け付ける。
プロキシがページ作成を代行するなら、この scoped token が使うべき正規の仕組みであり、
「読み取りのみ」「特定スコープのみ」の絞り込みもトークン側で表現できる。

- D-1: Gen 1 相当の固定コマンドを中立表現で作り直すだけ（LLM 不要）
- D-2: MCP サーバとして GROWI 側に立て、LLM は GROWI 内のエージェントが動かす（= 決定 C-1 と整合）
- D-3: プロキシが MCP クライアント兼エージェントホストになる（= 決定 C-2 と整合）

**決める制約**: 決定 C と同じ。C を決めれば D も従属して決まる。

### 決定 E: 「オフィシャルアプリでない」問題を Gen 2 で解くか

Gen 1 の課題として挙がっているが、これは**アーキテクチャではなく組織・審査の問題**（Slack App Directory 申請、
Discord の verified bot、Teams の AppSource 申請）。プラットフォームごとに審査要件も期間も違う。

**決める制約**: Gen 2 の技術スコープに含めず、別トラックとして扱うのが妥当か。含めるならプラットフォームごとに個別判断が要る。

---

## 5. 次のアクション

1. **決定 C を先に決める**（串刺し検索を Gen 2 に入れるか）。A・B・D はこれに従属するか、独立して後で決められる。
2. C が決まったら `/kiro-spec-init` で Gen 2 の spec を起こす。本ブリーフはその入力になる。
3. 並行して、リスクの実測を取る:
   - `chat-adapter-mattermost` を実際に GROWI からの通知経路で動かし、fork 保守の現実味を測る
   - MySQL state adapter のプロトタイプを書いて 決定 A-2 の工数を測る
4. `@growi/chat`（中立メッセージ契約）のインタフェース草案を書く。**Gen 2 の工数の重心はここ。**

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
