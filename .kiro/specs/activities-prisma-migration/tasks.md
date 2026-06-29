# Implementation Plan

> 移行方針: 確定2（構造=Option C／順序=Option B）。フェーズ1（読み書き＋一覧 paginate）で `activity-log` のハードブロッカー解除ゲート（記録・更新・一覧が Prisma 経由）を満たし、フェーズ2（集計×2・CSV cursor・autocomplete）で要件5 を完成させる。**挙動を変えない純粋な移行**に徹する。
>
> スパイク（1.1 / 1.2 / 5.1）は使い捨て検証であり、成果物は「記録された判断（採用する実装方式）」とする。本実装はその判断に従う。

## フェーズ1: 読み書きを Prisma 経由へ（ゲート達成）

- [ ] 1. 基盤整備: schema・共有 paginate・先行スパイク
- [ ] 1.1 (P) R1 先行スパイク（一覧フィルタ実装前の blocking spike）
  - composite type `snapshot.username` への `where` 絞り込み（`snapshot: { is: { username: { in: [...] } } }` 形）が introspect 済み型で実 DB に対し意図通り効くかを、10〜20 行の使い捨てスクリプトで検証する
  - 観察可能な完了状態: 「(a) native composite filter を採用 / (b) `aggregateRaw` 生クエリへフォールバック」のいずれかを判断として記録し、タスク 3.5・6.4 の実装方式を確定させる
  - _Requirements: 2.2, 3.4_
  - _Boundary: spike（utils/prisma 検証）_
  - _Blocked: 実 MongoDB が必要。本リモート環境は egress ポリシーが mongod バイナリ DL を 403 ブロックするため実行不可。MongoDB が使える環境（devcontainer/CI）で実施。依存実装(3.5)は design 第一候補（native composite filter `snapshot:{is:{username:{in}}}`）で進め、tsgo 型チェック＋CI integ で検証する。_

- [ ] 1.2 (P) R4 先行スパイク（明示 `_id` の受理確認）
  - `create` / `createMany` が明示 `_id`（ObjectId 文字列）を受け付けるかを使い捨てスクリプトで検証する（integ テストが明示 `_id` を使うための前提）
  - 観察可能な完了状態: 「明示 `_id` 指定が可能/不可」を判断として記録し、フェーズ1・2 の integ テストの fixture 方式を確定させる
  - _Requirements: 5.2, 5.3_
  - _Boundary: spike（integ テスト前提）_
  - _Blocked: 実 MongoDB が必要（同上）。CI integ で明示 `_id` 利用の fixture が通るかを検証する。_

- [x] 1.3 schema.prisma の relation 明示と型再生成
  - `model activities` の `user` リレーションに `onDelete: NoAction, onUpdate: NoAction` を明示（mongoose-to-prisma スキル準拠。Mongoose に整合性強制が無いため）
  - フィールド追加・index 変更はしない（複合 unique `@@unique` は不変）。`pnpm prisma generate` で型を再生成
  - 観察可能な完了状態: 再生成後の Prisma クライアント型に `activities.user` リレーションが存在し、型エラーなくビルドできる
  - _Requirements: 5.2_

- [x] 1.4 共有 paginate を offset 入力へ統一
  - `utils/prisma.ts` の `paginate` 入力を offset 一本化（`skip = offset`、`page` 入力廃止）。出力は page 系フィールドを内部計算で保持し、`offset` を必ず含める。`page`/`pagingCounter`/`hasPrevPage`/`prevPage` を mongoose-paginate-v2 互換式（`page===1 && offset!==0` のとき `hasPrevPage=true, prevPage=1`）で導出
  - `PaginateResult<T>` を `interfaces/mongoose-utils.ts` の shape（`offset: number` 含む）に揃える
  - 観察可能な完了状態: 単体テストで offset 入力→正しい skip、出力に `offset` フィールドが必ず含まれ、`page`/`totalPages`/`hasNextPage` と `page===1 && offset!==0` 時の `hasPrevPage/prevPage` が期待どおりになる
  - _Requirements: 2.1, 2.3_

- [x] 1.5 external-account の offset 追随（共有ヘルパ変更の巻き添え・integration）
  - `external-account.ts` の `findAllWithPagination` を offset 受けに変更し、呼び出し側（`apiv3/users.js` の external-accounts ルート）で `offset=(page-1)*limit` 変換を1箇所入れる
  - 観察可能な完了状態: external-account 一覧の件数・並び順・ページ情報が offset 化前後で不変であることを実 DB の integ 回帰テストでアサートする
  - _Depends: 1.4_
  - _Requirements: 2.1, 2.3, 5.3_
  - _Boundary: ExternalAccount, apiv3/users(external-accounts ルート)_

- [ ] 2. ActivityExtension（薄いアダプタ）の作成と有効化
- [x] 2.1 ActivityExtension の骨格・create・チェーン有効化
  - `models/activity.ts` 末尾に `Prisma.defineExtension` を追加。`result.activities` に `_id`/`__v` alias、`model.activities.createByParameters` を実装
  - **Key Decision 4 をここで確定**: `user`/`target` のオブジェクト→ID 正規化の所在（拡張内で正規化 vs 呼び出し側で ID 化）を決め、以降の消費者タスク（特に 3.3）がこの方針を継承する
  - `utils/prisma.ts` に `.$extends(ActivityExtension)` を追加して有効化
  - 観察可能な完了状態: `prisma.activities.createByParameters(params)` が移行前と同一フィールドの activity を作成し、`_id`/`__v` が読める
  - _Depends: 1.3, 1.4_
  - _Requirements: 1.1, 1.4_

- [x] 2.2 updateByParameters（not-found セマンティクス保持）
  - `model.activities.updateByParameters` を `include: { user: true }` 付きで実装し、戻り値に `userId` と `user` の両方を含める（Key Decision 5）
  - **C1**: Prisma `update` の `P2025` を catch して `null` を返し、現行 `findOneAndUpdate(..., {new:true})` の「対象なし＝null（例外を投げない・作成しない）」挙動を保つ（`upsert` 化はしない）
  - 観察可能な完了状態: 既存 activity を更新すると populated `user` 付きで返り、存在しない id では例外を投げず `null` を返す
  - _Depends: 2.1_
  - _Requirements: 1.2_

- [ ] 3. フェーズ1 消費者の Prisma 化
- [x] 3.1 addActivity middleware の create を拡張経由へ
  - `add-activity.ts` の `Activity.createByParameters` を拡張メソッドへ置換（`user` は `req.user?._id` で ID 寄り）
  - 観察可能な完了状態: 監査対象操作で middleware が Prisma 拡張経由で activity を記録する
  - _Depends: 2.1_
  - _Requirements: 1.1_

- [x] 3.2 service/activity.ts の create/update を拡張経由へ（TTL/index は据え置き）
  - `createActivity`（`createByParameters`）と `activityEvent.on('update')` ハンドラ（`updateByParameters`）を拡張メソッド経由へ。`shoudUpdateActivity` ゲート（記録可否判定）は不変
  - `createTtlIndex`（`createIndexes`＋raw collection）は **Mongoose のまま据え置き**（要件 4-1・4-3）。index 用途の Activity import のみ残す
  - **重複エラー処理（4.2）**: 既存の Mongoose 重複エラー捕捉箇所があれば Prisma `P2002` 捕捉へ置換し、複合 unique 制約違反時の挙動を維持する
  - 観察可能な完了状態: GET 経由の記録と settle 時の更新が Prisma 拡張経由で行われ、記録対象外 action はスキップされ、起動時の TTL index 作成が従来どおり機能する
  - _Depends: 2.1, 2.2_
  - _Requirements: 1.2, 1.3, 4.1, 4.2, 4.3_
  - _Boundary: ActivityService（service/activity.ts）_

- [x] 3.3 page delete 時の記録を拡張経由へ
  - `service/page/index.ts` の `Activity.createByParameters`（page 削除時）を拡張経由へ。`user`/`target` のオブジェクト→ID 正規化は 2.1 で確定した方針に従う
  - 観察可能な完了状態: ページ削除時に Prisma 拡張経由で `target`/`targetModel` を含む activity が記録される
  - _Depends: 2.1_
  - _Requirements: 1.1_

- [x] 3.4 update-activity-logic の findOne を findFirst へ
  - `update-activity-logic.ts` の `findOne({...}).sort()` を `findFirst({where, orderBy})` へ（`$ne`→`{not}`、`$in`→`{in}`、1件取得）
  - 観察可能な完了状態: 直近の content activity 取得が Prisma 経由で移行前と同一の1件を返す
  - _Depends: 2.1_
  - _Requirements: 1.2_

- [x] 3.5 監査ログ一覧 paginate の Prisma 化
  - `apiv3/activity.ts` の `Activity.paginate(query, {offset,...})` を `prisma.activities.paginate({where, orderBy, offset, limit, include:{user:true}})` へ
  - where 変換: `action` 配列→`{in}`、date 範囲、`snapshot.username` 絞り込みは **スパイク 1.1 の判断（native / aggregateRaw フォールバック）に従う**。`populate:'user'`→`include` ＋ レスポンスの `userId`→`user` remap
  - **既存 quirk 維持**: ルートの `offset = req.query.offset || 1` をそのまま維持し、移行後も `offset` が現状どおり（`|| 1` 込み）skip に届く（純粋移行・要件 2.1）
  - 観察可能な完了状態: 一覧 API がフィルタ＋ページネーションで移行前と同一の件数・並び順・レスポンス shape を返す
  - _Depends: 1.1, 1.4, 2.1_
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 4. フェーズ1 検証とゲート確認
- [x] 4.1 フェーズ1 integ テスト（記録・一覧の挙動同一性）
  - 記録: middleware→`activityEvent('update')` で activity が移行前と同じフィールドで確定。記録対象外 action はスキップ
  - 重複防止: 複合 unique（操作者・target・action・作成日時）違反時に重複記録されないことをアサート（要件 4.2）
  - 一覧: フィルタ（action/date/user）＋ページネーションで移行前と同一結果・同一レスポンス shape。**`offset||1` quirk による1ページ目先頭1件スキップが移行後も再現される**ことをアサート（件数の silent な変化を防ぐ）
  - 観察可能な完了状態: 上記 integ テストがすべてグリーン
  - _Depends: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 4.2_

- [x] 4.2 ハードブロッカー解除ゲートの確認
  - `add-activity.ts` / `service/activity.ts` / `apiv3/activity.ts` が `Activity.create/update/paginate`（Mongoose statics）を呼ばないことを grep で機械確認
  - 観察可能な完了状態: 記録・更新・一覧が Prisma 経由であることが grep で確認でき、`activity-log` 着手ゲートを満たす
  - _Depends: 4.1_
  - _Requirements: 5.1, 5.5_

## フェーズ2: 集計・cursor・autocomplete（要件5 完成）

- [ ] 5. フェーズ2 基盤: raw スパイクと正規化ユーティリティ
- [ ] 5.1 R2/R3 先行スパイク（フェーズ2 着手前）
  - 実 pipeline（`$facet`/`$lookup`/`$dateTrunc` 込み）の `aggregateRaw` 戻り値を1件キャプチャし、`$oid`/`$date` の表現と、`cursor`+`take` バッチングのメモリ/順序を実 DB で確認する
  - 観察可能な完了状態: 正規化が必要な BSON 拡張 JSON の形と cursor バッチング方式を判断として記録し、5.2・6.x の実装方式を確定させる
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: spike（aggregateRaw/cursor 検証）_
  - _Blocked: 実 MongoDB が必要（同上）。aggregateRaw の戻り BSON 表現は runtime 依存のため型チェックで代替不可。5.2 normalizer は Prisma/MongoDB の既知の拡張 JSON 仕様（$oid/$date）を前提に実装し、CI integ で実戻り値に対する正規化を検証する。_

- [x] 5.2 prisma-raw-normalize ユーティリティ
  - `aggregateRaw` 戻り値の BSON 拡張 JSON（`$oid`→`string`、`$date`→`Date`）を正規化する pure util を新規作成（co-located spec 付き）。想定外 BSON は明示エラー＋文脈ログ
  - 観察可能な完了状態: 単体テストで `$oid`/`$date` を含む戻りが `string`/`Date` へ正しく正規化される
  - _Depends: 5.1_
  - _Requirements: 3.1, 3.2_

- [ ] 6. フェーズ2 executor 群（pipeline/work-set を引数で受ける pure executor）
- [x] 6.1 (P) ユーザー別アクティビティ集計 executor
  - `$facet`/`$lookup` pipeline を引数で受け `aggregateRaw`→正規化して `{docs, totalCount}` を返す pure executor を新規作成（spec 付き）。`apiv3/user-activities.ts` の `Activity.aggregate` を本 executor 呼び出しへ置換
  - 観察可能な完了状態: 単体テスト（pipeline 注入）で現行 Mongoose 集計と同一の docs/totalCount を返し、API が移行前と同一集計を返す
  - _Depends: 5.2_
  - _Requirements: 3.2_
  - _Boundary: aggregate-user-activities, apiv3/user-activities_

- [ ] 6.2 (P) 貢献度集計 executor
  - `$dateTrunc` 日次集計 pipeline を引数で受ける pure executor を新規作成（spec 付き）。`activity-aggregation-service.ts` の `aggregate` を置換し、`contribution-migration-service.ts` の `findById().select()` を `findUnique({select})` へ
  - 観察可能な完了状態: 単体テスト（pipeline 注入）で現行と同一の日次集計を返し、貢献度グラフが移行前と同一集計を返す
  - _Depends: 5.2_
  - _Requirements: 3.1_
  - _Boundary: aggregate-contributions, contribution-graph services_

- [ ] 6.3 (P) 監査ログ CSV エクスポート cursor executor
  - フィルタ＋batchSize＋prisma を受け `_id` 昇順で `cursor`+`take` バッチを yield する `AsyncIterable` を新規作成（spec 付き）。`exportAuditLogsToFsAsync.ts` の `exists`→`count>0`/`findFirst`、`find().cursor()`→`Readable.from(executor)` で既存 `pipeline` に接続
  - 観察可能な完了状態: executor が `_id` 昇順で全件を同順序出力し、`lastExportedId` resume が成立、一定メモリで動作する
  - _Depends: 5.1_
  - _Requirements: 3.3_
  - _Boundary: activity-export-cursor, audit-log-bulk-export step_

- [ ] 6.4 (P) ユーザー名補完を aggregateRaw 経由へ
  - `findSnapshotUsernamesByUsernameRegexWithTotalCount` を拡張メソッド（`aggregateRaw`）で再実装し、`apiv3/users.js`（autocomplete ルート）の呼び出しを置換。regex は現状の生 `q` を維持（エスケープ改善はスコープ外）
  - 観察可能な完了状態: オートコンプリートが移行前と同一の候補一覧と総件数を返す
  - _Depends: 5.2, 1.1_
  - _Requirements: 3.4_
  - _Boundary: ActivityExtension.findSnapshotUsernames, apiv3/users(autocomplete ルート)_
  - 注: `apiv3/users.js` はタスク 1.5（external-accounts ルート）と同一ファイルを編集するため、フェーズ越え・ファイル単位では並行不可（フェーズ順序で直列化される）

- [ ] 7. フェーズ2 検証・クリーンアップ・最終検証
- [ ] 7.1 フェーズ2 integ テスト
  - 集計: user-activities／contribution が移行前と同一集計（明示 `_id` は ObjectId 保持で維持）。エクスポート: cursor executor が `_id` 昇順で全件を同順序出力し resume が成立。autocomplete: 候補一覧・総件数が同一
  - 観察可能な完了状態: 既存 integ（`update-activity.spec`・`activity-aggregation-service.spec`・`audit-log-...integ`）を含むフェーズ2 テストがすべてグリーン
  - _Depends: 6.1, 6.2, 6.3, 6.4_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 7.2 Mongoose statics の撤去とモデルファイル整理
  - `models/activity.ts` の3 statics（`createByParameters`/`updateByParameters`/`findSnapshotUsernamesByUsernameRegexWithTotalCount`）と Mongoose 専用 interface を撤去。schema 本体・`createTtlIndex` 用の登録は残す。全消費者移行後に `export default` を撤去
  - 観察可能な完了状態: 3 statics が削除されても型チェック・ビルドが通り、schema 登録と TTL index 作成は継続する
  - _Depends: 7.1_
  - _Requirements: 5.1_

- [ ] 7.3 最終検証（完了基準・非破壊性）
  - 全消費者が Prisma 経由で Mongoose 専用メソッドに非依存であることを grep で確認。観察可能挙動（記録・一覧・集計・エクスポート・保持）の回帰、フロントエンド無変更、破壊的データ移行なし（ObjectId 保持・additive）を確認
  - 観察可能な完了状態: ゲート grep が statics 参照ゼロを示し、フェーズ1・2 の全 integ がグリーン、フロントエンドの diff が無い
  - _Depends: 7.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

## Implementation Notes

- **環境制約（本リモート実行環境）**: 外部 `mongo` ホストは未提供。integ テストは `mongodb-memory-server` を使うが、mongod バイナリの DL 先が egress ポリシーで 403 ブロックされ、キャッシュ・システム mongod も無いため **ローカルで integ テストを実行できない**。検証方針:
  - ローカルで実行可能な検証: `pnpm run lint:typecheck`（tsgo）、`pnpm run lint:biome`、`turbo run build --filter @growi/app`、DB 不要の pure ユニットテスト（1.4 paginate、5.2 normalizer 等）。
  - integ テストは**コードとして実装し、実行は CI（GitHub Actions の mongo サービス＝外部 `MONGO_URI`）に委ねる**。ローカルでは型チェックで integ ファイルのコンパイルのみ担保。
  - DB 依存スパイク（1.1/1.2/5.1）は本環境で実行不可のため Blocked。依存実装は design の第一候補方式で進め、型レベルで確認できる範囲（R1/R4 の Prisma 構文サポート）は tsgo で前倒し確認する。
- 前提セットアップ: `@growi/*` ワークスペースパッケージは未ビルドだと vitest が `@growi/logger` 解決に失敗する。`turbo run build --filter='@growi/app^...'` で先にビルド済み（本セッションで実施）。Prisma クライアントは `src/generated/prisma` に生成済み。
- **2.1/2.2 → 3.x への申し送り**: `createByParameters`/`updateByParameters` の `user`/`target` 正規化は拡張内（`normalizeToId`）で行う方針（Key Decision 4）。`updateByParameters` の `parameters` 型は `Prisma.activitiesUncheckedUpdateInput`（design の `Partial<IActivityParameters>` から意図的に変更）。タスク 3.2 で `activityEvent.on('update')` を切り替える際、caller の update payload の `target` がオブジェクトの場合は `normalizeToId` 相当の正規化が必要になりうる点に留意。
