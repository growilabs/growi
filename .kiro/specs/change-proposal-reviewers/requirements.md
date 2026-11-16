# Requirements Document

## Project Description (Input)

change-proposal-reviewers: change-proposal-core の amend spec。Change Proposal に「承認者」（複数のユーザー・グループ）を持たせ、依頼した人以外が承認・却下・放棄できるようにする（詳細は [brief.md](./brief.md)）。

### (a) 誰が困っているか
- AI などに作らせた Change Proposal を、他の人に確認して承認してもらいたいユーザー。誰に頼めばよいか分からないときは、身近な人（メンターなど）にまず頼み、その人に正しい確認先を足してもらいたい。
- 承認する側のユーザー（個人、またはグループの人たち）。依頼した人が不在でも承認を進めたい。自分には判断できないページや、承認できない変更を、理由を添えて返したい。
- 大人数の wiki の管理者。AI が頻繁に Change Proposal を作ると、承認が依頼した本人 1 人に集中して溜まる。

### (b) 現状
- Change Proposal に持つ人は依頼した人だけで、承認・飛ばす・破棄ができるのも依頼した人だけ。承認待ちの Change Proposal は、依頼した人以外には返さない（core の 4.6、9.2）。
- 依頼した人以外が「この変更には賛成できない」と伝える手段が無い。

### (c) どう変えたいか
- Change Proposal に承認者（複数のユーザー、複数のグループ、その混在。依頼した人自身も可）を指定できるようにする。承認者は、あとから承認者を足したり外したりできる。依頼した人も同じことができる。
- 承認者が、自分が閲覧できるページの操作を承認できる。さらに、ページごとに「却下（変更を依頼する意見）」と「レビューの放棄（このページは分からない）」を、Change Proposal 全体には「却下」を記録できる。どれにもコメントを付けられる。却下と放棄は、意見の記録と通知であり、承認や反映を止めない。
- 承認待ちを依頼した人と承認者に見せ、承認者に通知する。依頼した人には、判断の結果とコメントを通知する。
- 見る人が閲覧できないページの存在は、これまでどおり分からないままにする。

## Introduction

この文書は、`change-proposal-core` の契約を変える amend spec の要件を定める。完了後は、内容を core の requirements.md・design.md・research.md に戻し、この spec は削除する（[spec-lifecycle](../../../.claude/rules/spec-lifecycle.md)）。core に戻すときの要件の番号は、core の最後の番号（14）の続きに付け直す（既存の番号は変えない）。

### 本要件で使う言い方

core の「本要件で使う言い方」の語（Change Proposal、操作、依頼した人、閲覧できるページ、見る人、見る人に返す操作、段階、完了、達成度、後続など）をそのまま使う。このほかに次の語を使う。

- **承認者**: Change Proposal の承認待ちの操作について、判断（承認・却下・放棄）をできる人。ユーザー、またはユーザーグループとして指定される。ユーザーグループには、GROWI のユーザーグループと、外部の認証から取り込まれたグループの両方が含まれる。
- **承認者である人**: 次のどちらかを満たすユーザー。(1) 承認者としてそのユーザー自身が指定されている。(2) 承認者として指定されたグループの、操作の時点での所属者である。グループの所属者かどうかは、既存のページの閲覧範囲（グループ指定）と同じ規則で、操作の時点で判定する。
- **承認の対象**: 承認者である人が判断できる操作。その人が閲覧できるページ（リンクを知る人だけが見られるページを除く）に対する、状態が「待ち」の操作を指す。ここでの「閲覧できるページ」は、新規作成では親のページ（親がまだ無いときは、いちばん近くにある上のページ）、移動では移動元のページと移動先の親のページの両方とする。
- **承認**: 承認者である人または依頼した人が、操作を反映してよいと判断すること。承認は、承認した人が、自分が閲覧できるページの差分を見て、そのページに反映してよいと判断したことを表す。内容の正しさを保証するものではない。
- **却下**: 承認者である人が、操作または Change Proposal 全体について、「この変更には賛成できない」という意見を記録すること。記録と通知だけで、操作の状態・承認・反映は止めない。画面では、止めない意味が伝わる表示名（たとえば「変更を依頼」）にすることがある（表示名は `change-proposal-viewer` が決める）。操作ごとの却下と、Change Proposal 全体の却下がある。
- **放棄**: 承認者である人が、あるページの操作について「このページについては判断できない」と表明すること。記録と通知だけで、操作の状態は変えない。放棄した操作も、承認の対象のままである。
- **判断**: 承認・却下・放棄のこと。
- **コメント**: 却下と放棄に、入れなくてもよい文字として添えられる一言。
- **変更の目的**: 依頼した人が作成のときに書く、この Change Proposal を出す理由の説明（入れなくてもよい）。承認者にも返す。AI との会話や AI が書いた要約とは別のもので、それらは今までどおり依頼した人にしか返さない。

## Boundary Context

- **In scope**:
  - 作成のときと、その後に、承認者（ユーザー・グループ・混在・依頼した人自身）を指定すること。承認者の追加と削除。指定が無いときの既定
  - 作成のときに「変更の目的」を指定すること
  - 承認者である人と依頼した人による承認。グループが承認者のときは、所属者の誰か 1 人の承認で反映されること
  - 承認者である人による、操作ごとの却下と放棄、Change Proposal 全体の却下。コメントを添えること
  - 承認待ちを、依頼した人と承認者である人にだけ返すこと。承認者である人が承認待ちを一覧で取得すること
  - 承認者への通知と、依頼した人への判断の結果の通知。判断に関する記録（activity を含む）
  - 承認者を指定した Change Proposal を、作成の直後に自動反映しないこと。後続・見直しが承認者を引き継ぐこと
  - 反映のときの権限の確認と作者を、これまでどおり依頼した人にすること
- **Out of scope**:
  - 承認・却下・放棄・承認者の追加と削除の画面、承認待ちの一覧の画面、導線（`change-proposal-viewer` に、この spec の後で足す）
  - AI チャットで承認者を選ぶ画面と指定の道具（`change-proposal-ai-agent`。必要なら別に判断する）
  - ページのパスごとの既定の承認者（承認者を自動で決める規則）、依頼した人自身の承認を管理者の設定で禁止すること
  - 決めた人数だけを自動で割り当てる仕組み、グループの所属者全員への通知
  - 同じ Change Proposal の操作を差し替えて再レビューを頼むこと（Vault の push と一緒に別の spec で扱う）
  - 「対応中」の印、誰の番かの表示、承認待ちの期限の前の催促、依頼した人が使えないユーザーになったときの取り下げ、管理者向けの承認待ちの溜まり具合の画面
  - 全員の承認を要求する形、承認する人数の下限
  - 承認に付けるコメント（却下と放棄だけにコメントを付ける）
  - 却下の記録が、ほかの承認者の承認を止めること、却下を理由に操作の状態を変えること（却下は意見の記録だけにする）
  - 差分の塊ごとの承認
- **Adjacent expectations**:
  - 閲覧できるかどうかの判定、グループの所属の判定、読み取り専用ユーザーとゲストの扱いには、GROWI の既存の規則を使い、新しい規則は作らない。新規作成と移動の承認の対象は、core の 3.6（反映のときの権限の確認先）と 3.9（新しいページの閲覧範囲は親のページと同じ）を当てはめるもので、新しい判定の規則ではない。
  - 反映の仕組み（元のリビジョンの確認、編集中の人、権限の確認、並び順、二重書き込みの防止）は core の要件 3 のままで、本 spec は変えない。
  - 反映済みの Change Proposal の見え方（core の 9.1・9.7 など）は、承認待ちの扱いを除いて変えない。
  - **公開の順序**: 承認の画面と承認待ちの一覧（`change-proposal-viewer`）、承認者を指定する入口（`change-proposal-ai-agent`）ができるまでは、承認者の指定を受け付ける入口と、承認者への通知を使えないようにしておく。通知を受け取っても操作できない状態を作らないため。

## Requirements

### Requirement 1: 承認者と変更の目的の指定

**Objective:** 依頼した人として、Change Proposal を作るときに、承認してほしい人（ユーザーとグループ）と、変更の目的を伝えたい。承認者が、何のための変更かを分かって判断できるようにするため。

#### Acceptance Criteria
1. When 入口が Change Proposal の作成を求めるときに承認者を指定した場合, the Change Proposal System shall 指定された承認者を Change Proposal とともに保存する。
2. The Change Proposal System shall 承認者として、複数のユーザー、複数のユーザーグループ、およびその混在を受け付ける。
3. The Change Proposal System shall 依頼した人自身を、承認者として指定することを受け付ける。
4. Where 作成のときに承認者が指定されなかった場合, the Change Proposal System shall 依頼した人だけを承認者とみなす。そのため、既存の Change Proposal と、承認者を指定しない入口の振る舞いは変わらない。
5. If 指定された承認者のユーザーまたはグループが存在しない場合, then the Change Proposal System shall その Change Proposal を保存せず、受け付けない理由を返す。
6. If 指定された承認者に、同じユーザーまたは同じグループが重ねて含まれている場合, then the Change Proposal System shall 重ねた分を 1 つにまとめて保存する。
7. If 承認者の数が、決められた上限を超える場合, then the Change Proposal System shall その Change Proposal を保存せず、上限を超えたことを返す。上限の値は設計で決め、管理者の設定にはしない。
8. When 入口が Change Proposal の作成を求めるときに変更の目的を指定した場合, the Change Proposal System shall それを Change Proposal とともに保存する。
9. If 変更の目的が決まった文字数を超える場合, then the Change Proposal System shall その Change Proposal を保存せず、文字数を超えたことを返す。
10. The Change Proposal System shall 変更の目的を、書式や HTML として解釈せず、文字のまま返す。
11. When 承認者として、依頼した人以外のユーザーまたはグループが 1 つ以上含まれる Change Proposal が作られた場合, the Change Proposal System shall 自動反映の方針にかかわらず、作成の直後にどの操作も反映せず、すべてを承認待ちにする。

### Requirement 2: 承認

**Objective:** 承認者または依頼した人として、自分が閲覧できるページの操作を確かめて承認したい。依頼した人が不在でも、承認を進めるため。

#### Acceptance Criteria
1. When 承認者である人または依頼した人が、承認待ちの Change Proposal の中で 1 つ以上のページを選んで承認した場合, the Change Proposal System shall 選ばれたページに対する、その人にとっての承認の対象の操作を反映する。依頼した人にとっての承認の対象は、これまでどおり、依頼した人に返す操作のうち状態が「待ち」のものとする。
2. When 承認者である人または依頼した人が、承認待ちの Change Proposal 全体の承認を求めた場合, the Change Proposal System shall その人にとっての承認の対象の操作をすべて反映する。その人が閲覧できないページの操作は反映しない。
3. The Change Proposal System shall 依頼した人が、承認者として指定されていなくても、いつでも自分の Change Proposal を承認できるようにする。
4. Where 承認者がグループとして指定されている場合, the Change Proposal System shall そのグループの所属者の誰か 1 人が承認すれば、その操作を反映する。同じグループの別の所属者の承認を重ねて求めない。
5. When 複数の承認者である人が、同じ操作の承認や判断を同時に求めた場合, the Change Proposal System shall その操作を 1 回だけ反映し、同じ操作を二度書き込まない。後から処理された求めには、その人に見える「待ち」の操作が残っている限り、その時点の操作の状態を返す。
6. If 承認者である人が、自分が閲覧できないページの操作の判断を求めた場合, then the Change Proposal System shall それを受け付けず、そのページの操作が存在しない場合と同じ応答を返す。
7. If 承認者でもなく依頼した人でもないユーザー、または承認者であってもその人に返す操作が 1 つも無いユーザーが、承認待ちの Change Proposal の判断・承認者の追加・承認者の削除を求めた場合, then the Change Proposal System shall それを受け付けず、Change Proposal が存在しない場合と同じ応答を返す。
8. When 承認によって操作が反映された場合, the Change Proposal System shall その操作に、承認した人、日時、経路（画面・API・AI の道具などのどこから承認したか）、承認した人が依頼した人自身であるか、を記録する。
9. If 期限切れ・破棄・取り下げ・完了になった Change Proposal の承認または判断を求められた場合, then the Change Proposal System shall core の 2.10、4.7 と同じように、反映せず、反映できない状態であることを返す。
10. When 承認によって、編集中の人がいたために操作が「待ち」のまま残った場合, the Change Proposal System shall core の 4.8 と同じように、その操作を承認待ちとして扱い、承認者である人または依頼した人が後から再び承認できるようにする。
11. If すでに状態が「待ち」でない操作（反映済み、飛ばした、など）の承認または判断が求められた場合, then the Change Proposal System shall 書き込まず、その人に見える「待ち」の操作が残っている限り、その時点の操作の状態を返す。その人に見える「待ち」の操作が残っていない場合は、9 と同じ、反映できない状態であることを返す。

### Requirement 3: 却下と放棄

**Objective:** 承認者として、この変更には賛成できない、という意見を理由とともに依頼した人へ伝えたい。また、自分には判断できないページがあることを伝えたい。依頼した人や他の承認者が、次にどうするかを決められるようにするため。却下と放棄は、意見の記録と通知であり、操作の状態や承認を変えない。

#### Acceptance Criteria
1. When 承認者である人が、承認の対象の操作の却下を求めた場合, the Change Proposal System shall 却下した人・日時・コメントを、その操作についての却下の記録として残す。操作の状態は変えない。
2. When 承認者である人が、承認待ちの Change Proposal 全体の却下を求めた場合, the Change Proposal System shall 却下した人・日時・コメントを、Change Proposal 全体についての却下の記録として残す。各操作の状態は変えない。
3. When 承認者である人が、承認の対象の操作の放棄を求めた場合, the Change Proposal System shall 放棄した人・日時・コメントを、その操作についての放棄の記録として残す。操作の状態は変えない。放棄した操作は、その人にとっても、これまでどおり承認の対象である。
4. When 同じ人が、同じ操作（または全体）について、却下・放棄の記録を残したあと、あとから承認または別の判断を求めた場合, the Change Proposal System shall 前の記録を、あとの判断で置き換える。
5. When 却下または放棄を求めるときにコメントが添えられた場合, the Change Proposal System shall そのコメントを、判断の記録とともに残す。
6. If コメントが決まった文字数を超える場合, then the Change Proposal System shall 判断を記録せず、文字数を超えたことを返す。
7. The Change Proposal System shall コメントを、書式や HTML として解釈せず、文字のまま返す。
8. The Change Proposal System shall 操作ごとの却下と放棄の記録（コメントを含む）を、依頼した人と、その操作のページを閲覧できる承認者である人にだけ返す。Change Proposal 全体の却下の記録は、依頼した人にだけ返す。
9. The Change Proposal System shall 却下と放棄の記録によって、操作の状態、承認できるかどうか、反映、Change Proposal の段階、達成度を変えない。ほかの承認者または依頼した人が、却下された操作を承認した場合は、通常どおり反映する。
10. If 依頼した人が、自分の Change Proposal の操作の却下または放棄を求めた場合, then the Change Proposal System shall それを受け付けない。依頼した人は、これまでどおり「飛ばす」と「破棄」を使う。
11. If 承認者でも依頼した人でもないユーザーが、却下または放棄を求めた場合, then the Change Proposal System shall Requirement 2.7 と同じ応答を返す。

### Requirement 4: 承認者の追加と削除

**Objective:** 依頼した人または承認者として、正しいレビュー先を足したり、不要な人を外したりしたい。依頼した人が誰に頼めばよいか分からないときに、身近な人に頼み、その人が正しいレビュー先を追加できるようにするため。

#### Acceptance Criteria
1. When 依頼した人または承認者である人が、承認待ちの Change Proposal に、承認者としてユーザーまたはユーザーグループを追加した場合, the Change Proposal System shall その承認者を保存する。
2. The Change Proposal System shall 承認者を追加するときに、複数のユーザー、複数のグループ、およびその混在を受け付ける。
3. When 依頼した人または承認者である人が、承認待ちの Change Proposal から、承認者を削除した場合, the Change Proposal System shall その承認者を外す。削除できるのは、誰が追加した承認者でも、自分自身でもよい。
4. When 承認者が 1 人も残らなくなった場合, the Change Proposal System shall 依頼した人だけを承認者とみなす（Requirement 1.4 と同じ）。
5. If 追加しようとした承認者のユーザーまたはグループが存在しない場合, then the Change Proposal System shall 追加せず、受け付けない理由を返す。
6. If 追加しようとした承認者がすでに承認者として指定されている場合, then the Change Proposal System shall 何も変えずに成功として返す。
7. If 削除しようとした承認者が、承認者として指定されていない場合, then the Change Proposal System shall 何も変えずに成功として返す。
8. If 段階が承認待ちでない Change Proposal について、承認者の追加または削除を求められた場合, then the Change Proposal System shall 変えず、変えられない状態であることを返す。
9. If 追加したあとの承認者の数が、Requirement 1.7 の上限を超える場合, then the Change Proposal System shall 追加せず、上限を超えたことを返す。
10. When 承認者が追加または削除された場合, the Change Proposal System shall 追加または削除した人と日時を、承認者ごとに記録する。
11. When 承認者が追加された場合, the Change Proposal System shall Requirement 6 の通知を、新しく承認者である人になったユーザーに送る。追加によって、追加された人が閲覧できないページの存在は分からない。
12. When 承認者が削除された場合, the Change Proposal System shall すでに記録された、その人の承認・却下・放棄の記録を変えない。

### Requirement 5: 承認待ちの見え方

**Objective:** 承認者として、自分に承認が頼まれている Change Proposal を、見つけて確かめたい。見つけられないと、承認が溜まってしまうため。

#### Acceptance Criteria
1. When 依頼した人または承認者である人が、承認待ちの Change Proposal の取得を求めた場合, the Change Proposal System shall 依頼した人・入口の種類・モデル名・作成日時・全体の状態・変更の目的と、見る人が閲覧できるページに対する操作だけを、操作ごとの状態とともに返す。
2. When 承認者である人が、承認待ちの Change Proposal の取得を求めた場合, the Change Proposal System shall 承認の対象の操作について、変更後の本文（差分を作るための内容）、元のリビジョン、その元のリビジョンが今も最新かどうか、並び順を返す。
3. The Change Proposal System shall 依頼した人でも承認者である人でもない見る人には、承認待ちの Change Proposal を返さない。
4. If 承認者である人が、承認待ちの Change Proposal を取得しようとしたときに、その人に返す操作が 1 つも無い場合, then the Change Proposal System shall Change Proposal が存在しない場合と同じ「見つからない」応答を返す。
5. When 見る人が、自分が承認者である承認待ちの Change Proposal の一覧を求めた場合, the Change Proposal System shall その人にとっての承認の対象の操作を 1 つ以上含む承認待ちの Change Proposal を、作成が古い順（期限は作成時に決まるので、期限が近い順と同じになる）に、ページ送りできる形で返す。
6. The Change Proposal System shall 承認者である人に返す操作を、その人が閲覧できるページ（リンクを知る人だけが見られるページを除く）に対する操作だけにする。閲覧できない操作の件数や、閲覧できない操作があることを示す情報を含めない。
7. The Change Proposal System shall 承認者である人への応答に、承認者の一覧（ユーザーの名前とグループの名前）、承認・却下・放棄した人、承認者を追加・削除した人を含める。ただし、見る人が見られないページの存在を示す情報は含めない。
8. The Change Proposal System shall 依頼した人にだけ返している内容（段階と達成度、ページごとの通知の指定、AI が書いた要約や会話、入口が用意する本人向けの内容など）を、承認者である人には返さない。変更の目的は、承認者である人にも返す。
9. While 承認者である人が、承認者としての指定をグループの所属によって得ている場合, the Change Proposal System shall 所属が外れたあとは、その人を承認者である人として扱わない。
10. The Change Proposal System shall 反映済みの Change Proposal の取得と一覧の振る舞い（core の 9.1・9.7 など）を、この Requirement によって変えない。

### Requirement 6: 通知と記録

**Objective:** 承認者として、自分に承認が頼まれたことに気付きたい。依頼した人として、承認者の判断の結果とコメントを知りたい。判断の結果が届かないと、依頼した人は次の手を打てないため。

#### Acceptance Criteria
1. When 承認者が指定された Change Proposal が承認待ちとして作られた場合、または承認者が追加された場合, the Change Proposal System shall 新しく承認者である人になった個人のユーザーに、アプリ内通知を送る。
2. The Change Proposal System shall 承認者として指定されたグループの所属者には、個別の通知を送らない。グループの所属者は、承認待ちの一覧（Requirement 5.5）で見つける。
3. The Change Proposal System shall 承認者への通知の中身を、受け取るユーザーが閲覧できるページの分だけで作り、閲覧できないページのパス・タイトル・件数を含めない。
4. If 通知を受け取るはずのユーザーが、承認の対象の操作を 1 つも持たない場合, then the Change Proposal System shall そのユーザーにはその通知を送らない。
5. When 承認者である人が、承認・却下・放棄を求め、その求めが受け付けられた場合, the Change Proposal System shall 1 回の求めにつき 1 件のアプリ内通知を、依頼した人に送る。中身は、判断した人、各操作の結果、添えられたコメント、Change Proposal の詳細ページへのリンクにする。
6. The Change Proposal System shall 依頼した人自身が行った承認については、依頼した人に通知を送らない。
7. The Change Proposal System shall 反映のあとのまとめたアプリ内通知（core の 7.2・7.8）の宛先と中身を、この Requirement によって変えない。
8. When 承認・却下・放棄が行われた場合, the Change Proposal System shall それを新しい種類の activity として、判断した人を操作者として、経路（画面・API・AI の道具のどこから求めたか）とともに、監査ログの設定にかかわらず記録する。
9. When 承認によって操作が反映された場合, the Change Proposal System shall 承認した人を、承認の activity（6.8）と、操作に残る記録（承認した人・経路・日時）に残す。反映の activity の記録は変えない（1 回の反映が、複数の人の承認をまとめて書くことがあるため）。
10. When 承認者が追加または削除された場合, the Change Proposal System shall それを新しい種類の activity として、追加または削除した人を操作者として、経路とともに、監査ログの設定にかかわらず記録する。誰を追加・削除したかは、Change Proposal の中の記録（4.10）で分かる。作成のときの承認者の指定は、作成の activity（core の 7.7）に含まれ、別には記録しない。

### Requirement 7: 反映のときの権限と作者

**Objective:** 管理者として、承認者に指定されたことで、書き込める範囲が増えないようにしたい。承認の仕組みが権限の抜け道にならないようにするため。

#### Acceptance Criteria
1. When 承認者である人の承認によって操作を反映する場合, the Change Proposal System shall 書き込む権限を、core の 3.6 と同じように、依頼した人についてその時点で確かめる。
2. When 承認者である人の承認によって操作を反映する場合, the Change Proposal System shall 作るリビジョンとページの作者を、core の 3.10 と同じように依頼した人にする。
3. If 反映しようとした時点で、依頼した人が対象のページに書き込む権限を持たない場合、または依頼した人が読み取り専用ユーザーや使えないユーザーになっている場合, then the Change Proposal System shall core の 3.6 と同じように、その操作を書き込まずに「失敗」にする。承認者である人の権限では書き込まない。
4. The Change Proposal System shall 承認者として指定されたことを、ページを閲覧する権限・編集する権限・管理者の設定のどれにも影響させない。
5. If 読み取り専用ユーザーまたはゲストが、承認・判断・承認者の追加と削除を求めた場合, then the Change Proposal System shall core の 9.9 と同じように、それを受け付けない。
6. The Change Proposal System shall 承認による反映に、core の要件 3（元のリビジョンの確認、編集中の人、並び順、二重書き込みの防止、人の保存との競合）をそのまま適用する。
7. When 管理者が書き込み機能を無効にした場合, the Change Proposal System shall core の 8.5 と同じように、承認者が指定された Change Proposal を含めて、承認待ちの Change Proposal をすべて取り下げる。

### Requirement 8: 既存の動きの維持、後続・見直しとの関係、表示名

**Objective:** 管理者と依頼した人として、承認者を指定しない使い方と、すでにある Change Proposal がこれまでどおり動いてほしい。また、承認者がいる Change Proposal を直して出し直しても、承認者が外れないでほしい。

#### Acceptance Criteria
1. The Change Proposal System shall 承認者を指定していない Change Proposal（作成のときに指定されなかったものと、この変更の前に作られたもの）では、依頼した人だけが承認・飛ばす・破棄でき、承認待ちは依頼した人にだけ返す。
2. The Change Proposal System shall 自動反映の方針（「しない」「自分が作ったページだけ」「すべて」）の意味を変えない。「自分が作ったページだけ」の「自分」は、依頼した人を指す。
3. The Change Proposal System shall ページごとの通知の指定の変更を、これまでどおり依頼した人だけに許す。
4. When 依頼した人が、承認者が指定された Change Proposal を元にして後続または見直しの Change Proposal を作った場合, the Change Proposal System shall 元の Change Proposal の、その時点の承認者を引き継いで保存する。依頼した人は、作成のときに承認者を指定し直すこともできる。
5. Where 後続または見直しの Change Proposal の承認者に、依頼した人以外が含まれる場合, the Change Proposal System shall Requirement 1.11 と同じように、作成の直後にどの操作も反映せず、すべてを承認待ちにする。
6. The Change Proposal System shall 承認者の指定のない入口（取り消しの Change Proposal を含む）の振る舞いを、この変更によって変えない。
7. The Change Proposal System shall 承認者、承認、却下、放棄、コメント、変更の目的についての新しい表示名と、承認者に関する新しい activity の名前を、GROWI が対応する 5 言語（英語・日本語・中国語・フランス語・韓国語）すべてで表示する。

## 既存の core の要件との関係

この spec が core に戻るとき、次のように扱う（core の本文は、変更がもとからなかったものとして書き換える）。

| core の要件 | この spec での扱い |
|---|---|
| 1（作成） | Requirement 1 を、作成の要件として追加する（承認者、変更の目的、承認者を指定したときの自動反映の扱い） |
| 2.1（操作の状態 7 つ） | 変えない（却下・放棄は状態を変えない。Requirement 3.9）。2.3（飛ばす）・2.4（破棄）は依頼した人だけのまま（Requirement 3.10） |
| 4.4、4.5（承認） | 「依頼した人」に加えて「承認者である人」が承認できる（Requirement 2.1、2.2） |
| 4.6（本人以外の拒否） | 「依頼した人以外」を「依頼した人でも承認者である人でもない」に直す（Requirement 2.7） |
| 7（通知） | 7.2・7.8 は変えない。承認者への通知と、依頼した人への判断の結果の通知は新しい要件として追加する（Requirement 6）。7.15 は変えない（Requirement 8.3） |
| 9.2、9.3、9.4 | 承認待ちを承認者である人にも返す（Requirement 5）。見える操作の絞り込みと「見つからない」の扱いは同じ規則 |
| 9.9（読み取り専用ユーザー） | 承認・判断・承認者の追加と削除にも適用する（Requirement 7.5） |
| 13.4（見直し）、13.7（後続） | 後続・見直しは承認者を引き継ぎ、承認者に依頼した人以外が含まれるときは自動反映しない（Requirement 8.4、8.5）。13.4（見直しは依頼した人の承認待ち）は、「承認者の承認待ち」に読み替える |
| 11（共通の表示名） | 判断、コメントなどの表示名を 5 言語で足す（Requirement 8.7） |

## 確認したいこと（決まっていないこと）

依頼の答えに無かった点を、次の既定で置いた。承認の前に確認する。

1. **コメントの見える範囲（Requirement 3.8）。** 操作ごとのコメントは依頼した人と、そのページを閲覧できる承認者である人だけ。全体の却下の記録（コメントを含む）は依頼した人だけ。コメントの文面にページ名を書かれたとき、見られない人に漏れないようにするため。
2. **承認にはコメントを付けない（Out of scope）。** 却下と放棄にだけ付ける。
3. **承認者の数の上限（Requirement 1.7）の値。** 設計で決める。
4. **公開の順序。** 承認の画面と承認待ちの一覧（viewer）、承認者を指定する入口（ai-agent）が使えるまで、承認者の指定の入口と通知を出さない。この順序を守る方法（機能の切り替え、spec のマージ順など）は、設計の段階で決める。

### 決まったこと（参考）
- **却下は、反映を止めない（オーナー決定）。** 却下は意見の記録と通知だけで、操作の状態も承認も変えない。画面の表示名は、止めない意味が伝わる語（「変更を依頼」など）にする案（`change-proposal-viewer` の spec で決める）。
- **却下は、段階を変えない。** 却下しても、Change Proposal は自動で完了にならない。依頼した人が、操作を「飛ばす」か Change Proposal を破棄するまで残り、放置されると期限切れになる。
