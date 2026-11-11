# Research & Design Decisions: change-proposal-viewer

## Summary
- **Feature**: `change-proposal-viewer`
- **Discovery Scope**: Extension（既存の画面（Recent Changes・ページ履歴・作者の表示・アプリ内通知）に表示を足し、詳細ページと一覧の画面を新しく作る。データと判定は `change-proposal-core` の API を使う）
- **Key Findings**:
  - Recent Changes の応答の各行には、今のリビジョンの ID（`revision`）がそのまま入っている。印を付けるには、その ID をまとめて `change-proposal-core` のリビジョンの印の API に渡せばよく、一覧の取得の処理を変えずに済む。
  - ページ履歴の差分は、ブラウザの中で `diff` の `createPatch` と diff2html で作っている。一方、`revision-diff` の機能に、見る人ごとに閲覧を確かめてから差分を返す API（`POST /_api/v3/revisions/diff`）がすでにあるが、画面からはまだ使われていない。
  - アプリ内通知の画面は、`targetModel` ごとの hook を順に呼び、最初に null でない結果を使う作りになっている。知らない種類の通知は何も表示しない。新しい種類は hook を 1 つ足せば表示できる。

umbrella の判断は [../change-proposal/research.md](../change-proposal/research.md)、core の判断は [../change-proposal-core/research.md](../change-proposal-core/research.md) にある。本書はそれを前提とし、viewer の設計のために追加で確かめた事実と判断だけを書く。コード上の事実は 2026-10-21 時点の master を読んで確かめた。core が master に入ったあとの 2026-11-11 に、core のコードと突き合わせて確かめ直した事実は「core の実装との突き合わせ」にまとめた。動かして確かめていないものは「未確認」と書く。

## Research Log

### Recent Changes（`client/components/Sidebar/RecentChanges/`）
- **Findings**:
  - 一覧は `useSWRINFxRecentlyUpdated`（`stores/page-listing.tsx`）が `GET /_api/v3/pages/recent` を 20 件ずつ読む。`useSWRInfinite` を使い、`suspense: true` で表示する。
  - サーバーは `Page.findRecentUpdatedPages` で、一覧の表示の方針（`security:list-policy:hideRestrictedByOwner` / `hideRestrictedByGroup`、初期値はどちらも false）に従って行を選ぶ。初期設定では、他の人の「自分だけ」やグループのページの行も出る。
  - 各行は今のリビジョンの ID（`revision`）を持つ。リビジョンの中身は入っていない。行ごとに「見る人がそのページを実際に閲覧できるか」を示す値は無い。
  - 行の部品は `RecentChangesSubstance.tsx` の `PageItem`。タイトルの `<h6>` に WIP の印と鍵の印がある。新しい印はここに並べられる。見出しの部品（`RecentChangesHeader`）には、再読み込み・表示の切り替え・WIP の表示の切り替えがある。
  - `GET /pages/recent` はゲストにも開いている（`loginRequired`）。core の API はログインが必須（`loginRequiredStrictly`）。
- **Implications**: 一覧の取得には手を入れない。読み込んだ行のリビジョンの ID を集めて core のリビジョンの印の API に送り、返った印だけを表示する。core は閲覧の判定（`findByIdsAndViewer`、一覧の表示の方針を使わない判定）で絞って返すので、「実際に閲覧できる行にだけ印を付ける」はそのまま満たせる。ゲストのときは問い合わせない。

### ページ履歴（`client/components/PageHistory/`）
- **Findings**:
  - `PageRevisionTable` が `useSWRxInfinitePageRevisions`（`GET /revisions/list`、10 件ずつ。比べる 2 つの版が URL で指定されたときは全件）を読み、行ごとに `Revision` を表示する。`Revision` は作者の名前の横に「最新」の印（`badge bg-info`）を出している。
  - `/revisions/list` は Prisma の `include` で読み、リビジョンの項目をすべて返す。
  - ページ履歴は、ページの付属の画面（`PageAccessoriesModal`）のタブとして開く。ゲストと共有リンクでは開けない。
- **Implications**: 読み込んだリビジョンの ID を core のリビジョンの印の API に送り、`Revision` に印を渡す。全件を読んだ場合に 100 件を超えることがあるので、100 件ずつに分けて問い合わせる。

### 差分の表示
- **Findings**:
  - `RevisionDiff.tsx` は、2 つのリビジョンの本文から `createPatch` で差分を作り、diff2html の `html()`（`outputFormat: 'side-by-side'`、`drawFileList: false`、色は画面のテーマから決める）で HTML にして表示する。見た目は `RevisionDiff.vendor-styles`（あらかじめ用意した CSS）と `RevisionDiff.module.scss` に頼っている。見出しには、ページ履歴の中で版を開くリンクがある。
  - `revision-diff` の機能の `POST /_api/v3/revisions/diff` は、`{ pageId, fromRevisionId | null, toRevisionId }` の組を 20 件まで受け、組ごとに統一形式の差分の文字列（`status: 'ok'`）か、`forbidden` / `invalid` を返す。`fromRevisionId` が null なら空の本文と比べる。閲覧の判定は `findByIdsAndViewer`。
- **Implications**: 詳細ページの差分は `POST /revisions/diff` で取り、diff2html の同じ設定と同じスタイルで表示する。diff2html の設定と見た目は、core が `RevisionDiff.tsx` から `features/change-proposal/client/shared/diff2html-options.ts` に切り出し、ページ履歴の差分と viewer・ai-agent の差分がそれを使う（Design Decisions の「差分の取り方」）。core の実装で分かった細部は「core の実装との突き合わせ」にある。

### ページの作者の表示
- **Findings**:
  - ページの見出し（`PageHeader`）には作者を出していない。作者は `PageContentFooter`（ページの下。常に出る）と `PageSideContents`（ページの横。`customize:showPageSideAuthors` が有効なときだけ出る）の `AuthorInfo` で、作った人と最後に更新した人を出している。
  - `?revisionId=` で古い版を表示しているとき、ページのデータの `revision` は表示している古い版になる。今の版の ID は `useSWRxPageInfo` の `latestRevisionId` で分かり、他の人が保存すると更新される。
- **Implications**: brief の「ページの見出し: 作者の横に印」は、最後に更新した人の `AuthorInfo` の横に印を出すことと読む。印は `latestRevisionId` で決める（表示している版ではなく、今の版）。

### アプリ内通知の画面
- **Findings**:
  - `ModelNotification/index.tsx` の `useModelNotification` は、ページ・ユーザー・ページの一括書き出し・監査ログの書き出しの hook をすべて呼び、最初に null でない結果を使う。どれにも当たらなければ、`InAppNotificationElm` は何も表示しない。
  - 各 hook は `Notification`（表示の部品）、`publishOpen`（開いたときの移動）、`clickLink`、`isDisabled` を返す。表示の部品 `ModelNotification` は、操作した人・操作の言葉・アイコン・パス・補足・日時を並べる。
  - 操作の言葉は `useActionAndMsg.ts` の switch で、英語の文字列を直接書いている（翻訳していない）。
  - サイドバーの通知の画面は `commons` の名前空間を使う。管理画面は `commons` と `admin` だけを読み込む。
  - 通知の一覧の API（`GET /in-app-notification/list`）は `target` を `refPath` で読み込んで返す。core は、`targetModel` が `ChangeProposal` の通知では `target` を `_id` だけにする（core の design の Modified Files）。
  - 未読の件数は Socket.IO の `notificationUpdated` を受けて数え直す。
- **Implications**: Change Proposal の通知の hook を 1 つ作り、`useModelNotification` の順に足す。文言は `useActionAndMsg.ts` に足さず、hook の中で `commons` の名前空間の翻訳を使う。リンク先は `target` ではなく snapshot の `proposalId` から作る。snapshot を読めなかったときは null を返し、その通知だけを表示しない（例外を投げると一覧全体が表示されなくなる）。

### 頼む通知の作り方
- **Findings**:
  - 利用者が別の利用者に文を添えて通知を送る仕組みは、今は無い。受け取る人ごとに中身を変えて入れる前例は、メンションの通知の `insertMentionNotifications`（`insertMany` で入れ、`emitSocketIo` で知らせる）。
  - activity の `update` の受け手（`service/activity.ts`）は、記録したあとで必ず `updated` を出す。アプリ内通知のサービスは `updated` を受けて、`target` があり、action が `EssentialActionGroup` に入っているときだけ通知を作る。`target` を渡さなければ、決まった形の通知は作られない。
  - 監査ログが無効でも記録されるのは、`EssentialActionGroup` の action だけ。通知の一覧は、通知に付けた activity の `user` から「操作した人」を出す。
- **Implications**: 頼む通知は、新しい action を `EssentialActionGroup` に入れて、`target` を渡さずに activity を記録し、通知は自分で 1 件入れて Socket.IO で知らせる。activity が必ず残るので、同じ人が短い間に何度も送っていないかを activity で確かめられる。

### 画面の URL
- **Findings**:
  - `_search`・`_news` などの画面は `@growi/core` の `restrictedPatternsToCreate` でページのパスとして使えないようにしてある。`_news` は `/*`（ゲストを通す `loginRequired`）を通って Next.js に渡る。
  - `/me` と `/me/*` は `loginRequiredStrictly` を通って Next.js に渡る。`/me` はすでにページのパスとして使えない。`pages/me/[[...path]].page.tsx` は個人の設定と通知の一覧を表示する。Next.js では、決まった名前のページのファイルが `[[...path]]` より先に選ばれる。
- **Implications**: 詳細ページと一覧は `/me/change-proposals` の下に置く（Design Decisions の「画面の URL」）。

### core が足す項目が既存の応答に載ること
- **Findings**:
  - `respondWithSinglePage` が使う `populateDataToShowRevision`（`server/models/obsolete-page.js`）は、ページの `revision` を、本文以外のすべての項目つきで読み込む。
  - `/revisions/list` は Prisma の `include` で、リビジョンの項目をすべて返す。
  - `/pages/recent` は、ページの文書を項目を選ばずに返す。
- **Implications**: core はページには項目を足さず、リビジョンにだけ `proposalId` と `proposalOperationKey`（操作ごとの乱数の `key`）を足す。リビジョンの 2 つの項目は上の応答に載るが、`key` は並び順の情報を持たないので、ほかの操作があるかどうかは分からない（core の design。viewer の design.md の Upstream issues の U1）。viewer はこれらの項目を読まず、印はリビジョンの印の API だけから取る。Recent Changes の行と作者の表示の印は、今のリビジョンの ID を送り、そのリビジョンの `proposalId` を core が引いて返す。

### core の実装との突き合わせ（2026-11-11）
- **Findings**:
  - core の server の barrel（`features/change-proposal/server/index.ts`）は、`createChangeProposalService`、型 `ChangeProposalService` と `ProposalQuery`、`readChangeProposalSettings`、router を作る関数などを export する。`getForViewer` は関数として export されておらず、サービスの関数である。core の router（`server/routes/index.ts`）は、サービスを最初の要求で 1 つだけ作り、それを返す `getService`（型 `GetChangeProposalService`、`server/routes/read-access.ts`）を各 route の handler を作る関数に渡している。
  - core の書く route は、どれも `server/routes/write-access.ts` の `writeAccessChain(crowi)`（`accessTokenParser` → `loginRequiredFactory(crowi)` → `excludeReadOnlyUser` → `addActivity`）を使う。core は `:id` を検査しない。形の正しくない ID を存在しない ID と同じ 404 `notfound` にするためで、`findProposal` は形の正しくない ID に null を返す（`server/routes/get-proposal.ts`）。
  - `pages/common-props/commons.ts` は、`getServerSideProps` の中で `crowi` から取った `configManager` で設定を読む（`app:siteUrl` など）。AI の有効・無効は `crowi.isAiReady()` を通して読み、その注記に「SSR の側で直接 import した `configManager` は、設定を読み込んでいない別の実体になる」と書かれている（`server/crowi/index.ts` の `isAiReady` の注記には「Config is not loaded」とある）。core の `readChangeProposalSettings()`（`server/services/settings.ts`）は `configManager` を直接 import しているので、SSR から呼ぶと、読み込んだ設定の値を読めない（初期値の偽が返るか、例外になる。どちらになるかは動かして確かめていない。未確認）。設定キーは `app:changeProposalEnabled` で、`readChangeProposalSettings().isEnabled` はこのキーが `true` かどうかである。
  - diff2html のあらかじめ用意した CSS は `client/shared/diff2html.vendor-styles.ts` にあるが、`client/shared` の barrel からは export されていない。ページ履歴は `import '~/features/change-proposal/client/shared/diff2html.vendor-styles.prebuilt'` で読み込むだけにしている（`client/components/PageHistory/RevisionDiff.tsx`）。`.d2h-wrapper` の `position: relative` と表の `table-layout: fixed` の指定は、`client/components/PageHistory/RevisionDiff.module.scss` に残っている。
  - `OperationView` は作ったページの ID（`resultPageId`）を持たない。今のページは `page`（`{ id, path }`）で、ページが削除されたか見る人が閲覧できないときは返らない。
  - core は、戻せるかどうかの判定（`revertability`）を、見る人が書き込みを求められるとき（有効なユーザーで読み取り専用でない。`server/services/pre-write-checks.ts` の `isRequesterAllowed`）に、反映済みか取り消しを断られたの操作にだけ付ける（`server/services/proposal-query.ts`）。
  - core の取り消し（`server/services/revert-action.ts`）は、取り消しの反映が `in-progress` になったときや、途中で終わって待ちの操作が残ったときに、結果の決まっていない操作を `RevertResult.operations` に入れない。このときも `revertProposalId` は返る。元の Change Proposal では、編集中の人がいたために見送った操作も「反映済み」のまま残る（core の要件 5.11）。
  - 元の Change Proposal の依頼した人へのまとめた取り消しの通知は、snapshot の `proposalId` と `entry` が元の Change Proposal のものになる（`server/services/proposal-notifier.ts`、core の要件 7.8）。
  - `formatProposalShortId` は、先頭の `#` を含めて返す（`client/shared/proposal-links.ts`）。
  - 編集の取り消しは新しいリビジョンを作り、そのリビジョンは取り消しの Change Proposal の印を持つ。リビジョンの印の API は、取り消しの Change Proposal で作られた印に `isRevert: true` を付ける（`server/services/revision-marks-query.ts`）。
- **Implications**: 頼む通知のサービスは `getService` を受け取る。route は `writeAccessChain` を使い、ID を検査しない。画面の共通の値は `crowi` を通して読む。差分の部品は CSS を読むだけの import で読み、`RevisionDiff.module.scss` と同じ 2 つの指定を自分で持つ。取り消しの結果は、取り消しの Change Proposal を取り直して決める（Design Decisions の「取り消しの結果が決まるまで、取り消しの Change Proposal を取り直す」）。

### ページがもう無い操作の見え方
- **Findings**: 2026-11-11 時点の master の core の `selectVisibleOperations`（`server/domain/select-visible-operations.ts`）は、対象のページがもう無い操作を依頼した人にだけ返す。この決まりのままでは、他の人が新規作成を取り消すと、取り消した人は詳細ページを取り直したときに元の Change Proposal が「見つからない」になる。元の依頼した人は、新規作成の取り消しだけの取り消しの Change Proposal を開けない。また、同じ時点の完全な削除の操作の表示（`server/services/to-operation-view.ts`）はパスを持たない。
- **Implications**: プロダクトの判断で、core の見え方の決まりを、ページがもう無い操作を取り消しの相手にも表示のために返す形にし（取り消しの対象は広げない）、ページがもう無い操作のパスを操作の記録から決めて、1 件の取得と一覧の要約の両方で返す。完全な削除の操作には元の新規作成のパスを、編集の操作には反映した時点のページのパスを使う（編集のパスは core が反映のときに記録する）。方針は「何が取り消されたか、その操作がどのページのパスに対するものだったかが、見える人に見え続けること」である。決まりは core の spec（要件 9.11・9.12、research.md の決定「ページがもう無い操作は、取り消しの相手にも見せる」）が持ち、実装は本 spec の tasks.md のグループ 8 が持つ。

## Architecture Pattern Evaluation

| 案 | 内容 | 良い点 | 問題 |
|---|---|---|---|
| A. 既存の応答に載るリビジョンの `proposalId` を読んで印を付ける | リビジョンの既存の応答の項目をそのまま使う | 問い合わせが増えない | 一覧の表示の方針で出しているだけの行にも印が付く。リンクを知る人だけが見られるページで、詳細ページが「見つからない」になる印が出る。core の絞り込みと別の判断になる |
| **B. core のリビジョンの印の API だけを使う（採用）** | 読み込んだ行のリビジョンの ID を API に送り、返った印だけを表示する | 印を付けるかどうかの判断が core の 1 か所だけになる。見る人ごとの絞り込みをやり直さない | 一覧を読むたびに問い合わせが 1 回増える。行を先に表示し、印は後から付けることで、表示を遅くしない |

## Design Decisions

### Decision: 印は core のリビジョンの印の API だけから取る
- **Context**: 要件 5.3・6.2・7.1・10.1。印は、見る人が閲覧できるページで、かつ詳細ページを開けるときだけ出す必要がある。
- **Selected Approach**: ページ履歴・Recent Changes・作者の表示のどれも、表示しているリビジョンの ID を `POST /_api/v3/change-proposals/revision-marks` に送り、返った印（`RevisionMarkView`）だけを表示する。既存の応答に載る `proposalId` は読まない。
- **Rationale**: core は、閲覧の判定（一覧の表示の方針を使わない）と、リンクを知る人だけが見られるページを除く判定で絞って印を返す。core は、依頼した人以外には、閲覧できるページへの操作のうち状態が反映済み・取り消し済み・取り消しを断られた、のどれかである操作だけを返し、同じ条件をリビジョンの印と 1 件の取得の両方に当てる。そのため、印をたどって「見つからない」になることが無い（design.md の Upstream issues の U5）。
- **Trade-offs**: 一覧や履歴を読むたびに問い合わせが 1 回増える。行の表示を待たせないよう、印は別の問い合わせとして後から付ける。

### Decision: 差分の取り方
- **Context**: 要件 2.2・2.3・2.11。brief は「既存の差分表示を使う」とする。
- **Alternatives Considered**:
  1. 2 つのリビジョンを `GET /revisions/:id` で読み、既存の `RevisionDiff` の部品にそのまま渡す。
  2. `POST /revisions/diff` で差分の文字列を取り、diff2html の同じ設定で表示する（採用）。
- **Selected Approach**: 2。diff2html の設定（表示の形式、ファイル一覧を出さない、テーマから色を決める）と見た目は、core が `RevisionDiff.tsx` から `client/shared/diff2html-options.ts` に切り出したものを使う。viewer は `RevisionDiff.tsx` に手を入れない。
- **Rationale**: `RevisionDiff` は 2 つのリビジョンの本文全体を受け取り、見出しにページ履歴の中のリンクを出す部品で、ページ履歴の画面に結び付いている。新規作成の操作では比べる元のリビジョンが無い。`POST /revisions/diff` は、見る人ごとに閲覧を確かめ、空の本文との比較も扱い、本文全体をブラウザに送らない。表示の設定を 1 か所にまとめれば、見た目はページ履歴と同じになる。
- **Trade-offs**: 1 回に 20 組までなので、差分は操作を開いたときに 1 つずつ取る。

### Decision: 画面の URL を `/me/change-proposals` の下にする
- **Context**: 詳細ページと一覧は、ログインした人だけが見る画面である。
- **Alternatives Considered**:
  1. `/_change-proposals`（`_news` と同じ形）。`@growi/core` の `restrictedPatternsToCreate` に足す必要があり、公開している package なので changeset が要る。core の作成の検査（`isCreatablePage`）の結果も変わる。すでにそのパスにページがある wiki では、そのページが開けなくなる。`/*` はゲストを通すので、ログインを必須にする route を足す必要もある。
  2. `/me/change-proposals`（採用）。
- **Selected Approach**: 一覧を `/me/change-proposals`、詳細ページを `/me/change-proposals/{id}` にする。Next.js のページのファイルを `pages/me/change-proposals/` に置く。
- **Rationale**: `/me` の下はすでにページのパスとして使えず、`loginRequiredStrictly` を通る。`@growi/core` と server の route の表を変えずに済む。
- **Trade-offs**: 他の人の Change Proposal の詳細も `/me` の下になる。URL を他の人に渡しても、その人が見られる分だけが表示されるので、表示の内容には影響しない。

### Decision: 「戻せるものを全部戻す」は、戻せる操作の key を明示して送る
- **Context**: 要件 3.3。core の取り消しの API は、`operationKeys` を省くと「見る人が閲覧できる反映済みの操作すべて」を対象にし、戻せない操作は元の Change Proposal の中で「取り消しを断られた」にする。
- **Selected Approach**: 画面に「戻せる」と表示していた操作の key だけを `operationKeys` に入れて送る。
- **Rationale**: 見る人が押したのは「戻せるもの」を戻すボタンなので、戻せないと表示していた操作の状態を変えない。
- **Follow-up**: ボタンを押してから届くまでの間に状態が変わった操作は、core が判定し直して結果で返す。画面はその結果を表示する。

### Decision: 取り消しの結果が決まるまで、取り消しの Change Proposal を取り直す
- **Context**: 要件 3.9・3.10。core は、結果の決まっていない操作を `RevertResult.operations` に入れない（「core の実装との突き合わせ」）。そのまま表示すると、頼んだ操作の一部が結果の一覧から黙って消える。
- **Alternatives Considered**:
  1. 元の Change Proposal を取り直し、操作の状態が「取り消し済み」か「取り消しを断られた」になったら決まったとみなす。編集中の人がいたために見送った操作は元の Change Proposal で「反映済み」のまま残るので、まだ処理中の操作と区別できず、時間切れまで「処理中」になる。また、新規作成の取り消しでは、ページが消えてから元の操作に結果が書かれるまでの間、取り消した人には元の操作が見えず、詳細が一時的に「見つからない」になる。
  2. 取り消しの Change Proposal（`revertProposalId`）を取り直す（採用）。取り消した人はその依頼した人なので、待ちの操作を含めてすべての操作が返り、`revertTarget.operationKey` で送った key に結び付けられる。待ちなら処理中、反映済みなら取り消した、飛ばしたなら見送った、失敗・古いなら断られた、と決まる。
- **Selected Approach**: 2。取り直しは 3 秒ごとにし、最初の応答から 60 秒で止める。止めたときは、処理はサーバーで続いていて、しばらくしてから再読み込みすると結果が分かることを表示する。すべて決まったとき、または止めたときに、詳細・Recent Changes・印を 1 回取り直す。送った key が結果にも取り消しの Change Proposal にも無いときは「対象にならなかった」として扱い、「処理中」のまま残さない（取り消しを求めた間にその操作が見えなくなった場合などで、core はその key を黙って対象から外す）。
- **Rationale**: 結果が決まらないのは、取り消しの反映が別の処理に引き継がれた場合と、反映が例外で止まった場合である。前者は、引き継いだ処理が数秒で終える。後者は、保守用の cron（初期値では 10 分ごと）が止まった反映を引き継ぐまで決まらない（反映の権利 `APPLY_LEASE_MS` は 5 分）。画面を開いたまま最大 10 分以上取り直し続けるのは長すぎるので、引き継ぎで足りる 60 秒で止め、あとは再読み込みに任せる。3 秒の間隔は、1 回分の反映が数秒で終わることに合わせ、問い合わせを 20 回までに抑える値である。
- **Trade-offs**: cron に引き継がれた場合は、画面には結果が出ないまま、再読み込みを促す文言が出る。取り直しの間は、取り消しの Change Proposal の取得が 1 人につき 3 秒に 1 回増える。

### Decision: 「本人に戻すよう頼む」は、依頼した人以外にいつでも出す
- **Context**: 要件 4.1・4.8。brief は「全部は戻せないときは、本人に戻すよう頼める」とする。
- **Selected Approach**: 依頼した人以外で、ログインしていて読み取り専用でない人には、操作の状態にかかわらず出す。brief の「全部は戻せないとき」は、出す条件ではなく、この操作を作る理由と読む。
- **Rationale**: 頼む通知が要るのは、見る人に見えない操作があるときである。見える操作がすべて戻せる場合でも、見えない操作は残っているかもしれない。「見える操作に戻せないものがあるときだけ出す」とすると、いちばん必要な場面で出ない。また、送れるかどうかを見えない操作の状態で変えると、その違いから見えない操作があると分かってしまう。
- **Trade-offs**: 見える操作をすべて戻したあとにも頼めるので、不要な頼む通知が出ることがある。同じ人が同じ Change Proposal に送れるのは決まった時間に 1 回までにする。

### Decision: 頼む通知は viewer が作り、新しい activity の action を足す
- **Context**: 要件 4.2・4.10。core は反映と取り消しのまとめた通知だけを作る（core の Out of Boundary に「本人に戻すよう頼む」通知がある）。
- **Selected Approach**: action `CHANGE_PROPOSAL_REVERT_REQUEST` を足し、`EssentialActionGroup` に入れる。route で `target` を渡さずに activity を記録し、通知は `InAppNotification` に 1 件入れて、受け取る人に `notificationUpdated` を送る。通知の `targetModel` は `ChangeProposal`、`target` は Change Proposal の ID、snapshot は頼む通知の形にする。
- **Rationale**: `target` を渡すと、決まった形の通知の処理（`generateSnapshot`）が動くが、そこには Change Proposal の分岐が無い。`EssentialActionGroup` に入れると、監査ログが無効でも activity が残り、通知の一覧に送った人が表示され、短い間に何度も送っていないかを確かめられる。
- **Follow-up**: `interfaces/activity.ts` は core も変える。core のタスク 1.5 のあとで足す。

### Decision: AI が書いた要約と会話は、詳細ページに本人だけの場所を用意して、中身は入口の spec に任せる
- **Context**: 要件 1.7・1.8。brief は「AI が書いた要約や会話は本人にだけ表示する」とし、core は要約と会話を保存しないと決めている（ai-agent が Change Proposal の ID を鍵にして持つ）。
- **Selected Approach**: 入口の種類ごとに、本人だけに出す部品を宣言する表（`requester-only-sections.ts` の `REQUESTER_ONLY_SECTIONS`）を viewer が持つ。部品が受け取る値は `{ proposalId: string }` にする。詳細ページは、見る人が依頼した人のときだけ、その入口の部品を読み込んで表示する。viewer は `'ai-chat'` の行を持たない表を出し、ai-agent が `AiRecordSection` を作って `'ai-chat'` の行に登録する。
- **Rationale**: viewer は入口ごとの中身を知らずに済み、入口が増えても詳細ページの部品を変えない。本人にだけ返すことは、中身を返す API（ai-agent）が守る。
- **Trade-offs**: ai-agent が部品を登録するまで、本人向けの内容は表示されない。部品の受け取る値を変えるときは、ai-agent の部品も合わせて直す（design.md の Revalidation Triggers）。

### Decision: 操作の言葉と差分の見た目は core の画面の共通の部品を使う
- **Context**: 要件 2.1・2.2・2.6・2.7。操作の種類・操作の状態・全体の状態・理由・戻せない理由の言葉と差分の見た目は、viewer の詳細ページと ai-agent のチャット画面の両方で使う。
- **Selected Approach**: core が `features/change-proposal/client/shared/` に置く言葉の表・翻訳のキー（`change_proposal.*`）・`preservePatterns`・`diff2html-options.ts` を使う。viewer が持つのは、viewer の画面だけで使う入口の表と、`change_proposal_viewer.*` の文言と、通知の文言（`commons`）だけにする。
- **Rationale**: 同じ値の言葉を 2 つの spec が別々に持つと、値が増えたときに片方だけが直り、画面ごとに言葉が食い違う。core の値の型と同じ場所に表を置けば、値が増えたときに型の検査で 1 か所の不足として分かる。
- **Trade-offs**: 言葉を変えるときは core の表を直す。viewer の画面だけの言い回しが欲しくなったら、`change_proposal_viewer.*` に別のキーとして足す。

### Decision: 書き込み機能が有効なときだけ、Recent Changes に一覧へのリンクを出す
- **Context**: 要件 6.7。書き込み機能は初期値で無効で、多くの wiki では Change Proposal が 1 件も無い。
- **Selected Approach**: 書き込み機能の設定キー `app:changeProposalEnabled` を、`getServerSideCommonInitialProps` の中で `crowi` から取った `configManager` で読み（`crowi.configManager.getConfig('app:changeProposalEnabled')`）、画面の共通の値として渡す。真のときだけリンクを出す。core の `readChangeProposalSettings()` は、SSR の側から呼ばない。印・詳細ページ・一覧そのものは、設定にかかわらず動く。
- **Rationale**: 無効にしたあとも、反映済みの Change Proposal と取り消しは残る（core 要件 5.13）。印と詳細ページは、それをたどる手段として残す必要がある。一方、一度も使っていない wiki の Recent Changes に入口を出すと、意味の無いリンクになる。読み方を `crowi` 経由にするのは、`readChangeProposalSettings()` が `configManager` を直接 import していて、SSR の側では設定を読み込んでいない別の実体を読むためである（「core の実装との突き合わせ」。実際に初期値が返るか例外になるかは未確認）。`commons.ts` は AI の有効・無効を `crowi.isAiReady()` で、ほかの設定を `crowi` の `configManager` で読んでおり、同じ形にそろえる。
- **Trade-offs**: 設定キーの名前を viewer も知ることになる。キーの名前や意味が変わったときは viewer も直す（design.md の Revalidation Triggers）。
- **Trade-offs**: 無効にしたあとは、一覧へは通知・印・URL からしか行けない。

### Decision: 本人向けの操作は、入口ごとの宣言の表から引く
- **Context**: 要件 13。umbrella の決定 7。AI チャットの入口は、詳細ページに「後続 Change Proposal を作る」と、操作ごとの「AI に見直してもらう」を出したい。Vault・MCP の入口は、今は同じことができない。
- **Alternatives Considered**:
  1. 詳細ページが入口の種類を見て、AI チャットのときだけボタンを出す。viewer が AI チャットの振る舞いを知ることになり、入口が増えるたびに viewer を直す。
  2. 既存の本人向けの内容の表（`REQUESTER_ONLY_SECTIONS`）の行を、内容と操作の両方を持つ形に変える。ai-agent がすでに合わせている形（`{ proposalId }`）が変わる。
  3. 本人向けの操作だけの表（`REQUESTER_ACTION_SLOTS`）を別に作り、Change Proposal 全体の部品と操作ごとの部品を入口ごとに宣言させる（採用）。
- **Selected Approach**: 3。部品には、詳細ページが表示している core の応答（`ChangeProposalView` と、操作ごとの部品には `OperationView` も）を渡す。どの操作にボタンを出すかは部品が決める。表に行が無い入口では、viewer が反映されなかった操作の一覧だけを出す。
- **Rationale**: 本人向けの内容の表と同じ形（入口をキーにした宣言の表と、遅れて読み込む部品）で、詳細ページは入口で分岐しない。部品に応答をそのまま渡すと、部品が同じ Change Proposal を取り直さずに済み、取り消しのあとに詳細ページが取り直した値もそのまま渡る。
- **Trade-offs**: 部品の props が core の応答の型に依存する。core の応答の形が変わったときは、Revalidation Triggers に従って ai-agent の部品も確かめ直す。

### Decision: 完了と達成度は依頼した人にだけ表示する
- **Context**: 要件 11。core は段階と達成度を依頼した人にだけ返す（core の research.md の「段階と達成度は依頼した人にだけ返す」）。
- **Selected Approach**: core の `requesterState` があるときだけ表示する。完了なら達成度の割合（切り捨て）を添え、分母が 0 なら「完了」だけにする。破棄は「残りを反映せずに閉じた」と表示する。
- **Rationale**: 割合を四捨五入すると、1 つだけ反映されなかった案が「100%」に見えることがあるので、切り捨てる。破棄は、依頼した人が残りを反映しないと決めたことなので、失敗のように見えない言葉にする。

## Risks & Mitigations
- 印の問い合わせが Recent Changes の表示を遅くする — 一覧の行を先に表示し、印は別の問い合わせとして後から付ける。結合テストで、印の API が遅い・失敗する場合にも行が表示されることを確かめる。
- 通知の snapshot が読めず、通知の一覧全体が表示されなくなる — snapshot を読む関数は例外を投げず、読めなければ null を返す。単体テストで、壊れた値・知らない action・欠けた項目を確かめる。
- 頼む通知が同じ人から何度も届く — 同じ人・同じ Change Proposal は決まった時間に 1 回までにする。2 つの要求がほぼ同時に届いた場合は 2 件になることがあるが、受け入れる（送るボタンは送信中は押せない）。
- core と viewer が別の版で出ると、開いても何も表示されない通知が生まれる — tasks.md の先頭に、core と同じ版で出すことを書く。

## References
- [../change-proposal-core/design.md](../change-proposal-core/design.md) — API、`ChangeProposalView` / `OperationView` / `RevisionMarkView`、通知の snapshot
- `.kiro/specs/revision-diff-api/design.md` — `POST /revisions/diff` と見る人ごとの絞り込み
- `apps/app/.claude/rules/activity-recording.md` — activity の記録の順序
- `apps/app/.claude/rules/page-write-action-403-404.md` — 見えないページへの応答をそろえる規則
- `apps/app/.claude/rules/ui-pitfalls.md` — reactstrap の `target` に `useId()` を渡さない
- `apps/app/.claude/skills/vendor-styles-components/SKILL.md` — 差分の表示のスタイルの読み込み
