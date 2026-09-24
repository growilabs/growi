# Requirements Document

## Project Description (Input)

**Amend target**: `ci-flaky-test-detection`（`phase: implementation-complete`）。変更対象は
`.claude/skills/investigate-flaky-test/SKILL.md` の「Pausing for a human decision」の共通テンプレート、
および `.claude/commands/flaky-ci-routine.md` Step 6 のレポート内容。

このリポジトリでは、flakyテストを検知・調査・追跡する仕組み（`flaky-ci-routine`）が1日2回稼働しているが、
`flaky/needs-decision` が付いたissueに対して人間が判断を下す際、判断に必要な「発生頻度」（初回観測日・直近観測日・
発生回数）の情報が、判断対象のissue自身には載っておらず、別issue（ダッシュボード #11720）を開いて突き合わせないと
見えない。2026-09-19〜24にかけて、21件の`flaky/needs-decision`issueをユーザーと一緒に手作業でレビューした際、
この頻度情報を毎回手で issue の `Date:` 行から拾い直す必要があった（ダッシュボード側には既に計算済みの
`First seen / Last seen / Occurrences` 列として存在していたにもかかわらず）。

また同じレビューの過程で、`flaky/suspected`（まだ再現測定をしていない状態）のissueが長期間放置されるケースが
あることが分かった。`flaky/observing` は14日再発なしで自動クローズされる一方、`flaky/suspected` /
`flaky/confirmed` は設計上決して自動クローズされないため、`flaky/suspected` のまま測定されずに滞留している
issueを可視化する仕組みが存在しない（これは自動クローズではなく、人が気づけるようにするだけの可視化）。

### 変更内容
1. `investigate-flaky-test` の「Pausing for a human decision」共通テンプレートに、ダッシュボードと同じ
   計算結果（Occurrences / First seen / Last seen）を1行追加する。新しい計算ロジックは作らず、既存の計算
   （`bin/flaky-ci/lib/dashboard.ts` とその呼び出し元が使っている値）を再利用する。
2. `flaky-ci-routine.md` Step 6 のレポートに、`flaky/suspected` のまま一定日数「再現測定の試行が一度も
   行われていない」issueを一覧する項目を追加する。自動クローズはしない（suspected/confirmedは自動クローズ
   対象外という既存設計を維持する）。

### スコープ外（この場で直接修正済み、このspecの対象外）
上記のレビュー中に見つかった、ラベル運用そのものの不具合2件は、このspecを待たず直接修正済み:
- #11864: `flaky/confirmed` と `flaky/suspected` が同時に付いていた（tierラベルは排他のはずが重複）
- #11858: 修正PR（#11863）がクローズ・未マージのまま `phase/resolved` が付いていた

## Introduction

`flaky-ci-routine` が人の判断を求めて止まる箇所（`flaky/needs-decision`）に、判断材料として既に
どこかで計算済みの情報を追加で見えるようにする、小さな2点の改善。新しい確信度の分類や新しいラベルは
導入せず、既存の計算結果を「もう1箇所にも表示する」ことと、「今は誰も見ていない滞留状態を報告に含める」
ことに限定する。

## Boundary Context

- **In scope**:
  - 判断待ちのコメントに、そのissueの発生頻度（回数・初回観測日・直近観測日）を1行追加すること
  - 実行レポートに、未測定のまま滞留している`flaky/suspected`issueの一覧を追加すること
- **Out of scope**:
  - 新しいラベルの追加、または既存のtierラベル（observing/suspected/confirmed）の意味そのものの変更
  - `flaky/suspected` / `flaky/confirmed` を自動クローズ対象にすること（可視化のみで、クローズはしない）
  - issueタイトルの短縮・書式変更（別途検討し、不要と判断済み）
  - ラベル運用の不具合修正（#11864 の tier ラベル重複、#11858 の `phase/resolved` 誤り）— このspecの
    着手前に直接修正済みで、このspecのタスクには含まれない
- **Adjacent expectations**: このspecは、ダッシュボードissue（#11720）が既に算出している発生頻度の
  計算結果をそのまま再利用することを前提とする。計算結果の形式や算出元が変わる場合は、このspecとの
  整合を別途確認する必要がある。

## Requirements

### Requirement 1: 判断待ちコメントへの発生頻度の明示

**Objective:** GROWI のメンテナーとして、`flaky/needs-decision` が付いた issue を開いたときに、その
テストが過去何回・いつ発生しているかがその場で分かってほしい。それにより、ダッシュボード issue を別途
開いて突き合わせなくても、発生頻度を踏まえた判断ができる。

#### Acceptance Criteria

1. When 調査が中程度または低い確信度で停止し人の判断待ちのコメントを投稿する場合, the flaky-ci-routine shall そのissueの発生回数・初回観測日・直近観測日を、ダッシュボードissueが使うのと同じ計算結果から1行にまとめてコメントに含める。
2. The flaky-ci-routine shall 発生頻度の計算をこの判断待ちコメント用に別途実装せず、ダッシュボードが使う既存の計算結果を再利用する。
3. If 発生頻度の計算に必要な観測記録が1件も読み取れない場合, the flaky-ci-routine shall 頻度の行を省略せず、値が不明であることを明示する。

### Requirement 2: 未測定のまま滞留した suspected issue の可視化

**Objective:** GROWI のメンテナーとして、まだ再現測定が一度も行われていない `flaky/suspected` issue が
長期間放置されていないかを、毎回の実行レポートで把握したい。それにより、自動調査のパイプラインが詰まって
いることに早く気づける。

#### Acceptance Criteria

1. When 実行のレポートを作成する場合, the flaky-ci-routine shall `flaky/suspected`のまま設定済みの日数を超えて再現測定の記録が一度も無いissueを一覧し、その番号を報告する。
2. The flaky-ci-routine shall 前項の一覧に含まれるissueを自動でクローズしない。
3. If 該当するissueが1件も無い場合, the flaky-ci-routine shall その行を省略せず、0件であることを明示する。
4. The flaky-ci-routine shall `flaky/suspected` と `flaky/confirmed` が自動クローズの対象外であるという既存の設計を変更しない。
