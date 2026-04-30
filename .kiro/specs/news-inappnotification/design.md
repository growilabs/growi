# Design Document: news-inappnotification

## Overview

本機能は GROWI インスタンスが外部の静的 JSON フィード（GitHub Pages）を定期取得し、ニュースとして InAppNotification パネルに表示する。既存の通知（InAppNotification）とニュース（NewsItem）は別モデルで管理し、UI のみクライアント側で時系列マージして統合表示する。

**Purpose**: GROWI 運営者が配信するニュース（リリース情報、セキュリティ通知、お知らせ等）を、ユーザーが既存の通知導線から確認できるようにする。

**Users**: すべての GROWI ログインユーザー。ロール（admin/general）により表示対象を制御できる。

**Impact**: InAppNotification サイドバーパネルに「すべて/通知/お知らせ」フィルタタブと無限スクロールを追加する。既存の「未読のみ」トグルは維持し、フィルタタブとの2重フィルタリングを提供する。

### Goals

- 外部フィード（`NEWS_FEED_URL`）を cron で定期取得し、MongoDB にキャッシュする
- InAppNotification パネルで通知とニュースを統合表示する
- ニュースの既読/未読状態をユーザー単位で管理する
- ロール別表示制御（admin/general）をサーバーサイドで強制する
- 多言語ニュース（`ja_JP`, `en_US` 等）をブラウザ言語に応じて表示する

### Non-Goals

- GROWI 管理者によるニュース作成・編集 UI（フィードリポジトリで管理）
- リアルタイムプッシュ通知（cron ポーリングのみ）
- `growiVersionRegExps` 以外の条件によるフィルタ（将来フェーズ）
- RSS/Atom フォーマットへの対応（将来フェーズ）

---

## Architecture

### Existing Architecture Analysis

InAppNotification は per-user ドキュメント設計であり、`user` フィールドが必須。通知発生時に全対象ユーザー分のドキュメントを生成する（push 型）。ニュースは全ユーザーで1件のドキュメントを共有し、ユーザーがパネルを開いたときに取得する（pull 型）。この設計上の差異により、ニュースは別モデルとして実装する（詳細は `research.md` の Design Decisions を参照）。

サイドバーパネルは `Sidebar/InAppNotification/InAppNotification.tsx` が `useState` でトグル state を管理し、子コンポーネントへ prop として渡すパターンを採用している。本機能ではフィルタ state も同じく親で管理する。データ層（2 つの SWR ストリーム合流・マージ・mutation handlers）は責務集中による凝集度低下を避けるため `hooks/useMergedInAppNotifications.ts` のカスタムフックに集約し、Forms（フィルタ UI）と Content（リスト描画）のプレゼンテーションを分離する。

### Architecture Pattern & Boundary Map

```mermaid
graph TB
  GitHubPages[GitHub Pages\nfeed.json]
  NewsCron[NewsCronService]
  NewsItemModel[NewsItem Model]
  NewsReadModel[NewsReadStatus Model]
  NewsService[NewsService]
  NewsAPI[News API\napiv3/news]
  SidebarPanel[InAppNotification Panel\nSidebar/InAppNotification/]
  NewsHooks[useSWRINFxNews\nstores/news.ts]
  IANHooks[useSWRINFxInAppNotifications\nstores/in-app-notification.ts]
  InfScroll[InfiniteScroll Component]
  BadgeItem[PrimaryItemForNotification]

  GitHubPages -->|HTTP GET cron| NewsCron
  NewsCron -->|upsert / delete| NewsItemModel
  NewsAPI -->|delegates| NewsService
  NewsService -->|query| NewsItemModel
  NewsService -->|query / write| NewsReadModel
  SidebarPanel -->|fetch| NewsHooks
  SidebarPanel -->|fetch| IANHooks
  NewsHooks -->|apiv3Get| NewsAPI
  SidebarPanel -->|renders| InfScroll
  BadgeItem -->|count sum| NewsHooks
```

**Architecture Integration**:
- 選択パターン: Pull 型 + クライアントサイドマージ
- 新規コンポーネント: `NewsCronService`, `NewsItem Model`, `NewsReadStatus Model`, `NewsService`, `News API`, `NewsItem Component`, `useSWRINFxNews`, `useMergedInAppNotifications`（パネルのデータ層フック）, `InAppNotificationForms.tsx`, `InAppNotificationContent.tsx`
- 既存コンポーネント拡張: `InAppNotification.tsx`（フィルタ state 追加）, `useSWRINFxInAppNotifications`（新設）, `PrimaryItemForNotification`（未読カウント合算）, `InAppNotificationElm.tsx`（既存通知側の修正あり）
- スコープ拡張: `@growi/core` に `features.in_app_notification` を新設し、News API と既存 `/in-app-notification/*` の通知データ取得系エンドポイントを移行（設定 CRUD は `user_settings.in_app_notification` のまま）
- 既存 `InfiniteScroll.tsx` をそのまま再利用

### Technology Stack

| Layer | 選択 / バージョン | 役割 |
|---|---|---|
| Backend Cron | node-cron（既存） | フィード定期取得スケジューリング |
| Backend HTTP | node `fetch` / axios（既存） | `NEWS_FEED_URL` から feed.json 取得 |
| Data Store | MongoDB + Mongoose（既存） | NewsItem, NewsReadStatus の永続化 |
| Frontend Data | SWR `useSWRInfinite`（既存） | ニュース・通知の無限スクロール取得 |
| Frontend State | React `useState`（既存パターン） | フィルタタブ・未読トグルのローカル state |
| i18n | next-i18next / `commons.json`（既存） | UI ラベルの多言語化 |

---

## System Flows

### フィード取得フロー

```mermaid
sequenceDiagram
  participant Cron as NewsCronService
  participant Feed as GitHub Pages
  participant DB as MongoDB

  Cron->>Cron: getCronSchedule() = '0 0 * * *'（midnight 起動）
  Cron->>Cron: NEWS_FEED_URL 未設定? → スキップ
  Cron->>Cron: randomSleep（0–5 時間）でリクエスト時刻を分散
  Cron->>Feed: HTTP GET feed.json
  alt 取得失敗
    Cron->>Cron: ログ記録、既存 DB データ維持
  else 取得成功
    Cron->>Cron: growiVersionRegExps でフィルタ
    Cron->>DB: bulkWrite で一括 upsert（externalId キー、ordered:false）
    Cron->>DB: フィードにないアイテムを削除
  end
  Note over DB: TTL インデックス（90日）で自動削除
```

### パネル表示フロー

```mermaid
sequenceDiagram
  participant User
  participant Panel as InAppNotification Panel
  participant NewsAPI as News API
  participant IANAPI as InAppNotification API

  User->>Panel: パネルを開く
  Panel->>NewsAPI: useSWRINFxNews(limit, { onlyUnread, userRole })
  Panel->>IANAPI: useSWRINFxInAppNotifications(limit, { status })
  alt フィルタ = 'all'
    Panel->>Panel: 両データを publishedAt/createdAt で降順マージ
  else フィルタ = 'news'
    Panel->>Panel: NewsItem のみ表示
  else フィルタ = 'notifications'
    Panel->>Panel: InAppNotification のみ表示
  end
  Panel->>User: レンダリング
  User->>Panel: スクロール末端に達する
  Panel->>NewsAPI: setSize(size + 1)（次ページ fetch）
```

### 既読フロー

```mermaid
sequenceDiagram
  participant User
  participant Component as NewsItem Component
  participant API as News API
  participant DB as MongoDB

  User->>Component: クリック
  Component->>API: POST /apiv3/news/mark-read { newsItemId }
  API->>DB: NewsReadStatus upsert（userId + newsItemId）
  Component->>Component: SWR mutate（ローカルキャッシュ更新）
  Component->>User: url が存在すれば新タブで開く
```

---

## Requirements Traceability

| 要件 | Summary | コンポーネント | インターフェース | フロー |
|---|---|---|---|---|
| 1.1–1.7 | フィード定期取得 | NewsCronService | `executeJob()` | フィード取得フロー |
| 2.1–2.4 | NewsItem モデル | NewsItem Model | MongoDB schema | フィード取得フロー |
| 3.1–3.5 | 既読/未読管理 | NewsReadStatus Model, NewsService, News API | `POST /mark-read`, `GET /unread-count` | 既読フロー |
| 4.1–4.2 | ロール別表示制御 | NewsService | `listForUser(userRole)` | パネル表示フロー |
| 5.1–5.7 | UI 統合表示 | InAppNotification Panel, InAppNotificationForms, InAppNotificationContent, useMergedInAppNotifications | filter state props, フックの戻り値 | パネル表示フロー |
| 6.1–6.4 | 視覚表示 | NewsItem Component | CSS classes（`fw-bold`, `bg-primary`） | — |
| 7.1–7.2 | 未読バッジ | PrimaryItemForNotification | `useSWRxNewsUnreadCount` | — |
| 8.1–8.4 | 多言語対応 | NewsItem Component, locales | locale fallback logic | — |

---

## Components and Interfaces

### サーバーサイド

| コンポーネント | 層 | Intent | 要件 | 主要依存 |
|---|---|---|---|---|
| NewsCronService | Server / Cron | フィード定期取得・DB 同期 | 1.1–1.7 | CronService (P0), NewsService (P0) |
| NewsItem Model | Server / Data | ニュースアイテムの永続化 | 2.1–2.4 | MongoDB (P0) |
| NewsReadStatus Model | Server / Data | ユーザー既読状態の永続化 | 3.1–3.3 | MongoDB (P0) |
| NewsService | Server / Domain | ニュース一覧・既読管理のビジネスロジック | 3.4–3.5, 4.1–4.2 | NewsItem Model (P0), NewsReadStatus Model (P0) |
| News API | Server / API | HTTP エンドポイント提供 | 3.1–3.5, 4.1–4.2 | NewsService (P0) |

---

#### NewsCronService

| Field | Detail |
|---|---|
| Intent | フィード URL から JSON を定期取得し NewsItem を upsert/delete する |
| Requirements | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7 |

**Responsibilities & Constraints**
- 毎日 0 時に発火し、ランダムスリープで実取得時刻を 0–5 時に分散させる（cron 起動 `'0 0 * * *'` + `randomSleep(0–5h)`）
- `NEWS_FEED_URL` 未設定時はスキップ（エラーなし）
- 取得失敗時は既存 DB データを維持
- `growiVersionRegExps` の照合はここで実施（DB には合致アイテムのみ保存）

**配信先への分散戦略**:
全 GROWI インスタンスが同じ時間帯にフィードへアクセスするため、CDN ミス時に origin（GitHub Pages）へ集中する thundering herd を避ける必要がある。`'0 1 * * *'` + 5 分窓では実用上の希釈が小さいため、**5 時間ウィンドウ + 60 倍希釈**（対 5 分窓比）に拡張した。GitHub Pages の月間 100GB 帯域クォータと CDN キャッシュ TTL 10 分という外部条件を踏まえ、夜間帯 0–5 時に均等分散する設計。

**Dependencies**
- Inbound: node-cron — スケジュール実行（P0）
- Outbound: NewsService — upsert/delete（P0）
- External: `NEWS_FEED_URL` の HTTP エンドポイント — feed.json 取得（P0）

**Contracts**: Batch [x]

##### Batch / Job Contract
- Trigger: `node-cron` スケジュール `'0 0 * * *'`（実取得は randomSleep を経て 0–5 時に分散）
- Input: `NEWS_FEED_URL` 環境変数、GROWI バージョン文字列
- Output: MongoDB の NewsItem コレクションを最新フィードと同期
- Idempotency: `externalId` ユニークインデックスにより冪等。再実行しても重複なし

##### Service Interface
```typescript
class NewsCronService extends CronService {
  getCronSchedule(): string;  // '0 0 * * *'
  executeJob(): Promise<void>;
}

const MAX_RANDOM_SLEEP_MS = 5 * 60 * 60 * 1000;  // 5 hours
```

**Implementation Notes**
- Integration: `server/service/cron.ts` の `CronService` を継承。`startCron()` をアプリ起動時に呼ぶ
- Validation: `NEWS_FEED_URL` の URL 検証は以下のルールで行う。`https://` で始まる URL は常に許可。`http://localhost` または `http://127.0.0.1` で始まる URL はローカル開発用として許可。それ以外の `http://` は拒否する。`growiVersionRegExps` は try-catch で個別評価し、不正 regex はスキップ
- Risks: フィード取得タイムアウト（10秒推奨）。外部依存のため失敗を前提に設計する

---

#### NewsItem Model

| Field | Detail |
|---|---|
| Intent | フィードから取得したニュースアイテムを全ユーザー共通で1件保持する |
| Requirements | 2.1, 2.2, 2.3, 2.4 |

**Contracts**: State [x]

##### State Management
```typescript
interface INewsItem {
  _id: Types.ObjectId;
  externalId: string;                    // unique index
  title: Record<string, string>;         // { ja_JP: string, en_US?: string, ... }
  body?: Record<string, string>;
  emoji?: string;
  url?: string;
  publishedAt: Date;                     // index
  fetchedAt: Date;                       // TTL index (90 days = 7776000s)
  conditions?: {
    targetRoles?: string[];              // ['admin'] | ['admin', 'general'] | undefined
  };
}
```

**Indexes**:
- `externalId`: unique index（重複排除）
- `publishedAt`: index（降順ソート）
- `fetchedAt`: TTL index（90日で自動削除）

---

#### NewsReadStatus Model

| Field | Detail |
|---|---|
| Intent | ユーザーが既読にした時のみドキュメントを作成。ドキュメント不在 = 未読 |
| Requirements | 3.1, 3.2, 3.3 |

**Contracts**: State [x]

##### State Management
```typescript
interface INewsReadStatus {
  _id: Types.ObjectId;
  userId: Types.ObjectId;              // compound unique index with newsItemId
  newsItemId: Types.ObjectId;         // compound unique index with userId
  readAt: Date;
}
```

**Indexes**:
- `{ userId, newsItemId }`: compound unique index（重複防止・冪等性保証）

---

#### NewsService

| Field | Detail |
|---|---|
| Intent | ニュース一覧取得・既読管理のビジネスロジックを担う |
| Requirements | 3.4, 3.5, 4.1, 4.2 |

**Contracts**: Service [x]

##### Service Interface
```typescript
interface INewsService {
  listForUser(
    userId: Types.ObjectId,
    userRoles: string[],
    options: { limit: number; offset: number; onlyUnread?: boolean }
  ): Promise<PaginateResult<INewsItemWithReadStatus>>;

  getUnreadCount(userId: Types.ObjectId, userRoles: string[]): Promise<number>;

  markRead(userId: Types.ObjectId, newsItemId: Types.ObjectId): Promise<void>;

  markAllRead(userId: Types.ObjectId, userRoles: string[]): Promise<void>;

  upsertNewsItems(items: INewsItemInput[]): Promise<void>;

  deleteNewsItemsByExternalIds(externalIds: string[]): Promise<void>;
}

interface INewsItemWithReadStatus extends INewsItem {
  isRead: boolean;
}
```

- Preconditions: `userId` は有効な ObjectId
- Postconditions: `listForUser` の結果は `publishedAt` 降順。各アイテムに `isRead` が付与される
- ロールフィルタ: `conditions.targetRoles` が未設定または `userRoles` に一致するアイテムのみ返す

**`upsertNewsItems` の実装制約**:

配信側（`tmp/news-feed-delivery-spec.md`）でフィードアイテム数の上限は規定されない（運用の柔軟性を優先）。受信側 NewsItem の TTL（90 日）はフィードに残り続けるアイテムの `fetchedAt` が毎回更新されるため実質発火しない。よって items 配列は理論上無制限に成長しうる。実運用想定は 5 年で ~150–250 件だが上限保証は無い。

`Promise.all(items.map(NewsItem.updateMany))` での並列 fan-out は項目数増加時に DB コネクションプール圧迫・IO 飽和を招くため、**`NewsItem.bulkWrite([...], { ordered: false })` で 1 DB コマンドにバッチ化**する。`markAllRead` の `insertMany({ ordered: false })` と一貫したスタイル。

```typescript
async upsertNewsItems(items: INewsItemInput[]): Promise<void> {
  if (items.length === 0) return;
  const now = new Date();
  await NewsItem.bulkWrite(
    items.map(item => ({
      updateOne: {
        filter: { externalId: item.id },
        update: { $set: { ... fetchedAt: now } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}
```

---

#### News API

| Field | Detail |
|---|---|
| Intent | ニュース一覧取得・既読管理の HTTP エンドポイントを提供する |
| Requirements | 3.1, 3.4, 3.5, 4.1, 4.2 |

**Contracts**: API [x]

##### API Contract

| Method | Endpoint | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/apiv3/news/list` | `?limit&offset&onlyUnread` | `PaginateResult<INewsItemWithReadStatus>` | 401 |
| GET | `/apiv3/news/unread-count` | — | `{ count: number }` | 401 |
| POST | `/apiv3/news/mark-read` | `{ newsItemId: string }` | `{ ok: true }` | 400, 401 |
| POST | `/apiv3/news/mark-all-read` | — | `{ ok: true }` | 401 |

全エンドポイントに `loginRequiredStrictly` と `accessTokenParser` を適用する。

**Scope 設計**:

GROWI の scope 階層は以下の意味論で運用する：

| 階層 | 意味 | 例 |
|---|---|---|
| `user_settings.X` | ユーザーの **X 機能に関する設定値** の CRUD | `/personal-setting/in-app-notification-settings`（通知設定） |
| `features.X` | **X 機能のデータ自体** へのアクセス | `/pages/list`（ページデータ）, `/news/list`（ニュースデータ） |

通知データ取得は機能データへのアクセスに該当するため `features.in_app_notification` を新設し、News API 4 エンドポイントを移行する。あわせて既存 `/in-app-notification/*` の 4 エンドポイント（`list` / `status` / `open` / `all-statuses-open`）も同スコープへ移行（既存は `user_settings.in_app_notification` を誤用していた）。`/personal-setting/in-app-notification-settings` GET/POST は通知設定 CRUD なので `user_settings.in_app_notification` のまま維持する。

| Method | Endpoint | Scope |
|---|---|---|
| GET | `/apiv3/news/list` | `read:features:in_app_notification` |
| GET | `/apiv3/news/unread-count` | `read:features:in_app_notification` |
| POST | `/apiv3/news/mark-read` | `write:features:in_app_notification` |
| POST | `/apiv3/news/mark-all-read` | `write:features:in_app_notification` |

`@growi/core` の `SCOPE_SEED_USER.features.in_app_notification` 追加と、`accesstoken_scopes_desc` i18n（`en_US` / `ja_JP` / `zh_CN` / `fr_FR`）の更新が必要。

**Implementation Notes**
- Integration: `apps/app/src/features/news/server/routes/news.ts` に新規作成。`createNewsRouter(crowi?: Crowi)` をエクスポートし、optional `Crowi` で受けてテスト時にミドルウェアを pass-through できる構造（型アサーションは使わない）
- Validation: `newsItemId` は `mongoose.isValidObjectId()` で検証
- Risks: ロールフィルタはサーバーサイドで強制。クライアントから `targetRoles` を受け取らない

---

### クライアントサイド

| コンポーネント | 層 | Intent | 要件 | 主要依存 |
|---|---|---|---|---|
| useSWRINFxNews | Client / Hooks | ニュースアイテムの無限スクロール取得 | 5.4 | News API (P0) |
| useSWRxNewsUnreadCount | Client / Hooks | ニュース未読カウント取得 | 7.1 | News API (P0) |
| useSWRINFxInAppNotifications | Client / Hooks | 通知の無限スクロール取得（既存 hook を拡張） | 5.4 | InAppNotification API (P0) |
| useMergedInAppNotifications | Client / Hooks | パネルのデータ層（2 SWR + 終端判定 + 合成 response + マージ + 既読 mutation handlers） | 5.1–5.5 | useSWRINFxNews (P0), useSWRINFxInAppNotifications (P0) |
| InAppNotification.tsx（変更） | Client / UI | フィルタ state を追加管理 | 5.2, 5.3 | useState (P0) |
| InAppNotificationForms.tsx（新設） | Client / UI | フィルタタブ + 未読トグル UI | 5.2, 5.3 | — |
| InAppNotificationContent.tsx（新設） | Client / UI | 3 分岐レンダラー（all/news/notifications） + InfiniteScroll | 5.1, 5.4, 5.5 | useMergedInAppNotifications (P0), InfiniteScroll (P0) |
| NewsItem Component | Client / UI | ニュースアイテム1件の表示（`React.memo` で wrap） | 5.5, 5.6, 5.7, 6.1–6.4, 8.1–8.2 | — |
| PrimaryItemForNotification（変更） | Client / UI | 未読バッジに NewsItem の未読数を合算 | 7.1, 7.2 | useSWRxNewsUnreadCount (P0) |

---

#### useSWRINFxNews

| Field | Detail |
|---|---|
| Intent | ニュースアイテムの無限スクロールデータ取得 |
| Requirements | 5.4 |

**Contracts**: State [x]

##### State Management
```typescript
// stores/news.ts
export const useSWRINFxNews = (
  limit: number,
  options?: { onlyUnread?: boolean },
  config?: SWRConfiguration,
): SWRInfiniteResponse<PaginateResult<INewsItemWithReadStatus>, Error>;

export const useSWRxNewsUnreadCount = (): SWRResponse<number, Error>;
```

キー: `['/news/list', limit, pageIndex, options.onlyUnread]`

---

#### InAppNotification.tsx（変更）

| Field | Detail |
|---|---|
| Intent | フィルタタブ state を追加し、子コンポーネントへ伝播する |
| Requirements | 5.2, 5.3 |

**Implementation Notes**
- 既存 `isUnopendNotificationsVisible` state はそのまま維持
- `activeFilter: 'all' | 'news' | 'notifications'` を `useState('all')` で追加
- `InAppNotificationForms` と `InAppNotificationContent` へ prop を追加

```typescript
type FilterType = 'all' | 'news' | 'notifications';
```

---

#### InAppNotificationElm.tsx（既存・修正あり）

**実装後に判明した落とし穴**: 未読ドットに使われていた CSS クラス `grw-unopend-notification` はコードベースに定義が存在せず、ドットが不可視だった。`bg-primary rounded-circle` + インラインスタイル（`width/height: 8px, display: inline-block`）に置き換えて修正済み。このコンポーネントを今後変更する場合、同クラスを再導入しないこと。

---

#### Panel modules: Forms + Content + data hook

| Field | Detail |
|---|---|
| Intent | フィルタタブ UI とリスト描画を独立に保ち、データ層はカスタムフックに集約する |
| Requirements | 5.1, 5.2, 5.3, 5.4, 5.5 |

**Contracts**: State [x]

**ファイル構成**:

```
client/components/Sidebar/InAppNotification/
├── InAppNotification.tsx                  (フィルタ state を管理し props で配布)
├── InAppNotificationForms.tsx             (Forms UI のみ)
├── InAppNotificationContent.tsx           (3 分岐レンダラー)
└── hooks/
    └── useMergedInAppNotifications.ts     (データ層)
```

**設計原則**:
- **データ層と表示層を分離する**。`useMergedInAppNotifications` フックがニュース・通知の両 `useSWRInfinite` 呼び出し、ページ終端判定、合成 SWRInfiniteResponse の構築、マージ、既読 mutation handlers を一手に引き受ける。これにより `InAppNotificationContent` はフックの戻り値を受け取って `activeFilter` で 3 分岐するだけの薄い renderer になる
- **Forms はプレゼンテーションのみ**。データ層に触れない
- 単一ファイルで 7 責務（スクロール戦略・SWR 2 本・終端判定・合成 response・マージ・mutation 2 種・3 分岐 render）を抱えていた v1 の `InAppNotificationSubstance.tsx`（339 行）は廃止し、上記 3 モジュールに分割する

**InAppNotificationForms**:
- フィルタボタン（「すべて」「通知」「お知らせ」）を Bootstrap `btn-group` で実装
- 既存「未読のみ」トグルを維持

**InAppNotificationContent (3 分岐)**:
- `'all'`: `useMergedInAppNotifications.allModeSWRResponse` + `mergedItems` を `InfiniteScroll` に渡し、両ストリームをマージ表示
- `'news'`: `newsResponse` + `allNewsItems` のみ
- `'notifications'`: `notificationResponse` + `allNotificationItems` のみ
- 既存 `InfiniteScroll` コンポーネント（`client/components/InfiniteScroll.tsx`）を再利用
- 既存 `// TODO: Infinite scroll implemented` コメントを解消

**useMergedInAppNotifications フック**:

戻り値:
```typescript
{
  newsResponse, allNewsItems, newsExhausted,
  notificationResponse, allNotificationItems, notifExhausted,
  allModeSWRResponse, mergedItems,
  handleReadMutate, handleNotificationRead,
}
```

- `'all'` モード用の合成 `SWRInfiniteResponse`: `setSize` は終端に達していないストリームをインクリメント（両方未終端なら両方）、`isValidating` はいずれかが true なら true、両ストリーム終端時に `isReachingEnd = true`
- `mergedItems` は両ストリームの `flatMap → publishedAt/createdAt 降順 sort`
- ハンドラは `useCallback` で参照を安定化する。SWR の `mutate` は cache key 単位で stable なので、`{ mutate: mutateNews } = newsResponse` のように destructure して deps に含める（biome のルール対応）

**サイドバーモード別スクロール戦略**:

サイドバーには2種類のモードがあり、スクロール担当コンテナが異なる。

| モード | UI | スクロール担当 | コンテンツエリアの制約 |
|---|---|---|---|
| collapsed（ホバーパネル ①） | ベルアイコンにホバー時の小パネル | `InAppNotificationContent` 内の `overflow-auto` div | `maxHeight: 60vh` で高さを制限 |
| dock / drawer（全面サイドバー ②） | 展開した全面パネル | 外側の `SimpleBar`（`h-100`） | 制約なし。コンテンツが自然に伸長 |

collapsed モードで `overflow-auto + maxHeight` を使い、dock/drawer モードでは外していない場合、**二重スクロールコンテナ**が発生する。具体的には：
- `overflow-auto` div がサイドバーと同高の scroll context を作る
- スクロールバーがコンテンツ高さとほぼ同じ縦幅で出現し、わずかな余白でしか動かせなくなる（振動挙動）

対策として `InAppNotificationContent` 内で `useSidebarMode()` を呼び、`isCollapsedMode()` が true のときのみ `overflow-auto` クラスと `maxHeight: 60vh` を付与する。dock/drawer モードでは div に何も付与せず、SimpleBar にスクロールを委ねる。

**通知ドット即時消去: SWR mutate による楽観的更新**:

`InAppNotificationElm` はクリック時に `apiv3Post('/in-app-notification/open')` でサーバーへ書き込みを行うが、UI への反映は SWR キャッシュの即時書き換えで行う。`useMergedInAppNotifications.handleNotificationRead` 内で `mutateNotifications(updater, { revalidate: false })` を用い、`useSWRInfinite` のページごとに該当 `doc.status` を `STATUS_OPENED` へ書き換える。

`useSWRInfinite` のキャッシュは `SWRConfig` プロバイダの Map に保持されるため、同一 React tree のアンマウント／リマウントを跨いで状態が維持され、リマウント後もドットは消えたままとなる。ローカル `useState` を持たずに SWR の標準機能のみで完結させることで、キャッシュ・再検証制御・キー共有といった SWR の利点をそのまま活かせる。

品質改善の経緯: PR #10986 のレビュー FB を受け、当初採用した `useState<Set<string>>` 戦略を SWR `mutate` + `revalidate: false` に差し替えた。さらに PR #11050 で Substance 単一ファイル構造を Forms / Content / data hook の 3 モジュールに分割（凝集度向上）し、ハンドラを `useCallback` 化した。

---

#### NewsItem Component

| Field | Detail |
|---|---|
| Intent | ニュースアイテム1件を表示する（emoji、タイトル、未読インジケータ） |
| Requirements | 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 8.1, 8.2 |

**Implementation Notes**
- 配置: `features/news/client/components/NewsItem.tsx`
- **レイアウト**: 既存の `InAppNotificationElm` と同一カラム構成に揃える
  - 左端: 未読ドット（`bg-primary` 8px 丸）または同幅の透明スペーサー
  - アバター位置: `emoji` を表示（`UserPicture` が占める位置と同等）。未設定時は `📢` をフォールバック
  - コンテンツ列: タイトル（未読時 `fw-bold`、既読時 `fw-normal`）+ 公開日時
- ロケールフォールバック: `i18n.language → ja_JP → en_US → 最初に利用可能なキー`（`useTranslation()` から取得）
- 日付フォーマット: `date-fns` の `format` と `getLocale(i18n.language)` を用い、`ActivityListItem` と同じロケールパターンに統一
- Bootstrap クラス: `w-100 text-start bg-transparent fs-5 lh-1` などを利用し、インラインスタイルを最小化
- 未読ドット: `InAppNotificationElm` と共有の `UnreadDot.module.scss` を使用し、両者の見た目を完全に揃える
- クリック時: `POST /mark-read` + SWR mutate + `url` があれば新タブで開く
- **再レンダ最適化**: `export const NewsItem = memo(NewsItemInner)` で `React.memo` ラップ。親 `InAppNotificationContent` の再レンダ時、SWR が同一参照を返している `item` props と `useCallback` で参照安定化された `onReadMutate` props により、変化のないアイテムは再レンダされない。`<InAppNotificationElm>`（legacy 経路 `InAppNotificationDropdown` / `InAppNotificationPage` から共有される）の memo 化は本機能のスコープ外として将来 PR で対応

---

## Data Models

### Domain Model

```mermaid
erDiagram
  NewsItem {
    ObjectId _id
    string externalId
    object title
    object body
    string emoji
    string url
    Date publishedAt
    Date fetchedAt
    object conditions
  }
  NewsReadStatus {
    ObjectId _id
    ObjectId userId
    ObjectId newsItemId
    Date readAt
  }
  User {
    ObjectId _id
    string username
    string role
  }

  NewsReadStatus }o--|| User : "userId"
  NewsReadStatus }o--|| NewsItem : "newsItemId"
```

- NewsItem は全ユーザーで共有する集約ルート（per-instance、not per-user）
- NewsReadStatus は「ユーザーが既読にした」という事実のみを記録。削除によって「未読に戻す」ことも可能

### Physical Data Model

**NewsItem Collection** (`newsitems`):

```typescript
const NewsItemSchema = new Schema<INewsItem>({
  externalId: { type: String, required: true, unique: true },
  title: { type: Map, of: String, required: true },
  body: { type: Map, of: String },
  emoji: { type: String },
  url: { type: String },
  publishedAt: { type: Date, required: true, index: true },
  fetchedAt: { type: Date, required: true, index: { expires: '90d' } },
  conditions: {
    targetRoles: [{ type: String }],
  },
});
```

**NewsReadStatus Collection** (`newsreadstatuses`):

```typescript
const NewsReadStatusSchema = new Schema<INewsReadStatus>({
  userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  newsItemId: { type: Schema.Types.ObjectId, required: true, ref: 'NewsItem' },
  readAt: { type: Date, required: true, default: Date.now },
});
NewsReadStatusSchema.index({ userId: 1, newsItemId: 1 }, { unique: true });
```

### Data Contracts & Integration

**API レスポンス型**:

```typescript
interface INewsItemWithReadStatus {
  _id: string;
  externalId: string;
  title: Record<string, string>;
  body?: Record<string, string>;
  emoji?: string;
  url?: string;
  publishedAt: string;  // ISO 8601
  conditions?: { targetRoles?: string[] };
  isRead: boolean;
}

// PaginateResult<T> は ~/interfaces/in-app-notification の既存型を再利用する（再定義不要）
```

---

## Error Handling

### Error Strategy

フィード取得はフォールバック優先（失敗しても既存データを維持）。API エンドポイントは fail-fast（認証エラーは即時 401）。

### Error Categories and Responses

| カテゴリ | エラー | 対応 |
|---|---|---|
| Cron / External | フィード取得失敗（ネットワーク、タイムアウト） | `logger.error` + 既存 DB データ維持。次回 cron で再試行 |
| Cron / Config | `NEWS_FEED_URL` 未設定 | スキップ（ログなし）。設定されるまで無害に動作 |
| Cron / Validation | `growiVersionRegExps` に不正 regex | try-catch で該当アイテムをスキップ、`logger.warn` |
| API / Auth | 未認証リクエスト | 401（`loginRequiredStrictly` が処理） |
| API / Validation | 不正な `newsItemId` フォーマット | 400（`mongoose.isValidObjectId()` チェック） |
| API / Conflict | `mark-read` の重複呼び出し | upsert で冪等処理。エラーなし |

### Monitoring

- `NewsCronService.executeJob()` の成功/失敗を `logger.info` / `logger.error` で記録
- `mark-read` 件数を `logger.debug` で記録（デバッグ用）

---

## Testing Strategy

### Unit Tests

- `NewsCronService.executeJob()`: 正常取得 → upsert、取得失敗 → DB 変更なし、`NEWS_FEED_URL` 未設定 → スキップ
- `NewsCronService.executeJob()`: `growiVersionRegExps` 一致 → 保存、不一致 → 除外
- `NewsService.listForUser()`: `targetRoles` フィルタ（admin のみ、general 除外）
- `NewsService.listForUser()`: `onlyUnread=true` で未読のみ返す
- `NewsService.getUnreadCount()`: 未読件数の正確な計算

### Integration Tests

- `GET /apiv3/news/list`: ロール別フィルタが正しく動作する
- `POST /apiv3/news/mark-read`: 2回呼んでもエラーなし（冪等性）
- `POST /apiv3/news/mark-all-read` 後に `GET /apiv3/news/unread-count` が 0 を返す
- 未認証リクエストが 401 を返す

### Component Tests

- `NewsItem`: `emoji` 未設定時に 📢 が表示される
- `NewsItem`: `title` ロケールフォールバック（`browserLocale → ja_JP → en_US`）
- `NewsItem`: 未読時に `fw-bold` + 青ドット、既読時に `fw-normal` + スペーサー
- `InAppNotificationForms`: フィルタタブのクリックで `activeFilter` が変わる

---

## Security Considerations

- すべての `/apiv3/news/*` エンドポイントに `loginRequiredStrictly` を適用する
- アクセストークン用 scope は **`features.in_app_notification`** を使用する（read / write）。設定 CRUD 用の `user_settings.in_app_notification` とはセマンティクスが異なるため流用しない。アクセストークン発行時にユーザーが意図した粒度でアクセスを許可できるようにする
- `conditions.targetRoles` のフィルタリングはサーバーサイドの `NewsService.listForUser()` で強制する。クライアントから `targetRoles` パラメータを受け付けない
- `NEWS_FEED_URL` は `https://` で始まる URL は常に許可。`http://localhost` または `http://127.0.0.1` で始まる URL はローカル開発用として許可。それ以外の `http://` は拒否する
- フィードから取得したデータはそのまま DB に保存し、クライアントへのレスポンス時に Mongoose スキーマで型安全に扱う

## Performance & Scalability

**データ量とインデックス**:
- NewsItem は全ユーザーで1件共有のため、ユーザー数に比例してドキュメントが増えない
- `publishedAt` インデックスにより降順ソートが効率的
- `fetchedAt` TTL インデックス（90日）は **フィードから外れたアイテムにのみ実質発火** する（フィードに残り続けるアイテムは毎回 `fetchedAt` が更新されるため発火しない）。よってコレクションサイズの上限は配信側のキュレーションに依存する
- `NewsReadStatus` の compound unique index により `listForUser` の LEFT JOIN 相当クエリが効率的

**フィードアイテム規模の前提**:
- 配信側スキーマ（`tmp/news-feed-delivery-spec.md`）でフィードアイテム数の上限規定は設けない（運用の柔軟性を優先）
- 想定ペース: release 12–24 件/年、security/tips/maintenance/announcement 合わせて 30–50 件/年
- 5 年運用で **150–250 件程度** の見込み。ただし上限保証はないため、実装は無制限成長に耐える形で設計する

**書き込み戦略**:
- `NewsCronService.executeJob()` 内の upsert は `NewsItem.bulkWrite([...], { ordered: false })` で 1 DB コマンドにバッチ化。`Promise.all(items.map(updateMany))` の並列 fan-out は項目数増加時に DB コネクションプール圧迫・IO 飽和を招くため採用しない

**配信先への分散**:
- cron を `'0 0 * * *'` + `randomSleep(0–5 時間)` に設定し、複数 GROWI インスタンスのリクエストを夜間 5 時間ウィンドウに均等分散する
- `'0 1 * * *'` + 5 分窓と比較して **約 60 倍の希釈**。GitHub Pages の月間 100GB 帯域クォータ・10 分 CDN キャッシュ TTL に対して thundering herd を回避できる
- 即時性は不要（日次配信）であり、5 時間ウィンドウは UX への影響なし

**フロントエンド再レンダ**:
- `<NewsItem>` は `React.memo` ラップ。`useMergedInAppNotifications` のハンドラ群は `useCallback` で参照安定化されており、SWR が返す `item` 参照と組み合わせて、変化のないリスト項目は再レンダをスキップする
