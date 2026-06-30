# Brief: granular-page-permissions（ページ権限の粒度向上）

> umbrella spec: [enhanced-guest](../enhanced-guest/roadmap.md) の sub-spec（基盤・依存なし）。
> 兄弟: `guest-users`（このロール／グループ付与に依存）、`time-limited-access`（直交軸）。

## Problem（解決したい課題）

GROWI のページ権限モデルは「閲覧できる範囲」と「編集できる範囲」が一体化しており、
**ページを閲覧できるログインユーザーは、そのページを編集もできる**。ページのスコープを
決められるのは grant の種類（`Public` / `リンクを知っている人` / `自分のみ` /
`グループ内に限定`）だけで、いずれも「この相手には閲覧だけ許し、編集はさせない」を
表現できない。

ユーザーから独立して挙がっている具体的な痛みは2つ:

1. **スコープ単位での閲覧/編集の分離ができない。** 広く公開しつつ編集者は限定したい
   （例: 人事がお知らせを全員に公開するが、編集できるのは人事のみ）。
   - [#8815「Enrich pages permissions」](https://github.com/growilabs/growi/discussions/8815)
   - [#8250「ページ毎に編集権限範囲が設定できるようにする」](https://github.com/growilabs/growi/discussions/8250)
2. **自分が所属していないグループに権限を付与できない。** 付与UIは自分の所属グループしか
   一覧に出さないため、他部門との情報共有（非メンバーのグループへの付与）ができない。
   - [#9091「閲覧権限設定に、自分を含んでいないグループを含めて複数設定したい」](https://github.com/growilabs/growi/discussions/9091)

これは広義の「Enhanced Guest」
（[#11139](https://github.com/growilabs/growi/discussions/11139)）の実質的な中核である。
「柔軟なゲスト/パートナー管理」という要望の本当のニーズは、**新しいユーザー区分ではなく、
ロールを区別できる粒度の細かいページ権限**にある。

## Current State（現状）

- **grant モデル**（`apps/app/src/server/models/page.ts`）: `GRANT_PUBLIC=1`,
  `GRANT_RESTRICTED=2`, `GRANT_OWNER=4`, `GRANT_USER_GROUP=5`。ページは
  `grantedGroups[]` / `grantedUsers[]` を持つ。グループメンバーは**フルアクセス（閲覧＋編集）**
  になり、**スコープ単位の閲覧/編集の区別は存在しない**。
- **grant 選択 UI**（`apps/app/src/client/components/PageEditor/EditorNavbarBottom/`）:
  `GrantSelector.tsx`（ドロップダウン）＋ `SelectGroupModal.tsx`。モーダルは
  `userRelatedGroups`（＝**自分が所属するグループ**）しか一覧しないため、非メンバーの
  グループは付与できない。grant データは `useSWRxCurrentGrantData()` 経由で
  `/api/v3/page/grant-data/{pageId}` から取得。
- **ツリーの整合性・継承は既に実装済み**
  （`apps/app/src/server/service/page-grant.ts`）: `isGrantNormalized` / `validateGrant` /
  `canOverwriteDescendants` / `generateUpdateGrantInfoToOverwriteDescendants` が、ページの
  grant を祖先・子孫と整合する形に保ち、`overwriteScopesOfDescendants` ＋
  `GrantedGroupsInheritanceSelectModal` が配下ツリーへの適用・継承を行う。これにより古い要望
  [#7712](https://github.com/growilabs/growi/discussions/7712)（ページ毎設定の手間・設定漏れ
  による漏洩）は v5 のツリー移行以降ほぼ解消済み。**ただしこの継承・正規化の仕組みはすべて
  「アクセス権（閲覧＋編集）」を運んでおり、閲覧/編集のロールは運んでいない。**
- **グローバルな読み取り専用ユーザー**
  （`apps/app/src/server/middlewares/exclude-read-only-user.ts`, `User.readOnly`）は、
  アカウント全体に効く別概念であり、ページ単位のスコープロールとは直交する。

## Desired Outcome（達成したい状態）

- ページをユーザーグループ（および適用可能な他スコープ）に付与する際、そのスコープに対する
  **ロール（`閲覧のみ` / `閲覧＋編集`）を選べる**。
- あるページに対する実効ロールが `閲覧のみ` のユーザーは、閲覧はできるが、ページ本文の更新・
  リネーム・削除はできない（サーバーで強制し、UI にも反映する）。
- 管理者（およびポリシーで定めた範囲で一般ユーザー）が、**自分が所属していないグループ**にも
  ページを付与でき、他部門・外部向けの共有が可能になる。
- 既存の配下ツリー継承・grant 正規化は引き続き動作し、閲覧/編集ロールを子孫まで運ぶ。

## Approach（採用アプローチ）

並行する権限システムや新ユーザー区分を導入せず、**既存 grant モデルを拡張**する:

1. **データモデル** — 付与グループ（および意味のある範囲で付与ユーザー）に**スコープ単位の
   ロール**を追加。具体形は design で確定（例: `grantedGroups: [{ item, role: 'read' | 'edit' }]`）。
   現行の「メンバー＝閲覧＋編集」からの移行を保ち、既存 grant は `edit` にマップする。
2. **強制（enforcement）** — `page-grant.ts` でユーザーの**実効ロール**を算出し、実効ロールが
   閲覧のみのとき書き込み操作（ページ更新・リネーム・削除、添付など）を遮断する。可能な限り
   既存の書き込みルート用ミドルウェアの接合点を再利用する。グローバルな `User.readOnly`
   フラグとは**混同しない**。
3. **継承・正規化** — `isGrantNormalized` / `validateGrant` / `canOverwriteDescendants` に
   閲覧/編集の次元を通し、配下ツリーが祖先より広い権限にならないこと、子孫上書きがロールを
   保つことを担保する。
4. **UI** — `SelectGroupModal` を拡張し、選択した各グループに閲覧/編集トグルを付ける。さらに
   非メンバーのグループも選択可能にする（グループ存在の開示ポリシーは design で決定。後述の
   Out of Boundary 参照）。grant インジケータにロールを表示する。

進め方: 本 brief で意図を固定 → requirements（EARS）→ 既存の grant/権限コードに対する
`kiro-validate-gap`（統合面が広い）→ design → tasks。

## Scope（スコープ）

- **In**:
  - グループ付与（および適用可能な範囲で付与ユーザー）への閲覧/編集ロール。
  - サーバー側の実効ロール算出と書き込み操作の遮断。
  - 既存のツリー正規化・継承・子孫上書きにロールを通すこと。
  - grant UI: グループごとの閲覧/編集トグル、非メンバーグループの付与、ページツリーの三点
    リーダー（⋮ / `PageItemControl`）からの配下ツリーへの権限付与（既存の配下上書き機構を
    入口として露出）。
  - 既存 grant のロール付き形式への移行（既存 ⇒ `edit`）。
  - テスト（`page-grant.ts` のロール判定のユニット、書き込み遮断の integration）。
- **Out**:
  - 期限付き／有効期限つきアクセス（Enhanced Guest のもう半分）— 直交する軸であり別スペック。
  - ゲスト専用 `userType` — 意図的に保留。ロールで表現できないゲスト固有の振る舞いが現れた
    場合のみ再検討。
  - 管理者向けの「誰が何にアクセスできるか」俯瞰/マトリクス画面 — 後続の読み取り中心ビュー。
  - グローバル `User.readOnly` フラグや `exclude-read-only-user` ミドルウェアの変更
    （スコープロールと明確に区別する以上のことはしない）。
  - 承認/編集ワークフロー（[#9453](https://github.com/growilabs/growi/discussions/9453)）。

## Boundary Candidates（責務の境界候補）

- grant データモデル＋移行（ロールを持つ `grantedGroups`/`grantedUsers`）。
- 実効ロール算出＆書き込み操作の強制（`page-grant.ts` ＋ ミドルウェア）。
- ロールを運ぶツリー正規化・継承。
- grant 選択 UI（閲覧/編集トグル＋非メンバーグループ選択）。

## Out of Boundary（このスペックが持たない範囲）

- **期限付きアクセス／有効期限** — 兄弟スペック（Enhanced Guest）に属する。本スペックはロールを
  期限に結びつけてはならない。
- **グループ存在の開示ポリシー** — #9091 が指摘するとおり、グループの存在自体を見せたくない
  チームもある。非メンバーグループを自由に選べるのか／管理者限定か／オプトインかは、暗黙の
  デフォルトではなく requirements/design で決める**ポリシー判断**。
- **アカウント全体の読み取り専用** — 既存 `User.readOnly` の仕組みが所有する。

## Upstream / Downstream（上流 / 下流）

- **Upstream**: ページ grant モデルと `IPage` の grant フィールド（`@growi/core` /
  `models/page.ts`）、`page-grant.ts`、`GrantSelector` / `SelectGroupModal`、
  user-group / user-group-relation モデル、`useSWRxCurrentGrantData`。
- **Downstream**: 兄弟 sub-spec `guest-users`（Public 非公開ゲスト・招待・管理。このロール／
  グループ付与の上に乗る）、`time-limited-access`（期限付きアクセス。直交軸）、管理者向け権限
  俯瞰 UI、将来のスコープ単位ポリシー（例: コメントのみ許可）。

## Existing Spec Touchpoints（既存スペックとの接点）

- **Extends**: なし（新規スペック）。
- **Adjacent**: `access-token-parser`（認証だがトークン単位であり、ページ grant とは別）。
  editor/keymap/collaborative-editor 系スペックとは重複しない。ページ grant を統べる既存
  スペックは存在しない。

## Constraints（制約）

- 後方互換: 既存 grant は観測されるアクセスを変えずにロール付き形式へ移行すること
  （既存のグループ付与 ⇒ `edit`）。
- 既存のツリー正規化・継承の挙動を退行・重複させないこと。
- スコープ単位のロールはグローバルな `User.readOnly` 概念と厳密に分離すること。
- リポジトリ方針に従い TDD。閲覧のみスコープでの書き込み遮断には integration テストを付ける。
- `kiro-validate-gap` を早期に実行する — 本機能は `page-grant.ts` と grant UI に対する既存
  コード統合面が広い。
