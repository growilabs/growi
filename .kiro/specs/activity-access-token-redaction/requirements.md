# Requirements Document

## Project Description (Input)
**activity-log の amend spec**（完了済みの `activity-log` spec の約束を変える一時的な spec。最後に変更を activity-log へ書き戻して自分を削除する。`.claude/rules/spec-lifecycle.md` に従う）。

- **誰が困っているか**: 監査ログ（activity）を保管・閲覧する GROWI の管理者と運用者。activity の `endpoint` に access_token が平文で残ると、DB を読める人や監査ログのエクスポートを受け取った人にトークンが漏れる。
- **今の状況**:
  - 記録用の middleware（`add-activity.ts` → `redact-access-token-from-endpoint.ts`）で endpoint の access_token を伏せ字にしているが、activity-log spec には書かれていない。
  - `ActivityService.createActivity` を直接呼ぶ経路（ログイン、検索、添付ファイルのダウンロード、ページ閲覧、growi-vault、各種エクスポートの cron など）は middleware を通らないので、生の URL が保存される。
  - 伏せ字処理が入る前に保存された activity には、トークンが平文で残っている。
- **何を変えるか**:
  - 伏せ字処理を middleware からモデル側の保存処理（`models/activity.ts` の書き込み口）に移し、どの経路で記録しても endpoint の access_token が伏せ字になるようにする。
  - 既存の activity の endpoint を伏せ字にする migration を追加する。
  - activity-log spec の design.md / requirements.md に伏せ字の約束を書き戻す。

範囲外: endpoint 検索まわりの変更（別 spec）。

## Introduction

このドキュメントは、activity（監査ログ）の `endpoint` に access_token が平文で残らないようにするための要件を定義する。GROWI は access_token をクエリパラメータでも受け付けるため、リクエスト URL をそのまま endpoint に保存すると、認証情報が平文で DB に残る。今は一部の記録経路でしか伏せ字にしていないので、どの経路で activity が DB に入っても伏せ字になること、すでに平文で残っている activity を直すこと、の 2 点を約束にする。

この spec は `activity-log` の amend spec であり、ここで定める約束は最終的に activity-log の requirements.md に書き戻される。activity-log がすでに Requirement 1〜4 を使っているため、書き戻したときに番号が衝突しないよう、この spec の要件は 5 から番号を振る。

## Boundary Context

- **In scope**:
  - activity を記録するすべての経路（更新系リクエストの記録、失敗・中断した操作の試行記録、サーバ内部から直接記録する経路）で、保存する endpoint の access_token の値を伏せ字にする。
  - データのインポート（管理画面からエクスポートデータを取り込む機能）で書き込まれる activity の endpoint も伏せ字にする。
  - アップグレード時のデータ移行で、すでに保存されている activity の endpoint を伏せ字にする。
- **Out of scope**:
  - 保持期間（TTL）を過ぎてすでに削除された activity。
  - 作成済みの監査ログのエクスポートファイル（ダウンロード済み・保存済みのファイルの中身は直せない）。
  - ローリングアップデート中に、古いバージョンのインスタンスがデータ移行のあとに書いた activity（保持期間を過ぎて消えるまで残る）。
  - access_token 以外のクエリパラメータの伏せ字。
  - endpoint による監査ログの検索・候補表示の仕様の変更（別 spec が担当）。
  - activity の endpoint 以外のフィールド（snapshot の中身など）の伏せ字。
- **Adjacent expectations**:
  - 監査ログの全文検索の索引は、もともと endpoint のクエリ文字列を取り除いて登録しているので、伏せ字の前後で索引の中身は変わらない。データ移行で書き換えた activity の更新は索引への同期処理にも届くが、同期処理は activity の更新を索引に反映しない。
  - GROWI 間移行（G2G）では activity は転送されないので、この spec の対象にならない。
  - 記録ゲート（どの action を記録するか）と失敗・中断した操作の試行記録の挙動は activity-log の既存の約束のままとし、この spec では変えない。

## Requirements

### Requirement 5: 記録時の伏せ字（記録経路を問わない）

**Objective:** GROWI の管理者として、どの経路で activity が記録されても endpoint に access_token が平文で残らないようにしたい。DB を読める人や監査ログを受け取った人に認証情報が漏れないようにするため。

#### Acceptance Criteria
1. When activity を記録する場合, the Activity Log System shall endpoint に含まれる `access_token` クエリパラメータの値を伏せ字に置き換えてから保存する。
2. The Activity Log System shall 記録経路（更新系リクエストの記録、失敗・中断した操作の試行記録、サーバ内部から直接記録する経路）に関わらず、Requirement 5.1 の伏せ字を適用する。
3. When endpoint の `access_token` のキー名が URL エンコードされている場合（例: `access%5Ftoken`）, the Activity Log System shall デコード後のキー名で判定し、その値を伏せ字にする。
4. When endpoint に `access_token` クエリパラメータが複数含まれる場合, the Activity Log System shall そのすべての値を伏せ字にする。
5. The Activity Log System shall 伏せ字にする値以外の endpoint の部分（パス、他のクエリパラメータ、パラメータの順序）を元のまま保存する。
6. If endpoint に `access_token` クエリパラメータが含まれない場合, the Activity Log System shall endpoint を変更せずに保存する。

### Requirement 6: 既存の activity の伏せ字（データ移行）

**Objective:** GROWI の運用者として、伏せ字処理が入る前に保存された activity に残っている平文の access_token を消したい。過去の記録からも認証情報が漏れないようにするため。

#### Acceptance Criteria
1. When アップグレード時のデータ移行が実行された場合, the Activity Log System shall 保存済みの activity のうち endpoint に `access_token` クエリパラメータを含むものについて、その値を Requirement 5 と同じ規則で伏せ字にする。
2. The Activity Log System shall データ移行で、endpoint に `access_token` クエリパラメータを含まない activity を変更しない。
3. The Activity Log System shall データ移行で、activity の endpoint 以外のフィールドを変更しない。
4. When すでに伏せ字になっている endpoint にデータ移行が適用された場合, the Activity Log System shall endpoint の値を変えない。
5. If データ移行が途中で中断された場合, the Activity Log System shall 再実行で残りの activity を伏せ字にし、すでに伏せ字にした activity を変えない。

### Requirement 7: インポート時の伏せ字

**Objective:** GROWI の管理者として、平文の access_token を含む古いエクスポートデータを取り込んでも、トークンが平文で DB に戻らないようにしたい。データ移行のあとでも平文が入り込む経路を残さないため。

#### Acceptance Criteria
1. When データのインポートで activity を取り込む場合, the Activity Log System shall 取り込む activity の endpoint に含まれる `access_token` クエリパラメータの値を、Requirement 5 と同じ規則で伏せ字にしてから保存する。
2. The Activity Log System shall インポートで取り込む activity の endpoint 以外のフィールドの取り込み結果を、本変更の前後で変えない。

### Requirement 8: 伏せ字の規則の一貫性

**Objective:** activity を保守する GROWI 開発者として、記録・データ移行・インポートで伏せ字の結果が食い違わないようにしたい。経路ごとに規則がずれて、ある経路だけ平文が残る事態を防ぐため。

#### Acceptance Criteria
1. The Activity Log System shall 同じ endpoint に対して、記録時・データ移行時・インポート時に同じ伏せ字の結果を保存する。
2. When 伏せ字にするクエリパラメータが将来追加された場合, the Activity Log System shall 記録・データ移行・インポートのすべてに同じ規則が適用されるようにする。

### Requirement 9: 既存の監査ログ機能の維持

**Objective:** GROWI の管理者として、伏せ字の変更で監査ログの閲覧・検索・エクスポートの使い勝手が変わらないようにしたい。

#### Acceptance Criteria
1. When 監査ログの一覧・エクスポートで activity を表示・出力する場合, the Activity Log System shall 保存されている伏せ字後の endpoint をそのまま表示・出力する。
2. The Activity Log System shall endpoint による監査ログの検索・候補表示の結果を、パス部分が同じ activity について伏せ字の前後で変えない。
3. The Activity Log System shall どの action を記録するか（記録ゲート）と、失敗・中断した操作の試行記録の挙動を、本変更で変えない。
