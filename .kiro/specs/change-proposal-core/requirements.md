# Requirements Document

## Project Description (Input)

GROWI には、AI や外部の仕組みが複数のページをまとめて書き換えるための、安全な書き込みの仕組みが無い（詳細は [brief.md](./brief.md)、umbrella の判断は [../change-proposal/roadmap.md](../change-proposal/roadmap.md) と [../change-proposal/research.md](../change-proposal/research.md)）。

### (a) 誰が困っているか
- AI チャットなどに、複数のページの編集・新規作成・移動を任せたいユーザー。今は AI が案を出しても、自分で 1 ページずつ書き換えるしかない。
- 同じ wiki を使う他のユーザー。外から書き込まれると、自分の保存や共同編集中の入力が上書きされたり消えたりするおそれがある。
- 管理者。AI からの書き込みを許すかどうか、どこまで自動で適用するかを決める手段が無い。
- AI などに作らせた変更を、ほかの人（個人やグループの人たち）に確かめて承認してもらいたいユーザーと、承認を頼まれる側のユーザー。Proposal 作成者だけが承認する形では、AI が頻繁に変更を作ると、承認が Proposal 作成者 1 人に集中して溜まる。

### (b) 現状
- 書き込みは、エディタの保存、ページの作成・更新・移動の API、外部の `@growi/mcp-server`（API トークンで REST を呼ぶ）だけで、どれも人が 1 ページずつ保存することを前提にしている。
- 上書き防止の確認・activity・通知・共同編集（yjs）の同期は API の処理（route）の中にあり、他の処理から呼び出せない。確認と書き込みが別々なので、外からの書き込みは人の保存とぶつかる。REST で保存すると共同編集中の文書が置き換わり、共同編集者の未保存の入力が消える。
- 複数ページへの変更を 1 つにまとめて記録する仕組みも、まとめて戻す仕組みも無い。activity は同じ人の 5 分以内の更新を 1 つにまとめ、30 日で消えるため、その代わりにならない。

### (c) どう変えたいか
- 複数ページへの Change オペレーション（`edit` (編集)・`create` (新規作成)・`move` (移動)）を 1 つにまとめた Proposal を保存し、LLM を使わずにサーバー側で適用できるようにする。適用は人の保存とぶつからず、共同編集中の人の入力を消さず、権限をその時点で確かめる。
- 管理者の設定に応じて、Change オペレーションを自動で適用するか、Proposal 作成者または Proposal 作成者が指定した Proposal 承認者がページ単位で承認してから適用する。Proposal 承認者は、賛成できない変更や自分にはレビューできないページについて、コメントを添えた意見を Proposal 作成者へ返せる。
- Change オペレーションを適用した Proposal を取り消せるようにし、どのリビジョンがどの Proposal で作られたかを、消えない記録として残す。`create` (新規作成) で作ったページは、その最初のリビジョンの記録から分かる。ページが完全に削除されたときは、リビジョンと一緒にその記録も消えるが、Proposal の側の記録（どの Change オペレーションがどのページとリビジョンを作ったか）は残る。

## Introduction

この文書は、Change Proposal の土台となる部分（データ、状態の移り変わり、サーバー側での適用と取り消し、承認と自動適用、Proposal 承認者によるレビュー、記録、通知、管理者の設定、API）の要件を定める。Proposal を作る側（AI チャットなど）と、適用後の画面（詳細ページ、ページ履歴や Recent Changes の印）は、それぞれ兄弟の spec `change-proposal-ai-agent` と `change-proposal-viewer` が持つ。本 spec はそれらが使う API とデータを提供する。

### 本要件で使う言い方

「Change Proposal」を短く「Proposal」と書く。決まった値は、`コード上の名前` (日本語) の形で書く。だれに何を返すか、だれが何をできるかの決まりは、この節ではなく各 Requirement に書く。

**人**

| 言葉 | 意味 |
|---|---|
| Proposal 作成者 | Proposal を作るように頼んだユーザー。適用で作られるリビジョンとページの作者になる |
| Proposal 承認者 | 承認・却下・放棄ができる人。承認者に指定されたユーザーと、指定されたグループにその時点で所属するユーザーの両方を指す。グループには、GROWI のユーザーグループと、外部の認証から取り込まれたグループの両方が含まれる。所属しているかどうかは、ページの閲覧範囲（グループ指定）と同じ規則で、その時点で判定する |
| 取り消しの相手 | ある Change オペレーションから見て、取り消しでつながったもう一方の Proposal の作成者。オリジナルの Proposal の Change オペレーションでは、その Change オペレーションを取り消した取り消しの Proposal の作成者（取り消した人）を指す。取り消しの Proposal の Change オペレーションでは、オリジナルの Proposal の作成者を指す |

**Proposal と Change オペレーション**

| 言葉 | 意味 |
|---|---|
| Proposal | 複数のページへの Change オペレーションを、並び順つきでまとめたもの。1 件ごとに ID を持つ |
| Change オペレーション | Proposal に含まれる 1 つの変更。種類は `edit` (編集)、`create` (新規作成)、`move` (移動)、`delete-completely` (完全な削除) の 4 つ。`delete-completely` は、取り消しのための Proposal だけが持つ |
| 元のリビジョン | `edit` (編集) が前提にしている、そのページのリビジョン。ページの最新のリビジョンがこれと同じときだけ書き込む |
| Proposal 作成元 | Proposal がどこから来たか。`ai-chat` (AI チャット)、`vault` (Vault)、`mcp` (MCP)、`revert` (取り消し) のどれか |
| 適用 | Change オペレーションを、実際のページとリビジョンに書き込むこと |
| 取り消し | 適用した Change オペレーションを元に戻すこと。作成元が `revert` (取り消し) の Proposal を作り、それを適用する。`create` (新規作成) を戻すときは、作ったページを完全に削除する（ごみ箱には残さない）。完全に削除したページは戻せないので、この取り消しは取り消せない |
| Proposal の目的 | Proposal 作成者が作成のときに書く、Proposal を出す理由。入れなくてもよい。AI との会話や AI が書いた要約とは別のものである |

「そのユーザーに返す Change オペレーション」と書くときは、Proposal を取得するユーザーの立場（Proposal 作成者・Proposal 承認者・それ以外のユーザー）に応じて、Requirement 9.11〜9.15 の決まりで選んだ Change オペレーションを指す。

**Change オペレーションの状態**

| 値 | 意味 |
|---|---|
| `pending` (適用待ち) | まだ適用していない。承認を待っているか、共同編集中のページだったので適用を見送った |
| `applied` (適用済み) | 適用が終わった |
| `failed` (適用失敗) | 権限・設定・パスの重なりなどの条件を満たさず、書き込まなかった |
| `stale` (見送り) | ページの最新のリビジョンが元のリビジョンから変わっていたので、書き込まなかった |
| `skipped` (スキップ) | Proposal 作成者が適用しないと決めた。または Proposal が取り下げ・期限切れになった |
| `reverted` (取り消し済み) | 適用したあとに、取り消しで元に戻した |
| `revert-refused` (取り消し不可) | 取り消そうとしたが、戻してよい条件を満たさなかった |

`applied`・`reverted`・`revert-refused` の 3 つをまとめて「一度は適用された Change オペレーション」と呼ぶ。

**Proposal のライフサイクル**

Change オペレーションの状態とは別に、Proposal 全体が動いているか終わったかを表す。

| 値 | 意味 |
|---|---|
| `open` (進行中) | `pending` (適用待ち) の Change オペレーションが残っている |
| `settled` (完了) | `pending` (適用待ち) の Change オペレーションが 1 つも残っていない |
| `discarded` (破棄) | Proposal 作成者が破棄したので、残っていた `pending` (適用待ち) の Change オペレーションを `skipped` (スキップ) にし、以後適用しない |
| `expired` (期限切れ) | `open` (進行中) のまま作成から決められた期間を過ぎたので、残っていた `pending` (適用待ち) の Change オペレーションを `skipped` (スキップ) にし、以後適用しない |
| `withdrawn` (取り下げ) | 管理者が書き込み機能を無効にしたので、残っていた `pending` (適用待ち) の Change オペレーションを `skipped` (スキップ) にし、以後適用しない |

**Proposal 承認者のレビュー**

| 言葉 | 意味 |
|---|---|
| レビュー | Proposal 承認者が行う承認・却下・放棄をまとめた呼び方 |
| 承認 | Change オペレーションを適用してよいと判断すること。Proposal 作成者と Proposal 承認者ができる。承認した人が、自分が閲覧できるページの差分を見て、適用してよいと判断したことを表す。内容の正しさを保証するものではない |
| 却下 | 「この変更には賛成できない」という意見を記録すること。記録と通知だけで、承認や適用は止めない。Change オペレーションごとの却下と、Proposal 全体の却下がある。画面では、承認や適用を止めない意味が伝わる表示名（たとえば「変更を依頼」）にすることがある。表示名は `change-proposal-viewer` が決める |
| 放棄 | 「このページについてはレビューできない」と表明すること。記録と通知だけで、Change オペレーションの状態は変えない |
| コメント | 却下と放棄に添える一言。入れなくてもよい |
| 承認権限チェック | Proposal 承認者が、ある Change オペレーションを閲覧してレビューしてよいかを確かめる検査。その Proposal 承認者が、下の「確かめるページ」をすべて閲覧できれば通る。確かめるページの中に、リンクを知る人だけが見られるページが 1 つでもあれば通らない |

承認権限チェックで確かめるページ:

| Change オペレーションの種類 | 確かめるページ |
|---|---|
| `edit` (編集) | 対象のページ |
| `create` (新規作成) | 親のページ。親が無いときと、親の中身が空のときは、中身が空でないいちばん近い上のページ |
| `move` (移動) | 移動元のページと、移動先の親のページの両方。移動先の親は、`create` (新規作成) と同じ決め方で選ぶ |

中身が空でない上のページがルートまで 1 つも無いときは、承認権限チェックを通らない。

**Proposal どうしのつながり**

| 言葉 | 意味 |
|---|---|
| オリジナルの Proposal | `follow-up` (後続) Proposal または `rework` (見直し) Proposal の、もとになった Proposal。その中で、後続・見直しが指す Change オペレーションを「オリジナルの Change オペレーション」と呼ぶ |
| `follow-up` (後続) Proposal | オリジナルの Proposal で適用されなかった Change オペレーション（`stale`・`failed`・`skipped`）を、今のページに対してもう一度試すための Proposal |
| `rework` (見直し) Proposal | オリジナルの Proposal で適用された内容を、その後に人が加えた編集をふまえて作り直すための Proposal。取り消しとは違い、新しい内容を作る |
| 適用率 | Proposal 作成者が適用しないと決めた Change オペレーションを除いたうち、一度は適用されたものの割合。Proposal 作成者にだけ返す |

**ページの状態と通知**

| 言葉 | 意味 |
|---|---|
| 閲覧できるページ | あるユーザーが、その時点の閲覧範囲の設定で見られるページ。GROWI では、閲覧できるページは編集もできる |
| 共同編集中のページ | 共同編集の画面にだれかが接続しているページ。または、まだページへ保存されていない入力が共同編集の文書に残っているページ |
| ページごとの通知 | 人が画面から同じ操作（編集・新規作成・移動・完全な削除）をしたときに、ページ 1 つごとに出る通知。そのページを購読している人へのアプリ内通知と、管理者が設定したグローバル通知（Slack・メール）の 2 つを指す。人が保存のたびに Slack のチャンネルを選んで送る通知は含めない |
| ページごとの通知設定 | Proposal ごとに持つ「ページごとの通知を出すか」の値。Proposal 作成者が決める |

## Boundary Context

- **In scope**:
  - Proposal の保存、状態の移り変わり、`open` (進行中) の Proposal の期限切れ
  - 人の保存と同じ確認を通る、サーバー側での Change オペレーションの適用
  - Change オペレーションを適用するときの確認（元のリビジョン、共同編集中かどうか、権限、読み取り専用ユーザー、管理者の設定）
  - Proposal 作成者と Proposal 承認者によるページ単位の承認と、管理者の設定による自動適用
  - 作成のときとその後に、Proposal 承認者（ユーザー・グループ・混在・Proposal 作成者自身）を指定すること。Proposal 承認者の追加と削除。指定が無いときの既定。作成のときの Proposal の目的
  - Proposal 承認者による、Change オペレーションごとの却下と放棄、Proposal 全体の却下。コメントを添えること。却下と放棄は、Change オペレーションの状態・承認・適用を変えない
  - `pending` (適用待ち) の Change オペレーションを、Proposal 作成者と Proposal 承認者にだけ返すこと。Proposal 承認者が `open` の Proposal を一覧で取得すること
  - Proposal 承認者への通知と、Proposal 作成者へのレビューの結果の通知。レビューと Proposal 承認者の追加・削除の activity
  - Proposal 承認者を指定した Proposal を、作成の直後に自動適用しないこと。`follow-up` (後続) Proposal・`rework` (見直し) Proposal が Proposal 承認者の指定を引き継ぐこと
  - 取り消しと、戻してよい条件の判定。`move` (移動) を戻すときに逆向きのリダイレクトを消すこと
  - リビジョンへの、作った Proposal の記録（`create` (新規作成) で作ったページは、その最初のリビジョンの記録で表す）
  - Proposal ごとに 1 つのアプリ内通知にまとめること。ページごとの通知を出すかを、管理者の通知設定とページごとの通知設定で決めること。activity への記録
  - 管理者の設定画面（5 言語の文言を含む）
  - Proposal を作り、取得し、承認し、取り消す API。却下・放棄を記録し、Proposal 承認者を追加・削除する API。Proposal を取得するユーザーに返す Change オペレーションの分だけを返すこと
  - 兄弟の spec の画面で共通に使う部品: Change オペレーションの種類・Change オペレーションの状態・全体の状態・理由・戻せない理由の表示名（5 言語）と、本文の差分を表示するときの diff2html の設定と見た目
  - Proposal のライフサイクル `settled` (完了) への自動の移り変わりと、Proposal 作成者にだけ返す Proposal のライフサイクルと適用率
  - `follow-up` (後続) Proposal・`rework` (見直し) Proposal とオリジナルの Proposal のつながりの保存と検査、つながりを、Proposal を取得するユーザーごとに絞って返すこと。Proposal のライフサイクル・つながりの関係・適用率の表示名（5 言語）
- **Out of scope**:
  - AI に Proposal を作らせる道具、置き換えの指示から本文を組み立てる処理、内容が大きく消える Change オペレーションの拒否、チャット画面（`change-proposal-ai-agent`）
  - Change オペレーションを適用した Proposal の詳細ページ・一覧画面、ページ履歴・Recent Changes・ページの見出しの印、取り消しボタン、「本人に戻すよう頼む」通知、まとめたアプリ内通知の画面での表示と文言（`change-proposal-viewer`）
  - AI が書いた要約や会話の保存と表示（`change-proposal-ai-agent`）
  - Proposal 作成元の `vault` (Vault)・`mcp` (MCP) から Proposal を作る仕組みそのもの（将来の spec）
  - 差分の塊ごとの承認、元のリビジョンが変わった案の自動の合わせ込み
  - ページの削除・閲覧範囲の変更・公開と非公開の切り替えを Change オペレーションとして受け付けること
  - `pending` (適用待ち)・`failed` (適用失敗)・`stale` (見送り)・`skipped` (スキップ) の Change オペレーションを、Proposal 作成者でも Proposal 承認者でもない人に見せること
  - `follow-up` (後続) Proposal・`rework` (見直し) Proposal の中身（どの Change オペレーションをどう作り直すか）を作ること。Proposal を作る側が作る（AI チャットでは `change-proposal-ai-agent`）
  - `follow-up` (後続) Proposal・`rework` (見直し) Proposal を作るボタンなどの画面（`change-proposal-ai-agent` と `change-proposal-viewer`）
  - 承認・却下・放棄・Proposal 承認者の追加と削除の画面、レビュー待ちの一覧の画面、Proposal 承認者への通知と結果の通知の表示（`change-proposal-viewer`）。AI チャットで Proposal 承認者を選ぶ画面と指定の道具（`change-proposal-ai-agent`）
  - ページのパスごとの既定の Proposal 承認者（Proposal 承認者を自動で決める規則）、Proposal 作成者自身の承認を管理者の設定で禁止すること、決めた人数だけを自動で割り当てる仕組み、グループの所属者全員への通知
  - 全員の承認を求める形、承認する人数の下限、承認に付けるコメント（コメントは却下と放棄にだけ付ける）
  - 却下の記録で、ほかの Proposal 承認者の承認を止めること、却下を理由に Change オペレーションの状態を変えること（却下は意見の記録だけにする）
  - 同じ Proposal の Change オペレーションを差し替えて再レビューを頼むこと（Vault の push と一緒に別の spec で扱う）
  - 「対応中」の印、誰の番かの表示、`open` (進行中) の Proposal の期限の前の催促、Proposal 作成者が使えないユーザーになったときの取り下げ、管理者向けに `open` の Proposal の溜まり具合を見せる画面
- **Adjacent expectations**:
  - Proposal を作る側（`change-proposal-ai-agent` など）は、変更後の本文全体を作ってから Proposal を作る。本 spec は受け取った本文をそのまま使い、本文の中身を評価しない。
  - Proposal 作成元の違い（`ai-chat` (AI チャット)・`vault` (Vault)・`mcp` (MCP)）によって、適用・承認・取り消しの振る舞いを変えない。
  - `change-proposal-viewer` は、本 spec の API が返す「戻せるかどうか」の判定結果と、リビジョンに残した記録を表示に使う。判定そのものはしない。
  - `change-proposal-viewer` と `change-proposal-ai-agent` は、Change オペレーションの種類・状態・理由の表示名と差分の表示の設定を、本 spec が用意した共通の部品から使い、自分では持たない。それぞれの画面だけで使う文言は、それぞれの spec が持つ。
  - 閲覧できるかどうかの判定には、GROWI の既存の閲覧の判定を使う。新しい判定の規則は作らない。グループの所属の判定と、読み取り専用ユーザーとゲストの扱いも、既存の規則を使う。`create` (新規作成) と `move` (移動) で承認権限チェックが確かめるページは、3.6（適用のときの権限の確認先）と 3.9（新しいページの閲覧範囲は親のページと同じ）を Proposal 承認者に当てはめたもので、新しい判定の規則ではない。
  - **公開の順序**: `change-proposal-viewer` の承認の画面とレビュー待ちの一覧、`change-proposal-ai-agent` で Proposal 承認者を指定する画面と道具ができるまでは、Proposal 作成者以外のユーザーを Proposal 承認者に指定することも、追加することも受け付けない。通知を受け取っても操作できない状態を作らないため。この切り替えは、管理者の設定画面には出さない設定で行う。

## Requirements

### Requirement 1: Change Proposal の作成

**Objective:** AI チャットなど、Proposal を作る側の機能を作る開発者として、複数ページへの Change オペレーションを 1 つの Proposal としてまとめて保存したい。後で承認・適用・取り消しを 1 つの単位で扱えるようにするため。

#### Acceptance Criteria
1. When Proposal を作る側が、Proposal 作成者・Proposal 作成元・並び順のある Change オペレーションの一覧を指定して Proposal の作成を求めた場合, the Change Proposal System shall Proposal を保存し、その ID と、Change オペレーションごとの状態（初期値は `pending` (適用待ち)）を返す。
2. The Change Proposal System shall `edit` (編集) の Change オペレーションとして、対象のページ、元のリビジョン、変更後の本文全体を受け付ける。
3. The Change Proposal System shall `create` (新規作成) の Change オペレーションとして、作るページのパスと本文を受け付ける。
4. The Change Proposal System shall `move` (移動) の Change オペレーションとして、移動元のページと移動先のパスを受け付ける。
5. If 作成を求められた Proposal に、`edit` (編集)・`create` (新規作成)・`move` (移動) 以外の種類の Change オペレーションが含まれる場合, then the Change Proposal System shall その Proposal を保存せず、受け付けない理由を返す。
6. If 作成を求められた Proposal に `move` (移動) の Change オペレーションが 2 つ以上含まれる場合, then the Change Proposal System shall その Proposal を保存せず、受け付けない理由を返す。
7. If 作成を求められた Proposal の Change オペレーションの数が、管理者が設定した 1 件あたりの Change オペレーション数の上限を超える場合, then the Change Proposal System shall その Proposal を保存せず、上限を超えたことを返す。
8. If Proposal 作成者がその日に作った Proposal の件数が、管理者が設定した 1 日あたりの件数の上限に達している場合, then the Change Proposal System shall 新しい Proposal を保存せず、上限に達したことを返す。
9. If 書き込み機能が管理者によって無効にされている場合、または含まれる Change オペレーションの種類が管理者によって無効にされている場合, then the Change Proposal System shall その Proposal を保存せず、無効にされていることを返す。
10. If Proposal 作成者が読み取り専用ユーザーである場合、またはゲストである場合, then the Change Proposal System shall Proposal を保存しない。
11. If `edit` (編集) の Change オペレーションの対象のページ、または `move` (移動) の Change オペレーションの移動元のページを、Proposal 作成者が閲覧できない場合, then the Change Proposal System shall その Proposal を保存せず、対象のページが存在しない場合と同じ応答を返す。
12. If `edit` (編集) の Change オペレーションの元のリビジョンが、対象のページのリビジョンではない場合, then the Change Proposal System shall その Proposal を保存せず、受け付けない理由を返す。
13. If `create` (新規作成) の Change オペレーションのパス、または `move` (移動) の Change オペレーションの移動先のパスが、ページのパスとして使えない形である場合, then the Change Proposal System shall その Proposal を保存せず、受け付けない理由を返す。
14. The Change Proposal System shall Proposal 作成元が `revert` (取り消し) の Proposal を、Proposal を作る側からの作成の求めでは受け付けず、取り消しの求め（Requirement 5）によってだけ作る。
15. Where Proposal を作る側が、表示用のモデル名を指定した場合, the Change Proposal System shall それを Proposal とともに保存する。
16. If 作成を求められた Proposal の本文の合計の大きさが、1 件の Proposal として保存できる大きさを超える場合, then the Change Proposal System shall その Proposal を保存せず、大きすぎることを返す。
17. When Proposal を作る側が Proposal の作成を求めた場合, the Change Proposal System shall Proposal を作る側が指定したページごとの通知設定を、Proposal とともに保存する。Proposal を作る側が指定しなかったときは「出す」として保存する。`follow-up` (後続) Proposal・`rework` (見直し) Proposal も同じ扱いにする。

### Requirement 2: 状態の移り変わりと期限切れ

**Objective:** Proposal 作成者として、Proposal と各 Change オペレーションがいまどうなっているかを知りたい。承認するか、作り直すか、取り消すかを判断するため。

#### Acceptance Criteria
1. The Change Proposal System shall Change オペレーションごとに、`pending` (適用待ち)・`applied` (適用済み)・`failed` (適用失敗)・`stale` (見送り)・`skipped` (スキップ)・`reverted` (取り消し済み)・`revert-refused` (取り消し不可) のいずれかの状態を持つ。
2. The Change Proposal System shall Proposal 全体の状態を、含まれる Change オペレーションの状態と、取り下げ・期限切れの有無から決める。
3. When Proposal 作成者が、`open` (進行中) の Proposal の中の Change オペレーションを適用しないことを選んだ場合, the Change Proposal System shall その Change オペレーションの状態を `skipped` (スキップ) にする。
4. When Proposal 作成者が、`open` (進行中) の Proposal を破棄した場合, the Change Proposal System shall `pending` (適用待ち) の Change オペレーションをすべて `skipped` (スキップ) にし、その Proposal の Change オペレーションを以後適用しない。
5. When `open` (進行中) の Proposal が、作成から決められた期間を過ぎた場合, the Change Proposal System shall その Proposal を期限切れにし、`pending` (適用待ち) の Change オペレーションをすべて `skipped` (スキップ) にし、以後適用しない。
6. When Change オペレーションが適用された場合, the Change Proposal System shall その Change オペレーションに、適用した日時と、適用で作られたページとリビジョンを記録する。
7. When Change オペレーションが `failed` (適用失敗)・`stale` (見送り)・`revert-refused` (取り消し不可) になった場合, the Change Proposal System shall その Change オペレーションに、理由を表す決まった値を記録する。
8. The Change Proposal System shall `applied` (適用済み) の Change オペレーションを含む Proposal を削除しない。
9. When Proposal のライフサイクルが `open` (進行中) の Proposal で、適用・スキップ・承認による適用の処理の結果、`pending` (適用待ち) の Change オペレーションが 1 つも残らなくなった場合, the Change Proposal System shall その Proposal のライフサイクルを自動で `settled` (完了) にする。作成の直後の自動適用ですべての Change オペレーションの状態が決まった Proposal と、取り消しの Proposal も同じように `settled` にする。
10. If `settled` (完了) の Proposal の承認・スキップ・破棄を求められた場合, then the Change Proposal System shall それを受け付けず、適用できない状態であることを返す。`settled` の Proposal の `applied` (適用済み) の Change オペレーションの取り消しと、`settled` の Proposal をオリジナルの Proposal にした `follow-up` (後続) Proposal・`rework` (見直し) Proposal の作成は受け付ける。
11. The Change Proposal System shall `settled` (完了) の Proposal を、期限切れと取り下げの対象にしない。

**残っている差**（自動テストでは確かめられないこと）:
- 2.9: `pending` (適用待ち) の状態を変える書き込みと、`settled` (完了) にする書き込みは別々の更新である。その間で処理が止まると、Proposal のライフサイクルが `settled` になるのは保守用の cron の次の実行（初期値では 10 分ごと）まで遅れる（design の「Change Proposal のライフサイクルの移り変わり」）。

### Requirement 3: 適用

**Objective:** Proposal 作成者として、Proposal の Change オペレーションを、LLM を使わずにサーバー側で安全に適用してほしい。人の保存や共同編集中の入力を壊さずに、まとめて書き換えるため。

#### Acceptance Criteria
1. The Change Proposal System shall Change オペレーションの適用に LLM を使わず、保存されている Change オペレーションの内容だけをもとに書き込む。
2. When Change オペレーションを適用する場合, the Change Proposal System shall Proposal の並び順に従って Change オペレーションを 1 つずつ適用し、`move` (移動) の Change オペレーションは他の Change オペレーションのあとで最後に適用する。
3. When `edit` (編集) の Change オペレーションを適用する場合, the Change Proposal System shall 「対象のページの最新のリビジョンが元のリビジョンのままであれば、変更後の本文で新しいリビジョンを作る」ことを、確認と書き込みの間に他の保存が入らない 1 回の操作として行う。
4. If `edit` (編集) の Change オペレーションを適用しようとしたときに、対象のページの最新のリビジョンが元のリビジョンから変わっていた場合, then the Change Proposal System shall 書き込まずに、その Change オペレーションを `stale` (見送り) にする。
5. If Change オペレーションの対象のページが共同編集中のページである場合, then the Change Proposal System shall その Change オペレーションを適用せず、`pending` (適用待ち) のまま残す。
6. If 適用しようとした時点で、Proposal 作成者が対象のページ（`create` (新規作成) では親のページ、`move` (移動) では移動元と移動先）に書き込む権限を持たない場合、または Proposal 作成者が読み取り専用ユーザーになっている場合, then the Change Proposal System shall その Change オペレーションを書き込まずに `failed` (適用失敗) にする。
7. If 適用しようとした時点で、書き込み機能またはその Change オペレーションの種類が管理者によって無効にされている場合, then the Change Proposal System shall その Change オペレーションを書き込まずに `failed` (適用失敗) にする。
8. If `create` (新規作成) の Change オペレーションのパス、または `move` (移動) の Change オペレーションの移動先のパスに、適用しようとした時点ですでにページがある場合, then the Change Proposal System shall その Change オペレーションを書き込まずに `failed` (適用失敗) にする。
9. When `create` (新規作成) の Change オペレーションを適用する場合, the Change Proposal System shall 新しいページの閲覧範囲を親のページと同じにする。
10. When Change オペレーションを適用する場合, the Change Proposal System shall 作るリビジョンとページの作者を Proposal 作成者にする。
11. When 適用の前から開いていたエディタで、Change オペレーションを適用したページを人が保存した場合, the Change Proposal System shall 人の保存と同じ上書き防止の確認を働かせ、適用した内容を確認なしに上書きさせない。
12. When Change オペレーションを適用した後に誰かがそのページのエディタを開いた場合, the Change Proposal System shall 適用した後の本文をエディタに表示させる。
13. If 適用の途中で、ある Change オペレーションが `failed` (適用失敗) または `stale` (見送り) になった場合, then the Change Proposal System shall それより前に `applied` (適用済み) になった Change オペレーションを元に戻さず、残りの Change オペレーションの適用を続ける。
14. When 適用が途中で止まった Proposal の Change オペレーションを再び適用する場合, the Change Proposal System shall すでに書き込まれた Change オペレーションを確かめ、同じ Change オペレーションを二度書き込まない。
15. While ある Proposal の Change オペレーションを適用している間, the Change Proposal System shall 同じ Proposal の Change オペレーションを別の処理が同時に適用しないようにする。
16. When 人の保存と Change オペレーションの適用が同じページに対して同時に起きた場合, the Change Proposal System shall どちらか一方が相手の内容を確認なしに上書きすることを起こさず、適用の側が負けた場合はその Change オペレーションを `stale` (見送り) にする。
17. When Change オペレーションを適用した場合, the Change Proposal System shall 全文検索など、人の保存のあとに更新される機能を、人の保存と同じように更新する。

**残っている差**（自動テストでは確かめられないこと）:
- 3.5: 共同編集中かどうかの確認は、このプロセスの接続数と、まだ保存されていない入力の有無だけで行う。複数台のサーバーで動かすと、別のプロセスにつながっている編集者は見えない（design の OQ-6）。その人の次の保存は、上書き防止の確認で止まる。
- 3.16: 保存の前後で、閲覧範囲が「リンクを知る人だけ」かどうかが変わる人の保存は、期待するリビジョンを条件にせずに 1 回だけ書く。そのため、Change オペレーションの適用と同時に起きると、適用した内容を確認なしに上書きすることがある（design の PageSave Core の Risks）。

### Requirement 4: 承認と自動適用

**Objective:** 管理者として、AI などからの書き込みをどこまで自動で適用するかを決めたい。Proposal 作成者としては、自動で適用されなかった Change オペレーションをページ単位で確かめてから適用したい。

#### Acceptance Criteria
1. Where 自動適用の方針が「しない」である場合, the Change Proposal System shall 作成した Proposal の Change オペレーションを自動では適用せず、すべて `pending` (適用待ち) のまま承認を待たせる。
2. Where 自動適用の方針が「すべて」である場合, the Change Proposal System shall Proposal を作成した直後に、すべての Change オペレーションを適用する。
3. Where 自動適用の方針が「自分が作ったページだけ」である場合, the Change Proposal System shall 対象のページが Proposal 作成者の作ったページであると判定された Change オペレーションと、`create` (新規作成) の Change オペレーションだけを作成した直後に適用し、それ以外の Change オペレーションを `pending` (適用待ち) のまま承認を待たせる。
4. When Proposal 作成者または Proposal 承認者が、`open` (進行中) の Proposal の中で 1 つ以上のページを選んで承認した場合, the Change Proposal System shall そのページに対する、そのユーザーに返す Change オペレーションのうち `pending` (適用待ち) のものを適用する（Proposal 承認者による承認の詳細は Requirement 16）。
5. When Proposal 作成者または Proposal 承認者が、`open` (進行中) の Proposal 全体を承認した場合, the Change Proposal System shall そのユーザーに返す Change オペレーションのうち `pending` (適用待ち) のものをすべて適用する。
6. If Proposal 作成者でも Proposal 承認者でもないユーザーが、`open` (進行中) の Proposal の承認を求めた場合、または Proposal 作成者以外のユーザーがスキップ・破棄を求めた場合, then the Change Proposal System shall それを受け付けず、Proposal が存在しない場合と同じ応答を返す。
7. If `expired` (期限切れ)・`discarded` (破棄)・`withdrawn` (取り下げ) になった Proposal の承認を求められた場合, then the Change Proposal System shall Change オペレーションを適用せず、適用できない状態であることを返す。
8. When 自動適用または承認による適用で、共同編集中のページだったために Change オペレーションが `pending` (適用待ち) のまま残った場合, the Change Proposal System shall その Change オペレーションを承認を待つものとして扱い、Proposal 作成者または Proposal 承認者が後から再び承認できるようにする。

### Requirement 5: 取り消し

**Objective:** Proposal 作成者と、適用された変更に気付いた他のユーザーとして、適用された Change オペレーションを Proposal 単位で取り消したい。AI などによる望まない変更を、手作業で 1 ページずつ直さずに戻すため。

#### Acceptance Criteria
1. When ユーザーが `applied` (適用済み) の Change オペレーションの取り消しを求めた場合, the Change Proposal System shall Proposal 作成元が `revert` (取り消し) の Proposal を作り、その取り消しの Proposal の Change オペレーションを、通常の Change オペレーションと同じ仕組みで適用する。
2. The Change Proposal System shall Proposal 作成者には、Proposal の中で Proposal 作成者が閲覧できるページに対する `applied` (適用済み) の Change オペレーションをすべて取り消すことを許す。
3. The Change Proposal System shall Proposal 作成者以外のユーザー（管理者を含む）には、そのユーザーが閲覧できるページに対する `applied` (適用済み) の Change オペレーションだけを取り消すことを許す。
4. If 取り消しを求めたユーザーが閲覧できない Change オペレーションが Proposal に含まれている場合, then the Change Proposal System shall それを理由に取り消しを断らず、閲覧できる Change オペレーションだけを取り消し、閲覧できない Change オペレーションがあることを応答で示さない。
5. When `edit` (編集) の Change オペレーションを取り消す場合, the Change Proposal System shall その Change オペレーションが作ったリビジョンがまだページの最新のリビジョンであるときだけ、元のリビジョンの本文で新しいリビジョンを作る。
6. When `create` (新規作成) の Change オペレーションを取り消す場合, the Change Proposal System shall 作ったページに子のページが無く、その Change オペレーションが作ったリビジョンがまだ最新のリビジョンであり、取り消す人がそのページを完全に削除してよいとき（5.16）だけ、そのページを完全に削除する。ごみ箱には残さない。
7. When `move` (移動) の Change オペレーションを取り消す場合, the Change Proposal System shall 移動元のパスが空いているときだけページを移動元のパスへ戻し、移動のときに作られた、移動元から移動先への転送（リダイレクト）を消す。
8. If 取り消そうとした Change オペレーションが、戻してよい条件（5.5〜5.7、5.16）を満たさない場合, then the Change Proposal System shall その Change オペレーションを書き込まずに `revert-refused` (取り消し不可) にし、断った理由を返す。
9. When 取り消しの Proposal の Change オペレーションが適用された場合, the Change Proposal System shall オリジナルの Change オペレーションを `reverted` (取り消し済み) にし、その Change オペレーションに、取り消しの Proposal の ID を記録する。
10. The Change Proposal System shall 取り消しの Proposal を、自動適用の方針と承認を通さず、取り消しを求めた時点で適用する。
11. If 取り消しの Proposal の Change オペレーションの対象が、共同編集中のページである場合, then the Change Proposal System shall その Change オペレーションを適用せずに取り消しの Proposal の中で `skipped` (スキップ) にし、オリジナルの Change オペレーションを `applied` (適用済み) のまま残して、取り消しを求めた人が後から再び求められるようにする。
12. The Change Proposal System shall 取り消しの Proposal で適用した `edit` (編集) と `move` (移動) の Change オペレーションを、通常の Proposal の Change オペレーションと同じ条件で取り消せるようにする。
13. The Change Proposal System shall 取り消しを、書き込み機能の有効化・Change オペレーションの種類ごとの有効化・件数の上限の設定にかかわらず受け付ける。
14. When ユーザーが `applied` (適用済み) の Change オペレーションを取得した場合, the Change Proposal System shall その Change オペレーションをその時点で戻せるかどうかと、戻せない場合の理由を、Proposal を取得するユーザーごとに判定して返す。
15. When 取り消しの Proposal でページを完全に削除した Change オペレーションの取り消しを求められた場合, the Change Proposal System shall ページを戻さず、その Change オペレーションを `revert-refused` (取り消し不可) にし、対象のページが無いことを理由として返す。
16. When `create` (新規作成) の Change オペレーションの取り消しでページを完全に削除する場合, the Change Proposal System shall 取り消す人が、人が画面から同じページを完全に削除するときの条件（管理者が決めた完全な削除の権限、複数のグループに公開されたページでは公開先のすべてのグループに属していること、ユーザーのホームのページでは管理者の設定と持ち主がもういないこと）と、ごみ箱へ移す権限の両方を満たすときだけ削除する。満たさないときは、その Change オペレーションを `revert-refused` (取り消し不可) にし、削除してよい権限が無いことを理由として返す。

**残っている差**（自動テストでは確かめられないこと）:
- 5.9: 取り消しの結果をオリジナルの Change オペレーションに書く処理が 3 回とも失敗すると、オリジナルの Change オペレーションは `applied` (適用済み) のまま残る。もう一度取り消しを求めれば判定し直される（research.md の決定「取り消しの結果をオリジナルの Change オペレーションに書く処理は、例外のときだけその場で 2 回までやり直す」）。
- 5.14: 管理者がユーザーページを無効にしたあと、`/user` の下に触れる `edit` (編集)・`move` (移動) の取り消しは、5.14 の判定では「戻せる」と出ても、取り消しの Proposal の Change オペレーションを適用するときに `revert-refused` (取り消し不可)（対象のページが無い）になる（research.md の決定「適用でも、人の route と同じユーザーページの保護を通す」）。

### Requirement 6: 作った Change Proposal の記録

**Objective:** 適用後の画面（`change-proposal-viewer`）を作る開発者として、どのリビジョン（`create` (新規作成) のページでは、その最初のリビジョン）がどの Proposal で作られたかを知りたい。ページ履歴や Recent Changes に印を付け、Proposal の詳細へたどれるようにするため。

#### Acceptance Criteria
1. When Change オペレーションの適用でリビジョンを作った場合, the Change Proposal System shall そのリビジョンに、作った Proposal の ID と、その Change オペレーションを指す ID を記録する。Change オペレーションを指す ID は、作成のときに Change オペレーションごとに振る乱数の ID で、並び順を表さない。
2. When `create` (新規作成) の Change オペレーションの適用でページを作った場合, the Change Proposal System shall ページそのものには記録の項目を足さず、そのページの最初のリビジョンに 6.1 の記録を付ける。
3. The Change Proposal System shall 人の保存で作られたリビジョンには、Proposal の記録を付けない。
4. The Change Proposal System shall リビジョンの上書き防止の確認に使われている既存の値（保存の出どころを表す `origin`）に新しい値を足さず、Change オペレーションの適用で作るリビジョンの `origin` を空にする。
5. The Change Proposal System shall `applied` (適用済み) の Change オペレーションを含む Proposal を、activity の保存期間とは関係なく保存し続ける。
6. The Change Proposal System shall リビジョンを返す既存の API の応答に記録の値が含まれても、そこから Proposal の中の他の Change オペレーションの数・並び順・あるかどうかが分からないようにする。
7. When `edit` (編集) の Change オペレーションを適用した場合, the Change Proposal System shall 適用した時点の対象のページのパスを、その Change オペレーションの記録に残す。ページが後で移動・削除されても、記録したパスは変えない。

**残っている差**（自動テストでは確かめられないこと）:
- 6.6・9.5: リンクを知る人だけが見られるページは、ID を知っているログイン済みの人なら誰でも読める。そのため、そのページのリビジョンを `/revisions/list` で読むと `proposalId` が見え、その Proposal を取得すると「見つからない」になるので、開けない Proposal があることは分かる。他の Change オペレーションの数や並び順は分からない。

### Requirement 7: 通知と activity

**Objective:** wiki を使う他のユーザーとして、まとめて書き換えられたときに、ページごとの大量の通知ではなく、1 つのまとまった通知で知りたい。そのとき、自分が閲覧できないページのことは知らされたくない。管理者としては、必要なら人の保存と同じページごとの通知も出せるようにしたい。Proposal 作成者としては、大きな Proposal ではページごとの通知を止められるようにしたい。

#### Acceptance Criteria
1. If Change オペレーションを適用するときに、管理者の通知設定でページごとの通知が有効になっていない場合、または Proposal のページごとの通知設定が「出さない」である場合, then the Change Proposal System shall その Change オペレーションの適用では、ページごとの通知（購読している人へのアプリ内通知と、グローバル通知）を出さない。
2. When Proposal の Change オペレーションを適用する処理が終わり、1 つ以上の Change オペレーションが `applied` (適用済み) になった場合, the Change Proposal System shall その Proposal について 1 つのアプリ内通知を、`applied` の Change オペレーションのページが人の保存で更新された場合にアプリ内通知を受け取るはずだったユーザー（Proposal 作成者を除く）に送る。
3. The Change Proposal System shall まとめたアプリ内通知の中身を、受け取るユーザーが閲覧できるページの分だけで作り、閲覧できないページのパス・タイトル・件数を含めない。
4. If 通知を受け取るはずのユーザーが、`applied` (適用済み) の Change オペレーションのページを 1 つも閲覧できない場合, then the Change Proposal System shall そのユーザーにはその Proposal の通知を送らない。
5. When Proposal の Change オペレーションを適用した場合、または取り消した場合, the Change Proposal System shall 監査ログの設定にかかわらず、それを新しい種類の activity として、Proposal 作成者または取り消した人を操作者として記録する。
6. The Change Proposal System shall 人の保存のときに出る通知と activity の振る舞いを変えない。
7. When Proposal を作成した場合, the Change Proposal System shall 監査ログの設定で記録の対象になっているときに、それを新しい種類の activity として、Proposal 作成者を操作者として記録する。
8. When 取り消しの Proposal の Change オペレーションを適用する処理が終わり、1 つ以上の Change オペレーションが `applied` (適用済み) になった場合, the Change Proposal System shall 完全に削除したページも通知の対象のページに含め、オリジナルの Proposal の作成者にも（取り消した人と同じでなければ）まとめたアプリ内通知を送る。中身は 7.3・7.4 と同じく、受け取る人が閲覧できるページの分だけで作る。ただし完全に削除したページは、誰も閲覧できないので、オリジナルの Proposal の作成者にだけ、その人が `create` (新規作成) を求めたときのパスで含める。オリジナルの Proposal の作成者への通知は、取り消しの Proposal ではなくオリジナルの Proposal を指す（オリジナルの Proposal には、その人が頼んだ Change オペレーションのすべてと、それぞれが取り消されたかどうかが記録されているため）。
9. When Proposal を作る側が、利用者の request を受けた処理の中で Proposal を作った場合, the Change Proposal System shall 作成の activity をその request の activity として記録し、作成のための activity を別に残さない。
10. When Change オペレーションを適用するときに、管理者の通知設定でページごとの通知が有効になっていて、かつ Proposal のページごとの通知設定が「出す」である場合, the Change Proposal System shall その Change オペレーションについて、人が画面から同じ操作をしたときと同じページごとの通知を出す。アプリ内通知の受け取る人は人の操作と同じ決め方で決め、グローバル通知は人の操作と同じく、ページの閲覧範囲によって送るかどうかを決める。
11. The Change Proposal System shall 人が保存のたびに Slack のチャンネルを選んで送る通知を、Change オペレーションの適用では出さない。
12. The Change Proposal System shall まとめたアプリ内通知（7.2・7.8）を、管理者の通知設定とページごとの通知設定にかかわらず送る。
13. The Change Proposal System shall ページごとの通知を出すかを、Change オペレーションごとに、その Change オペレーションを書き込む時点の管理者の通知設定とページごとの通知設定で決める。作成の直後に自動で適用する Change オペレーションには、作成のときに保存したページごとの通知設定を使う。
14. When Proposal 作成者が、ライフサイクルが `open` (進行中) の自分の Proposal について、ページごとの通知設定の変更を求めた場合, the Change Proposal System shall ページごとの通知設定を変え、変えたあとに適用する Change オペレーションにだけ使う。すでに適用した Change オペレーションについて出した通知、出さなかった通知は変えない。
15. If Proposal 作成者以外のユーザーが、ページごとの通知設定の変更を求めた場合, then the Change Proposal System shall 変えずに、Proposal が存在しない場合と同じ応答を返す。
16. If ライフサイクルが `open` (進行中) でない Proposal について、ページごとの通知設定の変更を求められた場合, then the Change Proposal System shall 変えずに、変えられない状態であることを返す。
17. When 取り消しの Proposal を作る場合, the Change Proposal System shall オリジナルの Proposal のページごとの通知設定を引き継いで保存する。
18. When Proposal 作成者が自分の Proposal を取得した場合（1 件の取得と一覧のどちらでも）, the Change Proposal System shall ページごとの通知設定と、管理者の通知設定でページごとの通知が有効になっているかどうかを返す。Proposal 作成者以外のユーザーへの応答には、どちらも含めない。
19. If 読み取り専用ユーザーが、ページごとの通知設定の変更を求めた場合, then the Change Proposal System shall それを受け付けない。

**残っている差**（自動テストでは確かめられないこと）:
- 7.10: 前の実行がページを書いたあと、ページごとの通知を送る前に止まった場合、やり直しの実行はその Change オペレーションを書き込み済みとして記録するだけなので、その Change オペレーションのページごとの通知は出ないままになる（design の Operation Handlers）。
- 7.2・7.5: Change オペレーションの適用がうまくいったあと、activity を記録する前に Proposal の読み込みが例外になると、その回の適用の activity とまとめた通知は残らず、呼び出し側には「適用中」（`in-progress`）が返る。書き込みとその結果の記録は済んでいる（tasks.md の Implementation Notes の、最終検証 4 回目の IMPORTANT）。

### Requirement 8: 管理者の設定

**Objective:** 管理者として、AI などからの書き込みを許すかどうか、どの種類の Change オペレーションを許すか、どこまで自動で適用するか、どれだけの量を許すかを決めたい。wiki 全体に対する書き込みの量と範囲を管理するため。

#### Acceptance Criteria
1. The Change Proposal System shall 書き込み機能の有効・無効を管理者が設定できるようにし、初期値を無効にする。
2. The Change Proposal System shall `edit` (編集)・`create` (新規作成)・`move` (移動) のそれぞれの種類について、Change オペレーションの有効・無効を管理者が設定できるようにする。
3. The Change Proposal System shall 自動適用の方針として「しない」「自分が作ったページだけ」「すべて」のいずれかを管理者が設定できるようにし、初期値を「しない」にする。
4. The Change Proposal System shall 1 件の Proposal あたりの Change オペレーション数の上限と、Proposal 作成者ごとの 1 日あたりの Proposal の件数の上限を、管理者が設定できるようにする。
5. When 管理者が書き込み機能を無効にした場合, the Change Proposal System shall `open` (進行中) の Proposal をすべて取り下げ、その `pending` (適用待ち) の Change オペレーションを `skipped` (スキップ) にする。
6. The Change Proposal System shall これらの設定を、管理者の設定画面から確かめ、変更できるようにする。
7. The Change Proposal System shall 管理者の設定画面の文言と、監査ログに表示する新しい activity の名前を、GROWI が対応する 5 言語（英語・日本語・中国語・フランス語・韓国語）すべてで表示する。
8. If 管理者でないユーザーが設定の変更を求めた場合, then the Change Proposal System shall 変更しない。
9. The Change Proposal System shall Change オペレーションの適用でページごとの通知を出すかどうか（管理者の通知設定）を管理者が設定できるようにし、初期値を「出さない」にする。
10. The Change Proposal System shall 1 件の Proposal あたりの Change オペレーション数の上限の初期値を 50 にし、Proposal 作成者ごとの 1 日あたりの件数の上限の初期値を「上限なし」にする。1 日あたりの件数は、管理者が上限の数を設定したときだけ確かめる（1.8）。

### Requirement 9: Change Proposal の取得と、取得するユーザーごとの絞り込み

**Objective:** Proposal を作る側と適用後の画面を作る開発者として、Proposal を取得する API がほしい。ただし、Proposal を取得するユーザーが閲覧できないページの存在は、どの応答からも分からないようにしたい（ページがもう無い Change オペレーションを、Proposal 作成者と取り消しの相手に返す場合（9.11・9.15・9.17）は除く）。

#### Acceptance Criteria
1. When ユーザーが Proposal の ID を指定して取得を求めた場合, the Change Proposal System shall Proposal 作成者・Proposal 作成元・モデル名・作成日時・全体の状態と、そのユーザーが閲覧できるページに対する Change オペレーションだけを、Change オペレーションごとの状態とともに返す。ただし、ページがもう無い Change オペレーションは、Proposal 作成者と取り消しの相手に返す（9.11・9.15）。
2. The Change Proposal System shall Proposal 作成者でも Proposal 承認者でもないユーザーには、そのユーザーに返す Change オペレーション（9.13）だけを返し、それを 1 つも含まない Proposal を返さない。そのため、そうしたユーザーに返す全体の状態は `pending` (適用待ち) や `partially-applied` (一部を適用) にならない。Proposal 承認者への返し方は Requirement 19 で定める。
3. If 指定された Proposal が存在しない場合、またはそのユーザーに返す Change オペレーションを 1 つも含まない場合, then the Change Proposal System shall どちらの場合も同じ「見つからない」応答を返す。
4. The Change Proposal System shall 応答に、そのユーザーが閲覧できない Change オペレーションの件数や、閲覧できない Change オペレーションがあることを示す情報を含めない。ただし、ページがもう無い Change オペレーションを、Proposal 作成者と取り消しの相手に返す場合（9.11・9.15・9.17）は除く。
5. The Change Proposal System shall Proposal 作成者以外のユーザーへの応答では、リンクを知る人だけが見られるページに対する Change オペレーションを含めない。
6. When ユーザーが自分の作った Proposal の一覧を求めた場合, the Change Proposal System shall 自分が Proposal 作成者である Proposal を、新しい順に、ページ送りできる形で返す。
7. When ユーザーが、自分が閲覧できるページを含む、Change オペレーションを適用した Proposal の一覧を求めた場合, the Change Proposal System shall そのユーザーに返す Change オペレーションのうち状態が `applied` (適用済み)・`reverted` (取り消し済み)・`revert-refused` (取り消し不可) のものを 1 つ以上含む Proposal を、新しい順に、ページ送りできる形で返す。Proposal 作成者以外のユーザーには、リンクを知る人だけが見られるページだけを含む Proposal を返さない。
8. When ユーザーがリビジョンの ID の一覧を指定して、それらを作った Proposal を求めた場合, the Change Proposal System shall そのリビジョンを作った Change オペレーションがそのユーザーに返す Change オペレーションであるときだけ、作った Proposal の ID と、それが取り消しで作られたかどうかを返す。
9. If 読み取り専用ユーザーが、Proposal の作成・承認・スキップ・破棄・取り消し・却下・放棄・Proposal 承認者の追加と削除を求めた場合, then the Change Proposal System shall それを受け付けない。
10. The Change Proposal System shall Proposal 作成者以外のユーザーに返す「最後に適用した日時」を、1 件の取得でも一覧でも、そのユーザーに返す Change オペレーションの適用の日時だけから決める。
11. The Change Proposal System shall Proposal 作成者には、閲覧できるページに対する Change オペレーションに加えて、まだページが無い `create` (新規作成) の Change オペレーションと、対象のページが完全に削除されてもう無い Change オペレーションも返す。
12. The Change Proposal System shall Proposal 承認者には、`applied` (適用済み)・`reverted` (取り消し済み)・`revert-refused` (取り消し不可) の Change オペレーションを 9.13 と同じ決まりで返す。`pending` (適用待ち)・`failed` (適用失敗)・`stale` (見送り)・`skipped` (スキップ) の Change オペレーションは、承認権限チェックを通ったときだけ返す。
13. The Change Proposal System shall Proposal 作成者でも Proposal 承認者でもないユーザーには、閲覧できるページ（リンクを知る人だけが見られるページを除く）に対する Change オペレーションのうち、`applied` (適用済み)・`reverted` (取り消し済み)・`revert-refused` (取り消し不可) のものだけを返す。`pending` (適用待ち)・`failed` (適用失敗)・`stale` (見送り)・`skipped` (スキップ) の Change オペレーションは返さない。
14. The Change Proposal System shall 9.11〜9.13 でどの Change オペレーションを返すかを、Proposal のライフサイクル（`open` (進行中)・`settled` (完了)・`discarded` (破棄)・`expired` (期限切れ)・`withdrawn` (取り下げ)）によって変えない。
15. If Change オペレーションの対象のページがもう存在しない場合, then the Change Proposal System shall その Change オペレーションを、Proposal 作成者のほかに取り消しの相手にも返す。オリジナルの Proposal の Change オペレーションは、その Change オペレーションを取り消した取り消しの Proposal の作成者に返す。取り消しの Proposal の Change オペレーションは、オリジナルの Proposal の作成者に返す。取り消しの相手には、`applied` (適用済み)・`reverted` (取り消し済み)・`revert-refused` (取り消し不可) の Change オペレーションだけを返す。Proposal 作成者でも取り消しの相手でもないユーザーには、Proposal 承認者であっても返さない。取り消しの相手に返すのは表示のためである。取り消しの相手が取り消しを求めたときの対象には、この Change オペレーションを入れない（取り消しの対象は 5.2〜5.4 のとおり、閲覧できるページの Change オペレーションから選ぶ。Proposal 作成者の扱いも変えない）。この決まりも、Proposal のライフサイクルによって変えない。
16. When 取り消しの Proposal の `delete-completely` (完全な削除) の Change オペレーションを返す場合, the Change Proposal System shall 削除したページのパスとして、その Change オペレーションが取り消したオリジナルの `create` (新規作成) の Change オペレーションのパスを付けて返す。
17. When ページがもう無い Change オペレーションを Proposal 作成者または取り消しの相手に返す場合, the Change Proposal System shall 1 件の取得の Change オペレーションと、一覧の要約のページの一覧の両方で、そのページのパスを Change オペレーションの記録から決めて返す。`create` (新規作成) は作るときのパス、`move` (移動) は移動先のパス、`delete-completely` (完全な削除) は 9.16 のパス、`edit` (編集) は 6.7 で記録したパスとする。記録にパスが無い Change オペレーションは、一覧の要約のページの一覧に、パスを付けずにページの ID だけで入れる。ページがもう無い Change オペレーションのパスと ID は、Proposal 作成者と取り消しの相手のほかには返さない。

**今の制限**（決まった扱いがまだ無いこと）:
- 9.17: 6.7 の記録を始める前に適用した `edit` (編集) の Change オペレーションは、記録にパスを持たない。そのような Change オペレーションは、ページがもう無いと、1 件の取得ではパスの無い Change オペレーションとして返り、一覧の要約のページの一覧にはパスの無い項目（ページの ID だけ）として入る。画面は、どちらでもパスの代わりに「ページはもうありません」と出す。

**残っている差**（自動テストでは確かめられないこと）:
- 9.15: 取り消しの結果をオリジナルの Change オペレーションに書く処理が 3 回とも失敗すると（5.9 の残っている差）、オリジナルの Change オペレーションは、取り消した Proposal の ID を持たないまま `applied` (適用済み) で残る。そのため、`create` (新規作成) を取り消した人は、オリジナルの Proposal のその Change オペレーションを（ページがもう無いので）見られない。また、取り消しの Proposal の適用では、取り消しの Change オペレーションの結果を書いてから、オリジナルの Change オペレーションに印を書く（`proposal-applier.ts` の `applyOne`）。その 2 つの書き込みの間に取り消した人がオリジナルの Proposal を取得すると、ページが消えた `create` の Change オペレーションはまだ印を持たないので返らない（ほかに見える Change オペレーションが無ければ「見つからない」）。取り消しの結果が応答に入っている場合は、応答の前に両方の書き込みが終わっているので、これは起きない。
- 9.7: Change オペレーションを適用した Proposal の一覧の続きの位置（cursor）は「時刻-ID」の平文なので、最後に読んだ文書が、取得するユーザーに見えない Proposal のとき、その ID と最後に適用した時刻が分かる。パス・件数・中身は分からない。また、一覧は保存した最後の適用の日時の順に読むので、見えない Change オペレーションがあとから適用されたことが、並び順の食い違いから分かることがある（design の Security Considerations の「対策せずに受け入れる危険」）。

### Requirement 10: 人の保存への影響

**Objective:** 普段エディタや画面からページを保存するユーザーとして、Change Proposal の仕組みが入っても、今までどおりに保存できてほしい。

#### Acceptance Criteria
1. The Change Proposal System shall 人がエディタや画面から保存したときの、上書き防止の確認・activity・通知・共同編集の同期の振る舞いを変えない。
2. The Change Proposal System shall ページの作成・更新・移動の既存の API の、入力と応答の形を変えない。
3. When 書き込み機能が無効である場合, the Change Proposal System shall 人の保存・作成・移動の振る舞いに一切影響を与えない。

### Requirement 11: 兄弟の spec の画面で共通に使う部品

**Objective:** 適用後の画面とチャット画面（`change-proposal-viewer` と `change-proposal-ai-agent`）を作る開発者として、Change オペレーションの種類・状態・理由の表示名と差分の見た目を、1 か所で決めたものとして使いたい。画面ごとに言葉や見た目が食い違わないようにするため。

#### Acceptance Criteria
1. The Change Proposal System shall Change オペレーションの種類・Change オペレーションの状態・全体の状態・理由・戻せない理由のそれぞれについて、値ごとの表示名を、GROWI が対応する 5 言語すべてで用意する。
2. The Change Proposal System shall 1 の表示名を、値から表示名の翻訳キーを引く表として、兄弟の spec の画面から import できる形で提供する。値の型に含まれるすべての値に表示名があることを、型の検査で確かめられるようにする。
3. The Change Proposal System shall Proposal の本文の差分を、ページ履歴の差分と同じ diff2html の設定と見た目で表示するための部品を、兄弟の spec の画面から import できる形で提供し、ページ履歴の差分もそれを使う。ページ履歴の差分の見た目は変えない。
4. The Change Proposal System shall Proposal のライフサイクル・つながりの関係（`follow-up` (後続)・`rework` (見直し)・オリジナル）の表示名と、適用率を表す文言を、11.1 と同じく 5 言語で用意し、11.2 と同じ形で兄弟の spec の画面から使えるようにする。
5. The Change Proposal System shall 状態 `stale` (見送り) の表示名を、対応が要る誤りではなく、ページが先に変わっていたために見送ったことが分かる言葉（日本語では「見送り（ページが先に変わっていた）」）にする。ライフサイクル `discarded` (破棄) と全体の状態 `discarded` の表示名は、残りの Change オペレーションを適用せずに閉じたことが分かる言葉（日本語では「残りを反映せずに閉じた」）にする。

### Requirement 12: 完了と適用率

**Objective:** Proposal 作成者として、自分の Proposal が終わったかどうかと、頼んだ変更のうちどれだけが適用されたかを知りたい。残りをどうするかを決めるため。

#### Acceptance Criteria
1. When Proposal 作成者が自分の Proposal を取得した場合（1 件の取得と一覧のどちらでも）, the Change Proposal System shall その Proposal のライフサイクルと適用率を返す。
2. The Change Proposal System shall 適用率を、一度は適用された Change オペレーションの数と、全体の Change オペレーションの数から Proposal 作成者が適用しないことを選んだ Change オペレーションの数を引いた数、の 2 つの数として返す。
3. The Change Proposal System shall 取り消しの Proposal には、適用率を返さない。
4. The Change Proposal System shall Proposal のライフサイクルと適用率を、Proposal 作成者以外のユーザーへの応答に含めない。

### Requirement 13: `follow-up` (後続) と `rework` (見直し) の Change Proposal

**Objective:** Proposal を作る側の機能を作る開発者として、適用されなかった Change オペレーションをもう一度試す Proposal と、適用された内容を考え直す Proposal を、オリジナルの Proposal に結び付けて作りたい。Proposal 作成者が、どの Proposal から続いたものかをたどれるようにするため。

#### Acceptance Criteria
1. Where Proposal を作る側が作成の求めに、オリジナルの Proposal の ID・関係（`follow-up` (後続) または `rework` (見直し)）・オリジナルの Change オペレーションの一覧を指定した場合, the Change Proposal System shall それを Proposal とともに保存する。Proposal 作成元にかかわらず保存する。
2. If 指定されたオリジナルの Proposal が存在しない場合、作成を求めたユーザーが、オリジナルの Proposal の作成者と違う場合、またはオリジナルの Proposal が取り消しの Proposal である場合, then the Change Proposal System shall その Proposal を保存せず、どの場合も同じ「オリジナルの Proposal を使えない」結果を返す。
3. If オリジナルの Change オペレーションが 1 つも指定されていない場合、指定されたオリジナルの Change オペレーションがオリジナルの Proposal に無い場合、またはオリジナルの Change オペレーションの状態が関係に合わない場合, then the Change Proposal System shall その Proposal を保存せず、合わない Change オペレーションを示す結果を返す。関係に合う状態は、`follow-up` (後続) では `stale` (見送り)・`failed` (適用失敗)・`skipped` (スキップ)、`rework` (見直し) では `applied` (適用済み)・`revert-refused` (取り消し不可) とする。
4. Where 関係が `rework` (見直し) である場合, the Change Proposal System shall 自動適用の方針にかかわらず、作成の直後にどの Change オペレーションも適用せず、すべてを `pending` (適用待ち) のまま、Proposal 作成者または Proposal 承認者の承認を待たせる。
5. The Change Proposal System shall `follow-up` (後続) Proposal・`rework` (見直し) Proposal を作ったときも、その Change オペレーションを適用したときも、オリジナルの Change オペレーションの状態を変えない。
6. The Change Proposal System shall オリジナルの Change オペレーションを `reverted` (取り消し済み) にするのを、取り消しの Proposal の Change オペレーションの適用（Requirement 5）だけにする。`rework` (見直し) Proposal の Change オペレーションの適用では `reverted` にしない。
7. Where 関係が `follow-up` (後続) である場合, the Change Proposal System shall 自動適用と承認を、通常の Proposal と同じに扱う。`follow-up` (後続) Proposal・`rework` (見直し) Proposal がオリジナルの Proposal の Proposal 承認者の指定を引き継ぐことと、Proposal 作成者以外の Proposal 承認者がいるときに作成の直後に適用しないことは、Requirement 22.4・22.5 による。

### Requirement 14: つながりの取得と、取得するユーザーごとの絞り込み

**Objective:** 適用後の画面とチャット画面を作る開発者として、ある Proposal から、その `follow-up` (後続) Proposal・`rework` (見直し) Proposal と、オリジナルの Proposal へたどれる情報がほしい。ただし、Proposal を取得するユーザーが閲覧できないページの存在は、つながりからも分からないようにしたい。

#### Acceptance Criteria
1. When ユーザーが Proposal を 1 件取得した場合, the Change Proposal System shall 返す Change オペレーションごとに、その Change オペレーションをオリジナルの Change オペレーションとして指す `follow-up` (後続) Proposal・`rework` (見直し) Proposal の ID と関係を返す。
2. When ユーザーが `follow-up` (後続) Proposal・`rework` (見直し) Proposal を 1 件取得した場合, the Change Proposal System shall オリジナルの Proposal の ID と関係と、オリジナルの Change オペレーションのうちそのユーザーに返す Change オペレーションの key を返す。
3. If Proposal 作成者以外のユーザーがつながった先の Proposal を取得すると「見つからない」になる場合, then the Change Proposal System shall そのつながりを返さない。
4. The Change Proposal System shall Proposal 作成者以外のユーザーに、そのユーザーに返さないオリジナルの Change オペレーションの key と、その数を返さない。
5. If Proposal 作成者以外のユーザーに返すオリジナルの Change オペレーションの key が 1 つも無い場合, then the Change Proposal System shall オリジナルの Proposal へのつながりを返さない。

### Requirement 15: Proposal 承認者と Proposal の目的の指定

**Objective:** Proposal 作成者として、Proposal を作るときに、承認してほしい人（ユーザーとグループ）と、Proposal の目的を伝えたい。Proposal 承認者が、何のための変更かを分かってレビューできるようにするため。

#### Acceptance Criteria
1. When Proposal を作る側が Proposal の作成を求めるときに Proposal 承認者を指定した場合, the Change Proposal System shall Proposal 承認者の指定を Proposal とともに保存する。
2. The Change Proposal System shall Proposal 承認者の指定として、複数のユーザー、複数のユーザーグループ、およびその混在を受け付ける。
3. The Change Proposal System shall Proposal 作成者自身を、Proposal 承認者として指定することを受け付ける。
4. Where 作成のときに Proposal 承認者が指定されなかった場合, the Change Proposal System shall Proposal 作成者だけを Proposal 承認者とみなす。そのため、Proposal 承認者を指定しない Proposal 作成元から作った Proposal は、Proposal 作成者だけが承認する。
5. If Proposal 承認者に指定されたユーザーまたはグループが存在しない場合、または指定されたユーザーが有効な状態でない場合（未承認・停止中・削除済み・招待中）, then the Change Proposal System shall その Proposal を保存せず、受け付けない理由を返す。
6. If Proposal 承認者の指定に、同じユーザーまたは同じグループが重ねて含まれている場合, then the Change Proposal System shall 重ねた分を 1 つにまとめて保存する。
7. If Proposal 承認者の指定の数が、決められた上限を超える場合, then the Change Proposal System shall その Proposal を保存せず、上限を超えたことを返す。上限の値は設計で決め、管理者の設定にはしない。
8. When Proposal を作る側が Proposal の作成を求めるときに Proposal の目的を指定した場合, the Change Proposal System shall それを Proposal とともに保存する。
9. If Proposal の目的が決まった文字数を超える場合, then the Change Proposal System shall その Proposal を保存せず、文字数を超えたことを返す。
10. The Change Proposal System shall Proposal の目的を、書式や HTML として解釈せず、文字のまま返す。
11. When Proposal 承認者の指定に、Proposal 作成者以外のユーザーまたはグループが 1 つ以上含まれる Proposal が作られた場合, the Change Proposal System shall 自動適用の方針にかかわらず、作成の直後にどの Change オペレーションも適用せず、すべてを `pending` (適用待ち) のまま承認を待たせる。

### Requirement 16: Proposal 承認者による承認

**Objective:** Proposal 承認者または Proposal 作成者として、自分が閲覧できるページの Change オペレーションを確かめて承認したい。Proposal 作成者が不在でも、承認を進めるため。

#### Acceptance Criteria
1. When Proposal 承認者または Proposal 作成者が、`open` (進行中) の Proposal の中で 1 つ以上のページを選んで承認した場合, the Change Proposal System shall 選ばれたページに対する、そのユーザーが承認できる Change オペレーションを適用する。Proposal 承認者が承認できるのは、承認権限チェックを通った `pending` (適用待ち) の Change オペレーションとする。Proposal 作成者が承認できるのは、Proposal 作成者に返す Change オペレーションのうち `pending` のものとする。
2. When Proposal 承認者または Proposal 作成者が、`open` (進行中) の Proposal 全体の承認を求めた場合, the Change Proposal System shall そのユーザーが承認できる Change オペレーション（16.1）をすべて適用する。そのユーザーが閲覧できないページの Change オペレーションは適用しない。
3. The Change Proposal System shall Proposal 作成者が、Proposal 承認者として指定されていなくても、いつでも自分の Proposal を承認できるようにする。
4. Where Proposal 承認者の指定にグループが含まれている場合, the Change Proposal System shall そのグループに所属する Proposal 承認者の誰か 1 人が承認すれば、その Change オペレーションを適用する。同じグループに所属する別の Proposal 承認者の承認を重ねて求めない。
5. When 複数の Proposal 承認者が、同じ Change オペレーションの承認やレビューを同時に求めた場合, the Change Proposal System shall その Change オペレーションを 1 回だけ適用し、同じ Change オペレーションを二度書き込まない。後から処理された求めには、そのユーザーに見える `pending` (適用待ち) の Change オペレーションが残っている限り、その時点の Change オペレーションの状態を返す。
6. If Proposal 承認者が、自分が閲覧できないページの Change オペレーションのレビューを求めた場合, then the Change Proposal System shall それを受け付けず、そのページの Change オペレーションが存在しない場合と同じ応答を返す。
7. If Proposal 承認者でも Proposal 作成者でもないユーザー、または Proposal 承認者であってもそのユーザーに返す Change オペレーションが 1 つも無いユーザーが、`open` (進行中) の Proposal のレビュー・Proposal 承認者の追加・Proposal 承認者の削除を求めた場合, then the Change Proposal System shall それを受け付けず、Proposal が存在しない場合と同じ応答を返す。
8. When 承認によって Change オペレーションが適用された場合, the Change Proposal System shall その Change オペレーションに、承認した人、日時、経路（画面・API・AI の道具などのどこから承認したか）、承認した人が Proposal 作成者自身であるか、を記録する。
9. If `expired` (期限切れ)・`discarded` (破棄)・`withdrawn` (取り下げ)・`settled` (完了) になった Proposal の承認またはレビューを求められた場合, then the Change Proposal System shall 2.10、4.7 と同じように、Change オペレーションを適用せず、適用できない状態であることを返す。
10. When 承認によって適用しようとした Change オペレーションが、共同編集中のページだったために `pending` (適用待ち) のまま残った場合, the Change Proposal System shall 4.8 と同じように、その Change オペレーションを承認を待つものとして扱い、Proposal 承認者または Proposal 作成者が後から再び承認できるようにする。
11. If すでに状態が `pending` (適用待ち) でない Change オペレーション（`applied` (適用済み)、`skipped` (スキップ)、など）の承認またはレビューが求められた場合, then the Change Proposal System shall 書き込まず、そのユーザーに見える `pending` の Change オペレーションが残っている限り、その時点の Change オペレーションの状態を返す。そのユーザーに見える `pending` の Change オペレーションが残っていない場合は、16.9 と同じ、適用できない状態であることを返す。

### Requirement 17: 却下と放棄

**Objective:** Proposal 承認者として、この変更には賛成できない、という意見を理由とともに Proposal 作成者へ伝えたい。また、自分にはレビューできないページがあることを伝えたい。Proposal 作成者や他の Proposal 承認者が、次にどうするかを決められるようにするため。却下と放棄は、意見の記録と通知であり、Change オペレーションの状態や承認を変えない。

#### Acceptance Criteria
1. When Proposal 承認者が、承認権限チェックを通った `pending` (適用待ち) の Change オペレーションの却下を求めた場合, the Change Proposal System shall 却下した人・日時・コメントを、その Change オペレーションについての却下の記録として残す。Change オペレーションの状態は変えない。
2. When Proposal 承認者が、`open` (進行中) の Proposal 全体の却下を求めた場合, the Change Proposal System shall 却下した人・日時・コメントを、Proposal 全体についての却下の記録として残す。各 Change オペレーションの状態は変えない。
3. When Proposal 承認者が、承認権限チェックを通った `pending` (適用待ち) の Change オペレーションの放棄を求めた場合, the Change Proposal System shall 放棄した人・日時・コメントを、その Change オペレーションについての放棄の記録として残す。Change オペレーションの状態は変えない。放棄した Change オペレーションも、承認権限チェックを通った `pending` (適用待ち) のままなので、その Proposal 承認者は引き続きレビューできる。
4. When 同じ人が、同じ Change オペレーション（または Proposal 全体）について、却下・放棄の記録を残したあと、あとから承認または別のレビューを求めた場合, the Change Proposal System shall 前の記録を、あとのレビューで置き換える。
5. When 却下または放棄を求めるときにコメントが添えられた場合, the Change Proposal System shall そのコメントを、レビューの記録とともに残す。
6. If コメントが決まった文字数を超える場合, then the Change Proposal System shall レビューを記録せず、文字数を超えたことを返す。
7. The Change Proposal System shall コメントを、書式や HTML として解釈せず、文字のまま返す。
8. The Change Proposal System shall Change オペレーションごとの却下と放棄の記録（コメントを含む）を、Proposal 作成者と、その Change オペレーションのページを閲覧できる Proposal 承認者にだけ返す。Proposal 全体の却下の記録は、Proposal 作成者にだけ返す。
9. The Change Proposal System shall 却下と放棄の記録によって、Change オペレーションの状態、承認できるかどうか、適用、Proposal のライフサイクル、適用率を変えない。ほかの Proposal 承認者または Proposal 作成者が、却下された Change オペレーションを承認した場合は、通常どおり適用する。
10. If Proposal 作成者が、自分の Proposal の Change オペレーションの却下または放棄を求めた場合, then the Change Proposal System shall それを受け付けない。Proposal 作成者は「スキップ」と「破棄」（2.3・2.4）を使う。
11. If Proposal 承認者でも Proposal 作成者でもないユーザーが、却下または放棄を求めた場合, then the Change Proposal System shall Requirement 16.7 と同じ応答を返す。

### Requirement 18: Proposal 承認者の追加と削除

**Objective:** Proposal 作成者または Proposal 承認者として、正しいレビュー先を足したり、不要な人を外したりしたい。Proposal 作成者が誰に頼めばよいか分からないときに、身近な人に頼み、その人が正しいレビュー先を追加できるようにするため。

#### Acceptance Criteria
1. When Proposal 作成者または Proposal 承認者が、`open` (進行中) の Proposal に、Proposal 承認者としてユーザーまたはユーザーグループを追加した場合, the Change Proposal System shall その Proposal 承認者の指定を保存する。
2. The Change Proposal System shall Proposal 承認者を追加するときに、複数のユーザー、複数のグループ、およびその混在を受け付ける。
3. When Proposal 作成者または Proposal 承認者が、`open` (進行中) の Proposal から、Proposal 承認者の指定を削除した場合, the Change Proposal System shall その指定を外す。削除できるのは、誰が追加した指定でも、自分自身の指定でもよい。
4. When Proposal 承認者の指定が 1 つも残らなくなった場合, the Change Proposal System shall Proposal 作成者だけを Proposal 承認者とみなす（Requirement 15.4 と同じ）。
5. If Proposal 承認者として追加しようとしたユーザーまたはグループが存在しない場合、または追加しようとしたユーザーが有効な状態でない場合（未承認・停止中・削除済み・招待中）, then the Change Proposal System shall 追加せず、受け付けない理由を返す。
6. If 追加しようとしたユーザーまたはグループがすでに Proposal 承認者として指定されている場合, then the Change Proposal System shall 何も変えずに成功として返す。
7. If 削除しようとしたユーザーまたはグループが、Proposal 承認者として指定されていない場合, then the Change Proposal System shall 何も変えずに成功として返す。
8. If ライフサイクルが `open` (進行中) でない Proposal について、Proposal 承認者の追加または削除を求められた場合, then the Change Proposal System shall 変えず、変えられない状態であることを返す。
9. If 追加したあとの Proposal 承認者の指定の数が、Requirement 15.7 の上限を超える場合, then the Change Proposal System shall 追加せず、上限を超えたことを返す。
10. When Proposal 承認者の指定が追加または削除された場合, the Change Proposal System shall 追加または削除した人と日時を、指定ごとに記録する。
11. When Proposal 承認者の指定が追加された場合, the Change Proposal System shall Requirement 20 の通知を、新しく Proposal 承認者になったユーザーに送る。追加によって、追加されたユーザーが閲覧できないページの存在は分からない。
12. When Proposal 承認者の指定が削除された場合, the Change Proposal System shall すでに記録された、そのユーザーの承認・却下・放棄の記録を変えない。

### Requirement 19: `open` (進行中) の Change Proposal の見え方

**Objective:** Proposal 承認者として、自分に承認が頼まれている Proposal を、見つけて確かめたい。見つけられないと、承認が溜まってしまうため。

#### Acceptance Criteria
1. When Proposal 作成者または Proposal 承認者が、`open` (進行中) の Proposal の取得を求めた場合, the Change Proposal System shall Proposal 作成者・Proposal 作成元・モデル名・作成日時・全体の状態・Proposal の目的と、そのユーザーが閲覧できるページに対する Change オペレーションだけを、Change オペレーションごとの状態とともに返す。
2. When Proposal 承認者が、`open` (進行中) の Proposal の取得を求めた場合, the Change Proposal System shall 承認権限チェックを通った `pending` (適用待ち) の Change オペレーションについて、変更後の本文（差分を作るための内容）、元のリビジョン、その元のリビジョンが今も最新かどうか、並び順を返す。
3. The Change Proposal System shall Proposal 作成者でも Proposal 承認者でもないユーザーには、`pending` (適用待ち) の Change オペレーションを返さない。
4. If Proposal 承認者が、`open` (進行中) の Proposal を取得しようとしたときに、そのユーザーに返す Change オペレーションが 1 つも無い場合, then the Change Proposal System shall Proposal が存在しない場合と同じ「見つからない」応答を返す。
5. When ユーザーが、自分が Proposal 承認者である `open` (進行中) の Proposal の一覧を求めた場合, the Change Proposal System shall 承認権限チェックを通った `pending` (適用待ち) の Change オペレーションを 1 つ以上含む `open` の Proposal を、作成が古い順（期限は作成時に決まるので、期限が近い順と同じになる）に、ページ送りできる形で返す。
6. The Change Proposal System shall Proposal 承認者に返す Change オペレーションを、そのユーザーが閲覧できるページ（リンクを知る人だけが見られるページを除く）に対する Change オペレーションだけにする。閲覧できない Change オペレーションの件数や、閲覧できない Change オペレーションがあることを示す情報を含めない。
7. The Change Proposal System shall Proposal 承認者への応答に、Proposal 承認者の指定の一覧（ユーザーの名前とグループの名前）、承認・却下・放棄した人、Proposal 承認者を追加・削除した人を含める。ただし、そのユーザーが見られないページの存在を示す情報は含めない。
8. The Change Proposal System shall Proposal 作成者にだけ返している内容（Proposal のライフサイクルと適用率、ページごとの通知設定、AI が書いた要約や会話、Proposal を作る側が用意する Proposal 作成者向けの内容など）を、Proposal 承認者には返さない。Proposal の目的は、Proposal 承認者にも返す。
9. While あるユーザーが、Proposal 承認者に指定されたグループに所属していることによって Proposal 承認者である場合, the Change Proposal System shall 所属が外れたあとは、そのユーザーを Proposal 承認者として扱わない。
10. The Change Proposal System shall 状態が `applied` (適用済み)・`reverted` (取り消し済み)・`revert-refused` (取り消し不可) の Change オペレーションのうちどれを返すか（9.1・9.7）を、そのユーザーが Proposal 承認者であるかどうかによって変えない。

### Requirement 20: Proposal 承認者と Proposal 作成者への通知と、レビューの記録

**Objective:** Proposal 承認者として、自分に承認が頼まれたことに気付きたい。Proposal 作成者として、Proposal 承認者のレビューの結果とコメントを知りたい。レビューの結果が届かないと、Proposal 作成者は次の手を打てないため。

#### Acceptance Criteria
1. When Proposal 承認者の指定がある Proposal がライフサイクル `open` (進行中) として作られた場合、または Proposal 承認者の指定が追加された場合, the Change Proposal System shall 新しく Proposal 承認者になった個人のユーザーに、アプリ内通知を送る。
2. The Change Proposal System shall Proposal 承認者に指定されたグループに所属するユーザーには、個別の通知を送らない。グループに所属するユーザーは、レビュー待ちの一覧（Requirement 19.5）で見つける。
3. The Change Proposal System shall Proposal 承認者への通知の中身を、受け取るユーザーが閲覧できるページの分だけで作り、閲覧できないページのパス・タイトル・件数を含めない。
4. If 通知を受け取るはずのユーザーに、承認権限チェックを通った `pending` (適用待ち) の Change オペレーションが 1 つも無い場合, then the Change Proposal System shall そのユーザーにはその通知を送らない。
5. When Proposal 承認者が、承認・却下・放棄を求め、その求めが受け付けられた場合, the Change Proposal System shall 1 回の求めにつき 1 件のアプリ内通知を、Proposal 作成者に送る。中身は、レビューした人、各 Change オペレーションの結果、添えられたコメント、Proposal の詳細ページへのリンクにする。
6. The Change Proposal System shall Proposal 作成者自身が行った承認については、Proposal 作成者に通知を送らない。
7. The Change Proposal System shall Change オペレーションの適用のあとのまとめたアプリ内通知（7.2・7.8）の宛先と中身を、Proposal 承認者がいるかどうかにかかわらず同じ決め方で作る。
8. When 承認・却下・放棄が行われた場合, the Change Proposal System shall それを新しい種類の activity として、承認・却下・放棄をした人を操作者として、経路（画面・API・AI の道具のどこから求めたか）とともに、監査ログの設定にかかわらず記録する。
9. When 承認によって Change オペレーションが適用された場合, the Change Proposal System shall 承認した人を、承認の activity（20.8）と、Change オペレーションに残る記録（承認した人・経路・日時）に残す。適用の activity の記録は変えない（1 回の適用の処理が、複数の人の承認をまとめて書くことがあるため）。
10. When Proposal 承認者の指定が追加または削除された場合, the Change Proposal System shall それを新しい種類の activity として、追加または削除した人を操作者として、経路とともに、監査ログの設定にかかわらず記録する。誰を追加・削除したかは、Proposal の中の記録（18.10）で分かる。作成のときの Proposal 承認者の指定は、作成の activity（7.7）に含まれ、別には記録しない。

### Requirement 21: Proposal 承認者の承認で適用するときの権限と作者

**Objective:** 管理者として、Proposal 承認者に指定されたことで、書き込める範囲が増えないようにしたい。承認の仕組みが権限の抜け道にならないようにするため。

#### Acceptance Criteria
1. When Proposal 承認者の承認によって Change オペレーションを適用する場合, the Change Proposal System shall 書き込む権限を、3.6 と同じように、Proposal 作成者についてその時点で確かめる。
2. When Proposal 承認者の承認によって Change オペレーションを適用する場合, the Change Proposal System shall 作るリビジョンとページの作者を、3.10 と同じように Proposal 作成者にする。
3. If 適用しようとした時点で、Proposal 作成者が対象のページに書き込む権限を持たない場合、または Proposal 作成者が読み取り専用ユーザーや使えないユーザーになっている場合, then the Change Proposal System shall 3.6 と同じように、その Change オペレーションを書き込まずに `failed` (適用失敗) にする。Proposal 承認者の権限では書き込まない。
4. The Change Proposal System shall Proposal 承認者に指定されたことを、ページを閲覧する権限・編集する権限・管理者の設定のどれにも影響させない。
5. If 読み取り専用ユーザーまたはゲストが、承認・レビュー・Proposal 承認者の追加と削除を求めた場合, then the Change Proposal System shall 9.9 と同じように、それを受け付けない。
6. The Change Proposal System shall 承認による Change オペレーションの適用に、Requirement 3（元のリビジョンの確認、共同編集中のページ、並び順、二重書き込みの防止、人の保存との競合）をそのまま当てはめる。
7. When 管理者が書き込み機能を無効にした場合, the Change Proposal System shall 8.5 と同じように、Proposal 承認者の指定がある Proposal を含めて、`open` (進行中) の Proposal をすべて取り下げる。

### Requirement 22: Proposal 承認者を指定しない使い方、`follow-up` (後続)・`rework` (見直し) との関係、表示名

**Objective:** 管理者と Proposal 作成者として、Proposal 承認者を指定しない Proposal が、Proposal 作成者だけで承認する形のまま動いてほしい。また、Proposal 承認者がいる Proposal を直して出し直しても、Proposal 承認者が外れないでほしい。

#### Acceptance Criteria
1. The Change Proposal System shall Proposal 承認者を指定していない Proposal（作成のときに指定されなかったものと、Proposal 承認者の指定の記録を持たないもの）では、Proposal 作成者だけが承認・スキップ・破棄でき、`pending` (適用待ち) の Change オペレーションは Proposal 作成者にだけ返す。
2. The Change Proposal System shall 自動適用の方針（「しない」「自分が作ったページだけ」「すべて」）の意味を、Proposal 承認者がいるかどうかで変えない。「自分が作ったページだけ」の「自分」は、Proposal 作成者を指す。
3. The Change Proposal System shall ページごとの通知設定の変更を、Proposal 作成者だけに許す（7.14・7.15）。
4. When Proposal 作成者が、Proposal 承認者の指定がある Proposal をオリジナルの Proposal にして `follow-up` (後続) Proposal または `rework` (見直し) Proposal を作った場合, the Change Proposal System shall オリジナルの Proposal の、その時点の Proposal 承認者の指定を引き継いで保存する。Proposal 作成者は、作成のときに Proposal 承認者を指定し直すこともできる。
5. Where `follow-up` (後続) Proposal または `rework` (見直し) Proposal の Proposal 承認者の指定に、Proposal 作成者以外が含まれる場合, the Change Proposal System shall Requirement 15.11 と同じように、作成の直後にどの Change オペレーションも適用せず、すべてを `pending` (適用待ち) のまま承認を待たせる。
6. The Change Proposal System shall Proposal 承認者を指定しない Proposal 作成元（`revert` (取り消し) を含む）の振る舞いを、Proposal 承認者の機能があっても、Proposal 作成者だけが承認する形のままにする。
7. The Change Proposal System shall Proposal 承認者、承認、却下、放棄、コメント、Proposal の目的についての新しい表示名と、Proposal 承認者に関する新しい activity の名前を、GROWI が対応する 5 言語（英語・日本語・中国語・フランス語・韓国語）すべてで表示する。
