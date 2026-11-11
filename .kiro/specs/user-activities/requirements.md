# Requirements Document

## Project Description (Input)

ユーザーページの「最近の活動」が使う `GET /_api/v3/user-activities` の応答の仕様を定める。詳細な背景・方針は `brief.md` を参照。

### (a) 誰が困っているか
- この API を変更する開発者。誰の履歴を取得できるか、どのページへの操作を一覧に含めるか、ページのどの項目を返すか、総件数が何の件数かを定めた文書が無く、実装から読み取るしかない。
- この API を画面以外から直接呼ぶ利用者（アクセストークンなど）。応答に何が含まれるかの約束が無い。

### (b) 現状
- この API の応答を扱う spec が無い。隣の `activity-log` は「何を記録するか」を担当し、読み出し側は範囲外である。
- 既存のテストは集計の形を確認するもので、「誰に何を返すか」を確認するテストは無い。
- GROWI の他の読み出し経路（検索、ページ一覧、`GET /users/:id/recent`）は、閲覧者が見られるページだけを返す。

### (c) どう変えたいか
- この API が返す内容を、閲覧者が閲覧できるページについての情報だけにする。この判断はサーバー側で行い、画面側の表示制御に頼らない。
- 操作対象のページについて返す項目を、画面が必要とするものに限る。
- 総件数を、実際に一覧として返す対象の件数と一致させる。
- 閲覧できないページへの操作履歴を「行ごと返さない」か「行は残してページの情報だけ返さない」かは、design で応答時間を実測して決める（前者が第 1 候補）。要件はどちらの方式でも満たせるよう、観察できる結果で書く。

## Introduction

このドキュメントは、ユーザーページの「最近の活動」が使う `GET /_api/v3/user-activities`（以下 User Activities API）の応答の要件を定める。定めるのは次の 4 点である。

- 誰が、誰の履歴を取得できるか
- どのページへの操作を応答に含めるか
- 操作対象のページについて、どの項目を返すか
- 総件数が何の件数か

中心になる約束は「閲覧者が閲覧できないページについての情報を、この API は返さない」である。この約束はサーバー側で守り、画面側の表示制御には頼らない。API を画面以外から直接呼んでも、同じ結果になる。

この文書で「閲覧者が閲覧できるページ」とは、GROWI の既存の一覧（検索、ページ一覧）が同じ閲覧者に見せるページのことである。「閲覧できないページ」とは、既存の一覧が同じ閲覧者に見せないページのことである。

## Boundary Context

- **In scope**:
  - User Activities API の応答の内容（取得できる相手、含める履歴、ページについて返す項目、総件数とページ送り）
  - 閲覧権限による絞り込みをサーバー側で行うこと
  - 応答の変更に合わせた「最近の活動」画面の表示
  - API の文書（OpenAPI の記述）を実際の応答に合わせること
- **Out of scope**:
  - contribution graph の API（件数だけを返す別の API）
  - 何を記録するか、保存期間の値（`activity-log` が担当）
  - 管理者向けの監査ログ画面とその API
  - 閲覧権限の規則そのものの変更（公開範囲の種類や判定方法）
  - 認証の手段を増やすこと（アクセストークンでの呼び出しへの対応など）
  - 「最近の活動」画面の見た目の刷新
- **Adjacent expectations**:
  - 「閲覧者が閲覧できるページ」の範囲は、GROWI の既存の一覧（検索、ページ一覧、`GET /users/:id/recent`）が同じ閲覧者に見せる範囲に従う。この API 専用の範囲を新しく作らない。
  - 既存の一覧は、制限付きページ（「自分のみ」やグループ限定）を一覧に出すかどうかの管理設定に従う。この API も同じ設定に従う。そのため、設定によっては、閲覧者が開けない制限付きページのパスも、既存の一覧と同じように返る。
  - 閲覧できないページへの操作履歴を「行ごと返さない」か「行は残してページの情報だけ返さない」かは、design で応答時間を実測して決める（前者が第 1 候補）。以下の要件はどちらの方式でも満たせるよう、観察できる結果で書いてある。方式によってだけ必要になる要件は `Where` で条件を付けている。
  - 応答時間の基準値は design で実測して定める。1 人のユーザーが保存期間内（既定 30 日）に持つ履歴の件数を想定して測る。
  - 履歴の記録は `activity-log` が担当する。この API は、記録された履歴を読むだけである。

## Requirements

### Requirement 1: 取得できる相手と認証

**Objective:** As a GROWI の利用者, I want 自分や他のユーザーの最近の活動を取得すること, so that ユーザーページで、その人が最近何をしたかを知ることができる

#### Acceptance Criteria
1. If ログインしていない利用者が呼び出した, then the User Activities API shall 履歴を返さず、認証が必要であることを示すエラーを返す
2. When ログイン済みの利用者が対象ユーザーを指定せずに呼び出した, the User Activities API shall 呼び出した利用者自身の履歴を返す
3. When ログイン済みの利用者が対象ユーザーを指定して呼び出した, the User Activities API shall 指定されたユーザーの履歴を、Requirement 2 の範囲で返す
4. If 対象ユーザーの指定がユーザー ID の形式でない, then the User Activities API shall 履歴を返さず、入力の誤りを示すエラーを返す
5. If 指定されたユーザーが存在しない, then the User Activities API shall 0 件の一覧を返す
6. The User Activities API shall 対象ユーザーが行った、「最近の活動」の対象となる操作（ページの作成・更新・名前変更・複製・削除・完全削除・復元・いいね、コメントの作成）の履歴だけを返す

### Requirement 2: 閲覧できないページの情報を返さない

**Objective:** As a ページの公開範囲を限定している利用者, I want 自分のページの存在や場所が、閲覧権限のない人に他人の活動履歴を通じて伝わらないこと, so that 公開範囲の設定がこの API でも守られる

#### Acceptance Criteria
1. The User Activities API shall 既存の一覧（検索、ページ一覧）が同じ閲覧者に見せないページについて、パス・ID・公開範囲・許可されたユーザーやグループなど、そのページを特定できる情報を応答に含めない
2. The User Activities API shall 「閲覧者が閲覧できるページ」の範囲を、GROWI の既存の一覧（検索、ページ一覧）が同じ閲覧者に見せるページの範囲と一致させる
3. The User Activities API shall 操作対象のページがすでに存在しない履歴と、閲覧者が閲覧できないページへの履歴とを、応答から区別できないようにする
4. When 閲覧者が管理者である, the User Activities API shall 既存の一覧が管理者に見せる範囲と同じ範囲を適用し、この API だけの例外を設けない
5. When 閲覧者が対象ユーザー本人である, the User Activities API shall 既存の一覧が本人に見せるページについての情報だけを返す
6. The User Activities API shall 画面を経由しない直接の呼び出しに対しても、上記と同じ応答を返す

### Requirement 3: 返す項目

**Objective:** As a この API を変更する開発者、または直接呼ぶ利用者, I want 応答に含まれる項目が決まっていること, so that 必要以上の情報が応答に乗らず、応答の形を前提にできる

#### Acceptance Criteria
1. The User Activities API shall 各履歴について、履歴の ID・操作の種類・操作の日時・操作したユーザー・操作対象のページを返す
2. The User Activities API shall 操作対象のページについて、「最近の活動」画面の表示に必要な項目だけを返す
3. The User Activities API shall 操作対象のページについて、許可されたユーザーやグループ、ページを見たユーザーの一覧、いいねしたユーザーの一覧を返さない
4. The User Activities API shall 操作したユーザーについて、ID・ユーザー名・表示名・アイコン画像の場所だけを返し、メールアドレスや認証に関わる情報を返さない
5. The User Activities API shall 履歴を記録したときの接続元の情報（IP アドレスなど）を返さない

### Requirement 4: 総件数とページ送り

**Objective:** As a ユーザーページを見る利用者, I want ページ送りの表示が実際の件数と合っていること, so that 空のページや、件数の足りないページが途中に現れない

#### Acceptance Criteria
1. The User Activities API shall 履歴を、操作の日時が新しい順に返す
2. The User Activities API shall 総件数として、同じ閲覧者がページ送りですべて取得したときに返る履歴の件数を返す
3. When 取得する件数と開始位置が指定された, the User Activities API shall 開始位置から、指定された件数（残りがそれより少ないときは残りの全件）の履歴を返す
4. The User Activities API shall ページ送りですべて取得したときに、同じ履歴を重複して返さず、返すべき履歴を欠かさない
5. If 取得する件数に 100 を超える値が指定された, then the User Activities API shall 履歴を返さず、入力の誤りを示すエラーを返す
6. When 取得する件数が指定されなかった, the User Activities API shall GROWI の設定で決まる既定の件数を使う

### Requirement 5: 「最近の活動」画面の表示

**Objective:** As a ユーザーページを見る利用者, I want その人が操作したページのうち自分が見られるものを一覧で見ること, so that そこからページを開ける

#### Acceptance Criteria
1. The 最近の活動画面 shall 応答に含まれる履歴を、1 件につき 1 行ずつ、すべて表示する
2. The 最近の活動画面 shall 各行に、操作の種類と、操作からの経過時間を表示する
3. When 履歴にページの情報が含まれる, the 最近の活動画面 shall そのページのパスを、そのページへのリンクとして表示する
4. Where 応答にページの情報を持たない履歴が含まれる方式を採る, the 最近の活動画面 shall その行を、リンクを付けず、ページを特定できない表示にする
5. The 最近の活動画面 shall ページ送りの総ページ数を、API が返す総件数から決める
6. Where 画面に新しい文言を追加する, the 最近の活動画面 shall GROWI が対応する 5 言語すべてで、その文言を翻訳して表示する

### Requirement 6: API の文書

**Objective:** As a この API を直接呼ぶ利用者, I want 公開されている API の文書が実際の応答と合っていること, so that 文書を見て正しく呼べる

#### Acceptance Criteria
1. The User Activities API の文書 shall 実際の呼び出し先のパスを記載する
2. The User Activities API の文書 shall 実際に受け付ける引数をすべて記載し、応答に影響しない引数を記載しない
3. The User Activities API の文書 shall 応答の各項目を、実際に返る形のとおりに記載する
4. The User Activities API の文書 shall 実際に使える認証の手段だけを記載する
