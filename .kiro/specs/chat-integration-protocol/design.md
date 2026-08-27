# Technical Design — chat-integration-protocol

> umbrella spec: [chat-integration](../chat-integration/)。要件は umbrella の `requirements.md` が持つ。
> 本書は要件 ID を参照するだけで、番号を振り直さない。設計判断の根拠（決定 1〜10）は umbrella の `research.md`。

## Overview

**Purpose**: GROWI と chat-integration proxy の**間を流れるものだけ**を定める。通信契約の型、RFC 9421 の署名、
チャンネル権限の判定。3 つとも**両側が同一でなければ壊れる**ものである。

**Users**: 直接の利用者は他の 2 つの sub-spec（`chat-integration-proxy` と `chat-integration-app`）。

**Impact**: 新規パッケージ `packages/chat`（`@growi/chat`）。GROWI 本体（`apps/app`）と proxy の両方が依存する。

### Goals

- 両側が**同じコード**を使うことで、片側だけ直して食い違うことを構造的に防ぐ
- 契約の形を一望できる状態に保つ（この spec が独立している理由）

### Non-Goals

- チャットサービスとのやり取り（`chat-integration-proxy` が持つ）
- GROWI の権限判定・検索・ページ作成（`chat-integration-app` が持つ）
- **Chat SDK への依存**。本パッケージは `chat` / `@chat-adapter/*` を一切 import しない

---

## Boundary Commitments

### This Spec Owns

- **通信契約の型** — `CommandRequest` / `CommandResponse` / `NotificationRequest` / `NotificationResult` /
  ペアリングと鍵の型 / 設定と能力の型
- **RFC 9421 署名の生成と検証** — 署名対象の宣言、署名対象文字列の組み立て、`Content-Digest`
- **チャンネル権限の判定** — 純粋関数。proxy と GROWI の両方が同じものを使う
- **コマンド名の語彙** — 定数として 1 か所に宣言する

### Out of Boundary

- Chat SDK、チャットサービスの資格情報、プラットフォームの能力表（すべて `chat-integration-proxy`）
- GROWI のユーザー・権限・検索・ページ（すべて `chat-integration-app`）
- **鍵の保管**。interface は定めるが、実装（PostgreSQL / MongoDB）は各側が持つ

### Allowed Dependencies

| 依存先 | 使ってよい場所 | 制約 |
|---|---|---|
| `node:crypto` | `src/signature/` のみ | 暗号は自前で書かない。`crypto.subtle` は Ed25519 の検証が壊れているので使わない |
| `structured-headers@^2.0.3` | `src/signature/structured-fields.ts` のみ | 型定義が無いので、このファイルだけが未型付き API に触れる |

**それ以外の実行時依存を持たない。** とくに `chat` / `@chat-adapter/*` / HTTP クライアントを import しない。

### Revalidation Triggers

**本 spec の変更は必ず両方の sub-spec に効く。** 以下が変わったら `chat-integration-proxy` と
`chat-integration-app` の design を必ず再確認する。

- 通信契約の型の形が変わったとき
- 署名の対象に含めるものが変わったとき（**片側だけ変えると全リクエストが通らなくなる**）
- 鍵の識別子の一意性の範囲が変わったとき
- チャンネル権限の判定の意味が変わったとき
- コマンド名の語彙が増減したとき

---

## File Structure Plan

```
packages/chat/
├── src/
│   ├── index.ts                   # 契約型・コマンド名・権限判定を出す（client からも安全）
│   ├── server.ts                  # 署名を出す（node:crypto を使うのでサーバ専用）
│   ├── contract/
│   │   ├── index.ts
│   │   ├── common.ts              # ChatAccountRef / ChannelRef / MessageRef / PlatformName
│   │   ├── command.ts             # CommandRequest / CommandResponse（要件 3・4・5・6・14）
│   │   ├── notification.ts        # NotificationRequest / NotificationResult（要件 2）
│   │   ├── account-link.ts        # 紐付けの開始と完了（要件 7）
│   │   ├── pairing.ts             # ペアリングと鍵（要件 9・10.5）
│   │   └── settings.ts            # RelationSettings / CapabilityReport（要件 1.3・11）
│   ├── commands/
│   │   └── command-names.ts       # コマンド名の語彙。両側がこれを使う
│   ├── permission/
│   │   └── channel-permission.ts  # 純粋関数。両側が同じ判定を使う（要件 11）
│   └── signature/
│       ├── index.ts
│       ├── covered-components.ts  # 署名対象の宣言。1 か所だけ
│       ├── signature-base.ts      # RFC 9421 の署名対象文字列（自前）
│       ├── sign.ts / verify.ts    # node:crypto
│       ├── content-digest.ts      # RFC 9530
│       └── structured-fields.ts   # structured-headers の型付きラッパ
├── turbo.json                     # build / dev / lint / test を宣言（packages/slack に倣う）
└── package.json
```

**公開面を 2 つに分ける理由**: 管理画面（要件 1.3 / 11 / 12.5）は契約型と権限判定を使うが、
`index.ts` が署名も出していると `node:crypto` を client の束に引き込む。
steering の `structure.md` が禁じているサーバ専用コードの混入にあたる。`packages/slack` が
`index` から `consts` と `interfaces` しか出していないのと同じ形。

---

## Components and Interfaces

| Component | File | Intent | Req Coverage |
|---|---|---|---|
| `CommonTypes` | `contract/common.ts` | 層をまたぐ基本型 | 3.9, 5.3, 7.8 |
| `CommandContract` | `contract/command.ts` | コマンドの往復 | 3.6–3.9, 4.2–4.6, 5.2, 5.3, 6.2, 6.3, 14.2 |
| `NotificationContract` | `contract/notification.ts` | 通知の往復と結果 | 2.1–2.6, 12.3 |
| `AccountLinkContract` | `contract/account-link.ts` | 紐付けの開始と完了 | 7.1–7.7 |
| `PairingContract` | `contract/pairing.ts` | ペアリングと鍵 | 9.1–9.7, 10.5 |
| `SettingsContract` | `contract/settings.ts` | 設定と能力の一覧 | 1.3, 3.8, 11.1, 11.2, 11.4 |
| `CommandNames` | `commands/command-names.ts` | コマンド名の語彙 | 11.1, 11.2, 14.1 |
| `ChannelPermission` | `permission/channel-permission.ts` | チャンネル権限の判定 | 11.1–11.5, 14.4 |
| `MessageSignature` | `signature/` | 署名の生成と検証 | 9.6, 10.1–10.7 |

---

### 基本型

```typescript
export type PlatformName = 'slack' | 'discord' | 'teams' | 'mattermost';

/** チャットサービス上の利用者。**GROWI ユーザーではない**（要件 7.8） */
export interface ChatAccountRef {
  readonly platform: PlatformName;
  readonly accountId: string;
  /** 紐付いていない発言者の表示に使う（要件 5.3） */
  readonly displayName: string;
}

export interface ChannelRef {
  readonly platform: PlatformName;
  /** **照合はこれだけで行う。** `channelName` は表示用で、変更されうるので判定に使わない */
  readonly channelId: string;
  readonly channelName: string;
  readonly isPrivate: boolean;
}

export interface MessageRef {
  readonly channel: ChannelRef;
  readonly messageId: string;
}
```

> **チャンネルの照合は `channelId` だけで行う。** 名前は変更できるので、名前で照合すると
> チャンネル名を変えるだけで権限をすり抜けられる。`RelationSettings.allowedChannels` と
> `NotificationRequest.targets[].channel` に入るのも `channelId` である（要件 11.3）。

### コマンド名の語彙

```typescript
/**
 * **両側がこの定数を使う。** GROWI の管理画面が保存する `commandName` と、
 * proxy が判定に使う名前が違う綴りだと、権限が静かに効かなくなる。
 */
export const COMMAND_NAMES = {
  search: 'search',
  createPage: 'create-page',
  keep: 'keep',
  linkPreview: 'link-preview',
  help: 'help',
} as const;

export type CommandName = (typeof COMMAND_NAMES)[keyof typeof COMMAND_NAMES];

/** 書き込みを伴うコマンド。既定で不許可にする対象（要件 11.1・Security） */
export const WRITE_COMMANDS: ReadonlySet<CommandName> = new Set([
  COMMAND_NAMES.createPage,
  COMMAND_NAMES.keep,
]);

/** 全 GROWI へ配るコマンド（要件 11.2 の broadcast） */
export const BROADCAST_COMMANDS: ReadonlySet<CommandName> = new Set([
  COMMAND_NAMES.search,
  COMMAND_NAMES.help,
]);
```

---

### 鍵の識別子 — 関係ごとに一意にする

**これは本 spec で最も間違えやすい箇所である。**

```typescript
/**
 * 鍵の識別子。**関係（relation）ごとに一意**であり、世界で一意ではない。
 *
 * 素朴に「鍵の持ち主が付ける。持ち主の中で一意」とすると、
 * **別々の GROWI が同じ `keyId` を付けうる。** 1 台の proxy に多数の GROWI が
 * ぶら下がるハブ（要件 8.1）では、これが次の 3 つを同時に壊す。
 *
 *   1. `keyId` だけで公開鍵を引くと、別の関係の鍵を返す
 *   2. nonce（使い捨ての値）の名前空間が混ざり、正当なリクエストが「再送」として弾かれる
 *   3. 処理済みの記録が混ざり、別の GROWI の通知を握りつぶす
 *
 * したがって **`keyId` を単独で鍵にしない。必ず `relationId` と組にする。**
 * 症状が「ときどき検証に失敗する」「ときどき通知が届かない」なので、原因にたどり着きにくい。
 */
export interface KeyRef {
  readonly relationId: string;
  readonly keyId: string;
}

/** 署名ヘッダに載せる `keyid` は、この形にする */
export const encodeKeyId = (ref: KeyRef): string => `${ref.relationId}:${ref.keyId}`;
export const decodeKeyId = (encoded: string): KeyRef | null => { /* ... */ };
```

**この決定が波及する先**（両 sub-spec で必ず守る）:

| 場所 | 正しい形 |
|---|---|
| 公開鍵の解決 | `resolvePublicKey(ref: KeyRef)` — `keyId` だけを受け取らない |
| 使い捨ての値の消費 | `consumeNonce(ref: KeyRef, nonce, expiresAt)` |
| proxy 側の `request_nonce` | 主キー `(relation_id, key_id, nonce)` |
| proxy 側の `processed_request` | 主キー `(relation_id, request_id)` |
| GROWI 側の同等のもの | 同上 |
| 鍵の入れ替えの戻り値 | **関係ごとの新しい `keyId` の一覧**（1 つの文字列ではない） |

---

### MessageSignature

**Contracts**: Service [x]

```typescript
/** 署名対象。ここが唯一の宣言箇所（要件 10.1） */
export const COVERED_COMPONENTS = ['@method', '@target-uri', 'content-type', 'content-digest'] as const;

/**
 * RFC 9421 では `created` / `expires` / `nonce` / `keyid` / `alg` は
 * `@signature-params` という別枠として署名対象に入る。上の一覧には現れないが、
 * **署名対象から外れているわけではない。**
 * 要件 10.3（期限切れ）と 10.4（再送）はこちらに寄りかかっているので、
 * 改ざん検知のテストは両方の一覧を 1 つずつ回すこと。
 */
export const SIGNATURE_PARAMS = ['created', 'expires', 'nonce', 'keyid', 'alg'] as const;

export interface SignParams {
  readonly method: string;
  readonly targetUri: string;
  readonly headers: Readonly<Record<string, string>>;
  /** 本体が無いリクエスト（GET / DELETE）は空のバイト列を渡す。digest は必ず付ける */
  readonly body: Uint8Array;
  readonly key: KeyRef;
  readonly privateKey: KeyObject;
  readonly expiresInSec: number;   // 既定 60
  readonly nonce?: string;         // 省略時は sign が生成する
}

export interface SignResult {
  readonly headers: {
    readonly 'content-digest': string;
    /** `keyid` / `created` / `expires` / `nonce` / `alg` はこの中に入る */
    readonly 'signature-input': string;
    readonly signature: string;
  };
  readonly nonce: string;
  readonly expiresAt: Date;
}

export const sign: (params: SignParams) => SignResult;

export type VerifyFailure =
  | 'signature-mismatch' | 'digest-mismatch' | 'expired'
  | 'replayed' | 'unknown-key' | 'malformed';

export type VerifyResult =
  | { readonly ok: true; readonly key: KeyRef }
  | { readonly ok: false; readonly failure: VerifyFailure };

export interface VerifyParams {
  readonly method: string;
  readonly targetUri: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  /** **`KeyRef` を受け取る。** `keyId` 単独では別の関係の鍵を引きうる */
  readonly resolvePublicKey: (ref: KeyRef) => Promise<KeyObject | null>;
  /** 一度使った値は 2 度目に false を返す（要件 10.4）。**署名の検証に成功した後にだけ呼ぶ** */
  readonly consumeNonce: (ref: KeyRef, nonce: string, expiresAt: Date) => Promise<boolean>;
}

export const verify: (params: VerifyParams) => Promise<VerifyResult>;
```

- Postconditions: `verify` は例外を投げず、失敗の種類を返す（要件 10.2 の記録に使う）
- Invariants: **秘密鍵は `sign` の外に出ない**（要件 9.6 / 10.6）
- Invariants: **`consumeNonce` は署名の検証に成功した後にだけ呼ぶ。** 先に呼ぶと、
  鍵の識別子を知っているだけの相手が使い捨ての値の表を膨らませられる
- Invariants: 本体の無いリクエストにも空のバイト列に対する digest を付ける。
  `COVERED_COMPONENTS` を本体の有無で変えないため

---

### ペアリング — 申告された URL の扱い

**Contracts**: API [x]

```typescript
/** GROWI → proxy。管理者が GROWI に登録コードを入力すると送られる。**署名は付かない** */
export interface PairingSubmission {
  readonly registrationCode: string;
  /** **申告する側が自由に書ける値。下記の条件で必ず検証する** */
  readonly growiUri: string;
  readonly growiLabel: string;
  /** GROWI の公開鍵はここで渡す */
  readonly publicKey: { readonly keyId: string; readonly publicKeyJwk: JsonWebKey; readonly validFrom: string };
}

export type PairingResult =
  | {
      readonly status: 'paired';
      readonly relationId: string;
      /** 要件 12.4 の重なり判定に使う */
      readonly workspace: { readonly platform: PlatformName; readonly workspaceId: string; readonly workspaceName: string };
      /** proxy の公開鍵はここで返す */
      readonly publicKey: { readonly keyId: string; readonly publicKeyJwk: JsonWebKey; readonly validFrom: string };
    }
  | { readonly status: 'code-expired' }
  | { readonly status: 'ownership-unverified'; readonly detail: string }
  | { readonly status: 'already-paired'; readonly detail: string };   // 要件 8.5

export interface OwnershipChallenge {
  readonly registrationCode: string;
  readonly challenge: string;      // proxy がその場で作る使い捨ての値
}

export interface ChallengeResponse {
  readonly challenge: string;
}
```

#### 手順（①〜⑥）

1. proxy が登録コードを発行する（チャットからの管理コマンド）
2. 管理者が GROWI に貼る。**GROWI はこれを「保留中の登録コード」として保持する**
3. GROWI が `PairingSubmission`（**自分の公開鍵を含む**）を proxy へ送る
4. proxy が `OwnershipChallenge` を**申告された URL へ**送る
5. **GROWI は、保留中の登録コードと一致するときにだけ** `ChallengeResponse` を返す。
   一致しなければ 401、保留が失効していれば 410
6. proxy が一致を確認し、双方の鍵を登録して `PairingResult`（**proxy の公開鍵を含む**）を返す

#### ⑤ に条件が要る理由

条件を書かずに「受け取った値をそのまま返す」と実装すると、**Gen 2 の受け口を持つ GROWI ならどれでも答えてしまう。**
すると ④ で確かめられるのは「その URL に Gen 2 の GROWI が居る」ことだけになり、要件 9.2 の
「その URL の**持ち主だけが答えられる**確認」にならない。

具体的な壊れ方 — 登録コードを盗み見た第三者が、`growiUri` に**他人の GROWI** を、公開鍵に**自分の鍵**を書いて ③ を送る。
proxy はその GROWI へ ④ を送り、その GROWI は身に覚えの無いまま ⑤ で答える。
proxy は「所有を確認できた」と判断し、**他人の GROWI を名乗る関係が成立する。**

#### ④ で申告された URL を検証する（踏み台にされないため）

**`pairing/submit` は署名の付かない唯一の入口で、そこで受け取った URL へ proxy が自分からリクエストを送る。**
何も検証しないと、登録コードを 1 つ持っている人が **proxy を踏み台にして、proxy から届く範囲の任意のホストを叩かせられる。**
閉域構成（要件 13）では proxy は閉域内の GROWI に届く位置に置くので、**これはそのまま閉域内を外から探る手段になる。**
proxy が侵害される前の、正常に動いている proxy がやってしまう点が重い。

`OwnershipChallenge` を送る前に、次をすべて満たすことを確かめる。

| 条件 | 理由 |
|---|---|
| scheme が `https` のみ | 平文と、`file:` などの別 scheme を除く |
| ポートは既定（443）のみ | 内部サービスの探索を防ぐ |
| 名前を引いた結果が**私的アドレス帯でない**（RFC 1918・リンクローカル 169.254.0.0/16・ループバック・ユニークローカル） | クラウドのメタデータ（169.254.169.254）と閉域内のホストを除く |
| **確かめたアドレスへそのままつなぐ** | 確認の後で別のアドレスへ差し替わることを防ぐ |
| **リダイレクトを追わない** | 追うと上の検証をすべて迂回できる |
| 応答の待ち時間に上限を置く | 応答しない相手で詰まらせない |

**管理者に返すのは失敗の種類（`ownership-unverified`）だけで、相手の応答の中身は返さない。** 返すと探索の結果が読めてしまう。

**登録コードそのものの強さ**: 128 bit 以上の乱数。proxy 側は `pairing_order` にハッシュで保存し、平文で持たない。
**installation ごとに、発行数と間違えた試行の回数に上限を置く。**

> **custom proxy の例外**: 閉域内では GROWI の URL が私的アドレス帯になるのが普通なので、
> **許す宛先を運用者が設定で明示できる**ようにする。official proxy はこの設定を持たず、既定で拒む。

---

### ChannelPermission — 両側が使う純粋関数

**Contracts**: Service [x]

```typescript
/**
 * `allowedChannels` の意味
 *   'all'  … どのチャンネルでも許可
 *   'none' … どのチャンネルでも不許可
 *   一覧   … 挙げた channelId でのみ許可（**名前ではなく id で照合する**）
 */
export interface RelationSettings {
  readonly growiId: string;
  readonly channelPermissions: ReadonlyArray<{
    readonly commandName: CommandName;
    readonly scope: 'broadcast' | 'single';        // 要件 11.2
    readonly allowedChannels: ReadonlyArray<string> | 'all' | 'none';
  }>;
}

export type PermissionVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'not-permitted-in-channel' | 'no-settings' };

/** 1 つの GROWI に対する判定 */
export const judge: (
  settings: RelationSettings | null,
  commandName: CommandName,
  channel: ChannelRef,
) => PermissionVerdict;

/** 全 GROWI 対象のコマンドで、配ってよい GROWI を絞る（要件 11.2） */
export const filterBroadcastTargets: (
  settingsByGrowi: ReadonlyArray<{ growiId: string; settings: RelationSettings | null }>,
  commandName: CommandName,
  channel: ChannelRef,
) => ReadonlyArray<string>;
```

**既定値**（`settings` が `null` = まだ一度も受け取っていない関係）
- `WRITE_COMMANDS` に含まれるもの: **不許可**（`no-settings`）
- それ以外: **許可**

**複数の GROWI が紐づくチャンネルでの合成**: **全体で許す・許さないを決めず、GROWI ごとに絞る。**
- 全 GROWI 対象（`search` / `help`）: 許可している GROWI にだけ配る。**配らなかった GROWI は利用者に示す**（要件 11.3）
- 対象が 1 つに定まる（`create-page` / `keep`）: 許可している GROWI だけを選択肢に並べる（要件 8.2）
- 1 つも無ければ実行せず、理由を示す

理由 — 「全台が許可でなければ通さない」だと 1 台の設定漏れで全体が止まり、
「1 台でも許可なら全台へ通す」だと許可していない GROWI へ配ってしまう。

- Invariants: **純粋関数。** 設定と引数だけで決まり、DB も時刻も読まない。両側で同じ結果になることが唯一の存在理由

---

### 通信契約

```typescript
export interface CommandEnvelope {
  /** 再送しても変わらない。二重実行の判定に使う（要件 10.4）。**宛先ごとに別の値** */
  readonly requestId: string;
  readonly growiId: string;
  readonly actor: ChatAccountRef;
  /**
   * どのチャンネルから来たか。GROWI 側でもチャンネル権限を判定し直すために運ぶ。
   * **ただし proxy が名乗る値なので、侵害された proxy に対する防御にはならない**
   * （どこでも不許可のコマンドを除く）。詳細は umbrella の Security Considerations。
   * 監査ログにチャンネルを残せる価値がある。
   */
  readonly channel: ChannelRef;
}

export type CommandRequest = CommandEnvelope & (
  | { readonly kind: 'search'; readonly keyword: string; readonly limit: number }
  | { readonly kind: 'create-page'; readonly path: string; readonly body: string }
  | { readonly kind: 'keep'; readonly path: string; readonly messages: ReadonlyArray<KeepMessage> }
  | { readonly kind: 'link-preview'; readonly pageUrl: string }
  | { readonly kind: 'help' }
);

/** 要件 5.2 / 5.3。発言者はチャット上の識別子のまま渡し、GROWI 側が解決する */
export interface KeepMessage {
  readonly postedAt: string;
  readonly author: ChatAccountRef;
  readonly markdown: string;
}

/** 要件 3.9: 整形済みの表示物ではなく構造化データ */
export interface SearchResultItem {
  readonly rank: number;
  readonly path: string;
  readonly title: string;
  readonly url: string;
  readonly updatedAt: string;
  readonly commentCount: number;
}

export type CommandResponse =
  | { readonly kind: 'search'; readonly items: ReadonlyArray<SearchResultItem>; readonly appliedAs: 'linked-user' | 'anonymous' }
  | { readonly kind: 'created'; readonly pageUrl: string }
  | { readonly kind: 'link-preview'; readonly path: string; readonly restricted: boolean; readonly excerpt?: string; readonly updatedAt?: string; readonly commentCount?: number }
  | { readonly kind: 'help'; readonly commands: ReadonlyArray<{ name: CommandName; usage: string; description: string }> }
  | { readonly kind: 'account-link-required'; readonly growiLabel: string; readonly linkUrl: string }
  | { readonly kind: 'error'; readonly code: 'forbidden' | 'path-conflict' | 'invalid' | 'not-permitted-in-channel'; readonly message: string };
```

**再送したときの応答**: GROWI は処理済みの `(relationId, requestId)` に対し、**1 回目の `CommandResponse` をそのまま返す。**
これをしないと、再送の 2 回目が `path-conflict`（既にページがあります）になり、
利用者は自分が作らせたページのリンク（要件 4.2）を受け取れない。

```typescript
/** GROWI → proxy。通知は markdown 文字列で送る（決定 3） */
export interface NotificationRequest {
  readonly requestId: string;
  readonly growiId: string;
  /** **channelId で指定する。** proxy は宛先がその関係の installation に属することを確かめる */
  readonly targets: ReadonlyArray<{ platform: PlatformName; channelId: string }>;
  readonly markdown: string;
  readonly containsRestrictedPage: boolean;   // 要件 2.3 の判断は GROWI が行う
}

/**
 * 宛先ごとの結果。要件 2.4 は「運用者が後から確認できる形」を求めるが、
 * official proxy の利用者は proxy のログを見られないので、**GROWI 側へ返して記録させる**。
 * `timeout` があるのは、宛先が多いときに GROWI の 1 リクエストが待たされないよう
 * proxy 側にも締め切りを設けるため。
 */
export interface NotificationResult {
  readonly outcomes: ReadonlyArray<{
    readonly platform: PlatformName;
    readonly channelId: string;
    readonly status: 'posted' | 'bot-not-in-channel' | 'channel-not-in-installation' | 'platform-error' | 'timeout';
    readonly remedy?: string;
    readonly detail?: string;
  }>;
}
```

### 紐付けの契約（要件 7）

```typescript
/**
 * **紐付けはチャット側から始める。** 利用者がチャットで紐付けを求めると、
 * GROWI が一度きり・短時間で失効するリンクをその場限りのメッセージで返し、
 * **GROWI にログインした状態でそれを開いて承認したときに成立する**（要件 7.3）。
 *
 * この経路が契約に無いと、Gen 1 の欠陥（利用者が自分のチャット ID を
 * GROWI の個人設定に手で貼る形。本人確認が無く、他人の ID を先に貼ると
 * 本人の紐付けを塞げる）へ逆戻りする。
 */
export interface AccountLinkStartRequest {
  readonly growiId: string;
  readonly actor: ChatAccountRef;
}

export type AccountLinkStartResponse =
  | { readonly status: 'link-issued'; readonly linkUrl: string; readonly expiresAt: string }
  | { readonly status: 'already-linked'; readonly growiUserName: string }
  | { readonly status: 'taken-by-another-user' };   // 要件 7.4（同じ GROWI 内で一意）
```

**紐付けは GROWI ごとに成立する。** ある GROWI での紐付けは、同じ workspace に紐づく他の GROWI には及ばない
（それぞれが独立したユーザー DB を持つため）。3 台紐づくチャンネルでは利用者は 3 回求められる（要件 7.2）。

---

## Testing Strategy

### Unit Tests

1. `sign` / `verify` — RFC 9421 のテストベクタと一致すること。**`COVERED_COMPONENTS` と `SIGNATURE_PARAMS` の両方**を
   1 つずつ改ざんすると必ず失敗すること（10.1・10.3・10.4）
2. **鍵の識別子の分離** — 別々の関係が同じ `keyId` を使っていても、互いの鍵を引かないこと。
   同じ `nonce` を別の関係が使っても弾かれないこと（8.1・10.4）
3. `consumeNonce` は**署名の検証に成功した後にだけ**呼ばれること（検証に失敗したリクエストで表が増えないこと）
4. `judge` / `filterBroadcastTargets` — 既定値（書き込みは不許可・読み取りは許可）、`'all'`/`'none'`/一覧、
   複数 GROWI の絞り込み（11.1–11.3）
5. **チャンネルの照合が `channelId` だけで行われること** — `channelName` を変えても判定が変わらないこと（11.3）
6. 申告された URL の検証 — https 以外・既定外ポート・私的アドレス帯・リダイレクトが**すべて拒まれる**こと（9.2）
7. コマンド名の語彙 — `COMMAND_NAMES` に無い名前が `RelationSettings` に入らないこと（型で担保）

### Integration Tests

1. ペアリングの往復 ①〜⑥ が成立し、双方に相手の公開鍵が登録されること（9.1–9.5）
2. **ペアリングを始めていない GROWI が `OwnershipChallenge` に答えないこと**（9.2 の本質）
3. 失効した登録コードが拒まれること（9.4）
4. 鍵の入れ替え — 新旧が両方有効な間、どちらの署名でも検証が通ること（10.5）
