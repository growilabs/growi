# Requirements Document

## Project Description (Input)

この spec は activity log サブシステムの flagship（最も基本的な spec）であり、「**何を記録するか＝記録対象の制御（記録ゲート）**」を担う。加えて、activity log サブシステム全体の関心マップ（どの関心をどの spec が持つか）をここで管理する。詳細な背景・方針は `brief.md` を参照。

### (a) 誰が困っているか
- GROWI.cloud のようなマルチテナントの運用者。監査ログの記録対象を config `app:auditLogActionGroupSize`（env `AUDIT_LOG_ACTION_GROUP_SIZE`、既定 `Small`）で絞っているつもりでも、対象外 action の行が MongoDB に書き込まれ・溜まり続けるため、書き込み・保管量の負荷になる。

### (b) 現状
- 記録の可否判定そのものは存在する（`ActivityService.shoudUpdateActivity(action)` が `getAvailableActions()`（group size / additional / exclude / essential から算出）で判定）。
- **GET 経路**（`ActivityService.createActivity`）は保存前に判定し、対象外なら行を作らない（要望どおり）。
- **非 GET 経路**（問題）: `add-activity.ts` middleware が action 判定なしに `ACTION_UNSETTLED`（未確定の仮行）を無条件で1件作る。その後ルートが `activityEvent.emit('update', ...)` で実 action に確定（settle）する。settle 時に対象内なら本来の action 名へ更新、**対象外なら更新されず `ACTION_UNSETTLED` のまま残る**。
- 残った `ACTION_UNSETTLED` 行を明示的に掃除する処理はなく、TTL インデックス（既定 30 日）で消えるだけ。
- 根本原因: 実 action はリクエスト処理の後半まで確定しないため、activityId を先に発行して後から確定させる二段構えになっている。

### (c) どう変えたいか
- 記録対象外の action を、今後 DB に永続化しない（対象外の残骸行を作らない／残さない）。
- 記録対象の判定は既存の single source（`getAvailableActions` / `shoudUpdateActivity`）を流用し、二重実装しない。
- 直し方の候補は2案あり、design フェーズで計測・比較して決める:
  - **(A) defer-create**: middleware の無条件事前作成をやめ、action 確定後に対象内のものだけ create する（書き込み回数自体を削減。emit('update') を飛ばす約 25 箇所と activityId 受け渡しの再設計が必要でリスク中）。
  - **(B) delete-at-settle**: 事前作成は残し、対象外と確定した時点で仮行を削除する（局所変更で低リスクだが、write→delete で書き込み回数は減らず、settle が飛ばないケースの残骸は消えない）。

### スコープ
- **In**: 非 GET 経路（`add-activity.ts` middleware ＋ settle リスナー）で、記録対象外の action を今後永続化しないようにする。判定は既存の `getAvailableActions()` / `shoudUpdateActivity()` を single source として流用する。
- **Out**:
  - 既存の `ACTION_UNSETTLED` 残骸行の掃除・migration（今回は今後分のみ。既存分は TTL 任せ）。
  - action グループの中身の変更（どの action がどの group に属するか）、管理 UI の記録対象トグル追加。
  - snapshot データ（`activity-log-snapshot` の責務）、表示 UI（`activity-log-snapshot-viewer` の責務）、TTL・保持期間そのものの変更。

### 関連 spec（activity-log ファミリー）
- **`activity-log`（本 spec / flagship）** — 記録ゲート。サブシステム全体の関心マップも保持（`brief.md` の Appendix 参照）。
- **`activity-log-snapshot`** — snapshot の型付け・添付削除ログ。添付系 action への capture 拡張を継続所有。
- **`activity-log-snapshot-viewer`** — 監査ログ画面での snapshot 表示。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
