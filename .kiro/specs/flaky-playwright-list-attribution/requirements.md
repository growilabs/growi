# Requirements Document

## Introduction

`flaky-ci-routine` は、CI の `run-playwright` ジョブのログから不安定なテストを
見つけ、テストごとの追跡 issue に記録する。いまは、テスト名をログ中の注釈の
行から読んでいる。この注釈はログ上で 2 通りの形になり、ルーティンは片方しか
読めない。読めなかった回の失敗は、テスト名を持たないジョブ単位の issue
（`playwright:firefox` など）に記録される。その結果、テストごとの issue に
再発が記録されず、修正が効いたかどうかの確認が働かない。

この仕様は、テスト名の読み取り元を、Playwright 自身がログ末尾に出す
「再実行で通ったテスト」「全試行で失敗したテスト」の一覧に替える。
経緯と、実際のログで確認した事実は `brief.md` にある。

これは完了済みの仕様 `ci-flaky-test-detection` の決まりを変える一時的な仕様
である。変える箇所は `brief.md` の「Amend target」に示す。

## Boundary Context

- **In scope**:
  - `run-playwright` ジョブのログから、不安定なテストをテストごとに特定する
    決まり
  - 特定できなかったときにジョブ単位の識別へ記録する条件
  - ジョブのログから読む集計件数の正しさ
  - 既存の追跡 issue（テストごとのもの、ジョブ単位のもの）との整合
- **Out of scope**:
  - vitest の失敗の検出と識別
  - 確信度を上げる安価な証拠シグナル（Cheap Suspicion Mining）の中身
  - ダッシュボードの表示
  - 追跡 issue の題名（識別）の形そのものの変更。ただし、古い時期に作られ、
    いまの形に合っていない題名を、いまの形にそろえることは含む
  - 注釈の行を、どちらの形でも読めるようにすること
- **Adjacent expectations**:
  - 追跡 issue の検索・作成・追記・再オープン、確信度の段階、ダッシュ
    ボードは、`ci-flaky-test-detection` の既存の決まりのまま動く。この仕様が
    変えるのは、それらに渡す「どのテストの発生か」の決め方だけである
  - `investigate-flaky-test` は、issue の題名から識別を読む。題名の形は
    変えないので、調査側の動きは変わらない

## Requirements

### Requirement 1: 再実行で通ったテストを、テストごとの識別で記録する

**Objective:** flaky test を追跡する開発者として、再実行で通った Playwright
のテストが、そのテストの追跡 issue に記録されてほしい。修正の後に再発したか
どうかを、その issue で確かめられるようにするためである。

#### Acceptance Criteria

1. When `run-playwright` ジョブのログ末尾の一覧に、再実行で通ったテストが
   載っている, the flaky-ci-routine shall そのテストを、ブラウザ・spec・
   テスト名からなるテストごとの識別で、確定済みの発生として記録する
2. When 1 つのジョブの一覧に、再実行で通ったテストが 2 件以上載っている,
   the flaky-ci-routine shall それぞれのテストを別々の識別で記録する
3. The flaky-ci-routine shall ログ中の注釈の行がどの形で出ていても、また
   出ていなくても、同じテストに対して同じ識別を得る
4. When 同じ一覧が 1 つのジョブのログに重ねて出力されている, the
   flaky-ci-routine shall 同じテストを 1 回の発生として数える
5. When 得た識別が既存の追跡 issue の題名と一致する, the flaky-ci-routine
   shall 新しい issue を作らず、その issue に発生を追記する

### Requirement 2: 全試行で失敗したテストは、確定ではなく観測として扱う

**Objective:** flaky test を追跡する開発者として、再実行しても通らなかった
テストが「不安定」と確定されないでほしい。全試行で失敗するのは本物の不具合
でもあり得るためである。

#### Acceptance Criteria

1. When ログ末尾の一覧に、全試行で失敗したテストが載っている, the
   flaky-ci-routine shall そのテストをテストごとの識別で特定し、確定済み
   ではなく観測として扱う
2. When 全試行で失敗したテストを観測として扱う, the flaky-ci-routine shall
   `ci-flaky-test-detection` の既存の安価な証拠シグナルによる判定を、
   これまでと同じ条件で適用する
3. When 1 つのジョブの一覧に、再実行で通ったテストと全試行で失敗したテスト
   の両方が載っている, the flaky-ci-routine shall 前者を確定済みの発生、
   後者を観測として、テストごとに分けて扱う

### Requirement 3: 一覧から読めないときは、推測で割り当てない

**Objective:** flaky test を追跡する開発者として、テストを特定できなかった
発生が、誤ったテストの issue に記録されないでほしい。誤った記録は、記録が
無いことより調査を誤らせるためである。

#### Acceptance Criteria

1. If 一覧の見出しが示す件数と、その下に載っているテストの数が一致しない,
   then the flaky-ci-routine shall その一覧からテストを特定しない
2. If ログの集計が再実行で通ったテストを 1 件以上と示しているのに、その
   テストを一覧から特定できない, then the flaky-ci-routine shall その発生を
   ジョブ単位の識別（ブラウザ名まで）で記録し、テストを特定できなかった
   ことを issue の本文に書く
3. The flaky-ci-routine shall テスト名を、ログ末尾の一覧以外の箇所（再試行
   の出力の並びなど）から推測して識別に使わない
4. When 1 つのジョブで、一部のテストは一覧から特定でき、残りは特定できない,
   the flaky-ci-routine shall 特定できたテストだけをテストごとの識別で記録
   し、残りをジョブ単位の識別で記録する

### Requirement 4: 集計の件数を、テストの実行ごとに正しく読む

**Objective:** flaky test を追跡する開発者として、ジョブのログから読んだ
件数が、実際の実行結果と一致していてほしい。件数は、発生を確定とするか
観測とするかの判定に使われるためである。

#### Acceptance Criteria

1. While 1 つのジョブの中でテストの実行が 2 回以上行われている, the
   flaky-ci-routine shall それぞれの実行の件数を別々に読み、別の実行の
   件数と混ぜない
2. The flaky-ci-routine shall あるテストを確定済みとするか観測とするかの
   判定に、そのテストが載っている一覧と同じ実行の結果だけを使う
3. If ログに件数の行が 1 つも無い, then the flaky-ci-routine shall 件数を
   0 と読まず、不明として扱う

### Requirement 5: 既存の追跡 issue と整合する

**Objective:** flaky test を追跡する開発者として、この変更の後も、既存の
追跡 issue がそのまま使われてほしい。同じテストの issue が新旧で 2 つに
分かれると、発生回数と経緯が分散するためである。

#### Acceptance Criteria

1. The flaky-ci-routine shall テストごとの識別を、既存の追跡 issue の題名
   と同じ形で作る
2. When ある発生をテストごとの識別で記録した, the flaky-ci-routine shall
   同じ発生をジョブ単位の追跡 issue には記録しない
3. The flaky-ci-routine shall 既存のジョブ単位の追跡 issue に過去に記録
   された発生を、テストごとの issue へ移し替えない
4. When 閉じられているジョブ単位の追跡 issue があり、その後の発生がすべて
   テストごとの識別で記録できた, the flaky-ci-routine shall そのジョブ単位
   の issue を再オープンしない
5. Where 既存の追跡 issue の題名が、テスト名のうち末尾の名前だけを持ち、
   それを囲むグループ名を欠いていて、いまあるテストのちょうど 1 つに対応
   づけられる, the flaky-ci-routine shall 同じテストの発生を、その issue
   とは別の新しい issue に分けて記録しない

### Requirement 6: 特定の根拠を issue に残す

**Objective:** 追跡 issue を読む開発者として、その発生がなぜこのテストの
ものと判断されたのかを、issue の上で確かめたい。ログの保存期間が過ぎた後
でも、判断を追えるようにするためである。

#### Acceptance Criteria

1. When 発生をテストごとの識別で記録する, the flaky-ci-routine shall 特定の
   根拠にした一覧の該当部分を、issue の証拠として残す
2. When 発生をジョブ単位の識別で記録する, the flaky-ci-routine shall
   テストを特定できなかった理由（一覧が無い、件数が合わない、など）を
   issue の本文に書く
