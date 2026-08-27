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
/**
 * `relationId` と `keyId` は **`:` を含まない**（どちらも proxy と鍵の持ち主が採番するので守れる）。
 * `decodeKeyId` は**最初の `:` で切る**。含まれていたら `null` を返す。
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
  `relationId` に一本化した効き目は、この確認まで書いて完成する
- Invariants: **`consumeNonce` は署名の検証に成功した後にだけ呼ぶ。** 先に呼ぶと、
  鍵の識別子を知っているだけの相手が使い捨ての値の表を膨らませられる
- Invariants: 本体の無いリクエストにも空のバイト列に対する digest を付ける。
  `COVERED_COMPONENTS` を本体の有無で変えないため

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
   * GROWI 側で更新した時刻。**関係ごとに 1 つの値**であり、行ごとの時刻ではない
   * （設定全体を毎回まるごと送る形なので、行ごとに持つと比べる基準が決まらない）。
   * **proxy は自分が持つものより古い押し込みを捨てる。**
   * これが無いと、管理者が続けて 2 回変えて 1 回目の再送が遅れて届いたときに、
   * **古い設定が新しい設定を上書きする**（proxy には気づく手立てが無い）。要件 11.4 に触る。
   */
  readonly updatedAt: string;
}

/** proxy → GROWI（保険）。押し込みが届かなかったときに proxy が取りに行く */
export interface SettingsPullResponse {
  readonly settings: RelationSettings;
  /** GROWI 側で最後に更新した時刻。proxy は自分が持つものと比べて古ければ入れ替える */
  readonly updatedAt: string;
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

**あわせて 2 つ縛る。**

- **⑤ は「同じ問いには同じ答えを返す」。回数では縛らない。**
  保留の行に**答えた `challenge` と返した署名を記録**し（`answeredChallenge` / `answeredSignature`）、
  - **同じ `challenge` が再び来たら → 記録した署名をそのまま返す**
  - **違う `challenge` が来たら → 410**

  記録は**条件つき更新で 1 本に絞る**（`answeredChallenge` が未設定の行だけを取る）。
  ふつうの読み書きだと、④ が同時に 2 本届いたときに両方へ別々の署名を返してしまう。

  「1 回だけ答える」にすると**正常系が塞がる** — proxy の ④ には応答の待ち時間の上限があるので、
  GROWI が重くて上限を超えると **GROWI は答えて印を付け、proxy は受け取れない**。
  やり直すと 410 が返り、**応答が遅い GROWI は何度やってもペアリングできない**。
  症状は「所有確認に失敗」なので原因にも辿り着けない。
  **中身で縛れば、署名の集め放題を止めたまま正常なやり直しが通る。**
- **`relationId` は推測できない値にする**（proxy が採番する。連番にしない）。
  `keyid` として署名ヘッダに載り外部に出る識別子なので、数え上げられない値にしておく

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

#### この検証を**どちらが持つか**（宙に浮かせない）

本パッケージは Allowed Dependencies のとおり `node:dns` もネットワークも使えない。
一方 `chat-integration-proxy` の design は「検証は `@growi/chat` の関数を使う」と書いていた。
**このままだと両側が相手を担当だと読み、誰も実装しないまま終わる。** そうなるとこの検証が防ぐはずだったもの
（登録コードを 1 つ持つ人が proxy を踏み台にして閉域の中を探ること）が丸ごと無くなり、
しかも動いている限り誰も気づかない。**担当を次のとおり割る。**

| 何を | どちらが |
|---|---|
| 条件そのものの判定（https か・既定ポートか・**引き終わったアドレス**が私的帯でないか） | **`@growi/chat`**（`src/url-guard/`）。引数だけで決まる純粋関数 |
| 名前を引く（`node:dns`）、確かめたアドレスへつなぐ、リダイレクトを追わない、待ち時間の上限 | **`chat-integration-proxy`**。ネットワークに触れる側 |

```typescript
// packages/chat/src/url-guard/growi-uri-guard.ts
export type UriVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'scheme' | 'port' | 'private-address' | 'malformed' };

/** 名前を引いた結果を**呼ぶ側が渡す**。このパッケージは名前を引かない */
export const judgeGrowiUri: (
  uri: string,
  resolvedAddresses: ReadonlyArray<string>,
  allowList?: ReadonlyArray<string>,   // custom proxy が閉域の宛先を明示するため
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
   * それは `BROADCAST_COMMANDS` という定数で決まっているので、行にも持つと同じ知識の二重持ちになり、
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
- `WRITE_COMMANDS` に含まれるもの: **不許可**（`no-settings`）
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

export type CommandResponse =
  | { readonly kind: 'search'; readonly items: ReadonlyArray<SearchResultItem>; readonly appliedAs: 'linked-user' | 'anonymous' }
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
   `allowList` に挙げた宛先は私的帯でも通ること（9.2）。**リダイレクトは proxy 側の担当なのでここでは試験しない**
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
7. **同じ問いには同じ答え** — 同じ `challenge` の 2 回目に**記録した署名がそのまま返る**こと。
   違う `challenge` は 410 になること（9.2・9.3）
