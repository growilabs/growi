# Implementation Plan

- [x] 1. 土台: 応答の型と、条件を Prisma に渡す形
- [x] 1.1 User Activities API の応答の型を追加する
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: 応答の型_

- [x] 1.2 ID を含む条件を、pages への `findRaw` に渡せるようにする
  - _Requirements: 2.1_
  - _Boundary: Prisma に渡す形への変換_

- [x] 2. サーバー側のサービス: 見せてよいページの条件と、3 回の問い合わせ
- [x] 2.1 (P) 閲覧者に見せてよいページの条件を作る
  - _Requirements: 2.1, 2.2, 2.4, 2.5_
  - _Boundary: buildListablePageFilter_
  - _Depends: 1.2_

- [x] 2.2 (P) 3 回の問い合わせを組み立てる純粋関数を作る
  - _Requirements: 1.3, 1.6, 2.3, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4_
  - _Boundary: 問い合わせの組み立て_
  - _Depends: 1.2_

- [x] 2.3 3 回の問い合わせを順に実行して、行と総件数を返す処理を作る
  - _Requirements: 2.1, 2.3, 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4_
  - _Boundary: aggregateUserActivities_
  - _Depends: 1.2, 2.2_

- [x] 2.4 閲覧者ごとに返る履歴を、条件の組み立てと実行をつないで結合テストで確認する
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: buildListablePageFilter, aggregateUserActivities_
  - _Depends: 2.1, 2.3_

- [x] 3. ルートの切り替えと API の文書
- [x] 3.1 ルートを新しいサービスに切り替える
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.6, 3.1, 3.4, 4.5, 4.6_
  - _Boundary: user-activities ルート_
  - _Depends: 1.1, 2.1, 2.3_

- [x] 3.2 使われなくなった古い処理とそのテストを削除する
  - _Requirements: 2.6, 3.1_
  - _Boundary: user-activities ルート, aggregateUserActivities_
  - _Depends: 3.1_

- [x] 3.3 OpenAPI の記述を実際の応答に合わせる
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: user-activities ルート_
  - _Depends: 1.1, 3.1_

- [x] 4. 「最近の活動」画面
- [x] 4.1 画面を、応答の行をそのまま表示する形にする
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - _Boundary: RecentActivity, ActivityListItem_
  - _Depends: 1.1, 3.1_

- [x] 5. 仕上げの確認
- [x] 5.1 使われなくなった型を削除し、全体の検査を通す
  - _Requirements: 2.6, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: 応答の型_
  - _Depends: 3.2, 4.1_

- [x] 5.2 Prisma を通した実際のコードで応答時間を 1 回測る
  - _Requirements: 4.2_
  - _Boundary: aggregateUserActivities_
  - _Depends: 3.1_

## Implementation Notes

- Prisma の `findRaw` / `aggregateRaw` に条件を渡すときの落とし穴（ObjectId の変換、値が `undefined` の条件）は、research.md の「条件を `aggregateRaw` と `findRaw` に渡す形」にまとめた。
- `RawPageFilter` を `findRaw` の `filter` に渡すときは、既存の `aggregateRaw` の呼び出しと同じく `as Prisma.InputJsonObject` が要る。
- サービスの入口の読み込み元は `~/server/service/activity/index` と書く。同じ階層に `service/activity.ts` があり、`~/server/service/activity` と書くとそちらに解決される。
- `aggregateUserActivities` が結果の形の異常で投げるエラーの文言には、行やページの内容（ID、パス）が入ることがある。ルートはこの文言を応答に渡さず、記録だけにする。
- 既存の一覧の条件（`addConditionToFilteringByViewerForList`）の実体は `apps/app/src/server/models/obsolete-page.js` にある。結合テストから既存の一覧を呼ぶときは `test/setup/crowi` の `getInstance()` を使う。
- 結合テストで設定を変えるときは `configManager.updateConfigs(..., { skipPubsub: true })` を使い、終了時に戻す。
- activities には「ユーザー・対象・操作・日時」の一意制約がある。同じ日時の履歴をテストで作るときは、ページか操作の種類を変える。
- 結合テストの履歴の後始末は、テスト専用の `ip` の値で絞って消している。`10.0.0.70`〜`10.0.0.72` は使用済みなので、新しいまとまりを足すときは別の値を使う。
- `build-listable-page-filter.integ.ts` は 800 行の上限に近い。次にこのファイルへテストを足すときは、2 つ目の `describe`（条件の組み立てと実行をつなぐテスト）を別ファイルへ移す。
- 型検査の前に、生成物を作るため `pnpm run pre:styles-bulk-export` を apps/app で 1 回実行する必要がある。apps/app の全テスト（`pnpm run test`）は、生成物が無いと、この機能と無関係の 4 ファイル（`CommentEditor.spec`、`DrawioViewerWithEditButton.spec`、`vault-gateway.integ`、`clone-e2e.integ`）が落ちる。
- 開発サーバーへ直接呼んで確かめるときは、ポート 3000 とは別のポートで、使い捨ての DB（`MONGO_URI` を起動コマンドの行だけで渡し、`ELASTICSEARCH_URI` は空にする）を使って起動する。ユーザーはインストーラー API と登録 API で作り、HTTP でログインしてセッションを得る。終了後は自分が起動したプロセスだけを止め、DB を削除する。
- 本人による 5 分以内の更新は、既存の処理が記録しない。ページの作成以外の行を直接確かめたいときは、別のユーザーが先に更新したページを更新するか、コメントを足す。
