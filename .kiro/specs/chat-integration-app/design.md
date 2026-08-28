# Technical Design — chat-integration-app

> umbrella spec: [chat-integration](../chat-integration/)。要件は umbrella の `requirements.md` が持つ。
> 通信契約・署名・チャンネル権限の判定は [chat-integration-protocol](../chat-integration-protocol/) が持つ。
> 設計判断の根拠（決定 1〜10）は umbrella の `research.md`。

## Overview

**Purpose**: GROWI 本体の Gen 2 連携。proxy から届くコマンドを既存の機能（検索・ページ作成・権限判定）へつなぎ、
GROWI 内のイベントを通知として送り、チャットの利用者を GROWI ユーザーへ紐付ける。

**Impact**: `apps/app/src/features/chat-integration/`（新規）。既存ファイルの変更は**通知の配り口と、保存時に宛先を指定する経路**（要件 2.2）。
**Gen 1（`packages/slack` と既存の `slack-integration`）には手を入れない。**

### Non-Goals

- チャットサービスとのやり取り（`chat-integration-proxy`）
- 通信契約・署名・権限判定そのもの（`chat-integration-protocol`）
- GROWI の検索の索引・クエリ・スコアリングの変更
- 既存のページ作成の処理そのものの変更

> **「呼ぶだけ」では済まない。** 検索結果を**返す前の絞り込み**と、ページ作成の**権限判定と重複の事前確認**は
> **この feature が持つ**（下記「既存の機能を呼ぶだけでは要件を満たせない」）。

---

## Boundary Commitments

### This Spec Owns

- `CommandEndpoint` — proxy から届くコマンドの処理（要件 3.6/3.7, 4, 5, 6, 14.2）
- **`content/`** — GROWI が送り出す中身の組み立てと、公開範囲による絞り込み（要件 2.1–2.3, 3.6, 3.7, 3.9, 5.2, 5.3, 6.2, 6.3, 14.2）
- **`ProxyClient`** — GROWI から proxy へ送る唯一の口
- `NotificationOutbox` と `NotificationDispatcher` — Gen 2 の宛先への通知（要件 2, 12.3）
- `DestinationRegistry` — 宛先の集合（Gen 1 / Gen 2 を種類で分岐しない。要件 12.2）
- `ChatAccountLink` — チャット利用者と GROWI ユーザーの紐付け（要件 7）
- `KeyStore`（GROWI 側の実装）— 自分の鍵と proxy の公開鍵（要件 9.5, 10.5）
- 管理画面と個人設定（要件 1.3, 11, 12.4, 12.5, 7.7）
- **GROWI 側の新しいデータの一覧と、その消し方**

### Out of Boundary

- **Gen 1 の実装。** `packages/slack`、`slack-integration.ts`、`slack-command-handler/*`、
  `User.slackMemberId` — いずれも読むだけで変更しない
- GROWI の検索の索引・クエリ・スコアリング、既存のページ作成の処理そのもの
  （**返す前の絞り込みと、ページ作成の権限判定・重複の事前確認はこの spec が持つ**）

### Allowed Dependencies

| 依存先 | 制約 |
|---|---|
| `@growi/chat` | 契約型・権限判定は `index.ts` から、署名は `server.ts` から。**client 側は `index.ts` だけ** |
| GROWI 既存の検索サービス・ページ作成・権限判定 | 呼ぶ。**返す前の絞り込みはこの spec が足す**（実装は変えない） |

### Revalidation Triggers

- `@growi/chat` の契約が変わったとき
- GROWI 本体の検索・権限判定の呼び出し契約が変わったとき（要件 3.6 / 3.7 が影響を受ける）

---

## File Structure Plan

```
apps/app/src/features/chat-integration/
├── server/
│   ├── command/
│   │   ├── command-endpoint.ts        # CommandRequest の 5 種を処理
│   │   ├── resolve-actor.ts           # actor → GROWI ユーザー + 所属グループ
│   │   └── handlers/                  # search / create-page / keep / link-preview / help
│   ├── content/                       # ★ GROWI が送り出す中身を組み立てる
│   │   ├── index.ts                   # この層の公開窓口
│   │   ├── notification-content.ts    # 6 イベントぶんの文面（要件 2.1・2.2）
│   │   ├── search-result-mapper.ts    # 検索結果 → SearchResultItem（要件 3.9）
│   │   ├── link-preview-mapper.ts     # ページ → 要約（要件 6.2・6.3）
│   │   ├── help-content.ts            # このバージョンが提供するコマンド（要件 14.2）
│   │   ├── conversation-page.ts       # ★ 発言列 → ページ本文（要件 5.2・5.3）
│   │   ├── viewer-page-filter.ts      # ★ 「この利用者が見てよいか」（要件 3.6・3.7）
│   │   └── public-page-filter.ts      # ★ 「誰でも見られるページか」（要件 2.3・6.3）
│   ├── notification/
│   │   ├── notification-outbox.ts     # ★ 送るべき通知を書き留める
│   │   ├── notification-dispatcher.ts # ★ 書き留めた分を proxy へ送り、結果を書き戻す
│   │   └── destination-registry.ts    # 宛先の集合（Gen 1 / Gen 2 を種類で分岐しない）
│   ├── account-link/
│   │   ├── account-link-service.ts    # 紐付けの開始・承認・解除
│   │   └── models/chat-account-link.ts
│   ├── keys/
│   │   ├── key-store.ts               # KeyStore の GROWI 側の実装
│   │   └── models/chat-integration-key.ts
│   ├── signature-guard.ts             # proxy から届くリクエストの検証（要件 10.1–10.4）
│   ├── proxy-client.ts                # GROWI → proxy の唯一の口（署名を付ける）
│   ├── pairing/
│   │   ├── pairing-endpoint.ts        # 保留中の登録コードと突き合わせて確認に答える
│   │   └── models/pending-pairing.ts
│   └── models/
│       ├── chat-relation.ts
│       ├── chat-notification-destination.ts
│       ├── chat-processed-request.ts
│       └── chat-request-nonce.ts
├── client/
│   ├── AdminChatIntegration/          # 要件 1.3, 11, 12.4, 12.5
│   └── MeChatAccountLinks/            # 要件 7.7
└── interfaces/
```

### Modified Files（既存）

| ファイル | 変更内容 |
|---|---|
| `server/service/global-notification/index.ts` | **Gen 2 の宛先を既存の `Promise.all` の外に足す**（Gen 1 の 2 つの宛先の呼び方には手を入れない）。種類で分岐せず `DestinationRegistry` を回す形にするのは Gen 2 側だけ（要件 12.2・12.3） |
| `server/service/user-notification/index.ts` | Slack 未設定で例外を投げる作りなので、Gen 2 の宛先だけでも成立するようにする |
| `server/routes/apiv3/`（新規 1 ファイル） | Gen 2 の受け口。既存の `slack-integration.js` は変更しない |
| `server/routes/apiv3/page/create-page.ts` / `update-page.ts`、`routes/comment.js` | **要件 2.2 の入力経路。** 現在は `isSlackEnabled` と `slackChannels`（カンマ区切りの名前）を読むが、Gen 2 は platform と channelId が要る。**Gen 1 の項目は残したまま** Gen 2 の宛先を別項目で受ける |
| `client/components/SlackNotification.tsx`（または Gen 2 用の新規部品） | 保存時に宛先を選ぶ UI。Gen 2 はチャンネルを **id で選ぶ**ので、`ProxyClient` 経由でチャンネルの一覧を取る |
| `apps/app/package.json` | `@growi/chat` を `workspace:^` で追加 |
| `apps/app/turbo.json` | **`@growi/chat#build` への依存を宣言する。** 同じリポジトリ内の build を作る依存が増えたら書き足す決まりである（`.claude/rules/project-structure.md`）。書かないと build の順序が狂い `dist/` が無い状態で型エラーになる |
| `server/crowi/express-init.js` | **`bodyParser.json` より前に**この feature のパスだけ `express.raw` を通す（上記「署名の検証には届いたバイト列そのものが要る」） |
| `pages/admin/*.page.tsx`（新規） | 管理画面は feature の外に薄い受け皿が要る（Next.js の Pages Router の決まり） |
| `components/Admin/Common/AdminNavigation.tsx` | **手作業の追記が 3 か所**（`MenuLabel` の分岐、一覧、スマートフォン用の一覧）。データ駆動になっていないので漏れやすい |

---

## Components and Interfaces

| Component | File | Intent | Req Coverage |
|---|---|---|---|
| `NotificationContent` | `server/content/notification-content.ts` | 6 イベントぶんの通知の文面 | 2.1, 2.2, 2.3 |
| `SearchResultMapper` | `server/content/search-result-mapper.ts` | 検索結果を構造化データへ（日時は RFC 3339 の UTC 表記） | **3.9** |
| `LinkPreviewMapper` | `server/content/link-preview-mapper.ts` | ページを要約へ | 6.2, 6.3 |
| `DestinationRegistry` | `server/notification/destination-registry.ts` | 宛先の集合。**種類で分岐しない** | 12.2, 12.3 |
| `HelpContent` | `server/content/help-content.ts` | このバージョンが提供するコマンド | 14.2 |
| `ConversationPage` | `server/content/conversation-page.ts` | 発言列をページ本文へ組み立てる | 5.2, 5.3 |
| `ViewerPageFilter` | `server/content/viewer-page-filter.ts` | **相手による判定** — この利用者が見てよいページだけを残す | 3.6, 3.7 |
| `PublicPageFilter` | `server/content/public-page-filter.ts` | **相手によらない判定** — 誰でも見られるページか | 2.3, 6.3 |
| `CommandEndpoint` | `server/command/command-endpoint.ts` | proxy からのコマンドを処理 | 3.6, 3.7, 4.2–4.6, 5.2, 5.3, 6.2, 6.3, 14.2 |
| `ResolveActor` | `server/command/resolve-actor.ts` | actor → GROWI ユーザー | 3.6, 3.7, 4.3, 4.4, 7.6 |
| `NotificationOutbox` | `server/notification/notification-outbox.ts` | 送るべき通知を書き留める | 2.1–2.3, 2.5, 2.6 |
| `NotificationDispatcher` | `server/notification/notification-dispatcher.ts` | 送って結果を書き戻す | 2.4, 10.4, 10.7 |
| `ChatAccountLink` | `server/account-link/` | 紐付け | 7.1–7.7 |
| `KeyStore` | `server/keys/key-store.ts` | 鍵の保持と入れ替え | 9.5, 10.5, 10.6 |
| `SignatureGuard` | `server/signature-guard.ts` | 届くリクエストの検証 | 10.1–10.4 |
| `ProxyClient` | `server/proxy-client.ts` | **GROWI から proxy へ送る唯一の口**（通知・ペアリングの申請・設定の反映・鍵の登録と失効・能力の一覧・チャンネルの一覧） | 1.3, 2.1–2.6, 9.5, 10.5, 11.1, 11.2, 11.4 |
| `PairingEndpoint` | `server/pairing/pairing-endpoint.ts` | 所有確認に答える | 9.2, 9.3 |

---

### CommandEndpoint

```typescript
export interface ResolvedActor {
  /**
   * 紐付いていない、**または GROWI ユーザーとして操作できる状態にない**ときは `null`。
   * 「行が引けたか」ではなく「操作してよいか」で決める（下記）
   */
  readonly user: IUser | null;
  readonly userGroups: ReadonlyArray<ObjectIdLike>;   // `user` が null なら空
  /** 書き込みを断る理由。`user` があっても読み取り専用なら書き込みだけ断る */
  readonly writeDenied: 'not-linked' | 'read-only' | null;
}

export interface CommandEndpoint {
  handle(request: CommandRequest): Promise<CommandResponse>;
  /** `ChatAccountRef` に workspace の軸は無いので、`relationId` も受け取る（一意キーに入っているため） */
  resolveActor(relationId: string, actor: ChatAccountRef): Promise<ResolvedActor>;
}
```

- Preconditions: 署名の検証と `(relationId, requestId)` の重複判定を通過している
- Preconditions: **`handle` の冒頭で `@growi/chat` の `judge` を `CommandEnvelope.channel` で通す**（要件 11.3）
- Postconditions: 例外を投げず、必ず `CommandResponse` を返す
- Invariants: **`resolveActor` が `user: null` のときは書き込みを実行しない**（要件 4.4 / 7.6）
- Invariants: **`writeDenied` が `null` でないときは書き込みを実行しない。**
  `'not-linked'` は要件 7.6 の案内（`account-link-required`）へ、`'read-only'` は `forbidden` へ落とす

#### `resolveActor` は「行が引けたか」では決められない（実コードで確認）

**紐付けの行が引けても、その GROWI ユーザーが操作してよいとは限らない。**
GROWI が画面からの操作に対して掛けている確認が 2 つあり、どちらも `chat_account_links` には現れない。

| 確認 | 実コード | 落ちる状態 |
|---|---|---|
| **利用者の状態が「有効」であること** | `middlewares/login-required.ts:45-47` が `status === UserStatus.STATUS_ACTIVE` の人だけ先へ通す | 承認待ち(1) / 停止(3) / 削除(4) / 招待中(5)（`models/user/conts.ts:1-8`） |
| **読み取り専用でないこと** | `middlewares/exclude-read-only-user.ts:20-29` が `user.readOnly` なら断る | 読み取り専用の利用者 |

実際の並びは `accessTokenParser → loginRequiredStrictly → excludeReadOnlyUser → addActivity`
（`routes/apiv3/page/create-page.ts:301-306`）。

**この 2 つを落とすと、GROWI の画面からは何もできない人が、チャットからだけは操作できる。**
停止した人・退職して削除扱いにした人が**ページを作れ、その人の閲覧権限で検索できる**。
検索結果はチャンネルへ投稿されるので、**その人だけが読めたページのパスとタイトルがチャンネル全員の目に触れる。**
運用者から見て食い違いに気づく手がかりが無い。

→ **`resolveActor` の後条件**:
- `status !== STATUS_ACTIVE` なら **`user` を `null` として扱う**（読み取りも紐付いていない扱いになる）
- `user.readOnly` が真なら `user` は返すが **`writeDenied: 'read-only'`** を立てる（検索は本人の権限で通す）
- 条件は自前で書かず、`excludeReadOnlyUser` と同じ判定を**1 か所から共有する**
  （`.claude/rules/coding-style.md`「枠組みに寄った包み込みから素の関数を切り出す」）

#### 既存の機能を呼ぶだけでは要件を満たせない（実コードで確認）

**検索（要件 3.6 / 3.7）** — `searchKeyword` を 5 引数で正しく呼んでも足りない。
絞り込みを作っている `filterPagesByViewer`（`server/service/search-delegator/elasticsearch.ts:1331-1398`）は
2 つの設定値で分岐し、**その既定値は両方 `false`**（`config-manager/config-definition.ts:809-814`）。
既定のままだと `showPagesRestrictedByOwner` と `showPagesRestrictedByGroup` が真になり、
**`user` と `userGroups` を見る分岐に一度も入らない。** 除かれるのはリンクを知っている人だけが読めるページだけで、
`canShowSnippet`（`search.ts:869-896`）は本文の抜粋を消すだけなので**パスとタイトルは残る**。

**Gen 2 の検索結果はチャンネルへ投稿される**ので、そこに居る全員が見る。
Gen 1 の `/growi search` は既定設定のまま非公開ページのパスをチャンネルに出しており
（`slack-command-handler/search.js:48-63` は `formatSearchResult` すら通っていない）、
**「Gen 1 の呼び方を正す」だけでは同じ状態が残る。**

→ **この feature が、返す前にページごとの公開範囲を見て落とす段を持つ。** ただし次の 3 つを決めないと実装できない。

**規則** — **`PageQueryBuilder.addConditionToFilteringByViewer` と同じ判定にする。**
**ただし第 3 引数（`includeAnyoneWithTheLink`）は既定の `false` のまま呼ぶ。**
参照実装として名前を挙げた `Page.isAccessiblePageByViewer` は `true` を渡しているので、
**そのまま写すとリンクを知っている人だけが読めるページがチャンネルに出る。**
一番近く見える `canShowSnippet`（`search.ts`）を写してはいけない — **両方向に間違っている**。
特定ユーザー限定（`GRANT_SPECIFIED`）は 4 つの分岐のどれにも当たらず最後の `return true` に落ちて**素通り**し、
グループ限定は `grantedGroups` の中身が `{ type, item }` の形なのに 24 桁の ID 文字列と比べているので**常に一致せず、
メンバー本人でも落ちる**。後者は安全な側に外れているため誰も気づいておらず、確かめるテストもリポジトリにない。

**材料** — **検索結果だけでは判断できない。** `createSearchQuery` が取り出すのは `path` / 各種の件数 /
`updated_at` / `tag_names` / `comments` だけで、`grant` も `grantedUsers` も `grantedGroups` も含まれない。
判定にはページ本体が要る。ヒットした id をまとめて 1 回問い合わせる — `Page.find({ _id: { $in: ids } }).and(generateGrantCondition(user, userGroups))`。
**`findPageListByIds` に絞り込みを足さない** — これは GROWI の通常の検索も使う共有の関数なので、
足すと本体の検索結果まで変わり Non-Goals に反する。`generateGrantCondition` は `export` されているので単体で使える。

**件数と順位** — `limit` 件取ってから落とすと、利用者が求めた件数に届かず `SearchResultItem.rank` に穴が空く。
proxy はこの `rank` を `weight / (k + 順位)` に入れて複数 GROWI の結果を混ぜるので、穴がそのまま最終的な並びに効く。
**`limit` の 3 倍を取ってから落とし、落とした後に順位を 1 から振り直す。** 3 倍でも足りなければ足りないまま返す。

**ページ作成（要件 4.5 / 4.6）** — `pageService.create`（`server/service/page/index.ts:4840`）が見るのは
パスの重複と公開範囲の整合性だけで、**「この人がここに書いてよいか」は判定していない**。
その判定は呼び出し口（`routes/apiv3/page/create-page.ts`）にあり、並びは
`accessTokenParser`（`:301`）→ `loginRequiredStrictly` → `excludeReadOnlyUser` → `addActivity` である。
`isCreatablePage` は middleware ではなく `determinePath` の中で呼ばれる素の関数である（`:75`, `:95`）。
またパス重複時の例外は `Error('Cannot process create')` という汎用のもので、**他の失敗と区別できない**。

→ **この feature が `isCreatablePage` と作成権限の判定、パス重複の事前確認を行い、
`path-conflict` と `forbidden` を区別して返す。**

**監査ログ（要件 7 の目的文・Adjacent expectations）** — GROWI が「誰が何をしたか」を記録するのは
サービスの中ではなく**入口の route** である。`create-page.ts` は `addActivity`（`:298`, `:304`）で
`res.locals.activity` を作り、作成の後に
`activityEvent.emit('update', res.locals.activity._id, { action: ACTION_PAGE_CREATE, contributor: req.user, ... })`
を出している（`:238-245`）。**`pageService.create` を直に呼ぶと、この経路をまるごと飛ばす。**

umbrella の `requirements.md` は Adjacent expectations に
「チャット経由の操作も他の操作と同じように記録されることを期待する」を挙げており、要件 7 の目的文も
「ページの履歴と**監査ログ**で追える」ことを掲げている。今のままだとページの履歴（revision の作者）には
残るが監査ログには残らない。**チャット経由は GROWI の外から入ってくる書き込みなので、
画面からの操作より記録が要る経路である。**

→ **書き込みを行うコマンド（`create-page` / `keep`）は、route と同じ形で Activity を出す。**

- `addActivity` は Express の middleware なので、**中身を素の関数として切り出し**、
  route とこの feature の両方から呼ぶ（`.claude/rules/coding-style.md`）
- **順序は `.claude/rules/activity-recording.md` に従う** — 応答を返す前に emit する
- **チャット経由であることと発言元のチャンネルを残す。** protocol 側も `CommandEnvelope.channel` を
  残す価値の 1 つとして監査ログを挙げている

**会話の取り込み（要件 5.2 / 5.3）** — `keep` は**書き込みを伴うコマンド**なので、
`create-page` について書いた 3 つ（権限の判定・パス重複の事前確認・再送への応答）が**そのまま要る**。
そのうえで、この 2 つの受け入れ条件が求めるものが別にある。

| 受け入れ条件 | 求めるもの | どう満たすか |
|---|---|---|
| 5.2 | 指定した範囲の発言をページとして保存する | proxy が `fetchHistory` で集めた `HistoryMessage` の列が `CommandRequest` に載って届く。**GROWI は集めに行かない**（チャットサービスに触れるのは proxy だけ） |
| 5.3 | 発言ごとに、投稿者に紐付いた GROWI ユーザーが居ればその人、居なければチャット上の表示名を記す | **発言ごとに引く。`resolveActor` は 1 人ぶんしか解決しない** |

→ **`content/conversation-page.ts` が発言列を本文へ組み立てる。**

- **投稿者の解決は発言ごと、まとめて 1 回。** 発言の数だけ問い合わせると、
  100 件の取り込みで 100 回引くことになる。**現れる `accountId` を重複を除いて集め、
  `chat_account_links` を `$in` で 1 回引く**
- **紐付いていない投稿者は、チャット上の表示名をそのまま書く。** GROWI ユーザーとして解決できない人を
  「不明」と書くと、要件 5.3 が求める「誰の発言か分かる」を満たさない
- **ページを作る人（`actor`）と、発言の投稿者は別である。** ページの作成者は `keep` を打った人であり、
  権限の判定もその人に対して行う。発言の投稿者は本文の中の記述にすぎない
- **範囲に発言が 1 件も無いとき**（要件 5.5）は proxy 側で打ち切られるので、GROWI には届かない

**再送への応答**: 処理済みの `(relationId, requestId)` には**1 回目の `CommandResponse` をそのまま返す**。
これをしないと 2 回目が `path-conflict` になり、利用者がページのリンク（要件 4.2）を受け取れない。

---

### 通知を 2 段に分ける（要件 2.4 / 2.5 の両立）

**この 2 つは 1 段では両立しない。** 要件 2.5 は「通知が失敗してもページ操作は完了させる」、
要件 2.4 は「投稿できなかったことを運用者が後から確認できる形で記録する」。
待たなければ結果を受け取れず、待てばページ操作が通知に引きずられる。

さらに**再送する主体が居ないと、`requestId` と proxy 側の `processed_request` が働かない**。
重複を取り除く仕組みだけがあって、受け止める相手が居ない状態になる。

```
① ページ保存の処理  →  chat_notification_outbox に 1 行書いてすぐ戻る（要件 2.5）
                          ↓
② NotificationDispatcher（別処理）
      → proxy へ送る → NotificationResult を受け取る → 行に書き戻す
      → 届かなければ間隔を空けてやり直す（同じ requestId・**まだ posted でない宛先だけ**。要件 10.4）
      → 諦めた分と bot-not-in-channel を運用者が見られる場所に残す（要件 2.4）
```

**文面は `NotificationContent` が作る。** `enqueue` が `markdown` を受け取るのは、
**非公開ページの本文を落とす作業を `PublicPageFilter` が済ませた後**だからである
（`containsRestrictedPage` は proxy への申し送りにすぎず、落とす場所ではない）。
Gen 1 では `server/util/slack.js`（202 行）が本文を 2000 文字で切って埋め込み、更新時は差分を作っていた。
その仕事は Gen 2 でもそのまま残る。

```typescript
export interface NotificationOutbox {
  /** ページ保存の処理から呼ぶ。**送信を待たない** */
  enqueue(entry: {
    relationId: string;
    targets: ReadonlyArray<{ platform: PlatformName; channelId: string }>;
    markdown: string;
    containsRestrictedPage: boolean;
  }): Promise<void>;
}

export interface NotificationDispatcher {
  /**
   * 未送信・再送待ちの行を処理する。
   *
   * **複数台のうち 1 台だけが実行する仕組みを、この feature が用意する必要がある。**
   * リポジトリに共有の分散ロックは無い（`server/service/cron.ts` は `node-cron` をそのまま回し、
   * `crowi/index.ts` は全インスタンスで無条件に起動する。`features/news` は最大 5 時間の
   * ランダムな待ち時間で散らしているだけで、`s2s-messaging` の redis 実装は警告を出す空実装）。
   * **MongoDB の条件つき更新（`findOneAndUpdate` で `state` を奪う）で 1 行ずつ排他する**のが最も軽い。
   * 行単位なので、複数台が同時に走っても同じ通知を 2 回送らない。
   *
   * **奪った印には期限を付ける（`claimedAt`）。** 期限が無いと、送っている途中で
   * プロセスが落ちた行が `sending` のまま**誰のものでもなくなり**、やり直しの対象にも
   * `given-up` にもならない。要件 2.4 が最も働いてほしい場面で働かなくなる。
   * 奪う条件は「`pending` の行」または「`sending` だが `claimedAt` が既定 5 分より古い行」。
   */
  drain(now: Date): Promise<{ sent: number; failed: number; givenUp: number }>;
}
```

- **誰が回すか。** GROWI には `state` の列を持つコレクションを定期的に回す形が既に 3 つある
  （`page-bulk-export` / `audit-log-bulk-export` / `growi-vault`。いずれも `server/service/cron.ts` の
  `CronService` を継承し、後者には `resilience/retry-policy.ts` もある）。**4 つ目を新しく起こさず
  `CronService` を継承する**（既定 1 分間隔）。やり直しの間隔は `growi-vault` の retry-policy に倣う
- **`requestId` は行を作るときに 1 度だけ採番し、再送しても変えない**（要件 10.4）
- **やり直しは宛先ごと。** proxy は `(relationId, requestId, platform, channelId)` の単位で記録するので、
  `posted` になった宛先は飛ばされ、失敗した宛先だけが再び試される。
  `(relationId, requestId)` だけで記録する形だと、**やり直しは記録を読み直すだけで投稿を一度も試みない**
- **署名は作り直す。** `requestId` は据え置くが `nonce` と `created` / `expires` は取り直す
  （protocol の `MessageSignature` の不変条件。しないと 2 回目が必ず `replayed` で弾かれる）
- 書き留める契機は 2 つ。**管理者がパス条件ごとに設定した通知**（要件 2.1）と、
  **編集した人がページの保存時に宛先を指定した通知**（要件 2.2）。どちらも同じ outbox に入る
- やり直しは間隔を空けて数回。上限を超えたら `given-up` として残す
- **宛先の集合を種類で分岐しない。** 既存の `GlobalNotificationSettingType` は `{ MAIL, SLACK }` の閉じた 2 値で、
  分岐は `routes/apiv3/notification-setting.js` の入力検査（`isIn(['mail','slack'])`）と種類の切り替え時の後始末、
  型の宣言（**`models/GlobalNotificationSetting/consts.ts:16-19` の 1 か所だけ**。
  `index.ts:177-180` は再輸出、`types.d.ts:5` は型の取り込み）、
  **クライアント側 4 ファイル**（`client/interfaces/global-notification.ts:1-6`、`GlobalNotificationList.jsx`、
  `NotificationTypeIcon.tsx`、`ManageGlobalNotification.tsx`）に散っている。
  なおクライアント側の宣言は server 側とは**別物**で、鍵の名前も食い違っている（`Email` 対 `MAIL`）。
  3 つ目を足す形は `.claude/rules/coding-style.md`「モード名で分岐しない」に反する。**宛先の集合を受け取って配る形へ寄せる**
- **既存の `Promise.all` を「他が落ちる」と読まない（実コードで確認）。** `.map()` がすべての送信を
  先に走らせるので、**止まるものは無い**。実際に起きているのは、**最初に失敗した 1 件で `Promise.all` が
  終わり、残りの成否が捨てられる**ことと、呼び出し側がそれを log の 1 行に飲み込むこと
  （`create-page.ts:262-264`、`update-page.ts:201-203`、`comment.js:397-399`）。
  つまり問題は「他が落ちる」ではなく**「結果が見えなくなる」**である
- **それでも Gen 1 の送信処理は変えない。** umbrella の `requirements.md` は Out of scope に
  「Gen 1 の実装の変更 — Gen 1 には手を入れない」を置いており、本 spec の Out of Boundary も
  Gen 1 は読むだけと書いている。**sub-spec の判断で umbrella の範囲は広げられない。**
  変えるべきだと考えるなら、先に umbrella 側を直す。
  Gen 2 の宛先は**既存の `Promise.all` の外**に足し、Gen 2 側だけが宛先ごとの成否を返す
  （要件 2.6 は Gen 2 に対する条件であり、Gen 1 の振る舞いを求めていない）
- **パス条件の突き合わせを二重に書かない。** 既存の `findSettingByPathAndEvent` が
  `generatePathsToMatch`（外へ出していない関数）で `/a/b/c → /a/b/c, /a/b/*, /a/*, /*` を作っている。
  **この関数を外へ出して共有する**

---

### 要件 12.4 — 宛先が重なるときの注意喚起

**Gen 1 側に workspace の識別子が無い。** `SlackAppIntegration` が持つのはトークン 2 本と権限の Map だけで、
どの Slack workspace につながっているかを保持していない（実コードで確認済み）。
したがって「Gen 1 と Gen 2 が同じ workspace か」を識別子で突き合わせることはできない。

**そこで判定はチャンネル名の一致で行う。**

- Gen 2 の宛先は `PairingResult.workspace`（`workspaceId` / `workspaceName`）を持つ
- Gen 1 の宛先は `slackChannels` の文字列だけを持つ
- **同じチャンネル名が Gen 1 と Gen 2 の両方の宛先にあれば、設定の時点で運用者に示す**

正確ではない（別の workspace に同名のチャンネルがあれば誤検知する）が、要件 12.4 が求めているのは
**設定の時点での注意喚起**であり、誤検知の側に倒すのが妥当である。
「判定できないので可能性があります」としか出せない形よりは実用に足る。

---

### ChatAccountLink

**Contracts**: Service [x] / State [x]

- 状態モデル: `{ relationId, userId, platform, accountId, linkedAt }`、**`(relationId, platform, accountId)` に複合ユニーク索引**
- **`User` に項目を足さない。** 要件 7.1 が 1 ユーザー対 N アカウントを求めるため別コレクションにする。
  Gen 1 の `User.slackMemberId` はそのまま残し、Gen 2 は参照しない
- **紐付けは GROWI ごとに成立する**（要件 7.2）。他の GROWI での紐付けには影響されない
- 本人確認（要件 7.3）: 利用者がチャットで紐付けを求めると、GROWI が**一度きり・短時間で失効するリンク**を
  その場限りのメッセージで返す。**GROWI にログインした状態で**そのリンクを開いて承認したときに成立する

#### 一度きりのリンクは既存の仕組みに倣う（新しく起こさない）

GROWI には同じ形のものが既に 3 つある（`models/password-reset-order.ts` /
`models/user-registration-order.ts` / `models/transfer-key.ts`）。**`password-reset-order.ts` を手本にする** —
`crypto.randomBytes(256)` で token を作り、`expiredAt` は 10 分後、`isRevoked` /
`isExpired()` / `revokeOneTimeToken()` を持つ。消費する route の手本は `routes/apiv3/forgot-password.ts`。

| 段 | 何をするか |
|---|---|
| 発行 | `AccountLinkStartRequest` を受けて `chat_account_link_orders` に 1 行作り、`linkUrl` と `expiresAt` を返す |
| 承認画面 | `pages/` に 1 枚。**ログイン必須**。**どのチャットアカウントを、どの GROWI ユーザーに結び付けるのかを画面に出す** — 出さないと利用者が取り違えたまま承認する。`workspaceName` と `platform` と表示名を `chat_relations` から引いて添える |
| 承認 | `chat_account_links` に書き、**同じトランザクションで token を失効させる**。既に別の利用者に紐付いていれば複合ユニーク索引が弾き、`taken-by-another-user` として扱う（要件 7.4） |
| 失効 | `expiredAt` の TTL 索引で自然に消える |
- 一意性の衝突（要件 7.4）は**複合ユニーク索引で**実現する。アプリ側の事前確認だけに頼らない
- 解除（要件 7.5）: 行を削除する。以降の書き込みは要件 7.6 の経路に落ちる
- **GROWI ユーザーが使えなくなったとき**: GROWI の利用者削除は文書を消さず `status` を
  `STATUS_DELETED`(4) に変えるだけである（`models/user/index.js:374-380`）。したがって
  **掃除の引き金は「文書が消えたとき」ではなく「`status` が `STATUS_ACTIVE` でなくなったとき」**にする。
  ただし行を消す必要は無い — `resolveActor` が状態を見て `user: null` にするので（上記）、
  **紐付けの行は残したままで安全**である。利用者が復帰したときに紐付け直さずに済む

---

## Data Models（GROWI / MongoDB）

**この spec が新しく作るコレクションの一覧と、それぞれ「いつ誰が消すのか」。**

| コレクション | 主な項目 | 索引・寿命 |
|---|---|---|
| `chat_relations` | `relationId`, `proxyUri`, `platform`, `workspaceId`, `workspaceName`, `label`, `state`, `settingsVersion`, `createdAt` | `relationId` 一意。**これが無いと送り先も分からない**（下記）。**紐付け解除（要件 9.7）では削除せず `state: 'unpaired'` にする** — `workspaceId` を残さないと繋ぎ直しのときに紐付けを引き継げない。消すのは**鍵・チャンネル権限・宛先**だけ（秘密鍵を残さない目的はこれで満たせる） |
| `chat_account_links` | `relationId`, `userId`, `platform`, `accountId`, `linkedAt` | **`(relationId, platform, accountId)` 複合ユニーク**（下記）。**利用者が解除するまで残る。** 関係の解除では消さない（下記の再ペアリングを参照） |
| `chat_integration_keys` | `relationId`, `side`(`own`/`peer`), `keyId`, `key`, `validFrom`, `revokedAt` | `(relationId, side, keyId)` 一意。**紐付け解除で削除**（秘密鍵を残さない） |
| `chat_notification_outbox` | `requestId`, `relationId`, `targets`, `markdown`, `state`, `attempts`, `result`, `createdAt` | `state` に索引。**送信済みは 30 日で TTL 索引により消す**。`given-up` は運用者が確認するまで残す |
| `chat_processed_requests` | `relationId`, `requestId`, `response`, `processedAt` | `(relationId, requestId)` 一意。**TTL 索引で 24 時間**（再送が起こりうる間だけ） |
| `chat_request_nonces` | `relationId`, `keyId`, `nonce`, `expiresAt` | `(relationId, keyId, nonce)` 一意。**`expiresAt` に TTL 索引** |
| `chat_pending_pairings` | `registrationCode`, `proxyUri`, `growiUri`, `createdBy`, **`ownKeyId`**, **`ownKeyPair`（暗号化）**, **`answerCount`**, **`answerWindowStartedAt`**, `expiresAt` | `registrationCode` 一意。**`expiresAt` に TTL 索引**。要件 9.2 の所有確認に使う。**答えた `challenge` は記録しない** — どの問いにも答える形にしたため（上記）。数えるのは**回数の上限**（1 分 30 回）だけ |
| `chat_account_link_orders` | `token`, `relationId`, `platform`, `accountId`, `isRevoked`, `createdAt`, `expiredAt` | `token` 一意。**`expiredAt` に TTL 索引**（既定 10 分）。要件 7.3 の一度きりのリンク。**`models/password-reset-order.ts` に倣う**（下記） |
| `chat_channel_permissions` | `relationId`, `commandName`, `allowedChannels` | **`(relationId, commandName)` 一意。** **行ごとの `updatedAt` は持たない** — protocol の `SettingsPushRequest.updatedAt` は関係ごとに 1 つの値なので、行ごとに持つと比べる基準が決まらない。版は `chat_relations.settingsVersion` に 1 つ持ち、**保存のたびに 1 増やす**。proxy が取りに来たときはそこから返す（要件 11.4） |
| `chat_notification_destinations` | `platform`, `channelId`, **`channelName`**, `pathPattern`, `triggerEvents`, `relationId` | `channelName` は表示と要件 12.4 の突き合わせ用。**`ChannelInventory` を引いたときに合わせて更新する**（名前は変わりうるので、古いままだと注意喚起が出たり出なかったりする）。管理者が設定する。Gen 1 の設定とは**別に保存する**（要件 12.2） |

#### ペアリングの途中に、自分の鍵を置く場所が要る（順序の矛盾）

protocol の手順 ⑤ で GROWI は **③ で申告した秘密鍵で `challenge` に署名する**。
つまり**鍵ペアは ③ を送る前に作って保存されていなければならない**。
ところが `chat_integration_keys` の一意キーは `(relationId, side, keyId)` で、
その **`relationId` は ⑥ で proxy が採番して初めて手に入る**。このままでは置き場所が無い。

→ **ペアリングの途中の鍵は `chat_pending_pairings` の行に持つ**（`ownKeyId` と暗号化した `ownKeyPair`）。
⑥ で `PairingResult.relationId` を受け取った時点で `chat_integration_keys` へ移し、保留の行は消す。

**⑤ で署名するのは `challenge` そのものではない。** protocol の `pairingChallengePayload()`
（`growi-chat-pairing-challenge:v1:` + **登録コード** + `challenge`）に署名する。
**`proxyUri` は入れない** — GROWI 側は管理者が入力した文字列、proxy 側は自分の設定値と出どころが違い、
1 文字ずれただけでペアリングが 1 度も成立しないため。**両側が同じ文字列を持っている値だけで組み立てる。**
proxy 間の持ち回しは、登録コード（proxy が発行し ④ で送り返される乱数）が既に塞いでいる。
`challenge` だけに署名すると、**⑤ が「相手の指定した文字列に、後で本番のリクエスト署名に使う同じ鍵で
署名して返す窓口」**になり、登録コードを見た第三者が RFC 9421 の署名対象文字列を投げ込んで
その GROWI 本人として通る署名を手に入れられる。

**⑤ は、保留中の登録コードが生きている限りどの `challenge` にも答える。**
答えた内容を覚えて次から断る形にはしない（protocol spec「⑤ に条件が要る理由」）。
守りは 3 つ — 用途を示す接頭辞、**保留 1 件あたり 1 分 30 回**の上限（超えたら 429）、
`challenge` が base64url の 32〜128 文字であること（外れたら 400）。

**「1 回だけ答える」「同じ問いにしか答えない」にすると、外から潰される。**
⑤ は誰でも叩ける口なので、**登録コードを見た第三者が本物の proxy より先に自分の `challenge` で叩けば、
本物の ④ が来たときには断られる。** やり直しても記録は変わらないので、その登録コードでは二度と成立しない。
答えられる問いの数に上限を置いても、攻撃の手数がその数になるだけである。
症状は保留の失効と同じ 410 なので、運用者は原因に辿り着けない。

回数を増やしても危なくならないのは、**接頭辞が付いた文字列が RFC 9421 の署名対象としては
絶対に現れない**からである。署名を何本集めても本番のリクエストには使えない。

**`OwnershipChallenge` には送り主を示す値が入っていない**（`registrationCode` と `challenge` の 2 つだけ）。
したがって「送信先の proxy や申告した `keyId` と突き合わせる」形の確認は**書いても実装できない**。
守りとして数えない。③ で申告した鍵は、⑤ が**その鍵で署名する**ことで縛る。

> **設定の保存は 1 つのトランザクションで行う。** 権限の行（`chat_channel_permissions`）と
> 版（`chat_relations.settingsVersion`）が別のコレクションなので、片方だけ書けた状態がありうる。
> **版だけ進むと proxy は古い設定を新しいものとして受け取る。**
> devcontainer の MongoDB はレプリカセットなのでトランザクションが使える。

#### GROWI 側の受け口（proxy から届くもの）

**署名が要る口は `SignatureGuard` を通し、その後 `@growi/chat` の検査関数で本文の形を確かめてから**処理する
（署名は「経路上で書き換えられていない」ことしか示さない）。検査関数は契約ごとにある（`parseCommandRequest` ほか）。
**すべて `POST`。** パスと `op` は protocol spec の「口の一覧」が持つ。

| 口（`op`） | パス | 中身 | 署名 | 要件 |
|---|---|---|:--:|---|
| `command` | `/chat-integration/command` | `CommandRequest` → `CommandResponse` | 要 | 3.6, 3.7, 4, 5, 6, 14.2 |
| `key-register` | `/chat-integration/keys/register` | `KeyRegistrationRequest` → `KeyOperationResult` | 要 | 10.5 |
| `key-revoke` | `/chat-integration/keys/revoke` | `KeyRevocationRequest` → `KeyOperationResult`。**有効な鍵が 0 本になる要求は `would-leave-no-valid-key` で断る** | 要 | 10.5 |
| `settings-pull` | `/chat-integration/settings` | `{ relationId, op }` → `SettingsPullResponse` | 要 | 11.4 |
| `account-link-start` | `/chat-integration/account-link/start` | `AccountLinkStartRequest` → `AccountLinkStartResponse` | 要 | 7.3 |
| （署名なし） | `/chat-integration/pairing/challenge` | `OwnershipChallenge` → `ChallengeResponse` | **不要** | 9.2 |

**署名を確かめた後、`acceptEnvelope()` で本体の `relationId` と `op` を突き合わせてから処理する。**

**「所有の確認」だけが署名なし。** 鍵がまだ無い時点の口なので署名で守れない（protocol の「署名の付かない唯一の入口」）。
守るのは**保留中の登録コードとの一致**と、**用途を示す接頭辞つきの文字列に署名すること**、
そして**口ごとの回数の上限**（保留 1 件あたり 1 分 30 回）である。

> **「1 つの保留につき 1 回だけ答える」「同じ問いにしか答えない」という形にしてはいけない。**
> ⑤ は誰でも叩ける口なので、**登録コードを見た第三者が本物の proxy より先に自分の `challenge` で叩けば、
> その登録コードでは二度とペアリングできなくなる。** 保留が生きている間は**どの `challenge` にも答える**
> （protocol spec「⑤ に条件が要る理由」）。

#### 署名の検証には**届いたバイト列そのもの**が要る（実コードで確認）

`content-digest` は本文のバイト列に対するハッシュなので、`verify` には**解析前のバイト列**を渡す必要がある。
ところが GROWI は `bodyParser.json({ limit: '50mb' })` を**アプリ全体に、すべての router より前に**
登録している（`server/crowi/express-init.js:116-117`）。router へ処理が回った時点で本文は読み終わっており、
残っているのは解析済みの JavaScript の値だけである。

**Gen 1 の書き方は写せない。** `routes/apiv3/slack-integration.js:41-48` は router の中で
`req.on('data', ...)` を後から付けているが、上の全体設定が読み切った後なので**何も拾わない**。
さらに受け取った塊を**文字列として足し込んでいる**ので、日本語のように複数バイトの文字が塊の境目で
分かれると壊れる。Gen 2 は `create-page` の本文と `keep` の発言列を運ぶので、まさにその大きさになる。

→ **この feature の router だけ、全体の JSON 解析より前に生のバイト列で受ける。**

```javascript
// server/crowi/express-init.js — bodyParser.json より前に置く
app.use(
  '/_api/v3/chat-integration',
  express.raw({ type: 'application/json', limit: '10mb' }),
);
```

`express.raw` は `req.body` に `Buffer` を入れ、`req._body` を立てる。
後続の `bodyParser.json` は `req._body` が立っている要求を飛ばすので、**既存の経路には影響しない。**
署名を確かめた後、この feature が自分で `JSON.parse` する。

- **`Buffer` のまま扱う。** 文字列に足し込まない（複数バイトの文字が壊れる）
- **解析した値から本文を組み立て直してハッシュを取らない。** 鍵の並び順や数値の書き方が
  送信時と一致する保証が無く、**正しい相手が弾かれる**。Gen 1 の
  `packages/slack/src/middlewares/verify-slack-request.ts:52-57` がこの形になっているが、写さない
- 上限を 10mb にするのは、この口が運ぶのがページ 1 枚ぶんの本文だからである（全体の 50mb は要らない）

`ProxyClient`（GROWI → proxy）が送るもの:

| 送るもの | 型 | 要件 |
|---|---|---|
| 通知 | `NotificationRequest` → `NotificationResult` | 2.1–2.6 |
| ペアリングの申請 | `PairingSubmission` → `PairingResult` | 9.1–9.5 |
| 設定の押し込み | **`SettingsPushRequest`**（`updatedAt` つき） | 11.1, 11.2, 11.4 |
| 鍵の追加・失効 | `KeyRegistrationRequest` / `KeyRevocationRequest` → `KeyOperationResult` | 10.5 |
| 能力の一覧 | → **`CapabilityReport`** | 1.3 |
| チャンネルの一覧 | → **`ChannelInventory`** | 2.2, 11.1（管理画面が宛先を選ぶため。**`channelName` が取れるので要件 12.4 の突き合わせもこれで解ける**） |

**設定を変えたら押し込む**（要件 11.4「次の実行から反映」はこれで満たす）。押し込みが失敗しても、
proxy が `SettingsPullResponse` で取りに来るので取りこぼしは埋まる。

#### 関係を表すコレクションが要る理由

`relationId` を持つ行はいくつもあるのに、**その `relationId` が何を指すのか**（どの proxy か、
どのチャットサービスのどの workspace か、表示名は何か）を保持する場所が無いと、次が成立しない。

- `NotificationDispatcher` が**どこへ送るか**を決められない（Gen 1 は設定値 `slackbot:proxyUri` を持っていた）
- ペアリングの手順 ③（GROWI が `PairingSubmission` を proxy へ送る）を行う部品が無い
- 鍵の入れ替え（10.5）で新しい公開鍵を proxy へ渡す経路が無い
- チャンネル権限（11.1・11.2）の保存先と、proxy へ反映する経路（11.4）が無い
- 使える機能の一覧（1.3）と、どちらの連携がどのサービスに繋がっているかの表示（12.5）の材料が無い

#### 紐付けの一意性に workspace の軸が要る

**Slack のメンバー ID はその workspace の中でだけ一意**である。1 つの GROWI に複数の連携先が紐づく前提
（要件 2.6・8.1。Gen 1 でも最大 10 件まで作れる）では、`(platform, accountId)` だけを一意にすると
**別の workspace の別人が、同じ GROWI ユーザーとして解決される。**

protocol spec が「`keyId` を単独で鍵にすると別の関係のものを引く」を最も間違えやすい箇所として挙げているのと
**同じ形の誤り**である。したがって `(relationId, platform, accountId)` を一意にする。

> **再ペアリングで紐付けを失わせない。** `relationId` は proxy が採番するので、一度解除して繋ぎ直すと値が変わる。
> `chat_account_links` の一意キーを `relationId` にすると、**繋ぎ直しただけで全利用者の紐付けが消える。**
> そこで**索引は `(relationId, platform, accountId)` にしつつ、繋ぎ直しのときに引き継ぐ** —
> 解除では `chat_relations` の行を消さず `state: 'unpaired'` にして `platform` と `workspaceId` を残し、
> 繋ぎ直したときに**同じ `platform` と `workspaceId` を持つ解除済みの行**を探して紐付けを新しい `relationId` へ移し、
> 古い行を消す。**行を消してしまうと、古い `relationId` がどの workspace のものだったか分からなくなり、引き継げない。**
>
> **引き継ぎ元が複数あるときは、いちばん新しい解除済みの行から引き継ぐ。**
> 移す途中で `(relationId, platform, accountId)` がぶつかったら**新しいほうを残す**。
> **解除済みの `chat_relations` の行そのものも 90 日で消す**（`chat_account_links` と揃える）。
> 90 日の掃除は `NotificationDispatcher` と同じく**条件つき更新で 1 台だけ**が回す。
>
> **`chat_account_links` を消すのは 3 つの場合だけ** — 利用者が解除したとき、GROWI ユーザーが削除されたとき、
> 引き継ぎ先が無いまま一定期間（既定 90 日）過ぎたとき。
>
> **要件 7.4 の「同じ GROWI 内で一意」との関係**: 同じ GROWI に 2 つの workspace が紐づくとき、
> 同じ `accountId` を別の利用者が取れる。**これは正しい振る舞い**（別の workspace の別人なので）。
> protocol の `taken-by-another-user` の注記もこの意味で読む。

> **要件 7.2（紐付けは GROWI ごと）とも噛み合う。** 同じ GROWI に 2 つの workspace が紐づくなら、
> 利用者はそれぞれについて紐付ける。

**鍵の識別子も `(relationId, keyId)` の組で扱う。** `keyId` 単独では別の関係の鍵を引きうる
（protocol spec の「鍵の識別子」を参照）。

#### 新しい model がいつ読み込まれるか

GROWI では feature の中の Mongoose model は **import された瞬間に `mongoose.model()` が走り、
そこで索引が作られる**（`autoIndex` を切っている場所は無い）。起動時にどこからも import されない
置き方をすると、**機能を最初に使うまで索引ができない** — この spec の複合ユニーク索引
（`chat_account_links` の `(relationId, platform, accountId)`）は要件 7.4 の実現手段なので、
索引が無い時間帯があると**その間だけ二重の紐付けが通る**。

→ **`features/growi-vault/server/index.ts` と同じ形にする。** feature の `server/index.ts` が
model を静的に import し、それが `routes/apiv3/index.js` から辿れるようにする。

**`setup-models.ts` の `setupIndependentModels()` に足すのは誤り。** これは起動経路ではなく、
インポートと復元の処理からしか呼ばれない。

#### 秘密鍵の暗号化は GROWI に前例が無いので、この spec が仕組みごと決める

暗号化する対象は `chat_integration_keys.key` のうち `side: 'own'` のものと、
`chat_pending_pairings.ownKeyPair` の 2 つである。

**既存の仕組みは使えない。** `config-manager` の `isSecret` は**画面で伏せ字にするだけ**で暗号化ではない
（`config-manager.ts:202-210`）。Gen 1 の `SlackAppIntegration` はトークンを**平文で持っている**。
proxy 側の「`runtime/config.ts` が環境変数から読む」も proxy の話で、GROWI には当てはまらない。

| 決めること | 決めた内容 |
|---|---|
| 暗号化に使う鍵の出どころ | **環境変数 `CHAT_INTEGRATION_KEY_ENCRYPTION_KEY`**（32 バイトを base64 で）。設定画面からは入れられないようにする — DB に入れると、DB を取られた人が暗号化した鍵も一緒に取れて意味が無くなる |
| 未設定のときの振る舞い | **ペアリングを始められない。** 管理画面に「環境変数が未設定である」ことを出す。**平文で保存に落とさない** |
| 方式 | `node:crypto` の AES-256-GCM。行ごとに 12 バイトの初期化ベクトルを作り、認証タグと一緒に保存する |
| 復号する場所 | **署名する関数の中だけ。** 他の層へは復号した値ではなく**署名する関数**を渡す（proxy 側と同じ形） |
| 入れ替え | 環境変数を変えたら、**古い鍵で復号して新しい鍵で入れ直す**移行を 1 本用意する。入れ替えの最中に読めない行が出ないよう、行に**どの世代の鍵で暗号化したか**を持たせる |

---

## Testing Strategy

### Unit Tests

1. `resolveActor` — 紐付いていれば GROWI ユーザーと所属グループを返し、いなければ `null` と空を返すこと（3.6・3.7）
2. **`searchKeyword` の引数の並び**を明示的に検証すること。引数がずれても型が通る形だったのが Gen 1 の欠陥（3.6）
3. `ViewerPageFilter` — 公開・特定ユーザー限定・所有者限定・グループ限定・リンク限定の 5 種について、
   紐付いている場合といない場合で落ちるものが正しいこと（3.6・3.7）
4. `PublicPageFilter` — 同じ 5 種について、**相手によらず**「誰でも見られる」ものだけが残ること（2.3・6.3）
5. `resolveActor` の状態の確認 — `status` が有効でない 4 種（承認待ち・停止・削除・招待中）で
   `user` が `null` になること。`readOnly` の利用者で `writeDenied: 'read-only'` が立ち、
   **検索は通り書き込みだけが断られる**こと（3.6・4.5・7.6）
6. `ConversationPage` — 発言ごとに、投稿者が紐付いていれば GROWI ユーザー名、
   いなければチャット上の表示名が使われること（5.3）
7. 再送への応答 — 同じ `(relationId, requestId)` の 2 回目に**1 回目の応答がそのまま返ること**（10.4・4.2）
8. 要件 12.4 の判定 — Gen 1 と Gen 2 に同じチャンネル名があれば注意喚起が出ること
9. **署名の検証に届いたバイト列が渡ること** — 鍵の並び順だけが違う同じ内容の JSON を送り、
   **解析して組み立て直した本文では通らない**こと（`content-digest` が一致しないこと）を確かめる。
   組み立て直す実装に戻ったら落ちる形にする（10.1）
10. **書き込みが監査ログに残ること** — `create-page` と `keep` の後に `Activity` が 1 件でき、
    操作した人とチャンネルが残ること（要件 7 の目的文）

### Integration Tests

1. **未紐付けの利用者の検索が、誰でも閲覧できるページだけを返すこと**（3.7）。
   **`hideRestrictedByOwner` などの設定を触らず、既定のまま走らせる。**
   既定では `filterPagesByViewer` の絞り込みが効かないので、設定を変えて通すテストは意味を持たない
2. 紐付け — チャットから開始 → リンクを開いて承認 → 成立。**他人が同じアカウントを紐付けようとすると拒まれること**（7.3・7.4）
3. **通知の 2 段** — proxy が応答しないとき、ページ保存は完了し（2.5）、行が再送待ちとして残り、
   やり直しの上限を超えたら運用者が確認できる形で残ること（2.4）
4. Gen 1 との併存 — Gen 2 を設定しても Gen 1 の通知先と設定が変わらないこと（12.2・12.3）
5. 署名の検証に失敗したリクエストが処理されず、記録が残ること。**その際 nonce の表が増えないこと**（10.2）
