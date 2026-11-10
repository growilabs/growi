# Brief: change-proposal-viewer

**Parent**: umbrella spec `change-proposal`（[roadmap.md](../change-proposal/roadmap.md)、判断の理由とコード上の事実は [research.md](../change-proposal/research.md)）

## Problem

AI や外部の仕組みが Change Proposal で多くのページを書き換えたとき、依頼した本人以外には、それが1つのまとまった変更だと分からない。Recent Changes にもページ履歴にも、同じ人の別々の更新として並ぶだけになる。そのため、他のユーザーが「この変更はよくないので全部戻してほしい」と気付いて判断することも、実際に戻すこともできない。

## Current State

- Recent Changes は、ページを更新日時の順に並べた一覧で、行ごとに最後に更新した人を表示する（`apps/app/src/server/models/page.ts` の `findRecentUpdatedPages`、`Sidebar/RecentChanges/`）。
- 初期設定では、他の人の非公開ページのタイトルも一覧に出す（`security:list-policy:hideRestrictedByOwner` / `hideRestrictedByGroup` が false）。
- ページ履歴（`client/components/PageHistory/`）は、リビジョンごとに作者・日時・最新の印を出す。古い版に戻す操作は無い。
- アプリ内通知は対象ごとにまとめられ、新しい対象の種類を足せる（`PageBulkExportJob` が前例）。
- GROWI では、ページを見られる人はそのページを編集できる。

## Desired Outcome

- 反映済みの Change Proposal を、他のユーザーも1つの単位として認識できる。
- 1ページを読んでいる人が、同じ Change Proposal で変わった他のページに気付ける。
- 他のユーザーが、自分が見られるページの分の操作を戻せる。全部は戻せないときは、本人に戻すよう頼める。
- これらの画面から、見る人が閲覧できないページの存在が分からない。

## Approach

- **Change Proposal の詳細ページ**
  - 依頼した人、入口（AI チャット／Vault／MCP）、モデル、反映日時を表示する
  - 操作ごとに、ページ、差分（既存の差分表示を使う）、状態（戻せる／他の人が編集済みで戻せない／取り消し済み）を表示する
  - 「戻せるものを全部戻す」ボタンを置く
  - 見る人が閲覧できるページの操作だけを表示し、全体の件数は出さない
  - AI が書いた要約や会話は本人にだけ表示する
- **ページ履歴**: Change Proposal で作られたリビジョンに印と詳細ページへのリンクを付ける。取り消しで作られたリビジョンには「取り消し」の印を付ける。
- **Recent Changes**
  - 一覧の取得はそのままにする
  - 取得した後で、各ページの今のリビジョンに `proposalId` があるかを一度にまとめて調べ、印を付ける
  - 印は、見る人が実際に閲覧できる行にだけ付ける（一覧の方針で表示しているだけの行には付けない）
  - 人が編集すると、そのページの印は消える
- **ページの見出し**: 今の版が Change Proposal で作られたときは、作者の横に印を出す。
- **Change Proposal の一覧**: 自分の Change Proposal の一覧と、自分が見られるページを含む反映済みの Change Proposal の一覧を作り、Recent Changes から行けるようにする。
- **取り消しの操作**
  - 本人は全体を戻せる
  - 他の人（管理者も含む）は、自分が見られるページの操作を戻せる
  - 見えない操作があることを理由に断らない
  - 「本人に戻すよう頼む」通知を、一言を添えて送れる
  - 戻せるかどうかの判定は `change-proposal-core` に任せ、この spec は結果を表示する
- **通知**: Change Proposal ごとにまとめたアプリ内通知を表示する。中身は `change-proposal-core` が作る。

## Scope

- **In**:
  - 詳細ページ、Change Proposal の一覧
  - ページ履歴・Recent Changes・ページの見出しの印
  - 取り消しのボタンと「本人に戻すよう頼む」通知
  - まとめたアプリ内通知の表示
  - 5 言語の文言
- **Out**:
  - 戻せるかどうかの判定と取り消しの実行 → `change-proposal-core`
  - チャット画面での表示・承認 → `change-proposal-ai-agent`
  - Recent Changes を Change Proposal 単位でまとめ直すこと（将来）
  - 承認待ちの Change Proposal を本人以外に見せること（将来）
  - Change Proposal へのコメントや話し合い
  - ページ履歴の一般的な「この版に戻す」ボタン

## Boundary Candidates

- 詳細ページと一覧（見る人ごとの絞り込みを含む）
- 既存の画面への印（ページ履歴、Recent Changes、ページの見出し）
- 取り消しの操作と頼む通知

## Out of Boundary

- 見る人ごとの絞り込みの判定そのものは、既存の閲覧の判定（`findByIdsAndViewer` など）を使う。新しい判定を作らない。
- Recent Changes の取得処理とページ送りは変えない。

## Upstream / Downstream

- **Upstream**:
  - `change-proposal-core`（取得・取り消しの API、`proposalId` の記録、まとめた通知）
  - 既存の差分表示（`RevisionDiff`）
  - ページ履歴と Recent Changes の画面
- **Downstream**:
  - 将来の Vault の push、`change-proposal-mcp` から来た Change Proposal も同じ画面で表示する

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**:
  - `revision-diff-api`（差分の取得、見る人ごとの絞り込みの前例）
  - `activity-log-snapshot-viewer`（変更の記録の表示）
  - `news-inappnotification`（アプリ内通知）

## Constraints

- 見えないページについて、件数・「ほかにある」の表示・リンクを知る人だけが見られるページの一覧への掲載・エラーの違いのどれでも、存在を分からせない。
- Vault から来た Change Proposal でも、Vault がファイル名に付ける接尾辞（`__hash8`、`_orphaned/`）を画面に出さない。常にページのパスで表示する。
- 最初に確かめること: Recent Changes の取得後に今のリビジョンの `proposalId` を調べる処理が、一覧の表示を遅くしないか。
