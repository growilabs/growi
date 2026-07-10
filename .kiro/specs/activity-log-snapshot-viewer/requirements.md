# Requirements Document

## Introduction

管理画面の監査ログ（AuditLog）で、activity に記録された snapshot を管理者が閲覧できるようにする read（表示）側の機能。PR #11393 で添付削除の snapshot（`originalName` / `pagePath` / `pageId` / `fileSize`）は DB 保存・API 応答まで通っているが、監査ログ画面のテーブル（`ActivityTable`）は `snapshot.username` しか描画しておらず、記録済みのデータが UI から見えない。

本機能では、(1) 全 action の生（raw）snapshot を確認できる汎用ビューアと、(2) 添付削除 action の整形表示（ファイル名・サイズ・所属ページリンク）を提供する。添付追加（`ACTION_ATTACHMENT_ADD`）の整形表示は upstream `activity-log-snapshot` の capture 拡張（別増分）に依存するため、初回スコープから除外する。

本書における「監査ログビューア」は、監査ログ画面で activity 一覧と各 activity の snapshot を表示する UI を指す。

## Boundary Context

- **In scope**:
  - 全 action の raw snapshot 表示（汎用ビューア）。action 固有の整形が無い場合は raw 表示にフォールバックする。
  - 添付削除 `ACTION_ATTACHMENT_REMOVE` の整形表示（ファイル名・ファイルサイズ・所属ページリンク。削除済み実体なのでダウンロードリンクは出さない。ページ削除済み等の欠損はフォールバック表示）。
  - 追加ラベルの多言語対応（en / ja / ko / zh / fr の全ロケール）。
- **Out of scope**:
  - 添付追加 `ACTION_ATTACHMENT_ADD` の整形表示（ダウンロードリンク含む）。upstream `activity-log-snapshot` の ADD capture 拡張の完了後に将来増分として扱う。
  - 非添付 action の整形表示（raw 表示のみ）。
  - snapshot データの capture（記録）自体（`activity-log-snapshot` が担当）。
  - `target × targetModel` の全面的な polymorphic「対象」列（将来課題）。
- **Adjacent expectations**:
  - 表示するデータは upstream の記録側（`activity-log-snapshot`）が保存済みであることに依存する。添付削除は #11393 で保存済み、添付追加は未保存（別増分待ち）。
  - 既存の監査ログ API（`apiv3/activity`）・activity/snapshot の型・監査ログ一覧取得・多言語基盤を再利用し、これらの契約を壊さない。
  - snapshot の各 action への振り分けの判別子は snapshot 自身のフィールドではなく activity の `action` である（記録側が定めた既存のデータ契約）。

## Requirements

### Requirement 1: 全 action の raw snapshot 表示（汎用ビューア）

**Objective:** 管理者として、任意の action の snapshot に記録された内容を生のまま確認したい。そうすることで、整形表示が未対応の action でも「何が記録されたか」を監査ログ画面から追える。

#### Acceptance Criteria

1. When 管理者が監査ログの或る activity の snapshot 詳細表示を要求する, the 監査ログビューア shall その activity の snapshot に含まれる全フィールドをキーと値の対で表示する。
2. Where その activity の action に対応する整形表示が用意されていない, the 監査ログビューア shall raw 表示のみを見せる。
3. If snapshot が存在しない、または表示すべきフィールドを持たない, the 監査ログビューア shall snapshot 詳細を持たない旨がわかる表示にし、エラーを起こさない。
4. The 監査ログビューア shall 既存の user / date / action / ip / url 各列の表示を維持したうえで、snapshot 詳細を追加表示する。
5. When 表示対象の activity の action に対応する整形表示が用意されている, the 監査ログビューア shall 整形表示を既定として見せつつ、同一の snapshot 詳細内で raw 表示（全フィールドのキーと値）へ切り替える手段を提供し、整形表示が raw 表示を置き換えて失わせてはならない。

### Requirement 2: 添付削除 action の整形表示

**Objective:** 管理者として、添付削除の監査ログを「どのファイルが、どのページから、どれだけのサイズで削除されたか」が読める形で確認したい。そうすることで、raw のキー羅列を読まずに削除内容を把握できる。

#### Acceptance Criteria

1. When 表示対象の activity の action が添付削除（`ACTION_ATTACHMENT_REMOVE`）である, the 監査ログビューア shall ファイル名（originalName）・ファイルサイズ・所属ページを整形表示する。
2. When ファイルサイズ（bytes 単位の数値）を表示する, the 監査ログビューア shall 人間可読な単位（例: KB / MB）へ整形して表示する。
3. When 所属ページのパス（pagePath）が存在する, the 監査ログビューア shall そのページへのリンクを表示する。
4. When 表示対象の action が添付削除である, the 監査ログビューア shall ダウンロードリンクを表示しない（削除により実体が存在しないため）。

### Requirement 3: 欠損フィールドのフォールバック表示

**Objective:** 管理者として、snapshot の一部フィールドが欠けている場合でも、破綻せず読める表示を得たい。snapshot は全フィールド optional で、記録側が解決できなかった値は欠損しうる。

#### Acceptance Criteria

1. If ファイル名（originalName）が欠損している, the 監査ログビューア shall ファイル名の代わりに不明である旨のフォールバック表示を出す。
2. If 所属ページのパス（pagePath）が欠損している（対象ページが削除済み等）, the 監査ログビューア shall ページリンクを張らず、参照先が無い旨のフォールバック表示にする。
3. If ファイルサイズ（fileSize）が欠損している, the 監査ログビューア shall サイズ欄をフォールバック表示にする。
4. The 監査ログビューア shall いずれのフィールドが欠損してもレンダリングエラーを起こさず一覧表示を継続する。

### Requirement 4: 追加ラベルの多言語対応

**Objective:** 管理者として、追加された snapshot 詳細のラベルを自分の UI 言語で読みたい。GROWI は複数ロケールを提供している。

#### Acceptance Criteria

1. The 監査ログビューア shall 追加する snapshot 詳細ラベル（ファイル名・ファイルサイズ・所属ページ等）を en / ja / ko / zh / fr の全ロケールで提供する。
2. When 現在の UI 言語に対応する翻訳が存在する, the 監査ログビューア shall その言語のラベルを表示する。
3. If あるロケールに当該ラベルの翻訳が欠落している, the 監査ログビューア shall 既存の多言語基盤の欠落時フォールバック挙動に従う。

### Requirement 5: 既存 activity との後方互換

**Objective:** 管理者として、これまで記録された（添付フィールドを持たない）activity も、これまで通り破綻なく閲覧したい。

#### Acceptance Criteria

1. When snapshot が username のみを持つ（従来形式の）activity を表示する, the 監査ログビューア shall 従来通り username を表示し、添付整形表示を要求しない。
2. When action が整形表示未対応の activity を表示する, the 監査ログビューア shall 既存の action 名の多言語表示を維持する。
3. The 監査ログビューア shall 既存レコード（添付フィールド無し）と新規レコード（添付フィールド有り）を、同一の一覧内で混在して表示できる。
