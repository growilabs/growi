# Requirements Document

## Project Description (Input)

**amend spec**（完了済みの `chat-integration`（umbrella）と `chat-integration-proxy` の契約を変える）。対象と、変わる契約は `brief.md` の「Amend target」にある。

### 誰が困っているか

- チャットから GROWI を検索するチームのメンバーと、そのチャンネルにいる他の参加者（社外の人を含みうる）。検索した人にしか見えないページの題名とパスが、チャンネルの全員に見えてしまう。
- Mattermost などで chat-integration を使う人。本人にだけ返すつもりの登録コード・紐付けの URL・エラーが、届かないおそれがある。
- 後から作る `agent` コマンドの利用者。答えを本人にだけ届ける仕組みが要る。

### 今どうなっているか

- `search` は、検索した本人の閲覧権限で調べる（要件 3.6）のに、結果をチャンネルの全員に見える形で投稿している（proxy の `orchestration/command-flow.ts` が、仮の投稿を一覧で差し替える）。
- 本人にだけ返すものは `platform.postEphemeral` で出しているが、DM への切り替えはアダプタに本人だけのメッセージの機能が無いとき（Discord）にしか働かない。Slack では、返事の無いメッセージのスレッドに出すと表示されないことがあり、届くことの保証も無い。Mattermost では、システム管理者の権限が無い bot は本人だけのメッセージを出せない。

### 何を変えるか

- proxy に「本人にだけ届ける」部品を 1 つ作る。本人だけのメッセージを出せる場所ではそれを使い、出せない場所や失敗したときは本人への DM で届ける。どの失敗でも、チャンネルの全員に見える形にはならない。
- 今ある本人宛ての返事と、`search` の結果・検索中の表示・結果の注記を、この部品に通す。
- チャンネルに共有したいときは、本人がページの URL を貼る。何を誰に見せるかは要件 6（URL の展開）の規則に任せ、共有の専用の仕組みは作らない。
- 能力表と導入ドキュメントに、各サービスで本人宛ての返事がどう届くか（その場か DM か）を示す。

詳しい背景・検討して採らなかった案・サービスごとの制約は `brief.md` を参照。

## Introduction

この文書は、chat-integration proxy が「依頼した本人にだけ」返事を届けるときの振る舞いを定める。
今の chat-integration は、検索の結果をチャンネルの全員に見える形で出しており、本人の閲覧権限で集めた内容が他の参加者に見えてしまう。
また、本人にだけ返すつもりの返事が、サービスや場所によっては届かない。

本書は、本人に宛てた返事がチャンネルの全員に見える形にならないこと、本人にだけ見えるメッセージが使えないときは本人への DM で届くこと、
検索の結果をその仕組みで届けることを定める。

用語は umbrella（`chat-integration`）の requirements.md にならい、中継サーバを **chat-integration proxy**、GROWI 本体を **GROWI application** と呼ぶ。
加えて、本書では次の 2 つを区別する。

- **本人にだけ見えるメッセージ**: チャンネルやスレッドの中に出るが、依頼した本人にしか見えないメッセージ（Slack の ephemeral message など）
- **本人への DM**: chat-integration の bot と、依頼した本人との 1 対 1 の会話に送るメッセージ

### 書き戻し先（予定）

この spec は amend spec なので、完了時に要件を umbrella の requirements.md へ書き戻し、この spec を削除する（`.claude/rules/spec-lifecycle.md`）。
書き戻すときは既存の番号を振り直さず、各要件の末尾に足す。正確な番号は書き戻すときに決める。

| 本書の要件 | 書き戻し先（umbrella） |
|---|---|
| 要件 1・2 | 要件 1（サービスごとの機能差。本人にだけ届ける手段の違いと代わりの手段） |
| 要件 3 | 要件 3（検索）の末尾 |
| 要件 4 | 要件 1.3・1.5 に関わる受け入れ条件として要件 1 の末尾 |
| 要件 5 | 書き戻さない（変えないことの確認） |

## Boundary Context

- **In scope**:
  - 本人に宛てた返事を、本人にだけ見えるメッセージか本人への DM で届けること
  - 今ある本人宛ての返事（登録コード、アカウントの紐付けの URL と案内、チャンネルで許可されていないことの案内、エラー、引数の聞き返し、本人にだけ返している管理コマンドの返事）
  - 検索の結果・検索中の表示・結果の注記
  - 能力表と導入ドキュメントでの、届き方と必要な権限の説明
- **Out of scope**:
  - 結果をチャンネルに共有する専用の操作。共有したい人はページの URL を貼り、何を見せるかは umbrella の要件 6（URL の展開）が決める
  - あとから（依頼の処理が終わった後で）届ける返事。`chat-integration-agent` が、本書の仕組みの上に足す
  - チャンネルの全員に向けた返事（ヘルプ、ページ作成の成功の知らせ、URL の展開、通知、`unregister`・`weight`・`rotate-key` などチャンネルに出している管理コマンドの返事）
  - GROWI application の検索と権限の適用（umbrella の要件 3.6・3.7）
- **Adjacent expectations**:
  - 各チャットサービスが bot から本人への DM を許していること。利用者が bot からの DM を受け取らない設定にしている場合は、要件 1.6 の扱いになる
  - 本人にだけ見えるメッセージが、そのサービスの仕様上、利用者の画面から消えることがある（Slack では再読み込みで消える）。本書はそれを防がない

## Requirements

### Requirement 1: 本人に宛てた返事を本人にだけ届ける

**Objective:** As a チャットから GROWI を使う人と、同じチャンネルにいる他の参加者, I want 本人に宛てた返事が本人にしか見えないこと, so that 本人の権限で得た内容や本人だけに渡すべき情報が、他の参加者に漏れない

#### Acceptance Criteria

1. The chat-integration proxy shall 本人に宛てた返事を、依頼した本人以外のチャンネル参加者が読める形で投稿しない
2. Where 依頼が行われた場所で、そのサービスが本人にだけ見えるメッセージを出せる, the chat-integration proxy shall 本人に宛てた返事を、依頼が行われた場所に本人にだけ見えるメッセージとして届ける
3. Where 依頼が行われた場所で、そのサービスが本人にだけ見えるメッセージを出せない、またはそのサービスの仕様でその場所には表示されないことが分かっている, the chat-integration proxy shall 本人に宛てた返事を本人への DM で届ける
4. If 本人にだけ見えるメッセージを出そうとして失敗した, then the chat-integration proxy shall 同じ返事を本人への DM で届け直す
5. When 本人に宛てた返事を本人への DM で届けた, the chat-integration proxy shall 返事の内容を含まない形で、返事が DM に届いたことを依頼が行われた場所で本人が分かるようにする
6. If 本人にだけ見えるメッセージでも本人への DM でも届けられなかった, then the chat-integration proxy shall 返事の内容を含まない形で、届けられなかったことと、本人が取れる操作（bot からの DM を受け取れるようにする など）を依頼が行われた場所に示す
7. If 本人にだけ見えるメッセージでも本人への DM でも届けられなかった, then the chat-integration proxy shall 届けられなかったこと・対象のサービス・理由を、運用者が後から確認できる形で記録する
8. The chat-integration proxy shall 本人への DM で届けた返事を、本人がそれだけを読んで、どの場所での何の依頼に対する返事かを分かる形にする

### Requirement 2: 今ある本人宛ての返事を同じ仕組みで届ける

**Objective:** As a chat-integration を使う人と運用者, I want 今まで本人にだけ返していた返事が、どのサービスでも確実に本人に届くこと, so that 登録や紐付け、エラーの案内を受け取れずに手順が止まることが無い

#### Acceptance Criteria

1. The chat-integration proxy shall 次の返事を要件 1 に従って届ける: GROWI との紐付けの登録コード、アカウントの紐付けの URL、紐付けが必要であることの案内、そのチャンネルでは許可されていないことの案内、コマンドの実行に失敗したことの案内、引数の聞き返し、本人にだけ返している管理コマンドの返事
2. When 今まで依頼が行われた場所に本人にだけ見えるメッセージとして届けていた返事を、要件 1 により本人への DM で届けた, the chat-integration proxy shall その返事の内容を、場所が変わったこと以外は変えない
3. While 引数の聞き返しを本人への DM で届けた, when 本人がその聞き返しに答えた, the chat-integration proxy shall その答えを元の依頼の引数として受け付ける

### Requirement 3: 検索の結果を本人にだけ届ける

**Objective:** As a チャットから GROWI を検索する人, I want 検索の結果が自分にだけ届くこと, so that 自分の閲覧権限でしか見えないページの題名やパスが、チャンネルの他の参加者に見えない

#### Acceptance Criteria

1. When 利用者が検索コマンドを実行した, the chat-integration proxy shall 検索の結果の一覧を要件 1 に従って、検索した本人にだけ届ける
2. The chat-integration proxy shall 結果の注記（応答しなかった GROWI、紐付けが必要な GROWI、エラーを返した GROWI、結果が得られなかったこと）を、結果の一覧と同じく本人にだけ届ける
3. When 利用者が検索コマンドを実行した, the chat-integration proxy shall 結果が届くまでの間、検索を受け付けたことを本人が分かるようにする
4. The chat-integration proxy shall 検索を受け付けたことの表示と、DM に届いたことの表示に、検索の結果と注記を含めない
5. The chat-integration proxy shall 結果の並べ方と注記の内容（umbrella の要件 3.2〜3.5・3.8）を、本書の変更の前と同じにする

### Requirement 4: 運用者への説明

**Objective:** As a chat-integration proxy を運用する人, I want 各サービスで本人宛ての返事がどう届くかと、そのために何を用意すればよいかを知ること, so that 導入の時点で利用者に届き方を説明でき、必要な権限を bot に与えられる

#### Acceptance Criteria

1. The chat-integration proxy shall 運用者に示すサービスごとの機能（umbrella の要件 1.3）として、本人宛ての返事が依頼が行われた場所に届くか、本人への DM になるかを示す
2. The 導入ドキュメント shall チャットサービスごとに、本人への DM を送るために bot に必要な権限を示す
3. Where あるチャットサービスで、本人にだけ見えるメッセージを出すために bot に追加の権限が要る, the 導入ドキュメント shall その権限と、与えない場合は本人宛ての返事が本人への DM で届くことを示す

### Requirement 5: チャンネルの全員に向けた返事は変えない

**Objective:** As a チャットで GROWI を使うチーム, I want 全員に向けた返事は今どおり全員に見えること, so that 本書の変更で、共有されるべき知らせが見えなくならない

#### Acceptance Criteria

1. The chat-integration proxy shall ヘルプ、ページ作成の成功の知らせ、URL の展開、GROWI からの通知、チャンネルに出している管理コマンドの返事を、本書の変更の前と同じ相手に見える形で届ける
