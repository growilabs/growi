# Requirements Document

## Project Description (Input)

**誰の困りごとか**: GROWI の管理者。チャットサービス（Slack など）と GROWI をつなぎ、どのチャンネルでどのコマンドを使わせるか、どのチャンネルへ通知するかを決める人。

**現状**: 管理画面（`/admin/chat-integration`）は、機能としては一通り動くが、初めて使う管理者が迷わずに設定を終えられる作りになっていない。

- **接続を追加するハードルが高い。** 登録コード・proxy の URL・この GROWI の URL・表示名を、案内なしに手で入力する。失敗してもトーストで短い英語の 1 行が出るだけで、次に何をすればよいか分からない。接続が 1 件もないときの表示は、エラーのように見える。
- **画面が縦に長く、一覧できない。** 接続ごとのカードの中に、機能表・チャンネル権限・通知先・切断の操作がすべて縦に並ぶ。
- **チャンネル権限の入力が、チャンネル ID の手打ちである。** ID はチャンネル名と結び付かないので、何を許可しているかを管理しにくい。
- **権限の「Not configured (protocol default)」の意味が、画面から分からない。** 実際の既定の挙動は、コマンドによって違う（書き込み系は許可されず、それ以外はすべてのチャンネルで許可される）。
- **通知先を削除できない。** 配信イベントが 0 件のままでも保存できる。
- **切断と再接続が分かりにくい。** 切断で何が消え、何が残るか、proxy 側の登録が残ることが示されない。切断済みの接続のカードが、一覧の途中に残る。
- **画面の文言が英語の直書きで、i18n されていない。** 保存結果の通知は内部用語（version、proxy）を含む。機能表と状態の表示は、プロトコルの生の値のまま出る。

**何を変えたいか**: 上記を解消し、管理者が、接続の追加から、権限と通知先の設定、切断と再接続までを、画面の案内だけで迷わず進められるようにする。機能の追加（サジェストなど）は、接続の追加の入口では行わず、入力の手がかりで解決する。チャンネルの選択は、一覧から選ぶ汎用の部品にする。

## Introduction

umbrella spec `chat-integration` の管理画面（`/admin/chat-integration`）を作り直す amend spec。

管理者が、チャットサービスとの接続の追加、チャンネル単位の権限と通知先の設定、接続の切断と再接続までを、画面の案内だけで進められるようにする。変えるのは管理画面と、その画面が呼ぶ GROWI application の API だけで、chat-integration proxy と `@growi/chat` の契約は変えない。

背景・決まったこと・未決の項目は、同じディレクトリの `brief.md` にある。

以下、中継サーバを **chat-integration proxy**、GROWI 本体を **GROWI application** と呼ぶ（umbrella と同じ）。

### Amend target

| 対象の spec | 変わる契約 |
|---|---|
| `chat-integration`（umbrella） | 要件 1・2・9・11 に受け入れ条件を足す。要件 16（管理画面の使いやすさ）を新しく足す。既存の受け入れ条件は変えない |
| `chat-integration-app` | design.md の「触れない部品」（`CapabilityReportTable`・`ChannelPermissionsSection`・`NotificationDestinationsSection`・`UnpairButton`）の取り決めを解く。管理画面の文言を英語の直書きとする取り決めを、表示言語ごとの文言に改める。管理画面の節と、管理画面の API（チャンネルの一覧、通知先の削除）を書き換える |
| roadmap.md | 順 8「管理画面の作り直し」の対象を、この spec の範囲に広げる。完了時に、この行を消す |

再検証が必要になる条件への影響: なし。`@growi/chat` と chat-integration proxy の契約は変えない。

### 番号の扱い

既存の番号は振り直さない。新しい受け入れ条件は、各要件の末尾に足す。`chat-integration-agent`（roadmap 順 7）が予約している番号の後ろから始める。

| 要件 | 足す番号 | 備考 |
|---|---|---|
| 1 | 1.23・1.24 | 1.20〜1.22 は `chat-integration-agent` が予約している |
| 2 | 2.15〜2.17 | 2.10・2.11 は `chat-integration-agent` が予約している。2.12〜2.14 は既存 |
| 9 | 9.14〜9.29 | |
| 11 | 11.9〜11.20 | 11.6〜11.8 は `chat-integration-agent` が予約している |
| 16 | 16.1〜16.10 | 新しい要件 |

### 既存の受け入れ条件との関係

| 既存 | 本 spec の後の扱い |
|---|---|
| 9.3・9.4（紐付けを成立させず、失敗の理由ややり直しの手順を示す） | 変えない。何を示すかを、9.18〜9.22 で具体的にする |
| 9.7（解除したら、以降その GROWI との間のリクエストを処理しない） | 変えない。解除の前の確認と、解除の後の案内を、9.26〜9.28 で足す |
| 9.8・9.9（保持期間 45 日と、再接続での引き継ぎ） | 変えない。切断の確認で、その内容を管理者に示す（9.27） |
| 9.10〜9.13（接続が切れている状態の表示） | 変えない。状態の言葉づかいを 9.29 で足す |
| 11.1（コマンドごとに、実行を許すチャンネルを管理者が設定できる） | 変えない。設定の仕方を 11.9〜11.20 で定める |
| 2.1・2.2（通知先の設定）、2.12〜2.14（保存時の通知先を選ぶ部品） | 変えない。管理画面の通知先の削除と検査を、2.15〜2.17 で足す。保存時の選択部品は対象外 |
| 12.4・12.5（Gen 1 との併存の表示） | 変えない。文言を表示言語に対応させることだけが及ぶ（16.9） |

## Boundary Context

### In scope

- 管理画面の、接続の追加（入力の手がかり、初期値、失敗の知らせ）と、接続が 1 件もないときの表示
- 接続のカードの並べ方と、折りたたみ、切断済みの接続の並び順
- チャンネル権限の編集（選択肢、「既定値」の表示、チャンネルの選び方、一覧が取得できないときや一覧にないときの扱い）
- 通知先の削除と、配信イベントの検査
- 接続の切断の確認と、切断後の再接続の案内
- 保存の操作（変更がないときの無効化、未保存の表示、保存結果の言葉づかい）
- 運用者に示す「できること」の表と、接続の状態の言葉づかい
- 管理画面の文言の、表示言語への対応

### Out of scope

- **チャットサービスへの bot の導入（OAuth の入口）の画面化** — 今は導入用の URL を手で組む。導入ドキュメントの範囲
- **GROWI での切断を chat-integration proxy へ自動で伝えること** — 署名付きの新しい通信と、契約の変更が要る。将来の候補
- **切断済みの接続を、保持期間の前に手動で消すこと** — 管理画面からは消せないまま（9.8 の自動の掃除のみ）
- **保存時の通知先を選ぶ部品**（要件 2.12〜2.14）と、管理画面の通知先を追加するときのチャンネルの選び方 — 今のまま
- **「既定値」と「すべてのチャンネルで使う」が、同じ結果になる場合の区別を見せる工夫** — 後回し（チームで合意済み）
- **`chat-integration-agent` が足した `agent` の行と DM の欄** — その spec の範囲。この spec は、その上に載る

### Adjacent expectations

- **chat-integration proxy** — GROWI の URL の持ち主を確認できなかった理由を返さない（要件 9.3 の確認は、原因を断定できない）。この spec は、その前提で失敗の知らせを書く
- **チャットサービス側の登録の解除** — chat-integration proxy の管理コマンド（`unregister`）が受け持つ。GROWI の切断は、これを呼ばない
- **`chat-integration-agent`** — 管理画面の `agent` の行と DM の欄を、先に足し終えていることを前提にする（roadmap 順 7 → 8）。書き戻し先の `chat-integration-app` の design.md を同じ節で書き直すので、書き戻しの順番を守る
- **表示言語** — GROWI が持つ表示言語（英語・日本語・中国語・フランス語・韓国語）すべてに、文言が揃っていることを、GROWI のビルドの検査が求める

### まだ確かめていないこと

要件の内容は変えないが、design で確かめる。

- カードを横に並べる画面幅の区切り（デスクトップ幅の定義）
- 「接続の状態」と「機能の表」の、プロトコル上の値と表示する言葉の対応（知らない値をそのまま示す扱いを含む）
- `chat-integration-agent` の残りのタスクが、この spec が書き換える節に触れるか

## Requirements

### Requirement 1: 複数のチャットサービスへの対応と、サービスごとの機能差（受け入れ条件の追記）

**Objective:** As a GROWI の管理者, I want 運用者に示されるサービスごとの機能の表を、読めば意味が分かる言葉で見られること, so that 使えない機能を、利用者に案内する前に知れる

#### Acceptance Criteria

23. The GROWI application shall 運用者に示すサービスごとの機能（要件 1.3）を管理画面に示すとき、サービス・機能・対応の程度を、管理者が意味を理解できる言葉で示す
24. If 管理画面が、知らないサービス・機能・対応の程度の値を受け取った, then the GROWI application shall その値をそのまま示し、その行を欠落させない

### Requirement 2: GROWI からチャットへの通知（受け入れ条件の追記）

**Objective:** As a GROWI の管理者, I want 誤って足した通知先を管理画面から消せ、無効な通知先を作らずに済むこと, so that 通知が意図しないチャンネルに飛び続けるのを防げる

#### Acceptance Criteria

15. When 管理者が管理画面で、設定済みの通知先の削除を求めた, the GROWI application shall その通知先を削除する
16. When 通知先を削除した, the GROWI application shall 以降、その通知先（チャンネルとページのパス条件の組）へは通知を投稿しない
17. If 通知先の配信イベントが 1 つも選ばれていない, then the GROWI application shall その通知先を保存せず、配信イベントを 1 つ以上選ぶ必要があることを示す

### Requirement 9: chat-integration proxy と GROWI の紐付け（受け入れ条件の追記）

**Objective:** As a GROWI の管理者, I want 接続の追加・失敗からのやり直し・切断・再接続を、画面の案内だけで進められること, so that 手順書や proxy の運用者に尋ねずに、自分で作業を終えられる

#### Acceptance Criteria

14. The GROWI application shall 接続を追加する画面の入力欄に、何を入力するかが分かる例または説明を示す
15. When 接続を追加する画面が開かれた, the GROWI application shall 「この GROWI の URL」にこの GROWI のサイト URL を、「表示名」にこの GROWI のアプリ名を、管理者が書き換えられる初期値として入れる
16. If この GROWI のサイト URL が設定されていない, then the GROWI application shall 「この GROWI の URL」を空にし、入力する URL の例を示す
17. If 接続の追加が失敗した, then the GROWI application shall 失敗したことと、次に取れる操作を、接続を追加する画面を閉じずに、画面の中に、管理者が次に操作するまで示し続ける
18. If 登録コードの有効期限が切れていた, then the GROWI application shall 有効期限が切れたことと、チャットサービスで新しい登録コードを発行する必要があることを示す
19. If chat-integration proxy が、GROWI の URL の持ち主であることを確認できなかった, then the GROWI application shall chat-integration proxy から GROWI の URL にアクセスできなかったことと、確認する点（入力した GROWI の URL が proxy から到達できること、GROWI が起動していて HTTPS の証明書が有効であること、閉域ネットワークの場合は proxy の許可リストにこの GROWI のホスト名が登録されていること）を示し、原因は断定しない
20. If GROWI application が chat-integration proxy に接続できなかった, then the GROWI application shall proxy に接続できなかったことと、確認する点（入力した proxy の URL が正しいこと、proxy が起動していること）を示し、失敗の種類を補足として示す
21. If 同じ workspace とこの GROWI の接続が、chat-integration proxy 側に既に存在する, then the GROWI application shall この workspace がすでにこの GROWI と接続されていることを示し、接続の一覧を確認するよう案内する。あわせて、一覧に有効な接続が無い場合（GROWI 側だけで切断した場合）は、chat-integration proxy 側の登録が残っているので、チャットサービスで登録を解除（`unregister`）してから、新しい登録コードでもう一度試す必要があることを示す
22. If chat-integration proxy が返した接続の識別子を、この GROWI が既に持っていた, then the GROWI application shall すでに登録されていることを示し、接続の一覧を確認するよう案内する
23. If 暗号化キーが設定されていないために接続を追加できない, then the GROWI application shall 暗号化キーが設定されていないことと、画面上部の案内に従う必要があることを示す
24. While 一覧に示す接続が 1 件もなく、暗号化キーが設定されている, the GROWI application shall 接続がないことと、「接続を追加」から追加できることを、エラーに見えない形で示す
25. While 一覧に示す接続が 1 件もなく、暗号化キーが設定されていない, the GROWI application shall 接続を追加できない理由が暗号化キーの未設定であることを示し、「接続を追加」へは誘導しない
26. When 管理者が接続の切断を始めた, the GROWI application shall 対象の接続の名前を示し、ほかの操作をさえぎる確認を求め、管理者が確認するまでは切断しない
27. The GROWI application shall 接続の切断の確認で、次の 3 点を分けて示す。削除されるもの: チャンネル権限、通知先、署名用の鍵、および元に戻せないこと。残るもの: ユーザーのアカウント連携、その保持期間（要件 9.8）、同じ workspace を再接続すると引き継がれること（要件 9.9）。注意: 切断は GROWI 側だけに反映されること、チャットサービス側の登録は残ること、再接続するには先にチャットサービスで登録を解除する必要があること
28. While 接続が切断済みである, the GROWI application shall その接続の表示に、再接続の手順（チャットサービスで登録を解除し、新しい登録コードで接続を追加する）を示す
29. The GROWI application shall 接続の状態（使用中、切断済み、接続が切れている、接続の健全性）を、プロトコル上の値ではなく、管理者が意味を理解できる言葉で示す

### Requirement 11: チャンネル単位のコマンド権限（受け入れ条件の追記）

**Objective:** As a GROWI の管理者, I want コマンドごとの権限を、いまの設定と既定の挙動を読み取りながら、チャンネルを名前で選んで設定できること, so that 設定を誤って書き込みを意図しないチャンネルに許してしまうことを防げる

#### Acceptance Criteria

9. The GROWI application shall コマンドごとに、「既定値」「すべてのチャンネルで使う」「指定したチャンネルのみ」「使わない」の 4 つから選べるようにする
10. The GROWI application shall 「既定値」の選択肢の表示に、そのコマンドを何も設定しなかったときの挙動を添える。ページを作るなど書き込みを伴うコマンドは「既定値（許可しない）」、それ以外のコマンドは「既定値（すべてのチャンネルで許可）」と表示する
11. The GROWI application shall 「既定値」の挙動の分類を、コマンドごとの性質から決め、コマンドが増えたときも、そのコマンドの性質に合った表示になるようにする
12. While コマンドに保存された設定がない, the GROWI application shall そのコマンドを、「既定値」が選ばれた状態で示す
13. When 管理者が「既定値」を選んで保存した, the GROWI application shall そのコマンドの設定を保存せず、既定の挙動のままにする。ただし、ダイレクトメッセージでの実行をチャンネルとは別に許可できるコマンドで、ダイレクトメッセージでの実行を許可した場合は、その許可と、チャンネルでの挙動を既定の挙動と同じにする設定を保存する
14. When 管理者が「指定したチャンネルのみ」を選んだ, the GROWI application shall チャンネルの一覧から、絞り込みながらチェックして選ぶ画面を示す
15. The GROWI application shall チャンネルの選択肢に、チャンネルの名前と識別子を示し、非公開のチャンネルはそれと分かるようにする
16. The GROWI application shall 選んだチャンネルを、名前ではなく識別子で保存する
17. If チャンネルの一覧を取得できなかった, then the GROWI application shall 取得できなかったことと理由を示し、選ぶチャンネルの変更を受け付けない。「指定したチャンネルのみ」が選ばれた行には、チャンネルを選べない理由を示す
18. While チャンネルの一覧を取得できていない, the GROWI application shall 保存済みの指定チャンネルを、保存しても変更せずに残す
19. If 保存済みの指定チャンネルが、いま取得した一覧にない, then the GROWI application shall そのチャンネルを、一覧にないことが分かる印を付けて示し、管理者が外すまで、保存しても残す
20. If 「指定したチャンネルのみ」が選ばれていて、チャンネルが 1 つも選ばれていない, then the GROWI application shall 保存せず、チャンネルを 1 つ以上選ぶ必要があることを示す

### Requirement 16: 管理画面の使いやすさ

**Objective:** As a GROWI の管理者, I want 接続・権限・通知先を、画面を何度もスクロールせずに見渡して設定でき、保存の結果が分かること, so that 設定の抜けや誤りに気づきやすく、自分の言語で作業できる

#### Acceptance Criteria

1. While 画面の幅が広い, the GROWI application shall 接続のカードを、1 行に 2 枚並べて示す
2. The GROWI application shall 接続のカードの、チャンネル権限・通知先・切断の操作を、管理者が開くまで閉じた状態で示す
3. The GROWI application shall 切断済みの接続を、一覧の最後に示す
4. While 編集中の設定に、保存済みの内容からの変更がない, the GROWI application shall 保存の操作を押せない状態にする
5. While 保存していない変更がある, the GROWI application shall 保存していない変更があることを示す
6. When 設定の保存に成功した, the GROWI application shall 保存できたことを、内部の用語（設定の版、proxy など）を含まない言葉で示す
7. If 設定の保存はできたが、chat-integration proxy への即時の反映に失敗した, then the GROWI application shall 保存はできていることと、チャットサービス側へはあとで自動で反映されることを、内部の用語を含まない言葉で示す
8. If 設定の保存に失敗した, then the GROWI application shall 保存できなかったことと、管理者が取れる操作を、内部の用語を含まない言葉で示す
9. The GROWI application shall 管理画面の文言を、GROWI が持つすべての表示言語（英語・日本語・中国語・フランス語・韓国語）で用意する
10. The GROWI application shall コマンド名や、チャンネルの名前と識別子のように、利用者が入力・識別する値を、翻訳せずに示す
