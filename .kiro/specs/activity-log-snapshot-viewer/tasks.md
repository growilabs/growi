# Implementation Plan

> 方針: 新規コンポーネントは **TDD（テスト先行・red→green）** で進める（essential-test-design=観察可能な契約をテスト / essential-test-patterns=Vitest・RTL・型安全モック `mock<T>()` に従う）。i18n の非英語翻訳（タスク 6）はコード実装（1〜5）の完成条件ではなく、疎結合な後続タスクとして切り出す（未実施の間は i18next フォールバックで英語表示、要件 4.3）。型・API・記録側（`~/interfaces/activity` の型/型ガード、`apiv3/activity`）は変更せず read/UI のみを追加する。

- [ ] 1. Foundation: 追加ラベル（英語）の土台
- [x] 1.1 監査ログ snapshot 詳細ラベルを en_US に追加
  - `en_US/admin.json` に詳細列見出し `audit_log_management.detail` と `audit_log_snapshot.{file_name, file_size, page, no_detail, unknown_file_name, page_unavailable, unknown_size}` を追加する
  - 既存キーは変更しない（追加のみ）
  - 完了状態: `en_US/admin.json` に上記キーが全て存在し、`t('admin:audit_log_snapshot.file_name')` 等がキー文字列ではなく英語ラベルを返す
  - _Requirements: 4.1, 4.2_

- [ ] 2. Core: snapshot 詳細レンダラ
- [x] 2.1 (P) 汎用 raw snapshot ビューア（RawSnapshotDetail）
  - 先に失敗するコンポーネント spec を書く（red）: (a) 複数フィールドを持つ snapshot → 全フィールドが key-value で描画される、(b) `undefined`／空 snapshot → 「詳細なし」プレースホルダが出て例外を投げない
  - 実装で green にする: `snapshot` の全フィールドを列挙して key-value 描画（透過される `_id`/`id` 含む）、値はテキスト化（object/array は安全に文字列化）、空/不在は `no_detail` プレースホルダ
  - 完了状態: spec が green。空・欠損 snapshot でもレンダリングエラーを起こさずプレースホルダを描画する
  - _Requirements: 1.1, 1.3, 3.4_
  - _Boundary: RawSnapshotDetail_
  - _Depends: 1.1_
- [x] 2.2 (P) 添付削除の整形レンダラ（AttachmentRemoveSnapshotDetail）
  - 先に失敗する spec を書く（red）: (a) 全フィールド有り → ファイル名・人間可読サイズ・所属ページリンクが描画され、ダウンロードリンクは描画されない、(b) `originalName` 欠損 → 不明ラベル、(c) `pagePath` 欠損 → リンク要素が無く参照先なしラベル、(d) `fileSize` 欠損 → サイズ欠損ラベル
  - 実装で green にする: 絞り込み済み型（`snapshot?: AttachmentRemoveSnapshot`）を受け取り、各フィールドを独立にフォールバック判定。サイズは `pretty-bytes`、ページは `PagePathHierarchicalLink` + `LinkedPagePath`。ダウンロードリンクは一切出さない
  - 完了状態: spec が green。各欠損ケースでフォールバック文言が出て、リンクの有無（page あり=リンク / 削除実体=DLなし）が仕様どおり
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3_
  - _Boundary: AttachmentRemoveSnapshotDetail_
  - _Depends: 1.1_

- [ ] 3. Core: 宣言的ディスパッチ
- [x] 3.1 レンダラレジストリと defineRenderer ファクトリ
  - `defineRenderer(guard, Component)` を実装（型ガードの絞り込み型を Component の props 型へ結合。唯一の widening cast を factory 内 1 箇所に閉じ込め、`any` は使わない）
  - レジストリに添付削除を `defineRenderer(isAttachmentRemoveActivity, AttachmentRemoveSnapshotDetail)` の 1 エントリで登録。判定は `action` を判別子とし互いに排他（1 action = 1 エントリ）
  - 型検査ゲート: `isAttachmentRemoveActivity`（引数 `Pick<IActivity,'action'|'snapshot'>`・述語で snapshot を絞る）を factory のジェネリックが受理することを確認。噛み合わなければ制約調整か明示型引数で対応（上流の型ガード定義は変更しない）。guard と Component の action 取り違えは型エラーになることを確認
  - 完了状態: 型検査が green。レジストリに REMOVE エントリが 1 件あり、誤ったペア登録がコンパイルエラーになる
  - _Requirements: 1.2_
  - _Boundary: snapshot-detail-renderers_
  - _Depends: 2.2_
- [x] 3.2 ディスパッチャ（ActivitySnapshotDetail）と barrel 公開
  - 先に失敗する spec を書く（red）: (a) `action=ATTACHMENT_REMOVE` → 既定で整形（ファイル名等）が現れ、raw タブへ切り替えると全フィールドの key-value が現れる（整形が raw を置き換えない）、(b) 未登録 action → タブ無しで raw のみ、(c) `username` のみの snapshot → 整形もタブも現れず raw のみ
  - 実装で green にする: レジストリを先頭一致（`find`）で選ぶ。一致すれば「整形／raw」タブで見せる（既定タブ=整形、raw タブは常に `RawSnapshotDetail` の全フィールド、アクティブタブはローカル state、タブ部品はプロジェクト標準を利用）。一致が無ければ `RawSnapshotDetail` のみ（タブ chrome 無し）。`snapshot-detail/index.ts` は `ActivitySnapshotDetail` のみを公開
  - 完了状態: spec が green。整形対象 action でも raw タブで全フィールドが失われず参照でき、未対応 action は raw のみ。barrel からは `ActivitySnapshotDetail` のみ import 可能
  - _Requirements: 1.2, 1.3, 1.5, 5.1_
  - _Boundary: ActivitySnapshotDetail, snapshot-detail barrel_
  - _Depends: 3.1, 2.1_

- [ ] 4. Integration: 監査ログテーブルへの組み込み
- [x] 4.1 行コンポーネント（ActivityTableRow）の新規作成と展開 UI
  - 先に失敗する spec を書く（red）: (a) disclosure トグルで詳細サブ行が現れ、再度で閉じる、(b) 既存 5 セル（user/date/action/ip/url）の描画が保たれる、(c) トグルに `aria-expanded` が付く
  - 実装で green にする: 1 activity を 1 行で描画する新規コンポーネントを作り、行ローカルの展開 state を持たせる。先頭に disclosure セルを追加、展開時のみ `ActivitySnapshotDetail` の全幅サブ行を mount。既存 `data-testid="activity-table"` を維持し、詳細サブ行に別 testid を付す
  - 完了状態: spec が green。未展開時は詳細を mount せず、展開でのみ snapshot 詳細が現れる
  - _Requirements: 1.4, 5.3_
  - _Boundary: ActivityTableRow_
  - _Depends: 3.2_
- [ ] 4.2 ActivityTable への詳細列追加と行委譲
  - `<thead>` に詳細列見出し（`admin:audit_log_management.detail`）を追加し、行生成を `ActivityTableRow` へ委譲する薄いコンテナにする
  - 既存の列順・`data-testid`・action 名の i18n 表示（`admin:audit_log_action.<action>`）・user セルの username 描画は不変に保つ
  - 完了状態: 監査ログ画面で全 activity 行に disclosure が出て、展開すると snapshot 詳細（添付削除は整形、他は raw）が表示される。既存 5 列と action 名表示は従来どおり
  - _Requirements: 1.4, 5.2_
  - _Boundary: ActivityTable_
  - _Depends: 4.1, 1.1_

- [ ] 5. Validation: 後方互換の混在レンダリング
- [ ] 5.1 旧/新レコード混在の feature-level コンポーネント統合テスト
  - 先に失敗する統合 spec を書く（red）→ green: 旧レコード（snapshot 無し／`username` のみ）と新レコード（添付フィールド有り）を混在させた `activityList` を同一テーブルに渡し、破綻なく描画されることを検証
  - 展開時、添付削除行は既定で整形が出て raw タブでも全フィールドを参照でき、非添付行は raw のみ。削除実体にはダウンロードリンクが出ないことを確認
  - 完了状態: 統合 spec が green。混在一覧でレンダリングエラーが無く、既存レコードは従来どおり表示される
  - _Requirements: 1.2, 5.1, 5.3_
  - _Depends: 4.2_

- [ ] 6. 多言語翻訳（後続・実施要否は別途判断）
- [ ] 6.1 ja / ko / zh / fr のラベル翻訳を追加
  - `ja_JP/ko_KR/zh_CN/fr_FR/admin.json` にタスク 1.1 と同一キーの各言語訳を追加する
  - このタスクはコード実装（1〜5）の完成条件ではない。未実施の間は i18next の欠落時フォールバックで英語表示となり機能は成立する（疎結合・後回し可、実施要否は design の i18n 方針に従い別途判断）
  - 完了状態: 4 ロケールの `admin.json` に該当キーが全て存在し、各 UI 言語で翻訳ラベルが表示される
  - _Requirements: 4.1, 4.3_
  - _Depends: 1.1_

## Implementation Notes

- 3.1: design の参照実装（`T extends IActivityHasId`）は実在の型ガード（`Pick<IActivity,'action'|'snapshot'>` ベース）と単一の `T` では両立しないため、design が明記する代替案どおり制約を `T extends Pick<IActivity,'action'|'snapshot'>` に調整し、Component props は `IActivityHasId & T` とした（上流は無変更）。
- 4.1: 「copied!」tooltip の開閉 state はテーブル共有から行ローカルへ移した（挙動は行単位で不変）。`formatDate` が ActivityTable と ActivityTableRow に重複しており、4.2 で ActivityTable を薄いコンテナへ変える際に解消すること。
- 3.2: タブ見出し「Formatted」「Raw」は英語ハードコード（design の i18n 契約はフィールドラベル 8 キーのみでタブ見出しキーを定義していないため）。i18n キー化するなら admin.json を境界に含むタスク 4.2 で `audit_log_snapshot.tab_formatted` / `tab_raw` 等の追加を判断する。
- 3.1: snapshot 型が全フィールド optional ＋ `FC` の呼び出しシグネチャが bivariant なため、「余分な必須フィールドを要求する Component」の誤登録は型エラーにならない。durable に検出できる誤ペアは「同名フィールドの型が矛盾する」場合のみで、負のゲートは `@ts-expect-error`（`fileSize: string` の dummy）として `snapshot-detail-renderers.spec.tsx` に常設。この directive の下の行がエラーでなくなると typecheck 自体が落ちる（TS2578）。
