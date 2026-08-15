# Implementation Plan

このspecはRequirement 1〜4を既存実装の事後spec化として扱うため、実装タスク
は主に新規要件であるRequirement 5（常設ダッシュボード）に発生する。
Requirement 1〜4は「既存実装の確認」タスク（1.2）でrequirements.mdとの対応
を確認する。ただし1.2の実施中にAC 2.6が未実装であることが判明したため、
例外的にタスク1.3でコード修正を行う（詳細は1.2の実施結果を参照）。

- [ ] 1. Foundation: 前提条件の整備
- [x] 1.1 GitHubラベル `flaky/dashboard` を作成する
  - `gh api repos/growilabs/growi/labels -X POST -f name=flaky/dashboard -f color=... -f description=...` で作成する
  - 説明文は100文字制限に収める（`flaky/suspected`作成時に一度422で失敗した実績あり）
  - 観測可能な完了状態: `gh api repos/growilabs/growi/labels/flaky%2Fdashboard -X GET` がラベル情報を返す
  - _Requirements: 5.3_
- [x] 1.2 既存実装（Requirement 1〜4）がrequirements.mdの各Acceptance Criteriaを満たしていることを確認する
  - `.claude/skills/detect-flaky-ci/SKILL.md` を読み、Requirement 1（検出）・Requirement 2（エスカレーション）の各ACに対応するステップを特定する
  - `.claude/skills/investigate-flaky-test/SKILL.md` を読み、Requirement 3（自律調査・修正）の各ACに対応するステップを特定する
  - `.claude/commands/flaky-ci-routine.md` のStep0を読み、Requirement 4（実行環境差異への耐性）の各ACに対応する記述を特定する
  - 観測可能な完了状態: 全AC ID（1.1〜1.6, 2.1〜2.6, 3.1〜3.5, 4.1〜4.3）について対応箇所を1行ずつ書き出したチェックリストが作れる（コード変更は無し。ギャップがあれば別途報告し、本タスクでは修正しない）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3_
  - **実施結果**: 19/20 ACは実装済みと確認。AC 2.6（再発証拠が解決済みとした変更より前の時点の場合、誤って再オープンしない）は`detect-flaky-ci/SKILL.md`の「Existing CLOSED issue found」に対応する日時比較ロジックが無く、未実装と判明（#11711で人間/LLMのその場判断のみで回避されていた既知の懸念、research.md参照）。ユーザー承認のうえタスク1.3として追加実装する
- [x] 1.3 `detect-flaky-ci/SKILL.md` の「Existing CLOSED issue found」に、再発証拠と解決コミットの前後関係を比較するチェックを追加する（AC 2.6、タスク1.2で発見）
  - 新しい失敗の証拠（run/コミット/ログのタイムスタンプ）を取得し、issueを解決したとされる変更（`Fixed by #NNNN` 等の記載や、そのPRのマージコミット日時）より**前**の時点のものであるかどうかを判定する手順を追加する
  - 前の時点であると判定された場合は、issueを再オープンせず、その証拠を過去の記録として（既存の`### Backfilled observation`系のコメント形式で）issueに残すことを明記する（#11711で実際に発生した状況をそのまま明文化する）
  - 前の時点でない（解決後の新規再発）と判定された場合は、既存どおり再オープンし`flaky/confirmed`にラベル付けする
  - 判定に必要な情報（解決コミットの日時、証拠コミットの日時）がどちらのAPI呼び出しから得られるかを具体的に記述する（`gh api`呼び出し例を含める）
  - 観測可能な完了状態: `detect-flaky-ci/SKILL.md`の「Existing CLOSED issue found」セクションを読むと、再発証拠の日時と解決コミット日時を比較する具体的な手順が書かれており、その手順だけで「再オープンする/しない」を一意に決定できる
  - _Requirements: 2.6_
  - _Boundary: Escalation Tiering_
  - **実施結果**: レビュー承認済み。同一issueに`Fixed by #NNNN`コメントが複数付いた場合のタイブレークルール（最新のものを使う等）は未明記のまま残っている（#11711では1件のみだったため実害なし、将来の改善候補としてImplementation Notesに記録）

- [ ] 2. Core: ダッシュボード機能の実装
- [x] 2.1 (P) `investigate-flaky-test/SKILL.md` にFix-PR Marker Conventionを追加する
  - Step 6-A（draft PRオープン）の直後に、対象の追跡issueへ `**Fix PR**: {PR_HTML_URL}` という固定書式の1行を含むコメントを追加する手順を1つ追加する
  - 既存のPR作成フロー・他のステップ番号は変更しない
  - 観測可能な完了状態: SKILL.mdのStep 6-Aブロックを読むと、コメント追加手順とその固定書式が明記されている
  - _Requirements: 5.3_
  - _Boundary: Fix-PR Marker Convention_
- [x] 2.2 (P) `flaky-ci-routine.md` にDashboard Updaterステップを追加し、ステップ番号を整理する
  - 現行Step3（investigate-flaky-testループ）とStep4（Report）の間に新しい **Step4: Update Dashboard** を挿入し、既存Step4（Report）を**同じ編集内で**Step5に繰り下げる（新Step4挿入と旧Step4の繰り下げは同一ファイルの1つの編集としてまとめて行い、Step4が2つ存在する中間状態を作らない）
  - `open`状態かつ `flaky/observing|suspected|confirmed` いずれかのラベルを持つ全issueを再取得する手順を記述する
  - タイトルが完全一致で `flaky-ci-routine: dashboard` のissueを検索し、無ければ作成・あれば本文を全置換する手順を記述する（ラベル `flaky/dashboard` を付与）
  - ダッシュボード本文の表フォーマット（Identity/Tier/First seen/Last seen/Occurrences/Tracking issue/Fix PR列）と、Occurrencesの算出規則（本文1件＋見出しが`### Additional observation`または`### Backfilled observation`に一致するコメントのみをカウント）を明記する
  - Fix PR欄はFix-PR Marker Conventionの記載があるときのみforward-onlyで埋め、無ければ`—`にする（自由形式のURL探索は行わない）ことを明記する
  - issue本文が文字数上限に近い場合の切り捨てと明記ルール、タイトル検索が2件以上ヒットした場合の異常報告ルールを記述する
  - investigate-flaky-testループが人間の判断待ちで停止した場合でも、新Step4（Dashboard更新）は必ず実行することを明記する（Requirement 5.1の「ルーティンの実行が完了した場合」は個々の調査の完了ではなくルーティン1サイクルの完了を指す、という解釈を明記する）
  - 新Step5（Report、旧Step4から繰り下げ）に、ダッシュボードの更新結果（新規作成/更新、掲載件数、切り捨ての有無）を報告する記述を追加する
  - 観測可能な完了状態: `flaky-ci-routine.md` の全ステップ番号がStep0〜Step5で重複・欠番なく一貫しており、新Step4の手順だけで「ダッシュボードissueが存在するかどうか」を判定し作成/更新のどちらに進むかを一意に決定できる
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: Dashboard Updater_

- [ ] 3. Validation: run nowによるシナリオ検証
- [ ] 3.1 ダッシュボードissueの新規作成と更新・非重複を検証する
  - `flaky-ci-routine: dashboard` issueが存在しない状態で `/flaky-ci-routine` を実行し、1件だけ作成されることを確認する（design.mdシナリオ1）
  - 同issueが存在する状態でもう一度実行し、issue番号が変わらず本文だけが更新されることを確認する（design.mdシナリオ2）
  - 観測可能な完了状態: 2回のrun後もダッシュボードissue番号が1つのままで、本文の更新日時が最新化されている
  - _Depends: 2.2_
  - _Requirements: 5.1, 5.2_
- [ ] 3.2 ゼロ状態表示を検証する
  - 一時的に全ての `flaky/*` 追跡issueを解決済みにしてから `/flaky-ci-routine` を実行し、ダッシュボードが「アクティブなflakyはありません」を表示し、古い表が残らないことを確認する（design.mdシナリオ3）
  - 観測可能な完了状態: ダッシュボードissue本文に古いテスト行が1件も残っていない
  - _Depends: 2.2_
  - _Requirements: 5.4, 5.5_
- [ ] 3.3 Fix-PRマーカーの反映を検証する
  - investigate-flaky-testが実際にPRを開いた後、追跡issueに `**Fix PR**: ...` コメントが付与され、次のダッシュボード更新でそのリンクが反映されることを確認する（design.mdシナリオ4）
  - マーカーが無い既存issue（例: #11711）についてはFix PR欄が`—`のままであることも合わせて確認する
  - 観測可能な完了状態: ダッシュボードissue本文のFix PR列に、マーカー付きissueのPRリンクが表示され、マーカー無しissueは`—`になっている
  - _Depends: 2.1, 2.2_
  - _Requirements: 5.3_

## Implementation Notes
- タスク1.3: `detect-flaky-ci/SKILL.md`「Existing CLOSED issue found」に日時比較ロジックを追加した際、同一issueに`Fixed by #NNNN`スタイルのコメントが複数付いた場合のタイブレークルールを明記していない（未検証の理論上のエッジケース。#11711では1件のみで実害なし）。将来この状況が実際に発生したら「最新のFixed byコメントを使う」等のルールを追記する
- タスク2.1: レビュー1周目で`gh pr create`を2回呼んでしまい（1回目は実際のPR作成、2回目はURL取得目的のプレースホルダー本文）、重複PRを作ってしまう不具合が見つかった。修正版は元の`gh pr create`呼び出し自体を`PR_HTML_URL=$(...)`で包んで出力を捕捉する形にし、2回目の呼び出しを削除。以降、他タスクで同様に「既存コマンドの出力を後段で使いたい」場合は、コマンドを複製せず出力を変数に捕捉する形を優先する
