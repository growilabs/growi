# Implementation Plan

- [ ] 1. 伏せ字の規則を共有の場所に置く
- [ ] 1.1 伏せ字の関数を middleware 配下から server の共有ユーティリティへ移し、冪等性をテストで固定する
  - 関数の中身と既存の単体テストのケースは変えずに移す
  - 移した先の単体テストに、伏せ字済みの endpoint をもう一度通しても値が変わらないケースを足す
  - 記録用 middleware の import を新しい場所に向け直す（この時点では middleware の伏せ字の呼び出しは残す）
  - 完了時: 旧パスのファイルがなくなり、移した単体テスト（冪等性を含む）が通り、middleware 経由の記録の挙動は変わらない
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 6.4, 8.1, 8.2_

- [ ] 2. 保存口・インポート・データ移行に伏せ字を適用する
- [ ] 2.1 (P) activity の保存口で、行を作る前に endpoint を伏せ字にする
  - 保存口に渡された endpoint を、DB に作成を依頼する前に伏せ字の関数に通す。endpoint が渡されないときは今までどおり空文字を保存する
  - 統合テストで、access_token を含む endpoint を渡すと保存された行が伏せ字の関数の戻り値と一致し、トークンの文字列が残らず `[REDACTED]` が入っていること、渡さないと空文字のままであることを確かめる
  - 完了時: 保存口の統合テストが、保存された行の endpoint が伏せ字になっていることを示して通る
  - _Requirements: 5.1, 8.1_
  - _Boundary: ActivityExtension_

- [ ] 2.2 activity の更新口で endpoint を書けないようにする
  - 更新用のパラメータ型から endpoint を外し、オブジェクトリテラルで endpoint を渡すとコンパイルエラーになることを型のテストで固定する
  - 実行時にも、渡された値から endpoint を取り除いてから更新する
  - 統合テストで、endpoint を持つ変数（オブジェクトリテラルでない値）を渡しても、保存済みの endpoint が変わらないことを確かめる
  - 2.1 と同じ保存口のファイルを触るので並行にしない
  - 完了時: 型のテストと更新口の統合テストが通り、更新で endpoint が書き換わる経路がなくなっている
  - _Requirements: 5.2_
  - _Boundary: ActivityExtension_

- [ ] 2.3 (P) データのインポートで取り込む activity の endpoint を伏せ字にする
  - インポートのコレクションごとの上書き（`overwrite-params/`）に activity 用のモジュールを足し、コレクション名で上書きを選ぶ分岐に activity を加える。上書きするのは endpoint だけで、文字列なら伏せ字の関数に通し、文字列でなければそのまま返す
  - 変換表の activity の snapshot の特例と、他の項目の変換は変えない
  - 単体テストで、activity の上書きが endpoint だけを持つこと、トークンを含む値が伏せ字の関数の戻り値と一致し、トークンの文字列が残らず `[REDACTED]` が入っていること、文字列でない値が変わらないことを確かめる
  - 完了時: activity の上書きの単体テストが通り、取り込む endpoint が伏せ字になる
  - _Requirements: 7.1, 7.2, 8.1_
  - _Boundary: ImportEndpointConverter_

- [ ] 2.4 (P) 既存の activity の endpoint を伏せ字にするデータ移行を追加する
  - クエリ文字列を持つ activity を `_id` 順に 1,000 件ずつ読み、値が変わる文書だけを、元の endpoint を条件に含めて endpoint だけ書き換える。`_id` インデックスを使わせる
  - 1 バッチ分の読み出しのカーソルを作る関数を migration から export し、データ移行の本体はそれを使って読む
  - 開始時と、終わったときに書き換えた件数の合計をログに出す。巻き戻しは何もしない（元のトークンは戻せない旨をログに出す）
  - 統合テストで、トークンあり・エンコードされたキー・クエリなし・トークンなしのクエリ・伏せ字済みの行を seed して流し、トークンを含む行だけが伏せ字になること、他の行は値もバージョン番号も変わらないこと、endpoint 以外の項目が変わらないこと、2 回目を流したあとも全行の endpoint・バージョン番号・他の項目が 1 回目のあとと同じであること、1,000 件を超える行でも全件直ることを確かめる。伏せ字になった行の期待値は伏せ字の関数の戻り値で書き、トークンの文字列が残らず `[REDACTED]` が入っていることも確かめる
  - 同じ統合テストで、export した関数が返すカーソルの実行計画を取り（問い合わせはテストに書き写さない）、`_id` インデックスの IXSCAN が選ばれ、SORT ステージがないことを assert する
  - 完了時: データ移行の統合テスト（実行計画の assert を含む）が通る
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 8.1_
  - _Boundary: RedactionMigration_

- [ ] 3. 記録経路を保存口の伏せ字につなぎ替え、全体を確かめる
- [ ] 3.1 記録用 middleware の伏せ字をやめ、すべての記録経路が保存口で伏せ字になることを確かめる
  - middleware は文脈の endpoint にリクエスト URL をそのまま入れる。文脈の他の項目、id の採番、finalizer の登録は変えない
  - 記録ゲートの統合テストに、生の URL を持つ文脈から settle した行が伏せ字で保存されるケースを足す
  - 失敗・中断した操作の試行記録の統合テストに、生の URL を持つ文脈から作った行が伏せ字で保存されるケースを足す
  - サーバ内部からの直接記録の統合テストに、直接呼び出しで作った行が伏せ字で保存されるケースを足す
  - 完了時: middleware から伏せ字の呼び出しがなくなり、上の 3 つの統合テストと既存の記録ゲート・試行記録のテストが通る
  - _Depends: 2.1_
  - _Requirements: 5.2, 9.3_

- [ ] 3.2 監査ログの既存機能が変わらないことを確かめ、品質チェックを通す
  - 監査ログの一覧・エクスポート・endpoint の候補表示・ES 索引の整形の既存テストが変更なしで通ることを確かめる
  - 既存の候補表示のテストは伏せ字前の行しか seed していないので、伏せ字済みの endpoint を持つ行を seed しても、パス部分が同じ行の候補表示の結果が変わらないケースを足す
  - アプリ全体の lint・テスト・ビルドを通す
  - 完了時: 伏せ字済みの行を含む候補表示のケースが通り、lint・テスト・ビルドがすべて成功する
  - _Requirements: 9.1, 9.2, 9.3_

- [ ] 4. 変更を activity-log spec と activity-log-snapshot spec に書き戻し、この spec を削除する
- [ ] 4.1 activity-log の requirements.md と design.md を書き換える
  - requirements.md の末尾に Requirement 5〜9 を追加し（既存の 1〜4 は番号を変えない）、Boundary Context（Adjacent expectations を含む）を design.md の Amend target の表のとおりに直す
  - design.md を Amend target の表の全行のとおりに直す（Non-Goals、This Spec Owns、Out of Boundary、Allowed Dependencies、Revalidation Triggers、Existing Architecture Analysis、Architecture Pattern & Boundary Map、Technology Stack、File Structure Plan、System Flows、Requirements Traceability、Components and Interfaces、add-activity middleware、保存口、settleActivityRecord、Data Models、Error Handling、Performance & Scalability、Migration Strategy、Testing Strategy、Security Considerations）
  - activity-log-snapshot の design.md を、Amend target の activity-log-snapshot の表のとおりに直す（`IActivityUpdateParameters` が `endpoint` を含まないこと）
  - 本文は amend がなかったかのように現在の事実だけで書き、経緯の語りを残さない
  - 完了時: activity-log の requirements.md と design.md、activity-log-snapshot の design.md に、Amend target の両方の表の全行の変更が入っている
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 8.1, 8.2, 9.1, 9.2, 9.3_

- [ ] 4.2 設計判断を移し、この spec を削除する
  - この spec の research.md の Decision をすべて activity-log の research.md に移す
  - activity-log と activity-log-snapshot の spec.json の `updated_at` を更新する（`phase` / `approvals` は変えない）
  - roadmap.md と steering にこの spec への言及があれば外すか、移した先に向け直す
  - このディレクトリを削除する
  - 完了時: `.kiro/specs/activity-access-token-redaction/` が存在せず、リポジトリ内にこの spec への参照が残っていない
  - _Depends: 4.1_
