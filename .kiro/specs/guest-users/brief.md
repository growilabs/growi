# Brief: guest-users（Public 非公開ゲストユーザー）

> umbrella spec: [enhanced-guest](../enhanced-guest/roadmap.md) の sub-spec。
> 依存: `granular-page-permissions`（read/edit ロール・グループ付与の基盤）。

## Problem（解決したい課題）

外部パートナーや一時メンバーに、**明示的に許可した領域だけ**を見せたい。しかし GROWI の
現行モデルでは `Public` ページは全ログインユーザーに自動的に見える。そのため、特定のサブツリー
（例: `/Projects/Foo` 配下）だけを共有したい相手にも、**社内向けの Public ページがすべて見えて
しまう**。

複数の導入検討者から繰り返し挙がっている要件:
> 「`/Projects/Foo` の下は全部見せたいが、その上位の Public ページは見せたくない」

これは既存の `User.readOnly`（書き込み禁止）でも、グループ付与（足し算で許可）でも表現できない。
必要なのは「**Public すら自動では見えず、明示的に許可した範囲だけが見える**」という、
ホワイトリスト型のアクセスを持つユーザー = ゲストである。これが Enhanced Guest
（[#11139](https://github.com/growilabs/growi/discussions/11139)）の中で唯一「ゲスト固有」と
言える振る舞いであり、ここでだけ専用の区分（userType）を導入する根拠になる。

## Current State（現状）

- **Public = 全員に見える**: grant `GRANT_PUBLIC=1` のページは全ログインユーザー（設定により
  匿名も）に閲覧可能。ユーザー側で「Public を見せない」よう絞る仕組みは無い。
- **ユーザー属性**: `User`（`apps/app/src/server/models/user/index.js` / `IUser` =
  `packages/core/src/interfaces/user.ts`）は `admin` / `readOnly` フラグと `status` を持つが、
  「アクセスのホワイトリスト化」を表す区分は無い。
- **招待フロー**: 既存の管理画面ユーザー招待（`apps/app/src/pages/admin/users/`）はあるが、
  「ゲストとして招待」「見せる範囲を指定して招待」という導線は無い。
- **依存基盤（別 sub-spec）**: `granular-page-permissions` がスコープ単位の read/edit ロールと
  非所属グループ付与を追加する。ゲストは「あるグループに read で所属し、そのグループに付与
  されたサブツリーだけ見える」形でアクセスを表現するため、その基盤の完成を前提とする。

## Desired Outcome（達成したい状態）

- **ゲスト userType**: Public ページが自動では見えず、**明示的に付与されたページ／サブツリー／
  グループのみ**閲覧できるユーザー区分。
- **招待フロー**: 管理者がゲストを招待でき、招待時に見せる範囲（グループ／サブツリー）を
  指定できる。
- **管理**: 管理画面でゲストを一覧・識別（バッジ）・絞り込みでき、付与範囲を編集できる。
- 既存の通常ユーザー・`readOnly` ユーザーの挙動は変わらない。

## Approach（採用アプローチ・暫定）

1. **userType の導入**: `User` / `IUser` に区分を追加（例: `userType: 'normal' | 'guest'`、
   具体形は design）。ゲストの判定は `User.readOnly` とは独立。
2. **アクセス評価の変更**: ページ閲覧可否判定で、ゲストには `GRANT_PUBLIC` の暗黙許可を
   与えない。閲覧可能なのは明示的に grant されたスコープ（`granular-page-permissions` の
   ロール付き grant）に限る。判定は `page-grant.ts` の実効ロール算出に「ゲストは Public を
   含めない」レイヤを重ねる（**二重定義を避け、基盤の算出を再利用**）。
3. **招待 UI**: 管理画面にゲスト招待フローを追加。`GrantSelector` / `SelectGroupModal` 側の
   「ゲストを含む/ゲストのみ」フィルタは基盤 UI の上に重ねる。
4. **管理 UI**: ユーザー一覧でゲストのバッジ・絞り込み・付与範囲編集。

進め方: brief → requirements（EARS、特にアクセス評価の不変条件）→ `kiro-validate-gap`
（アクセス判定の中核に触れるため必須）→ design → tasks。

## Scope

- **In**:
  - Public を自動公開しないゲスト userType（ホワイトリスト型アクセス）。
  - アクセス評価でのゲスト分岐（明示付与スコープのみ閲覧可）。
  - ゲスト招待フロー（範囲指定つき）。
  - 管理画面でのゲスト識別・絞り込み・付与範囲管理。
- **Out**:
  - read/edit ロール・非所属グループ付与・配下ツリー UI そのもの（`granular-page-permissions`）。
  - 有効期限／自動失効（`time-limited-access`）。ゲストと併用するが別 sub-spec。
  - グローバル `User.readOnly` の挙動変更。
  - 匿名（未ログイン）アクセスの公開ポリシー変更。

## Boundary Candidates（責務の境界候補）

- userType のデータモデル（`User` / `IUser`）と移行。
- アクセス評価でのゲスト分岐（Public 非自動公開）。
- ゲスト招待フロー（UI＋API）。
- 管理画面のゲスト管理（一覧・絞り込み・範囲編集）。

## Out of Boundary（このスペックが持たない範囲）

- **権限モデルの粒度（read/edit・非所属グループ）** — `granular-page-permissions` が所有。
- **有効期限** — `time-limited-access` が所有。
- **匿名公開の扱い** — 既存の Public/匿名設定が所有。ゲストはあくまでログインユーザーの一区分。

## Upstream / Downstream（上流 / 下流）

- **Upstream**: `granular-page-permissions`（ロール付き grant・グループ付与）、`page-grant.ts`
  の実効ロール算出、`User` / `IUser`、管理ユーザー API（`apiv3/users`）、`GrantSelector` /
  `SelectGroupModal`。
- **Downstream**: `time-limited-access`（ゲストに期限を併用）、将来のゲスト固有ポリシー
  （招待リンク、利用規約同意 等）。

## Existing Spec Touchpoints（既存スペックとの接点）

- **Extends**: なし（新規 sub-spec）。
- **Adjacent**: `granular-page-permissions`（依存）、`time-limited-access`（兄弟・直交）。
  `access-token-parser` とは別レイヤ。

## Constraints（制約）

- `granular-page-permissions` の完了を前提とする（依存）。
- ゲストのアクセス評価は `page-grant.ts` の算出を再利用し、Public 非公開判定を重ねるのみ
  （ロジックを二重に持たない）。
- ゲスト userType はグローバル `User.readOnly` と混同しない。
- アクセス評価の変更はセキュリティ critical。requirements で不変条件（ゲストは未付与の Public を
  決して閲覧できない）を明記し、integration テストで保証する。
- `kiro-validate-gap` を早期に実行する。
