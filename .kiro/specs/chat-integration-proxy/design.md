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
| `slashCommand` | ○ | ○ | × | × | mention で起動する（決定 4） |
| `mention` | ○ | ○ | ○ | ○ | — |
| `modal` | ○ | × | ○ | × | コマンド行の引数 + 聞き返し（決定 5） |
| `interactiveActions` | ○ | ○ | ○ | × | 番号つきの一覧を出して返信で選ばせる |
| `card` | ○ | ○ | ○ | △ | markdown で投稿する |
| `linkPreview` | ○ | 要確認 | 要確認 | 要確認 | 要件 6.5 に従い「使えない」と示す |
| `fetchMessages` | ○ | ○ | ○ | ○ | — |
| `plainReply` | 要確認 | 要確認 | 要確認 | 要確認 | **呼びかけ付きの返信にする**（下記） |

`CapabilityLevel` は `full` / `degraded` / `none` / `unverified` の 4 値。
表の ○ が `full`、△ が `degraded`、× が `none`、要確認が `unverified`。
**`unverified` は `supports()` が `false` を返す** — 確かめるまで、その能力に寄りかからない。

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
  /** 起動時。installation を数え上げて 1 件ずつつなぐ */
  start(): Promise<void>;
  /** 停止時。全部閉じる */
  stopAll(): Promise<void>;
  /** ペアリングが成立して workspace が増えたとき、動いているプロセスがその場で足す */
  attach(installationId: string): Promise<void>;
  /** 紐付けが解除されたとき */
  detach(installationId: string): Promise<void>;
  /** 現在の接続状態。運用者が確認できる形で出す */
  status(): Promise<ReadonlyArray<{ installationId: string; platform: PlatformName; state: 'connected' | 'reconnecting' | 'failed'; since: Date }>>;
}
```

**切れたときは指数的に間隔を空けて張り直す。** 上限を超えたら `failed` として記録し、運用者に見える形で残す。
**1 つの接続の失敗を他へ波及させない**（要件 1.4）。

#### 複数台で動かすときの持ち分

**1 つの installation の接続は、1 台だけが持つ。** 同じ workspace に 2 台がつなぐと、
イベントが二重に処理される。持ち分は Chat SDK が要求する state（`@chat-adapter/state-pg`）の
**分散ロックを `installation:{id}` に掛けて**決める。ロックには寿命を持たせ、
**持ち主が落ちてから他の台が引き取るまでの時間**を設定で決められるようにする（既定 60 秒）。

> **初版は 1 台で動かす前提とし、複数台は上のロックで成立させる。**
> Performance の記述は「アイドル時のコストがゼロ」ではない — **常時接続を持つ以上、
> installation の数に比例した常駐コストがかかる**（GROWI の台数には比例しない）。

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
│   │   ├── webhook-routes.ts      # Teams の受け口ほか
│   │   ├── growi-routes.ts        # 通知・設定・能力・鍵・ペアリング
│   │   └── health-routes.ts
│   └── runtime/
│       ├── server.ts              # プロセス起動、ConnectionManager.start()、シグナル処理
│       ├── config.ts              # process.env を読んでよい唯一のファイル
│       └── sweeper.ts             # 期限切れの掃除（分散ロックで 1 台だけが実行）
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
| `CommandInvocation` | `command/invocation.ts` | mention / slash を 1 つの内部表現へ | 1.2, 3.1, 4.1, 14.1 |
| `ArgumentCollector` | `command/argument-collector.ts` | 値を集め、途中経過を保存して再開 | 1.2, 4.1, 5.2, 8.2, 11.5 |
| `AdminCommandSet` | `command/admin-command-set.ts` | 運用者の入り口 | 3.8, 9.1, 9.7, 10.5, 13.4 |
| `GrowiSelector` | `relation/growi-selection.ts` | どの GROWI に対して実行するか | 6.4, 8.1–8.6 |
| `PairingService` | `relation/pairing-service.ts` | ペアリングの proxy 側 | 9.1–9.7 |
| `FanOutCollector` | `growi/fan-out-collector.ts` | 複数 GROWI への配信と待ち合わせ | 3.1, 3.4, 3.5, 14.5 |
| `SearchFusion` | `growi/search-fusion.ts` | 重みつきの式で 1 本に統合 | 3.2, 3.3, 3.8 |
| `GrowiClient` | `growi/growi-client.ts` | 署名つきで GROWI を呼ぶ | 3.1, 4.2, 5.2, 9.2, 14.2 |
| `EventSink` | `orchestration/event-sink.ts` | イベントを受けて各層を呼ぶ | 1.1, 1.2, 3.1, 4.1, 6.1, 14.1 |
| `InboundFlow` | `orchestration/inbound-flow.ts` | GROWI からの通知・設定・鍵 | 2.1–2.6, 10.7, 11.4 |

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
  /** `ConnectionManager.start()` が起動時に数え上げるために使う */
  list(platform: PlatformName): Promise<ReadonlyArray<{ installationId: string; workspaceId: string }>>;
}

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

export interface PlatformFacade {
  post(target: ChannelRef, message: OutboundMessage): Promise<PostOutcome>;
  postEphemeral(target: ChannelRef, user: ChatAccountRef, message: OutboundMessage): Promise<PostOutcome>;
  /** modal を開くだけ。送信は後から `modal-submit` として届く */
  openModal(trigger: InteractionRef, form: ModalForm, correlationId: string): Promise<void>;
  /** 要件 6.1 */
  attachPreview(target: MessageRef, preview: OutboundMessage): Promise<PostOutcome>;
  fetchHistory(target: ChannelRef, range: TimeRange): Promise<HistoryOutcome>;
  /** 外部から接続を受けるサービス（Teams）のための受け口 */
  webhookHandler(platform: PlatformName): (request: Request) => Promise<Response>;
  connections(): ConnectionManager;
}

export const createPlatformFacade: (
  appConfig: PlatformAppConfig,
  installations: InstallationProvider,
  sink: PlatformEventSink,
) => Promise<PlatformFacade>;
```

- Preconditions: `openModal` は **`supports(platform, 'modal')` が真 かつ `trigger` が失効していない**ときだけ呼べる
- Postconditions: `post` は例外を投げず、必ず `PostOutcome` を返す（要件 1.4 / 2.4）
- Invariants: **`PlatformAppConfig` / `InstallationCredentials` / `PlatformEvent` に Chat SDK の型を含めない。**
  この 3 つが platform 層の出入口のすべてで、どれも proxy 自身の型だけで書けることが、
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
  readonly responded: ReadonlyArray<{ growiId: string; growiLabel: string; value: T }>;
  readonly notResponded: ReadonlyArray<{ growiId: string; growiLabel: string; reason: 'timeout' | 'error' }>;
  /**
   * **チャンネル権限で配らなかった GROWI（要件 11.3）。**
   * これが無いと、3 台紐づくチャンネルで 1 台が許可されていないとき、
   * 利用者は残り 2 台の結果だけを見て「全部を検索した」と思う — **検索が黙って不完全になる。**
   */
  readonly excluded: ReadonlyArray<{ growiId: string; growiLabel: string; reason: 'not-permitted-in-channel' }>;
}

/** 宛先ごとに `requestId` と `growiId` を作り替えて配る */
export const fanOut: <T>(
  targets: ReadonlyArray<Relation>,
  build: (relation: Relation) => CommandRequest,
  options?: { readonly deadlineMs?: number },   // 既定 10000
) => Promise<FanOutOutcome<T>>;
```

- Invariants: `responded` が空でも例外を投げない（要件 3.5）
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
  sources: ReadonlyArray<{ growiId: string; growiLabel: string; weight: number; items: ReadonlyArray<SearchResultItem> }>,
  options?: { readonly k?: number; readonly limit?: number },
) => ReadonlyArray<{ item: SearchResultItem; growiId: string; growiLabel: string; score: number }>;
```

**単なる交互配置として実装しない。** `weight / (k + 順位)`（`k = 60`）の式のまま持つ。
GROWI ごとに文書集合が互いに素なので、重みが等しければ結果は交互配置と一致する。
重みを掛ける形で持つことで、アルゴリズムを変えずに要件 3.8 の調整ができる。
**関連度順ではない**ことは受け入れる。

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

**申告された URL の検証は `@growi/chat` の関数を使う**（protocol spec の「④ で申告された URL を検証する」）。
custom proxy 向けに、許す宛先を運用者が設定で明示できるようにする（`runtime/config.ts`）。

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
| `channel_permission` | `id`, `relation_id`, `command_name`, `scope`, `channels` | `(relation_id, command_name, scope)` 一意 |
| `pending_collection` | `correlation_id`, `relation_id`（**GROWI 選択中は空**）, `platform`, `channel_id`, `actor_account_id`, `command_name`, `invocation`(JSON), `collected`(JSON), `expires_at` | `correlation_id` 主キー。`(platform, channel_id, actor_account_id)` に索引 |

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

1. `fuseResults` — 重みが等しいと交互に並ぶこと。重みで順位が変わること。同点が `growiId` で安定すること（3.2・3.3・3.8）
2. `PlatformCapabilities` — 4 サービス × 9 能力がすべて埋まっていること。**`unverified` に対して `supports()` が `false`** を返すこと（1.2）
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
