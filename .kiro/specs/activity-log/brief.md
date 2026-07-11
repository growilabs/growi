# Brief: activity-log（記録ゲート / flagship）

> この spec は activity log サブシステムの flagship（最も基本的な spec）である。担う責務は「**何を記録するか＝記録対象の制御（記録ゲート）**」。加えて、サブシステム全体の関心マップ（どの関心をどの spec が持つか）をここで管理する。

## Problem

監査ログ（activity log）の記録対象は config `app:auditLogActionGroupSize`（env `AUDIT_LOG_ACTION_GROUP_SIZE`、既定 `Small`）で決まる建付けだが、**非 GET リクエストでは対象外 action でも DB に行が残っている**。マルチテナント（GROWI.cloud）では、リクエストごとに不要な行が書き込まれることが MongoDB の書き込み・保管量の負荷になる。

## Current State

記録の可否判定そのものは既に存在する（`ActivityService.shoudUpdateActivity(action)` が `getAvailableActions()` で判定。`getAvailableActions` は group size / additional / exclude / essential から記録対象集合を算出する。design 参照）。しかし保存経路が2系統あり、非 GET 経路がゲートを通っていない。

- **GET 経路（要望どおり動いている）**: `ActivityService.createActivity` は保存前に判定し、対象外なら行を作らない。page view / search / attachment download / vault / bulk-export cron など。
- **非 GET 経路（問題）**: `add-activity.ts` middleware が **action 判定なしに** `ACTION_UNSETTLED`（まだ何の操作か確定していない仮の行）を無条件で1件作る。その後、各ルートが `activityEvent.emit('update', activityId, parameters)` を飛ばして実 action に確定（settle）する。settle 時に対象内なら本来の action 名へ更新、**対象外なら更新されず `ACTION_UNSETTLED` のまま残る**。
- 残った `ACTION_UNSETTLED` 行を明示的に掃除する処理はない。TTL インデックス（既定 30 日）で消えるだけ。
- 表示 API `apiv3/activity` はフィルタ未指定時に全行を返すため、残骸 `ACTION_UNSETTLED` 行も一覧に混ざりうる。

> なぜ middleware で先に作るか: 実 action はリクエスト処理の後半（emit('update') 時）まで確定しないため、activityId を先に発行して後から確定させる二段構えになっている。これが「対象外でも行が残る」構造の根本原因。

## Desired Outcome

- 記録対象外の action は、今後 DB に永続化されない（対象外の残骸行を作らない／残さない）。
- GROWI.cloud のようなマルチテナントで、監査ログ由来の MongoDB 書き込み・保管量が減る。
- 記録対象の判定は既存の single source（`getAvailableActions` / `shoudUpdateActivity`）を流用し、二重実装しない。

## Approach

直し方の候補は2つ。**どちらを採るかは `/kiro-spec-design` で計測・比較して決める**（負荷への効き方が異なるため、ここでは確定しない）。

- **(A) defer-create（書き込み自体を減らす）**: middleware の無条件事前作成をやめ、action 確定後（settle 時）に対象内のものだけ create する。書き込み回数そのものが減るので負荷軽減の狙いに最も合う。ただし emit('update') を飛ばす約 25 箇所と、middleware→settle 間の activityId 受け渡しを作り直す必要があり、リスクは中。
- **(B) delete-at-settle（残骸を消す）**: 事前作成は残し、対象外と確定した時点で仮行を削除する。変更は settle リスナー周辺に閉じて低リスク。ただし write→delete なので書き込み回数自体は減らず、settle が飛ばないケースの残骸は消えない。

いずれの案でも、settle が起きないケース（ルートが emit しない／例外）では `ACTION_UNSETTLED` が必ず残りうるため、その扱いを設計で明示する。

## Scope

- **In**:
  - 非 GET 経路（`add-activity.ts` middleware ＋ settle リスナー）で、記録対象外の action を今後永続化しないようにする。
  - 判定は既存の `getAvailableActions()` / `shoudUpdateActivity()` を single source として流用する。
- **Out**:
  - 既に DB に溜まっている `ACTION_UNSETTLED` 残骸行の掃除・migration（今回は今後分のみ対象。既存分は TTL 任せ）。
  - action グループの中身の変更（どの action がどの group に属するか、`ACTION_ATTACHMENT_REMOVE` の格上げ等）。
  - 管理 UI での記録対象トグル追加。
  - snapshot データ（`activity-log-snapshot` の責務）。
  - 表示 UI（`activity-log-snapshot-viewer` の責務）。
  - TTL・保持期間そのものの変更。

## Boundary Candidates

- middleware の事前作成ポリシー（`add-activity.ts`）。
- settle リスナーでの永続化判定（`service/activity.ts` の update リスナー、`shoudUpdate=false` 分岐）。
- 記録対象集合の single source（`getAvailableActions` / `shoudUpdateActivity`）の再利用。

## Out of Boundary

- snapshot の型・capture（`activity-log-snapshot`）。
- 監査ログ画面の表示（`activity-log-snapshot-viewer`）。
- 既存残骸の掃除。

## Upstream / Downstream

- **Upstream**: 既存 `add-activity.ts` middleware、`ActivityService`、`getAvailableActions` / `shoudUpdateActivity`、config `app:auditLogActionGroupSize` / `app:auditLogAdditionalActions` / `app:auditLogExcludeActions`。
- **Downstream**: `activity-log-snapshot-viewer`（記録された行を表示する。直接の実装依存はないが、記録される行の集合がゲート挙動で変わる）。

## Existing Spec Touchpoints

- **Adjacent**: `activity-log-snapshot`。同じ Activity 記録経路を共有する。snapshot の capture は「記録対象なら保存される」前提（design に「`createActivity` 内部で `shoudUpdateActivity` ゲートを通す」と記述あり）。ゲート挙動を変える際、snapshot 側の記録可否の前提を壊さないよう整合を取る。

## Constraints

- `shoudUpdateActivity` は綴りが typo だが公開 I/F（既存の呼び出し・テストが多数）。安易に改名しない。
- settle が飛ばないケースは必ず残るので、掃除・抑制ロジックを settle 経路だけに置くと取りこぼす。
- TDD 前提: テスト先行（red→green）。結合試験では記録対象内／対象外の設定を **明示的に注入**する（`process.env` を直接書き換えない）。テスト分離は per-worker で行う。
- 関連テスト: `activity.spec.ts` / `activity-extension.spec.ts` / `build-activity-list-where.spec.ts` / `service/page/*-cascade-activity.integ.ts`。

---

## Appendix: activity log サブシステム 関心マップ

flagship としてサブシステム全体の関心をここで一覧する（旧 `activity-log`（現 `activity-log-snapshot`）requirements にあった「用意するセクション（snapshot 以外は TBD）」の一覧をここへ移設）。

| 関心 | 担当 spec | 状態 |
|---|---|---|
| 何を記録するか（記録ゲート／action グループ制御） | **`activity-log`（本 spec）** | 本 brief で着手 |
| snapshot の型付け・添付削除ログ・添付系 action（ADD/DOWNLOAD）への capture 拡張 | `activity-log-snapshot` | 実装済み（REMOVE: PR #11393 / ADD・DOWNLOAD: PR #11433） |
| 監査ログ画面での snapshot 表示（生表示＋添付系整形。旧「対象」列） | `activity-log-snapshot-viewer` | 新規 |
| `target × targetModel` の全面的型安全化 | 未割当（将来課題） | TBD |
| 保持期間・TTL | 未割当（将来課題） | TBD |
| 大量カスケード削除時のボリューム制御・スロットリング | 未割当（将来課題） | TBD |

### 配置ポリシー: snapshot 実装の置き場所（2026-07-11 合意）

snapshot 保存に対応する action が増えるにつれ、`server/service/activity/` に各ドメインの関心事（凍結対象モデルの知識）が集まり肥大化する。これを防ぐため、snapshot 実装は次の3層で置き場所を分ける。

- **判別ユニオンの型・type guard**（`ISnapshot`・variant 型・`isAttachment*Activity` 等）→ `interfaces/activity.ts` に置く。「監査ログが何を凍結するか」の閉じた横断契約であり、監査ログ API と viewer（client 側）が narrowing に使うため、中央での一覧性を優先する。variant 型を各ドメインへ散らすと共有ハブ→ドメインの依存逆流が起きるので行わない。
- **builder / resolver / recorder（処理）** → 凍結対象ドメインが所有する。処理側にはドメイン固有の知識（例: 添付の Mongoose `page` 参照 → `pageId` の読み替え）が集まるため。feature ディレクトリの家があるドメインは `features/{foo}/` 内に、legacy ドメインはそのドメインのサービス隣（例: 添付は `server/service/attachment/`）に置く。ドメインが feature 構造へ移行するときは snapshot 実装も一緒に動かす（snapshot だけ先に features へ送る分断はしない）。
- **記録の機構**（記録ゲート・settle・failsafe・保存口）→ `server/service/activity/` に置く。このディレクトリはドメイン固有の内容物を持たず、snapshot をデータとして受け取るだけの機構に収束させる。

適用第1号: 添付 snapshot モジュール（`attachment-snapshot.ts` / `attachment-removal-snapshot.ts`）を `service/activity/` から `service/attachment/` へ移動（`activity-log-snapshot` spec のタスク14・挙動不変 refactor）。
