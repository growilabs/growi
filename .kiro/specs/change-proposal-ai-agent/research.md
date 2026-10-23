# Research & Design Decisions: change-proposal-ai-agent

## Summary
- **Feature**: `change-proposal-ai-agent`
- **Discovery Scope**: Extension（既存の GROWI AI Agent に書き込みの道具を足し、兄弟の spec `change-proposal-core` のサービスと API を使う）
- **Key Findings**:
  - core の作成のサービスは、作成の直後に管理者の自動反映の方針で操作を反映する。作成のときに「この操作は自動で反映しない」と指定する手段は無い。そのため、本人の確認が要る案（AI の提案・閲覧範囲が狭いページを読んだ案）は、core に渡す前に本 spec の中で止める必要がある。
  - チャットの入力欄は、@メンションを「パスの文字列」として本文に入れるだけで、サーバーにはメンションかどうかの区別が届かない。ただし、メンションを確定すると前は空白か行頭、後ろには空白が 1 つ入る。前後を空白か句読点で区切られたパスだけを「ユーザーが指定したページ」とすれば、メンションは必ず当てはまり、文中にたまたま含まれる部分の文字列は当てはまらない。
  - 読み取りの道具の `getPageContentTool` は、返す本文の CR と LF の組を LF に直している。AI はその本文から置き換える元の文字列を写すので、元の本文をそのまま使うと CR と LF の組を含むページでは一致しない。

umbrella の判断（決定 1〜6）とコード上の事実は [../change-proposal/research.md](../change-proposal/research.md)、core の判断は [../change-proposal-core/research.md](../change-proposal-core/research.md) にある。本書はそれを前提とし、本 spec のために追加で確かめた事実と判断だけを書く。コード上の事実は 2026-10-21 時点の master を読んで確かめた。動かして確かめていないものは「未確認」と書く。

## Research Log

### GROWI AI Agent の今の作り（`apps/app/src/features/mastra/`）
- **Findings**:
  - `growiAgent`（`server/services/mastra-modules/agents/growi-agent.ts`）の `instructions` は固定の文字列、`tools` は `fullTextSearchTool` と `getPageContentTool` の 2 つ。`model` だけが request context（実行ごとの値の入れ物）から決まる。
  - `@mastra/core` 1.41.0 の `Agent` は、`instructions` と `tools` も、request context を受け取る関数で渡せる（`dist/agent/types.d.ts` の `DynamicArgument`）。実行ごとに、書き込みの道具を渡すかどうかを変えられる。
  - チャットの API（`server/routes/post-message.ts`）の middleware は `accessTokenParser([SCOPE.WRITE.FEATURES.AI])` → `loginRequiredStrictly` → 入力の検査。`growiAgent.stream(messages, { requestContext, maxSteps: 10, memory })` を呼ぶ。request context には `user`・`searchService`・`modelKey` を入れている（`types/request-context.ts`）。
  - memory は `lastMessages: 30`。前の実行で読んだページの本文は、次の実行でも AI の文脈に残る。
  - 画面（`client/components/ChatSidebar/ChatSidebar.tsx`、500 行）は `useChat` を使い、メッセージの部品のうち `text` と `reasoning` を表示し、道具の結果は `page-sources.ts` が読んで「参照したページ」として出す。道具の結果は `tool-<登録名>` の部品として型が付く（`interfaces/chat-tools.ts` の `GrowiChatTools`）。過去の会話を開き直したときも、道具の結果の部品は同じ形で戻る。
  - 画面は、会話の全部のメッセージ（ユーザー・AI・道具の結果）を毎回サーバーへ送る（`DefaultChatTransport` の既定）。
- **Implications**: 書き込みの道具と指示文は、request context の値で切り替える。ユーザーが指定したページは、送られてきたメッセージのうちユーザーが書いたものの文字だけから決める。AI が読んだページは、実行ごとではなく会話ごとに記録する。

### 読み取りの道具の出力
- **Findings**:
  - `fullTextSearchTool` は、閲覧できるページの `pageId`・`pagePath`・`snippet`（本文の抜粋）を返す。
  - `getPageContentTool` は `findByIdAndViewer` / `findByPathAndViewer` でページを取り、`pageId`・`path`・本文の一部または見出しの一覧を返す。本文は `scanBody` が CR と LF の組を LF に直してから返す。ID で読むときは、リンクを知る人だけが見られるページも読める。
  - どちらも、失敗を例外ではなく `result` の値で返す。
- **Implications**: 道具の中身と出力の形は変えずに、登録するときに「結果からページ ID を取り出して記録する」処理を足す。検索の結果の抜粋も本文の一部なので、AI が読んだページとして記録する。リンクを知る人だけが見られるページを読んだ場合は、閲覧範囲が狭いページとして扱う。

### チャットの入力欄の @メンション（`ai-chat-page-mention`）
- **Findings**:
  - `getMentionFlattenedText` は `state.doc.toString()` で、メンションはパスの文字列のまま本文に入る。サーバーには区別が届かない。
  - `@` は行頭か空白の直後でだけ始まり、確定すると `@` と検索の文字列がパスに置き換わり、後ろに空白が 1 つ入る（`ai-chat-page-mention` の要件 1.1・3.1）。
- **Implications**: 「ユーザーが指定したページ」は、ユーザーのメッセージの中に、前が行頭・空白・開きの句読点、後ろが末尾・空白・閉じの句読点で区切られて現れるパスとする。メンションは必ず当てはまる。日本語で「/議事録/2026を直して」のように助詞を続けて打ったパスは当てはまらないが、その操作は「AI の提案」として保留され、本人が 1 回選べば進められる。入力欄の部品は変えない。

### 外部の `@growi/mcp-server` の `editPage`
- **Findings**（`@growi/mcp-server` 1.8.0 の配布物を読んだ）:
  - `applyStringEdits(body, edits)` は、`{ oldString, newString, replaceAll? }` の並びを前から順に適用する。`oldString` が空・見つからない・複数見つかって `replaceAll` が無い、のどれかで例外を投げる。複数見つかったときは、最初の数か所の行・列・前後の文字を返す。
  - 改行の書き方は直さず、文字列をそのまま比べる。
  - 置き換えの元になる本文は、保存の直前に最新のものを取り直している。
  - `@growi/mcp-server` は `@growi/core` を開発用の依存として持ち、配布物に取り込んでいる。
- **Implications**: 置き換えを適用する純関数は、同じ規則（前から順に、空は不可、複数で `replaceAll` が無ければ不可）で `@growi/core` に置き、例外ではなく結果の型で返す。改行の書き方をそろえる処理は、本 spec の側で純関数の前に行う（`@growi/core` の関数は mcp-server と同じく文字列をそのまま比べる）。将来の `change-proposal-mcp` と外部の mcp-server も同じ関数を使える。

### suggest-path
- **Findings**:
  - `POST /_api/v3/ai-tools/suggest-path`（`features/ai-tools/suggest-path/server/routes/apiv3/index.ts`）は、本文を受け取り、置き場所の候補（`type`・`path`・`label`・`description`・`grant`）を返す。`path` は親のディレクトリの形（末尾が `/`）。`aiReadyGuard` を通る。
  - 中で `suggestPathAgent` という別の AI を動かすので、時間とトークンがかかる。
- **Implications**: 書き込みの道具の中から suggest-path を呼ばない（段数とトークンを使い、AI が選んだ場所は結局「AI の提案」になるため）。保留中の案に、ユーザーが指定していない場所に作る新規作成があるときだけ、チャット画面が suggest-path の API を呼んで候補を示し、本人が選ぶ。

### 閲覧範囲の比べ方
- **Findings**:
  - `server/service/page-grant.ts` の `validateGrant` は、子のページの閲覧範囲が親の閲覧範囲に収まるかを確かめる。グループの階層は、親のグループの ID に、その子孫のグループの ID を足した一覧（`findGroupsWithDescendantsById`）と比べている。
  - ただし `validateGrant` は private で、子のページがリンクを知る人だけのページなら常に許す（ページの木の階層とは別の扱いのため）。本 spec の「書き込み先の読者が、読んだページの読者に収まるか」とは意味が違う。
- **Implications**: 比べる判断は本 spec の純関数として作る。子孫のグループの足し方だけは、`page-grant.ts` と同じく `UserGroup` / `ExternalUserGroup` の `findGroupsWithDescendantsById` を使う。収まることを確かめられないときは「狭い」とする。

### アクセストークンの scope の確かめ方
- **Findings**: `AccessToken.findUserIdByToken(token, scopes)` は `scopes: { $all: … }` で、渡したすべての scope を要求する。`AccessToken.validateTokenScopes(token, requiredScopes)` もある。`accessTokenParser` は読み取り専用ユーザーのトークンを受け付けない。
- **Implications**: チャットの API の middleware の scope は変えない（読み取りだけのチャットを壊さないため）。アクセストークンで呼ばれたときは、handler の中で `validateTokenScopes` によりページの書き込みの scope を確かめ、無ければ書き込みの道具を渡さない。

### Mastra の `requireApproval`
- **Findings**: `@mastra/core` 1.41.0 の道具は `requireApproval`（真偽値か、入力から決める関数）を持てる（`dist/tools/types.d.ts:488`）。承認を待つ間、実行は止まり、画面から承認か拒否を送って実行を再開する仕組みが要る。今のチャット画面と `post-message.ts` には、止まった実行を再開する経路が無い。
- **Implications**: 使わない（Design Decisions を参照）。

### core の契約で本 spec が使うもの
- `ChangeProposalService.createProposal({ requester, entry: 'ai-chat', modelLabel, operations, request, trigger? })` は、作成の直後に自動反映の方針で反映し、`{ proposalId, apply }` を返す。`trigger`（`ApplyTrigger`）を渡すと、作成と自動反映の activity をその activity に記録する。渡さなければ `background` として記録する。失敗は `ServiceError`（`not-found`・`not-open`・`input-rejected`・`feature-disabled`・`daily-limit-reached`・`target-unavailable`・`base-revision-mismatch`・`user-not-allowed`）で返す。`not-found` と `not-open` は承認などの誤りで、作成では返らない。`target-unavailable` と `base-revision-mismatch` の `index` は、core に渡した並びの番号である。
- 承認・飛ばす・破棄・取り消し・取得は REST（`/_api/v3/change-proposals/...`）。操作の指定は、どの API でも `key`（作成のときに振る乱数の ID）。承認の結果 `ApplyResult` と取り消しの結果 `RevertResult`（`revertProposalId?` と、`key` ごとの `outcome`: `reverted`・`revert-refused` と理由・`skipped` と理由 `page-being-edited`）も、操作を `key` で指す。依頼した人への `OperationView` には `index`・`baseRevisionId`・`proposedBody`・`revertability` が入る。
- 機能の server の barrel が export するのは、作成・承認・取得の関数と、設定を読む関数 `readChangeProposalSettings`（core の tasks.md 5.1・5.2・6.1）。`interfaces` は `MAX_TOTAL_BODY_BYTES` を export する。
- 操作の種類・状態・理由・戻せない理由の言葉の表（翻訳のキーは `translation` の `change_proposal.*`）と、`RevisionDiff` から切り出した diff2html の設定と見た目は、core の `features/change-proposal/client/shared/` にある。viewer と本 spec の画面は、どちらもこれを使う。
- 反映で作ったリビジョンには、core が `proposalId` と `proposalOperationKey` を付ける（`Page` には項目を足さない）。本 spec はこの印を読まない。
- viewer は、詳細ページに本人向けの場所を用意する。入口の種類ごとに部品を読み込む関数を並べた表（`requester-only-sections.ts`、部品の props は `{ proposalId: string }`）で、表に行があり、見る人が依頼した人のときだけ出す。表は、`'ai-chat'` の行が無い状態で作られる（viewer の tasks.md 5.6）。

## Architecture Pattern Evaluation

| 案 | 内容 | 良い点 | 問題 |
|---|---|---|---|
| A. 道具が常に core に作らせる | 確認が要る案も core に作らせ、自動反映を止める指定を core に足してもらう | 保存先が 1 つ | core の作成の契約を変える必要がある。core は完了済み |
| **B. 確認が要る案は本 spec が保留にする（採用）** | AI の提案や閲覧範囲の問題がある案は、本 spec の collection に保留中の案として置き、本人がチャット画面で確かめてから core に作らせる | core を変えない。確認は、モデルには押せない画面のボタンで行う | 保留中の案の保存と期限を本 spec が持つ |
| C. 確認が要る案は断るだけ | AI の提案や閲覧範囲の問題があれば作らず、ユーザーに頼み直してもらう | 保存するものが無い | 閲覧範囲の確認は、文字で「大丈夫」と書いても AI が書いたものと区別できず、進める手段が無い |

## Design Decisions

### Decision: 確認が要る案は、core に渡す前に保留にする
- **Context**: 要件 4.6・5.7・7.4–7.8。core の作成は、作成の直後に自動反映の方針で反映する。
- **Alternatives Considered**: 上の表の A・B・C。
- **Selected Approach**: B。書き込みの道具は、確認が要らない案だけを core に作らせる。確認が要る案は、変更後の本文まで組み立てた形で保留中の案として保存し、チャット画面から本人が「進める」を押したときに、本 spec の REST の API が core に作らせる。
- **Rationale**: 確認は、AI が書く文字ではなく、本人だけが押せる画面のボタンから来る必要がある。保留中の案はサーバーが持つので、ボタンから届く値は「どの操作を含めるか」と「置き場所」だけで、本文や対象を画面から書き換えられない。
- **Trade-offs**: 保留中の案の保存と期限を本 spec が持つ。期限は TTL 索引で消す（Change Proposal にならなかった一時的なデータで、記録として残す必要が無い）。

### Decision: ユーザーが指定したページは、ユーザーのメッセージの文字から厳しく決める
- **Context**: 要件 4.1–4.5。サーバーにはメンションの区別が届かない。
- **Selected Approach**: 候補のページのパス（とページの ID のリンク）が、ユーザーが書いたメッセージの中に、前後を空白か句読点で区切られて現れるかを確かめる。新規作成と移動先は、そのパスか、指定されたページの下にあるかを確かめる。`/` は親として数えない。
- **Rationale**: メンションは前後の区切りを必ず満たす。打ったパスに助詞が続くような、区切りの無い書き方は当てはまらないが、そのときは「AI の提案」として保留され、本人が選べば進められる。間違ってゆるく当てはめる（`/a` を `/ab` の一部として数える）よりも、本人に 1 回選んでもらうほうが安全である。
- **Trade-offs**: 入力欄からメンションの一覧を別に送る案は、`ai-chat-page-mention` の部品の出力を変える必要があり、打ったパスには使えないので採らない。

### Decision: AI が読んだページは会話ごとに記録し、記録が欠けていれば確認を求める
- **Context**: 要件 5.1・5.6。brief は「その実行で読んだページ」としている。
- **Selected Approach**: 会話（スレッド）ごとに、AI が読んだページの ID と読んだ時点のパスを記録する。記録を始める前からある会話、記録の書き込みに失敗した実行、記録の件数が上限を超えた会話は「確かめられない」として、確認を求める。
- **Rationale**: memory が前の 30 件のメッセージを AI に渡すので、前の実行で読んだ本文も AI の文脈に残っている。実行ごとの記録では、前の実行で読んだ非公開のページを見落とす。brief の「その実行で」は、この理由で会話全体に広げて解釈する。
- **Trade-offs**: 長い会話で一度でも非公開のページを読むと、以後の書き込みで毎回確認が出る。新しい会話を始めれば記録は空から始まる。
- **記録する期間**: 書き込み機能が有効なときだけ記録する。機能の初期値は無効なので、使わない wiki に新しいコレクションと、読み取りのたびの書き込みを足さないため。機能を有効にする前からある会話は「記録を始める前のやり取りがある」として、無効の間に読み取りがあった会話は「欠けている」として、どちらも確認を求める。

### Decision: 閲覧範囲が狭いページを読んだ案は、本人が確かめれば進められる
- **Context**: brief は「本人が確かめれば進められるかは設計で決める」とした。
- **Selected Approach**: 進められる。保留中の案に、内容が含まれうるページの名前を並べ、本人が「確かめた」ことを明示して進めたときだけ作る。進めるときにもう一度確かめ、新しく見つかったページがあれば作らずに一覧を出し直す。
- **Rationale**: 止めるだけにすると、本人は同じ内容を手で書き写すことになり、確認の機会が無くなる。読んだページを閲覧できるのは本人なので、本人に一覧を見せても新しく漏れるものは無い。
- **Trade-offs**: 本人が一覧を読まずに進めることは防げない。

### Decision: 同じページへの編集は 1 つの操作にまとめる
- **Context**: 要件 2.6。core は編集の操作ごとに「最新のリビジョンが元のリビジョンのままなら書く」で反映する。
- **Rationale**: 同じページへの編集の操作を 2 つにすると、両方が同じ元のリビジョンを持つため、1 つ目を反映した時点で 2 つ目が「古い」になる。そこで、同じページへの置き換えの指示は書かれた順につなげて 1 つの操作にする。新規作成するページへの編集は、まだページが無く ID が無いので断り、新規作成の本文にまとめさせる。

### Decision: 改行の書き方は LF にそろえてから適用する
- **Context**: 要件 2.7。`getPageContentTool` は LF に直した本文を AI に見せる。
- **Selected Approach**: 元の本文と置き換えの指示の両方の CR と LF の組を LF に直してから適用する。組み立てた本文は LF のまま core に渡す。
- **Trade-offs**: CR と LF の組で保存されていたページは、編集の反映で LF に変わる。GROWI のエディタは LF で保存するので、表示には影響しない。差分の表示も、LF に直した元の本文と比べる。

### Decision: 内容が大きく消える編集は、割合と最低の長さで断る
- **Context**: 要件 2.8・2.9。
- **Selected Approach**: 元の本文が `SHRINK_CHECK_MIN_BASE_CHARS`（400 文字）以上で、組み立てた本文が元の `SHRINK_REJECT_RATIO`（0.5、半分）未満になるときは断る。空になるときは、元の長さにかかわらず断る。値は定数で持つ（管理者の設定にはしない）。
- **Rationale**: 置き換えの指示では、出力の途中で切れることは起きないが、「この節を消す」が続くと大きく消える。小さいページは数行の変更で割合が大きく動くので、最低の長さを置く。断られたときは、AI がエディタで本人が行うよう伝える。
- **Follow-up**: 値が実際の使い方に合うかは、使われ方を見て見直す（Open Questions）。

### Decision: 1 回の実行の段数は、書き込みの道具を渡すときだけ 20 にする
- **Context**: 要件 11.2・11.3。今の上限は 10。
- **Rationale**: 書き込みの道具は操作の並びを 1 回で受け付けるので、案を作るのは 1 段で済む。ただし、3 ページを読むと、見出しの一覧と節の読み取りで最大 6 段、検索で 1 段、置き換えの指示の作り直しで 1 段、最後の応答で 1 段となり、10 段ちょうどになる。並べて呼ぶかどうかはモデルによるので、余裕を持って 20 にする。書き込みの道具を渡さない実行は 10 のままにし、読み取りだけのチャットの費用を変えない。
- **Follow-up**: 決まった順に道具を呼ぶ試験用のモデルで、3 ページの編集と作り直し 1 回が上限の中で終わることを試験で確かめる。実際のモデルでの段数は、開発用のサーバーで確かめて記録する。

### Decision: `requireApproval` は使わない
- **Context**: brief は「Mastra の `requireApproval` を今のチャット画面で使えるか」を最初に確かめるとした。
- **Selected Approach**: 使わない。
- **Rationale**: 承認の単位は Change Proposal と保留中の案で、どちらも会話を開き直した後や、別の日にも承認できる必要がある。`requireApproval` は 1 回の実行を止めて待つ仕組みで、止まった実行を再開する経路を `post-message.ts` と画面に作る必要がある。管理者の自動反映の方針とも別に動くので、承認の仕組みが 2 つになる。`requireApproval` が今の画面で動くかどうかは、この判断を変えないので、確かめる作業は行わない。

### Decision: 道具の出力の操作は、作成のあとに core の取得のサービスから作る
- **Context**: 要件 7.2。core の `ApplyResult` は操作を `key` で指す。`key` は core が作成のときに振るので、書き込みの道具は、どの `key` が自分の送ったどの操作に当たるかを知らない。
- **Selected Approach**: 作れたら、依頼した人として `getForViewer` で Change Proposal を読み、`index`（依頼した人にだけ返る、core に渡した並びの番号）で渡した操作と結び付けて、`key`・種類・パス・状態を道具の出力に入れる。`apply` が `null` や `in-progress` でも、取得の結果の状態をそのまま使う。
- **Rationale**: core の作成の結果の形を変えずに済み、出力の状態は core が保存した状態と同じになる。
- **Trade-offs**: 作成のたびに 1 回の読み込みが増える。

### Decision: core の誤りは、1 つの対応表で道具の結果と HTTP の応答に置き換える
- **Context**: 要件 7.3・9.8。core の `ServiceError` の値は、書き込みの道具と、保留中の案を進める API の両方で返りうる。
- **Selected Approach**: design の「core の誤りの対応表」に、すべての値の置き換え先を書く。作成では返らない `not-found` と `not-open` も、予期しない誤りとして表に入れる。誤りの `index` は、道具では AI が送った並びの番号に、進める API では操作の `key` に直す。
- **Rationale**: 値を 1 つでも扱い忘れると、AI に理由が伝わらないか、画面が知らない応答を受け取る。core に渡す並びは、同じページの編集をまとめたあとの並びや、本人が選んだ操作だけの並びなので、core の番号をそのまま返すと別の操作を指してしまう。

### Decision: 保留中の案を進める route は、自分の activity を core に渡す
- **Context**: `activity-recording.md`。書く route は `addActivity` で activity を作る。
- **Selected Approach**: 進める route は、`addActivity` が作った activity を `trigger: { kind: 'request', activityId }` として `createProposal` に渡し、自分では activity を記録しない。書き込みの道具からの作成は、チャットの API が `addActivity` を通らないので `trigger` を渡さず、core が `background` として記録する。
- **Rationale**: route の activity を使わずに core が別の activity を作ると、作成の記録がこの要求の activity に結び付かない。応答が途中で切れたときなどには、route の activity が `ACTION_UNSETTLED` として別に残る。route の activity を core に渡せば、作成の記録はその 1 つになり、操作者と要求の情報（IP・endpoint）も route のものになる。

### Decision: 置き換えを適用する純関数は `@growi/core` に置く
- **Context**: brief の制約「`applyStringEdits` との共通化を検討する（置き場所は `@growi/core` など）」。
- **Selected Approach**: `packages/core/src/utils/string-edits.ts` に、mcp-server と同じ規則の純関数を、結果の型で返す形で置く。
- **Rationale**: 依存の無い純関数で、`@growi/core` の役割（複数の package にまたがる純関数）に合う。将来の `change-proposal-mcp` と、`@growi/core` を取り込んでいる外部の mcp-server が同じ関数を使える。
- **Trade-offs**: `@growi/core` は公開している package なので changeset が要る。外部の mcp-server を書き換えるのは本 spec の範囲外。

### Decision: 機能の置き場所
- **Selected Approach**:
  - AI の SDK を使う部分（書き込みの道具、読んだページを記録する処理、指示文、`post-message.ts` の変更）は `features/mastra/` に置く。
  - AI の SDK を使わない部分（本文の組み立て・書き込み先の判断・閲覧範囲の判断の純関数、保留中の案と AI の記録と読んだページの記録の model、REST の API、チャット画面の部品）は新しい `features/change-proposal-ai/` に置く。
- **Rationale**: REST の API は起動時に登録されるので、AI の SDK を読み込んではいけない（`server-boot-imports.md`）。AI の記録の API は、AI の機能を無効にした後も依頼した人が取得できる必要がある（要件 10.6）ので、`aiReadyGuard` の下に置かない。依存の向きは `features/mastra` → `features/change-proposal-ai` → `features/change-proposal`（core）である。逆向きは、viewer の本人向けの部品の表が、`'ai-chat'` の行から本 spec の `client/record` を `import()` で遅れて読み込む 1 か所だけにする。viewer の詳細ページは入口の種類で分岐せず表を引くだけなので、AI チャットに固有の画面は本 spec が持ち、viewer は場所だけを持つ。

## Synthesis

- **一般化**: 「本人の確認が要る理由」（AI の提案・閲覧範囲が狭いページ・記録が欠けている）を 1 つの判断（`decideProposalRoute`）にまとめ、理由の種類を値で持つ。新しい理由を足しても、保留中の案の流れと画面は変わらない。
- **既存を使う**: 置き換えの規則は mcp-server の規則をそのまま使う。差分の表示は既存の `diff` と `diff2html` を使い、diff2html の設定と見た目、操作の種類・状態・理由の言葉は core の `client/shared/` のものを使う。置き場所の候補は suggest-path の API を使う。子孫のグループを足すには `findGroupsWithDescendantsById` を使う。
- **減らしたもの**: suggest-path を呼ぶ道具は作らない（画面から呼ぶ）。`requireApproval` は使わない。1 回の実行の中の状態は持たず、作った案の数は AI の記録の数を実行の ID で数える。

## Risks & Mitigations
- 長い会話では確認が多く出る — 新しい会話を始めると記録は空から始まることを、確認の表示に書く。
- 検索の結果だけで閲覧範囲の確認が出る — 検索の抜粋も本文の一部なので、brief のとおり記録する。確認が多すぎるかは、使われ方を見て見直す。
- 試験用のモデルで段数を確かめても、実際のモデルの呼び方とは違う — 開発用のサーバーで実際のモデルを使って確かめ、結果を本書に足す。

## References
- `apps/app/.claude/rules/server-boot-imports.md` — 起動時に AI の SDK を読み込まない
- `apps/app/.claude/rules/activity-recording.md` — REST の API の middleware の順
- `apps/app/.claude/rules/page-write-action-403-404.md` — 見えないものへの応答をそろえる
- `.claude/rules/model.md` — 索引は Mongoose 側で宣言する
- `.kiro/specs/ai-agentic-search/design.md` — 読み取りの道具と指示文の決まり
- `.kiro/specs/ai-chat-page-mention/requirements.md` — メンションの入り方
- `.kiro/specs/suggest-path/` — 置き場所の候補
