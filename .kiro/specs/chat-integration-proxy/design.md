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
(d) 受け持つ installation が消えていたら閉じる、を行う。

さらに 3 つ決めておく。

- **前の周回が終わる前に次を始めない。** installation が多いと 1 周が間隔を超えることがあり、
  重なって走ると同じ相手に 2 本つなぐ
- **ロックの寿命は回す間隔の 3 倍以上**（既定: 間隔 20 秒・寿命 60 秒）。
  この関係を書いておかないと、後から間隔だけを伸ばした運用者が二重処理を踏む
- **(c) で閉じ終わるまでの短い間、2 台が同じ相手につながることは避けられない。**
  延長に失敗した時点でロックは既に他の台に渡っており、閉じる操作は一瞬では終わらない。
  **この間の重複は Chat SDK の state による重複の取り除き（`event_id` 単位）が受け止める** —
  チャットサービスの再送を取り除く仕組みと同じものが、ここでも働く

#### 接続を足す・外す引き金は installation の増減

**GROWI の紐付け（relation）の増減では接続を触らない。** ペアリング（要件 9）は
**すでにある installation に GROWI を 1 つ足す**操作で、要件 9.7 の解除は relation を 1 件消す操作である。
これを引き金にすると、**3 台紐づく workspace で 1 台だけ解除したときに残り 2 台の接続まで切れる。**
`reconcile()` が `installation` の一覧を見て差を埋めるので、引き金は「installation が増えた・消えた」だけでよい。

> **常駐コストは installation の数に比例する**（GROWI の台数には比例しない）。
> 「アイドル時のコストがゼロ」は常時接続を持つ以上あてはまらない。

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

#### イベントの振り分け順序

1. `mention` はまず `CommandInvocation.normalize` を試す
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
│   │   ├── outbound-message.ts    # OutboundMessage / HistoryMessage / HistoryOutcome（SDK 型を含まない）
│   │   ├── distributed-lock.ts    # DistributedLock（SDK 型を含まない）
│   │   └── platform-event.ts      # PlatformEvent / PlatformAppConfig / InstallationCredentials
│   ├── capabilities/
│   │   ├── index.ts
│   │   └── platform-capabilities.ts   # 能力表。唯一の宣言箇所
│   ├── db/
│   │   ├── prisma-client.ts
│   │   └── repositories/
│   │       ├── installation-repository.ts
│   │       ├── relation-repository.ts
│   │       ├── peer-key-repository.ts     # KeyStore の proxy 側の実装
│   │       ├── pairing-order-repository.ts
│   │       ├── pending-collection-repository.ts
│   │       ├── processed-request-repository.ts
│   │       └── request-nonce-repository.ts
│   ├── platform/                  # Chat SDK に触れてよい唯一の層
│   │   ├── index.ts
│   │   ├── bot-factory.ts
│   │   ├── adapter-set.ts         # 接続情報を受け取ってアダプタと state を組み立てる
│   │   ├── connection-manager.ts  # 常時接続の生涯
│   │   ├── installation-provider.ts
│   │   ├── event-mapping.ts       # SDK のイベント → PlatformEvent（SDK 型はここで止まる）
│   │   ├── outbound.ts
│   │   ├── prompt.ts              # modal の開閉
│   │   └── history.ts
│   ├── command/
│   │   ├── invocation.ts          # mention / slash を 1 つの内部表現へ
│   │   ├── argument-collector.ts  # start / resume / sweepExpired
│   │   ├── pending-collection.ts
│   │   ├── command-set.ts         # 利用者向けコマンド
│   │   └── admin-command-set.ts   # 運用者向け（register / unregister / weight / rotate-key）
│   ├── relation/
│   │   ├── pairing-service.ts     # 確認値を送る関数を引数で受け取る
│   │   ├── growi-uri-resolver.ts  # 名前を引き、確かめたアドレスへつなぐ（リダイレクトを追わない）
│   │   ├── growi-selection.ts
│   │   └── unpair-service.ts
│   ├── growi/
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
| `InstallationProvider` | `platform/installation-provider.ts` | workspace ごとの資格情報を解決 | 1.1, 8.1 |
| `InstallationStore` | `platform/installation-store.ts` | **installation を作る・消す。** OAuth の折り返しと、Mattermost の設定ファイルから呼ぶ | 1.1, 1.5, 8.1 |
| `CommandInvocation` | `command/invocation.ts` | mention / slash を 1 つの内部表現へ | 1.2, 3.1, 4.1, 14.1 |
| `ArgumentCollector` | `command/argument-collector.ts` | 値を集め、途中経過を保存して再開 | 1.2, 4.1, 5.2, 8.2, 11.5 |
| `AdminCommandSet` | `command/admin-command-set.ts` | 運用者の入り口 | 3.8, 9.1, 9.7, 10.5, 13.4 |
| `GrowiSelector` | `relation/growi-selection.ts` | どの GROWI に対して実行するか | 6.4, 8.1–8.6 |

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
| `rotate-key` | 10.5 | proxy 側の鍵の入れ替えを始める。配布の結果と未達の相手を返す |

**実行できるのは workspace の管理者だけ。** これが無いと、その workspace の誰でも自分の GROWI を紐付けられ、
**要件 9 の目的（第三者が勝手に登録できない）が成立しない**。

**調べ方はサービスごとに違うので、能力表と同じくデータとして持つ**（Slack は利用者情報の管理者フラグ、
Discord は権限のビット、Mattermost はロール、Teams は所属の役割）。`if (platform === ...)` と書かない。

**登録コードは本人にだけ見えるメッセージで返す。** チャンネルに平文で出さない（protocol spec 手順 ①）。

**GrowiSelector の判断**（要件 8.2–8.4）
- 対象が 1 つに定まる操作で、許可している GROWI が複数 → **利用者に選ばせる**（8.2）
- 許可している GROWI が 1 つだけ → **選択を求めずそれに対して実行する**（8.3）
- **全 GROWI を対象とする操作（検索・ヘルプ）→ 選択を求めず、許可している全 GROWI へ配る**（8.4）
- どの GROWI も紐づいていない、または許可していない → 実行せず理由を示す（8.6・11.3）
| `PairingService` | `relation/pairing-service.ts` | ペアリングの proxy 側 | 9.1–9.7 |
| `FanOutCollector` | `growi/fan-out-collector.ts` | 複数 GROWI への配信と待ち合わせ | 3.1, 3.4, 3.5, 14.5 |
| `SearchFusion` | `growi/search-fusion.ts` | 重みつきの式で 1 本に統合 | 3.2, 3.3, 3.8 |
| `GrowiClient` | `growi/growi-client.ts` | 署名つきで GROWI を呼ぶ | 3.1, 4.2, 5.2, 9.2, 14.2 |
| `EventSink` | `orchestration/event-sink.ts` | イベントを受けて各層を呼ぶ | 1.1, 1.2, 3.1, 4.1, 6.1, 14.1 |
| `InboundFlow` | `orchestration/inbound-flow.ts` | GROWI からの通知・設定・鍵の追加と失効 | 2.1–2.6, **10.5**, 10.7, 11.4 |

### PlatformFacade

```typescript
/** 全 workspace 共通。`runtime/config.ts` が環境変数から読む */
export interface PlatformAppConfig {
  readonly slack?: { readonly signingSecret: string; readonly clientId: string; readonly clientSecret: string };
  readonly discord?: { readonly applicationId: string; readonly publicKey: string };
  readonly teams?: { readonly clientId: string; readonly clientSecret: string };
  readonly stateConnectionString: string;
}

/**
 * **workspace ごとの資格情報は `installation` から解決する。**
 * 1 台の proxy が複数の workspace をさばくハブであること（要件 8.1）がこの分離で成り立つ。
 * ここを 1 組に固定すると `installation` テーブルが誰も読まない列になる。
 */
export interface InstallationCredentials {
  readonly slack?: { readonly botToken: string; readonly appToken?: string };
  readonly discord?: { readonly botToken: string };
  readonly teams?: { readonly tenantId: string };
  /** Mattermost は接続先そのものが installation ごとに違う */
  readonly mattermost?: { readonly baseUrl: string; readonly botToken: string };
}

export interface InstallationProvider {
  resolve(platform: PlatformName, workspaceId: string): Promise<InstallationCredentials | null>;
  /** `ConnectionManager.reconcile()` が「あるべき接続」を知るために使う */
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
  | { readonly kind: 'reply';         readonly platform: PlatformName; readonly channel: ChannelRef; readonly actor: ChatAccountRef; readonly text: string }
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
  readonly excluded: ReadonlyArray<{ relationId: string; growiLabel: string; reason: 'not-permitted-in-channel' }>;
}

/** 宛先ごとに `requestId` と `relationId` を作り替えて配る */
export const fanOut: <T>(
  targets: ReadonlyArray<Relation>,
  build: (relation: Relation) => CommandRequest,
  options?: { readonly deadlineMs?: number },   // 既定 10000
) => Promise<FanOutOutcome<T>>;
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

`SignatureGuard` を通した後、**`@growi/chat` の `parseCommandRequest` で本文の形を確かめてから**処理する
（署名は「経路上で書き換えられていない」ことしか示さない）。**本文の `relationId` が署名から特定した関係と
一致しないリクエストは `malformed` として断る**（protocol の不変条件）。

| 口 | 受け取るもの | 返すもの | 要件 |
|---|---|---|---|
| 通知 | `NotificationRequest` | `NotificationResult` | 2.1–2.6 |
| 設定の押し込み | `SettingsPushRequest` | `204` | 11.1, 11.2, 11.4 |
| 鍵の追加 | `KeyRegistrationRequest` | `KeyOperationResult` | 10.5 |
| 鍵の失効 | `KeyRevocationRequest` | `KeyOperationResult`。**有効な鍵が 0 本になる要求は `would-leave-no-valid-key` で断る** | 10.5 |
| 能力の一覧 | — | `CapabilityReport` | 1.3 |
| チャンネルの一覧 | — | その installation のチャンネル | 11.1（管理画面が宛先を選ぶため） |
| ペアリングの申請 | `PairingSubmission` | `PairingResult` | 9.1–9.5（**署名なし。唯一の例外**） |

**設定の押し込みは `updatedAt` を見る。** 自分が持つものより古ければ捨てる —
管理者が続けて 2 回変えて 1 回目の再送が遅れて届くと、古い設定が新しい設定を上書きするため（protocol の判断）。

**保険の取り直し**（`GET {growiUri}/.../settings` → `SettingsPullResponse`）も `updatedAt` で比べる。

### 通知の宛先の検査（要件 2.4・Security）

`NotificationRequest.targets` のチャンネルが、**署名から特定した関係の installation に属すること**を確かめる。
属さないものは投稿せず `channel-not-in-installation` を返す。
これは **1 台の GROWI が侵害されたとき、被害が他の workspace や他のチャンネルへ広がらない唯一の手段**である。

**「その workspace のチャンネルか」と「bot が入っているチャンネルか」は別物。** 取り違えると案内が出せない —
bot が招待されていない公開チャンネルは、本当は `bot-not-in-channel`（招待すれば直る）なのに
`channel-not-in-installation`（この関係のものではない）として断られる。要件 2.4 は前者について
「投稿できるようにするために必要な操作」を示すことを求めているので、**引くのは workspace のチャンネル一覧**とし、
bot の在籍は投稿を試みた結果（`PostOutcome`）で判断する。

一覧は毎回 API を呼ばず、**installation ごとに覚えておいて一定間隔で取り直す**。
ただし **`reconcile()` の周回は自分がロックを持つ接続の分しか回らない**のに対し、
通知はロードバランサが選んだ任意の台に届くので、**覚えていない台でも動く形にする** —
覚えていなければその場で 1 度引き、結果を共有の保存先（PostgreSQL）に置く。
**引く問い合わせが失敗したときは通す**（チャットサービスの一時的な不調で通知が全部止まるのを避ける）。
その場合は投稿を試み、失敗すれば `PostOutcome` の理由がそのまま返る。

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
検証に使うのは **③ で申告された公開鍵**。文字列の一致だけを実装すると、
第三者が本物の GROWI の URL と自分の鍵で申し込んだときに通ってしまい、鍵のすり替えが成立する
（protocol spec の「⑤ が公開鍵を縛る理由」）。検証に失敗したら `ownership-unverified` を返す。

**申告された URL の検証は 2 つに割れている**（protocol spec の「この検証をどちらが持つか」）。

- **条件そのものの判定**（https か・既定ポートか・引き終わったアドレスが私的帯でないか）→ `@growi/chat` の `judgeGrowiUri`
- **名前を引く（`node:dns`）、確かめたアドレスへつなぐ、リダイレクトを追わない、待ち時間の上限** → **この proxy が持つ**
  （`relation/growi-uri-resolver.ts`）。`@growi/chat` はネットワークに触れられない

custom proxy 向けに、許す宛先を運用者が設定で明示できるようにする（`runtime/config.ts` → `judgeGrowiUri` の `allowList`）。

---

## Data Models（proxy / PostgreSQL）

| テーブル | 主な列 | 索引・制約 |
|---|---|---|
| `installation` | `id`, `platform`, `workspace_id`, `workspace_name`, `credentials`（暗号化）, `created_at` | `(platform, workspace_id)` 一意 |
| `relation` | `id`, `installation_id`, `growi_uri`, `growi_label`, `search_weight`, `created_at` | `(installation_id, growi_uri)` 一意 |
| `peer_key` | `id`, `relation_id`, `key_id`, `public_key_jwk`, `valid_from`, `revoked_at` | `(relation_id, key_id)` 一意 |
| `own_key` | `id`, `relation_id`, `key_id`, `private_key_pem`（暗号化）, `valid_from`, `revoked_at` | 同上。**相手ごとに鍵を分ける** — 1 つの関係の鍵が漏れても他へ波及しないため |
| `pairing_order` | `id`, `installation_id`, `code_hash`, `attempts`, `expires_at`, `consumed_at` | `code_hash` 一意。`attempts` に上限 |
| `request_nonce` | `relation_id`, `key_id`, `nonce`, `expires_at` | **主キー `(relation_id, key_id, nonce)`** |
| `processed_request` | `relation_id`, `request_id`, `response`（JSON）, `processed_at`, `expires_at` | **主キー `(relation_id, request_id)`** |
| `channel_permission` | `id`, `relation_id`, `command_name`, `channels`, `updated_at` | **`(relation_id, command_name)` 一意。** `scope` は持たない — 全 GROWI 向けかどうかは `BROADCAST_COMMANDS` で決まるので、行にも持つと二重持ちになる。`updated_at` は取りに行った設定が古いかを比べるため（要件 11.4） |
| `pending_collection` | `correlation_id`, `relation_id`（**GROWI 選択中は空**）, `platform`, `channel_id`, `actor_account_id`, `command_name`, `invocation`(JSON), `collected`(JSON), **`offered_options`(JSON)**, `expires_at` | `correlation_id` 主キー。`(platform, channel_id, actor_account_id)` に索引 |

Chat SDK の state（購読・分散ロック・重複排除）は `@chat-adapter/state-pg` が別スキーマに持つ。**触らない。**

**期限切れの掃除**: `request_nonce` / `processed_request` / `pending_collection` / `pairing_order` を
`runtime/sweeper.ts` が定期的に削除する。**分散ロックで 1 台だけが実行する。**

**紐付けを解除したとき（要件 9.7）**: `relation` に連なる `own_key` / `peer_key` / `channel_permission` /
`pending_collection` を削除する。**秘密鍵を残さない。** `request_nonce` と `processed_request` は
期限切れで自然に消えるので触らない。

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
4. `ConnectionManager` — 起動時に installation を数え上げてつなぐこと。切れたら張り直すこと。
   **1 つの接続の失敗が他へ波及しないこと**（1.1・1.4）
5. **複数台の持ち分** — 2 台起動しても 1 つの installation につながるのは 1 台だけであること。
   持ち主を止めると他方が引き取ること
6. ペアリング — 申告された URL が https 以外・私的アドレス帯・リダイレクトのとき拒まれること（9.2）

### E2E Tests

1. Slack: mention → ボタン → modal → ページ作成 → リンクが投稿される（4.1–4.3・8.2）
2. Mattermost: mention → 番号つき一覧 → `@growi 1` で選択 → 引数と聞き返しでページ作成（1.2・8.2）
3. Discord: mention による検索が 2 台の GROWI の結果を出典つきで返す（3.1–3.3）
4. **Teams**: mention → modal → ページ作成。**外部から接続を受ける唯一のサービス**で、
   slash command は使えず modal は使えるという他と違う組み合わせを持つため確かめる価値が最も高い（1.1・1.2・13.3）
