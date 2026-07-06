# Brief: account-scope-roles（アカウント全体ロール）

> umbrella spec: [access-control](../access-control/roadmap.md) の sub-spec。
> Dependencies: `authorization-core`（本 sub-spec は `authorize()` 判定点と Role/Capability
> モデルの上に乗る）。兄弟: `admin-permission-delegation`。

## Problem（解決したい課題）

「アカウント単位で、そのユーザーができる操作の性質」を表す軸が、現状 `IUser.readOnly` の
**二値（全編集可 / 全編集不可）**しかない。「閲覧＋コメントだけできる」「特定操作だけ許す」と
いった、**読み取り専用とフル編集の中間にあるアカウント全体の権限区分**を表現できない。

`granular-page-permissions` はページというリソースに宿る read/edit/comment を扱うが、それは
「このページで誰が何をできるか」であって、「このユーザーはアカウントとしてどういう性質か」
（ページ横断で効く区分）とは軸が異なる。後者を柔軟に定義できる土台が欲しい。

## Current State（現状）

- **グローバル ROM**（`IUser.readOnly` ＋ `exclude-read-only-user.ts`）: アカウント全体に効く
  唯一のアカウント軸。ただし二値で、コメント可否は既存 config
  （`isRomUserAllowedToComment` 相当）で一律制御されるのみ。中間区分は作れない。
- `granular-page-permissions`（`enhanced-guest`）が、ページ単位の実効ロール
  （edit / readOnly / none）と「read-only スコープユーザーのコメント可否 config」を設計中。
  これは*ページ*の軸。
- `authorization-core` が `authorize(user, action, resource?)` と Role/Capability モデル・
  グループ付与・後方互換マッピングを提供する前提。

## Desired Outcome（達成したい状態）

- 「閲覧＋コメントのみ」等の**アカウント全体ロール**を、`authorization-core` の
  role × capability 機構で表現できる（新しい並行モデルを作らない）。
- 該当ロールのユーザーは、ページ横断で書き込み系操作が抑止され、コメント等の許可された操作
  のみ可能（サーバーが最終権威）。
- グローバル `User.readOnly`（既存）とは**別概念として分離**しつつ、両者の関係
  （どちらが優先か、併用時の意味）を明確に定義する。
- ロールはユーザーにもグループにも付与可能（`authorization-core` の機能を利用）。

## Approach（採用アプローチ）

1. **capability の定義** — アカウント軸の操作を capability（例 `account:comment`、
   `account:write` … 具体は design で確定）として `authorization-core` レジストリに宣言。
2. **アカウントロールの表現** — 「閲覧＋コメントのみ」を capability の部分集合を持つロールとして
   定義。`authorize()` 経由でページ書き込み経路・コメント経路が判定される
   （`granular-page-permissions` の `page:*` 委譲、コメントゲートと整合させる）。
3. **`User.readOnly` との関係整理** — 二値 ROM とアカウントロールの優先順位・併用意味を
   明文化。どちらも「アカウント軸」だが、readOnly は既存資産として温存し、ロールは
   より柔軟な上位表現とする（design で確定）。
4. **UI** — アカウントロールの付与（管理画面のユーザー/グループ管理から）。純関数判定は
   `authorize()` に委譲。

進め方: brief → requirements（EARS）→ `kiro-validate-gap`（`page-grant`・ROM・コメント経路との
整合面）→ design → tasks。

## Scope（スコープ）

- **In**:
  - アカウント軸 capability の定義とレジストリ宣言。
  - 「閲覧＋コメントのみ」を含むアカウントロールの表現と、`authorize()` を通じた強制
    （ページ書き込み・コメント経路との整合）。
  - `User.readOnly` とアカウントロールの関係（優先順位・併用意味）の定義。
  - アカウントロールの付与 UI（ユーザー／グループ）。
- **Out**:
  - `authorize()`・Role/Capability データモデルそのもの（`authorization-core`）。
  - admin セクションの委譲（`admin-permission-delegation`）。
  - ページ単位の read/edit/comment 判定ロジック（`granular-page-permissions` が所有。ここは
    アカウント軸を重ねるだけ）。
  - グローバル `User.readOnly` の**廃止**（温存。関係整理のみ）。

## Boundary Candidates（責務の境界候補）

- アカウント軸 capability の定義集合。
- アカウントロールの強制（ページ横断の書き込み/コメント判定との整合）。
- `User.readOnly` との関係・優先順位ルール。
- アカウントロール付与 UI。

## Out of Boundary（このスペックが持たない範囲）

- **`authorize()` の仕組み・ロールモデル** — `authorization-core` が所有。
- **ページに宿る read/edit/comment の算出** — `granular-page-permissions`。ここは委譲・整合のみ。
- **admin セクション権限** — `admin-permission-delegation`。
- **グローバル ROM の実装変更** — 既存を温存し、関係を定義するに留める。

## Upstream / Downstream（上流 / 下流）

- **Upstream**: `authorization-core`（`authorize()`・Role/Capability・グループ付与）、
  既存 `User.readOnly` / `exclude-read-only-user.ts`、`granular-page-permissions` の
  ページ書き込み/コメント経路（`page:*` 委譲・コメントゲート）。
- **Downstream**: 将来のより細かいアカウント区分、外部 IdP からのロールマッピング、
  `enhanced-guest`（ゲストにアカウントロールを組み合わせる可能性）。

## Existing Spec Touchpoints（既存スペックとの接点）

- **Extends**: なし（新規スペック）。`authorization-core` に依存。
- **Adjacent**: `granular-page-permissions`（ページ軸。アカウント軸と重ねる際の整合を
  design で確認。二重にコメント可否を制御しないよう調整）、`time-limited-access`
  （`enhanced-guest`。アカウント軸だが「有効期限」で直交）。

## Constraints（制約）

- capability ロールとグローバル `User.readOnly` を**厳密に分離**しつつ、併用時の意味を明文化。
- コメント可否の制御を `granular-page-permissions` と二重に持たない（整合させる）。
- capability は `authorization-core` の単一レジストリで宣言（二重定義しない）。
- 後方互換: 既存ユーザーのアカウント軸挙動を、ロール未付与時は変えない。
- `kiro-validate-gap` を早期に実行する。
- TDD。ドキュメント・コメントは `spec.json.language`（`ja`）に従う。
