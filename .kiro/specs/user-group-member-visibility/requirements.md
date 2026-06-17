# Requirements Document

## Project Description (Input)
ユーザーグループのメンバーが、自分の所属するグループの他のメンバーを確認できるようにしたい

## Introduction
GROWI のユーザーグループに所属するメンバーが、自分が直接所属するグループの他メンバーを確認できるようにする。現状ではグループのメンバー一覧は管理者向け機能でのみ閲覧でき、一般メンバーは同じグループに誰が所属しているかを把握できない。本機能により、一般ログインユーザーが自分の所属グループの構成メンバーを参照できるようにする。

GROWI には手動管理の UserGroup と、外部 IdP(LDAP/SAML 等)で同期される ExternalUserGroup の 2 系統が存在し、いずれもグループは親子階層を持ちうる。本機能は両系統を対象とし、ユーザーが直接所属するグループのみを参照対象とする。

## Boundary Context
- **In scope**:
  - ページの公開範囲を「グループ限定」に設定する際のグループ選択 UI(GrantSelector)上で、選択肢として並ぶ各グループのメンバーを確認できること
  - 対象は一般ログインユーザーが直接所属する UserGroup および ExternalUserGroup
  - 各メンバーの氏名(name)とユーザー名(username)の表示
  - 追加の有効化設定なしに常時利用できること
- **Out of scope**:
  - GrantSelector 以外のグループ選択 UI(grant 不整合を修正する FixPageGrantModal 等)へのメンバー表示の適用
  - 親グループ・子孫グループのメンバー表示(直接所属グループのみが対象)
  - メンバーシップの編集・追加・削除(グループ管理は既存の管理者機能が所有)
  - 氏名・ユーザー名以外のメンバー情報(メールアドレス、自己紹介、プロフィール画像等)の公開
  - 本機能の有効/無効を切り替える管理者設定の追加
  - 自分が所属していないグループ(GrantSelector 上の nonUserRelatedGrantedGroups 等)のメンバー閲覧
- **Adjacent expectations**:
  - 既存のグループ所属データ(UserGroupRelation / ExternalUserGroupRelation)に依拠する。本機能は所属関係を変更しない。
  - GrantSelector が表示するグループ一覧(自分の所属グループ)の取得ロジックと整合する範囲で動作する。

## Requirements

### Requirement 1: グループ選択 UI 上でのメンバー一覧の閲覧
**Objective:** As a グループに所属する一般ログインユーザー, I want ページの公開範囲をグループ限定に設定する際、選択肢の各グループのメンバーを確認したい, so that どのグループに公開するかを所属メンバーを見て判断できる

#### Acceptance Criteria
1. When ログインユーザーが GrantSelector でグループ選択肢の一覧を表示したとき, the GROWI shall 選択肢として並ぶ自分の所属グループそれぞれについて、当該グループに所属するメンバーの一覧を提示する
2. The GROWI shall 提示する各メンバーについて、氏名(name)とユーザー名(username)を表示する
3. The GROWI shall UserGroup と ExternalUserGroup の両方の所属グループについてメンバー一覧を提示する
4. While あるグループに自分以外のメンバーが存在しないとき, the GROWI shall そのグループにメンバーがいない(自分のみである)ことが分かる形で結果を提示する

### Requirement 2: 表示対象の範囲
**Objective:** As a 一般ログインユーザー, I want 自分が直接所属するグループのメンバーだけを対象に確認したい, so that 表示範囲が予測可能で、関係のないグループの情報が混在しない

#### Acceptance Criteria
1. The GROWI shall ユーザーが直接メンバーとして登録されているグループのみをメンバー確認の対象とする
2. While 対象グループが親子階層を持つとき, the GROWI shall 親グループおよび子孫グループのメンバーを一覧に含めない
3. The GROWI shall メンバー一覧に有効(アクティブ)なユーザーのみを含め、無効化済みのユーザーを除外する

### Requirement 3: アクセス制御とプライバシー
**Objective:** As a 利用者, I want 自分が所属するグループのメンバーだけを閲覧でき、関係のないグループのメンバーは閲覧できないようにしたい, so that メンバー情報が必要最小限の範囲でのみ共有される

#### Acceptance Criteria
1. If 未ログインの状態でメンバー確認機能にアクセスされたとき, then the GROWI shall アクセスを拒否する
2. If ログインユーザーが自分の所属していないグループのメンバー一覧を要求したとき, then the GROWI shall そのグループのメンバー情報を返さない
3. The GROWI shall メンバー確認機能を、管理者権限を持たない一般ログインユーザーに提供する
4. The GROWI shall 各メンバーについて、氏名とユーザー名以外の情報(メールアドレス、自己紹介、プロフィール画像等)を公開しない
5. The GROWI shall 本機能を、追加の有効化設定なしに常時提供する
