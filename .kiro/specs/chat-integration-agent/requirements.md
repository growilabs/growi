# Requirements Document

## Introduction

umbrella spec `chat-integration` のコマンドを `search`・`create-page`・`agent` の 3 つに再編する amend spec。

`agent` は、チャットの利用者の依頼を、紐付けた GROWI ユーザーとして GROWI の AI Agent に渡し、答えを本人にだけ届ける。
会話を原文のままページにする `keep`（要件 5）は廃止し、`agent` が会話を要約してページにする形に置き換える。
あわせて、通知を書き留めた直後に送り、通知の定期処理の間隔を延ばす。

背景・採った方針・実現性の確認の結果は、同じディレクトリの `brief.md` にある。

以下、中継サーバを **chat-integration proxy**、GROWI 本体を **GROWI application** と呼ぶ（umbrella と同じ）。

### Amend target

| 対象の spec | 変わる契約 |
|---|---|
| `chat-integration`（umbrella） | Out of scope の決定 4（LLM を使った、自由な文章からのページ作成）を撤回する。要件 5 を置き換える。要件 1・2・11・14 に受け入れ条件を足す。要件 15 を新しく足す |
| `chat-integration-protocol` | コマンドの語彙から `keep` を外し、`agent` を足す。GROWI application が、受け付けた依頼の答えをあとから chat-integration proxy へ送る口を足す |
| `chat-integration-proxy` | コマンドの組、`agent` の答えの届け方、Slack の AI アプリの画面での受け答え、能力表 |
| `chat-integration-app` | `agent` の処理、会話の要約をページにする処理、答えをあとから送る処理、`keep` の処理の削除、ヘルプの内容、通知を直後に送る処理と定期処理の間隔 |

再検証が必要になる条件への影響: protocol の契約が変わるので、proxy と app の両方を確かめ直す
（umbrella の roadmap.md の Constraints「契約の変更は 3 spec すべてに効く」）。

### 番号の扱い

既存の番号は振り直さない。新しい受け入れ条件は、各要件の末尾に足す。

| 要件 | 足す番号 | 備考 |
|---|---|---|
| 1 | 1.20〜1.22 | |
| 2 | 2.10・2.11 | この spec のために空けてあった番号 |
| 5 | 5.7〜5.18 | 5.1〜5.6 は廃止する。番号は欠番として残し、ほかの受け入れ条件に使い回さない |
| 11 | 11.6〜11.8 | |
| 14 | 14.6 | |
| 15 | 15.1〜15.20 | 新しい要件 |

書き戻した後の有効な受け入れ条件は 164 件になる（今の 129 件 − 廃止 6 件 ＋ 追加 41 件）。要件は 15 件になる。

### 既存の受け入れ条件との関係

| 既存 | 本 spec の後の扱い |
|---|---|
| 5.1〜5.6（会話を原文のまま取り込む） | **廃止する。** 書き戻しで、番号を残したまま「廃止」と記す。同じ場面の扱いは 5.13〜5.15 が引き継ぐ（履歴を取得できない、発言が無い、サービスが対応していない） |
| 要件 5 の見出しと Objective | 書き戻しで「チャットの会話を要約してページにする」に書き直す。番号は 5 のまま |
| 2.9（通知を書き留めたプロセスが止まった場合。「定期処理は 1 分に 1 回なので、書き留めてからおよそ 11 分以内」） | 定期処理の間隔が 5 分になる（2.11）ので、書き戻しで括弧の中を「定期処理は 5 分に 1 回なので、書き留めてからおよそ 15 分以内」に書き直す。番号は 2.9 のまま |
| 7.6（紐付いていない利用者の書き込みを伴う操作は実行しない） | 変えない。`agent` は、読むだけの依頼でも紐付けを求める（15.3） |
| 8.2・8.3（複数の GROWI が紐づくチャンネルでの選択） | 変えない。`agent` は、対象が 1 つに定まる操作として扱う（15.13） |
| 11.1〜11.5（チャンネル単位の権限） | 変えない。`agent` と DM の扱いを足す（11.6〜11.8） |
| 14.2・14.4（ヘルプは、実際に提供しているコマンドを返す。許可されていないコマンドの扱い） | 変えない。AI が使えない GROWI の扱いを足す（14.6） |
| Out of scope「LLM を使った、自由な文章からのページ作成」（決定 4） | **撤回する。** 書き戻しで Out of scope から外し、In scope に「GROWI の AI Agent への依頼」を足す。チャット側の AI が GROWI の MCP サーバで直接ページを作る経路は、本筋として残る（この spec の対象ではない） |
| Out of scope「検索結果の要約」 | 変えない。`search` は今までどおり要約しない。`agent` が 1 つの GROWI の中で調べて答えることは、これとは別の機能である |

## Boundary Context

### In scope

- `agent` コマンド: 依頼を受け付け、紐付けた GROWI ユーザーとして GROWI の AI Agent に渡し、答えをあとから本人にだけ届ける
- 会話を要約してページにする依頼（`keep` の置き換え）
- 答えの届く場所: 依頼のスレッドの中、Slack の AI アプリの画面、本人への DM
- 続けてやり取りする会話を、GROWI の AI の 1 本の会話として扱うこと
- `agent` と DM のチャンネル単位の権限、ヘルプ、運用者に示す「できること」の表、導入ドキュメント
- 通知を書き留めた直後に送ることと、通知の定期処理の間隔を延ばすこと

### Out of scope

- **GROWI の AI Agent そのもの**（道具、指示文、言語モデルの選び方）— 使う側に徹する
- **GROWI の AI Agent に書き込みの道具を足すこと** — 既にあるページの編集を AI に任せる依頼は対象外
- **答えの少しずつの書き出し** — できあがった答えをまとめて届ける
- **GROWI の AI を有効にする設定と、言語モデルの設定** — 既存の管理画面のまま
- **要約したページを作る前に本人の確認を取ること、および変更の提案（Change Proposal）として出すこと** — 初版は確認を取らず、作成中（WIP）のページとして作る（5.8・5.9）。PR #12222 の Change Proposal が完成した後に、提案として出す形にするか、管理画面で選べるようにするかを改めて判断する（umbrella の roadmap.md に記録する）
- **スラッシュコマンド** — `chat-integration-proxy` のタスク 12.4
- **Discord の DM から依頼すること** — Discord の DM はどの workspace にも属さず、対象の GROWI が決まらないので、今までどおり断る。Discord で `agent` の答えが本人への DM に届くこと（要件 1.8）は対象に含む
- **管理者が決める利用回数の上限** — 同じ人の依頼を同時に 1 件までにすること（15.12）だけを行う

### Adjacent expectations

- **GROWI の AI Agent** — 依頼した利用者の閲覧権限で読める内容だけを使うことを期待する（既存の道具がそう動く）
- **本人に宛てた返事の届け方** — 要件 1.6〜1.13 の仕組みを使う。この spec は、その上に「依頼の処理が終わった後で届けること」を足す
- **チャットのアカウントと GROWI ユーザーの対応表** — chat-integration proxy は持たない（要件 7.8）。続きの会話の対応づけも、この制約の中で行う
- **GROWI application の監査ログ** — `agent` によるページの作成も、ほかの操作と同じように記録されることを期待する
- **チャットサービスの会話の履歴の制限** — サービスや配布の形によって、読める件数や頻度が限られる。この spec はそれを解消せず、限られたときの振る舞いを定める（5.16・5.17）

### まだ確かめていないこと

要件の内容は変えないが、design か実機で確かめる。

- Slack の API の利用規約が、会話の要約を GROWI のページとして残すことを制限するか（`brief.md`「実現性の確認の結果」4。法務の確認が要る）
- Slack で、返事の無いメッセージのスレッドに、本人にだけ見えるメッセージが表示されるか（同 2）
- Teams で、本人にだけ見えるメッセージがスレッドの中に出るか。1 対 1 の会話にアプリを個人の範囲でも入れる必要があるか（同 8）
- Slack の AI アプリの画面が、無料のプランで使えるか（同 10）

## Requirements

### Requirement 1: 複数のチャットサービスへの対応と、サービスごとの機能差（受け入れ条件の追記）

**Objective:** As a GROWI を self-host する運用者, I want `agent` が自分たちのチャットサービスでどう動くかを導入の時点で知れること, so that 利用者に案内する内容を、試す前に決められる

#### Acceptance Criteria

20. The chat-integration proxy shall 運用者に示すサービスごとの機能（要件 1.3）として、`agent` の答えが届く場所、続けてやり取りできる場所の有無、会話の要約が使えるか、使える場合に読める範囲が限られるかを示す
21. The 導入ドキュメント shall Slack の AI アプリの画面を使うために Slack アプリに要る設定と権限を示す
22. Where Teams で、利用者が bot との 1 対 1 の会話に書き込むために、アプリを個人の範囲にも入れる必要がある, the 導入ドキュメント shall その導入の手順を示す

### Requirement 2: GROWI からチャットへの通知（受け入れ条件の追記）

**Objective:** As a GROWI を使うチームのメンバー, I want ページの変更の通知が、変更のすぐ後に届くこと, so that 定期処理の間隔が延びても、通知が遅れない

#### Acceptance Criteria

10. When GROWI application が通知を書き留めた, the GROWI application shall 通知の定期処理を待たずに、その通知を送り始める
11. The GROWI application shall 通知の定期処理を 5 分に 1 回動かし、送っている途中で止まった通知を、止まってから 10 分以内に取り直して送る

### Requirement 5: チャットの会話を要約してページにする（要件 5 の置き換え）

**Objective:** As a チャットで議論したチームメンバー, I want その会話の要約を GROWI のページとして残せること, so that 後から議論の結論と経緯を読み返せる

5.1〜5.6（会話を原文のまま取り込む）は廃止する。

#### Acceptance Criteria

7. When GROWI application が、`agent` の依頼を会話を要約してページにする依頼だと判断して、その会話を chat-integration proxy に求めた, the chat-integration proxy shall 依頼がスレッドの中で行われたならそのスレッドの発言を、そうでなければ依頼が行われた場所の直近の発言を読み、GROWI application へ渡す
8. When GROWI application が、要約する会話を受け取った, the GROWI application shall その会話の要約を本文とするページを、本人の確認を取らずに作成し、作成されたページへのリンクを本人に返す
9. The 作成されたページ shall 作成者として、依頼した利用者に紐付いた GROWI ユーザーを記録し、作成中（WIP）の状態になる
10. The GROWI application shall 依頼がページのパスを指定していれば、そのパスに、`create-page` で作る場合と同じ公開範囲でページを作成し、指定していなければ、依頼した本人のメモ置き場（本人のユーザーページの下の `memo`）に、GROWI の AI が付けた題名で、本人だけが閲覧できるページとして作成する
11. If 決まったパスに既にページが存在する、または紐付いた GROWI ユーザーがそのパスへページを作成する権限を持たない, then the GROWI application shall ページを作成せず、その理由を本人に示す
12. The GROWI application shall 本人への返事に、要約の対象にした会話の範囲（発言の件数と、最初と最後の発言の日時）を示す
13. If bot がその会話の履歴を取得できない, then the chat-integration proxy shall ページを作成させず、取得できない理由と、取得できるようにするために必要な操作を本人に示す
14. If 対象の範囲に発言が 1 件も無い, then the chat-integration proxy shall ページを作成させず、その旨を本人に示す
15. Where あるチャットサービスが会話の履歴の取得に対応していない, the chat-integration proxy shall そのサービスでは会話の要約を使えないことを本人に示す
16. Where チャットサービスが、会話の履歴を読める件数を制限している, the chat-integration proxy shall 読めた範囲の発言だけを GROWI application へ渡し、範囲が限られたことを本人への返事に示す
17. If チャットサービスが、会話の履歴を読む頻度の制限によって読み取りを断った, then the chat-integration proxy shall ページを作成させず、時間を置いてやり直す必要があることを本人に示す
18. The 作成されたページ shall 作成中（WIP）のページの自動削除の対象にならない

### Requirement 11: チャンネル単位のコマンド権限（受け入れ条件の追記）

**Objective:** As a GROWI の管理者, I want `agent` を使わせる場所を、ほかのコマンドとは別に決められること, so that AI による調べものとページの作成を、想定した場所だけに限れる

#### Acceptance Criteria

6. The GROWI application shall `agent` の実行を許すチャンネルを、`search`・`create-page` とは別に管理者が設定できるようにする
7. The GROWI application shall `agent` を DM（Slack の AI アプリの画面を含む）で使わせるかどうかを、チャンネルの設定とは別に管理者が設定できるようにする
8. The GROWI application shall 管理者が `agent` の許可を設定するときに、`agent` がページを作成しうることを示す

### Requirement 14: ヘルプ（受け入れ条件の追記）

**Objective:** As a チャットから GROWI を使う人, I want ヘルプに、その GROWI で実際に使えるコマンドだけが出ること, so that 使えない `agent` を試して戸惑わない

#### Acceptance Criteria

6. While GROWI の AI が使えない状態である（管理者が有効にしていない、または言語モデルが設定されていない）, the GROWI application shall ヘルプの内容に `agent` を含めない

### Requirement 15: GROWI の AI Agent への依頼

**Objective:** As a チャットで話している人, I want GROWI を開かずに、GROWI の AI に調べものや要約を頼めること, so that 会話の流れを止めずに、GROWI に書かれた知識を使える

#### Acceptance Criteria

1. When 利用者が `agent` コマンドに依頼の文章を添えて実行した, the chat-integration proxy shall その文章を、依頼した利用者を示す情報とともに、対象の GROWI application へ渡す
2. When GROWI application が `agent` の依頼を受け取った, the GROWI application shall 依頼した利用者に紐付いた GROWI ユーザーとして GROWI の AI Agent に依頼を渡し、そのユーザーが閲覧できる内容だけを答えの材料にする
3. If 依頼した利用者に対応する GROWI ユーザーが紐付いていない, then the GROWI application shall 依頼を AI Agent に渡さず、紐付けの手順を本人に返す
4. If GROWI の AI が使えない状態である, then the GROWI application shall 依頼を AI Agent に渡さず、使えない理由を本人に返す
5. When chat-integration proxy が `agent` の依頼を受け付けた, the chat-integration proxy shall 答えが届くまでの間、依頼を受け付けたことを、答えの内容を含まない形で本人が分かるようにする
6. When AI Agent の答えができた, the GROWI application shall 依頼を受け付けてからの時間にかかわらず、その答えを chat-integration proxy へ送る
7. When chat-integration proxy が `agent` の答えを受け取った, the chat-integration proxy shall その答えを要件 1.6〜1.13 に従って、依頼した本人にだけ届ける
8. Where 依頼がチャンネルで行われ、そのサービスがスレッドの中に本人にだけ見えるメッセージを出せる, the chat-integration proxy shall 答えを、依頼のメッセージのスレッドの中に届ける
9. Where そのチャットサービスに、bot と続けてやり取りできる場所（Slack の AI アプリの画面、bot との DM）がある, the chat-integration proxy shall チャンネルでの依頼への答えに、その場所で続けられることの案内を添える
10. If AI Agent が、定められた上限の時間の内に答えを出せなかった、または途中で失敗した, then the GROWI application shall 答えを得られなかったことを、本人に宛てた返事として届ける
11. If GROWI application が答えを chat-integration proxy へ送れなかった, then the GROWI application shall 定められた回数まで送り直し、それでも送れなかった場合は、送れなかったことを運用者が後から確認できる形で記録する
12. While ある利用者の `agent` の依頼を GROWI application が処理している, when 同じ利用者が同じ GROWI に新しい `agent` の依頼をした, the GROWI application shall 新しい依頼を受け付けず、前の依頼を処理中であることを本人に返す
13. The chat-integration proxy shall `agent` を、対象が 1 つの GROWI に定まる操作として扱い、要件 8.2・8.3 に従って対象の GROWI を決める
14. When 利用者が、bot との DM（Slack の AI アプリの画面を含む）の同じスレッドで続けて依頼した, the GROWI application shall それまでのやり取りを踏まえた 1 本の会話として答える
15. Where Slack の AI アプリの画面が使える, when 利用者がその画面に文章を送った, the chat-integration proxy shall その文章を、先頭の語がほかのコマンドの名前と同じであっても、`agent` の依頼として扱う
16. While Slack の AI アプリの画面で `agent` の答えを待っている, the chat-integration proxy shall 処理中であることをその画面に表示する
17. The chat-integration proxy shall 依頼の文章から bot 自身への呼びかけだけを取り除き、ほかの利用者への言及は、文章の先頭にあるものを含めて、打たれたとおりに GROWI application へ渡す
18. The GROWI application shall チャットからの `agent` のやり取り（会話を要約してページにする依頼を除く）を、紐付いた GROWI ユーザーの AI の会話の記録として残す
19. The GROWI application shall `agent` の答えを届けるために、インターネットから GROWI application へ届く通信経路を必要としない
20. While GROWI の AI が使えない状態である, the GROWI application shall `search` と `create-page` を、AI が使える場合と同じように提供する
