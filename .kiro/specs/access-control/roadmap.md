# access-control Sub-spec Roadmap

> 本ファイルは umbrella spec `access-control` 内の sub-spec 進行管理。リポジトリ全体の
> roadmap は `.kiro/steering/roadmap.md` を参照すること。

## Overview

GROWI の「誰が何をできるか」を、**単一の認可判定点（PDP: `authorize(user, action, resource?)`）**
に集約し、その上に **名前付きロール × 権限（capability）** モデルを載せる横断的な基盤づくり。

現状、権限は3つの独立した仕組みに分散している:

- `IUser.admin: boolean` — `admin-required.ts` が `req.user.admin` を見るだけの**二値ゲート**。
  全 admin ルートがこれ一択で、「usergroup だけ編集できる非管理者」を表現する余地がない。
- `IUser.readOnly: boolean` — アカウント全体に効くグローバル ROM。別軸。
- ページ grant / `editScope` — *ページというリソース*に宿る read/edit/comment
  （`enhanced-guest` の `granular-page-permissions` が設計中）。

本 umbrella は、これらを **1つの `authorize()` 入口に束ねつつ、リソース種別ごとに適した評価器
を差し替え可能にする**（＝ page は既存の grant 評価器へ委譲し、作り直さない）。第一の実証対象は
**管理画面の操作権限の委譲（delegated admin）**。「柔軟なユーザー権限管理」の将来機能
（アカウント全体ロール、閲覧＋コメントのみ 等）の共通土台となる。

## Approach Decision

- **Chosen**: **単一の認可判定点（PDP）＋ リソース種別ごとの差し替え可能な評価器**。
  - `authorize(user, action, resource?)` を唯一の判定入口にする。
  - `admin:* / account:*` 系は **role × capability** 評価器で判定（ロールはユーザーにも
    グループにも付与可能）。
  - `page:*` 系は **既存のページ grant 評価器（`PageGrantService` / `editScope` /
    ツリー継承）へ委譲**する（ページ権限を作り直さない）。
  - `IUser.admin === true` は移行時に**全 capability を持つ `admin` ロール**へ後方互換
    マッピングし、ロールアウト直後は挙動を変えない。
- **Why**: 統一は *データモデル* ではなく *判定インターフェース* のレベルで行うのが正しい。
  admin 権限は「主体が持つロール」で決まるフラットな RBAC 型、ページ権限は「grant が
  リソースに宿る」関係ベース＋ツリー継承型で、**形が本質的に異なる**。両者を1つのデータ
  モデルに押し込むと、数百万ページに対してロール/ポリシーを持たせる破綻と、既に解決済みの
  ツリー正規化・継承機構の喪失を招く。判定点だけを統一すれば「1つの基盤」の狙いを満たしつつ、
  各領域は自分に合ったモデルを保てる。
- **Rejected alternatives**:
  - *素朴な統一データモデル（ページ権限もロールで表す）*: 上記のとおりページの
    インスタンス単位・ツリー構造の権限に不適で、コスト以前に設計として誤り。
  - *admin ゲートを二値 boolean のまま据え置く*: 委譲された管理者を表現できず、本 umbrella
    の第一目的を満たせない。
  - *本基盤を `enhanced-guest` の中に入れる*: 認可基盤は「外部パートナー受け入れ」より広い
    横断的 foundation。ゲストの下にぶら下げると概念が逆転する。独立 umbrella とし、
    `enhanced-guest` の各 sub-spec が本基盤に**依存する**関係とする。

## Scope

- **In**: 単一 `authorize()` 判定点、Role / Capability データモデルとレジストリ、
  ロールのユーザー／グループへの付与、`admin` ロールへの後方互換マッピング、admin ルートの
  `req.user.admin` 直読みを `authorize()` 経由へ置換、委譲された管理者ロールの作成・付与 UI、
  アカウント全体ロール（例: 閲覧＋コメントのみ）の表現土台。
- **Out**: ページ grant モデルそのものの再設計（`granular-page-permissions` が所有。本基盤は
  `page:*` を委譲で繋ぐのみ）、グローバル `User.readOnly` / `exclude-read-only-user` の挙動変更、
  外部 IdP からのロールマッピング（将来検討）、承認/編集ワークフロー。

## Constraints

- **後方互換（最重要）**: authorization-core のロールアウト直後は観測される権限を一切
  変えない（`User.admin===true` ⇒ `admin` ロール ⇒ 全 capability）。
- **既存スペックのファイルに触れない**: `enhanced-guest` 配下（`granular-page-permissions`
  等）は独立に進行させ、本 umbrella は cross-umbrella の依存関係として繋ぐのみ。
- **ページ grant を二重定義しない**: `page:*` は必ず既存 `PageGrantService` へ委譲する。
- **網羅性＝安全性**: admin ゲートは全 admin ルートに散在する。`granular-page-permissions`
  の「書き込み経路インベントリ」と同型の網羅漏れ＝権限バイパスリスクがあるため、
  ゲート置換は段階的・インベントリ駆動で行う。
- スコープ単位ロール（capability）とグローバル `User.readOnly` を厳密に分離する。
- TDD（リポジトリ方針）。ドキュメント・コメントは各 spec の `spec.json.language`（`ja`）に従う。

## Boundary Strategy

- **Why this split**: 「認可の中核抽象（判定点＋モデル）」「admin 委譲という適用」「アカウント
  全体ロールという適用」は、変更箇所・リスク・レビュー観点が異なる。中核を独立で固めることで、
  委譲・アカウントロールを安全に積み上げられる。
- **Shared seams to watch**:
  - **`page:*` 評価器 ↔ `PageGrantService`** — `granular-page-permissions` が所有する
    実効ロール算出（`resolveEffectiveRole`）を、authorization-core は薄いアダプタ経由で
    呼ぶだけにする。二重定義しないこと。
  - **`IUser` の属性** — capability ロールは `User.admin`/`readOnly` とは別概念。同じ
    `IUser`（`packages/core/src/interfaces/user.ts`）に並ぶが、混ぜないこと。
  - **Capability レジストリ** — action 名前空間（`admin:usergroup:manage` 等）は単一の
    ソースで宣言し、評価器・UI・ドリフトテストが同じ宣言を読む（executor は work-set を
    import しない、の原則）。
  - **admin ルートのゲート適用インベントリ** — 置換漏れ＝権限バイパス。tasks で網羅する。

## Specs (dependency order)

- [ ] authorization-core -- 単一 `authorize(user, action, resource?)` 判定点、Role/Capability データモデルとレジストリ、ロールのユーザー／グループ付与、`admin` ロールへの後方互換マッピング、`page:*` を既存 `PageGrantService` へ委譲するアダプタ。挙動を変えない基盤。Dependencies: none
- [ ] admin-permission-delegation -- admin セクションごとの capability 定義、`admin-required` の `req.user.admin` 直読みを `authorize()` 経由へ段階置換、委譲管理者ロール（例: usergroup だけ編集できる非管理者）の作成・付与 UI。Dependencies: authorization-core
- [ ] account-scope-roles -- アカウント全体に効くロール（例: 閲覧＋コメントのみ）を同じ role × capability 機構で表現。グローバル `User.readOnly` とは分離。Dependencies: authorization-core

## Cross-umbrella Relationships

- **`enhanced-guest` / `granular-page-permissions`**: `granular-page-permissions` が確立する
  ページの実効ロール算出は、本基盤における `page:*` 評価器の実体になる。authorization-core は
  それを委譲で繋ぐ（新規の薄いアダプタとして実装。`granular-page-permissions` のファイルは
  変更しない）。将来 `enhanced-guest` の各 sub-spec は `authorize()` を消費する側になる。
