# Requirements Document

## Project Description (Input)

この spec は、GROWI の activity log（監査ログ／操作履歴）サブシステムのうち **snapshot（記録された各 activity が凍結して持つ付随データ）** の型付けと、添付ファイル削除ログを対象とする。activity log サブシステム全体の関心マップ（どの関心をどの spec が持つか）と、記録ゲート・表示・型安全化・TTL などの他要素は flagship の `activity-log` spec が管理する（下記「関連 spec（activity-log ファミリー）」を参照）。

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
- 本 spec の対象は **snapshot の型付け（action ベースの判別可能ユニオン）＋ 添付削除ログ** のみ。
- `target × targetModel` の全面的な型安全化（discriminated union 化）は本 spec のスコープ外（activity-log ファミリーの将来課題。下記参照）。本 spec では `SupportedTargetModel` に `Attachment` を1つ足すのみ。

### 関連 spec（activity-log ファミリー）
activity log サブシステムは責務ごとに次の spec に分割されている。かつてこの spec に「snapshot 以外は TBD セクション」として仮置きしていた要素は、それぞれの spec へ移した。関心マップの管理は flagship `activity-log` が持つ。
- **`activity-log`（flagship / 記録ゲート）** — 「何を記録するか」。action / action グループと記録対象の制御（対象外 action を保存しない）。サブシステム全体の関心マップもここが持つ。
- **`activity-log-snapshot`（本 spec）** — snapshot の型付けと添付削除ログ。添付系 action への snapshot capture 拡張もここが継続して所有する。
- **`activity-log-snapshot-viewer`** — 監査ログ画面での snapshot 表示（生表示＋添付系の整形表示。旧「対象」列の追加方針）。
- 将来課題（未着手・どの spec にも未割当）: `target × targetModel` の全面的型安全化、保持期間・TTL、大量カスケード削除時のボリューム制御。整理先は flagship `activity-log` の関心マップで管理する。

## Introduction

このドキュメントは、GROWI の activity log（監査ログ・操作履歴）サブシステムにおける snapshot 設計の形式化と添付ファイル削除ログの改善に関する要件を定義する。snapshot の型を action 種別に基づいた判別可能ユニオンとして形式化し、添付ファイル削除時に削除直前の情報を snapshot に記録することで、管理者が「誰がどのファイルをいつ削除したか」を監査ログで追跡できるようにすることと、GROWI 開発者が snapshot の型を action 種別ごとに安全に扱えるようにすることを目的とする。

## Boundary Context

- **In scope**:
  - snapshot 型の action ベース判別可能ユニオン化
  - 直接削除（添付ファイル削除 API）時の添付ファイル情報の snapshot 記録
  - ページ完全削除・ゴミ箱を空にする操作のカスケードで消える添付ファイルの activity 記録と snapshot
- **Out of scope**:
  - `target × targetModel` フィールドの全面的な型安全化（activity-log ファミリーの将来課題）
  - action グループの設定変更・記録対象の制御（対象外 action を保存しないなど）は flagship `activity-log` spec が担当
  - 監査ログ画面への「対象」列・snapshot 表示 UI は `activity-log-snapshot-viewer` spec が担当
  - 保持期間・TTL の変更
  - 大量カスケード削除時のボリューム制御・スロットリング
- **Adjacent expectations**:
  - `ACTION_ATTACHMENT_REMOVE` は現在 MediumActionGroup 以上でのみ記録される（デフォルトは Small）。本機能で追加される snapshot データが実際に保存されるかどうかは、`AUDIT_LOG_ACTION_GROUP_SIZE` または `AUDIT_LOG_ADDITIONAL_ACTIONS` の設定（＝`activity-log` spec が扱う記録ゲート）に依存する。
  - 記録した snapshot データは、`activity-log-snapshot-viewer` spec が参照して表示できる後方互換な構造で保存されなければならない。

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

---

## 増分（2026-07-10）: 添付系 action 全般への snapshot capture 拡張

> **この増分の位置づけ**: 要件 1〜4（添付ファイル削除 `ACTION_ATTACHMENT_REMOVE` の snapshot capture）は実装完了済み（PR #11393。型・ビルダー・直接削除／カスケード統合・API 素通し・結合テストまで green）。本増分は**その実装を作り直さず**、同じ流儀で残りの添付系 action へ snapshot capture を広げる。
>
> **対象 action の全体像**: 添付カテゴリ（`SupportedActionCategory.ATTACHMENT`、action 名の接頭辞 `ATTACHMENT_`）に属する action は `ACTION_ATTACHMENT_ADD`（追加）／`ACTION_ATTACHMENT_REMOVE`（削除・**完了済み**）／`ACTION_ATTACHMENT_DOWNLOAD`（ダウンロード）の3つで**全部**である（`interfaces/activity.ts` で実測確認）。REMOVE が済んでいるため、本増分で ADD と DOWNLOAD を加えると添付ファミリーが揃う。`ACTION_ADMIN_ATTACHMENT_DISPOSITION_UPDATE` は名前に "ATTACHMENT" を含むが接頭辞が `ADMIN_` の管理設定 action であり、対象を添付ファイルとする action ではないため本増分の対象外。

### 増分の Boundary Context

- **In scope（増分）**:
  - `ACTION_ATTACHMENT_ADD` 記録時の添付情報 snapshot capture（要件 6）。
  - `ACTION_ATTACHMENT_DOWNLOAD` 記録時の添付情報 snapshot capture（要件 7。実際の取得範囲は capture 箇所で取れるデータに依存）。
  - snapshot 判別ユニオンへの ADD／DOWNLOAD variant と type guard の追加（要件 5。要件 1 の「action を唯一の判別子とする判別可能ユニオン」方針をそのまま踏襲）。
  - 監査ログ API 応答への ADD／DOWNLOAD snapshot フィールドの露出、および下流 viewer（`activity-log-snapshot-viewer`）が ADD の「実体が残る添付」に対しダウンロードリンクを生成できるだけの情報の提供（要件 8）。
- **Out of scope（増分）**:
  - REMOVE（要件 1〜4）の再実装・仕様変更（完了済み・触らない）。
  - `attachments.removeProfileImage`（プロフィール画像の添付を削除するが activity を一切記録しない経路であることを実測確認済み。本増分でも新たに記録を新設しない）。
  - action グループの設定・記録可否ゲート（flagship `activity-log` spec が担当）。
  - 監査ログ画面での snapshot 表示 UI・整形描画（`activity-log-snapshot-viewer` spec が担当。本増分は「表示に足るデータを保存・API 露出するところまで」）。
  - `target × targetModel` の全面的型安全化、TTL・保持期間、大量記録のボリューム制御。
- **Adjacent expectations（増分）**:
  - `ACTION_ATTACHMENT_ADD` と `ACTION_ATTACHMENT_DOWNLOAD` はいずれも `MediumActionGroup` 以上でのみ記録され、既定の Small では記録されない（`interfaces/activity.ts` で実測確認）。REMOVE と同じく、本増分で追加する snapshot が実際に保存されるかどうかは記録ゲート設定（`AUDIT_LOG_ACTION_GROUP_SIZE` または `AUDIT_LOG_ADDITIONAL_ACTIONS`＝`activity-log` spec が扱う）に依存する。
  - ダウンロード経路は guest（匿名）閲覧が許可されている場合に未認証で発火しうる（`login-required` を `isGuestAllowed=true` で使用）。このため DOWNLOAD の `username` は欠損しうる。
  - 記録した snapshot データは、`activity-log-snapshot-viewer` spec が参照して表示できる後方互換な構造で保存されなければならない（要件 4.2 と同じ制約を ADD／DOWNLOAD にも適用）。

### 添付系 action の capture 箇所と取得可能データ（参考・実測）

各 action の記録が起きるコード上の箇所と、その瞬間に手に入る／手に入らないデータを実測で整理した（EARS ではなく設計への申し送り情報）。「取得不可・要追加取得」に該当するフィールドは、要件側で「取得できなければ省略（graceful degradation）」として扱う。

| action | capture 箇所（実測） | 記録経路 | その場で取得できるデータ | 取得不可 / 欠損しうるデータ |
|--------|--------------------|---------|------------------------|--------------------------|
| ADD | `server/routes/apiv3/attachment.js`（`emit('update', ...ACTION_ATTACHMENT_ADD)`） | `addActivity` middleware が先に activity を作り、それを `emit('update')` で更新（REMOVE 直接削除と同じ更新経路） | 添付 `_id`、`originalName`、`fileSize`、`pageId`（添付の `page`）、**`pagePath`（同経路で `Page.findOne` 済みのページ doc から `page.path` を直接取得でき、追加の引き当て不要）**、`username`（`req.user`） | 実運用ではほぼ全て取得可能。ページ doc が存在しない場合のみ `pagePath` が欠損（ADD はアクセス権判定でページ存命が前提のため稀） |
| DOWNLOAD | `server/routes/attachment/download.ts`（`createActivity(...ACTION_ATTACHMENT_DOWNLOAD)`） | `createActivity` を直接呼ぶ**新規作成**経路（現状は結果を待たない fire-and-forget、snapshot は `{ username }` のみ） | 添付 `_id`、`originalName`、`fileSize`、`pageId`（添付の `page`）、`ip`／`endpoint`（`req.ip`／`req.originalUrl`） | **`pagePath`（添付はパス文字列を持たず `page`（参照 ID）のみ。取得には別途ページ引き当てが必要＝ダウンロードのホットパスに DB アクセスが増える）**、**`username`（guest 匿名ダウンロード時は `req.user` が無く欠損）** |
| REMOVE（完了済み・参考） | `server/routes/attachment/api.js`（直接削除）／`server/service/page/*`（カスケード） | 直接=`emit('update')`、カスケード=添付ごとに `createActivity` | 添付 `_id`、`originalName`、`fileSize`、`pageId`、`pagePath`（ページを引き当て）、`username` | `pagePath`（ページ削除済み・プロフィール画像で page 無し等）、カスケードでは `ip`／`endpoint` |

### Requirement 5: 添付系 action への snapshot 判別ユニオンの拡張

**Objective**: GROWI 開発者として、ADD・DOWNLOAD の snapshot も REMOVE と同じ判別ユニオンの枠組みで action 種別ごとに型安全に扱いたい。添付系 action 全体を一貫した方法で narrow でき、将来の添付系 action 追加時も同じ拡張手順で済むようにするため。

#### Acceptance Criteria
1. The Activity Log System shall `ACTION_ATTACHMENT_ADD` と `ACTION_ATTACHMENT_DOWNLOAD` の snapshot を、要件 1 で定義した判別可能ユニオンの中の名前付き variant として表現する。判別子は既存の `action` フィールドのみとし、snapshot 内に判別専用フィールドを追加しない（要件 1.4 の踏襲）。
2. The Activity Log System shall 添付系 action ごとに、`action` を根拠に activity の snapshot を該当 variant へ narrowing する type guard を提供する（既存 `isAttachmentRemoveActivity` と同じパターン）。
3. The Activity Log System shall 添付系 snapshot の各フィールドを optional に保ち、capture 箇所が取得できないフィールドは当該フィールドなしで記録できるようにする（graceful degradation、要件 2.3 と同じ扱い）。
4. The Activity Log System shall 本増分より前に記録された ADD／DOWNLOAD の既存レコード（`{ username? }` 形の catch-all snapshot、または snapshot 未設定）をそのまま扱えるようにし、破壊的なデータ移行を必要としない（要件 1.3 / 4.2 との後方互換）。

### Requirement 6: 添付ファイル追加（ADD）時の snapshot 記録

**Objective**: GROWI 管理者として、監査ログで「どのページにどの添付ファイルがいつ追加されたか」を追跡したい。追加された（＝ストレージに実体が残る）添付ファイルを事後に特定し、必要に応じて取得できるようにするため。

#### Acceptance Criteria
1. When ユーザーが添付ファイル追加 API を通じて添付ファイルを追加した場合, the Activity Log System shall 次のフィールドを snapshot に記録する：元のファイル名（`originalName`）、添付ファイルが属するページのパス（`pagePath`）、そのページの ID（`pageId`）、ファイルサイズ（`fileSize`）。
2. When 添付ファイル追加 activity を記録する際, the Activity Log System shall 操作者の username を snapshot に含める。
3. When 添付ファイル追加 activity を記録する際, the Activity Log System shall 追加された添付ファイル（実体が残る）を下流が特定・取得できるよう、その添付ファイルの識別情報を activity に永続化する（REMOVE と同じく対象＝添付とすることを想定。永続化先が activity の `target` か snapshot かは design で決める）。
4. If ADD の記録時点で snapshot フィールドの一部が取得できない場合, the Activity Log System shall 取得できたフィールドのみで activity を記録し、必要に応じて警告レベルのログを出力する（要件 2.3 と同じ扱い）。

### Requirement 7: 添付ファイルダウンロード（DOWNLOAD）時の snapshot 記録

**Objective**: GROWI 管理者として、監査ログで「誰がどの添付ファイルをいつダウンロードしたか」を追跡したい。ダウンロードされた対象ファイルを事後に特定できるようにするため。

> **未確定（design／ユーザー判断が必要）**: DOWNLOAD をこの増分でどこまで対象にするか（特に `pagePath` を追加のページ引き当てで取得するか、ホットパスへの負荷を避けて `pagePath` を省略するか、あるいは DOWNLOAD 自体を本増分から外して ADD のみとするか）は未確定。以下の受け入れ基準は「取得できるものを記録し、取得できないものは省略する」形にして、この判断がどちらに転んでも成立するように書いている。scope 判断そのものは design への申し送りとする。

#### Acceptance Criteria
1. When ユーザーが添付ファイルダウンロード経路を通じて添付ファイルをダウンロードした場合, the Activity Log System shall ダウンロード時点で取得可能な添付情報を snapshot に記録する：元のファイル名（`originalName`）、ページ ID（`pageId`）、ファイルサイズ（`fileSize`）、および対象添付の識別情報（`target`＝添付、`targetModel`＝`Attachment` を想定）。
2. When ダウンロード操作者が認証済みの場合, the Activity Log System shall 操作者の username を snapshot に含める。While ダウンロードが guest（匿名）許可により未認証で行われる場合, the Activity Log System shall username を省略して記録する。
3. If ダウンロード経路で `pagePath` が capture 時点で直接得られない場合, the Activity Log System shall `pagePath` を省略して記録する（graceful degradation）。（ダウンロード経路の添付はページ参照 ID のみを持ちパス文字列を持たないため、`pagePath` を得るには追加のページ引き当てが必要になる。これを行うか否かは上記「未確定」の scope 判断に従う。）
4. When snapshot capture がダウンロード処理に付随して行われる場合, the Activity Log System shall snapshot の記録失敗・データ欠損がダウンロード応答そのものを失敗させないようにする（ダウンロード成功を最優先とし、記録は best-effort）。

### Requirement 8: ADD／DOWNLOAD snapshot の監査ログ API 参照と下流 viewer 消費インターフェース

**Objective**: GROWI 管理者および下流の監査ログ表示 UI（`activity-log-snapshot-viewer`）として、ADD／DOWNLOAD の snapshot 詳細を API から参照したい。とくに「実体が残る」ADD 添付についてはダウンロードリンクを生成し、「実体が消える」REMOVE 添付とは区別できるようにするため。

#### Acceptance Criteria
1. When 管理者が `ACTION_ATTACHMENT_ADD` または `ACTION_ATTACHMENT_DOWNLOAD` の activity レコードを監査ログ API 経由で取得した場合, the Activity Log System shall 応答に当該 action の snapshot 添付フィールド（`originalName`、`pagePath`（取得できた場合）、`pageId`、`fileSize`）を含める。
2. The Activity Log System shall ADD 添付（ストレージに実体が残る）について、下流 viewer がダウンロードリンクを生成するのに十分な情報（対象添付の識別子＋ファイル名・サイズ・所属ページ情報）を API 応答から取得できるようにする。
3. The Activity Log System shall 下流が「ダウンロードリンクを出す添付（ADD 等・実体が残る）」と「出さない添付（REMOVE・実体が消える）」を `action` によって区別できる状態を保つ（判別子は snapshot ではなく `action`。既存 REMOVE の挙動は変えない）。
4. The Activity Log System shall 既存の activity レコード構造に後方互換な形式で ADD／DOWNLOAD の snapshot を保存し、破壊的なデータ移行を必要としない（要件 4.2 の踏襲）。
