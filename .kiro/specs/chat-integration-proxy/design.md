# Technical Design — chat-integration-proxy

> umbrella spec: [chat-integration](../chat-integration/)。要件は umbrella の `requirements.md` が持つ。
> 通信契約・署名・チャンネル権限の判定は [chat-integration-protocol](../chat-integration-protocol/) が持つ。
> 設計判断の根拠（決定 1〜10）は umbrella の `research.md`。

## Overview

**Purpose**: Slack・Mattermost・Discord・Microsoft Teams と GROWI をつなぐ中継サーバ。
1 台に**複数のチャット workspace と複数の GROWI** がぶら下がるハブとして動く。

**Impact**: 新規アプリ `apps/chat-integration-proxy`。**Gen 1（`apps/slackbot-proxy`）には手を入れない。**

### Non-Goals

- GROWI の権限判定・検索・ページ作成（`chat-integration-app`）
- 通信契約・署名・チャンネル権限の判定そのもの（`chat-integration-protocol`）
- Cloudflare Workers 向けの 2 つ目のビルド（決定 10 で不採用）

---

## Boundary Commitments

### This Spec Owns

- 4 サービスとのやり取り（Chat SDK 経由）と、**常時接続の生涯**
- 関係管理（1 workspace 対 N GROWI）、ペアリングの proxy 側、鍵の保管（PostgreSQL）
- コマンドの解釈、引数の収集、GROWI の選択、検索の待ち合わせと統合
- proxy 側の PostgreSQL スキーマ
- 閉域向け推奨構成のドキュメント

### Out of Boundary

- Gen 1 の実装 / Chat SDK のアダプタ実装（fork しない）
- 通信契約の型・署名・権限判定の実装（`@growi/chat` から使うだけ）

### Allowed Dependencies

| 依存先 | 使ってよい層 | 制約 |
|---|---|---|
| `chat@=4.38.1`、`@chat-adapter/{slack,discord,teams}@=4.38.1`、`chat-adapter-mattermost@=1.1.3`、`@chat-adapter/state-pg@=4.38.1` | **`src/platform/**` のみ** | 完全固定。他の層からの import を lint で禁止する |
| `@growi/chat` | すべての層 | 契約型・署名・権限判定 |
| `@prisma/client` 6.19.2 | `src/db/` と repository | apps/app と同じ版 |
| `hono@^4.13.5` | `src/routes/` と `src/runtime/` | 依存ゼロ。Web 標準の `Request`/`Response` を扱う |

**依存の向き**（左のものだけを import してよい）:

```
types → capabilities → db → platform → command → relation → growi → orchestration → routes
```

- `runtime/` は最も外側。上のどこからも import されない
- **repository が返す型は `types/` に置く。** `Relation` と `Invocation` を `relation/` と `command/` に置くと、
  `db`（3 番目）がそれより右の層を import することになる
- **`orchestration/` は relation と growi の右**。イベントを受けて各層を順に呼ぶ層で、
  アーキテクチャ図にある「束ねる処理」の実体
- **`relation/` は `growi/` を import しない。** `PairingService` が所有確認に必要とするのは
  「申告された URL へ確認値を送る関数」だけなので、**それを引数で受け取る**
  （`.claude/rules/coding-style.md`「executor は work-set を引数で受け取る」）

### Revalidation Triggers

- `@growi/chat` の契約が変わったとき
- 対応するチャットサービスが増減したとき（能力表と要件 1.2 / 5.6 / 6.5 の対象が変わる）
- Chat SDK を更新したとき — **能力表を必ず突き合わせる**（docs が `protected` 拡張面を「まだ安定と見なしていない」と明記）
- 能力表の「要確認」の行を実物で確かめたとき（`linkPreview` / `plainReply`）

---

## Architecture

### プラットフォーム能力表（設計の中核データ）

**唯一の宣言箇所。** 各所で `if (platform === 'mattermost')` と書かない。

| 能力 | Slack | Discord | Teams | Mattermost | 無いときの代わり |
|---|:--:|:--:|:--:|:--:|---|
| `ephemeralMessage`（その場限りのメッセージ） | ○ | ○ | ○ | ○ | — （聞き返しと要件 11.3 の提示が寄りかかる） |
| `slashCommand` | ○ | ○ | × | × | mention で起動する（決定 4） |
| `mention` | ○ | ○ | ○ | ○ | — |
| `modal` | ○ | × | ○ | × | コマンド行の引数 + 聞き返し（決定 5） |
| `interactiveActions` | ○ | ○ | ○ | × | 番号つきの一覧を出して返信で選ばせる |
| `card` | ○ | ○ | ○ | △ | markdown で投稿する |
| `linkPreview` | ○ | × | × | × | 要件 6.5 に従い「使えない」と示す（Slack の `link_shared` に相当するものが他に無い） |
| `fetchMessages` | ○ | ○ | ○ | ○ | — |
| `plainReply` | 要確認 | 要確認 | 要確認 | 要確認 | **呼びかけ付きの返信にする**（下記） |

**接続をどの単位で張るか**は能力ではなく別の軸なので、表とは別に持つ。

**制約（能力ではない）**: `requiresInboundReachability`（外部からの接続を受ける必要があるか）は
**Teams だけ ○**、他の 3 つは ×。`supports()` の意味が反転する（true なら「使える」ではなく「穴が要る」）ので
能力表とは分けて持つ。要件 13.3 の接続元制限の対象。

| | 接続の単位 | ロックの鍵 | 根拠（実測 2026-08-27） |
|---|---|---|---|
| Slack | **アプリごと 1 本** | `app:slack` | `appToken`（`xapp-`）は app-level。README: 「Socket mode works with both single-workspace tokens and **multi-workspace OAuth**: events arriving over the socket resolve **per-installation tokens by `team_id`**」 |
| Discord | **アプリごと 1 本** | `app:discord` | Gateway は bot token 1 本 |
| Teams | 接続しない（外部から受ける） | — | Bot Framework が proxy へ POST してくる |
| Mattermost | **installation ごと** | `installation:{id}` | 接続先 `baseUrl` が installation ごとに違う |

> **Slack と Discord は「1 本の接続に全 workspace のイベントが届く」形である。**
> したがって installation の数だけ接続を開くことはなく、「同じ発言を workspace の数だけ処理する」も起きない。
> **ロックの鍵は接続の単位に合わせる** — アプリごとなら 1 台だけが 1 本を持ち、
> installation ごとなら installation の数だけ持ち分が分かれる。
> `ConnectionManager` はこの表を読んで動き、`if (platform === 'discord')` と書かない。

`CapabilityLevel` は `full` / `degraded` / `none` / `unverified` の 4 値。
表の ○ が `full`、△ が `degraded`、× が `none`、要確認が `unverified`。
`supports()` が `true` を返すのは **`full` のときだけ**。
- `degraded`（Mattermost の `card`）— `false`。呼ぶ側は代わりの手段（markdown で投稿）を選ぶ。
  `levelOf()` で `degraded` を見分けられるので、「使えるが劣る」ことを利用者に示したい場所だけがそれを使う
- `unverified` — `false`。**確かめるまでその能力に寄りかからない**

> **`plainReply` に依存しない。** 番号つき一覧への答えは「`@growi 1`」と**呼びかけ付き**で返信させる。
> 必要な能力が全サービス ○ の `mention` だけになり、確かめるまで確定できない値への依存が消える。
> 利用者の手間は 1 語増える。確認できたサービスでは呼びかけ無しも受け付けてよい。

### 常時接続の生涯（要件 1.1 / 1.4 / 13.2）

**この proxy は webhook を待つだけのサーバではない。** Slack は Socket Mode、Discord は Gateway、
Mattermost は WebSocket で、**proxy 側から接続しに行く**（決定 7・10。閉域構成で外部から穴を開けずに済む理由がこれ）。
外部から接続を受けるのは **Teams だけ**。

したがって**接続を開く・閉じる・張り直す操作が要る**。webhook のハンドラだけでは成立しない。

```typescript
export interface ConnectionManager {
  start(): Promise<void>;
  stopAll(): Promise<void>;
  /**
   * **あるべき接続と今ある接続の差を埋める。** 一定間隔（既定 20 秒）で呼ぶ。
   * 起動時に 1 回ではなく**回し続ける**ことが要点（下記）。
   */
  reconcile(): Promise<void>;
  /**
   * 現在の接続状態。運用者が確認できる形で出す（要件 1.4 / 13.2）。
   * **接続 1 件の状態と、その接続が受け持つ installation の一覧を分けて返す** —
   * Slack と Discord は 1 本が多数の installation を受け持つので、
   * installation ごとの状態として返すと 100 件に同じ値が並ぶだけになる。
   */
  status(): Promise<ReadonlyArray<{
    readonly lockKey: string;                 // 'app:slack' | 'installation:{id}'
    readonly platform: PlatformName;
    readonly state: 'connected' | 'reconnecting' | 'failed' | 'held-by-other';
    readonly since: Date;
    readonly servedInstallationIds: ReadonlyArray<string>;
  }>>;
}
```

**切れたときは指数的に間隔を空けて張り直す。** 上限を超えたら `failed` として記録し、運用者に見える形で残す。
**1 つの接続の失敗を他へ波及させない**（要件 1.4）。

#### 起動時に 1 回では成立しない

接続の管理を「起動時に数え上げてつなぐ」形にすると、次の 2 つが壊れる。

1. **取れなかったものを取りに行かない。** 2 台目の起動時に 1 台目が持っている installation は取れず、
   その後 1 台目が落ちてロックが切れても、2 台目は取りに行かない。
   **その workspace は誰もつながないまま黙り続ける。** 気づけるのは利用者が「反応しない」と言い出したとき
2. **ロックが自分の目的を壊す。** 寿命 60 秒の印を生きている持ち主が延ばさないなら、
   **正常に動いている 1 台目のロックが 60 秒で切れ、2 台目が引き取って二重に処理する。**
   これはロックが防ごうとしていたことそのもの

したがって `reconcile()` を一定間隔で回し、**毎回** (a) 取れていない**接続の単位**のロックを取りに行き、
(b) 自分が持っているロックを延ばし、(c) 延長に失敗したら**自分の接続を閉じる**、
(d) **受け持ちが 0 件になったときだけ**閉じる、を行う。
**アプリごとの接続（Slack / Discord）は受け持ちが 0 件でも保つ** — OAuth の折り返しの直後にすぐつながるため。
 installation が 1 件消えても、アプリごとの接続は閉じてはいけない。

さらに 3 つ決めておく。

- **前の周回が終わる前に次を始めない。** installation が多いと 1 周が間隔を超えることがあり、
  重なって走ると同じ相手に 2 本つなぐ
- **ロックの寿命は回す間隔の 3 倍以上**（既定: 間隔 20 秒・寿命 60 秒）。
  この関係を書いておかないと、後から間隔だけを伸ばした運用者が二重処理を踏む
- **(c) で閉じ終わるまでの短い間、2 台が同じ相手につながることは避けられない。**
  延長に失敗した時点でロックは既に他の台に渡っており、閉じる操作は一瞬では終わらない。
  **この間の重複は Chat SDK の state による重複の取り除き（`event_id` 単位）が受け止める** —
  チャットサービスの再送を取り除く仕組みと同じものが、ここでも働く

#### 接続を張り直す引き金

**GROWI の紐付け（relation）の増減では接続を触らない。** ペアリング（要件 9）は
**すでにある installation に GROWI を 1 つ足す**操作で、要件 9.7 の解除は relation を 1 件消す操作である。
これを引き金にすると、**3 台紐づく workspace で 1 台だけ解除したときに残り 2 台の接続まで切れる。**
`reconcile()` が `installation` の一覧を見て差を埋めるので、引き金は「installation が増えた・消えた」だけでよい。

> **常駐コストは installation の数に比例する**（GROWI の台数には比例しない）。
> 「アイドル時のコストがゼロ」は常時接続を持つ以上あてはまらない。

#### Slack と Discord は受信が 1 台に集まる（規模の評価に必要）

`app:slack` のロックは 1 台しか持てないので、**その 1 台が全 workspace のイベントを受ける。** 帰結が 2 つある。

- **台数を増やしても受信は分散しない。** 投稿と GROWI への送信は分散するが、受信は分散しない
- **持ち主が落ちると、他の台が引き取るまで（既定 60 秒）そのサービス全体がまとめて黙る。**
  installation ごとに持ち分が分かれる Mattermost なら黙るのは一部だが、Slack と Discord は全体である。
  **ロックの寿命 60 秒は、そのまま「Slack が黙る最大時間」になる**

初版はこの形とする。受けた台が他の台へ配る仕組みは作らない（要件 8.1 の規模で足りるかは、
上の 2 点を前提に運用で測る）。

### 引数の収集 — 待つ関数として作らない

modal の送信も、番号つき一覧への返信も、**最初のリクエストとは別のイベントとして後から届く**。
proxy を複数台にすると別の台に届く。だから**途中経過を `pending_collection` に保存し、次のイベントで再開する**。

#### modal を開ける条件（能力表だけでは足りない）

modal を開くには、そのサービスが modal に対応しているかとは**別に、短命の手がかり**が要る
（Slack の `trigger_id`。スラッシュコマンドやボタン操作の応答としてだけ渡され、**mention の通知には付いてこない**）。

**したがって modal を選ぶ条件は「能力表が対応と言っている**かつ**有効な手がかりがある」。**

mention から始まったときの段取り:

1. `interactiveActions` が使えるなら、**ボタンを 1 つ出す**（「入力する」）
2. その押下で手がかりが得られるので、それで modal を開く
3. `interactiveActions` が使えない（Mattermost）か、手がかりが切れているなら、**聞き返しの経路へ落とす**

**要件 8.3 の経路（紐づく GROWI が 1 つなので選択させない）に注意。** 選択のボタンを出さないため、
mention から直接 modal を開こうとして手がかりが無い。この場合も上の 1 を通す。

#### イベントの振り分け

**`EventSink` が受け取る 6 種類すべての行き先を決める。** 書かないと、受け入れ条件を書けない部品が残る。

| `PlatformEvent.kind` | 行き先 |
|---|---|
| `mention` | 下の順序で振り分ける |
| `slash-command` | `CommandInvocation.normalize` へ直接（コマンド名が確定しているため） |
| `modal-submit` | `ArgumentCollector.resume`（`correlationId` で途中経過を引く） |
| `action` | 同上。GROWI の選択ボタン（要件 8.2）と一覧の選択がここに来る |
| `reply` | **受け取らない。** `plainReply` に依存しないと決めた（上記）ので、呼びかけ無しの返信は扱わない。`PlatformEvent` の型からも外す |
| `link-posted` | `link-preview` として扱う（要件 6.1）。**コマンドの解釈を通さない** |

`mention` の振り分け順序:

1. まず `CommandInvocation.normalize` を試す
2. コマンド名として解釈できなければ `ArgumentCollector.resume` に渡す
3. `resume` が `not-mine` を返したら通常のメッセージとして扱う（何もしない）

**新しいコマンドが優先される。** 途中経過がある状態でコマンド名を打てば、古い途中経過は破棄される。

---

## File Structure Plan

```
apps/chat-integration-proxy/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── types/
│   │   ├── index.ts               # InteractionRef / TimeRange / ModalForm / FieldSpec
│   │   ├── relation.ts            # Relation（db が返す型。上の層順の理由でここに置く）
│   │   ├── invocation.ts          # Invocation（同上）
│   │   ├── outbound-message.ts    # OutboundMessage / HistoryMessage / HistoryOutcome（SDK 型を含まない）
│   │   ├── distributed-lock.ts    # DistributedLock（SDK 型を含まない）
│   │   └── platform-event.ts      # PlatformEvent / PlatformAppConfig / InstallationCredentials
│   ├── capabilities/
│   │   ├── index.ts
│   │   ├── platform-capabilities.ts   # 能力表。唯一の宣言箇所
│   │   └── admin-check.ts             # 管理者かどうかの調べ方（4 サービス分のデータ）
│   ├── db/
│   │   ├── index.ts                       # この層の公開窓口
│   │   ├── prisma-client.ts
│   │   └── repositories/
│   │       ├── index.ts                   # リポジトリの公開窓口
│   │       ├── installation-repository.ts
│   │       ├── installation-channel-repository.ts   # 通知の宛先の検査に使う一覧
│   │       ├── relation-repository.ts
│   │       ├── peer-key-repository.ts     # 相手（GROWI）の公開鍵
│   │       ├── own-key-repository.ts      # **proxy 自身の鍵。秘密鍵は暗号化して保存**
│   │       ├── channel-permission-repository.ts
│   │       ├── pairing-order-repository.ts
│   │       ├── pending-collection-repository.ts
│   │       ├── processed-notification-repository.ts # 宛先ごとの通知の記録
│   │       └── request-nonce-repository.ts
│   ├── platform/                  # Chat SDK に触れてよい唯一の層
│   │   ├── index.ts
│   │   ├── bot-factory.ts
│   │   ├── adapter-set.ts         # 接続情報を受け取ってアダプタと state を組み立てる
│   │   ├── connection-manager.ts  # 常時接続の生涯
│   │   ├── installation-provider.ts
│   │   ├── installation-store.ts  # installation を作る・消す
│   │   ├── event-mapping.ts       # SDK のイベント → PlatformEvent（SDK 型はここで止まる）
│   │   ├── outbound.ts
│   │   ├── prompt.ts              # modal の開閉
│   │   ├── history.ts
│   │   └── channels.ts            # listChannels（周期で取り直して保存）
│   ├── command/
│   │   ├── invocation.ts          # mention / slash を 1 つの内部表現へ
│   │   ├── argument-collector.ts  # start / resume / sweepExpired
│   │   ├── pending-collection.ts
│   │   ├── command-set.ts         # 利用者向けコマンドの宣言（下記の表がそのまま中身）
│   │   ├── index.ts               # この層の公開窓口
│   │   └── admin-command-set.ts   # 運用者向け（register / unregister / weight / rotate-key）
│   ├── relation/
│   │   ├── index.ts               # この層の公開窓口
│   │   ├── pairing-service.ts     # 確認値を送る関数を引数で受け取る
│   │   ├── relation-key-service.ts # proxy 自身の鍵を作る・保管する・配る
│   │   ├── growi-uri-resolver.ts  # 名前を引き、確かめたアドレスへつなぐ（リダイレクトを追わない）
│   │   ├── growi-selection.ts
│   │   └── unpair-service.ts
│   ├── growi/
│   │   ├── index.ts               # この層の公開窓口
│   │   ├── growi-client.ts        # 署名つき送信
│   │   ├── fan-out-collector.ts   # 複数 GROWI への配信と待ち合わせ（検索とヘルプで共用）
│   │   └── search-fusion.ts
│   ├── orchestration/             # ★ イベントを受けて各層を順に呼ぶ
│   │   ├── index.ts
│   │   ├── event-sink.ts          # PlatformEventSink の実装
│   │   ├── command-flow.ts        # 権限 → GROWI 選択 → 引数収集 → 送信 → 投稿
│   │   └── inbound-flow.ts        # GROWI からの通知・設定・鍵
│   ├── routes/                    # Hono
│   │   ├── install-routes.ts      # OAuth の折り返し（Slack / Discord）。**installation を作る唯一の HTTP 経路**
│   │   ├── webhook-routes.ts      # Teams の受け口ほか
│   │   ├── growi-routes.ts        # 通知・設定・能力・鍵・ペアリング
│   │   └── health-routes.ts
│   └── runtime/
│       ├── server.ts              # プロセス起動、ConnectionManager.start()、シグナル処理
│       ├── config.ts              # process.env を読んでよい唯一のファイル
│       ├── mattermost-installations.ts  # 設定から Mattermost の接続先を読み、起動時に InstallationStore.save する
│       └── sweeper.ts             # 期限切れの掃除。**`DistributedLock` を引数で受け取る**（facade 全体は受け取らない）
├── docs/
│   └── closed-network-deployment.md
├── turbo.json                     # build / dev / lint / test。@growi/chat#build に依存
└── package.json
```

---

## Components and Interfaces

| Component | File | Intent | Req Coverage |
|---|---|---|---|
| `PlatformCapabilities` | `capabilities/platform-capabilities.ts` | 能力差を 1 か所のデータで持つ | 1.2, 5.1, 5.6, 6.5, 13.2 |
| `PlatformFacade` | `platform/index.ts` ほか | Chat SDK に触れる唯一の層 | 1.1, 1.4, 2.4, 5.4, 6.1 |
| `ConnectionManager` | `platform/connection-manager.ts` | 常時接続の生涯 | 1.1, 1.4, 13.2 |
| `ChannelDirectory` | `platform/channels.ts` | installation のチャンネル一覧を周期で取り直して保存 | 2.2, 2.4, 11.1 |
| `InstallationProvider` | `platform/installation-provider.ts` | workspace ごとの資格情報を解決 | 1.1, 8.1 |
| `InstallationStore` | `platform/installation-store.ts` | **installation を作る・消す。** OAuth の折り返しと、Mattermost の設定ファイルから呼ぶ | 1.1, 1.5, 8.1 |
| `CommandInvocation` | `command/invocation.ts` | mention / slash を 1 つの内部表現へ | 1.2, 3.1, 4.1, 14.1 |
| `ArgumentCollector` | `command/argument-collector.ts` | 値を集め、途中経過を保存して再開 | 1.2, 4.1, 5.2, 8.2, 11.5 |
| `CommandSet` | `command/command-set.ts` | **利用者向けコマンドの宣言。** 名前・集める値・対象の決まり方を 1 か所のデータで持つ | 3.1, 4.1, 5.1, 7.3, 14.1 |
| `AdminCommandSet` | `command/admin-command-set.ts` | 運用者の入り口（**文字列の解釈と結果の組み立てだけ**） | 3.8, 9.1, 9.7, 10.5, 13.4 |
| `RelationKeyService` | `relation/relation-key-service.ts` | **proxy 自身の鍵を作り、保管し、GROWI へ配る** | 9.5, 9.6, 10.5, 10.6 |
| `GrowiSelector` | `relation/growi-selection.ts` | どの GROWI に対して実行するか | 6.4, 8.1–8.4, 8.6 |
| `PairingService` | `relation/pairing-service.ts` | ペアリングの proxy 側 | 9.1–9.7 |
| `FanOutCollector` | `growi/fan-out-collector.ts` | 複数 GROWI への配信と待ち合わせ | 3.1, 3.4, 3.5, 14.5 |
| `SearchFusion` | `growi/search-fusion.ts` | 重みつきの式で 1 本に統合 | 3.2, 3.3, 3.8 |
| `GrowiClient` | `growi/growi-client.ts` | 署名つきで GROWI を呼ぶ（`GrowiUriResolver` を通す） | 3.1, 4.2, 5.2, 7.3, 9.2, 10.5, 14.2 |
| `EventSink` | `orchestration/event-sink.ts` | イベントを受けて各層を呼ぶ | 1.1, 1.2, 3.1, 4.1, 6.1, 14.1 |
| `InboundFlow` | `orchestration/inbound-flow.ts` | GROWI からの通知・設定・鍵の追加と失効 | 2.1–2.6, **10.5**, **10.7**, 11.4 |

### CommandSet — 利用者が打てるコマンドの宣言

**この表がそのまま `command/command-set.ts` の中身になる。** ここに無いものは打てない。
`if (name === 'search')` のような分岐を各層に書かず、**この宣言を読んで動く**（`.claude/rules/coding-style.md`）。

| 打つ言葉 | 集める値（`FieldSpec` の並び） | 送るもの | 対象の決まり方 | 権限判定に使う名前 |
|---|---|---|---|---|
| `search <語>` | `keyword`（必須・自由入力） | `CommandRequest`（`search`） | 許可している全 GROWI | `search` |
| `create-page` | `path`（必須）, `title`（任意）, `body`（必須・複数行） | `CommandRequest`（`create-page`） | 1 つに定まる | `create-page` |
| `keep` | `range`（必須・`TimeRange`）, `path`（必須）, `title`（任意） | `CommandRequest`（`keep`） | 1 つに定まる | `keep` |
| `help` | なし | `CommandRequest`（`help`） | 許可している全 GROWI | `help` |
| `link` | なし | **`AccountLinkStartRequest`** | 1 つに定まる | **判定しない**（下記） |
| （URL の投稿） | — | `CommandRequest`（`link-preview`） | URL の一致で決まる | `link-preview` |

**`link` だけ送るものが違う。** 紐付けの開始は `CommandRequest` ではなく `AccountLinkStartRequest` という
別の契約なので、**`COMMAND_NAMES` には足さない**。共有する契約を広げずに済み、
`COMMAND_TRAITS` の分類も `channel_permission` の行も要らなくなる。

**`link` はチャンネル権限の判定に掛けない。** GROWI への書き込みではなく、
利用者が自分の身元を結び付ける操作だからである。**掛けてしまうと、権限の設定がまだ無いチャンネルで
`create-page` が「紐付けが要る」と答え、その紐付けを始める `link` も断られて、利用者が抜け出せなくなる。**

#### 要件 7 の入り口は 2 つある

| 入り口 | 流れ |
|---|---|
| **利用者が自分から**（`link`） | `GrowiClient` が `AccountLinkStartRequest` を送る → `link-issued` なら `linkUrl` を**本人にだけ見えるメッセージ**で出す。`already-linked` / `taken-by-another-user` はそのまま伝える（要件 7.4） |
| **書き込みを断られて**（要件 7.6） | GROWI が `CommandResponse` の `account-link-required`（`growiLabel` と `linkUrl` を持つ）を返す → 同じく**本人にだけ見えるメッセージ**で出す |

**どちらも投稿の経路は 1 本にする**（`orchestration/command-flow.ts`）。
`linkUrl` は一度きりで短時間に失効するので、**チャンネルに平文で出さない。**
複数の GROWI が紐づくチャンネルでは `growiLabel` を必ず添える — 紐付けは GROWI ごとに成立するので、
どれに対する紐付けかが分からないと利用者が取り違える（要件 7.2）。

---

### AdminCommandSet

| Field | Detail |
|---|---|
| Intent | 運用者が proxy 側の設定を触るための、チャットからの管理コマンド |
| Requirements | 3.8, 9.1, 9.7, 10.5, 13.4 |

| コマンド | 要件 | 内容 |
|---|---|---|
| `register` | 9.1 | 一定時間で失効する登録コードを発行する |
| `unregister` | 9.7 | 紐付けを解除する |
| `weight <growi> <値>` | 3.8 | その workspace における GROWI ごとの検索の重みを決める |
| `rotate-key` | 10.5 | proxy 側の鍵の入れ替えを始める。配布の結果と未達の相手を返す（中身は `RelationKeyService`。下記の 4 段） |

**実行できるのは workspace の管理者だけ。** これが無いと、その workspace の誰でも自分の GROWI を紐付けられ、
**要件 9 の目的（第三者が勝手に登録できない）が成立しない**。

**調べ方はサービスごとに違うので、能力表の隣にデータとして持つ**（`capabilities/admin-check.ts`）。
`if (platform === ...)` と書かない。

| | 管理者かどうかの調べ方 |
|---|---|
| Slack | 利用者情報の `is_admin` / `is_owner` |
| Discord | ギルドの権限のビット（`ADMINISTRATOR` または `MANAGE_GUILD`） |
| Mattermost | 利用者のロールに `system_admin` または対象チームの `team_admin` |
| Teams | 所属の役割（`owner`） |

**登録コードは本人にだけ見えるメッセージで返す。** チャンネルに平文で出さない（protocol spec 手順 ①）。

**この部品は文字列の解釈と結果の組み立てだけを持つ。** 4 つの操作の中身はすべて右側の層にある
（`register` / `unregister` は `relation/`、`rotate-key` は `relation/` と `growi/`）ので、
ここから直に呼ぶと**宣言した依存の向き（`command → relation → growi`）を逆走する**。
実際の呼び出しは `orchestration/` が行い、この部品は**呼ぶべき操作と引数を値として返す**。

---

### RelationKeyService — proxy 自身の鍵

| Field | Detail |
|---|---|
| Intent | 関係ごとに proxy 自身の鍵を作り、秘密鍵を暗号化して保管し、公開鍵を GROWI へ配る |
| Requirements | 9.5, 9.6, 10.5, 10.6 |

**この部品が無いとペアリングが完成しない。** ⑥ で返す `PairingResult` は proxy の公開鍵を含むので、
その前に鍵を作っておく必要がある。**`relationId` を採番するのは proxy 自身なので、
関係の行と鍵の行を同じトランザクションで書ける**（GROWI 側にあった「鍵の置き場所が先に要る」という
順序の問題は proxy には起きない）。

**鍵は関係ごとに分ける。** 1 つの関係の秘密鍵が漏れても他の GROWI との関係に波及しない。

```typescript
export interface RelationKeyService {
  /** ペアリングの成立時に呼ぶ。`relation` の行と同じトランザクションで書く */
  issue(relationId: string): Promise<{ readonly keyId: string; readonly publicKeyJwk: JsonWebKey }>;
  /** 署名するときに呼ぶ。**秘密鍵は復号した値ではなく署名する関数として渡す** */
  signerFor(relationId: string): Promise<{ readonly key: KeyRef; readonly privateKey: KeyObject }>;
  /** 入れ替え（下記の 4 段）。相手ごとの結果を返す */
  rotate(relationId: string): Promise<RotationOutcome>;
}

export interface RotationOutcome {
  readonly newKeyId: string;
  readonly delivered: ReadonlyArray<string>;      // 追加を受け付けた relationId
  readonly undelivered: ReadonlyArray<{ relationId: string; reason: string }>;
  readonly revokedOld: boolean;                    // 全員に届いたときだけ真
}
```

**入れ替えは 4 段で、順番を入れ替えてはいけない**（要件 10.5・10.6）。

1. 新しい鍵を作り、`own_key` に**有効な鍵として**書く（この時点で古い鍵も有効なまま）
2. 紐づく GROWI へ `KeyRegistrationRequest` を送る（**署名は古い鍵で行う** — 新しい鍵はまだ相手が知らない）
3. **届かなかった相手を記録して運用者に返す。** ここで止められる形にする
4. **全員に届いたときにだけ**古い鍵を失効させる

**3 を飛ばして 4 をやると、届いていない相手との通信が止まる。** 受ける側にも
「有効な鍵が 0 本になる要求は断る」という条件があるが（下記の口の表）、
それは**相手の側の最後の砦**であって、こちらが順番を守らなくてよい理由にはならない。

**GrowiSelector の判断**（要件 8.2–8.4）
- 対象が 1 つに定まる操作で、許可している GROWI が複数 → **利用者に選ばせる**（8.2）
- 許可している GROWI が 1 つだけ → **選択を求めずそれに対して実行する**（8.3）
- **全 GROWI を対象とする操作（検索・ヘルプ）→ 選択を求めず、許可している全 GROWI へ配る**（8.4）
- どの GROWI も紐づいていない、または許可していない → 実行せず理由を示す（8.6・11.3）

### PlatformFacade

**資格情報を 2 つに分ける軸は、上の「接続の単位」の表と同じである。**

| 置き場所 | 何を持つか |
|---|---|
| `PlatformAppConfig` | **アプリごとに 1 つしかない値。** 常時接続を開くのに使う値はすべてこちら |
| `InstallationCredentials` | **その workspace でしか通用しない値。** 投稿・一覧の取得など、workspace を相手にする呼び出しに使う |

**アプリごとの接続は `PlatformAppConfig` から開き、installation ごとの接続は `InstallationCredentials` から開く。**
この分け方でないと、「受け持ちが 0 件でもアプリごとの接続は保つ」（下記）が成り立たない —
受け持ちが 0 件なら `installation` の行が 1 つも無く、そこからはトークンを取り出せないからである。

```typescript
/** 全 workspace 共通。`runtime/config.ts` が環境変数から読む */
export interface PlatformAppConfig {
  readonly slack?: {
    readonly signingSecret: string; readonly clientId: string; readonly clientSecret: string;
    /** `xapp-` で始まる app-level token。**Socket Mode の接続を開くのに使う** */
    readonly appToken: string;
  };
  readonly discord?: {
    readonly applicationId: string; readonly publicKey: string;
    /** OAuth の折り返しで受け取った code をトークンに交換するのに使う */
    readonly clientSecret: string;
    /** **Gateway の接続を開くのに使う。** Discord の bot トークンはアプリに 1 つで、
     *  参加しているサーバーごとには存在しない */
    readonly botToken: string;
  };
  readonly teams?: { readonly clientId: string; readonly clientSecret: string };
  readonly stateConnectionString: string;
}

/**
 * **workspace ごとの資格情報は `installation` から解決する。**
 * 1 台の proxy が複数の workspace をさばくハブであること（要件 8.1）がこの分離で成り立つ。
 * ここを 1 組に固定すると `installation` テーブルが誰も読まない列になる。
 *
 * **常時接続を開くための値はここに置かない**（上記）。
 */
export interface InstallationCredentials {
  /** Slack は接続はアプリごと、投稿は workspace ごとのトークン（Socket Mode が `team_id` で解決する） */
  readonly slack?: { readonly botToken: string };
  /** Discord は投稿もアプリごとの bot トークンで足りるので、workspace 固有の値は無い */
  readonly discord?: Record<string, never>;
  readonly teams?: { readonly tenantId: string };
  /** Mattermost は接続先そのものが installation ごとに違う */
  readonly mattermost?: { readonly baseUrl: string; readonly botToken: string };
}

export interface InstallationProvider {
  resolve(platform: PlatformName, workspaceId: string): Promise<InstallationCredentials | null>;
  /** `reconcile()` が **その接続が受け持つ installation** を知るために使う。
   *  「あるべき接続の本数」は installation の数では決まらない — アプリごとの接続は
   *  `PlatformAppConfig` にそのサービスの設定があるかどうかで決まる */
  list(platform: PlatformName): Promise<ReadonlyArray<{ installationId: string; workspaceId: string }>>;
}

/**
 * **installation を作る口。これが無いと初版が動かない。**
 * Gen 1 は `GET /oauth_redirect` と `InstallationStore.storeInstallation()` がここを担っていた。
 * サービスによって入り方が違う — Slack と Discord は OAuth の折り返し、
 * **Mattermost は運用者が接続先 URL と bot トークンを入力する**。どちらも受けられる形にする。
 */
export interface InstallationStore {
  save(platform: PlatformName, workspaceId: string, workspaceName: string, credentials: InstallationCredentials): Promise<string>;
  remove(installationId: string): Promise<void>;
}
```

**呼ぶ入り口は 2 つ**（型だけあって呼ぶ場所が無い、という状態にしない）。

| サービス | 入り口 | 置き場所 |
|---|---|---|
| Slack / Discord | **OAuth の折り返し**（`GET /install/{platform}/callback`）。Gen 1 の `GET /oauth_redirect` に相当 | `routes/install-routes.ts` |
| Mattermost | **設定ファイルから読み、起動時に `save` する。** チャットの管理コマンドは使えない — **bot がまだ Mattermost につながっていない段階ではコマンドを打てず、順番が逆になる** | `runtime/mattermost-installations.ts` |

```typescript

/** platform 層が外へ渡すイベント。**Chat SDK の型を含めない** */
export type PlatformEvent =
  | { readonly kind: 'mention';       readonly platform: PlatformName; readonly channel: ChannelRef; readonly actor: ChatAccountRef; readonly text: string; readonly interaction: InteractionRef | null }
  | { readonly kind: 'slash-command'; readonly platform: PlatformName; readonly channel: ChannelRef; readonly actor: ChatAccountRef; readonly command: string; readonly text: string; readonly interaction: InteractionRef }
  | { readonly kind: 'modal-submit';  readonly platform: PlatformName; readonly channel: ChannelRef; readonly actor: ChatAccountRef; readonly correlationId: string; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: 'action';        readonly platform: PlatformName; readonly channel: ChannelRef; readonly actor: ChatAccountRef; readonly correlationId: string; readonly actionId: string; readonly value: string | null; readonly interaction: InteractionRef }
  | { readonly kind: 'link-posted';   readonly platform: PlatformName; readonly channel: ChannelRef; readonly actor: ChatAccountRef; readonly messageRef: MessageRef; readonly urls: ReadonlyArray<string> };

export interface PlatformEventSink { handle(event: PlatformEvent): Promise<void> }

export type PostOutcome =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly reason: 'bot-not-in-channel'; readonly remedy: string }
  | { readonly ok: false; readonly reason: 'platform-error'; readonly detail: string };

/**
 * **proxy 自身の語彙で持つ。Chat SDK の Card を含めない。**
 * Card への変換は `platform/outbound.ts` の中だけで行う。ここに SDK の型が入ると、
 * 組み立てる `orchestration/` が SDK を import することになり、決定 2 の lint に例外が要る。
 */
export type OutboundMessage =
  | { readonly kind: 'markdown'; readonly markdown: string }
  | { readonly kind: 'list'; readonly title: string;
      readonly rows: ReadonlyArray<{ readonly markdown: string; readonly sourceLabel: string }>;
      readonly footer?: string }
  | { readonly kind: 'choice'; readonly prompt: string;
      readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }> };

export type HistoryOutcome =
  | { readonly ok: true; readonly messages: ReadonlyArray<HistoryMessage> }
  | { readonly ok: false; readonly reason: 'not-in-channel' | 'not-permitted' | 'unsupported'; readonly remedy: string };

/** `fetchMessages` が返す 1 発言。`KeepMessage`（protocol）へ変換して GROWI へ送る */
export interface HistoryMessage {
  readonly postedAt: string;
  readonly author: ChatAccountRef;
  readonly text: string;
}

/** Chat SDK の state が持つ分散ロックを、proxy 自身の型で外へ出す。
 *  `ConnectionManager` と `runtime/sweeper.ts` の両方がこれを使う */
export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  renew(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface PlatformFacade {
  post(target: ChannelRef, message: OutboundMessage): Promise<PostOutcome>;
  postEphemeral(target: ChannelRef, user: ChatAccountRef, message: OutboundMessage): Promise<PostOutcome>;
  /** modal を開くだけ。送信は後から `modal-submit` として届く */
  openModal(trigger: InteractionRef, form: ModalForm, correlationId: string): Promise<void>;
  /** installation のチャンネル一覧。**周期で取り直して保存するために使う**（通知のたびには呼ばない） */
  listChannels(installationId: string): Promise<ChannelInventory>;
  /** 要件 6.1 */
  attachPreview(target: MessageRef, preview: OutboundMessage): Promise<PostOutcome>;
  fetchHistory(target: ChannelRef, range: TimeRange): Promise<HistoryOutcome>;
  /** 先に受け付けを返した後、その投稿を差し替える。
   *  Slack は 3 秒、Discord は一次応答に 3 秒の期限があるため、検索は必ずこの経路を通る */
  replace(message: MessageRef, replacement: OutboundMessage): Promise<PostOutcome>;
  /** 外部から接続を受けるサービス（Teams）のための受け口 */
  webhookHandler(platform: PlatformName): (request: Request) => Promise<Response>;
  connections(): ConnectionManager;
  /** Chat SDK の state が持つ分散ロック。`sweeper` と `ConnectionManager` が使う */
  locks(): DistributedLock;
}

export const createPlatformFacade: (
  appConfig: PlatformAppConfig,
  installations: InstallationProvider,
  sink: PlatformEventSink,
) => Promise<PlatformFacade>;
```

- Preconditions: `openModal` は **`supports(platform, 'modal')` が真 かつ `trigger` が失効していない**ときだけ呼べる
- Postconditions: `post` は例外を投げず、必ず `PostOutcome` を返す（要件 1.4 / 2.4）
- Invariants: **platform 層の出入口に Chat SDK の型を含めない。** 出入口は `PlatformAppConfig` / `InstallationCredentials` /
  `PlatformEvent` / `OutboundMessage` / `HistoryOutcome` / `HistoryMessage` / `DistributedLock` の 7 つ。これらがどれも proxy 自身の型だけで書けることが、
  lint（`chat` / `@chat-adapter/*` の import を `platform/**` 以外で禁止）を**例外なしに**書ける条件

### ArgumentCollector

```typescript
export type StartOutcome =
  | { readonly status: 'collected'; readonly values: Readonly<Record<string, string>> }
  | { readonly status: 'pending';   readonly correlationId: string }
  | { readonly status: 'unavailable'; readonly reason: string };

export type ResumeOutcome =
  | { readonly status: 'collected'; readonly values: Readonly<Record<string, string>>; readonly invocation: Invocation }
  | { readonly status: 'pending' }
  | { readonly status: 'cancelled' | 'expired' | 'not-mine' };

export interface ArgumentCollector {
  start(invocation: Invocation, fields: ReadonlyArray<FieldSpec>): Promise<StartOutcome>;
  resume(event: PlatformEvent): Promise<ResumeOutcome>;
  sweepExpired(now: Date): Promise<number>;
}
```

- Postconditions: `resume` が `collected` を返すときは**元の `Invocation` も返す** — 要件 11.5
  （後から部品が操作されたときも元のコマンドと同じ権限設定を適用する）を満たすため
- Invariants: 途中経過は**チャット上の識別子しか持たない**（要件 7.8）
- Invariants: 1 チャンネル・1 利用者につき同時に 1 件。新しいコマンドが始まったら古いものを破棄し、
  **破棄したことを利用者に示す**

### FanOutCollector（検索とヘルプで共用）

```typescript
export interface FanOutOutcome<T> {
  readonly responded: ReadonlyArray<{ relationId: string; growiLabel: string; value: T }>;
  readonly notResponded: ReadonlyArray<{ relationId: string; growiLabel: string; reason: 'timeout' | 'error' }>;
  /**
   * **チャンネル権限で配らなかった GROWI（要件 11.3）。**
   * これが無いと、3 台紐づくチャンネルで 1 台が許可されていないとき、
   * 利用者は残り 2 台の結果だけを見て「全部を検索した」と思う — **検索が黙って不完全になる。**
   */
  /** `filterBroadcastTargets` が返す `PermissionVerdict` の理由をそのまま持つ。
   *  `not-permitted-in-channel` と `no-settings` は利用者への案内が違うので、1 つに丸めない */
  readonly excluded: ReadonlyArray<{ relationId: string; growiLabel: string; reason: 'not-permitted-in-channel' | 'no-settings' }>;
}

/**
 * 宛先ごとに `requestId` と `relationId` を作り替えて配る。
 * **落とした相手も引数で受け取る。** 配る相手だけを渡す形にすると `excluded` を埋める材料が無く、
 * 常に空になる（＝検索が黙って不完全になるのを防ぐ、という目的が果たせない）。
 */
export const fanOut: <T>(args: {
  readonly targets: ReadonlyArray<Relation>;
  readonly excluded: FanOutOutcome<never>['excluded'];   // `filterBroadcastTargets` が落とした相手
  readonly build: (relation: Relation) => CommandRequest;
  readonly extract: (response: CommandResponse, relation: Relation) => T;   // `T` を決める材料
  readonly deadlineMs?: number;    // 既定 10000
  readonly concurrency?: number;   // 既定 20
}) => Promise<FanOutOutcome<T>>;
```

- Invariants: `responded` が空でも例外を投げない（要件 3.5）
- **段取りは「いったん投稿して差し替える」。** 受け付けの段階ではまだメッセージが無いので `MessageRef` を作れない。
  まず「検索しています」を投稿し、その `PostOutcome.messageId` から `MessageRef` を作り、
  結果が揃ったら `replace()` で差し替える
- **チャットサービス側の応答期限との関係**: Slack はイベントに 3 秒、Discord は一次応答に 3 秒の期限がある。
  **webhook にはまず受け付けを返し**（Slack は 200、Discord は deferred）、結果が揃ってから改めて投稿する。
  期限内に応答しないとチャットサービスが同じイベントを再送するので、重複の取り除きは Chat SDK の state に任せる
- 同時に出すリクエストの本数に上限を設ける（既定 20）。紐づく GROWI が多いときに proxy を詰まらせない
- **ヘルプも同じ待ち合わせを使う。** 複数 GROWI が紐づくチャンネルでは、
  **どの GROWI のヘルプかが分かる形で区別して示す**（要件 14.3）。
  ヘルプの内容は GROWI ごとに違いうる（バージョンによって提供するコマンドが変わるため）

**取り込む範囲に発言が 1 件も無いとき**（要件 5.5）は、ページを作らず「その範囲に発言がありません」と利用者に示す。
`fetchHistory` が空を返した時点で打ち切り、GROWI へは送らない。

### SearchFusion

```typescript
export const fuseResults: (
  sources: ReadonlyArray<{ relationId: string; growiLabel: string; weight: number; items: ReadonlyArray<SearchResultItem> }>,
  options?: { readonly k?: number; readonly limit?: number },
) => ReadonlyArray<{ item: SearchResultItem; relationId: string; growiLabel: string; score: number }>;
```

**単なる交互配置として実装しない。** `weight / (k + 順位)`（`k = 60`）の式のまま持つ。
GROWI ごとに文書集合が互いに素なので、重みが等しければ結果は交互配置と一致する。
重みを掛ける形で持つことで、アルゴリズムを変えずに要件 3.8 の調整ができる。
**関連度順ではない**ことは受け入れる。

### GROWI から届く口（`InboundFlow` が受ける）

署名を確かめた後、**`@growi/chat` の検査関数で本文の形を確かめてから**処理する
（署名は「経路上で書き換えられていない」ことしか示さない）。**口ごとに使う関数が違う** — 下の表を参照。
**`CommandRequest` は proxy へ来ない**（コマンドは proxy から GROWI へ送る側）ので `parseCommandRequest` は使わない。**本文の `relationId` が署名から特定した関係と
一致しないリクエストは `malformed` として断る**（protocol の不変条件）。

**パスと `op` は protocol spec の「口の一覧」が持つ。** ここに写すのは proxy が公開する側だけである。
**すべて `POST`。** 読み取りの口も本体に `{ relationId, op }` を載せる（理由は protocol spec）。

| 口（`op`） | パス | 受け取るもの | 検査関数 | 返すもの | 要件 |
|---|---|---|---|---|---|
| `notification` | `/chat-integration/notification` | `NotificationRequest` | `parseNotificationRequest` | `NotificationResult` | 2.1–2.6 |
| `settings-push` | `/chat-integration/settings-push` | `SettingsPushRequest` | `parseSettingsPush` | `204` | 11.1, 11.2, 11.4 |
| `key-register` | `/chat-integration/keys/register` | `KeyRegistrationRequest` | `parseKeyRegistration` | `KeyOperationResult` | 10.5 |
| `key-revoke` | `/chat-integration/keys/revoke` | `KeyRevocationRequest` | `parseKeyRevocation` | `KeyOperationResult`。**有効な鍵が 0 本になる要求は `would-leave-no-valid-key` で断る** | 10.5 |
| `capabilities` | `/chat-integration/capabilities` | `{ relationId, op }` | `parseOpEnvelope` | `CapabilityReport` | 1.3 |
| `connection-status` | `/chat-integration/connection-status` | `{ relationId, op }` | `parseOpEnvelope` | `ConnectionManager.status()` の結果 | 1.4（下記） |
| `channels` | `/chat-integration/channels` | `{ relationId, op }` | `parseOpEnvelope` | **`ChannelInventory`** | 2.2, 11.1（管理画面が宛先を選ぶため） |
| （署名なし） | `/chat-integration/pairing/submit` | `PairingSubmission` | **`parsePairingSubmission`** | `PairingResult` | 9.1–9.5（**署名なし。本文の検査だけが守りなので必ず通す**） |

> **`connection-status` の位置づけ。** 「運用者に接続状態を見せる」ことを直接求める受け入れ条件は無い。
> これは**要件 1.4（あるサービスの失敗が他へ波及しない）が満たされていることを外から確かめる手段**であり、
> **この設計が Slack と Discord をアプリごとの 1 本に集約したことの帰結**でもある —
> 1 本しかないので、持ち主の台が落ちるとそのサービス全体が黙り、**他のサービスは動いているように見える。**
> 見る手段が無いと、1.4 を満たしているのか単に気づいていないのかを区別できない。

**署名を確かめた後、`acceptEnvelope()` で本体の `relationId` と `op` を突き合わせてから処理する。**
`op` の突き合わせが、署名を別の口へ流用させない唯一の縛りである（protocol spec）。

#### 二重に処理しないための手立ては口によって違う（要件 10.7）

**`requestId` を持つのは `NotificationRequest` だけ**なので、他の口を同じ形では守れない。
`nonce`（使い捨ての値）は再送のたびに取り直す決まりなので、**再送を見分ける役には立たない**。

| 口 | どう守るか |
|---|---|
| `notification` | `processed_notification_target` に**宛先ごと**に記録し、`posted` の宛先は飛ばす |
| `settings-push` | **設定の版**（`settings_version`）が自分の持つものより大きいときだけ書く。同じ押し込みが 2 度来ても 2 度目は何もしない |
| `key-register` | `(relation_id, key_id)` が一意なので、同じ鍵の 2 度目の登録は**何も変えずに成功を返す** |
| `key-revoke` | 失効は「`revoked_at` を立てる」だけなので、2 度目も結果が変わらない |
| `capabilities` / `connection-status` / `channels` | 読み取りだけなので、何度呼ばれても変わらない |

**どの口も「2 度目が来ても結果が変わらない」形にしてある**ので、記録した応答を返し直す仕組みは要らない。

> **通知は宛先ごとに記録する。** 同じ `requestId` の 2 回目は、**`posted` になっていない宛先だけを投稿し直す**。
> `(relation_id, request_id)` で丸ごと弾くと、やり直しは記録を読み直すだけで投稿を一度も試みず、
> **bot を招待して直したのにやり直しても投稿されない**という直しようのない状態になる。
> 応答は**常に `targets` 全件ぶん**を返し、前回 `posted` だった宛先はその結果をそのまま載せる。

**設定の押し込みは `updatedAt` を見る。** 自分が持つものより古ければ捨てる —
管理者が続けて 2 回変えて 1 回目の再送が遅れて届くと、古い設定が新しい設定を上書きするため（protocol の判断）。

**保険の取り直し**（`GET {growiUri}/.../settings` → `SettingsPullResponse`）も `updatedAt` で比べる。

### 通知の宛先の検査（要件 2.4・Security）

`NotificationRequest.targets` のチャンネルが、**署名から特定した関係の installation に属すること**を確かめる。
属さないものは投稿せず `channel-not-in-installation` を返す。
これは **1 台の GROWI が侵害されたとき、被害が他の workspace や他のチャンネルへ広がらない唯一の手段**である。

**「その workspace のチャンネルか」と「bot が入っているチャンネルか」は別物。** 取り違えると案内が出せない —
bot が招待されていない公開チャンネルは、本当は `bot-not-in-channel`（招待すれば直る）なのに
`channel-not-in-installation` として断られる。要件 2.4 は前者について「投稿できるようにするために必要な操作」を
示すことを求めているので、この書き分けは保つ。

**判定は proxy が自分の周期で取り直して保存した一覧だけを見る。通知が来たときには引きに行かない。**

| | |
|---|---|
| 取り直し | **proxy が installation ごとに、自分の周期で**（既定 10 分）`PlatformFacade.listChannels()` を呼び、`installation_channel` に保存する |
| **最初の 1 回** | **`InstallationStore.save()` が成功した直後に 1 回取り直す。** これが無いと、`installation_channel` が空のまま最初の周期を待つことになり、**紐付けた直後の 10 分間、通知がすべて断られる** |
| 判定 | 通知が来たら**保存した一覧だけを見る**。無いチャンネルは `channel-not-in-installation` |
| **一度も取れていない installation** | `refreshed_at` の行が 1 つも無い状態と、取れた結果が空だった状態を**区別する**。前者は `channel-not-in-installation` ではなく **`inventory-not-ready`** を返す。前者で「そのチャンネルは無い」と答えると、**運用者に間違った直し方（チャンネルを作り直す・bot を入れ直す）を案内してしまう** |
| 取り直しの失敗 | **最後に取れた一覧をそのまま使い続ける**（新しい一覧が取れるまで判定は変わらない） |
| 誰が回すか | `sweeper` と同じく**分散ロックで 1 台だけ**が取り直す。保存先は PostgreSQL なので、**ロックを持たない台も読める** |

**「通知が来たときに引く」と「失敗したら通す」を両方やめるのが要点。** 前の版はこの 2 つを持っていたため、
**侵害された GROWI が覚えていないチャンネル宛てに大量に送るだけで問い合わせを起こし、
チャットサービスの呼び出し上限に当てて検査を通る側へ倒せた** — 攻撃者が自分で条件を作れた。
取り直しを proxy の都合だけで行えば、外から問い合わせを起こす手立てが無くなり、
失敗時にどちらへ倒すかという判断も要らなくなる。

**管理者が選んだ宛先を材料にしない。** 要件 2.2（編集した人がページの保存時に宛先を指定する）は
管理者の設定を通らないので、管理者が選んだものだけを許すと**2.2 の通知がすべて断られる**。
判定の材料は「その installation に存在するチャンネルか」であって「管理者が選んだか」ではない。

### PairingService

```typescript
/** **`GrowiClient` を import しない。** 確認値を送る関数だけを引数で受け取る（依存の向きを守るため） */
export type SendChallenge = (growiUri: string, challenge: OwnershipChallenge) => Promise<ChallengeResponse>;

export interface PairingService {
  issueCode(installationId: string, issuedBy: ChatAccountRef): Promise<{ code: string; expiresAt: Date }>;
  submit(submission: PairingSubmission, send: SendChallenge): Promise<PairingResult>;
  unpair(relationId: string): Promise<void>;
}
```

**⑥ では `challenge` の一致だけでなく `challengeSignature` を検証する。**
検証に使うのは **③ で申告された公開鍵**、検証する値は protocol の `pairingChallengePayload(registrationCode, challenge)`
（`challenge` そのものではない。**`proxyUri` は入らない** — 両側で出どころが違い署名が一致しないため。
理由は protocol の「⑤ で署名する値」）。文字列の一致だけを実装すると、
第三者が本物の GROWI の URL と自分の鍵で申し込んだときに通ってしまい、鍵のすり替えが成立する
（protocol spec の「⑤ が公開鍵を縛る理由」）。検証に失敗したら `ownership-unverified` を返す。

**申告された URL の検証は 2 つに割れている**（protocol spec の「この検証をどちらが持つか」）。

- **条件そのものの判定**（https か・既定ポートか・引き終わったアドレスが私的帯でないか）→ `@growi/chat` の `judgeGrowiUri`
- **名前を引く（`node:dns`）、確かめたアドレスへつなぐ、リダイレクトを追わない、待ち時間の上限** → **この proxy が持つ**
  （`relation/growi-uri-resolver.ts`）。`@growi/chat` はネットワークに触れられない

custom proxy 向けに、許す宛先を運用者が設定で明示できるようにする（`runtime/config.ts` → `judgeGrowiUri` の `allowList`）。
**`allowList` に挙げた宛先には、つなぐときに信頼する証明書の根拠も運用者が指定できる**
（`runtime/config.ts`。閉域では自前の認証局や自己署名の証明書がふつうなので、
指定する手立てが無いと証明書の検証そのものを切る構成に落ちる）。

**判定はペアリングのときだけでなく、保存した `growi_uri` へ送る毎リクエストの前に掛ける**（protocol spec）。
`GrowiUriResolver` がその窓口で、**リクエストごとに名前を引き直し、引いたアドレスを `judgeGrowiUri` に掛け、
確かめたアドレスへつなぐ**。ペアリングのときだけだと、④ で公開アドレスを申告して通したあと
名前の引き先を閉域内へ付け替えるだけで、この検証が防ごうとしたものがそのまま成立する。

**`GrowiClient` は必ず `GrowiUriResolver` を通す。** 直に `fetch` しない。
2 つの部品が別々に HTTP を組み立てると、片方だけ判定が抜ける。
`PairingService.submit` が引数で受け取る `SendChallenge` も、**`orchestration/` が
`GrowiUriResolver` を包んで組み立てて渡す**（`relation/` は `growi/` を import しないため）。

---

## Data Models（proxy / PostgreSQL）

| テーブル | 主な列 | 索引・制約 |
|---|---|---|
| `installation` | `id`, `platform`, `workspace_id`, `workspace_name`, `credentials`（暗号化）, `created_at` | `(platform, workspace_id)` 一意 |
| `relation` | `id`（**推測できない値。連番にしない** — `keyid` として署名ヘッダに載り外部に出るため）, `installation_id`, `growi_uri`, `growi_label`, `search_weight`, `settings_version`, `created_at` | `(installation_id, growi_uri)` 一意 |
| `peer_key` | `id`, `relation_id`, `key_id`, `public_key_jwk`, `valid_from`, `revoked_at` | `(relation_id, key_id)` 一意 |
| `own_key` | `id`, `relation_id`, `key_id`, `private_key_pem`（暗号化）, `valid_from`, `revoked_at` | 同上。**相手ごとに鍵を分ける** — 1 つの関係の鍵が漏れても他へ波及しないため |
| `pairing_order` | `id`, `installation_id`, `code_hash`, `attempts`, `expires_at`, `consumed_at` | `code_hash` 一意。`attempts` に上限 |
| `request_nonce` | `relation_id`, `key_id`, `nonce`, `expires_at` | **主キー `(relation_id, key_id, nonce)`** |
| ~~`processed_request`~~ | — | **持たない。** コマンドは proxy から GROWI へ送る側なので、`CommandRequest` は proxy に届かない（下記の口の表）。GROWI から届くもののうち `requestId` を持つのは `NotificationRequest` だけで、それは `processed_notification_target` が受け持つ |
| `processed_notification_target` | `relation_id`, `request_id`, `platform`, `channel_id`, `status`, `detail`, `processed_at`, `expires_at` | **主キー `(relation_id, request_id, platform, channel_id)`。通知用** — `posted` の宛先は次のやり直しで飛ばす。**コマンドと同じ表に混ぜない**（主キーの意味が違い、読む人が取り違える） |
| `installation_channel` | `installation_id`, `platform`, `channel_id`, `channel_name`, `is_private`, `refreshed_at` | **主キー `(installation_id, channel_id)`。** 通知の宛先の検査に使う唯一の材料。周期で取り直す |
| `channel_permission` | `id`, `relation_id`, `command_name`, `channels` | **`(relation_id, command_name)` 一意。** `scope` も行ごとの `updated_at` も持たない — 前者は `COMMAND_TRAITS` の `targeting` で決まり、後者は**関係ごとに 1 つ**（`relation.settings_version`）だから |
| `pending_collection` | `correlation_id`, `relation_id`（**GROWI 選択中は空**）, `platform`, `channel_id`, `actor_account_id`, `command_name`, `invocation`(JSON), `collected`(JSON), **`offered_options`(JSON)**, `expires_at` | `correlation_id` 主キー。`(platform, channel_id, actor_account_id)` に索引 |

Chat SDK の state（購読・分散ロック・重複排除）は `@chat-adapter/state-pg` が別スキーマに持つ。**触らない。**

**期限切れの掃除**: `request_nonce` / **`processed_notification_target`** / `pending_collection` / `pairing_order` を
`runtime/sweeper.ts` が定期的に削除する。**分散ロックで 1 台だけが実行する。**

**紐付けを解除したとき（要件 9.7）**: `relation` に連なる `own_key` / `peer_key` / `channel_permission` /
`pending_collection` / `processed_notification_target` を削除し、**最後に `relation` の行そのものを削除する**。
**秘密鍵を残さない。** `request_nonce` は期限切れで自然に消えるので触らない。

- **`relation` の行を消さないと繋ぎ直せない。** `(installation_id, growi_uri)` が一意なので、
  同じ GROWI をもう一度申し込むと `already-paired`（要件 8.5）が返り続ける。
  `chat-integration-app` 側は「繋ぎ直すと新しい `relationId` になる」前提で書かれている
- **`installation_channel` は消さない。** この表は **installation ごと**であって関係ごとではない。
  1 つの関係を解除しただけで消すと、**同じ workspace に紐づく他の GROWI からの通知が、
  次の取り直しまで（既定 10 分）すべて `channel-not-in-installation` で断られる**

**保存時の暗号化**: `installation.credentials` と `own_key.private_key_pem`。
暗号化に使う鍵は `runtime/config.ts` が環境変数から読み、他の層へは復号済みの値ではなく**復号する関数**を渡す。

---

## 閉域ネットワークでの運用（要件 13）

```
インターネット ──(Teams のみ)──▶ [DMZ] chat-integration-proxy ──▶ [閉域] GROWI
                                        │
                                        ├── Slack   （Socket Mode。proxy から接続）
                                        ├── Discord （Gateway。proxy から接続）
                                        └── Mattermost（閉域内。proxy から接続）
```

- **外部から通す必要があるのは Teams だけ。** 接続元は Azure Bot Service の IP レンジに絞れる
- **proxy から出る先**: 各チャットサービスの API、紐づく GROWI の URL、PostgreSQL
- **GROWI から proxy へ**: 通知・設定・鍵・ペアリングの申請

> **閉域では公式に運用する proxy を選べない。** ペアリングの所有確認もコマンドの送信も
> **proxy から GROWI へ届くことが前提**なので、GROWI を公開しない構成では
> **proxy も自分の閉域（または閉域に届く場所）に立てる**しかない。決定 10 により
> 公式版も自前版も同じ Docker image なので、置き場所を変えるだけで済む。

**proxy が侵害されたときの影響**は umbrella の Security Considerations を参照し、そのまま導入ドキュメントに載せる。

---

## Testing Strategy

### Unit Tests

1. `fuseResults` — 重みが等しいと交互に並ぶこと。重みで順位が変わること。同点が `relationId` で安定すること（3.2・3.3・3.8）
2. `PlatformCapabilities` — **表に載っている全ての能力について** 4 サービス分が埋まっていること（数を書かない。行が増えるたびに書き換える形にしない）。**`unverified` に対して `supports()` が `false`** を返すこと（1.2）
3. `CommandInvocation.normalize` — mention と slash command が同じ `Invocation` になること（決定 4）
4. **modal を選ぶ条件** — 能力表が対応と言っていても、手がかりが無い／失効していれば聞き返しへ落ちること（4.1・8.3）

### Integration Tests

1. `ArgumentCollector` — 同じ `FieldSpec` から Slack（modal）と Discord（聞き返し）の両方で値が集まること。
   **`start` と `resume` を別プロセスで実行しても成立すること**（1.2・4.1）
2. **呼びかけ付きの返信** — `@growi 1` が `normalize` で `null` になった後 `resume` に届き、値が集まること（8.2）
3. `FanOutCollector` — 3 台のうち 1 台が締め切りを超え、1 台が権限で外れたとき、
   **残り 1 台の結果と、超えた 1 台と外れた 1 台の両方が示されること**（3.4・11.3）
4. `ConnectionManager`（**接続の単位ごとに書き分ける**）
   - Slack: **1 本が複数の installation を受け持つこと。** installation が 1 件消えても接続が閉じないこと
   - Mattermost: **installation ごとに持ち分が分かれること**
   - 共通: 切れたら張り直すこと。**1 つの接続の失敗が他へ波及しないこと**（1.1・1.4）
5. **複数台の持ち分**（同じく単位ごと）
   - Slack: **2 台起動しても張られる接続は 1 本だけ**であること
   - Mattermost: 1 つの installation につながるのは 1 台だけであること
   - 共通: 持ち主を止めると他方が引き取ること。**ロックが延長され続ける限り奪われない**こと
6. ペアリング — 申告された URL が https 以外・私的アドレス帯・リダイレクトのとき拒まれること。
   **`allowList` に挙げた宛先は 3 条件とも通ること。判定が毎リクエストに掛かること**（9.2・13.1）
7. **管理コマンドは workspace の管理者だけが実行できること**（4 サービス分。要件 9.1・9.7 の目的そのもの）
8. **通知の宛先の検査** — `channel-not-in-installation` と `bot-not-in-channel` が書き分けられること。
   **一度も一覧を取れていない installation は `inventory-not-ready` になる**こと。
   **installation を作った直後に一覧が取れていること**（2.4）
9. **設定の押し込み** — 自分が持つ版より小さい `version` の押し込みが捨てられること（11.4）
10. **鍵の入れ替え** — 届かない相手が 1 台あるとき、古い鍵が失効しないこと。
    全員に届いたときにだけ失効すること（10.5・10.6）

### E2E Tests

1. Slack: mention → ボタン → modal → ページ作成 → リンクが投稿される（4.1–4.3・8.2）
2. Mattermost: mention → 番号つき一覧 → `@growi 1` で選択 → 引数と聞き返しでページ作成（1.2・8.2）
3. Discord: mention による検索が 2 台の GROWI の結果を出典つきで返す（3.1–3.3）
4. **Teams**: mention → modal → ページ作成。**外部から接続を受ける唯一のサービス**で、
   slash command は使えず modal は使えるという他と違う組み合わせを持つため確かめる価値が最も高い（1.1・1.2・13.3）
5. **通知**（要件 2）: GROWI がページを保存 → 通知が指定のチャンネルへ届く →
   **1 つの宛先だけ失敗させて再送すると、成功した宛先には二重に投稿されない**こと（2.1–2.5）。
   Gen 1 で最も使われている機能なので、コマンドの流れと同じだけ確かめる
6. **紐付け**（要件 7）: 紐付いていない利用者が `create-page` を打つ →
   `account-link-required` が**本人にだけ見えるメッセージ**で返る → `link` でも同じ経路が使えること（7.3・7.6）
