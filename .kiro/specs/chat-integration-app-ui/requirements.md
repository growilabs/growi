# Requirements Document

> この文書は amend spec の要件である。umbrella（[chat-integration](../chat-integration/requirements.md)）の要件 2・7・9 に**受け入れ条件を末尾へ足す**。
> 見出しの番号は umbrella の要件の番号で、条件の番号は既存の続き番号である（既存の条件は書き換えず、振り直さない）。
> 書き戻しの最後のタスクで、この文書の条件を umbrella の `requirements.md` の該当する要件の末尾へ移す。

## Introduction

`chat-integration-app` が作った 3 つの画面（ページの保存時の通知先の選択、管理画面の関係の状態、アカウントの紐付けの承認画面）の見え方を直す。動作の規則は変えない。誤った表示（接続が切れているのに「active」と出る）と、取り違えを招く表示（何を承認するのかが分かりにくい）をなくし、編集画面の配置を崩さないようにする。

## Boundary Context

- **In scope**: 保存時の通知先の選択部品の大きさと表示、管理画面の関係のバッジと接続の行、承認画面の体裁と、承認前に出す情報
- **Out of scope**:
  - 管理画面の「できること」の表、チャンネルの権限の節、通知の宛先の節（roadmap の順 8 で作り直す）
  - proxy と `@growi/chat` の契約の変更（GROWI に「解除された」と知らせる新しい通信を含む）
  - 通知先を選ぶ規則そのもの（要件 2.2）、紐付けを成立させる規則（要件 7.3・7.4）、解除の規則（要件 9.7）
- **Adjacent expectations**: 並行する amend spec が番号を予約している。`chat-integration-notification-load` は要件 2 に 2.7〜2.11、要件 9 に 9.8 を足す。`chat-integration-agent` は要件 15 と、要件 1・5・11・14 の変更を持つ。この文書は、それらを避けて要件 2 に 2.12〜2.14、要件 7 に 7.9〜7.12、要件 9 に 9.9〜9.12 を足す。**番号の予約が変わったら（`notification-load` が 2.11 を取りやめるなど）、書き戻しの前にここと tasks.md の番号を見直す**（既に決めた番号を詰め直さない。空き番号は空きのままにする）

## Requirements

### Requirement 2: GROWI からチャットへの通知（追加分）

**Objective:** As a ページを編集して保存する人, I want 通知先のチャンネルを選ぶ部品が保存の操作欄を押し広げないこと, so that チャンネルが多い GROWI でも、保存と公開範囲の操作がいつもの位置にある

#### Acceptance Criteria

12. While 保存時の通知先を選ぶ部品が表示されている, the GROWI application shall 選べるチャンネルの数にかかわらず、保存の操作欄の高さと、ほかの部品の並びを変えない
13. The GROWI application shall 保存時の通知先を選ぶ部品に、選択中のチャンネルの件数を、選択肢を開かなくても分かる形で示す
14. When 編集した人が通知先の選択肢を開いた, the GROWI application shall チャンネルを workspace ごとにまとめ、チャンネルの数が多くても選択肢の領域が画面からはみ出さず、中をスクロールして選べるようにする

### Requirement 7: チャットの利用者と GROWI ユーザーの紐付け（追加分）

**Objective:** As a アカウントの紐付けを承認する人, I want どの GROWI に、どのユーザーとして、どのチャットのアカウントを結び付けるのかを承認の前に確かめられること, so that 他人のアカウントや別の GROWI へ取り違えて承認しない

#### Acceptance Criteria

9. The GROWI application shall アカウントの紐付けの承認画面を、GROWI のサイドバーやナビゲーションなど承認に関係しない部品を含まない、承認のためだけの画面として表示する
10. When 承認画面が表示された, the GROWI application shall 承認の前に次の 3 つを、互いに区別できる形で示す: この GROWI の名前、この GROWI にログインしているユーザー、紐付けるチャットのアカウント（チャットサービス・workspace・アカウントの識別子）
11. Where 紐付けの開始時にチャットサービスがアカウントの表示名を伝えていた, the GROWI application shall 承認画面に表示名を、アカウントの識別子と併せて示す。表示名しか伝えていない場合は出さない
12. When 承認画面が表示された, the GROWI application shall 承認の前に、リンクの有効期限と、心当たりがなければ承認せずに閉じてよいことを示す

### Requirement 9: chat-integration proxy と GROWI の紐付け（追加分）

**Objective:** As a GROWI の管理者, I want チャット側で紐付けが解除されて使えなくなった関係を、管理画面が「使える」と表示し続けないこと, so that 通知やコマンドが届かない原因に気付き、GROWI 側を片付けられる

#### Acceptance Criteria

9. If 管理画面が関係の接続の状態を proxy に問い合わせ、proxy が GROWI の署名を受け付けなかった, then the GROWI application shall その関係に「接続が切れている」状態を示し、「active」としては示さない
10. When 管理画面が関係の「接続が切れている」状態を示した, the GROWI application shall 原因を断定せず、チャット側で解除された可能性があることと、GROWI 側の解除（要件 9.7）で片付けられることを示す
11. If 接続の状態を、proxy に届かない・proxy が失敗を返したなど、署名の拒否以外の理由で取得できなかった, then the GROWI application shall 「接続が切れている」とは示さず、状態を確認できなかったことだけを示す
12. While 関係が「接続が切れている」状態として示されている, the GROWI application shall その関係を自動では解除せず、管理者が GROWI 側で解除する操作（要件 9.7）を使えるままにする

## Constraints

- **文言**: この spec で足す・書き換える文言は `t()` を通し、en_US・ja_JP・zh_CN・fr_FR・ko_KR の 5 言語の訳をこの spec の中で用意する。`lint:i18n` の基準値（`tools/i18n-audit/baseline.json`）は引き上げない
- **手を触れない文言**: 管理画面の、この spec が触れない部分（できることの表、権限、宛先、解除、ペアリングの申請）は、今の英語の直書きのまま残す
- **要件 2.12〜2.14 は、既存の要件 2.2 の「通知先を選ぶ」の規則を変えない**: 選択部品が返す値（`relationId`・`platform`・`channelId`。名前を含まない）と、チャンネルを選択肢からしか選べない（自由入力が無い）ことは、今のとおり保つ
