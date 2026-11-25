# Requirements Document

## Introduction

GROWI Vault は、ゲスト閲覧を許可しているサイトで、認証情報のない `git clone` にも public のページを返してきた。この経路は、権限を絞ったページや削除したページの過去の内容を、新しくクローンしたゲストに渡してしまう。この spec は、認証情報のないクローンを廃止し、すでに作られたゲスト向けのビューを取り除く。growi-vault-gateway・growi-vault・growi-vault-manager の承認済みの契約を変える amend spec であり、対象は brief.md の「Amend target」に示す。

## Project Description (Input)
growi-vault-gateway に対する amend spec。認証情報のないクローン（ゲストのクローン）を廃止する。

- 誰が困っているか: GROWI 管理者とページの作成者。ゲスト閲覧を許可しているサイトで、権限を絞ったページや削除したページの内容が、Vault のゲスト向けクローンから取り出せる。
- 現状: 認証ヘッダーのない git clone を `userId: null` として通し、すべてのゲストで共有する `anonymous-view` を合成して返している。ビューの合成は前回のビューの commit を親にするので、履歴に過去の public の内容がすべて残る。
- 変えること: ゲスト閲覧の設定によらず、認証情報のないクローンは 401 + `WWW-Authenticate` で PAT を求める。vault-manager は `userId: null` の合成をやめ、既存の `refs/namespaces/anonymous-view/` と `vault_user_views` の匿名の記録を消す。

Amend target は brief.md を参照。

## Boundary Context

- **In scope**:
  - 認証情報のない clone / fetch を、ゲスト閲覧の設定によらず拒否すること
  - 利用者を特定しないビューを、今後は作らないこと
  - すでに作られたゲスト向けのビューと、その記録を取り除くこと
  - 利用者向けの案内（文書・画面の文言・リリースノート）を、この変更に合わせること
- **Out of scope**:
  - ブラウザでのゲスト閲覧。`security:restrictGuestMode` / `security:wikiMode` によるページ表示の可否は変えない
  - ログインユーザーのビューの履歴の持ち方。ログインユーザーのビューは 1 人に 1 本で、履歴に入るのは本人がすでに受け取った内容だけである
  - 失敗した instruction の再処理と `grant-change-prefix` の扱い（別の amend spec で扱う）
- **Adjacent expectations**:
  - PAT による認証、無効な PAT の拒否、PAT のスコープの扱いは、growi-vault-gateway の要件 2.1〜2.3・2.5・2.6 のまま変えない
  - ゲスト向けのビューを取り除いても、public namespace そのもの（ログインユーザーのビューの材料）は残す

## Requirements

### Requirement 1: 認証情報のないクローンを拒否する

**Objective:** GROWI 管理者として、認証情報のない git クライアントには Vault の内容を一切返さないようにしたい。権限を絞ったページや削除したページの内容が、利用者を特定できない相手に渡らないようにするためである。

#### Acceptance Criteria

1. When 認証情報を伴わない clone または fetch の要求を受け取ったとき, the GROWI Vault Gateway shall `WWW-Authenticate: Basic realm="GROWI Vault"` ヘッダーを含む HTTP 401 を返し、PAT を求める
2. While ゲスト閲覧が許可されている（`security:wikiMode='public'` または `security:restrictGuestMode='Readonly'`）間, the GROWI Vault Gateway shall 認証情報を伴わない clone または fetch の要求を、ゲスト閲覧が許可されていない場合と同じく拒否する
3. When 認証情報を伴わない要求を拒否するとき, the GROWI Vault Gateway shall 応答にページの一覧、ref の一覧、ページが存在するかどうかの情報を含めない
4. When 有効な PAT を伴う clone または fetch の要求を受け取ったとき, the GROWI Vault Gateway shall この変更の前と同じ内容を返す
5. The GROWI Vault Gateway shall 利用者を特定できない要求に対して、namespace の計算もビューの合成の依頼も行わない

### Requirement 2: 利用者を特定しないビューを作らない

**Objective:** GROWI 管理者として、複数の相手が共有するビューが Vault の中に作られないようにしたい。共有されたビューの履歴を通じて、ある時点の内容が、後からクローンした別の相手に渡るのを防ぐためである。

#### Acceptance Criteria

1. If 利用者を特定しないビューの合成を依頼されたとき, then the GROWI Vault Manager shall その依頼をエラーとして拒否し、ビューもその記録も作らない
2. The GROWI Vault shall 1 本のビューを 1 人の利用者にだけ対応させ、複数の利用者が同じビューを受け取ることがないようにする

### Requirement 3: すでに作られたゲスト向けのビューを取り除く

**Objective:** GROWI 管理者として、更新するだけで、過去に作られたゲスト向けのビューが Vault から取り除かれてほしい。更新の後も古いビューの履歴が残り、そこから過去の内容を取り出せる状態を残さないためである。

#### Acceptance Criteria

1. When この変更を含む版に更新した後で最初に起動したとき, the GROWI Vault shall ゲスト向けのビュー（`anonymous-view`）と、そのビューの記録を、管理者の操作なしに取り除く
2. When ゲスト向けのビューを取り除いた後で clone または fetch の要求を受け取ったとき, the GROWI Vault shall ゲスト向けのビューの履歴からしかたどれない内容を、どの利用者にも返さない
3. If ゲスト向けのビューもその記録も存在しないとき, then the GROWI Vault shall 何も変更せず、エラーも出さずに起動を続ける
4. If ゲスト向けのビューを取り除く処理が失敗したとき, then the GROWI Vault shall 失敗を error ログに残し、次の起動でもう一度取り除きを試みる
5. The GROWI Vault shall ゲスト向けのビューを取り除くために、Vault の再構築（管理画面の「Vault の再構築」）を必要としない
6. When ゲスト向けのビューを取り除くとき, the GROWI Vault shall ログインユーザーのビューと、namespace（`public` を含む）の内容を変えない

### Requirement 4: 利用者への案内を変更に合わせる

**Objective:** GROWI の利用者と管理者として、クローンには PAT が必要であることを、文書と画面から分かるようにしたい。これまでゲストとしてクローンしていた利用者が、失敗の理由と対処を知るためである。

#### Acceptance Criteria

1. The GROWI Vault の利用者向け文書 shall クローンには PAT が必要であることを示し、認証情報なしでクローンできるという記述を含まない
2. Where GROWI の画面が Vault のクローン手順を示す場合, the GROWI shall ログインしていない閲覧者に、認証情報なしのクローン手順を示さない
3. The この変更のリリースノート shall ゲスト閲覧を許可しているサイトでも認証情報なしのクローンができなくなること、および PAT を発行すればクローンできることを示す
