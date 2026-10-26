# Research & Design Decisions: change-proposal-core

## Summary
- **Feature**: `change-proposal-core`
- **Discovery Scope**: Complex Integration（既存のページ保存・共同編集・通知・activity の仕組みに、別の書き込みの入口を足す）
- **Key Findings**:
  - 上書き防止の確認（`isUpdatable`）と書き込み（`Page.pushRevision`）は別々の段階で、書き込みのときに「最新のリビジョンがまだ確認したものか」を確かめていない。反映を人の保存とぶつけないには、書き込みそのものを「最新のリビジョンが期待どおりなら書く」1 回の更新にする必要がある。
  - ページの作成・更新の通知（アプリ内・Slack・メール）は route から出ているが、移動とごみ箱への移動のアプリ内通知は `pageService` の中から出ている。route を通らないだけでは、移動の通知は止まらない。
  - 共同編集の接続数はプロセスごとのメモリ上にしか無い。複数台のサーバーで動かすと、別のプロセスにつながっている編集者は見えない。

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

### 作成と移動とごみ箱（`service/page/index.ts`）
- **Findings**:
  - `create(path, body, user, options)` は、近い祖先のページの閲覧範囲を引き継ぐ（`grant` を渡さなければ祖先の `grant`、グループは祖先の `grantedGroups`。`onlyInheritUserRelatedGrantedGroups` が真なら、依頼した人が属するグループだけ）。パスが使われていれば `Error('Cannot process create')` を投げる。作る前に、そのパスからのリダイレクトを消す。
  - `renamePage(page, newPagePath, user, options, activityParameters)` の options は `isRecursively` / `createRedirectPage` / `updateMetadata` だけである。activity を自分で作り、子のページが無ければ中でアプリ内通知のための `updated` を出す。子のページの移動は待たずに裏で続く（`PageOperation` で再開できる）。
  - リダイレクト（`PageRedirect`、`fromPath` は一意）は、移動のときに「移動元 → 移動先」で作られる。移動を戻しても、元のリダイレクトは消えない。そのため A→B のあと B→A と戻すと、`/A` を開いたときにリダイレクトをたどって `/B` へ行ってしまう。消す手段は `create()` の中の `deleteByFromPath` と、旧 API の `pages.unlink`（`toPath` で消す）だけである。
  - `deletePage(page, user, options, isRecursively, activityParameters)` も、中で activity を作り `updated` を出す。
  - 作成・更新・移動・削除は、どれも裏の処理のために `PageOperation` を作り、終わるまで残す。`pageOperationService.canOperate` は、重なるパスに `PageOperation` があると作成や移動を断る。
- **Implications**:
  - 移動とごみ箱への移動には「アプリ内通知を出さない」指定を足す。
  - 移動を戻すときは、移動元を起点とするリダイレクト（子のページの分も含む）を、反映の側で消す。
  - 1 つの Change Proposal の中で、前の操作の裏の処理が終わる前に次の操作が断られることがある。反映の側で、重なる `PageOperation` が消えるのを決まった時間だけ待つ。

### ごみ箱から戻す処理（`pageService.revertDeletedPage`）
- **Context**: 新規作成を取り消してごみ箱へ移した操作を、さらに取り消せるようにするため、既存の「ごみ箱から戻す」処理を確かめた。
- **Findings**:
  - `revertDeletedPage(page, user, options, isRecursively, activityParameters)` は、ごみ箱のパスから先頭の `/trash` を除いたパス（`Page.getRevertDeletedPageName`）へページを戻す。そのパスに空でないページがあると `PathAlreadyExistsError` を投げ、空のページだけがあるときはそれと置き換える。重なる `PageOperation` があれば断る。
  - 自分で `beginActivity` を呼んで activity（`PAGE_REVERT` など）を作る。子のページを含めない戻し方では、`activityEvent.emit('update', activityId, parameters, page, preNotifyService.generatePreNotify)` で、ページを購読している人へのアプリ内通知も作る。通知を止める指定は今は無い。
  - ごみ箱へ移す処理（`deletePage` の中の `deleteNonEmptyTarget`）は、ページのパスを `/trash/…` に変え、「元のパス → ごみ箱のパス」のリダイレクトを作る。リビジョンは作らないので、ごみ箱にあるページの最新のリビジョンは、ごみ箱へ移す前と同じである。
  - 子のページを含めない戻し方の中には、このリダイレクトを消す処理が見当たらない。ページを開くときの処理（`page-data-props.ts`）は、ページを探す前にリダイレクトを調べる（未確認: 動かしては確かめていない）。
- **Implications**:
  - ごみ箱から戻す操作（`restore`）は `revertDeletedPage` を使い、同じ判断（空でないページがあれば断る、空のページは置き換える）に合わせる。
  - `revertDeletedPage` の options に、移動・ごみ箱と同じ「アプリ内通知を出さない」指定を足す。
  - 戻したあとで、元のパスを起点とするリダイレクトを消し、結合テストで元のパスを開いて確かめる。
  - 「最新のリビジョンが、元の新規作成で作ったリビジョンのままか」は、ごみ箱にある間にリビジョンが変わらないので、そのまま比べられる。

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
- **Implications**: 反映では route の通知の処理を呼ばず、移動とごみ箱への移動には通知を止める指定を渡す。まとめた通知は、受け取る人ごとに中身を作って `insertMany` で入れる。新しい action は `CHANGE_PROPOSAL_` で始め、監査ログの分類に新しい種類を足す。

### 機能の置き場所と前例
- **Findings**:
  - apiv3 の route とサービスを持つ機能の前例は `features/growi-vault/server/` と `features/page-bulk-export/server/`。新しいコレクションを Prisma だけで読み書きする前例は `features/mastra/server/models/refreshed-model-catalog.ts`（索引が無いので Mongoose の schema を持たない）。Mongoose の schema で索引を作り、読み書きを Prisma の拡張で行う前例は `server/models/page-redirect.ts` と `server/models/revision.ts`。
  - 期限切れの処理の前例は `wip-page-cleanup-cron.ts`（`CronService` を継承、設定キーで実行の間隔を決める、複数台の間でずらすための待ち、保守モードでは動かない）と `delete-expired-wip-page-by-system.ts`（`findOneAndUpdate` で 1 台だけが取る）。WIP ページは TTL 索引をやめてこの形にした。TTL 索引は、アプリの処理を通さずに消すので、記録には使わない。
  - 管理者の設定画面の前例は `pages/admin/ai.page.tsx` と `features/mastra/client/admin/`。管理画面は `commons` と `admin` の名前空間しか読み込まない。
  - 依頼した人ごとの 1 日の件数を数える仕組みは無い。近い前例は contribution-graph の、サーバーの日付の 0 時で区切る数え方。
  - access token の scope を足すには `@growi/core` の変更と翻訳が要る。
- **Implications**: 新しい機能は `apps/app/src/features/change-proposal/` に置く。Change Proposal のコレクションは Prisma で読み書きし、コレクションと索引の作成だけを Mongoose の schema に任せる（Design Decisions の「新しいコレクションは Prisma で読み書きし、索引は Mongoose の schema で作る」）。scope は既存の `features.page`（利用者の API）と `admin.app`（管理者の API）を使い、新しい scope は足さない。

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
- **Follow-up**: 書き直しの回数の上限は定数にする。既存の `update-page.integ.ts` が変更なしで通ることを確かめる。

### Decision: 共同編集の文書を反映の側では置き換えない
- **Context**: 要件 3.5・3.11・3.12。
- **Selected Approach**: 接続数と `draft` を確かめて反映するかを決め、反映後は `syncWithTheLatestRevisionForce` を呼ばない。次に開いたときに `outdated` から置き換わるのに任せる。
- **Rationale**: 確かめてから書くまでの間に誰かがつながっても、その人の入力をサーバーが消さない。その人には衝突の知らせが出る。
- **Trade-offs**: 接続数はこのプロセスの分しか見えない。複数台のサーバーでは、別のプロセスにつながっている人のページにも反映してしまう。その人には衝突の知らせが出るので黙って消えることは無いが、未保存の入力が `draft` として保存される前に書いた場合、その人が次に開き直したときに入力が置き換わるおそれがある（未確認）。umbrella の未決の論点として残す。

### Decision: 取り消しは反映と同じ操作の種類で表す
- **Context**: umbrella の決定 4。
- **Selected Approach**: 取り消しの Change Proposal の操作は、編集（元の本文に戻す。元のリビジョンは反映で作ったリビジョン）、移動（元のパスへ戻し、移動元を起点とするリダイレクトを消す）、ごみ箱へ移す（新規作成で作ったページをごみ箱へ移す）、ごみ箱から戻す（ごみ箱へ移したページを元のパスへ戻す）の 4 種類にする。後の 2 つは取り消しのときだけ使う。各操作は、どの Change Proposal のどの操作（`key`）を戻すかを持つ。
- **Rationale**: 編集と移動は、通常の操作と同じ処理と同じ確認で戻せる。ごみ箱へ移すと戻すは互いに逆の操作なので、取り消しの取り消しを何度重ねても、同じ判定で扱える。ごみ箱から戻す処理は既存の `revertDeletedPage` があるので、新しく書かない。
- **Trade-offs**: ごみ箱から戻すのは、ページがまだごみ箱にあり、元のパスに空でないページが無く、最新のリビジョンが元の新規作成で作ったもののままのときだけにする。人が先にごみ箱から戻した場合や、元のパスに別のページを作った場合は、理由を付けて断る。

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

### Decision: 依頼した人以外に返す操作は、反映に関わった操作だけにする
- **Context**: 要件 9.2・9.7・9.8・9.10。承認待ちの Change Proposal でも、一部の操作がすでに反映されていることがある。
- **Selected Approach**: 依頼した人以外には、閲覧できるページに対する「反映済み」「取り消し済み」「取り消しを断られた」の操作だけを返す。Change Proposal が承認待ちかどうかは判断に使わない。1 件の取得・反映済みの一覧・リビジョンの印の 3 つが、同じ純関数（`selectVisibleOperations`）を通す。全体の状態と `lastAppliedAt` も、返す操作だけから決める。
- **Rationale**: 反映されたページを見た人が、それを作った Change Proposal にたどれる必要がある（ページ履歴の印から詳細へ）。一方で、まだ反映されていない案や、反映されなかった案は、依頼した人の作業中のものなので、他の人に見せる理由が無い。段階（`lifecycle`）で判断すると、一部が反映された承認待ちの案を他の人が見られなくなる。
- **Trade-offs**: 反映済みの一覧は、文書に保存した `lastAppliedAt`（見えない操作の反映の日時を含む）の順に読む。そのため、表示する日時と並び順が食い違うことがある。分かるのは「見えない何かが、より新しく反映された」ことだけなので、見る人ごとの並べ直しはしない。

### Decision: 取り消しの通知は、元の依頼した人にも送る
- **Context**: 要件 7.8。
- **Selected Approach**: 取り消しの Change Proposal を反映したときは、通知の対象のページにごみ箱へ移す・戻すのページも含め、元の Change Proposal の依頼した人も受け取る人に加える。中身は受け取る人ごとに、閲覧できるページの分だけで作る。
- **Rationale**: 自分が頼んだ変更を他の人が取り消したことは、そのページを購読していなくても、依頼した人が知るべきことである。ごみ箱へ移す・戻すは、人が行ったときも購読している人に通知が出る。

### Decision: 入口の request の中の作成は、その request の activity に記録する
- **Context**: 要件 7.9。入口の route は `addActivity` で activity を 1 つ作る。作成のサービスが別の activity を作ると、route の activity が記録されないまま（`ACTION_UNSETTLED`）残る。
- **Selected Approach**: `createProposal` は任意の `trigger: ApplyTrigger` を受け取る。request なら、その activity を `CHANGE_PROPOSAL_CREATE` として記録する。1 つの activity は 1 つの action にしか使えないので、作成の直後の自動反映（`CHANGE_PROPOSAL_APPLY`）は、別の activity を自分で作る。
- **Trade-offs**: 自動反映があると、1 回の request で監査ログの行が 2 つ（作成と反映）になる。どちらも意味のある記録なので、そのままにする。

### Decision: 兄弟の spec の画面の共通の部品を core に置く
- **Context**: 要件 11。viewer の画面と ai-agent のチャット画面は、どちらも操作の種類・状態・理由を言葉にし、本文の差分を表示する。
- **Selected Approach**: 値から翻訳キーを引く表、`translation` の名前空間の `change_proposal.*` のキー（5 言語）、diff2html の設定と CSS を、core の `client/shared/` に置く。ページ履歴の差分（`RevisionDiff`）も同じ部品を使う。画面ごとの文言は、それぞれの spec が `change_proposal_viewer.*` と `change_proposal_chat.*` に置く。まとめた通知の文言は viewer の `commons` に置く。
- **Rationale**: 値の型を持つのは core なので、値が増えたときに表と翻訳を同じ spec の中で直せる。2 つの画面が別々に表を持つと、同じ値の言葉が食い違う。表を `satisfies Record<…>` で宣言すると、値を足して表に足し忘れたときに型の検査で止まる。
- **Trade-offs**: キーの全体を表から引くので、翻訳キーの検査（i18next-cli）にはキーが使われていないように見える。`i18next.config.ts` の `preservePatterns` に 表の接頭辞（8 つ）のワイルドカードを足して、使われていないと報告されないようにする。`change_proposal.` で始まる静的な呼び出しを作らないので、ワイルドカードで隠れるキーは無い。

### Decision: 新しいコレクションは Prisma で読み書きし、索引は Mongoose の schema で作る
- **Context**: GROWI は Mongoose のモデルを Prisma の拡張（`Prisma.defineExtension`）へ順に移している（`.claude/rules/model.md`）。新しいコレクション `changeproposals` を Mongoose で読み書きすると、あとで移す対象を 1 つ増やすことになる。一方で、このコレクションには疎な索引（値を持つ文書だけが入る索引）が要り、Change Proposal の状態の変化は「今の状態がこうなら書く」という条件付きの更新に頼る。
- **確かめた事実**（apps/app が使う Prisma は 6.19.2。prisma-engines の 6.19.2 の tag のコードを読んだ。動かしてはいない）:
  1. 条件を付けた `updateMany` と `update` は、MongoDB の 1 つのコマンドにはならない。クエリエンジンは、まず条件に合う文書の `_id` を読み、次に `{ _id: { $in: 読んだ _id } }` だけを条件にして書く（`write.rs` の `update_records`）。2 回目のコマンドには元の条件が入らない。
  2. ただし、`updateMany` と `update` は、クエリエンジンが MongoDB の transaction の中で実行する（`update.rs` の `flag_transactional`、`execute_operation.rs`）。読んでから書くまでの間に、別の処理が同じ文書を書き換えると、MongoDB は書き込みの衝突（WriteConflict）を返す。クエリエンジンは、その transaction を最初からやり直す（間を 5 ミリ秒空け、合計でおよそ 12 秒まで）。やり直しでは条件を読み直すので、もう条件に合わない文書は書かれず、返る件数は 0 になる。このため、条件付きの `updateMany` は「条件に合えば書く」を 1 回の処理として扱える。結果の件数が 1 なら自分が書いた、0 なら書いていない、と判断できる。
  3. 埋め込みの配列（composite type の list。文書の中に持つ配列）への `updateMany` は、`$map` と `$cond` を使う 1 つの更新になる。配列の要素ごとに、書くときに条件を確かめて書き換える（`into_expression.rs`）。`operations` の中の、`key` と `status` が合う 1 つの要素だけを書き換える更新は、Prisma の通常の書き方で表せる。
  4. 任意の項目について、Prisma は「値が null」と「項目そのものが無い」を区別する。更新では `unset: true` で項目を消せ、条件では `isSet` で項目があるかを確かめられる（apps/app の生成された型に `unset?: boolean` と `isSet?: boolean` がある）。
  5. Prisma の schema は、疎な索引・TTL 索引・`partialFilterExpression` を表せない。また今の GROWI は `prisma db push` を使っていないので、`schema.prisma` の `@@index` は何も作らない（`.claude/skills/mongoose-to-prisma/SKILL.md`）。
  6. アプリ内通知のモデルは、`target` を `refPath: 'targetModel'` で読み込む（`server/models/in-app-notification.ts`）。通知の一覧の API は `target` を読み込むので、`targetModel` に書く `ChangeProposal` という名前の Mongoose のモデルが登録されていないと、一覧の読み込みが失敗する。
  7. apps/app の `utils/prisma.ts` は、すべての model の `update` と `updateMany` の `data` に `v: { increment: 1 }` を足す。`v`（`@map("__v")`）を持たない model では、この更新が失敗する。
- **Alternatives Considered**:
  1. Mongoose で読み書きする。移す対象が増える。
  2. Prisma で読み書きし、索引は migrate-mongo の migration で作る（`20260619120000-add-unique-key-index-to-auditlog-es-sync-collections.js` の前例）。事実 6 のとおり、通知のために `ChangeProposal` の Mongoose のモデルの登録がどのみち要る。
  3. Prisma で読み書きし、コレクションと索引の作成だけを、索引の項目だけを持つ Mongoose の schema に任せる（採用）。
- **Selected Approach**: `features/change-proposal/server/models/change-proposal.ts` に、索引の項目だけを持つ Mongoose の schema（`getOrCreateModel('ChangeProposal', schema)` で登録し、export しない）と、Prisma の拡張を置く（`page-redirect.ts` と同じ形）。`schema.prisma` に `changeproposals` の model を足し、読み書きはすべて拡張の関数を通す。拡張は `utils/prisma.ts` の `createPrisma()` に登録する。この登録で、起動時にこのファイルが読み込まれ、Mongoose が接続のときに索引を作る。
- **Rationale**: 事実 2・3 から、前の設計が `findOneAndUpdate` に頼っていた操作（lease の取得と延長、操作の状態の変化、期限切れと取り下げ）は、すべて条件付きの `updateMany` と件数の確認で同じ結果を保てる。生の MongoDB のコマンド（`$runCommandRaw`）が要る操作は無い。疎な索引は Mongoose の schema が作る。Mongoose の schema は事実 6 のためにも要る。
- **Trade-offs**:
  - 条件付きの更新が 1 回の処理として扱えるのは、クエリエンジンの作り（読んでから書く処理を transaction の中で行い、衝突したらやり直す）による。Prisma の文書に書かれた約束ではない。そこで、同じ条件付きの更新を 2 つ同時に走らせて、件数 1 が 1 つだけ返ることを結合テストで確かめる（tasks.md の 1.4・4.5・5.4）。Prisma の版を上げたときは、この結合テストで確かめ直す。結合テストで同時に 2 つが成功した場合は、その操作だけを `$runCommandRaw` の `update` コマンド（条件を `q` に入れ、`n` で件数を見る）に置き換える。
  - 1 回の条件付きの更新は、読み・書き・transaction の確定の 3 回の往復になる。書き込みの衝突が続くと、クエリエンジンはおよそ 12 秒でやり直しをやめ、`P2034`（transaction の衝突）の誤りを返す。呼び出し側は、これを「取れなかった（件数 0）」と同じに扱う。
  - transaction を使うので、MongoDB が replica set で動いている必要がある。GROWI は Prisma のためにすでに replica set を前提にしている。
  - Prisma の model は `v` を持つので、Prisma の更新のたびに `__v` が 1 増える（`model.md`）。`__v` の値に頼る処理は作らない。
- **Follow-up**: `schema.prisma` の `@@index` には、Mongoose の schema が作る索引と同じ項目・同じ名前（`map`）を書き、疎な索引にはそのことを注記する（`pages.wipExpiredAt` の前例）。将来 `prisma db push` が索引の作成を受け持つときに、疎の指定を付け直すためである。

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
- **Context**: 要件 12。依頼した人以外には、反映に関わった操作（反映済み・取り消し済み・取り消しを断られた）だけを返している。
- **Selected Approach**: 段階と達成度を `requesterState` にまとめ、依頼した人への応答にだけ入れる。全体の状態（`ProposalStatus`）は今までどおり操作の状態から決め、`settled` を全体の状態の値には足さない。
- **Rationale**: 依頼した人以外に段階を返すと、反映済みの操作しか見えないのに段階が承認待ちのままであることから、見えない「待ち」の操作があると分かる。達成度も、依頼した人以外にはいつも 100% になり、分母から見えない操作の数が分かる。
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
- **Rationale**: 見直しは、ほかの人がその後に加えた編集をふまえて内容を作り直すものなので、元の案より人の編集とぶつかる見込みが高い。依頼した人が差分を確かめてから反映する。

## Risks & Mitigations
- 人の保存の route に手が入る — 既存の `update-page.integ.ts` / `create-page.integ.ts` とページの結合テストを変更なしで通すことを、切り出しのタスクの完了条件にする。
- 複数台のサーバーで、別のプロセスにつながっている編集者を見落とす — 分かっている制約として design に書き、umbrella の未決の論点に残す。
- 移動の裏の処理と次の操作がぶつかる — 移動は最後に 1 つだけ。編集・作成の後は、重なる `PageOperation` が消えるのを決まった時間だけ待ち、それでも残れば「待ち」のままにする。
- `revisions` に索引を足すと、大きな collection では起動時の索引作成に時間がかかる — 疎な索引（値を持つリビジョンだけが入る）にする。起動にかかる時間を結合テストの環境で確かめる。
- 条件付きの更新が 1 回の処理として扱えることは、Prisma のクエリエンジンの作りに頼っている — 同時に 2 つ走らせる結合テストで確かめ、Prisma の版を上げたときに確かめ直す。成り立たなければ、その操作だけを `$runCommandRaw` に置き換える（Design Decisions の「新しいコレクションは Prisma で読み書きし、索引は Mongoose の schema で作る」）。
- 1 件の Change Proposal が MongoDB の 1 文書の上限（16MB）を超える — 本文の合計の上限を定数で持ち、作成の時点で断る（要件 1.16）。

## References
- `apps/app/.claude/skills/learned/page-save-origin-semantics/SKILL.md` — `origin` と上書き防止の確認の関係
- `apps/app/.claude/rules/activity-recording.md` — activity の記録の順序
- `apps/app/.claude/rules/page-write-action-403-404.md` — 見えないページへの応答をそろえる規則
- `.claude/rules/model.md` と `.claude/skills/mongoose-to-prisma/SKILL.md` — 読み書きは Prisma の拡張、コレクションと索引の作成は Mongoose の schema
- prisma-engines 6.19.2 の `query-engine/connectors/mongodb-query-connector/src/root_queries/write.rs`（`update_records`）、`query-engine/core/src/query_graph_builder/write/update.rs`、`query-engine/core/src/executor/execute_operation.rs`、`mongodb-query-connector/src/root_queries/update/into_expression.rs` — 条件付きの更新の実行のしかた
- `.kiro/specs/collaborative-editor/design.md` — 共同編集の文書の状態
- `.kiro/specs/revision-diff-api/design.md` — 見る人ごとの絞り込みの前例
