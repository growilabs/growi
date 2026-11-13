# Research & Design Decisions: change-proposal-reviewers

この文書は amend spec の調査と判断の記録である。core に戻すときは、判断と理由を `change-proposal-core/research.md` に移し、この spec ごと削除する（[spec-lifecycle](../../../.claude/rules/spec-lifecycle.md)）。

## Summary

- **Feature**: `change-proposal-reviewers`（`change-proposal-core` の amend spec）
- **Discovery Scope**: Extension（既存の Change Proposal のデータ・ルート・通知・activity に、承認者を足す）。軽い discovery を行い、コードの調査は 3 つに分けて実施した（データモデルと状態／ルートと見える範囲／通知・activity・他 spec への影響）。
- **Key Findings**:
  - 保存は Prisma。操作の `status` と `reason` は enum ではなく文字列なので、状態「却下」を足しても migration は要らない。承認者の一覧用の索引は、新しい migration ファイルで作る（既存の migration は書き換えない）。
  - 承認・飛ばす・破棄を「依頼した人だけ」にしている箇所は、サービス側（`requester-actions.ts`）と書き込みの条件（`models/change-proposal.ts` の `where {requester}`）の 2 か所にある。両方を広げないと、承認者が閉じた Change Proposal を承認したときに「閉じている」ではなく「見つからない」が返り、要件 2.9 を満たせない。
  - 新規作成の「待ち」の操作は、まだページが無いので、今は依頼した人にしか見えない。移動先の親ページを確かめている箇所も、この機能のどこにも無い。承認の対象を決める部分は、新しく作る。

## Research Log

### 保存の形と、モデルを変える決まり
- **事実**: 読み書きはすべて Prisma の拡張関数（`server/models/change-proposal.ts`）。Mongoose は通知が参照するための空のモデルだけ。スキーマは `prisma/schema.prisma` の `changeproposals`。操作は文書の中の配列。索引は migration（`src/migrations/20261110120000-add-change-proposal-indexes.js`）で作り、schema.prisma に同じ名前で宣言している。
- **事実**: `.claude/rules/model.md` の決まりは、新しい索引を migrate-mongo の migration の `createIndex` で作り、schema.prisma にも同じ名前で書き、Mongoose の schema には書かないこと。migration は ESM で `up` と `down` を名前付きで export する。
- **含意**: 承認者の索引は新しい migration。古い文書には新しい配列が無いので、`$set reviewers: []` の補完を同じ migration に含める（Prisma が欠けた配列を空として返すかは未確認だったため、補完で不確かさを無くす）。

### 判断の記録の置き方（3 案）
- **案 A: 操作の要素の中に配列で持つ**。1 回の `operations.updateMany` で書ける。要素の中の配列への追加と削除（要件 3.4 の放棄の置き換えに必要）を、Prisma の `updateMany` の中でできるかが未確認。
- **案 B: 文書の一番上に配列で持つ**。一番上の配列への追加には前例がある（`appliedPageIds`）。承認者を外しても記録が残る（要件 4.12）。
- **案 C: 別のコレクション**。書き込みが 2 回になり、途中で止まったときの復旧が要る。今の「条件付きの 1 回の更新」から外れる。
- **判断**: 状態を決める記録（承認・却下）は、状態を書くのと同じ 1 回の更新で、**操作の要素の項目**として書く（承認した人・日時・経路、却下した人・日時・経路・コメント）。「状態を変えない記録」（放棄）と承認者の一覧は、**文書の一番上の配列**（案 B）に持つ。状態の書き換えと記録を同時に書ける、という利点を、状態を決める記録だけに使う。案 A の「要素の中の配列の更新」は使わないので、未確認の点に頼らない。

### 却下を表す形
- **判断**: 操作の状態に `rejected` を足す。Change Proposal 全体の段階（`lifecycle`）には新しい値を足さない。全体の却下は、すべての「待ち」の操作を `rejected` にし、既存の「待ち」が無くなったら完了にする仕組み（`settleIfNoPending`）に任せる。
- **理由**: 段階を足すと、表示名・見た目・一覧の絞り込みなど多くの場所が変わる。却下の意味は操作の状態で足りる。`derive-proposal-status.ts` が `failed/stale/skipped` だけを見て「反映できなかった操作がある」と判定しているので、ここに `rejected` を足さないと、反映済みと却下が混ざった提案が「反映済み」と表示される（コンパイルでは見つからないので、タスクに明記する）。
- **達成度**: `compute-achievement.ts` は依頼した人が自分で飛ばした操作だけを分母から除くので、要件 3.12 は変更なしで満たされる。

### 同時実行（承認と却下）
- **事実**: 承認（`markApproved`）は状態を変えず `approvedAt` を付けるだけで、そのあと排他の印（リース）を取った 1 つの処理が反映する。反映は `approvedAt` を持つ「待ち」の操作を対象にする。
- **既存の穴（本 spec の対象外）**: `skipPendingOperations` は `approvedAt` もリースも条件に入れていない。反映の処理がページを書いたあと、結果を記録する前に「飛ばす」が割り込むと、ページは書かれたのに操作は「飛ばした」になる。この競合を確かめるテストも文書も無い。
- **判断**: 新しい却下の書き込みの条件に `status: 'pending'` と `approvedAt: null` を入れる。承認済み（反映待ち）の操作は却下できず、承認が先なら承認が勝つ。こうすれば、却下は反映の処理と交わらない。既存の「飛ばす」の穴は本 spec では直さず、別に直す候補として記録する。

### 承認の対象（承認者が見る操作の決め方）
- **事実**: 新規作成の反映では、`findNonEmptyClosestAncestor(path)` のあと依頼した人が閲覧できるかを確かめている。この「親、無ければ最も近い上のページ」の判定は再利用できる。移動では移動元だけを確かめていて、移動先の親は確かめていない。
- **事実**: 閲覧できるページ・リンクを知る人だけが見られるページ・すでに無いページを 1 回で分ける `loadViewablePages`（`current-page-facts.ts`）がある。
- **判断**: 操作ごとに「判断に使うページ」の集合（編集は対象のページ、新規作成は親ページ、移動は移動元と移動先の親）を決める純関数を作り、閲覧の判定は `loadViewablePages` を再利用する。承認者は、その集合のすべてを閲覧できる（かつリンクを知る人だけのページを含まない）ときに、その操作の承認の対象を持つ。パスから上のページを引くときは、1 回の問い合わせにまとめる（パス 1 つにつき 1 回の問い合わせにしない）。
- **brief の制約との関係**: 「新しい判定の規則は作らない」は、閲覧できるかの判定を新しく作らない、の意味で守る。判断に使うページの決め方は、core 3.6（権限の確認先）と 3.9（新しいページの閲覧範囲は親と同じ）を当てはめるもの。

### グループの所属の判定
- **事実**: ページの閲覧範囲では、`UserGroupRelation.findAllUserGroupIdsRelatedToUser` と外部認証グループの同名の関数を使う。`pageGrantService.getUserRelatedGroups` がグループの種類つきで返す。ユーザーを子グループに足すと、親グループすべてにも所属の記録が作られる（`user-group.js`、`external-user-group-sync.ts`）。
- **判断**: 承認者の判定は、ユーザーの所属グループの ID を 1 回取得して使う。子グループの展開は要らない（直接の所属を見るだけで、ページの閲覧範囲と同じ規則になる）。取得した所属を、閲覧の判定（`findByIdsAndViewer` の第 3 引数）と承認者の判定の両方に渡す。

### 承認者の一覧（レビューの受信箱）
- **事実**: `listMine` は skip/limit でページ送りしている。依頼した人は自分の操作を全部見られるので成り立つ。承認者の一覧は、読んだあとに閲覧できるかで絞るので、この作りは使えない。`listAppliedVisible` が、続きの位置（カーソル）と 1 回に調べる件数の上限で作っている。
- **判断**: `listAppliedVisible` と同じ形（カーソル、1 回に調べる上限）で作る。条件は `{lifecycle: 'open', reviewers に本人かその所属グループの ID を含む}`、並び順は期限が近い順（`expiresAt` 昇順、同じなら `_id`）。索引は `{lifecycle, reviewers.id, expiresAt, _id}` の複合索引。
- **未確認**: 配列の要素に張る索引が実際にどれだけ効くか。`usergrouprelations` に relatedUser の索引が無く、所属の取得は今も全件を読んでいる（ページを開くたびに既に行っているのと同じ問い合わせ）。実測はしていない。タスクに計測を含める。

### 反映の経路と権限、作者
- **事実**: 反映は `proposal.requester` から依頼した人を読み、操作ごとに `findRequester` と `isRequesterAllowed` で依頼した人を確かめ直し、その人を書き込みの主体にする（`proposal-applier.ts`）。
- **事実**: 反映は、承認が付いた操作を、そのとき読み直してまとめて反映する。1 回の反映が複数の人の承認をまとめて書くことがある。
- **判断**: 「承認した人」は反映の引数にせず、承認の書き込み（`markApproved`）で操作に記録する。反映の中身は変えない。そのため、反映時の権限の確認と作者は依頼した人のままで、要件 7.1〜7.3 を満たす。

### activity と通知
- **事実**: 1 つの activity ID に記録できる行は 1 つ。HTTP の求めで反映が動くと、その求めの activity ID を使い回し、記録されるユーザーは求めた人になる。
- **判断**: 承認の求めでは、「承認」の activity をその求めの ID で記録し、承認の求めで動く反映は背景の反映と同じ形で呼ぶ（反映の activity は新しい ID、操作者は依頼した人。既存の背景の経路と同じ）。1 回の反映が複数の人の承認をまとめて書くことがあるので、「反映の activity に承認した人を含める」は成り立たない。そのため、要件 6.9 を「承認した人を承認の activity と操作の項目に残す。反映の activity は変えない」に直した（設計の検証 1 回目の指摘）。
- **事実**: 新しい activity の種類は、`~/interfaces/activity.ts` の `SupportedAction`、`EssentialActionGroup`、`MediumActionGroup` に足す。監査ログの設定にかかわらず記録するのは、Essential に入れることで実現している。名前は `public/static/locales/*/admin.json` の `audit_log_action.*` に 5 言語で足す（`i18next.config.ts` に登録済みのワイルドカードで足りる）。
- **事実**: 通知は、通知の種類（action）を新しく足し、snapshot に `kind` を持たせ、`InAppNotification.create` を直接呼ぶ前例が「戻すよう頼む」通知にある。`upsertByActivity` は 7 日以内の似た通知をまとめるので使わない。一覧の取得では `MODEL_CHANGE_PROPOSAL` の対象を読み込まず、通知の中身は snapshot だけに頼る。viewer の表示は `parse-notification-snapshot.ts` が `null` を返す通知を一覧に出さないので、viewer の対応が済むまで、新しい通知は表示されない。

### 経路（画面・API・AI の道具）
- **事実**: `accessTokenParser` は、どの方法でログインしたかの印を残さない。AI の道具は service を直接呼ぶので、引数で明示できる。
- **判断**: 経路を `'ui' | 'api' | 'ai-tool'` の 3 値にする。HTTP のルートは、アクセストークンで認証された求めなら `'api'`、そうでなければ `'ui'` とする補助関数で決める。AI の道具は `'ai-tool'` を引数で渡す。トークン認証かどうかを `req` から読む方法は、実装時に確かめる（読めなければ `'ui'` を既定にし、`'api'` の判別は後続に回す）。

### 依頼した人の承認の変更
- **事実**: 今の承認（`requester-actions.ts` の `resolveApprovalKeys`）は、見えるかどうかで絞らずに承認し、依頼した人が閲覧できなくなったページの操作は、反映時の権限の確認で「失敗」になる。
- **判断**: 承認の入口を 1 つ（`reviewer-actions.approve`）にまとめるので、依頼した人の承認も、見える操作だけを対象にする（要件 2.1）。そのような操作は「待ち」のまま残り、期限切れで「飛ばした」になる。意図した変更としてテストに入れる。

### 公開の順序
- **判断**: 新しい設定キー `app:changeProposalReviewersEnabled`（既定は無効。管理画面の項目は作らない）で、承認者の機能の公開を切り替える。当初は「新しい切り替えは作らず、書き込み機能の既定が無効であることと spec 間の依存で守る」としたが、設計の検証 4 回目で、core はすでに master に入っており、書き込み機能を有効にした環境では、画面が無いまま承認者の追加などのルートが使えてしまう、と分かったため、切り替えを足した。無効の間は、承認者の指定を受け付けず、承認者の追加・削除・却下・放棄・承認者としての一覧と承認者への通知を、存在しないものとして扱う。依頼した人の承認と、承認者を持たない Change Proposal の動きは変えない。viewer と ai-agent の追従が入ったあとに有効にする。

## Architecture Pattern Evaluation

| 案 | 内容 | 利点 | 欠点 | 判断 |
|---|---|---|---|---|
| 承認者の判定を各ルートに書く | ルートごとに所属を調べる | 手早い | 判定が複数に散り、見える範囲の判定とずれる | 不採用 |
| 承認者の判定を 1 つの純関数にする | 承認者である人・承認の対象を純関数にし、ルートとサービスと一覧の問い合わせが同じ関数を使う | 判定の食い違いが起きない。テストしやすい | 関数の入力（所属グループ）を読む層が要る | **採用** |
| 承認者の機能を別のコレクションと別のサービスにする | 既存と分離 | 既存への影響が小さい | 状態の書き換えが 2 回になり、整合が崩れる。既存の「待ち」の操作と一体で動く必要がある | 不採用 |

## Design Decisions（要約）

### Decision: 状態を決める記録は操作の項目に、状態を変えない記録は文書の配列に
- **Context**: 承認・却下は状態を変える。放棄は状態を変えず、人ごとに置き換わる。
- **Selected Approach**: 承認・却下は操作の項目（`approvedBy` など）。放棄と承認者の一覧は文書の一番上の配列（`abstentions`、`reviewers`）。
- **Rationale**: 状態の書き換えと記録を 1 回の条件付き更新で書ける。要素の中の配列の更新に頼らない。
- **Trade-offs**: 記録が 2 か所に分かれる。見る側（`to-operation-view`）で合成する。
- **Follow-up**: 追加・削除・放棄の置き換えは、要素ごとの条件付きの書き込み（追加は `push`、削除は要素への `removedAt` の書き込み、放棄の置き換えは削除と追加の 2 回の更新）にし、同じ更新での併用には頼らない。

### Decision: 却下は操作の状態として足し、全体の段階は足さない
- **Rationale**: 上の Research Log のとおり。
- **Follow-up**: `deriveProposalStatus` の「反映できなかった操作」の判定を手で直す。`BASED_ON_ELIGIBLE_STATUSES['follow-up']` に足すと、viewer の「残りの操作」の一覧と ai-agent の「後続を作る」条件にも影響するので、両方の spec の追従を Revalidation Triggers に書く。

### Decision: 承認の対象は、判断に使うページの集合の閲覧で決める
- **Rationale**: 上の Research Log のとおり。

### Decision: 承認者に返す値と、依頼した人にだけ返す値を、役割（依頼した人・承認者・それ以外）で分ける
- **Context**: 依頼した人以外には「待ち」を返さず、並び順や変更後の本文も隠している。並び順の番号の飛びから、隠した操作の存在が分かるため。
- **Selected Approach**: 見る人の役割を 3 つに分け、承認者には、変更後の本文、元のリビジョンが今も最新か、見える操作の中での順位（元の番号ではない）、変更の目的、承認者の一覧、判断の記録を返す。AI の要約・会話、段階と達成度、ページごとの通知の指定は、依頼した人にだけ返したままにする。

## Risks & Mitigations
- **配列の索引の効き方が未実測** → 計測のタスクを置く。1 回に調べる件数の上限で最悪の負荷を抑える。
- **`deriveProposalStatus` の判定の直し忘れ**（コンパイルで見つからない） → タスクに明記し、結合テストで「反映済みと却下が混ざった提案」の表示を確かめる。
- **「却下」を知らない古い版のコードが `rejected` を読むと例外になる**（`toMember`） → 版を戻す運用では、却下を含む文書が残ると読めない。リリースノートに書く。
- **viewer・ai-agent が「承認待ちは依頼した人にだけ」を前提にしている** → Revalidation Triggers に書き、viewer・ai-agent の spec に追従を足す。
- **経路の判別（`'api'` と `'ui'`）が実装時に確かめられない可能性** → 既定を `'ui'` にし、判別は後続に回せるようにする。

## 実装時に確かめる点（未確認の事実）
1. 配列の複合型（`reviewers.id`）に張る `@@index` を、Prisma の schema が受け付けるか（既存の 5 件はどれも配列でない複合型で、前例が無い）。受け付けなければ、索引は migration の `createIndex` だけで作り、schema.prisma には書かない（`.claude/rules/model.md` の決まりに照らして確認する）。
2. `reviewers` が無い古い文書を Prisma が空の配列として返すか（補完の migration で無くす）。
3. 配列要素に張る複合索引の実測の効き方。
4. アクセストークン認証かどうかを `req` から読む方法。
5. 承認者の一覧で期限が無い文書の並び（MongoDB は値の無いものを昇順の先頭に置くので、期限がある文書を先に読み、そのあとに期限が無い文書を読む 2 段階にする。カーソルに段階を持たせる）。期限が無い文書は、設定で期限を無効にした場合にだけ生じる。

## References
- `.kiro/specs/change-proposal-core/design.md`、`requirements.md`、`research.md`
- `.kiro/specs/change-proposal-viewer/requirements.md`（承認待ちを依頼した人以外に見せない前提の箇所）
- `.kiro/specs/change-proposal-ai-agent/design.md`（承認・飛ばす・破棄の画面の前提）
- `.claude/rules/model.md`、`apps/app/.claude/rules/`（import、ESM、ルート）
