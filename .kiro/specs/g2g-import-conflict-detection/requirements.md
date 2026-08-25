# Requirements Document

## Project Description (Input)

GROWI の GROWI-to-GROWI（G2G）転送で、転送元 GROWI A の全データを別の GROWI B へ転送すると、A でユーザーグループ X に公開設定されていたページが B で閲覧不能になる不具合（issue #10151）を解消する。

### (a) 誰が困っているか
- G2G 転送で GROWI 間のデータ移行を行う管理者。転送は「成功」と表示されるのに、グループ公開ページが移行先で開けなくなり、原因も分からない。

### (b) 現状（確認済みの発生機序）
- G2G 転送のコレクション取り込みは、既定で `insert` モードを使う（受信側 `getImportSettingMap` は転送元 UI が送る `optionsMap` の mode をそのまま採用し、UI 側の既定 mode は `users`=`insert` / `usergroups`=`insert` / `usergrouprelations`=`insert`）。
- MongoDB の `bulk.insert()` は一意制約違反でそのドキュメントだけ失敗し、`execUnorderedBulkOpSafely` が書き込みエラーを配列で受け取って**処理を続行する**（例外を投げない）。
- `users` コレクションは `username`（`unique`）・`email`（`unique, sparse`）・`slackMemberId`（`unique, sparse`）に一意制約を持つ。`usergroups` は `name`（`unique`）に一意制約を持つ。
- 典型シナリオ: GROWI B は管理者アカウント（B_adminId）付きで初期セットアップ済み。A に同じ email/username の管理者ユーザーがいると、A のそのユーザードキュメント（A_userId）の insert がサイレントに失敗し、A_userId は B に作られない。
- 一方で `usergrouprelations`（A_userId → A_groupId）と `usergroups`（A_groupId）はそのまま取り込まれ、ページは `grantedGroups[].item = A_groupId` を保持したまま取り込まれる。
- ログイン時、その人物は B_adminId として認証される。ページの閲覧可否は `UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)`（= `find({ relatedUser: user._id })`）で解決され、B_adminId に紐づく関係は存在しない（関係は A_userId に紐づいている）ため、グループ X 公開ページは `grantedGroups.item` の一致に失敗し **Forbidden** になる。
- 転送後に B で新規作成したページは、`relatedUser: B_adminId` の関係が正しく作られるため閲覧できる（対比により機序が裏付けられる）。

### (c) どう変えたいか
- 一意制約の衝突を**サイレントに握りつぶさない**。取り込みを始める前に検知し、操作者に通知する（＝壊れたデータを作らない）。
- 衝突が無い転送では、グループ公開ページのアクセス権が転送後も維持されることを保証する（現状のリグレッションを起こさない）。
- 直し方の候補（衝突の事前検知＋通知 / ID の再マッピング 等）と、その到達範囲・実装難度は design で機序に照らして決める。本要件はどの方式でも満たせるよう、観察可能な結末で記述する。

## Introduction

このドキュメントは、G2G 転送における一意制約衝突の扱いに関する要件を定義する。目的は 2 つある。第一に、転送元アーカイブと転送先 GROWI の既存データとの間に `users`（`username` / `email` / `slackMemberId`）または `usergroups`（`name`）の一意制約衝突があるとき、それを**取り込み開始前に検知して操作者へ通知**し、現状のようにサイレントにドキュメントを取りこぼしてグループ公開ページを閲覧不能にする事態を防ぐこと。第二に、衝突が無い転送では、転送元でグループに属していたユーザーが転送後もそのグループ公開ページを閲覧できる状態を維持すること（既存の正常系を壊さない）。

「サイレントに握りつぶす」とは、insert 失敗を書き込みエラーとしてログに残しつつ取り込みを続行し、結果として整合性の壊れたデータ（存在しないユーザーを指す関係・到達不能なグループ公開ページ）を生成する現状の挙動を指す。本要件は、この現状を「衝突が操作者に観察可能な形で表面化し、壊れたデータを作らない」状態に置き換えることを求める。

## Boundary Context

- **In scope**:
  - G2G 転送の受信側で、取り込み対象アーカイブの `users` / `usergroups` と、転送先 GROWI の既存データとの一意制約衝突を、コレクションの書き込み開始前に検知する。
  - 衝突が検知された場合に、壊れたデータを生成せず、操作者へ衝突内容（衝突フィールド・値・件数）を観察可能な形で通知する。
  - 衝突が無い場合に、グループ公開ページのアクセス権が転送後も維持されること（正常系の非回帰）。
- **Out of scope**:
  - 管理画面からの手動 GROWI アーカイブ取り込み（zip アップロード）経路。基盤の insert 挙動は共通だが、本 spec の主対象は G2G 経路とする（手動経路への検知の適用は将来拡張。Adjacent 参照）。
  - 一意制約衝突があっても転送を**成功させる**（衝突ドキュメントの _id を既存ドキュメントへ再マッピングして関係・ページ参照を貼り替える）完全自動修復。これは将来拡張として design で言及するが、本 spec の受け入れ対象には含めない。
  - `insert` / `upsert` / `flushAndInsert` の各取り込みモードの意味そのものの変更、および MongoDB の一意制約（インデックス定義）の変更。
  - `users` 以外・`usergroups` 以外のコレクションが持つ一意制約の網羅的な検知（本 spec はグループアクセス破壊に直結する `users` と `usergroups` に限定する）。
  - ExternalUserGroup（外部連携グループ）系コレクションの衝突検知（内部 `usergroups` に限定する。必要なら別 spec）。
- **Adjacent expectations**:
  - ページの閲覧可否判定は既存の `PageQueryBuilder`（`grantedGroups.item` と、ユーザーに紐づくグループ ID 集合の一致）に依存する。本 spec はこの判定ロジックを変更しない。「グループ公開ページが閲覧できる」という結末は、ユーザー・グループ・関係の 3 者が整合して取り込まれていることに帰着する。
  - G2G 転送は、転送元（push 側）が転送先（receive 側）へアーカイブを送る非同期処理で、進捗は WebSocket（`admin:g2gProgress` / `admin:g2gError`）で転送元の管理者に通知される。「操作者への通知」はこの既存の通知経路（またはそれに準ずる、転送元の管理者が観察できる経路）で行われることを想定する。
  - 手動取り込み経路とは、ドキュメントを取りこぼす insert 挙動（`bulk.insert()` + `execUnorderedBulkOpSafely`）を共有する。本 spec で作る衝突検知の中核ロジックは、将来この経路にも再利用できる形に保つことが望ましいが、手動経路の UI 対応は本 spec の受け入れ対象外とする。

## Requirements

### Requirement 1: 一意制約衝突の検知

**Objective:** G2G 転送を行う管理者として、取り込むアーカイブと転送先の既存データとの間の一意制約衝突を、取り込みが始まる前に検知してほしい。サイレントにドキュメントを取りこぼしてデータが壊れるのを防ぐため。

#### Acceptance Criteria
1. When 取り込み対象アーカイブに、転送先 GROWI に既に存在するユーザーと同じ `username` を持つユーザードキュメント（かつ既存ドキュメントとは異なる `_id`）が含まれる場合, the G2G Transfer System shall それを一意制約衝突として検知する。
2. When 取り込み対象アーカイブに、転送先 GROWI に既に存在するユーザーと同じ `email` を持つユーザードキュメント（かつ既存ドキュメントとは異なる `_id`）が含まれる場合, the G2G Transfer System shall それを一意制約衝突として検知する。
3. When 取り込み対象アーカイブに、転送先 GROWI に既に存在するユーザーと同じ `slackMemberId` を持つユーザードキュメント（かつ既存ドキュメントとは異なる `_id`）が含まれる場合, the G2G Transfer System shall それを一意制約衝突として検知する。
4. When 取り込み対象アーカイブに、転送先 GROWI に既に存在するユーザーグループと同じ `name` を持つグループドキュメント（かつ既存ドキュメントとは異なる `_id`）が含まれる場合, the G2G Transfer System shall それを一意制約衝突として検知する。
5. If 一意フィールドの値が一致してもアーカイブ側と既存側の `_id` が同一の場合（＝同一ドキュメントの再取り込み）, then the G2G Transfer System shall それを衝突として扱わない。
6. Where 転送対象コレクションに `users` または `usergroups` が含まれない場合, the G2G Transfer System shall そのコレクションについての衝突検知を行わず、他コレクションの転送を妨げない。

### Requirement 2: 衝突時にサイレントな破壊を起こさない

**Objective:** G2G 転送を行う管理者として、一意制約衝突があるときは壊れたデータが作られないでほしい。転送は「成功」と表示されるのにグループ公開ページが閲覧不能になる、という現状を避けるため。

#### Acceptance Criteria
1. If 一意制約衝突が 1 件以上検知された場合, then the G2G Transfer System shall `users` / `usergroups` / `usergrouprelations` / `pages` を含むいずれの MongoDB コレクションについても取り込み（書き込み）を開始しない。
2. If 一意制約衝突が 1 件以上検知された場合, then the G2G Transfer System shall 転送を「成功」として完了させず、衝突が原因で転送が中断されたことを操作者に通知する。
3. The G2G Transfer System shall 一意制約衝突による insert 失敗を、書き込みエラーとしてログに残すだけで取り込みを続行する（＝壊れたデータを生成する）現状の挙動を、G2G 経路で起こさない。
4. While 衝突検知を実行している間, the G2G Transfer System shall 転送先 GROWI の既存データ（`users` / `usergroups` / `usergrouprelations` / `pages` 等）を変更しない。

### Requirement 3: 通知が実行可能（actionable）である

**Objective:** G2G 転送を行う管理者として、衝突が通知されたときに、何がどう衝突したのかと、どうすれば転送できるのかを理解できるようにしてほしい。原因不明のまま止まるのを避けるため。

#### Acceptance Criteria
1. When 衝突を操作者に通知する場合, the G2G Transfer System shall どの種別（ユーザー / ユーザーグループ）が衝突したかと、その件数を通知に含める。
2. When 衝突を操作者に通知する場合, the G2G Transfer System shall どの一意フィールド（`username` / `email` / `slackMemberId` / `name`）が、どの値で衝突したかを操作者が特定できる情報を通知に含める。
3. When 衝突を操作者に通知する場合, the G2G Transfer System shall 衝突を解消して転送を再実行するための指針（例: 衝突するアカウント・グループを事前に解消する、初期セットアップ前の空の GROWI へ転送する）を提供する。

### Requirement 4: 衝突が無いときはグループアクセスが維持される

**Objective:** G2G 転送を行う管理者として、衝突が無い正常な転送では、転送元でグループに属していたユーザーが転送後もそのグループ公開ページを閲覧できる状態が維持されてほしい。移行の目的（アクセス権ごとの移行）を満たすため。

#### Acceptance Criteria
1. When 一意制約衝突が検知されず転送が実行された場合, the G2G Transfer System shall `users` / `usergroups` / `usergrouprelations` を、取り込み後に「あるユーザーに紐づくグループ ID 集合」が転送元と同じ対応関係になるよう取り込む。
2. When 一意制約衝突が検知されず転送が実行された場合 and 転送元でグループ X に属していたユーザー U がグループ X 公開ページ P にアクセスできていた場合, the G2G Transfer System shall 転送後も U が P を閲覧できる状態を維持する。
3. The G2G Transfer System shall 衝突が無い転送について、従来の転送成功挙動（対象コレクションの取り込みと添付ファイル転送の完了、進捗の完了通知）を変更しない。

### Requirement 5: 検知結果の再現可能なテスト

**Objective:** 保守者として、衝突検知とアクセス維持が実データベース上で検証されるようにしてほしい。モックでは表面化しない一意制約・関係解決の挙動を担保するため。

#### Acceptance Criteria
1. The G2G Transfer System shall 衝突検知について、転送先に既存ドキュメントを持つ実データベース上で、衝突あり（検知される）・衝突なし（検知されない）・同一 `_id` の再取り込み（検知されない）の各ケースを検証できるようにする。
2. The G2G Transfer System shall 衝突が無いケースについて、取り込み後に「ユーザーに紐づくグループ ID 集合」が期待どおり解決されること（= グループ公開ページが当該ユーザーから到達可能であること）を実データベース上で検証できるようにする。
