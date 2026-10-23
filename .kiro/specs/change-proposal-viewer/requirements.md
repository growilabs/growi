# Requirements Document

## Project Description (Input)

AI や外部の仕組みが Change Proposal で多くのページを書き換えたとき、依頼した本人以外には、それが 1 つのまとまった変更だと分からない（詳細は [brief.md](./brief.md)、umbrella の判断は [../change-proposal/roadmap.md](../change-proposal/roadmap.md) と [../change-proposal/research.md](../change-proposal/research.md)）。

### (a) 誰が困っているか
- 同じ wiki を使う他のユーザー。AI などがまとめて書き換えた変更に気付いても、それが 1 つのまとまりだと分からず、「全部戻してほしい」と判断することも、実際に戻すこともできない。
- 依頼した本人。自分が頼んだ変更が、どのページにどう反映されたかを後から 1 か所で確かめられない。

### (b) 現状
- Recent Changes とページ履歴では、Change Proposal で作られた更新も、同じ人の別々の更新として並ぶだけで、見分けられない。
- ページ履歴に、古い版に戻す操作は無い。
- `change-proposal-core` は、Change Proposal の取得・一覧・取り消しの API と、どのリビジョンがどの Change Proposal で作られたかの記録、受け取る人ごとに中身を絞ったアプリ内通知のデータを用意する。しかし、それを表示する画面は無い。

### (c) どう変えたいか
- 反映済みの Change Proposal を、他のユーザーも 1 つの単位として認識できるようにする。
- 1 ページを読んでいる人が、同じ Change Proposal で変わった他のページに気付けるようにする。
- 他のユーザーが、自分が見られるページの分の操作を戻せるようにし、全部は戻せないときは本人に戻すよう頼めるようにする。
- これらの画面から、見る人が閲覧できないページの存在が分からないようにする。

## Introduction

この文書は、反映された Change Proposal を画面に表示する部分の要件を定める。対象は、詳細ページ、Change Proposal の一覧、ページ履歴・Recent Changes・ページの作者表示に付ける印、画面からの取り消し、「本人に戻すよう頼む」通知、まとめたアプリ内通知の表示である。データ・判定・取り消しの実行は `change-proposal-core` が持ち、本 spec はその結果を表示する。

### 本要件で使う言い方

`change-proposal-core` の要件の「本要件で使う言い方」と同じ語を使う（Change Proposal、操作、編集・新規作成・移動、元のリビジョン、依頼した人、入口、反映、取り消し、見る人、閲覧できるページ、操作の 7 つの状態）。本 spec で足す言い方は次のとおり。

- **詳細ページ**: 1 件の Change Proposal の中身を表示する画面。
- **見える操作**: `change-proposal-core` が、見る人に返した操作。見る人が閲覧できるページに対する操作だけが返る。依頼した人以外には、リンクを知る人だけが見られるページの操作は返らない。また依頼した人以外には、状態が「反映済み」「取り消し済み」「取り消しを断られた」のどれかである操作だけが返り、「待ち」「失敗」「古い」「飛ばした」の操作は返らない。そのため依頼した人以外には、全体の状態が「承認待ち」や「一部だけ反映」と表示されることは無い。
- **戻せるかどうかの判定**: 反映済みの操作について、その時点で取り消せるかどうかと、取り消せない理由。`change-proposal-core` が見る人ごとに決めて返す。本 spec は判定しない。
- **印**: 既存の画面の行や作者の表示の横に付ける小さな表示。「Change Proposal で作られた」ことを表す印と、「取り消しで作られた」ことを表す印の 2 種類がある。印は詳細ページへのリンクを兼ねる。
- **今の版**: ページの最新のリビジョン。古い版を表示している間も、ページの最新のリビジョンを指す。
- **頼む通知**: 依頼した人以外のユーザーが、依頼した人に「この Change Proposal を戻してほしい」と知らせるアプリ内通知。一言を添えられる。
- **まとめた通知**: `change-proposal-core` が、反映または取り消しが終わったときに、Change Proposal ごとに 1 件だけ作るアプリ内通知。中身は受け取る人が閲覧できるページの分だけで作られている。

## Boundary Context

- **In scope**:
  - 詳細ページと、Change Proposal の一覧（自分が依頼したもの、自分が見られるページを含む反映済みのもの）
  - ページ履歴・Recent Changes・ページの作者表示への印
  - 詳細ページの「戻せるものを全部戻す」ボタンと、その結果の表示
  - 頼む通知の送信と、その通知の表示
  - まとめた通知の表示
  - 新しく足す文言の 5 言語（英語・日本語・中国語・フランス語・韓国語）の翻訳
- **Out of scope**:
  - 戻せるかどうかの判定、取り消しの実行、見る人ごとの絞り込みの判定、まとめた通知の中身を作ること（`change-proposal-core`）
  - 操作の種類・操作の状態・全体の状態・理由・戻せない理由を表す言葉とその 5 言語の翻訳、差分の表示の設定と見た目（`change-proposal-core` が画面の共通の部品として用意し、本 spec はそれを使う）
  - チャット画面での Change Proposal の表示・承認・作り直し、AI が書いた要約と会話の保存（`change-proposal-ai-agent`）
  - 承認待ちの Change Proposal の承認・飛ばす・破棄の操作（詳細ページには置かない）
  - Recent Changes を Change Proposal 単位でまとめ直すこと
  - 承認待ちの Change Proposal を本人以外に見せること
  - Change Proposal へのコメントや話し合い
  - ページ履歴の一般的な「この版に戻す」ボタン
- **Adjacent expectations**:
  - `change-proposal-core` は、見る人ごとに絞った Change Proposal の中身、戻せるかどうかの判定、リビジョンの印、受け取る人ごとのまとめた通知を、本 spec が使う前に用意している。本 spec はその結果をそのまま表示し、絞り込みや判定をやり直さない。
  - `change-proposal-core` のまとめた通知は、本 spec の通知の表示と同じ版で出す。片方だけが出ると、未読の印だけが出て、開いても何も表示されない通知が生まれる。
  - AI が書いた要約と会話は `change-proposal-ai-agent` が保存し、本人にだけ返す。本 spec は、依頼した人が見るときにだけ、その内容を表示する場所を詳細ページに用意する。
  - 閲覧できるかどうかの判定には、GROWI の既存の閲覧の判定を使う。本 spec は新しい判定の規則を作らない。

## Requirements

### Requirement 1: 詳細ページ

**Objective:** 反映された変更に気付いたユーザーとして、Change Proposal を 1 つのまとまりとして確かめたい。誰が、どこから、いつ、何を変えたかを 1 か所で知るため。

#### Acceptance Criteria
1. When 見る人が詳細ページを開いた場合, the Change Proposal Viewer shall 依頼した人、入口、モデル名（記録されている場合）、作成日時、反映日時、全体の状態を表示する。
2. The Change Proposal Viewer shall 入口を「AI チャット」「Vault」「MCP」「取り消し」のいずれかの言葉で表示する。
3. If 指定された Change Proposal が存在しない場合、または見る人が依頼した人でなく、見える操作が 1 つも無い場合（`change-proposal-core` が「見つからない」を返す場合）, then the Change Proposal Viewer shall どの場合も同じ「見つからない」表示にする。
4. The Change Proposal Viewer shall 詳細ページに、操作の件数（見える操作の件数も、全体の件数も）と、見えない操作がほかにあることを示す表示を出さない。
5. When 依頼した人以外が詳細ページを開いた場合, the Change Proposal Viewer shall 反映日時として、見える操作のうちいちばん新しい反映日時（`change-proposal-core` が見る人ごとに決めて返す値）を表示する。
6. Where Change Proposal の入口が「取り消し」である場合, the Change Proposal Viewer shall 取り消した元の Change Proposal の詳細ページへのリンクを表示する。
7. Where 見る人が依頼した人で、入口の spec が本人向けの内容（AI が書いた要約や会話など）を用意している場合, the Change Proposal Viewer shall その内容を詳細ページに表示する。
8. If 見る人が依頼した人でない場合, then the Change Proposal Viewer shall 本人向けの内容を表示せず、本人向けの内容があるかどうかも表示しない。
9. If ログインしていない人が詳細ページを開いた場合, then the Change Proposal Viewer shall 詳細ページを表示せず、ログインを求める。

### Requirement 2: 操作ごとの表示

**Objective:** 詳細ページを見るユーザーとして、操作ごとに、どのページがどう変わり、いまどうなっているかを知りたい。戻すかどうかを判断するため。

#### Acceptance Criteria
1. The Change Proposal Viewer shall 見える操作ごとに、操作の種類（編集・新規作成・移動・ごみ箱へ移す・ごみ箱から戻す）、対象のページのパス、操作の状態を表示する。
2. When 見る人が反映でリビジョンが作られた編集の操作の差分を開いた場合, the Change Proposal Viewer shall 元のリビジョンと反映で作られたリビジョンの差分を、ページ履歴の差分と同じ見た目で表示する。
3. When 見る人が反映でページが作られた新規作成の操作の差分を開いた場合, the Change Proposal Viewer shall 空の本文と作られたリビジョンの差分を、ページ履歴の差分と同じ見た目で表示する。
4. The Change Proposal Viewer shall 移動の操作について、移動元のパスと移動先のパスを表示する。
5. The Change Proposal Viewer shall パスを常に wiki のページのパスで表示し、Vault がファイル名に付ける接尾辞（`__hash8` や `_orphaned/` など）を表示しない。
6. When 操作の状態が「待ち」「失敗」「古い」「飛ばした」「取り消しを断られた」のいずれかである場合, the Change Proposal Viewer shall その理由を言葉で表示する。
7. When 操作が反映済みまたは取り消しを断られた状態である場合, the Change Proposal Viewer shall `change-proposal-core` が返した戻せるかどうかの判定を、「戻せる」または戻せない理由（他の人が編集したため戻せない、など）の言葉で表示する。
8. The Change Proposal Viewer shall 戻せるかどうかを自分では判定せず、`change-proposal-core` が返した判定だけを表示する。
9. When 操作が取り消し済みである場合, the Change Proposal Viewer shall その操作を取り消した Change Proposal の詳細ページへのリンクを表示する。
10. If 見る人が依頼した人でない場合, then the Change Proposal Viewer shall 操作の並び順の番号を表示しない。
11. If ある操作の差分を取得できなかった場合, then the Change Proposal Viewer shall その操作の差分の部分にだけ「表示できない」と表示し、他の操作と詳細ページの表示を続ける。
12. While 操作がまだ反映されていない場合（依頼した人にだけ返る操作）, the Change Proposal Viewer shall 状態と理由だけを表示し、差分と承認の操作を表示しない。

### Requirement 3: 画面からの取り消し

**Objective:** 依頼した人と、反映された変更に気付いた他のユーザーとして、自分が見られるページの分の操作を、1 回の操作で戻したい。1 ページずつ手で直さずに済ませるため。

#### Acceptance Criteria
1. Where 「戻せる」と判定された見える操作が 1 つ以上あり、見る人がログインしていて読み取り専用ユーザーでない場合, the Change Proposal Viewer shall 「戻せるものを全部戻す」ボタンを表示する。
2. When 見る人が「戻せるものを全部戻す」ボタンを押した場合, the Change Proposal Viewer shall 戻す対象のページのパスを並べて確認を求め、見る人が確定したときだけ取り消しを求める。
3. The Change Proposal Viewer shall 取り消しの対象を、ボタンを押した時点で「戻せる」と表示されていた操作だけにする。
4. When 取り消しの結果が返った場合, the Change Proposal Viewer shall 対象にした操作ごとに、取り消したこと、断られた理由、または編集中の人がいたために見送ったことを表示し、詳細ページの表示を新しい状態に更新する。
5. When 取り消しの結果が返った場合, the Change Proposal Viewer shall Recent Changes とページの作者表示の印を、新しい状態で表示し直す。
6. If 取り消しを求めたときに通信に失敗した場合、または「見つからない」が返った場合, then the Change Proposal Viewer shall 詳細ページの表示を変えずに、取り消せなかったことを表示する。
7. If 見る人が読み取り専用ユーザーである場合、またはログインしていない場合, then the Change Proposal Viewer shall 「戻せるものを全部戻す」ボタンを表示しない。
8. The Change Proposal Viewer shall 見えない操作がほかにあることを理由に、ボタンを隠したり取り消しを止めたりしない。

### Requirement 4: 本人に戻すよう頼む

**Objective:** 依頼した人以外のユーザーとして、自分では戻しきれない変更を、依頼した人に戻すよう頼みたい。自分が見られないページの分も含めて、本人に全体を戻してもらうため。

#### Acceptance Criteria
1. Where 見る人が依頼した人ではなく、ログインしていて読み取り専用ユーザーでない場合, the Change Proposal Viewer shall 詳細ページに「本人に戻すよう頼む」操作を、操作の状態や戻せるかどうかにかかわらず表示する。
2. When 見る人が「本人に戻すよう頼む」を送った場合, the Change Proposal Viewer shall 一言（入れなくてもよい）を添えた頼む通知を、依頼した人に 1 件送る。
3. If 一言が決まった文字数を超える場合, then the Change Proposal Viewer shall 頼む通知を送らず、文字数を超えていることを表示する。
4. If 同じ人が同じ Change Proposal について、決まった時間の中ですでに頼む通知を送っている場合, then the Change Proposal Viewer shall 新しい頼む通知を送らず、すでに送ったことを表示する。
5. If 送ろうとした人が依頼した人自身である場合, then the Change Proposal Viewer shall 頼む通知を送らない。
6. If 送ろうとした人が、その Change Proposal の詳細ページを見られない場合（要件 1.3 で「見つからない」になる場合）, then the Change Proposal Viewer shall 頼む通知を送らず、Change Proposal が存在しない場合と同じ応答を返す。
7. If 依頼した人がすでに有効なユーザーでない場合, then the Change Proposal Viewer shall 頼む通知を送らず、送れないことを表示する。
8. The Change Proposal Viewer shall 頼む通知を送るかどうかと応答の内容を、送る人が見られない操作の状態によって変えない。
9. The Change Proposal Viewer shall 頼む通知の中身を、送った人、添えた一言、Change Proposal の詳細ページへのリンクだけにする。
10. When 頼む通知を送った場合, the Change Proposal Viewer shall 監査ログの設定にかかわらず、送った人を操作者とする新しい種類の activity を記録する。
11. If 読み取り専用ユーザーまたはログインしていない人が頼む通知を送ろうとした場合, then the Change Proposal Viewer shall それを受け付けない。

### Requirement 5: ページ履歴の印

**Objective:** ページ履歴を見るユーザーとして、どの版が Change Proposal で作られたかを見分けたい。同じ Change Proposal で変わった他のページに気付き、詳細を確かめるため。

#### Acceptance Criteria
1. When ページ履歴を表示した場合, the Change Proposal Viewer shall Change Proposal で作られたリビジョンの行に、「Change Proposal で作られた」印と、その詳細ページへのリンクを表示する。
2. When ページ履歴を表示した場合, the Change Proposal Viewer shall 取り消しで作られたリビジョンの行に、「取り消し」の印と、その取り消しの Change Proposal の詳細ページへのリンクを表示する。
3. The Change Proposal Viewer shall 印を、`change-proposal-core` が見る人に返したリビジョンの印の分だけ表示し、それ以外のリビジョンには付けない。
4. When ページ履歴の続きを読み込んだ場合, the Change Proposal Viewer shall 読み込んだリビジョンにも同じように印を付ける。
5. If 印の取得に失敗した場合、または時間がかかっている場合, then the Change Proposal Viewer shall ページ履歴の表示と操作を止めずに、印だけを表示しない。

### Requirement 6: Recent Changes の印と一覧への入口

**Objective:** Recent Changes を見るユーザーとして、どのページが Change Proposal で更新されたかを一覧の中で見分けたい。まとめて書き換えられたことに気付くため。

#### Acceptance Criteria
1. When Recent Changes を表示した場合, the Change Proposal Viewer shall 今の版が Change Proposal で作られたページの行に「Change Proposal で作られた」印を、今の版が取り消しで作られたページの行に「取り消し」の印を、それぞれ詳細ページへのリンクとして表示する。
2. The Change Proposal Viewer shall 印を、見る人が実際に閲覧できるページの行にだけ付け、一覧の表示の方針によってタイトルだけが表示されている行には付けない。
3. When 人がページを保存して今の版が人の保存で作られたものになった場合, the Change Proposal Viewer shall そのページの行の印を表示しない。
4. The Change Proposal Viewer shall Recent Changes の一覧の並び順、表示する行、続きの読み込みの振る舞いを変えない。
5. The Change Proposal Viewer shall 印を調べ終わるのを待たずに一覧の行を表示し、印は調べ終わった行から後で付ける。
6. If 印の取得に失敗した場合, then the Change Proposal Viewer shall 一覧の行をそのまま表示し、印だけを表示しない。
7. Where 書き込み機能が管理者によって有効にされている場合, the Change Proposal Viewer shall Recent Changes から Change Proposal の一覧へ移るリンクを表示する。

### Requirement 7: ページの作者表示の印

**Objective:** ページを読んでいるユーザーとして、いま読んでいる内容が Change Proposal で書かれたものかを知りたい。同じ Change Proposal で変わった他のページに気付くため。

#### Acceptance Criteria
1. When ページを表示し、今の版が Change Proposal で作られたものである場合, the Change Proposal Viewer shall ページの最後に更新した人の表示の横に「Change Proposal で作られた」印を、詳細ページへのリンクとして表示する。
2. When ページを表示し、今の版が取り消しで作られたものである場合, the Change Proposal Viewer shall 最後に更新した人の表示の横に「取り消し」の印を、その取り消しの Change Proposal の詳細ページへのリンクとして表示する。
3. While 見る人がページの古い版を表示している場合, the Change Proposal Viewer shall 表示している版ではなく今の版にもとづいて印を決める。
4. The Change Proposal Viewer shall 印を調べ終わるのを待たずにページの本文を表示し、印の取得に失敗したときは印だけを表示しない。

### Requirement 8: Change Proposal の一覧

**Objective:** ユーザーとして、自分が依頼した Change Proposal と、自分が見られるページを含む反映済みの Change Proposal を一覧で見たい。過去のまとまった変更を後から探して確かめるため。

#### Acceptance Criteria
1. When 見る人が自分の Change Proposal の一覧を開いた場合, the Change Proposal Viewer shall 自分が依頼した Change Proposal を新しい順に表示し、続きを読み込めるようにする。
2. When 見る人が反映済みの Change Proposal の一覧を開いた場合, the Change Proposal Viewer shall 見る人が閲覧できるページを含む反映済みの Change Proposal を新しい順に表示し、続きを読み込めるようにする。
3. The Change Proposal Viewer shall 一覧の各項目に、依頼した人、入口、モデル名（記録されている場合）、日時、全体の状態、見る人が見られるページのパスを表示し、詳細ページへのリンクにする。
4. The Change Proposal Viewer shall 一覧に、全体の件数、ページ数、各項目の操作の件数を表示しない。
5. When 続きを読み込んで表示できる項目が 1 件も無かったが、さらに続きがある場合, the Change Proposal Viewer shall 「これ以上無い」とは表示せず、続きを読み込めるようにする。
6. If 一覧の取得に失敗した場合, then the Change Proposal Viewer shall それまでに表示した項目を残したまま、取得できなかったことを表示する。
7. If ログインしていない人が一覧を開いた場合, then the Change Proposal Viewer shall 一覧を表示せず、ログインを求める。

### Requirement 9: アプリ内通知の表示

**Objective:** 通知を受け取るユーザーとして、まとめて書き換えられたことや、取り消しを頼まれたことを、1 件の分かりやすい通知で知りたい。詳細ページへすぐ移って確かめるため。

#### Acceptance Criteria
1. When まとめた通知が反映についてのものである場合, the Change Proposal Viewer shall 依頼した人と、通知の中身にあるページのパスを表示し、その Change Proposal の詳細ページへのリンクにする。
2. When まとめた通知が取り消しについてのものである場合, the Change Proposal Viewer shall 取り消した人と、通知の中身にあるページのパスを表示し、その取り消しの Change Proposal の詳細ページへのリンクにする。
3. When 頼む通知を表示する場合, the Change Proposal Viewer shall 送った人と添えられた一言を表示し、その Change Proposal の詳細ページへのリンクにする。
4. The Change Proposal Viewer shall 添えられた一言を、書式や HTML として解釈せず、文字のまま表示する。
5. The Change Proposal Viewer shall 通知に、通知の中身にあるページ以外のページのパスと、操作やページの件数を表示しない。
6. If 通知の中身を読み取れない場合, then the Change Proposal Viewer shall その通知だけを表示せず、ほかの通知の一覧の表示を続ける。
7. When 受け取った人が通知を開いた場合, the Change Proposal Viewer shall 既存の通知と同じように既読にする。
8. The Change Proposal Viewer shall サイドバーの通知、通知の一覧ページ、管理画面のどこでも、通知の文言を受け取った人の言語で表示する。

### Requirement 10: 全体にかかわる約束

**Objective:** wiki を使うすべてのユーザーとして、Change Proposal の画面から、自分が閲覧できないページの存在を知らされたくない。また、自分の言語で画面を使いたい。

#### Acceptance Criteria
1. The Change Proposal Viewer shall 本 spec で足す画面・印・通知・エラーのどこにも、見る人が閲覧できないページのパス、タイトル、件数、「ほかにある」こと、存在しない場合との違いを表示しない。
2. If ログインしていない人、または共有リンクでページを見ている人がページ履歴・Recent Changes・ページを表示した場合, then the Change Proposal Viewer shall 印を表示せず、印のための問い合わせもしない。
3. Where 見る人が読み取り専用ユーザーである場合, the Change Proposal Viewer shall 詳細ページ・一覧・印は表示し、取り消しと頼む通知の操作は表示しない。
4. The Change Proposal Viewer shall 新しく足す文言を、GROWI が対応する 5 言語（英語・日本語・中国語・フランス語・韓国語）すべてで表示する。
5. The Change Proposal Viewer shall 入口の種類（AI チャット・Vault・MCP・取り消し）によって、詳細ページ・一覧・印・通知の振る舞いを変えない（本人向けの内容の有無を除く）。
