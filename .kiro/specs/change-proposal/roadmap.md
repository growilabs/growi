# change-proposal Sub-spec Roadmap

> 本ファイルは umbrella spec `change-proposal` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md` を参照すること。判断の理由と、検討時に確かめたコード上の事実は同じディレクトリの `research.md` にある。

## Overview

GROWI の AI 機能は、今は検索と、読んだページをもとにした回答だけで、ページを書き換えることはできない。一方で、ページの編集・新規作成・移動による整理を AI に任せたいという需要がある。将来は GROWI Vault（git で wiki を取得する機能）からの書き込みや、MCP 経由の外部の AI からの書き込みも受け付けたい。

この umbrella は、それらの書き込みをすべて **Change Proposal** という単位で扱う仕組みを作る。Change Proposal は、複数のページに対する操作（編集・新規作成・移動）をまとめた変更のかたまりである。管理者の設定に応じて自動で反映するか、依頼した本人がページ単位で承認してから反映する。反映した後は、本人も他のユーザーも、Change Proposal 単位で変更を確かめ、取り消せる。

## Approach Decision

- **Chosen**: Change Proposal（自動反映・取り消し機能付き）。
  - Change Proposal は Page / Revision とは別のコレクションに保存する。中には複数ページの操作と、どこから来たか（AI チャット／Vault／MCP）を持つ。
  - 反映はサーバー側で行い、LLM は使わない。自動反映は最初から入れ、管理者の設定（しない／自分が作ったページだけ／すべて）で制御する。初期値は「しない」。自動で反映しないときは、本人がページ単位で承認する。
  - 取り消しは、取り消し用の Change Proposal を作って同じ反映の仕組みで適用する。元の Change Proposal には、操作ごとに「どの取り消しで戻されたか」を記録する。
  - 反映済みの Change Proposal は、他のユーザーにも、そのユーザーが閲覧できるページの分だけ見せる。
- **Why**: 詳細は `research.md` の「決定」節。要点は次のとおり。
  - 「要望を聞いて案を作り、承認して反映する」流れでは、編集と新規作成を同じ仕組みで扱える。
  - Vault の push や MCP も、同じ Change Proposal に変換すれば、承認・反映・取り消しの仕組みが1つで済む。
  - 2026 年の AI エージェントの使い方（すぐ実行し、後で戻せる）に合わせるには、自動反映とまとめての取り消しが最初から要る。
- **Rejected alternatives**:
  - 承認前の変更を「未承認のリビジョン」として持つ案: 新規作成ではページを先に作る必要があり、パスを使ってしまう。リビジョンを読むすべての処理に除外の条件が要る。複数ページをまとめられない。
  - 開いているエディタに AI の書き換えを流し込む案（v7 の Editor Assistant の方式）: 1ページずつしか扱えず、案が残らないので後で承認できない。
  - 下書きを WIP ページとして作る案: 下書きがパスを使い、ページツリー・検索・通知に混ざる。複数ページをまとめて扱えない。
  - 承認なしですぐ反映し、ページ履歴で戻すだけの案: 複数ページをまとめて戻せない。
  - 差分の塊ごとの部分承認: 安全の守りにはならず、作る費用が大きい。最初の段階では作らない。直したい部分は AI に頼み直す。

## Scope

- **In**:
  - Change Proposal のデータ、状態の移り変わり、サーバー側での反映と取り消し、管理者の設定 — `change-proposal-core`
  - GROWI AI Agent のチャットから Change Proposal を作る道具と、チャット画面での承認 — `change-proposal-ai-agent`
  - 反映済みの Change Proposal を他のユーザーにも見せる画面と、画面からの取り消し — `change-proposal-viewer`
- **Out**:
  - ページの自動要約（別の施策で進行中）
  - ページの削除、閲覧範囲の変更、公開・非公開の切り替えを AI に任せること
  - 差分の塊ごとの部分承認
  - 承認待ちの Change Proposal を本人以外に見せること（将来。Vault からの push と一緒に考える）
  - Recent Changes の一覧を Change Proposal 単位でまとめ直すこと（将来）
  - AI が自分から始める作業（古い内容の検出、定期実行など）

## Constraints

- **反映するとき LLM を使わない**: 自動反映でも件数が増えても処理が重くならないようにする。AI チャットの編集は、AI に「この文字列をこう置き換える」という指示を出させ、案を作る時点でサーバーが本文全体を組み立てて保存する。
- **見えないページの存在を漏らさない**: Change Proposal の画面・通知・エラーは、見る人が閲覧できるページの分だけで作る。件数や「ほかに N ページある」も出さない。GROWI Vault の約束（見えないページは存在も分からない）と同じ厳しさにそろえる。今の Recent Changes の一覧の方針（他の人の非公開ページのタイトルも出す初期設定）には合わせない。
- **共同編集中の人の入力を消さない**: 編集中の人がいるページには反映しない。
- **人の保存と黙ってぶつからない**: 反映は「元の版のままなら書く」を1回の操作で行う。
- **作者は依頼した人間にする**: AI 専用のユーザーは作らない。AI によるものかどうかは `Revision.origin` ではなく別の項目で記録する（`origin` は上書き防止の確認に使われているため）。
- **i18n**: 新しく足す画面・通知の文言は、各 sub-spec の中で 5 言語すべてを訳す。
- **モデルの規則**: 新しいコレクションの索引は Mongoose 側で宣言する（`.claude/rules/model.md`）。

## Boundary Strategy

- **Why this split**:
  - `change-proposal-core` は「何を、どう反映し、どう取り消すか」を持ち、入口（AI チャット・Vault・MCP）を知らない。入口を増やしても core を変えずに済む。
  - `change-proposal-ai-agent` は入口の1つで、AI に何を任せてよいか（書き込み先の制限、閲覧範囲の確認、変更の出させ方）を持つ。
  - `change-proposal-viewer` は反映した後の見せ方と、画面からの取り消しを持つ。入口に関係なく同じ画面を使う。
  - `change-proposal-ai-agent` と `change-proposal-viewer` は、どちらも core に依存し、並行して進められる。例外は、ai-agent が詳細ページに部品を登録する 2 つのタスク（AI の記録と、後続・見直しのボタン）で、viewer の置き場所ができてから行う。
- **Shared seams to watch**:
  - core の反映の API ↔ ai-agent の自動反映・承認: 承認の単位（ページ単位）と、自動反映しなかった操作が承認待ちとして残る扱いを、両方の spec で同じにする。
  - core の取り消しの条件 ↔ viewer の取り消しボタン: 戻せるかどうかの判定は core が持ち、viewer はその結果を表示するだけにする。
  - 見る人ごとの絞り込み: 通知の中身は core、画面は viewer が作る。どちらも同じ判定（見る人が閲覧できるページか）を使う。
  - `proposalId` の記録: core がリビジョンにだけ書き（ページには書かない）、viewer がページ履歴と Recent Changes の印に使う。
  - 表示用の共通部品: 操作の種類・状態・理由の文言の表と、差分表示の設定は core が `features/change-proposal/client/shared/` に持ち、ai-agent と viewer はそれを使う。値を決めているのが core だから。
  - 本人にだけ見せる部分: viewer が詳細ページに入口ごとの置き場所（本人向けの内容と、本人向けの操作の 2 つ）を用意し、ai-agent が AI の要約と会話を出す部品と、後続・見直しを頼むボタンの部品をそこに登録する。ai-agent のこの 2 つのタスクだけが viewer に依存する。
  - ページごとの通知の指定: 出すかの判断（管理者の設定と Change Proposal ごとの指定の両方が有効なときだけ）と、指定を変える API は core が持つ。指定を切り替える画面は承認と同じ入口の画面（AI チャットでは ai-agent のチャット画面）が持ち、viewer は詳細ページに指定の値を表示するだけにする（research.md の決定 8）。
  - 完了・達成度・後続と見直しのつながり（`basedOn`）: 段階の移り変わり、達成度の数え方、つながりの保存と検査、見る人ごとの絞り込みは core が持つ。後続・見直しの中身と、それを頼むボタンは入口（ai-agent）が持つ。viewer は core が返したものを表示するだけにする（research.md の決定 7）。
- **Cross-spec touchpoints**（複数の spec が触るもの）:
  - `@growi/core` の変更: core がリビジョンの型に項目を足し、ai-agent が置き換えを当てる純関数 `applyStringEdits` を足す。どちらも changeset が要る。
  - 既存の `ai-agentic-search` の確かめ直し: ai-agent が `growi-agent.ts` と `post-message.ts` を書き換えるので、`ai-agentic-search` の Revalidation Triggers（`RequestContext` の新しいキー、指示文の構成の変更）に当たる。
  - 共有するファイル: `apiv3/index.js`、`generate-spec-apiv3.sh`、各言語の locale の JSON、`interfaces/activity.ts`、core の router の `index.ts`。

## Specs (dependency order)

- [x] change-proposal-core -- Change Proposal のデータ・状態・サーバー側の反映と取り消し・管理者の設定・通知のまとめ。Dependencies: none
- [x] change-proposal-ai-agent -- GROWI AI Agent から Change Proposal を作る道具、書き込みの守り、チャット画面での承認。Dependencies: change-proposal-core（詳細ページへの部品の登録の 2 タスクだけ change-proposal-viewer にも依存）
- [x] change-proposal-viewer -- 反映済みの Change Proposal の詳細ページ、ページ履歴と Recent Changes の印、画面からの取り消し。Dependencies: change-proposal-core

## Future (brief はまだ作らない)

- **GROWI Vault からの push**: 決まった場所のブランチ（例: `refs/heads/proposals/*`）への push を Change Proposal に変換する。`growi-vault` ファミリー側の sub-spec として作る。前提として、配った commit を push のときまで残す仕組みと、ファイルから元のページとリビジョンをたどる仕組みが要る（`research.md` 参照）。
- **MCP の入口**（`change-proposal-mcp`）: 外部の AI からの書き込みを Change Proposal として受け付ける。
- **承認待ちの Change Proposal を編集者にも見せる**: プルリクエストのように他の人に承認を頼む流れ。Vault からの push と一緒に考える。
- **Recent Changes を Change Proposal 単位でまとめ直す**: ページの一覧ではなく、出来事の一覧として作り直す必要がある。
- **見出し単位の承認、元の版が変わった案の自動の合わせ込み、AI が自分から始める作業**。

## 未決の論点

- 承認待ちの Change Proposal の期限（何日で期限切れにするか）と、破棄・期限切れの案の本文をいつ消すか
- 自動反映の「自分が作ったページだけ」の「作った」の定義（作成者か、最後の更新者か）
- AI が新しく作るページを WIP にするかどうか
- 複数台のサーバーで動かしている場合に、編集中の人がいるかどうかを確かめる方法（今の数え方はサーバーのプロセスごと）
