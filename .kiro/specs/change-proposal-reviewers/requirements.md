# Requirements Document

## Project Description (Input)

change-proposal-reviewers: change-proposal-core の amend spec。Change Proposal に「承認できる人（承認者）」を持たせ、依頼した人以外のユーザー・ユーザーグループが承認できるようにする（詳細は [brief.md](./brief.md)）。

### (a) 誰が困っているか
- AI などに作らせた Change Proposal を、他の人に確認して承認してもらいたいユーザー。
- 承認する側のユーザー（個人、またはグループの人たち）。依頼した人が不在でも承認を進めたい。
- 大人数の wiki の管理者。AI が頻繁に Change Proposal を作ると、承認が依頼した本人 1 人に集中して溜まる。

### (b) 現状
- Change Proposal に持つ人は依頼した人だけで、承認・飛ばす・破棄ができるのも依頼した人だけ。承認待ちの Change Proposal は、依頼した人以外には返さない（core の 4.6、9.2）。

### (c) どう変えたいか
- Change Proposal に承認者（複数のユーザー、複数のグループ、その混在。依頼した人自身も可）を指定できるようにする。
- 承認者が、自分が閲覧できるページの操作を承認できるようにする。承認者は別の承認者を追加できる。
- 承認待ちを依頼した人と承認者に見せ、承認者に通知する。
- 見る人が閲覧できないページの存在は、これまでどおり分からないままにする。

## Introduction

この文書は、`change-proposal-core` の契約を変える amend spec の要件を定める。完了後は、内容を core の requirements.md・design.md・research.md に戻し、この spec は削除する（[spec-lifecycle](../../../.claude/rules/spec-lifecycle.md)）。core に戻すときの要件の番号は、core の最後の番号（14）の続きに付け直す（既存の番号は変えない）。

### 本要件で使う言い方

core の「本要件で使う言い方」の語（Change Proposal、操作、依頼した人、閲覧できるページ、見る人、見る人に返す操作、段階、完了など）をそのまま使う。このほかに次の語を使う。

- **承認者**: Change Proposal の承認待ちの操作を、承認したり飛ばしたりできる人。ユーザー、またはユーザーグループとして指定される。ユーザーグループには、GROWI のユーザーグループと、外部の認証から取り込まれたグループの両方が含まれる。
- **承認者である人**: 次のどちらかを満たすユーザー。(1) 承認者としてそのユーザー自身が指定されている。(2) 承認者として指定されたグループの、操作の時点での所属者である。グループの所属者かどうかは、既存のページの閲覧範囲（グループ指定）と同じ規則で、操作の時点で判定する。
- **承認の対象**: 承認者である人が承認・飛ばすことのできる操作。その人が閲覧できるページ（リンクを知る人だけが見られるページを除く）に対する、状態が「待ち」の操作を指す。

## Boundary Context

- **In scope**:
  - 作成のときと、その後に、承認者（ユーザー・グループ・混在・依頼した人自身）を指定すること。指定が無いときの既定
  - 承認者である人による、承認の対象の承認と飛ばすこと。グループが承認者のときは、所属者の誰か 1 人の承認で反映されること
  - 承認者である人による、別の承認者の追加
  - 承認待ちを、依頼した人と承認者である人にだけ返すこと。承認者である人が承認待ちを一覧で取得すること
  - 承認者である人への通知と、承認者に関する記録（activity）
  - 反映のときの権限の確認と作者を、これまでどおり依頼した人にすること
- **Out of scope**:
  - 承認・承認者の追加の画面、承認待ちの一覧の画面、導線（`change-proposal-viewer` に、この spec の後で足す）
  - AI チャットで承認者を選ぶ画面と、AI の道具からの指定（`change-proposal-ai-agent`。必要なら別に判断する）
  - 全員の承認を要求する形、承認する人数の下限
  - 承認者の削除（確認したいこと 3）
  - Change Proposal 全体の破棄を承認者に許すこと（破棄は依頼した人だけ）
  - ページごとの通知の指定の変更を承認者に許すこと（依頼した人だけ）
  - 差分の塊ごとの承認
- **Adjacent expectations**:
  - 閲覧できるかどうかの判定、グループの所属の判定、読み取り専用ユーザーとゲストの扱いには、GROWI の既存の規則を使い、新しい規則は作らない。
  - 反映の仕組み（元のリビジョンの確認、編集中の人、権限の確認、並び順、二重書き込みの防止）は core の要件 3 のままで、本 spec は変えない。
  - 反映済みの Change Proposal の見え方（core の 9.1・9.7 など）は、承認待ちの扱いを除いて変えない。

## Requirements

### Requirement 1: 承認者の指定

**Objective:** 依頼した人として、Change Proposal を作るときに、承認してほしい人（ユーザーとグループ）を指定したい。自分以外の人にも承認を頼めるようにするため。

#### Acceptance Criteria
1. When 入口が Change Proposal の作成を求めるときに承認者を指定した場合, the Change Proposal System shall 指定された承認者を Change Proposal とともに保存する。
2. The Change Proposal System shall 承認者として、複数のユーザー、複数のユーザーグループ、およびその混在を受け付ける。
3. The Change Proposal System shall 依頼した人自身を、承認者として指定することを受け付ける。
4. Where 作成のときに承認者が指定されなかった場合, the Change Proposal System shall 依頼した人だけを承認者とみなす。そのため、既存の Change Proposal と、承認者を指定しない入口の振る舞いは変わらない。
5. Where 作成のときに承認者が指定された場合, the Change Proposal System shall 依頼した人を、指定に含まれている場合に限り承認者として扱う。
6. If 指定された承認者のユーザーまたはグループが存在しない場合, then the Change Proposal System shall その Change Proposal を保存せず、受け付けない理由を返す。
7. If 指定された承認者に、同じユーザーまたは同じグループが重ねて含まれている場合, then the Change Proposal System shall 重ねた分を 1 つにまとめて保存する。
8. If 作成のときに指定された承認者の数が、決められた上限を超える場合, then the Change Proposal System shall その Change Proposal を保存せず、上限を超えたことを返す。上限の値は設計で決める（確認したいこと 4）。
9. The Change Proposal System shall 承認者を指定できるのを、Change Proposal を作る依頼した人（Requirement 1.1）と、承認者である人（Requirement 3）に限る。

### Requirement 2: 承認者による承認と飛ばすこと

**Objective:** 承認者として、自分が閲覧できるページの操作を確かめて承認したい。依頼した人が不在でも、承認を進めるため。

#### Acceptance Criteria
1. When 承認者である人が、承認待ちの Change Proposal の中で 1 つ以上のページを選んで承認した場合, the Change Proposal System shall 選ばれたページに対する承認の対象の操作を反映する。
2. When 承認者である人が、承認待ちの Change Proposal 全体の承認を求めた場合, the Change Proposal System shall その人にとっての承認の対象の操作をすべて反映する。その人が閲覧できないページの操作は反映しない。
3. When 承認者である人が、承認の対象の操作を反映しないことを選んだ場合, the Change Proposal System shall その操作の状態を「飛ばした」にする。
4. Where 承認者がグループとして指定されている場合, the Change Proposal System shall そのグループの所属者の誰か 1 人が承認すれば、その操作を反映する。同じグループの別の所属者の承認を重ねて求めない。
5. When 複数の承認者である人が、同じ操作の承認または飛ばすことを同時に求めた場合, the Change Proposal System shall その操作を 1 回だけ反映し、同じ操作を二度書き込まない。後から処理された求めには、その時点の操作の状態を返す。
6. If 承認者である人が、自分が閲覧できないページの操作の承認または飛ばすことを求めた場合, then the Change Proposal System shall それを受け付けず、そのページの操作が存在しない場合と同じ応答を返す。
7. If 承認者でもなく依頼した人でもないユーザーが、承認待ちの Change Proposal の承認・飛ばす・破棄・承認者の追加を求めた場合, then the Change Proposal System shall それを受け付けず、Change Proposal が存在しない場合と同じ応答を返す。
8. If 承認者として指定されていない依頼した人が、承認または飛ばすことを求めた場合, then the Change Proposal System shall それを受け付けず、承認者ではないことを返す。
9. When 依頼した人が、承認待ちの Change Proposal を破棄した場合, the Change Proposal System shall core の 2.4 と同じ扱いにする。承認者である人は、Change Proposal 全体を破棄できない。
10. When 承認者である人が操作を承認または飛ばした場合, the Change Proposal System shall その操作に、承認または飛ばした人と日時を記録する。
11. If 期限切れ・破棄・取り下げ・完了になった Change Proposal の承認または飛ばすことを求められた場合, then the Change Proposal System shall core の 2.10、4.7 と同じように、反映せず、反映できない状態であることを返す。
12. When 承認者である人の承認により、編集中の人がいたために操作が「待ち」のまま残った場合, the Change Proposal System shall core の 4.8 と同じように、その操作を承認待ちとして扱い、承認者である人が後から再び承認できるようにする。

### Requirement 3: 承認者の追加

**Objective:** 承認者として、自分では判断できない操作を、別の人やグループに確認してもらいたい。承認を分担するため。

#### Acceptance Criteria
1. When 承認者である人が、承認待ちの Change Proposal に、承認者としてユーザーまたはユーザーグループを追加した場合, the Change Proposal System shall その承認者を保存する。
2. The Change Proposal System shall 承認者を追加するときに、複数のユーザー、複数のグループ、およびその混在を受け付ける。
3. When 依頼した人が、承認待ちの Change Proposal に承認者を追加した場合, the Change Proposal System shall 承認者として保存する。ただし、依頼した人が承認者でなくても、追加はできる。
4. If 追加しようとした承認者のユーザーまたはグループが存在しない場合, then the Change Proposal System shall 追加せず、受け付けない理由を返す。
5. If 追加しようとした承認者がすでに承認者として指定されている場合, then the Change Proposal System shall 何も変えずに成功として返す。
6. If 段階が承認待ちでない Change Proposal について、承認者の追加を求められた場合, then the Change Proposal System shall 追加せず、追加できない状態であることを返す。
7. If 追加したあとの承認者の数が、Requirement 1.8 の上限を超える場合, then the Change Proposal System shall 追加せず、上限を超えたことを返す。
8. When 承認者が追加された場合, the Change Proposal System shall 追加した人と日時を記録する。
9. When 承認者が追加された場合, the Change Proposal System shall 追加された承認者である人に、Requirement 5 の通知を送る。追加によって、追加された人が閲覧できないページの存在は分からない。

### Requirement 4: 承認待ちの見え方

**Objective:** 承認者として、自分に承認が頼まれている Change Proposal を、見つけて確かめたい。見つけられないと、承認が溜まってしまうため。

#### Acceptance Criteria
1. When 依頼した人または承認者である人が、承認待ちの Change Proposal の取得を求めた場合, the Change Proposal System shall 依頼した人・入口の種類・モデル名・作成日時・全体の状態と、見る人が閲覧できるページに対する操作だけを、操作ごとの状態とともに返す。
2. The Change Proposal System shall 依頼した人でも承認者である人でもない見る人には、承認待ちの Change Proposal を返さない。
3. If 承認者である人が、承認待ちの Change Proposal を取得しようとしたときに、その人に返す操作が 1 つも無い場合, then the Change Proposal System shall Change Proposal が存在しない場合と同じ「見つからない」応答を返す。
4. When 見る人が、自分が承認者である承認待ちの Change Proposal の一覧を求めた場合, the Change Proposal System shall その人に返す操作を 1 つ以上含む承認待ちの Change Proposal を、新しい順に、ページ送りできる形で返す。
5. The Change Proposal System shall 承認者である人に返す操作を、その人が閲覧できるページ（リンクを知る人だけが見られるページを除く）に対する操作だけにする。閲覧できない操作の件数や、閲覧できない操作があることを示す情報を含めない。
6. The Change Proposal System shall 承認者である人への応答に、承認者の一覧（ユーザーの名前とグループの名前）、承認または飛ばした人、追加した人を含める。ただし、見る人が見られないページの存在を示す情報は含めない。
7. The Change Proposal System shall 依頼した人にだけ返している内容（承認待ちの達成度、ページごとの通知の指定、入口が用意する本人向けの内容など）を、承認者である人には返さない。
8. While 承認者である人が、承認者としての指定をグループの所属によって得ている場合, the Change Proposal System shall 所属が外れたあとは、その人を承認者である人として扱わない。
9. The Change Proposal System shall 反映済みの Change Proposal の取得と一覧の振る舞い（core の 9.1・9.7 など）を、この Requirement によって変えない。

### Requirement 5: 承認者への通知と記録

**Objective:** 承認者として、自分に承認が頼まれたことに気付きたい。承認が頼まれても気付けないと、承認が溜まるため。

#### Acceptance Criteria
1. When 承認者が指定された Change Proposal が承認待ちとして作られた場合、または承認者が追加された場合, the Change Proposal System shall 新しく承認者である人になったユーザーに、アプリ内通知を送る。
2. The Change Proposal System shall この通知の中身を、受け取るユーザーが閲覧できるページの分だけで作り、閲覧できないページのパス・タイトル・件数を含めない。
3. If 通知を受け取るはずのユーザーが、承認の対象の操作を 1 つも持たない場合, then the Change Proposal System shall そのユーザーにはその通知を送らない。
4. When 承認者として指定されたグループがある場合, the Change Proposal System shall 通知を送る時点のグループの所属者を宛先にする。
5. The Change Proposal System shall 依頼した人自身が承認者に含まれている場合でも、依頼した人には、自分が作った Change Proposal についての新しい通知を、この Requirement によっては送らない。
6. When 承認者の指定、承認者の追加、承認者による承認または飛ばすことがあった場合, the Change Proposal System shall それを新しい種類の activity として、操作した人を操作者として記録する。
7. The Change Proposal System shall 反映のあとのまとめたアプリ内通知（core の 7.2・7.8）の宛先と中身を、この Requirement によって変えない。

### Requirement 6: 反映のときの権限と作者

**Objective:** 管理者として、承認者に指定されたことで、書き込める範囲が増えないようにしたい。承認の仕組みが権限の抜け道にならないようにするため。

#### Acceptance Criteria
1. When 承認者である人の承認によって操作を反映する場合, the Change Proposal System shall 書き込む権限を、core の 3.6 と同じように、依頼した人についてその時点で確かめる。
2. When 承認者である人の承認によって操作を反映する場合, the Change Proposal System shall 作るリビジョンとページの作者を、core の 3.10 と同じように依頼した人にする。
3. If 反映しようとした時点で、依頼した人が対象のページに書き込む権限を持たない場合、または依頼した人が読み取り専用ユーザーや使えないユーザーになっている場合, then the Change Proposal System shall core の 3.6 と同じように、その操作を書き込まずに「失敗」にする。承認者である人の権限では書き込まない。
4. The Change Proposal System shall 承認者として指定されたことを、ページを閲覧する権限・編集する権限・管理者の設定のどれにも影響させない。
5. If 読み取り専用ユーザーまたはゲストが、承認・飛ばす・承認者の追加を求めた場合, then the Change Proposal System shall core の 9.9 と同じように、それを受け付けない。
6. The Change Proposal System shall 承認者による承認の反映に、core の要件 3（元のリビジョンの確認、編集中の人、並び順、二重書き込みの防止、人の保存との競合）をそのまま適用する。
7. When 管理者が書き込み機能を無効にした場合, the Change Proposal System shall core の 8.5 と同じように、承認者が指定された Change Proposal を含めて、承認待ちの Change Proposal をすべて取り下げる。

### Requirement 7: 既存の動きの維持と表示名

**Objective:** 管理者として、承認者を指定しない使い方と、すでにある Change Proposal が、これまでどおり動いてほしい。機能の追加で既存の動きが変わらないようにするため。

#### Acceptance Criteria
1. The Change Proposal System shall 承認者を指定していない Change Proposal（作成のときに指定されなかったものと、この変更の前に作られたもの）では、依頼した人だけが承認・飛ばす・破棄でき、承認待ちは依頼した人にだけ返す。
2. The Change Proposal System shall 自動反映の方針（「しない」「自分が作ったページだけ」「すべて」）の意味を変えない。「自分が作ったページだけ」の「自分」は、依頼した人を指す。
3. The Change Proposal System shall ページごとの通知の指定の変更を、これまでどおり依頼した人だけに許す。
4. The Change Proposal System shall 承認者に関する新しい表示名（承認者、承認した人、承認者の追加などの言葉）と、承認者に関する新しい activity の名前を、GROWI が対応する 5 言語（英語・日本語・中国語・フランス語・韓国語）すべてで表示する。
5. The Change Proposal System shall 承認者の指定のない入口（取り消し、後続・見直しの Change Proposal を含む）の振る舞いを、この変更によって変えない。

## 既存の core の要件との関係

この spec が core に戻るとき、次のように扱う（core の本文は、変更がもとからなかったものとして書き換える）。

| core の要件 | この spec での扱い |
|---|---|
| 1（作成） | Requirement 1 を、作成の要件として追加する |
| 2.3、2.4（飛ばす、破棄） | 2.3 は「依頼した人」を「承認者である人」に広げる（Requirement 2.3）。2.4 は依頼した人だけのまま（Requirement 2.9） |
| 4.4、4.5（承認） | 「依頼した人」を「承認者である人」に広げる（Requirement 2.1、2.2） |
| 4.6（本人以外の拒否） | 「依頼した人以外」を「依頼した人でも承認者でもない」に直す（Requirement 2.7） |
| 7（通知） | 7.2・7.8 は変えない。承認者への通知は新しい要件として追加する（Requirement 5）。7.15 は変えない（Requirement 7.3） |
| 9.2、9.3、9.4 | 承認待ちを承認者である人にも返す（Requirement 4）。見える操作の絞り込みと「見つからない」の扱いは同じ規則 |
| 9.9（読み取り専用ユーザー） | 承認・飛ばす・承認者の追加にも適用する（Requirement 6.5） |

## 確認したいこと（決まっていないこと）

要件を書く時点で、依頼にまだ答えが無かった点。ここで置いた既定のまま進めてよいか、承認の前に確認する。

1. **依頼した人は、承認者に指定しなければ承認できない（Requirement 1.5、2.8）。** 「自分自身の設定も可」という依頼から、承認者を指定したときは、依頼した人は指定に含めた場合だけ承認者になる、と読んだ。ほかの人に頼んだあと、依頼した人が自分で承認できなくなってよいか。代わりに「依頼した人は常に承認者に含める」という形もある。
2. **全体の破棄は依頼した人だけ（Requirement 2.9）。** 承認者は、自分が閲覧できるページの操作を飛ばすことで「断る」ことができる。承認者にも破棄を許すかどうか。
3. **承認者の削除は作らない（Out of scope）。** 追加は承認者である人が誰でもできるので、誤って追加した人を外せない。外せる人（追加した人だけ、依頼した人だけ、など）を決めるか。
4. **承認者の数の上限（Requirement 1.8）。** 上限の値（たとえば 20）と、管理者の設定にするかどうか。
5. **指定された承認者がすべて存在しなくなったとき（ユーザーの削除、グループの削除）。** 承認できる人がいなくなった承認待ちを、期限切れまで待つか、依頼した人が承認できる状態に戻すか。
6. **承認者の追加が、見えない承認待ちの存在を知らせることにならないか。** 追加された人が 1 つもページを閲覧できないときは、通知を送らず、取得も「見つからない」にする（Requirement 4.3、5.3）。追加した人には、追加が成功したことだけを返し、追加された人が見られるかどうかは返さない。この扱いでよいか。
