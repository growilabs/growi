# Brief: authorization-core（認可基盤の中核）

> umbrella spec: [access-control](../access-control/roadmap.md) の base sub-spec（依存なし）。
> 兄弟: `admin-permission-delegation`（本基盤に依存）、`account-scope-roles`（本基盤に依存）。

## Problem（解決したい課題）

GROWI の「誰が何をできるか」は、互いに独立した仕組みに分散している:

- `IUser.admin: boolean` を `admin-required.ts` が直読みする**二値ゲート**。全 admin ルートが
  これ一択で、「管理者ではないが usergroup の管理だけできる」といった**部分的な管理権限を
  一切表現できない**。
- `IUser.readOnly: boolean`（グローバル ROM）。
- ページ grant / `editScope`（`granular-page-permissions` が設計中。ページというリソースに宿る）。

将来やりたい「柔軟なユーザー権限管理」（委譲された管理者、閲覧＋コメントのみ、等）はいずれも
「主体 × 操作 × 対象」を判定する共通の土台を必要とするが、その土台が存在しない。判定ロジックが
ルートごと・middleware ごとに散在しているため、新しい権限区分を足すたびに散在箇所を触る必要があり、
網羅漏れ＝権限バイパスのリスクが高い。

## Current State（現状）

- **admin 判定**（`apps/app/src/server/middlewares/admin-required.ts`）: `req.user.admin` が
  true かを見るだけ。false は `/` へリダイレクト。粒度なし。
- **ログイン判定**（`login-required.ts`）とグローバル ROM（`exclude-read-only-user.ts`）は
  それぞれ別軸のゲート。
- **ページ権限**（`apps/app/src/server/service/page-grant.ts`）: `isUserGrantedPageAccess()`、
  および `granular-page-permissions` が新設予定の `resolveEffectiveRole()` /
  `isUserGrantedPageEdit()`。ページに宿る grant＋ツリー継承で判定する関係ベースのモデル。
- **ユーザー／グループ**: `UserGroup` / `ExternalUserGroup` と user-group-relation が既にあり、
  グループメンバーシップは確立済み。ロールを載せる下地になる。
- **capability や role の概念は存在しない**。

## Desired Outcome（達成したい状態）

- サーバーに**唯一の認可判定入口** `authorize(user, action, resource?)` があり、admin / account /
  page のいずれの権限判定もここを通る。
- **Role（capability の名前付き束）** と **Capability（名前空間付き action、例
  `admin:usergroup:manage`）** のデータモデルがあり、ロールを**ユーザーにもグループにも**
  付与できる。ユーザーの実効 capability ＝「直接付与ロール ∪ 所属グループ経由ロール」。
- `authorize()` は action の名前空間で評価器を振り分ける:
  - `admin:* / account:*` → role × capability 評価器。
  - `page:*` → 既存の `PageGrantService`（`granular-page-permissions` の実効ロール算出）へ
    **委譲**（本 sub-spec で薄いアダプタを新設。既存ファイルは変更しない）。
- **後方互換**: ロールアウト直後、`IUser.admin === true` のユーザーは全 capability を持つ
  `admin` ロールへマッピングされ、観測される権限は一切変わらない。
- Capability の一覧は**単一のレジストリ**で宣言され、評価器・UI・テストが同じ宣言を読む。

## Approach（採用アプローチ）

1. **中核抽象** — `authorize(user, action, resource?): boolean`（PDP）を新設。純関数の判定を
   サービスに集約し、middleware は薄い adapter とする（coding-style 準拠）。
2. **データモデル** — `Role`（capability 集合）と capability レジストリを定義。ロール付与は
   ユーザー／グループ双方を対象。具体形（埋め込み vs 別コレクション、`IUser.roles` の持ち方）は
   design で確定。Prisma/Mongoose の現行方針に合わせる。
3. **評価器の差し替え** — action 名前空間でディスパッチ。`page:*` は既存 `PageGrantService`
   へ委譲するアダプタを1本用意し、ページ grant を二重定義しない。
4. **後方互換マッピング** — `User.admin===true` ⇒ `admin` ロール（全 capability）。移行データ
   不要の遅延既定として実装できるか design で検討。
5. **本 sub-spec ではゲート置換は行わない** — 実際の admin ルート置換は
   `admin-permission-delegation` が担う。ここは判定点・モデル・レジストリ・委譲先アダプタと、
   「挙動を変えない」ことを保証するテストまで。

進め方: 本 brief で意図を固定 → requirements（EARS）→ 既存の権限/認証コードに対する
`kiro-validate-gap`（統合面が広い）→ design → tasks。

## Scope（スコープ）

- **In**:
  - `authorize(user, action, resource?)` 判定点（PDP）と action 名前空間の設計。
  - Role / Capability データモデルとレジストリ（単一ソース）。
  - ロールのユーザー／グループへの付与と、実効 capability の合成（直接∪グループ経由）。
  - `admin` ロールへの後方互換マッピング（挙動不変）。
  - `page:*` を `PageGrantService` へ委譲する薄いアダプタ（既存ファイル非変更）。
  - 「挙動を変えない」ことの回帰テスト（既存 admin ユーザー・非 admin ユーザーの権限が不変）。
- **Out**:
  - admin ルートの実ゲート置換・委譲管理者 UI（`admin-permission-delegation`）。
  - アカウント全体ロールの具体機能（`account-scope-roles`）。
  - ページ grant モデルの再設計（`granular-page-permissions` が所有）。
  - グローバル `User.readOnly` / `exclude-read-only-user` の挙動変更。
  - 外部 IdP からのロールマッピング。

## Boundary Candidates（責務の境界候補）

- `authorize()` 判定点 ＋ action 名前空間。
- Role / Capability データモデル ＋ 単一レジストリ。
- ロール付与と実効 capability 合成（ユーザー／グループ）。
- `page:*` 委譲アダプタ（`PageGrantService` への橋渡し）。
- `admin` ロール後方互換マッピング。

## Out of Boundary（このスペックが持たない範囲）

- **admin ルートのゲート置換** — `admin-permission-delegation` が所有。網羅性が要るため独立。
- **ページ権限の実効ロール算出そのもの** — `granular-page-permissions` が所有。ここは委譲のみ。
- **アカウント全体の読み取り専用** — 既存 `User.readOnly` の仕組みが所有。capability ロールと
  混同しない。
- **capability レジストリの中身（どんな admin セクションがあるか）の網羅** — 消費側 sub-spec が
  必要に応じて追加する。ここは仕組みと最小の初期集合まで。

## Upstream / Downstream（上流 / 下流）

- **Upstream**: `IUser`（`packages/core/src/interfaces/user.ts`）、`UserGroup` /
  `ExternalUserGroup` と user-group-relation、`admin-required.ts` / `login-required.ts`、
  `PageGrantService`（`page-grant.ts`）、config-manager。
- **Downstream**: 兄弟 sub-spec `admin-permission-delegation`（ゲート置換・委譲 UI）、
  `account-scope-roles`（アカウント全体ロール）、将来の外部 IdP ロールマッピング、
  `enhanced-guest` の各 sub-spec（`authorize()` を消費する側になる）。

## Existing Spec Touchpoints（既存スペックとの接点）

- **Extends**: なし（新規スペック）。
- **Adjacent**: `granular-page-permissions`（`enhanced-guest`）— `page:*` の実効ロール算出を
  所有。本基盤は委譲で繋ぐのみで、そのファイルは変更しない。`access-token-parser`（認証だが
  トークン単位で別軸）。

## Constraints（制約）

- **後方互換（最重要）**: ロールアウト直後に観測される権限を一切変えない
  （`User.admin===true` ⇒ 全 capability）。回帰テストで担保する。
- ページ grant を二重定義しない（`page:*` は必ず `PageGrantService` へ委譲）。
- capability ロールとグローバル `User.readOnly` を厳密に分離する。
- capability は単一レジストリで宣言し、評価器・UI・テストが同じ宣言を読む（executor は
  work-set を import しない、の原則）。
- `kiro-validate-gap` を早期に実行する — 認証/認可コードへの統合面が広い。
- TDD。ドキュメント・コメントは `spec.json.language`（`ja`）に従う。
