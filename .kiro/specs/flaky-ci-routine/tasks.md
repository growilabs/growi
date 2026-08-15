# Implementation Plan

このspecはRequirement 1〜4を既存実装の事後spec化として扱うため、実装タスク
は新規要件であるRequirement 5（常設ダッシュボード）にのみ発生する。
Requirement 1〜4は「既存実装の確認」タスク（1.2）でrequirements.mdとの対応
を確認するのみで、コード変更は行わない。

- [ ] 1. Foundation: 前提条件の整備
- [ ] 1.1 GitHubラベル `flaky/dashboard` を作成する
  - `gh api repos/growilabs/growi/labels -X POST -f name=flaky/dashboard -f color=... -f description=...` で作成する
  - 説明文は100文字制限に収める（`flaky/suspected`作成時に一度422で失敗した実績あり）
  - 観測可能な完了状態: `gh api repos/growilabs/growi/labels/flaky%2Fdashboard -X GET` がラベル情報を返す
  - _Requirements: 5.3_
- [ ] 1.2 既存実装（Requirement 1〜4）がrequirements.mdの各Acceptance Criteriaを満たしていることを確認する
  - `.claude/skills/detect-flaky-ci/SKILL.md` を読み、Requirement 1（検出）・Requirement 2（エスカレーション）の各ACに対応するステップを特定する
  - `.claude/skills/investigate-flaky-test/SKILL.md` を読み、Requirement 3（自律調査・修正）の各ACに対応するステップを特定する
  - `.claude/commands/flaky-ci-routine.md` のStep0を読み、Requirement 4（実行環境差異への耐性）の各ACに対応する記述を特定する
  - 観測可能な完了状態: 全AC ID（1.1〜1.6, 2.1〜2.6, 3.1〜3.5, 4.1〜4.3）について対応箇所を1行ずつ書き出したチェックリストが作れる（コード変更は無し。ギャップがあれば別途報告し、本タスクでは修正しない）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3_

- [ ] 2. Core: ダッシュボード機能の実装
- [ ] 2.1 (P) `investigate-flaky-test/SKILL.md` にFix-PR Marker Conventionを追加する
  - Step 6-A（draft PRオープン）の直後に、対象の追跡issueへ `**Fix PR**: {PR_HTML_URL}` という固定書式の1行を含むコメントを追加する手順を1つ追加する
  - 既存のPR作成フロー・他のステップ番号は変更しない
  - 観測可能な完了状態: SKILL.mdのStep 6-Aブロックを読むと、コメント追加手順とその固定書式が明記されている
  - _Requirements: 5.3_
  - _Boundary: Fix-PR Marker Convention_
- [ ] 2.2 (P) `flaky-ci-routine.md` にDashboard Updaterステップを追加し、ステップ番号を整理する
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
