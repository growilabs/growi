# Requirements Document

## Project Description (Input)

この spec は activity log サブシステムの flagship（最も基本的な spec）であり、「**何を記録するか＝記録対象の制御（記録ゲート）**」を担う。加えて、activity log サブシステム全体の関心マップ（どの関心をどの spec が持つか）をここで管理する。詳細な背景・方針は `brief.md` を参照。

### (a) 誰が困っているか
- GROWI.cloud のようなマルチテナントの運用者。監査ログの記録対象を設定（`app:auditLogActionGroupSize`、既定 `Small`）で絞っているつもりでも、対象外 action の行が MongoDB に書き込まれ・溜まり続けるため、書き込み・保管量の負荷になる。

### (b) 現状
- 記録の可否判定そのものは存在する（監査ログ設定＝グループサイズ／追加／除外／essential から記録対象集合を算出し、確定した action がその集合に含まれるかで判定する）。
- **GET 経路**は保存前に判定し、対象外なら行を作らない（要望どおり）。
- **更新系（非 GET）経路**（問題）: middleware が action 判定なしに「未確定（`ACTION_UNSETTLED`）」の仮行を無条件で1件作る。その後、各ルートが確定（settle）イベントを送出して実 action に確定させる。確定時に対象内なら本来の action へ更新、**対象外なら更新されず未確定の仮行が残る**。
- 残った未確定行を明示的に掃除する処理はなく、TTL（既定 30 日）で消えるだけ。
- 根本原因: 実 action は更新系リクエストの処理後半まで確定しないため、行を先に作って後から確定させる二段構えになっている。

### (c) どう変えたいか
- 記録対象外の action を、今後 DB に永続化しない（対象外の残骸行を残さない）。
- 記録対象の判定は既存の単一の情報源を再利用し、判定ルールを二重に定義しない。
- 直し方の候補（書き込み自体を減らす方式 / 確定後に残骸を消す方式）と、確定イベントが送出されないケースの扱いは design で計測・比較して決める（本 spec の要件はどちらの方式でも満たせるよう、観察可能な結末で記述する）。

## Introduction

このドキュメントは、activity log（監査ログ）の**記録ゲート**、すなわち「どの操作を activity レコードとして永続化するか」の制御に関する要件を定義する。目的は、記録対象外の action が更新系（非 GET）経路で DB に残る現状を解消し、記録対象外の操作を今後永続化しないようにすることである。ただし、例外やプロセス中断で記録可否が確定しないまま終わった操作については、「操作が試みられた」という試行記録を fail-safe として残す（記録可否が確定して対象外だった操作とは区別する）。activity log は GROWI 全体（通知・貢献度グラフ・監査／コンプライアンス）で広く使われるため、記録抑制の変更は既存の記録・通知・集計の観察可能な挙動を壊してはならない。

## Boundary Context

- **In scope**:
  - 更新系（非 GET）経路で、記録対象外と確定した action を今後永続化しないようにする。
  - 記録対象の判定に、既存の記録可否判定と同一の単一の情報源（監査ログ設定から算出される記録対象集合）を再利用する。
  - 例外・中断で記録可否が確定しなかった操作について、「試行された」事実（操作者・時刻・エンドポイント・IP）を fail-safe として保持する。
- **Out of scope**:
  - 既に DB に溜まっている未確定／対象外の残骸行の遡及的な掃除・移行（今回は今後分のみ。既存分は TTL 任せ）。
  - action グループの構成変更（どの action がどのグループ／essential に属するか、特定 action の格上げ等）。
  - 管理画面での記録対象トグルの追加。
  - snapshot の型・中身（`activity-log-snapshot` が担当）。
  - 監査ログ画面での表示（`activity-log-snapshot-viewer` が担当）。
  - TTL・保持期間の値そのものの変更。
  - GET 経路の記録挙動の変更（既に対象外を作らない。維持のみ）。
- **Adjacent expectations**:
  - 記録抑制の「方式」は design で決定する。要件上、記録可否が確定して対象外だった操作（emit 済み）は永続化せず（Requirement 1）、確定しないまま終わった操作の試行記録は残す（Requirement 4）。方式の候補は「先に作り、対象外と確定した行だけ削除する」（クラッシュを含め試行記録を残せるが書き込み回数は減らない）か「先に作らず、対象内は確定時に作成・失敗時のみ試行記録を作る」（書き込みを減らせるがクラッシュ時の試行記録は取りこぼしうる）で、書き込み削減度とクラッシュ時の試行記録の網羅度がトレードオフになる。
  - 貢献度グラフ・通知は activity の記録に相乗りしている既存機能である。記録ゲートは「どの行が残るか」を決めるだけで、これらの観察可能な挙動を変えない。
  - 記録された行の表示は `activity-log-snapshot-viewer`、行が持つ snapshot の中身は `activity-log-snapshot` が担当する。

## Requirements

### Requirement 1: 記録対象外の action を永続化しない

**Objective:** GROWI.cloud のようなマルチテナントの運用者として、記録対象外の action が activity レコードとして DB に残らないようにしたい。監査ログ由来の永続的な蓄積（書き込み・保管量。特に MongoDB 負荷）を減らすため。

#### Acceptance Criteria
1. When 更新系（非 GET）リクエストの操作が記録対象外の action として確定した場合, the Activity Log System shall その操作を activity レコードとして永続化しない（対象外の残骸行を残さない）。
2. When 更新系（非 GET）リクエストの操作が記録対象の action として確定した場合, the Activity Log System shall 従来どおりその action の activity レコードを永続化する。
3. The Activity Log System shall GET 経路の既存の記録挙動（記録対象のみ作成）を変更しない。
4. The Activity Log System shall 同一の監査ログ設定に対して、記録対象とする action 集合が既存の記録可否判定と一致するようにし、記録対象ルールを新たに複製・分岐しない。

### Requirement 2: 広く使われる既存の記録挙動の維持

**Objective:** activity log は GROWI 全体（通知・貢献度グラフ・監査／コンプライアンス）で広く使われるため、GROWI 管理者・利用者として、記録抑制の変更で既存の記録・通知・集計が壊れないことを保証したい。

#### Acceptance Criteria
1. The Activity Log System shall essential（通知に必須の）action を、action グループ設定に関わらず常に永続化する。
2. Where `app:auditLogEnabled` が false に設定されている場合, the Activity Log System shall essential action のみを永続化する（既存挙動の維持）。
3. When 記録対象の action が確定した場合, the Activity Log System shall その activity に紐づく既存の通知を従来どおり送出する。
4. The Activity Log System shall 記録対象の action に対する貢献度（contribution）の集計結果を、本変更の前後で変化させない。
5. The Activity Log System shall どの action がどのグループ／essential に属するかの構成を、本変更で変更しない。

### Requirement 3: 記録ゲートの責務分離（凝集度）

**Objective:** activity log を保守する GROWI 開発者として、記録対象の制御ロジックが、本来知らなくてよい他の責務（snapshot の中身、個々のルート固有のデータ、貢献度グラフや通知の内部）に依存しないようにしたい。凝集度を保ち、他機能の変更が記録ゲートへ（またはその逆へ）波及しないようにするため。

#### Acceptance Criteria
1. The Activity Log System shall 記録対象の判定を、対象操作の action 種別（記録可否）のみに基づいて行い、その操作固有のデータ（snapshot の中身・ルート固有のペイロード）に依存しない。
2. The Activity Log System shall 記録ゲートの責務を記録可否の判断に限定し、貢献度グラフや通知の内部詳細に依存しない。
3. When activity log に新しい action や新しい記録経路が将来追加された場合, the Activity Log System shall 記録可否の単一の情報源のみでその可否が決まるようにし、記録ゲート側に action 固有の分岐追加を必要としない。

### Requirement 4: 失敗・中断した操作の試行記録の保持（fail-safe 監査）

**Objective:** 監査・コンプライアンス対応を行う GROWI 管理者として、更新系操作が例外やプロセス中断で記録可否が確定しないまま終わった場合でも、「その操作が試みられた」記録（操作者・時刻・エンドポイント・IP）を監査ログに残したい。失敗・中断した操作を事後に追跡できるようにするため。

#### Acceptance Criteria
1. When 更新系（非 GET）リクエストの操作が、記録可否が確定しないまま（例外・中断などで）終了した場合, the Activity Log System shall その操作の試行記録（操作者・時刻・エンドポイント・IP）を監査ログに保持する。
2. The Activity Log System shall 記録可否が確定しないまま残る試行記録を、記録可否が確定して対象外と判定された操作（Requirement 1 で永続化しないもの）とは区別して扱う。
3. While 記録可否が確定していない試行記録が保持されている場合, the Activity Log System shall それが未確定（どの操作か特定されていない）であることを区別できる形で保持する。
