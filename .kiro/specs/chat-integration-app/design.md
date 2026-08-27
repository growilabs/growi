# Technical Design — chat-integration-app

> umbrella spec: [chat-integration](../chat-integration/)。要件は umbrella の `requirements.md` が持つ。
> 通信契約・署名・チャンネル権限の判定は [chat-integration-protocol](../chat-integration-protocol/) が持つ。
> 設計判断の根拠（決定 1〜10）は umbrella の `research.md`。

## Overview

**Purpose**: GROWI 本体の Gen 2 連携。proxy から届くコマンドを既存の機能（検索・ページ作成・権限判定）へつなぎ、
GROWI 内のイベントを通知として送り、チャットの利用者を GROWI ユーザーへ紐付ける。

**Impact**: `apps/app/src/features/chat-integration/`（新規）。既存ファイルの変更は通知の配り口に限る。
**Gen 1（`packages/slack` と既存の `slack-integration`）には手を入れない。**

### Non-Goals

- チャットサービスとのやり取り（`chat-integration-proxy`）
- 通信契約・署名・権限判定そのもの（`chat-integration-protocol`）
- **GROWI の検索・権限判定・ページ作成の仕組みの変更**。呼ぶだけ

---

## Boundary Commitments

### This Spec Owns

- `CommandEndpoint` — proxy から届くコマンドの処理（要件 3.6/3.7, 4, 5, 6, 14.2）
- `NotificationSender` — Gen 2 の宛先への通知（要件 2, 12.3）
- `ChatAccountLink` — チャット利用者と GROWI ユーザーの紐付け（要件 7）
- `KeyStore`（GROWI 側の実装）— 自分の鍵と proxy の公開鍵（要件 9.5, 10.5）
- 管理画面と個人設定（要件 1.3, 11, 12.4, 12.5, 7.7）
- **GROWI 側の新しいデータの一覧と、その消し方**

### Out of Boundary

- **Gen 1 の実装。** `packages/slack`、`slack-integration.ts`、`slack-command-handler/*`、
  `User.slackMemberId` — いずれも読むだけで変更しない
- GROWI の検索・ページ作成・権限判定の実装

### Allowed Dependencies

| 依存先 | 制約 |
|---|---|
| `@growi/chat` | 契約型・権限判定は `index.ts` から、署名は `server.ts` から。**client 側は `index.ts` だけ** |
| GROWI 既存の検索サービス・ページ作成・権限判定 | 呼ぶだけ。実装を変えない |

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
│   ├── pairing/
│   │   ├── pairing-endpoint.ts        # 保留中の登録コードと突き合わせて確認に答える
│   │   └── models/pending-pairing.ts
│   └── models/
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
| `apps/app/package.json` | `@growi/chat` を `workspace:^` で追加 |

---

## Components and Interfaces

| Component | File | Intent | Req Coverage |
|---|---|---|---|
| `CommandEndpoint` | `server/command/command-endpoint.ts` | proxy からのコマンドを処理 | 3.6, 3.7, 4.2–4.6, 5.2, 5.3, 6.2, 6.3, 14.2 |
| `ResolveActor` | `server/command/resolve-actor.ts` | actor → GROWI ユーザー | 3.6, 3.7, 4.3, 4.4, 7.6 |
| `NotificationOutbox` | `server/notification/notification-outbox.ts` | 送るべき通知を書き留める | 2.1–2.3, 2.5, 2.6 |
| `NotificationDispatcher` | `server/notification/notification-dispatcher.ts` | 送って結果を書き戻す | 2.4, 10.4, 10.7 |
| `ChatAccountLink` | `server/account-link/` | 紐付け | 7.1–7.7 |
| `KeyStore` | `server/keys/key-store.ts` | 鍵の保持と入れ替え | 9.5, 10.5, 10.6 |
| `SignatureGuard` | `server/signature-guard.ts` | 届くリクエストの検証 | 10.1–10.4 |
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
  resolveActor(actor: ChatAccountRef): Promise<ResolvedActor>;
}
```

- Preconditions: 署名の検証と `(relationId, requestId)` の重複判定を通過している
- Preconditions: **`handle` の冒頭で `@growi/chat` の `judge` を `CommandEnvelope.channel` で通す**（要件 11.3）
- Postconditions: 例外を投げず、必ず `CommandResponse` を返す
- Invariants: **`resolveActor` が `user: null` のときは書き込みを実行しない**（要件 4.4 / 7.6）

**検索の呼び方**（要件 3.6 / 3.7）: 既存の
`searchService.searchKeyword(keyword, nqName, user, userGroups, searchOpts)` を **5 引数すべて揃えて**呼ぶ。
Gen 1 の呼び出しは 4 引数で並びがずれており参照にならない（umbrella の `research.md` 研究ログ 6）。
紐付いていなければ `user: null` / `userGroups: []` で呼び、**誰でも閲覧できるページだけ**が返ることを確かめる。

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
      → 届かなければ間隔を空けてやり直す（同じ requestId で。要件 10.4 が効く）
      → 諦めた分と bot-not-in-channel を運用者が見られる場所に残す（要件 2.4）
```

```typescript
export interface NotificationOutbox {
  /** ページ保存の処理から呼ぶ。**送信を待たない** */
  enqueue(entry: {
    growiId: string;
    targets: ReadonlyArray<{ platform: PlatformName; channelId: string }>;
    markdown: string;
    containsRestrictedPage: boolean;
  }): Promise<void>;
}

export interface NotificationDispatcher {
  /** 未送信・再送待ちの行を処理する。**複数台では分散ロックで 1 台だけが実行する** */
  drain(now: Date): Promise<{ sent: number; failed: number; givenUp: number }>;
}
```

- **`requestId` は行を作るときに 1 度だけ採番し、再送しても変えない**（要件 10.4）
- 書き留める契機は 2 つ。**管理者がパス条件ごとに設定した通知**（要件 2.1）と、
  **編集した人がページの保存時に宛先を指定した通知**（要件 2.2）。どちらも同じ outbox に入る
- やり直しは間隔を空けて数回。上限を超えたら `given-up` として残す
- **宛先の集合を種類で分岐しない。** 既存の `GlobalNotificationSettingType` は `{ MAIL, SLACK }` の閉じた 2 値で、
  `routes/apiv3/notification-setting.js` の 3 か所がそれで分岐している。ここへ 3 つ目を足す形は
  `.claude/rules/coding-style.md`「モード名で分岐しない」に反する。**宛先の集合を受け取って配る形へ寄せる**

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

- 状態モデル: `{ userId, platform, accountId, linkedAt }`、**`(platform, accountId)` に複合ユニーク索引**
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
| `chat_account_links` | `userId`, `platform`, `accountId`, `linkedAt` | `(platform, accountId)` 複合ユニーク。**解除まで残る** |
| `chat_integration_keys` | `relationId`, `side`(`own`/`peer`), `keyId`, `key`, `validFrom`, `revokedAt` | `(relationId, side, keyId)` 一意。**紐付け解除で削除**（秘密鍵を残さない） |
| `chat_notification_outbox` | `requestId`, `growiId`, `targets`, `markdown`, `state`, `attempts`, `result`, `createdAt` | `state` に索引。**送信済みは 30 日で TTL 索引により消す**。`given-up` は運用者が確認するまで残す |
| `chat_processed_requests` | `relationId`, `requestId`, `response`, `processedAt` | `(relationId, requestId)` 一意。**TTL 索引で 24 時間**（再送が起こりうる間だけ） |
| `chat_request_nonces` | `relationId`, `keyId`, `nonce`, `expiresAt` | `(relationId, keyId, nonce)` 一意。**`expiresAt` に TTL 索引** |
| `chat_pending_pairings` | `registrationCode`, `growiUri`, `createdBy`, `expiresAt` | `registrationCode` 一意。**`expiresAt` に TTL 索引**。要件 9.2 の所有確認に使う |
| `chat_notification_destinations` | `platform`, `channelId`, `pathPattern`, `triggerEvents`, `relationId` | 管理者が設定する。Gen 1 の設定とは**別に保存する**（要件 12.2） |

**鍵の識別子は `(relationId, keyId)` の組で扱う。** `keyId` 単独では別の関係の鍵を引きうる
（protocol spec の「鍵の識別子」を参照）。

**保存時の暗号化**: `chat_integration_keys.key` のうち `side: 'own'`（秘密鍵）は暗号化する。

---

## Testing Strategy

### Unit Tests

1. `resolveActor` — 紐付いていれば GROWI ユーザーと所属グループを返し、いなければ `null` と空を返すこと（3.6・3.7）
2. **`searchKeyword` の引数の並び**を明示的に検証すること。引数がずれても型が通る形だったのが Gen 1 の欠陥（3.6）
3. 再送への応答 — 同じ `(relationId, requestId)` の 2 回目に**1 回目の応答がそのまま返ること**（10.4・4.2）
4. 要件 12.4 の判定 — Gen 1 と Gen 2 に同じチャンネル名があれば注意喚起が出ること

### Integration Tests

1. **未紐付けの利用者の検索が、誰でも閲覧できるページだけを返すこと**（3.7）
2. 紐付け — チャットから開始 → リンクを開いて承認 → 成立。**他人が同じアカウントを紐付けようとすると拒まれること**（7.3・7.4）
3. **通知の 2 段** — proxy が応答しないとき、ページ保存は完了し（2.5）、行が再送待ちとして残り、
   やり直しの上限を超えたら運用者が確認できる形で残ること（2.4）
4. Gen 1 との併存 — Gen 2 を設定しても Gen 1 の通知先と設定が変わらないこと（12.2・12.3）
5. 署名の検証に失敗したリクエストが処理されず、記録が残ること。**その際 nonce の表が増えないこと**（10.2）
