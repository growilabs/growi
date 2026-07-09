# Brief: admin-permission-delegation（管理権限の委譲）

> umbrella spec: [access-control](../access-control/roadmap.md) の sub-spec。
> Dependencies: `authorization-core`（本 sub-spec は `authorize()` 判定点と Role/Capability
> モデルの上に乗る）。兄弟: `account-scope-roles`。

## Problem（解決したい課題）

GROWI の管理画面は `IUser.admin: boolean` の**全か無か**でしか守られていない。
`admin-required.ts` が `req.user.admin` を見るだけなので、「管理者ではないが、ユーザーグループの
管理**だけ**を任せたい」「マークダウン設定だけ触らせたい」といった**部分的・委譲的な管理権限**を
一切表現できない。結果として、運用の一部を任せるためにフル管理者権限を渡すしかなく、過剰権限
（least-privilege 違反）が常態化する。

これは access-control umbrella の**第一の実証対象**であり、「柔軟なユーザー権限管理」の中でも
最も具体的に要望されている形（例: usergroup だけ編集できる非管理者）である。

## Current State（現状）

- **admin ゲート**（`apps/app/src/server/middlewares/admin-required.ts`）: `req.user.admin`
  が true なら通し、false は `/` へリダイレクト。粒度なし。全 admin ルートがこれ一択。
- **admin ルート**（`apps/app/src/server/routes/apiv3/`）: セクションごとにファイル/ディレクトリが
  分かれている（`user-group.js` / `user-group-relation.js`、`security-settings/`、
  `app-settings/`、`markdown-setting.js`、`customize-setting.js`、`notification-setting.js`、
  `import.ts` / `export.js`、`slack-integration*.js`、`in-app-notification.ts`、`admin-home.ts` 等）。
  → **セクション境界は既に物理的に存在する**。capability の名前空間に対応づけやすい。
- **admin UI**（`apps/app/src/client/components/Admin/`）: `UserGroup` / `Security` / `App` /
  `MarkdownSetting` / `Customize` / `Notification` / `ImportData` / `ExportArchiveData` /
  `SlackIntegration` / `Users`(UserManagement) / `AuditLog` 等、セクション単位で構成済み。
  ナビゲーションは admin 全体を一括表示（現状は admin フラグ前提）。
- `authorization-core` が `authorize(user, action, resource?)` と Role/Capability モデル・
  レジストリ・`admin` ロール後方互換を提供する前提。

## Desired Outcome（達成したい状態）

- admin セクションごとに **capability**（例 `admin:usergroup:manage`、`admin:markdown:manage`、
  `admin:security:manage` …）が定義され、単一レジストリに宣言される。
- `admin-required.ts` の `req.user.admin` 直読みが、**対象セクションの capability を要求する
  `authorize()` 呼び出しへ段階的に置換**される。全 admin 書き込み/設定ルートを網羅する。
- 管理者が、任意の capability の部分集合を持つ**委譲管理者ロール**を作成し、ユーザーまたは
  グループに付与できる（例: 「UserGroup 管理者」ロール = `admin:usergroup:manage` のみ）。
- 委譲されたユーザーは、許可されたセクションのみ admin ナビゲーション/画面にアクセスでき、
  それ以外は 403/非表示になる（サーバーが最終権威、UI は事前反映）。
- **後方互換**: 既存のフル管理者（`admin` ロール）は全 capability を持ち、挙動は変わらない。

## Approach（採用アプローチ）

1. **capability レジストリの充実** — admin セクションを列挙し、各セクションの capability を
   `authorization-core` のレジストリに宣言（単一ソース）。粒度は当面「セクション単位の manage」
   から始め、必要に応じて read/write 分離を検討（design で確定）。
2. **ゲート置換（網羅が最重要）** — `adminRequired` を `authorize(user, 'admin:<section>:...')`
   ベースの guard へ置換、または adminRequired にセクション capability 引数を足す。**全 admin
   ルートのインベントリを固定し、1経路ずつ置換＋テスト**（`granular-page-permissions` の書き込み
   経路インベントリと同型のリスク管理）。
3. **委譲ロール管理 UI** — admin 内に「ロール」管理画面を追加。capability の部分集合を選んで
   ロールを作成し、ユーザー／グループへ付与（グループ付与は `authorization-core` が対応済み）。
4. **ナビゲーション/画面の事前反映** — 現在のユーザーの capability を取得し、許可セクションのみ
   admin メニューに表示。サーバー guard が最終権威。
5. 純関数判定は `authorize()` に委譲し、middleware は薄い adapter（coding-style 準拠）。

進め方: brief → requirements（EARS）→ `kiro-validate-gap`（admin ルート統合面が広い）→
design → tasks。

## Scope（スコープ）

- **In**:
  - admin セクション capability の定義とレジストリ宣言。
  - `admin-required` の全 admin ルートにわたるゲート置換（インベントリ駆動・網羅）。
  - 委譲管理者ロールの作成・編集・付与（ユーザー／グループ）UI ＋ API。
  - 現在ユーザーの capability を返す API と、admin ナビ/画面の事前反映（許可セクションのみ）。
  - 網羅テスト（各 admin 経路で、capability を持たないユーザーが 403、持つユーザーが成功）。
- **Out**:
  - `authorize()` 判定点・Role/Capability データモデルそのもの（`authorization-core` が所有）。
  - アカウント全体ロール（閲覧＋コメントのみ 等）（`account-scope-roles`）。
  - ページ権限（`granular-page-permissions`）。
  - グローバル `User.readOnly` の挙動変更。
  - 外部 IdP からのロールマッピング。

## Boundary Candidates（責務の境界候補）

- admin セクション capability の定義集合（レジストリへの宣言）。
- admin ルートのゲート置換（サーバー強制）。
- 委譲ロール管理 UI ＋ API。
- capability に基づく admin ナビ/画面の事前反映（クライアント）。

## Out of Boundary（このスペックが持たない範囲）

- **`authorize()` の仕組み・ロールモデル** — `authorization-core` が所有。
- **アカウント全体の閲覧/コメント制御** — `account-scope-roles`（ページ横断のアカウント軸）。
- **ページ単位の read/edit/comment** — `granular-page-permissions`。
- **capability 粒度の際限ない細分化** — 初期はセクション単位。細分化は要望駆動で後続。

## Upstream / Downstream（上流 / 下流）

- **Upstream**: `authorization-core`（`authorize()`・Role/Capability・グループ付与）、
  `apps/app/src/server/middlewares/admin-required.ts`、`apps/app/src/server/routes/apiv3/`
  の各 admin ルート、`apps/app/src/client/components/Admin/` のセクション UI。
- **Downstream**: 将来の細粒度 capability（read/write 分離）、監査ログでのロール別追跡、
  外部 IdP ロールマッピング。

## Existing Spec Touchpoints（既存スペックとの接点）

- **Extends**: なし（新規スペック）。`authorization-core` に依存。
- **Adjacent**: `access-token-parser`（トークン認証。admin API のトークン利用時の権限判定と
  接点があり得る — design で確認）。

## Constraints（制約）

- **網羅性＝安全性（最重要）**: admin ルートは散在する。1経路でもゲート置換漏れ＝権限バイパス。
  tasks で経路インベントリを固定し、各経路に統合テストを付ける。
- **後方互換**: 既存フル管理者（`admin` ロール = 全 capability）の挙動を変えない。
- capability は `authorization-core` の単一レジストリで宣言（二重定義しない）。
- capability ロールとグローバル `User.readOnly` を混同しない。
- `kiro-validate-gap` を早期に実行する。
- TDD。ドキュメント・コメントは `spec.json.language`（`ja`）に従う。
