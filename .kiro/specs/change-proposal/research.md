# Research: change-proposal

検討は 2026-10-12〜10-20 に行った。他製品の調査、コードの確認、観点を分けたサブエージェント（製品・使い勝手／設計・実装／安全・統制、2 回）からの意見をもとにしている。コード上の事実は master を読んで確かめたもので、動かして確かめていないものは「未確認」と書く。

## 1. 他製品の AI 書き込み機能（2026-10 時点）

| 製品 | 画面上で AI ができる書き込み | 安全の仕組み |
|---|---|---|
| Notion | Agent がページと DB を作成・編集する。Custom Agents は予定や出来事をきっかけに動く。DB の列を AI が埋める | Plan Mode（計画を承認するまで編集しない）、Suggest edits（行ごとに承認）。Custom Agents は最初どのページにも触れず、ページごとに権限を渡す。実行ログ、監査ログ、使用量の上限 |
| Confluence (Rovo) | Agent がページを作成・編集・移動する。下書きを本人だけに見せてから置き場所を選んで追加する | 書き込む前に確認する。Agent が読んだ後に他の人がページを変えていたら編集を拒否する。Agent を共同編集者として表示する。版の履歴で戻せる |
| Slite | 古い記述を見つけて直す案を出す。改名・アーカイブも提案する | すべての変更を承認待ちの一覧に入れ、1件ずつ差分を見て承認する。変更履歴に変更元（アプリ・API・MCP・Agent）を記録する |
| GitBook | Agent が変更リクエスト（プルリクエストのような別ブランチ）を作る。内容の抜けやリンク切れを見つけて自分で修正案を出す | すべて変更リクエスト経由。同時に出す変更リクエストは3件まで。人と Agent に同じ役割権限をかける |
| Google Drive / Docs | ファイルの移動案を一覧で出す。文書を書き換える | 移動案をユーザーが直してから一括承認する。移動で権限が変わるときは別に確認する。書き換えは本人だけに見える提案として出す |
| NotePM | 質問に答えながらマニュアルを作る。Office や PDF をページに変換する | MCP では対象ごとに読み取りと書き込みを別々に許可する。AI 経由の操作を 180 日分記録する |
| Kibela / esa / DocBase | 書き込みは MCP や Slack 経由だけ | Kibela は削除・アーカイブ・タイトル変更を AI に渡さない。esa は外部アプリの接続を既定で拒否する。DocBase は `no-ai` タグで AI の対象から外せる |

各社に共通する仕組み: AI は呼び出したユーザーの権限の範囲でだけ動く。反映の前に人が確かめる（計画の承認、1件ずつの承認、一括承認）。反映した後に版の履歴と AI による変更の記録で戻せる。危険な操作は AI に渡さない。管理者が止められる。

国内の他社には、自社でホストできて AI の提供元も選べるものが無い。GROWI はそれができる。

主な出典:
- https://www.notion.com/help/custom-agents-sharing-and-permissions
- https://www.notion.com/releases/2026-05-07
- https://www.atlassian.com/blog/confluence/new-agents-in-confluence
- https://support.atlassian.com/rovo/docs/agent-actions
- https://slite.com/changelog/the-self-maintaining-knowledge-base
- https://gitbook.com/docs/changelog/readme.md
- https://blog.kibe.la/entry/2026/09/24/145712
- https://docs.esa.io/posts/584

## 2. コード上の事実（設計の前提）

- **今の GROWI AI Agent は読み取りだけ**: 道具は `fullTextSearchTool` と `getPageContentTool` の2つ（`apps/app/src/features/mastra/server/services/mastra-modules/agents/growi-agent.ts`）。
- **`Revision.origin` は上書き防止の確認に使われている**: `isUpdatable`（`apps/app/src/server/models/obsolete-page.js:156`）は、保存してきた側の origin が `editor` で、最新のリビジョンの origin が `editor` か `view` のときだけ確認を飛ばす。エディタは最新のリビジョンの origin が undefined のときだけ revisionId を送る（`apps/app/src/client/components/PageEditor/PageEditor.tsx:159`）。AI 用の値を足すと、AI の反映直後のエディタの保存がエラーになるとみられる（未確認）。
- **REST で保存すると、編集中の共有文書が置き換わる**: origin が `view` か undefined の保存では、`syncWithTheLatestRevisionForce`（`apps/app/src/server/service/yjs/yjs.ts:164`、呼び出しは `apps/app/src/server/routes/apiv3/page/update-page.ts:188`）が yjs の文書を保存した本文で丸ごと置き換える。共同編集者の未保存の入力は消える。今の MCP からの書き込みにも同じ問題がある。
- **確認と書き込みが別々**: `isUpdatable` で確かめた後、`pushRevision`（`apps/app/src/server/models/page.ts:1085`）は書き込む時点でもう一度確かめない。人の保存とぶつかると、どちらかが上書きされる。
- **保存まわりの処理は route にある**: 上書き防止の確認、activity、通知、yjs の同期は `update-page.ts` / `create-page.ts` にあり、`pageService.updatePage` には無い。
- **activity は同じ人の5分以内の更新を1つにまとめる**（`apps/app/src/server/service/activity/update-activity-logic.ts`）。audit log は初期設定で無効で、activity は 30 日で消える（`config-definition.ts`）。Change Proposal をまとめる単位にも、消えない記録にも使えない。
- **版を戻す機能は今は無い**: ページ履歴の画面に、古い版に戻す操作は無い。
- **移動してもページ自身の閲覧範囲は変わらない**: `renamePage`（`apps/app/src/server/service/page/index.ts`）はページの grant を保つ。子ページの移動は裏で続き、呼び出し元は待たない。移動すると旧パスからのリダイレクトができる。
- **AI はリンクを知る人だけが見られるページも ID で読める**: `getPageContentTool` が使う `findByIdAndViewer` は、そうしたページも含める。
- **GROWI では「見られる」と「編集できる」が同じ**: ページの更新は `excludeReadOnlyUser` と `findByIdAndViewer` だけで確かめている。管理者も他の人の「自分だけ」のページには届かない。
- **Recent Changes は初期設定で、他の人の非公開ページのタイトルも一覧に出す**: `security:list-policy:hideRestrictedByOwner` / `hideRestrictedByGroup` の初期値が false（`config-definition.ts:818`、使われるのは `page.ts:975`）。
- **チャットの API は書き込み向けの確認をしていない**: AI 用の権限だけを確かめ、読み取り専用のユーザーを弾いていない（`features/mastra/server/routes/post-message.ts`）。ページの更新・作成の API はページの書き込み権限と `excludeReadOnlyUser` を確かめている。
- **差分表示の部品は残っている**: v7 の Editor Assistant で使った `@codemirror/merge` の部品が `packages/editor/src/client/services-internal/unified-merge-view/` に残っている。ただし apps/app からは使われておらず、開いているエディタの中でしか動かない。
- **GROWI Vault の履歴は作り直される**: namespace の履歴は 1 時間ごと（または 1000 commit ごと）に、親の無い commit 1 つへまとめ直される（`.kiro/specs/growi-vault-manager/requirements.md` 要件 6）。ファイル名にはユーザーごとに決まる接尾辞が付くことがある（同 要件 4）。

## 3. 決定

### 決定 1: 承認前の変更は、Page / Revision とは別のデータとして持つ
- **理由**: Revision は必ずページに属するので、新規作成の案を持てない。未承認の版を混ぜると、リビジョンを読むすべての処理に除外の条件が要り、1か所でも漏れると承認前の内容が見えてしまう。案は複数ページにまたがる。案は捨てたり期限切れにしたりする一時的なデータで、リビジョンは消さない履歴である。
- **却下した案**: 未承認のリビジョン、WIP の下書きページ、開いているエディタへの流し込み、すぐ反映するだけ（Roadmap の Approach Decision 参照）。

### 決定 2: 自動反映を最初から入れ、差分の塊ごとの部分承認は作らない
- **理由**: 部分承認は、書き写しによる漏洩、ページの本文に仕込まれた指示、一度に大量のページが壊れる事故、他人の更新との衝突のどれも防がない。防いでいるのは、書き込み先の制限、閲覧範囲の確認、上限、反映時の確認である。塊ごとの承認は、保存した案を後からエディタに読み込めるか確かめておらず、費用が大きい。一方、サーバー側での反映と取り消しは、自動反映にも Vault の push にも必要になる。
- **異論として出た意見**: 「最初はページ単位の承認だけにし、自動反映は後の設定にする」。版を戻す機能が無く、絞った条件の取り消しは活発な wiki ではよく断られるため。これに対しては、AI に本文全体を書かせない・短くなる操作を拒否する・編集中のページには反映しない・反映を1回の操作で行う、を自動反映の前提条件とし、自動反映の初期値を「しない」にすることで受け止めた。

### 決定 3: 反映のときに LLM を使わない
- AI チャットの編集では、AI に「この文字列をこう置き換える」という指示を出させる。案を作る時点で、サーバーが元の本文に当てて本文全体を作り、保存する。元の文字列が見つからない操作と、本文が一定の割合以上短くなる操作は拒否する。
- **理由**: AI は長いページを見出しごとに分けて読むので、本文全体を書かせると読んでいない節を落としたり、出力の上限で途中で切れたりする。反映に LLM を使わなければ、件数が増えても処理は軽い。Vault の push や MCP から来る本文はそのまま使う（短くなる操作は警告にとどめる）。

### 決定 4: 取り消しは取り消し用の Change Proposal として適用する
- 元の Change Proposal には、操作ごとに状態（反映済み／取り消し済み／取り消しを断られた）と、戻した取り消し用の Change Proposal の ID を記録する。全体の状態は操作ごとの状態から計算し、別に保存しない。
- **理由**: 反映の仕組みが1つで済み、守りが片方にだけ入るずれを防げる。別々の人が別々の時点で一部ずつ戻すことが普通に起きる。取り消しの取り消しも特別な処理なしでできる。
- 戻してよい条件: 編集は AI のリビジョンがまだ最新のときだけ。新規作成は子ページも他の人の編集も無いときだけ、ごみ箱へ移す。移動は元のパスが空いているときだけ戻し、逆向きのリダイレクトを消す。それ以外は断り、手で直してもらう。

### 決定 5: 反映済みの Change Proposal は他のユーザーにも見せる
- 見る人が閲覧できるページの操作だけを見せる。件数は出さない。AI が書いた要約や会話、AI が読んだページの一覧は本人にだけ見せる。リンクを知る人だけが見られるページは一覧に並べない。
- 本人は全体を戻せる。他の人（管理者も含む）は、自分が見られるページの操作を戻せる。見えない操作があることを理由に断らない（断ることが存在を漏らす）。代わりに「本人に戻すよう頼む」通知を送れる。
- **理由**: 大きな変更が広い範囲を書き換えたとき、他の人が1つの単位として気付いて戻せる必要がある。他製品には、本人以外が Agent の実行をまとめて戻せるものは見つからなかった（未確認）。
- Recent Changes はまとめ直さない。Recent Changes はページの一覧で、件数とページ送りの仕組みが壊れるため。取得した後で今のリビジョンの `proposalId` を一度にまとめて調べ、印を付けるだけにする。

### 決定 6: sub-spec 名を `change-proposal-` でそろえる
- 前例の `growi-vault` に合わせ、名前で属する umbrella が分かるようにする。AI 関連の spec からは、この roadmap と steering の索引でたどる。

