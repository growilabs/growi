# Technical Design — chat-integration-protocol

> umbrella spec: [chat-integration](../chat-integration/)。要件は umbrella の `requirements.md` が持つ。
> 本書は要件 ID を参照するだけで、番号を振り直さない。設計判断の根拠（決定 1〜10）は umbrella の `research.md`。

## Overview

**Purpose**: GROWI と chat-integration proxy の**間を流れるものだけ**を定める。通信契約の型、RFC 9421 の署名、
チャンネル権限の判定、申告された URL の条件判定。4 つとも**両側が同一でなければ壊れる**ものである。

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
- **申告された URL の条件判定**（`judgeGrowiUri`）— 引数だけで決まる純粋関数。名前引きと接続は proxy が持つ
- **コマンド名の語彙** — 定数として 1 か所に宣言する
- **口の一覧**（`op` ↔ パス ↔ 向き）— どちらが公開する口かも含めてここで決める
- **本文の検査関数**（`parse*`）— 署名は「経路上で書き換えられていない」ことしか示さないので、
  形の確認は両側が同じ関数で行う

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
│   │   └── command-names.ts       # コマンド名の語彙と性質（COMMAND_TRAITS）。両側がこれを使う
│   ├── endpoints/
│   │   └── op-names.ts            # 口の一覧（op ↔ パス ↔ 向き）。両側がこれを使う
│   ├── parse/
│   │   ├── index.ts
│   │   ├── shape.ts               # 手書きの形の確認に使う最小の道具（下記）
│   │   ├── parse-command.ts       # parseCommandRequest / parseCommandResponse
│   │   ├── parse-notification.ts  # parseNotificationRequest / parseNotificationResult
│   │   ├── parse-pairing.ts       # parsePairingSubmission / parseOwnershipChallenge / parseChallengeResponse
│   │   ├── parse-keys.ts          # parseKeyRegistration / parseKeyRevocation
│   │   └── parse-settings.ts      # parseSettingsPush / parseAccountLinkStart
│   ├── permission/
│   │   └── channel-permission.ts  # 純粋関数。両側が同じ判定を使う（要件 11）
│   ├── url-guard/
│   │   └── growi-uri-guard.ts     # 申告された URL の条件判定（純粋関数。名前は引かない）
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

**`parse/` を手書きにする理由と、その作り方。** Allowed Dependencies に検証ライブラリが無いのは、
このパッケージが GROWI 本体と proxy の両方に入るためである（依存を増やすと両方に波及する）。
そこで `parse/shape.ts` に**最小の道具だけ**を置き、7 本の検査関数はそれを組み合わせて書く。

```typescript
// packages/chat/src/parse/shape.ts
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
export const arr = <T>(v: unknown, max: number, item: (x: unknown) => T | undefined): ReadonlyArray<T> | undefined => { /* ... */ };
export const oneOf = <T extends string>(v: unknown, allowed: ReadonlyArray<T>): T | undefined => { /* ... */ };
```

**長さの上限を必ず付ける。** 署名を通ったリクエストでも、本文の大きさまでは署名が守らない。
上限が無いと、鍵を持っている相手（＝正当な相手が侵害された場合）が大きな本文で受け側を詰まらせられる。

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
| `SettingsContract` | `contract/settings.ts` | 設定と能力の一覧を運ぶ | 1.3, 11.1, 11.2, 11.4 |
| `UriGuard` | `url-guard/growi-uri-guard.ts` | 申告された URL の条件判定（純粋関数） | 9.2 |
| `CommandNames` | `commands/command-names.ts` | コマンド名の語彙と性質 | 11.1, 11.2, 14.1 |
| `OpNames` | `endpoints/op-names.ts` | 口の一覧（`op` ↔ パス ↔ 向き） | 10.1 |
| `ShapeParsers` | `parse/` | 本文の形の確認。**両側が同じ関数を使う** | 10.1 |
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

/**
 * **性質はコマンドの宣言そのものに持たせる。** 手で並べた集合を別に置くと、
 * `COMMAND_NAMES` に書き込みコマンドを足して集合への追加を忘れたときに
 * **どのチャンネルからでも許可**という危ない側へ倒れる。
 * この形なら、性質を書かないコマンドはそもそも作れない。
 */
export type CommandTargeting =
  | 'single'        // 対象の GROWI が 1 つに定まる。複数あれば利用者に選ばせる（要件 8.2）
  | 'broadcast'     // 許可している全 GROWI へ配る（要件 8.4）
  | 'url-matched';  // 宛先は URL の一致で決まる。利用者に選ばせない（要件 6.4）

export interface CommandTraits {
  readonly writes: boolean;        // 既定で不許可にする対象（要件 11.1・Security）
  readonly targeting: CommandTargeting;
}

export const COMMAND_TRAITS: Readonly<Record<CommandName, CommandTraits>> = {
  [COMMAND_NAMES.search]:      { writes: false, targeting: 'broadcast' },
  [COMMAND_NAMES.help]:        { writes: false, targeting: 'broadcast' },
  [COMMAND_NAMES.createPage]:  { writes: true,  targeting: 'single' },
  [COMMAND_NAMES.keep]:        { writes: true,  targeting: 'single' },
  [COMMAND_NAMES.linkPreview]: { writes: false, targeting: 'url-matched' },
};

export const isWriteCommand = (name: CommandName): boolean => COMMAND_TRAITS[name].writes;
export const targetingOf = (name: CommandName): CommandTargeting => COMMAND_TRAITS[name].targeting;
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
/**
 * `relationId` と `keyId` は **`:` を含まない**。`relationId` は proxy が採番するので守れるが、
 * **`keyId` は相手が付ける値なので、登録のときに形を確かめる** — `[A-Za-z0-9_-]` の 8〜64 文字に限り、
 * 外れる登録は断る（`PublicKeyRegistration` の検査項目に入れる）。確かめないと、
 * `:` を含む `keyId` を登録した相手が `encodeKeyId` の区切りをずらせる。
 *
 * `decodeKeyId` は**最初の `:` で切り**、左を `relationId`、右を `keyId` とする。
 * `:` が 1 つも無い、どちらかが空、右側にさらに `:` が含まれる、のいずれかなら `null` を返す。
 */
export const encodeKeyId = (ref: KeyRef): string => `${ref.relationId}:${ref.keyId}`;
export const decodeKeyId = (encoded: string): KeyRef | null => { /* ... */ };
```

#### 関係を指す識別子は `relationId` ただ 1 つ

**`relationId` は推測できない値にする**（proxy が採番する。連番にしない）。
理由は **`keyid`（= `relationId:keyId`）として署名ヘッダに載り外部に出る識別子だから** —
数え上げられない値にしておく。
（⑤ を使った署名の収集は、接頭辞を付けた時点で `relationId` の推測可否と無関係に閉じている。
この控えはそれとは別の、識別子を数え上げられないようにするための習慣である。）

**`growiId` という別名を作らない。** 契約の中で GROWI を指す値はすべて `relationId` とし、
**proxy がペアリングの成立時に採番する**。`PairingResult.relationId` で GROWI に渡るので、
GROWI はそれを保存して以降のリクエストに載せる。

別名を作ると「誰が付ける値か」「どちらが一意性を保証するか」が読み手ごとに変わり、
下の `keyId` と同じ種類の取り違えを生む。**関係を指す軸は 1 本に保つ。**

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

**署名付きのリクエストは全て `POST` で、本体は JSON、`{ relationId, op, ... }` を必ず持つ。**
読み取りだけの口（能力の一覧・接続の状態・チャンネルの一覧）も POST にする。理由は次の項に書く。

```typescript
/** 署名対象。ここが唯一の宣言箇所（要件 10.1）。**本体の有無で変えない** */
export const COVERED_COMPONENTS = ['@method', 'content-type', 'content-digest'] as const;

/** どの口を叩いたか。**本体に入れて `content-digest` で覆う**（下記の理由） */
export const OP_NAMES = [
  'command', 'notification', 'settings-push', 'key-register', 'key-revoke',
  'capabilities', 'connection-status', 'channels', 'account-link-start', 'settings-pull',
] as const;
export type OpName = (typeof OP_NAMES)[number];

/**
 * RFC 9421 では `created` / `expires` / `nonce` / `keyid` / `alg` は
 * `@signature-params` という別枠として署名対象に入る。上の一覧には現れないが、
 * **署名対象から外れているわけではない。**
 * 要件 10.3（期限切れ）と 10.4（再送）はこちらに寄りかかっているので、
 * 改ざん検知のテストは両方の一覧を 1 つずつ回すこと。
 */
export const SIGNATURE_PARAMS = ['created', 'expires', 'nonce', 'keyid', 'alg'] as const;

export interface SignParams {
  /** 常に `'POST'` */
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /** **必ず中身がある。** 送るバイト列そのものを渡す（組み立て直さない） */
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

/** `Content-Digest`（RFC 9530）のハッシュ方式。**ここが唯一の宣言箇所** */
export const CONTENT_DIGEST_ALGORITHM = 'sha-512' as const;

export type VerifyResult =
  | { readonly ok: true; readonly key: KeyRef }
  | { readonly ok: false; readonly failure: VerifyFailure };

export interface VerifyParams {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /** **届いたバイト列そのもの。** 解析した値から組み立て直したものを渡してはならない
   *  （鍵の並び順・数値の書き方が送信時と一致する保証が無く、正しい相手が弾かれる） */
  readonly body: Uint8Array;
  /** **`KeyRef` を受け取る。** `keyId` 単独では別の関係の鍵を引きうる。
   *  **失効済み（`revokedAt` が過ぎている）と、まだ有効になっていない（`validFrom` が未来）鍵は
   *  `null` を返す。** 呼ぶ側にこの判断を任せると、片側が見落としたときに
   *  **失効が効かないまま誰も気づかない**（要件 10.5・10.6） */
  readonly resolvePublicKey: (ref: KeyRef) => Promise<KeyObject | null>;
  /** 一度使った値は 2 度目に false を返す（要件 10.4）。**署名の検証に成功した後にだけ呼ぶ** */
  readonly consumeNonce: (ref: KeyRef, nonce: string, expiresAt: Date) => Promise<boolean>;
}

export const verify: (params: VerifyParams) => Promise<VerifyResult>;
```

- Postconditions: `verify` は例外を投げず、失敗の種類を返す（要件 10.2 の記録に使う）
- Invariants: **秘密鍵は `sign` の外に出ない**（要件 9.6 / 10.6）
- Invariants: **検証する側は、保存してある鍵に紐づく方式を使う。** リクエストが名乗る `alg` は
  一致の確認にだけ使い、**処理の選択には使わない**。`alg` は送る側が名乗る値なので、
  署名対象に入っていることが示すのは「経路上で書き換えられていない」ことだけである
- Invariants: **受け入れる有効期間は最大 300 秒、時計のずれは 30 秒まで許す。**
  `expiresInSec` は**送る側**の値なので、そのまま信じると 1 行の指定で 1 通が何年でも有効になる。
  **`consumeNonce` に渡す期限は、送られてきた値ではなく受ける側が上限で切った値**にする。
  これをしないと使い捨ての値の表が自動削除されず、単調に増える
- Invariants: **再送は `requestId` を据え置き、`nonce` と `created` / `expires` を取り直して署名し直す。**
  一度作った署名済みのリクエストをそのまま送り直すと、2 回目は必ず `replayed` で弾かれ、
  記録した 1 回目の応答を返す経路まで**一度も届かない**
- Invariants: **本文に載せた `relationId` が、署名から特定した関係と一致しないリクエストは `malformed` として断る。**
  `relationId` に一本化した効き目は、この確認まで書いて完成する。
  **この確認は関数として出す** — 文章だけにすると両側が別々に覚えて実装することになり、
  このパッケージが存在する理由（同じコードを使う）と噛み合わない:

  ```typescript
  /** 署名から特定した関係と、本体の `relationId` / `op` が一致するかを確かめる。
   *  受け口はこれを通してからでないと本体を使わない */
  export const acceptEnvelope: <T extends { relationId: string; op: OpName }>(
    body: T, verified: KeyRef, endpointOp: OpName,
  ) => { readonly ok: true; readonly body: T } | { readonly ok: false; readonly failure: 'malformed' };
  ```
- Invariants: **`consumeNonce` は署名の検証に成功した後にだけ呼ぶ。** 先に呼ぶと、
  鍵の識別子を知っているだけの相手が使い捨ての値の表を膨らませられる
- Invariants: **`expires` と `nonce` が付いていない署名は `malformed` として断る。**
  RFC 9421 はどちらも省略できるので、無いものをそのまま通すと
  **有効期間の上限（300 秒）も再送の検知も丸ごと無意味になる**（要件 10.3・10.4）
- Invariants: **本体の `op` が、実際に叩かれた口と一致しないリクエストは `malformed` として断る。**
  署名を別の口へ流用させないための縛りはこれ 1 つである（下記のとおり宛先もパスも署名対象に入れない）。
  受ける側は自分がどの口で受けたかを知っているので、その値と本体の `op` を突き合わせる

#### 署名対象に**宛先の URL もパスも入れない**理由（要件 10.1）

**署名の材料にしてよいのは、送る側と受ける側が「データとして同じ値を持っている」ものだけである。**
HTTP の層から取り出す値は、途中の機器が書き換えるので、この条件を満たさない。同じ判断を
ペアリングの署名（`pairingChallengePayload` から `proxyUri` を外した件）でも下している。

| 入れたくなる値 | 何が起きるか |
|---|---|
| `@target-uri` | TLS を終端するリバースプロキシがあると、送る側は `https://growi.example.com/...` を署名し、受ける側のプロセスに届くのは `http://内部ホスト:3000/...`。**正しい相手からの全リクエストが `signature-mismatch` で落ちる** |
| `@authority` | 同上 |
| `@path` | nginx の `proxy_pass http://app:3000/;`（末尾スラッシュ）は location の前置きを削る。**前置きを付けて公開している構成で全リクエストが落ちる** |

**代わりに、どの口を叩いたかを本体の `op` に載せる。** 本体は `content-digest` で覆われているので
書き換えられない。`op` は両側が**データとして**持つ値なので、途中の機器の設定に左右されない。

これで守りは次のように分かれる。

- **別の口へ流用**（能力の一覧の署名を設定の押し込みへ）→ `op` の突き合わせが防ぐ
- **別の相手へ流用**（GROWI-A 宛てを GROWI-B へ）→ 鍵が関係ごとなので検証が落ちる
- **同じ口への再送** → `nonce` が防ぐ

**読み取りの口も POST にする**のはこのためである。GET には本体が無いので `op` を覆えず、`Content-Type` も
付かない（RFC 9421 は署名対象に挙げた項目がリクエストに無いと組み立てそのものを失敗させる）。
機械同士の署名付きのやり取りなので、読み取りが POST になる不格好さは受け入れる。
副産物として、`COVERED_COMPONENTS` が本体の有無で 2 つに分かれる問題も消える。

#### 口の一覧（`op` ↔ パス ↔ 向き）

**この表がこの spec の持ちもので、proxy と app は自分の側だけをこれに合わせる。**
パスは署名対象ではないので、途中の機器が前置きを付けても構わない。表にあるのは**それぞれの側が公開する形**である。

| `op` | 向き | パス（それぞれの土台からの相対） | 本体 | 要件 |
|---|---|---|---|---|
| `command` | proxy → GROWI | `/chat-integration/command` | `CommandRequest` | 3, 4, 5, 6, 14 |
| `account-link-start` | proxy → GROWI | `/chat-integration/account-link/start` | `AccountLinkStartRequest` | 7.3 |
| `settings-pull` | proxy → GROWI | `/chat-integration/settings` | `{ relationId, op }` のみ | 11.1 |
| `notification` | GROWI → proxy | `/chat-integration/notification` | `NotificationRequest` | 2.1–2.6 |
| `settings-push` | GROWI → proxy | `/chat-integration/settings-push` | `SettingsPushRequest` | 11.1, 11.2, 11.4 |
| `key-register` | GROWI → proxy | `/chat-integration/keys/register` | `KeyRegistrationRequest` | 10.5 |
| `key-revoke` | GROWI → proxy | `/chat-integration/keys/revoke` | `KeyRevocationRequest` | 10.5 |
| `capabilities` | GROWI → proxy | `/chat-integration/capabilities` | `{ relationId, op }` のみ | 1.3 |
| `connection-status` | GROWI → proxy | `/chat-integration/connection-status` | `{ relationId, op }` のみ | 1.4, 13.2 |
| `channels` | GROWI → proxy | `/chat-integration/channels` | `{ relationId, op }` のみ | 2.2, 11.1 |

**ペアリングの申請だけはこの表の外**（`POST /chat-integration/pairing/submit`、署名なし・`op` なし）。
署名の前段なので鍵がまだ無く、`relationId` もまだ無い。守りは本文の検査と登録コードだけである。

---

### ペアリング — 申告された URL の扱い

**Contracts**: API [x]

```typescript
/**
 * 公開鍵。**登録する側は必ず検査する。** `JsonWebKey` は楕円曲線でも RSA でも共通鍵でも通る広い型なので、
 * そのまま受け入れると意図しない種類の鍵が登録される。次をすべて確かめる。
 *   - `kty` が `'OKP'`、`crv` が `'Ed25519'`
 *   - **秘密の成分（`d`）を含まない**
 */
export interface PublicKeyRegistration {
  /** 鍵の持ち主が付ける。**関係の中で一意**（「鍵の識別子」を参照） */
  readonly keyId: string;
  readonly publicKeyJwk: JsonWebKey;
  readonly validFrom: string;
}

export interface PublicKeySet {
  readonly keys: ReadonlyArray<PublicKeyRegistration & { readonly revokedAt: string | null }>;
}

/** GROWI → proxy。管理者が GROWI に登録コードを入力すると送られる。**署名は付かない** */
export interface PairingSubmission {
  readonly registrationCode: string;
  /** **申告する側が自由に書ける値。下記の条件で必ず検証する** */
  readonly growiUri: string;
  readonly growiLabel: string;
  /** GROWI の公開鍵はここで渡す */
  readonly publicKey: PublicKeyRegistration;
}

export type PairingResult =
  | {
      readonly status: 'paired';
      readonly relationId: string;
      /** 要件 12.4 の重なり判定に使う */
      readonly workspace: { readonly platform: PlatformName; readonly workspaceId: string; readonly workspaceName: string };
      /** proxy の公開鍵はここで返す */
      readonly publicKey: PublicKeyRegistration;
    }
  | { readonly status: 'code-expired' }
  | { readonly status: 'ownership-unverified'; readonly detail: string }
  | { readonly status: 'already-paired'; readonly detail: string };   // 要件 8.5

export interface OwnershipChallenge {
  readonly registrationCode: string;
  readonly challenge: string;      // proxy がその場で作る使い捨ての値。**base64url に限る**
}

export interface ChallengeResponse {
  readonly challenge: string;
  /**
   * **③ で申告した秘密鍵で、下記の「署名する値」に署名したもの**（base64url で符号化）。
   * ここが揃わないと、両側が別々に実装した瞬間にペアリングが必ず失敗する。
   * これが無いと、所有確認は「その URL に居る誰かが登録コードを知っている」ことしか示さず、
   * **③ で申告された公開鍵がその相手のものであること**を示さない。
   */
  readonly challengeSignature: string;
}
```

**足りない往復を含む、鍵の追加と失効**

```typescript
/**
 * 新しい公開鍵を相手に足してもらう。**両方向に流れる**（proxy → GROWI と GROWI → proxy）。
 * ペアリングは最初の 1 組を交換するだけなので、後から足す経路がこれ。
 * これが無いと要件 10.5（止めずに入れ替える）は成立しない。
 */
export interface KeyRegistrationRequest {
  readonly relationId: string;
  readonly key: PublicKeyRegistration;
}

export interface KeyRevocationRequest {
  readonly relationId: string;
  readonly keyId: string;
}

export type KeyOperationResult =
  | { readonly status: 'ok' }
  | { readonly status: 'rejected'; readonly reason: 'would-leave-no-valid-key' | 'unknown-key' | 'invalid-key' };
```

**設定と能力を運ぶ往復**

```typescript
/** GROWI → proxy。管理者が保存した時点で押し込む。要件 11.4「次の実行から反映」はこれで満たす */
export interface SettingsPushRequest {
  readonly settings: RelationSettings;
  /**
   * 設定の版。**関係ごとに 1 つの値**であり、行ごとには持たない
   * （設定全体を毎回まるごと送る形なので、行ごとに持つと比べる基準が決まらない）。
   * GROWI が保存のたびに **1 ずつ増やす**。**proxy は自分が持つものより小さい押し込みを捨てる。**
   * これが無いと、管理者が続けて 2 回変えて 1 回目の再送が遅れて届いたときに、
   * **古い設定が新しい設定を上書きする**（proxy には気づく手立てが無い）。要件 11.4 に触る。
   *
   * **時刻にしない。** 時計が巻き戻ると新しい設定が捨てられ、続けて変えた 2 回が同じ時刻に
   * なると 2 回目が捨てられる。どちらも proxy 側からは正常に見え、原因に辿り着けない。
   */
  readonly version: number;
}

/** proxy → GROWI（保険）。押し込みが届かなかったときに proxy が取りに行く */
export interface SettingsPullResponse {
  readonly settings: RelationSettings;
  /** GROWI 側の設定の版。proxy は自分が持つものより大きければ入れ替える */
  readonly version: number;
}

/** proxy → GROWI。管理画面が通知の宛先を選ぶために取る（要件 2.2 / 11.1）。
 *  **`channelName` が取れるので、要件 12.4 の宛先の突き合わせもこれで解ける** */
export interface ChannelInventory {
  readonly channels: ReadonlyArray<{
    readonly platform: PlatformName;
    readonly channelId: string;
    readonly channelName: string;
    readonly isPrivate: boolean;
  }>;
}

export type CapabilityLevel = 'full' | 'degraded' | 'none' | 'unverified';

/** proxy → GROWI。管理画面が「このサービスで何が使えるか」を出すために取る（要件 1.3） */
export interface CapabilityReport {
  readonly platforms: ReadonlyArray<{
    readonly platform: PlatformName;
    readonly capabilities: ReadonlyArray<{
      readonly capability: string;
      readonly level: CapabilityLevel;
      readonly substitute: string | null;
    }>;
  }>;
}
```

#### 手順（①〜⑥）

1. proxy が登録コードを発行する（チャットからの管理コマンド）。
   **発行できるのは workspace の管理者だけ。コードは本人にだけ見えるメッセージで渡し、チャンネルに平文で出さない**
2. 管理者が GROWI に貼る。**GROWI はこれを「保留中の登録コード」として保持する**
3. GROWI が `PairingSubmission`（**自分の公開鍵を含む**）を proxy へ送る
4. proxy が `OwnershipChallenge` を**申告された URL へ**送る
5. **GROWI は、保留中の登録コードと一致するときにだけ** `ChallengeResponse` を返す。
   一致しなければ 401、保留が失効していれば 410。
   **返す `challengeSignature` は、③ で申告した秘密鍵で `challenge` に署名したもの**（下記）
6. proxy が **`challenge` の一致と `challengeSignature` の検証**を行い、双方の鍵を登録して
   `PairingResult`（**proxy の公開鍵と `relationId` を含む**）を返す

#### ⑤ に条件が要る理由

条件を書かずに「受け取った値をそのまま返す」と実装すると、**Gen 2 の受け口を持つ GROWI ならどれでも答えてしまう。**
すると ④ で確かめられるのは「その URL に Gen 2 の GROWI が居る」ことだけになり、要件 9.2 の
「その URL の**持ち主だけが答えられる**確認」にならない。

具体的な壊れ方 — 登録コードを盗み見た第三者が、`growiUri` に**他人の GROWI** を、公開鍵に**自分の鍵**を書いて ③ を送る。
proxy はその GROWI へ ④ を送り、その GROWI は身に覚えの無いまま ⑤ で答える。
proxy は「所有を確認できた」と判断し、**他人の GROWI を名乗る関係が成立する。**

#### ⑤ で署名する値 — `challenge` そのものに署名してはいけない

```typescript
/**
 * **用途を示す接頭辞と、その場の条件を必ず連結する。**
 * `challenge` だけに署名すると、⑤ が「相手の指定した文字列に、
 * **後で本番のリクエスト署名に使う同じ鍵で**署名して返す窓口」になる。
 */
/**
 * `challenge` は base64url に限る（区切りの `:` が値に現れないようにするため）。
 *
 * **両側が同じ文字列を持っている値だけで組み立てる。** これが要点。
 * `proxyUri` は入れない — GROWI は管理者が画面に入力した文字列、proxy は自分の設定値、と
 * **出どころが違う**ので、末尾スラッシュ・大文字小文字・`:443` の有無が 1 文字ずれただけで
 * 署名が一致せず、**リバースプロキシの内側のような普通の構成でペアリングが 1 度も成立しない**。
 * しかも失敗は `ownership-unverified` としか見えないので、運用者は URL の書き方ではなく到達性を疑う。
 *
 * **入れなくても足りる。** 用途の区切りは接頭辞が担い、この 1 回のペアリングへの結び付けは
 * `registrationCode`（128 bit 以上の乱数で、**proxy が発行し ④ で送り返される**）が担う。
 * proxy B は自分が発行していない登録コードを持たないので、**proxy 間の持ち回しもこれで塞がっている。**
 */
export const pairingChallengePayload = (
  registrationCode: string, challenge: string,
): string => `growi-chat-pairing-challenge:v1:${registrationCode}:${challenge}`;
```

**なぜ必要か。** ⑤ は鍵がまだ無い時点の口なので**署名で守れない**。答える条件は「保留中の登録コードと一致すること」だけである。
そこで登録コードを窓の開いている間に見た第三者が、proxy を経由せず GROWI の ⑤ へ直接、
**`challenge` に RFC 9421 の署名対象文字列そのものを入れて**投げると、その署名を受け取れる。
それを `Signature` ヘッダに載せれば**その GROWI 本人として通る**。

接頭辞を付ければ、⑤ が返す署名は **RFC 9421 の署名対象文字列としては絶対に現れない形**になり、この経路が閉じる。

**⑤ は、保留中の登録コードが生きている限り、どの `challenge` にも答える。**
答えた内容を覚えて次から断る、という形にはしない。守りは接頭辞（上）と、口ごとの回数の上限だけである。

| 縛り | 中身 |
|---|---|
| 用途の接頭辞 | 上のとおり。**何度答えても、返した署名は本番のリクエストには使えない** |
| 回数の上限 | 保留 1 件あたり **1 分 30 回**を上限とし、超えたら 429 を返す。保留そのものの寿命（既定 10 分）でも自然に閉じる |
| `challenge` の形 | base64url、**32〜128 文字**。これを外れたら 400。長い本体を投げ込ませない |

**「一度答えたら、以後は同じ問いにしか答えない」という形にしてはいけない。**
⑤ は誰でも叩ける口なので、**登録コードを盗み見た第三者が本物の proxy より先に自分の `challenge` で叩けば、
本物の ④ が来たときには「違う問い」になって断られる。** やり直しても記録は変わらないので、
**その登録コードでは二度とペアリングできない。**
proxy から見た症状は `ownership-unverified` で、保留が失効したときと同じなので、
運用者は URL の到達性や設定の書き方を疑い、原因に辿り着けない。
答えられる問いの数に上限を置いても同じで、**攻撃の手数がその数になるだけ**である。

回数を増やしても危なくならないのは、**接頭辞が付いた文字列が RFC 9421 の署名対象としては絶対に現れない**からである。
署名を何本集めても本番のリクエストには使えず、Ed25519 は署名を集めても秘密鍵が出る方式ではない。

> **`OwnershipChallenge` に送り主を示す値は入っていない**（`registrationCode` と `challenge` の 2 つだけ）。
> したがって「③ の送信先や申告された `keyId` と突き合わせる」形の確認は**書いても実装できない**。
> 守りとして数えないこと。③ で申告された鍵は、⑤ が**その鍵で署名する**ことで縛る（次の項）。

#### ⑤ が公開鍵を縛る理由 — 条件だけでは鍵のすり替えを止められない

⑤ に「保留中の登録コードと一致するときだけ答える」という条件を付けても、**まだ足りない。**
その条件が示すのは「その URL に居る誰かが登録コードを知っている」ことだけで、
**③ で申告された公開鍵がその相手のものである**ことは示さないからである。

具体的な壊れ方 — 登録コードを見た第三者が、`growiUri` に**本物の GROWI** を、
公開鍵に**自分の鍵**を書いて ③ を送る。本物の GROWI は同じコードを保留しているので ⑤ に答えてしまい、
**proxy は第三者の鍵を登録する。** 以後その第三者は、本物の GROWI として通る署名を作れる。

**そこで ⑤ の応答に `challengeSignature` を含める** — ③ で申告した秘密鍵で `challenge` に署名したもの。
GROWI は自分が申告した鍵でしか署名できないので、鍵のすり替えが成立しなくなる。
あわせて GROWI 側の保留の行に、**送信先の proxy と自分が申告した `keyId` を記録し、⑤ で突き合わせる。**

#### ④ で申告された URL を検証する（踏み台にされないため）

**`pairing/submit` は署名の付かない唯一の入口で、そこで受け取った URL へ proxy が自分からリクエストを送る。**
何も検証しないと、登録コードを 1 つ持っている人が **proxy を踏み台にして、proxy から届く範囲の任意のホストを叩かせられる。**
閉域構成（要件 13）では proxy は閉域内の GROWI に届く位置に置くので、**これはそのまま閉域内を外から探る手段になる。**
proxy が侵害される前の、正常に動いている proxy がやってしまう点が重い。

`OwnershipChallenge` を送る前に、次をすべて満たすことを確かめる。

| 条件 | 理由 | `allowList` で外れるか |
|---|---|---|
| scheme が `https` のみ | 平文と、`file:` などの別 scheme を除く | **外れる** |
| ポートは既定（443）のみ | 内部サービスの探索を防ぐ | **外れる** |
| 名前を引いた結果が**私的アドレス帯でない**（RFC 1918・リンクローカル 169.254.0.0/16・ループバック・ユニークローカル） | クラウドのメタデータ（169.254.169.254）と閉域内のホストを除く | **外れる** |
| **確かめたアドレスへそのままつなぐ** | 確認の後で別のアドレスへ差し替わることを防ぐ | 外れない |
| **リダイレクトを追わない** | 追うと上の検証をすべて迂回できる | 外れない |
| 応答の待ち時間に上限を置く | 応答しない相手で詰まらせない | 外れない |

> **`allowList` は上の 3 つを**まとめて**外す。** 私的アドレス帯だけを外す形にすると、
> 閉域の GROWI がふつうに使う `http://growi.internal:3000` が scheme とポートで断られ、
> **要件 13 の構成でペアリングが 1 度も成立しない。** そのとき運用者に見えるのは
> `ownership-unverified` だけなので、原因に辿り着けないまま、証明書の検証を切るなどの
> **この検証を丸ごと無効にする回避**へ向かう。それを避けるために 3 つまとめて外す。
>
> **照合するのは URI に書かれたホスト名**であって、引き終わったアドレスではない。
> アドレスの側で照合すると、名前の引き先が変わっただけで許可が別のホストへ移る。
>
> **`allowList` に挙げた宛先には、つなぐときに信頼する証明書の根拠を運用者が指定できるようにする**
> （`chat-integration-proxy` の `runtime/config.ts` が持つ）。閉域では自前の認証局や自己署名の証明書が
> ふつうなので、指定する手立てが無いと**証明書の検証そのものを切る**構成に落ちる。
> そこまで落ちると、リダイレクトを追わない・確かめたアドレスへつなぐ、という残りの守りも
> 実質的な最後の一枚を失う。

**管理者に返すのは失敗の種類（`ownership-unverified`）だけで、相手の応答の中身は返さない。** 返すと探索の結果が読めてしまう。

**登録コードそのものの強さ**: 128 bit 以上の乱数。proxy 側は `pairing_order` にハッシュで保存し、平文で持たない。
**installation ごとに、発行数と間違えた試行の回数に上限を置く。**

> **custom proxy の例外**: 閉域内では GROWI の URL が私的アドレス帯になるのが普通なので、
> **許す宛先を運用者が設定で明示できる**ようにする。official proxy はこの設定を持たず、既定で拒む。

**判定はペアリングのときだけでなく、保存した URL へ送る毎リクエストの前に掛ける。**
ペアリングのときだけだと、④ で公開アドレスを申告して通し、そのあと名前の引き先を閉域内のアドレスへ
付け替えれば、proxy は以後ずっとそこへ送り続ける。**この検証が防ごうとしたものがそのまま成立する。**
毎回掛けるのは `chat-integration-proxy` の担当（`relation/growi-uri-resolver.ts`）で、
名前を引き直す・引いたアドレスを判定に掛ける・確かめたアドレスへつなぐ、をリクエストごとに行う。

#### この検証を**どちらが持つか**（宙に浮かせない）

本パッケージは Allowed Dependencies のとおり `node:dns` もネットワークも使えない。
一方 `chat-integration-proxy` の design は「検証は `@growi/chat` の関数を使う」と書いていた。
**このままだと両側が相手を担当だと読み、誰も実装しないまま終わる。** そうなるとこの検証が防ぐはずだったもの
（登録コードを 1 つ持つ人が proxy を踏み台にして閉域の中を探ること）が丸ごと無くなり、
しかも動いている限り誰も気づかない。**担当を次のとおり割る。**

| 何を | どちらが |
|---|---|
| 条件そのものの判定（https か・既定ポートか・**引き終わったアドレス**が私的帯でないか・`allowList` との照合） | **`@growi/chat`**（`src/url-guard/`）。引数だけで決まる純粋関数 |
| 名前を引く（`node:dns`）、確かめたアドレスへつなぐ、リダイレクトを追わない、待ち時間の上限、**`allowList` の宛先に使う証明書の根拠**、**毎リクエストで判定を掛けること** | **`chat-integration-proxy`**。ネットワークに触れる側 |

```typescript
// packages/chat/src/url-guard/growi-uri-guard.ts
export type UriVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'scheme' | 'port' | 'private-address' | 'malformed' };

/** 名前を引いた結果を**呼ぶ側が渡す**。このパッケージは名前を引かない */
export const judgeGrowiUri: (
  uri: string,
  resolvedAddresses: ReadonlyArray<string>,
  /**
   * custom proxy が閉域の宛先を明示するため。**照合するのは `uri` のホスト名**であって
   * `resolvedAddresses` ではない（アドレスで照合すると、名前の引き先が変わっただけで許可が移る）。
   * 一致した宛先は **scheme・ポート・私的アドレス帯の 3 つをまとめて**通す
   */
  allowList?: ReadonlyArray<string>,
) => UriVerdict;
```

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
  readonly relationId: string;
  /**
   * **コマンド 1 つにつき 1 行。** `scope`（全 GROWI 向けか単一向きか）は行に持たない —
   * それは `COMMAND_TRAITS` の `targeting` で決まっているので、行にも持つと同じ知識の二重持ちになり、
   * 2 行が食い違ったときにどちらを見るかが決まらなくなる。
   */
  readonly channelPermissions: ReadonlyArray<{
    readonly commandName: CommandName;
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
export interface BroadcastTarget {
  readonly relationId: string;
  readonly verdict: PermissionVerdict;
}

/**
 * 全 GROWI 対象のコマンドで、配ってよい相手を絞る（要件 11.2）。
 * **落とした相手も理由つきで返す** — 要件 11.3 と `FanOutOutcome.excluded` が
 * 「配らなかった相手を利用者に示す」ことを求めるため。許可した一覧だけを返すと理由が落ちる。
 */
export const filterBroadcastTargets: (
  settingsByRelation: ReadonlyArray<{ relationId: string; settings: RelationSettings | null }>,
  commandName: CommandName,
  channel: ChannelRef,
) => ReadonlyArray<BroadcastTarget>;
```

**既定値** — 次の 2 つは**同じ扱い**にする。
1. `settings` が `null`（まだ一度も受け取っていない関係）
2. `settings` はあるが、**そのコマンドの行が無い**（`COMMAND_NAMES` に名前を足した直後は必ずこうなる）

どちらの場合も:
- `isWriteCommand()` が真のもの: **不許可**（`no-settings`）
- それ以外: **許可**

2 を書かずに済ませると、**唯一の存在理由が「両側で同じ結果になること」である関数が、
正当なデータに対して答えを 1 つに決められない**状態になる。

**複数の GROWI が紐づくチャンネルでの合成**: **全体で許す・許さないを決めず、GROWI ごとに絞る。**
- 全 GROWI 対象（`search` / `help`）: 許可している GROWI にだけ配る。**配らなかった GROWI は利用者に示す**（要件 11.3）
- 対象が 1 つに定まる（`create-page` / `keep`）: 許可している GROWI だけを選択肢に並べる（要件 8.2）
- 1 つも無ければ実行せず、理由を示す。**`no-settings` と `not-permitted-in-channel` は文面を分ける** —
  前者は「まだ設定されていません（管理者に設定を依頼してください）」、後者は「このチャンネルでは使えません」。
  要件 11.3 が理由を示すことを求めているので、1 つに丸めない

理由 — 「全台が許可でなければ通さない」だと 1 台の設定漏れで全体が止まり、
「1 台でも許可なら全台へ通す」だと許可していない GROWI へ配ってしまう。

- Invariants: **純粋関数。** 設定と引数だけで決まり、DB も時刻も読まない。両側で同じ結果になることが唯一の存在理由

---

### 通信契約

> **受け取った本文は必ず形を確かめる。** 署名の検証が示すのは「経路上で書き換えられていない」ことだけで、
> **「契約どおりの形をしている」ことは示さない**。正しく署名された壊れた本文はそのまま処理へ届く。
> 契約の型ごとに検査する関数を本パッケージが提供し、**両側がそれを使う**（同じ受け入れ条件を持つことが本パッケージの前提そのもの）。
> 知らない `kind` は `unknown-kind` として断る。`keyword` と `path` と `body` の長さ、`limit` の上限もここで決める。
>
> ```typescript
> export const parseCommandRequest:      (raw: unknown) => CommandRequest      | { readonly error: 'malformed' | 'unknown-kind' };
> export const parseNotificationRequest: (raw: unknown) => NotificationRequest | { readonly error: 'malformed' };
> export const parseSettingsPush:        (raw: unknown) => SettingsPushRequest | { readonly error: 'malformed' };
> export const parseKeyRegistration:     (raw: unknown) => KeyRegistrationRequest | { readonly error: 'malformed' };
> export const parseKeyRevocation:       (raw: unknown) => KeyRevocationRequest   | { readonly error: 'malformed' };
> export const parsePairingSubmission:   (raw: unknown) => PairingSubmission   | { readonly error: 'malformed' };
> export const parseAccountLinkStart:    (raw: unknown) => AccountLinkStartRequest | { readonly error: 'malformed' };
> ```

```typescript
export interface CommandEnvelope {
  /** 再送しても変わらない。二重実行の判定に使う（要件 10.4）。**宛先ごとに別の値** */
  readonly requestId: string;
  /** どの GROWI との関係か。**proxy がペアリング成立時に採番する**（下記「関係を指す識別子」） */
  readonly relationId: string;
  readonly actor: ChatAccountRef;
  /**
   * どのチャンネルから来たか。GROWI 側でもチャンネル権限を判定し直すために運ぶ。
   * **ただし proxy が名乗る値なので、侵害された proxy に対する防御にはならない**
   * （どこでも不許可のコマンドを除く）。詳細は umbrella の Security Considerations。
   * 監査ログにチャンネルを残せる価値がある。
   */
  readonly channel: ChannelRef;
}

/** `kind` は `CommandName` そのもの。**文字列を書き並べない** — 語彙を 1 か所に置くと決めた以上、ここも従う */
export type CommandRequest = CommandEnvelope & (
  | { readonly kind: typeof COMMAND_NAMES.search;      readonly keyword: string; readonly limit: number }
  | { readonly kind: typeof COMMAND_NAMES.createPage;  readonly path: string; readonly body: string }
  | { readonly kind: typeof COMMAND_NAMES.keep;        readonly path: string; readonly messages: ReadonlyArray<KeepMessage> }
  | { readonly kind: typeof COMMAND_NAMES.linkPreview; readonly pageUrl: string }
  | { readonly kind: typeof COMMAND_NAMES.help }
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

/** 応答の種類の語彙。**`CommandRequest` の `COMMAND_NAMES` と同じ扱いにする**
 *  — 片方だけ定数にすると、文字列を手で書いた側が黙って綴りを間違える */
export const RESPONSE_KINDS = {
  search: 'search', created: 'created', linkPreview: 'link-preview',
  help: 'help', accountLinkRequired: 'account-link-required', error: 'error',
} as const;
export type ResponseKind = (typeof RESPONSE_KINDS)[keyof typeof RESPONSE_KINDS];

export type CommandResponse =
  | { readonly kind: typeof RESPONSE_KINDS.search; readonly items: ReadonlyArray<SearchResultItem>; readonly appliedAs: 'linked-user' | 'anonymous' }
  /** `create-page` と `keep` の両方がこれを返す */
  | { readonly kind: 'created'; readonly pageUrl: string; readonly importedMessageCount?: number }
  | { readonly kind: 'link-preview'; readonly path: string; readonly restricted: boolean; readonly excerpt?: string; readonly updatedAt?: string; readonly commentCount?: number }
  | { readonly kind: 'help'; readonly commands: ReadonlyArray<{ name: CommandName; usage: string; description: string }> }
  | { readonly kind: 'account-link-required'; readonly growiLabel: string; readonly linkUrl: string }
  | { readonly kind: 'error'; readonly code: 'forbidden' | 'path-conflict' | 'invalid' | 'not-permitted-in-channel' | 'no-settings' | 'unknown-kind'; readonly message: string };
```

**通知の再送は宛先ごとに記録する**（`CommandRequest` とは扱いが違う）。
`(relationId, requestId)` だけで記録して同じ応答を返すと、**やり直しは記録を読み直すだけで投稿を一度も試みない。**
宛先の一部が `timeout` や `platform-error` だった通知は、何度やり直しても同じ結果が返って上限に達する。
そこで **`(relationId, requestId, platform, channelId)` の単位で記録し、`posted` になった宛先だけを飛ばす。**
やり直しが実際に働くのはこの形だけである。

**コマンドの再送したときの応答**: GROWI は処理済みの `(relationId, requestId)` に対し、**1 回目の `CommandResponse` をそのまま返す。**
これをしないと、再送の 2 回目が `path-conflict`（既にページがあります）になり、
利用者は自分が作らせたページのリンク（要件 4.2）を受け取れない。

```typescript
/** GROWI → proxy。通知は markdown 文字列で送る（決定 3） */
export interface NotificationRequest {
  readonly requestId: string;
  readonly relationId: string;
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
  /**
   * **常に `targets` の全件ぶんを返す。** やり直しのときも、前回 `posted` だった宛先は
   * その結果をそのまま載せる。「今回試した宛先だけ」を返すと、
   * GROWI が結果を outbox の行に書き戻すたびに**前回の成功が消える**。
   */
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
  readonly relationId: string;
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
6. `judgeGrowiUri` — https 以外・既定外ポート・私的アドレス帯が**すべて拒まれる**こと。
   `allowList` に挙げた宛先は、**scheme が `http`・既定でないポート・私的アドレス帯のどれであっても**通ること。
   挙げていない宛先は 3 つとも断ること。照合が**URI に書かれたホスト名**に対して行われ、
   引き終わったアドレスに対しては行われないこと（9.2・13.1）。
   **リダイレクトは proxy 側の担当なのでここでは試験しない**
7. コマンド名の語彙 — `COMMAND_NAMES` に無い名前が `RelationSettings` に入らないこと（型で担保）
8. **`judge` の既定値** — 設定が無いときと、設定はあるがそのコマンドの行が無いときで**同じ答え**になること（11.1）
9. **再送の署名** — `requestId` を据え置き `nonce` を取り直した 2 回目が `replayed` にならず、
   1 回目の応答をそのまま受け取れること（10.4・2.4・4.2）
10. **有効期間の上限** — 送る側が長い `expiresInSec` を指定しても、受ける側が上限で切ること。
    `consumeNonce` に渡る期限が上限を超えないこと（10.3）
11. **公開鍵の検査** — `kty` / `crv` が違う鍵、**秘密の成分を含む鍵**が登録を拒まれること（10.6）
12. `encodeKeyId` / `decodeKeyId` の往復。`:` を含む入力が `null` になること
13. `parseCommandRequest` — 知らない `kind`、欠けた項目、長すぎる値が断られること

### Integration Tests

1. ペアリングの往復 ①〜⑥ が成立し、双方に相手の公開鍵が登録されること（9.1–9.5）
2. **ペアリングを始めていない GROWI が `OwnershipChallenge` に答えないこと**（9.2 の本質）
3. 失効した登録コードが拒まれること（9.4）
4. 鍵の入れ替え — 新旧が両方有効な間、どちらの署名でも検証が通ること。
   **有効な鍵が 0 本になる失効の要求が `would-leave-no-valid-key` で断られること**（10.5）
5. **鍵のすり替え** — 登録コードを知る第三者が、他人の `growiUri` と自分の公開鍵で申し込んでも、
   `challengeSignature` の検証で成立しないこと（9.2・9.5）
6. **署名の代行窓口が閉じていること** — `challenge` に **RFC 9421 の署名対象文字列そのもの**を入れて ⑤ を叩き、
   返った署名を `Signature` ヘッダとして使っても**通らないこと**（9.6・10.6）。
   この設計の要になった判断なので試験で固定する
7. **⑤ はどの `challenge` にも答える** — 保留が生きている間は、違う `challenge` が続けて来ても
   それぞれに署名を返すこと。**先に別の `challenge` で叩かれても、本物の問いに答えられる**こと。
   上限（1 分 30 回）を超えたときだけ 429 になること。`challenge` が base64url でない、または
   32〜128 文字を外れたら 400 になること（9.2・9.3）
