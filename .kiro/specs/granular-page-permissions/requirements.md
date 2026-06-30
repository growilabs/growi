# Requirements Document

## Introduction

GROWI のページ権限は現在「閲覧できる範囲」と「編集できる範囲」が一体化しており、ページを閲覧
できるログインユーザーは編集もできる。本機能は、ページに対して **閲覧範囲（read scope）と編集
範囲（edit scope）を独立して設定** できるようにし、編集範囲にのみ含まれないユーザーの書き込みを
サーバー側で遮断する。あわせて、**自分が所属しないグループへの付与**、ページツリーの三点リーダー
（⋮）からの **配下ツリーへの権限付与**、および既存のツリー整合・継承への **ロール次元の追加** を
行う。既存ページのアクセス可否は移行後も変わらない。

本 spec は umbrella `enhanced-guest` の基盤 sub-spec である。詳細な背景・Discussions 根拠
（#8815 / #8250 / #9091）は `brief.md` を、全体方針は `../enhanced-guest/roadmap.md` を参照。

## Boundary Context

- **In scope**:
  - ページごとの閲覧範囲・編集範囲の独立設定（例: 閲覧=全体公開、編集=特定グループ）。
  - 実効ロール（編集可 / 閲覧のみ / アクセス不可）の算出と、閲覧のみロールの書き込み遮断。
  - 新規ページ作成のゲート（作成先の親ページに対する編集権限を要する）。
  - 閲覧のみロールユーザーのコメント可否の設定切替。
  - 自分が所属しないグループへの付与（全ユーザー可）。
  - 三点リーダー（⋮）からの配下ツリーへの権限付与。
  - 既存のツリー整合・継承にロール次元を通すこと。
  - 既存 grant の後方互換移行。
- **Out of scope**:
  - Public ページが自動では見えないゲスト（`guest-users` が所有）。
  - 有効期限／自動失効（`time-limited-access` が所有）。
  - 管理者向けの権限俯瞰／棚卸し画面。
  - グローバルな読み取り専用ユーザー（`User.readOnly`）の挙動変更。
  - 承認/編集ワークフロー（#9453）、匿名（未ログイン）公開ポリシーの変更。
- **Adjacent expectations**:
  - 既存のページ grant 正規化・継承（祖先と整合する閲覧範囲、配下への上書き、制限ページ配下
    での継承）を前提として利用し、ロール次元を加えて維持する。退行させない。
  - グローバル ROM（`User.readOnly`）とページ単位ロールは独立した別概念として併存する。
  - 管理者は既存どおりの権限を保持する（本機能はそれを縮小しない）。

## Requirements

### Requirement 1: 閲覧範囲と編集範囲の独立設定

**Objective:** ページ作成者として、ページの閲覧範囲と編集範囲を別々に指定したい。そうすれば
広い相手に公開しつつ編集者を限定できる。

#### Acceptance Criteria

1. When ページ作成者がページの権限を設定するとき, the Page Permission Service shall 閲覧範囲と編集範囲をそれぞれ独立して指定できるようにする。
2. When 閲覧範囲が Public に設定され編集範囲が特定グループに設定されたとき, the Page Permission Service shall 全ログインユーザーに閲覧を許可し、当該グループのメンバーにのみ編集を許可する。
3. The Page Permission Service shall 編集範囲を閲覧範囲の部分集合に限定する（編集を許す相手は必ず閲覧も許される）。
4. If 閲覧範囲に含まれないスコープを編集範囲に指定する設定が要求された場合, then the Page Permission Service shall その設定を拒否し、拒否理由を提示する。
5. If 編集範囲が空になる設定が要求された場合, then the Page Permission Service shall その設定を拒否する（編集者が存在しないページを作らせない）。

### Requirement 2: 実効ロールに基づく閲覧/編集の可否

**Objective:** 閲覧者として、自分が閲覧範囲にのみ含まれるページは閲覧できるが編集はできない
ようにしたい。そうすれば意図しない編集を防げる。

#### Acceptance Criteria

1. When ユーザーがページにアクセスするとき, the Page Permission Service shall そのユーザーの実効ロールを「編集可」「閲覧のみ」「アクセス不可」のいずれかに決定する。
2. While ユーザーの実効ロールが閲覧のみであるとき, the Page Service shall そのページの本文・属性の更新、リネーム、移動、複製先への作成、削除を拒否する。
3. While ユーザーの実効ロールがアクセス不可であるとき, the Page Service shall そのページの閲覧と編集をいずれも拒否する。
4. If 閲覧のみロールのユーザーが書き込み操作を UI を経由せず直接要求した場合, then the Page Service shall その操作を拒否する。
5. When 同一ユーザーが複数のスコープ（複数グループ等）に該当するとき, the Page Permission Service shall それらのうち最も強い権限を実効ロールとして採用する。
6. While ユーザーが添付ファイルの追加・削除を要求しており実効ロールが閲覧のみであるとき, the Page Service shall その操作を拒否する。
7. When ユーザーが新規ページを作成しようとするとき, the Page Service shall 作成先の親ページに対する実効ロールが編集可である場合にのみ作成を許可する。
8. If 作成先の親ページに対する実効ロールが閲覧のみまたはアクセス不可である場合, then the Page Service shall 新規ページの作成を拒否する。
9. Where 作成先の親ページが編集範囲を限定していない（editScope 未設定の開放領域である）とき, the Page Service shall 従来どおり閲覧可能なユーザーによる作成を許可する。

### Requirement 3: 閲覧のみロールユーザーのコメント可否（設定切替）

**Objective:** 運用者として、閲覧のみロールのユーザーがコメントできるかを設定で制御したい。
チームの運用に応じて許可/不許可を選べるようにするため。

#### Acceptance Criteria

1. Where 閲覧のみロールユーザーのコメントを許可する設定が有効であるとき, the Comment Service shall 閲覧のみロールのユーザーによるコメント投稿・更新・削除を許可する。
2. Where 閲覧のみロールユーザーのコメントを許可する設定が無効であるとき, the Comment Service shall 閲覧のみロールのユーザーによるコメント投稿・更新・削除を拒否する。
3. The system shall 当該設定の既定値を「許可しない（コメント不可）」とする。

### Requirement 4: 自分が所属しないグループへの付与

**Objective:** ページ権限を設定するユーザーとして、自分が所属していないグループにも権限を
付与したい。他部門や別チームと情報共有するため。

#### Acceptance Criteria

1. When ユーザーが閲覧範囲または編集範囲にグループを追加しようとするとき, the Page Permission UI shall 自分が所属するグループに加え、所属していないグループも選択候補として提示する。
2. The Page Permission Service shall すべてのユーザーに対し、自分が所属しないグループへの付与を許可する。
3. When 非所属グループが閲覧範囲または編集範囲に付与されたとき, the Page Permission Service shall そのグループのメンバーに対し、付与されたロールに応じたアクセスを与える。

### Requirement 5: 配下ツリーへの権限付与（三点リーダー）

**Objective:** ページ管理者として、あるページの配下ツリーにまとめて権限（閲覧範囲・編集範囲・
ロール）を適用したい。ページごとの設定の手間を省くため。

#### Acceptance Criteria

1. When ユーザーがページツリーの三点リーダー（⋮）メニューを開いたとき, the Page Tree UI shall 「配下ツリーへ権限を付与する」操作を提示する。
2. When ユーザーが配下ツリーへの権限付与を実行したとき, the Page Permission Service shall 対象ページとその配下ページに、指定した閲覧範囲・編集範囲・ロールを適用する。
3. While 配下ツリーへの適用が進行中であるとき, the Page Tree UI shall 適用の進行状況または完了をユーザーに通知する。
4. The Page Permission Service shall 配下ツリーへの適用を既存の配下上書き挙動と整合する形で行う。

### Requirement 6: ツリー整合性とロールの継承

**Objective:** システムとして、権限変更後もツリー全体で権限が整合し、子孫が祖先より広い閲覧を
持たないことを保証したい。設定漏れによる情報漏洩を防ぐため。

#### Acceptance Criteria

1. The Page Permission Service shall 子ページの閲覧範囲を祖先ページの閲覧範囲の範囲内に保つ。
2. When 制限されたページの配下に新規ページが作成されるとき, the Page Permission Service shall 親の閲覧範囲・編集範囲・ロールを継承の候補として提示する。
3. If ツリーの整合性を崩す権限変更が要求された場合, then the Page Permission Service shall その変更を拒否するか整合する形へ正規化し、結果をユーザーに提示する。
4. The Page Permission Service shall 整合性および継承の判定を、閲覧/編集ロールの次元を含めて行う。

### Requirement 7: 既存権限の後方互換移行

**Objective:** 既存ユーザーとして、機能導入後も既存ページのアクセス可否が変わらないように
したい。導入による不意のアクセス変化を避けるため。

#### Acceptance Criteria

1. When 本機能が導入されるとき, the Migration shall 既存のグループ／ユーザー付与を「編集可」ロール（閲覧＋編集）として扱われる形へ移行する。
2. The system shall 移行後、既存ページの閲覧および編集の可否を移行前と同一に保つ。
3. The system shall 既存の Public / リンク共有 / 自分のみ の各 grant の挙動を移行後も維持する。

### Requirement 8: グローバル読み取り専用ユーザーとの分離

**Objective:** 運用者として、ページ単位のロールがグローバルな読み取り専用ユーザー設定と
混ざらないようにしたい。2つの読み取り専用概念の取り違えを防ぐため。

#### Acceptance Criteria

1. The Page Permission Service shall ページ単位の実効ロールを、グローバルな読み取り専用ユーザー設定とは独立に算出する。
2. While ユーザーがグローバル読み取り専用であるとき, the system shall 既存のグローバル読み取り専用の挙動を維持し、本機能によって変更しない。
