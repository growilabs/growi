# Requirements Document

## Introduction

GROWI の「誰が何をできるか」の判定は、現在3つの独立した仕組みに分散している。管理画面は
`user.admin` の全か無かのゲート（`adminRequired`）でしか守られておらず、ページ権限は
`PageGrantService.isUserGrantedPageAccess()` の真偽判定、書き込み抑止は `readOnly` を見る
グローバル ROM ゲートが担う。この分散のため、部分的・委譲的な権限（例「管理者ではないが
特定設定だけ扱える」）を表現できず、新しい権限区分を足すたびに散在する判定箇所を触る必要があり、
網羅漏れが権限バイパスに直結する。

本スペック `authorization-core` は access-control umbrella の base sub-spec として、
分散した権限判定を**単一の認可判定**に集約し、その上に**名前付きロール × 権限（capability）**
モデルを載せる基盤を用意する。ロールはユーザーにもグループにも付与でき、ユーザーの実効権限は
「直接付与ロール ∪ 所属グループ経由ロール」で合成する。認可判定は action の種別で評価を振り分け、
管理・アカウント系の action はロール評価で、ページ系の action は既存のページアクセス判定へ委譲する。
最重要の制約として、**本基盤の導入時点では観測される権限を一切変えない**（後方互換）。

本スペックは判定の仕組み・モデル・権限カタログ・委譲・「挙動を変えない」保証までを範囲とし、
実際の管理ルートのゲート置換や委譲管理者ロールの UI（`admin-permission-delegation`）、
アカウント全体ロールの強制（`account-scope-roles`）、ページの read/edit 判定ロジックそのもの
（`granular-page-permissions` / `PageGrantService`）は範囲外とする。詳細は
[brief.md](./brief.md) と umbrella ロードマップ
[../access-control/roadmap.md](../access-control/roadmap.md) を参照。

## Boundary Context

- **In scope**:
  - 単一の認可判定（ユーザー・action・任意の対象リソースを受け、許可/不許可を返す）。
  - 権限（capability）とロールのモデル、および列挙可能な権限カタログ。
  - ロールのユーザー／グループへの付与と、実効権限の合成（直接付与 ∪ グループ経由）。
  - 既存フル管理者（`user.admin === true`）を全権限として扱う後方互換マッピング。
  - ページ系 action の、既存ページアクセス判定への委譲。
  - 導入時に観測される権限を変えない（データ移行不要）保証。
- **Out of scope**:
  - 管理ルートの実ゲート置換・委譲管理者ロールの作成/付与 UI（`admin-permission-delegation`）。
  - アカウント全体ロール（例「閲覧＋コメントのみ」）の定義・強制・UI（`account-scope-roles`）。
  - ページの read/edit 判定ロジックそのもの（`granular-page-permissions` / `PageGrantService`）。
  - グローバル ROM（`readOnly` / `excludeReadOnlyUser`）の挙動変更。
  - 外部 IdP からのロールマッピング。
- **Adjacent expectations**:
  - ページ系 action の判定は、既存の `PageGrantService` のページアクセス判定に一致すること
    （本基盤は独自のページ権限判定を持たない）。
  - ユーザーの所属グループ解決は、既存のグループ関係解決
    （`UserGroupRelation` / `ExternalUserGroupRelation` 由来の内部・外部グループ）に依拠する。
  - 既存の `adminRequired` / `loginRequired` / `excludeReadOnlyUser` は本スペックでは変更されず、
    併存する。実際にそれらを本基盤の判定へ差し替えるのは下流スペックの責務。

## Requirements

### Requirement 1: 単一の認可判定
**Objective:** As a GROWI 開発者・保守者, I want 「このユーザーはこの action を（任意で対象リソースに対して）実行できるか」を判定する単一の入口, so that 権限判定が一貫し、散在による網羅漏れを防げる

#### Acceptance Criteria
1. When 呼び出し元がユーザー・action・任意の対象リソースを与えて認可判定を要求する, the Authorization Core shall 許可または不許可の決定を返す。
2. When 同一のユーザー・action・対象リソースで繰り返し判定する, the Authorization Core shall 副作用なく同一の決定を返す（決定は決定論的である）。
3. If 判定対象の action が権限カタログに存在しない, then the Authorization Core shall 不許可を返し、未知の action として記録する。
4. The Authorization Core shall 判定の際に対象の永続データを変更しない（読み取りのみで判定する）。

### Requirement 2: 権限（capability）とロールのモデル
**Objective:** As a 運用者, I want 権限を名前付きロールとして束ねて表現できること, so that 部分的な権限の集合を意味のある単位で扱える

#### Acceptance Criteria
1. The Authorization Core shall 権限（capability）を名前空間付きの action 識別子（例 `admin:usergroup:manage`）として表現する。
2. The Authorization Core shall ロールを 0 個以上の capability からなる名前付き集合として表現する。
3. When 運用者が capability 集合を持つロールを定義する, the Authorization Core shall そのロールを以降の判定に反映する。
4. The Authorization Core shall 定義済み capability を列挙できる権限カタログを提供する。

### Requirement 3: ロールの付与と実効権限の合成
**Objective:** As a 運用者, I want ロールを個々のユーザーにもグループにも付与できること, so that 個人単位・組織単位のどちらでも柔軟に権限を委ねられる

#### Acceptance Criteria
1. The Authorization Core shall ロールを個々のユーザーへ付与できる。
2. The Authorization Core shall ロールをユーザーグループ（内部グループおよび外部グループ）へ付与できる。
3. When あるユーザーの実効権限を算出する, the Authorization Core shall 直接付与されたロールの capability と、ロールが付与された所属グループ経由の capability の和集合を実効権限とする。
4. When ユーザーが複数のグループから重複する capability を得る, the Authorization Core shall その capability を付与済みとして冪等に扱う。
5. When 管理・アカウント系 action を判定する, the Authorization Core shall 当該 action に対応する capability が実効権限に含まれる場合に限り許可する。
6. If 判定対象ユーザーが未認証（ユーザーなし）で、かつ action が管理・アカウント系である, then the Authorization Core shall 不許可を返す。

### Requirement 4: 後方互換（導入時に挙動を変えない）
**Objective:** As a GROWI 管理者・運用者, I want この基盤の導入で既存の権限が一切変わらないこと, so that 段階的に権限モデルを移行でき、ロールバックも安全に行える

#### Acceptance Criteria
1. While ユーザーが `admin === true` である, the Authorization Core shall そのユーザーを全 capability を持つ者（`admin` ロール相当）として扱う。
2. While システムに明示的なロールが未設定である, when 管理・アカウント系 action を判定する, the Authorization Core shall 既存の `user.admin` ゲートと同一の許可/不許可決定を返す。
3. When ロール未設定の既存ユーザーに対して任意の action を判定する, the Authorization Core shall 導入前と同一の観測されるアクセス可否を保つ。
4. The Authorization Core shall 既存権限の保持のためにデータ移行を必要としない。

### Requirement 5: ページ系 action の委譲
**Objective:** As a GROWI 保守者, I want ページ系の権限判定を既存のページアクセス判定に委譲すること, so that ページ権限とツリー継承を作り直さず再利用でき、二重定義を避けられる

#### Acceptance Criteria
1. When 判定対象の action がページ系（`page:*`）である, the Authorization Core shall 既存のページアクセス判定へ委譲し、その結果と一致する決定を返す。
2. The Authorization Core shall 独自のページ権限判定ロジックを保持しない（ページ判定は委譲のみ）。
3. Where 既存のページアクセス判定が編集可否（edit）レベルの判定を提供する, the Authorization Core shall `page:edit` 系 action をその判定へ委譲する。

### Requirement 6: グローバル ROM（readOnly）との分離
**Objective:** As a GROWI 運用者, I want capability ロールとグローバル読み取り専用（readOnly）が別概念として扱われること, so that 二つの軸が混ざって権限が不明瞭になることを防げる

#### Acceptance Criteria
1. The Authorization Core shall capability による判定を `readOnly` の値を根拠にせず行う（capability ロールとグローバル ROM を独立に扱う）。
2. While ユーザーが `readOnly` である, the Authorization Core shall 既存のグローバル ROM ゲートの適用を妨げない（本基盤は ROM を置換・変更しない）。

### Requirement 7: 消費者向けの判定提供
**Objective:** As a 下流スペック（`admin-permission-delegation` / `account-scope-roles`）, I want 管理・アカウント系 action の判定を本基盤から利用できること, so that ゲート置換やアカウントロールを共通の判定の上に構築できる

#### Acceptance Criteria
1. The Authorization Core shall 管理・アカウント系 action について、ユーザーの実効権限に基づく許可/不許可判定を消費者へ提供する。
2. When 消費者が特定の capability を要求する判定を求める, the Authorization Core shall そのユーザーの実効権限に当該 capability が含まれるかに基づいて決定を返す。
3. The Authorization Core shall 新しい capability の追加を、既存の判定・消費者の呼び出し方法を変更せずに行えるようにする（カタログへの宣言で完結する）。
