# Requirements Document

## Project Description (Input)

GROWI の Activity（Mongoose モデル `apps/app/src/server/models/activity.ts`、collection `activities`）を Prisma 拡張へ移行する。GROWI は Mongoose→Prisma を1モデルずつ漸進移行中で、comments / users / external-account が移行済み。`mongoose-to-prisma` スキル（`.claude/skills/mongoose-to-prisma/SKILL.md`）の確立パターンに従う。

### (a) 誰が困っているか
- activity log を保守・拡張する GROWI 開発者。Activity だけ Mongoose のままで、他の移行済みモデルと書き方が混在している。
- 別スペック `activity-log`（snapshot の action ベース判別可能ユニオン化＋添付削除ログ）の実装者。activity-log は移行後の Prisma activities モデル上で実装される設計になっており、本移行が完了しないと着手できない（ハードブロッカー）。移行未完のまま実装すると、Mongoose の strict な `snapshotSchema`（`username` のみ宣言）が新フィールドを保存時に黙って捨て、「型は通るが保存されない」無言の失敗に陥る。

### (b) 現状（activity-log の設計フェーズ調査で判明）
- `activities` モデルと `ActivitiesSnapshot` composite type は既に `apps/app/prisma/schema.prisma`（`model activities` 50-71行、`type ActivitiesSnapshot` 16-19行）に introspect 済みで存在する。ただしアプリ側はまだ Mongoose statics を使用しており、Prisma 拡張（`Prisma.defineExtension`）は未作成。
- Prisma クライアントは `apps/app/src/utils/prisma.ts` の `createPrisma()` が拡張をチェーンしている（CommentExtension / ExternalAccountExtension / UserExtension）。移行では ActivityExtension を追加して `.$extends` する。
- 消費者は 15+ ファイルに及ぶ。

### (c) どう変えたいか
- Activity の Mongoose statics を Prisma 拡張へ置き換え、全消費者を Prisma 経由に移行する。**挙動は変えない純粋な移行**に徹する（API レスポンス shape・後方互換を保つ）。

### 移行対象（消費者マップ）
- **置換が必要な Mongoose statics**: `createByParameters`、`updateByParameters`、`findSnapshotUsernamesByUsernameRegexWithTotalCount`、`getActionUsersFromActivities`。
- **読み取り**: `paginate`（`apiv3/activity.ts`、mongoose-paginate-v2 → `utils/prisma` の paginate ヘルパ）、`findOne` / `findById`（`service/activity.ts`、`service/activity/update-activity-logic.ts`、contribution-migration）。
- **集計・ストリーム（複雑、raw 化が必要な可能性）**: `aggregate`（`apiv3/user-activities.ts`、contribution-graph の `activity-aggregation-service`）、`find().sort().cursor()`（audit-log-bulk-export の CSV ストリーム出力 `exportAuditLogsToFsAsync`）。
- **主要な書き込み起点**: `addActivity` middleware（`Activity.createByParameters`）、`activityEvent.on('update')` ハンドラ（`updateByParameters`）と 40+ 箇所の emit、page service の `createByParameters`。
- **そのほか**: `countDocuments` / `deleteMany`（cron・テスト）、TTL index（`createTtlIndex`、`createIndexes`）。

### 移行時の注意点（mongoose-to-prisma スキル準拠）
- Mongoose schema 本体は collection / index 作成のため全モデル移行完了まで残す（`prisma db push` は使わない）。TTL index は raw 作成のまま維持する。
- `_id` / `__v` は `createPrisma()` の computed field で後方互換。`__v` は Prisma では全 update で increment する挙動差があるため、activity update 経路（UNSETTLED→settled）で許容できるか確認する。
- polymorphic な `target`（Mongoose の `refPath: 'targetModel'`）は Prisma では緩い `target String? @db.ObjectId` ＋ `targetModel String?`（リレーション強制なし）。この緩さは `activity-log` 側で `target=添付の_id`・`targetModel='Attachment'` を使う前提なので維持する。
- 複合 unique index `@@unique([userId, target, action, createdAt])` は変更しない。
- フロントエンドは変更しない。API のレスポンス shape は後方互換を保つ（`snapshot` / `user` 等のフィールド名）。

### スコープ外
- `activity-log` 側の機能（snapshot の判別可能ユニオン型・添付削除ログ）。本スペックは挙動を変えない純粋な移行に徹し、機能追加は行わない。

### 依存関係
- 後続スペック `activity-log` の前提条件（ハードブロッカー）。本移行の完了＝「`apiv3/activity.ts` の paginate・`service/activity.ts` の create/update が Prisma 拡張経由になっており、`models/activity.ts` の Mongoose statics に依存していないこと」を、activity-log 着手のゲートとする。

## Introduction

このドキュメントは、GROWI の Activity モデル（collection `activities`）を Mongoose から Prisma へ移行する際に満たすべき要件を定義する。GROWI は Mongoose→Prisma を1モデルずつ漸進移行する方針であり、本スペックはその一環として Activity を移行する。**挙動を変えない純粋な移行**に徹し、監査ログの記録・参照・集計・エクスポート・保持といった観察可能な機能を移行前後で同一に保つことを最重要とする。本移行は後続スペック `activity-log` の前提条件（ハードブロッカー）であり、その着手ゲートとして「移行の完了基準」を明確にする。

## Boundary Context

- **In scope**:
  - Activity の永続アクセス（記録・参照・集計・エクスポート・保持）を Prisma 経由へ移行する。
  - 全消費者コードを Prisma 経由のアクセスに切り替える。
  - 移行前後で観察可能な挙動の後方互換を保つ。
- **Out of scope**:
  - `activity-log` スペックの機能追加（snapshot の判別可能ユニオン型・添付削除ログ）。本移行は機能を増やさない。
  - Mongoose schema 本体および collection／インデックス作成の仕組みの撤去（全モデルの移行完了まで残す）。
  - フロントエンドの変更。
- **Adjacent expectations**:
  - バージョンキー（`__v`）の増分タイミングが移行前後で変わりうる（移行前は特定の更新操作のみ、移行後は更新ごと）。activity の更新経路でこの差が観察可能な不具合を生まないことを後続フェーズで確認する。
  - 後続スペック `activity-log` は本移行の完了を前提とし、`target`／`targetModel` がリレーション整合性を強制しない緩い参照であることを流用する。本移行はこの緩さを保持する。

## Requirements

### Requirement 1: Activity 記録の挙動保持

**Objective**: GROWI 開発者として、移行後も activity の記録が移行前と同じ条件・同じ内容で行われることを保証したい。監査ログの信頼性を移行で損なわないため。

#### Acceptance Criteria
1. When GROWI が監査対象の操作を記録する際, the Activity サブシステム shall 移行前と同じフィールド（操作者・IP・エンドポイント・action・target・targetModel・snapshot・作成日時）を持つ activity を記録する。
2. When 操作の確定後に activity の内容が更新される際, the Activity サブシステム shall 移行前と同じ記録可否判定に基づいて action・snapshot 等を更新する。
3. While 記録対象外として設定された action が指定されている場合, the Activity サブシステム shall 移行前と同じく activity を記録・更新しない。
4. The Activity サブシステム shall 移行前に記録されていた全 action 種別を、移行後も同じ判定で記録できる。

### Requirement 2: Activity 参照・一覧の挙動保持

**Objective**: GROWI 管理者として、移行後も監査ログ画面の一覧・ページネーション・フィルタが従来どおり動くことを期待する。監査・コンプライアンス業務を中断させないため。

#### Acceptance Criteria
1. When 管理者が監査ログ一覧を取得した際, the Activity サブシステム shall 移行前と同じ件数・並び順・ページ情報を持つページネーション結果を返す。
2. When 管理者が操作者・日付・action でフィルタした際, the Activity サブシステム shall 移行前と同じ絞り込み結果を返す。
3. The Activity サブシステム shall API レスポンスのフィールド構造（`snapshot`・`user` 等の名称と形）を移行前と同一に保ち、フロントエンドの変更を不要にする。

### Requirement 3: 集計・エクスポート機能の挙動保持

**Objective**: GROWI 管理者として、移行後も貢献度集計・ユーザー別アクティビティ・監査ログのエクスポートが従来どおり得られることを期待する。

#### Acceptance Criteria
1. When 貢献度グラフがアクティビティ集計を要求した際, the Activity サブシステム shall 移行前と同じ集計結果を返す。
2. When ユーザー別アクティビティ表示が集計を要求した際, the Activity サブシステム shall 移行前と同じ集計結果を返す。
3. When 監査ログのバルクエクスポートが実行された際, the Activity サブシステム shall 移行前と同じ内容・順序で全 activity を出力する。
4. When ユーザー名補完が操作者名の検索を要求した際, the Activity サブシステム shall 移行前と同じ候補一覧と総件数を返す。

### Requirement 4: 保持・一意制約・インデックスの維持

**Objective**: GROWI 運用者として、移行後も activity の保持期間と重複防止が従来どおり機能することを期待する。

#### Acceptance Criteria
1. The Activity サブシステム shall 移行前と同じ保持期間で期限切れの activity を自動的に削除する。
2. The Activity サブシステム shall 移行前と同じ複合一意制約（操作者・target・action・作成日時）を維持し、重複記録を防ぐ。
3. While 全モデルの Prisma 移行が完了していない間, the Activity サブシステム shall collection とインデックスの作成を既存の仕組みで行い続ける。

### Requirement 5: 移行の完了基準と非破壊性

**Objective**: GROWI 開発者および後続スペック `activity-log` の実装者として、移行が「どこまで終われば完了か」を明確にしたい。`activity-log` 着手のゲートにするため。

#### Acceptance Criteria
1. When 移行が完了した際, the activities を利用するコード shall Prisma クライアント経由で activities にアクセスし、Activity の Mongoose 専用メソッド（記録・更新・一覧・集計などの統計メソッド）に依存しない。
2. The 移行 shall 既存の activity データに対する破壊的なデータ移行を必要としない。
3. The 移行 shall 監査ログの観察可能な挙動（記録内容・一覧・集計・エクスポート・保持）を変更しない。
4. The 移行 shall フロントエンドのコードを変更しない。
5. Where 後続スペック `activity-log` が本移行の完了を確認する場合, the 移行 shall 「activities の記録・更新・一覧取得が Prisma 経由になっており Mongoose 専用メソッドに依存していないこと」を確認可能な状態にする。
