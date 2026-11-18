# Research & Design Decisions: change-proposal-core

## Summary
- **Feature**: `change-proposal-core`
- **Discovery Scope**: Complex Integration（既存のページ保存・共同編集・通知・activity の仕組みに、別の書き込みの入口を足す）
- **Key Findings**:
  - 上書き防止の確認（`isUpdatable`）と書き込み（`Page.pushRevision`）は別々の段階で、書き込みのときに「最新のリビジョンがまだ確認したものか」を確かめていない。反映を人の保存とぶつけないには、書き込みそのものを「最新のリビジョンが期待どおりなら書く」1 回の更新にする必要がある。
  - ページの作成・更新の通知（アプリ内・Slack・メール）は route から出ているが、移動とごみ箱への移動のアプリ内通知は `pageService` の中から出ている。route を通らないだけでは、移動の通知は止まらない。
  - 共同編集の接続数はプロセスごとのメモリ上にしか無い。複数台のサーバーで動かすと、別のプロセスにつながっている編集者は見えない。
  - だれが承認・飛ばす・破棄をできるかの判定は、サービスと書き込みの条件の 2 か所にある。承認は、この両方で依頼した人と承認者を認める。飛ばす・破棄は、依頼した人だけに認める。承認の対象（承認者に見せる操作）は、`decideReviewScope` が決める。

umbrella の判断（決定 1〜6）とコード上の事実は [../change-proposal/research.md](../change-proposal/research.md) にある。本書はそれを前提とし、core の設計のために追加で確かめた事実と判断だけを書く。コード上の事実は 2026-10-21 時点の master を読んで確かめた。動かして確かめていないものは「未確認」と書く。

## Research Log

### ページの更新の流れ（`routes/apiv3/page/update-page.ts`）
- **Context**: 反映を人の保存と同じ確認に通すため、route の中で何が起きているかを確かめた。
- **Findings**:
  - middleware の順は `accessTokenParser` → `loginRequiredStrictly` → `excludeReadOnlyUser` → `addActivity` → 入力の検査 → handler で、`apps/app/.claude/rules/activity-recording.md` の決まった順と同じ。
  - handler の順: ページの取得（`findByIdAndViewer`）→ 書き換えられないパスの確認 → `normalizeLatestRevisionIfBroken` → `isUpdatable(revisionId, origin)`（だめなら 409 `conflict`）→ 差分用の前の本文の取得 → `pageService.updatePage` → `generateUpdateActivity`（応答の前）→ 応答 → `postAction`（待たない）。
  - `postAction` は、`origin` が `view` か空のときに `syncWithTheLatestRevisionForce` で共同編集の文書を置き換え、グローバル通知（`PAGE_EDIT`）と、依頼があれば Slack 通知を出す。
  - アプリ内通知は、`activityEvent.emit('update', …, generatePreNotify)` を受けた activity のサービスが `updated` を出し、アプリ内通知のサービスがそれを受けて作る。
- **Implications**: 人の保存で route に残すもの（activity の記録、通知）と、反映と共通にするもの（確認と書き込み）を分ける。通知は呼び出し側が選ぶ形にする。

### 書き込みのときの確認が無い（`Page.pushRevision`）
- **Findings**: `pushRevision(pageData, newRevisionData, user)`（`models/page.ts:1085`）は、リビジョンを作り、`page.revision` などを設定して `save()` する。今の `revision` が何かを条件にしていない。`isUpdatable` は route の中で先に呼ばれるだけである。
- **Implications**: `pushRevision` に「期待するリビジョンの ID」を任意で渡せるようにし、渡されたときは `Page.findOneAndUpdate({ _id, revision: 期待する ID }, …)` で書く。一致しなければ作ったリビジョンを消して例外を投げる。人の保存も同じ仕組みに乗せると、反映の側でも人の保存の側でも、確認から書き込みまでの間に別の書き込みが入ったときに、それを見つけて書き込みを止められる（Design Decisions の「確認と書き込みを 1 回の更新にする」）。

### 作成と移動と削除（`service/page/index.ts`）
- **Findings**:
  - `create(path, body, user, options)` は、近い祖先のページの閲覧範囲を引き継ぐ（`grant` を渡さなければ祖先の `grant`、グループは祖先の `grantedGroups`。`onlyInheritUserRelatedGrantedGroups` が真なら、依頼した人が属するグループだけ）。パスが使われていれば `Error('Cannot process create')` を投げる。作る前に、そのパスからのリダイレクトを消す。
  - `renamePage(page, newPagePath, user, options, activityParameters)` の options は `isRecursively` / `createRedirectPage` / `updateMetadata` だけである。activity を自分で作り、子のページが無ければ中でアプリ内通知のための `updated` を出す。子のページの移動は待たずに裏で続く（`PageOperation` で再開できる）。
  - リダイレクト（`PageRedirect`、`fromPath` は一意）は、移動のときに「移動元 → 移動先」で作られる。移動を戻しても、元のリダイレクトは消えない。そのため A→B のあと B→A と戻すと、`/A` を開いたときにリダイレクトをたどって `/B` へ行ってしまう。消す手段は `create()` の中の `deleteByFromPath` と、旧 API の `pages.unlink`（`toPath` で消す）だけである。
  - `deletePage(page, user, options, isRecursively, activityParameters)` も、中で activity を作り `updated` を出す。`deleteCompletely(page, user, options, isRecursively, preventEmitting, activityParameters)` は、ページとリビジョンなどをごみ箱を通さずに消し、activity（`PAGE_DELETE_COMPLETELY`）を作り、子のページを含めない削除では `updated` を出す。このときアプリ内通知を止める指定は無かった。人の完全な削除の route（`routes/page.js`）は `canDeleteCompletely` とユーザーのホームの条件を確かめ、`canDelete` は確かめない。削除のあとで、消す前のページで `PAGE_DELETE` のグローバル通知を送る。
  - 作成・更新・移動・削除は、どれも裏の処理のために `PageOperation` を作り、終わるまで残す。`pageOperationService.canOperate` は、重なるパスに `PageOperation` があると作成や移動を断る。
- **Implications**:
  - 移動と完全な削除には「アプリ内通知を出さない」指定を足す。
  - 移動を戻すときは、元の移動が作ったリダイレクト（移動元+suffix → 移動先+suffix。子のページの分も含む）だけを、反映の側で消す。移動元の下にあっても、ほかの移動で作られたリダイレクトは消さない（人の操作も消さない）。
  - 1 つの Change Proposal の中で、前の操作の裏の処理が終わる前に次の操作が断られることがある。反映の側で、重なる `PageOperation` が消えるのを決まった時間だけ待つ。

### 共同編集（`service/yjs/`）
- **Findings**:
  - 接続数は y-websocket のプロセスごとの `docs` の Map（`WSSharedDoc.conns`）にしか無い。接続が 0 になると、文書は Map からすぐ消える。複数のプロセスで接続の状態を共有する仕組みは無い。
  - `getYDocStatus(pageId)` が `draft` なら、共同編集の文書に、最新のリビジョンより新しい入力がある（未保存の入力）。
  - 文書が誰にも開かれていないときにサーバーが `origin` 空のリビジョンを書くと、文書の状態は `outdated` になる。次に誰かが開いたとき、`bindState` が最新のリビジョンの本文で文書を置き換える。ただし、書く前に `draft` だった場合、その未保存の入力は次に開いたときに置き換えで消える。
  - `origin` が `editor` のリビジョンをサーバーが書くと、次に開いたときに文書が置き換えられず、古い文書が残る。
  - エディタは、最新のリビジョンの `origin` が空のときだけ `revisionId` を送る。サーバーは、送られてきた `origin` が `editor` で、最新のリビジョンの `origin` が `editor` か `view` のときだけ確認を飛ばす。
  - エディタを開いている人には、`origin` が空のリビジョンが作られたことが Socket.IO で伝わり、エディタに衝突の知らせが出る（`useConflictEffect`）。
- **Implications**:
  - 反映の前に、そのページの接続数（このプロセスで見える分）と `draft` を確かめる。どちらかがあれば反映しない。
  - 反映したリビジョンの `origin` は空にする。こうすると、次に開いたときに文書が反映後の本文に置き換わる（要件 3.12）。反映の前から開いていたエディタの保存では確認が働く（要件 3.11）。
  - 反映の側では `syncWithTheLatestRevisionForce` を呼ばない。確かめてから書くまでの間に誰かがつながった場合に、その人の入力を置き換えで消さないためである。その人には衝突の知らせが出て、人が直す。

### 通知と activity
- **Findings**:
  - 通知を止める指定は今は無い。作成・更新の通知は route から、移動・削除のアプリ内通知は `pageService` から出ている。
  - アプリ内通知の受け取り手は、対象のページを購読している人から操作した人を除いた人（`pre-notify.ts`）。作成（`PAGE_CREATE`）はアプリ内通知を出さない。
  - `upsertByActivity` は全員に同じ snapshot を使う。受け取る人ごとに中身を変える前例は、メンションの通知の `insertMentionNotifications`（`insertMany`）である。
  - 新しい通知の対象の種類を足した前例は `PageBulkExportJob`。対象は Mongoose のモデル名として登録されている必要がある（一覧の API が `populate` するため）。
  - activity は `createActivity` で直接作れる（監査ログの設定で記録の対象かどうかを確かめる）。`EssentialActionGroup` に入れた action は、監査ログが無効でも記録される。監査ログの絞り込みの一覧は、action の名前の先頭（`^PAGE_` など）で分類している。
  - 全文検索・GROWI Vault・画面の更新は `crowi.events.page` を受けて動き、`pageService` の中から出るので、反映でもそのまま動く。
- **Implications**: 反映では route の応答のあとの処理を丸ごとは呼ばない。ページごとの通知を出すかは操作ごとに決め、出さないときは移動と完全な削除に通知を止める指定を渡す（「ページごとの通知は 2 つの切り替えの両方が有効なときだけ出す」）。まとめた通知は、受け取る人ごとに中身を作って `insertMany` で入れる。新しい action は `CHANGE_PROPOSAL_` で始め、監査ログの分類に新しい種類を足す。

### 機能の置き場所と前例
- **Findings**:
  - apiv3 の route とサービスを持つ機能の前例は `features/growi-vault/server/` と `features/page-bulk-export/server/`。新しいコレクションを Prisma だけで読み書きする前例は `features/mastra/server/models/refreshed-model-catalog.ts`（索引が無いので Mongoose の schema を持たない）。Mongoose の schema で索引を作り、読み書きを Prisma の拡張で行う前例は `server/models/page-redirect.ts` と `server/models/revision.ts`。
  - 期限切れの処理の前例は `wip-page-cleanup-cron.ts`（`CronService` を継承、設定キーで実行の間隔を決める、複数台の間でずらすための待ち、保守モードでは動かない）と `delete-expired-wip-page-by-system.ts`（`findOneAndUpdate` で 1 台だけが取る）。WIP ページは TTL 索引をやめてこの形にした。TTL 索引は、アプリの処理を通さずに消すので、記録には使わない。
  - 管理者の設定画面の前例は `pages/admin/ai.page.tsx` と `features/mastra/client/admin/`。管理画面は `commons` と `admin` の名前空間しか読み込まない。
  - 依頼した人ごとの 1 日の件数を数える仕組みは無い。近い前例は contribution-graph の、サーバーの日付の 0 時で区切る数え方。
  - access token の scope を足すには `@growi/core` の変更と翻訳が要る。
- **Implications**: 新しい機能は `apps/app/src/features/change-proposal/` に置く。Change Proposal のコレクションは Prisma で読み書きし、索引は migration で作り、Mongoose では通知の `target` のための空のモデルを登録するだけにする（Design Decisions の「新しいコレクションは Prisma で読み書きし、索引は migration で作る」）。scope は既存の `features.page`（利用者の API）と `admin.app`（管理者の API）を使い、新しい scope は足さない。

### 承認者の機能を足すための調査
- **Context**: 依頼した人以外が承認・却下・放棄できるようにするため、「依頼した人だけ」を前提にしている箇所と、承認者の判定に使える既存の仕組みを確かめた。
- **Findings**:
  - 操作の `status` と `reason` は enum ではなく文字列なので、承認者・判断の記録を足す migration は、索引と、古い文書への空の配列の補完だけで済む。
  - だれが書けるかの判定は、サービスの入口と、書き込みの条件の 2 か所にある。承認者を片方でしか認めないと、承認者が閉じた Change Proposal を承認したときに「閉じている」ではなく「見つからない」が返る。そのため、両方で同じ人を認める。
  - 新規作成の「待ち」の操作はまだページが無いので、対象のページを閲覧できるかでは判定できない。移動先の親のページは、反映の権限の確認では確かめない（移動元だけを確かめる）。そのため、承認者に見せる操作は、反映の権限の確認とは別に、判断に使うページの閲覧で決める。新規作成の反映は `findNonEmptyClosestAncestor(path)` のあとで依頼した人が閲覧できるかを確かめているので、「親、無ければ最も近い上のページ」の決め方は、承認者の判定でも同じものを使う。閲覧できるページ・リンクを知る人だけのページ・もう無いページを 1 回で分ける `loadViewablePages` もある。
  - ページの閲覧範囲の判定は、`UserGroupRelation.findAllUserGroupIdsRelatedToUser` と外部認証グループの同名の関数で所属を読む。ユーザーを子グループに足すと、親グループすべてにも所属の記録が作られる（`user-group.js`、`external-user-group-sync.ts`）。`pageGrantService.getUserRelatedGroups` も同じ所属をグループの種類つきで返すが、消えたグループの関連を落とす（そうした関連はグループの削除時と起動時の `removeAllInvalidRelations` で掃除されるので、結果の違いは実際には出ない）。
  - 自分の一覧は skip と limit でページ送りしている。依頼した人は自分の操作を全部見られるので成り立つが、読んだあとに閲覧できるかで絞る承認者の一覧には使えない。反映済みの一覧（`listAppliedVisible`）が、続きの位置と 1 回に調べる件数の上限で作っている。
  - 反映は、承認が付いた操作をそのとき読み直してまとめて反映する。1 回の反映が複数の人の承認をまとめて書くことがある。反映は `proposal.requester` から依頼した人を読み、操作ごとに依頼した人を確かめ直して書き込みの主体にする。
  - 1 つの activity の ID に記録できる行は 1 つである。HTTP の求めで反映が動くと、その求めの activity の ID を使い、記録されるユーザーは求めた人になる。
  - 監査ログの設定にかかわらず記録するのは、action を `EssentialActionGroup` に入れることで実現している。新しい action の名前は `admin.json` の `audit_log_action.*` に 5 言語で足す（`i18next.config.ts` に登録済みのワイルドカードで足りる）。
  - 通知の一覧の取得では `ChangeProposal` の対象を読み込まず、通知の中身は snapshot だけに頼る。viewer の表示は、読めない通知を一覧に出さない。`upsertByActivity` は 7 日以内の似た通知をまとめるので、受け取る人ごとの中身には使えない。
  - `accessTokenParser` は、どの方法でログインしたかの印を `req` に残さない。アクセストークンが付いているかは `extractAccessToken(req)` で読める。
- **Implications**: 承認の対象の決め方と承認者の判定は純関数として新しく作り、閲覧の判定は `loadViewablePages` を、所属の読み出しはページの閲覧の判定と同じ関数を再利用する。承認者の一覧は反映済みの一覧と同じ形（続きの位置と上限）で作る。経路は `extractAccessToken` の有無で `'api'` と `'ui'` に分ける（無効なトークンを付けてセッションでログインしている求めも `'api'` になる）。

### Prisma の MongoDB の落とし穴（承認者と記録の書き込みで確かめたこと）
- 省略できる項目（`reviews.operationKey`）に `in` で条件を付けると、項目の無い要素（全体の却下の記録）にも合う。`isSet: true` を一緒に付ける必要がある。
- 複合型の要素の条件の `OR: []`（空）は、「すべての要素に合う」と解釈される。対象が 0 件のときは、書き込みの関数を呼ばない。
- 配列の項目を渡さずに文書を作ると、その項目は文書に保存されない。読むときは空の配列が返るので表示には影響しないが、DB を直接条件にする問い合わせ（`$size`、`$exists` など）と食い違う。そのため、作成ではいつも `reviewers` と `reviews` を渡す。
- 配列の複合型の要素に張る索引（`@@index([lifecycle, reviewers.id, id])`）は、`prisma validate` と生成で受け付けられた（`schema.prisma` には、配列の複合型の要素に張った索引の前例がほかに無い）。schema と migration に同じ名前で書いた。
- `findMany` の `reviewers: { some: … }` は `$expr` と `$filter` に変換され、どの索引も使われない。配列の要素で探す読み取りは、ID だけを `aggregateRaw` の `$elemMatch` で読み、`findMany` で読み直す形にする（次の項）。書き込みは Change Proposal の ID で先に絞るので影響しない。

### 承認者としての一覧の索引の効き方
- **測ったもの**: 承認者としての一覧の問い合わせ（ID だけを `aggregateRaw` で読む形。条件は `{ lifecycle: 'open', reviewers: { $elemMatch: { id: { $in: [...] }, removedAt: null } }, _id: { $gt: cursor } }`、並びは `_id: 1`）が、索引 `lifecycle_1_reviewers.id_1__id_1` を使うか、調べる文書の数が総数とともに増えないかを、`explain` で確かめた。
- **結果**: 本人とグループごとの IXSCAN を SORT_MERGE でまとめる計画になった。使い捨ての DB（2,000 件と 10,000 件。8 割が開いている。4 分の 1 に、ほかの 300 人と 30 のグループが承認者として入っている。見る人の Change Proposal は 40 件）で、最初の 20 件は keysExamined 21・docsExamined 20・0〜1 ミリ秒、続きの 50 件は 20・20 だった。比べた Prisma の素直な条件（`some`）は、docsExamined が 976（2,000 件）と 4,876（10,000 件）で総数に比例した（19 ミリ秒）。別の再現（2,000・10,000・50,000 件。本人と 10 のグループ）では、最初の 20 件で keys 67・docs 66、続きの 50 件で keys 176・docs 175 で、どの規模でも同じ値だった。承認者として 1 件も付いていない人と、`$in` が空のときは keys 0・docs 0 だった。
- **注意**: 計測のファイルは CI で走らせないよう消した。ローカルの結合テストは索引の無い DB で動くので、索引が使われることを示すのはこの計測だけである。所属の読み出しは、`usergrouprelations` に `relatedUser` の索引が無いので全件を読む（ページを開くたびにすでに行っている問い合わせと同じ）。こちらは測っていない。

## Architecture Pattern Evaluation

| 案 | 内容 | 良い点 | 問題 |
|---|---|---|---|
| A. 既存の route を内部から呼ぶ | 反映で `update-page.ts` などの handler を、作った request で呼ぶ | 変更が小さい | 通知・activity・共同編集の同期が必ず走り、止められない。request が無い場面（期限切れの処理）で使えない |
| B. 反映専用の書き込みを新しく作る | 反映だけの書き込み処理を、`pageService` を使わずに作る | 人の保存に影響しない | 全文検索・Vault・閲覧範囲の確認・ページの階層の更新を二か所で持つことになり、片方だけが直されて動きが食い違うおそれがある |
| **C. 確認と書き込みを共通の処理に切り出す（採用）** | 上書き防止の確認と書き込みを `server/service/page-save/` に切り出し、人の保存と反映が同じ処理を通る。通知は呼び出し側が選ぶ | 確認と書き込みが 1 か所になる。人の保存どうしがぶつかる問題も同時に防げる | 人の保存の route に手が入る。既存の結合テストを変えずに通すことを条件にする |

## Design Decisions

### Decision: 確認と書き込みを 1 回の更新にする
- **Context**: 要件 3.3・3.16。今は確認と書き込みの間に他の保存が入れる。
- **Alternatives Considered**:
  1. 反映の側だけで、書く前にもう一度確かめる。間は狭くなるが無くならない。
  2. `Page` の `revision` を条件にした `findOneAndUpdate` で書く（採用）。
  3. MongoDB の transaction で囲む。`updatePage` の中は多くの書き込みと event を含み、全部を transaction に入れる変更が大きすぎる。
- **Selected Approach**: `pushRevision` に任意の `expectedRevisionId` を足す。渡されたときは条件付きの更新で書き、一致しなければ作ったリビジョンを消して `RevisionConflictError` を投げる。反映では元のリビジョンの ID を渡す。人の保存では、ページを読んだ時点の `page.revision` を渡す。
- **Rationale**: 人の保存は、エディタ（`origin: editor`）では `revisionId` を送らないことがある。そこで人の保存は「確認を飛ばすかどうか」は今の `isUpdatable` で決め、書き込みは「読んだ時点の最新のままなら」を条件にする。一致しなかったときは、ページを読み直して `isUpdatable` をもう一度通し、通れば決めた回数まで書き直す。通らなければ今と同じ 409 `conflict` を返す。こうすると、エディタどうしの保存は今までどおり確認を飛ばして通り、反映（`origin` 空）が間に入ったときだけ人の保存が 409 になる。
- **Trade-offs**: `updatePage` は `pushRevision` の前に `save()` で閲覧範囲や WIP の値を書くので、書き込みで負けたときに、その値だけが先に保存される。反映では閲覧範囲を変えないので影響しない。人の保存では書き直しで同じ値が書かれる。
### Decision: 共同編集の文書を反映の側では置き換えない
- **Context**: 要件 3.5・3.11・3.12。
- **Selected Approach**: 接続数と `draft` を確かめて反映するかを決め、反映後は `syncWithTheLatestRevisionForce` を呼ばない。次に開いたときに `outdated` から置き換わるのに任せる。
- **Rationale**: 確かめてから書くまでの間に誰かがつながっても、その人の入力をサーバーが消さない。その人には衝突の知らせが出る。
- **Trade-offs**: 接続数はこのプロセスの分しか見えない。複数台のサーバーでは、別のプロセスにつながっている人のページにも反映してしまう。その人には衝突の知らせが出るので黙って消えることは無いが、未保存の入力が `draft` として保存される前に書いた場合、その人が次に開き直したときに入力が置き換わるおそれがある（未確認）。umbrella の未決の論点として残す。

### Decision: 取り消しは反映と同じ操作の種類で表す
- **Context**: umbrella の決定 4。
- **Selected Approach**: 取り消しの Change Proposal の操作は、編集（元の本文に戻す。元のリビジョンは反映で作ったリビジョン）、移動（元のパスへ戻し、元の移動が作ったリダイレクトだけを消す。決定「移動の取り消しは、元の移動が作ったリダイレクトだけを消す」）、完全な削除（新規作成で作ったページを完全に削除する）の 3 種類にする。完全な削除は取り消しのときだけ使う。各操作は、どの Change Proposal のどの操作（`key`）を戻すかを持つ。
- **Rationale**: 編集と移動は、通常の操作と同じ処理と同じ確認で戻せる。新規作成をどう戻すかは、次の決定「新規作成の取り消しは完全な削除にする」による。
- **Trade-offs**: 完全な削除は戻せないので、取り消しの取り消しができるのは編集と移動だけになる。

### Decision: 自動反映の「自分が作ったページ」の判定を 1 つの関数にする
- **Context**: umbrella の未決の論点（作成者か、最後の更新者か）。
- **Selected Approach**: `isOwnPageForAutoApply(page, requester)` という 1 つの関数にし、自動反映の判定はこれだけを使う。新規作成の操作は、作るのが依頼した人なので「自分が作ったページ」として扱う。移動は移動元のページで判定する。
- **Rationale**: 定義が決まったときに変えるのは 1 か所で済む。実装を進められるように、決まるまでは作成者（`page.creator`）で判定する仮の実装にし、仮であることを関数の中に書く。
- **Follow-up**: 定義が決まったら、関数とそのテストだけを直す。

### Decision: 取り消しは管理者の設定に左右されない
- **Context**: 要件 5.13。
- **Rationale**: 管理者が書き込み機能を止めるのは、AI などからの書き込みで困ったときが多い。そのときに取り消しまで止まると、戻す手段が無くなる。取り消しは依頼した人や他の人が自分で求める操作で、自動反映とは性質が違う。
- **Trade-offs**: 書き込み機能が無効でも、反映済みの Change Proposal の取り消しは動く。

### Decision: Change Proposal の作成は、プロセスの中から呼ぶサービスとして提供する
- **Context**: brief は「作り、取得し、承認し、取り消す API」とする。最初の入口（`change-proposal-ai-agent`）は、サーバーの中の AI の道具から呼ぶ。
- **Selected Approach**: 作成はサービスの関数として提供し、REST の作成の API は作らない。取得・承認・飛ばす・破棄・取り消し・リビジョンの記録の取得は REST で提供する。
- **Rationale**: REST で作成を受けると、入口の種類（AI チャット・Vault・MCP）を呼び出し側が名乗れてしまい、正しさを確かめられない。外部から作る入口は、将来の `change-proposal-mcp` が、自分の入口の種類を決めて作る。
- **Trade-offs**: 外部からの作成は、将来の入口の spec を待つ。

### Decision: AI が書いた要約と会話は core に保存しない
- **Context**: viewer の brief は「モデル」を全員に、「AI が書いた要約や会話」を本人にだけ見せる。ai-agent の brief は、要約と会話を Change Proposal に結び付けて保存するとする。
- **Selected Approach**: core は表示用のモデル名（短い文字列）だけを持つ。要約と会話は `change-proposal-ai-agent` が Change Proposal の ID を鍵にして保存する。
- **Rationale**: core は入口を知らない（brief の Out of Boundary）。入口ごとに違う中身を core が持つと、入口を増やすたびに core が変わる。

### Decision: 管理者の設定画面の文言だけを core で 5 言語にする
- **Context**: まとめたアプリ内通知の画面での表示は viewer の In scope。
- **Selected Approach**: core は通知のデータ（受け取る人ごとの snapshot）を作る。画面に出す文言と部品は viewer が作る。core は管理者の設定画面と、監査ログに出す activity の名前を 5 言語で訳す。
- **Trade-offs**: viewer が入るまで、まとめた通知はアプリ内通知の一覧に表示されない（一覧の部品は、知らない種類を表示しない）。ただし未読の件数には数えられるので、core と viewer の通知の表示は同じ版で出す。
- **追加で確かめた事実**: アプリ内通知の一覧の API は `target` を中身ごと読み込んで返す。Change Proposal を対象にした通知では、一覧の API が `target` を `_id` だけにして返すようにする（受け取る人ごとに絞った snapshot だけを見せるため）。監査ログの一覧は対象の中身を返さない。

### Decision: 自分のページを含む反映済みの一覧は、新しい順に読みながら絞る
- **Context**: 要件 9.7。見る人が閲覧できるページは事前に列挙できない。
- **Selected Approach**: Change Proposal に「反映で触れたページの ID の一覧」を持たせる。新しい順に決まった数ずつ読み、その分のページ ID をまとめて `findByIdsAndViewer` で 1 回だけ確かめ、閲覧できるページを含むものだけを残す。1 回の要求で読む件数には上限を設け、続きの位置（cursor）を返す。
- **Trade-offs**: 見る人が閲覧できるものが少ないと、1 回の応答が少なくなる（0 件で cursor だけを返すこともある）。件数は返さない（要件 9.4）。

### Decision: リビジョンの印は操作の `key` で持ち、ページには持たない
- **Context**: 要件 6.1・6.2・6.6。リビジョンの文書は、既存の API（`/pages/recent`、`/revisions/list`、ページの取得で読み込まれるリビジョン）からそのまま返る。
- **Alternatives Considered**:
  1. 並び順の番号を印にする。既存の API の応答に番号が出るので、番号が飛んでいることから「見えない操作がある」と分かってしまう。
  2. 操作の `key`（作成のときに振る乱数の ID）を印にする（採用）。
- **Selected Approach**: リビジョンに `proposalId` と `proposalOperationKey` だけを書く。ページには項目を足さない。新規作成で作ったページは、その最初のリビジョンの印で分かる。前の実行の書き込みを探すときも、印の付いたリビジョンの `pageId` から作ったページを引く。
- **Rationale**: `key` は並び順を持たないので、既存の API の応答を変えずに済む。ページに項目を足さないので、`@growi/core` の `IPage` と `pages` の schema を変えずに済む。
- **Trade-offs**: `pageService.create` はページを保存してからリビジョンを書くので、その間で処理が止まると、印の無いページが残る。そのときは、もう一度反映しても「パスが使われている」で失敗になり、二度は書かない。

### Decision: 依頼した人でも承認者でもない人に返す操作は、反映に関わった操作だけにする
- **Context**: 要件 9.2・9.7・9.8・9.10。承認待ちの Change Proposal でも、一部の操作がすでに反映されていることがある。
- **Selected Approach**: 依頼した人でも承認者でもない人には、閲覧できるページに対する「反映済み」「取り消し済み」「取り消しを断られた」の操作だけを返す。Change Proposal が承認待ちかどうかは判断に使わない。1 件の取得・反映済みの一覧・リビジョンの印の 3 つが、同じ純関数（`selectVisibleOperations`）でこの操作を選ぶ。承認者には、1 件の取得と承認待ちの一覧で、判断に使うページをすべて閲覧できる操作も返す（要件 19.6。`decideReviewScope` が決める。決定「承認の対象は、判断に使うページの集合の閲覧で決める」）。全体の状態と `lastAppliedAt` は、どの人に対しても、返す操作だけから決める。
- **Rationale**: 反映されたページを見た人が、それを作った Change Proposal にたどれる必要がある（ページ履歴の印から詳細へ）。一方で、まだ反映されていない案や、反映されなかった案は、依頼した人と承認者が扱っている途中のものなので、それ以外の人に見せる理由が無い。段階（`lifecycle`）で判断すると、一部が反映された承認待ちの案を他の人が見られなくなる。
- **Trade-offs**: 反映済みの一覧は、文書に保存した `lastAppliedAt`（見えない操作の反映の日時を含む）の順に読む。そのため、表示する日時と並び順が食い違うことがある。分かるのは「見えない何かが、より新しく反映された」ことだけなので、見る人ごとの並べ直しはしない。

### Decision: 取り消しの通知は、元の依頼した人にも送る
- **Context**: 要件 7.8。
- **Selected Approach**: 取り消しの Change Proposal を反映したときは、通知の対象のページに完全に削除したページも含め、元の Change Proposal の依頼した人も受け取る人に加える。中身は受け取る人ごとに、閲覧できるページの分だけで作る。完全に削除したページは誰も閲覧できないので、元の Change Proposal の依頼した人にだけ、その人が新規作成を求めたときのパスで含める。
- **Rationale**: 自分が頼んだ変更を他の人が取り消したことは、そのページを購読していなくても、依頼した人が知るべきことである。完全な削除は、人が行ったときも購読している人に通知が出る。消したページのパスは、元の依頼した人が元の Change Proposal ですでに見られるので、その人に知らせても新しく漏れることは無い。今のパス（人が後から移動していれば違うパス）は使わない。元の依頼した人への通知は、元の Change Proposal を指す（snapshot の `proposalId` と `entry` を元のものにする）。画面は通知から `proposalId` の詳細ページへつなぐが、取り消しの Change Proposal の完全な削除の操作は、取り消した人にしか見せないので、それだけの取り消しでは元の依頼した人が開けず「見つからない」になる。元の Change Proposal なら、取り消された操作がすべて記録されていて、その人はいつも開ける。ほかの受け取る人の通知は、今までどおり取り消しの Change Proposal を指す（その人が閲覧できるページの操作があるので開ける）。

### Decision: 入口の request の中の作成は、その request の activity に記録する
- **Context**: 要件 7.9。入口の route は `addActivity` で activity を 1 つ作る。作成のサービスが別の activity を作ると、route の activity が記録されないまま（`ACTION_UNSETTLED`）残る。
- **Selected Approach**: `createProposal` は任意の `trigger: ApplyTrigger` を受け取る。request なら、その activity を `CHANGE_PROPOSAL_CREATE` として記録する。1 つの activity は 1 つの action にしか使えないので、作成の直後の自動反映（`CHANGE_PROPOSAL_APPLY`）は、別の activity を自分で作る。
- **Trade-offs**: 自動反映があると、1 回の request で監査ログの行が 2 つ（作成と反映）になる。どちらも意味のある記録なので、そのままにする。

### Decision: 兄弟の spec の画面の共通の部品を core に置く
- **Context**: 要件 11。viewer の画面と ai-agent のチャット画面は、どちらも操作の種類・状態・理由を言葉にし、本文の差分を表示する。
- **Selected Approach**: 値から翻訳キーを引く表、`translation` の名前空間の `change_proposal.*` のキー（5 言語）、diff2html の設定と CSS を、core の `client/shared/` に置く。ページ履歴の差分（`RevisionDiff`）も同じ部品を使う。画面ごとの文言は、それぞれの spec が `change_proposal_viewer.*` と `change_proposal_chat.*` に置く。まとめた通知の文言は viewer の `commons` に置く。
- **Rationale**: 値の型を持つのは core なので、値が増えたときに表と翻訳を同じ spec の中で直せる。2 つの画面が別々に表を持つと、同じ値の言葉が食い違う。表を `satisfies Record<…>` で宣言すると、値を足して表に足し忘れたときに型の検査で止まる。
- **Trade-offs**: キーの全体を表から引くので、翻訳キーの検査（i18next-cli）にはキーが使われていないように見える。`i18next.config.ts` の `preservePatterns` に 表の接頭辞（9 つ）のワイルドカードを足して、使われていないと報告されないようにする。`change_proposal.` で始まる静的な呼び出しを作らないので、ワイルドカードで隠れるキーは無い。

### Decision: 新しいコレクションは Prisma で読み書きし、索引は migration で作る
- **Context**: GROWI は Mongoose のモデルを Prisma の拡張（`Prisma.defineExtension`）へ順に移している（`.claude/rules/model.md`）。新しいコレクション `changeproposals` を Mongoose で読み書きすると、あとで移す対象を 1 つ増やすことになる。一方で、このコレクションには疎な索引（値を持つ文書だけが入る索引）が要り、Change Proposal の状態の変化は「今の状態がこうなら書く」という条件付きの更新に頼る。
- **確かめた事実**（apps/app が使う Prisma は 6.19.2。prisma-engines の 6.19.2 の tag のコードを読んだ）:
  1. 条件を付けた `updateMany` と `update` は、MongoDB の 1 つのコマンドにはならない。クエリエンジンは、まず条件に合う文書の `_id` を読み、次に `{ _id: { $in: 読んだ _id } }` だけを条件にして書く（`write.rs` の `update_records`）。2 回目のコマンドには元の条件が入らない。
  2. ただし、`updateMany` と `update` は、クエリエンジンが MongoDB の transaction の中で実行する（`update.rs` の `flag_transactional`、`execute_operation.rs`）。読んでから書くまでの間に、別の処理が同じ文書を書き換えると、MongoDB は書き込みの衝突（WriteConflict）を返す。クエリエンジンは、その transaction を最初からやり直す（間を 5 ミリ秒空け、合計でおよそ 12 秒まで）。やり直しでは条件を読み直すので、もう条件に合わない文書は書かれず、返る件数は 0 になる。このため、条件付きの `updateMany` は「条件に合えば書く」を 1 回の処理として扱える。結果の件数が 1 なら自分が書いた、0 なら書いていない、と判断できる。
  3. 埋め込みの配列（composite type の list。文書の中に持つ配列）への `updateMany` は、`$map` と `$cond` を使う 1 つの更新になる。配列の要素ごとに、書くときに条件を確かめて書き換える（`into_expression.rs`）。`operations` の中の、`key` と `status` が合う 1 つの要素だけを書き換える更新は、Prisma の通常の書き方で表せる。
  4. 任意の項目について、Prisma は「値が null」と「項目そのものが無い」を区別する。更新では `unset: true` で項目を消せ、条件では `isSet` で項目があるかを確かめられる（apps/app の生成された型に `unset?: boolean` と `isSet?: boolean` がある）。
  5. Prisma の schema は、疎な索引・TTL 索引・`partialFilterExpression` を表せない。また今の GROWI は `prisma db push` を使っていないので、`schema.prisma` の `@@index` は何も作らない（`.claude/skills/mongoose-to-prisma/SKILL.md`）。
  6. アプリ内通知のモデルは、`target` を `refPath: 'targetModel'` で読み込む（`server/models/in-app-notification.ts`）。通知の一覧の API は `target` を読み込むので、`targetModel` に書く `ChangeProposal` という名前の Mongoose のモデルが登録されていないと、一覧の読み込みが失敗する。
  7. apps/app の `utils/prisma.ts` は、すべての model の `update` と `updateMany` の `data` に `v: { increment: 1 }` を足す。`v`（`@map("__v")`）を持たない model では、この更新が失敗する。
- **Alternatives Considered**:
  1. Mongoose で読み書きする。移す対象が増える。
  2. Prisma で読み書きし、コレクションと索引の作成を、索引を宣言した Mongoose の schema に任せる。採用しない。索引を Mongoose の schema だけが宣言していると、その schema を取り除いたときに索引が作られなくなる。デプロイは `prisma db push` を実行しないので、`.claude/rules/model.md` は新しい索引を migration で作ることを求めている。
  3. Prisma で読み書きし、索引は migrate-mongo の migration で作る（`20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js` の前例。採用）。事実 6 のとおり、通知のために `ChangeProposal` の Mongoose のモデルの登録がどのみち要るので、項目も索引も持たない空の schema だけを登録する。
- **Selected Approach**: `features/change-proposal/server/models/change-proposal.ts` に、項目も索引も持たない空の Mongoose の schema（`getOrCreateModel('ChangeProposal', new Schema({}))` で登録し、export しない）と、Prisma の拡張を置く（`page-redirect.ts` と同じ形）。`schema.prisma` に `changeproposals` の model を足し、読み書きはすべて拡張の関数を通す。拡張は `utils/prisma.ts` の `createPrisma()` に登録する。この登録で、起動時にこのファイルが読み込まれ、`ChangeProposal` の名前の Mongoose のモデルが登録される。索引は migration `apps/app/src/migrations/20261110120000-add-change-proposal-indexes.js` が、`changeproposals` の 6 つの索引と、`revisions` の疎な索引 `{ proposalId: 1, proposalOperationKey: 1 }` を、`schema.prisma` の `@@index` と同じ名前と疎の指定で作る。
- **Rationale**: 事実 2・3 から、前の設計が `findOneAndUpdate` に頼っていた操作（lease の取得と延長、操作の状態の変化、期限切れと取り下げ）は、すべて条件付きの `updateMany` と件数の確認で同じ結果を保てる。生の MongoDB のコマンド（`$runCommandRaw`）が要る操作は無い。疎な索引は migration が作る。空の Mongoose の schema は事実 6 のために要る。
- **Trade-offs**:
  - 条件付きの更新が 1 回の処理として扱えるのは、クエリエンジンの作り（読んでから書く処理を transaction の中で行い、衝突したらやり直す）による。Prisma の文書に書かれた約束ではない。そこで、同じ条件付きの更新を 2 つ同時に走らせて、件数 1 が 1 つだけ返ることを結合テストで確かめる（tasks.md の 1.4・4.5・5.4）。Prisma の版を上げたときは、この結合テストで確かめ直す。結合テストで同時に 2 つが成功した場合は、その操作だけを `$runCommandRaw` の `update` コマンド（条件を `q` に入れ、`n` で件数を見る）に置き換える。
  - 1 回の条件付きの更新は、読み・書き・transaction の確定の 3 回の往復になる。書き込みの衝突が続くと、クエリエンジンはおよそ 12 秒でやり直しをやめ、`P2034`（transaction の衝突）の誤りを返す。呼び出し側は、これを「取れなかった（件数 0）」と同じに扱う。
  - transaction を使うので、MongoDB が replica set で動いている必要がある。GROWI は Prisma のためにすでに replica set を前提にしている。
  - Prisma の model は `v` を持つので、Prisma の更新のたびに `__v` が 1 増える（`model.md`）。`__v` の値に頼る処理は作らない。
- **条件の決め方のうち、コードから読み取りにくいもの**:
  - 期限切れと取り下げの更新（`closeIfStillOpen`）とその候補の検索は、「待ち」の操作が 1 つ以上あることを条件にする。「待ち」が無い `open` の文書は、完了の書き込みの前で処理が止まったものなので、完了にするほう（`settleIfNoPending`）へ回す（要件 2.11）。
  - 止まった反映の再開の候補（`findIdsWithInterruptedApply`）には、lease が無い文書も入れる。反映中の処理が最後に対象を読み直したあとで承認が記録され、その承認の側は lease を取れず、そのあとで反映中の処理が lease を手放すと、承認された「待ち」の操作が lease の無い文書に残るためである。
  - 完了の書き込みが止まった文書の候補（`findIdsOpenWithoutPending`）は、lease を持つ文書も含める。完了は lease と関係なく書けるためである。
- **Follow-up**: `schema.prisma` の `@@index` には、migration が作る索引と同じ項目・同じ名前（`map`）を書き、疎な索引にはそのことを注記する（`pages.wipExpiredAt` の前例）。将来 `prisma db push` が索引の作成を受け持つときに、疎の指定を付け直すためである。

### Decision: リビジョンの印の型は `@growi/core` に置く
- **Context**: 上書き防止の確認と書き込みの共通の処理（`server/service/page-save/`）は、人の保存の route も使うので、`features/change-proposal` に依存しない。一方で、その入力と `pageService.updatePage` / `create` の options は、リビジョンに書く印を受け取る。
- **Selected Approach**: `@growi/core` の `interfaces/revision.ts` に、`IRevision` と並べて `IRevisionProposalMark = { proposalId: string; proposalOperationKey: string }` を置く。`IRevision` の 2 つの任意の項目と同じ名前にする。`page-save`・`pageService`・`prepareRevision` はこの型だけを受け取る。Change Proposal の側の `ProposalMark`（`proposalId` と `operationKey`。取り消しの操作が戻す相手と、API の応答で使う）は今のまま持ち、反映のときに純関数 `toRevisionProposalMark` で `IRevisionProposalMark` に変える。
- **Rationale**: 依存の向き（`page-save` は `features/change-proposal` を import しない）を守ったまま、リビジョンの項目名と同じ名前の型を、下の層が受け取れる。
- **Trade-offs**: 似た 2 つの型（`ProposalMark` と `IRevisionProposalMark`）がある。変換を 1 つの純関数に限り、単体テストで項目の対応を確かめる。

### Decision: 完了は、待ちの状態を変えた書き込みのすぐあとの条件付きの更新で決める
- **Context**: 要件 2.9。「最後の『待ち』の状態を変えた更新で、同時に段階を完了にする」という書き方は、core の設計の契約に由来する。umbrella の決定 7 が求めるのは、「待ち」が 1 つも残らなくなったら自動で完了にすることだけで、同じ更新で行うことまでは求めていない。
- **確かめた事実**: Prisma の更新は `data` を条件で切り替えられない。「この操作が最後の待ちなら、段階も `settled` にする」を 1 つの `updateMany` で書くには、条件の違う 2 つの更新（ほかに待ちが無い場合の更新と、ある場合の更新）を順に試し、どちらも当たらなければやり直す、という繰り返しが要る。
- **Alternatives Considered**:
  1. 上の 2 つの更新を順に試す。正しく書けるが、操作の結果を書くすべての関数に、やり直しの繰り返しが入る。
  2. 待ちの状態を変えた書き込みのすぐあとに、`lifecycle: 'open'` で「待ち」が 1 つも無いことを条件にした更新（`settleIfNoPending`）を、同じ処理が呼ぶ（採用）。
- **Selected Approach**: 2。反映の 1 回の実行の終わりと、飛ばす処理のあとで呼ぶ。2 つの書き込みの間で止まった場合は、保守用の cron が `open` で「待ち」の無い文書を探して完了にする。期限切れと取り下げは「待ち」があることを条件にする。
- **Rationale**: 条件付きの更新なので何度呼んでも結果は同じで、反映と飛ばす処理が最後の 2 つの待ちの状態を同時に変えても、あとに呼んだほうが必ず完了にする。関数ごとのやり直しの繰り返しが要らない。
- **Trade-offs**: 2 つの書き込みの間は、段階が `open` のまま「待ち」が無い。この間に起きることは、完了の表示が遅れることだけである（design の Open Questions / Risks）。

### Decision: 段階と達成度は依頼した人にだけ返す
- **Context**: 要件 12。依頼した人以外には、その人に見える操作だけを返している。
- **Selected Approach**: 段階と達成度を `requesterState` にまとめ、依頼した人への応答にだけ入れる。全体の状態（`ProposalStatus`）は今までどおり操作の状態から決め、`settled` を全体の状態の値には足さない。
- **Rationale**: 依頼した人以外に段階を返すと、見える操作がすべて終わっているのに段階が承認待ちのままであることから、見えない「待ち」の操作があると分かる。達成度も、分母から見えない操作の数が分かる。
- **Trade-offs**: 依頼した人以外の画面には「完了」が出ない。他の人にとって意味があるのは反映された内容なので、全体の状態の表示で足りる。

### Decision: 後続と見直しは `basedOn` で元に結び付け、元の操作は書き換えない
- **Context**: 要件 13・14。umbrella の決定 7。
- **Selected Approach**: 後続・見直しの Change Proposal の側に `basedOn`（元の ID・関係・元の操作の `key`）を持ち、元の側は書き換えない。元から後続・見直しへは `basedOn.proposalId` の疎な索引で引く。作れるのは元の依頼した人だけで、元が取り消しの Change Proposal のときは作れない。
- **Rationale**: 元の操作の状態（取り消し済みかどうかなど）は、取り消しの仕組みだけが決める。見直しの反映で元の操作を「取り消し済み」にすると、機械的に戻せたかのように見え、取り消しの判定（戻せる条件）の意味が崩れる。つながりを片側だけに持てば、元の文書を書き換える同時実行の問題が起きない。
- **Trade-offs**: 元の Change Proposal を開くたびに、つながりを読む問い合わせが 1 回増える。読む件数に上限を設ける。
- **元の操作として認める状態**: 後続は「古い」「失敗」「飛ばした」。「待ち」は元の Change Proposal でまだ承認できるので、後続にすると同じ変更が 2 か所で承認できてしまう。見直しは「反映済み」「取り消しを断られた」（今も内容がページに残っている操作）。「取り消し済み」は、内容がすでに戻っているので見直す意味が無い。

### Decision: 見直しは自動反映しない
- **Context**: 要件 13.4。
- **Selected Approach**: `selectAutoApplyTargets` に関係を渡し、見直しなら方針にかかわらず空を返す。
- **Rationale**: 見直しは、ほかの人がその後に加えた編集をふまえて内容を作り直すものなので、元の案より人の編集とぶつかる見込みが高い。依頼した人または承認者が差分を確かめてから反映する。

### Decision: ページごとの通知は 2 つの切り替えの両方が有効なときだけ出す
- **Context**: 要件 7.1・7.10–7.19・8.9。理由の全体は umbrella の research.md の決定 8。
- **Selected Approach**: 管理者の設定（初期値は出さない）と、Change Proposal ごとの指定（初期値は出す）の両方が真のときだけ、人の操作と同じページごとの通知を出す。2 つを組み合わせるのは純関数 `shouldSendPerPageNotifications` だけにし、ProposalApplier が操作を書く直前に両方を読み直して決める。取り消しの Change Proposal は元の指定を引き継ぐ。まとめた通知はいつも出す。
- **追加で確かめた事実**: 人の操作のグローバル通知は、編集・新規作成・移動・削除（ごみ箱へ移すと完全な削除）のどれも route から送られ、`globalNotificationService.fire` の中でページの閲覧範囲から送るかを決めている。編集の購読している人へのアプリ内通知は、route の `generateUpdateActivity` が `PAGE_UPDATE` の activity を `preNotify` つきで知らせて作られる。反映の activity（`CHANGE_PROPOSAL_APPLY`）とは別の action なので、1 つの activity の ID では両方を記録できない。
- **Rationale**: 編集のアプリ内通知のために、操作ごとに `beginActivity` で `PAGE_UPDATE` の activity を作り、route と同じ処理（`emitPageUpdateActivity`）で知らせる。グローバル通知も route の送り方を `firePageGlobalNotification` に移して共有する。人の保存と同じ処理を通すので、受け取る人の決め方と閲覧範囲の判定がずれない。
- **Trade-offs**: 両方を有効にすると、購読している人には同じ変更についてページごとの通知とまとめた通知の両方が届く。編集ごとに `PAGE_UPDATE` の activity が監査ログに増える。指定は操作ごとに読み直すので、操作 1 つにつき問い合わせが 1 回増える（本文を読まない小さな問い合わせにする）。

### Decision: 上限の初期値は操作数 50、1 日の件数は上限なし
- **Context**: 要件 8.10。理由は umbrella の research.md の決定 8。
- **Selected Approach**: `changeProposal:maxOperationsPerProposal` の初期値を 50、`changeProposal:maxProposalsPerUserPerDay` の初期値を `null`（上限なし）にする。どちらも管理者が変えられる。
- **Trade-offs**: ai-agent の書き込みの道具は 1 回の呼び出しで 20 個（`MAX_OPERATIONS_PER_CALL`）までしか受けないので、初期値のままでは操作数の上限で断られることは無い。管理者が 20 より小さくしたときは、core が `input-rejected`（`too-many-operations`）を返す。

### Decision: 承認待ちの期限の初期値は 30 日にする
- **Context**: 要件 2.5。design の OQ-1 の期限の部分。初期値が `null`（期限なし）だと、初期の状態では承認待ちの Change Proposal がいつまでも残り、要件 2.5 の期限切れが動かない。
- **Selected Approach**: `changeProposal:pendingExpirationSeconds` の初期値を 30 日（`2592000` 秒）にする（人が決めた）。値の決め方は今までどおり「DB の値があればそれ、無ければ環境変数か初期値」で、読む側の `toLimit` が 0 以下と数字以外を `null`（期限なし）と読む。この設定は画面に出していないので、期限をなくすには環境変数に `0` を入れる。期限は作成のときに `expiresAt` として保存し、保守用の cron はその `expiresAt` だけを見るので、cron の候補の決め方は変えない。
- **Trade-offs**: 期限は作成のときに `expiresAt` として決まるので、期限の長さを変えても、すでに作られた Change Proposal の期限は変わらない。期限なし（`0`）の間に作られた Change Proposal は `expiresAt` を持たず、あとで期限を設けても期限切れにならない。破棄・期限切れの案の本文をいつ消すかは、まだ決めていない。

### Decision: 取り消しの結果を元の操作に書く処理は、例外のときだけその場で 2 回までやり直す
- **Context**: 要件 5.9・13.5。取り消しの操作の結果を記録したあと、元の操作に書く `markOriginalOperation` が DB の一時的な障害で例外になると、元の操作は「反映済み」のまま残り、取り消しの Change Proposal は完了になるので、直す処理が無かった。
- **Alternatives Considered**: 1. 保守用の cron で、元の操作と取り消しの操作の結果を突き合わせて書き直す。2. その場で短い間を置いてやり直す。
- **Selected Approach**: 2（人が決めた）。150 ミリ秒の間を置いて 2 回までやり直し、それでも例外ならログに残して進む。`false`（元の操作がもう取り消せる状態でない）は正しい結果なのでやり直さない。取り消しの前に断ると決めた操作の記録（`revert` の受付の中）も、同じやり直しを使い、書けなくても受付全体を失敗にしない。
- **Rationale**: 一時的な障害はたいていすぐ直るので、その場のやり直しで足りる。cron で書き直すには、取り消しの操作と元の操作を突き合わせる新しい問い合わせと、その処理の結合テストが要り、得られるものに比べて大きい。
- **Trade-offs**: 3 回とも失敗したときは、元の操作が「反映済み」のまま残る。もう一度取り消しを求めると判定し直されるが、取り消しで変わったページに対しては、たいてい「取り消しを断られた」になる。

### Decision: 新規作成の取り消しは完全な削除にする
- **Context**: 要件 5.6・5.15・5.16。
- **Alternatives Considered**: 1. ごみ箱へ移す（取り消しの取り消しで戻せる）。2. 完全に削除する。
- **Selected Approach**: 2（人が決めた）。新規作成の取り消しは、作ったページを `pageService.deleteCompletely` で完全に削除し、ごみ箱に残さない。完全な削除の取り消しは `target-unavailable` で断る。
- **Rationale**: Change Proposal を受け入れる前は、そのページはごみ箱にも無かった。取り消したあとでごみ箱に残るのは、受け入れる前の状態に戻ったとは言えず不自然である。
- **権限**: 人が画面から完全に削除するときの route（`routes/page.js`）は、`canDeleteCompletely`（`security:pageCompleteDeletionAuthority`。複数のグループに公開されたページで、公開先のすべてのグループに属していることを求める設定も含む）と、ユーザーのホームのページでの `canDeleteUserHomepageByConfig`・`isUsersHomepageOwnerAbsent` を確かめる。取り消しでは、これに加えて route が確かめていない `canDelete`（`security:pageDeletionAuthority`）も求める。人ができる以上のことを取り消しでできないようにするためで、どちらの権限が厳しく設定されていても、それに従う。表示する「戻せるか」（要件 5.14）と、書き込みの直前の判定は、同じ関数（`createCanDeletePageCompletely`）で行う。
- **やり直しの扱い**: handler の `findExistingResult` は、ページがもう存在しなければ「反映済み」とみなす。`deleteCompletely` のあと、結果を記録する前に処理が止まった場合に、やり直しで同じ操作を記録できるようにするためである。人が同じ間に完全に削除した場合も「反映済み」になるが、ページが無いという結果は同じなので、止まったあとのやり直しを優先する。
- **見せ方**: 完全に削除したページは、閲覧できるかを判定できない。対象のページがもう存在しない操作は、まだページが無い新規作成と同じく、依頼した人にだけ返す（依頼した人以外には存在も知らせない）。人が後からページを完全に削除した操作も同じ扱いになる。
- **Trade-offs**: 取り消しの取り消しで、作ったページを戻すことはできない。間違えて取り消したときは、もう一度作り直す。完全な削除の権限を管理者だけにしている GROWI では、管理者でない人は新規作成を取り消せない（`not-deletable`）。依頼した人以外は、新規作成を取り消したあとの元の操作を見られなくなる。
- **共通の処理の変更**: `deleteCompletely` は、子のページを含めない削除で、アプリ内通知を止める指定（`isInAppNotificationSuppressed`）が真のとき、`updated` を出さない（activity は記録する）。`deletePage` と同じ扱いで、ページごとの通知を出さない設定のときに通知が出ないようにするためである。子のページごと消す削除は、指定にかかわらず今のまま通知する。

### Decision: 移動の取り消しは、元の移動が作ったリダイレクトだけを消す
- **Context**: 要件 5.7。移動は「移動元 → 移動先」のリダイレクトを、子のページの分も含めて作る。戻したときにこれが残ると、元のパスを開いても移動先へ送られる。
- **Alternatives Considered**:
  1. 移動元とその下を起点とするリダイレクトを、行き先を見ずに全部消す。人が前に作った `/A/old → /X` のような、元の移動と関係の無いリダイレクトまで、戻せない形で消えてしまう。
  2. 元の移動が実際に作る形（移動元+suffix → 移動先+suffix）だけを消す（採用）。
- **Selected Approach**: 2。`PageRedirect` の Prisma の拡張の `deleteRedirectsCreatedByMove({ fromPath, toPath })` で消す。suffix は空か `/…` で、移動先の側は `renamePage` と同じく、移動先の文字列をそのまま前に付けて作る。完全一致で比べるので、移動が実際に書いた組だけが消える（末尾に `/` が付いた移動先は作成のときに断るが、それより前に保存された提案を取り消すときも、同じ比べ方で正しく消せる）。取り消しの移動の書き込みと、`findExistingResult` で途中の後始末を済ませるときの両方で使う。
- **進め方**: 1 回の移動で何万件もできることがあるので、候補を `fromPath` の順に 1000 件ずつ読み、消す組を `_id` で 1000 件以下ずつ消す。全件を 1 回のコマンドで消すと、長い日本語のパスでは送るコマンドが MongoDB の 16MB の上限を超えて失敗し、件数が増えると時間も急に延びたためである。移動元そのもののリダイレクト（戻したページを隠す `/A → /B`）を、下のページの分より先に消すので、途中で失敗しても残りうるのは下のページの分だけである。何度呼んでも結果は同じ。
- **Trade-offs**: 反映の前から人が手で作った、まったく同じ形のリダイレクトは区別できず消える。保存されているデータから判断できる最も狭い条件がこれである。

### Decision: 末尾に `/` が付いたパスは、作成のときに断る
- **Context**: 要件 1.13・3.8。人の route（作成の `create-page.ts`、移動の `routes/apiv3/pages/index.js`）は、パスを先に `normalizePath` で正規化する。反映ではパスを正規化しないので、末尾に `/` が付いたパスをそのまま受け付けると、既にある `/A` と同じ親の下に `/A/` という中身のある別のページができる、子のあるページを `/B/` へ移すと `/B//child` ができる、既にある `/C` へ別のページを `/C/` として移動できる、といったことが起きる。
- **Alternatives Considered**: 1. 作成のときに正規化して受け付ける。2. 作成のときに断る（採用。人が決めた）。
- **Selected Approach**: `isUsablePagePath` は、`path === normalizePath(path)` でないパスを `invalid-path`（操作の番号つき）で断る。新規作成のパスと移動先の両方に当てる。`/` はもともと正規化された形なので扱いを変えない（作成のときは受け付け、反映のときに既にあるページとして `path-occupied` になる）。

### Decision: 反映でも、人の route と同じユーザーページの保護を通す
- **Context**: 管理者がユーザーページを無効にしている（`security:disableUserPages`）とき、人の route は `/user` の下への書き込みを断る。反映がこれを通らないと、人ができない書き込みを Change Proposal でできてしまう。
- **Selected Approach**: 作成のときと反映のときの両方で、人の route と同じ `isUsersTopPage` / `isUserPage` を使う共通の判定 `findUserPageWriteRefusal`（`server/service/page/user-page-write-guard.ts`）で確かめ、当たれば `target-unavailable` にする。存在しないユーザーのホームの下への作成も断る。移動は、無効の確認を移動元と移動先の両方で、持ち主がいるかの確認を移動先だけで行う。これは duplicate の route と同じ規則で、rename の route より厳しい。AI には、ページが無いか閲覧できない場合と同じ値で伝わる。
- **Trade-offs**: `judgeRevertability` はこの規則を知らないので、ユーザーページを無効にしたあと、`/user` に触れる編集・移動の取り消しは、画面で「戻せる」と出ても、反映では `target-unavailable` で断られる。完全な削除の操作は、人の完全な削除と同じく `disableUserPages` を確かめない。

### Decision: 承認者の判定は 1 組の純関数にまとめる
- **Context**: 要件 15–22。承認者かどうか・承認の対象かどうかの判定は、取得・承認者としての一覧・6 つの操作（承認・却下・全体の却下・放棄・承認者の追加と削除）・通知のすべてで、同じ答えを出す必要がある。答えが食い違うと、ある応答だけから見えない操作の存在が分かってしまう。
- **Alternatives Considered**:
  1. 承認者の判定を各 route に書く。手早いが、判定が複数に散り、見える範囲の判定とずれる。
  2. 承認者の判定と承認の対象の決め方を 1 組の純関数にし、所属と閲覧の判定を読む薄い層を `services/` に置く（採用）。
  3. 承認者の機能を別のコレクションと別のサービスにする。既存への影響は小さいが、状態の書き換えが 2 回になって整合が崩れる。既存の「待ち」の操作と一体で動く必要がある。
- **Selected Approach**: 2。純関数の入力（所属グループ）は、呼ぶ側が 1 回の求めにつき 1 回だけ読んで渡す。
- **Trade-offs**: 所属を読む層が別に要る。純関数は設定を読まないので、機能の切り替えは呼ぶ側で確かめる。

### Decision: 却下と放棄は、操作の状態を変えない判断の記録にする
- **Context**: 要件 17。却下を操作の新しい状態（`rejected`）にすると、状態の追加が多くの場所（全体の状態の決め方、後続を作れる状態の表、表示名の表、取り消しの進み具合、viewer と ai-agent の型の網羅、古い版のコードが知らない値を読んで例外になる問題）に広がり、承認との競合を条件で避ける必要が出る。「全体の却下で、閲覧できないページの操作まで却下になる」問題と、達成度の分母や完了への移り変わりの扱いも決める必要が出る。
- **Alternatives Considered**:
  1. 却下を操作の状態にし、承認との競合を条件で避ける。
  2. 却下と放棄を、GitHub の Request changes と同じく、意見の記録と通知だけにする（採用。人が決めた）。
- **Selected Approach**: 2。却下（操作ごと・全体）と放棄は、文書の一番上の配列 `reviews` に、誰が・いつ・コメントを足すだけにする。操作の状態、承認の条件、段階、達成度は変えない。承認は、状態を決める記録なので、状態を書くのと同じ 1 回の更新で、操作の項目（`approvedBy`、`approvedChannel`、`decisionToken`）として書く。承認者の一覧（`reviewers`）も文書の一番上の配列に持つ（一番上の配列への追加には `appliedPageIds` の前例がある）。配列の中の配列を書き換える操作（Prisma の `updateMany` の中での入れ子の `push`・`deleteMany`）には頼らない。
- **Rationale**: 状態を足さないので、上の波及がすべて要らない。却下は記録を足すだけなので、承認との競合の条件と `settleIfNoPending` の呼び出しが要らない。全体の却下は操作に何も書かないので、閲覧できないページの操作の扱いの問題も起きない。
- **Trade-offs**: 却下は反映を止めない。グループの 1 人が却下しても、別の 1 人が承認すれば反映される。却下しても Change Proposal は自動では完了にならず、依頼した人が操作を飛ばすか Change Proposal を破棄するまで残り、放置されると期限切れになる。画面の表示名は、止めない意味が伝わる語（「変更を依頼」など）にする（viewer が決める）。API の名前は `reject` のままなので、コードには、`reject` が反映を止めないことをコメントで書く。止める形と、承認にコメントを付ける形は、後の候補として残す。
- **Follow-up**: 承認者の追加・削除・記録の置き換えは、要素ごとの条件付きの書き込み（追加は `push`、削除は要素への `removedAt` の書き込み、記録の置き換えは追加と削除の 2 回の更新）にし、同じ更新での組み合わせには頼らない。記録の置き換えは「足してから、今回の日時より前の同じ人の記録を消す」順にする。消してから足すと、その間に Change Proposal が閉じたり承認者が外されたりしたとき、前の記録だけが失われるためである。

### Decision: 承認の対象は、判断に使うページの集合の閲覧で決める
- **Context**: 要件 16・19.6。承認者がどの操作を判断できるかを決める必要がある。
- **Selected Approach**: 操作ごとに「判断に使うページ」の集合（編集は対象のページ、新規作成は親のページ、移動は移動元と移動先の親）を決める純関数を作り、閲覧の判定は `loadViewablePages` を再利用する。承認者は、その集合のすべてを閲覧でき、リンクを知る人だけのページを含まないときに、その操作を判断できる。上のページのパスは、まとめて 1 回の問い合わせで引く。上のページは、空でない最も近い上のページのパスで決め、そのパスにある空でないページをすべて閲覧できることを求める（`path` は一意でなく、1 つに絞ると閲覧できない親の代わりに閲覧できる別のページで判定してしまう。ツリーに載るページだけに絞ると、移行前の v4 のページが親のときに別の形で漏れる）。
- **Rationale**: 「新しい判定の規則は作らない」は、閲覧できるかの判定を新しく作らない、の意味で守る。判断に使うページの決め方は、3.6（反映の権限の確認先）と 3.9（新しいページの閲覧範囲は親と同じ）を承認者に当てはめたものである。
- **Trade-offs**: 反映済み・取り消し済み・取り消しを断られたの操作は、承認者にも、依頼した人でも承認者でもない人と同じ規則（対象のページ）で見せる（要件 19.10）。そのため、親は公開で作られたページがグループ X だけのとき、X に入らない承認者には、反映前は見えた新規作成が反映後は見えなくなる。

### Decision: 承認者に返す値と、依頼した人にだけ返す値を、役割で分ける
- **Context**: 要件 19.1・19.2・19.7・19.8。依頼した人でも承認者でもない人には「待ち」を返さず、並び順と変更後の本文も隠している。並び順の番号の飛びから、隠した操作の存在が分かるため。
- **Selected Approach**: 見る人の役割を 3 つ（依頼した人・承認者・それ以外）に分ける。承認者には、判断できる操作の変更後の本文、元のリビジョンが今も最新か、見える操作の中での順位（元の番号ではない）、変更の目的、承認者の一覧、判断の記録を返す。AI の要約と会話、段階と達成度、ページごとの通知の指定は、依頼した人にだけ返したままにする。依頼した人が自分自身や自分のグループを承認者に入れていても、役割は依頼した人を優先する。
- **Rationale**: 変更の目的は、承認者が「何のための変更か」を分かって判断するために要る。AI との会話や要約は依頼した人の作業の記録で、承認者に見せる理由が無い。

### Decision: 依頼した人でない人には、見える操作だけから決めた段階を使う
- **Context**: 要件 16.9・18.8・19.6。依頼した人でない人に、実際の段階をそのまま使うと、`not-open` を返すかどうかや全体の状態の言葉（破棄・期限切れなど）から、見えない「待ち」の操作の有無が分かる。たとえば、見える操作が「失敗」1 件で、見えない「待ち」が 1 件ある Change Proposal を破棄すると、その人の画面だけ「破棄」になる（操作が 1 件だけなら「反映されなかった」になる）。
- **Selected Approach**: 依頼した人でない人には、見える操作だけから決めた「見える段階」を、`not-open` の判定と全体の状態の計算の両方に使う。見える操作が 0 件の人は、閉じているかを判定する前に「見つからない」にする。依頼した人には実際の段階を使う（依頼した人は自分の Change Proposal の全体を知っているので、漏れにならない。依頼した人に見えない「待ち」だけが残る場合は、`not-open` ではなく成功の応答になる）。書き込みの条件には実際の `lifecycle: 'open'` を残す。
- **Trade-offs**: Change Proposal は実際には開いていても、その人に見える「待ち」が無ければ `not-open` になる。たとえばグループの所属者 2 人が同じ操作を承認し、1 人目の承認で反映されたあと、その操作しか見えない 2 人目の求めには、Change Proposal がまだ開いていても `not-open` が返る。そのため、要件 16.5・16.11 の「その時点の操作の状態を返す」は、「その人に見える『待ち』の操作が残っている限り」の条件つきにしている。`not-open` の応答には `results` を入れない。承認者でも、見える操作が 0 件なら、判断だけでなく承認者の追加・削除も「見つからない」になる（要件 16.7。要件 19.4 と同じ基準）。

### Decision: 承認した人は、承認の activity と操作の項目に残し、反映の activity は変えない
- **Context**: 要件 20.9。1 回の反映は、そのとき承認が付いている操作をまとめて書くので、複数の人の承認をまとめて書くことがあり、反映の activity に「承認した人」を 1 人に決められない。
- **Selected Approach**: 承認の求めでは、承認の activity（`CHANGE_PROPOSAL_APPROVE`）をその求めの ID で記録し、承認の求めで動く反映は背景の反映と同じ形で呼ぶ（反映の activity は新しい ID、操作者は依頼した人、`ip` と `endpoint` は空）。承認した人・経路・日時は、承認の書き込みで操作の項目に残す。「承認した人」を反映の引数にはせず、反映の中身は変えない。
- **Rationale**: 反映の activity に承認者の `ip` と `endpoint` を並べると、操作者は依頼した人なのに別の人の接続元が記録され、監査ログを誤って読ませる。反映の権限の確認と作者は依頼した人のままなので、要件 21.1–21.3 もそのまま満たす。activity は一定期間で消えるので、長く残る記録は Change Proposal の中（`approvedBy`・`approvedChannel`、`reviewers` の `removedBy` など）に持つ。
- **Trade-offs**: 依頼した人の承認でも、承認の activity（求めの ID）と反映の activity（新しい ID、`ip` と `endpoint` が空）の 2 行になる。監査ログで、求めと反映を `ip` でつないで読む処理は使えない。

### Decision: 判断と承認者の追加・削除を activity に記録し、経路を残す
- **Context**: 要件 20.8・20.10。承認・却下・放棄だけでなく、承認者の追加・削除も、誰がどこから行ったかを監査ログで追えるようにする（人が決めた）。activity には経路を入れる項目が無い。
- **Selected Approach**: 5 つの action（承認・却下・放棄・承認者の追加・削除）を足し、経路（`ui` / `api` / `ai-tool`）を snapshot に残す。snapshot の型は、リポジトリの snapshot の置き場所の方針と、添付ファイルの activity が `AttachmentSnapshot` を足した前例に沿って、`interfaces/activity.ts` に `ChangeProposalReviewSnapshot` と type guard を足す（snapshot を作る処理は `proposal-activity.ts` に置く）。保存先の `ActivitiesSnapshot` は全 activity が共有する 1 つの composite 型で、和集合にできないので、項目 `reviewChannel` を足す（Mongo では migration は要らない）。項目名は、「channel」だけだと Slack のチャンネルと取り違えやすいので、機能に固有の名前にする。
- **確かめた事実**: activity を実際に保存する経路（`emit('update')` → `settleActivityRecord` → `createByParameters`）は、snapshot の項目（`username`、`originalName`、`pagePath` など）を手で並べて組み立てる。ここに足さないと、書いても黙って捨てられる。`updateByParameters` が使う `buildSnapshotUpdateEnvelope` は本番の記録の経路では呼ばれないが、そろえて足す。`username` は `settle-activity-record.ts` の `?? context?.username` で保たれる。
- **Trade-offs**: activity は一定期間で消えるので、長く残る記録は Change Proposal の中（`approvedChannel`、`reviewers` の `removedBy` など）のままにする。誰を追加・削除したかは activity に書かず、Change Proposal の記録で分かる。

### Decision: 依頼した人の承認も、依頼した人に見える操作だけを対象にする
- **Context**: 要件 16.1・16.3。承認の入口を依頼した人と承認者で 1 つにまとめる。
- **Selected Approach**: 依頼した人の承認の対象を、依頼した人に返す「待ち」の操作に限る。依頼した人が提出後に閲覧できなくなったページの操作は、承認の対象にならず「待ち」のまま残り、期限切れで「飛ばした」になる。
- **Alternatives Considered**: 見えるかどうかで絞らずに承認し、反映のときの権限の確認で「失敗」にする形。依頼した人の承認だけ別の規則になり、入口を 1 つにできない。
- **Trade-offs**: その操作は「失敗」ではなく「待ち」として残り、期限切れで「飛ばした」になる。依頼した人は Change Proposal を破棄して閉じることもできる。

### Decision: 依頼した人は、親のページを閲覧できなくなっても、自分の承認待ちの新規作成と、それへのコメントを見続ける
- **Context**: 要件 17.8・19.1。まだページの無い新規作成の「待ち」の操作は、依頼した人にはいつも返る（`selectVisibleOperations` は、ページの無い操作を依頼した人には閲覧の判定なしに返す）。依頼した人が提出後に親のページを閲覧できなくなった場合、その新規作成と、承認者がそれに付けた却下・放棄のコメントも、依頼した人に見え続ける。
- **Alternatives Considered**: 依頼した人にも、新規作成を親のページの閲覧で絞って見せる。
- **Selected Approach**: 今の形のまま受け入れる（コードは変えない）。
- **Rationale**:
  - 要件 17.8 は、操作ごとの判断の記録を返す相手に、依頼した人を条件なしで挙げている。
  - 新規作成のパスと本文は、依頼した人自身が書いたものなので、その存在を依頼した人から隠す意味が無い。
  - コメントは自由な文字なので、承認者はどのコメントにでも、どのページの名前でも書ける。親のページの閲覧で絞っても、コメントからページの名前が分かる経路は塞げない。
  - 隠すと、依頼した人が飛ばすことも破棄で閉じることもできない「待ち」の操作が生まれる。
- **Trade-offs**: 依頼した人は、閲覧できなくなった親のページの下に作ろうとしたパスと、それへのコメントを見続ける。承認者が書いたコメントの文面に、依頼した人が閲覧できないページのことが書かれていても、それは承認者が書いた内容として受け入れる。

### Decision: 承認者の機能は、承認者を保存する 2 か所だけで切り替える
- **Context**: 公開の順序（requirements の Adjacent expectations）。core はすでに出荷されているので、書き込み機能を有効にした環境では、承認の画面が無いまま承認者の追加などの route が使えてしまう。
- **Alternatives Considered**:
  1. 新しい切り替えを作らず、書き込み機能の初期値が無効であることと、spec の順序で守る。上の理由で守れない。
  2. 切り替えが無効の間、承認者の機能（指定、追加・削除、却下・放棄、一覧、通知）をすべて止める。サービスの 4 か所の確認と、純関数への引数が要る。
  3. 承認者を保存する 2 か所（作成で承認者を渡すとき、承認者の追加）だけで確かめる（採用。人が決めた）。
- **Selected Approach**: 3。設定キー `app:changeProposalReviewersEnabled`（初期値は無効、環境変数 `CHANGE_PROPOSAL_REVIEWERS_ENABLED`、管理者の設定画面には出さない）。無効のとき、依頼した人以外を含む承認者の保存を `reviewers-disabled` で断る。
- **Rationale**: 承認者が保存されなければ、ほかの経路は承認者がいないので自然に働かない。確かめる場所が少ないので、確かめ忘れの穴も少ない。
- **Trade-offs**: 無効にしても、すでに指定された承認者の動きは止まらない。後続・見直しが引き継ぐ承認者は、すでに保存されたものなので確かめない。viewer の承認の画面と承認待ちの一覧、ai-agent の承認者の指定の入口が入ってから有効にする。

### Decision: 承認者に指名できるユーザーは、有効な状態の人だけにする
- **Context**: 要件 15.5・18.5。実在の確認が「ユーザーの文書があるか」だけだと、停止中や削除済みの人も指名できる。停止中の人は承認の操作ができず（`user-not-allowed`）、削除済みの人には通知が届かないので、Change Proposal がその人を待っているように見える。
- **Selected Approach**: 作成での指定と、後からの追加の両方で、有効な状態（`STATUS_ACTIVE`）でないユーザーを、存在しない場合と同じ `reviewer-not-found` で断る（人が決めた）。グループは存在だけを確かめる。
- **Trade-offs**: 指名したあとで停止・削除された人は、承認者に残る。引き継ぎ（後続・見直し）では確かめ直さない。

### Decision: 上限の値は、承認者 20、コメント 500、変更の目的 2000 にする
- **Context**: 要件 15.7・15.9・17.6。
- **Selected Approach**: 定数（`MAX_REVIEWERS`、`MAX_REVIEW_COMMENT_LENGTH`、`MAX_PURPOSE_LENGTH`）にし、管理者の設定にはしない。文字数は `modelLabel` と同じくコードポイントで数える（`.length` は使わない）。
- **Trade-offs**: 承認者の上限は、同時の追加で数件超えることがある。上限は安全のためではなく、通知と一覧の量の目安なので受け入れる。

### Decision: 承認者としての一覧は作成が古い順に読み、続きの位置は一覧に出した最後の ID にする
- **Context**: 要件 19.5。
- **Alternatives Considered**:
  1. 期限が近い順に読む。期限の無い文書のための 2 段階の読み取りと、暗号化した続きの位置が要る。
  2. `_id` の順（作成が古い順）に読み、続きの位置を平文にする（採用。人が決めた）。
- **Selected Approach**: 2。期限は作成のときに「作成時刻 + 設定値」で書かれ、ほかで書き換えないので、作成が古い順は期限が近い順と同じになる（設定値を途中で変えると、その前後で少しずれる）。続きの位置は、一覧に出した最後の Change Proposal の ID にする（人が決めた）。
- **Rationale**: 続きの位置が平文なので、調べた最後の Change Proposal の ID を返すと、その Change Proposal に見る人の承認の対象が無いとき、それが実際に開いていると分かり、取得で見える段階が閉じている Change Proposal については、見えない「待ち」の存在を推測できてしまう。
- **Trade-offs**: 1 回に調べる上限に達して 1 件も出していなければ `null` を返し、その回の一覧はそこで終わる（データの終わりと区別できない）。承認者として指定された開いている Change Proposal が、承認の対象を持たないまま上限の件数以上続く場合だけの制限として受け入れる。1 件以上出していれば、次の呼び出しはその次から調べ直すので、読む量は増えるが、1 回に調べる上限は変わらない。

### Decision: 承認待ちの一覧の cursor は署名せず、細工した cursor で 1 件の Change Proposal が開いているかどうかが分かることを受け入れる
- **Context**: cursor は 24 桁の 16 進数なら受け付ける。細工した cursor の値を変えながら何度も呼ぶと、「cursor が `null` でなく、返った件数が `limit` 未満」になる境目から、「その cursor の後ろから 500 件目（1 回に調べる上限）の、自分が承認者に指定された開いている Change Proposal」の ID が分かる。その Change Proposal に自分の承認の対象が 0 件でも、開いていることが分かる。
- **Alternatives Considered**: (1) cursor に署名し、サービスが返した値以外を断る。(2) `limit` の上限を下げる。
- **Selected Approach**: どちらも入れず、既知の小さな例外として受け入れる（人が決めた）。
- **Rationale**: 分かるのは、自分が承認者に指名された Change Proposal 1 件が開いているかどうかだけで、中身・ページ・依頼した人は分からない。成り立つには、500 件以上の開いている Change Proposal で承認者に指名されていることなどが要る。署名は、鍵の管理と、鍵を変えたときに cursor が無効になる扱いが増え、費用に見合わない。(2) は、`limit` が 2 以上なら境目が残るので、塞げない。
- **Follow-up**: 重く見る事情が出たら、cursor の形を変えずに署名の検証を足せる。

### Decision: 入力の形は route で確かめ、サービスは型を信頼する
- **Context**: 却下・放棄（`POST /:id/reviews`）と承認者の追加・削除（`PATCH /:id/reviewers`）の本文の形（配列か、要素が文字列か、`kind` の値など）を、route とサービスのどちらで確かめるか。将来の AI の道具が route を通らずにサービスを呼ぶことが考えられるが、今その道具からサービスを呼ぶコードは無く、サービスの引数の型はすでに形を表している。
- **Alternatives Considered**: (1) route とサービスの両方で確かめる。(2) route だけで確かめ、サービスは型を信頼する。
- **Selected Approach**: (2)（人が決めた）。本文の形は、承認の route と同じく express-validator で確かめ、誤りは 400 `validation_failed` で断る。`req.body` の型は検証が保証する形で書き、型の変換なしでサービスに渡す。サービスは業務の規則（コメントの長さ、空のコメントを「コメントなし」とする扱い、承認者の上限、実在と有効の確認、重複のまとめ、機能の切り替え）だけを確かめる。形の誤りのためだけのエラーコードは作らない。
- **Rationale**: 型で閉じられる穴は、型と入口の検証で閉じる。サービスの奥に実行時の検査と、型に反する値をわざと作って渡すテストを置くと、同じ規則が 2 か所に分かれ、どちらが正しいかが分からなくなる。route で確かめれば、承認の route と同じ応答（`validation_failed`）になる。
- **Trade-offs**: route を通らない入口（将来の AI の道具など）は、自分の入口で形を確かめてから呼ぶ必要がある。忘れると、型に合わない値がそのままサービスに届く。キーが空の配列は型（`readonly string[]`）では断れないので、サービスに渡ると、何も記録せずに成功を返す（全体の却下にはならない）。

### Decision: 通知の action は、きっかけになった activity の action を使う
- **Context**: 承認者への通知（`review-request`）と判断の結果の通知（`review-result`）にも、`InAppNotification` の `action` が要る。通知のためだけの action（`CHANGE_PROPOSAL_REVIEW_REQUEST` など）を作ると、activity として記録されないのに、名前が `CHANGE_PROPOSAL_` で始まるので監査ログの絞り込みの一覧に出て、選んでも何も見つからない。
- **Alternatives Considered**: (1) 通知のためだけの action を作り、監査ログの絞り込みの一覧から外す。(2) 通知のためだけの action を作らず、通知のきっかけになった activity の action を使う。
- **Selected Approach**: (2)（人が決めた）。承認者への通知は、作成（`CHANGE_PROPOSAL_CREATE`）か承認者の追加（`CHANGE_PROPOSAL_REVIEWER_ADD`）の action を使う。判断の結果の通知は、承認（`CHANGE_PROPOSAL_APPROVE`）・却下（`CHANGE_PROPOSAL_REJECT`。全体の却下もこれ）・放棄（`CHANGE_PROPOSAL_ABSTAIN`）の action を使う。activity を記録した側が、その action を通知の処理に渡す。通知の種類は snapshot の `kind` で見分ける。
- **Rationale**: 反映の通知（ProposalNotifier）が、すでにこの形である（action は反映か取り消しの activity のもの、種類は snapshot の `kind`）。通知に付ける activity と action がそろう。(1) は、一覧から外すための特別な扱いが要り、activity にならない action とその 5 言語の表示名が残る。同じ action を使っても、ほかの通知とは混ざらない。これらの activity は target の文書を渡さずに記録するので、既存のアプリ内通知の経路（`upsertByActivity`）は動かず、同じ action の通知が別に作られることはない。通知の一覧の画面は `targetModel` で読み手を決めるので、今の画面が action を見て Change Proposal の通知に別の文言を出すこともない。
- **Trade-offs**: action だけでは通知の種類が決まらない（たとえば `CHANGE_PROPOSAL_CREATE` の通知が承認者への通知だと分かるのは、snapshot の `kind` を読んだとき）。通知を読む処理は、snapshot の `kind` で形を選ぶ必要がある。ai-agent は通知の action を読まない。

### Decision: 書き込みの衝突であきらめたときの扱いを、操作の性質で分ける
- **Context**: Prisma は書き込みの衝突が続くと `P2034` であきらめる。承認・却下と放棄・承認者の追加で、そのときの応答をどうするか。
- **Selected Approach**:
  - 承認: `markApproved` は `not-open` を返す。Change Proposal がまだ開いていれば、「何も書かなかった」として成功の応答で読み直した状態を返す。承認の activity・結果の通知・記録の削除はしない。承認されなかった操作は応答の中で「待ち」のまま見えるので、利用者は失敗に気付ける。
  - 却下・放棄: 例外のまま返す（route では 500。利用者はやり直せる）。成功しても操作の状態を変えないので、衝突を成功の応答で隠すと、保存できた場合と見分けがつかず、判断とコメントが黙って失われる。応答に「この求めで書いたか」の印を足す形は、その値を応答に出さないと決めているので採らない。
  - 承認者の追加: 例外のまま返す（route では 500）。例外の前に保存された承認者には、追加の activity も通知も出ない（足された人は承認待ちの一覧で見つけられる）。1 回の求めの中で最大 20 回、順に書くだけなので、めったに起きない。
- **Follow-up**: 承認者の追加で通知の漏れを無くすなら、サービスの層で 1 件ずつモデルを呼んで足した人を積み、例外のときに通知と activity を出してから投げ直す形にできる。

## References
- `apps/app/.claude/skills/learned/page-save-origin-semantics/SKILL.md` — `origin` と上書き防止の確認の関係
- `apps/app/.claude/rules/activity-recording.md` — activity の記録の順序
- `apps/app/.claude/rules/page-write-action-403-404.md` — 見えないページへの応答をそろえる規則
- `.claude/rules/model.md` と `.claude/skills/mongoose-to-prisma/SKILL.md` — 読み書きは Prisma の拡張、索引の作成は migration
- prisma-engines 6.19.2 の `query-engine/connectors/mongodb-query-connector/src/root_queries/write.rs`（`update_records`）、`query-engine/core/src/query_graph_builder/write/update.rs`、`query-engine/core/src/executor/execute_operation.rs`、`mongodb-query-connector/src/root_queries/update/into_expression.rs` — 条件付きの更新の実行のしかた
- `.kiro/specs/collaborative-editor/design.md` — 共同編集の文書の状態
- `.kiro/specs/revision-diff-api/design.md` — 見る人ごとの絞り込みの前例
- `.kiro/specs/change-proposal-viewer/requirements.md` と `.kiro/specs/change-proposal-ai-agent/design.md` — 承認待ちを依頼した人だけに見せる前提で書かれた箇所（承認者の機能の Revalidation Triggers の相手）

## 反映の所要時間の計測（8.4）
- **測ったもの**: 操作数の上限の初期値（50）いっぱいの Change Proposal（ページの編集 45 件 + 新規作成 5 件）を承認してから、反映が終わって `approve` が戻るまでの時間（`performance.now` で計測）。あわせて、ページごとのアプリ内通知が購読者全員の分そろうまでの時間も測った。どちらのモードでも、反映前のページの作成は計測の外で行い、最初の 1 回は捨て、通知なし・通知ありを交互に 3 回ずつ実行した。
- **2 つのモード**: 「通知なし」は管理者の設定でページごとの通知を止めた場合。「通知あり」は管理者の設定と Change Proposal の値の両方を有効にした場合。編集した 45 ページそれぞれを 5 人が購読しており（アプリ内通知は 1 回の反映で 225 件）、全体の通知の設定（メール、対象は編集と作成）が本物の GlobalNotificationService を通る（設定の検索とメール本文の組み立ては実際に動く）。本物から差し替えたのは次の 4 つ: メールの送信（`mailService.send`）、ユーザーごとの通知の送信（`userNotificationService`）、編集中の人がいるかの情報源（テスト用の部品で常に「誰もいない」。YjsService は使わない）、ページのイベント（全文検索・Vault への反映の処理は動かさない）。
- **結果**（単位はミリ秒。1 操作あたりは中央値を 50 で割った値）:

| 回 | モード | 最小 | 中央値 | 最大 | 1 操作あたり |
|---|---|---|---|---|---|
| 1 回目 | 通知なし | 2058 | 2356 | 2411 | 47.1 |
| 1 回目 | 通知あり | 2046 | 2346 | 2371 | 46.9 |
| 2 回目 | 通知なし | 2089 | 2096 | 2124 | 41.9 |
| 2 回目 | 通知あり | 2040 | 2274 | 2319 | 45.5 |

- **読み方**: 通知ありと通知なしの差は、回ごとのばらつき（約 300 ミリ秒）と同じくらいの大きさにとどまった。ページごとのアプリ内通知は `approve` が戻った時点ですでにそろっていた（戻ってからそろうまでの差は 3 ミリ秒以内）。通知を出すことで処理が極端に遅くなる様子（ページ数に比例して問い合わせが増えすぎるような問題）は見られなかった。
- **環境**: 開発用のコンテナ。MongoDB は `MONGO_URI` を設定せずに実行したため、メモリ上の MongoDB（結合テストの既定）を使った。CPU は 12th Gen Intel Core i7-12650H、`nproc` は 16。計測日は 2026-10-27。
- **注意**: 開発用のコンテナでの数字で、本番の MongoDB（ネットワーク越し・レプリカセット）では 1 回の書き込みの往復が長くなるため、所要時間は増える。計測用のテストは `apps/app/src/features/change-proposal/server/services/change-proposal-apply-timing.integ.ts`（結果の正しさだけを確かめ、時間の上限は確かめない。測った数字はテストの出力に出る）。このテストは時間がかかるので、普段のテストの実行では飛ばされる。測るときは `CHANGE_PROPOSAL_MEASURE_TIMING=1 pnpm vitest run change-proposal-apply-timing` で実行する。
