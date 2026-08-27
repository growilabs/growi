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
- **`content/` の 5 部品** — GROWI が送り出す中身の組み立てと、公開範囲による絞り込み（要件 2.1–2.3, 3.6, 3.7, 3.9, 6.2, 6.3, 14.2）
- **`ProxyClient`** — GROWI から proxy へ送る唯一の口
- `NotificationSender` — Gen 2 の宛先への通知（要件 2, 12.3）
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
│   │   ├── notification-content.ts    # 6 イベントぶんの文面（要件 2.1・2.2）
│   │   ├── search-result-mapper.ts    # 検索結果 → SearchResultItem（要件 3.9）
│   │   ├── link-preview-mapper.ts     # ページ → 要約（要件 6.2・6.3）
│   │   ├── help-content.ts            # このバージョンが提供するコマンド（要件 14.2）
│   │   └── restricted-page-filter.ts  # ★ 非公開ページの本文を落とす唯一の場所（要件 2.3）
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
| `server/service/global-notification/index.ts` | `Promise.all([mail, slack])` を**宛先の集合を回す形へ**置き換える。Gen 1 の宛先の振る舞いは変えない（要件 12.2・12.3） |
| `server/service/user-notification/index.ts` | Slack 未設定で例外を投げる作りなので、Gen 2 の宛先だけでも成立するようにする |
| `server/routes/apiv3/`（新規 1 ファイル） | Gen 2 の受け口。既存の `slack-integration.js` は変更しない |
| `server/routes/apiv3/page/create-page.ts` / `update-page.ts`、`routes/comment.js` | **要件 2.2 の入力経路。** 現在は `isSlackEnabled` と `slackChannels`（カンマ区切りの名前）を読むが、Gen 2 は platform と channelId が要る。**Gen 1 の項目は残したまま** Gen 2 の宛先を別項目で受ける |
| `client/components/SlackNotification.tsx`（または Gen 2 用の新規部品） | 保存時に宛先を選ぶ UI。Gen 2 はチャンネルを **id で選ぶ**ので、`ProxyClient` 経由でチャンネルの一覧を取る |
| `apps/app/package.json` | `@growi/chat` を `workspace:^` で追加 |

---

## Components and Interfaces

| Component | File | Intent | Req Coverage |
|---|---|---|---|
| `NotificationContent` | `server/content/notification-content.ts` | 6 イベントぶんの通知の文面 | 2.1, 2.2, 2.3 |
| `SearchResultMapper` | `server/content/search-result-mapper.ts` | 検索結果を構造化データへ（日時は RFC 3339 の UTC 表記） | **3.9** |
| `LinkPreviewMapper` | `server/content/link-preview-mapper.ts` | ページを要約へ | 6.2, 6.3 |
| `HelpContent` | `server/content/help-content.ts` | このバージョンが提供するコマンド | 14.2 |
| `RestrictedPageFilter` | `server/content/restricted-page-filter.ts` | 公開範囲で落とす | 2.3, 3.6, 3.7, 6.3 |
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
  readonly user: IUser | null;                        // 紐付いていなければ null
  readonly userGroups: ReadonlyArray<ObjectIdLike>;   // 紐付いていなければ空
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
その判定は呼び出し口（`routes/apiv3/page/create-page.ts` の `loginRequiredStrictly` / `excludeReadOnlyUser` / `isCreatablePage`）にある。
またパス重複時の例外は `Error('Cannot process create')` という汎用のもので、**他の失敗と区別できない**。

→ **この feature が `isCreatablePage` と作成権限の判定、パス重複の事前確認を行い、
`path-conflict` と `forbidden` を区別して返す。**

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
**非公開ページの本文を落とす作業を `RestrictedPageFilter` が済ませた後**だからである
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
   */
  drain(now: Date): Promise<{ sent: number; failed: number; givenUp: number }>;
}
```

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
  型の宣言 2 か所（`models/GlobalNotificationSetting/index.ts` と `types.d.ts`）、
  **クライアント側 4 ファイル**（`client/interfaces/global-notification.ts`、`GlobalNotificationList.jsx`、
  `NotificationTypeIcon.tsx`、`ManageGlobalNotification.tsx`）に散っている。
  3 つ目を足す形は `.claude/rules/coding-style.md`「モード名で分岐しない」に反する。**宛先の集合を受け取って配る形へ寄せる**
- **「Gen 1 の振る舞いを変えない」との折り合い。** 既存の `Promise.all` は 2 階層あり
  （`global-notification/index.ts` と、宛先ごとのループである `global-notification-slack.ts` / `-mail.ts`）、
  どちらも 1 件失敗すると残りが止まる。**宛先ごとの成否を返す形へ寄せると Gen 1 の振る舞いも変わる。**
  ここは**変える**と決める — 1 件の失敗で他の宛先が落ちないことは Gen 1 にとっても改善であり、
  要件 2.6 が Gen 2 で求めるものと同じ形になる。**変えることを移行の注記に残す**
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
- 一意性の衝突（要件 7.4）は**複合ユニーク索引で**実現する。アプリ側の事前確認だけに頼らない
- 解除（要件 7.5）: 行を削除する。以降の書き込みは要件 7.6 の経路に落ちる

---

## Data Models（GROWI / MongoDB）

**この spec が新しく作るコレクションの一覧と、それぞれ「いつ誰が消すのか」。**

| コレクション | 主な項目 | 索引・寿命 |
|---|---|---|
| `chat_relations` | `relationId`, `proxyUri`, `platform`, `workspaceId`, `workspaceName`, `label`, `state`, `settingsUpdatedAt`, `createdAt` | `relationId` 一意。**これが無いと送り先も分からない**（下記）。**紐付け解除（要件 9.7）では削除せず `state: 'unpaired'` にする** — `workspaceId` を残さないと繋ぎ直しのときに紐付けを引き継げない。消すのは**鍵・チャンネル権限・宛先**だけ（秘密鍵を残さない目的はこれで満たせる） |
| `chat_account_links` | `relationId`, `userId`, `platform`, `accountId`, `linkedAt` | **`(relationId, platform, accountId)` 複合ユニーク**（下記）。**利用者が解除するまで残る。** 関係の解除では消さない（下記の再ペアリングを参照） |
| `chat_integration_keys` | `relationId`, `side`(`own`/`peer`), `keyId`, `key`, `validFrom`, `revokedAt` | `(relationId, side, keyId)` 一意。**紐付け解除で削除**（秘密鍵を残さない） |
| `chat_notification_outbox` | `requestId`, `relationId`, `targets`, `markdown`, `state`, `attempts`, `result`, `createdAt` | `state` に索引。**送信済みは 30 日で TTL 索引により消す**。`given-up` は運用者が確認するまで残す |
| `chat_processed_requests` | `relationId`, `requestId`, `response`, `processedAt` | `(relationId, requestId)` 一意。**TTL 索引で 24 時間**（再送が起こりうる間だけ） |
| `chat_request_nonces` | `relationId`, `keyId`, `nonce`, `expiresAt` | `(relationId, keyId, nonce)` 一意。**`expiresAt` に TTL 索引** |
| `chat_pending_pairings` | `registrationCode`, `proxyUri`, `growiUri`, `createdBy`, **`ownKeyId`**, **`ownKeyPair`（暗号化）**, **`answeredChallenge`**, **`answeredSignature`**, `expiresAt` | `registrationCode` 一意。**`expiresAt` に TTL 索引**。要件 9.2 の所有確認に使う |
| `chat_channel_permissions` | `relationId`, `commandName`, `allowedChannels` | **`(relationId, commandName)` 一意。** **行ごとの `updatedAt` は持たない** — protocol の `SettingsPushRequest.updatedAt` は関係ごとに 1 つの値なので、行ごとに持つと比べる基準が決まらない。時刻は `chat_relations.settingsUpdatedAt` に 1 つ持ち、proxy が取りに来たときはそこから返す（要件 11.4） |
| `chat_notification_destinations` | `platform`, `channelId`, **`channelName`**, `pathPattern`, `triggerEvents`, `relationId` | `channelName` は表示と要件 12.4 の突き合わせ用。**`ChannelInventory` を引いたときに合わせて更新する**（名前は変わりうるので、古いままだと注意喚起が出たり出なかったりする） | 管理者が設定する。Gen 1 の設定とは**別に保存する**（要件 12.2） |

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

**⑤ は「同じ問いには同じ答えを返す」。** 保留の行に**答えた `challenge` と返した署名を記録**し、
同じ `challenge` の再送には記録した署名をそのまま返す。違う `challenge` は 410。
記録は **`findOneAndUpdate` で `answeredChallenge` が未設定の行だけを取る**形にする —
ふつうの読み書きだと ④ が同時に 2 本届いたときに両方へ別々の署名を返す。

「1 回だけ答える」にすると**正常系が塞がる** — proxy の ④ には応答の待ち時間の上限があるので、
GROWI が重くて上限を超えると **GROWI は答えて印を付け、proxy は受け取れない**。
やり直すと 410 になり、**応答が遅い GROWI は何度やってもペアリングできない**。
`proxyUri` も同じ行に記録し、**⑤ で「送信先の proxy と自分が申告した `keyId`」を突き合わせる**（protocol の要求）。

> **設定の保存は 1 つのトランザクションで行う。** 権限の行（`chat_channel_permissions`）と
> 時刻（`chat_relations.settingsUpdatedAt`）が別のコレクションなので、片方だけ書けた状態がありうる。
> **時刻だけ進むと proxy は古い設定を新しいものとして受け取る。**
> devcontainer の MongoDB はレプリカセットなのでトランザクションが使える。

#### GROWI 側の受け口（proxy から届くもの）

**署名が要る口は `SignatureGuard` を通し、その後 `@growi/chat` の検査関数で本文の形を確かめてから**処理する
（署名は「経路上で書き換えられていない」ことしか示さない）。検査関数は契約ごとにある（`parseCommandRequest` ほか）。

| 口 | 中身 | 署名 | 要件 |
|---|---|:--:|---|
| コマンド | `CommandRequest` → `CommandResponse` | 要 | 3.6, 3.7, 4, 5, 6, 14.2 |
| 鍵の追加 | `KeyRegistrationRequest` → `KeyOperationResult` | 要 | 10.5 |
| 鍵の失効 | `KeyRevocationRequest` → `KeyOperationResult`。**有効な鍵が 0 本になる要求は `would-leave-no-valid-key` で断る** | 要 | 10.5 |
| 設定の取り出し | → `SettingsPullResponse` | 要 | 11.4 |
| 紐付けの開始 | `AccountLinkStartRequest` → `AccountLinkStartResponse` | 要 | 7.3 |
| 所有の確認 | `OwnershipChallenge` → `ChallengeResponse` | **不要** | 9.2 |

**「所有の確認」だけが署名なし。** 鍵がまだ無い時点の口なので署名で守れない（protocol の「署名の付かない唯一の入口」）。
守るのは**保留中の登録コードとの一致**と、**1 つの保留につき 1 回だけ答える**こと。

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

**保存時の暗号化**: `chat_integration_keys.key` のうち `side: 'own'`（秘密鍵）は暗号化する。

---

## Testing Strategy

### Unit Tests

1. `resolveActor` — 紐付いていれば GROWI ユーザーと所属グループを返し、いなければ `null` と空を返すこと（3.6・3.7）
2. **`searchKeyword` の引数の並び**を明示的に検証すること。引数がずれても型が通る形だったのが Gen 1 の欠陥（3.6）
3. `RestrictedPageFilter` — 公開・特定ユーザー限定・所有者限定・グループ限定・リンク限定の 5 種について、
   紐付いている場合といない場合で落ちるものが正しいこと（3.6・3.7・2.3・6.3）
4. 再送への応答 — 同じ `(relationId, requestId)` の 2 回目に**1 回目の応答がそのまま返ること**（10.4・4.2）
5. 要件 12.4 の判定 — Gen 1 と Gen 2 に同じチャンネル名があれば注意喚起が出ること

### Integration Tests

1. **未紐付けの利用者の検索が、誰でも閲覧できるページだけを返すこと**（3.7）。
   **`hideRestrictedByOwner` などの設定を触らず、既定のまま走らせる。**
   既定では `filterPagesByViewer` の絞り込みが効かないので、設定を変えて通すテストは意味を持たない
2. 紐付け — チャットから開始 → リンクを開いて承認 → 成立。**他人が同じアカウントを紐付けようとすると拒まれること**（7.3・7.4）
3. **通知の 2 段** — proxy が応答しないとき、ページ保存は完了し（2.5）、行が再送待ちとして残り、
   やり直しの上限を超えたら運用者が確認できる形で残ること（2.4）
4. Gen 1 との併存 — Gen 2 を設定しても Gen 1 の通知先と設定が変わらないこと（12.2・12.3）
5. 署名の検証に失敗したリクエストが処理されず、記録が残ること。**その際 nonce の表が増えないこと**（10.2）
