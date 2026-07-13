# Requirements Document

## Project Description (Input)

GROWI の管理画面は `IUser.admin: boolean` の全か無かのゲート（`adminRequired` が `req.user.admin`
を直読み）でしか守られていない。そのため「管理者ではないが、ユーザーグループの管理**だけ**を
任せたい」「マークダウン設定だけ触らせたい」といった**部分的・委譲的な管理権限**を表現できず、
運用の一部を任せるにはフル管理者権限を渡すしかない（過剰権限＝least-privilege 違反が常態化）。

本スペック `admin-permission-delegation` は access-control umbrella の sub-spec として、
base sub-spec `authorization-core`（単一の `authorize(user, action, resource?)` 判定点と
ロール × 権限（capability）モデル）の上に構築する。達成すべき状態は、(a) 管理セクションごとに
capability が定義され単一カタログ（既存 `SCOPE` 語彙）に宣言されること、(b) `adminRequired` の
`req.user.admin` 直読みが、対象セクションの capability を要求する `authorize()` 呼び出しへ
**網羅的かつ段階的に**置換されること、(c) 管理者が任意の capability の部分集合を持つ**委譲管理者
ロール**を作成し、ユーザーまたはグループへ付与できること、(d) 委譲されたユーザーは許可された
セクションのみ管理画面のナビ/画面にアクセスでき、それ以外は 403/非表示となること（サーバーが
最終権威、クライアントは事前反映）である。

**最重要の制約は網羅性＝安全性**：管理ルートは `apps/app/src/server/routes/apiv3/` を中心に
散在（`adminRequired` を使う apiv3 22 ファイル＋feature 系ルート）しており、1経路でも置換を誤る/
付け忘れると権限バイパスに直結する。経路インベントリを固定し、段階的に1経路ずつ置換＋統合
テストで担保する。既存フル管理者（`user.admin === true` ＝ 全 capability）の挙動は変えない
（後方互換）。詳細は [brief.md](./brief.md) と umbrella ロードマップ
[../access-control/roadmap.md](../access-control/roadmap.md) を参照。

## Boundary Context

- **In scope**:
  - 管理セクションごとの capability 定義（`authorization-core` のカタログ＝既存 `SCOPE` への宣言）。
  - 委譲管理者ロールの作成・編集・削除（管理操作／UI／API）。
  - ロールのユーザー／グループへの付与・解除（管理操作／UI／API）。
  - 全管理操作経路への capability ベースのアクセス制御適用（網羅・段階置換）。
  - 管理ナビ/画面の事前反映（許可セクションのみ表示、サーバーが最終権威）。
  - 導入時に既存管理アクセスを変えない後方互換。
  - ロール管理操作自体の統制と権限昇格の防止。
- **Out of scope**:
  - `authorize()` 判定点・Role/Capability モデル・実効 capability 合成（`authorization-core`）。
  - アカウント全体ロール（例「閲覧＋コメントのみ」）（`account-scope-roles`）。
  - ページの read/edit 判定（`granular-page-permissions`）。
  - グローバル `User.readOnly` / ROM の挙動変更。
  - 新しい管理セクション／管理機能そのものの追加。
- **Adjacent expectations**:
  - `authorization-core` の `authorize()` / `Role` / `RoleAssignment` / capability カタログに依拠する。
  - 既存の管理ルート認証チェーン（トークン検証 → ログイン必須 → 管理ゲート）の構造に接続する。
  - API トークン利用者は、対応するスコープを持つ限り従来どおり管理 API にアクセスできる。
  - ロール／付与の変更は既存の activity/監査ログ基盤で観測可能であることが望ましい。

## Requirements

### Requirement 1: 管理セクションごとの権限（capability）定義
**Objective:** As a 運用者, I want 各管理セクションに対応する権限が定義・列挙されていること, so that セクション単位で管理権限を委譲できる

#### Acceptance Criteria
1. The Admin Permission Delegation shall 各管理セクション（例: ユーザーグループ管理・セキュリティ設定・マークダウン設定・カスタマイズ・通知・データ入出力・全文検索・監査ログ等）に対応する capability を定義する。
2. The Admin Permission Delegation shall 定義済みの管理 capability をカタログから列挙できる。
3. When 新しい管理セクションに対応する capability を追加する, the Admin Permission Delegation shall 既存の判定・付与の仕組みを変更せず、カタログへの宣言のみで追加できる。

### Requirement 2: 委譲管理者ロールの管理（作成・編集・削除）
**Objective:** As a 管理者, I want 管理 capability の部分集合を持つロールを作成・編集・削除できること, so that 任せたい範囲だけのロールを用意できる

#### Acceptance Criteria
1. When 管理者が任意の管理 capability の部分集合を選んでロールを作成する, the Admin Permission Delegation shall そのロールを保存し、以降付与可能にする。
2. When 管理者がロールの capability 構成を編集する, the Admin Permission Delegation shall 変更を保存し、以降の認可判定へ反映する。
3. When 管理者がロールを削除する, the Admin Permission Delegation shall そのロールと関連する付与を除去し、付与されていたユーザー／グループから当該 capability を失わせる。
4. If 作成／編集で指定された capability がカタログに存在しない, then the Admin Permission Delegation shall その操作を拒否する。

### Requirement 3: ロールの付与・解除（ユーザー／グループ）
**Objective:** As a 管理者, I want ロールをユーザーやグループへ付与・解除できること, so that 個人単位・組織単位で管理権限を委ねられる

#### Acceptance Criteria
1. When 管理者がロールをユーザーへ付与または解除する, the Admin Permission Delegation shall その結果を保存し、対象ユーザーの実効権限へ反映する。
2. When 管理者がロールをグループ（内部・外部）へ付与または解除する, the Admin Permission Delegation shall グループ所属ユーザーの実効権限へ反映する。
3. When 付与対象のロールまたは主体が存在しない, the Admin Permission Delegation shall その付与操作を拒否する。

### Requirement 4: capability に基づく管理アクセス制御（網羅・トークン互換）
**Objective:** As GROWI, I want 管理操作へのアクセスが対応 capability で制御されること, so that 権限のないユーザーが管理操作を実行できない

#### Acceptance Criteria
1. When ユーザーが管理セクションの操作を要求し、対応する capability を実効権限に持つ, the Admin Permission Delegation shall その操作を許可する。
2. If ユーザーが要求した管理セクションに対応する capability を持たない, then the Admin Permission Delegation shall その操作を拒否する。
3. The Admin Permission Delegation shall すべての管理操作経路にアクセス制御を適用し、制御が未適用の管理経路を残さない。
4. While リクエストが有効な API トークンにより行われ、そのトークンが対応するスコープを持つ, the Admin Permission Delegation shall 従来どおりその操作を許可する。

### Requirement 5: 管理ナビ／画面の事前反映
**Objective:** As a 委譲されたユーザー, I want 自分が使えるセクションだけが管理画面に見えること, so that 使えない画面で拒否に突き当たらない

#### Acceptance Criteria
1. While ユーザーが管理画面を表示している, the Admin Permission Delegation shall そのユーザーが capability を持つ管理セクションのみをナビ／画面に表示する。
2. If ユーザーが capability を持たない管理セクションへ直接アクセスする, then the Admin Permission Delegation shall サーバー側で拒否する（クライアントの表示制御に依存しない）。

### Requirement 6: 後方互換（導入時に既存管理アクセスを変えない）
**Objective:** As a GROWI 管理者, I want 本機能の導入で既存の管理アクセスが変わらないこと, so that 安全に段階移行できる

#### Acceptance Criteria
1. While ロールが未付与である, when 既存のフル管理者が管理操作を要求する, the Admin Permission Delegation shall 従来どおり許可する。
2. While ロールが未付与である, when 非管理者が管理操作を要求する, the Admin Permission Delegation shall 従来どおり拒否する。
3. The Admin Permission Delegation shall 既存の管理アクセスの保持のためにデータ移行を必要としない。

### Requirement 7: ロール管理の統制と権限昇格の防止
**Objective:** As a セキュリティ責任者, I want ロールの管理操作自体が適切に制限されること, so that 委譲を悪用した権限昇格を防げる

#### Acceptance Criteria
1. The Admin Permission Delegation shall ロールの作成・編集・削除・付与・解除操作を、ロール管理の権限を持つユーザー（導入時はフル管理者）のみに許可する。
2. If ロール管理の権限を持たないユーザーがロール管理操作を要求する, then the Admin Permission Delegation shall その操作を拒否する。
3. The Admin Permission Delegation shall あるユーザーが自身の保持しない capability を他者へ付与することを許可しない。
