# Requirements Document

## Project Description (Input)

GROWI AI Agent は、検索と読み取りの結果をもとに答えることしかできない（詳細は [brief.md](./brief.md)、umbrella の判断は [../change-proposal/roadmap.md](../change-proposal/roadmap.md) と [../change-proposal/research.md](../change-proposal/research.md)）。

### (a) 誰が困っているか
- AI チャットに「この会議の結果でこの手順書を直して」「この内容で新しいページを作って」「このページをあそこへ移して」と頼みたいユーザー。今は AI が答えを出しても、自分でページを書き換えるしかない。
- 同じ wiki を使う他のユーザー。AI に書き込みをそのまま任せると、頼んでいないページが書き換えられたり、本人しか見られないページの内容が広く公開されたページに書き写されたりするおそれがある。

### (b) 現状
- GROWI AI Agent の道具は、全文検索とページの本文の読み取りの 2 つだけで、ページに書き込めない。
- 書き込みの仕組みとして、兄弟の spec `change-proposal-core` が Change Proposal（複数のページへの操作をまとめたもの）の作成・承認・反映・取り消しを提供する。ただし、AI チャットからそれを使う入口が無い。
- AI に本文全体を書かせると、長いページの読んでいない節を落としたり、出力の上限で途中で切れたりして、内容が消える。

### (c) どう変えたいか
- チャットでの会話から、AI が Change Proposal（編集・新規作成・移動）を作れるようにする。
- 編集は「この文字列をこう置き換える」という指示で AI に出させ、サーバーが本文全体を組み立てる。内容が大きく消える操作は断る。
- AI が書き込む先を、ユーザーが指定したページに限る。AI が読んだページより閲覧範囲の広いページへ書き写すおそれがあるときは、本人に確かめてもらう。
- チャット画面で、作られた Change Proposal の差分を確かめ、ページ単位で承認して反映し、取り消せるようにする。

## Introduction

この文書は、GROWI AI Agent のチャットから Change Proposal を作る機能の要件を定める。Change Proposal の保存・反映・取り消し・管理者の設定は `change-proposal-core` が持ち、本 spec はそれを使う入口の 1 つとして、「AI に何を任せてよいか」と「チャット画面での確かめ方」を持つ。反映した後に他のユーザーへ見せる画面は `change-proposal-viewer` が持つ。

### 本要件で使う言い方

- **Change Proposal**: `change-proposal-core` が定める、複数のページへの操作（編集・新規作成・移動）をまとめたもの。作られた後の承認・反映・取り消しは core が行う。
- **書き込みの道具**: AI が Change Proposal を作るために呼ぶ道具。ページやリビジョンには直接書き込まない。
- **実行**: ユーザーがチャットでメッセージを 1 つ送ってから、AI の応答が終わるまでの 1 回の処理。
- **会話**: チャットの 1 つのスレッド。複数の実行を含む。
- **置き換えの指示**: 「この文字列を、この文字列に置き換える」という組の並び。AI が編集の内容として出す。
- **元の本文**: 編集の対象のページの、書き込みの道具が呼ばれた時点の最新のリビジョンの本文。
- **ユーザーが指定したページ**: その会話でユーザーが書いたメッセージの中に、@メンションまたはパスとして、前後を空白か句読点で区切られた形で現れるページ。ページの ID を使ったリンク（`/` とページの ID）で書かれたページも含む。AI が書いた文や、道具が返した内容に現れるページは含まない。
- **AI の提案**: ユーザーが指定していないページを対象にした操作、またはユーザーが指定していない場所に作る新規作成の操作。本人が選ばない限り Change Proposal に含めない。
- **AI が読んだページ**: その会話で、全文検索の結果として返されたページと、本文を読み取られたページ。
- **閲覧範囲が狭い**: ある読んだページについて、書き込み先のページを閲覧できるのに、その読んだページは閲覧できないユーザーがいる（またはいるかどうか確かめられない）こと。
- **保留中の案**: 本人の確認が要るため、まだ Change Proposal にしていない案。本人が確かめて Change Proposal にするか、やめるまで残る。
- **AI の記録**: 書き込みの道具が Change Proposal を作るときに残す、AI が書いた要約・会話へのリンク・AI が読んだページの一覧。本人にだけ見せる。
- **古い操作**: core が「元のリビジョンから変わっていたため書き込まなかった」とした編集の操作。

## Boundary Context

- **In scope**:
  - 書き込みの道具（編集・新規作成・移動）と、それを AI に渡す条件
  - 置き換えの指示から本文を組み立てる処理と、内容が大きく消える操作を断ること
  - 書き込み先の制限、AI が読んだページの記録と閲覧範囲の確認、ページの内容を信頼できないデータとして扱うこと
  - 本人の確認が要る案を保留にし、本人が確かめてから Change Proposal にする流れ
  - チャット画面での表示・承認・飛ばす・破棄・取り消し・作り直し
  - AI の記録の保存と、本人だけが取得できる API
  - 反映済みの Change Proposal の詳細ページ（`change-proposal-viewer`）で、AI の記録を本人に見せる部品と、その部品を viewer の本人向けの場所に登録すること
  - AI への指示文（いつ書き込みの道具を使うか、どう出すか）
  - 新しく足す画面の文言（5 言語）
- **Out of scope**:
  - Change Proposal の保存・状態・反映・取り消しの実行・戻せるかの判定・管理者の設定・通知の中身（`change-proposal-core`）
  - 反映済みの Change Proposal の詳細ページ・一覧・ページ履歴や Recent Changes の印・まとめた通知の表示（`change-proposal-viewer`）。ただし詳細ページで AI の記録を表示するための API と、表示する部品は本 spec が提供する（部品を置く場所は viewer が用意する）
  - ページを直接書き換える道具。削除・閲覧範囲の変更・公開と非公開の切り替えの道具
  - 大きな整理を計画として先に出させる機能、AI が自分から始める作業
  - 外部の `@growi/mcp-server` 自体の変更
- **Adjacent expectations**:
  - core の作成のサービスは、受け取った本文をそのまま使い、本文の中身を評価しない。内容が大きく消えるかの判定は本 spec が作成の前に行う。
  - core は、管理者の自動反映の方針に従って、作成の直後に操作を反映することがある。そのため、本人の確認が要る案は、core に渡す前に本 spec の中で止める。
  - 既存の読み取りの道具（全文検索とページの本文の読み取り）の入力と出力の形は変えない。
  - 操作の種類・状態・理由の表示の言葉と、差分の表示の設定と見た目は、core が画面向けに共通で用意したものを使う。本 spec の文言はチャット画面に固有のものだけにする。
  - 新規作成の置き場所の候補は、既存の suggest-path の機能が出す。

## Requirements

### Requirement 1: 書き込みの道具を AI に渡す条件

**Objective:** 管理者と依頼した人として、書き込みが許されているときだけ AI がページへの変更を提案できるようにしたい。許されていない人や場面で AI が書き込もうとしないようにするため。

#### Acceptance Criteria
1. When チャットの実行が始まった場合, the AI Proposal Feature shall 書き込み機能が管理者によって有効にされ、依頼した人が読み取り専用ユーザーでもゲストでもないときだけ、AI に書き込みの道具を渡す。
2. Where 編集・新規作成・移動のうち一部の種類だけが管理者によって有効にされている場合, the AI Proposal Feature shall 有効な種類の操作だけを書き込みの道具で受け付ける。
3. If チャットの実行がアクセストークンで呼ばれ、そのトークンにページの書き込みの権限が含まれない場合, then the AI Proposal Feature shall その実行では AI に書き込みの道具を渡さない。
4. While 書き込みの道具を渡さない実行の間, the AI Proposal Feature shall 検索と読み取りによる回答を、書き込みの道具を足す前と同じように行う。
5. If 書き込みの道具を渡さない実行で、ユーザーがページの変更を頼んだ場合, then the AI Proposal Feature shall AI が変更を作れないことと、自分で編集する必要があることを応答で伝える。
6. The AI Proposal Feature shall ページやリビジョンに直接書き込む道具と、ページの削除・閲覧範囲の変更・公開と非公開の切り替えを行う道具を、AI に渡さない。

### Requirement 2: 編集の提案と本文の組み立て

**Objective:** 依頼した人として、AI に長いページの一部だけを直してもらいたい。AI が読んでいない節を落としたり、出力が途中で切れたりして、内容が消えないようにするため。

#### Acceptance Criteria
1. The AI Proposal Feature shall 編集の操作を、対象のページと置き換えの指示の並びとして受け付け、変更後の本文全体を AI から受け付けない。
2. When 編集の操作を受け付けた場合, the AI Proposal Feature shall 置き換えの指示を元の本文に前から順に適用して変更後の本文全体を作り、元の本文のリビジョンを、その操作の元のリビジョンとする。
3. If 置き換える元の文字列が元の本文に見つからない場合, then the AI Proposal Feature shall その案を作らず、何番目の指示が見つからなかったかを AI に返して作り直させる。
4. If 置き換える元の文字列が元の本文の複数の場所に見つかり、すべてを置き換える指定が無い場合, then the AI Proposal Feature shall その案を作らず、見つかった数と場所の手がかりを AI に返して作り直させる。
5. Where 置き換えの指示に、すべての出現を置き換える指定がある場合, the AI Proposal Feature shall 元の文字列のすべての出現を置き換える。
6. When 1 回の書き込みの道具の呼び出しの中に、同じページへの編集が複数ある場合, the AI Proposal Feature shall それらの置き換えの指示を書かれた順につなげて 1 つの編集の操作にまとめる。
7. The AI Proposal Feature shall 改行の書き方（CR と LF の組か LF だけか）の違いで、置き換える元の文字列が見つからなくならないようにする。
8. If 組み立てた本文が、元の本文より決めた割合以上短くなる場合、または空になる場合, then the AI Proposal Feature shall その案を作らず、内容が大きく消えるため受け付けないことを AI に返す。
9. If 内容が大きく消えるために編集が受け付けられなかった場合, then the AI Proposal Feature shall AI が、その変更はエディタで本人が行う必要があることを応答で伝える。
10. If 編集の対象のページが存在しない場合、または依頼した人が閲覧できない場合, then the AI Proposal Feature shall どちらの場合も同じ「対象のページが見つからない」結果を AI に返す。

### Requirement 3: 新規作成と移動の提案

**Objective:** 依頼した人として、会話の内容から新しいページを作ったり、ページを別の場所へ移したりする案を、AI に作ってもらいたい。

#### Acceptance Criteria
1. The AI Proposal Feature shall 新規作成の操作を、作るページのパスと本文として受け付ける。
2. The AI Proposal Feature shall 移動の操作を、移動元のページと移動先のパスとして受け付ける。
3. If 新規作成の本文が空である場合, then the AI Proposal Feature shall その案を作らず、理由を AI に返す。
4. If 1 回の書き込みの道具の呼び出しの中に、新規作成するページと同じパスへの編集がある場合, then the AI Proposal Feature shall その案を作らず、新規作成の本文にまとめて書くよう AI に返す。
5. If 1 回の書き込みの道具の呼び出しの中に移動の操作が 2 つ以上ある場合, then the AI Proposal Feature shall その案を作らず、移動は 1 つの案につき 1 つまでであることを AI に返す。
6. If 移動元のページが存在しない場合、または依頼した人が閲覧できない場合, then the AI Proposal Feature shall どちらの場合も同じ「対象のページが見つからない」結果を AI に返す。
7. When 保留中の案に、ユーザーが指定していない場所に作る新規作成の操作がある場合, the AI Proposal Feature shall チャット画面で、suggest-path が出した置き場所の候補を示し、本人が候補の中から置き場所を選び直せるようにする。

### Requirement 4: 書き込み先の制限

**Objective:** 依頼した人と他のユーザーとして、AI が書き込む先を、ユーザーが頼んだページに限りたい。ページの本文に仕込まれた指示に従って、頼んでいないページが書き換えられないようにするため。

#### Acceptance Criteria
1. The AI Proposal Feature shall ユーザーが指定したページを、その会話でユーザーが書いたメッセージの文字だけから決め、AI が書いた文や道具が返した内容からは決めない。
2. The AI Proposal Feature shall 編集の操作と移動の操作は、対象のページ（移動では移動元のページ）がユーザーが指定したページであるときだけ、AI の提案でない操作として扱う。
3. The AI Proposal Feature shall 新規作成の操作は、作るパスがユーザーが指定したページの下にあるとき、またはユーザーが書いたメッセージにそのパスそのものが現れるときだけ、AI の提案でない操作として扱う。
4. The AI Proposal Feature shall 移動の操作は、移動先のパスについても 4.3 と同じ条件を満たすときだけ、AI の提案でない操作として扱う。
5. The AI Proposal Feature shall 最上位のページ（`/`）を、ユーザーが指定したページの親として扱わない。
6. When 書き込みの道具が受け取った操作に AI の提案が含まれる場合, the AI Proposal Feature shall その案を Change Proposal にせず保留中の案にし、AI の提案である操作に、チャット画面で「AI の提案」と分かる印を付ける。
7. While 保留中の案を本人が確かめている間, the AI Proposal Feature shall AI の提案である操作を、本人が選ばない限り Change Proposal に含めない。
8. When AI の提案である操作を受け付けた場合, the AI Proposal Feature shall ユーザーが頼んだ対象と AI が触れようとした対象が違ったことを、ページの本文を含めずに記録する。

### Requirement 5: AI が読んだページの記録と閲覧範囲の確認

**Objective:** 他のユーザーとして、本人しか見られないページの内容を、AI が広く公開されたページへ書き写すことを防ぎたい。依頼した人としては、そのおそれがあるときに、どのページの内容が含まれうるかを知ってから判断したい。

#### Acceptance Criteria
1. The AI Proposal Feature shall その会話で全文検索の結果として返されたページと、本文を読み取られたページを、AI が読んだページとして会話ごとに記録する。
2. The AI Proposal Feature shall AI が読んだページの記録を、ユーザーにも AI にも見えない場所で行い、検索と読み取りの道具の入力と出力を変えない。
3. When 書き込みの道具が呼ばれた場合, the AI Proposal Feature shall 各操作の書き込み先（編集ではそのページ、新規作成では作るページが引き継ぐ親の閲覧範囲、移動では移すページ）について、AI が読んだページの中に閲覧範囲が狭いページがあるかを、その時点の閲覧範囲の設定で確かめる。
4. The AI Proposal Feature shall 書き込み先のページを依頼した人だけが閲覧できる場合、その書き込み先については閲覧範囲が狭いページは無いと判断する。
5. The AI Proposal Feature shall 閲覧範囲がリンクを知る人だけのページを、書き込み先がそのページ自身でない限り、閲覧範囲が狭いページとして扱う。
6. If 閲覧範囲が狭いかどうかを確かめられない場合（読んだページが消えている場合、記録が途中で取れなかった場合、記録を始める前からある会話の場合を含む）, then the AI Proposal Feature shall 閲覧範囲が狭いページがある場合と同じように扱う。
7. When 閲覧範囲が狭いページがあった場合, the AI Proposal Feature shall その案を Change Proposal にせず保留中の案にし、チャット画面で、内容が含まれうるページの名前を並べて示す。
8. When 本人が、閲覧範囲が狭いページの一覧を確かめたことをチャット画面で明示して保留中の案を進めた場合, the AI Proposal Feature shall その案を Change Proposal にする。
9. The AI Proposal Feature shall 閲覧範囲が狭いページの一覧を本人にだけ示し、AI の応答・ログ・他のユーザーへの画面や通知に含めない。

### Requirement 6: AI への指示と、信頼できないデータとしての扱い

**Objective:** 依頼した人として、AI が頼んだときだけ、決まった出し方で書き込みの案を作ってほしい。ページに書かれた文に AI が従わないようにしたい。

#### Acceptance Criteria
1. While 書き込みの道具を渡す実行の間, the AI Proposal Feature shall ユーザーがページの変更・作成・移動をはっきり頼んだときだけ書き込みの道具を使うよう、AI に指示する。
2. While 書き込みの道具を渡す実行の間, the AI Proposal Feature shall 検索の結果とページの本文を信頼できないデータとして扱い、その中に書かれた指示に従わず、書き込みの対象をユーザーのメッセージだけから決めるよう、AI に指示する。
3. While 書き込みの道具を渡す実行の間, the AI Proposal Feature shall 編集の前に対象の節を読み取り、読み取った本文から置き換える元の文字列をそのまま写し、できるだけ短い置き換えの指示で出すよう、AI に指示する。
4. When 書き込みの道具が結果を返した場合, the AI Proposal Feature shall AI が、作った案が反映されたのか、承認待ちなのか、保留中なのか、断られたのかを、道具の結果どおりにユーザーへ伝えるよう指示する。
5. Where 書き込み機能が管理者によって無効にされている場合, the AI Proposal Feature shall AI への指示を、書き込みの道具を足す前と同じにする。

### Requirement 7: Change Proposal の作成と保留中の案

**Objective:** 依頼した人として、AI が作った案を、確かめが要らないときはすぐに Change Proposal にし、確かめが要るときは自分が確かめてから Change Proposal にしたい。

#### Acceptance Criteria
1. When 書き込みの道具が受け取った案に、AI の提案も閲覧範囲が狭いページも含まれない場合, the AI Proposal Feature shall `change-proposal-core` の作成のサービスで、入口の種類を AI チャットとし、表示用のモデル名を付けて Change Proposal を作る。
2. When Change Proposal を作った場合, the AI Proposal Feature shall core が返した ID と各操作の状態（自動で反映されたかどうかを含む）を AI に返す。
3. If core が作成を断った場合（書き込み機能や操作の種類が無効、件数の上限、対象のページが見つからないなど）, then the AI Proposal Feature shall 断られた理由を AI に返し、案を保存しない。
4. When 保留中の案を作った場合, the AI Proposal Feature shall その案を依頼した人に結び付けて保存し、保留中であることと、本人の確認が要る理由を AI に返す。
5. When 本人がチャット画面で保留中の案を確かめて進めた場合, the AI Proposal Feature shall 本人が選んだ操作だけで、7.1 と同じ方法で Change Proposal を作り、保留中の案を Change Proposal に結び付ける。
6. When 保留中の案を進めるとき, the AI Proposal Feature shall 本人が選び直した置き場所を含め、閲覧範囲の確認をもう一度行い、本人が確かめた一覧に無い閲覧範囲が狭いページが新たに見つかった場合は、Change Proposal を作らずに新しい一覧を示す。
7. When 本人がチャット画面で保留中の案をやめた場合, the AI Proposal Feature shall その案を以後 Change Proposal にしない。
8. When 保留中の案が、作られてから決めた期間を過ぎても進められなかった場合, the AI Proposal Feature shall その案を以後 Change Proposal にしない。
9. If 依頼した人以外のユーザーが、保留中の案の取得・進める・やめるを求めた場合, then the AI Proposal Feature shall その案が存在しない場合と同じ応答を返す。
10. If 読み取り専用ユーザーまたはゲストが、保留中の案を進めることを求めた場合, then the AI Proposal Feature shall それを受け付けない。
11. If 1 回の実行の中で作った Change Proposal と保留中の案の合計が、決めた数に達している場合, then the AI Proposal Feature shall それ以上の案を作らず、上限に達したことを AI に返す。

### Requirement 8: チャット画面での表示

**Objective:** 依頼した人として、AI が作った案が何をどう変えるのかを、チャットの中で反映の前に確かめたい。

#### Acceptance Criteria
1. When 書き込みの道具が Change Proposal または保留中の案を作った場合, the AI Proposal Feature shall その応答の中に、案を表す表示を出す。
2. The AI Proposal Feature shall 案を表す表示の中で、操作ごとに、種類・対象のページのパス・変更の内容を示す。変更の内容は、編集では元の本文と変更後の本文の差分、新規作成では作る本文、移動では移動元と移動先のパスとする。
3. The AI Proposal Feature shall Change Proposal を表す表示に、操作ごとの今の状態（承認待ち・反映済み・失敗・古い・飛ばした・取り消し済み・取り消しを断られた）と、状態の理由を示す。
4. The AI Proposal Feature shall Change Proposal を表す表示の状態を、その表示を開いた時点と、本人が操作した後に、core から取り直して示す。
5. When 本人が過去の会話を開き直した場合, the AI Proposal Feature shall その会話で作られた案を表す表示を、今の状態で再び出す。
6. The AI Proposal Feature shall 保留中の案を表す表示に、AI の提案である操作の印と、閲覧範囲が狭いページの名前の一覧を示す。
7. The AI Proposal Feature shall 案を表す表示に、AI が書いた案の要約を示す。

### Requirement 9: チャット画面での承認・取り消し・作り直し

**Objective:** 依頼した人として、チャットの中で、ページ単位で承認して反映し、反映した結果を取り消し、古くなった案を作り直したい。

#### Acceptance Criteria
1. When 本人が承認待ちの Change Proposal の中で 1 つのページを承認した場合, the AI Proposal Feature shall core にそのページの操作の承認を求め、結果の状態を示す。
2. When 本人が承認待ちの Change Proposal の「すべて反映」を選んだ場合, the AI Proposal Feature shall core に全体の承認を求め、結果の状態を示す。
3. When 本人が承認待ちの操作を飛ばすこと、または Change Proposal 全体を破棄することを選んだ場合, the AI Proposal Feature shall core にそれを求め、結果の状態を示す。
4. When 本人が反映済みの操作、または反映済みの Change Proposal 全体の取り消しを選んだ場合, the AI Proposal Feature shall core に取り消しを求め、操作ごとの結果（取り消し済み・断られた理由・飛ばした理由）を示す。
5. The AI Proposal Feature shall 取り消しのボタンを、core がその時点で戻せると判定した操作にだけ出し、戻せない操作には core が返した理由を示す。
6. If 編集中の人がいたため操作が承認待ちに戻った場合, then the AI Proposal Feature shall その理由を示し、本人がもう一度承認できるようにする。
7. When 本人が古い操作の「AI で作り直す」を選んだ場合, the AI Proposal Feature shall その操作の対象のページのパスを含む作り直しの依頼を、本人のメッセージとして同じ会話に送る。
8. If core が承認・飛ばす・破棄・取り消しを断った場合, then the AI Proposal Feature shall 断られた理由を表示し、表示を core の今の状態に合わせる。
9. While 承認・飛ばす・破棄・取り消しの求めを core が処理している間, the AI Proposal Feature shall 同じ案への別の操作のボタンを押せないようにする。

### Requirement 10: AI の記録

**Objective:** 依頼した人として、Change Proposal を後から見たときに、AI がなぜそう変えたのかと、どの会話から来たのかを確かめたい。他のユーザーには、それを見せたくない。

#### Acceptance Criteria
1. When 書き込みの道具または保留中の案から Change Proposal を作った場合, the AI Proposal Feature shall AI が書いた要約・作った会話・AI が読んだページの一覧を、その Change Proposal の ID に結び付けて保存する。
2. When 依頼した人が Change Proposal の ID を指定して AI の記録を求めた場合, the AI Proposal Feature shall 要約・会話へのリンク・AI が読んだページのうち今も依頼した人が閲覧できるものの一覧を返す。
3. If 依頼した人以外のユーザーが AI の記録を求めた場合、または指定された Change Proposal に AI の記録が無い場合, then the AI Proposal Feature shall どちらも同じ「見つからない」応答を返す。
4. The AI Proposal Feature shall AI の記録を、元になった会話が削除された後も、Change Proposal がある限り保存し続ける。
5. If AI の記録の会話が削除されている場合, then the AI Proposal Feature shall 会話へのリンクの代わりに、会話が削除されたことを示す。
6. The AI Proposal Feature shall AI の記録を、AI の機能が無効にされた後も依頼した人が取得できるようにする。
7. When 依頼した人が、入口の種類が AI チャットの Change Proposal の詳細ページ（`change-proposal-viewer`）を開いた場合, the AI Proposal Feature shall その詳細ページの本人向けの場所に、AI の記録（要約、会話を開く手段または会話が削除されたことの表示、AI が読んだページのうち今も閲覧できるものの一覧）を表示する。

### Requirement 11: 1 回の実行で扱える量

**Objective:** 依頼した人として、複数のページにまたがる変更を、1 回の依頼でまとめて案にしてもらいたい。

#### Acceptance Criteria
1. The AI Proposal Feature shall 1 回の書き込みの道具の呼び出しで、複数のページへの操作を 1 つの案として受け付ける。
2. While 書き込みの道具を渡す実行の間, the AI Proposal Feature shall 3 ページ程度の読み取りと、置き換えの指示の作り直しを 1 回含めても案を作り終えられる段数を、1 回の実行に許す。
3. While 書き込みの道具を渡さない実行の間, the AI Proposal Feature shall 1 回の実行に許す段数を、書き込みの道具を足す前と同じにする。

### Requirement 12: 文言と既存の機能への影響

**Objective:** GROWI を使うユーザーとして、新しい画面の文言を自分の言語で読みたい。AI チャットの今の使い方が変わらないでほしい。

#### Acceptance Criteria
1. The AI Proposal Feature shall 新しく足すチャット画面の文言を、GROWI が対応する 5 言語（英語・日本語・中国語・フランス語・韓国語）すべてで表示する。
2. The AI Proposal Feature shall 既存の検索と読み取りの道具の入力と出力の形、および、チャット画面の参照したページの一覧の表示を変えない。
3. When 書き込み機能が管理者によって無効にされている場合, the AI Proposal Feature shall チャットの応答とチャット画面の表示を、書き込みの道具を足す前と同じにする。ただし、過去に作られた案を表す表示は、今の状態で出す。
</content>
</invoke>
