# Technical Design — chat-integration-app-ui

> umbrella: [chat-integration](../chat-integration/)。直す対象は [chat-integration-app](../chat-integration-app/)（実装済み）の 3 画面。
> 要件はこの spec の [requirements.md](./requirements.md)（書き戻し後は umbrella の `requirements.md`）。決定の根拠と採らなかった案は [research.md](./research.md)。

## Amend target

| 対象の spec | 変わる部分（書き戻し先） |
|---|---|
| `chat-integration` の `requirements.md` | 要件 2.12〜2.14、7.9〜7.12、9.9〜9.12 を、各要件の末尾へ足す。既存の番号は振り直さない |
| `chat-integration` の `roadmap.md` | 順 4 の行と節「4. app の見え方」を消す。順 4 を参照している文（「順 4・5・6 は app だけの変更で…」）を書き直す |
| `chat-integration-app` の `design.md` | 下の「design.md への書き戻しの一覧」の 6 か所 |
| `chat-integration-app` の `research.md` | この spec の research.md の決定 1〜6 を足す |

- **Revalidation Triggers**: `chat-integration-app` の既存の項目には触れない（`@growi/chat` の契約、proxy の能力表・通知契約は変えない）。**1 つ足す**: proxy の署名の検査が、拒否したとき 401 以外を返すようになったら、`ProxyCallFailure` の `rejected` の判定を見直す。
- **触れない節**: `chat-integration-agent` が書き換える「権限」「能力表」の節、roadmap 順 8 が作り直す管理画面の表と 2 つの節。この spec は、それらを描く部品（`CapabilityReportTable`、`ChannelPermissionsSection`、`NotificationDestinationsSection`）のファイルと、`RelationRow` の中での並びを変えない。

### design.md への書き戻しの一覧

1. `ChatAccountLink` の「承認画面」の行: 「`workspaceName` と `platform` と表示名を `chat_relations` から引いて添える」を、「`workspaceName` と `platform` は `chat_relations` から、チャットアカウントの表示名は注文（`chat_account_link_orders.accountDisplayName`）から引いて添える」に直す。ログイン中のユーザーと GROWI の名前も出すことを足す
2. Data Models の `chat_account_link_orders` の項目に `accountDisplayName`（任意）を足す
3. ファイル構成の `client/` の節と Modified Files に、承認画面の専用ページ `pages/me/chat-integration/account-link/[token].page.tsx` と、`pages/me/[[...path]].page.tsx` から項目を外したことを足す
4. 「保存時に宛先を選ぶ UI」の行（Modified Files）を、トグルのボタンとチェックボックスのメニューの形に書き換える
5. `ProxyClient` の行に、失敗の種類 `rejected`（署名の拒否）を足す
6. 管理画面の記述に、関係の状態の導き方（`state` と接続の状態の問い合わせから、バッジを決める）を足す

---

## Overview

**Purpose**: 3 つの画面について、誤った表示と取り違えを招く表示をなくし、編集画面の配置を保つ。
**Users**: ページを保存する編集者、GROWI の管理者、チャットのアカウントを紐付ける利用者。
**Impact**: `apps/app/src/features/chat-integration/` の中の変更が中心。feature の外は、`pages/me/` に専用ページを 1 枚足し（`[[...path]]` から項目を 1 つ外す）、`SavePageControls.tsx` が選択部品へ向きの指定を渡す 2 行、locale の JSON。

### Goals

- 要件 2.12〜2.14、7.9〜7.12、9.9〜9.12 を満たす
- 画面が返す・送る値は今のまま（選択部品の出力、承認の API、管理画面の API の形）

### Non-Goals

- requirements.md の Out of scope と同じ

---

## Boundary Commitments

### This Spec Owns

- `client/notification/ChatIntegrationDestinationSelect.tsx` の見た目と操作（出力の型は変えない）
- `client/admin/AdminChatIntegration.tsx` のうち、`RelationRow` のバッジと「Connection」の行
- `client/components/AccountLinkApproval.tsx` と、その専用ページ
- `chat_account_link_orders.accountDisplayName` と、承認画面へ返す表示データの項目
- `proxy-client.ts` の失敗の種類 `rejected`

### Out of Boundary

- 要件 2.2・7.3・7.4・9.7 の規則そのもの
- 管理画面の表・権限・宛先の節（上の「触れない節」）
- proxy、`@growi/chat`

### Allowed Dependencies

| 依存先 | 制約 |
|---|---|
| `GrantSelector.tsx` の形（トグル + メニュー） | 形を借りるだけ。import しない |
| `RawLayout`（`components/Layout/`） | 承認の専用ページが使う。`BasicLayout`・`NoLoginLayout` は使わない（理由は research.md 決定 4） |
| `useAppTitle()`・`useSiteUrl()`（`~/states/global`） | 「この GROWI の名前」を出すために読む |

### Revalidation Triggers

上の「Amend target」に書いたとおり、足すのは 1 つだけ。

---

## 1. 保存時の通知先の選択部品（要件 2.12〜2.14）

### 原因

`<select multiple>` は、ブラウザが選択肢の数に応じて縦に伸びる。`SavePageControls` の横並びの欄は `flex-nowrap` なので、伸びた分だけ欄全体が背が高くなり、編集画面の下端の操作欄が押し上げられる。

### 作り

`GrantSelector.tsx` と同じ形にする。

```
[ Chat: 2 selected ▾ ]            ← トグルのボタン（1 行・固定の高さ）
  ┌──────────────────────────┐
  │ Workspace A                │  ← workspace ごとの見出し（小さい文字）
  │ ☑ #general                 │
  │ ☐ #random   (private)      │
  │ Workspace B                │
  │ ☐ #general                 │
  │ ─────────────────────────  │
  │ ⚠ Workspace C could not be │  ← 取得できなかった workspace（今ある警告をメニューへ移す）
  │   listed (unreachable)     │
  └──────────────────────────┘     max-height: 50vh、overflow-y: auto
```

- **部品の props**: `destinations`・`onChange`（今のまま）に、`openInModal?: boolean` を足す。メニューの向きは `GrantSelector` と同じで、編集画面の下端の欄では上向き（`direction="up"`）、モーダルの中では下向き。`SavePageControls.tsx` の 2 か所の使用箇所に `openInModal` を渡す（横並びの欄は渡さず、モーダルの方は `openInModal`）
- **ボタンの文言**: 選択が 0 件なら `chat_integration.destination_select.summary_none`、1 件以上なら `chat_integration.destination_select.summary_selected`（`{{count}}` を使う。複数形の別キーは作らない）。ボタンの `title` に、選択中のチャンネルの `workspace / #channel` を改行で並べる
- **メニューの中**: `workspaceName` ごとに見出しを出し、その下にチャンネルをチェックボックスで並べる。見出しの単位は `relationId`（同じ名前の workspace が 2 つ紐づくことがあるため）。見出しの文字は `workspaceName`。チェックボックスの `id` と `label` の対応は `useId()` で付ける（`useId()` を reactstrap の `target` には渡さない。`apps/app/.claude/rules/ui-pitfalls.md`）
- **出力**: 今と同じ `{ relationId, platform, channelId }` の配列。`channelName` は含めない。順序は、メニューに並ぶ順（取得したチャンネルの順）にする。チェックを外したら配列から消す。**入力欄は置かない**（検索ボックスも付けない。付けると要件 2.2 の「選択肢からしか選べない」を崩しうる。件数が多すぎて困る声が出たら別の spec で扱う）
- **開いたままにする**: チェックを 1 つ入れてもメニューが閉じない。`Dropdown`（制御つき）を使い、チェックボックスは `DropdownItem` にしない（`DropdownItem` は押すとメニューを閉じる）。reactstrap 9.2.2 の `container="body"` のメニューで、メニュー内のクリックが「外側のクリック」と判定されて閉じることがないかは、実装時に確かめる（確かめ方は tasks の 3.2 と research.md の「未確認」）。閉じてしまう場合は、メニューの `onClick` で伝播を止める
- **チャンネルが 0 件のとき**: 今と同じく何も描かない（取得できなかった workspace があっても同じ。今の挙動）
- **取得できなかった workspace がある場合**: 今は警告が選択肢の下に常に出ている。メニューへ移すと、開くまで気付けないので、ボタンに小さな警告の印（`warning` アイコン）を付け、`title` に「一部の workspace のチャンネルを取得できませんでした」を出す。詳しい内容（workspace 名と理由）はメニューの中に出す。理由は research.md 決定 1
- **文言**: `chat_integration.destination_select.*` を `translation.json` に 5 言語で足す。ボタンのラベル、`(private)`、取得できなかった workspace の警告、ボタンの `aria-label`

### 保つ契約（テストで固定する）

- 自由入力の欄が無い（`textbox`・`combobox` が無い）
- 出力は `relationId`・`platform`・`channelId` だけで、`channelName` を含まない
- 2 つの workspace に同じ `channelId` があっても、選んだ方の `relationId` が出る
- 紐づく workspace が無ければ何も描かない

## 2. 接続が切れた関係の表示（要件 9.9〜9.12）

### 信号の出どころ

GROWI の側に「解除された」と知る新しい手段は作らない。今ある信号は 1 つ: proxy は、鍵を消した関係からの署名付きの呼び出しを、`signature-guard.ts` で拒否して**空の 401** を返す。拒否の理由は返さない（呼び出す側が関係の有無を探れないようにする、という proxy の設計）。GROWI から見えるのは「署名を受け付けられなかった」ことだけである。

### 変更点

| ファイル | 変更 |
|---|---|
| `server/proxy-client.ts` | `ProxyCallFailure` に `'rejected'` を足す。`sendSigned` で、応答の status が 401 のとき `rejected` を返す（他の 2xx 以外は今までどおり `http-error`）。`rejected` の説明に「proxy がこの GROWI の署名を受け付けなかった。理由は分からない（proxy は拒否の理由を返さない）」と書く |
| `server/admin/admin-router.ts` | 変更なし。`connectionStatusHandler` は既に `result.reason` を `ErrorV3` の code にして 502 で返す。**401 のまま返さない**（クライアントの共通処理が 401 をログイン切れと読むため）。テストで、`rejected` が code として届くことだけを固定する |
| `client/admin/relation-connection-state.ts`（新規） | 純粋関数 `deriveRelationBadge(state, connectionStatusError)` と `isConnectionRejected(error)`。`apiv3` が返す失敗（配列の `errors[0].code`）を読む。フレームワークに依存しない |
| `client/admin/AdminChatIntegration.tsx` の `RelationRow` | バッジを `deriveRelationBadge` の結果で出す。「Connection」の行で、`rejected` のときは「接続が切れています」の説明を出す |

### 表示の規則

`RelationRow` が受け取る入力と、出す結果。

| `relation.state` | 接続の状態の問い合わせ | バッジ | 「Connection」の行 |
|---|---|---|---|
| `unpaired` | 問い合わせない | `unpaired`（今のまま、灰色） | 出さない（今のまま） |
| `active` | 成功 | `active`（緑） | `connected` などの `health`（今のまま） |
| `active` | 失敗（`rejected`） | **「接続が切れています」（赤）** | 説明文（下） |
| `active` | 失敗（それ以外） | `active`（緑のまま） | 「Failed to load connection status」（今のまま、赤字） |
| `active` | まだ読み込み中 | `active`（緑） | 何も出さない（今のまま） |

- 「失敗（それ以外）」で緑のバッジを残すのは、GROWI の記録としては関係が `active` であり、切れたと断定できる材料が無いため（要件 9.11）。
- **前に成功した値が SWR のキャッシュに残る**。SWR は、再取得が失敗しても前の成功値（`data`）を返し続けるので、`error` と `data` が同時に入る。`rejected` のときは `data`（古い `health`）を出さない。出すと「connected」と「接続が切れています」が並ぶ。`deriveRelationBadge` のテストに、この組み合わせを含める。
- 説明文（要件 9.10）: 「proxy がこの GROWI を受け付けなくなりました。チャット側で `unregister` された可能性があります。通知とコマンドは使えません。GROWI 側の関係を片付けるには、下の『Disconnect』を押してください。」。時計のずれや鍵の不一致でも同じ状態になりうるので、「可能性」と書き、再度ペアリングを試す案内も 1 文添える。文言は `admin.json` の `chat_integration.connection_lost.badge` と `.detail` に 5 言語で足す（管理画面は `admin` namespace だけを読み込む。`pages/admin/_shared/get-server-side-common-props.ts`。`translation` に置くと本番で生のキーが出る）
- 自動で解除はしない（要件 9.12）。GROWI 側の解除は `UnpairButton`（今ある）が `unpairRelation` を呼ぶ。この関数は proxy を呼ばず GROWI 側だけで完結するので、接続が切れていても動く。
- 管理画面のほかの文言は英語の直書きのまま。この spec で `t()` にするのは、上の 2 キーだけ。

## 3. 承認画面（要件 7.9〜7.12）

### データ

**注文に表示名を保存する。**

| 変更 | 内容 |
|---|---|
| `models/chat-account-link-order.ts` | `accountDisplayName: { type: String, default: null }` を足す。型 `IChatAccountLinkOrder` にも `accountDisplayName: string \| null` を足す。索引は変えない。移行は不要（注文の寿命は 10 分で、TTL 索引が消す。足す前に作られた注文は `null` のまま使える） |
| `account-link/create-link-order.ts` | `findOrCreatePendingAccountLinkOrder` が新しい注文を作るとき `accountDisplayName: actor.displayName` を保存する。前後の空白を落とし、空文字なら `null`。**既にある注文を使い回すときは書き換えない**（同じチャットアカウントの注文なので、表示名が数分で変わっても承認の判断に影響しない） |
| `account-link/account-link-service.ts` | `getAccountLinkOrderForApproval` が返す表示データに `accountDisplayName: string \| null` と `growiName: string \| null`（承認しているユーザーの `name`）を足す。`expiresAt` は既に返している |

呼び出し元（`peer-router.ts` の `account-link-start`、`command-endpoint.ts`）は、どちらも `ChatAccountRef`（`displayName` を持つ）を既に渡しているので、呼び出し側の変更は無い。protocol の契約も変わらない。

**表示名は識別の根拠にしない。** Slack などの表示名は本人が自由に決められる。承認画面は、表示名を出すときも、**識別子（`accountId`）と workspace を同じ強さで必ず併記する**（要件 7.10・7.11）。表示名だけを大きく見せない。

### 画面

`client/components/AccountLinkApproval.tsx` を作り直す。置き場所は専用ページ。

```
┌──────────────────────────────────────────┐
│ [GROWI ロゴ]                               │  ← RawLayout の中のカード（最大幅 480px、中央寄せ）
│ アカウントの紐付けの確認                     │
│                                          │
│ この GROWI                                 │
│   {appTitle}   {siteUrl のホスト名}         │
│                                          │
│ あなた（GROWI にログイン中）                │
│   {growiName}  @{growiUsername}            │
│                                          │
│ 紐付けるチャットのアカウント                 │
│   Slack · {workspaceName}                  │  ← relationLabel があればその後ろに「（{relationLabel}）」
│   {accountDisplayName}  ID: {accountId}    │  ← 表示名が無ければ ID だけ
│                                          │
│ このリンクは {expiresAt} まで有効です。      │
│ 心当たりがなければ、承認せずに閉じてください。│
│                          [ 承認する ]       │
└──────────────────────────────────────────┘
```

- 3 つの塊に見出しを付け、内容を互いに区別する（要件 7.10）。リストの `ul` ではなく、定義リスト（`dl`）で作り、スクリーンリーダーが「項目名 → 値」と読めるようにする
- 結果の画面（成功・別のユーザーに紐付け済み・無効または期限切れ）も、同じカードの中に出す。文言は今の 3 つを、キーに直す（意味は変えない）。成功のときは、紐付いたチャットアカウントを 1 行添える
- 「この GROWI」の名前は `useAppTitle()`。`useSiteUrl()` からホスト名を出す。どちらも `_app` が全ページで埋める値で、専用ページでも読める。`relationLabel`（管理者が付けたラベル）は GROWI の名前ではなく**接続の名前**なので、チャットの側の行に添える
- 文言は `chat_integration.account_link.*` を `translation.json` に 5 言語で足す。`pages/me/[[...path]].page.tsx` の `'Link Chat Account'`（ページ見出し）も同じ namespace のキーにする
- 取り消しの口と、「別のユーザーでやり直す」導線は作らない（Non-Goals）。心当たりが無ければ閉じる、という案内だけを出す

### 経路とレイアウト

- **専用ページ** `apps/app/src/pages/me/chat-integration/account-link/[token].page.tsx` を足す。Next.js は、固定の経路を `[[...path]]` より優先する。`/me/*` は Express の `loginRequiredStrictly` を通るので、ログイン必須は今のまま（`server/routes/index.js:359-360`。変更しない）。URL（`ACCOUNT_LINK_ACCEPT_PATH`）も変えない
- ページは `RawLayout` で包む（サイドバー・ナビゲーションなし）。`getServerSideProps` は、`me/[[...path]].page.tsx` と同じく共通のプロパティと i18n（`translation`）だけを取る。`BasicLayout` が要る設定の取得（`getServerSideBasicLayoutProps`）は呼ばない
- トークンは `router.query.token` から読む（今の `useAccountLinkToken` の `path[2]` は消す）
- `me/[[...path]].page.tsx` の `chat-integration` の項目と `AccountLinkApproval` の dynamic import を消し、`me/[[...path]].page.spec.tsx` の対応するテストを専用ページ側へ移す
- Express が横取りする経路の一覧（`utils/is-next-page-route.ts`）が古くならないか、`next-express-route-consistency` の手順で確かめる（tasks の 2.4）

## Data Models

| コレクション | 変更 |
|---|---|
| `chat_account_link_orders` | `accountDisplayName`（String、任意、既定 `null`）を足す。消し方は今のまま（`expiredAt` の TTL 索引） |

## Error Handling

- 承認画面の取得が失敗したときの表示は今のまま（「無効、使用済み、または期限切れ」）。理由を区別しない（今の設計どおり）
- `rejected` と他の失敗の区別は、ネットワークの内側の事情を画面へ流さない（`ProxyCallFailure` は粗いまま、1 種類だけ増える。research.md 決定 3）

## Testing Strategy

`.claude/rules/testing.md` に従い、**テストは先に書いて落とす（RED → GREEN）**。`essential-test-design`（何を確かめるか）と `essential-test-patterns`（作り方。`vitest-mock-extended` の `mock<T>()`、`as` の型アサーションを避ける）を、テストを書く前に読む。

| 対象 | 確かめること（利用者に見える約束） | 置き場所 |
|---|---|---|
| 注文の作成 | 新しい注文に表示名が保存される。既にある注文を使い回すとき書き換えない。空白だけの表示名は `null` | `create-link-order.spec.ts`（既存） |
| 承認の表示データ | 表示名と `growiName` と `expiresAt` を返す。表示名が無い注文は `null` | `account-link-service.spec.ts`（既存） |
| 注文の model | `accountDisplayName` の列がある | `chat-account-link-order.spec.ts`（既存の `allFields`） |
| `proxy-client` | 401 のとき `rejected`、500 のとき `http-error`、接続失敗のとき `unreachable` | `proxy-client.spec.ts`（既存） |
| 管理画面の経路 | 接続の状態の取得が `rejected` のとき、502 と code `rejected` が画面まで届く | `admin-router.spec.ts`（既存） |
| `relation-connection-state` | 上の表の 5 行。**`error` と古い `data` が同時にあるとき** | `relation-connection-state.spec.ts`（新規） |
| 管理画面の行 | 接続が切れた関係に、「active」でなく「接続が切れています」が出る。説明文と「Disconnect」が出る。**古い `connected` が出ない**。切れていない関係は今までどおり | `AdminChatIntegration.spec.tsx`（既存に足す） |
| 選択部品 | 保つ契約の 4 つ。件数がボタンに出る。1 つ選んでもメニューが閉じない。取得できなかった workspace がメニューに出る。メニューにチャンネルが多くても、ボタンの要素の数は変わらない | `ChatIntegrationDestinationSelect.spec.tsx`（既存を、`listbox`・`selectOptions` から `checkbox` 中心に書き換える） |
| 保存の操作欄 | 選んだチャンネルが `chatIntegrationDestinations` として保存に載る。何も選ばなければ空 | `SavePageControls.spec.tsx`（既存の 2 件を書き換える） |
| 承認画面 | 3 つの塊（GROWI・ログイン中ユーザー・チャットのアカウント）が出る。表示名があるときは表示名と識別子の両方、無いときは識別子だけ。有効期限が出る。承認の結果 3 種 | `AccountLinkApproval.spec.tsx`（既存を書き換える） |
| 専用ページ | サイドバーが出ない。`router.query.token` を使う | `[token].page.spec.tsx`（新規。`me/[[...path]].page.spec.tsx` の既存の対応テストを移す） |

- 文言は `t` を `(key) => key` に差し替えるので、テストは**キーの文字列ではなく、意味のある単位（見出しの役割・値）**で確かめる。表示される値（`Test Workspace`、`U-alice` など）は、キーに依存しないのでそのまま確かめられる
- 5 言語の訳は、既存の `lint:i18n`（`pnpm run lint:i18n`）が、キーの欠けと基準値の増加を見る。専用の新しいテストは足さない
- 見た目（配置が崩れない）は jsdom では測れない。tasks の最後の動作確認で、開発サーバを起動し、画面で確かめる

## Why（この形にした理由）

- **選択部品を `GrantSelector` と同じ形にした**: 同じ操作欄に並ぶ部品が同じ操作（ボタンを押すとメニューが開く）になり、高さが 1 行に固定される。`<select multiple>` の `size` を 1 にする案は、ブラウザごとに見え方が違い、複数選択の操作（Ctrl/Cmd を押しながら選ぶ）を知らない人が選べない。詳しくは research.md 決定 1
- **接続が切れた状態に新しい信号を作らなかった**: proxy → GROWI の通知を足すと、`@growi/chat` と proxy の両方の契約が変わり、3 つの sub-spec すべての再検証が要る。今ある 401 は、見た目の誤りを正すには足りる。詳しくは research.md 決定 2・3
- **表示名を注文に保存した**: 表示名は承認の判断の助けになる（`U0123ABCD` だけでは、誰のアカウントか分からない）。protocol は変わらず、`actor.displayName` を保存するだけで済む。詳しくは research.md 決定 5
- **専用ページにした**: `BasicLayout` を外すには、ページごとにレイアウトを選べる単位が要る。`[[...path]]` の中でパスを見て分岐すると、1 つのページが 2 つのレイアウトを持つ。詳しくは research.md 決定 4
