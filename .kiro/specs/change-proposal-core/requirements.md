# Requirements Document

## Project Description (Input)

GROWI には、AI や外部の仕組みが複数のページをまとめて書き換えるための、安全な書き込みの仕組みが無い（詳細は [brief.md](./brief.md)、umbrella の判断は [../change-proposal/roadmap.md](../change-proposal/roadmap.md) と [../change-proposal/research.md](../change-proposal/research.md)）。

### (a) 誰が困っているか
- AI チャットなどに、複数のページの編集・新規作成・移動を任せたいユーザー。今は AI が案を出しても、自分で 1 ページずつ書き換えるしかない。
- 同じ wiki を使う他のユーザー。外から書き込まれると、自分の保存や共同編集中の入力が上書きされたり消えたりするおそれがある。
- 管理者。AI からの書き込みを許すかどうか、どこまで自動で反映するかを決める手段が無い。

### (b) 現状
- 書き込みは、エディタの保存、ページの作成・更新・移動の API、外部の `@growi/mcp-server`（API トークンで REST を呼ぶ）だけで、どれも人が 1 ページずつ保存することを前提にしている。
- 上書き防止の確認・activity・通知・共同編集（yjs）の同期は API の処理（route）の中にあり、他の処理から呼び出せない。確認と書き込みが別々なので、外からの書き込みは人の保存とぶつかる。REST で保存すると共同編集中の文書が置き換わり、共同編集者の未保存の入力が消える。
- 複数ページへの変更を 1 つにまとめて記録する仕組みも、まとめて戻す仕組みも無い。activity は同じ人の 5 分以内の更新を 1 つにまとめ、30 日で消えるため、その代わりにならない。

### (c) どう変えたいか
- 複数ページへの操作（編集・新規作成・移動）を 1 つにまとめた Change Proposal を保存し、LLM を使わずにサーバー側で反映できるようにする。反映は人の保存とぶつからず、共同編集中の人の入力を消さず、権限をその時点で確かめる。
- 管理者の設定に応じて、自動で反映するか、依頼した本人がページ単位で承認してから反映する。
- 反映した Change Proposal を取り消せるようにし、どのリビジョンがどの Change Proposal で作られたかを、消えない記録として残す。新規作成で作ったページは、その最初のリビジョンの記録から分かる。

## Introduction

この文書は、Change Proposal の土台となる部分（データ、状態の移り変わり、サーバー側での反映と取り消し、承認と自動反映、記録、通知、管理者の設定、API）の要件を定める。Change Proposal を作る側（AI チャットなどの入口）と、反映後の画面（詳細ページ、ページ履歴や Recent Changes の印）は、それぞれ兄弟の spec `change-proposal-ai-agent` と `change-proposal-viewer` が持つ。本 spec はそれらが使う API とデータを提供する。

### 本要件で使う言い方

- **Change Proposal**: 複数のページへの操作を、並び順つきでまとめたもの。1 件ごとに ID を持つ。
- **操作**: Change Proposal に含まれる 1 つの変更。種類は「編集」「新規作成」「移動」の 3 つで、削除は無い。
  - **編集**: 既存のページの本文を、変更後の本文全体で置き換える。
  - **新規作成**: 指定したパスに新しいページを作る。
  - **移動**: ページを別のパスへ移す。
- **元のリビジョン**: 編集の操作が前提にしている、そのページのリビジョン。編集の操作は「ページの最新のリビジョンが、まだ元のリビジョンのままであること」を条件に書き込む。
- **依頼した人**: Change Proposal を作るように頼んだユーザー。反映で作られるリビジョンとページの作者になる。
- **入口**: Change Proposal がどこから来たか。「AI チャット」「Vault」「MCP」「取り消し」のいずれか。
- **反映**: 操作を実際のページとリビジョンに書き込むこと。
- **取り消し**: 反映した操作を元に戻すこと。種類が「取り消し」の Change Proposal を作り、同じ反映の仕組みで適用する。新規作成を戻すときは、作ったページをごみ箱へ移す。その取り消しをさらに戻すときは、ページをごみ箱から元のパスへ戻す。この 2 つの操作は、取り消しの Change Proposal だけが持つ。
- **見る人**: API を呼んで Change Proposal を取得するユーザー。依頼した人の場合も、他のユーザーの場合もある。
- **閲覧できるページ**: 見る人が、その時点の閲覧範囲の設定に従って見られるページ。GROWI では、閲覧できるページは編集もできる。
- **見る人に返す操作**: 依頼した人には、閲覧できるページに対する操作と、まだページが無い新規作成の操作。依頼した人以外の見る人には、閲覧できるページ（リンクを知る人だけが見られるページを除く）に対する操作のうち、状態が「反映済み」「取り消し済み」「取り消しを断られた」のものだけ。依頼した人以外には、「待ち」「失敗」「古い」「飛ばした」の操作を返さない。Change Proposal が承認待ちかどうか、破棄・期限切れ・取り下げになったかどうかは、この決まりに関係しない。
- **編集中の人がいるページ**: そのページの共同編集の画面に誰かが接続しているページ、または共同編集の文書に、まだページへ保存されていない入力が残っているページ。

操作ごとの状態は次の 7 つとする。

| 状態 | 意味 |
|---|---|
| 待ち | まだ反映していない。承認待ち、または編集中の人がいたため反映を見送ったもの |
| 反映済み | 反映が終わった |
| 失敗 | 反映しようとしたが、権限・設定・パスの重なりなどの条件を満たさず、書き込まなかった |
| 古い | 反映しようとしたときに、ページの最新のリビジョンが元のリビジョンから変わっていたため、書き込まなかった |
| 飛ばした | 依頼した人が反映しないことを選んだ、または Change Proposal 全体が取り下げ・期限切れになった |
| 取り消し済み | 反映した後に、取り消しで元に戻された |
| 取り消しを断られた | 取り消そうとしたが、戻してよい条件を満たさなかった |

## Boundary Context

- **In scope**:
  - Change Proposal の保存、状態の移り変わり、承認待ちの期限切れ
  - 人の保存と同じ確認を通る、サーバー側での反映
  - 反映するときの確認（元のリビジョン、編集中の人、権限、読み取り専用ユーザー、管理者の設定）
  - 依頼した人によるページ単位の承認と、管理者の設定による自動反映
  - 取り消しと、戻してよい条件の判定。移動を戻すときに逆向きのリダイレクトを消すこと
  - リビジョンへの、作った Change Proposal の記録（新規作成で作ったページは、その最初のリビジョンの記録で表す）
  - ページごとの通知を止め、Change Proposal ごとに 1 つのアプリ内通知にまとめること。activity への記録
  - 管理者の設定画面（5 言語の文言を含む）
  - Change Proposal を作り、取得し、承認し、取り消す API。見る人に返す操作の分だけを返すこと
  - 兄弟の spec の画面で共通に使う部品: 操作の種類・操作の状態・全体の状態・理由・戻せない理由の表示名（5 言語）と、本文の差分を表示するときの diff2html の設定と見た目
- **Out of scope**:
  - AI に Change Proposal を作らせる道具、置き換えの指示から本文を組み立てる処理、内容が大きく消える操作の拒否、チャット画面（`change-proposal-ai-agent`）
  - 反映済みの Change Proposal の詳細ページ・一覧画面、ページ履歴・Recent Changes・ページの見出しの印、取り消しボタン、「本人に戻すよう頼む」通知、まとめたアプリ内通知の画面での表示と文言（`change-proposal-viewer`）
  - AI が書いた要約や会話の保存と表示（`change-proposal-ai-agent`）
  - Vault・MCP の入口そのもの（将来の spec）
  - 差分の塊ごとの承認、元のリビジョンが変わった案の自動の合わせ込み
  - ページの削除・閲覧範囲の変更・公開と非公開の切り替えを操作として受け付けること
  - 「待ち」「失敗」「古い」「飛ばした」の操作を、依頼した人以外に見せること
- **Adjacent expectations**:
  - 入口（`change-proposal-ai-agent` など）は、変更後の本文全体を作ってから Change Proposal を作る。本 spec は受け取った本文をそのまま使い、本文の中身を評価しない。
  - 入口の違い（AI チャット・Vault・MCP）によって、反映・承認・取り消しの振る舞いを変えない。
  - `change-proposal-viewer` は、本 spec の API が返す「戻せるかどうか」の判定結果と、リビジョンに残した記録を表示に使う。判定そのものはしない。
  - `change-proposal-viewer` と `change-proposal-ai-agent` は、操作の種類・状態・理由の表示名と差分の表示の設定を、本 spec が用意した共通の部品から使い、自分では持たない。それぞれの画面だけで使う文言は、それぞれの spec が持つ。
  - 閲覧できるかどうかの判定には、GROWI の既存の閲覧の判定を使う。新しい判定の規則は作らない。

## Requirements

### Requirement 1: Change Proposal の作成

**Objective:** 入口（AI チャットなど）を作る開発者として、複数ページへの操作を 1 つの Change Proposal としてまとめて保存したい。後で承認・反映・取り消しを 1 つの単位で扱えるようにするため。

#### Acceptance Criteria
1. When 入口が、依頼した人・入口の種類・並び順のある操作の一覧を指定して Change Proposal の作成を求めた場合, the Change Proposal System shall Change Proposal を保存し、その ID と、操作ごとの状態（初期値は「待ち」）を返す。
2. The Change Proposal System shall 編集の操作として、対象のページ、元のリビジョン、変更後の本文全体を受け付ける。
3. The Change Proposal System shall 新規作成の操作として、作るページのパスと本文を受け付ける。
4. The Change Proposal System shall 移動の操作として、移動元のページと移動先のパスを受け付ける。
5. If 作成を求められた Change Proposal に、編集・新規作成・移動以外の種類の操作が含まれる場合, then the Change Proposal System shall その Change Proposal を保存せず、受け付けない理由を返す。
6. If 作成を求められた Change Proposal に移動の操作が 2 つ以上含まれる場合, then the Change Proposal System shall その Change Proposal を保存せず、受け付けない理由を返す。
7. If 作成を求められた Change Proposal の操作の数が、管理者が設定した 1 件あたりの操作数の上限を超える場合, then the Change Proposal System shall その Change Proposal を保存せず、上限を超えたことを返す。
8. If 依頼した人がその日に作った Change Proposal の件数が、管理者が設定した 1 日あたりの件数の上限に達している場合, then the Change Proposal System shall 新しい Change Proposal を保存せず、上限に達したことを返す。
9. If 書き込み機能が管理者によって無効にされている場合、または含まれる操作の種類が管理者によって無効にされている場合, then the Change Proposal System shall その Change Proposal を保存せず、無効にされていることを返す。
10. If 依頼した人が読み取り専用ユーザーである場合、またはゲストである場合, then the Change Proposal System shall Change Proposal を保存しない。
11. If 編集の操作の対象のページ、または移動の操作の移動元のページを、依頼した人が閲覧できない場合, then the Change Proposal System shall その Change Proposal を保存せず、対象のページが存在しない場合と同じ応答を返す。
12. If 編集の操作の元のリビジョンが、対象のページのリビジョンではない場合, then the Change Proposal System shall その Change Proposal を保存せず、受け付けない理由を返す。
13. If 新規作成の操作のパス、または移動の操作の移動先のパスが、ページのパスとして使えない形である場合, then the Change Proposal System shall その Change Proposal を保存せず、受け付けない理由を返す。
14. The Change Proposal System shall 入口の種類が「取り消し」の Change Proposal を、入口からの作成の求めでは受け付けず、取り消しの求め（Requirement 5）によってだけ作る。
15. Where 入口が、表示用のモデル名を指定した場合, the Change Proposal System shall それを Change Proposal とともに保存する。
16. If 作成を求められた Change Proposal の本文の合計の大きさが、1 件の Change Proposal として保存できる大きさを超える場合, then the Change Proposal System shall その Change Proposal を保存せず、大きすぎることを返す。

### Requirement 2: 状態の移り変わりと期限切れ

**Objective:** 依頼した人として、Change Proposal と各操作がいまどうなっているかを知りたい。承認するか、作り直すか、取り消すかを判断するため。

#### Acceptance Criteria
1. The Change Proposal System shall 操作ごとに、「待ち」「反映済み」「失敗」「古い」「飛ばした」「取り消し済み」「取り消しを断られた」のいずれかの状態を持つ。
2. The Change Proposal System shall Change Proposal 全体の状態を、含まれる操作の状態と、取り下げ・期限切れの有無から決める。
3. When 依頼した人が、承認待ちの Change Proposal の中の操作を反映しないことを選んだ場合, the Change Proposal System shall その操作の状態を「飛ばした」にする。
4. When 依頼した人が、承認待ちの Change Proposal を破棄した場合, the Change Proposal System shall 「待ち」の操作をすべて「飛ばした」にし、その Change Proposal を以後反映しない。
5. When 承認待ちの Change Proposal が、作成から決められた期間を過ぎた場合, the Change Proposal System shall その Change Proposal を期限切れにし、「待ち」の操作をすべて「飛ばした」にし、以後反映しない。
6. When 操作が反映された場合, the Change Proposal System shall その操作に、反映した日時と、反映で作られたページとリビジョンを記録する。
7. When 操作が「失敗」「古い」「取り消しを断られた」になった場合, the Change Proposal System shall その操作に、理由を表す決まった値を記録する。
8. The Change Proposal System shall 反映済みの操作を含む Change Proposal を削除しない。

### Requirement 3: 反映

**Objective:** 依頼した人として、Change Proposal の操作を、LLM を使わずにサーバー側で安全に反映してほしい。人の保存や共同編集中の入力を壊さずに、まとめて書き換えるため。

#### Acceptance Criteria
1. The Change Proposal System shall 反映に LLM を使わず、保存されている操作の内容だけをもとに書き込む。
2. When 操作を反映する場合, the Change Proposal System shall Change Proposal の並び順に従って操作を 1 つずつ反映し、移動の操作は他の操作のあとで最後に反映する。
3. When 編集の操作を反映する場合, the Change Proposal System shall 「対象のページの最新のリビジョンが元のリビジョンのままであれば、変更後の本文で新しいリビジョンを作る」ことを、確認と書き込みの間に他の保存が入らない 1 回の操作として行う。
4. If 編集の操作を反映しようとしたときに、対象のページの最新のリビジョンが元のリビジョンから変わっていた場合, then the Change Proposal System shall 書き込まずに、その操作を「古い」にする。
5. If 操作の対象のページが編集中の人がいるページである場合, then the Change Proposal System shall その操作を反映せず、「待ち」のまま残す。
6. If 反映しようとした時点で、依頼した人が対象のページ（新規作成では親のページ、移動では移動元と移動先）に書き込む権限を持たない場合、または依頼した人が読み取り専用ユーザーになっている場合, then the Change Proposal System shall その操作を書き込まずに「失敗」にする。
7. If 反映しようとした時点で、書き込み機能またはその操作の種類が管理者によって無効にされている場合, then the Change Proposal System shall その操作を書き込まずに「失敗」にする。
8. If 新規作成の操作のパス、または移動の操作の移動先のパスに、反映しようとした時点ですでにページがある場合, then the Change Proposal System shall その操作を書き込まずに「失敗」にする。
9. When 新規作成の操作を反映する場合, the Change Proposal System shall 新しいページの閲覧範囲を親のページと同じにする。
10. When 操作を反映する場合, the Change Proposal System shall 作るリビジョンとページの作者を依頼した人にする。
11. When 反映の前から開いていたエディタで、反映されたページを人が保存した場合, the Change Proposal System shall 人の保存と同じ上書き防止の確認を働かせ、反映した内容を確認なしに上書きさせない。
12. When 反映した後に誰かがそのページのエディタを開いた場合, the Change Proposal System shall 反映した後の本文をエディタに表示させる。
13. If 反映の途中で、ある操作が「失敗」または「古い」になった場合, then the Change Proposal System shall それより前に反映済みになった操作を元に戻さず、残りの操作の反映を続ける。
14. When 反映が途中で止まった Change Proposal を再び反映する場合, the Change Proposal System shall すでに書き込まれた操作を確かめ、同じ操作を二度書き込まない。
15. While ある Change Proposal を反映している間, the Change Proposal System shall 同じ Change Proposal を別の処理が同時に反映しないようにする。
16. When 人の保存と反映が同じページに対して同時に起きた場合, the Change Proposal System shall どちらか一方が相手の内容を確認なしに上書きすることを起こさず、反映の側が負けた場合はその操作を「古い」にする。
17. When 操作を反映した場合, the Change Proposal System shall 全文検索など、人の保存のあとに更新される機能を、人の保存と同じように更新する。

### Requirement 4: 承認と自動反映

**Objective:** 管理者として、AI などからの書き込みをどこまで自動で反映するかを決めたい。依頼した人としては、自動で反映されなかった操作をページ単位で確かめてから反映したい。

#### Acceptance Criteria
1. Where 自動反映の方針が「しない」である場合, the Change Proposal System shall 作成した Change Proposal の操作を自動では反映せず、すべて承認待ちにする。
2. Where 自動反映の方針が「すべて」である場合, the Change Proposal System shall Change Proposal を作成した直後に、すべての操作を反映する。
3. Where 自動反映の方針が「自分が作ったページだけ」である場合, the Change Proposal System shall 対象のページが依頼した人の作ったページであると判定された操作と、新規作成の操作だけを作成した直後に反映し、それ以外の操作を承認待ちにする。
4. When 依頼した人が、承認待ちの Change Proposal の中で 1 つ以上のページを選んで承認した場合, the Change Proposal System shall そのページに対する「待ち」の操作を反映する。
5. When 依頼した人が、承認待ちの Change Proposal 全体を承認した場合, the Change Proposal System shall 「待ち」の操作をすべて反映する。
6. If 依頼した人以外のユーザーが、承認待ちの Change Proposal の承認・飛ばす・破棄を求めた場合, then the Change Proposal System shall それを受け付けず、Change Proposal が存在しない場合と同じ応答を返す。
7. If 期限切れ・破棄・取り下げになった Change Proposal の承認を求められた場合, then the Change Proposal System shall 反映せず、反映できない状態であることを返す。
8. When 自動反映または承認による反映で、編集中の人がいたために操作が「待ち」のまま残った場合, the Change Proposal System shall その操作を承認待ちとして扱い、依頼した人が後から再び承認できるようにする。

### Requirement 5: 取り消し

**Objective:** 依頼した人と、反映された変更に気付いた他のユーザーとして、反映された操作を Change Proposal 単位で取り消したい。AI などによる望まない変更を、手作業で 1 ページずつ直さずに戻すため。

#### Acceptance Criteria
1. When ユーザーが反映済みの操作の取り消しを求めた場合, the Change Proposal System shall 入口の種類が「取り消し」の Change Proposal を作り、反映と同じ仕組みで適用する。
2. The Change Proposal System shall 依頼した人には、Change Proposal の中で依頼した人が閲覧できるページに対する反映済みの操作をすべて取り消すことを許す。
3. The Change Proposal System shall 依頼した人以外のユーザー（管理者を含む）には、そのユーザーが閲覧できるページに対する反映済みの操作だけを取り消すことを許す。
4. If 取り消しを求めたユーザーが閲覧できない操作が Change Proposal に含まれている場合, then the Change Proposal System shall それを理由に取り消しを断らず、閲覧できる操作だけを取り消し、閲覧できない操作があることを応答で示さない。
5. When 編集の操作を取り消す場合, the Change Proposal System shall その操作が作ったリビジョンがまだページの最新のリビジョンであるときだけ、元のリビジョンの本文で新しいリビジョンを作る。
6. When 新規作成の操作を取り消す場合, the Change Proposal System shall 作ったページに子のページが無く、その操作が作ったリビジョンがまだ最新のリビジョンであるときだけ、そのページをごみ箱へ移す。
7. When 移動の操作を取り消す場合, the Change Proposal System shall 移動元のパスが空いているときだけページを移動元のパスへ戻し、移動のときに作られた、移動元から移動先への転送（リダイレクト）を消す。
8. If 取り消そうとした操作が、戻してよい条件（5.5〜5.7、5.16）を満たさない場合, then the Change Proposal System shall その操作を書き込まずに「取り消しを断られた」にし、断った理由を返す。
9. When 取り消しが反映された場合, the Change Proposal System shall 元の操作を「取り消し済み」にし、その操作に、取り消した Change Proposal の ID を記録する。
10. The Change Proposal System shall 取り消しの Change Proposal を、自動反映の方針と承認を通さず、取り消しを求めた時点で適用する。
11. If 取り消しの Change Proposal の操作の対象が、編集中の人がいるページである場合, then the Change Proposal System shall その操作を反映せずに取り消しの Change Proposal の中で「飛ばした」にし、元の操作を「反映済み」のまま残して、取り消しを求めた人が後から再び求められるようにする。
12. The Change Proposal System shall 取り消しの Change Proposal で反映した編集と移動の操作を、通常の Change Proposal の操作と同じ条件で取り消せるようにする。
13. The Change Proposal System shall 取り消しを、書き込み機能の有効化・操作ごとの有効化・件数の上限の設定にかかわらず受け付ける。
14. When 見る人が反映済みの操作を取得した場合, the Change Proposal System shall その操作をその時点で戻せるかどうかと、戻せない場合の理由を、見る人ごとに判定して返す。
15. When 取り消しの Change Proposal でページをごみ箱へ移した操作の取り消しを求められた場合, the Change Proposal System shall そのページがまだごみ箱にあり、ごみ箱へ移す前のパスに中身のある別のページが無く、ページの最新のリビジョンが元の新規作成の操作で作ったリビジョンのままであるときだけ、ごみ箱から元に戻す既存の処理でページを元のパスへ戻す。条件を満たさないときは、その操作を「取り消しを断られた」にし、満たさなかった条件を理由として返す。
16. When 取り消しの Change Proposal でページをごみ箱から戻した操作の取り消しを求められた場合, the Change Proposal System shall 新規作成の操作の取り消し（5.6）と同じ条件で、そのページをごみ箱へ移す。

### Requirement 6: 作った Change Proposal の記録

**Objective:** 反映後の画面（`change-proposal-viewer`）を作る開発者として、どのリビジョン（新規作成のページでは、その最初のリビジョン）がどの Change Proposal で作られたかを知りたい。ページ履歴や Recent Changes に印を付け、Change Proposal の詳細へたどれるようにするため。

#### Acceptance Criteria
1. When 操作の反映でリビジョンを作った場合, the Change Proposal System shall そのリビジョンに、作った Change Proposal の ID と、その操作を指す ID を記録する。操作を指す ID は、作成のときに操作ごとに振る乱数の ID で、並び順を表さない。
2. When 新規作成の操作の反映でページを作った場合, the Change Proposal System shall ページそのものには記録の項目を足さず、そのページの最初のリビジョンに 6.1 の記録を付ける。
3. The Change Proposal System shall 人の保存で作られたリビジョンには、Change Proposal の記録を付けない。
4. The Change Proposal System shall リビジョンの上書き防止の確認に使われている既存の値（保存の出どころを表す `origin`）に新しい値を足さず、反映で作るリビジョンの `origin` を空にする。
5. The Change Proposal System shall 反映済みの操作を含む Change Proposal を、activity の保存期間とは関係なく保存し続ける。
6. The Change Proposal System shall リビジョンを返す既存の API の応答に記録の値が含まれても、そこから Change Proposal の中の他の操作の数・並び順・あるかどうかが分からないようにする。

### Requirement 7: 通知と activity

**Objective:** wiki を使う他のユーザーとして、まとめて書き換えられたときに、ページごとの大量の通知ではなく、1 つのまとまった通知で知りたい。そのとき、自分が閲覧できないページのことは知らされたくない。

#### Acceptance Criteria
1. While Change Proposal の操作を反映している間, the Change Proposal System shall ページごとに出るアプリ内通知・Slack 通知・メール通知を出さない。
2. When Change Proposal の反映が終わり、1 つ以上の操作が反映済みになった場合, the Change Proposal System shall その Change Proposal について 1 つのアプリ内通知を、反映済みの操作のページが人の保存で更新された場合にアプリ内通知を受け取るはずだったユーザー（依頼した人を除く）に送る。
3. The Change Proposal System shall まとめたアプリ内通知の中身を、受け取るユーザーが閲覧できるページの分だけで作り、閲覧できないページのパス・タイトル・件数を含めない。
4. If 通知を受け取るはずのユーザーが、反映済みの操作のページを 1 つも閲覧できない場合, then the Change Proposal System shall そのユーザーにはその Change Proposal の通知を送らない。
5. When Change Proposal を反映した場合、または取り消した場合, the Change Proposal System shall 監査ログの設定にかかわらず、それを新しい種類の activity として、依頼した人または取り消した人を操作者として記録する。
6. The Change Proposal System shall 人の保存のときに出る通知と activity の振る舞いを変えない。
7. When Change Proposal を作成した場合, the Change Proposal System shall 監査ログの設定で記録の対象になっているときに、それを新しい種類の activity として、依頼した人を操作者として記録する。
8. When 取り消しの Change Proposal の反映が終わり、1 つ以上の操作が反映済みになった場合, the Change Proposal System shall ごみ箱へ移したページとごみ箱から戻したページも通知の対象のページに含め、元の Change Proposal の依頼した人にも（取り消した人と同じでなければ）まとめたアプリ内通知を送る。中身は 7.3・7.4 と同じく、受け取る人が閲覧できるページの分だけで作る。
9. When 入口が、利用者の request を受けた処理の中で Change Proposal を作った場合, the Change Proposal System shall 作成の activity をその request の activity として記録し、作成のための activity を別に残さない。

### Requirement 8: 管理者の設定

**Objective:** 管理者として、AI などからの書き込みを許すかどうか、どの操作を許すか、どこまで自動で反映するか、どれだけの量を許すかを決めたい。wiki 全体に対する書き込みの量と範囲を管理するため。

#### Acceptance Criteria
1. The Change Proposal System shall 書き込み機能の有効・無効を管理者が設定できるようにし、初期値を無効にする。
2. The Change Proposal System shall 編集・新規作成・移動のそれぞれについて、操作の有効・無効を管理者が設定できるようにする。
3. The Change Proposal System shall 自動反映の方針として「しない」「自分が作ったページだけ」「すべて」のいずれかを管理者が設定できるようにし、初期値を「しない」にする。
4. The Change Proposal System shall 1 件の Change Proposal あたりの操作数の上限と、依頼した人ごとの 1 日あたりの Change Proposal の件数の上限を、管理者が設定できるようにする。
5. When 管理者が書き込み機能を無効にした場合, the Change Proposal System shall 承認待ちの Change Proposal をすべて取り下げ、その「待ち」の操作を「飛ばした」にする。
6. The Change Proposal System shall これらの設定を、管理者の設定画面から確かめ、変更できるようにする。
7. The Change Proposal System shall 管理者の設定画面の文言と、監査ログに表示する新しい activity の名前を、GROWI が対応する 5 言語（英語・日本語・中国語・フランス語・韓国語）すべてで表示する。
8. If 管理者でないユーザーが設定の変更を求めた場合, then the Change Proposal System shall 変更しない。

### Requirement 9: Change Proposal の取得と、見る人ごとの絞り込み

**Objective:** 入口と反映後の画面を作る開発者として、Change Proposal を取得する API がほしい。ただし、見る人が閲覧できないページの存在は、どの応答からも分からないようにしたい。

#### Acceptance Criteria
1. When 見る人が Change Proposal の ID を指定して取得を求めた場合, the Change Proposal System shall 依頼した人・入口の種類・モデル名・作成日時・全体の状態と、見る人が閲覧できるページに対する操作だけを、操作ごとの状態とともに返す。
2. The Change Proposal System shall 依頼した人以外の見る人には、見る人に返す操作（「本要件で使う言い方」）だけを返し、それを 1 つも含まない Change Proposal を返さない。そのため、依頼した人以外に返す全体の状態は「承認待ち」や「一部だけ反映」にならない。
3. If 指定された Change Proposal が存在しない場合、または見る人に返す操作を 1 つも含まない場合, then the Change Proposal System shall どちらの場合も同じ「見つからない」応答を返す。
4. The Change Proposal System shall 応答に、見る人が閲覧できない操作の件数や、閲覧できない操作があることを示す情報を含めない。
5. The Change Proposal System shall 依頼した人以外の見る人への応答では、リンクを知る人だけが見られるページに対する操作を含めない。
6. When 見る人が自分の作った Change Proposal の一覧を求めた場合, the Change Proposal System shall 自分が依頼した Change Proposal を、新しい順に、ページ送りできる形で返す。
7. When 見る人が、自分が閲覧できるページを含む反映済みの Change Proposal の一覧を求めた場合, the Change Proposal System shall 見る人に返す操作のうち状態が「反映済み」「取り消し済み」「取り消しを断られた」のものを 1 つ以上含む Change Proposal を、新しい順に、ページ送りできる形で返す。依頼した人以外の見る人には、リンクを知る人だけが見られるページだけを含む Change Proposal を返さない。
8. When 見る人がリビジョンの ID の一覧を指定して、それらを作った Change Proposal を求めた場合, the Change Proposal System shall そのリビジョンを作った操作が見る人に返す操作であるときだけ、作った Change Proposal の ID と、それが取り消しで作られたかどうかを返す。
9. If 読み取り専用ユーザーが、Change Proposal の作成・承認・飛ばす・破棄・取り消しを求めた場合, then the Change Proposal System shall それを受け付けない。
10. The Change Proposal System shall 依頼した人以外の見る人に返す「最後に反映した日時」を、1 件の取得でも一覧でも、その見る人に返す操作の反映の日時だけから決める。

### Requirement 10: 人の保存への影響

**Objective:** 普段エディタや画面からページを保存するユーザーとして、Change Proposal の仕組みが入っても、今までどおりに保存できてほしい。

#### Acceptance Criteria
1. The Change Proposal System shall 人がエディタや画面から保存したときの、上書き防止の確認・activity・通知・共同編集の同期の振る舞いを変えない。
2. The Change Proposal System shall ページの作成・更新・移動の既存の API の、入力と応答の形を変えない。
3. When 書き込み機能が無効である場合, the Change Proposal System shall 人の保存・作成・移動の振る舞いに一切影響を与えない。

### Requirement 11: 兄弟の spec の画面で共通に使う部品

**Objective:** 反映後の画面とチャット画面（`change-proposal-viewer` と `change-proposal-ai-agent`）を作る開発者として、操作の種類・状態・理由の表示名と差分の見た目を、1 か所で決めたものとして使いたい。画面ごとに言葉や見た目が食い違わないようにするため。

#### Acceptance Criteria
1. The Change Proposal System shall 操作の種類・操作の状態・全体の状態・理由・戻せない理由のそれぞれについて、値ごとの表示名を、GROWI が対応する 5 言語すべてで用意する。
2. The Change Proposal System shall 1 の表示名を、値から表示名の翻訳キーを引く表として、兄弟の spec の画面から import できる形で提供する。値の型に含まれるすべての値に表示名があることを、型の検査で確かめられるようにする。
3. The Change Proposal System shall Change Proposal の本文の差分を、ページ履歴の差分と同じ diff2html の設定と見た目で表示するための部品を、兄弟の spec の画面から import できる形で提供し、ページ履歴の差分もそれを使う。ページ履歴の差分の見た目は変えない。
