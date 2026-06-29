# Requirements Document

## Project Description (Input)

この spec は、GROWI の activity log（監査ログ／操作履歴）サブシステムを今後メンテナンス・拡張する際に参照するための情報をまとめたものである。activity log 全体を対象とするが、今回は構成要素のうち **snapshot** を詳しく記述し、その他の要素はセクションだけ用意して現時点でわかっていることを記し、詳細は TBD（To Be Done）とする。

### (a) 誰が困っているか
- activity log を保守・拡張する GROWI の開発者。snapshot の型・設計がコードに散らばっていてドキュメント化されておらず、改修のたびにモデル・サービス・画面のコードを読み直す必要がある。
- 直近の利用者課題として、管理者が監査ログ画面で「どのページのどの添付ファイルが削除されたか」を追えない。

### (b) 現状
- Activity モデルの `target` は `refPath: 'targetModel'` による polymorphic 参照で、`targetModel` は Page / User / PageBulkExportJob / AuditLogBulkExportJob の 4 種。
- `snapshot` は現状 `{ username?: string }` のみの型付きサブスキーマで、削除済みユーザーでも操作者名を残す用途に使われている。
- 添付ファイルの直接削除（`/_api/attachments.remove`）は `addActivity` middleware ＋ `activityEvent.emit('update', ..., { action: ACTION_ATTACHMENT_REMOVE })` で「誰が消したか」は記録されるが、`target` / `snapshot` を渡していないため対象（ページ・ファイル）が残らない。
- `ACTION_ATTACHMENT_REMOVE` は MediumActionGroup 以上にのみ含まれ、既定の Small では記録されない。記録対象の制御は環境変数のみ（`AUDIT_LOG_ACTION_GROUP_SIZE` / `AUDIT_LOG_ADDITIONAL_ACTIONS`）で、管理 UI のトグルはない。
- 監査ログ画面のテーブルは user / date / action / ip / endpoint のみで「対象」列がない。

### (c) どう変えたいか（今回の焦点 = snapshot）
- **snapshot を詳述する。** snapshot の形は「対象のモデル（targetModel）」ではなく「**action 種別**」で決まる、という設計方針を文書化する（同じ Page でも RENAME と DELETE で必要な凍結データが異なるため）。型としては action で絞り込める判別可能ユニオン（特別な snapshot を持つ action だけ列挙し、残りは共通の `{ username? }` に畳む catch-all）を採用する。`snapshotTargetModel` のような別フィールドは追加しない（判別子は既存の必須フィールド `action` を流用する）。
- 最初の適用例として、添付ファイル削除時に削除直前の情報（originalName, pagePath, pageId, fileSize など）を snapshot に残し、管理画面の監査ログで参照できるようにする。
- 削除のカスケード連動（ページ完全削除・ゴミ箱を空にする操作で消える添付）も記録対象とする。

### スコープ（合意済み）
- **(a) を採用**：今回の対象は **snapshot の型付け（action ベースの判別可能ユニオン）＋ 添付削除ログ** のみとする。
- `target × targetModel` の全面的な型安全化（discriminated union 化）は別 PR に切り出す。本 spec では「型安全化」セクションに方針メモのみ残し、詳細は TBD とする。

### この spec に用意するセクション（snapshot 以外は TBD で軽く）
- snapshot 設計 — **詳述**
- target / targetModel の型安全化 — TBD（方針のみ）
- action / action グループと記録対象の制御 — TBD
- 監査ログ画面の表示（「対象」列の追加方針） — TBD
- 保持期間・TTL、大量カスケード削除時のボリューム — TBD

## Introduction

このドキュメントは、GROWI の activity log（監査ログ・操作履歴）サブシステムにおける snapshot 設計の形式化と添付ファイル削除ログの改善に関する要件を定義する。snapshot の型を action 種別に基づいた判別可能ユニオンとして形式化し、添付ファイル削除時に削除直前の情報を snapshot に記録することで、管理者が「誰がどのファイルをいつ削除したか」を監査ログで追跡できるようにすることと、GROWI 開発者が snapshot の型を action 種別ごとに安全に扱えるようにすることを目的とする。

## Boundary Context

- **In scope**:
  - snapshot 型の action ベース判別可能ユニオン化
  - 直接削除（添付ファイル削除 API）時の添付ファイル情報の snapshot 記録
  - ページ完全削除・ゴミ箱を空にする操作のカスケードで消える添付ファイルの activity 記録と snapshot
- **Out of scope**:
  - `target × targetModel` フィールドの全面的な型安全化（別 PR で実施）
  - action グループの設定変更（`ACTION_ATTACHMENT_REMOVE` を Small グループへ格上げすることや、管理 UI でのトグル追加）
  - 監査ログ画面への「対象」列の詳細 UI 実装（本 spec では方針のみ; 詳細は TBD）
  - 保持期間・TTL の変更
  - 大量カスケード削除時のボリューム制御・スロットリング
- **Adjacent expectations**:
  - `ACTION_ATTACHMENT_REMOVE` は現在 MediumActionGroup 以上でのみ記録される（デフォルトは Small）。本機能で追加される snapshot データが実際に保存されるかどうかは、`AUDIT_LOG_ACTION_GROUP_SIZE` または `AUDIT_LOG_ADDITIONAL_ACTIONS` 環境変数の設定に依存する。この設定変更は本 spec のスコープ外。
  - 記録した snapshot データは、将来の監査ログ画面拡張（「対象」列の追加など）で参照できる構造で保存されなければならない。

## Requirements

### Requirement 1: Snapshot 型の action ベース判別可能ユニオン化

**Objective**: GROWI 開発者として、snapshot の型が action 種別ごとに明確に定義されていることを知りたい。改修のたびにモデル・サービス・画面のコードを読み直す必要をなくし、型安全に snapshot を操作できるようにするため。

#### Acceptance Criteria
1. The Activity Log System shall define the snapshot type as a discriminated union keyed by the `action` field, not by the `targetModel` field.
2. When an action has snapshot fields specific to that action (e.g., 添付ファイル削除に特有のファイル情報フィールド), the Activity Log System shall represent that action's snapshot as a named variant in the discriminated union.
3. The Activity Log System shall include a catch-all variant in the union that preserves the existing `{ username?: string }` shape for all actions not explicitly listed, maintaining backward compatibility with existing activity data.
4. The Activity Log System shall use the existing `action` field as the sole discriminant for the snapshot union, without adding a new field (e.g., `snapshotTargetModel`) to the activity record.

### Requirement 2: 添付ファイル直接削除時の snapshot 記録

**Objective**: GROWI 管理者として、監査ログで「どのページのどの添付ファイルが削除されたか」を追跡したい。削除された対象ファイルを事後に特定できるようにするため。

#### Acceptance Criteria
1. When ユーザーが添付ファイル削除 API を通じて単個の添付ファイルを削除した場合, the Activity Log System shall 削除直前の時点で次のフィールドを snapshot に記録する：元のファイル名（`originalName`）、添付ファイルが属するページのパス（`pagePath`）、そのページの ID（`pageId`）、ファイルサイズ（`fileSize`）。
2. When 添付ファイルの直接削除 activity を記録する際, the Activity Log System shall 既存の動作と同様に操作者の username を snapshot に含める。
3. If snapshot データの取得時点で添付ファイルのレコードが既に存在しない場合, the Activity Log System shall 取得できたフィールドのみで activity を記録し、警告レベルのログを出力する。

### Requirement 3: カスケード削除時の添付ファイル activity 記録

**Objective**: GROWI 管理者として、ページの完全削除やゴミ箱の空操作に伴って削除される添付ファイルを監査ログで追跡したい。ページ削除操作に含まれた個々の添付ファイルを事後に特定できるようにするため。

#### Acceptance Criteria
1. When ページが完全削除（削除後に復元できない操作）され、その添付ファイルがカスケードで削除される場合, the Activity Log System shall 削除される各添付ファイルに対して `ACTION_ATTACHMENT_REMOVE` の activity を個別に作成し、snapshot を記録する。
2. When ゴミ箱を空にする操作により添付ファイルがカスケードで削除される場合, the Activity Log System shall 削除される各添付ファイルに対して `ACTION_ATTACHMENT_REMOVE` の activity を個別に作成し、snapshot を記録する。
3. When カスケード削除の添付 activity を記録する際, the Activity Log System shall 直接削除と同じ snapshot フィールドを記録する：`originalName`、`pagePath`、`pageId`、`fileSize`。
4. While カスケード削除処理が進行中の場合, the Activity Log System shall 各添付ファイルが実際のストレージから削除される前に snapshot データを取得する。

### Requirement 4: 監査ログ API での snapshot データ参照

**Objective**: GROWI 管理者として、監査ログの管理画面または API を通じて添付ファイル削除の詳細情報（削除されたファイル名・所属ページ）を参照したい。監査・コンプライアンス対応のため。

#### Acceptance Criteria
1. When 管理者が `ACTION_ATTACHMENT_REMOVE` の activity レコードを監査ログ API 経由で取得した場合, the Activity Log System shall 応答に添付ファイルの snapshot フィールド（`originalName`、`pagePath`、`pageId`、`fileSize`）を含める。
2. The Activity Log System shall 既存の activity レコードの構造に後方互換な形式で snapshot を保存し、既存データの破壊的な移行を必要としない。
